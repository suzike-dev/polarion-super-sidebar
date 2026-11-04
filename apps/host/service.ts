import { Store } from './store.ts';
import { Drafts, Polarion } from './polarion.ts';
import { Engines, safeError } from './engine.ts';
import { Capabilities } from './capabilities.ts';
import { Assets } from './assets.ts';
import {Boards} from './boards.ts';
import { RequestSchema, PROTOCOL, type Reply, type Run, type Session } from '../../packages/protocol/index.ts';
export class Service {
  store: Store; drafts: Drafts; engines: Engines;
  capabilities: Capabilities;
  assets: Assets;
  constructor(store: Store, drafts?: Drafts) { this.store = store; this.assets = new Assets(store); this.drafts = drafts ?? new Drafts(store, new Polarion(this.assets)); this.engines = new Engines(store, this.drafts, this.assets); this.capabilities = new Capabilities(store); }
  async request(input: unknown): Promise<Reply> {
    let id = '';
    try {
      const request = RequestSchema.parse(input); id = request.id; const c = request.command; let value: unknown;
      switch (c.method) {
        case 'health': value = { protocol: PROTOCOL, version: '0.3.0', pid: process.pid, running: this.engines.active.size, codex: 'not-integrated', writeScope: 'explicit-user-save-with-readback' }; break;
        case 'engine.capabilities': {const s=c.sessionId?this.store.require<Session>('session',c.sessionId):undefined;if(s&&s.target.projectId!==c.target.projectId)throw Error('SESSION_PROJECT_MISMATCH');const runtime=c.sessionId?this.engines.runtimes.get(c.sessionId):undefined;const capabilities=runtime?await import('./capabilities.ts').then(m=>m.inspectRuntime(runtime)):await this.capabilities.read(c.target,c.refresh);value={...capabilities,connected:!!runtime};break;}
        case 'engine.manage': value=await this.engines.manage(c.sessionId,c.action,c.server);break;
        case 'engine.context': this.store.require<Session>('session',c.sessionId);value=await this.engines.contextUsage.read(c.sessionId,c.refresh);break;
        case 'settings.read': value = this.store.settings(); break;
        case 'settings.write': this.store.put('settings', 'global', c.settings); value = c.settings; break;
        case 'sessions.list': value = this.store.list<Session>('session').filter(s => s.target.projectId === c.projectId).sort((a, b) => b.updatedAt - a.updatedAt); break;
        case 'sessions.create': value = this.store.createSession(c.target, c.title); break;
        case 'sessions.rename': { const s = this.store.require<Session>('session', c.sessionId); s.title = c.title; this.store.put('session', s.id, s); value = s; break; }
        case 'sessions.read': value = { session: this.store.require<Session>('session', c.sessionId), runs: this.store.list<Run>('run').filter(r => r.sessionId === c.sessionId).sort((a, b) => a.startedAt - b.startedAt).map(({ contexts, prompt, ...r }) => r), events: this.store.events(c.sessionId, c.after) }; break;
        case 'runs.start': { const result = this.store.startRun(c.sessionId, c.requestId, c.prompt, c.contexts, c.target, c.attachments, c.permissionMode); if (result.created) void this.engines.execute(result.run); value = result.run; break; }
        case 'assets.begin': value = this.assets.begin(c.target,c.name,c.mime,c.size); break;
        case 'assets.chunk': value = this.assets.chunk(c.assetId,c.offset,c.data); break;
        case 'assets.finish': value = this.assets.finish(c.assetId); break;
        case 'assets.read': value = this.assets.read(c.assetId,c.offset,c.length); break;
        case 'assets.metadata': value = this.assets.metadata(this.assets.require(c.assetId)); break;
        case 'assets.text': { const a=this.assets.require(c.assetId);value={text:a.text??'',extraction:a.extraction,truncated:!!a.truncated};break; }
        case 'images.resolve': {if(!(this.drafts.remote instanceof Polarion))throw Error('IMAGE_READER_UNAVAILABLE');value=await this.drafts.remote.image(c.target,c.workItemId,c.src);break;}
        case 'boards.proposals': value=new Boards(this.store,this.assets).proposals(this.drafts.read(c.draftId),c.objectId,c.snapshotId);break;
        case 'boards.generation.begin': value=new Boards(this.store,this.assets).beginGeneration(this.drafts.read(c.draftId),c.localBoardId,c.baselineSignature);break;
        case 'boards.generation.proposals': value=new Boards(this.store,this.assets).generationProposals(this.drafts.read(c.draftId),c.requestId);break;
        case 'boards.generation.open': {const draft=this.drafts.read(c.draftId),request=new Boards(this.store,this.assets).generationRequest(draft,c.requestId);if(!request.originRunId)throw Error('BOARD_GENERATION_USE_EXISTING_CANVAS');value={draft,request};break;}
        case 'boards.generation.decide': value=new Boards(this.store,this.assets).decideGeneration(this.drafts.read(c.draftId),c.proposalId,c.action,c.baselineSignature);break;
        case 'boards.decide': value=new Boards(this.store,this.assets).decide(this.drafts.read(c.draftId),c.proposalId,c.action);break;
        case 'boards.create': {const d=this.drafts.read(c.draftId);value=new Boards(this.store,this.assets).create(d.target,d.workItemId,c.title,c.sourceId,c.previewId,c.parentSnapshotId);break;}
        case 'boards.open': {const d=this.drafts.read(c.draftId),boards=new Boards(this.store,this.assets);if(c.src.startsWith('polarion-asset:')){const record=boards.byPreview(c.src.slice(15));if(!record)throw Error('BOARD_SOURCE_MISSING');value=boards.owned(d,record.manifest.objectId,record.manifest.snapshotId);}else{if(!d.html.includes(c.src))throw Error('BOARD_REFERENCE_MISSING');if(!(this.drafts.remote instanceof Polarion))throw Error('BOARD_READER_UNAVAILABLE');const result=await this.drafts.remote.call<any>({method:'board',target:d.target,workItemId:d.workItemId,src:c.src});value=boards.import(d.target,d.workItemId,result);}break;}
        case 'runs.cancel': this.engines.cancel(c.runId); value = { requested: true }; break;
        case 'permissions.answer': this.engines.answer(c.runId, c.permissionId, c.allow); value = { answered: true }; break;
        case 'interactions.answer': this.engines.interactions.answer(c.runId,c.interactionId,{action:c.action,values:c.values});value={answered:true};break;
        case 'drafts.list': value = this.store.drafts(c.target).map(({ html, baseHtml, ...d }) => d); break;
        case 'drafts.open': value = await this.drafts.open(c.target, c.workItemId); break;
        case 'drafts.read': value = this.drafts.read(c.draftId); break;
        case 'drafts.rich.read': value = this.drafts.richRead(c.draftId); break;
        case 'drafts.rich.apply': value = this.drafts.richApply(c.draftId, c.editorId, c.expectedRevision, c.document); break;
        case 'drafts.reconcile': value = await this.drafts.reconcile(c.draftId); break;
        case 'drafts.conflict.read': value=await this.drafts.conflictRead(c.draftId);break;
        case 'drafts.conflict.resolve': value=await this.drafts.resolveConflict(c.draftId,c.expectedRevision,c.remoteHash,c.remoteUpdated,c.strategy);break;
        case 'drafts.replaceText': value = this.drafts.replace(c.draftId, c.expectedRevision, c.nodeId, c.expectedText, c.text); break;
        case 'drafts.save': value = await this.drafts.save(c.draftId, c.expectedRevision, c.nativeState); break;
      }
      return { protocol: 1, id, ok: true, value };
    } catch (error) { return { protocol: 1, id, ok: false, error: safeError(error) }; }
  }
}
