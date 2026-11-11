import { Store } from './store.ts';
import { Drafts, Polarion } from './polarion.ts';
import { Engines, safeError } from './engine.ts';
import { Capabilities } from './capabilities.ts';
import { Assets } from './assets.ts';
import {Boards} from './boards.ts';
import {Variants} from './variants.ts';
import {Changes} from './changes.ts';
import {Credentials} from './credentials.ts';
import {validateGuideline} from './guidelines.ts';
import {pickFolder, pickFiles} from './dialogs.ts';
import {buildTestCard, sendCardToGroups} from './feishu.ts';
import { RequestSchema, PROTOCOL, normalizeGuideline, type Reply, type Run, type Session, type SessionGroup } from '../../packages/protocol/index.ts';
export class Service {
  store: Store; drafts: Drafts; engines: Engines;
  capabilities: Capabilities;
  assets: Assets;
  variants: Variants;
  changes: Changes;
  credentials?: Credentials;
  constructor(store: Store, drafts?: Drafts) { this.store = store; this.assets = new Assets(store); this.drafts = drafts ?? new Drafts(store, new Polarion(this.assets)); this.engines = new Engines(store, this.drafts, this.assets); this.capabilities = new Capabilities(store); this.variants = new Variants(store, this.drafts, this.assets); this.changes = new Changes(store, this.drafts, this.assets); }
  async request(input: unknown): Promise<Reply> {
    // 解析失败也要带回请求 id，否则客户端只能等 100 秒超时，看不到具体校验错误。
    let id = input && typeof input === 'object' && typeof (input as { id?: unknown }).id === 'string' ? String((input as { id?: unknown }).id) : '';
    try {
      const request = RequestSchema.parse(input); id = request.id; const c = request.command; let value: unknown;
      switch (c.method) {
        case 'health': value = { protocol: PROTOCOL, version: '0.8.0', pid: process.pid, running: this.engines.active.size, codex: 'not-integrated', writeScope: 'explicit-user-save-with-readback' }; break;
        case 'engine.capabilities': {const s=c.sessionId?this.store.require<Session>('session',c.sessionId):undefined;if(s&&s.target.projectId!==c.target.projectId)throw Error('SESSION_PROJECT_MISMATCH');const runtime=c.sessionId?this.engines.runtimes.get(c.sessionId):undefined;const capabilities=runtime?await import('./capabilities.ts').then(m=>m.inspectRuntime(runtime)):await this.capabilities.read(c.target,c.refresh);value={...capabilities,connected:!!runtime};break;}
        case 'engine.manage': value=await this.engines.manage(c.sessionId,c.action,c.server);break;
        case 'engine.context': this.store.require<Session>('session',c.sessionId);value=await this.engines.contextUsage.read(c.sessionId,c.refresh);break;
        case 'settings.read': value = this.store.settings(); break;
        case 'polarion.credentials.status': case 'polarion.credentials.check': case 'polarion.credentials.save': {
          if (!(this.drafts.remote instanceof Polarion)) throw Error('POLARION_UNAVAILABLE');
          const credentials=this.credentials??=new Credentials(this.drafts.remote);
          value=c.method==='polarion.credentials.status'?await credentials.status():c.method==='polarion.credentials.check'?await credentials.check():await credentials.save(c.username,c.password);break;
        }
        case 'settings.write': this.store.setDraftsFolder(c.settings.draftsFolder); this.store.put('settings', 'global', c.settings); value = c.settings; break;
        case 'sessions.list': value = this.store.list<Session>('session').filter(s => s.target.projectId === c.projectId).sort((a, b) => b.updatedAt - a.updatedAt); break;
        case 'sessions.create': value = this.store.createSession(c.target, c.title); break;
        case 'sessions.rename': { const s = this.store.require<Session>('session', c.sessionId); s.title = c.title; this.store.put('session', s.id, s); value = s; break; }
        case 'sessions.archive': { const s = this.store.require<Session>('session', c.sessionId); s.archived = c.archived || undefined; this.store.put('session', s.id, s); value = s; break; }
        case 'sessions.group': { const s = this.store.require<Session>('session', c.sessionId); s.group = c.group.trim() || undefined; this.store.put('session', s.id, s); value = s; break; }
        case 'sessions.delete': value = this.store.deleteSession(c.sessionId); break;
        // 分组登记独立于会话存在：空分组也有效；解散时清掉所有会话上的该分组标记。
        case 'sessionGroups.list': value = this.store.list<SessionGroup>('session-group').sort((a, b) => a.createdAt - b.createdAt); break;
        case 'sessionGroups.create': { const name = c.name.trim(); if (!name) throw Error('GROUP_NAME_EMPTY'); const existing = this.store.get<SessionGroup>('session-group', name); value = existing ?? (() => { const g: SessionGroup = { name, createdAt: Date.now() }; this.store.put('session-group', name, g); return g; })(); break; }
        case 'sessionGroups.delete': { this.store.remove('session-group', c.name); for (const s of this.store.list<Session>('session')) if (s.group === c.name) this.store.put('session', s.id, { ...s, group: undefined }); value = { disbanded: c.name }; break; }
        case 'sessions.read': value = { session: this.store.require<Session>('session', c.sessionId), runs: this.store.list<Run>('run').filter(r => r.sessionId === c.sessionId).sort((a, b) => a.startedAt - b.startedAt).map(({ contexts, prompt, ...r }) => r), events: this.store.events(c.sessionId, c.after) }; break;
        case 'runs.start': { const result = this.store.startRun(c.sessionId, c.requestId, c.prompt, c.contexts, c.target, c.attachments, c.permissionMode, c.delivery, c.guidelineId); if (result.created) { if (result.run.status === 'queued') { if (c.delivery === 'steer') this.engines.steer(c.sessionId, result.run.id); this.engines.pump(c.sessionId); } else void this.engines.execute(result.run); } value = result.run; break; }
        case 'assets.begin': value = this.assets.begin(c.target,c.name,c.mime,c.size); break;
        case 'assets.chunk': value = this.assets.chunk(c.assetId,c.offset,c.data); break;
        case 'assets.finish': value = this.assets.finish(c.assetId); break;
        case 'assets.read': value = this.assets.read(c.assetId,c.offset,c.length); break;
        case 'assets.metadata': value = this.assets.metadata(this.assets.require(c.assetId)); break;
        case 'assets.text': { const a=this.assets.require(c.assetId);value={text:a.text??'',extraction:a.extraction,truncated:!!a.truncated};break; }
        case 'images.resolve': {if(!(this.drafts.remote instanceof Polarion))throw Error('IMAGE_READER_UNAVAILABLE');value=await this.drafts.remote.image(c.target,c.workItemId,c.src,this.drafts.scopeFor(c.target,c.workItemId));break;}
        case 'boards.proposals': value=new Boards(this.store,this.assets).proposals(this.drafts.read(c.draftId),c.objectId,c.snapshotId);break;
        case 'boards.generation.begin': value=new Boards(this.store,this.assets).beginGeneration(this.drafts.read(c.draftId),c.localBoardId,c.baselineSignature);break;
        case 'boards.generation.proposals': value=new Boards(this.store,this.assets).generationProposals(this.drafts.read(c.draftId),c.requestId);break;
        case 'boards.generation.open': {const draft=this.drafts.read(c.draftId),request=new Boards(this.store,this.assets).generationRequest(draft,c.requestId);if(!request.originRunId)throw Error('BOARD_GENERATION_USE_EXISTING_CANVAS');value={draft,request};break;}
        case 'boards.generation.decide': value=new Boards(this.store,this.assets).decideGeneration(this.drafts.read(c.draftId),c.proposalId,c.action,c.baselineSignature);break;
        case 'boards.decide': value=new Boards(this.store,this.assets).decide(this.drafts.read(c.draftId),c.proposalId,c.action);break;
        case 'boards.create': {const d=this.drafts.read(c.draftId);value=new Boards(this.store,this.assets).create(d.target,d.workItemId,c.title,c.sourceId,c.previewId,c.parentSnapshotId);break;}
        case 'boards.open': {const d=this.drafts.read(c.draftId),boards=new Boards(this.store,this.assets);if(c.src.startsWith('polarion-asset:')){const record=boards.byPreview(c.src.slice(15));if(!record)throw Error('BOARD_SOURCE_MISSING');value=boards.owned(d,record.manifest.objectId,record.manifest.snapshotId);}else{if(!d.html.includes(c.src))throw Error('BOARD_REFERENCE_MISSING');if(!(this.drafts.remote instanceof Polarion))throw Error('BOARD_READER_UNAVAILABLE');const scope=this.drafts.scopeFor(d.target,d.workItemId);const result=await this.drafts.remote.call<any>({method:'board',target:d.target,workItemId:d.workItemId,src:c.src,...(scope?{variant:scope}:{})});value=boards.import(d.target,d.workItemId,result);}break;}
        case 'runs.retry': {
          const prior = this.store.require<Run>('run', c.runId);
          const attachments = (prior.attachments ?? []).filter(id => this.store.get('asset', id));
          const guidelineId = prior.guidelineId && this.store.get('guideline', prior.guidelineId) ? prior.guidelineId : undefined;
          const result = this.store.startRun(prior.sessionId, c.requestId, prior.prompt, prior.contexts, prior.target, attachments, prior.permissionMode, 'queue', guidelineId);
          if (result.created) { if (result.run.status === 'queued') this.engines.pump(prior.sessionId); else void this.engines.execute(result.run); }
          value = result.run; break;
        }
        case 'runs.cancel': this.engines.cancel(c.runId); value = { requested: true }; break;
        case 'permissions.answer': this.engines.answer(c.runId, c.permissionId, c.allow, c.scope); value = { answered: true }; break;
        case 'interactions.answer': this.engines.interactions.answer(c.runId,c.interactionId,{action:c.action,values:c.values});value={answered:true};break;
        case 'drafts.list': value = this.store.drafts(c.target).map(({ html, baseHtml, ...d }) => d); break;
        case 'workitems.peek': value = await this.drafts.peek(c.target, c.workItemId); break;
        case 'workitems.search': value = await this.drafts.searchItems(c.target, c.query, c.limit); break;
        case 'workitems.read': value = await this.drafts.readOnly(c.target, c.workItemId); break;
        case 'document.outline': {
          if (!(this.drafts.remote instanceof Polarion) || !this.drafts.remote.outline) throw Error('POLARION_UNAVAILABLE');
          value = await this.drafts.remote.outline(c.target);
          break;
        }
        case 'changes.workspace.read': value = await this.changes.workspace(c.target); break;
        case 'changes.session.start': value = await this.changes.start(c.target, c.note); break;
        case 'changes.session.cancel': value = await this.changes.cancel(c.sessionId); break;
        case 'changes.session.finish': value = await this.changes.finish(c.sessionId); break;
        case 'changes.compare.options': value = await this.changes.compareOptions(c.target); break;
        case 'changes.compare.create': value = await this.changes.compare(c.target, c.beforeAt, c.afterAt); break;
        case 'changes.job.read': value = this.changes.jobRead(c.jobId); break;
        case 'changes.record.read': value = await this.changes.readRecord(c.recordId); break;
        case 'changes.record.note': value = await this.changes.setNote(c.recordId, c.note); break;
        case 'changes.record.delete': value = await this.changes.deleteRecord(c.recordId); break;
        case 'changes.record.summarize': value = await this.changes.summarize(c.recordId, c.force); break;
        case 'changes.share.publish': value = await this.changes.publish(c.recordId); break;
        case 'changes.share.stop': value = this.changes.stopShare(); break;
        case 'changes.share.feishu': value = await this.changes.shareFeishu(c.recordId); break;
        case 'changes.share.feishuTest': value = await sendCardToGroups([{label: '测试群', webhook: c.webhook, secret: c.secret}], buildTestCard(c.projectId)); break;
        case 'changes.feishu.groups': value = await this.changes.feishuGroups(c.target); break;
        case 'changes.feishu.groups.save': value = await this.changes.feishuGroupsSave(c.target, c.groups); break;
        case 'drafts.delete': value = { removed: this.drafts.remove(c.draftIds) }; break;
        case 'guidelines.list': value = this.store.guidelines(); break;
        case 'guidelines.save': validateGuideline(c.guideline); this.store.put('guideline', c.guideline.id, normalizeGuideline(c.guideline)); value = normalizeGuideline(c.guideline); break;
        case 'guidelines.delete': { this.store.require('guideline', c.id); this.store.remove('guideline', c.id); value = { removed: true }; break; }
        case 'dialog.pickFolder': value = { path: await pickFolder(c.title, c.defaultPath) }; break;
        case 'dialog.pickFiles': value = { paths: await pickFiles(c.title, c.defaultPath) }; break;
        case 'drafts.open': value = await this.drafts.open(c.target, c.workItemId); break;
        case 'drafts.read': value = this.drafts.read(c.draftId); break;
        case 'drafts.rich.read': value = this.drafts.richRead(c.draftId); break;
        case 'drafts.rich.apply': value = this.drafts.richApply(c.draftId, c.editorId, c.expectedRevision, c.document); break;
        case 'drafts.reconcile': value = await this.drafts.reconcile(c.draftId); break;
        case 'drafts.conflict.read': value=await this.drafts.conflictRead(c.draftId);break;
        case 'drafts.conflict.resolve': value=await this.drafts.resolveConflict(c.draftId,c.expectedRevision,c.remoteHash,c.remoteUpdated,c.strategy);break;
        case 'drafts.replaceText': value = this.drafts.replace(c.draftId, c.expectedRevision, c.nodeId, c.expectedText, c.text); break;
        case 'drafts.save': value = await this.drafts.save(c.draftId, c.expectedRevision, c.nativeState); break;
        case 'variants.list': value = await this.variants.list(c.target, c.mainWorkItemId); break;
        case 'variants.roles': value = await this.variants.roles(c.target); break;
        case 'variants.create': value = await this.variants.create({target:c.target,mainWorkItemId:c.mainWorkItemId,label:c.label,title:c.title,copy:c.copy,role:c.role}); break;
        case 'variants.rename': value = await this.variants.rename(c.variantId, c.label); break;
        case 'variants.link': value = await this.variants.link(c.variantId); break;
        case 'variants.unlink': value = await this.variants.unlink(c.variantId); break;
        case 'variants.open': value = await this.variants.open(c.variantId); break;
        case 'variants.preview': value = await this.variants.preview(c.variantId); break;
        case 'variants.apply': value = await this.variants.apply(c.variantId); break;
        case 'variants.undo': value = await this.variants.undo(c.applyId); break;
        case 'variants.details.read': value = await this.variants.details(c.target, c.variantId); break;
        case 'variants.details.write': value = await this.variants.saveDetails(c.target, c.variantId, c.details); break;
      }
      return { protocol: 1, id, ok: true, value };
    } catch (error) { return { protocol: 1, id, ok: false, error: safeError(error) }; }
  }
}
