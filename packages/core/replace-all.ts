import type { JSONContent } from '@tiptap/core';
import { Mark, type Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { richSchema } from './rich-schema.ts';
import type { TextMatch } from './editor-text.ts';
import { glossaryAliasPattern } from './requirement-lint.ts';
import { diffTextParts, previewDraftChanges, type TextDiffPart } from './text-diff.ts';

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

/** Change only differing characters. A prefix inherits the first character's marks, a suffix the last's. */
function styledReplacement(doc: PMNode, from: number, to: number, text: string, matchStart: number): PMNode[] {
  if (!text) return [];
  const marksOf = (node: PMNode) => node.marks.filter(mark => mark.type.name !== 'sourceText');
  if (from === to) {
    const at = doc.resolve(from), adjacent = from === matchStart ? at.nodeAfter : at.nodeBefore;
    return [richSchema.text(text, marksOf(adjacent!))];
  }
  const runs: { marks: Mark[]; length: number }[] = [];
  let total = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const length = Array.from(node.text!.slice(Math.max(0, from - pos), Math.min(to - pos, node.nodeSize))).length;
    const marks = marksOf(node), last = runs.at(-1);
    if (last && Mark.sameSet(last.marks, marks)) last.length += length;
    else runs.push({ marks, length });
    total += length;
  });
  // With no common text to anchor the new spelling, retain each marked run where its length permits.
  const letters = Array.from(text), minimum = letters.length >= runs.length ? 1 : 0;
  let consumed = 0, cursor = 0;
  return runs.flatMap(({ marks, length }, index) => {
    consumed += length;
    const remaining = runs.length - index - 1;
    const next = Math.min(letters.length - remaining * minimum, Math.max(cursor + minimum, Math.round(consumed / total * letters.length)));
    const value = letters.slice(cursor, next).join(''); cursor = next;
    return value ? [richSchema.text(value, marks)] : [];
  });
}

/** Apply revision-bound lint ranges and build the character diff from those same ranges. */
export function replaceGlossaryMatches(document: JSONContent, matches: readonly TextMatch[], alias: string, term: string, caseSensitive: boolean, savedText?: string) {
  if (!matches.length) throw Error('REPLACE_TEXT_NOT_FOUND');
  const doc = richSchema.nodeFromJSON(document), tr = new Transform(doc), spelling = glossaryAliasPattern(alias, caseSensitive);
  const parts: TextDiffPart[] = [], edits: { from: number; to: number; nodes: PMNode[] }[] = [];
  const same = (text: string) => { if (text) parts.push({ kind: 'same', text }); };
  let cursor = 0;
  for (const { from, to } of matches) {
    if (from < cursor || to <= from || to > doc.content.size) throw Error('STALE_DRAFT');
    const start = doc.resolve(from), end = doc.resolve(to);
    const original = doc.textBetween(from, to, '', () => '');
    if (!start.sameParent(end) || !start.parent.isTextblock || original.length !== to - from || original === term || !spelling.test(original)) throw Error('STALE_DRAFT');
    same(doc.textBetween(cursor, from, '\n', '\uFFFC'));
    let pos = from;
    for (const part of diffTextParts(original, term, true)) {
      if (part.kind === 'same') { same(part.text); pos += part.text.length; continue; }
      const next = pos + (part.before?.length ?? 0);
      parts.push(part);
      edits.push({ from: pos, to: next, nodes: styledReplacement(doc, pos, next, part.after ?? '', from) });
      pos = next;
    }
    cursor = to;
  }
  same(doc.textBetween(cursor, doc.content.size, '\n', '\uFFFC'));
  for (const edit of edits.reverse()) tr.replaceWith(edit.from, edit.to, edit.nodes);
  return { document: tr.doc.toJSON(), replacements: matches.length, diffPreview: previewDraftChanges(parts, savedText) };
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
