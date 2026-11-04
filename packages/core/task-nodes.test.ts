import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RichDocument} from './rich-document.ts';
test('task state round trips as passive native HTML with exact no-op preservation',()=>{
 const model=new RichDocument('<p>start</p>'),doc=structuredClone(model.document);
 doc.content!.push({type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Verify HVAC'}]}]}]});
 const html=model.serialize(doc);assert.match(html,/☐/);assert.doesNotMatch(html,/<input|onclick|<button/);
 const read=new RichDocument(html);assert.equal(read.serialize(read.document),html);const changed=structuredClone(read.document);changed.content![1]!.content![0]!.attrs!.checked=true;
 const checked=read.serialize(changed);assert.match(checked,/☑/);assert.match(checked,/data-checked="true"/);assert.equal(new RichDocument(checked).document.content![1]!.content![0]!.attrs!.checked,true);
});
