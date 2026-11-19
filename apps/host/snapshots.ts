import type { Store } from './store.ts';
import type { Coverage } from './coverage.ts';
import type { Gates } from './gates.ts';
import type { Reviews } from './reviews.ts';
import { openReviewIssues, type SnapshotDiff, type SnapshotView, type Target } from '../../packages/protocol/index.ts';

/**
 * 项目基线快照（时间机器一期）：把当前覆盖/体检/门禁/未决预审聚合成一条可比较的记录。
 * 用途：发版前拍快照、周会对比“这周比上周好了多少”，以及评审时引用当时指标。
 */
export class Snapshots {
  private store: Store;
  private coverage: Coverage;
  private gates: Gates;
  private reviews: Reviews;
  constructor(store: Store, coverage: Coverage, gates: Gates, reviews: Reviews) {
    this.store = store; this.coverage = coverage; this.gates = gates; this.reviews = reviews;
  }

  private qualityOf(projectId: string): SnapshotView['quality'] {
    const report = this.store.get<{ checked: number; clean: number; byRule: unknown[] }>('quality-report', projectId);
    if (!report || !report.checked) return null;
    return { checked: report.checked, clean: report.clean, findings: report.checked - report.clean, score: Math.round((report.clean / report.checked) * 100) };
  }
  private openIssuesOf(target: Target): number {
    return this.reviews.list(target).reduce((count, record) => count + openReviewIssues(record).length, 0);
  }

  async save(target: Target, label = ''): Promise<SnapshotView> {
    const coverage = this.coverage.view(target);
    let gates: SnapshotView['gates'] = null;
    try {
      const view = await this.gates.view(target);
      gates = { total: view.summary.total, passed: view.summary.passed, byGate: view.summary.byGate };
    } catch { /* 覆盖索引未建时门禁不可得 */ }
    const snapshot: SnapshotView = {
      id: crypto.randomUUID(), at: Date.now(), label: label.trim(),
      coverage: coverage.items.length ? { total: coverage.items.length, ...coverage.summary } : null,
      quality: this.qualityOf(target.projectId),
      gates,
      openIssues: this.openIssuesOf(target),
    };
    this.store.put('project-snapshot', snapshot.id, { ...snapshot, projectId: target.projectId });
    return snapshot;
  }

  list(projectId: string, limit = 20): SnapshotView[] {
    return this.store.list<SnapshotView & { projectId: string }>('project-snapshot')
      .filter(row => row.projectId === projectId)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map(({ projectId: _projectId, ...view }) => view);
  }

  diff(target: Target): SnapshotDiff {
    const [latest, previous = null] = this.list(target.projectId, 2);
    if (!latest) throw Error('SNAPSHOT_EMPTY：还没有基线快照，先点「保存快照」。');
    const delta = {
      coverageOrphans: previous && latest.coverage && previous.coverage ? latest.coverage.orphans - previous.coverage.orphans : null,
      qualityScore: previous && latest.quality && previous.quality ? latest.quality.score - previous.quality.score : null,
      gatesPassed: previous && latest.gates && previous.gates ? latest.gates.passed - previous.gates.passed : null,
      openIssues: previous ? latest.openIssues - previous.openIssues : null,
    };
    return { latest, previous, delta };
  }
}
