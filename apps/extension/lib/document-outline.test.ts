import assert from 'node:assert/strict';
import test from 'node:test';
import {buildOutlineChapters, countOutlineItems, filterOutlineChapters} from './document-outline.ts';
import type {DocumentOutlineItem} from '../../../packages/protocol/index';

const item = (id: string, title: string, outline: string, type = 'softwarerequirement'): DocumentOutlineItem => ({id, title, outline, type, status: 'draft'});

// 真实文档的形状：章 4 独占大部分条目，层级到 4 层，heading 与需求混排。
const SAMPLE: DocumentOutlineItem[] = [
  item('SPE-509', 'Software Requirement Specification', '', 'heading'),
  item('SPE-510', '变更履历', '1', 'heading'),
  item('SPE-511', '变更记录', '1.1'),
  item('SPE-523', 'ASW软件功能需求', '4', 'heading'),
  item('SPE-524', '整车状态识别', '4.1', 'heading'),
  item('SPE-810', '整车低压', '4.1.1', 'heading'),
  item('SPE-817', '整车低压', '4.1.1-1'),
  item('SPE-811', '整车高压', '4.1.2', 'heading'),
  item('SPE-818', '整车高压', '4.1.2-1'),
  item('SPE-555', '压缩机进出口温度', '4.2.13-1'),
  item('SPE-556', '压缩机进出口压力', '4.2.13-2'),
  item('SPE-999', '未编号条目', ''),
];

test('按 outline 还原章与分组，heading 不出条目', () => {
  const chapters = buildOutlineChapters(SAMPLE);
  assert.deepEqual(chapters.map(chapter => chapter.num), ['1', '4', '0']);
  const chapter4 = chapters[1]!;
  assert.equal(chapter4.title, 'ASW软件功能需求');
  assert.deepEqual(chapter4.groups.map(group => group.num), ['4.1', '4.2']);
  // 4.1 与 4.2 各自聚合其下所有子层级的需求条目（4.1.1-1、4.1.2-1 → 4.1）。
  assert.deepEqual(chapter4.groups.map(group => group.items.length), [2, 2]);
  assert.equal(chapter4.groups[0]!.title, '整车状态识别');
  assert.equal(chapter4.groups[1]!.title, '');
});

test('未编号条目归入未分节而不是丢失', () => {
  const chapters = buildOutlineChapters(SAMPLE);
  const tail = chapters.at(-1)!;
  assert.equal(tail.num, '0');
  assert.equal(tail.title, '未分节');
  assert.deepEqual(tail.groups[0]!.items.map(entry => entry.id), ['SPE-999']);
});

test('总数等于非 heading 条目数', () => {
  assert.equal(countOutlineItems(buildOutlineChapters(SAMPLE)), 6);
});

test('关键字过滤保留命中路径并丢弃空分组', () => {
  const chapters = buildOutlineChapters(SAMPLE);
  const filtered = filterOutlineChapters(chapters, '压缩机');
  assert.equal(countOutlineItems(filtered), 2);
  assert.deepEqual(filtered.map(chapter => chapter.num), ['4']);
  assert.deepEqual(filtered[0]!.groups.map(group => group.num), ['4.2']);
});

test('编号前缀匹配与空查询', () => {
  const chapters = buildOutlineChapters(SAMPLE);
  assert.equal(countOutlineItems(filterOutlineChapters(chapters, 'spe-81')), 2);
  assert.equal(countOutlineItems(filterOutlineChapters(chapters, '   ')), 6);
});

test('章顺序按编号数值排序且色相稳定', () => {
  const chapters = buildOutlineChapters([item('A-2', 'b', '10.1'), item('A-1', 'a', '9.1')]);
  assert.deepEqual(chapters.map(chapter => chapter.num), ['9', '10']);
  assert.notEqual(chapters[0]!.hue, chapters[1]!.hue);
});

test('缺少 type 字段时按 outline 结构识别章节', () => {
  const blind: DocumentOutlineItem[] = [
    {id: 'SPE-1', title: 'ASW软件功能需求', outline: '4', type: '', status: ''},
    {id: 'SPE-2', title: '整车状态识别', outline: '4.1', type: '', status: ''},
    {id: 'SPE-3', title: '整车低压', outline: '4.1.1-1', type: '', status: ''},
    {id: 'SPE-4', title: '整车高压', outline: '4.1.2-1', type: '', status: ''},
  ];
  const chapters = buildOutlineChapters(blind);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0]!.title, 'ASW软件功能需求');
  assert.equal(countOutlineItems(chapters), 2);
});

test('同章内每个分组拿到不同色相', () => {
  const chapters = buildOutlineChapters([
    item('A-1', 'g1', '4.1.1-1'), item('A-2', 'g2', '4.2.1-1'), item('A-3', 'g3', '4.3.1-1'),
  ]);
  const hues = chapters[0]!.groups.map(group => group.hue);
  assert.equal(new Set(hues).size, hues.length);
});
