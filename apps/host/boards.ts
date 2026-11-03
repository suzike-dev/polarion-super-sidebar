import {parseFragment} from 'parse5';
import {applyBoardPatches,type BoardPatch} from '../../packages/core/board-changes.ts';
import type {Draft,Run} from '../../packages/protocol/index.ts';
import {createHash} from 'node:crypto';
import {Assets} from './assets.ts';
import {Store} from './store.ts';
import {sameTarget,type Target} from '../../packages/protocol/index.ts';
import {boardFileNames,BoardManifestSchema,validateBoardSource,type BoardManifest} from '../../packages/core/board-contract.ts';
export type BoardRecord={manifest:BoardManifest;sourceId:string;previewId:string;manifestId:string};
export type BoardRead={id:string;runId:string;draftId:string;revision:number;objectId:string;snapshotId:string;sourceHash:string;selectedIds:string[]};
export type BoardProposal=BoardRead&{proposalId:string;title:string;patches:BoardPatch[];summary:ReturnType<typeof applyBoardPatches>['summary'];status:'pending'|'applied'|'rejected';createdAt:number};
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
