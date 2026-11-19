import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'fflate';
import { Store } from './store.ts';
import { Rules } from './rules.ts';
import { RulePackSchema } from '../../packages/core/requirement-lint.ts';
import type { Drafts } from './polarion.ts';
import type { Target } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'PSB', document: '_wiki/测试文档' };
const openStore = () => new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-')), 'test.db'));

function stubDrafts(remote?: object): Drafts {
  return { remote } as unknown as Drafts;
}

const polarionPack = RulePackSchema.parse({ version: 7, glossary: [{ term: '刹车助力', aliases: ['制动助力'] }], lintRules: [{ id: 'fuzzy', severity: 'warn', type: 'fuzzy-word', words: ['快速'], message: '模糊词', enabled: true }] });

function remoteWith(attachments: { file_name: string; dataBase64: string }[]) {
  return {
    changeList: async () => [{ workItemId: 'PSB-1', attachments: attachments.map(({ file_name }) => ({ file_name })) }],
    changeRead: async (_t: unknown, _id: string, name: string) => ({ dataBase64: attachments.find(item => item.file_name === name)!.dataBase64, updated: 'x' }),
  };
}

test('无远端时回退内置默认规则包', async () => {
  const store = openStore();
  const view = await new Rules(store, stubDrafts()).read(target);
  assert.equal(view.source, 'default');
  assert.equal(view.pack.lintRules.length, 6); // 严格基线 v2
  store.close();
});

test('PSB-RULES 附件（gzip JSON）解析成功并写入缓存', async () => {
  const store = openStore();
  const dataBase64 = Buffer.from(gzipSync(Buffer.from(JSON.stringify(polarionPack)))).toString('base64');
  const drafts = stubDrafts(remoteWith([{ file_name: 'sidebar-rules.pack.json', dataBase64 }]));
  const first = await new Rules(store, drafts).read(target, true);
  assert.equal(first.source, 'polarion');
  assert.equal(first.version, 7);
  assert.equal(first.workItemId, 'PSB-1');
  // 第二次读取：远端不可用时也应命中缓存而不是默认包。
  const second = await new Rules(store, stubDrafts()).read(target);
  assert.equal(second.source, 'cache');
  assert.equal(second.pack.glossary[0]!.term, '刹车助力');
  store.close();
});

test('远端删除规则包后刷新会撤销旧缓存，再开编辑器仍使用默认规则', async () => {
  const store = new Store(':memory:');
  try {
    const dataBase64 = Buffer.from(JSON.stringify(polarionPack)).toString('base64');
    await new Rules(store, stubDrafts(remoteWith([{ file_name: 'sidebar-rules.pack.json', dataBase64 }]))).read(target, true);
    const rules = new Rules(store, stubDrafts({ changeList: async () => [], changeRead: async () => { throw Error('unused'); } }));
    assert.equal((await rules.read(target, true)).source, 'default');
    const reopened = await rules.read(target);
    assert.equal(reopened.source, 'default');
    assert.deepEqual(reopened.pack.glossary, []);
  } finally { store.close(); }
});

test('明文 base64 JSON 附件也能解析', async () => {
  const store = openStore();
  const dataBase64 = Buffer.from(JSON.stringify(polarionPack), 'utf8').toString('base64');
  const view = await new Rules(store, stubDrafts(remoteWith([{ file_name: 'sidebar-rules.pack.json', dataBase64 }]))).read(target, true);
  assert.equal(view.source, 'polarion');
  store.close();
});

test('非法 JSON 落回缓存或默认包并给出提示', async () => {
  const store = openStore();
  const rules = new Rules(store, stubDrafts(remoteWith([{ file_name: 'sidebar-rules.pack.json', dataBase64: Buffer.from('{"broken":').toString('base64') }])));
  const view = await rules.read(target, true);
  assert.equal(view.source, 'default');
  assert.match(view.error ?? '', /PSB-RULES 读取失败/);
  store.close();
});

test('工作项存在但缺少附件时提示补建', async () => {
  const store = openStore();
  const view = await new Rules(store, stubDrafts(remoteWith([]))).read(target, true);
  assert.equal(view.source, 'default');
  assert.match(view.error ?? '', /缺少附件/);
  store.close();
});

test('save 写回 PSB-RULES 附件并更新缓存', async () => {
  const store = openStore();
  const written: unknown[] = [];
  const drafts = stubDrafts({
    changeList: async () => [{ workItemId: 'PSB-9', updated: 'v1', attachments: [] }],
    changeWrite: async (input: unknown) => { written.push(input); return { workItemId: 'PSB-9', updated: 'v2' }; },
  });
  const view = await new Rules(store, drafts).save(target, polarionPack);
  assert.equal(view.source, 'polarion');
  assert.equal(view.workItemId, 'PSB-9');
  assert.equal((written[0] as { workItemId?: string }).workItemId, 'PSB-9');
  assert.equal((written[0] as { fileName: string }).fileName, 'sidebar-rules.pack.json');
  // 缓存已带新包：远端不可用时读取到的就是刚保存的内容。
  const cached = await new Rules(store, stubDrafts()).read(target);
  assert.equal(cached.source, 'cache');
  assert.equal(cached.pack.version, 7);
  store.close();
});

test('save 冲突时报专用错误引导刷新', async () => {
  const store = openStore();
  const drafts = stubDrafts({
    changeList: async () => [{ workItemId: 'PSB-9', updated: 'v1', attachments: [] }],
    changeWrite: async () => { throw Error('REMOTE_CONFLICT'); },
  });
  await assert.rejects(() => new Rules(store, drafts).save(target, polarionPack), /RULES_CONFLICT/);
  store.close();
});

test('save 新建工作项时按类型候选回退重试', async () => {
  const store = openStore();
  const types: string[] = [];
  const drafts = stubDrafts({
    changeList: async () => [],
    changeWrite: async (input: { type?: string }) => { types.push(input.type ?? ''); if (input.type === 'task') throw Error('CHANGE_RECORD_CREATE_FAILED'); return { workItemId: 'PSB-10', updated: 'v1' }; },
  });
  const view = await new Rules(store, drafts).save(target, polarionPack);
  assert.equal(view.workItemId, 'PSB-10');
  assert.deepEqual(types, ['task', 'changeRequest']);
  store.close();
});

test('v1 旧规则包读取时自动升级到 v2 基线（新规则补入、词表并集、版本提升）', async () => {
  const store = openStore();
  // 模拟项目里存的 v1 旧包：只有 4 条旧规则、模糊词表为旧词
  const legacy = { version: 1, glossary: [], lintRules: [
    { id: 'fuzzy-default', severity: 'warn', type: 'fuzzy-word', message: '旧文案', enabled: true, words: ['快速', '及时'] },
    { id: 'non-atomic-default', severity: 'warn', type: 'non-atomic', message: '', enabled: true, words: [] },
  ] };
  // 版本号更高但内容更旧的包也要合并（真机坑：远端 version=3 存的却是 4 条旧规则）。
  store.put('rule-pack', 'rule-test', { pack: legacy, updated: 1 });
  const view = await new Rules(store, stubDrafts()).read({ origin: 'https://polarion.pufafen.com', projectId: 'rule-test', document: 'd' } as never);
  assert.equal(view.pack.lintRules.length >= 6, true);
  const ids = view.pack.lintRules.map(rule => rule.id);
  assert.ok(ids.includes('no-condition-default')); // 新规则补入
  assert.ok(ids.includes('long-sentence-default'));
  const fuzzy = view.pack.lintRules.find(rule => rule.id === 'fuzzy-default')!;
  assert.ok(fuzzy.words.includes('快速') && fuzzy.words.includes('尽快')); // 用户词保留 + 内置新词并集
  assert.equal(fuzzy.message, '旧文案'); // 用户自定义文案不被覆盖
  store.close();
});
