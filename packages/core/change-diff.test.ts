import test from 'node:test';
import assert from 'node:assert/strict';
import {collectImageSources, diffItemHtml, htmlChangeSignature, resolveImages, sanitizeBlockHtml, textOfHtml} from './change-diff.ts';

test('whitespace, attribute order and regenerated ids are not changes', () => {
  const before = '<p id="polarion_wiki macro name=x;uid=1" class="a" style="color: red;  font-weight: 700"> 需求  文本 </p>';
  const after = '<p style="color:red;font-weight:700" class="a" id="another-id">需求 文本</p>';
  assert.equal(htmlChangeSignature(before), htmlChangeSignature(after));
  const diff = diffItemHtml(before, after);
  assert.equal(diff.changed, false);
  assert.equal(diff.counts.same, 1);
});

test('modified paragraph is paired instead of reported as remove plus add', () => {
  const diff = diffItemHtml('<p>温度上限为 45°C。</p>', '<p>温度上限为 50°C。</p>');
  assert.equal(diff.changed, true);
  assert.equal(diff.counts.modified, 1);
  assert.equal(diff.counts.added, 0);
  assert.equal(diff.counts.removed, 0);
  assert.match(diff.blocks[0]!.before ?? '', /45°C/);
  assert.match(diff.blocks[0]!.after ?? '', /50°C/);
});

test('inserted and deleted paragraphs keep surrounding context', () => {
  const before = '<p>第一段</p><p>第二段</p>';
  const after = '<p>第一段</p><p>新增的第三段</p><p>第二段</p>';
  const diff = diffItemHtml(before, after);
  assert.deepEqual(diff.counts, {added: 1, removed: 0, modified: 0, same: 2});
  assert.deepEqual(diff.blocks.map(block => block.kind), ['same', 'added', 'same']);
});

test('table changes are reported as a table block and keep rowspan structure', () => {
  const before = '<table><tbody><tr><td rowspan="2">-20</td><td>30</td></tr><tr><td>30</td></tr></tbody></table>';
  const after = '<table><tbody><tr><td rowspan="2">-20</td><td>35</td></tr><tr><td>30</td></tr></tbody></table>';
  const diff = diffItemHtml(before, after);
  assert.equal(diff.counts.modified, 1);
  assert.equal(diff.blocks[0]!.tag, 'table');
  assert.match(diff.blocks[0]!.after ?? '', /35/);
  assert.match(diff.blocks[0]!.after ?? '', /rowspan="2"/);
});

test('flattened wrappers still diff inner paragraphs', () => {
  const before = '<div class="section"><p>A</p><p>B</p></div>';
  const after = '<div class="section"><p>A</p><p>C</p></div>';
  const diff = diffItemHtml(before, after);
  assert.deepEqual(diff.blocks.map(block => block.kind), ['same', 'modified']);
});

test('sanitizer drops scripts and event handlers but keeps safe table markup', () => {
  const dirty = '<p onclick="steal()">文本<script>alert(1)</script><a href="javascript:bad()">链接</a></p><table><tr><td style="color: #123; behavior: url(x)">值</td></tr></table><iframe src="https://bad"></iframe>';
  const clean = sanitizeBlockHtml(dirty);
  assert.doesNotMatch(clean, /<script|onclick|javascript:|<iframe|behavior/i);
  assert.match(clean, /<table>/);
  assert.match(clean, /文本/);
});

test('external images become a clear placeholder, data images survive', () => {
  const html = '<p><img src="workitemimg:abc"/><img src="data:image/png;base64,AAAA"/></p>';
  const clean = sanitizeBlockHtml(html);
  assert.match(clean, /需在 Polarion 中查看/);
  assert.match(clean, /data:image\/png;base64,AAAA/);
  assert.deepEqual(collectImageSources(html), ['workitemimg:abc', 'data:image/png;base64,AAAA']);
  const resolved = resolveImages(clean, {'data:image/png;base64,AAAA': 'data:image/png;base64,AAAA'});
  assert.match(resolved, /data:image\/png;base64,AAAA/);
});

test('plain text extraction skips macros and collapses whitespace', () => {
  assert.equal(textOfHtml('<p>温度&nbsp;上限 <strong>45</strong> °C</p>'), '温度 上限 45 °C');
});

test('paragraph split into two stays a modified pair instead of remove plus add', () => {
  const diff = diffItemHtml('<p>温度上限为 45°C，低于 -20°C 时退出。</p>', '<p>温度上限为 50°C，</p><p>低于 -20°C 时退出。</p>');
  assert.equal(diff.counts.modified, 1);
  assert.equal(diff.counts.removed, 0);
  assert.equal(diff.counts.added, 0);
  assert.match(diff.blocks[0]!.after ?? '', /50°C/);
});

test('a replaced paragraph is a modification, not a whole delete plus add', () => {
  const diff = diffItemHtml('<p>空调系统应在环境温度低于负二十度时退出制热。</p>', '<p>充电桩应在电池 SOC 高于百分之九十时停止充电。</p>');
  assert.equal(diff.counts.modified, 1);
  assert.equal(diff.counts.removed, 0);
  assert.equal(diff.counts.added, 0);
});
