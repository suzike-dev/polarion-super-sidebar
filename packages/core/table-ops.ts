import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { richSchema } from './rich-schema.ts';

/**
 * 表格结构速通：增删行列、列宽、插入表格都只传"小命令"，由本模块在完整文档上执行，
 * 避免为改一张表读/写十几万字符的整篇 rich JSON。纯结构变换；单元格文字仍走 replace_text。
 * 含合并单元格（colspan/rowspan>1）的表不在本模块处理，明确报错引导 read_table/update_table。
 */

export type TableSummary = { index: number; rows: number; columns: number; headerRow: boolean; mergedCells: boolean; firstRow: string[] };

export type TableOperation =
  | { op: 'insert_table'; rows: number; columns: number; header?: boolean; at?: number }
  | { op: 'delete_table'; table: number }
  | { op: 'insert_rows'; table: number; at?: number; count?: number; header?: boolean; cells?: string[][] }
  | { op: 'delete_rows'; table: number; rowIndices: number[] }
  | { op: 'insert_columns'; table: number; at: number; count?: number }
  | { op: 'delete_columns'; table: number; columnIndices: number[] }
  | { op: 'set_colwidth'; table: number; widths: number[] };

const cellText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** 轻量清单：直接走 JSON，不建编辑会话、不触发 schema 解析成本。 */
export function listTables(document: JSONContent): TableSummary[] {
  const tables: TableSummary[] = [];
  const walk = (nodes: JSONContent[]) => {
    for (const node of nodes) {
      if (node.type === 'table') {
        const rows = (node.content ?? []).filter(child => child.type === 'tableRow');
        const cellsOf = (row: JSONContent) => (row.content ?? []).filter(child => child.type === 'tableCell' || child.type === 'tableHeader');
        tables.push({
          index: tables.length,
          rows: rows.length,
          columns: rows.reduce((max, row) => Math.max(max, cellsOf(row).length), 0),
          headerRow: cellsOf(rows[0] ?? {})[0]?.type === 'tableHeader',
          mergedCells: rows.some(row => cellsOf(row).some(cell => Number(cell.attrs?.colspan ?? 1) > 1 || Number(cell.attrs?.rowspan ?? 1) > 1)),
          firstRow: cellsOf(rows[0] ?? {}).slice(0, 3).map(cell => cellText(cell.content?.map(child => child.text ?? collectText(child.content)).filter(Boolean).join(' ') ?? '')),
        });
      }
      if (node.content) walk(node.content);
    }
  };
  walk(document.content ?? []);
  return tables;
}

const collectText = (nodes?: JSONContent[]): string => (nodes ?? []).map(node => node.text ?? collectText(node.content)).filter(Boolean).join(' ');

/** 读取/替换单张表的 JSON 子树（update_table 用），其余内容字节不动。 */
export function tableJsonAt(document: JSONContent, index: number): JSONContent {
  let seen = -1;
  const walk = (nodes: JSONContent[]): JSONContent | undefined => {
    for (const node of nodes) {
      if (node.type === 'table' && ++seen === index) return node;
      const found = node.content ? walk(node.content) : undefined;
      if (found) return found;
    }
  };
  const found = walk(document.content ?? []);
  if (!found) throw Error('TABLE_INDEX_OUT_OF_RANGE');
  return structuredClone(found);
}

export function replaceTableJson(document: JSONContent, index: number, replacement: JSONContent): JSONContent {
  if (replacement.type !== 'table') throw Error('TABLE_DOCUMENT_INVALID');
  let seen = -1;
  const walk = (nodes: JSONContent[]): JSONContent[] => nodes.map(node => {
    if (node.type === 'table' && ++seen === index) return replacement;
    return node.content ? { ...node, content: walk(node.content) } : node;
  });
  return { ...document, content: walk(document.content ?? []) };
}

type LocatedRow = { node: PMNode; pos: number };

const rowHasSpan = (row: PMNode) => {
  let span = false;
  row.forEach(cell => { if ((cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1) span = true; });
  return span;
};

function freshParagraph(text?: string) {
  const trimmed = (text ?? '').trim();
  return richSchema.nodes.paragraph.createChecked(null, trimmed ? richSchema.text(trimmed) : undefined);
}

function freshCell(header: boolean, text?: string) {
  return (header ? richSchema.nodes.tableHeader : richSchema.nodes.tableCell).createChecked({ colspan: 1, rowspan: 1, colwidth: null }, [freshParagraph(text)]);
}

function freshRow(columns: number, header: boolean, texts?: string[]) {
  return richSchema.nodes.tableRow.createChecked(null, Array.from({ length: columns }, (_unused, column) => freshCell(header, texts?.[column])));
}

/** 定位表格与其行；表格序号与 listTables 一致（文档顺序，含嵌套）。 */
function locate(doc: PMNode, index: number) {
  let seen = -1;
  let table: { node: PMNode; pos: number } | undefined;
  doc.descendants((node, pos) => {
    if (table || node.type.name !== 'table') return;
    if (++seen === index) table = { node, pos };
  });
  if (!table) throw Error('TABLE_INDEX_OUT_OF_RANGE');
  const located = table!;
  const rows: LocatedRow[] = [];
  let cursor = located.pos + 1;
  located.node.forEach((row, offset) => { rows.push({ node: row, pos: cursor + offset }); });
  return { table: located, rows };
}

function requirePlainGrid(rows: LocatedRow[]) {
  if (!rows.length) throw Error('TABLE_HAS_NO_ROWS');
  const cells = rows.map(row => { const cells: { node: PMNode; pos: number }[] = []; row.node.forEach((cell, offset) => cells.push({ node: cell, pos: row.pos + 1 + offset })); return cells; });
  const merged = cells.some(row => row.some(cell => (cell.node.attrs.colspan ?? 1) > 1 || (cell.node.attrs.rowspan ?? 1) > 1));
  if (merged) throw Error('TABLE_MERGED_CELLS_UNSUPPORTED');
  const width = cells[0]!.length;
  if (cells.some(row => row.length !== width)) throw Error('TABLE_RAGGED_ROWS_UNSUPPORTED');
  return { cells, width };
}

function topLevelPositions(doc: PMNode) {
  const blocks: { pos: number }[] = [];
  let cursor = 0;
  doc.forEach((_block, offset) => { blocks.push({ pos: cursor + offset + 1 }); });
  return blocks;
}

/** 顺序执行一批表格操作，一次序列化落盘；返回新文档与操作后的表格清单。 */
export function applyTableOperations(document: JSONContent, operations: TableOperation[]): { document: JSONContent; tables: TableSummary[]; applied: number } {
  if (!operations.length) throw Error('TABLE_OPERATIONS_REQUIRED');
  const tr = new Transform(richSchema.nodeFromJSON(document));
  for (const operation of operations) {
    const doc = tr.doc;
    if (operation.op === 'insert_table') {
      const rows = Math.floor(operation.rows), columns = Math.floor(operation.columns);
      if (!(rows >= 1 && rows <= 60 && columns >= 1 && columns <= 12)) throw Error('TABLE_SIZE_OUT_OF_RANGE');
      const body = Array.from({ length: rows }, (_unused, row) => freshRow(columns, Boolean(operation.header) && row === 0));
      const table = richSchema.nodes.table.createChecked(null, body);
      const blocks = topLevelPositions(doc);
      const at = operation.at ?? blocks.length;
      if (!(at >= 0 && at <= blocks.length)) throw Error('BLOCK_INDEX_OUT_OF_RANGE');
      tr.insert(at === blocks.length ? doc.content.size : blocks[at]!.pos - 1, table);
      continue;
    }
    const { table, rows } = locate(doc, operation.table);
    if (operation.op === 'delete_table') {
      // 表内含受保护对象时整表删除会被序列化校验拒绝（PROTECTED_OBJECT_REMOVED），提前给出明确错误。
      let guarded = false;
      table.node.descendants(node => { if (node.type.name.startsWith('protected')) guarded = true; return !guarded; });
      if (guarded) throw Error('TABLE_PROTECTED_UNSUPPORTED');
      tr.delete(table.pos, table.pos + table.node.nodeSize);
      continue;
    }
    if (operation.op === 'insert_rows') {
      if (rows.some(entry => rowHasSpan(entry.node))) throw Error('TABLE_MERGED_CELLS_UNSUPPORTED');
      const count = Math.floor(operation.count ?? 1);
      if (!(count >= 1 && count <= 20)) throw Error('ROW_COUNT_OUT_OF_RANGE');
      const at = operation.at ?? rows.length;
      if (!(at >= 0 && at <= rows.length)) throw Error('ROW_INDEX_OUT_OF_RANGE');
      const reference = rows[Math.min(at, rows.length - 1)]!;
      let columns = 0;
      reference.node.forEach(() => columns++);
      if (operation.cells && (operation.cells.length > count || operation.cells.some(row => row.length > columns))) throw Error('CELL_TEXTS_OUT_OF_RANGE');
      const fresh = Array.from({ length: count }, (_unused, row) => {
        const texts = operation.cells?.[row];
        return richSchema.nodes.tableRow.createChecked(null, Array.from({ length: columns }, (_slot, column) => freshCell(Boolean(operation.header), texts?.[column])));
      });
      tr.insert(at < rows.length ? rows[at]!.pos : table.pos + 1 + table.node.content.size, fresh);
      continue;
    }
    if (operation.op === 'delete_rows') {
      if (rows.some(entry => rowHasSpan(entry.node))) throw Error('TABLE_MERGED_CELLS_UNSUPPORTED');
      const descending = [...new Set(operation.rowIndices)].sort((left, right) => right - left);
      if (!descending.length || descending.some(index => index < 0 || index >= rows.length)) throw Error('ROW_INDEX_OUT_OF_RANGE');
      if (descending.length >= rows.length) throw Error('TABLE_LAST_ROW');
      for (const index of descending) tr.delete(rows[index]!.pos, rows[index]!.pos + rows[index]!.node.nodeSize);
      continue;
    }
    const { cells, width } = requirePlainGrid(rows);
    // 每行自底向上执行，前面的行不再受后续插入/删除的位移影响。
    if (operation.op === 'insert_columns') {
      const count = Math.floor(operation.count ?? 1);
      if (!(count >= 1 && count <= 8)) throw Error('COLUMN_COUNT_OUT_OF_RANGE');
      const at = operation.at;
      if (!(at >= 0 && at <= width)) throw Error('COLUMN_INDEX_OUT_OF_RANGE');
      for (const row of [...cells].reverse()) {
        const mirror = at < row.length ? row[at]! : row[row.length - 1]!;
        const fresh = Array.from({ length: count }, () => mirror.node.type.createChecked({ colspan: 1, rowspan: 1, colwidth: null }, [freshParagraph()]));
        tr.insert(at < row.length ? mirror.pos : row[row.length - 1]!.pos + row[row.length - 1]!.node.nodeSize, fresh);
      }
      continue;
    }
    if (operation.op === 'delete_columns') {
      const descending = [...new Set(operation.columnIndices)].sort((left, right) => right - left);
      if (!descending.length || descending.some(index => index < 0 || index >= width)) throw Error('COLUMN_INDEX_OUT_OF_RANGE');
      if (descending.length >= width) throw Error('TABLE_LAST_COLUMN');
      for (const row of [...cells].reverse()) for (const index of descending) tr.delete(row[index]!.pos, row[index]!.pos + row[index]!.node.nodeSize);
      continue;
    }
    const widths = operation.widths;
    if (widths.length !== width || widths.some(value => !Number.isInteger(value) || value < 20 || value > 4800)) throw Error('COLWIDTH_OUT_OF_RANGE');
    for (const row of [...cells].reverse()) for (let index = width - 1; index >= 0; index--) {
      const cell = row[index]!;
      tr.replaceWith(cell.pos, cell.pos + cell.node.nodeSize, cell.node.type.createChecked({ ...cell.node.attrs, colwidth: [widths[index]!] }, cell.node.content));
    }
  }
  const next = tr.doc.toJSON();
  return { document: next, tables: listTables(next), applied: operations.length };
}
