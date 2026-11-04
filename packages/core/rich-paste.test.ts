import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {DOMParser,Fragment,Slice} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {history,undo} from '@tiptap/pm/history';
import {JSDOM} from 'jsdom';
import {richSchema} from './rich-schema.ts';
import {pasteRichSlice,pasteRichContent} from './rich-paste.ts';
test('mixed block paste at a heading start preserves heading levels without empty blocks',()=>{
  const heading=richSchema.node('heading',{level:1},richSchema.text('Existing requirement'));
  const doc=richSchema.node('doc',null,[heading]);const state=EditorState.create({doc,selection:TextSelection.create(doc,1)});
  const h2=richSchema.node('heading',{level:2},richSchema.text('Pasted heading')),p=richSchema.node('paragraph',null,richSchema.text('26.5 °C'));
  const tr=pasteRichSlice(state,new Slice(Fragment.fromArray([h2,p]),1,1));tr.doc.check();
  assert.equal(tr.doc.childCount,3);assert.equal(tr.doc.child(0).attrs.level,2);assert.equal(tr.doc.child(2).attrs.level,1);assert.equal(tr.doc.child(2).textContent,'Existing requirement');assert.ok(tr.doc.child(2).eq(heading));
});
const browserDocument=new JSDOM('').window.document;
function parse(html:string){const div=browserDocument.createElement('div');div.innerHTML=html;return DOMParser.fromSchema(richSchema).parse(div);}
function clipboard(html:string){const div=browserDocument.createElement('div');div.innerHTML=html;return DOMParser.fromSchema(richSchema).parseSlice(div);}
function paste(state:EditorState,html:string){const view={state,dispatch:(tr:any)=>{view.state=view.state.apply(tr);}};pasteRichContent(view as EditorView,{} as ClipboardEvent,clipboard(html));return view.state;}
test('mixed image matrix overwrites cells without appending old text or extra columns',()=>{
  const doc=parse('<table><tr><td><p>old1</p></td><td><p>old2</p></td></tr></table>');
  const state=EditorState.create({doc,selection:TextSelection.create(doc,4),plugins:[history()]});
  const next=paste(state,'<table><tr><td><p>new<img src="polarion-asset:00000000-0000-0000-0000-000000000000" data-polarion-asset="00000000-0000-0000-0000-000000000000"></p></td><td><p>new2</p></td></tr></table>');
  next.doc.check();const table=next.doc.firstChild!;assert.equal(TableMap.get(table).width,2);assert.equal(TableMap.get(table).height,1);assert.equal(table.textContent,'newnew2');assert.equal(table.firstChild!.firstChild!.firstChild!.lastChild!.type.name,'image');assert.equal(state.doc.textContent,'old1old2');
  let restored=next;assert.ok(undo(next,tr=>{restored=next.apply(tr);}));assert.ok(restored.doc.eq(doc));
});
test('matrix expands a small target and fills a selected cell rectangle using table rules',()=>{
  const doc=parse('<table><tr><td><p>old</p></td></tr></table>');const state=EditorState.create({doc,selection:TextSelection.create(doc,4)});
  const next=paste(state,'<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
  const table=next.doc.firstChild!,map=TableMap.get(table);assert.equal(map.width,2);assert.equal(map.height,2);assert.equal(table.textContent,'ABCD');
  const selected=next.apply(next.tr.setSelection(CellSelection.create(next.doc,1+map.map[0]!,1+map.map[3]!)));
  const filled=paste(selected,'<p>X</p>');assert.equal(filled.doc.textContent,'XXXX');assert.equal(TableMap.get(filled.doc.firstChild!).width,2);
});
test('inline paste inside text preserves the prefix and suffix',()=>{
  const doc=richSchema.node('doc',null,[richSchema.node('paragraph',null,richSchema.text('AB'))]);const state=EditorState.create({doc,selection:TextSelection.create(doc,2)});
  const tr=pasteRichSlice(state,new Slice(Fragment.from(richSchema.text('25 °C')),0,0));assert.equal(tr.doc.textContent,'A25 °CB');assert.equal(tr.doc.childCount,1);
});
