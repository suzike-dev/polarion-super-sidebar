import type { JSONContent } from '@tiptap/core';
import { richSchema } from './rich-schema.ts';
import { Transform } from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * 整篇排版命令：编号段落提升为标题层级、统一段落行距/对齐、清理空段。
 * 在 Host 内部的真实模型上变换，受保护对象/图片/引用原样保留——构造上不可能丢，
 * 替代"导出 JSON → 脚本重建 → 整篇写回"的绕 Bash 路径。
 * 标题提升只作用于顶层（含 sourceContainer 内）段落，不动列表项与表格单元格；
 * 空段清理跳过单元格（单元格必须保留一个段落）与承载图片/引用/受保护对象的段。
 */

export type RestyleRules = {
  /** 顶层形如 "4.2.16 xxx" 的编号段落提升为对应深度的标题（深度 1..6 → h1..h6）。 */
  promoteNumberedHeadings?: boolean;
  /** 标题层级偏移：文档标题已占 h1 时用 -1，让第 1 章落到 h2。范围 -3..3。 */
  headingLevelOffset?: number;
  paragraphLineHeight?: '1' | '1.2' | '1.5' | '1.75' | '2';
  paragraphTextAlign?: 'left' | 'center' | 'right' | 'justify';
  /** 删除没有任何文字与图片/引用/受保护对象的空段落（表格单元格除外）。 */
  removeEmptyParagraphs?: boolean;
};

const NUMBERED = /^(\d{1,3}(?:\.\d{1,3}){0,5})[\s、.．:：]+\S/;
const PROMOTE_PARENTS = new Set(['doc', 'sourceContainer']);
const KEEP_EMPTY_PARENTS = new Set(['tableCell', 'tableHeader']);

/** 段落是否承载了不可丢的内容（图片/引用/受保护对象），空段清理必须跳过。 */
function carriesObject(node: PMNode) {
  let yes = false;
  node.descendants(child => { if (child.type.name === 'image' || child.type.name === 'workItemRef' || child.type.name.startsWith('protected')) yes = true; return !yes; });
  return yes;
}

export function restyleDocument(document: JSONContent, rules: RestyleRules) {
  if (!rules.promoteNumberedHeadings && !rules.paragraphLineHeight && !rules.paragraphTextAlign && !rules.removeEmptyParagraphs && rules.headingLevelOffset === undefined) throw Error('RESTYLE_RULES_REQUIRED');
  if (rules.headingLevelOffset !== undefined && !rules.promoteNumberedHeadings) throw Error('RESTYLE_HEADING_OFFSET_REQUIRES_PROMOTE');
  const doc = richSchema.nodeFromJSON(document);
  const tr = new Transform(doc);
  let promoted = 0, lineHeightSet = 0, alignSet = 0, removed = 0;
  // 自底向上按位置替换/删除，避免前面的修改让后续位置失效。
  const edits: { pos: number; node: PMNode; kind: 'promote' | 'style' | 'remove' }[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'paragraph') return;
    const text = node.textContent.trim();
    const empty = !text && !carriesObject(node);
    const parentName = parent?.type.name ?? '';
    if (rules.promoteNumberedHeadings && PROMOTE_PARENTS.has(parentName) && NUMBERED.test(text)) { edits.push({ pos, node, kind: 'promote' }); return; }
    if (rules.removeEmptyParagraphs && empty && !KEEP_EMPTY_PARENTS.has(parentName)) { edits.push({ pos, node, kind: 'remove' }); return; }
    if (rules.paragraphLineHeight || rules.paragraphTextAlign) edits.push({ pos, node, kind: 'style' });
  });
  for (const edit of edits.reverse()) {
    const { pos, node } = edit;
    if (edit.kind === 'remove') { tr.delete(pos, pos + node.nodeSize); removed++; continue; }
    if (edit.kind === 'promote') {
      const depth = (NUMBERED.exec(node.textContent.trim())?.[1] ?? '1').split('.').length;
      const level = Math.min(6, Math.max(1, depth + (rules.headingLevelOffset ?? 0)));
      const heading = richSchema.node('heading', { ...node.attrs, level }, node.content);
      tr.replaceWith(pos, pos + node.nodeSize, heading);
      promoted++;
      continue;
    }
    const attrs = { ...node.attrs, ...(rules.paragraphLineHeight ? { lineHeight: rules.paragraphLineHeight } : {}), ...(rules.paragraphTextAlign ? { textAlign: rules.paragraphTextAlign } : {}) };
    if (attrs.lineHeight !== node.attrs.lineHeight) lineHeightSet++;
    if (attrs.textAlign !== node.attrs.textAlign) alignSet++;
    tr.replaceWith(pos, pos + node.nodeSize, node.type.createChecked(attrs, node.content));
  }
  if (!edits.length) throw Error('RESTYLE_NOTHING_TO_DO');
  return { document: tr.doc.toJSON(), changes: { promoted, lineHeightSet, alignSet, removedEmptyParagraphs: removed } };
}
