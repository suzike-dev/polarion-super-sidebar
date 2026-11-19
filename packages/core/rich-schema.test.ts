import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichJSON, richSchema } from './rich-schema.ts';

test('sanitizeRichJSON：空 cell 补段落、裸内联包段落、合法结构不动', () => {
  const bad = { type: 'doc', content: [
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableHeader', content: [{ type: 'text', text: '裸内联表头' }] },
      { type: 'tableCell', content: [] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '合法' }] }] },
    ] }] },
  ] };
  const fixed = sanitizeRichJSON(bad as never) as typeof bad;
  const row = (fixed.content![0]!.content as { content: unknown[] }[])[0]!;
  const [header, emptyCell, goodCell] = row.content as { type: string; content: { type: string; content?: { text: string }[] }[] }[];
  assert.equal(header.content![0]!.type, 'paragraph'); // 裸内联被包进段落
  assert.equal(header.content![0]!.content![0]!.text, '裸内联表头');
  assert.deepEqual(emptyCell.content, [{ type: 'paragraph' }]); // 空 cell 补空段落
  assert.deepEqual(goodCell.content, [{ type: 'paragraph', content: [{ type: 'text', text: '合法' }] }]); // 合法不动
  // 通过真实 schema 校验（此前这类内容会让 nodeFromJSON 抛 Invalid content）。
  richSchema.nodeFromJSON(fixed as never);
});
