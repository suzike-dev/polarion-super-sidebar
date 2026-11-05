import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {documentWorkItems, filterWorkItems} from './document-items.ts';

const page = '<div id="module-workitem;params=id=SPE-950"><h2>系统上电工作状态</h2></div>' +
  '<div id="module-workitem;params=id=SPE-1094;scope=document"><h2>EV</h2><p>正文</p></div>' +
  '<div id="module-workitem;params=id=SPE-1094"><h2>重复块</h2></div>' +
  '<div id="module-workitem;params=id=SPE-900|new=1"><h2>新建未保存</h2></div>' +
  '<div id="module-workitem;params=id=SPE-777"><p>SPE-777 - 带编号前缀的标题</p><p>正文</p></div>' +
  '<div id="module-workitem;params=id=SPE-520"><span id="polarion_editor_field=title" style="display:none">系统框图</span><div><span>SPE-520 - 正在加载...</span></div></div>' +
  '<div id="module-workitem;params=id=SPE-528"><div><span>SPE-528 - 正在加载...</span></div></div>' +
  '<p><span class="polarion-rte-link" data-type="workItem" data-item-id="SPE-777"></span></p>';

test('document work items come from document blocks, unique and without new placeholders', () => {
  const dom = new JSDOM(`<body>${page}</body>`);
  const items = documentWorkItems(dom.window.document);
  assert.deepEqual(items, [
    {workItemId: 'SPE-950', title: '系统上电工作状态'},
    {workItemId: 'SPE-1094', title: 'EV'},
    {workItemId: 'SPE-777', title: '带编号前缀的标题正文'},
    {workItemId: 'SPE-520', title: '系统框图'},
    {workItemId: 'SPE-528', title: ''},
  ]);
  dom.window.close();
});

test('local filtering matches id or title and keeps everything for an empty query', () => {
  const items = [{workItemId: 'SPE-950', title: '系统上电工作状态'}, {workItemId: 'SPE-1094', title: 'EV'}];
  assert.deepEqual(filterWorkItems(items, '').length, 2);
  assert.deepEqual(filterWorkItems(items, 'spe-95'), [{workItemId: 'SPE-950', title: '系统上电工作状态'}]);
  assert.deepEqual(filterWorkItems(items, 'ev'), [{workItemId: 'SPE-1094', title: 'EV'}]);
  assert.deepEqual(filterWorkItems(items, '不存在'), []);
});
