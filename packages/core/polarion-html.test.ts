import {test} from 'node:test';
import assert from 'node:assert/strict';
import {polarionWriteHtml} from './polarion-html.ts';
import {RichDocument} from './rich-document.ts';
test('native container retains mixed content exactly and remains editable without nesting wrappers',()=>{
 const html='<h2>阈值 26.5 °C</h2><p style="background-color:#fef3c7">保持 3.75 s<img src="workitemimg:fixture.png" width="240"></p><table><tr><td><p>15 s</p></td></tr></table>';
 const wrapped=polarionWriteHtml(html);assert.equal(wrapped,'<div data-polarion-sidebar-document="1">'+html+'</div>');assert.equal(polarionWriteHtml(wrapped),wrapped);
 const rich=new RichDocument(wrapped);assert.equal(rich.serialize(rich.document),wrapped);
 const edit=structuredClone(rich.document);const heading=edit.content![0]!.content![0]!;assert.equal(heading.type,'heading');heading.content![0]!.text='阈值 27 °C';const changed=rich.serialize(edit);assert.match(changed,/阈值 27/);assert.match(changed,/background-color:#fef3c7/);assert.match(changed,/workitemimg:fixture.png/);
 assert.equal(polarionWriteHtml('<h2>文字</h2><p>表述</p>'),'<h2>文字</h2><p>表述</p>');assert.equal(polarionWriteHtml(' <div class="native"><p><img src="x"></p></div> '),' <div class="native"><p><img src="x"></p></div> ');
});
