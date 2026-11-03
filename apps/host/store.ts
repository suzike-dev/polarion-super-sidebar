import { DatabaseSync } from 'node:sqlite';
import type { Context, Draft, Run, RunEvent, Session, Target, Asset, PermissionMode } from '../../packages/protocol/index.ts';
import { sameTarget, SettingsSchema } from '../../packages/protocol/index.ts';

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
    const row = this.db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(String(row.json)) as T : undefined;
  }
  require<T>(kind: string, id: string): T { const item = this.get<T>(kind, id); if (!item) throw Error('NOT_FOUND'); return item; }
  put(kind: string, id: string, value: unknown) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind, id, JSON.stringify(value));
  }
  list<T>(kind: string): T[] { return this.db.prepare('SELECT json FROM records WHERE kind=?').all(kind).map(r => JSON.parse(String(r.json)) as T); }
  settings() { return SettingsSchema.parse(this.get('settings', 'global') ?? { defaultEngine: 'claude', claudeModel: '', codexModel: 'gpt-6.1-sol' }); }
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
  startRun(sessionId: string, requestId: string, prompt: string, contexts: Context[], selectedTarget?: Target, attachments: string[] = [], permissionMode:PermissionMode = 'ask') {
    const session = this.require<Session>('session', sessionId);
    const target = selectedTarget ?? session.target;
    const prior = this.db.prepare('SELECT run_id FROM requests WHERE id=?').get(requestId);
    if (prior) {
      const run = this.require<Run>('run', String(prior.run_id));
      if ((run.permissionMode??'ask') !== permissionMode || run.sessionId !== sessionId || run.prompt !== prompt || JSON.stringify(run.contexts) !== JSON.stringify(contexts) || JSON.stringify(run.attachments ?? []) !== JSON.stringify(attachments) || !sameTarget(run.target ?? session.target, target)) throw Error('REQUEST_ID_REUSED');
      return { run, created: false };
    }
    if (target.origin !== session.target.origin || target.projectId !== session.target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
    if (contexts.some(c => c.target.origin !== target.origin || c.target.projectId !== target.projectId || (!c.pinned && !sameTarget(c.target, target)))) throw Error('CONTEXT_TARGET_MISMATCH');
    const assets = attachments.map(id => this.require<Asset>('asset',id));
    if (assets.some(a => a.state !== 'ready' || a.target.origin !== target.origin || a.target.projectId !== target.projectId)) throw Error('ASSET_PROJECT_MISMATCH');
    if (this.list<Run>('run').some(r => r.sessionId === sessionId && ['running', 'waiting'].includes(r.status))) throw Error('SESSION_BUSY');
    const run: Run = { permissionMode, id: crypto.randomUUID(), requestId, sessionId, target: structuredClone(target), prompt, contexts: structuredClone(contexts), attachments: [...attachments], status: 'running', startedAt: Date.now() };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.put('run', run.id, run);
      this.db.prepare('INSERT INTO requests VALUES(?,?)').run(requestId, run.id);
      this.event(run, 'user', { text: prompt, contexts: run.contexts, target: run.target, attachments: assets.map(({id,name,mime,size,sha256,extraction})=>({id,name,mime,size,sha256,extraction})) });
      this.put('session', session.id, { ...session, target: run.target, updatedAt: Date.now() });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { run, created: true };
  }
  recoverInterruptedRuns() {
    for (const run of this.list<Run>('run')) if (['running', 'waiting'].includes(run.status)) {
      run.status = 'interrupted'; run.endedAt = Date.now(); run.error = 'HOST_RESTARTED';
      this.put('run', run.id, run); this.event(run, 'status', { status: run.status, error: run.error });
    }
  }
  drafts(target: Target) { return this.list<Draft>('draft').filter(d => sameTarget(d.target, target)); }
  close() { this.db.close(); }
}
