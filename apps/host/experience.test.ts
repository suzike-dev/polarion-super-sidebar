import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.ts';
import { experiencePath, readExperience, writeExperience, clearExperience, conversationDigest, distillExperience } from './experience.ts';
import type { query } from '@anthropic-ai/claude-agent-sdk';

test('experience files are per-project, sanitized, and round-trip through write/read/clear', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psb-exp-store-'));
  try {
    assert.equal(experiencePath('proj/with space', dir), join(dir, 'experience', 'proj_with_space.md'));
    assert.deepEqual(readExperience('p1', dir), { text: '', path: experiencePath('p1', dir), updatedAt: 0 });
    const saved = writeExperience('p1', '## 沟通\n- 先解释再动手。', dir);
    assert.equal(saved.text, '## 沟通\n- 先解释再动手。');
    assert.ok(saved.updatedAt > 0);
    assert.equal(await readFile(experiencePath('p1', dir), 'utf8'), saved.text);
    assert.equal(readExperience('p2', dir).text, '', '经验按项目隔离');
    const cleared = clearExperience('p1', dir);
    assert.equal(cleared.text, ''); assert.equal(cleared.updatedAt, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('conversation digest keeps user corrections and bounds assistant text', async () => {
  const store = new Store(':memory:');
  try {
    const session = store.createSession({ origin: 'https://polarion.pufafen.com', projectId: 'test01', document: 'Requirements/Digest' }, 'digest');
    const run = store.startRun(session.id, crypto.randomUUID(), '把阈值改成 50', []).run;
    store.event(run, 'user', { text: '把阈值改成 50' });
    store.event(run, 'result', { text: '已修改。'.repeat(900) });
    const second = store.startRun(session.id, crypto.randomUUID(), '不对，不要直接改服务端', []).run;
    store.event(second, 'user', { text: '不对，不要直接改服务端，必须先走本地草稿。' });
    store.event(second, 'result', { text: '明白，后续先走草稿。' });
    const digest = conversationDigest(store, session.id);
    assert.match(digest, /【用户】把阈值改成 50/);
    assert.match(digest, /【用户】不对，不要直接改服务端/);
    assert.match(digest, /【助手】明白，后续先走草稿。/);
    assert.ok(!digest.includes('已修改。'.repeat(900)), '助手回答必须截断');
    assert.ok(digest.length <= 28000);
    const capped = conversationDigest(store, session.id, 60);
    assert.ok(capped.length <= 60);
    assert.match(capped, /不要直接改服务端/, '截断保留最近的纠正');
  } finally { store.close(); }
});

function distillFixture(messages: any[]) {
  const factory: typeof query = () => {
    async function* stream() { yield* messages; }
    const iterator = stream() as any;
    iterator.close = () => { void iterator.return(); };
    return iterator;
  };
  return factory;
}

test('distill merges lessons, strips fences, and reports failures honestly', async () => {
  const ok = distillFixture([
    { type: 'assistant', message: { content: [{ type: 'text', text: '```markdown\n## 工具与流程\n- 必须先走本地草稿。\n```' }] } },
    { type: 'result', subtype: 'success', result: '## 工具与流程\n- 必须先走本地草稿。\n- 回答先解释动作。' },
  ]);
  const text = await distillExperience({ digest: '【用户】不对，先走草稿', existing: '' }, ok);
  assert.equal(text, '## 工具与流程\n- 必须先走本地草稿。\n- 回答先解释动作。');
  const failed = distillFixture([{ type: 'result', subtype: 'error_during_execution', errors: ['boom'] }]);
  await assert.rejects(distillExperience({ digest: 'x', existing: '' }, failed), /EXPERIENCE_FAILED/);
  const empty = distillFixture([{ type: 'result', subtype: 'success', result: '   ' }]);
  await assert.rejects(distillExperience({ digest: 'x', existing: '' }, empty), /EXPERIENCE_EMPTY/);
  const broken: typeof query = () => { throw Error('spawn claude ENOENT'); };
  await assert.rejects(distillExperience({ digest: 'x', existing: '' }, broken), /EXPERIENCE_UNAVAILABLE/);
});
