import { Store } from './store.ts';
import type { BriefConfig, Target, WatchAlert, WatchView, WorkEvent, WorkEventKind } from '../../packages/protocol/index.ts';

/**
 * v0.15 事件总线一期：保存/备注/巡检/提案/体检/晨报统一落 sqlite，收件箱动态页与晨报共用。
 * 事件只记事实，不执行动作；守望警报从当前状态推导（模型侧变化 → 疑似过期、缺基准、索引过期）。
 */
export class Events {
  private store: Store;
  constructor(store: Store) { this.store = store; }
  private lastAt = 0;
  record(projectId: string, kind: WorkEventKind, subject: string, extra: { detail?: string; workItemId?: string } = {}): WorkEvent {
    // 单调时间戳：同毫秒连续写入也能稳定倒序（否则列表顺序随机）。
    const at = Math.max(Date.now(), this.lastAt + 1); this.lastAt = at;
    const event: WorkEvent = { id: crypto.randomUUID(), projectId, at, kind, subject: extra.detail ? `${subject} · ${extra.detail}` : subject, ...(extra.workItemId ? { workItemId: extra.workItemId } : {}) };
    this.store.put('work-event', event.id, event);
    return event;
  }
  list(projectId: string, limit = 60): WorkEvent[] {
    return this.store.list<WorkEvent>('work-event')
      .filter(event => event.projectId === projectId)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }

  /** 守望警报：从最近一次巡检与索引状态推导，不触发扫描（点开收件箱即时返回）。 */
  watch(target: Target): WatchView {
    const alerts: WatchAlert[] = [];
    const prefix = `${target.projectId}:`;
    const roots = this.store.get<{ roots: { id: string; label: string; path: string }[] }>('model-roots', target.projectId);
    const bound = (roots?.roots ?? []).filter(root => root.path);
    for (const root of bound) {
      const check = this.store.get<{ baselineAt: number | null; findings: { moduleKey: string; moduleName: string; side: string; workItems: unknown[] }[] } & Record<string, unknown>>('model-check', prefix + root.id);
      if (!check || check.baselineAt == null) {
        alerts.push({ level: 'info', title: `「${root.label}」还没有模型基准`, detail: '设定基准后，模型或需求变更才会被对比并标疑似过期。', action: 'baseline' });
        continue;
      }
      const modelSide = (check.findings ?? []).filter(finding => finding.side !== 'requirement');
      if (modelSide.length) {
        const staleItems = modelSide.reduce((count, finding) => count + finding.workItems.length, 0);
        alerts.push({
          level: 'warn',
          title: `「${root.label}」模型侧已变化：${modelSide.length} 个模块、${staleItems} 条关联需求疑似过期`,
          detail: modelSide.map(finding => finding.moduleName).slice(0, 8).join('、'),
          at: check.at as number,
          action: 'model-check',
        });
      }
    }
    const coverage = this.store.get<{ at: number; total: number }>('coverage-index', target.projectId);
    if (bound.length && (!coverage || Date.now() - coverage.at > 24 * 3600_000)) {
      alerts.push({ level: 'info', title: coverage ? '覆盖索引超过一天未更新' : '覆盖索引尚未构建', detail: '重建后写前查重、覆盖矩阵与影响卡才是最新事实。', action: 'coverage-sync' });
    }
    const generatedAt = Date.now();
    const brief = this.store.get<BriefConfig>('brief-config', target.projectId) ?? { enabled: false, at: '07:30' };
    if (!alerts.length) return { alerts: [{ level: 'info', title: '一切正常', detail: '没有待处理的守望警报。', action: 'model-check' }], generatedAt, brief };
    return { alerts: alerts.sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1)), generatedAt, brief };
  }
}
