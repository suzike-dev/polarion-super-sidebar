import type { JSONContent } from '@tiptap/core';
import { patchStyle, styleValues } from './rich-style.ts';
import { richSchema, sanitizeRichJSON } from './rich-schema.ts';

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

// Each invocation owns just the direct rows. Nested tables are visited independently.
function styleTable(table: JSONContent, config: PresetConfig, defaultsOnly = false): JSONContent {
  const style = (node: JSONContent, patch: Record<string, string | null>) => {
    const attrs = { ...node.attrs };
    if (defaultsOnly) {
      const existing = styleValues(attrs.sourceStyle);
      if (attrs.fill) existing['background-color'] = attrs.fill;
      if (attrs.valign) existing['vertical-align'] = attrs.valign;
      patch = Object.fromEntries(Object.entries(patch).filter(([key]) => !(key in existing)));
    }
    if (Object.keys(patch).length) attrs.sourceStyle = patchStyle(attrs.sourceStyle, patch);
    return attrs;
  };
  return { ...table, attrs: style(table, config.table), content: table.content?.map((row, index) => ({ ...row, content: row.content?.map(cell => {
    if (!isCell(cell)) return cell;
    const header = cell.type === 'tableHeader';
    const patch = header ? config.header : config.cell;
    if (defaultsOnly) return { ...cell, attrs: style(cell, patch) };
    const fill = header ? config.headerFill : index % 2 === 1 ? config.bodyFill : null;
    const clearStripe = fill === null && styleValues(cell.attrs?.sourceStyle)['background-color']?.toLowerCase() === presets.zebra.bodyFill;
    const attrs = style(cell, clearStripe ? { ...patch, 'background-color': null } : patch);
    if (fill !== null || attrs.fill === presets.zebra.bodyFill) attrs.fill = fill;
    return { ...cell, attrs };
  }) })) };
}

export function applyTablePreset(doc: JSONContent, preset: TablePreset): { doc: JSONContent; tables: number } {
  let tables = 0;
  const walk = (node: JSONContent): JSONContent => {
    const next = node.content ? { ...node, content: node.content.map(walk) } : node;
    if (node.type !== 'table') return next;
    tables++;
    return styleTable(next, presets[preset]);
  };
  return { doc: walk(doc), tables };
}

function removableParagraph(node: JSONContent) {
  if (node.type !== 'paragraph' || Object.entries(node.attrs ?? {}).some(([key, value]) => key !== 'sid' && !!value)) return false;
  return (node.content ?? []).every(child => child.type === 'text' && !child.text?.trim() && !child.marks?.some(mark => mark.type !== 'sourceText'));
}
const hasBorderStyle = (style?: string) => Object.keys(styleValues(style)).some(key => /^border(?:$|-(?:top|bottom|left|right|color|style|width)(?:-|$))/.test(key));
const isUntouchedType = (node: JSONContent) => /code|formula|math|protected/i.test(node.type ?? '');

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
  next = next.replace(/[ \u3000]{2,}|\u3000/g, () => { changes.spaces++; return ' '; });
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
    if (!node.content) return node;
    let children = node.content.map(walk);
    const expression = richSchema.nodes[node.type!]!.spec.content;
    if (expression === 'block+' || expression === 'paragraph block*' || node.type === 'details') {
      const start = node.type === 'details' ? 1 : 0;
      const last = children.findLastIndex(child => !removableParagraph(child));
      // Keep the original required paragraph (including its sid), even when all children are blank.
      children = children.filter((child, index, all) => {
        if (!removableParagraph(child)) return true;
        if (index === start && (expression === 'paragraph block*' || last < start)) return true;
        return index > start && index < last && !removableParagraph(all[index - 1]!);
      });
      changes.emptyParagraphs += node.content.length - children.length;
    }
    const next = { ...node, content: children };
    if (node.type === 'table' && options.tableDefaults && children.some(row => row.content?.some(isCell)) && !hasBorderStyle(node.attrs?.sourceStyle) && !children.some(row => row.content?.some(cell => hasBorderStyle(cell.attrs?.sourceStyle)))) {
      changes.tables++;
      return styleTable(next, presets.plain, true);
    }
    return next;
  };
  return { doc: walk(sanitizeRichJSON(doc)), changes };
}

export const tablePresetLabels: Record<TablePreset, string> = { plain: '全框线', threeLine: '三线表', zebra: '斑马纹', minimal: '极简' };
