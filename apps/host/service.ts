import { Store } from './store.ts';
import { Drafts, Polarion } from './polarion.ts';
import { Engines, safeError } from './engine.ts';
import { Capabilities } from './capabilities.ts';
import { Assets } from './assets.ts';
import {Boards} from './boards.ts';
import {Variants} from './variants.ts';
import {Changes} from './changes.ts';
import {Credentials} from './credentials.ts';
import {Workflows, localDay} from './workflows.ts';
import {ReqTemplates} from './templates.ts';
import {Model, scanModelRoot} from './model.ts';
import {Coverage} from './coverage.ts';
import {Rules} from './rules.ts';
import {Proposals} from './proposals.ts';
import {validateGuideline} from './guidelines.ts';
import {pickFolder, pickFiles} from './dialogs.ts';
import {buildTestCard, sendCardToGroups, buildMorningCard, buildReviewCard} from './feishu.ts';
import {Events} from './events.ts';
import {Gates} from './gates.ts';
import {Reviews} from './reviews.ts';
import {Meetings} from './meeting.ts';
import {Worksets} from './worksets.ts';
import {Macros} from './macros.ts';
import {sweepStalledRecords} from './stall-guard.ts';
import {Snapshots} from './snapshots.ts';
import {readExperience, writeExperience, clearExperience, conversationDigest, distillExperience, refineExperience} from './experience.ts';
import { RequestSchema, PROTOCOL, PROJECT_EVENT_LIMIT, TargetSchema, normalizeGuideline, isInboxPendingProposal, openReviewIssues, type Reply, type Run, type Session, type SessionGroup, type DocumentQualityReport, type BriefConfig, type DashboardView, type TimelineView } from '../../packages/protocol/index.ts';
import { lintText } from '../../packages/core/requirement-lint.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';
import { richSchema } from '../../packages/core/rich-schema.ts';
export class Service {
  store: Store; drafts: Drafts; engines: Engines;
  capabilities: Capabilities;
  assets: Assets;
  variants: Variants;
  changes: Changes;
  model: Model;
  coverage: Coverage;
  events: Events;
  gates: Gates;
  snapshots: Snapshots;
  reviews: Reviews;
  meetings: Meetings;
  worksets: Worksets;
  macros: Macros;
  rules: Rules;
  proposals: Proposals;
  workflows: Workflows;
  templates: ReqTemplates;
  credentials?: Credentials;
  constructor(store: Store, drafts?: Drafts) { this.store = store; this.assets = new Assets(store); this.drafts = drafts ?? new Drafts(store, new Polarion(this.assets)); this.engines = new Engines(store, this.drafts, this.assets); this.capabilities = new Capabilities(store); this.variants = new Variants(store, this.drafts, this.assets); this.changes = new Changes(store, this.drafts, this.assets); this.rules = new Rules(store, this.drafts); this.model = new Model(store, this.drafts); this.coverage = new Coverage(store, this.drafts, this.model); this.events = new Events(store); this.gates = new Gates(store, this.rules); this.reviews = new Reviews(store); this.meetings = new Meetings(store); this.snapshots = new Snapshots(store, this.coverage, this.gates, this.reviews); this.worksets = new Worksets(store); this.macros = new Macros(store, this.engines); this.engines.reviews = this.reviews; this.engines.meetings = this.meetings; this.reviews.engines = this.engines; this.meetings.engines = this.engines; this.proposals = new Proposals(store, this.drafts, this.changes); this.engines.proposals = this.proposals; this.workflows = new Workflows(store); this.workflows.proposals = this.proposals; this.workflows.engines = this.engines; this.engines.workflows = this.workflows; this.templates = new ReqTemplates(store); this.templates.drafts = this.drafts; this.engines.templates = this.templates; }
  async request(input: unknown): Promise<Reply> {
    // 解析失败也要带回请求 id，否则客户端只能等 100 秒超时，看不到具体校验错误。
    let id = input && typeof input === 'object' && typeof (input as { id?: unknown }).id === 'string' ? String((input as { id?: unknown }).id) : '';
    try {
      const request = RequestSchema.parse(input); id = request.id; const c = request.command; let value: unknown;
      switch (c.method) {
        case 'health': value = { protocol: PROTOCOL, version: '0.13.3', pid: process.pid, running: this.engines.active.size, codex: 'not-integrated', writeScope: 'explicit-user-save-with-readback', scopedQualityRewrite: true }; break;
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
        case 'sessions.read': value = { session: this.store.require<Session>('session', c.sessionId), runs: this.store.list<Run>('run').filter(r => r.sessionId === c.sessionId).sort((a, b) => a.startedAt - b.startedAt).map(({ contexts, prompt, ...r }) => r), events: this.store.events(c.sessionId, c.after), workflow: this.workflows.viewOf(c.sessionId) }; break;
        case 'runs.start': value = this.launchRun(this.store.startRun(c.sessionId, c.requestId, c.prompt, c.contexts, c.target, c.attachments, c.permissionMode, c.delivery, c.guidelineId, undefined, c.autoSave, c.qualityRewrite)); break;
        case 'runs.inspectQuality': {
          const prompt = `只读深检 ${c.snapshot.workItemId}「${c.title}」。分析版本为${c.sourceLabel}。`;
          value = this.launchRun(this.store.startRun(c.sessionId, c.requestId, prompt, [c.snapshot], c.snapshot.target, [], undefined, 'queue', undefined, undefined, false, 'inspect'));
          break;
        }
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
        case 'runs.retryQualityInspection':
        case 'runs.retry': {
          const prior = this.store.require<Run>('run', c.runId);
          if (c.method === 'runs.retryQualityInspection' && !prior.qualityInspection) throw Error('此任务没有只读深检快照，请从编辑器重新深检。');
          const attachments = (prior.attachments ?? []).filter(id => this.store.get('asset', id));
          const guidelineId = prior.guidelineId && this.store.get('guideline', prior.guidelineId) ? prior.guidelineId : undefined;
          value = this.launchRun(this.store.startRun(prior.sessionId, c.requestId, prior.prompt, prior.contexts, prior.target, attachments, prior.permissionMode, 'queue', guidelineId, undefined, prior.autoSave, prior.qualityInspection ? 'inspect' : prior.qualityRewrite));
          break;
        }
        case 'runs.cancel': this.engines.cancel(c.runId); value = { requested: true }; break;
        case 'runs.steer': value = this.engines.steerQueued(c.runId); break;
        case 'experience.read': value = readExperience(c.projectId); break;
        case 'experience.write': value = writeExperience(c.projectId, c.text, undefined, c.expectedUpdated); break;
        case 'experience.clear': value = clearExperience(c.projectId); break;
        case 'experience.refine': value = await refineExperience({ text: c.text, messages: c.messages, model: c.model }); break;
        case 'experience.distill': {
          const s = this.store.require<Session>('session', c.sessionId);
          const digest = conversationDigest(this.store, c.sessionId);
          if (!digest.trim()) throw Error('EXPERIENCE_NO_CONVERSATION');
          const text = await distillExperience({ digest, existing: readExperience(s.target.projectId).text, model: s.model || undefined });
          value = writeExperience(s.target.projectId, text); break;
        }
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
        case 'changes.record.preview': value = await this.changes.preview(c.recordId); break;
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
        case 'drafts.reconcile': value = await this.drafts.reconcile(c.draftId, c.expectedRevision); break;
        case 'drafts.conflict.read': value=await this.drafts.conflictRead(c.draftId);break;
        case 'drafts.conflict.resolve': value=await this.drafts.resolveConflict(c.draftId,c.expectedRevision,c.remoteHash,c.remoteUpdated,c.strategy);break;
        case 'drafts.replaceText': value = this.drafts.replace(c.draftId, c.expectedRevision, c.nodeId, c.expectedText, c.text); break;
        case 'drafts.save': {
          const { wroteToPolarion, ...saved } = await this.drafts.save(c.draftId, c.expectedRevision, c.nativeState);
          if (wroteToPolarion) this.events.record(saved.target.projectId, 'save', `${saved.workItemId} 保存到 Polarion`, { workItemId: saved.workItemId, detail: `修订 ${saved.revision}` });
          value = saved; break;
        }
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
        case 'workflows.list': value = this.workflows.defs(c.projectId); break;
        case 'workflows.save': value = this.workflows.saveDef(c.def); break;
        case 'workflows.delete': value = this.workflows.removeDef(c.id); break;
        case 'workflows.run': value = this.workflows.run(c.defId, c.sessionId, c.target, c.contexts, c.permissionMode, c.note); break;
        case 'workflows.resume': value = this.workflows.resume(c.id); break;
        case 'workflows.cancel': value = this.workflows.cancel(c.id); break;
        case 'workflows.plan': value = this.workflows.plan(c.sessionId, c.target, c.contexts, c.permissionMode, c.goal); break;
        case 'workflows.keep': value = this.workflows.keep(c.id, c.name); break;
        case 'workflows.history': value = this.workflows.history(c.projectId, c.limit); break;
        case 'workflows.seed': value = this.workflows.seedTemplates(c.projectId); break;
        case 'workflows.schedule': value = this.workflows.schedule(c.id, c.scheduleAt, c.target); break;
        case 'workflows.runBatch': value = this.workflows.runBatch(c.target, c.defId, c.workItemIds, c.permissionMode, c.note); break;
        case 'templates.list': value = { items: await this.templates.list(c.target.origin), ensureErrors: this.templates.lastEnsureErrors }; break;
        case 'templates.read': value = await this.templates.read(c.target.origin, c.templateId); break;
        case 'templates.reset': value = await this.templates.reset(c.target.origin, c.templateId); break;
        case 'templates.createCustom': value = await this.templates.createCustom(c.target.origin, c.title, c.category, c.html); break;
        case 'templates.instantiate': value = await this.templates.instantiate(c.target, c.templateId, c.title, c.anchorWorkItemId); break;
        case 'templates.apply': value = await this.templates.apply(c.target, c.workItemId, c.templateId); break;
        case 'model.roots': value = await this.model.roots(c.target); break;
        case 'model.roots.save': value = await this.model.rootsSave(c.target, c.roots, c.expectedUpdated); break;
        case 'model.roots.bind': value = this.model.bindLocal(c.target, c.rootId, c.path); break;
        case 'model.roots.scan': value = scanModelRoot(c.path); break;
        case 'model.note.read': value = await this.model.noteRead(c.target, c.workItemId); break;
        case 'model.platform.get': value = this.model.platformCatalog(); break;
        case 'model.platform.save': value = this.model.savePlatformCatalog(c.modules); break;
        case 'model.roots.forNote': value = await this.model.viewRoots(c.target); break;
        case 'model.note.write': { const written = await this.model.noteWrite(c.target, c.workItemId, c.note); this.events.record(c.target.projectId, 'note', `${c.workItemId} 更新实现模块备注`, { workItemId: c.workItemId, detail: `${c.note.marks.reduce((count, mark) => count + mark.modules.length, 0)} 个模块` }); value = written; break; }
        case 'model.index.sync': value = await this.model.indexSync(c.target, c.query); break;
        case 'model.trace.view': value = await this.model.traceView(c.target); break;
        case 'model.baseline.set': { const view = await this.model.baselineSet(c.target, c.rootId); this.events.record(c.target.projectId, 'check', `模型基准已设定（${view.checkedFiles} 个文件指纹）`); value = view; break; }
        case 'model.check': { const view = await this.model.check(c.target, c.rootId); if (!view.ok) this.events.record(c.target.projectId, 'watcher', `巡检发现 ${view.findings.length} 项差异`, { detail: `${view.changedFiles} 个文件变化` }); value = view; break; }
        case 'model.baseline.list': value = this.model.baselines(c.projectId); break;
        case 'model.autolink': {
          const session = this.store.require<Session>('session', c.sessionId);
          if (session.target.projectId !== c.target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
          const { prompt, count } = this.model.autolinkPrompt(c.target);
          const result = this.store.startRun(c.sessionId, crypto.randomUUID(), prompt, structuredClone(c.contexts), c.target, [], c.permissionMode, 'queue', undefined, { workflowRunId: '', defName: '模型初关联', stepIndex: 0, stepTotal: 1, stepTitle: `初关联 ${count} 条` });
          if (result.created) { if (result.run.status === 'queued') this.engines.pump(c.sessionId); else void this.engines.execute(result.run); }
          value = { runId: result.run.id, count };
          break;
        }
        case 'coverage.sync': value = await this.coverage.sync(c.target); break;
        case 'coverage.view': value = this.coverage.view(c.target); break;
        case 'dedup.search': value = this.coverage.dedup(c.target, c.text, c.limit, c.exclude); break;
        case 'impact.view': value = this.coverage.impact(c.target, c.workItemId); break;
        case 'rules.get': value = await this.rules.read(c.target, c.refresh); break;
        case 'rules.save': value = await this.rules.save(c.target, c.pack, c.expectedUpdated); break;
        case 'quality.document.last': value = this.store.get<DocumentQualityReport>('quality-report', c.target.projectId) ?? null; break;
        case 'quality.document.check': {
          const report = await this.documentQuality(c.target, c.limit);
          this.store.put('quality-report', c.target.projectId, report);
          this.events.record(c.target.projectId, 'lint', `整册体检：${report.checked - report.clean} 条有发现`, { detail: `已查 ${report.checked}/${report.total} · 规则来源 ${report.ruleSource}` });
          value = report;
          break;
        }
        case 'gates.view': value = await this.gates.view(c.target); break;
        case 'gates.policy.get': value = this.gates.policy(c.projectId); break;
        case 'gates.policy.save': value = this.gates.savePolicy(c.projectId, c.policy); break;
        case 'snapshots.save': value = await this.snapshots.save(c.target, c.label); break;
        case 'snapshots.list': value = this.snapshots.list(c.projectId, c.limit); break;
        case 'snapshots.diff': value = this.snapshots.diff(c.target); break;
        case 'review.start': value = this.reviews.start(c.sessionId, c.target, c.contexts, c.permissionMode); break;
        case 'review.list': value = this.reviews.list(c.target); break;
        case 'review.decide': value = this.reviews.decide(c.id, c.issueId, c.decision); break;
        case 'review.share': {
          const review = this.reviews.require(c.id);
          const groupsView = await this.changes.feishuGroups(c.target).catch(() => null);
          const groups = groupsView?.groups ?? [];
          if (!groups.length) throw Error('REVIEW_SHARE_NO_GROUPS：未配置飞书推送群（PSB-FEISHU）。');
          const open = review.issues.filter(issue => issue.status === 'open');
          value = { results: await sendCardToGroups(groups, buildReviewCard({ projectId: c.target.projectId, document: review.document, at: review.at, issues: open })), sent: open.length };
          this.events.record(c.target.projectId, 'lint', `AI 预审汇总已发送（未决 ${open.length} 条）`);
          break;
        }
        case 'worksets.list': value = this.worksets.list(c.projectId); break;
        case 'worksets.save': value = this.worksets.save(c.target, { ...(c.id ? { id: c.id } : {}), name: c.name, kind: c.kind, query: c.query }); break;
        case 'worksets.delete': value = this.worksets.remove(c.id); break;
        case 'worksets.items': value = await Promise.resolve(this.worksets.items(c.target, c.id)); break;
        case 'dashboard.view': value = this.dashboardView(c.target); break;
        case 'macros.list': value = this.macros.list(c.projectId); break;
        case 'macros.capture': value = this.macros.capture(c.sessionId, c.name, c.count); break;
        case 'macros.delete': value = this.macros.remove(c.id); break;
        case 'macros.run': value = this.macros.run(c.sessionId, c.id, c.target, c.contexts, c.permissionMode); break;
        case 'macros.schedule': value = this.macros.schedule(c.id, c.scheduleAt, c.target); break;
        case 'timeline.view': value = this.timelineView(c.target, c.workItemId); break;
        case 'evidence.markdown': value = await this.evidenceMarkdown(c.target, c.workItemId); break;
        case 'meeting.triage': value = this.meetings.start(c.sessionId, c.target, c.contexts, c.permissionMode, c.text); break;
        case 'meeting.list': value = this.meetings.list(c.target); break;
        case 'meeting.decide': value = this.meetings.decide(c.id, c.actionId, c.decision); break;
        case 'events.list': value = this.events.list(c.projectId, c.limit); break;
        case 'watch.view': value = this.events.watch(c.target); break;
        case 'brief.preview': value = await this.composeBrief(c.target); break;
        case 'brief.send': value = await this.sendBrief(c.target); break;
        case 'brief.toggle': {
          const config = this.store.get<BriefConfig & { id?: string; document?: string }>('brief-config', c.target.projectId) ?? { enabled: false, at: '07:30' };
          const next: BriefConfig & { id: string; document: string } = { ...config, enabled: c.enabled, id: c.target.projectId, document: config.document && config.id === c.target.projectId ? config.document : c.target.document };
          this.store.put('brief-config', c.target.projectId, next);
          value = next;
          break;
        }
        case 'proposals.list': value = this.proposals.list(c.target); break;
        case 'proposals.create': value = this.proposals.create({ source: c.source, target: c.target, workItemId: c.workItemId, summary: c.summary, op: c.op }); break;
        case 'proposals.approve': { const result = await this.proposals.approve(c.id, c.nativeState); this.events.record(result.proposal.target.projectId, 'proposal', `提案已处理：${result.proposal.status === 'applied' ? '已应用' : result.proposal.status}`, { workItemId: result.proposal.workItemId, detail: result.proposal.summary }); value = result; break; }
        case 'proposals.reject': { const proposal = this.proposals.reject(c.id); this.events.record(proposal.target.projectId, 'proposal', '提案已拒绝', { workItemId: proposal.workItemId, detail: proposal.summary }); value = proposal; break; }
      }
      return { protocol: 1, id, ok: true, value };
    } catch (error) { return { protocol: 1, id, ok: false, error: safeError(error) }; }
  }

  private launchRun({run, created}: ReturnType<Store['startRun']>) {
    if (!created) return run;
    if (run.status === 'queued') {
      if (run.delivery === 'steer') this.engines.steer(run.sessionId, run.id);
      this.engines.pump(run.sessionId);
    } else void this.engines.execute(run);
    return run;
  }

  /** 按大纲读取每条完整正文，包含尚未保存的本地修改。 */
  private async documentQuality(target: import('../../packages/protocol/index.ts').Target, limit: number): Promise<DocumentQualityReport> {
    if (!(this.drafts.remote instanceof Polarion) || !this.drafts.remote.outline) throw Error('POLARION_UNAVAILABLE');
    const outline = await this.drafts.remote.outline(target);
    const rules = await this.rules.read(target, false);
    const byRule = new Map<string, number>();
    const report: DocumentQualityReport = { document: target.document, at: Date.now(), total: outline.items.length, checked: 0, clean: 0, items: [], byRule: [], ruleSource: rules.source };
    for (const item of outline.items.slice(0, limit)) {
      report.checked++;
      try {
        const body = await this.drafts.readOnly(target, item.id);
        const doc = richSchema.nodeFromJSON(new RichDocument(body.html).document);
        const text = doc.textBetween(0, doc.content.size, '\n', '\n');
        const issues = lintText(`${body.title}\n${text}`, rules.pack).map(({ ruleId, severity, message, matchedText, suggestion }) => ({ ruleId, severity, message, matchedText, ...(suggestion ? { suggestion } : {}) }));
        if (!issues.length) report.clean++;
        for (const issue of issues) byRule.set(issue.ruleId, (byRule.get(issue.ruleId) ?? 0) + 1);
        report.items.push({ workItemId: item.id, title: body.title || item.title, outline: item.outline, issues, ...(body.readOnlyReference ? { readOnlyReference: true } : {}) });
      } catch { report.items.push({ workItemId: item.id, title: item.title, outline: item.outline, issues: [], unreadable: true }); }
    }
    report.byRule = [...byRule.entries()].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count);
    return report;
  }

  /** 晨报素材：整册体检 + 各根目录巡检（有基准才查）+ 待审批数 → 卡片与文本摘要。 */
  private async composeBrief(target: import('../../packages/protocol/index.ts').Target): Promise<{ card: ReturnType<typeof buildMorningCard>; digest: string; quality: DocumentQualityReport; checks: { label: string; ok: boolean; changedFiles: number; findings: number; modules: string[] }[] }> {
    const [quality, rootsView] = await Promise.all([
      this.documentQuality(target, 200).catch(() => ({ at: Date.now(), total: 0, checked: 0, clean: 0, items: [], byRule: [], ruleSource: 'default' as const })),
      this.model.roots(target),
    ]);
    const checks: { label: string; ok: boolean; changedFiles: number; findings: number; modules: string[] }[] = [];
    for (const root of rootsView.roots.filter(row => row.path)) {
      try {
        const view = await this.model.check(target, root.id);
        if (view.baselineAt != null) checks.push({ label: root.label, ok: view.ok, changedFiles: view.changedFiles, findings: view.findings.length, modules: view.findings.filter(finding => finding.side !== 'requirement').map(finding => finding.moduleName) });
      } catch { /* 未绑定/不可读的根跳过 */ }
    }
    const pendingProposals = this.proposals.list(target).filter(isInboxPendingProposal).length;
    const qualitySummary = { checked: quality.checked, clean: quality.clean, findings: quality.checked - quality.clean, topRules: quality.byRule.slice(0, 4) };
    const card = buildMorningCard({ projectId: target.projectId, document: target.document, at: Date.now(), quality: qualitySummary, checks, pendingProposals });
    const digest = [
      `质量体检：${qualitySummary.checked ? `${qualitySummary.checked} 条中 ${qualitySummary.findings} 条有发现${qualitySummary.topRules.length ? `（${qualitySummary.topRules.map(rule => `${rule.ruleId}×${rule.count}`).join('、')}）` : ''}` : '未执行'}`,
      `模型一致性：${checks.length ? checks.map(check => `${check.label}${check.ok ? '一致' : `${check.changedFiles} 文件变化、${check.findings} 模块需关注`}`).join('；') : '未设基准'}`,
      `待办：待审批提案 ${pendingProposals} 条`,
    ].join('\n');
    return { card, digest, quality, checks };
  }

  /** 手动发送和每日定时都以接收端的逐群回执记录结果。 */
  private async sendBrief(target: import('../../packages/protocol/index.ts').Target, scheduled = false) {
    const { card, digest } = await this.composeBrief(target);
    const groups = (await this.changes.feishuGroups(target)).groups;
    const label = scheduled ? '定时晨报' : '晨报';
    if (!groups.length) {
      const reason = '未配置飞书推送群（PSB-FEISHU）';
      if (scheduled) this.events.record(target.projectId, 'brief', `${label}跳过：${reason}`);
      return { card, digest, sent: false, reason };
    }
    const results = await sendCardToGroups(groups, card);
    const failed = results.filter(result => !result.ok);
    const delivered = results.length - failed.length;
    const status = !failed.length ? '已发送' : delivered ? '部分发送成功' : '发送失败';
    const summary = `${label}${status}（${delivered}/${results.length} 个群）`;
    this.events.record(target.projectId, 'brief', summary);
    const reason = failed.length ? `${summary}：${failed.map(group => `${group.label}（${group.error}）`).join('、')}` : undefined;
    return { card, digest, sent: delivered > 0, results, reason };
  }

  /** 每日晨报定时：按项目配置（brief-config）到点触发；当天已发不重复。 */
  private briefTimer: NodeJS.Timeout | undefined;
  startBriefScheduler() {
    if (this.briefTimer) return;
    try { const sweep = sweepStalledRecords(this.store, id => this.engines.isActiveRun(id)); for (const run of sweep.completed) { this.reviews.complete(run); this.meetings.complete(run); } } catch { /* 启动自愈失败不阻断服务 */ }
    this.briefTimer = setInterval(() => { void this.morningTick(); }, 60_000);
    this.briefTimer.unref();
  }
  /** 仪表盘：聚合提案/警报/体检/覆盖/工作流/事件/工作集/评审，数字即可点入对应视图。 */
  private dashboardView(target: import('../../packages/protocol/index.ts').Target): DashboardView {
    const quality = this.store.get<DocumentQualityReport>('quality-report', target.projectId);
    const coverage = this.coverage.view(target);
    const alerts = this.events.watch(target).alerts.filter(alert => alert.level === 'warn').length;
    return {
      pendingProposals: this.proposals.list(target).filter(isInboxPendingProposal).length,
      alerts,
      quality: quality ? { checked: quality.checked, findings: quality.checked - quality.clean, byRule: quality.byRule.slice(0, 5) } : null,
      coverage: coverage.at || coverage.items.length ? { total: coverage.items.length, withModule: coverage.summary.withModule, withUpstream: coverage.summary.withUpstream, withVerification: coverage.summary.withVerification, orphans: coverage.summary.orphans } : null,
      workflows: this.workflows.defs(target.projectId).length,
      events: this.events.list(target.projectId, PROJECT_EVENT_LIMIT).length,
      worksets: this.worksets.list(target.projectId).length,
      briefEnabled: (this.store.get<BriefConfig>('brief-config', target.projectId)?.enabled) ?? false,
      reviewOpen: this.reviews.list(target).reduce((count, review) => count + openReviewIssues(review).length, 0),
    };
  }

  /** 时间线：事件流按时间倒序；带 workItemId 时过滤出“一条需求的一生”。 */
  private timelineView(target: import('../../packages/protocol/index.ts').Target, workItemId?: string): TimelineView {
    const entries = this.events.list(target.projectId, 400)
      .filter(event => !workItemId || event.workItemId === workItemId)
      .map(event => ({ at: event.at, kind: event.kind, subject: event.subject, ...(event.workItemId ? { workItemId: event.workItemId } : {}), ...(event.detail ? { detail: event.detail } : {}) }));
    return { scope: workItemId ? 'item' : 'project', ...(workItemId ? { workItemId } : {}), entries };
  }

  /** 证据链 Markdown：需求摘要 + 模块（含疑似过期）+ 链接 + 巡检/事件史，供评审与交接引用。 */
  private async evidenceMarkdown(target: import('../../packages/protocol/index.ts').Target, workItemId: string): Promise<{ markdown: string }> {
    const impact = this.coverage.impact(target, workItemId);
    const timeline = this.timelineView(target, workItemId).entries;
    const lines: string[] = [
      `# 证据链 · ${workItemId} ${impact.title}`,
      ``,
      `- 项目：${target.projectId} · 文档：${target.document}`,
      `- 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })} · 覆盖索引：${impact.coverageAt ? new Date(impact.coverageAt).toLocaleString('zh-CN', { hour12: false }) : '未构建'}`,
      ``,
      `## 实现模块（${impact.modules.length}）`,
      ...(impact.modules.length ? impact.modules.map(module => `- ${module.rootLabel} / ${module.moduleName}${module.stale ? ' · **疑似过期**（基准后模型侧有变化）' : ''}`) : ['- （未标注）']),
      ``,
      `## 上游 / 下游 / 验证`,
      `- 上游：${impact.upstream.length ? impact.upstream.map(link => `${link.workItemId}(${link.role})`).join('、') : '无'}`,
      `- 下游：${impact.downstream.length ? impact.downstream.map(link => `${link.workItemId}(${link.role})`).join('、') : '无'}`,
      `- 验证：${impact.verification.length ? impact.verification.map(link => `${link.workItemId}(${link.role})`).join('、') : '无'}`,
      ``,
      `## 历史轨迹（${timeline.length} 条）`,
      ...(timeline.length ? timeline.map(entry => `- ${new Date(entry.at).toLocaleString('zh-CN', { hour12: false })} [${entry.kind}] ${entry.subject}`) : ['- （暂无记录：保存、提案、备注、巡检会自动累积）']),
    ];
    if (impact.staleCount) lines.push('', `> ⚠ ${impact.staleCount} 个关联模块在基准后变化过，建议做一次一致性巡检并复验本条。`);
    return { markdown: lines.join('\n') };
  }

  private briefRunning = false;
  private async morningTick() {
    if (this.briefRunning) return;
    this.briefRunning = true;
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const today = localDay(now);
      // 旧 Host 用 UTC 日期命名回执。升级当天仍承认本地今天已执行的那次投递。
      const legacyDay = now.toISOString().slice(0, 10);
      const configs = this.store.list<BriefConfig & { id?: string; document?: string }>('brief-config').filter(config => config.enabled && config.id && config.document);
      for (const config of configs) {
        if (config.at !== hhmm) continue;
        const marker = `brief-sent:${config.id}:${today}`;
        const alreadyAttempted = [marker, `brief-sent:${config.id}:${legacyDay}`].some(key => {
          const previous = this.store.get<{ at: number }>('brief-sent', key);
          return previous && localDay(new Date(previous.at)) === today;
        });
        if (alreadyAttempted) continue;
        this.store.put('brief-sent', marker, { at: now.getTime() });
        try {
          const target = TargetSchema.parse({ origin: 'https://polarion.pufafen.com', projectId: config.id, document: config.document });
          await this.sendBrief(target, true);
        } catch (error) {
          this.events.record(config.id!, 'brief', `定时晨报失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // 每日定时宏：到点对目标文档所在项目重放（当天去重）。
      for (const macro of this.macros.due(now)) {
        this.store.put('macro-sent', macro.marker, { at: Date.now() });
        try {
          const target = TargetSchema.parse({ origin: 'https://polarion.pufafen.com', projectId: macro.projectId, document: macro.document! });
          const session = this.store.list<Session>('session').filter(row => row.target.projectId === macro.projectId).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? this.store.createSession(target, `定时宏 · ${macro.name}`);
          const started = this.macros.run(session.id, macro.id, target, [], 'auto');
          this.events.record(macro.projectId, 'brief', `定时宏「${macro.name}」已触发（${started.started} 条指令）`);
        } catch (error) {
          this.events.record(macro.projectId, 'brief', `定时宏「${macro.name}」失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // 停滞自愈：评审/分诊记录卡在 running（run 丢失/终态/引擎已不在跑）时复位，避免 UI 永远“预审中”。
      try {
        const sweep = sweepStalledRecords(this.store, id => this.engines.isActiveRun(id));
        for (const run of sweep.completed) { this.reviews.complete(run); this.meetings.complete(run); }
        for (const failed of sweep.failed) {
          const projectId = (this.store.get<{ projectId: string }>(failed.collection, failed.id)?.projectId) ?? '';
          if (projectId) this.events.record(projectId, 'brief', `AI 任务中断已复位（${failed.collection === 'review-record' ? '预审' : '会议分诊'} · ${failed.reason}）`);
        }
      } catch { /* 自愈失败不影响其他定时任务 */ }
      // 每日定时工作流：到点对该项目最近会话运行（当天去重）。
      // 遍历所有有工作流定义的项目（此前误写 defs('*') 恒为空，工作流定时从未触发）。
      const workflowProjects = new Set(this.store.list<{ projectId: string }>('workflow-def').map(def => def.projectId));
      for (const project of workflowProjects) {
        for (const def of this.workflows.dueWorkflow(now, project)) {
          this.store.put('workflow-sent', def.marker, { at: Date.now() });
          try {
            const target = TargetSchema.parse({ origin: 'https://polarion.pufafen.com', projectId: def.projectId, document: def.document! });
            const session = this.store.list<Session>('session').filter(row => row.target.projectId === def.projectId).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? this.store.createSession(target, `定时工作流 · ${def.name}`);
            this.workflows.run(def.id, session.id, target, [], 'auto', '定时触发');
            this.events.record(def.projectId, 'brief', `定时工作流「${def.name}」已触发`);
          } catch (error) {
            this.events.record(def.projectId, 'brief', `定时工作流「${def.name}」失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } finally { this.briefRunning = false; }
  }
}
