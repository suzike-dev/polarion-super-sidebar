import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './store.ts';
import {Assets} from './assets.ts';
import {Boards} from './boards.ts';
import {Drafts} from './polarion.ts';
import {createBoardTools} from './board-tools.ts';
import {DIAGRAM_DESIGN_COMMIT} from './diagram-design.ts';

test('requirements can request a diagram directly; actual pinned design rules are read before a review-only proposal',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'requirement-diagram-')),store=new Store(':memory:');
 const target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/isolated'},drafts=new Drafts(store,{read:async()=>({id:'T-1',description:'<p>Need a diagram</p>',title:'Fixture',updated:'1'}),save:async()=>{throw Error('Remote writes forbidden');}}),assets=new Assets(store,dir);
 try{
  const draft=await drafts.open(target,'T-1'),session=store.createSession(target,'diagram'),run=store.startRun(session.id,crypto.randomUUID(),'Generate a requirements diagram',[]).run;
  const tools=createBoardTools(()=>({run,controller:new AbortController(),store,drafts,assets}));
  const call=async(name:string,args:unknown)=>{const tool=tools.find(t=>t.name===name)!;const out=await (tool.handler as any)(args,{});return JSON.parse(out.content[0].text);};
  const read=await call('read_requirement_diagram_context',{draftId:draft.id});
  assert.equal(read.request.originRunId,run.id);assert.match(read.diagramDesign.skill,/Mandatory connector rules/);assert.equal(store.get<any>('diagram-design-read',run.id).commit,DIAGRAM_DESIGN_COMMIT);
  const before=JSON.stringify(drafts.read(draft.id));
  const proposed=await call('propose_board_generation',{draftId:draft.id,readId:read.id,diagram:{title:'Direct diagram',summary:'Review before inserting',nodes:[{id:'start',kind:'ellipse',text:'Start'},{id:'work',kind:'rectangle',text:'Prepare requirements'}],edges:[{id:'go',from:'start',to:'work'}]}});
  assert.equal(proposed.status,'pending');assert.equal(JSON.stringify(drafts.read(draft.id)),before);assert.equal(store.list('asset').length,0);
  const event=store.events(session.id,0).find(e=>e.kind==='board-generation-proposal');assert.equal((event?.data as any).entry,'requirements');
  const otherRun={...run,id:crypto.randomUUID()};
  assert.throws(()=>new Boards(store,assets).readGenerationForRun(otherRun,draft,read.request.requestId),/CONTEXT_REQUIRED/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
