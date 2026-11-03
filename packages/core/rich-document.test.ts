import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RichDocument } from './rich-document.ts';
import type { JSONContent } from '@tiptap/core';
import {patchStyle,mergeSourceStyle,safeStyle} from './rich-style.ts';
const visit = (j: JSONContent, fn: (j: JSONContent) => void) => { fn(j); j.content?.forEach(c => visit(c, fn)); };
const source = '<div class="polarion-rte"><p style="color:#123456">Before&nbsp;<strong>bold</strong></p><table id="polarion_wiki macro name=table;params=uid=12" style="width:100%;border-collapse:collapse"><tbody><tr><td colspan="2" style="background-color:#eee"><p>A &amp; B</p><table><tbody><tr><td>nested</td></tr></tbody></table></td></tr><tr><td>x</td><td>y</td></tr></tbody></table><p><img src="attachment.png"><span id="polarion_wiki macro name=unknown;params=id=7">payload</span></p></div>';
test('native div inside inline span exposes its clause and retains exact wrappers',()=>{
 const html='<span style="color:red"><div></div><div>工程条件</div></span>',d=new RichDocument(html);assert.equal(d.serialize(d.document),html);const j=structuredClone(d.document);visit(j,n=>{if(n.text==='工程条件')n.text='工程条件确认';});assert.equal(d.serialize(j),html.replace('工程条件','工程条件确认'));
});
test('native Polarion sibling nested lists remain editable with byte-preserving virtual wrappers',()=>{
 const html='<div><ol><li>启用</li><ol><li><span style="color:red">远程条件</span></li></ol><li><div>块内容</div></li></ol></div>';
 const d=new RichDocument(html);assert.equal(d.serialize(d.document),html);const edited=structuredClone(d.document);visit(edited,n=>{if(n.text==='远程条件')n.text='远程条件已复核';});assert.equal(d.serialize(edited),html.replace('远程条件','远程条件已复核'));
});
test('rich editor no-op and targeted nested cell edit preserve source wrappers and protected objects', () => {
  const d = new RichDocument(source); assert.equal(d.serialize(d.document), source);
  const j = structuredClone(d.document); visit(j, n => { if (n.text === 'nested') n.text = '嵌套 🚙'; });
  assert.equal(d.serialize(j), source.replace('nested', '嵌套 &#x1F699;'));
});
test('rich formatting preserves unaffected fragments, entities and table identity', () => {
  const d = new RichDocument(source); const j = structuredClone(d.document);
  visit(j, n => { if (n.text === 'A & B') n.marks = [...n.marks!, { type: 'italic' }]; });
  assert.equal(d.serialize(j), source.replace('A &amp; B', '<em>A &amp; B</em>'));
});
test('deleting or fabricating protected objects is rejected', () => {
  const d = new RichDocument(source); const j = structuredClone(d.document); visit(j, n => { n.content = n.content?.filter(c => !c.type?.startsWith('protected')); });
  assert.throws(() => d.serialize(j), /PROTECTED_OBJECT_REMOVED/);
  const forged = structuredClone(d.document); forged.content!.push({ type: 'protectedBlock', attrs: { sid: 'fake' } });
  assert.throws(() => d.serialize(forged), /STALE_RICH_ANCHOR/);
});
test('table insertion/deletion and merge attributes remain valid with nested tables', () => {
  const d = new RichDocument('<table class="t"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
  const j = structuredClone(d.document); const table = j.content![0]!;
  table.content!.push({ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }] }] });
  assert.equal(d.serialize(j), '<table class="t"><tbody><tr><td>a</td><td>b</td></tr><tr><td colspan="2" style="border:1px solid #cbd5e1;padding:8px;"><p>new</p></td></tr></tbody></table>');
});
test('paragraph formatting and new content cannot inject active HTML', () => {
  const d = new RichDocument('<p class="native">x</p>'); const j = structuredClone(d.document); const p = j.content![0]!;
  p.attrs!.textAlign = 'center'; p.content![0]!.text = '<script> & 🚙';
  assert.equal(d.serialize(j), '<p class="native" style=";text-align:center">&lt;script&gt; &amp; &#x1F699;</p>');
  p.content![0]!.marks!.push({ type: 'link', attrs: { href: 'javascript:alert(1)' } });
  assert.throws(() => d.serialize(j), /UNSAFE_LINK/);
});
test('source whitespace around explicit table row groups survives a cell edit', () => {
  const source = '\n<table id="t">\n  <tbody>\n    <tr>\n      <td><p>x</p></td>\n    </tr>\n  </tbody>\n</table>\n';
  const d = new RichDocument(source); const j = structuredClone(d.document); visit(j, n => { if (n.text === 'x') n.text = 'y'; });
  assert.equal(d.serialize(j), source.replace('>x<', '>y<'));
});

test('existing paragraph and table styles save, reopen and preserve unrelated source attributes',()=>{
  const source='<p id="native" style="margin-top:2px; color : #123456; mso-special-format:yes">阈值 25 °C</p><table id="t" style="width:100%"><tbody><tr><td style="padding:3px">3.75 s</td></tr></tbody></table>';
  const d=new RichDocument(source),j=structuredClone(d.document);
  visit(j,n=>{if(n.type==='paragraph'&&n.attrs?.sid)n.attrs.sourceStyle=patchStyle(n.attrs.sourceStyle,{'margin-top':'24px','background-color':'#eff6ff'});if(n.type==='table')n.attrs!.sourceStyle=patchStyle(n.attrs!.sourceStyle,{width:'80%','border-spacing':'4px'});if(n.type==='tableCell')n.attrs!.sourceStyle=patchStyle(n.attrs!.sourceStyle,{padding:'12px'});});
  const html=d.serialize(j);assert.match(html,/mso-special-format:yes/);assert.match(html,/margin-top:24px/);assert.match(html,/background-color:#eff6ff/);assert.match(html,/width:80%/);assert.match(html,/padding:12px/);assert.match(html,/阈值 25 °C/);assert.match(html,/3.75 s/);
  const reopened=new RichDocument(html);assert.equal(reopened.serialize(reopened.document),html);
  assert.equal(d.serialize(d.document),source);
});

test('style edits remove duplicate declarations with whitespace without stripping unknown original styles',()=>{
  assert.equal(mergeSourceStyle('COLOR : red;color:blue;mso-test:keep;padding:2px','COLOR : red;color:blue;padding:2px','padding:4px'),'mso-test:keep;padding:4px');
  assert.equal(safeStyle('background-color:url(https://x);margin-top:12px;behavior:evil;position:fixed'), 'margin-top:12px');
  assert.equal(patchStyle('margin-top:12px;color:red',{'margin-top':null}),'color:red');
});

test('callout uses a native table carrier and remains editable after save and reopen',()=>{
  const d=new RichDocument('<p>阈值 25 °C &amp; 3 s</p>');const j=structuredClone(d.document);
  j.content=[{type:'callout',attrs:{tone:'warning'},content:j.content}];
  const html=d.serialize(j);assert.match(html,/data-sidebar-callout="warning"/);assert.match(html,/background-color:#fff7ed/);assert.match(html,/cellpadding="12"/);
  const reopened=new RichDocument(html),next=structuredClone(reopened.document);assert.equal(next.content![0]!.type,'callout');visit(next,n=>{if(n.text)n.text=n.text.replace('3 s','4 s');});
  const updated=reopened.serialize(next);assert.match(updated,/>阈值 25 °C &amp; 4 s</);assert.match(updated,/border-left:3px solid #c2410c/);assert.equal(new RichDocument(updated).document.content![0]!.type,'callout');
});

test('code block keeps whitespace and special characters through edits and reopening',()=>{
  const source='<pre class="native"><code class="language-c">if (t &lt; 25) {\n  hold = 3;\n}</code></pre>';
  const d=new RichDocument(source);assert.equal(d.serialize(d.document),source);const j=structuredClone(d.document);assert.equal(j.content![0]!.attrs!.language,'c');j.content![0]!.content![0]!.text='if (t < 26) {\n  hold = 4;\n}';
  const html=d.serialize(j);assert.match(html,/&lt; 26/);assert.match(html,/\n  hold = 4;/);assert.equal(new RichDocument(html).document.content![0]!.content![0]!.text,'if (t < 26) {\n  hold = 4;\n}');
});
