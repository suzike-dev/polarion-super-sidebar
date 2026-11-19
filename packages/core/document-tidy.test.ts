import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTablePreset, tidyDocument, tablePresetLabels } from './document-tidy.ts';
import type { JSONContent } from '@tiptap/core';
import { RichDocument } from './rich-document.ts';

const table = (style?: string): JSONContent => ({ type: 'table', ...(style ? { attrs: { sourceStyle: style } } : {}), content: [
  { type: 'tableRow', content: [
    { type: 'tableHeader', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: '信号' }] }] },
    { type: 'tableHeader', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: '单位' }] }] },
  ] },
  { type: 'tableRow', content: [
    { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'T_amb' }] }] },
    { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: '°C' }] }] },
  ] },
  { type: 'tableRow', content: [
    { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'T_bat' }] }] },
    { type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: '°C' }] }] },
  ] },
] });

test('three-line preset writes header rules and clears cell borders', () => {
  const { doc, tables } = applyTablePreset({ type: 'doc', content: [table()] }, 'threeLine');
  assert.equal(tables, 1);
  const header = (doc.content![0]!.content![0]!.content as JSONContent[])[0]!;
  const cell = (doc.content![0]!.content![1]!.content as JSONContent[])[0]!;
  assert.ok(String(header.attrs!.sourceStyle).includes('border-top:2px solid #1f2937'), header.attrs!.sourceStyle);
  assert.ok(String(cell.attrs!.sourceStyle).includes('border-bottom:1px solid #9ca3af'));
  assert.equal(header.attrs!.fill, 'transparent');
});

test('zebra preset fills alternate body rows and keeps existing table width', () => {
  const { doc } = applyTablePreset({ type: 'doc', content: [table('width:100%;border-collapse:collapse')] }, 'zebra');
  const rows = doc.content![0]!.content as JSONContent[];
  assert.ok(String(doc.content![0]!.attrs!.sourceStyle).includes('width:100%'));
  // header(row 0) 之后：第 1 个正文行染色、第 2 个不染。
  assert.equal((rows[1]!.content as JSONContent[])[0]!.attrs!.fill, '#f4f8f5');
  const third = applyTablePreset({ type: 'doc', content: [table(), table(), table()] }, 'zebra');
  assert.ok(!((third.doc.content![2]!.content![2]!.content as JSONContent[])[0]!.attrs!.fill));
});

for (const reopen of [false, true]) {
  test(`switching zebra to minimal clears preset colors ${reopen ? 'after reopening' : 'in the same edit'}`, () => {
    const base = new RichDocument('<table><tr><th>信号</th></tr><tr><td>温度</td></tr><tr><td style="background-color:#fff2aa">警告</td></tr></table>');
    const zebra = applyTablePreset(base.document, 'zebra').doc;
    const striped = base.serialize(zebra);
    assert.match(striped, /background-color:#f4f8f5/);

    const model = reopen ? new RichDocument(striped) : base;
    const minimal = applyTablePreset(reopen ? model.document : zebra, 'minimal').doc;
    const saved = model.serialize(minimal);
    assert.doesNotMatch(saved, /#f4f8f5|#eef4f0/i);
    assert.match(saved, /background-color:#fff2aa/);
    const reopened = new RichDocument(saved);
    assert.equal(reopened.serialize(reopened.document), saved);
  });
}

test('preset labels cover all four presets', () => {
  assert.deepEqual(Object.keys(tablePresetLabels).sort(), ['minimal', 'plain', 'threeLine', 'zebra']);
});

test('tidy collapses leading and repeated empty paragraphs and resizes wide images', () => {
  const empty = { type: 'paragraph' };
  const doc: JSONContent = { type: 'doc', content: [
    empty, empty,
    { type: 'paragraph', content: [{ type: 'text', text: '正文一' }] },
    empty, empty,
    { type: 'paragraph', content: [{ type: 'text', text: '正文二' }] },
    { type: 'image', attrs: { src: 'polarion-asset:x', width: 2000, height: 1000 } },
    empty,
  ] };
  const { doc: tidy, changes } = tidyDocument(doc);
  // 开头 2 个、正文一后折叠 1 个、结尾 1 个 = 4；正文一与正文二之间保留单个空段。
  assert.equal(changes.emptyParagraphs, 4);
  const kinds = tidy.content!.map(node => node.type);
  assert.deepEqual(kinds, ['paragraph', 'paragraph', 'paragraph', 'image']);
  const image = tidy.content!.find(node => node.type === 'image')!;
  assert.equal(image.attrs!.width, 1200);
  assert.equal(image.attrs!.height, 600);
});

test('tidy keeps one serializable body paragraph when details contains only empty paragraphs', () => {
  const base = new RichDocument('<details open><summary>备注</summary><p id="body"></p><p></p></details>');
  const { doc, changes } = tidyDocument(base.document);
  const saved = base.serialize(doc);
  assert.equal(changes.emptyParagraphs, 1);
  assert.equal(saved, '<details open><summary>备注</summary><p id="body"></p></details>');
  const reopened = new RichDocument(saved);
  const again = tidyDocument(reopened.document);
  assert.equal(again.changes.emptyParagraphs, 0);
  assert.equal(reopened.serialize(again.doc), saved);
});

test('tidy applies plain preset to borderless tables only', () => {
  const { changes } = tidyDocument({ type: 'doc', content: [table(), table('border-collapse:collapse;border:1px solid #cbd6e5')] }, { tableDefaults: true });
  assert.equal(changes.tables, 1);
});

test('tidy normalizes quotes, hex prefixes, runaway spaces and duplicated CJK punctuation', () => {
  const doc: JSONContent = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '由0x0"连接状态"跳变为0x1，ID 为 0X22B。。信号保持  联接\u3000状态，，' }] },
  ] };
  const { doc: tidy, changes } = tidyDocument(doc);
  const text = (tidy.content![0]!.content as JSONContent[])[0]!.text!;
  assert.equal(text, '由0x0“连接状态”跳变为0x1，ID 为 0x22B。信号保持 联接 状态，');
  assert.equal(changes.quotes, 1);
  assert.equal(changes.hexPrefixes, 1);
  assert.equal(changes.spaces, 2);
  assert.equal(changes.punctuation, 2);
  // 再跑一遍应零变化（幂等）。
  const again = tidyDocument(tidy);
  assert.deepEqual(again.changes, { emptyParagraphs: 0, resizedImages: 0, tables: 0, quotes: 0, hexPrefixes: 0, spaces: 0, punctuation: 0 });
});

test('tidy leaves code blocks, inline code and formulas untouched', () => {
  const doc: JSONContent = { type: 'doc', content: [
    { type: 'paragraph', content: [
      { type: 'text', text: '正文 "配对引号" 与 ' },
      { type: 'text', marks: [{ type: 'code' }], text: '0X22B  "保持原样"' },
      { type: 'text', text: ' 结束' },
    ] },
    { type: 'codeBlock', attrs: { language: 'c' }, content: [{ type: 'text', text: 'if (x == 0XFF)  return "raw";' }] },
  ] };
  const { doc: tidy, changes } = tidyDocument(doc);
  const paragraph = (tidy.content![0]!.content as JSONContent[]);
  assert.equal(paragraph[0]!.text, '正文 “配对引号” 与 ');
  assert.equal(paragraph[1]!.text, '0X22B  "保持原样"');
  assert.equal(((tidy.content![1]!.content as JSONContent[])[0]!).text, 'if (x == 0XFF)  return "raw";');
  assert.equal(changes.quotes, 1);
  assert.equal(changes.hexPrefixes, 0);
  assert.equal(changes.spaces, 0);
});

test('tidy keeps unpaired straight quotes as-is', () => {
  const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用了"未闭合的引号 和 0x0 值' }] }] };
  const { changes } = tidyDocument(doc);
  assert.equal(changes.quotes, 0);
});
