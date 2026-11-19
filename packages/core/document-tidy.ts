import type { JSONContent } from '@tiptap/core';
import { patchStyle, styleValues } from './rich-style.ts';

/** 表格样式预设与全文排版整理：纯 JSON 变换，编辑器里以事务应用，可撤销；序列化走既有 safeStyle 白名单。 */
export type TablePreset = 'plain' | 'threeLine' | 'zebra' | 'minimal';
type PresetConfig = { table: Record<string, string | null>; header: Record<string, string | null>; cell: Record<string, string | null>; bodyFill: string | null; headerFill: string | null };
const presets: Record<TablePreset, PresetConfig> = {
  plain: { table: { 'border-collapse': 'collapse' }, header: { border: '1px solid #aebfd4', 'background-color': '#edf3fb', 'text-align': 'left' }, cell: { border: '1px solid #cbd6e5', 'vertical-align': 'top' }, bodyFill: null, headerFill: '#edf3fb' },
  threeLine: { table: { 'border-collapse': 'collapse' }, header: { border: '0', 'border-top': '2px solid #1f2937', 'border-bottom': '1px solid #1f2937', 'background-color': 'transparent' }, cell: { border: '0', 'border-bottom': '1px solid #9ca3af' }, bodyFill: null, headerFill: 'transparent' },
  zebra: { table: { 'border-collapse': 'collapse' }, header: { border: '1px solid #d7e1ed', 'background-color': '#eef4f0' }, cell: { border: '1px solid #e3e9e5' }, bodyFill: '#f4f8f5', headerFill: '#eef4f0' },
  minimal: { table: { 'border-collapse': 'collapse' }, header: { border: '0', 'border-bottom': '1px solid #31424f', 'background-color': 'transparent' }, cell: { border: '0' }, bodyFill: null, headerFill: 'transparent' },
};

const isCell = (node: JSONContent) => node.type === 'tableCell' || node.type === 'tableHeader';

/** 给文档里的每个表格套用预设（嵌套在折叠块等容器里的也会处理）；返回 {doc, tables}。 */
export function applyTablePreset(doc: JSONContent, preset: TablePreset): { doc: JSONContent; tables: number } {
  const config = presets[preset];
  let tables = 0;
  const walk = (node: JSONContent, insideRow: { index: number } | null = null): JSONContent => {
    if (node.type === 'table') {
      tables++;
      let row = 0;
      return { ...node, attrs: { ...node.attrs, sourceStyle: patchStyle(node.attrs?.sourceStyle, config.table) }, content: (node.content ?? []).map(child => { if (child.type === 'tableRow') return walk(child, { index: row++ }); return walk(child, insideRow); }) };
    }
    if (node.type === 'tableRow') return { ...node, content: (node.content ?? []).map(child => walk(child, insideRow)) };
    if (isCell(node) && insideRow) {
      const style = node.type === 'tableHeader' ? config.header : config.cell;
      const fill = node.type === 'tableHeader' ? config.headerFill : (insideRow.index % 2 === 1 ? config.bodyFill : null);
      // 编辑中的斑马纹在 fill 中，保存重开后在 sourceStyle 中。
      const attrs = { ...node.attrs };
      const clearStripeStyle = fill === null && styleValues(attrs.sourceStyle)['background-color']?.toLowerCase() === presets.zebra.bodyFill;
      attrs.sourceStyle = patchStyle(attrs.sourceStyle, clearStripeStyle ? { ...style, 'background-color': null } : style);
      if (fill !== null || attrs.fill === presets.zebra.bodyFill) attrs.fill = fill;
      return { ...node, attrs, content: (node.content ?? []).map(child => walk(child, insideRow)) };
    }
    return node.content ? { ...node, content: node.content.map(child => walk(child)) } : node;
  };
  return { doc: walk(doc), tables };
}

const isEmptyParagraph = (node: JSONContent | undefined) => !!node && node.type === 'paragraph' && !(node.content ?? []).some(child => child.type !== 'text' || (child.text ?? '').trim());
const hasBorderStyle = (style: unknown) => typeof style === 'string' && /border/i.test(style);
/** 代码与公式内容一律不整理：保持字面语义。 */
const isUntouchedType = (node: JSONContent) => /code|formula|math/i.test(node.type ?? '');

export type TidyChanges = { emptyParagraphs: number; resizedImages: number; tables: number; quotes: number; hexPrefixes: number; spaces: number; punctuation: number };

/**
 * 文本级规范（同一文本串内完成，不跨节点配对）：
 * - 英文直引号成对 → 中文弯引号（只匹配同一文本串里的完整对，不成对的原样保留）；
 * - 十六进制前缀 0X → 0x（数字大小写保持原样，与正文 0x0/0x1 风格统一）；
 * - 连续半角空格/全角空格 → 单个半角空格；
 * - 中文重复标点 。。/，，/；； → 单个。
 */
function tidyText(text: string, changes: TidyChanges): string {
  let next = text.replace(/"([^"\n]*)"/g, (_match, inner: string) => { changes.quotes++; return `“${inner}”`; });
  next = next.replace(/(?<![A-Za-z0-9_])0X([0-9A-Fa-f]+)/g, (_match, digits: string) => { changes.hexPrefixes++; return '0x' + digits; });
  next = next.replace(/\u3000|( {2,})/g, () => { changes.spaces++; return ' '; });
  next = next.replace(/([。，；])\1+/g, match => { changes.punctuation++; return match[0]!; });
  return next;
}

/**
 * 全文排版整理：文档首部的空段删除、连续空段折叠为一个、超宽图片收到 1200px、无边框表格补默认全框线，
 * 以及文本级规范（直引号→弯引号、0X→0x、多余空格、重复中文标点）。
 * 只做保守、可见的整理；代码块、行内代码与公式不动，不改正文结构语义，编辑器中作为一个可撤销事务应用。
 */
export function tidyDocument(doc: JSONContent, options: { tableDefaults?: boolean } = {}): { doc: JSONContent; changes: TidyChanges } {
  const changes: TidyChanges = { emptyParagraphs: 0, resizedImages: 0, tables: 0, quotes: 0, hexPrefixes: 0, spaces: 0, punctuation: 0 };
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === 'text') {
      if ((node.marks ?? []).some(mark => mark.type === 'code') || !node.text) return node;
      const text = tidyText(node.text, changes);
      return text === node.text ? node : { ...node, text };
    }
    if (isUntouchedType(node)) return node;
    if (node.type === 'image' && node.attrs?.width && Number(node.attrs.width) > 1200) {
      changes.resizedImages++;
      const scale = 1200 / Number(node.attrs.width);
      return { ...node, attrs: { ...node.attrs, width: 1200, ...(node.attrs.height ? { height: Math.max(1, Math.round(Number(node.attrs.height) * scale)) } : {}) } };
    }
    if (node.type === 'table' && options.tableDefaults && !hasBorderStyle(node.attrs?.sourceStyle) && !(node.content ?? []).some(row => (row.content ?? []).some(cell => hasBorderStyle(cell.attrs?.sourceStyle)))) {
      changes.tables++;
      return applyTablePreset(node, 'plain').doc;
    }
    if (node.content) {
      const children: JSONContent[] = [];
      for (const child of node.content) {
        if (isEmptyParagraph(child) && (children.length === 0 || isEmptyParagraph(children.at(-1)))) { changes.emptyParagraphs++; continue; }
        children.push(walk(child));
      }
      // details 的 summary 后至少需要一个正文块，保留原段及其来源属性。
      const minChildren = node.type === 'details' ? 2 : 0;
      while (children.length > minChildren && isEmptyParagraph(children.at(-1))) { children.pop(); changes.emptyParagraphs++; }
      return { ...node, content: children };
    }
    return node;
  };
  return { doc: walk(doc), changes };
}

export const tablePresetLabels: Record<TablePreset, string> = { plain: '全框线', threeLine: '三线表', zebra: '斑马纹', minimal: '极简' };
