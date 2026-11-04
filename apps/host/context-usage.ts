import type { Query, SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { ContextUsage, EngineContext } from '../../packages/protocol/index.ts';

type Runtime = Pick<Query, 'getContextUsage'>;

// Deliberately project only aggregate fields: SDK responses also contain local paths.
export function contextUsageSnapshot(value: SDKControlGetContextUsageResponse, updatedAt = Date.now()): ContextUsage {
  if (![value.totalTokens, value.rawMaxTokens, value.percentage].every(Number.isFinite)
      || value.totalTokens < 0 || value.rawMaxTokens <= 0 || value.percentage < 0) throw Error('INVALID_CONTEXT_USAGE');
  return {
    usedTokens: value.totalTokens, windowTokens: value.rawMaxTokens,
    percentage: value.percentage, model: value.model, updatedAt,
    categories: value.categories.filter(c => Number.isFinite(c.tokens) && c.tokens >= 0)
      .map(({ name, tokens, kind }) => ({ name, tokens, kind })),
  };
}

export class ContextUsageCache {
  private snapshots = new Map<string, ContextUsage>();
  private compacting = new Set<string>();
  private pending = new Map<string, { runtime: Runtime; task: Promise<void> }>();
  private epochs = new Map<string, number>();
  private nextEpoch = 0;
  private runtime: (sessionId: string) => Runtime | undefined;
  private timeoutMs: number;
  constructor(runtime: (sessionId: string) => Runtime | undefined, timeoutMs = 5000) {
    this.runtime = runtime; this.timeoutMs = timeoutMs;
  }

  disconnect(sessionId: string) {
    this.snapshots.delete(sessionId); this.compacting.delete(sessionId); this.pending.delete(sessionId);
    // /clear can reset a conversation while retaining the same SDK Query.
    // Invalidate its pending measurements even if the runtime identity is unchanged.
    this.epochs.delete(sessionId);
  }
  setCompacting(sessionId: string, value: boolean) {
    if (value) this.compacting.add(sessionId); else this.compacting.delete(sessionId);
  }
  async read(sessionId: string, refresh = false): Promise<EngineContext> {
    const runtime = this.runtime(sessionId);
    // A cache from a prior process is not a measurement of a cold session.
    if (!runtime) { this.disconnect(sessionId); return { usage: null, connected: false, compacting: false }; }
    if (refresh) {
      let pending = this.pending.get(sessionId);
      if (!pending || pending.runtime !== runtime) {
        const epoch = this.epochs.get(sessionId) ?? ++this.nextEpoch;
        this.epochs.set(sessionId, epoch);
        const task = this.refresh(sessionId, runtime, epoch);
        pending = { runtime, task }; this.pending.set(sessionId, pending);
        void task.finally(() => { if (this.pending.get(sessionId)?.task === task) this.pending.delete(sessionId); });
      }
      await pending.task;
    }
    if (this.runtime(sessionId) !== runtime) return this.read(sessionId);
    return { usage: this.snapshots.get(sessionId) ?? null, connected: true, compacting: this.compacting.has(sessionId) };
  }
  private async refresh(sessionId: string, runtime: Runtime, epoch: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        runtime.getContextUsage({ detail: 'summary' }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('CONTEXT_USAGE_TIMEOUT')), this.timeoutMs); }),
      ]);
      if (this.runtime(sessionId) === runtime && this.epochs.get(sessionId) === epoch) this.snapshots.set(sessionId, contextUsageSnapshot(value));
    } catch { /* Keep the last measured snapshot; unavailable is not zero usage. */ }
    finally { if (timer) clearTimeout(timer); }
  }
}
