import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTablePreset, tidyDocument, tablePresetLabels } from './document-tidy.ts';
import type { JSONContent } from '@tiptap/core';
import { RichDocument } from './rich-document.ts';
import { richSchema } from './rich-schema.ts';

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
    { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'polarion-asset:x', width: 2000, height: 1000 } }] },
    empty,
  ] };
  const { doc: tidy, changes } = tidyDocument(doc);
  // 开头 2 个、正文一后折叠 1 个、结尾 1 个 = 4；正文一与正文二之间保留单个空段。
  assert.equal(changes.emptyParagraphs, 4);
  richSchema.nodeFromJSON(tidy).check();
  assert.equal(tidy.content!.length, 4);
  assert.deepEqual(tidy.content![1], empty);
  const image = tidy.content!.at(-1)!.content![0]!;
  assert.equal(image.type, 'image');
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

test('tidy never empties a table cell or leaves a list item starting with a nested list', () => {
  const doc: JSONContent = { type: 'doc', content: [
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableHeader', content: [{ type: 'paragraph' }] },
      { type: 'tableCell', content: [{ type: 'paragraph' }, { type: 'paragraph' }] },
    ] }] },
    { type: 'orderedList', content: [
      { type: 'listItem', content: [{ type: 'paragraph' }, { type: 'orderedList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '子项' }] }] },
      ] }] },
    ] },
  ] };
  const { doc: tidy } = tidyDocument(doc);
  const cell = ((tidy.content![0]!.content![0]!.content as JSONContent[])[1]!.content) as JSONContent[];
  assert.equal(cell[0]!.type, 'paragraph'); // 单元格至少保留一个块，不能被清空
  const item = (tidy.content![1]!.content as JSONContent[])[0]!;
  assert.equal(item.content![0]!.type, 'paragraph'); // 嵌套列表前保留段落
  // 修整后的结构必须能被真实 schema 接受（保存时不再抛 Invalid content）。
  richSchema.nodeFromJSON(tidy).check();
});

test('tidy retains the original required paragraph for an empty document, task or nested list', () => {
  const sources = [
    '<p id="cursor"></p><p></p>',
    '<ol id="steps"><li class="outer"><p id="lead"></p><ol><li><p id="empty"></p></li></ol></li></ol>',
    '<ul data-sidebar-tasks="true" id="tasks"><li data-sidebar-task="true" data-checked="true" class="step"><span data-task-marker="true">☑</span><div data-task-content="true"><p id="lead"></p><ul><li>child</li></ul></div></li></ul>',
  ];
  for (const html of sources) {
    const base = new RichDocument(html);
    const first = tidyDocument(base.document);
    richSchema.nodeFromJSON(first.doc).check();
    const saved = base.serialize(first.doc);
    assert.equal(saved, html.replace('<p id="cursor"></p><p></p>', '<p id="cursor"></p>'));
    const reopened = new RichDocument(saved);
    assert.deepEqual(tidyDocument(reopened.document).doc, reopened.document);
  }
});

test('tidy finishes nested borderless tables in one pass and preserves native attributes, authored cells and macros', () => {
  const macro = '<span id="polarion_wiki macro name=fixture;params=keep">literal  text。。</span>';
  const source = '<p class="bookmark" data-native="empty"></p><table id="polarion_wiki macro name=table;params=tidy" class="outer" style="width:90%"><tbody id="rows"><tr>' +
    '<th rowspan="1" data-fixture="head" style="background-color:#fec;text-align:center">title \u3000  here。。</th><td colspan="2" style="mso-header:keep">' +
    '<p><img src="img.png" width="2400" height="800"></p>' + macro +
    '<table class="nested"><tr><td>inner  text。。</td></tr></table>' +
    '<table class="styled" style="border:3px solid red"><tr><td style="padding:2px">styled  text</td></tr></table></td></tr></tbody></table>';
  const model = new RichDocument(source);
  const first = tidyDocument(model.document, { tableDefaults: true });
  richSchema.nodeFromJSON(first.doc).check();
  assert.deepEqual(first.changes, { emptyParagraphs: 0, resizedImages: 1, tables: 2, quotes: 0, hexPrefixes: 0, spaces: 3, punctuation: 2 });
  const result = model.serialize(first.doc);
  for (const retained of ['<p class="bookmark" data-native="empty"></p>', 'id="polarion_wiki macro name=table;params=tidy"', '<tbody id="rows">', 'rowspan="1"', 'data-fixture="head"', 'background-color:#fec', 'text-align:center', 'colspan="2"', 'mso-header:keep', 'title here。', 'inner text。', 'width="1200"', 'height="400"', macro, '<table class="styled" style="border:3px solid red"><tr><td style="padding:2px">styled text</td></tr></table>']) assert.ok(result.includes(retained), retained);
  const reopened = new RichDocument(result);
  for (const doc of [first.doc, reopened.document]) {
    const again = tidyDocument(doc, { tableDefaults: true });
    richSchema.nodeFromJSON(again.doc).check();
    assert.deepEqual(again.doc, doc);
    assert.ok(Object.values(again.changes).every(count => count === 0));
  }
  assert.equal(reopened.serialize(reopened.document), result);
});
