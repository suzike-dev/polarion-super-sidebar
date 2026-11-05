import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkItemPick, matchWorkItemQuery, splitWorkItems} from './workitem-picker.ts';

test('@ query only matches the trailing fragment and ignores emails', () => {
  assert.equal(matchWorkItemQuery('检查 @SPE'), 'SPE');
  assert.equal(matchWorkItemQuery('检查 @'), '');
  assert.equal(matchWorkItemQuery('参考@SPE'), 'SPE');
  assert.equal(matchWorkItemQuery('见（@SPE-950'), 'SPE-950');
  assert.equal(matchWorkItemQuery('前缀 @SPE-95 后缀'), null);
  assert.equal(matchWorkItemQuery('联系 user@example.com'), null);
  assert.equal(matchWorkItemQuery('联系 user@exa'), null);
  assert.equal(matchWorkItemQuery('没有查询'), null);
});

test('picking replaces the @ fragment and keeps the rest of the draft', () => {
  assert.equal(applyWorkItemPick('检查 @SPE', 'SPE-950'), '检查 SPE-950 ');
  assert.equal(applyWorkItemPick('只写了 @', 'TEST-729'), '只写了 TEST-729 ');
  assert.equal(applyWorkItemPick('没有查询', 'TEST-729'), '没有查询');
});

test('user text splits work item ids into clickable parts', () => {
  const parts = splitWorkItems('请看 SPE-950 与 TEST-729 的差异');
  assert.deepEqual(parts, [
    {text: '请看 '},
    {workItemId: 'SPE-950'},
    {text: ' 与 '},
    {workItemId: 'TEST-729'},
    {text: ' 的差异'},
  ]);
  assert.deepEqual(splitWorkItems('没有编号'), [{text: '没有编号'}]);
});
