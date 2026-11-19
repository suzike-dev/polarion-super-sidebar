import { Store } from './store.ts';
import type { Target, Workset, WorksetView } from '../../packages/protocol/index.ts';

/**
 * v0.17 智能工作集：保存的动态查询 = 活队列。条目不落库，每次打开按当前覆盖索引/体检结果现算——
 * 索引或体检刷新后工作集自动变新。四类：gaps=覆盖缺口 / orphans=孤立条目 / quality=体检有发现 / search=关键词。
 */
type CoverageRow = { workItemId: string; title: string; text: string; marks: { modules: string[] }[]; forwardLinks: { role: string }[]; backLinks: { role: string }[] };

export class Worksets {
  private store: Store;
  constructor(store: Store) { this.store = store; }

  list(projectId: string): Workset[] {
    return this.store.list<Workset>('workset').filter(set => set.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  }
  save(target: Target, input: { id?: string; name: string; kind: Workset['kind']; query: string }): Workset {
    const existing = input.id ? this.store.get<Workset>('workset', input.id) : undefined;
    if (this.list(target.projectId).some(set => set.name === input.name && set.id !== existing?.id)) throw Error('WORKSET_NAME_EXISTS');
    const value: Workset = { id: existing?.id ?? crypto.randomUUID(), projectId: target.projectId, name: input.name, kind: input.kind, query: input.query, createdAt: existing?.createdAt ?? Date.now() };
    this.store.put('workset', value.id, value);
    return value;
  }
  remove(id: string) {
    const set = this.store.require<Workset>('workset', id);
    this.store.remove('workset', id);
    return { removed: set.id };
  }

  items(target: Target, id: string): WorksetView {
    const set = this.store.require<Workset>('workset', id);
    if (set.projectId !== target.projectId) throw Error('WORKSET_PROJECT_MISMATCH');
    const coverage = this.store.get<{ at: number; items: CoverageRow[] }>('coverage-index', target.projectId);
    if (!coverage?.items.length) throw Error('WORKSET_INDEX_EMPTY：先在模型工作台「覆盖视图」构建覆盖索引。');
    const quality = this.store.get<{ items: { workItemId: string; issues: { severity: string; message: string }[] }[] }>('quality-report', target.projectId);
    const rows = coverage.items.map(item => ({ ...item, upstream: (item.forwardLinks ?? []).length, moduleCount: (item.marks ?? []).reduce((count, mark) => count + mark.modules.length, 0), verification: [...(item.forwardLinks ?? []), ...(item.backLinks ?? [])].filter(link => /test|verif|valid/i.test(link.role)).length }));
    let items: { workItemId: string; title: string; reason: string }[];
    if (set.kind === 'gaps') {
      items = rows.filter(row => !row.upstream || !row.moduleCount || !row.verification).map(row => ({ workItemId: row.workItemId, title: row.title, reason: [`无上游链接`, `未标注模块`, `无验证链接`].filter((label, index) => [row.upstream, row.moduleCount, row.verification][index] === 0).join(' · ') }));
    } else if (set.kind === 'orphans') {
      items = rows.filter(row => !row.upstream && !row.moduleCount && !row.verification).map(row => ({ workItemId: row.workItemId, title: row.title, reason: '上游/模块/验证全部为空' }));
    } else if (set.kind === 'quality') {
      const issuesByItem = new Map((quality?.items ?? []).map(row => [row.workItemId, row.issues]));
      items = [...issuesByItem.entries()].filter(([, issues]) => issues.length).map(([workItemId, issues]) => ({ workItemId, title: coverage.items.find(row => row.workItemId === workItemId)?.title ?? '', reason: `${issues.length} 处发现：${issues[0]!.message}` })).filter(row => coverage.items.some(item => item.workItemId === row.workItemId));
    } else {
      const needle = set.query.trim().toLowerCase();
      if (!needle) throw Error('WORKSET_QUERY_EMPTY：关键词工作集需要查询词。');
      items = rows.filter(row => `${row.workItemId} ${row.title} ${row.text}`.toLowerCase().includes(needle)).slice(0, 200).map(row => ({ workItemId: row.workItemId, title: row.title, reason: `命中「${set.query.trim()}」` }));
    }
    return { ...set, items: items.slice(0, 300) };
  }
}
