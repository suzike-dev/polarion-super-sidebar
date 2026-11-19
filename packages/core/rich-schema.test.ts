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
  richSchema.nodeFromJSON(fixed).check();
});

test('sanitizeRichJSON：listItem 以嵌套列表开头时补一个段落', () => {
  const bad = { type: 'doc', content: [
    { type: 'orderedList', content: [
      { type: 'listItem', content: [{ type: 'orderedList', content: [
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ] }] },
    ] },
  ] };
  const fixed = sanitizeRichJSON(bad as never) as typeof bad;
  const outer = (fixed.content![0]!.content as { content: { type: string }[] }[])[0]!;
  assert.equal(outer.content[0]!.type, 'paragraph');
  assert.equal(outer.content[1]!.type, 'orderedList');
  richSchema.nodeFromJSON(fixed).check();
});

test('repairs omitted cell content and groups only consecutive inline nodes without losing their anchors or order', () => {
  const lead = { type: 'workItemRef', attrs: { workItemId: 'TEST-1', sid: 'ref' } };
  const text = { type: 'text', text: 'retained', marks: [{ type: 'sourceText', attrs: { sid: 'text' } }] };
  const macro = { type: 'protectedInline', attrs: { sid: 'macro', label: 'opaque', text: 'literal' } };
  const middle = { type: 'paragraph', attrs: { sid: 'middle', sourceStyle: 'color:red' } };
  const row = { type: 'tableRow', content: [
    { type: 'tableHeader', attrs: { sid: 'header', rowspan: 2 } },
    { type: 'tableCell', attrs: { sid: 'cell', colspan: 2 }, content: [lead, text, middle, macro, { type: 'hardBreak' }] },
  ] };
  const doc = { type: 'doc', content: [{ type: 'table', content: [row] }] };
  const fixed = sanitizeRichJSON(doc);
  richSchema.nodeFromJSON(fixed).check();
  const [header, cell] = fixed.content![0]!.content![0]!.content!;
  assert.deepEqual(header, { ...row.content[0], content: [{ type: 'paragraph' }] });
  assert.deepEqual(cell, { ...row.content[1], content: [
    { type: 'paragraph', content: [lead, text] }, middle, { type: 'paragraph', content: [macro, { type: 'hardBreak' }] },
  ] });
  assert.deepEqual(sanitizeRichJSON(fixed), fixed);
  assert.equal(row.content[0]!.content, undefined);
});

test('repairs empty required containers while malformed and unknown children still fail validation', () => {
  const check = (json: Parameters<typeof sanitizeRichJSON>[0]) => richSchema.nodeFromJSON(sanitizeRichJSON(json)).check();
  check({ type: 'doc' });
  check({ type: 'doc', content: ['orderedList', 'bulletList', 'taskList', 'blockquote', 'sourceContainer', 'callout'].map(type => ({ type })) });
  check({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'bulletList' }] }] }] });
  for (const child of [{ type: 'unknownNode' }, {}, { type: 'tableRow' }]) {
    const cell = { type: 'tableCell', content: [child] };
    assert.throws(() => check({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell] }] }] }));
  }
});
