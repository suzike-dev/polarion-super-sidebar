import test from 'node:test';
import assert from 'node:assert/strict';
import {friendlyRecordName, recordPreview, recordNameFromItems, summaryLeadLines} from './change-record-name.ts';
import type {ChangeItem, ChangeRecord} from '../protocol/index.ts';

function item(workItemId: string, title: string, kind: ChangeItem['kind'] = 'modified'): ChangeItem {
  return {workItemId, title, outlineBefore: '1', outlineAfter: '1', chapterBefore: '1', chapterAfter: '1', kind, fields: [], blocks: [], counts: {added: 0, removed: 0, modified: 0}};
}

test('new record names list up to two changed work items and fold the rest', () => {
  assert.equal(recordNameFromItems([item('SPE-878', '防热风吹险'), item('SPE-879', '防冷风吹脚')]), 'SPE-878 防热风吹险 · SPE-879 防冷风吹脚');
  assert.equal(recordNameFromItems([item('SPE-1', '甲'), item('SPE-2', '乙'), item('SPE-3', '丙')], 3), 'SPE-1 甲 · SPE-2 乙 等 3 项');
  assert.equal(recordNameFromItems([item('SPE-1', '   ')]), '');
});

test('old AI headlines surface the focused work instead of the generic count', () => {
  assert.equal(friendlyRecordName('本次共变更 2 个工作项，全部为修改，集中在 4.4.1.1.4 Purge 功能的进入条件与执行次数判定上。', '软件需求', 2),
    '4.4.1.1.4 Purge 功能的进入条件与执行次数判定上');
  assert.equal(friendlyRecordName('共变更 2 个工作项，集中在防冷风吹扫功能。', '软件需求', 2), '防冷风吹扫功能');
});

test('auto headlines and bare counts stay readable', () => {
  const doc = 'Software Requirement Specification（软件需求）';
  assert.equal(friendlyRecordName(`${doc}：2 个工作项变更（修改 2、新增 0、删除 0），集中在第 4 章`, doc, 2), '第 4 章 · 2 项变更');
  assert.equal(friendlyRecordName('本次共变更 1 个工作项（修改 1、新增 0、删除 0）', '软件需求', 1), '1 项变更');
  assert.equal(friendlyRecordName('', '软件需求', 3), '3 项变更');
});

test('names keep the existing headline when it is already specific', () => {
  assert.equal(friendlyRecordName('SPE-878 防热风吹险 · SPE-879 防冷风吹脚', '软件需求', 2), 'SPE-878 防热风吹险 · SPE-879 防冷风吹脚');
});

test('summary lead lines skip section names and generic count/range sentences', () => {
  const lines = summaryLeadLines('## 结论\n- 本次共变更 2 个工作项\n- 两处改动性质一致，都是把触发时机改为空调开闭循环\n- 区间：2026-11-15\n### 影响提示\n- 需要重新确认标定', 3);
  assert.deepEqual(lines, ['两处改动性质一致，都是把触发时机改为空调开闭循环', '需要重新确认标定']);
});

test('record preview carries only lightweight display fields', () => {
  const record: ChangeRecord = {
    id: 'rec-1', target: {origin: 'https://polarion.pufafen.com', projectId: 'DEMO', document: 'Design/Spec'},
    documentTitle: '规格说明', baselineAt: 1, endedAt: 2, itemCount: 10, changedItems: 2, added: 0, removed: 0, modified: 2, moved: 0,
    aiStatus: 'ready', headline: 'SPE-1 甲 · SPE-2 乙', workItemId: 'DEMO-1', attachmentName: 'record.json',
    chapters: [], changes: [item('SPE-1', '甲'), item('SPE-2', '乙')], images: {'x.png': 'data:image/png;base64,AAAA'},
    heuristicSummary: '', aiSummary: {status: 'ready', text: '### 结论\n- 本次共变更 2 个工作项\n- 两处改动性质一致'},
  };
  const preview = recordPreview(record);
  assert.deepEqual(preview.items.map(value => value.workItemId), ['SPE-1', 'SPE-2']);
  assert.deepEqual(preview.summaryLines, ['两处改动性质一致']);
  assert.equal(preview.headline, 'SPE-1 甲 · SPE-2 乙');
  assert.equal((preview as Record<string, unknown>).images, undefined);
  assert.equal((preview as Record<string, unknown>).changes, undefined);
});
