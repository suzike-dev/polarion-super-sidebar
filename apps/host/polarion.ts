import {formatDocument, type TextFormat} from '../../packages/core/format-document.ts';
import {applyTableOperations, listTables, replaceTableJson, tableJsonAt, type TableOperation} from '../../packages/core/table-ops.ts';
import {restyleDocument, type RestyleRules} from '../../packages/core/restyle.ts';
import {applyBlockOperations, type BlockOperation} from '../../packages/core/block-ops.ts';
import {replaceAllText, replaceGlossaryMatches} from '../../packages/core/replace-all.ts';
import {isSingleQualitySentence, qualitySentence, staleQualityFinding, type TextMatch} from '../../packages/core/editor-text.ts';
import {richSchema} from '../../packages/core/rich-schema.ts';
import type {QualityRewrite} from '../../packages/protocol/index.ts';
import {equivalentHtml, matchesPolarionReadback} from '../../packages/core/html-equivalence.ts';
import {polarionWriteHtml} from '../../packages/core/polarion-html.ts';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './paths.ts';
import type { Draft, Target, Variant, VariantScope, DocumentOutline } from '../../packages/protocol/index.ts';
import { sameTarget } from '../../packages/protocol/index.ts';
import { LosslessHtml } from '../../packages/core/lossless-html.ts';
import { Store } from './store.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';
import type { JSONContent } from '@tiptap/core';
import { Assets } from './assets.ts';
import {Boards} from './boards.ts';
import { requireResolvedWorkItem, requireWorkItemId, type WorkItemIdentity } from './variant-access.ts';
type RichSession = { id: string; draftId: string; source: string; revision: number; imageAliases?:Record<string,string>;saved?:boolean };
export type RemoteItem = { id: string; title: string; description?: string; updated?: string; status?: string; type?: string; attachments?: {id?: string; file_name?: string; title?: string}[]; submittedHtml?: string; uploadedAssets?: {localId:string;attachmentId:string;sha256:string}[] };
type ProjectItemPreview = { workItemId: string; title: string; description?: string; updated?: string };
export type RemoteLink = { workItemId: string; role: string };
/** 变更基准快照：一次取出整篇文档的工作项正文，避免逐项 SOAP 往返。 */
export type SnapshotItem = { id: string; title: string; type: string; status: string; outline: string; created?: string; updated: string; html: string };
export type BulkSnapshot = { documentTitle: string; items: SnapshotItem[] };
export type HistoryChange = {revision: string; date: string; user?: {id?: string; name?: string}; diffs: {field: string; before?: unknown; after?: unknown}[]};
export type ChangeRemoteRow = { workItemId: string; title: string; description: string; created: string; updated: string; author?: {id?: string; name?: string}; type: string; status: string; attachments?: {id?: string; file_name?: string; title?: string}[] };
export type ChangeWriteInput = {
  target: Target;
  workItemId?: string;
  expectedUpdated?: string;
  type?: string;
  title: string;
  description: string;
  fileName: string;
  attachmentTitle: string;
  dataBase64: string;
  removeAttachments?: string[];
};
export type ChangeWriteResult = { workItemId: string; updated: string; attachmentId: string; uri: string };
export interface Remote {
  read(target: Target, workItemId: string, scope?: VariantScope): Promise<RemoteItem>;
  /** 当前文档全部工作项的轻量清单，供需求总览一次取全。 */
  outline?(target: Target): Promise<DocumentOutline>;
  /** 整篇文档的正文快照，供变更管理设定基准/结束比对。 */
  bulkRead?(target: Target): Promise<BulkSnapshot>;
  /** 单个工作项的字段级历史，用于按时间点还原正文。 */
  history?(target: Target, workItemId: string): Promise<HistoryChange[]>;
  /** 项目级变更记录工作项（按项目查询，天然隔离）；query 可复用为其它项目级工作项（如 PSB-FEISHU）。 */
  changeList?(target: Target, limit: number, query?: string): Promise<ChangeRemoteRow[]>;
  changeRead?(target: Target, workItemId: string, fileName: string): Promise<{workItemId: string; attachmentId: string; dataBase64: string; updated: string}>;
  changeWrite?(input: ChangeWriteInput): Promise<ChangeWriteResult>;
  changeDelete?(target: Target, workItemId: string, expectedUpdated?: string): Promise<{deleted: boolean}>;
  search?(target: Target, query: string, limit: number): Promise<{ workItemId: string; title: string }[]>;
  save(draft: Draft, scope?: VariantScope, overwrite?: boolean): Promise<RemoteItem>;
  image?(target: Target, workItemId: string, src: string, scope?: VariantScope): Promise<unknown>;
  create?(target: Target, title: string, type: string): Promise<RemoteItem>;
  peek?(target: Target, workItemId: string): Promise<ProjectItemPreview>;
  link?(target: Target, sourceWorkItemId: string, targetWorkItemId: string, role: string): Promise<{verified:boolean}>;
  unlink?(target: Target, sourceWorkItemId: string, targetWorkItemId: string, role: string): Promise<{verified:boolean}>;
  roles?(target: Target): Promise<{id:string;name?:string;hidden?:boolean}[]>;
  backLinks?(target: Target, mainWorkItemId: string): Promise<RemoteLink[]>;
  rename?(target: Target, workItemId: string, title: string, expectedUpdated: string, scope?: VariantScope): Promise<RemoteItem>;
  metadataRead?(target: Target, workItemId: string, scope?: VariantScope, name?: string): Promise<Record<string, unknown> | null>;
  metadataWrite?(target: Target, workItemId: string, details: Record<string, unknown>, scope?: VariantScope, name?: string): Promise<{verified: boolean; updated?: string}>;
  board?(target: Target, workItemId: string, src: string, scope?: VariantScope): Promise<{manifest: unknown; source: string; preview: string}>;
  modelNoteRead?(target: Target, workItemId: string): Promise<{note: unknown}>;
  modelNoteWrite?(target: Target, workItemId: string, note: unknown): Promise<{verified: boolean; updated?: string}>;
  modelNotes?(target: Target, query: string): Promise<{items: {workItemId: string; title: string; type: string; updated: string; marks: {rootId: string; modules: string[]}[]}[]; total: number; partial?: boolean}>;
}
export class Polarion implements Remote {
  async outline(target: Target): Promise<DocumentOutline> {
    return this.call<DocumentOutline>({ method: 'outline', target });
  }
  bulkRead(target: Target): Promise<BulkSnapshot> {
    return this.call<BulkSnapshot>({ method: 'bulkRead', target });
  }
  history(target: Target, workItemId: string): Promise<HistoryChange[]> {
    return this.call<HistoryChange[]>({ method: 'history', target, workItemId });
  }
  changeList(target: Target, limit: number, query?: string): Promise<ChangeRemoteRow[]> {
    return this.call<ChangeRemoteRow[]>({ method: 'change.list', target, limit, ...(query ? {query} : {}) });
  }
  changeRead(target: Target, workItemId: string, fileName: string) {
    return this.call<{workItemId: string; attachmentId: string; dataBase64: string; updated: string}>({ method: 'change.read', target, workItemId, fileName });
  }
  changeWrite(input: ChangeWriteInput): Promise<ChangeWriteResult> {
    return this.call<ChangeWriteResult>({ method: 'change.write', ...input });
  }
  changeDelete(target: Target, workItemId: string, expectedUpdated?: string): Promise<{deleted: boolean}> {
    return this.call<{deleted: boolean}>({ method: 'change.delete', target, workItemId, ...(expectedUpdated ? {expectedUpdated} : {}) });
  }
  async search(target: Target, query: string, limit: number): Promise<{ workItemId: string; title: string }[]> {
    return this.call<{ workItemId: string; title: string }[]>({ method: 'search', projectId: target.projectId, query, limit });
  }
  assets?: Assets;
  credentialPath?: string;
  constructor(assets?: Assets, credentialPath?: string){this.assets=assets;this.credentialPath=credentialPath;}
  reconfiguring = false;
  child?: ChildProcessWithoutNullStreams;
  pending = new Map<string, { resolve: (value: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout;progress?:(value:any)=>void }>();
  start() {
    if (this.reconfiguring) throw Error('POLARION_CONNECTION_BUSY');
    if (this.child) return;
    // PowerShell 7's module search path can break Windows PowerShell's DPAPI cmdlets.
    const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
    if (this.credentialPath) env.POLARION_SIDEBAR_CREDENTIALS = this.credentialPath;
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts/start-polarion-worker.ps1')], { cwd: ROOT, env, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    // Only retain explicitly recognized codes, never the raw diagnostic, which
    // can include paths or other sensitive subprocess output.
    const startupCodes = new Set(['POLARION_CREDENTIAL_PATH_MUST_BE_ABSOLUTE','POLARION_CREDENTIAL_FILE_MISSING','POLARION_CREDENTIAL_VERSION_UNSUPPORTED','POLARION_AUTH_MODE_UNSUPPORTED','POLARION_CREDENTIAL_FILE_INCOMPLETE','POLARION_CREDENTIAL_DECRYPT_FAILED','POLARION_CREDENTIAL_SECRET_EMPTY','POLARION_WORKER_INSTALLATION_INCOMPLETE']);
    let startupCode = '';
    child.stderr.setEncoding('utf8');
    let stderrTail = '';
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4096);
      for (const code of startupCodes) if (stderrTail.includes(code)) startupCode = code;
    });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      try { const reply = JSON.parse(line); const pending = this.pending.get(reply.id); if (!pending) return; if(reply.progress){pending.progress?.(reply.progress);return;}clearTimeout(pending.timer); this.pending.delete(reply.id); reply.ok ? pending.resolve(reply.value) : pending.reject(Error(reply.error)); } catch { /* no raw subprocess output goes to the UI */ }
    });
    const fail = () => { if (this.child !== child) return; this.child = undefined; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error(startupCode || 'POLARION_WORKER_STOPPED')); } this.pending.clear(); };
    // close waits for stderr to drain; exit can occur before the error code arrives.
    child.once('close', fail); child.once('error', fail);
    // A startup failure can close stdin before a pending request is written.
    child.stdin.on('error', () => {});
  }
  call<T=RemoteItem>(data: unknown,progress?:(value:any)=>void) {
    this.start(); const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const authentication=(data as {method?:string}).method==='authenticate';
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(authentication?'POLARION_CONNECTION_FAILED':'POLARION_TIMEOUT_VERIFY_BEFORE_RETRY'));
        // 超时说明 worker 可能已僵死：没有其它在途请求时结束它，下一次调用会重新启动干净的 worker。
        if (!this.pending.size && this.child) { try { this.child.kill(); } catch { /* 已退出 */ } }
      }, authentication?40000:150000);
      this.pending.set(id, { resolve, reject, timer,progress }); this.child!.stdin.write(JSON.stringify({ ...(data as object), id }) + '\n');
    });
  }
  async read(target: Target, workItemId: string, scope?: VariantScope) {
    const item = await this.call<RemoteItem & WorkItemIdentity>({ method: 'read', target, workItemId, ...(scope ? { variant: scope } : {}) });
    requireResolvedWorkItem(target.projectId, workItemId, item);
    return { ...item, title: item.title ?? '' };
  }
  async peek(target: Target, workItemId: string) {
    const item = await this.call<ProjectItemPreview & WorkItemIdentity>({ method: 'peek', target, workItemId });
    requireResolvedWorkItem(target.projectId, workItemId, { ...item, id: item?.workItemId });
    return item;
  }
  create(target: Target, title: string, type: string) {
    // 新需求要落进当前 LiveDoc；不传 documentLocation 会生成游离工作项，后续保存会被 WORK_ITEM_DOCUMENT_MISMATCH 拒绝。
    return this.call<{ item: RemoteItem; verified: boolean; verificationErrors: string[] }>({ method: 'create', target, title, type, documentLocation: target.document }).then(value => value.item);
  }
  link(target: Target, sourceWorkItemId: string, targetWorkItemId: string, role: string) {
    return this.call<{ verified: boolean }>({ method: 'link', target, sourceWorkItemId, targetWorkItemId, role });
  }
  unlink(target: Target, sourceWorkItemId: string, targetWorkItemId: string, role: string) {
    return this.call<{ verified: boolean }>({ method: 'unlink', target, sourceWorkItemId, targetWorkItemId, role });
  }
  roles(target: Target) { return this.call<{ id: string; name?: string; hidden?: boolean }[]>({ method: 'roles', projectId: target.projectId }); }
  backLinks(target: Target, mainWorkItemId: string) { return this.call<RemoteLink[]>({ method: 'backlinks', target, workItemId: mainWorkItemId }); }
  rename(target: Target, workItemId: string, title: string, expectedUpdated: string, scope?: VariantScope) {
    return this.call<{ item: RemoteItem; verified: boolean }>({ method: 'rename', target, workItemId, title, expectedUpdated, ...(scope ? { variant: scope } : {}) }).then(value => value.item);
  }
  metadataRead(target: Target, workItemId: string, scope?: VariantScope, name?: string) {
    return this.call<{ details: Record<string, unknown> | null }>({ method: 'metadata.read', target, workItemId, ...(scope ? { variant: scope } : {}), ...(name ? { name } : {}) }).then(value => value.details);
  }
  metadataWrite(target: Target, workItemId: string, details: Record<string, unknown>, scope?: VariantScope, name?: string) {
    return this.call<{ verified: boolean; updated?: string }>({ method: 'metadata.write', target, workItemId, details, ...(scope ? { variant: scope } : {}), ...(name ? { name } : {}) });
  }
  board(target: Target, workItemId: string, src: string, scope?: VariantScope) {
    return this.call<{ manifest: unknown; source: string; preview: string }>({ method: 'board', target, workItemId, src, ...(scope ? { variant: scope } : {}) });
  }
  modelNoteRead(target: Target, workItemId: string) {
    return this.call<{ note: unknown }>({ method: 'model.note.read', target, workItemId });
  }
  modelNoteWrite(target: Target, workItemId: string, note: unknown) {
    return this.call<{ verified: boolean; updated?: string }>({ method: 'model.note.write', target, workItemId, note });
  }
  modelNotes(target: Target, query: string) {
    return this.call<{ items: { workItemId: string; title: string; type: string; updated: string; marks: { rootId: string; modules: string[] }[]; links: { workItemId: string; role: string }[] }[]; total: number; partial?: boolean }>({ method: 'model.notes', target, query });
  }
  async stop() {
    const child = this.child; if (!child) return;
    if (this.pending.size) throw Error('POLARION_CONNECTION_BUSY');
    await new Promise<void>(resolve => { child.once('close', () => { clearTimeout(timer); resolve(); }); const timer=setTimeout(() => child.kill(),5000);child.stdin.end(); });
  }
  async image(target:Target,workItemId:string,src:string,scope?:VariantScope){
    if(!this.assets)throw Error('ASSET_STORE_UNAVAILABLE');
    const result=await this.call<{name:string;data:string}>({method:'image',target,workItemId,src,...(scope?{variant:scope}:{})});const bytes=Buffer.from(result.data,'base64');
    const ext=(result.name.split('.').pop()??'').toLowerCase();
    const mime=ext==='png'?'image/png':ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='gif'?'image/gif':ext==='webp'?'image/webp':'application/octet-stream';
    const asset=this.assets.begin(target,result.name,mime,bytes.length);for(let offset=0;offset<bytes.length;offset+=384*1024)this.assets.chunk(asset.id,offset,bytes.subarray(offset,offset+384*1024).toString('base64'));
    return this.assets.finish(asset.id);
  }
  save(draft: Draft, scope?: VariantScope, overwrite = false) {
    const ids=[...new Set([...draft.html.matchAll(/\bsrc=["']polarion-asset:([0-9a-f-]{36})["']/gi)].map(m=>m[1]!))];
    const assets=ids.flatMap(id=>{if(!this.assets)throw Error('ASSET_STORE_UNAVAILABLE');const bundle=new Boards(this.assets.store,this.assets).bundle(id,draft.target,draft.workItemId);if(bundle)return bundle;const a=this.assets.require(id,draft.target);if(a.extraction!=='image')throw Error('IMAGE_ASSET_REQUIRED');return[{id,name:a.name,mime:a.mime,sha256:a.sha256!,data:this.assets.bytes(id).toString('base64')}];});
    return this.call({ method: 'save', target: draft.target, workItemId: draft.workItemId, html: draft.html, expectedUpdated: draft.baseUpdated, baseHash: createHash('sha256').update(draft.baseHtml).digest('hex'),assets,...(scope?{variant:scope}:{}),...(overwrite?{overwrite:true}:{}) },receipt=>{this.assets?.store.put('attachment-receipt',draft.id+':'+receipt.localId,{draftId:draft.id,revision:draft.revision,at:Date.now(),...receipt});});
  }
}
/** 预览摘要：优先正文文字，跳过表格内部单元格（否则只剩一堆字段名），表格占比高时给出提示。 */
export function previewText(html: string): string {
  const ranges: [number, number][] = [];
  const tag = /<table\b[^>]*>|<\/table>/gi;
  let depth = 0, start = 0, match: RegExpExecArray | null;
  while ((match = tag.exec(html))) {
    if (match[0][1] !== '/') { if (depth === 0) start = match.index; depth++; }
    else if (depth > 0) { depth--; if (depth === 0) ranges.push([start, tag.lastIndex]); }
  }
  const clean = (value?: string) => (value ?? '').replace(/\s+/g, ' ').trim();
  const nodes = new LosslessHtml(html).nodes.filter(node => node.text);
  const inTable = (node: { start: number; end: number }) => ranges.some(([from, to]) => node.start >= from && node.end <= to);
  const prose = nodes.filter(node => !inTable(node)).map(node => clean(node.text)).filter(text => text && text !== '\u200b');
  const tables = (html.match(/<table\b/gi) ?? []).length;
  const joined = prose.join(' · ').slice(0, 1200);
  if (joined.length >= 60) return joined;
  if (joined) return tables ? `${joined}（含 ${tables} 个表格，打开编辑台查看完整内容）` : joined;
  return tables ? `正文以表格与结构化字段为主（${tables} 个表格），打开编辑台查看。` : '';
}
export type WorkItemHit = { workItemId: string; title: string; source: 'draft' | 'remote' };
/** 用户输入进入 lucene 前必须转义，否则括号/布尔运算符可以突破项目与文档作用域。 */
function luceneEscape(value: string) { return value.replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, '\\$&'); }
export type WorkItemPreview = { target: Target; workItemId: string; title: string; text: string; state?: string; revision?: number; source: 'draft' | 'remote'; readOnlyReference: boolean };
export class Drafts {
  store: Store; remote: Remote; snapshots = new Map<string, { revision: number; source: LosslessHtml }>();
  private previews = new Map<string, { at: number; value: Promise<WorkItemPreview>; draftId?: string; revision?: number }>();
  /** 悬停预览：本地草稿优先，其次远端读取；60 秒内同一工作项复用结果，避免悬停触发频繁请求。 */
  /** @ 引用的候选来源：本地草稿（编号/标题匹配）优先，远端 lucene 查询补充，按编号直查优先排序。 */
  async searchItems(target: Target, query: string, limit = 8): Promise<WorkItemHit[]> {
    const text = query.trim().toLowerCase();
    const local = this.store.list<Draft>('draft')
      .filter(d => d?.target?.projectId === target.projectId && (!text || d.workItemId.toLowerCase().includes(text) || String(d.title ?? '').toLowerCase().includes(text)))
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .map(d => ({ workItemId: d.workItemId, title: String(d.title ?? ''), source: 'draft' as const }));
    let remote: WorkItemHit[] = [];
    try {
      const lucene = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(text) ? `id:${luceneEscape(text.toUpperCase())}` : /^[A-Za-z][A-Za-z0-9_]*-$/.test(text) ? `id:${luceneEscape(text.toUpperCase())}*` : text ? `title:*${luceneEscape(text)}*` : 'id:*';
      const rows = await this.remote.search?.(target, lucene, limit) ?? [];
      remote = rows.map(row => ({ workItemId: row.workItemId, title: row.title ?? '', source: 'remote' as const }));
    } catch { remote = []; }
    const seen = new Set<string>(); const merged: WorkItemHit[] = [];
    for (const hit of [...local, ...remote]) { if (seen.has(hit.workItemId)) continue; seen.add(hit.workItemId); merged.push(hit); if (merged.length >= limit) break; }
    return merged;
  }
  private previewKey(target: Target, workItemId: string) {
    return JSON.stringify([target.origin, target.projectId, target.document, workItemId]);
  }
  private async readScoped(target: Target, workItemId: string, scope?: VariantScope) {
    const item = await this.remote.read(target, workItemId, scope);
    requireWorkItemId(workItemId, item?.id);
    return item;
  }
  private localForPreview(target: Target, workItemId: string) {
    const candidates = this.store.list<Draft>('draft').filter(d => d.workItemId === workItemId && d.target?.origin === target.origin && d.target.projectId === target.projectId);
    return candidates.find(d => sameTarget(d.target, target)) ?? candidates.find(d => d.state !== 'clean') ?? candidates[0];
  }
  private async previewSource(requested: Target, workItemId: string, local: Draft | undefined) {
    const target = local?.target ?? requested;
    let readOnlyReference = !sameTarget(requested, target);
    let item: RemoteItem | undefined;
    if (!local || local.state === 'clean') {
      try {
        item = await this.readScoped(target, workItemId, this.scopeFor(target, workItemId));
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'WORK_ITEM_DOCUMENT_MISMATCH' || !this.remote.peek) throw error;
        const preview = await this.remote.peek(target, workItemId);
        item = { ...preview, id: requireWorkItemId(workItemId, preview?.workItemId) };
        readOnlyReference = true;
      }
      // Edits or a newly opened same-document draft can arrive during either remote read.
      const latest = this.localForPreview(requested, workItemId);
      if (latest && (latest.id !== local?.id || latest.revision !== local.revision || latest.state !== 'clean')) {
        return { target: latest.target, local: latest, item: undefined, readOnlyReference: !sameTarget(latest.target, requested) || latest.id === local?.id && readOnlyReference };
      }
      local = latest;
    }
    return { target, local, item, readOnlyReference };
  }
  async readOnly(requested: Target, workItemId: string) {
    const key = this.previewKey(requested, workItemId);
    const { target, local, item, readOnlyReference } = await this.previewSource(requested, workItemId, this.localForPreview(requested, workItemId))
      .finally(() => this.previews.delete(key));
    const previewId = 'remote-' + workItemId;
    if (local && (!item || !readOnlyReference)) {
      const draft = item ? this.refreshIfClean(local, item) : local;
      return { ...this.read(draft.id), id: readOnlyReference ? previewId : draft.id, source: 'draft' as const, type: item?.type, readOnlyReference };
    }
    if (!item) throw Error('NOT_FOUND');
    const html = item.description ?? '', parsed = new LosslessHtml(html);
    return { id: previewId, target, workItemId, title: item.title, type: item.type, baseHtml: html, html, baseUpdated: item.updated ?? '', revision: 0, state: 'clean' as const, savedAt: undefined, nodes: parsed.nodes, version: parsed.version, source: 'remote' as const, readOnlyReference };
  }
  async peek(requested: Target, workItemId: string): Promise<WorkItemPreview> {
    const key = this.previewKey(requested, workItemId);
    const prior = this.localForPreview(requested, workItemId), cached = this.previews.get(key);
    if (cached && cached.draftId === prior?.id && cached.revision === prior?.revision && Date.now() - cached.at < 60_000) return cached.value;
    const value = this.previewSource(requested, workItemId, prior).then<WorkItemPreview>(({ target, local, item, readOnlyReference }) => {
      if (!item && !local) throw Error('NOT_FOUND');
      const nodes = item ? new LosslessHtml(item.description ?? '').nodes : this.read(local!.id).nodes;
      const text = nodes.map(n => n.text?.trim()).filter(Boolean).join('\n').slice(0, 1200);
      return { target, workItemId, text, readOnlyReference, title: item?.title ?? local?.title ?? '', source: item ? 'remote' : 'draft', ...(!item && { state: local!.state, revision: local!.revision }) };
    });
    // A later full read can invalidate this hover while it is still in flight.
    const entry = { at: Date.now(), value, draftId: prior?.id, revision: prior?.revision };
    this.previews.set(key, entry);
    try { return await value; }
    catch (error) { if (this.previews.get(key) === entry) this.previews.delete(key); throw error; }
  }
  saving = new Set<string>();
  richModels = new Map<string, RichDocument>();
  constructor(store: Store, remote: Remote) { this.store = store; this.remote = remote; }
  /** 变体工作项不属于当前文档，读写时必须携带主工作项与链接角色。 */
  variantFor(target: Target, workItemId: string) {
    return this.store.list<Variant>('variant').find(v => v.workItemId === workItemId && sameTarget(v.target, target));
  }
  scopeFor(target: Target, workItemId: string): VariantScope | undefined {
    const variant = this.variantFor(target, workItemId);
    return variant ? { mainWorkItemId: variant.mainWorkItemId, role: variant.linkRole } : undefined;
  }
  async open(target: Target, workItemId: string) {
    const variant = this.variantFor(target, workItemId);
    const scope = variant ? { mainWorkItemId: variant.mainWorkItemId, role: variant.linkRole } : undefined;
    const readCurrent = () => this.readScoped(target, workItemId, scope).finally(() => this.previews.delete(this.previewKey(target, workItemId)));
    let prior = this.store.drafts(target).find(d => d.workItemId === workItemId);
    if (prior) {
      // 旧草稿可能早于变体登记；补上归属，后续保存即可带变体作用域。
      if (variant && prior.variantOf !== variant.mainWorkItemId) { prior = { ...prior, variantOf: variant.mainWorkItemId }; this.store.put('draft', prior.id, prior); }
      // clean 草稿不代表最新：原生页面可能已直接保存，远端更新则以远端为准，避免工作台/预览显示旧内容。
      if (prior.state === 'clean') prior = this.refreshIfClean(prior, await readCurrent());
      return this.read(prior.id);
    }
    const item = await readCurrent();
    // Another request can finish while the remote read is in flight.
    const existing = this.store.drafts(target).find(d => d.workItemId === workItemId);
    if (existing) return this.read(existing.id);
    const draft: Draft = { id: crypto.randomUUID(), target, workItemId, title: item.title, baseHtml: item.description ?? '', html: item.description ?? '', baseUpdated: item.updated ?? '', revision: 0, state: 'clean', ...(variant ? { variantOf: variant.mainWorkItemId } : {}) };
    this.store.put('draft', draft.id, draft); return this.read(draft.id);
  }
  /** 远端比本地新（例如用户在原生页面直接保存）：clean 草稿没有未保存内容，安全前移基准；revision+1 让旧编辑会话失效。 */
  private refreshIfClean(prior: Draft, item: RemoteItem): Draft {
    const draft = this.store.require<Draft>('draft', prior.id);
    if (draft.revision !== prior.revision || draft.state !== 'clean') return draft;
    const html = item.description ?? '';
    if ((item.updated ?? '') === draft.baseUpdated && html === draft.baseHtml) return draft;
    const next: Draft = { ...draft, title: item.title || draft.title, html, baseHtml: html, baseUpdated: item.updated ?? draft.baseUpdated, revision: draft.revision + 1, savedAt: Date.now() };
    this.store.put('draft', next.id, next);
    return next;
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
    let model = this.richModels.get(editorId);
    if (!model) { model = new RichDocument(session.source, session.id); this.richModels.set(editorId, model); }
    let html = model.serialize(document, { recoverStructure: true });
    for(const [localId,attachmentId] of Object.entries(session.imageAliases??{}))html=html.replaceAll('polarion-asset:'+localId,'workitemimg:'+attachmentId);
    if(session.saved){html=polarionWriteHtml(html);if(equivalentHtml(html,draft.baseHtml))html=draft.baseHtml;}
    if (html === draft.html) return draft;
    // The next rich.read must be able to parse the exact bytes being checkpointed.
    new RichDocument(html);
    return this.checkpointHtml(draft, html, session);
  }
  private checkpointHtml(draft: Draft, html: string, session?: RichSession) {
    const value: Draft = { ...draft, html, revision: draft.revision + 1, state: draft.state === 'conflict' ? 'conflict' : html === draft.baseHtml ? 'clean' : 'dirty' };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.store.get<Draft>('draft', draft.id);
      if (!current || current.revision !== draft.revision || current.state !== draft.state || current.html !== draft.html) throw Error(session ? 'STALE_DRAFT' : staleQualityFinding);
      this.store.put('draft-checkpoint', crypto.randomUUID(), { draftId: draft.id, revision: draft.revision, html: draft.html, at: Date.now(), source: session ? 'rich-editor' : 'quality-rewrite' });
      this.store.put('draft', draft.id, value);
      if (session) this.store.put('rich-editor', session.id, { ...session, revision: value.revision });
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    return this.read(draft.id);
  }
  qualityRewriteRange(target: Target, scope: QualityRewrite) {
    const draft = this.store.get<Draft>('draft', scope.draftId);
    if (!draft || !sameTarget(draft.target, target) || draft.workItemId !== scope.workItemId || draft.revision !== scope.expectedRevision) throw Error(staleQualityFinding);
    if (this.saving.has(draft.id)) throw Error('DRAFT_SAVING');
    const model = new RichDocument(draft.html), doc = richSchema.nodeFromJSON(model.document);
    const located = qualitySentence(doc, scope.matchFrom, scope.matchTo, scope.matchedText);
    if (located.from !== scope.from || located.to !== scope.to || located.sentence !== scope.sentence) throw Error(staleQualityFinding);
    // When a sentence contains the same term twice, only the clicked spelling is editable.
    const folded = scope.sentence.toLowerCase(), term = scope.matchedText.toLowerCase();
    if (folded.indexOf(term) !== folded.lastIndexOf(term)) return { draft, model, from: scope.matchFrom, to: scope.matchTo, text: scope.matchedText };
    return { draft, model, from: scope.from, to: scope.to, text: scope.sentence };
  }
  applyQualityRewrite(target: Target, scope: QualityRewrite, replacement: string) {
    const range = this.qualityRewriteRange(target, scope);
    if (scope.sentence === replacement) return this.read(scope.draftId);
    if (!isSingleQualitySentence(replacement)) throw Error('改写候选超出单句范围，草稿未修改。');
    const prefix = scope.sentence.slice(0, range.from - scope.from), suffix = scope.sentence.slice(range.to - scope.from);
    if (!replacement.startsWith(prefix) || !replacement.endsWith(suffix) || replacement.length < prefix.length + suffix.length) throw Error('改写候选修改了同句中选定位置以外的文字，草稿未修改。');
    const editableText = replacement.slice(prefix.length, replacement.length - suffix.length);
    const html = range.model.replaceTextRange(range.from, range.to, range.text, editableText);
    return this.checkpointHtml(range.draft, html);
  }
  format(id:string,expectedRevision:number,format:TextFormat,selection?:string){
    if(this.read(id).revision!==expectedRevision)throw Error('STALE_DRAFT');
    const rich=this.richRead(id),changed=formatDocument(rich.document,format,selection);
    return{draft:this.richApply(id,rich.editorId,expectedRevision,changed.document),characters:changed.characters};
  }
  /* -------- 表格速通：小命令进出，避免为一张表读写整篇 rich JSON -------- */
  /** 表格清单：直接解析当前草稿，不建立编辑会话；返回体积极小。 */
  tables(id: string) {
    const draft = this.read(id);
    return { draftId: id, workItemId: draft.workItemId, revision: draft.revision, state: draft.state, tables: listTables(new RichDocument(draft.html).document) };
  }
  /** 批量执行表格结构操作（增删行/列、列宽、插入表格），一次调用一次落盘。 */
  table(id: string, expectedRevision: number, operations: TableOperation[]) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id);
    if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    const rich = this.richRead(id);
    const applied = applyTableOperations(rich.document, operations);
    const next = this.richApply(id, rich.editorId, expectedRevision, applied.document);
    return { draft: { draftId: next.id, workItemId: next.workItemId, revision: next.revision, state: next.state, savedToPolarion: false }, tables: applied.tables };
  }
  /** 读取单张表的完整 rich JSON（含 sid 映射），配合 tableApply 只回写这一张表。 */
  tableRead(id: string, table: number) {
    const rich = this.richRead(id);
    return { editorId: rich.editorId, draftId: id, workItemId: rich.draft.workItemId, revision: rich.draft.revision, table, document: tableJsonAt(rich.document, table) };
  }
  /** 全文逐字替换：只改文本节点，保留结构/格式/受保护对象；返回替换次数。 */
  replaceAll(id: string, expectedRevision: number, from: string, to: string, caseSensitive: boolean, lintMatches?: readonly TextMatch[]) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id);
    if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    const rich = this.richRead(id);
    const applied = lintMatches ? replaceGlossaryMatches(rich.document, lintMatches, from, to, caseSensitive) : replaceAllText(rich.document, from, to, caseSensitive);
    const next = this.richApply(id, rich.editorId, expectedRevision, applied.document);
    return { draft: { draftId: next.id, workItemId: next.workItemId, revision: next.revision, state: next.state, savedToPolarion: false }, replacements: applied.replacements };
  }
  /** 整篇排版：编号段落提升标题、统一行距/对齐、清空段，一次调用。 */
  restyle(id: string, expectedRevision: number, rules: RestyleRules) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id);
    if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    const rich = this.richRead(id);
    const applied = restyleDocument(rich.document, rules);
    const next = this.richApply(id, rich.editorId, expectedRevision, applied.document);
    return { draft: { draftId: next.id, workItemId: next.workItemId, revision: next.revision, state: next.state, savedToPolarion: false }, changes: applied.changes };
  }
  /** 块级点操作：段落/标题/列表互转、插入、删除、移动、拆段、合段。 */
  blocks(id: string, expectedRevision: number, operations: BlockOperation[]) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id);
    if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    const rich = this.richRead(id);
    const applied = applyBlockOperations(rich.document, operations);
    const next = this.richApply(id, rich.editorId, expectedRevision, applied.document);
    return { draft: { draftId: next.id, workItemId: next.workItemId, revision: next.revision, state: next.state, savedToPolarion: false }, changes: applied.changes };
  }
  /** 新建服务端工作项（空正文）并开本地草稿；正文仍只写草稿，由保存流程写入。 */
  async create(target: Target, title: string, type?: string) {
    if (!this.remote.create) throw Error('CREATE_WORK_ITEM_UNSUPPORTED');
    const item = await this.remote.create(target, title.trim().slice(0, 160), (type ?? '').trim() || 'task');
    const draft: Draft = { id: crypto.randomUUID(), target, workItemId: item.id, title: item.title, baseHtml: item.description ?? '', html: item.description ?? '', baseUpdated: item.updated ?? '', revision: 0, state: 'clean' };
    this.store.put('draft', draft.id, draft);
    return this.read(draft.id);
  }
  /** 把修改后的单张表写回：其余内容与源映射保持原样。 */
  tableApply(id: string, editorId: string, expectedRevision: number, table: number, node: JSONContent) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const session = this.store.require<RichSession>('rich-editor', editorId);
    if (session.draftId !== id) throw Error('STALE_DRAFT');
    let model = this.richModels.get(editorId);
    if (!model) { model = new RichDocument(session.source, editorId); this.richModels.set(editorId, model); }
    const next = this.richApply(id, editorId, expectedRevision, replaceTableJson(model.document, table, node));
    return { draft: { draftId: next.id, workItemId: next.workItemId, revision: next.revision, state: next.state, savedToPolarion: false }, tables: listTables(new RichDocument(next.html).document) };
  }
  replace(id: string, expectedRevision: number, nodeId: string, expectedText: string, text: string) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    const draft = this.read(id); if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    const source = this.snapshots.get(id)!.source;
    const next = source.replaceText(source.version, [{ nodeId, expectedText, text }]);
    if (next === source) return draft;
    const value: Draft = { ...draft, html: next.source, revision: draft.revision + 1, state: draft.state==='conflict'?'conflict':next.source === draft.baseHtml ? 'clean' : 'dirty' };
    this.store.put('draft', id, value); this.snapshots.set(id, { revision: value.revision, source: next }); return this.read(id);
  }
  private adoptReadback(draft: Draft, remote: RemoteItem, uploads: NonNullable<RemoteItem['uploadedAssets']> = []) {
    const html = remote.description ?? '', revision = draft.revision + (html === draft.html ? 0 : 1);
    const aliases = Object.fromEntries(uploads.map(asset => [asset.localId, asset.attachmentId]));
    // A verified save (including recovery) keeps the open editor's source IDs and undo history.
    for (const session of this.store.list<RichSession>('rich-editor')) {
      if (session.draftId === draft.id && session.revision === draft.revision) {
        this.store.put('rich-editor', session.id, { ...session, revision, saved: true, imageAliases: { ...session.imageAliases, ...aliases } });
      }
    }
    this.store.put('draft', draft.id, { ...draft, revision, html, baseHtml: html, baseUpdated: remote.updated ?? '', state: 'clean', savedAt: Date.now() });
  }
  async save(id: string, expectedRevision: number, nativeState: 'clean' | 'dirty' | 'unknown') {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    if (nativeState !== 'clean') throw Error('NATIVE_EDITOR_' + nativeState.toUpperCase());
    const draft = this.store.require<Draft>('draft', id);
    if (draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
    if (draft.state === 'clean') return { ...this.read(id), wroteToPolarion: false };
    this.saving.add(id);
    let dispatched = false; const operationId = crypto.randomUUID();
    const scope = this.scopeFor(draft.target, draft.workItemId);
    const audit = { id: operationId, draftId: id, target: draft.target, workItemId: draft.workItemId, revision: draft.revision, startedAt: Date.now(), baseHash: createHash('sha256').update(draft.baseHtml).digest('hex'), proposedHash: createHash('sha256').update(draft.html).digest('hex') };
    this.store.put('save', operationId, audit);
    try {
      // The workbench is the source of truth: saving replaces the remote description.
      // Tidy, an agent rewrite and hand editing all arrive here the same way.
      const outgoing = { ...draft, html: polarionWriteHtml(draft.html) };
      // Durable before dispatch: a Host crash must not turn an unknown write into a retryable draft.
      this.store.put('draft', id, { ...draft, state: 'uncertain' });
      this.store.put('save', operationId, { ...audit, phase: 'dispatched' }); dispatched = true;
      const outcome = await this.remote.save(outgoing, scope, true);
      // A successful write is the save. The readback refreshes the baseline with
      // the server's own spelling; it is not a second gate that can reject it.
      let readback: RemoteItem;
      try { readback = await this.readScoped(draft.target, draft.workItemId, scope); }
      catch { readback = { ...draft, id: draft.workItemId, title: draft.title, description: outcome.submittedHtml ?? outgoing.html, updated: draft.baseUpdated }; }
      const submitted = outcome.submittedHtml ?? outgoing.html, savedHtml = readback.description ?? '';
      // The user asked for B, so B has to be the body the reader sees. Polarion
      // may rewrite whitespace wrappers; a completely different body is not success.
      if (!matchesPolarionReadback(submitted, savedHtml)) {
        throw Error(matchesPolarionReadback(draft.baseHtml, savedHtml) ? 'SAVE_NOT_APPLIED' : 'READBACK_MISMATCH');
      }
      this.adoptReadback(draft, readback, outcome.uploadedAssets);
      this.store.put('save', operationId, { ...audit, phase: 'verified', endedAt: Date.now(), serverUpdated: readback.updated, submittedHash: createHash('sha256').update(outcome.submittedHtml ?? outgoing.html).digest('hex'), readbackHash: createHash('sha256').update(readback.description ?? '').digest('hex'), uploadedAssets: outcome.uploadedAssets ?? [] });
      return { ...this.read(id), wroteToPolarion: true };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'OPERATION_FAILED';
      // A known not-applied body keeps the draft editable and retryable; only a
      // lost transport response is genuinely uncertain about the remote state.
      const knownUnchanged = code === 'SAVE_NOT_APPLIED' || code === 'READBACK_MISMATCH';
      if (dispatched) this.store.put('draft', id, { ...draft, state: knownUnchanged ? 'dirty' : 'uncertain' });
      this.store.put('save', operationId, { ...audit, phase: code === 'SAVE_NOT_APPLIED' ? 'not-applied' : dispatched ? 'uncertain' : 'not-written', endedAt: Date.now(), errorCode: code });
      throw error;
    } finally { this.saving.delete(id); }
  }
  async conflictRead(id:string){
    const draft=this.store.require<Draft>('draft',id),remote=await this.remote.read(draft.target,draft.workItemId,this.scopeFor(draft.target,draft.workItemId)),remoteHtml=remote.description??'';
    return{draft,remoteHtml,remoteUpdated:remote.updated??'',remoteHash:createHash('sha256').update(remoteHtml).digest('hex')};
  }
  async resolveConflict(id:string,expectedRevision:number,remoteHash:string,remoteUpdated:string,strategy:'keep-local'|'use-remote'){
    if(this.saving.has(id))throw Error('DRAFT_SAVING');this.saving.add(id);
    try{
      const draft=this.store.require<Draft>('draft',id);if(draft.revision!==expectedRevision)throw Error('STALE_DRAFT');
      const remote=await this.remote.read(draft.target,draft.workItemId,this.scopeFor(draft.target,draft.workItemId)),remoteHtml=remote.description??'';
      if(createHash('sha256').update(remoteHtml).digest('hex')!==remoteHash||(remote.updated??'')!==remoteUpdated)throw Error('REMOTE_CHANGED_SINCE_REVIEW');
      const html=strategy==='keep-local'?draft.html:remoteHtml;
      this.store.put('conflict-resolution',crypto.randomUUID(),{draftId:id,at:Date.now(),strategy,previous:draft,remoteHtml,remoteUpdated});
      this.store.put('draft',id,{...draft,html,baseHtml:remoteHtml,baseUpdated:remoteUpdated,revision:draft.revision+1,state:html===remoteHtml?'clean':'dirty'});
      return this.read(id);
    }finally{this.saving.delete(id);}
  }
  async reconcile(id: string, expectedRevision?: number) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    this.saving.add(id);
    try {
      const draft = this.store.require<Draft>('draft', id);
      if (expectedRevision !== undefined && draft.revision !== expectedRevision) throw Error('STALE_DRAFT');
      const remote = await this.readScoped(draft.target, draft.workItemId, this.scopeFor(draft.target, draft.workItemId));
      if (this.store.require<Draft>('draft', id).revision !== draft.revision) throw Error('STALE_DRAFT');
      const html = remote.description ?? '';
      if (equivalentHtml(polarionWriteHtml(draft.html), html)) this.adoptReadback(draft, remote);
      else {
        const unchanged = html === draft.baseHtml && remote.updated === draft.baseUpdated;
        this.store.put('draft', id, { ...draft, state: unchanged ? 'dirty' : 'conflict' });
      }
      const result = this.read(id);
      this.store.put('reconciliation', crypto.randomUUID(), { draftId: id, at: Date.now(), state: result.state, remoteUpdated: remote.updated, remoteHash: createHash('sha256').update(html).digest('hex') });
      return result;
    } finally { this.saving.delete(id); }
  }
  /** 批量删除共享草稿及本地会话、检查点与附件回执；正在保存的草稿拒绝删除。 */
  remove(ids: string[]) {
    const removed: string[] = [];
    for (const id of ids) {
      if (this.saving.has(id)) throw Error('DRAFT_SAVING');
      this.store.require<Draft>('draft', id);
      this.store.remove('draft', id);
      this.store.removeMatching('draft-checkpoint', checkpoint => checkpoint.draftId === id);
      for (const session of this.store.list<RichSession>('rich-editor')) if (session.draftId === id) { this.store.remove('rich-editor', session.id); this.richModels.delete(session.id); }
      this.store.removeMatching('attachment-receipt', receipt => receipt.draftId === id);
      this.snapshots.delete(id);
      removed.push(id);
    }
    return removed;
  }
}
