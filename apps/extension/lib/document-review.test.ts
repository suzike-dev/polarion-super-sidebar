import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {reviewDocument} from './document-review.ts';
import {richPreview} from './rich-preview.ts';
test('review navigates separated edits, retains inherited formatting and filters unchanged content',()=>{
 const dom=new JSDOM(),Parser=dom.window.DOMParser,parser=new Parser();
 const before='<div style="color:blue"><p>阈值 25.5 °C 🚙</p><p>不变的分隔段</p><p>说明 A</p></div>',after=before.replace('25.5','26.0').replace('说明 A','说明 B');
 const r=reviewDocument(before,after,Parser,true);assert.equal(r.changes.length,2);assert.ok(!r.after.includes('不变的分隔段'));
 const document=parser.parseFromString(r.after,'text/html');assert.equal(document.querySelector('[data-review-change="0"] span')?.textContent,'26.0');assert.equal(document.querySelectorAll('[style="color:blue"]').length,2);assert.ok(document.body.textContent?.includes('🚙'));
 const rendered=richPreview(r.after,[],{origin:'https://polarion.pufafen.com',projectId:'test01',document:'Requirements/Test'},Parser);assert.equal(parser.parseFromString(rendered,'text/html').querySelectorAll('[data-review-change]').length,2);dom.window.close();
});
test('insert and delete changes pair navigable anchors on both sides without broken Unicode',()=>{
 const dom=new JSDOM(),Parser=dom.window.DOMParser,parser=new Parser();
 const inserted=reviewDocument('<p>A</p>','<p>A</p><p>新增</p>',Parser);assert.equal(inserted.changes[0]?.kind,'added');assert.equal(parser.parseFromString(inserted.before,'text/html').querySelector('[data-review-change="0"]')?.textContent,'此处为新增内容');
 const deleted=reviewDocument('<p>删除</p><p>A</p>','<p>A</p>',Parser);assert.equal(deleted.changes[0]?.kind,'removed');
 const emoji=reviewDocument('<p>😀测试</p>','<p>😁测试</p>',Parser);assert.equal(parser.parseFromString(emoji.after,'text/html').body.textContent,'😁测试');assert.equal(parser.parseFromString(emoji.after,'text/html').querySelector('span')?.textContent,'😁');dom.window.close();
});
test('visual review retains image/table markup and flags text or formatting changes without presenting source',()=>{const dom=new JSDOM(),parser=dom.window.DOMParser;const a='<p>A</p><table><tr><td>25 °C</td></tr></table><p><img src="workitemimg:1.png"></p>',b=a.replace('25 °C','26 °C');const r=reviewDocument(a,b,parser);assert.equal(r.removed,1);assert.equal(r.added,1);assert.match(r.before,/<table>/);assert.match(new parser().parseFromString(r.after,'text/html').body.textContent!,/26 °C/);assert.match(r.after,/<img src="workitemimg:1.png">/);assert.equal(reviewDocument(a,a,parser).unchanged,true);assert.equal(reviewDocument('<p>A</p>','<p style="color:red">A</p>',parser).added,1);dom.window.close();});
