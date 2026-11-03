import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RichDocument} from './rich-document.ts';
import {formatDocument} from './format-document.ts';
test('formatting targets unique cross-mark selection and retains source tables, images and macros',()=>{
 const source='<p><span style="color:red">前缀 Hello </span><b>world</b> 后缀</p><table id="t"><tr><td>不变</td></tr></table><p><img src="x.png"><span id="polarion_wiki macro name=x">macro</span></p>';
 const d=new RichDocument(source),result=formatDocument(d.document,{color:'#000000'},'Hello world'),html=d.serialize(result.document);
 assert.equal(result.characters,11);assert.ok(html.includes('<table id="t"><tr><td>不变</td></tr></table>'));assert.ok(html.includes('<img src="x.png">'));assert.ok(html.includes('color:#000000'));assert.ok(html.includes(' 后缀'));
 assert.throws(()=>formatDocument(new RichDocument('<p>同文</p><p>同文</p>').document,{bold:true},'同文'),/AMBIGUOUS_SELECTION/);
 assert.throws(()=>formatDocument(d.document,{bold:true},'不存在'),/SELECTION_NOT_FOUND/);
});
test('full-document paint remains valid across malformed native lists',()=>{
 const d=new RichDocument('<ol><li><span style="color:red">A</span></li><ol><li>B</li></ol></ol>');const r=formatDocument(d.document,{color:'#000000'});assert.equal(r.characters,2);const html=d.serialize(r.document);assert.equal((html.match(/color:#000000/g)??[]).length,2);assert.ok(html.includes('<ol><li>B')===false);assert.ok(html.endsWith('</ol></ol>'));
});
