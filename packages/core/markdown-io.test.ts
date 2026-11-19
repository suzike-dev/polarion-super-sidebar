import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeMarkdown, markdownToHtml } from './markdown-io.ts';

test('looksLikeMarkdown accepts structured markdown and rejects plain prose', () => {
  assert.equal(looksLikeMarkdown('# 标题\n\n- 条目A\n- 条目B\n\n**重点** 说明'), true);
  assert.equal(looksLikeMarkdown('|信号|单位|\n|---|---|\n|T_amb|°C|'), true);
  assert.equal(looksLikeMarkdown('```matlab\nx = 1;\n```'), true);
  assert.equal(looksLikeMarkdown('普通的一段说明文字，没有结构标记，不应被转换。'), false);
  assert.equal(looksLikeMarkdown('价格是 5*3 的方案，见附件'), false);
});

test('markdownToHtml converts headings, tables, task lists and formulas', () => {
  const html = markdownToHtml([
    '## 空调控制策略',
    '',
    '|信号|单位|说明|',
    '|---|---|---|',
    '|T_amb|°C|环境温度|',
    '',
    '- [ ] 完成降额表',
    '- [x] 复核阈值',
    '',
    '温控律 $P = k(x^2)$，块级公式：',
    '',
    '$$Q = m c \\Delta T$$',
    '',
    '==重点要求==必须满足',
  ].join('\n'));
  assert.ok(/<h2[^>]*>空调控制策略<\/h2>/.test(html), html);
  assert.ok(html.includes('<th>信号</th>') && html.includes('<td>T_amb</td>'));
  assert.match(html, /<ul data-sidebar-tasks="true">/);
  assert.match(html, /data-sidebar-task="true" data-checked="false"/);
  assert.match(html, /data-sidebar-task="true" data-checked="true"/);
  assert.ok(html.includes('data-sidebar-formula="inline"'), html);
  assert.ok(html.includes('data-sidebar-formula="block"') && html.includes('Q = m c \\Delta T'), html);
  assert.ok(html.includes('background-color:#fff3c4'), html);
});

test('markdownToHtml neutralizes executable link protocols', () => {
  const html = markdownToHtml('[点我](javascript:alert(1))\n\n[安全](https://example.com)');
  assert.ok(!/javascript:/i.test(html));
  assert.ok(html.includes('https://example.com'));
});

test('recognizes standalone highlights, images and tasks', () => {
  for (const text of ['==x==', '![](a.png)', '- [x] 复核']) assert.equal(looksLikeMarkdown(text), true, text);
});

test('custom inline syntax only applies outside code', () => {
  const html = markdownToHtml('`$x$ ==y==` and $x$ and ==<b>y</b>==');
  assert.match(html, /<code>\$x\$ ==y==<\/code>/);
  assert.match(html, /data-sidebar-formula="inline" data-tex="x"/);
  assert.match(html, /<span style="background-color:#fff3c4">&lt;b&gt;y&lt;\/b&gt;<\/span>/);
});

test('currency dollars are not converted into formulas', () => {
  const html = markdownToHtml('单价$100、总价$200，不是公式');
  assert.ok(!html.includes('data-sidebar-formula'), html);
});
