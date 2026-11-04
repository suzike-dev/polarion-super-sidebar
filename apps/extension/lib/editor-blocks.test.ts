import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {RichDocument} from '../../../packages/core/rich-document.ts';
import {richSchema} from '../../../packages/core/rich-schema.ts';
import {blockTransaction} from './editor-blocks.ts';
test('moving preserves source identities; duplicating clears identities and protected objects cannot be copied',()=>{
 const model=new RichDocument('<p id="first">A</p><p id="second">B</p>'),doc=richSchema.nodeFromJSON(model.document),state=EditorState.create({doc,selection:TextSelection.create(doc,1)});
 const moved=blockTransaction(state,'down')!;assert.equal(model.serialize(moved.doc.toJSON()),'<p id="second">B</p><p id="first">A</p>');
 const copied=blockTransaction(state,'duplicate')!;const html=model.serialize(copied.doc.toJSON());assert.equal((html.match(/id="first"/g)||[]).length,1);assert.equal(copied.doc.textContent,'AAB');
 const protectedModel=new RichDocument('<div><p>A</p><div id="polarion_wiki macro name=include;params=x">locked</div></div>');const protectedDoc=richSchema.nodeFromJSON(protectedModel.document),locked=EditorState.create({doc:protectedDoc,selection:TextSelection.create(protectedDoc,5)});assert.equal(blockTransaction(locked,'duplicate'),null);
});
