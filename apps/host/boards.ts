import {parseFragment} from 'parse5';
import {applyBoardPatches,boardSceneSignature,type BoardPatch} from '../../packages/core/board-changes.ts';
import {generateBoardDiagram,type BoardDiagram} from '../../packages/core/board-generation.ts';
import type {Draft,Run} from '../../packages/protocol/index.ts';
import {createHash} from 'node:crypto';
import {Assets} from './assets.ts';
import {Store} from './store.ts';
import {sameTarget,type Target} from '../../packages/protocol/index.ts';
import {boardFileNames,BoardManifestSchema,validateBoardSource,type BoardManifest} from '../../packages/core/board-contract.ts';
export type BoardRecord={manifest:BoardManifest;sourceId:string;previewId:string;manifestId:string};
export type BoardRead={id:string;runId:string;draftId:string;revision:number;objectId:string;snapshotId:string;sourceHash:string;selectedIds:string[]};
export type BoardProposal=BoardRead&{proposalId:string;title:string;patches:BoardPatch[];summary:ReturnType<typeof applyBoardPatches>['summary'];status:'pending'|'applied'|'rejected';createdAt:number};
export type BoardGenerationRequest={requestId:string;localBoardId:string;draftId:string;target:Target;workItemId:string;revision:number;baselineSignature:string;createdAt:number;status:'active'|'superseded'|'applied';originRunId?:string};
export type BoardGenerationRead={id:string;requestId:string;runId:string;draftId:string;revision:number};
export type BoardGenerationProposal={proposalId:string;requestId:string;localBoardId:string;runId:string;draftId:string;target:Target;workItemId:string;revision:number;baselineSignature:string;diagram:BoardDiagram;elements:ReturnType<typeof generateBoardDiagram>['elements'];summary:ReturnType<typeof generateBoardDiagram>['summary'];status:'pending'|'applied'|'rejected';createdAt:number};
export const hashBytes=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export class Boards{
  readonly store:Store;readonly assets:Assets;
  constructor(store:Store,assets:Assets){this.store=store;this.assets=assets;}
  putBytes(target:Target,name:string,mime:string,bytes:Buffer){const a=this.assets.begin(target,name,mime,bytes.length);for(let i=0;i<bytes.length;i+=384*1024)this.assets.chunk(a.id,i,bytes.subarray(i,i+384*1024).toString('base64'));return this.assets.finish(a.id);}
  create(target:Target,workItemId:string,title:string,sourceId:string,previewId:string,parentSnapshotId?:string){
    const source=this.assets.require(sourceId,target),preview=this.assets.require(previewId,target);
    validateBoardSource(this.assets.bytes(sourceId).toString('utf8'));if(preview.mime!=='image/png')throw Error('BOARD_PNG_REQUIRED');
    // A source/preview pair belongs to one immutable snapshot. Reusing it under another title/version is ambiguous.
    if(this.byPreview(previewId))throw Error('BOARD_PREVIEW_ALREADY_BOUND');
    const previous=parentSnapshotId?this.store.require<BoardRecord>('board',parentSnapshotId):undefined;
    if(previous&&(!sameTarget(previous.manifest.target,target)||previous.manifest.workItemId!==workItemId))throw Error('BOARD_TARGET_MISMATCH');
    const snapshotId=crypto.randomUUID(),names=boardFileNames(snapshotId);
    const manifest=BoardManifestSchema.parse({format:'polarion-sidebar-object',version:1,kind:'whiteboard',editor:'excalidraw',objectId:previous?.manifest.objectId??crypto.randomUUID(),snapshotId,parentSnapshotId,title,target,workItemId,createdAt:Date.now(),source:{name:names.source,sha256:source.sha256,size:source.size},preview:{name:names.preview,sha256:preview.sha256,size:preview.size}});
    const a=this.putBytes(target,names.manifest,'application/json',Buffer.from(JSON.stringify(manifest)));
    const record={manifest,sourceId,previewId,manifestId:a.id};this.store.put('board',snapshotId,record);return record;
  }
  /** 复制画板快照到另一个工作项：保留 objectId（同一逻辑画板），生成新 snapshotId 并绑定目标工作项。 */
  copy(record:BoardRecord,target:Target,workItemId:string){
    const sourceBytes=this.assets.bytes(record.sourceId),previewBytes=this.assets.bytes(record.previewId);
    validateBoardSource(sourceBytes.toString('utf8'));
    const snapshotId=crypto.randomUUID(),names=boardFileNames(snapshotId);
    const source=this.putBytes(target,record.manifest.source.name,'application/json',sourceBytes);
    const preview=this.putBytes(target,record.manifest.preview.name,'image/png',previewBytes);
    if(preview.mime!=='image/png')throw Error('BOARD_PNG_REQUIRED');
    const manifest=BoardManifestSchema.parse({...record.manifest,snapshotId,parentSnapshotId:record.manifest.snapshotId,workItemId,target,createdAt:Date.now(),source:{name:names.source,sha256:record.manifest.source.sha256,size:record.manifest.source.size},preview:{name:names.preview,sha256:record.manifest.preview.sha256,size:record.manifest.preview.size}});
    const manifestAsset=this.putBytes(target,names.manifest,'application/json',Buffer.from(JSON.stringify(manifest)));
    const copied={manifest,sourceId:source.id,previewId:preview.id,manifestId:manifestAsset.id};
    this.store.put('board',snapshotId,copied);return copied;
  }
  owned(draft:Draft,objectId:string,snapshotId:string){
    const r=this.store.require<BoardRecord>('board',snapshotId),m=r.manifest;
    if(!sameTarget(draft.target,m.target)||draft.workItemId!==m.workItemId||m.objectId!==objectId)throw Error('BOARD_TARGET_MISMATCH');
    const srcs:string[]=[];const visit=(n:any)=>{if(n.tagName==='img'){const src=n.attrs?.find((a:any)=>a.name==='src')?.value;if(src)srcs.push(src);}for(const child of n.childNodes??[])visit(child);};visit(parseFragment(draft.html));
    if(!srcs.some(src=>src==='polarion-asset:'+r.previewId||src.includes(boardFileNames(snapshotId).preview)))throw Error('BOARD_REFERENCE_MISSING: 请先将画板插入当前正文草稿');
    if(hashBytes(this.assets.bytes(r.sourceId))!==m.source.sha256)throw Error('BOARD_HASH_MISMATCH');
    return r;
  }
  readForRun(run:Run,draft:Draft,objectId:string,snapshotId:string,selectedIds:string[]){
    if(!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    const record=this.owned(draft,objectId,snapshotId),source=validateBoardSource(this.assets.bytes(record.sourceId).toString('utf8'));
    const selected=new Set(selectedIds);if(!selected.size||selectedIds.some(id=>!source.elements.some((e:any)=>e.id===id&&!e.isDeleted)))throw Error('BOARD_SELECTION_REQUIRED');
    const elements=source.elements.filter((e:any)=>selected.has(e.id)||selected.has(e.containerId)||selected.has(e.startBinding?.elementId)||selected.has(e.endBinding?.elementId));
    const read:BoardRead={id:crypto.randomUUID(),runId:run.id,draftId:draft.id,revision:draft.revision,objectId,snapshotId,sourceHash:record.manifest.source.sha256,selectedIds:elements.map((e:any)=>e.id)};
    this.store.put('board-read',read.id,read);return {...read,elements,limits:'Only existing selected objects: text, position, size and colors. No deletion. Unrotated ungrouped nodes and plain two-point arrows only for geometry. Proposals require user application.'};
  }
  propose(run:Run,draft:Draft,readId:string,title:string,patches:BoardPatch[]){
    const read=this.store.require<BoardRead>('board-read',readId);
    if(read.runId!==run.id||read.draftId!==draft.id||!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    const record=this.owned(draft,read.objectId,read.snapshotId);
    if(draft.revision!==read.revision||record.manifest.source.sha256!==read.sourceHash)throw Error('BOARD_BASELINE_CONFLICT');
    if(patches.some(p=>!read.selectedIds.includes(p.id)))throw Error('BOARD_PATCH_OUTSIDE_SELECTION');
    const source=validateBoardSource(this.assets.bytes(record.sourceId).toString('utf8')),result=applyBoardPatches(source.elements,patches);
    const proposal:BoardProposal={...read,proposalId:crypto.randomUUID(),title,patches,summary:result.summary,status:'pending',createdAt:Date.now()};
    this.store.put('board-proposal',proposal.proposalId,proposal);this.store.event(run,'board-proposal',{proposalId:proposal.proposalId,draftId:draft.id,objectId:read.objectId,title});return proposal;
  }
  proposals(draft:Draft,objectId:string,snapshotId:string){this.owned(draft,objectId,snapshotId);return this.store.list<BoardProposal>('board-proposal').filter(p=>p.draftId===draft.id&&p.objectId===objectId&&p.snapshotId===snapshotId&&p.status==='pending');}
  decide(draft:Draft,proposalId:string,action:'apply'|'reject'){
    const p=this.store.require<BoardProposal>('board-proposal',proposalId);if(p.draftId!==draft.id||p.status!=='pending')throw Error('BOARD_PROPOSAL_EXPIRED');
    const record=this.owned(draft,p.objectId,p.snapshotId),run=this.store.require<Run>('run',p.runId);if(!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    if(action==='apply'&&(draft.revision!==p.revision||record.manifest.source.sha256!==p.sourceHash))throw Error('BOARD_BASELINE_CONFLICT');
    p.status=action==='apply'?'applied':'rejected';this.store.put('board-proposal',p.proposalId,p);return p;
  }
  beginGeneration(draft:Draft,localBoardId:string,baselineSignature:string){
    if(!/^[0-9a-f-]{36}$/i.test(localBoardId)||!/^[a-f0-9]{64}$/.test(baselineSignature))throw Error('BOARD_GENERATION_CONTEXT_INVALID');
    if(draft.state==='uncertain'||draft.state==='conflict')throw Error('BOARD_DRAFT_UNAVAILABLE');
    const old=this.store.get<BoardGenerationRequest>('board-generation-active',localBoardId);
    if(old&&(old.draftId!==draft.id||!sameTarget(old.target,draft.target)||old.workItemId!==draft.workItemId))throw Error('BOARD_TARGET_MISMATCH');
    if(old){old.status='superseded';this.store.put('board-generation-request',old.requestId,old);}
    const request:BoardGenerationRequest={requestId:crypto.randomUUID(),localBoardId,draftId:draft.id,target:draft.target,workItemId:draft.workItemId,revision:draft.revision,baselineSignature,createdAt:Date.now(),status:'active'};
    this.store.put('board-generation-request',request.requestId,request);this.store.put('board-generation-active',localBoardId,request);return request;
  }
  readRequirementGeneration(run:Run,draft:Draft){
    if(!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    const signature=hashBytes(Buffer.from(JSON.stringify({title:'工程流程图',elements:boardSceneSignature([])})));
    const request=this.beginGeneration(draft,crypto.randomUUID(),signature);request.originRunId=run.id;
    this.store.put('board-generation-request',request.requestId,request);this.store.put('board-generation-active',request.localBoardId,request);
    return {...this.readGenerationForRun(run,draft,request.requestId),request};
  }
  generationRequest(draft:Draft,requestId:string,requireActive=true){
    const request=this.store.require<BoardGenerationRequest>('board-generation-request',requestId);
    if(request.draftId!==draft.id||!sameTarget(request.target,draft.target)||request.workItemId!==draft.workItemId)throw Error('BOARD_TARGET_MISMATCH');
    const active=this.store.get<BoardGenerationRequest>('board-generation-active',request.localBoardId);
    if(requireActive&&(request.status!=='active'||active?.requestId!==request.requestId||Date.now()-request.createdAt>24*60*60*1000))throw Error('BOARD_GENERATION_EXPIRED: 请重新点击 AI 协作建立当前画板上下文');
    return request;
  }
  readGenerationForRun(run:Run,draft:Draft,requestId:string){
    const request=this.generationRequest(draft,requestId);
    if(!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    const matched=run.contexts?.some(context=>{if(!sameTarget(context.target,draft.target)||(context.workItemId&&context.workItemId!==draft.workItemId))return false;const lines=context.text.split('\n');if(lines[0]!=='BOARD_GENERATION_CONTEXT')return false;try{const value=JSON.parse(lines[1]??'');return value.requestId===requestId&&value.draftId===draft.id&&value.localBoardId===request.localBoardId&&value.baselineSignature===request.baselineSignature;}catch{return false;}});
    if(!matched&&request.originRunId!==run.id)throw Error('BOARD_GENERATION_CONTEXT_REQUIRED: 请使用当前画板通过 AI 协作传入的生成上下文');
    if(draft.revision!==request.revision)throw Error('BOARD_BASELINE_CONFLICT');
    const read:BoardGenerationRead={id:crypto.randomUUID(),requestId,runId:run.id,draftId:draft.id,revision:draft.revision};
    this.store.put('board-generation-read',read.id,read);
    return {...read,localBoardId:request.localBoardId,baselineSignature:request.baselineSignature,limits:'Propose a complete editable diagram using propose_board_generation. Up to 9 nodes (rectangle/diamond/ellipse/text), 12 edges, 2 focal accent nodes. Every diamond has 2–3 outgoing labeled branches, labels are single-line and at most 14 characters. Follow diagram-design; plain text only. Default size=auto chooses a compact landscape or portrait canvas; explicit size=slide-16x9/doc-inline/doc-wide is optional. Avoid sparse oversized nodes and long scrolls. Direction down/right is preferred flow. Optional x/y must be paired and inside the selected frame. For responsibility-separated processes use kind=swimlane with 2–4 named lanes; every node carries its lane, lanes are vertical and flow runs top-down without x/y. For interaction ordering use kind=sequence with 2–6 participants and 1–14 messages (kind=sync/return/self, text ≤120 chars); sequence diagrams take participants/messages instead of nodes/edges and bind messages to lifelines. For structural models use kind=class with 2–6 classes (name ≤40 chars; up to 8 attributes and 8 methods each, ≤60 chars per line) and up to 10 relations (association/aggregation/composition/inheritance/dependency, optional label ≤14 chars); class diagrams take classes/relations instead of nodes/edges. Inheritance goes child→parent, composition/aggregation owner→part, dependency client→supplier. For data models use kind=er with 2–6 entities (name ≤40 chars, 1–10 fields each with name/optional type/optional pk) and up to 10 entityRelations (one-one/one-many/many-many with optional label ≤14 chars); ER diagrams take entities/entityRelations instead of nodes/edges and express cardinality with native crowfoot arrowheads. If content cannot fit legibly, split overview/detail. No files, images, HTML, URLs, arbitrary Excalidraw source or remote writes. User previews and explicitly applies; later manual changes block application.'};
  }
  proposeGeneration(run:Run,draft:Draft,readId:string,input:unknown){
    const read=this.store.require<BoardGenerationRead>('board-generation-read',readId),request=this.generationRequest(draft,read.requestId);
    if(read.runId!==run.id||read.draftId!==draft.id||!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    if(draft.revision!==read.revision||draft.revision!==request.revision)throw Error('BOARD_BASELINE_CONFLICT');
    if(this.store.list<BoardGenerationProposal>('board-generation-proposal').filter(p=>p.requestId===request.requestId&&p.status==='pending').length>=5)throw Error('BOARD_PROPOSAL_LIMIT: 请先审阅或拒绝现有草案');
    const proposalId=crypto.randomUUID(),result=generateBoardDiagram(input,proposalId);
    const proposal:BoardGenerationProposal={proposalId,requestId:request.requestId,localBoardId:request.localBoardId,runId:run.id,draftId:draft.id,target:draft.target,workItemId:draft.workItemId,revision:draft.revision,baselineSignature:request.baselineSignature,...result,status:'pending',createdAt:Date.now()};
    this.store.put('board-generation-proposal',proposalId,proposal);this.store.event(run,'board-generation-proposal',{proposalId,draftId:draft.id,requestId:request.requestId,title:result.diagram.title,summary:result.summary,entry:request.originRunId?'requirements':'board'});return proposal;
  }
  generationProposals(draft:Draft,requestId:string){
    const request=this.generationRequest(draft,requestId,false);if(request.status!=='active')return [];
    return this.store.list<BoardGenerationProposal>('board-generation-proposal').filter(p=>p.requestId===requestId&&p.draftId===draft.id&&p.status==='pending');
  }
  decideGeneration(draft:Draft,proposalId:string,action:'apply'|'reject',baselineSignature:string){
    const proposal=this.store.require<BoardGenerationProposal>('board-generation-proposal',proposalId),request=this.generationRequest(draft,proposal.requestId,action==='apply');
    if(proposal.draftId!==draft.id||proposal.workItemId!==draft.workItemId||!sameTarget(proposal.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    if(proposal.status!=='pending')throw Error('BOARD_PROPOSAL_EXPIRED');
    const run=this.store.require<Run>('run',proposal.runId);if(!sameTarget(run.target,draft.target))throw Error('BOARD_TARGET_MISMATCH');
    if(action==='apply'){
      if(draft.state==='uncertain'||draft.state==='conflict')throw Error('BOARD_DRAFT_UNAVAILABLE');
      if(draft.revision!==proposal.revision||proposal.baselineSignature!==baselineSignature||request.baselineSignature!==baselineSignature)throw Error('BOARD_BASELINE_CONFLICT: 画板或正文草稿已变化，请重新生成');
      // Validate stored payload again before returning editable content to the UI.
      const generated=generateBoardDiagram(proposal.diagram,proposalId);if(JSON.stringify(generated.elements)!==JSON.stringify(proposal.elements))throw Error('BOARD_GENERATION_CONTENT_MISMATCH');
      request.status='applied';this.store.put('board-generation-request',request.requestId,request);this.store.put('board-generation-active',request.localBoardId,request);
    }
    proposal.status=action==='apply'?'applied':'rejected';this.store.put('board-generation-proposal',proposalId,proposal);return proposal;
  }
  byPreview(id:string){return this.store.list<BoardRecord>('board').find(b=>b.previewId===id);}
  bundle(previewId:string,target:Target,workItemId:string){
    const record=this.byPreview(previewId);if(!record)return undefined;const m=record.manifest;
    if(!sameTarget(m.target,target)||m.workItemId!==workItemId)throw Error('BOARD_TARGET_MISMATCH');
    const names=boardFileNames(m.snapshotId);
    return [{id:record.sourceId,fileName:names.source,mime:'application/json',sha256:m.source.sha256},{id:record.previewId,fileName:names.preview,mime:'image/png',sha256:m.preview.sha256},{id:record.manifestId,fileName:names.manifest,mime:'application/json',sha256:this.assets.require(record.manifestId,target).sha256!}].map(a=>{const bytes=this.assets.bytes(a.id);if(hashBytes(bytes)!==a.sha256)throw Error('BOARD_HASH_MISMATCH');return{...a,name:m.title,data:bytes.toString('base64')};});
  }
  import(target:Target,workItemId:string,input:{manifest:unknown;source:string;preview:string}){
    const m=BoardManifestSchema.parse(input.manifest);if(!sameTarget(m.target,target)||m.workItemId!==workItemId)throw Error('BOARD_TARGET_MISMATCH');
    const source=Buffer.from(input.source,'base64'),preview=Buffer.from(input.preview,'base64');
    if(source.length!==m.source.size||preview.length!==m.preview.size||hashBytes(source)!==m.source.sha256||hashBytes(preview)!==m.preview.sha256)throw Error('BOARD_HASH_MISMATCH');
    validateBoardSource(source.toString('utf8'));
    const old=this.store.get<BoardRecord>('board',m.snapshotId);if(old){if(JSON.stringify(old.manifest)!==JSON.stringify(m))throw Error('BOARD_MANIFEST_MISMATCH');return old;}
    const s=this.putBytes(target,m.source.name,'application/json',source),p=this.putBytes(target,m.preview.name,'image/png',preview);if(p.mime!=='image/png')throw Error('BOARD_PNG_REQUIRED');
    const a=this.putBytes(target,boardFileNames(m.snapshotId).manifest,'application/json',Buffer.from(JSON.stringify(m)));const record={manifest:m,sourceId:s.id,previewId:p.id,manifestId:a.id};this.store.put('board',m.snapshotId,record);return record;
  }
}
