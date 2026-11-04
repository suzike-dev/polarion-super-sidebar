import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Boards} from './boards.ts';
import {createBoardTools} from './board-tools.ts';
import {Store} from './store.ts';
import {Assets} from './assets.ts';
import {Service} from './service.ts';
import {Drafts} from './polarion.ts';
import {validateBoardSource} from '../../packages/core/board-contract.ts';
import type {Draft,Run} from '../../packages/protocol/index.ts';
const target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/fixture'};
const source=JSON.stringify({type:'excalidraw',version:2,elements:[{id:'a',type:'rectangle',x:0,y:0,width:100,height:60}],files:{}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6s8AAAAASUVORK5CYII=','base64');
const generationDiagram={title:'草案流程',summary:'根据描述建立开始、判断和处理节点。',nodes:[{id:'start',kind:'ellipse',text:'开始'},{id:'check',kind:'diamond',text:'条件满足？'},{id:'end',text:'执行处理'},{id:'wait',text:'等待'}],edges:[{id:'a',from:'start',to:'check'},{id:'b',from:'check',to:'end',label:'满足'},{id:'c',from:'check',to:'wait',label:'不满足'}]};
async function generationFixture(check:(fixture:{boards:Boards;store:Store;draft:Draft;run:Run;request:ReturnType<Boards['beginGeneration']>;signature:string})=>void|Promise<void>){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-board-generation-')),store=new Store(':memory:');
 try{const boards=new Boards(store,new Assets(store,dir)),draft:Draft={id:crypto.randomUUID(),target,workItemId:'T-1',title:'blank',html:'<p></p>',baseHtml:'<p></p>',baseUpdated:'1',revision:0,state:'clean'},signature='a'.repeat(64),request=boards.beginGeneration(draft,crypto.randomUUID(),signature);
  const run:Run={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),requestId:crypto.randomUUID(),target,prompt:'画一个开始→判断→处理的流程',contexts:[{id:crypto.randomUUID(),target,workItemId:'T-1',text:'BOARD_GENERATION_CONTEXT\n'+JSON.stringify({draftId:draft.id,requestId:request.requestId,localBoardId:request.localBoardId,baselineSignature:signature}),prefix:'',suffix:'',source:'editor',capturedAt:Date.now(),pinned:false}],status:'running',startedAt:Date.now()};
  store.put('draft',draft.id,draft);store.put('run',run.id,run);await check({boards,store,draft,run,request,signature});
 }finally{store.close();for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
}
test('new-board generation uses real SDK tools and only creates a user-reviewable editable proposal',async()=>generationFixture(async({boards,store,draft,run,request,signature})=>{
 const controller=new AbortController(),sdkTools=createBoardTools(()=>({run,controller,store,assets:boards.assets,drafts:{read:()=>draft} as any}));
 const readTool=sdkTools.find(t=>t.name==='read_board_generation_context')!,proposeTool=sdkTools.find(t=>t.name==='propose_board_generation')!;
 const response=await readTool.handler({draftId:draft.id,requestId:request.requestId} as any,{}),read=JSON.parse((response.content[0] as any).text);
 const proposed=await proposeTool.handler({draftId:draft.id,readId:read.id,diagram:generationDiagram} as any,{}),receipt=JSON.parse((proposed.content[0] as any).text);
 assert.equal(receipt.status,'pending');const [p]=boards.generationProposals(draft,request.requestId);assert.ok(p);assert.ok(p.elements.some(e=>e.type==='diamond'));assert.equal(p.runId,run.id);assert.equal(p.draftId,draft.id);assert.equal(p.baselineSignature,signature);
 assert.deepEqual(store.require('draft',draft.id),draft);assert.equal(store.list('board').length,0);assert.equal(store.list('asset').length,0);
 assert.equal(boards.decideGeneration(draft,p.proposalId,'apply',signature).status,'applied');assert.deepEqual(store.require('draft',draft.id),draft);assert.equal(store.list('asset').length,0);assert.equal(boards.generationProposals(draft,request.requestId).length,0);
 controller.abort();await assert.rejects(readTool.handler({draftId:draft.id,requestId:request.requestId} as any,{}),/RUN_CANCELLED/);
}));
test('generation enforces current run context, draft identity, target, revision and manual-edit signature',async()=>generationFixture(({boards,draft,run,request,signature})=>{
 assert.throws(()=>boards.readGenerationForRun({...run,contexts:[]},draft,request.requestId),/CONTEXT_REQUIRED/);
 assert.throws(()=>boards.readGenerationForRun({...run,target:{...target,document:'foreign'}},draft,request.requestId),/TARGET_MISMATCH/);
 assert.throws(()=>boards.readGenerationForRun(run,{...draft,workItemId:'T-2'},request.requestId),/TARGET_MISMATCH/);
 assert.throws(()=>boards.readGenerationForRun(run,{...draft,id:crypto.randomUUID()},request.requestId),/TARGET_MISMATCH/);
 const read=boards.readGenerationForRun(run,draft,request.requestId);
 assert.throws(()=>boards.proposeGeneration({...run,id:crypto.randomUUID()},draft,read.id,generationDiagram),/TARGET_MISMATCH/);
 assert.throws(()=>boards.proposeGeneration(run,{...draft,revision:1},read.id,generationDiagram),/BASELINE_CONFLICT/);
 const p=boards.proposeGeneration(run,draft,read.id,generationDiagram);
 assert.throws(()=>boards.decideGeneration(draft,p.proposalId,'apply','b'.repeat(64)),/BASELINE_CONFLICT/);
 assert.throws(()=>boards.decideGeneration({...draft,revision:1},p.proposalId,'apply',signature),/BASELINE_CONFLICT/);
 assert.equal(boards.generationProposals(draft,request.requestId)[0]!.status,'pending');
 assert.equal(boards.decideGeneration(draft,p.proposalId,'reject','b'.repeat(64)).status,'rejected');assert.equal(boards.generationProposals(draft,request.requestId).length,0);
}));
test('generation supersession, stale requests, proposal limits and payload integrity are enforced',async()=>generationFixture(({boards,store,draft,run,request,signature})=>{
 const read=boards.readGenerationForRun(run,draft,request.requestId),p=boards.proposeGeneration(run,draft,read.id,generationDiagram);
 store.put('board-generation-proposal',p.proposalId,{...p,elements:[...p.elements,{id:'injected',type:'image',x:0,y:0,width:1,height:1}]});
 assert.throws(()=>boards.decideGeneration(draft,p.proposalId,'apply',signature),/CONTENT_MISMATCH/);
 for(let i=1;i<5;i++)boards.proposeGeneration(run,draft,read.id,generationDiagram);
 assert.throws(()=>boards.proposeGeneration(run,draft,read.id,generationDiagram),/PROPOSAL_LIMIT/);
 const next=boards.beginGeneration(draft,request.localBoardId,'b'.repeat(64));assert.notEqual(next.requestId,request.requestId);assert.equal(boards.generationProposals(draft,request.requestId).length,0);
 assert.throws(()=>boards.proposeGeneration(run,draft,read.id,generationDiagram),/GENERATION_EXPIRED/);assert.throws(()=>boards.decideGeneration(draft,p.proposalId,'apply',signature),/GENERATION_EXPIRED/);
 assert.equal(boards.decideGeneration(draft,p.proposalId,'reject',signature).status,'rejected');
 assert.throws(()=>boards.beginGeneration({...draft,id:crypto.randomUUID()},request.localBoardId,signature),/TARGET_MISMATCH/);
 assert.throws(()=>boards.beginGeneration({...draft,state:'uncertain'},crypto.randomUUID(),signature),/DRAFT_UNAVAILABLE/);
}));
test('an open editor can reopen its saved board by local asset alias without losing ownership checks',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-board-reopen-')),store=new Store(':memory:');
 const drafts=new Drafts(store,{read:async()=>({id:'T-1',title:'board',description:'<p></p>',updated:'1'}),save:async()=>{throw Error('unused');}}),service=new Service(store,drafts);
 try{
  const assets=new Assets(store,dir),boards=new Boards(store,assets);service.assets=assets;
  const s=boards.putBytes(target,'source.json','application/json',Buffer.from(source)),p=boards.putBytes(target,'preview.png','image/png',png),record=boards.create(target,'T-1','控制流程',s.id,p.id),draft=await drafts.open(target,'T-1');
  const html='<p><img src="workitemimg:9-'+record.manifest.preview.name+'"/></p>';
  store.put('draft',draft.id,{...draft,html,baseHtml:html,state:'clean'});
  const open=()=>service.request({protocol:1,id:crypto.randomUUID(),command:{method:'boards.open',draftId:draft.id,src:'polarion-asset:'+p.id}});
  const result=await open();assert.equal(result.ok,true);if(result.ok)assert.equal((result.value as any).manifest.snapshotId,record.manifest.snapshotId);
  store.put('draft',draft.id,{...draft,html,workItemId:'T-2'});const foreign=await open();assert.equal(foreign.ok,false);if(!foreign.ok)assert.match(foreign.error,/BOARD_TARGET_MISMATCH/);
  store.put('draft',draft.id,{...draft,html:'<p>removed</p>'});const removed=await open();assert.equal(removed.ok,false);if(!removed.ok)assert.match(removed.error,/BOARD_REFERENCE_MISSING/);
 }finally{service.engines.close();store.close();for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
test('board immutable source-preview-manifest survives a fresh local store, detects tampering and enforces owner',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-board-')),store=new Store(':memory:'),fresh=new Store(':memory:');
 try{const assets=new Assets(store,path.join(dir,'a')),boards=new Boards(store,assets),s=boards.putBytes(target,'source.json','application/json',Buffer.from(source)),p=boards.putBytes(target,'preview.png','image/png',png),r=boards.create(target,'T-1','控制流程',s.id,p.id);
  assert.throws(()=>boards.create(target,'T-1','duplicate',s.id,p.id),/ALREADY_BOUND/);assert.equal(boards.bundle(p.id,target,'T-1')!.length,3);assert.throws(()=>boards.bundle(p.id,target,'T-2'),/TARGET_MISMATCH/);
  const other=new Boards(fresh,new Assets(fresh,path.join(dir,'b'))),packet={manifest:r.manifest,source:Buffer.from(source).toString('base64'),preview:png.toString('base64')},restored=other.import(target,'T-1',packet);
  assert.equal(other.assets.bytes(restored.sourceId).toString(),source);assert.deepEqual(other.assets.bytes(restored.previewId),png);assert.equal(other.import(target,'T-1',packet).sourceId,restored.sourceId);
  assert.throws(()=>other.import(target,'T-1',{...packet,source:Buffer.from(source+' ').toString('base64')}),/HASH_MISMATCH/);
  assert.throws(()=>other.import(target,'T-2',packet),/TARGET_MISMATCH/);
  const p2=boards.putBytes(target,'new.png','image/png',png),next=boards.create(target,'T-1','第二版',s.id,p2.id,r.manifest.snapshotId);assert.equal(next.manifest.objectId,r.manifest.objectId);assert.notEqual(next.manifest.snapshotId,r.manifest.snapshotId);assert.equal(boards.byPreview(p.id)!.manifest.title,'控制流程');
 }finally{store.close();fresh.close();for(const folder of ['a','b']){const absolute=path.join(dir,folder);if(fs.existsSync(absolute)){for(const file of fs.readdirSync(absolute))fs.unlinkSync(path.join(absolute,file));fs.rmdirSync(absolute);}}fs.rmdirSync(dir);}
});
test('board source rejects duplicate identities and remote image dependencies',()=>{
 const value=JSON.parse(source);value.elements.push(value.elements[0]);assert.throws(()=>validateBoardSource(JSON.stringify(value)),/INVALID_BOARD_SOURCE/);
 value.elements.pop();value.files={image:{dataURL:'https://example.com/tracking.png'}};assert.throws(()=>validateBoardSource(JSON.stringify(value)),/BOARD_IMAGE_IMPORT_REQUIRED/);
});

test('board proposals are bound to run, target, draft revision, snapshot and source hash; rejection is non-mutating',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-board-proposal-')),store=new Store(':memory:');
 try{
  const boards=new Boards(store,new Assets(store,dir)),s=boards.putBytes(target,'source.json','application/json',Buffer.from(source)),p=boards.putBytes(target,'preview.png','image/png',png),r=boards.create(target,'T-1','控制流程',s.id,p.id);
  const draft={id:crypto.randomUUID(),target,workItemId:'T-1',html:'<p><img src="polarion-asset:'+p.id+'"></p>',revision:3} as any;
  const run={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),target} as any;store.put('run',run.id,run);
  const read=boards.readForRun(run,draft,r.manifest.objectId,r.manifest.snapshotId,['a']);
  assert.equal(read.sourceHash,r.manifest.source.sha256);
  assert.throws(()=>boards.readForRun({...run,target:{...target,document:'other'}},draft,r.manifest.objectId,r.manifest.snapshotId,['a']),/TARGET_MISMATCH/);
  assert.throws(()=>boards.readForRun(run,{...draft,html:'no image '+p.id},r.manifest.objectId,r.manifest.snapshotId,['a']),/REFERENCE_MISSING/);
  assert.throws(()=>boards.propose({...run,id:crypto.randomUUID()},draft,read.id,'test',[{id:'a',x:20}]),/TARGET_MISMATCH/);
  assert.throws(()=>boards.propose(run,{...draft,revision:4},read.id,'test',[{id:'a',x:20}]),/BASELINE_CONFLICT/);
  assert.throws(()=>boards.propose(run,draft,read.id,'test',[{id:'unknown',x:20}]),/OUTSIDE_SELECTION/);
  const proposal=boards.propose(run,draft,read.id,'向右移动',[{id:'a',x:20}]);assert.equal(boards.proposals(draft,r.manifest.objectId,r.manifest.snapshotId).length,1);
  assert.throws(()=>boards.decide({...draft,revision:4},proposal.proposalId,'apply'),/BASELINE_CONFLICT/);
  assert.equal(boards.decide(draft,proposal.proposalId,'reject').status,'rejected');assert.equal(boards.assets.bytes(s.id).toString(),source);
  const applied=boards.propose(run,draft,read.id,'修改颜色',[{id:'a',strokeColor:'#ff0000'}]);assert.equal(boards.decide(draft,applied.proposalId,'apply').status,'applied');assert.throws(()=>boards.decide(draft,applied.proposalId,'apply'),/EXPIRED/);
  let currentRun=run;
  const sdkTools=createBoardTools(()=>({run:currentRun,controller:new AbortController(),store,assets:boards.assets,drafts:{read:()=>draft} as any}));
  const readTool=sdkTools.find(t=>t.name==='read_board')!;
  const args={draftId:draft.id,objectId:r.manifest.objectId,snapshotId:r.manifest.snapshotId,selectedIds:['a']};
  const first=await readTool.handler(args as any,{});
  assert.equal(JSON.parse((first.content[0] as any).text).runId,run.id);
  currentRun={...run,id:crypto.randomUUID()};
  const second=await readTool.handler(args as any,{});
  assert.equal(JSON.parse((second.content[0] as any).text).runId,currentRun.id);
  currentRun={...run,target:{...target,document:'wrong-document'}};
  await assert.rejects(readTool.handler(args as any,{}),/TARGET_MISMATCH/);
  const tampered={...r,manifest:{...r.manifest,source:{...r.manifest.source,sha256:'0'.repeat(64)}}};store.put('board',r.manifest.snapshotId,tampered);assert.throws(()=>boards.readForRun(run,draft,r.manifest.objectId,r.manifest.snapshotId,['a']),/HASH_MISMATCH/);
 }finally{store.close();for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);}
});
