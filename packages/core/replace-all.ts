import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { richSchema } from './rich-schema.ts';

/** 全文逐字替换：只改文本节点，保留段落/表格/图片/受保护对象与格式；命中的文本作为新内容，不再沿用原 sourceText 锚点。 */
export function replaceAllText(document: JSONContent, from: string, to: string, caseSensitive = true) {
  if (!from) throw Error('REPLACE_FROM_REQUIRED');
  if (from === to) throw Error('REPLACE_NO_CHANGE');
  const tr = new Transform(richSchema.nodeFromJSON(document));
  const hits: { pos: number; node: PMNode }[] = [];
  const needle = caseSensitive ? from : from.toLowerCase();
  tr.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const haystack = caseSensitive ? node.text : node.text.toLowerCase();
    if (haystack.includes(needle)) hits.push({ pos, node });
  });
  if (!hits.length) throw Error('REPLACE_TEXT_NOT_FOUND');
  let replacements = 0;
  for (const { pos, node } of hits.reverse()) {
    const text = caseSensitive ? node.text!.split(from).join(to) : replaceInsensitive(node.text!, from, to);
    if (text === node.text) continue;
    const marks = node.marks.filter(mark => mark.type.name !== 'sourceText');
    if (text) tr.replaceWith(pos, pos + node.nodeSize, richSchema.text(text, marks));
    else tr.delete(pos, pos + node.nodeSize);
    replacements += countOccurrences(node.text!, from, caseSensitive);
  }
  if (!replacements) throw Error('REPLACE_TEXT_NOT_FOUND');
  return { document: tr.doc.toJSON(), replacements };
}

function countOccurrences(value: string, from: string, caseSensitive: boolean) {
  const haystack = caseSensitive ? value : value.toLowerCase(), needle = caseSensitive ? from : from.toLowerCase();
  let count = 0, cursor = 0;
  for (;;) { const at = haystack.indexOf(needle, cursor); if (at < 0) return count; count++; cursor = at + needle.length; }
}

function replaceInsensitive(value: string, from: string, to: string) {
  const lower = value.toLowerCase(), needle = from.toLowerCase();
  let result = '', cursor = 0;
  for (;;) {
    const at = lower.indexOf(needle, cursor);
    if (at < 0) return result + value.slice(cursor);
    result += value.slice(cursor, at) + to;
    cursor = at + from.length;
  }
}
