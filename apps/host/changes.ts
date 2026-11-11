import {createHash, randomBytes} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {Store} from './store.ts';
import {Drafts, type ChangeRemoteRow, type ChangeWriteResult, type SnapshotItem} from './polarion.ts';
import {Assets} from './assets.ts';
import {chapterOf, collectImageSources, diffItemHtml, outlineBase, sanitizeBlockHtml, textOfHtml, type ChangeBlock} from '../../packages/core/change-diff.ts';
import {sameTarget, type Asset, type ChangeAiSummary, type ChangeChapterSummary, type ChangeField, type ChangeItem, type ChangeJobView, type ChangeRecord, type ChangeRecordSummary, type ChangeSession, type ChangeSessionView, type ChangeShareStatus, type ChangeWorkspace, type Target, type ChangeCompareOptions, type ChangePoint} from '../../packages/protocol/index.ts';
import {summarizeChange} from './summarize.ts';
import {ChangeShare} from './changes-share.ts';

/**
 * 变更记录以 Polarion 工作项为准：
 * - 每次「设定基准」在项目里创建一个工作项，基线快照是它的附件；
 * - 「结束变更」把同一个工作项更新为正式记录，并把基线的变化写成新的附件；
 * - 本机 SQLite 只缓存工作台展示所需的摘要与正文，换电脑/换人时从 Polarion 重新读取。
 * 标题使用固定英文标记，查询天然按 project.id 隔离，项目成员都能看到同一份记录。
 */

const ACTIVE_TOKEN = 'PSB-CHANGE-ACTIVE';
const RECORD_TOKEN = 'PSB-CHANGE';
const CANCEL_TOKEN = 'PSB-CANCEL';
const FILE_PATTERN = /^sidebar-change-([0-9a-f-]{36})\.(record|session)\.json$/;

type SnapshotPayload = {v: 1; target: Target; documentTitle: string; at: number; items: SnapshotItem[]};

type ChangeMeta = {
  v: 1;
  recordId: string;
  document: string;
  docTitle?: string;
  state: 'active' | 'done' | 'cancelled';
  baselineAt: number;
  endedAt?: number;
  itemCount: number;
  changedItems?: number;
  added?: number;
  removed?: number;
  modified?: number;
  moved?: number;
  headline?: string;
  ai?: 'pending' | 'ready' | 'failed';
  note?: string;
  attachment: string;
  author?: string;
};

type LocalSession = ChangeSession & {expectedUpdated?: string; attachmentId?: string};
type Job = ChangeJobView & {at: number};
type CachedIndex = {target: Target; workItemId: string; attachmentName: string; updated?: string};
type ShareToken = {id: string; target: Target; token: string; createdAt: number};

function stamp(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfToday() {
  const date = new Date(); date.setHours(0, 0, 0, 0); return date.getTime();
}

function docLabel(target: Target) {
  return target.document.split('/').filter(Boolean).at(-1) ?? target.document;
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gzipJson(value: unknown) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), {level: 9}).toString('base64');
}

function gunzipJson<T>(value: string): T {
  return JSON.parse(gunzipSync(Buffer.from(value, 'base64')).toString('utf8')) as T;
}

function metaComment(meta: ChangeMeta) {
  return `<!--PSB-CHANGE:${Buffer.from(JSON.stringify(meta), 'utf8').toString('base64')}-->`;
}

function parseMeta(description: string | undefined): ChangeMeta | undefined {
  const match = /<!--PSB-CHANGE:([A-Za-z0-9+/=]+)-->/.exec(description ?? '');
  if (!match?.[1]) return undefined;
  try {
    const value = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as ChangeMeta;
    if (value?.v !== 1 || typeof value.recordId !== 'string' || typeof value.document !== 'string' || !['active', 'done', 'cancelled'].includes(value.state)) return undefined;
    return value;
  } catch { return undefined; }
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{2,}$/.test(message) ? message : 'CHANGE_OPERATION_FAILED';
}

function numericOutline(outline: string) {
  return outline.split('.').filter(Boolean).map(part => Number(part) || 0);
}

function compareOutline(left: string, right: string) {
  const a = numericOutline(left), b = numericOutline(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function firstLine(text: string) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 跳过“## 结论”这类栏目名，取真正的一句话结论。
    if (!trimmed || trimmed.startsWith('#')) continue;
    const value = trimmed.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim();
    if (value) return truncate(value, 200);
  }
  return '';
}

function textSummaryHtml(text: string) {
  return text.split(/\r?\n/).map(line => {
    const value = line.trim();
    if (!value) return '';
    return `<p>${escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
  }).join('');
}

export class Changes {
  readonly store: Store;
  readonly drafts: Drafts;
  readonly assets: Assets;
  private jobs = new Map<string, Job>();
  private summarizing = new Set<string>();
  readonly share: ChangeShare;

  constructor(store: Store, drafts: Drafts, assets: Assets) {
    this.store = store; this.drafts = drafts; this.assets = assets;
    this.share = new ChangeShare(store, {
      resolveToken: token => this.resolveToken(token),
      list: target => this.loadRecords(target).then(value => value.records),
      read: recordId => this.readRecord(recordId),
    });
  }

  private remote() { return this.drafts.remote; }

  /* ------------------------------ 工作台读取 ------------------------------ */

  async workspace(target: Target): Promise<ChangeWorkspace> {
    const loaded = await this.loadRecords(target);
    let session = loaded.active;
    const local = this.store.list<LocalSession>('change-session')
      .filter(item => sameTarget(item.target, target) && ['starting', 'active', 'finishing', 'failed'].includes(item.state))
      .sort((left, right) => right.baselineAt - left.baselineAt)[0];
    // Polarion 里的会话优先；离线或刚创建尚未写入时回退到本机状态。
    if (!session && local) session = {...local, source: 'cache'};
    if (session?.jobId) {
      const job = this.jobs.get(session.jobId);
      if (job) session = {...session, job: this.jobView(job)};
      else if (session.state === 'starting') session = {...session, state: 'failed', error: session.error ?? 'CHANGE_JOB_LOST'};
    }
    return {
      session: session ?? null,
      records: loaded.records,
      projectRecords: loaded.projectRecords,
      share: this.share.status(),
      online: loaded.online,
      ...(loaded.warning ? {warning: loaded.warning} : {}),
    };
  }

  private async loadRecords(target: Target): Promise<{records: ChangeRecordSummary[]; projectRecords: ChangeRecordSummary[]; active: ChangeSessionView | null; online: boolean; warning?: string}> {
    try {
      const remote = this.remote();
      if (!remote.changeList) throw Error('CHANGE_BACKEND_UNAVAILABLE');
      const rows = await remote.changeList(target, 200);
      const records: ChangeRecordSummary[] = [];
      const projectRecords: ChangeRecordSummary[] = [];
      let active: ChangeSessionView | null = null;
      let recovered = 0, skipped = 0;
      for (const row of rows) {
        let meta = parseMeta(row.description);
        let recordTarget = target;
        if (!meta && recovered < 10) {
          recovered++;
          const recoveredValue = await this.recoverMeta(target, row);
          meta = recoveredValue?.meta;
          if (recoveredValue) recordTarget = recoveredValue.target;
        }
        if (!meta) { skipped++; continue; }
        // 记录可能来自同一项目的另一篇文档：摘要和缓存都必须使用记录自己的 target。
        recordTarget = {...target, document: meta.document};
        if (meta.state === 'active') {
          if (meta.document !== target.document) continue;
          const session: ChangeSessionView = {
            id: meta.recordId, target: recordTarget, state: 'active', documentTitle: meta.docTitle ?? docLabel(recordTarget),
            startedAt: meta.baselineAt, baselineAt: meta.baselineAt, itemCount: meta.itemCount,
            ...(meta.note ? {note: meta.note} : {}),
            workItemId: row.workItemId, attachmentName: meta.attachment,
            ...(row.author?.name || row.author?.id ? {author: row.author.name ?? row.author.id} : {}),
            source: 'polarion',
          };
          if (!active || session.baselineAt > active.baselineAt) active = session;
          continue;
        }
        if (meta.state !== 'done') continue;
        const summary = this.summaryFromMeta(recordTarget, row, meta);
        projectRecords.push(summary);
        if (meta.document === target.document) records.push(summary);
        this.store.put('change-record-index', meta.recordId, {target: recordTarget, workItemId: row.workItemId, attachmentName: meta.attachment, updated: row.updated});
        this.store.put('change-record-summary', meta.recordId, summary);
      }
      const byEndedAt = (left: ChangeRecordSummary, right: ChangeRecordSummary) => right.endedAt - left.endedAt;
      records.sort(byEndedAt); projectRecords.sort(byEndedAt);
      return {records, projectRecords, active, online: true, ...(skipped ? {warning: `有 ${skipped} 条记录缺少可读元数据，暂未显示；记录本体仍在项目工作项中。`} : {})};
    } catch {
      const projectRecords = this.store.list<ChangeRecordSummary>('change-record-summary')
        .filter(summary => summary.target.projectId === target.projectId)
        .sort((left, right) => right.endedAt - left.endedAt);
      const records = projectRecords.filter(summary => sameTarget(summary.target, target));
      return {records, projectRecords, active: null, online: false, warning: 'Polarion 暂时不可用，当前显示本机缓存的变更记录；记录仍以项目中的工作项为准。'};
    }
  }

  /** 兼容早期记录或 Polarion 清理 HTML 注释的情况：从附件还原元数据。 */
  private async recoverMeta(target: Target, row: ChangeRemoteRow): Promise<{meta: ChangeMeta; target: Target} | undefined> {
    const remote = this.remote();
    if (!remote.changeRead) return undefined;
    for (const attachment of row.attachments ?? []) {
      const name = attachment.file_name ?? '';
      const match = FILE_PATTERN.exec(name);
      if (!match) continue;
      try {
        const raw = await remote.changeRead(target, row.workItemId, name);
        if (match[2] === 'record') {
          const record = gunzipJson<ChangeRecord>(raw.dataBase64);
          record.updated = raw.updated;
          const recordTarget = record.target?.projectId === target.projectId ? record.target : target;
          this.store.put('change-record', record.id, record);
          this.store.put('change-record-index', record.id, {target: recordTarget, workItemId: row.workItemId, attachmentName: name, updated: raw.updated});
          return {
            target: recordTarget,
            meta: {
              v: 1, recordId: record.id, document: recordTarget.document, docTitle: record.documentTitle, state: 'done',
              baselineAt: record.baselineAt, endedAt: record.endedAt, itemCount: record.itemCount,
              changedItems: record.changedItems, added: record.added, removed: record.removed, modified: record.modified, moved: record.moved,
              headline: record.headline, ai: record.aiSummary.status, attachment: name,
            },
          };
        }
        const payload = gunzipJson<SnapshotPayload>(raw.dataBase64);
        const sessionTarget = payload.target?.projectId === target.projectId ? payload.target : target;
        return {
          target: sessionTarget,
          meta: {
            v: 1, recordId: match[1]!, document: sessionTarget.document, docTitle: payload.documentTitle, state: 'active',
            baselineAt: payload.at, itemCount: payload.items.length, attachment: name,
          },
        };
      } catch { /* 单个附件不可读不影响列表 */ }
    }
    return undefined;
  }

  private summaryFromMeta(target: Target, row: ChangeRemoteRow, meta: ChangeMeta): ChangeRecordSummary {
    const parsed = Date.parse(row.updated);
    const endedAt = meta.endedAt ?? (Number.isFinite(parsed) ? parsed : Date.now());
    return {
      id: meta.recordId, target, documentTitle: meta.docTitle ?? docLabel(target),
      baselineAt: meta.baselineAt, endedAt,
      itemCount: meta.itemCount, changedItems: meta.changedItems ?? 0,
      added: meta.added ?? 0, removed: meta.removed ?? 0, modified: meta.modified ?? 0, moved: meta.moved ?? 0,
      aiStatus: meta.ai ?? (meta.headline ? 'ready' : 'pending'), headline: meta.headline ?? '',
      workItemId: row.workItemId, attachmentName: meta.attachment,
    };
  }

  /* ------------------------------ 基准会话 ------------------------------ */

  async start(target: Target, note = ''): Promise<{session: ChangeSessionView}> {
    const existing = await this.loadRecords(target);
    if (existing.active) throw Error('CHANGE_SESSION_ACTIVE');
    const local = this.store.list<LocalSession>('change-session')
      .filter(item => sameTarget(item.target, target) && ['starting', 'active', 'finishing'].includes(item.state))[0];
    if (local) throw Error('CHANGE_SESSION_ACTIVE');

    const id = crypto.randomUUID();
    const now = Date.now();
    const nextNote = note.trim().slice(0, 2000);
    const session: LocalSession = {
      id, target, state: 'starting', documentTitle: docLabel(target),
      startedAt: now, baselineAt: now, itemCount: 0,
      ...(nextNote ? {note: nextNote} : {}),
      attachmentName: this.fileName(id, 'session'), source: 'polarion',
    };
    this.store.put('change-session', id, session);
    const job = this.startJob('start', async progress => {
      progress('正在读取文档与工作项正文…', 0, 0);
      const snapshot = await this.readDocument(target);
      progress('正在压缩基准快照…', snapshot.items.length, snapshot.items.length);
      const at = Date.now();
      const payload: SnapshotPayload = {v: 1, target, documentTitle: snapshot.documentTitle, at, items: snapshot.items};
      const meta: ChangeMeta = {
        v: 1, recordId: id, document: target.document, docTitle: snapshot.documentTitle, state: 'active',
        baselineAt: at, itemCount: snapshot.items.length,
        ...(nextNote ? {note: nextNote} : {}),
        attachment: this.fileName(id, 'session'),
      };
      progress('正在把基准写入 Polarion 项目…', 0, 1);
      const written = await this.writeCreate(target, snapshot, meta, payload);
      const next: LocalSession = {
        ...session, state: 'active', baselineAt: at, documentTitle: snapshot.documentTitle, itemCount: snapshot.items.length,
        workItemId: written.workItemId, expectedUpdated: written.updated, attachmentName: meta.attachment, attachmentId: written.attachmentId,
      };
      this.store.put('change-session', id, next);
      progress('基准已写入 Polarion', 1, 1);
      return {sessionId: id};
    }, error => {
      const failed: LocalSession = {...(this.store.get<LocalSession>('change-session', id) ?? session), state: 'failed', error};
      this.store.put('change-session', id, failed);
    });
    session.jobId = job.id;
    this.store.put('change-session', id, session);
    return {session: {...session, job: this.jobView(job)}};
  }

  async finish(sessionId: string): Promise<{jobId: string}> {
    const session = this.store.get<LocalSession>('change-session', sessionId);
    if (!session) throw Error('CHANGE_SESSION_NOT_FOUND');
    if (!['active', 'failed'].includes(session.state)) throw Error('CHANGE_SESSION_BUSY');
    if (!session.workItemId || !session.attachmentName) throw Error('CHANGE_SESSION_NOT_READY');
    const next: LocalSession = {...session, state: 'finishing', error: undefined};
    this.store.put('change-session', sessionId, next);
    const job = this.startJob('finish', async progress => {
      const remote = this.remote();
      if (!remote.changeRead) throw Error('CHANGE_BACKEND_UNAVAILABLE');
      progress('正在读取 Polarion 中的基准快照…', 0, 0);
      const baselineRaw = await remote.changeRead(session.target, session.workItemId!, session.attachmentName!);
      const baseline = gunzipJson<SnapshotPayload>(baselineRaw.dataBase64);
      progress('正在读取当前文档…', 0, 0);
      const current = await this.readDocument(session.target);
      progress('正在逐项比对…', current.items.length, current.items.length);
      const endedAt = Date.now();
      const record = this.buildRecord(session.target, session, baseline, current, endedAt);
      if (session.note && !record.note) record.note = session.note;
      progress('正在整理变更中的图片…', 0, 0);
      await this.resolveRecordImages(record);
      record.workItemId = session.workItemId;
      record.attachmentName = this.fileName(session.id, 'record');
      record.updated = session.expectedUpdated;
      const meta = this.metaFromRecord(record);
      progress('正在把变更记录写入 Polarion 项目…', 0, 1);
      const written = await this.writeUpdate(record, meta);
      record.updated = written.updated;
      record.workItemId = written.workItemId;
      this.cacheRecord(record);
      this.store.remove('change-session', session.id);
      progress('变更记录已保存到项目', 1, 1);
      return {recordId: record.id};
    }, error => {
      const failed: LocalSession = {...session, state: 'active', error};
      this.store.put('change-session', sessionId, failed);
    });
    return {jobId: job.id};
  }

  async cancel(sessionId: string): Promise<{cancelled: true}> {
    const session = this.store.get<LocalSession>('change-session', sessionId);
    if (!session) throw Error('CHANGE_SESSION_NOT_FOUND');
    let workItemId = session.workItemId;
    let attachmentName = session.attachmentName;
    let expectedUpdated = session.expectedUpdated;
    if (!workItemId) {
      // 启动过程可能已在 Polarion 建好工作项、但本机还没来得及记下 ID；从项目列表找回再取消。
      const loaded = await this.loadRecords(session.target);
      if (loaded.active?.id === session.id) {
        workItemId = loaded.active.workItemId;
        attachmentName = loaded.active.attachmentName;
        if (workItemId) expectedUpdated = (await this.rowFor(session.target, workItemId))?.updated;
      }
    }
    if (workItemId && this.remote().changeWrite) {
      const meta: ChangeMeta = {
        v: 1, recordId: session.id, document: session.target.document, docTitle: session.documentTitle, state: 'cancelled',
        baselineAt: session.baselineAt, itemCount: session.itemCount, attachment: attachmentName ?? this.fileName(session.id, 'session'),
      };
      try {
        await this.remote().changeWrite!({
          target: session.target, workItemId, expectedUpdated,
          title: `${CANCEL_TOKEN} ${truncate(session.documentTitle, 80)} · ${stamp(session.baselineAt)}`,
          description: `${metaComment(meta)}<h2>变更基准已取消</h2><p>本次基准没有生成变更记录；附件中的基线快照已清理。</p>`,
          fileName: attachmentName ?? this.fileName(session.id, 'session'),
          attachmentTitle: 'Polarion Sidebar 变更基准', dataBase64: '',
          ...(attachmentName ? {removeAttachments: [attachmentName]} : {}),
        });
      } catch (error) { throw Error(errorCode(error)); }
    }
    this.store.remove('change-session', sessionId);
    return {cancelled: true};
  }

  /**
   * 补建基准候选：把文档内工作项的 created/updated 以及最近几个工作项的历史 revision
   * 聚合成“变更事件”，让用户选时间点而不是手写时间。
   */
  async compareOptions(target: Target): Promise<ChangeCompareOptions> {
    const snapshot = await this.readDocument(target);
    const minuteMap = new Map<number, {at: number; items: Set<string>}>();
    const add = (date: string | undefined, id: string) => {
      const ms = Date.parse(date ?? '');
      if (!Number.isFinite(ms) || ms > Date.now() + 60_000) return;
      const key = Math.floor(ms / 60_000) * 60_000;
      const row = minuteMap.get(key) ?? {at: ms, items: new Set<string>()};
      row.at = Math.max(row.at, ms); row.items.add(id); minuteMap.set(key, row);
    };
    for (const item of snapshot.items) { add(item.updated, item.id); add(item.created, item.id); }
    // 同一工作项可能改过多次；补充最近几个工作项的完整 revision 时间线，才能看到“上上次”。
    const recent = [...snapshot.items]
      .filter(item => item.updated)
      .sort((left, right) => Date.parse(right.updated) - Date.parse(left.updated))
      .slice(0, 5);
    if (this.remote().history) {
      for (const item of recent) {
        try { for (const change of await this.remote().history!(target, item.id)) add(change.date, item.id); }
        catch { /* 单个工作项历史不可读不影响候选列表 */ }
      }
    }
    const events = [...minuteMap.entries()]
      .map(([key, row]) => ({at: row.at, beforeAt: key - 1, label: stamp(row.at), count: row.items.size}))
      .filter(event => event.at <= Date.now())
      .sort((left, right) => right.at - left.at)
      .slice(0, 12);
    const points: ChangePoint[] = [
      {at: Date.now(), label: '现在', hint: '当前文档', kind: 'now'},
      {at: startOfToday(), label: '今天开始', hint: '今天 00:00 的文档状态', kind: 'start'},
    ];
    try {
      const lastRecord = (await this.loadRecords(target)).records[0];
      if (lastRecord) points.push({at: lastRecord.endedAt, label: '上一条变更记录结束', hint: lastRecord.headline.slice(0, 80), kind: 'record'});
    } catch { /* 记录读取失败不影响时间点 */ }
    for (const event of events) {
      points.push({at: event.beforeAt, label: `变更前 · ${event.label}`, hint: `${event.count} 个工作项在此刻更新`, kind: 'before'});
      points.push({at: event.at, label: `变更后 · ${event.label}`, hint: `${event.count} 个工作项在此刻更新`, kind: 'after'});
    }
    const seen = new Set<number>();
    const unique = points.filter(point => {
      if (!Number.isFinite(point.at) || point.at <= 0 || seen.has(point.at)) return false;
      seen.add(point.at); return true;
    }).sort((left, right) => right.at - left.at);
    return {documentTitle: snapshot.documentTitle, itemCount: snapshot.items.length, points: unique, events};
  }

  /** 按两个时间点补建变更记录：不依赖事先设定的基准，适合“改完才想起来”的场景。 */
  async compare(target: Target, beforeAt: number, afterAt: number): Promise<{jobId: string}> {
    if (!Number.isFinite(beforeAt) || !Number.isFinite(afterAt) || beforeAt <= 0 || afterAt <= beforeAt) throw Error('CHANGE_COMPARE_RANGE_INVALID');
    if (afterAt > Date.now() + 60_000) throw Error('CHANGE_COMPARE_AFTER_FUTURE');
    const id = crypto.randomUUID();
    const job = this.startJob('compare', async progress => {
      progress('正在还原变更前文档…', 0, 0);
      const before = await this.readDocumentAt(target, beforeAt, progress);
      progress('正在还原变更后文档…', 0, 0);
      const after = await this.readDocumentAt(target, afterAt, progress);
      progress('正在逐项比对…', 0, 0);
      const pseudo: LocalSession = {
        id, target, state: 'active', documentTitle: after.documentTitle,
        startedAt: beforeAt, baselineAt: beforeAt, itemCount: after.items.length,
      };
      const record = this.buildRecord(target, pseudo, {v: 1, target, documentTitle: before.documentTitle, at: beforeAt, items: before.items}, after, afterAt);
      record.note = `按时间补建：${stamp(beforeAt)} → ${stamp(afterAt)}${before.approximate || after.approximate ? '；部分历史版本无法精确还原，已按当前内容近似。' : ''}`;
      progress('正在整理变更中的图片…', 0, 0);
      await this.resolveRecordImages(record);
      record.attachmentName = this.fileName(id, 'record');
      const meta = this.metaFromRecord(record);
      progress('正在把变更记录写入 Polarion 项目…', 0, 1);
      const written = await this.writeCreateRecord(record, meta, after.items);
      record.workItemId = written.workItemId;
      record.updated = written.updated;
      this.cacheRecord(record);
      progress('变更记录已保存到项目', 1, 1);
      return {recordId: record.id};
    }, () => {});
    return {jobId: job.id};
  }

  /**
   * 还原某个时间点的文档：
   * - created 晚于时间点的工作项不存在；
   * - updated 早于时间点的工作项直接使用当前内容；
   * - 其余工作项读取字段级历史，反向回退 description/title/status/type。
   * 文档结构（章节顺序）在历史里不可得，沿用当前 outline；超出历史读取上限时标记为近似。
   */
  private async readDocumentAt(target: Target, at: number, progress: (phase: string, done: number, total: number) => void): Promise<{documentTitle: string; items: SnapshotItem[]; approximate: boolean}> {
    const current = await this.readDocument(target);
    if (at >= Date.now() - 30_000) return {...current, approximate: false};
    const remote = this.remote();
    let approximate = false;
    const existed = current.items.filter(item => {
      const created = Date.parse(item.created ?? '');
      return !Number.isFinite(created) || created <= at;
    });
    const existedIds = new Set(existed.map(item => item.id));
    const needs = current.items.filter(item => {
      if (!existedIds.has(item.id)) return false;
      const updated = Date.parse(item.updated ?? '');
      return Number.isFinite(updated) && updated > at;
    });
    const work = needs.slice(0, 80);
    if (needs.length > work.length) approximate = true;
    const reconstructed = new Map<string, SnapshotItem>();
    if (work.length && !remote.history) approximate = true;
    let done = 0;
    let cursor = 0;
    const total = work.length;
    if (total) progress('正在还原历史版本…', 0, total);
    const drain = async () => {
      while (cursor < work.length) {
        const item = work[cursor++]!;
        if (remote.history) {
          try {
            const history = await remote.history(target, item.id);
            reconstructed.set(item.id, {
              ...item,
              title: fieldAt(history, at, 'title', item.title),
              status: fieldAt(history, at, 'status', item.status),
              type: fieldAt(history, at, 'type', item.type),
              html: fieldAt(history, at, 'description', item.html),
              updated: `at:${at}`,
            });
          } catch { approximate = true; }
        }
        progress('正在还原历史版本…', ++done, total);
      }
    };
    await Promise.all(Array.from({length: Math.min(4, Math.max(1, work.length))}, drain));
    const items = current.items.flatMap(item => existedIds.has(item.id) ? [reconstructed.get(item.id) ?? item] : []);
    return {documentTitle: current.documentTitle, items, approximate};
  }

  jobRead(jobId: string): ChangeJobView {
    const job = this.jobs.get(jobId);
    if (!job) throw Error('CHANGE_JOB_NOT_FOUND');
    return this.jobView(job);
  }

  private jobView(job: Job): ChangeJobView {
    return {id: job.id, kind: job.kind, state: job.state, phase: job.phase, done: job.done, total: job.total, ...(job.error ? {error: job.error} : {}), ...(job.detail ? {detail: job.detail} : {}), ...(job.recordId ? {recordId: job.recordId} : {})};
  }

  private startJob(kind: 'start' | 'finish' | 'compare', run: (progress: (phase: string, done: number, total: number) => void) => Promise<{sessionId?: string; recordId?: string}>, onError: (error: string) => void): Job {
    const job: Job = {id: crypto.randomUUID(), kind, state: 'running', phase: '准备中…', done: 0, total: 0, at: Date.now()};
    this.jobs.set(job.id, job);
    const progress = (phase: string, done: number, total: number) => { job.phase = phase; job.done = done; job.total = total; };
    void run(progress).then(result => {
      job.state = 'done'; job.phase = '完成'; job.done = Math.max(job.done, job.total);
      if (result.recordId) job.recordId = result.recordId;
    }).catch(error => {
      const code = errorCode(error);
      const raw = error instanceof Error ? error.message : String(error);
      job.state = 'failed'; job.error = code; job.detail = raw.slice(0, 800); job.phase = '失败';
      onError(code);
    }).finally(() => {
      const timer = setTimeout(() => this.jobs.delete(job.id), 10 * 60_000);
      (timer as unknown as {unref?: () => void}).unref?.();
    });
    return job;
  }

  /* ------------------------------ 快照与记录 ------------------------------ */

  private async readDocument(target: Target) {
    const remote = this.remote();
    if (!remote.bulkRead) throw Error('CHANGE_BACKEND_UNAVAILABLE');
    const snapshot = await remote.bulkRead(target);
    if (!snapshot || !Array.isArray(snapshot.items)) throw Error('CHANGE_SNAPSHOT_FAILED');
    const items = snapshot.items.filter(item => item.id).sort((left, right) => compareOutline(left.outline, right.outline));
    return {documentTitle: snapshot.documentTitle || docLabel(target), items};
  }

  private fileName(id: string, kind: 'record' | 'session') {
    return `sidebar-change-${id}.${kind}.json`;
  }

  private title(target: Target, state: 'active' | 'done', meta: ChangeMeta) {
    const token = state === 'active' ? ACTIVE_TOKEN : RECORD_TOKEN;
    return `${token} · ${truncate(meta.docTitle ?? docLabel(target), 90)} · ${stamp(meta.endedAt ?? meta.baselineAt)}`;
  }

  private activeDescription(target: Target, meta: ChangeMeta) {
    return `${metaComment(meta)}<h2>变更基准</h2><p><strong>文档：</strong>${escapeHtml(meta.docTitle ?? docLabel(target))}</p><p><strong>基准时间：</strong>${stamp(meta.baselineAt)}</p><p><strong>检查范围：</strong>${meta.itemCount} 个工作项</p>${meta.note ? `<p><strong>修改目的：</strong>${escapeHtml(meta.note)}</p>` : ''}<p>这是由 Polarion 超级侧边栏设置的变更基准。结束后本工作项会更新为正式变更记录，完整对照存放在附件中。</p>`;
  }

  private doneDescription(record: ChangeRecord) {
    const meta = this.metaFromRecord(record);
    const summary = record.aiSummary.status === 'ready' && record.aiSummary.text ? record.aiSummary.text : record.heuristicSummary;
    const chapters = record.chapters.length
      ? `<h3>章节分布</h3><ul>${record.chapters.map(chapter => `<li>${escapeHtml(chapter.num === '0' ? '未分节' : `第 ${chapter.num} 章`)}${chapter.title && chapter.title !== chapter.num ? ' ' + escapeHtml(chapter.title) : ''}：${chapter.items} 项变更</li>`).join('')}</ul>`
      : '';
    return `${metaComment(meta)}<h2>需求变更记录</h2><p><strong>文档：</strong>${escapeHtml(record.documentTitle)}</p><p><strong>变更区间：</strong>${stamp(record.baselineAt)} → ${stamp(record.endedAt)}</p>${record.note ? `<p><strong>说明：</strong>${escapeHtml(record.note)}</p>` : ''}<p><strong>变更范围：</strong>${record.changedItems} 个工作项（修改 ${record.modified}、新增 ${record.added}、删除 ${record.removed}${record.moved ? `、移动 ${record.moved}` : ''}）</p><h3>变更总结</h3>${textSummaryHtml(summary)}${chapters}<p>完整的前后对照（含表格、图片与未变更上下文）见附件 <code>${escapeHtml(record.attachmentName ?? '')}</code>。</p>`;
  }

  private metaFromRecord(record: ChangeRecord): ChangeMeta {
    return {
      v: 1, recordId: record.id, document: record.target.document, docTitle: record.documentTitle, state: 'done',
      baselineAt: record.baselineAt, endedAt: record.endedAt, itemCount: record.itemCount,
      changedItems: record.changedItems, added: record.added, removed: record.removed, modified: record.modified, moved: record.moved,
      headline: record.headline, ai: record.aiSummary.status, attachment: record.attachmentName ?? this.fileName(record.id, 'record'),
    };
  }

  private typeCandidates(items: SnapshotItem[]) {
    const configured = this.store.settings().changeRecordType.trim();
    const counts = new Map<string, number>();
    for (const item of items) if (item.type) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    const likely = [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([type]) => type);
    // 优先使用文档里真实存在的类型：项目级 task 等类型可能被工作流/字段配置限制，附件写入会回滚。
    return [...new Set([configured, ...likely, 'task', 'changeRequest', 'change', 'risk', 'defect'].filter(Boolean))];
  }

  private async writeCreate(target: Target, snapshot: {documentTitle: string; items: SnapshotItem[]}, meta: ChangeMeta, payload: SnapshotPayload): Promise<ChangeWriteResult> {
    const remote = this.remote();
    if (!remote.changeWrite) throw Error('CHANGE_BACKEND_UNAVAILABLE');
    const dataBase64 = gzipJson(payload);
    let last: unknown;
    for (const type of this.typeCandidates(snapshot.items)) {
      try {
        return await remote.changeWrite({
          target, type,
          title: this.title(target, 'active', meta), description: this.activeDescription(target, meta),
          fileName: meta.attachment, attachmentTitle: 'Polarion Sidebar 变更基准', dataBase64,
        });
      } catch (error) {
        last = error;
        // 只有“类型不可用”才值得换一个类型重试；网络/权限/附件失败直接上报。
        if (!/CHANGE_RECORD_CREATE_FAILED/.test(String((error as Error).message))) throw error;
      }
    }
    throw last instanceof Error ? last : Error('CHANGE_RECORD_CREATE_FAILED');
  }

  private async writeCreateRecord(record: ChangeRecord, meta: ChangeMeta, items: SnapshotItem[]): Promise<ChangeWriteResult> {
    const remote = this.remote();
    if (!remote.changeWrite || !record.attachmentName) throw Error('CHANGE_BACKEND_UNAVAILABLE');
    const payload = {...record};
    delete payload.updated;
    const dataBase64 = gzipJson(payload);
    let last: unknown;
    for (const type of this.typeCandidates(items)) {
      try {
        return await remote.changeWrite({
          target: record.target, type,
          title: this.title(record.target, 'done', meta), description: this.doneDescription(record),
          fileName: record.attachmentName, attachmentTitle: 'Polarion Sidebar 变更记录', dataBase64,
        });
      } catch (error) {
        last = error;
        if (!/CHANGE_RECORD_CREATE_FAILED/.test(String((error as Error).message))) throw error;
      }
    }
    throw last instanceof Error ? last : Error('CHANGE_RECORD_CREATE_FAILED');
  }

  private async writeUpdate(record: ChangeRecord, meta: ChangeMeta): Promise<ChangeWriteResult> {
    const remote = this.remote();
    if (!remote.changeWrite || !record.workItemId || !record.attachmentName) throw Error('CHANGE_BACKEND_UNAVAILABLE');
    const payload = {...record};
    delete payload.updated;
    const dataBase64 = gzipJson(payload);
    const attempt = (expectedUpdated?: string) => remote.changeWrite!({
      target: record.target, workItemId: record.workItemId!, ...(expectedUpdated ? {expectedUpdated} : {}),
      title: this.title(record.target, 'done', meta), description: this.doneDescription(record),
      fileName: record.attachmentName!, attachmentTitle: 'Polarion Sidebar 变更记录', dataBase64,
      removeAttachments: [this.fileName(record.id, 'session')],
    });
    try { return await attempt(record.updated); }
    catch (error) {
      if (!/CHANGE_RECORD_CONFLICT/.test(String((error as Error).message))) throw error;
      const latest = await this.rowFor(record.target, record.workItemId);
      return attempt(latest?.updated);
    }
  }

  private buildRecord(target: Target, session: LocalSession, baseline: SnapshotPayload, current: {documentTitle: string; items: SnapshotItem[]}, endedAt: number): ChangeRecord {
    const before = new Map(baseline.items.map(item => [item.id, item]));
    const after = new Map(current.items.map(item => [item.id, item]));
    const headings = new Map<string, string>();
    for (const item of [...baseline.items, ...current.items]) if (item.type === 'heading' && item.outline) headings.set(outlineBase(item.outline), item.title);
    // 功能单元路径：章号 + 章名（如“功能需求”），再带小节（如 3.7 执行及辅助状态输出选择）。
    const sectionLabel = (outline: string) => {
      const base = outlineBase(outline);
      if (!base) return '';
      const parts = base.split('.');
      const chapterName = headings.get(parts[0]!) ?? '';
      const chapterPart = `第${parts[0]}章` + (chapterName && chapterName !== parts[0] ? ` ${chapterName}` : '');
      if (parts.length === 1) return chapterPart;
      const groupName = headings.get(base) ?? '';
      return `${chapterPart} · ${base}${groupName && groupName !== base ? ` ${groupName}` : ''}`;
    };
    const changes: ChangeItem[] = [];

    for (const item of current.items) {
      const prior = before.get(item.id);
      if (!prior) {
        const diff = diffItemHtml('', item.html);
        changes.push({
          workItemId: item.id, title: item.title, outlineBefore: '', outlineAfter: item.outline,
          chapterBefore: '0', chapterAfter: chapterOf(item.outline), sectionAfter: sectionLabel(item.outline), kind: 'added', fields: [],
          blocks: this.prepareBlocks(diff.blocks), counts: {added: diff.counts.added, removed: diff.counts.removed, modified: diff.counts.modified},
        });
        continue;
      }
      const fields = fieldChanges(prior, item);
      if (prior.updated === item.updated && fields.length === 0) continue;
      const diff = diffItemHtml(prior.html, item.html);
      if (!diff.changed && fields.length === 0) continue;
      const onlyMoved = !diff.changed && fields.length > 0 && fields.every(field => field.name === '章节' || field.name === '序号');
      changes.push({
        workItemId: item.id, title: item.title || prior.title,
        outlineBefore: prior.outline, outlineAfter: item.outline,
        chapterBefore: chapterOf(prior.outline), chapterAfter: chapterOf(item.outline),
        sectionBefore: sectionLabel(prior.outline), sectionAfter: sectionLabel(item.outline),
        kind: onlyMoved ? 'moved' : 'modified', fields,
        blocks: this.prepareBlocks(diff.blocks), counts: {added: diff.counts.added, removed: diff.counts.removed, modified: diff.counts.modified},
      });
    }
    for (const item of baseline.items) {
      if (after.has(item.id)) continue;
      const diff = diffItemHtml(item.html, '');
      changes.push({
        workItemId: item.id, title: item.title, outlineBefore: item.outline, outlineAfter: '',
        chapterBefore: chapterOf(item.outline), chapterAfter: '0', sectionBefore: sectionLabel(item.outline), kind: 'removed', fields: [],
        blocks: this.prepareBlocks(diff.blocks), counts: {added: diff.counts.added, removed: diff.counts.removed, modified: diff.counts.modified},
      });
    }
    changes.sort((left, right) => compareOutline(left.outlineAfter || left.outlineBefore, right.outlineAfter || right.outlineBefore) || left.workItemId.localeCompare(right.workItemId));

    const chapterMap = new Map<string, ChangeChapterSummary>();
    for (const change of changes) {
      const num = change.chapterAfter !== '0' ? change.chapterAfter : change.chapterBefore;
      const title = headings.get(num) ?? (num === '0' ? '未分节' : num);
      const row = chapterMap.get(num) ?? {num, title, items: 0, added: 0, removed: 0, modified: 0, moved: 0};
      row.items++;
      row[change.kind]++;
      chapterMap.set(num, row);
    }
    const chapters = [...chapterMap.values()].sort((left, right) => compareOutline(left.num, right.num));
    // 记录会作为附件写入 Polarion；必须控制单条记录体积，避免大文档拖垮附件写入。
    let htmlBudget = 6_000_000, textBudget = 1_500_000;
    for (const change of changes) {
      for (const block of change.blocks) {
        if (block.kind === 'same') {
          if (block.html) {
            if (htmlBudget < block.html.length) block.html = '<p class="cw-large">内容较大，请在 Polarion 中查看完整内容。</p>';
            else htmlBudget -= block.html.length;
          }
          if ((block.text?.length ?? 0) > textBudget) block.text = '…（未变更内容较长，请在 Polarion 中查看）';
          else textBudget -= block.text?.length ?? 0;
          continue;
        }
        for (const key of ['before', 'after'] as const) {
          const html = block[key];
          if (!html) continue;
          if (htmlBudget < html.length) block[key] = '<p class="cw-large">内容较大，请在 Polarion 中查看完整变更。</p>';
          else htmlBudget -= html.length;
        }
      }
    }
    const kindCounts = {modified: 0, added: 0, removed: 0, moved: 0};
    for (const change of changes) kindCounts[change.kind]++;
    const itemCount = Math.max(baseline.items.length, current.items.length);
    const top = [...chapters].sort((left, right) => right.items - left.items)[0];
    const headline = `${session.documentTitle || current.documentTitle}：${changes.length} 个工作项变更（修改 ${kindCounts.modified}、新增 ${kindCounts.added}、删除 ${kindCounts.removed}${kindCounts.moved ? `、移动 ${kindCounts.moved}` : ''}）${top ? `，集中在${top.num === '0' ? '未分节' : `第 ${top.num} 章`}` : ''}`;
    const heuristic = this.heuristicSummary(session, baseline, itemCount, changes, chapters, kindCounts, endedAt);
    const saveCount = this.store.list<{target: Target; startedAt: number}>('save')
      .filter(save => sameTarget(save.target, target) && save.startedAt >= session.baselineAt && save.startedAt <= endedAt).length;
    return {
      id: session.id, target, documentTitle: current.documentTitle || session.documentTitle,
      baselineAt: session.baselineAt, endedAt, itemCount,
      changedItems: changes.length, ...kindCounts,
      aiStatus: 'pending', headline,
      chapters, changes, images: {},
      heuristicSummary: heuristic,
      ...(saveCount ? {saveCount} : {}),
      aiSummary: {status: 'pending', text: ''},
    };
  }

  private heuristicSummary(session: LocalSession, baseline: SnapshotPayload, itemCount: number, changes: ChangeItem[], chapters: ChangeChapterSummary[], counts: {modified: number; added: number; removed: number; moved: number}, endedAt: number) {
    const lines = [
      '## 结论',
      `- 本次共变更 **${changes.length} 个工作项**：修改 ${counts.modified}、新增 ${counts.added}、删除 ${counts.removed}${counts.moved ? `、移动 ${counts.moved}` : ''}。`,
      `- 区间：${stamp(session.baselineAt)} → ${stamp(endedAt)}；检查 ${itemCount} 个工作项。`,
    ];
    if (session.note) lines.push(`- 修改目的：${session.note}`);
    lines.push('', '## 变更要点');
    const byChapter = new Map<string, ChangeItem[]>();
    for (const change of changes) {
      const num = change.chapterAfter !== '0' ? change.chapterAfter : change.chapterBefore;
      byChapter.set(num, [...(byChapter.get(num) ?? []), change]);
    }
    // 优先展示变更最多的章节，再按章节顺序排列，避免前几章为空时摘要没有重点。
    const selected = [...chapters].sort((left, right) => right.items - left.items).slice(0, 4).sort((left, right) => compareOutline(left.num, right.num));
    let listed = 0;
    for (const chapter of selected) {
      const items = byChapter.get(chapter.num) ?? [];
      if (!items.length) continue;
      const chapterName = chapter.num === '0' ? '未分节' : `第${chapter.num}章${chapter.title && chapter.title !== chapter.num ? ` ${chapter.title}` : ''}`;
      lines.push(`### ${chapterName}`);
      for (const change of items.slice(0, 4)) {
        const section = change.sectionAfter || change.sectionBefore || '';
        lines.push(`- **${change.workItemId} ${change.title || ''}**${section ? `（${section}）` : ''}：${this.changeBrief(change)}`);
        listed++;
      }
      if (items.length > 4) {
        lines.push(`- 本章另有 ${items.length - 4} 项，见逐项对照。`);
        listed += items.length - 4;
      }
    }
    if (changes.length > listed) lines.push(`- 其余 ${changes.length - listed} 个工作项见逐项对照。`);
    lines.push('', '## 影响提示');
    const hints: string[] = [];
    if (changes.some(change => change.blocks.some(block => block.kind !== 'same' && block.tag === 'table'))) hints.push('包含表格变更，建议核对表头、行列对应关系与单位。');
    if (changes.some(change => change.fields.some(field => field.name === '状态'))) hints.push('工作项状态发生变化，请确认评审与发布流程。');
    if (changes.some(change => change.kind === 'added')) hints.push('存在新增工作项，请补充验证场景与追踪关系。');
    if (!hints.length) hints.push('发布前请确认变更内容与下游设计、测试基线一致。');
    for (const hint of hints.slice(0, 3)) lines.push(`- ${hint}`);
    return lines.join('\n');
  }

  /** 每个工作项压缩成一行：优先属性变化，其次最多三条正文变化。 */
  private changeBrief(change: ChangeItem) {
    const parts: string[] = [];
    for (const field of change.fields.slice(0, 2)) {
      const before = field.before.length > 30 ? field.before.slice(0, 29) + '…' : field.before;
      const after = field.after.length > 30 ? field.after.slice(0, 29) + '…' : field.after;
      parts.push(`${field.name}：${before} → ${after}`);
    }
    for (const block of change.blocks) {
      if (block.kind === 'same') continue;
      if (block.kind === 'added') {
        const text = textOfHtml(block.after ?? '', 60);
        if (text) parts.push(`新增“${text}”`);
      } else if (block.kind === 'removed') {
        const text = textOfHtml(block.before ?? '', 60);
        if (text) parts.push(`删除“${text}”`);
      } else {
        const before = textOfHtml(block.before ?? '', 42), after = textOfHtml(block.after ?? '', 42);
        if (before || after) parts.push(`“${before}” → “${after}”`);
      }
      if (parts.length >= 3) break;
    }
    const brief = parts.filter(Boolean).slice(0, 3).join('；');
    return brief.length > 220 ? brief.slice(0, 219) + '…' : (brief || '内容调整');
  }

  private prepareBlocks(blocks: ChangeBlock[]): ChangeBlock[] {
    let budget = 1_500_000;
    return blocks.map(block => {
      if (block.kind === 'same') {
        let html = '';
        if (block.html) {
          const sanitized = sanitizeBlockHtml(block.html, 8000, true);
          if (sanitized.length <= 300_000 && budget >= sanitized.length) {
            budget -= sanitized.length;
            html = sanitized;
          } else {
            html = '<p class="cw-large">内容较大，请在 Polarion 中查看完整内容。</p>';
          }
        }
        return {...block, html, text: (block.text ?? '').slice(0, 2000)};
      }
      const next = {...block};
      const clean = (html: string) => {
        const sanitized = sanitizeBlockHtml(html, 8000, true);
        if (sanitized.length > 300_000 || budget < sanitized.length) return '<p class="cw-large">内容较大，请在 Polarion 中查看完整变更。</p>';
        budget -= sanitized.length;
        return sanitized;
      };
      if (next.before) next.before = clean(next.before);
      if (next.after) next.after = clean(next.after);
      return next;
    });
  }

  private async resolveRecordImages(record: ChangeRecord) {
    const remote = this.remote();
    const sources = new Map<string, string>();
    for (const change of record.changes) {
      if (change.kind === 'removed') continue;
      for (const block of change.blocks) {
        for (const html of [block.before, block.after, block.html]) {
          if (!html) continue;
          for (const src of collectImageSources(html)) if (!sources.has(src)) sources.set(src, change.workItemId);
        }
      }
    }
    const images: Record<string, string> = {};
    let total = 0, count = 0;
    for (const [src, workItemId] of sources) {
      if (count >= 12 || total > 6_000_000) break;
      if (/^data:image\//i.test(src)) { images[src] = src; continue; }
      try {
        const asset = await remote.image?.(record.target, workItemId, src) as Asset | undefined;
        if (!asset) continue;
        const bytes = this.assets.bytes(asset.id);
        if (bytes.length > 2_000_000 || total + bytes.length > 6_000_000) continue;
        total += bytes.length; count++;
        images[src] = `data:${asset.mime};base64,${bytes.toString('base64')}`;
      } catch { /* 无法读取的历史图片保留占位符 */ }
    }
    record.images = images;
  }

  /** 旧记录没有 sectionAfter/Before：读取时用章节标题 + outline 兜底补齐，保证 AI 重算与界面一致。 */
  private enrichSections(record: ChangeRecord) {
    if (record.changes.every(change => (change.sectionAfter ?? '') !== '' || (change.sectionBefore ?? '') !== '')) return record;
    const titles = new Map(record.chapters.map(chapter => [chapter.num, chapter.title && chapter.title !== chapter.num ? chapter.title : '']));
    const label = (outline: string, chapter: string) => {
      if (chapter === '0') return '未分节';
      if (!outline) return '';
      const base = outline.replace(/-\d+$/, '');
      const name = titles.get(chapter) ?? '';
      return `第${chapter}章${name ? ` ${name}` : ''} · ${base}`;
    };
    for (const change of record.changes) {
      if (!change.sectionAfter && change.outlineAfter) change.sectionAfter = label(change.outlineAfter, change.chapterAfter);
      if (!change.sectionBefore && change.outlineBefore) change.sectionBefore = label(change.outlineBefore, change.chapterBefore);
    }
    return record;
  }

  private cacheRecord(record: ChangeRecord) {
    this.store.put('change-record', record.id, record);
    this.store.put('change-record-index', record.id, {target: record.target, workItemId: record.workItemId ?? '', attachmentName: record.attachmentName ?? '', updated: record.updated});
    this.store.put('change-record-summary', record.id, this.summaryFromRecord(record));
  }

  private summaryFromRecord(record: ChangeRecord): ChangeRecordSummary {
    return {
      id: record.id, target: record.target, documentTitle: record.documentTitle,
      baselineAt: record.baselineAt, endedAt: record.endedAt, itemCount: record.itemCount,
      changedItems: record.changedItems, added: record.added, removed: record.removed, modified: record.modified, moved: record.moved,
      aiStatus: record.aiSummary.status, headline: record.headline,
      workItemId: record.workItemId, attachmentName: record.attachmentName,
    };
  }

  /* ------------------------------ 记录读取与 AI 总结 ------------------------------ */

  async readRecord(recordId: string): Promise<ChangeRecord> {
    const index = this.store.get<CachedIndex>('change-record-index', recordId);
    const cached = this.store.get<ChangeRecord>('change-record', recordId);
    const remote = this.remote();
    if (index?.workItemId && index.attachmentName && remote.changeRead) {
      try {
        const raw = await remote.changeRead(index.target, index.workItemId, index.attachmentName);
        const record = this.enrichSections(gunzipJson<ChangeRecord>(raw.dataBase64));
        record.updated = raw.updated;
        // 新建记录时附件先于工作项创建写入，JSON 里可能还没有 workItemId；用索引补齐。
        record.workItemId = index.workItemId;
        record.attachmentName ||= index.attachmentName;
        this.cacheRecord(record);
        return record;
      } catch { /* 离线时回退缓存 */ }
    }
    if (cached) return this.enrichSections(cached);
    throw Error('CHANGE_RECORD_NOT_FOUND');
  }

  /** 删除一条变更记录：同时删除 Polarion 工作项与本地缓存。用于清理误建或测试记录。 */
  async deleteRecord(recordId: string): Promise<{deleted: boolean}> {
    let record: ChangeRecord | undefined;
    try { record = await this.readRecord(recordId); } catch { /* 附件缺失时用列表缓存定位工作项 */ }
    const index = this.store.get<CachedIndex>('change-record-index', recordId);
    const target = record?.target ?? index?.target;
    const workItemId = record?.workItemId ?? index?.workItemId;
    if (!target || !workItemId) throw Error('CHANGE_RECORD_NOT_FOUND');
    const remote = this.remote();
    if (!remote.changeDelete) throw Error('CHANGE_BACKEND_UNAVAILABLE');
    await remote.changeDelete(target, workItemId, record?.updated ?? index?.updated);
    this.store.remove('change-record', recordId);
    this.store.remove('change-record-index', recordId);
    this.store.remove('change-record-summary', recordId);
    return {deleted: true};
  }

  /** 人工补充说明：与 AI 总结一起写入同一条 Polarion 记录，供项目成员回看。 */
  async setNote(recordId: string, note: string): Promise<{note: string; record: ChangeRecord}> {
    const record = await this.readRecord(recordId);
    const value = note.trim().slice(0, 4000);
    record.note = value || undefined;
    await this.persistRecord(record);
    return {note: value, record};
  }

  async summarize(recordId: string, force: boolean): Promise<{summary: ChangeAiSummary; record: ChangeRecord}> {
    if (this.summarizing.has(recordId)) throw Error('CHANGE_SUMMARY_BUSY');
    const record = await this.readRecord(recordId);
    if (record.aiSummary.status === 'ready' && record.aiSummary.text && !force) return {summary: record.aiSummary, record};
    this.summarizing.add(recordId);
    try {
      const digest = this.summaryDigest(record);
      const result = await summarizeChange({
        documentTitle: record.documentTitle,
        baselineAt: record.baselineAt,
        endedAt: record.endedAt,
        digest,
        model: this.store.settings().claudeModel,
      });
      const summary: ChangeAiSummary = {status: 'ready', text: result.text, model: result.model, at: Date.now()};
      record.aiSummary = summary;
      record.headline = firstLine(result.text) || record.headline;
      await this.persistRecord(record);
      return {summary, record};
    } catch (error) {
      record.aiSummary = {...record.aiSummary, status: 'failed', error: errorCode(error), at: Date.now()};
      this.store.put('change-record', recordId, record);
      throw Error(errorCode(error));
    } finally {
      this.summarizing.delete(recordId);
    }
  }

  private async persistRecord(record: ChangeRecord) {
    if (!record.workItemId || !record.attachmentName) throw Error('CHANGE_RECORD_NOT_FOUND');
    const meta = this.metaFromRecord(record);
    const written = await this.writeUpdate(record, meta);
    record.updated = written.updated;
    record.workItemId = written.workItemId;
    this.cacheRecord(record);
  }

  private summaryDigest(record: ChangeRecord) {
    const lines: string[] = [];
    lines.push(`文档：${record.documentTitle}`);
    lines.push(`变更区间：${stamp(record.baselineAt)} → ${stamp(record.endedAt)}`);
    lines.push(`涉及 ${record.changedItems} 个工作项：修改 ${record.modified}、新增 ${record.added}、删除 ${record.removed}${record.moved ? `、移动 ${record.moved}` : ''}。`);
    if (record.note) lines.push(`作者补充说明：${record.note}`);
    if (record.chapters.length) lines.push(`章节：${record.chapters.map(chapter => `${chapter.num === '0' ? '未分节' : `第${chapter.num}章${chapter.title && chapter.title !== chapter.num ? ` ${chapter.title}` : ''}`}（${chapter.items} 项）`).join('；')}`);
    const items = record.changes.slice(0, 24);
    for (const change of items) {
      const section = change.sectionAfter || change.sectionBefore || '';
      lines.push(`\n### ${change.outlineAfter || change.outlineBefore || '未编号'} ${change.workItemId} ${change.title} [${change.kind}]${section ? `（所属功能单元：${section}）` : ''}`);
      for (const field of change.fields) lines.push(`- ${field.name}：${field.before || '—'} → ${field.after || '—'}`);
      for (const block of change.blocks) {
        if (block.kind === 'same') continue;
        if (block.kind === 'added') lines.push(`- 新增：${textOfHtml(block.after ?? '', 260)}`);
        else if (block.kind === 'removed') lines.push(`- 删除：${textOfHtml(block.before ?? '', 260)}`);
        else {
          lines.push(`- 修改前：${textOfHtml(block.before ?? '', 200)}`);
          lines.push(`- 修改后：${textOfHtml(block.after ?? '', 200)}`);
        }
        if (lines.join('\n').length > 24_000) break;
      }
      if (lines.join('\n').length > 24_000) break;
    }
    if (record.changes.length > items.length) lines.push(`\n（其余 ${record.changes.length - items.length} 个工作项未放入摘要，详见对照页。）`);
    return lines.join('\n').slice(0, 26_000);
  }

  /* ------------------------------ 分享 ------------------------------ */

  async publish(recordId: string) {
    const record = await this.readRecord(recordId);
    const token = this.tokenFor(record.target);
    const status = await this.share.publish(token);
    record.share = {token, publishedAt: Date.now(), port: status.port};
    this.store.put('change-record', record.id, record);
    return {...status, recordUrl: `${status.historyUrl}/${record.id}`};
  }

  stopShare() {
    const status = this.share.stop();
    return status;
  }

  private tokenFor(target: Target): string {
    const id = createHash('sha256').update(`${target.origin}|${target.projectId}|${target.document}`).digest('hex').slice(0, 24);
    const existing = this.store.get<ShareToken>('change-share-token', id);
    if (existing) return existing.token;
    const value: ShareToken = {id, target, token: randomBytes(24).toString('hex'), createdAt: Date.now()};
    this.store.put('change-share-token', id, value);
    return value.token;
  }

  private resolveToken(token: string): Target | undefined {
    return this.store.list<ShareToken>('change-share-token').find(value => value.token === token)?.target;
  }

  private async rowFor(target: Target, workItemId: string): Promise<ChangeRemoteRow | undefined> {
    const remote = this.remote();
    if (!remote.changeList) return undefined;
    const rows = await remote.changeList(target, 200);
    return rows.find(row => row.workItemId === workItemId);
  }
}

function valueText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as {content?: unknown; '#text'?: unknown; id?: unknown};
  if (typeof record.content === 'string') return record.content;
  if (typeof record['#text'] === 'string') return record['#text'];
  if (typeof record.id === 'string') return record.id;
  return undefined;
}

/** 反向回退到时间点：从当前值出发，按时间倒序应用每次变更的 before。 */
export function fieldAt(history: import('./polarion.ts').HistoryChange[], at: number, field: string, current: string): string {
  const changes = [...history]
    .filter(change => Number.isFinite(Date.parse(change.date)))
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
  let value = current;
  for (const change of changes) {
    if (Date.parse(change.date) <= at) break;
    const diff = change.diffs.find(item => item.field.toLowerCase() === field.toLowerCase());
    if (!diff) continue;
    const before = valueText(diff.before);
    if (before !== undefined) value = before;
    else if (valueText(diff.after) !== undefined) value = '';
  }
  return value;
}

function fieldChanges(before: SnapshotItem, after: SnapshotItem): ChangeField[] {
  const fields: ChangeField[] = [];
  if (before.title !== after.title) fields.push({name: '标题', before: before.title, after: after.title});
  if (before.status !== after.status) fields.push({name: '状态', before: before.status || '—', after: after.status || '—'});
  if (before.type !== after.type) fields.push({name: '类型', before: before.type || '—', after: after.type || '—'});
  if (outlineBase(before.outline) !== outlineBase(after.outline)) fields.push({name: '章节', before: outlineBase(before.outline) || '—', after: outlineBase(after.outline) || '—'});
  else if (before.outline !== after.outline) fields.push({name: '序号', before: before.outline || '—', after: after.outline || '—'});
  return fields;
}
