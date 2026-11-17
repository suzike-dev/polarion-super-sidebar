import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { Drafts } from './polarion.ts';
import type { Target } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'test01', document: 'Requirements/TableTools' };
const html = '<p>intro</p><table><thead><tr><th>参数</th><th>阈值</th></tr></thead><tbody><tr><td>温度</td><td>25 °C</td></tr><tr><td>时长</td><td>3 s</td></tr></tbody></table><p>outro</p>';

async function fixture() {
  const store = new Store(':memory:');
  const remote = { read: async () => ({ id: 'T-1', title: '表格工作项', description: html, updated: '1' }) };
  const drafts = new Drafts(store, remote as never);
  const opened = await drafts.open(target, 'T-1');
  return { drafts, opened };
}

test('table listing is a tiny payload and table ops apply in one call', async () => {
  const { drafts, opened } = await fixture();
  const list = drafts.tables(opened.id);
  assert.deepEqual([list.workItemId, list.revision], ['T-1', 0]);
  assert.deepEqual(list.tables.map(({ rows, columns, headerRow }) => ({ rows, columns, headerRow })), [{ rows: 3, columns: 2, headerRow: true }]);
  assert.ok(JSON.stringify(list).length < 2000);

  const done = drafts.table(opened.id, 0, [{ op: 'insert_rows', table: 0, at: 3, cells: [['压力', '101 kPa']] }]);
  assert.equal(done.draft.revision, 1);
  assert.equal(done.draft.savedToPolarion, false);
  assert.equal(done.tables[0]!.rows, 4);
  const saved = drafts.read(opened.id).html;
  assert.match(saved, /压力/);
  assert.ok(saved.includes('<p>intro</p>') && saved.includes('<p>outro</p>'));

  assert.throws(() => drafts.table(opened.id, 0, [{ op: 'delete_rows', table: 0, rowIndices: [0] }]), /STALE_DRAFT/);
  const stale = drafts.table(opened.id, 1, [{ op: 'delete_rows', table: 0, rowIndices: [3] }]);
  assert.equal(stale.tables[0]!.rows, 3);
  assert.ok(!drafts.read(opened.id).html.includes('压力'));
});

test('single-table surgery reads one subtree and splices back only that table', async () => {
  const { drafts, opened } = await fixture();
  const read = drafts.tableRead(opened.id, 0);
  assert.equal(read.document.type, 'table');
  assert.equal(read.revision, opened.revision);
  read.document.content![1]!.content![0]!.content = [{ type: 'paragraph', content: [{ type: 'text', text: '温度（改）' }] }];
  const applied = drafts.tableApply(opened.id, read.editorId, read.revision, 0, read.document);
  assert.equal(applied.draft.revision, 1);
  const saved = drafts.read(opened.id).html;
  assert.match(saved, /温度（改）/);
  assert.ok(saved.includes('<thead><tr><th>参数</th>') && saved.includes('<p>outro</p>'));
  assert.throws(() => drafts.tableApply(opened.id, read.editorId, 99, 0, read.document), /STALE_DRAFT/);
});


test('peek reads a work item from another document without opening a draft', async () => {
  const store = new Store(':memory:');
  const remote = {
    read: async () => { throw Error('WORK_ITEM_DOCUMENT_MISMATCH'); },
    peek: async () => ({ workItemId: 'OTHER-1', title: '另一篇文档的工作项', description: '<p>跨文档参考正文</p>', updated: '2' }),
  };
  const drafts = new Drafts(store, remote as never);
  const value = await drafts.peek(target, 'OTHER-1');
  assert.equal(value.title, '另一篇文档的工作项');
  assert.match(value.text, /跨文档参考正文/);
  assert.equal(value.source, 'remote');
});
