import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {rememberSave,consumeSave} from './save-continuation.ts';
const target={origin:'https://polarion.pufafen.com' as const,projectId:'TEST',document:'Design/Test'};
test('save UI recovery is tab-local, target-bound, bounded and consumed once',()=>{
  const storage=new JSDOM('',{url:target.origin}).window.sessionStorage;
  const saved={target,draftId:'draft',workItemId:'TEST-1',at:1000,scrollTop:900,editorScrollTop:200};
  rememberSave(storage,saved);assert.deepEqual(consumeSave(storage,target,1100),saved);assert.equal(consumeSave(storage,target,1100),null);
  rememberSave(storage,saved);assert.equal(consumeSave(storage,{...target,projectId:'OTHER'},1100),null);
  rememberSave(storage,saved);assert.equal(consumeSave(storage,target,122000),null);
  rememberSave(storage,{...saved,scrollTop:-1});assert.equal(consumeSave(storage,target,1100),null);
});
