import { gunzipSync, gzipSync } from 'fflate';
import { RulePackSchema, defaultRulePack, type RulePack } from '../../packages/core/requirement-lint.ts';
import type { Target } from '../../packages/protocol/index.ts';
import type { Store } from './store.ts';
import type { Drafts } from './polarion.ts';

/* ------------------------------------------------------------------ */
/* S6 规则中心一期：规则包存在 Polarion 项目工作项 PSB-RULES 的固定附件， */
/* 本机缓存兜底、内置默认包垫底（v0.14 规格 B 组）。查询方式与 PSB-FEISHU 一致。 */
/* ------------------------------------------------------------------ */

const RULES_TITLE = 'PSB-RULES';
const RULES_FILE = 'sidebar-rules.pack.json';

/** rules.get 的返回：source 说明规则包来自哪里，error 仅为提示不阻断使用。 */
export type RulesView = { pack: RulePack; source: 'polarion' | 'cache' | 'default'; version: number; updated?: number; remoteUpdated?: string | null; workItemId?: string; error?: string };
type CachedPack = { pack: RulePack; updated: number; remoteUpdated?: string; workItemId?: string };

/** 附件为 gzip JSON（与 PSB-FEISHU 一致）；容错手写的明文 base64 JSON。 */
function parsePack(dataBase64: string): RulePack {
  const buffer = Buffer.from(dataBase64, 'base64');
  let text: string;
  try { text = new TextDecoder().decode(gunzipSync(buffer)); } catch { text = buffer.toString('utf8'); }
  return RulePackSchema.parse(JSON.parse(text));
}

function gzipJson(value: unknown) {
  return Buffer.from(gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 9 })).toString('base64');
}

/** 内置基线：项目包读取时按内容合并（缺的规则补入、词表并集），与版本号无关——旧包可能版本号更高但内容更旧。 */
const BASELINE_VERSION = 2;
function upgradeToBaseline(pack: RulePack): RulePack {
  const base = defaultRulePack();
  const rules = pack.lintRules.map(rule => ({ ...rule, words: [...rule.words] }));
  let changed = false;
  for (const builtin of base.lintRules) {
    const existing = rules.find(rule => rule.id === builtin.id);
    if (!existing) { rules.push({ ...builtin, words: [...builtin.words] }); changed = true; continue; }
    if (builtin.words.length && (builtin.type === 'fuzzy-word' || builtin.type === 'anaphora')) {
      const merged = [...new Set([...existing.words, ...builtin.words])].slice(0, 200);
      if (merged.length !== existing.words.length) { existing.words = merged; changed = true; }
    }
    // 旧包没有分类/人话标题：从内置继承，规则中心才能归位到正确分组。
    if (!existing.category && builtin.category) { (existing as { category?: string }).category = builtin.category; changed = true; }
    if (!existing.title && builtin.title) { (existing as { title?: string }).title = builtin.title; changed = true; }
  }
  if (!changed) return pack;
  return { ...pack, version: Math.max(pack.version, BASELINE_VERSION), lintRules: rules };
}

export class Rules {
  private store: Store;
  private drafts: Drafts;
  constructor(store: Store, drafts: Drafts) { this.store = store; this.drafts = drafts; }

  /** refresh=true 强制回源；否则有缓存用缓存，取过一次后不再自动请求 Polarion（自动刷新随 v0.17 事件总线）。 */
  async read(target: Target, refresh = false): Promise<RulesView> {
    const cached = this.store.get<CachedPack>('rule-pack', target.projectId);
    if (cached && !refresh) {
      const pack = upgradeToBaseline(cached.pack);
      if (pack !== cached.pack) this.store.put('rule-pack', target.projectId, { ...cached, pack });
      return { pack, source: 'cache', version: pack.version, updated: cached.updated, remoteUpdated: cached.remoteUpdated, ...(cached.workItemId ? { workItemId: cached.workItemId } : {}) };
    }
    const remote = (this.drafts as { remote?: { changeList?: Function; changeRead?: Function } }).remote;
    if (remote?.changeList && remote?.changeRead) {
      try {
        const row = (await remote.changeList(target, 20, `title:${RULES_TITLE}*`))[0] as { workItemId: string; updated?: string; attachments?: { file_name?: string }[] } | undefined;
        const attachment = (row?.attachments ?? []).find(item => item.file_name === RULES_FILE);
        if (row && attachment) {
          const raw = await remote.changeRead(target, row.workItemId, RULES_FILE);
          const pack = upgradeToBaseline(parsePack(String(raw.dataBase64)));
          const value: CachedPack = { pack, updated: Date.now(), remoteUpdated: raw.updated ?? row.updated, workItemId: row.workItemId };
          this.store.put('rule-pack', target.projectId, value);
          return { pack, source: 'polarion', version: pack.version, updated: value.updated, remoteUpdated: value.remoteUpdated, workItemId: row.workItemId };
        }
        if (!row) {
          this.store.remove('rule-pack', target.projectId);
          return { pack: defaultRulePack(), version: BASELINE_VERSION, source: 'default', remoteUpdated: null, error: '本项目尚未配置 PSB-RULES，使用内置默认规则。' };
        }
        if (row && !attachment) return this.fallback(cached, `工作项 ${row.workItemId} 缺少附件 ${RULES_FILE}，${cached ? '使用上次缓存' : '使用内置默认规则包'}`, target.projectId);
      } catch (error) {
        return this.fallback(cached, `PSB-RULES 读取失败（${(error as Error).message}），${cached ? '使用上次缓存' : '使用内置默认规则包'}`, target.projectId);
      }
    }
    return this.fallback(cached, cached ? undefined : '未连接 Polarion，使用内置默认规则包', target.projectId);
  }

  /** 保存规则包到 PSB-RULES 工作项（一人保存、全项目共用）；写入与 PSB-FEISHU 同一模式，冲突报专用错误引导刷新。 */
  async save(target: Target, pack: RulePack, expectedUpdated?: string | null): Promise<RulesView> {
    const remote = (this.drafts as { remote?: { changeList?: Function; changeWrite?: Function } }).remote;
    if (!remote?.changeList || !remote?.changeWrite) throw Error('POLARION_UNAVAILABLE');
    const row = (await remote.changeList(target, 20, `title:${RULES_TITLE}*`))[0] as { workItemId?: string; updated?: string } | undefined;
    if (expectedUpdated !== undefined && expectedUpdated !== (row?.updated ?? null)) throw Error('RULES_CONFLICT：规则包刚被他人更新，请刷新后再保存。');
    const description = '<h2>Polarion Sidebar · 需求质量规则包（项目共享）</h2><p>行内体检使用这里的术语表与启发式规则；规则对全部项目成员生效。附件由侧边栏维护，也可手动编辑（gzip 或明文 JSON 均可读）。</p>';
    let last: unknown;
    for (const type of [this.store.settings().changeRecordType.trim(), 'task', 'changeRequest', 'change'].filter(Boolean)) {
      try {
        const written = await remote.changeWrite({ target, ...(row ? { workItemId: row.workItemId, expectedUpdated: row.updated } : { type }), title: `${RULES_TITLE} 质量规则包`, description, fileName: RULES_FILE, attachmentTitle: 'Polarion Sidebar 需求质量规则包', dataBase64: gzipJson(pack) });
        const value: RulesView = { pack, source: 'polarion', version: pack.version, updated: Date.now(), remoteUpdated: written.updated, workItemId: written.workItemId };
        this.store.put('rule-pack', target.projectId, { pack, updated: value.updated!, remoteUpdated: value.remoteUpdated, workItemId: written.workItemId });
        return value;
      } catch (error) {
        const message = String((error as Error).message);
        if (/CONFLICT/.test(message)) throw Error('RULES_CONFLICT：规则包刚被他人更新，请刷新后再保存。');
        last = error;
        if (!/CHANGE_RECORD_CREATE_FAILED/.test(message)) throw error;
      }
    }
    throw last instanceof Error ? last : Error('CHANGE_RECORD_CREATE_FAILED');
  }

  private fallback(cached: CachedPack | undefined, error: string | undefined, projectId: string): RulesView {
    if (cached) {
      const pack = upgradeToBaseline(cached.pack);
      if (pack !== cached.pack) this.store.put('rule-pack', projectId, { ...cached, pack });
      return { pack, source: 'cache', version: pack.version, updated: cached.updated, remoteUpdated: cached.remoteUpdated, ...(cached.workItemId ? { workItemId: cached.workItemId } : {}), ...(error ? { error } : {}) };
    }
    return { pack: defaultRulePack(), source: 'default', version: BASELINE_VERSION, ...(error ? { error } : {}) };
  }
}
