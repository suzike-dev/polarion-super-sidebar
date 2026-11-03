import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {Fragment,Slice} from '@tiptap/pm/model';
import {richSchema} from './rich-schema.ts';
import {pasteRichSlice} from './rich-paste.ts';
test('mixed block paste at a heading start preserves heading levels without empty blocks',()=>{
  const heading=richSchema.node('heading',{level:1},richSchema.text('Existing requirement'));
  const doc=richSchema.node('doc',null,[heading]);const state=EditorState.create({doc,selection:TextSelection.create(doc,1)});
  const h2=richSchema.node('heading',{level:2},richSchema.text('Pasted heading')),p=richSchema.node('paragraph',null,richSchema.text('26.5 °C'));
  const tr=pasteRichSlice(state,new Slice(Fragment.fromArray([h2,p]),1,1));tr.doc.check();
  assert.equal(tr.doc.childCount,3);assert.equal(tr.doc.child(0).attrs.level,2);assert.equal(tr.doc.child(2).attrs.level,1);assert.equal(tr.doc.child(2).textContent,'Existing requirement');assert.ok(tr.doc.child(2).eq(heading));
});
test('inline paste inside text preserves the prefix and suffix',()=>{
  const doc=richSchema.node('doc',null,[richSchema.node('paragraph',null,richSchema.text('AB'))]);const state=EditorState.create({doc,selection:TextSelection.create(doc,2)});
  const tr=pasteRichSlice(state,new Slice(Fragment.from(richSchema.text('25 °C')),0,0));assert.equal(tr.doc.textContent,'A25 °CB');assert.equal(tr.doc.childCount,1);
});
