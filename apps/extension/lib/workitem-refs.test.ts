import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkifyWorkItems, tableToMarkdown} from './workitem-refs.ts';

const doc = (children: any[]) => ({type: 'root', children});

test('work item ids become links only in prose, never inside code or existing links', () => {
  const tree = doc([
    {type: 'paragraph', children: [
      {type: 'text', value: '请检查 SPE-950 与 TEST-729 的边界，型号 AB-12A 不算。'},
      {type: 'inlineCode', value: 'SPE-1'},
      {type: 'link', url: 'https://example.com', children: [{type: 'text', value: 'SPE-2'}]},
    ]},
    {type: 'code', value: 'SPE-3'},
  ]);
  assert.equal(linkifyWorkItems(tree), true);
  const paragraph = tree.children[0].children;
  assert.deepEqual(paragraph.map((n: any) => n.type), ['text', 'link', 'text', 'link', 'text', 'inlineCode', 'link']);
  assert.equal(paragraph[1].url, 'workitem:SPE-950');
  assert.equal(paragraph[3].url, 'workitem:TEST-729');
  assert.equal(paragraph[4].value.includes('AB-12A'), true);
  // 代码与既有链接保持原样
  assert.equal(tree.children[0].children[5].value, 'SPE-1');
  assert.equal(tree.children[0].children[6].children[0].value, 'SPE-2');
  assert.equal(tree.children[1].value, 'SPE-3');
});

test('text without ids is left untouched', () => {
  const tree = doc([{type: 'paragraph', children: [{type: 'text', value: '没有编号的普通回答。'}]}]);
  assert.equal(linkifyWorkItems(tree), false);
});

test('rendered tables serialize back to markdown with escaped pipes', () => {
  const cells = (rows: string[][]) => {
    const table: any = {rows: rows.map(row => ({cells: row.map(text => ({textContent: text}))}))};
    return tableToMarkdown(table);
  };
  assert.equal(cells([['编号', '条款'], ['R01', '压力 | 电压'], ['R02', '多行\n内容']]),
    '| 编号 | 条款 |\n| --- | --- |\n| R01 | 压力 \\| 电压 |\n| R02 | 多行 内容 |');
});
