import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RichDocument } from './rich-document.ts';
import { replaceAllText } from './replace-all.ts';
import { restyleDocument } from './restyle.ts';

const html = '<p>温度阈值 25 °C，温度单位 °C</p><table><tr><td>温度传感器</td><td>25 °C</td></tr></table><p><strong>温度</strong>说明</p>';

test('replaceAllText replaces every match, preserves structure and serializes cleanly', () => {
  const base = new RichDocument(html);
  const { document, replacements } = replaceAllText(base.document, '温度', '环境温度');
  assert.equal(replacements, 4);
  const saved = base.serialize(document);
  assert.equal((saved.match(/环境温度/g) ?? []).length, 4);
  assert.match(saved, /<td[^>]*>环境温度传感器/);
  assert.match(saved, /<strong>环境温度<\/strong>/);
  const reopened = new RichDocument(saved);
  assert.equal(reopened.serialize(reopened.document), saved);
});

test('case-insensitive replacement and explicit failures', () => {
  const base = new RichDocument('<p>Enable / ENABLE / disabled</p>');
  const { document, replacements } = replaceAllText(base.document, 'ENABLE', 'enable', false);
  assert.equal(replacements, 2);
  const saved = base.serialize(document);
  assert.equal((saved.match(/enable/g) ?? []).length, 2);
  assert.throws(() => replaceAllText(base.document, '', 'x'), /REPLACE_FROM_REQUIRED/);
  assert.throws(() => replaceAllText(base.document, 'enable', 'enable'), /REPLACE_NO_CHANGE/);
  assert.throws(() => replaceAllText(base.document, 'missing', 'x'), /REPLACE_TEXT_NOT_FOUND/);
});

test('headingLevelOffset shifts promoted levels without leaving the h1..h6 range', () => {
  const base = new RichDocument('<p>1 第一章</p><p>1.1 第一节</p><p>1.1.1 第二层</p>');
  const { document } = restyleDocument(base.document, { promoteNumberedHeadings: true, headingLevelOffset: 1 });
  assert.deepEqual(document.content!.map((node: any) => node.attrs!.level), [2, 3, 4]);
  const clamped = restyleDocument(base.document, { promoteNumberedHeadings: true, headingLevelOffset: -3 });
  assert.deepEqual(clamped.document.content!.map((node: any) => node.attrs!.level), [1, 1, 1]);
});
