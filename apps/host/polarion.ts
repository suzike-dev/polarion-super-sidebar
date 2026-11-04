import {formatDocument, type TextFormat} from '../../packages/core/format-document.ts';
import {equivalentHtml} from '../../packages/core/html-equivalence.ts';
import {polarionWriteHtml} from '../../packages/core/polarion-html.ts';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './paths.ts';
import type { Draft, Target } from '../../packages/protocol/index.ts';
import { LosslessHtml } from '../../packages/core/lossless-html.ts';
import { Store } from './store.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';
import type { JSONContent } from '@tiptap/core';
import { Assets } from './assets.ts';
import {Boards} from './boards.ts';
type RichSession = { id: string; draftId: string; source: string; revision: number; imageAliases?:Record<string,string>;saved?:boolean };
export type RemoteItem = { id: string; title: string; description?: string; updated?: string; status?: string; submittedHtml?: string; uploadedAssets?: {localId:string;attachmentId:string;sha256:string}[] };
export interface Remote { read(target: Target, workItemId: string): Promise<RemoteItem>; save(draft: Draft): Promise<RemoteItem> }
export class Polarion implements Remote {
  assets?: Assets;
  constructor(assets?: Assets){this.assets=assets;}
  child?: ChildProcessWithoutNullStreams;
  pending = new Map<string, { resolve: (value: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout;progress?:(value:any)=>void }>();
  start() {
    if (this.child) return;
    // PowerShell 7's module search path can break Windows PowerShell's DPAPI cmdlets.
    const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
    this.child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts/start-polarion-worker.ps1')], { cwd: ROOT, env, windowsHide: true, stdio: 'pipe' });
    this.child.stderr.resume();
    readline.createInterface({ input: this.child.stdout }).on('line', line => {
      try { const reply = JSON.parse(line); const pending = this.pending.get(reply.id); if (!pending) return; if(reply.progress){pending.progress?.(reply.progress);return;}clearTimeout(pending.timer); this.pending.delete(reply.id); reply.ok ? pending.resolve(reply.value) : pending.reject(Error(reply.error)); } catch { /* no raw subprocess output goes to the UI */ }
    });
    const fail = () => { this.child = undefined; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('POLARION_WORKER_STOPPED')); } this.pending.clear(); };
    this.child.once('exit', fail); this.child.once('error', fail);
  }
  call<T=RemoteItem>(data: unknown,progress?:(value:any)=>void) {
    this.start(); const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('POLARION_TIMEOUT_VERIFY_BEFORE_RETRY')); }, 90000);
      this.pending.set(id, { resolve, reject, timer,progress }); this.child!.stdin.write(JSON.stringify({ ...(data as object), id }) + '\n');
    });
  }
  read(target: Target, workItemId: string) { return this.call({ method: 'read', target, workItemId }); }
  async image(target:Target,workItemId:string,src:string){
    if(!this.assets)throw Error('ASSET_STORE_UNAVAILABLE');
    const result=await this.call<{name:string;data:string}>({method:'image',target,workItemId,src});const bytes=Buffer.from(result.data,'base64');
    const asset=this.assets.begin(target,result.name,'application/octet-stream',bytes.length);for(let offset=0;offset<bytes.length;offset+=384*1024)this.assets.chunk(asset.id,offset,bytes.subarray(offset,offset+384*1024).toString('base64'));
    return this.assets.finish(asset.id);
  }
  save(draft: Draft) {
    const ids=[...new Set([...draft.html.matchAll(/\bsrc=["']polarion-asset:([0-9a-f-]{36})["']/gi)].map(m=>m[1]!))];
    const assets=ids.flatMap(id=>{if(!this.assets)throw Error('ASSET_STORE_UNAVAILABLE');const bundle=new Boards(this.assets.store,this.assets).bundle(id,draft.target,draft.workItemId);if(bundle)return bundle;const a=this.assets.require(id,draft.target);if(a.extraction!=='image')throw Error('IMAGE_ASSET_REQUIRED');return[{id,name:a.name,mime:a.mime,sha256:a.sha256!,data:this.assets.bytes(id).toString('base64')}];});
    return this.call({ method: 'save', target: draft.target, workItemId: draft.workItemId, html: draft.html, expectedUpdated: draft.baseUpdated, baseHash: createHash('sha256').update(draft.baseHtml).digest('hex'),assets },receipt=>{this.assets?.store.put('attachment-receipt',draft.id+':'+receipt.localId,{draftId:draft.id,revision:draft.revision,at:Date.now(),...receipt});});
  }
}
export class Drafts {
  store: Store; remote: Remote; snapshots = new Map<string, { revision: number; source: LosslessHtml }>();
  saving = new Set<string>();
  richModels = new Map<string, RichDocument>();
  constructor(store: Store, remote: Remote) { this.store = store; this.remote = remote; }
  async open(target: Target, workItemId: string) {
    const prior = this.store.drafts(target).find(d => d.workItemId === workItemId);
    if (prior) return this.read(prior.id);
    const item = await this.remote.read(target, workItemId);
    // Another request can finish while the remote read is in flight.
    const existing = this.store.drafts(target).find(d => d.workItemId === workItemId);
    if (existing) return this.read(existing.id);
    const draft: Draft = { id: crypto.randomUUID(), target, workItemId, title: item.title, baseHtml: item.description ?? '', html: item.description ?? '', baseUpdated: item.updated ?? '', revision: 0, state: 'clean' };
    this.store.put('draft', draft.id, draft); return this.read(draft.id);
  }
  read(id: string) {
    const draft = this.store.require<Draft>('draft', id);
    let snapshot = this.snapshots.get(id);
    if (!snapshot || snapshot.revision !== draft.revision) { snapshot = { revision: draft.revision, source: new LosslessHtml(draft.html) }; this.snapshots.set(id, snapshot); }
    return { ...draft, version: snapshot.source.version, nodes: snapshot.source.nodes };
  }
  richRead(id: string) {
    const draft = this.read(id); const model = new RichDocument(draft.html);
    const session: RichSession = { id: model.version, draftId: id, source: draft.html, revision: draft.revision };
    this.store.put('rich-editor', session.id, session); this.richModels.set(session.id, model);
    return { editorId: session.id, draft, document: structuredClone(model.document) };
  }
  richApply(id: string, editorId: string, expectedRevision: number, document: JSONContent) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id); const session = this.store.require<RichSession>('rich-editor', editorId);
    if (session.draftId !== id || session.revision !== expectedRevision || draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    if (draft.state === 'uncertain') throw Error('READBACK_REQUIRED');
    let model = this.richModels.get(editorId);
    if (!model) { model = new RichDocument(session.source, session.id); this.richModels.set(editorId, model); }
    let html = model.serialize(document);
    for(const [localId,attachmentId] of Object.entries(session.imageAliases??{}))html=html.replaceAll('polarion-asset:'+localId,'workitemimg:'+attachmentId);
    if(session.saved){html=polarionWriteHtml(html);if(equivalentHtml(html,draft.baseHtml))html=draft.baseHtml;}
    if (html === draft.html) return draft;
    const value: Draft = { ...draft, html, revision: draft.revision + 1, state: draft.state === 'conflict' ? 'conflict' : html === draft.baseHtml ? 'clean' : 'dirty' };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.put('draft-checkpoint', crypto.randomUUID(), { draftId: id, revision: draft.revision, html: draft.html, at: Date.now(), source: 'rich-editor' });
      this.store.put('draft', id, value); this.store.put('rich-editor', editorId, { ...session, revision: value.revision });
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    return this.read(id);
  }
  format(id:string,expectedRevision:number,format:TextFormat,selection?:string){
    if(this.read(id).revision!==expectedRevision)throw Error('STALE_DRAFT');
    const rich=this.richRead(id),changed=formatDocument(rich.document,format,selection);
    return{draft:this.richApply(id,rich.editorId,expectedRevision,changed.document),characters:changed.characters};
  }
  replace(id: string, expectedRevision: number, nodeId: string, expectedText: string, text: string) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id); if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    if(draft.state==='uncertain')throw Error('READBACK_REQUIRED');
    const source = this.snapshots.get(id)!.source;
    const next = source.replaceText(source.version, [{ nodeId, expectedText, text }]);
    if (next === source) return draft;
    const value: Draft = { ...draft, html: next.source, revision: draft.revision + 1, state: draft.state==='conflict'?'conflict':next.source === draft.baseHtml ? 'clean' : 'dirty' };
    this.store.put('draft', id, value); this.snapshots.set(id, { revision: value.revision, source: next }); return this.read(id);
  }
  async save(id: string, expectedRevision: number, nativeState: 'clean' | 'dirty' | 'unknown') {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    if (nativeState !== 'clean') throw Error('NATIVE_EDITOR_' + nativeState.toUpperCase());
    const draft = this.store.require<Draft>('draft', id);
    if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    if (draft.state === 'clean') return this.read(id);
    if (draft.state === 'uncertain') throw Error('READBACK_REQUIRED');
    this.saving.add(id);
    let dispatched = false,knownUnchanged=false; const operationId = crypto.randomUUID();
    const audit = { id: operationId, draftId: id, target: draft.target, workItemId: draft.workItemId, revision: draft.revision, startedAt: Date.now(), phase: 'preflight', baseHash: createHash('sha256').update(draft.baseHtml).digest('hex'), proposedHash: createHash('sha256').update(draft.html).digest('hex') };
    this.store.put('save', operationId, audit);
    try {
      const current = await this.remote.read(draft.target, draft.workItemId);
      if (current.updated !== draft.baseUpdated || (current.description ?? '') !== draft.baseHtml) {
        this.store.put('draft', id, { ...draft, state: 'conflict' }); throw Error('REMOTE_CONFLICT');
      }
      // Durable before dispatch: a Host crash must not turn an unknown write into a retryable draft.
      this.store.put('draft', id, { ...draft, state: 'uncertain' });
      this.store.put('save', operationId, { ...audit, phase: 'dispatched' }); dispatched = true;
      const outgoing={...draft,html:polarionWriteHtml(draft.html)};
      const outcome = await this.remote.save(outgoing);
      const readback = await this.remote.read(draft.target, draft.workItemId);
      // Allow only serialization-equivalent attributes/entities/style spacing.
      // Text, tags, CSS values/order, images and object references still must match.
      const submitted=outcome.submittedHtml??outgoing.html;
      const savedHtml=readback.description??'';
      if (!equivalentHtml(savedHtml,submitted)){knownUnchanged=savedHtml===draft.baseHtml&&readback.updated===draft.baseUpdated;throw Error(knownUnchanged?'SAVE_NOT_APPLIED':'READBACK_MISMATCH');}
      const savedRevision=draft.revision+(savedHtml===draft.html?0:1);
      this.store.put('draft', id, { ...draft, html:savedHtml,revision:savedRevision,baseHtml: savedHtml, baseUpdated: readback.updated, state: 'clean', savedAt: Date.now() });
      // Keep source IDs and the open editor's undo history valid across a verified save.
      // Only sessions at the saved revision can continue; stale clients remain stale.
      for(const session of this.store.list<RichSession>('rich-editor'))if(session.draftId===id&&session.revision===draft.revision){
        const imageAliases={...session.imageAliases,...Object.fromEntries((outcome.uploadedAssets??[]).map(a=>[a.localId,a.attachmentId]))};
        this.store.put('rich-editor',session.id,{...session,revision:savedRevision,imageAliases,saved:true});
      }
      this.store.put('save', operationId, { ...audit, phase: 'verified', endedAt: Date.now(), serverUpdated: readback.updated,submittedHash:createHash('sha256').update(submitted).digest('hex'),uploadedAssets:outcome.uploadedAssets??[] });
      return this.read(id);
    } catch (error) {
      if (dispatched) this.store.put('draft', id, { ...draft, state: knownUnchanged?'dirty':'uncertain' });
      this.store.put('save', operationId, { ...audit, phase: knownUnchanged?'not-applied':dispatched ? 'uncertain' : 'not-written', endedAt: Date.now(),errorCode:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'OPERATION_FAILED' });
      throw error;
    } finally { this.saving.delete(id); }
  }
  async conflictRead(id:string){
    const draft=this.store.require<Draft>('draft',id),remote=await this.remote.read(draft.target,draft.workItemId),remoteHtml=remote.description??'';
    return{draft,remoteHtml,remoteUpdated:remote.updated??'',remoteHash:createHash('sha256').update(remoteHtml).digest('hex')};
  }
  async resolveConflict(id:string,expectedRevision:number,remoteHash:string,remoteUpdated:string,strategy:'keep-local'|'use-remote'){
    if(this.saving.has(id))throw Error('DRAFT_SAVING');this.saving.add(id);
    try{
      const draft=this.store.require<Draft>('draft',id);if(draft.revision!==expectedRevision)throw Error('STALE_DRAFT');
      const remote=await this.remote.read(draft.target,draft.workItemId),remoteHtml=remote.description??'';
      if(createHash('sha256').update(remoteHtml).digest('hex')!==remoteHash||(remote.updated??'')!==remoteUpdated)throw Error('REMOTE_CHANGED_SINCE_REVIEW');
      const html=strategy==='keep-local'?draft.html:remoteHtml;
      this.store.put('conflict-resolution',crypto.randomUUID(),{draftId:id,at:Date.now(),strategy,previous:draft,remoteHtml,remoteUpdated});
      this.store.put('draft',id,{...draft,html,baseHtml:remoteHtml,baseUpdated:remoteUpdated,revision:draft.revision+1,state:html===remoteHtml?'clean':'dirty'});
      return this.read(id);
    }finally{this.saving.delete(id);}
  }
  async reconcile(id: string) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    this.saving.add(id);
    try {
      const draft = this.store.require<Draft>('draft', id);
      const remote = await this.remote.read(draft.target, draft.workItemId);
      let value: Draft;
      if (equivalentHtml(remote.description??'',polarionWriteHtml(draft.html))) value = { ...draft, html:remote.description??'',revision:draft.revision+(remote.description===draft.html?0:1),baseHtml: remote.description??'', baseUpdated: remote.updated ?? '', state: 'clean', savedAt: Date.now() };
      else if ((remote.description ?? '') === draft.baseHtml && remote.updated === draft.baseUpdated) value = { ...draft, state: 'dirty' };
      else value = { ...draft, state: 'conflict' };
      this.store.put('draft', id, value);
      this.store.put('reconciliation', crypto.randomUUID(), { draftId: id, at: Date.now(), state: value.state, remoteUpdated: remote.updated, remoteHash: createHash('sha256').update(remote.description ?? '').digest('hex') });
      return this.read(id);
    } finally { this.saving.delete(id); }
  }
}
