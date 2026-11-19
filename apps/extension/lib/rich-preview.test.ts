import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { LosslessHtml } from '../../../packages/core/lossless-html.ts';
import { richPreview, richPreviewDocument } from './rich-preview.ts';
const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/fixture' };
test('empty reader bodies exclude editor placeholders and include standalone rich objects', t => {
  const dom = new JSDOM(); t.after(() => dom.window.close());
  const render = (source: string) => richPreviewDocument(source, new LosslessHtml(source).nodes, target, dom.window.DOMParser);
  for (const source of ['', ' \n', '<!-- empty --><p>&nbsp;<br></p><div><span>\u200b</span></div>']) assert.equal(render(source).hasContent, false);
  const objects = [
    ['<img src="attachment:fixture.png">', 'img[data-image-source]'],
    ['<table><tbody><tr><td><br></td></tr></tbody></table>', 'table td'],
    ['<span data-sidebar-formula="inline" data-tex="x^2"></span>', '[data-sidebar-formula] math'],
    ['<span data-type="workItem" data-item-id="FIX-7"></span>', 'button[data-workitem-ref="FIX-7"]'],
    ['<span class="polarion-rte-link" data-item-id="FIX-8"></span>', 'button[data-workitem-ref="FIX-8"]'],
    ['<div id="polarion_wiki macro name=fixture"></div>', '[data-protected]'],
  ] as const;
  for (const [source, selector] of objects) {
    const preview = render(source);
    assert.equal(preview.hasContent, true, source);
    assert.ok(new dom.window.DOMParser().parseFromString(preview.html, 'text/html').body.querySelector(selector), selector);
  }
});

test('rich preview keeps nested and merged table geometry without changing source', () => {
  const source = '<table style="width:100%"><tr><td rowspan="2">25 °C</td><td><table><tr><td>nested</td></tr></table></td></tr><tr><td>next</td></tr></table>';
  const original = new LosslessHtml(source); const dom = new JSDOM();
  const preview = new JSDOM(richPreview(source, original.nodes, target, dom.window.DOMParser)).window.document;
  assert.equal(preview.querySelectorAll('table').length, 2); assert.equal(preview.querySelector('td')!.rowSpan, 2);
  assert.equal(preview.querySelectorAll('[data-source-node]').length, 3); assert.equal(original.source, source); dom.window.close();
});
test('empty work item reference spans stay visible and clickable in the local preview', () => {
  const source = '<p>见 <span onclick="attack()" class="polarion-rte-link" data-type="workItem" id="fake" data-item-id="TEST-728" data-option-id="long"></span> 的说明</p>';
  const original = new LosslessHtml(source); const dom = new JSDOM();
  const preview = new JSDOM(richPreview(source, original.nodes, target, dom.window.DOMParser)).window.document;
  const chip = preview.querySelector('[data-workitem-ref]')!;
  assert.equal(chip.tagName, 'BUTTON'); assert.equal(chip.getAttribute('type'), 'button');
  assert.equal(chip.textContent, 'TEST-728'); assert.equal(chip.getAttribute('data-workitem-ref'), 'TEST-728');
  assert.equal(chip.getAttribute('class'), 'preview-workitem-ref'); assert.equal(chip.hasAttribute('onclick'), false);
  assert.equal(original.source, source); dom.window.close();
});
test('display sanitization blocks executable content and external resource requests, while source stays intact', () => {
  const source = '<p onclick="attack()" style="position:fixed;background:url(https://bad.test/x)">hello</p><script>attack()</script><img src="https://bad.test/x" onerror="attack()"><span id="polarion_wiki macro name=unknown;params=x">opaque</span>';
  const original = new LosslessHtml(source); const dom = new JSDOM();
  const preview = new JSDOM(richPreview(source, original.nodes, target, dom.window.DOMParser)).window.document;
  assert.equal(preview.querySelectorAll('script,[onclick],[onerror]').length, 0);
  assert.equal(preview.querySelector('img')!.hasAttribute('src'), false); assert.equal(preview.querySelector('p')!.style.position, '');
  assert.equal(preview.querySelector('[data-protected]')!.textContent?.includes('原始片段保留'), true); assert.equal(original.source, source); dom.window.close();
});
test('preview offers only diagram blocks to the board and preserves code text and language',()=>{
  const source='<pre><code class="language-mermaid junk">flowchart LR\nA--&gt;B</code></pre><pre><code class="language-matlab">if x\nend</code></pre>';
  const model=new LosslessHtml(source),dom=new JSDOM();
  const doc=new JSDOM(richPreview(source,model.nodes,target,dom.window.DOMParser)).window.document;
  assert.equal(doc.querySelectorAll('button[data-open-board]').length,1);
  assert.equal(doc.querySelector('button[data-open-board]')?.previousElementSibling?.textContent,'flowchart LR\nA-->B');
  assert.equal(doc.querySelector('pre code')?.className,'language-mermaid');
  assert.ok(doc.querySelector('.hljs-keyword'));dom.window.close();
});
test('parameterless table macro renders as a table, not the protected placeholder', () => {
  // LiveDoc 导出的表格宏 id 以宏名结尾、无 `;params`（SPE-908 实测形态）。
  const source = '<table id="polarion_wiki macro name=table" class="polarion-Document-table" style="width:80%"><tbody><tr><th>出风模式</th><th>出风温度阈值</th></tr><tr><td>吹面</td><td>＜[21,24]</td></tr></tbody></table>';
  const original = new LosslessHtml(source); const dom = new JSDOM();
  const preview = new JSDOM(richPreview(source, original.nodes, target, dom.window.DOMParser)).window.document;
  assert.equal(preview.querySelectorAll('table').length, 1);
  assert.equal(preview.querySelector('.preview-table td')!.textContent, '吹面');
  assert.equal(preview.querySelector('[data-protected]'), null);
  assert.equal(original.source, source); dom.window.close();
});
