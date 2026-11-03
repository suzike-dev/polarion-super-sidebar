import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { LosslessHtml } from '../../../packages/core/lossless-html.ts';
import { richPreview } from './rich-preview.ts';
const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/fixture' };
test('rich preview keeps nested and merged table geometry without changing source', () => {
  const source = '<table style="width:100%"><tr><td rowspan="2">25 °C</td><td><table><tr><td>nested</td></tr></table></td></tr><tr><td>next</td></tr></table>';
  const original = new LosslessHtml(source); const dom = new JSDOM();
  const preview = new JSDOM(richPreview(source, original.nodes, target, dom.window.DOMParser)).window.document;
  assert.equal(preview.querySelectorAll('table').length, 2); assert.equal(preview.querySelector('td')!.rowSpan, 2);
  assert.equal(preview.querySelectorAll('[data-source-node]').length, 3); assert.equal(original.source, source); dom.window.close();
});
test('display sanitization blocks executable content and external resource requests, while source stays intact', () => {
  const source = '<p onclick="attack()" style="position:fixed;background:url(https://bad.test/x)">hello</p><script>attack()</script><img src="https://bad.test/x" onerror="attack()"><span id="polarion_wiki macro name=unknown;params=x">opaque</span>';
  const original = new LosslessHtml(source); const dom = new JSDOM();
  const preview = new JSDOM(richPreview(source, original.nodes, target, dom.window.DOMParser)).window.document;
  assert.equal(preview.querySelectorAll('script,[onclick],[onerror]').length, 0);
  assert.equal(preview.querySelector('img')!.hasAttribute('src'), false); assert.equal(preview.querySelector('p')!.style.position, '');
  assert.equal(preview.querySelector('[data-protected]')!.textContent?.includes('原始片段保留'), true); assert.equal(original.source, source); dom.window.close();
});
