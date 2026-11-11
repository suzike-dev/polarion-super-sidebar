import {formatDocument, type TextFormat} from '../../packages/core/format-document.ts';
import {equivalentHtml} from '../../packages/core/html-equivalence.ts';
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
type RichSession = { id: string; draftId: string; source: string; revision: number; imageAliases?:Record<string,string>;saved?:boolean };
export type RemoteItem = { id: string; title: string; description?: string; updated?: string; status?: string; type?: string; attachments?: {id?: string; file_name?: string; title?: string}[]; submittedHtml?: string; uploadedAssets?: {localId:string;attachmentId:string;sha256:string}[] };
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
  /** 项目级变更记录工作项（按项目查询，天然隔离）。 */
  changeList?(target: Target, limit: number): Promise<ChangeRemoteRow[]>;
  changeRead?(target: Target, workItemId: string, fileName: string): Promise<{workItemId: string; attachmentId: string; dataBase64: string; updated: string}>;
  changeWrite?(input: ChangeWriteInput): Promise<ChangeWriteResult>;
  changeDelete?(target: Target, workItemId: string, expectedUpdated?: string): Promise<{deleted: boolean}>;
  search?(target: Target, query: string, limit: number): Promise<{ workItemId: string; title: string }[]>;
  save(draft: Draft, scope?: VariantScope): Promise<RemoteItem>;
  image?(target: Target, workItemId: string, src: string, scope?: VariantScope): Promise<unknown>;
  create?(target: Target, title: string, type: string): Promise<RemoteItem>;
  link?(target: Target, sourceWorkItemId: string, targetWorkItemId: string, role: string): Promise<{verified:boolean}>;
  unlink?(target: Target, sourceWorkItemId: string, targetWorkItemId: string, role: string): Promise<{verified:boolean}>;
  roles?(target: Target): Promise<{id:string;name?:string;hidden?:boolean}[]>;
  backLinks?(target: Target, mainWorkItemId: string): Promise<RemoteLink[]>;
  rename?(target: Target, workItemId: string, title: string, expectedUpdated: string, scope?: VariantScope): Promise<RemoteItem>;
  metadataRead?(target: Target, workItemId: string, scope?: VariantScope, name?: string): Promise<Record<string, unknown> | null>;
  metadataWrite?(target: Target, workItemId: string, details: Record<string, unknown>, scope?: VariantScope, name?: string): Promise<{verified: boolean; updated?: string}>;
  board?(target: Target, workItemId: string, src: string, scope?: VariantScope): Promise<{manifest: unknown; source: string; preview: string}>;
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
  changeList(target: Target, limit: number): Promise<ChangeRemoteRow[]> {
    return this.call<ChangeRemoteRow[]>({ method: 'change.list', target, limit });
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(authentication?'POLARION_CONNECTION_FAILED':'POLARION_TIMEOUT_VERIFY_BEFORE_RETRY')); }, authentication?40000:150000);
      this.pending.set(id, { resolve, reject, timer,progress }); this.child!.stdin.write(JSON.stringify({ ...(data as object), id }) + '\n');
    });
  }
  read(target: Target, workItemId: string, scope?: VariantScope) { return this.call({ method: 'read', target, workItemId, ...(scope ? { variant: scope } : {}) }); }
  create(target: Target, title: string, type: string) {
    return this.call<{ item: RemoteItem; verified: boolean; verificationErrors: string[] }>({ method: 'create', target, title, type }).then(value => value.item);
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
  save(draft: Draft, scope?: VariantScope) {
    const ids=[...new Set([...draft.html.matchAll(/\bsrc=["']polarion-asset:([0-9a-f-]{36})["']/gi)].map(m=>m[1]!))];
    const assets=ids.flatMap(id=>{if(!this.assets)throw Error('ASSET_STORE_UNAVAILABLE');const bundle=new Boards(this.assets.store,this.assets).bundle(id,draft.target,draft.workItemId);if(bundle)return bundle;const a=this.assets.require(id,draft.target);if(a.extraction!=='image')throw Error('IMAGE_ASSET_REQUIRED');return[{id,name:a.name,mime:a.mime,sha256:a.sha256!,data:this.assets.bytes(id).toString('base64')}];});
    return this.call({ method: 'save', target: draft.target, workItemId: draft.workItemId, html: draft.html, expectedUpdated: draft.baseUpdated, baseHash: createHash('sha256').update(draft.baseHtml).digest('hex'),assets,...(scope?{variant:scope}:{}) },receipt=>{this.assets?.store.put('attachment-receipt',draft.id+':'+receipt.localId,{draftId:draft.id,revision:draft.revision,at:Date.now(),...receipt});});
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
export type WorkItemPreview = { workItemId: string; title: string; text: string; state?: string; revision?: number; source: 'draft' | 'remote' };
export class Drafts {
  store: Store; remote: Remote; snapshots = new Map<string, { revision: number; source: LosslessHtml }>();
  private previews = new Map<string, { at: number; value: WorkItemPreview }>();
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
  /** 完整只读预览：本地草稿优先，否则读取 Polarion 正文；节点信息供只读渲染使用。 */
  async readOnly(target: Target, workItemId: string) {
    const candidates = this.store.list<Draft>('draft').filter(d => d.workItemId === workItemId);
    const local = candidates.find(d => d.target.projectId === target.projectId) ?? candidates[0];
    // 含未保存修改（dirty/uncertain/conflict）的草稿才优先本地；clean 草稿必须与远端核对，原生页面直接保存后不能再看旧内容。
    if (local && local.state !== 'clean') return { ...this.read(local.id), source: 'draft' as const };
    if (local) {
      try {
        const item = await this.remote.read(target, workItemId, local.variantOf ? this.scopeFor(target, workItemId) : undefined);
        return { ...this.read(this.refreshIfClean(local, item).id), source: 'draft' as const };
      } catch { return { ...this.read(local.id), source: 'draft' as const }; }
    }
    const item = await this.remote.read(target, workItemId);
    const html = item.description ?? '';
    const parsed = new LosslessHtml(html);
    return { id: 'remote-' + workItemId, target, workItemId, title: item.title, baseHtml: html, html, baseUpdated: item.updated ?? '', revision: 0, state: 'clean' as const, savedAt: undefined, nodes: parsed.nodes, version: parsed.version, source: 'remote' as const };
  }
  async peek(target: Target, workItemId: string): Promise<WorkItemPreview> {
    const key = `${target.projectId}/${target.document}/${workItemId}`;
    const cached = this.previews.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const candidates = this.store.list<Draft>('draft').filter(d => d.workItemId === workItemId);
    const local = candidates.find(d => d.target.projectId === target.projectId) ?? candidates[0];
    let value: WorkItemPreview;
    if (local && local.state !== 'clean') {
      const text = this.read(local.id).nodes.filter(n => n.text).map(n => String(n.text).trim()).filter(Boolean).join('\n').slice(0, 1200);
      value = { workItemId, title: local.title, text, state: local.state, revision: local.revision, source: 'draft' };
    } else {
      const item = await this.remote.read(target, workItemId);
      const text = new LosslessHtml(item.description ?? '').nodes.filter(n => n.text).map(n => String(n.text).trim()).filter(Boolean).join('\n').slice(0, 1200);
      value = { workItemId, title: item.title, text, source: 'remote' };
    }
    this.previews.set(key, { at: Date.now(), value });
    return value;
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
    let prior = this.store.drafts(target).find(d => d.workItemId === workItemId);
    if (prior) {
      // 旧草稿可能早于变体登记；补上归属，后续保存即可带变体作用域。
      if (variant && prior.variantOf !== variant.mainWorkItemId) { prior = { ...prior, variantOf: variant.mainWorkItemId }; this.store.put('draft', prior.id, prior); }
      // clean 草稿不代表最新：原生页面可能已直接保存，远端更新则以远端为准，避免工作台/预览显示旧内容。
      if (prior.state === 'clean') {
        try { prior = this.refreshIfClean(prior, await this.remote.read(target, workItemId, scope)); } catch { /* 远端暂不可读时退回本地内容 */ }
      }
      return this.read(prior.id);
    }
    const item = await this.remote.read(target, workItemId, scope);
    // Another request can finish while the remote read is in flight.
    const existing = this.store.drafts(target).find(d => d.workItemId === workItemId);
    if (existing) return this.read(existing.id);
    const draft: Draft = { id: crypto.randomUUID(), target, workItemId, title: item.title, baseHtml: item.description ?? '', html: item.description ?? '', baseUpdated: item.updated ?? '', revision: 0, state: 'clean', ...(variant ? { variantOf: variant.mainWorkItemId } : {}) };
    this.store.put('draft', draft.id, draft); return this.read(draft.id);
  }
  /** 远端比本地新（例如用户在原生页面直接保存）：clean 草稿没有未保存内容，安全前移基准；revision+1 让旧编辑会话失效。 */
  private refreshIfClean(draft: Draft, item: RemoteItem): Draft {
    if (draft.state !== 'clean') return draft;
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
    const scope = this.scopeFor(draft.target, draft.workItemId);
    const audit = { id: operationId, draftId: id, target: draft.target, workItemId: draft.workItemId, revision: draft.revision, startedAt: Date.now(), phase: 'preflight', baseHash: createHash('sha256').update(draft.baseHtml).digest('hex'), proposedHash: createHash('sha256').update(draft.html).digest('hex') };
    this.store.put('save', operationId, audit);
    try {
      const current = await this.remote.read(draft.target, draft.workItemId, scope);
      if (current.updated !== draft.baseUpdated || (current.description ?? '') !== draft.baseHtml) {
        this.store.put('draft', id, { ...draft, state: 'conflict' }); throw Error('REMOTE_CONFLICT');
      }
      // Durable before dispatch: a Host crash must not turn an unknown write into a retryable draft.
      this.store.put('draft', id, { ...draft, state: 'uncertain' });
      this.store.put('save', operationId, { ...audit, phase: 'dispatched' }); dispatched = true;
      const outgoing={...draft,html:polarionWriteHtml(draft.html)};
      const outcome = await this.remote.save(outgoing, scope);
      const readback = await this.remote.read(draft.target, draft.workItemId, scope);
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
  async reconcile(id: string) {
    if (this.saving.has(id)) throw Error('DRAFT_SAVING');
    this.saving.add(id);
    try {
      const draft = this.store.require<Draft>('draft', id);
      const remote = await this.remote.read(draft.target, draft.workItemId, this.scopeFor(draft.target, draft.workItemId));
      let value: Draft;
      if (equivalentHtml(remote.description??'',polarionWriteHtml(draft.html))) value = { ...draft, html:remote.description??'',revision:draft.revision+(remote.description===draft.html?0:1),baseHtml: remote.description??'', baseUpdated: remote.updated ?? '', state: 'clean', savedAt: Date.now() };
      else if ((remote.description ?? '') === draft.baseHtml && remote.updated === draft.baseUpdated) value = { ...draft, state: 'dirty' };
      else value = { ...draft, state: 'conflict' };
      this.store.put('draft', id, value);
      this.store.put('reconciliation', crypto.randomUUID(), { draftId: id, at: Date.now(), state: value.state, remoteUpdated: remote.updated, remoteHash: createHash('sha256').update(remote.description ?? '').digest('hex') });
      return this.read(id);
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
