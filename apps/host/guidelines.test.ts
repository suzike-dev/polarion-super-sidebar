import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {guidelineContent, validateGuideline} from './guidelines.ts';
import type {Guideline} from '../../packages/protocol/index.ts';
const base = (patch: Partial<Guideline>): Guideline => ({ id: crypto.randomUUID(), kind: 'library', name: '指令', description: '', content: '', files: [], file: '', ...patch });
test('guideline content merges inline text with every attached file and keeps per-file labels', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polarion-guideline-'));
  try {
    const template = join(directory, 'template.md'), vars = join(directory, 'vars.md');
    writeFileSync(template, '# 需求模板\n每条需求包含用途与边界。');
    writeFileSync(vars, '# 变量表\nsetpoint 单位 ℃');
    const guideline = base({ content: '总则：保持工程参数。', files: [{ path: template, label: '需求模板 v2' }, { path: vars, label: '' }] });
    const resolved = guidelineContent(guideline);
    assert.match(resolved.text, /总则：保持工程参数。/);
    assert.match(resolved.text, /【文件：需求模板 v2】[\s\S]*每条需求包含用途与边界/);
    assert.match(resolved.text, /【文件：vars\.md】[\s\S]*setpoint 单位 ℃/);
    assert.equal(resolved.source, 'file');
    assert.deepEqual(resolved.files.map(file => file.label), ['需求模板 v2', 'vars.md']);
    validateGuideline(guideline);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('guideline validation rejects empty content, missing files and legacy single-file input is normalized', () => {
  assert.throws(() => validateGuideline(base({})), /GUIDELINE_EMPTY/);
  assert.throws(() => validateGuideline(base({ files: [{ path: 'C:/definitely-missing-file.md', label: '' }] })), /GUIDELINE_FILE_INVALID/);
  validateGuideline(base({ content: '只有正文也可以。' }));
  const legacy = base({ file: 'C:/legacy.md', content: '' });
  const resolved = (() => { try { return guidelineContent(legacy); } catch { return null; } })();
  assert.equal(resolved, null, 'legacy single file is read through the same validated path');
});
