import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff } from './line-diff.ts';

test('lineDiff keeps identical text as all-same rows', () => {
  const rows = lineDiff('## 需求编写\n- 先走草稿。\n- 回答先解释。', '## 需求编写\n- 先走草稿。\n- 回答先解释。');
  assert.deepEqual(rows, [
    { kind: 'same', text: '## 需求编写' },
    { kind: 'same', text: '- 先走草稿。' },
    { kind: 'same', text: '- 回答先解释。' },
  ]);
});

test('lineDiff emits del rows before ins rows within each hunk', () => {
  const before = '## 排版\n- 老条目一。\n- 老条目二。\n## 工具';
  const after = '## 排版\n- 老条目一。\n- 新条目。\n## 工具';
  const rows = lineDiff(before, after);
  assert.deepEqual(rows, [
    { kind: 'same', text: '## 排版' },
    { kind: 'same', text: '- 老条目一。' },
    { kind: 'del', text: '- 老条目二。' },
    { kind: 'ins', text: '- 新条目。' },
    { kind: 'same', text: '## 工具' },
  ]);
});

test('lineDiff handles pure insertion and pure deletion at both ends', () => {
  assert.deepEqual(lineDiff('A\nB', 'A\nB\nC'), [
    { kind: 'same', text: 'A' },
    { kind: 'same', text: 'B' },
    { kind: 'ins', text: 'C' },
  ]);
  assert.deepEqual(lineDiff('0\nA\nB', 'A\nB'), [
    { kind: 'del', text: '0' },
    { kind: 'same', text: 'A' },
    { kind: 'same', text: 'B' },
  ]);
  assert.deepEqual(lineDiff('', '新条目'), [{ kind: 'ins', text: '新条目' }]);
  assert.deepEqual(lineDiff('旧条目', ''), [{ kind: 'del', text: '旧条目' }]);
  assert.deepEqual(lineDiff('', ''), []);
});

test('lineDiff falls back to whole-replace when inputs are too large to align', () => {
  const before = Array.from({length: 1200}, (_, i) => `b${i}`).join('\n');
  const after = Array.from({length: 1200}, (_, i) => `a${i}`).join('\n');
  const rows = lineDiff(before, after);
  assert.equal(rows.length, 2400);
  assert.ok(rows.slice(0, 1200).every(row => row.kind === 'del'));
  assert.ok(rows.slice(1200).every(row => row.kind === 'ins'));
});
