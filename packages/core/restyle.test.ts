import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RichDocument } from './rich-document.ts';
import { restyleDocument } from './restyle.ts';

const html = '<p>4.2.16 宠物模式</p><p>开启后系统按下列规则调节：</p><p>1. 目标温度下调 2 摄氏度</p><p></p><table><tr><td>旧表</td></tr></table><p>4.2.16.1 结束</p>';

test('restyle promotes numbered paragraphs to headings with depth levels and drops empty paragraphs', () => {
  const base = new RichDocument(html);
  const { document, changes } = restyleDocument(base.document, { promoteNumberedHeadings: true, removeEmptyParagraphs: true });
  assert.equal(changes.promoted, 3);
  assert.equal(changes.removedEmptyParagraphs, 1);
  const saved = base.serialize(document);
  const reopened = new RichDocument(saved);
  assert.equal(reopened.serialize(reopened.document), saved);
  const types = reopened.document.content!.map(node => node.type);
  assert.deepEqual(types, ['heading', 'paragraph', 'heading', 'table', 'heading']);
  assert.equal(reopened.document.content![0]!.attrs!.level, 3);
  assert.equal(reopened.document.content![2]!.attrs!.level, 1);
  assert.equal(reopened.document.content!.at(-1)!.attrs!.level, 4);
  assert.match(saved, /宠物模式/);
  assert.ok(!/<p>\s*<\/p>/.test(saved), '空段落被清理');
});

test('line-height and align apply to every paragraph without touching structure', () => {
  const base = new RichDocument(html);
  const { document, changes } = restyleDocument(base.document, { paragraphLineHeight: '1.5', paragraphTextAlign: 'left' });
  assert.ok(changes.lineHeightSet >= 4);
  const saved = base.serialize(document);
  assert.equal(new RichDocument(saved).document.content!.length, base.document.content!.length);
  assert.match(saved, /宠物模式/);
});

test('invalid rule sets fail with explicit codes', () => {
  const base = new RichDocument(html);
  assert.throws(() => restyleDocument(base.document, {}), /RESTYLE_RULES_REQUIRED/);
  const protectedOnly = new RichDocument('<div id="polarion_wiki macro name=custom;params=x">opaque</div>');
  assert.throws(() => restyleDocument(protectedOnly.document, { paragraphLineHeight: '1.5' }), /RESTYLE_NOTHING_TO_DO/);
  assert.throws(() => restyleDocument(base.document, { headingLevelOffset: 1 }), /RESTYLE_HEADING_OFFSET_REQUIRES_PROMOTE/);
});
