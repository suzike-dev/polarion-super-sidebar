import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {history,undo} from '@tiptap/pm/history';
import {richSchema} from '../../../packages/core/rich-schema.ts';
import {RichDocument} from '../../../packages/core/rich-document.ts';
import {clearFormattingTransaction} from './editor-format.ts';

test('clear formatting undoes to the exact original nested source style order across paragraphs',()=>{
  const html='<p><span style="font-size:13.5pt"><span style="font-size:14pt">Alpha</span></span></p><p><strong>Beta</strong></p>';
  const source=new RichDocument(html),doc=richSchema.nodeFromJSON(source.document);
  let state=EditorState.create({doc,plugins:[history()],selection:TextSelection.create(doc,1,doc.content.size-1)});
  const before=state.doc.toJSON();state=state.apply(clearFormattingTransaction(state));
  assert.notDeepEqual(state.doc.toJSON(),before);assert.equal(state.doc.textContent,'AlphaBeta');
  assert(undo(state,tr=>{state=state.apply(tr);}));assert.deepEqual(state.doc.toJSON(),before);assert.equal(source.serialize(state.doc.toJSON()),html);
});
