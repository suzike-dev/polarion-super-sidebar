import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Boards} from './boards.ts';
import {createBoardTools} from './board-tools.ts';
import {Store} from './store.ts';
import {Assets} from './assets.ts';
import {validateBoardSource} from '../../packages/core/board-contract.ts';
const target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/fixture'};
const source=JSON.stringify({type:'excalidraw',version:2,elements:[{id:'a',type:'rectangle',x:0,y:0,width:100,height:60}],files:{}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6s8AAAAASUVORK5CYII=','base64');
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
