import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDocumentRoute, parseChangeDeepLink, pendingChangeRecordId } from './change-deep-link.ts';

const origin = 'https://polarion.pufafen.com';

test('工作项深链换成对应文档深链并保留记录 id', () => {
  const hash = '#/project/55_SPE26_Y3_TM_004/workitem?id=SPE-714&psb=changes&psbChange=rec-1&psbDoc=' +
    encodeURIComponent('55_SPE26_Y3_TM_004/Software Requirement Specification');
  assert.deepEqual(parseChangeDeepLink(hash, origin), {
    recordId: 'rec-1',
    docUrl: `${origin}/polarion/#/project/55_SPE26_Y3_TM_004/wiki/55_SPE26_Y3_TM_004/Software%20Requirement%20Specification?psb=changes`,
  });
  assert.equal(isDocumentRoute(hash), false);
});

test('中文与特殊字符的文档路径逐段编码', () => {
  const hash = '#/project/TEST/workitem?id=TEST-1&psb=changes&psbChange=rec-2&psbDoc=' +
    encodeURIComponent('设计/软件需求 规格 & 附录');
  assert.equal(parseChangeDeepLink(hash, origin)?.docUrl,
    `${origin}/polarion/#/project/TEST/wiki/${encodeURIComponent('设计')}/${encodeURIComponent('软件需求 规格 & 附录')}?psb=changes`);
});

test('已经是文档页时只认记录 id，不再跳转', () => {
  const hash = '#/project/TEST/wiki/Design/Spec?psb=changes&psbChange=rec-3';
  assert.equal(parseChangeDeepLink(hash, origin), undefined);
  assert.equal(pendingChangeRecordId(hash), 'rec-3');
  assert.equal(isDocumentRoute(hash), true);
});

test('普通文档深链和缺参数都不产生记录跳转', () => {
  assert.equal(parseChangeDeepLink('#/project/TEST/wiki/Design/Spec?psb=changes', origin), undefined);
  assert.equal(parseChangeDeepLink('#/project/TEST/workitem?id=TEST-1&psb=changes', origin), undefined);
  assert.equal(parseChangeDeepLink('#/project/TEST/workitem?id=TEST-1&psbChange=rec-4', origin), undefined);
  assert.equal(parseChangeDeepLink('', origin), undefined);
  assert.equal(pendingChangeRecordId('#/project/TEST/wiki/Design/Spec?psb=changes'), undefined);
});
