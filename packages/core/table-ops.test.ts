import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';
import { RichDocument } from './rich-document.ts';
import { applyTableOperations, listTables, replaceTableJson, tableJsonAt } from './table-ops.ts';

const html = [
  '<p>intro</p>',
  '<table id="polarion_wiki macro name=table;params=uid=1" style="width:100%"><thead><tr><th>参数</th><th>阈值</th></tr></thead><tbody><tr><td>温度</td><td>25 °C</td></tr><tr><td>时长</td><td>3 s</td></tr></tbody></table>',
  '<p>outro</p>',
].join('');

const model = () => new RichDocument(html);

test('listTables reports dimensions, header row and first-row text without a session', () => {
  const tables = listTables(model().document);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0], { index: 0, rows: 3, columns: 2, headerRow: true, mergedCells: false, firstRow: ['参数', '阈值'] });
});

test('insert_rows appends and fills cell text while every untouched byte survives', () => {
  const base = model();
  const { document, tables, applied } = applyTableOperations(base.document, [{ op: 'insert_rows', table: 0, at: 3, count: 1, cells: [['压力', '101 kPa']] }]);
  assert.equal(applied, 1);
  assert.equal(tables[0]!.rows, 4);
  const saved = base.serialize(document);
  const reopened = new RichDocument(saved);
  assert.equal(reopened.serialize(reopened.document), saved);
  assert.match(saved, /<td[^>]*><p[^>]*>压力<\/p>/);
  assert.ok(saved.includes('<p>intro</p>') && saved.includes('<p>outro</p>') && saved.includes('<thead><tr><th>参数</th>'));
});

test('insert_rows at the header boundary keeps body cells and can add a header row explicitly', () => {
  const base = model();
  const afterHeader = applyTableOperations(base.document, [{ op: 'insert_rows', table: 0, at: 1, cells: [['新行', 'x']] }]);
  const saved = base.serialize(afterHeader.document);
  assert.match(saved, /<\/thead><tbody><tr><td[^>]*><p[^>]*>新行/);
  const headerTop = applyTableOperations(base.document, [{ op: 'insert_rows', table: 0, at: 0, header: true, cells: [['分组', '范围']] }]);
  const headerSaved = base.serialize(headerTop.document);
  assert.match(headerSaved, /<thead><tr><th[^>]*><p[^>]*>分组<\/p>/);
  const reopened = new RichDocument(saved);
  assert.equal(reopened.serialize(reopened.document), saved);
});

test('delete_rows, column operations and colwidth land in one batched call', () => {
  const base = model();
  const { document, tables } = applyTableOperations(base.document, [
    { op: 'delete_rows', table: 0, rowIndices: [2] },
    { op: 'insert_columns', table: 0, at: 2, count: 1 },
    { op: 'set_colwidth', table: 0, widths: [120, 200, 80] },
  ]);
  assert.equal(tables[0]!.rows, 2);
  assert.equal(tables[0]!.columns, 3);
  const saved = base.serialize(document);
  assert.ok(!saved.includes('时长'));
  assert.match(saved, /data-colwidth="120"/);
  const reopened = listTables(new RichDocument(saved).document);
  assert.deepEqual([reopened[0]!.rows, reopened[0]!.columns], [2, 3]);
});

test('delete_columns mirrors insert_columns and keeps rows plain', () => {
  const base = model();
  const added = applyTableOperations(base.document, [{ op: 'insert_columns', table: 0, at: 0, count: 1 }]);
  const removed = applyTableOperations(added.document, [{ op: 'delete_columns', table: 0, columnIndices: [0] }]);
  assert.equal(removed.tables[0]!.columns, 2);
  const saved = base.serialize(removed.document);
  assert.ok(saved.includes('<th>参数</th>'));
  assert.equal(listTables(new RichDocument(saved).document)[0]!.columns, 2);
});

test('insert_table appends a header-first table and serializes as a fresh table', () => {
  const base = model();
  const { document, tables } = applyTableOperations(base.document, [{ op: 'insert_table', rows: 2, columns: 3, header: true }]);
  assert.equal(tables.length, 2);
  assert.deepEqual([tables[1]!.rows, tables[1]!.columns, tables[1]!.headerRow], [2, 3, true]);
  const saved = base.serialize(document);
  assert.ok(saved.startsWith('<p>intro</p>'));
  assert.match(saved, /<table[^>]*><tr><th[^>]*><p[^>]*><\/p><\/th>/);
  assert.equal(listTables(new RichDocument(saved).document).length, 2);
});

test('merged-cell tables and bad indices fail with explicit codes', () => {
  const merged = new RichDocument('<table><tr><td>a</td><td colspan="2">b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>');
  assert.equal(listTables(merged.document)[0]!.mergedCells, true);
  assert.throws(() => applyTableOperations(merged.document, [{ op: 'insert_columns', table: 0, at: 1 }]), /TABLE_MERGED_CELLS_UNSUPPORTED/);
  assert.throws(() => applyTableOperations(merged.document, [{ op: 'delete_rows', table: 0, rowIndices: [0] }]), /TABLE_MERGED_CELLS_UNSUPPORTED/);
  const base = model();
  assert.throws(() => applyTableOperations(base.document, [{ op: 'insert_rows', table: 9 }]), /TABLE_INDEX_OUT_OF_RANGE/);
  assert.throws(() => applyTableOperations(base.document, [{ op: 'delete_rows', table: 0, rowIndices: [9] }]), /ROW_INDEX_OUT_OF_RANGE/);
  assert.throws(() => applyTableOperations(base.document, [{ op: 'set_colwidth', table: 0, widths: [100] }]), /COLWIDTH_OUT_OF_RANGE/);
  assert.throws(() => applyTableOperations(base.document, []), /TABLE_OPERATIONS_REQUIRED/);
});

test('single-table surgery returns one subtree and splices it back without touching the rest', () => {
  const base = model();
  const table = tableJsonAt(base.document, 0) as JSONContent & { content: NonNullable<JSONContent['content']> };
  assert.equal(table.type, 'table');
  const cell = table.content[1]!.content![0]!;
  cell.content = [{ type: 'paragraph', content: [{ type: 'text', text: '温度（改）' }] }];
  const document = replaceTableJson(base.document, 0, table);
  const saved = base.serialize(document);
  assert.match(saved, /温度（改）/);
  assert.ok(saved.includes('<thead><tr><th>参数</th>') && saved.includes('<p>outro</p>'));
  const reopened = new RichDocument(saved);
  assert.equal(reopened.serialize(reopened.document), saved);
  assert.throws(() => replaceTableJson(base.document, 0, { type: 'paragraph' }), /TABLE_DOCUMENT_INVALID/);
  assert.throws(() => tableJsonAt(base.document, 3), /TABLE_INDEX_OUT_OF_RANGE/);
});
