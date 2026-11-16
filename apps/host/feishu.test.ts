import test from 'node:test';
import assert from 'node:assert/strict';
import {buildChangeCard, cardDigest} from './feishu.ts';
import type {ChangeRecord} from '../../packages/protocol/index.ts';

const record: ChangeRecord = {
  id: 'rec-1',
  target: {origin: 'https://polarion.pufafen.com', projectId: 'DEMO', document: 'Design/Spec'},
  documentTitle: '规格说明',
  baselineAt: Date.parse('2026-11-16T01:00:00Z'),
  endedAt: Date.parse('2026-11-16T01:05:00Z'),
  itemCount: 10,
  changedItems: 3,
  added: 1,
  removed: 0,
  modified: 2,
  moved: 0,
  aiStatus: 'ready',
  headline: '修改了 A 和 B',
  workItemId: 'DEMO-1',
  attachmentName: 'record.json',
  chapters: [],
  changes: [],
  images: {},
  heuristicSummary: '自动摘要',
  aiSummary: {status: 'ready', text: '### 结论\n- 修改了 A 和 B\n### 影响提示\n- 需要评审', at: Date.now()},
};

const detailUrl = 'https://polarion.pufafen.com/polarion/#/project/DEMO/workitem?id=DEMO-1&psb=changes&psbChange=rec-1&psbDoc=Design%2FSpec';

test('change card keeps the magazine layout and exactly one detail link', () => {
  const card = buildChangeCard({record, url: 'http://127.0.0.1/share', detailUrl});
  const header = card.header as any;
  assert.equal(header.template, 'green');
  assert.equal(header.title.content, '规格说明');
  assert.match(header.subtitle.content, /需求变更速览 · DEMO/);
  assert.deepEqual(header.text_tag_list.map((tag: any) => tag.text.content), ['AI 总结', '3 个工作项']);

  const [stats, range, summary] = card.elements as any[];
  assert.equal(stats.tag, 'column_set');
  assert.equal(stats.background_style, 'grey');
  assert.equal(stats.columns.length, 4);
  assert.deepEqual(stats.columns.map((column: any) => column.elements[0].text.content.split('\n')[1]), [
    "<font color='grey'>变更工作项</font>", "<font color='grey'>修改</font>", "<font color='grey'>新增</font>", "<font color='grey'>删除</font>",
  ]);
  assert.match(range.text.content, /变更区间/);
  assert.match(range.text.content, /历时 5 分钟/);
  assert.equal(summary.tag, 'column_set');
  assert.match(summary.columns[0].elements[0].text.content, /^\*\*变更总结\*\*/);
  assert.match(summary.columns[0].elements[0].text.content, /▎/);

  const buttons = card.elements.filter((element: any) => element.tag === 'action').flatMap((element: any) => element.actions);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].text.content, '打开变更详情');
  assert.equal(buttons[0].url, detailUrl);
  assert.ok(!buttons[0].url.includes('/wi-attachment/'));
});

test('digest marks sections with a green bar, keeps minor headings bold and truncates long text', () => {
  const digest = cardDigest('### 结论\n- A\n#### 子项\n- B');
  assert.match(digest, /<font color='green'>▎<\/font>\*\*结论\*\*/);
  assert.match(digest, /\*\*子项\*\*/);
  assert.doesNotMatch(digest, /▎\*\*子项/);
  assert.match(digest, /• A/);
  const cut = cardDigest('### 甲\n' + '- x'.repeat(500));
  assert.match(cut, /其余要点见详情链接/);
});
