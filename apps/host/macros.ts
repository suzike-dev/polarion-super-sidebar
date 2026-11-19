import { Store } from './store.ts';
import type { Engines } from './engine.ts';
import type { Context, Macro, PermissionMode, Run, Session, Target } from '../../packages/protocol/index.ts';

/**
 * v0.17 宏：把当前会话跑顺的连续指令存下来，一键对当前工作项重放；支持每日定时（Host 常驻调度）。
 * 只捕获用户发出的普通指令（工作流/预审/分诊等自动轮不算），重放按原顺序排队。
 */
export class Macros {
  private store: Store;
  private engines?: Engines;
  constructor(store: Store, engines?: Engines) { this.store = store; this.engines = engines; }

  list(projectId: string): Macro[] {
    return this.store.list<Macro>('macro').filter(macro => macro.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  }
  /** 从会话捕获：取最近 count 条用户普通指令（跳过带 workflow 徽标的自动轮），保持原顺序。 */
  capture(sessionId: string, name: string, count: number): Macro {
    const session = this.store.require<Session>('session', sessionId);
    const prompts = this.store.list<Run>('run')
      .filter(run => run.sessionId === sessionId && !run.workflow)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, count)
      .map(run => run.prompt)
      .reverse();
    if (!prompts.length) throw Error('MACRO_NOTHING_TO_CAPTURE：该会话没有可录制的普通指令。');
    if (this.list(session.target.projectId).some(macro => macro.name === name)) throw Error('MACRO_NAME_EXISTS');
    const macro: Macro = { id: crypto.randomUUID(), projectId: session.target.projectId, name, steps: prompts, createdAt: Date.now() };
    this.store.put('macro', macro.id, macro);
    return macro;
  }
  remove(id: string) {
    const macro = this.store.require<Macro>('macro', id);
    this.store.remove('macro', id);
    return { removed: macro.id };
  }
  /** 重放：按原顺序把宏指令排入当前会话。 */
  run(sessionId: string, id: string, target: Target, contexts: Context[], permissionMode: PermissionMode): { started: number } {
    const macro = this.store.require<Macro>('macro', id);
    const session = this.store.require<Session>('session', sessionId);
    if (session.target.projectId !== macro.projectId) throw Error('MACRO_PROJECT_MISMATCH');
    let started = 0;
    for (const step of macro.steps) {
      const result = this.store.startRun(sessionId, crypto.randomUUID(), step, structuredClone(contexts), target, [], permissionMode, 'queue');
      started++;
      // 注意：新会话首条 run 的初始状态就是 running（不是 queued），必须直接 execute；
      // 只调 pump 会导致首条永远不执行（真机宏重放卡住的根因）。
      if (result.created) { if (result.run.status === 'queued') this.engines?.pump(sessionId); else void this.engines?.execute(result.run); }
    }
    return { started };
  }
  /** 设置/取消每日定时（scheduleAt 为空取消）；document 来自当时的会话目标。 */
  schedule(id: string, scheduleAt: string, target?: Target) {
    const macro = this.store.require<Macro>('macro', id);
    const next: Macro = { ...macro, ...(scheduleAt ? { scheduleAt, ...(target ? { document: target.document } : {}) } : { scheduleAt: undefined, document: undefined }) };
    this.store.put('macro', macro.id, next);
    return next;
  }
  /** 供调度器：当天未跑过的定时宏。 */
  due(now: Date): (Macro & { marker: string })[] {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = localDay(now);
    return this.store.list<Macro>('macro')
      .filter(macro => macro.scheduleAt === hhmm && macro.document)
      .filter(macro => !this.store.get('macro-sent', `${macro.id}:${today}`))
      .map(macro => ({ ...macro, marker: `${macro.id}:${today}` }));
  }
}

/** 本地日期 YYYY-MM-DD：定时去重按用户本地时区算，不能直接用 UTC（跨零点会错一天）。 */
function localDay(now: Date) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
