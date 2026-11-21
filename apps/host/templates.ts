import { Store } from './store.ts';
import { builtinRequirementTemplates, type BuiltinRequirementTemplate } from '../../packages/core/requirement-templates.ts';
import type { Target } from '../../packages/protocol/index.ts';
import type { Drafts, RemoteItem } from './polarion.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';

/** 需求模板库：模板=Polarion 里的真实工作项，集中存放在 library 项目（Document Library）的
 * 「需求模板库」文档中，跨项目通用。安装（首次访问）时幂等创建 5 个内置模板工作项。
 *
 * 一套逻辑：
 *  - 编辑模板 = 打开该工作项（drafts.open）→ 副文本工作台 → drafts.save（Polarion 原生保存链路，零特殊分支）；
 *  - 插入/建项 = 读模板工作项正文 → 在目标项目创建新工作项并写入副本（模板原件永不被改动）；
 *  - 恢复标准 = 把内置模板正文重置回软件内置基线。 */

/** 模板库固定位置（library = Document Library 项目，所有服务器同名）。 */
export const LIBRARY_PROJECT = 'library';
export const LIBRARY_DOC = '_default/Software Requirements Specification';

export type TemplateView = {
  id: string;
  title: string;
  category: string;
  /** builtin=安装时创建的 5 个必备模板；custom=用户在模板库里新建的普通工作项。 */
  origin: 'builtin' | 'custom';
  html: string;
  updated?: string;
};

/** 从标题解析类别：内置模板标题即类别名；自定义模板用「[类别] 名称」前缀约定。 */
function categoryOf(title: string): string {
  const bracket = title.match(/^\[([^\]]{1,20})\]/);
  if (bracket) return bracket[1]!;
  for (const base of builtinRequirementTemplates) {
    if (title.includes(base.name.replace('需求模板', '')) || title === base.name) return categoryLabelOf(base.category);
  }
  return '未分类';
}

const CATEGORY_LABELS: Record<string, string> = { scenario: '场景类', calculation: '计算类', algorithm: '算法类', 'state-machine': '状态机类', hybrid: '混合类' };
function categoryLabelOf(key: string): string { return CATEGORY_LABELS[key] ?? key; }

export class ReqTemplates {
  store: Store;
  drafts?: Drafts;
  /** 调试期：最近一次 ensureLibrary 的错误（list 返回给前端展示）。 */
  lastEnsureErrors: string[] = [];

  constructor(store: Store) { this.store = store; }

  libraryTarget(origin: 'https://polarion.pufafen.com'): Target {
    return { origin, projectId: LIBRARY_PROJECT, document: LIBRARY_DOC };
  }

  /** 幂等安装：确保 library 项目的模板文档与 5 个内置模板工作项存在。
   * 失败不阻塞模板功能（list/instantiate 仍可对已存在的模板工作）。 */
  async ensureLibrary(origin: 'https://polarion.pufafen.com'): Promise<{ created: string[]; available: string[]; errors?: string[] }> {
    const drafts = this.drafts;
    if (!drafts) throw Error('TEMPLATE_UNAVAILABLE');
    const libTarget = this.libraryTarget(origin);
    // 节流：10 分钟内已确认过安装就跳过（搜索是串行 SOAP，逐条查询会堵死 Host 队列）。
    const lastEnsure = this.store.get<{ at: number }>('template-ensure', 'global');
    if (lastEnsure && Date.now() - lastEnsure.at < 10 * 60 * 1000) return { created: [], available: [] };
    const created: string[] = [];
    const errors: string[] = [];
    // 单次裸文本搜索拿现有模板清单（title: 字段限定在该 SOAP 查询里对中文失效）。
    let existingTitles = new Set<string>();
    try {
      const hits = await drafts.searchItems(libTarget, '需求模板', 30);
      for (const hit of hits) existingTitles.add(hit.title.trim());
    } catch { /* 搜索失败按全部缺失处理 */ }
    for (const base of builtinRequirementTemplates) {
      if ([...existingTitles].some(title => title === base.name)) continue;
      try {
        const draft = await drafts.create(libTarget, base.name, 'task');
        const applied = drafts.replaceHtml(draft.id, base.html);
        await drafts.save(applied.id, applied.revision, 'clean');
        created.push(base.name);
        existingTitles.add(base.name);
      } catch (error) {
        // 标题重复创建会被 Polarion 接受（工作项标题不唯一）：以 created 去重靠上面的 existing 集合。
        errors.push(base.name + ': ' + (error instanceof Error ? error.message : String(error)));
      }
    }
    this.store.put('template-ensure', 'global', { at: Date.now() });
    return { created, available: [...existingTitles], errors };
  }

  /** 模板清单（正文一并返回，供 AI 注入与 UI 卡片；模板数量少，全文可控）。 */
  async list(origin: 'https://polarion.pufafen.com'): Promise<TemplateView[]> {
    const drafts = this.drafts;
    if (!drafts) throw Error('TEMPLATE_UNAVAILABLE');
    await this.ensureLibrary(origin).catch(() => undefined);
    const libTarget = this.libraryTarget(origin);
    // 单次裸文本搜索：全部模板（内置+自定义）标题都含「需求模板」或「模板」。
    const views: TemplateView[] = [];
    const seen = new Set<string>();
    try {
      const hits = await drafts.searchItems(libTarget, '需求模板', 30);
      for (const hit of hits) {
        if (seen.has(hit.workItemId)) continue;
        seen.add(hit.workItemId);
        try {
          const item = await drafts.remote.read(libTarget, hit.workItemId);
          views.push({ id: hit.workItemId, title: item.title, category: categoryOf(item.title), origin: this.builtinByTitle(item.title) ? 'builtin' : 'custom', html: item.description ?? '', updated: item.updated });
        } catch { /* 单条读取失败跳过 */ }
      }
    } catch { /* 搜索失败返回当前已知列表 */ }
    views.sort((a, b) => {
      const ia = builtinRequirementTemplates.findIndex(base => base.name === a.title);
      const ib = builtinRequirementTemplates.findIndex(base => base.name === b.title);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.title.localeCompare(b.title);
    });
    return views;
  }

  private builtinByTitle(title: string): BuiltinRequirementTemplate | undefined {
    return builtinRequirementTemplates.find(base => base.name === title);
  }

  /** 读单个模板正文。 */
  async read(origin: 'https://polarion.pufafen.com', templateId: string): Promise<TemplateView> {
    const drafts = this.drafts;
    if (!drafts) throw Error('TEMPLATE_UNAVAILABLE');
    const item = await drafts.remote.read(this.libraryTarget(origin), templateId);
    return { id: templateId, title: item.title, category: categoryOf(item.title), origin: this.builtinByTitle(item.title) ? 'builtin' : 'custom', html: item.description ?? '', updated: item.updated };
  }

  /** 内置模板恢复标准：正文重置回软件内置基线并保存（走工作项保存链路）。 */
  async reset(origin: 'https://polarion.pufafen.com', templateId: string): Promise<{ workItemId: string; state: string }> {
    const view = await this.read(origin, templateId);
    const base = this.builtinByTitle(view.title);
    if (!base) throw Error('TEMPLATE_NOT_BUILTIN');
    const drafts = this.drafts!;
    const draft = await drafts.open(this.libraryTarget(origin), templateId);
    const applied = drafts.replaceHtml(draft.id, base.html);
    const saved = await drafts.save(applied.id, applied.revision, 'clean');
    return { workItemId: saved.workItemId, state: saved.state };
  }

  /** 在模板库新建自定义模板（= 在模板文档里创建一个普通工作项）。 */
  async createCustom(origin: 'https://polarion.pufafen.com', title: string, category: string, html: string): Promise<{ workItemId: string }> {
    const drafts = this.drafts;
    if (!drafts) throw Error('TEMPLATE_UNAVAILABLE');
    const name = `[${category}] ${title.trim()}`;
    const draft = await drafts.create(this.libraryTarget(origin), name, 'task');
    const applied = drafts.replaceHtml(draft.id, html);
    await drafts.save(applied.id, applied.revision, 'clean');
    return { workItemId: applied.workItemId };
  }

  /** 把模板正文以副本写入目标项目的新工作项（编号按目标项目规则生成；模板原件不动）。 */
  async instantiate(target: Target, templateId: string, title: string, anchorWorkItemId?: string): Promise<{ workItemId: string; draftId: string; revision: number; state: string }> {
    const template = await this.read(target.origin, templateId);
    const drafts = this.drafts;
    if (!drafts?.remote.create) throw Error('TEMPLATE_INSTANTIATE_UNAVAILABLE');
    // anchorWorkItemId：光标所在条目；新条目创建在它之下（原生位置语义），缺省追加到文档末尾。
    const draft = await drafts.create(target, title, 'softwarerequirement', anchorWorkItemId);
    try {
      const applied = drafts.replaceHtml(draft.id, template.html);
      const saved = await drafts.save(applied.id, applied.revision, 'clean');
      return { workItemId: saved.workItemId, draftId: saved.id, revision: saved.revision, state: saved.state };
    } catch (error) {
      throw error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error : Error('TEMPLATE_INSTANTIATE_FAILED');
    }
  }

  /** 把模板正文写入目标项目已有的空白工作项（原生「插入模板」路径）。 */
  async apply(target: Target, workItemId: string, templateId: string): Promise<{ workItemId: string; revision: number; state: string; html: string; title: string }> {
    const template = await this.read(target.origin, templateId);
    const drafts = this.drafts;
    if (!drafts) throw Error('TEMPLATE_APPLY_UNAVAILABLE');
    const draft = await drafts.open(target, workItemId);
    const existing = (draft.html ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s/g, '');
    if (existing) throw Error('TEMPLATE_APPLY_TARGET_NOT_EMPTY');
    const applied = drafts.replaceHtml(draft.id, template.html);
    const saved = await drafts.save(applied.id, applied.revision, 'clean');
    return { workItemId: saved.workItemId, revision: saved.revision, state: saved.state, html: saved.html, title: saved.title };
  }
}
