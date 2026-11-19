import type { JSONContent } from '@tiptap/core';
import { richSchema } from './rich-schema.ts';
import { Transform } from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * 块级点操作：段落/标题/列表互转、插入、删除、移动、拆段、合段。
 * 与 restyle_document（整篇）互补，都是 Host 内原子变换，不整篇读写、受保护对象不可丢。
 * 定位一律用“块内唯一文字子串”；删除/拆分含受保护对象的块会被拒绝。
 */

export type BlockSpec =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'bulletList' | 'orderedList'; items: string[] };

export type BlockOperation =
  | { op: 'set_type'; target: string; block: 'paragraph' | { heading: number } | 'bulletItem' | 'orderedItem' }
  | { op: 'insert'; after?: string; at?: 'start' | 'end'; block: BlockSpec }
  | { op: 'delete'; target: string }
  | { op: 'move'; target: string; after: string | 'start' }
  | { op: 'split'; target: string; afterText: string }
  | { op: 'merge'; target: string; direction: 'next' | 'previous' }
  | { op: 'lift'; target: string; block: 'paragraph' | { heading: number } };

const normalize = (value: string) => value.replace(/\s+/g, '');
const plainText = (node: PMNode) => node.textContent;

function protectedInside(node: PMNode) {
  let yes = false;
  node.descendants(child => { if (child.type.name.startsWith('protected')) yes = true; return !yes; });
  return yes;
}

function buildBlock(spec: BlockSpec): PMNode {
  if (spec.type === 'heading') {
    const level = Math.min(Math.max(Math.floor(spec.level), 1), 6);
    return richSchema.node('heading', { level }, spec.text.trim() ? [richSchema.text(spec.text.trim())] : undefined);
  }
  if (spec.type === 'paragraph') return richSchema.node('paragraph', null, spec.text.trim() ? [richSchema.text(spec.text.trim())] : undefined);
  const itemType = spec.type === 'bulletList' ? 'bulletList' : 'orderedList';
  const items = spec.items.map(item => richSchema.node('listItem', null, [richSchema.node('paragraph', null, item.trim() ? [richSchema.text(item.trim())] : undefined)]));
  return richSchema.node(itemType, null, items);
}

/** 顶层块定位（doc 直接子节点）；needle 为块内文字子串（空白不敏感）。 */
function locateBlock(doc: PMNode, needle: string) {
  const wanted = normalize(needle);
  if (!wanted) throw Error('BLOCK_TARGET_REQUIRED');
  const hits: { node: PMNode; pos: number; index: number }[] = [];
  doc.forEach((node, offset, index) => { if (normalize(plainText(node)).includes(wanted)) hits.push({ node, pos: offset, index }); });
  if (!hits.length) throw Error('BLOCK_NOT_FOUND');
  if (hits.length > 1) throw Error('BLOCK_AMBIGUOUS');
  return hits[0]!;
}

const ensurePlain = (node: PMNode, what: string) => { if (protectedInside(node)) throw Error('BLOCK_PROTECTED:' + what); };

/** 顶层列表项定位：把编号列表项提升为标题/段落时用，要求全篇唯一。 */
function locateListItem(doc: PMNode, needle: string) {
  const wanted = normalize(needle);
  if (!wanted) throw Error('BLOCK_TARGET_REQUIRED');
  const hits: { list: PMNode; listPos: number; item: PMNode; index: number }[] = [];
  doc.forEach((list, listPos) => {
    if (list.type.name !== 'bulletList' && list.type.name !== 'orderedList') return;
    const items: PMNode[] = [];
    list.forEach(item => { items.push(item); });
    items.forEach((item, index) => { if (item.type.name === 'listItem' && normalize(item.textContent).includes(wanted)) hits.push({ list, listPos, item, index }); });
  });
  if (!hits.length) throw Error('BLOCK_NOT_FOUND');
  if (hits.length > 1) throw Error('BLOCK_AMBIGUOUS');
  return hits[0]!;
}

export function applyBlockOperations(document: JSONContent, operations: BlockOperation[]) {
  if (!operations.length) throw Error('BLOCK_OPERATIONS_REQUIRED');
  const tr = new Transform(richSchema.nodeFromJSON(document));
  const changes: Record<string, number> = {};
  for (const operation of operations) {
    const doc = tr.doc;
    if (operation.op === 'insert') {
      const node = buildBlock(operation.block);
      const pos = operation.at === 'start' ? 0 : operation.after !== undefined ? (() => { const anchor = locateBlock(doc, operation.after); return anchor.pos + anchor.node.nodeSize; })() : doc.content.size;
      tr.insert(pos, node);
      changes.inserted = (changes.inserted ?? 0) + 1;
      continue;
    }
    if (operation.op === 'lift') {
      const hit = locateListItem(doc, operation.target);
      if (hit.item.childCount !== 1 || hit.item.firstChild?.type.name !== 'paragraph') throw Error('LIST_ITEM_COMPLEX');
      const paragraph = hit.item.firstChild!;
      const replacement = operation.block === 'paragraph'
        ? richSchema.node('paragraph', { ...paragraph.attrs, sid: null }, paragraph.content)
        : richSchema.node('heading', { ...paragraph.attrs, sid: null, level: Math.min(Math.max(operation.block.heading, 1), 6) }, paragraph.content);
      const items: PMNode[] = [];
      hit.list.forEach(item => { items.push(item); });
      const before = items.slice(0, hit.index), after = items.slice(hit.index + 1);
      const nodes: PMNode[] = [];
      if (before.length) nodes.push(hit.list.type.createChecked({ ...hit.list.attrs, sid: null }, before));
      nodes.push(replacement);
      if (after.length) nodes.push(hit.list.type.createChecked({ ...hit.list.attrs, sid: null }, after));
      tr.replaceWith(hit.listPos, hit.listPos + hit.list.nodeSize, nodes);
      changes.lifted = (changes.lifted ?? 0) + 1;
      continue;
    }
    const target = locateBlock(doc, operation.target);
    if (operation.op === 'delete') {
      ensurePlain(target.node, 'delete');
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      changes.deleted = (changes.deleted ?? 0) + 1;
      continue;
    }
    if (operation.op === 'move') {
      ensurePlain(target.node, 'move');
      if (operation.after !== 'start') {
        const anchor = locateBlock(doc, operation.after);
        if (anchor.index === target.index) throw Error('BLOCK_MOVE_TO_SELF');
      }
      const block = richSchema.nodeFromJSON(target.node.toJSON());
      tr.delete(target.pos, target.pos + target.node.nodeSize);
      if (operation.after === 'start') tr.insert(0, block);
      else {
        const anchor = locateBlock(tr.doc, operation.after);
        tr.insert(anchor.pos + anchor.node.nodeSize, block);
      }
      changes.moved = (changes.moved ?? 0) + 1;
      continue;
    }
    if (operation.op === 'set_type') {
      const source = target.node;
      if (source.type.name !== 'paragraph' && source.type.name !== 'heading') throw Error('BLOCK_TYPE_UNSUPPORTED');
      if (protectedInside(source) && operation.block !== 'paragraph' && source.type.name !== 'paragraph') { /* 段落内受保护内联对象随内容保留，无需拒绝 */ }
      let replacement: PMNode;
      if (operation.block === 'paragraph') replacement = richSchema.node('paragraph', { ...(source.type.name === 'heading' ? {} : source.attrs) }, source.content);
      else if (typeof operation.block === 'object') replacement = richSchema.node('heading', { ...source.attrs, level: Math.min(Math.max(operation.block.heading, 1), 6) }, source.content);
      else {
        const listType = operation.block === 'bulletItem' ? 'bulletList' : 'orderedList';
        const item = richSchema.node('listItem', null, [richSchema.node('paragraph', null, source.content)]);
        replacement = richSchema.node(listType, null, [item]);
      }
      tr.replaceWith(target.pos, target.pos + source.nodeSize, replacement);
      changes.typed = (changes.typed ?? 0) + 1;
      continue;
    }
    // split / merge 只作用于段落
    const source = target.node;
    if (source.type.name !== 'paragraph') throw Error('BLOCK_NOT_PARAGRAPH');
    if (operation.op === 'split') {
      const wanted = normalize(operation.afterText);
      if (!wanted) throw Error('BLOCK_SPLIT_TEXT_REQUIRED');
      let splitAt = -1;
      source.descendants((node, pos) => {
        if (splitAt >= 0 || !node.isText || !node.text) return;
        const flat = normalize(node.text);
        const at = flat.indexOf(wanted);
        if (at < 0) return;
        // 反推匹配末字符在原始文本中的后一位置（normalize 只删空白）；descendants 的 pos 是段落内相对位置。
        let seen = 0;
        for (let i = 0; i < node.text.length; i++) {
          const part = normalize(node.text[i]!);
          if (!part) continue;
          if (seen === at + wanted.length - 1) { splitAt = pos + i + 1; return; }
          seen += part.length;
        }
      });
      if (splitAt < 0) throw Error('BLOCK_SPLIT_TEXT_NOT_FOUND');
      const absolute = target.pos + 1 + splitAt; // descendants 的位置是段落内相对位置
      tr.split(absolute);
      // PM split 会把 sourceText 锚点 mark 与段落自身 sid 复制到新段，序列化判 DUPLICATE_RICH_ANCHOR；
      // split 后新段从 absolute+1 开始（absolute 落在第一段内容末尾），前半保留原锚点，后半作为新内容。
      const second = absolute + 1;
      const after = tr.doc.resolve(second).nodeAfter;
      if (after) {
        tr.setNodeMarkup(second, null, { ...after.attrs, sid: null });
        tr.removeMark(second, second + after.nodeSize, richSchema.marks.sourceText);
      }
      changes.split = (changes.split ?? 0) + 1;
      continue;
    }
    // merge：与相邻段落合并
    const index = target.index;
    const siblingIndex = operation.direction === 'next' ? index + 1 : index - 1;
    if (siblingIndex < 0 || siblingIndex >= doc.childCount) throw Error('BLOCK_MERGE_TARGET_MISSING');
    const sibling = doc.child(siblingIndex);
    if (sibling.type.name !== 'paragraph') throw Error('BLOCK_MERGE_TARGET_NOT_PARAGRAPH');
    const joinPos = operation.direction === 'next' ? target.pos + target.node.nodeSize : target.pos;
    tr.join(joinPos);
    changes.merged = (changes.merged ?? 0) + 1;
  }
  return { document: tr.doc.toJSON(), changes };
}
