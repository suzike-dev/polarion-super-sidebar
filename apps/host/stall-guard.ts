import type { Store } from './store.ts';
import type { Run } from '../../packages/protocol/index.ts';

/**
 * 停滞记录自愈：评审/会议分诊记录在 status='running' 时，若其 run 已彻底不在引擎里
 * （已终态、记录缺失，或 running 但引擎无此活跃 run 且超过宽限），把记录复位为终态，
 * 避免 UI 永远显示“预审中”。run 已完成但回填钩子没走到的，交给调用方补 complete。
 */
export const STALL_GRACE_MS = 120_000;
type RunningRecord = { id: string; status: string; runId?: string; projectId: string; error?: string; at?: number };

export type StallSweep = { completed: Run[]; failed: { collection: string; id: string; reason: string }[] };

export function sweepStalledRecords(store: Store, isActive: (runId: string) => boolean, now = Date.now()): StallSweep {
  const result: StallSweep = { completed: [], failed: [] };
  for (const collection of ['review-record', 'meeting-record'] as const) {
    for (const record of store.list<RunningRecord>(collection)) {
      if (record.status !== 'running') continue;
      const run = record.runId ? store.get<Run>('run', record.runId) : undefined;
      if (run?.status === 'completed') { result.completed.push(run); continue; }
      const terminal = run ? ['failed', 'cancelled', 'interrupted'].includes(run.status) : true;
      const stalled = !!run && run.status === 'running' && !isActive(run.id) && now - run.startedAt > STALL_GRACE_MS;
      if (!terminal && !stalled) continue;
      if (stalled && run) {
        run.status = 'interrupted'; run.error = 'RUN_STALLED'; run.endedAt = now; store.put('run', run.id, run);
      }
      const reason = !run ? 'RUN_MISSING' : (run.error ?? run.status.toUpperCase());
      store.put(collection, record.id, { ...record, status: 'failed', error: reason });
      result.failed.push({ collection, id: record.id, reason });
    }
  }
  return result;
}
