import { Store } from './store.ts';
import { Drafts, Polarion, type RemoteLink } from './polarion.ts';
import { Model } from './model.ts';
import type { CoverageItem, CoverageView, DedupMatch, ImpactView, Target } from '../../packages/protocol/index.ts';

/**
 * v0.14 语义索引一期：当前文档逐条「正文摘要 + 双向链接 + 模块备注」入 sqlite，
 * 派生三层覆盖（上游链接 / 实现模块 / 验证链接）供覆盖矩阵、写前查重与影响前置卡共用。
 * 链接按角色名分类：test/verif/valid 视为验证，其余正向链接视为上游、反向视为下游引用。
 */
const VERIFICATION_ROLE = /test|verif|valid|检验|验证/i;
const STOP_TOKENS = new Set(['的', '了', '和', '与', '及', '或', '在', '为', '对', '由', '从', '该', '本', '并', '其', '当', '应', '须', '需', '不', '为', 'a', 'an', 'the', 'of', 'to', 'and', 'or', 'for', 'in', 'on', 'is', 'be', 'shall', 'must', 'should', 'may']);

/** 分词：CJK 二元组 + 拉丁/数字词（信号名、十六进制等整体保留），去停用词。 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase();
  for (const match of normalized.matchAll(/[a-z][a-z0-9_]*|0x[0-9a-f]+|\d+(?:\.\d+)?/g)) {
    const token = match[0];
    if (!STOP_TOKENS.has(token) && token.length > 1) tokens.push(token);
  }
  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const run of cjk) for (let index = 0; index + 2 <= run.length; index++) tokens.push(run.slice(index, index + 2));
  return tokens;
}

/** 重叠系数：|A∩B| / min(|A|,|B|)。短查询命中长条目时仍能给出高分，适合“写前查重”。 */
export function dedupScore(query: Set<string>, candidate: Set<string>): { score: number; shared: string[] } {
  const [small, large] = query.size <= candidate.size ? [query, candidate] : [candidate, query];
  const shared: string[] = [];
  for (const token of small) if (large.has(token)) shared.push(token);
  const score = small.size ? shared.length / small.size : 0;
  return { score: Math.round(score * 100) / 100, shared: shared.slice(0, 8) };
}

const classify = (item: Pick<CoverageItem, 'forwardLinks' | 'backLinks' | 'marks'>) => ({
  upstream: item.forwardLinks.filter(link => !VERIFICATION_ROLE.test(link.role)).length,
  moduleCount: item.marks.reduce((count, mark) => count + mark.modules.length, 0),
  verification: [...item.forwardLinks, ...item.backLinks].filter(link => VERIFICATION_ROLE.test(link.role)).length,
});

type CoverageRecord = { id: string; projectId: string; at: number; total: number; partial?: boolean; items: (Omit<CoverageItem, 'upstream' | 'moduleCount' | 'verification'>)[] };

export class Coverage {
  private store: Store;
  private drafts: Drafts;
  private model: Model;
  constructor(store: Store, drafts: Drafts, model: Model) { this.store = store; this.drafts = drafts; this.model = model; }
  private remote(): Polarion { if (!(this.drafts.remote instanceof Polarion) || !this.drafts.remote.outline || !this.drafts.remote.backLinks) throw Error('POLARION_UNAVAILABLE'); return this.drafts.remote; }

  private decorate(record: CoverageRecord): CoverageView {
    const items: CoverageItem[] = record.items.map(item => ({ ...item, ...classify(item) }));
    return {
      at: record.at, total: record.total, ...(record.partial ? { partial: true } : {}), items,
      summary: {
        withUpstream: items.filter(item => item.upstream > 0).length,
        withModule: items.filter(item => item.moduleCount > 0).length,
        withVerification: items.filter(item => item.verification > 0).length,
        orphans: items.filter(item => !item.upstream && !item.moduleCount && !item.verification).length,
      },
    };
  }

  /** 增量构建：model.notes（备注+正向链接）+ outline 序号 + 逐条 peek 正文与反向链接；修订未变的条目复用上次结果。 */
  async sync(target: Target): Promise<CoverageView> {
    const remote = this.remote();
    const index = await this.model.indexSync(target, '');
    const outline = await remote.outline(target);
    const outlineOf = new Map(outline.items.map(item => [item.id, item.outline]));
    const previous = this.store.get<CoverageRecord>('coverage-index', target.projectId);
    const previousById = new Map((previous?.items ?? []).map(item => [item.workItemId, item]));
    const items: CoverageRecord['items'] = [];
    for (const item of index.items.slice(0, 500)) {
      const prior = previousById.get(item.workItemId);
      const outlineNumber = outlineOf.get(item.workItemId) ?? '';
      if (prior && prior.updated === item.updated && prior.outline === outlineNumber) {
        items.push({ ...prior, title: item.title, type: item.type, marks: item.marks, forwardLinks: item.links });
        continue;
      }
      let text = ''; let backLinks: RemoteLink[] = [];
      try { text = `${await this.drafts.peek(target, item.workItemId).then(peek => `${peek.title}\n${peek.text}`)}`; } catch { /* 单条读取失败保留空正文 */ }
      try { backLinks = await remote.backLinks(target, item.workItemId); } catch { /* 链接接口受限时置空 */ }
      items.push({ workItemId: item.workItemId, title: item.title, type: item.type, outline: outlineNumber, updated: item.updated, marks: item.marks, text: text.slice(0, 1600), forwardLinks: item.links, backLinks: backLinks.map(link => ({ workItemId: link.workItemId, role: link.role })) });
    }
    const record: CoverageRecord = { id: target.projectId, projectId: target.projectId, at: Date.now(), total: index.total, ...(index.partial ? { partial: true } : {}), items };
    this.store.put('coverage-index', target.projectId, record);
    return this.decorate(record);
  }

  view(target: Target): CoverageView {
    const record = this.store.get<CoverageRecord>('coverage-index', target.projectId);
    return record ? this.decorate(record) : { at: 0, total: 0, items: [], summary: { withUpstream: 0, withModule: 0, withVerification: 0, orphans: 0 } };
  }

  /** 写前查重：与索引正文比对，exclude 排除自身。 */
  dedup(target: Target, text: string, limit: number, exclude?: string): { matches: DedupMatch[]; indexed: number } {
    const view = this.view(target);
    if (!view.items.length) throw Error('DEDUP_INDEX_EMPTY：先在需求总览点「体检」或在覆盖视图构建索引后再查重。');
    const query = new Set(tokenize(text));
    if (!query.size) return { matches: [], indexed: view.items.length };
    const matches = view.items
      .filter(item => item.workItemId !== exclude)
      .map(item => { const { score, shared } = dedupScore(query, new Set(tokenize(`${item.title}\n${item.text}`))); return { workItemId: item.workItemId, title: item.title, score, sharedTerms: shared }; })
      .filter(match => match.score >= 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { matches, indexed: view.items.length };
  }

  /** 影响前置卡：模块（含巡检疑似过期）+ 上下游 + 验证链接。 */
  impact(target: Target, workItemId: string): ImpactView {
    const record = this.store.get<CoverageRecord>('coverage-index', target.projectId);
    const item = record?.items.find(row => row.workItemId === workItemId);
    if (!item) throw Error('IMPACT_ITEM_NOT_INDEXED：该条目不在覆盖索引里，先构建覆盖索引。');
    // 疑似过期模块：取各根目录最近一次巡检里模型侧（含 both）变化过的模块。
    const staleModules = new Set<string>();
    for (const check of this.store.list<{ id?: string; findings?: { moduleKey: string; side: string }[] } & import('../../packages/protocol/index.ts').ModelCheckView>('model-check')) {
      if (typeof check.id !== 'string' || !check.id.startsWith(target.projectId + ':')) continue;
      for (const finding of check.findings ?? []) if (finding.side !== 'requirement') staleModules.add(finding.moduleKey);
    }
    const roots = this.store.get<{ roots: { id: string; label: string; modules: { key: string; name: string }[] }[] }>('model-roots', target.projectId);
    const modules = item.marks.flatMap(mark => {
      const root = roots?.roots.find(row => row.id === mark.rootId);
      return mark.modules.map(key => ({ rootId: mark.rootId, rootLabel: root?.label ?? mark.rootId, moduleKey: key, moduleName: root?.modules.find(module => module.key === key)?.name ?? key, stale: staleModules.has(key) }));
    });
    const forward = item.forwardLinks.map(link => ({ workItemId: link.workItemId, role: link.role }));
    const back = item.backLinks.map(link => ({ workItemId: link.workItemId, role: link.role }));
    return {
      workItemId, title: item.title, modules,
      upstream: forward.filter(link => !VERIFICATION_ROLE.test(link.role)),
      downstream: back.filter(link => !VERIFICATION_ROLE.test(link.role)),
      verification: [...forward, ...back].filter(link => VERIFICATION_ROLE.test(link.role)),
      staleCount: modules.filter(module => module.stale).length,
      coverageAt: record!.at,
    };
  }
}
