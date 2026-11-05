import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Context, Draft, Guideline, Run, RunEvent, Session, Target, Asset, PermissionMode, TurnDelivery } from '../../packages/protocol/index.ts';
import { sameTarget, SettingsSchema, DEFAULT_PERMISSION_MODE, DEFAULT_TURN_DELIVERY, normalizeGuideline } from '../../packages/protocol/index.ts';

const MAX_QUEUED_RUNS = 5;

export class Store {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,run_id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session_seq ON events(session_id,seq);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,run_id TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  get<T>(kind: string, id: string): T | undefined {
    if (kind === 'draft') { const folder = this.draftsFolder(); if (folder) return this.readDraftAt(id, folder) as T | undefined; }
    const row = this.db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(String(row.json)) as T : undefined;
  }
  require<T>(kind: string, id: string): T { const item = this.get<T>(kind, id); if (!item) throw Error('NOT_FOUND'); return item; }
  private putRecord(kind: string, id: string, json: string) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind, id, json);
  }
  put(kind: string, id: string, value: unknown) {
    if (kind === 'draft') { const folder = this.draftsFolder(); if (folder) { this.writeDraftAt(value as Draft, folder); return; } }
    this.putRecord(kind, id, JSON.stringify(value));
  }
  remove(kind: string, id: string) {
    if (kind === 'draft') { const folder = this.draftsFolder(); if (folder) { this.deleteDraftAt(id, folder); return; } }
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  }
  /** 按记录内容删除：适用于键是随机 UUID、记录体里没有 id 的检查点/回执。 */
  removeMatching(kind: string, predicate: (value: any) => boolean) {
    const rows = this.db.prepare('SELECT id,json FROM records WHERE kind=?').all(kind);
    for (const row of rows) {
      let value: any;
      try { value = JSON.parse(String(row.json)); } catch { continue; }
      if (predicate(value)) this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, String(row.id));
    }
  }
  list<T>(kind: string): T[] {
    if (kind === 'draft') {
      const folder = this.draftsFolder(); if (!folder) return this.db.prepare('SELECT json FROM records WHERE kind=?').all(kind).map(r => JSON.parse(String(r.json)) as T);
      let names: string[];
      try { names = fs.readdirSync(folder); }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return []; throw error; }
      return names
        .filter(name => name.endsWith('.json'))
        // 用户可能在该文件夹放置其他 JSON：只接受文件名与记录 id 一致、形状完整的工作项草稿。
        .flatMap(name => { const draft = this.draftFromFile(name, folder); return draft ? [draft as T] : []; });
    }
    return this.db.prepare('SELECT json FROM records WHERE kind=?').all(kind).map(r => JSON.parse(String(r.json)) as T);
  }
  private draftFromFile(name: string, folder: string): Draft | undefined {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as Draft;
      if (!value || typeof value !== 'object' || value.id !== name.replace(/\.json$/, '')) return;
      if (typeof value.workItemId !== 'string' || typeof value.title !== 'string' || typeof value.html !== 'string') return;
      if (!value.target || typeof value.target.projectId !== 'string' || typeof value.target.document !== 'string') return;
      return value;
    } catch { return; }
  }
  // ---- 共享草稿存储位置：默认内部数据库；设置自定义文件夹后按 <draftId>.json 存放，便于备份与迁移。
  private draftsFolder(): string | undefined { return this.settings().draftsFolder.trim() || undefined; }
  private draftFile(id: string, folder: string) { return path.join(folder, id + '.json'); }
  private readDraftAt(id: string, folder: string): Draft | undefined { return this.draftFromFile(id + '.json', folder); }
  private writeDraftAt(draft: Draft, folder: string) {
    fs.mkdirSync(folder, { recursive: true });
    const file = this.draftFile(draft.id, folder), temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(draft)); fs.renameSync(temporary, file);
  }
  private deleteDraftAt(id: string, folder: string) { fs.rmSync(this.draftFile(id, folder), { force: true }); }
  private canonicalFolder(folder: string) {
    if (!folder) return '';
    const resolved = path.resolve(folder);
    try { return fs.realpathSync.native(resolved).toLowerCase(); } catch { return resolved.toLowerCase(); }
  }
  /** 切换共享草稿存储位置并把现有草稿迁移过去；失败时不改动任何数据。 */
  setDraftsFolder(folder: string) {
    const trimmed = folder.trim(), current = this.draftsFolder(), target = trimmed || undefined;
    // 同一目录的另一种写法（斜杠/大小写/尾分隔符）不能当作迁移：否则会刚写入就删除同一批文件。
    if (this.canonicalFolder(current ?? '') === this.canonicalFolder(target ?? '')) {
      if ((current ?? '') !== trimmed) { const settings = this.settings(); settings.draftsFolder = trimmed; this.put('settings', 'global', settings); }
      return;
    }
    let drafts: Draft[];
    try { drafts = this.list<Draft>('draft'); } catch { drafts = []; } // 旧目录不可读（断开/拔盘）时允许切走，保留原文件。
    if (target) {
      if (!path.isAbsolute(trimmed)) throw Error('DRAFTS_FOLDER_NOT_ABSOLUTE');
      fs.mkdirSync(trimmed, { recursive: true });
      const probe = path.join(trimmed, '.polarion-write-test'); fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true });
      for (const draft of drafts) this.writeDraftAt(draft, target);
    } else {
      for (const draft of drafts) this.putRecord('draft', draft.id, JSON.stringify(draft));
    }
    // 先提交设置，再删除旧目录文件：删除后崩溃也不会出现“设置指向新目录但数据没迁过去”。
    const settings = this.settings(); settings.draftsFolder = trimmed; this.put('settings', 'global', settings);
    if (current) { for (const draft of drafts) { try { this.deleteDraftAt(draft.id, current); } catch { /* 旧目录不可写时保留副本 */ } } }
    else if (target) this.db.prepare("DELETE FROM records WHERE kind='draft'").run();
  }
  settings() { return SettingsSchema.parse(this.get('settings', 'global') ?? { defaultEngine: 'claude', claudeModel: '', codexModel: 'gpt-6.1-sol' }); }
  guidelines() { return this.list<Guideline>('guideline').map(normalizeGuideline); }
  createSession(target: Target, title: string) {
    const settings = this.settings();
    const session: Session = { id: crypto.randomUUID(), target, title, engine: settings.defaultEngine, model: settings.defaultEngine === 'claude' ? settings.claudeModel : settings.codexModel, createdAt: Date.now(), updatedAt: Date.now() };
    this.put('session', session.id, session); return session;
  }
  event(run: Run, kind: string, data: unknown) {
    const at = Date.now();
    const result = this.db.prepare('INSERT INTO events(session_id,run_id,kind,data,at) VALUES(?,?,?,?,?)').run(run.sessionId, run.id, kind, JSON.stringify(data), at);
    return Number(result.lastInsertRowid);
  }
  events(sessionId: string, after: number): RunEvent[] {
    return this.db.prepare('SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT 120').all(sessionId, after).map(r => ({ seq: Number(r.seq), sessionId: String(r.session_id), runId: String(r.run_id), kind: String(r.kind), data: JSON.parse(String(r.data)), at: Number(r.at) }));
  }
  startRun(sessionId: string, requestId: string, prompt: string, contexts: Context[], selectedTarget?: Target, attachments: string[] = [], permissionMode: PermissionMode = DEFAULT_PERMISSION_MODE, delivery: TurnDelivery = DEFAULT_TURN_DELIVERY, guidelineId?: string) {
    const session = this.require<Session>('session', sessionId);
    const target = selectedTarget ?? session.target;
    const prior = this.db.prepare('SELECT run_id FROM requests WHERE id=?').get(requestId);
    if (prior) {
      const run = this.require<Run>('run', String(prior.run_id));
      if ((run.permissionMode ?? 'ask') !== permissionMode || (run.delivery ?? DEFAULT_TURN_DELIVERY) !== delivery || run.guidelineId !== guidelineId || run.sessionId !== sessionId || run.prompt !== prompt || JSON.stringify(run.contexts) !== JSON.stringify(contexts) || JSON.stringify(run.attachments ?? []) !== JSON.stringify(attachments) || !sameTarget(run.target ?? session.target, target)) throw Error('REQUEST_ID_REUSED');
      return { run, created: false };
    }
    if (target.origin !== session.target.origin || target.projectId !== session.target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
    if (contexts.some(c => c.target.origin !== target.origin || c.target.projectId !== target.projectId || (!c.pinned && !sameTarget(c.target, target)))) throw Error('CONTEXT_TARGET_MISMATCH');
    const assets = attachments.map(id => this.require<Asset>('asset', id));
    if (assets.some(a => a.state !== 'ready' || a.target.origin !== target.origin || a.target.projectId !== target.projectId)) throw Error('ASSET_PROJECT_MISMATCH');
    const guideline = guidelineId ? this.get<Guideline>('guideline', guidelineId) : undefined;
    if (guidelineId && !guideline) throw Error('GUIDELINE_NOT_FOUND');
    // 运行中的会话不再拒绝新输入：排队等待或引导打断由调用方决定，队列保持先进先出。
    const pending = this.list<Run>('run').filter(r => r.sessionId === sessionId && ['running', 'waiting', 'queued'].includes(r.status));
    if (pending.filter(r => r.status === 'queued').length >= MAX_QUEUED_RUNS) throw Error('SESSION_QUEUE_FULL');
    const queued = pending.length > 0;
    const run: Run = { permissionMode, delivery, guidelineId, id: crypto.randomUUID(), requestId, sessionId, target: structuredClone(target), prompt, contexts: structuredClone(contexts), attachments: [...attachments], status: queued ? 'queued' : 'running', startedAt: queued ? Math.max(Date.now(), Math.max(...pending.map(r => r.startedAt)) + 1) : Date.now() };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.put('run', run.id, run);
      this.db.prepare('INSERT INTO requests VALUES(?,?)').run(requestId, run.id);
      this.event(run, 'user', { text: prompt, contexts: run.contexts, target: run.target, attachments: assets.map(({ id, name, mime, size, sha256, extraction }) => ({ id, name, mime, size, sha256, extraction })), guideline: guideline ? { id: guideline.id, name: guideline.name } : undefined });
      this.put('session', session.id, { ...session, target: run.target, updatedAt: Date.now() });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { run, created: true };
  }
  /** 取出会话中下一条排队任务并标记为运行：引导输入插队优先，其余按先进先出。 */
  claimQueued(sessionId: string) {
    const queued = this.list<Run>('run').filter(r => r.sessionId === sessionId && r.status === 'queued')
      .sort((a, b) => (a.delivery === 'steer' ? 0 : 1) - (b.delivery === 'steer' ? 0 : 1) || a.startedAt - b.startedAt);
    const next = queued[0];
    if (!next) return undefined;
    // 接手时重置开始时间：对话顺序与耗时按真实执行计，不含排队等待。
    next.status = 'running'; next.startedAt = Date.now();
    this.put('run', next.id, next); return next;
  }
  recoverInterruptedRuns() {
    for (const run of this.list<Run>('run')) if (['running', 'waiting', 'queued'].includes(run.status)) {
      run.status = 'interrupted'; run.endedAt = Date.now(); run.error = 'HOST_RESTARTED';
      this.put('run', run.id, run); this.event(run, 'status', { status: run.status, error: run.error });
    }
  }
  drafts(target: Target) { return this.list<Draft>('draft').filter(d => sameTarget(d.target, target)); }
  close() { this.db.close(); }
}
