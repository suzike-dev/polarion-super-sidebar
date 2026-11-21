import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'fflate';
import { Store } from './store.ts';
import { Drafts, Polarion } from './polarion.ts';
import { isHeadingType, ModelModuleSchema, ModelNoteSchema, ModelRootSchema, type ModelBaselineInfo, type ModelCheckFinding, type ModelCheckView, type ModelFileChange, type ModelIndexedItem, type ModelIndexView, type ModelModule, type ModelNote, type ModelRoot, type ModelRootsView, type ModelScanView, type ModelTraceGroup, type ModelTraceView, type Target } from '../../packages/protocol/index.ts';

/** Simulink 模型关联：项目级配置（PSB-MODEL 工作项 + sidebar-model.roots.json 附件）+ 工作项级备注（sidebar-model.json）。 */
const TITLE = 'PSB-MODEL';
const FILE = 'sidebar-model.roots.json';

type FileOwner = Pick<ModelModule, 'key' | 'name'>;
type PatrolBaseline = {
  at: number;
  files: Record<string, string>;
  owners?: Record<string, FileOwner | null>;
  items: { workItemId: string; title: string; updated: string }[];
};

const gzipJson = (value: unknown) => Buffer.from(gzipSync(new TextEncoder().encode(JSON.stringify(value)))).toString('base64');
const gunzipJson = <T>(base64: string): T => JSON.parse(new TextDecoder().decode(gunzipSync(Buffer.from(base64, 'base64'))));

/** 平台模块目录：跨项目共用的固定模块清单。需求先于模型的项目（未配置模型根目录）也能把需求落到这套目录上。 */
export const PLATFORM_ROOT_ID = '00000000-0000-4000-8000-000000000001';
const PLATFORM_CATALOG_KEY = 'model-platform-catalog';
export function platformRoot(store: Store): ModelRoot | null {
  const catalog = store.get<{ modules: ModelModule[] }>(PLATFORM_CATALOG_KEY, 'global');
  const modules = (catalog?.modules ?? []).filter(module => !module.excluded);
  if (!modules.length) return null;
  return ModelRootSchema.parse({ id: PLATFORM_ROOT_ID, label: '平台模块', modules });
}

const SKIP_DIRS = new Set(['.svn', '.git', 'node_modules', '_work', 'build', 'bin', 'codegen', 'slprj', 'derivedwork', 'work']);

function classify(dir: string): ModelModule['kind'] {
  const value = dir.toLowerCase();
  if (/(^|[\/ _-])(integrate|integration|topmodel|top|frame|plat|platform)/.test(value)) return 'integration';
  if (/(^|[\/ _-])(lib|library|libs)/.test(value)) return 'library';
  if (/(^|[\/ _-])(test|unittest|verif)/.test(value)) return 'test';
  return 'module';
}

/**
 * 扫描本地模型根目录：递归（深度 ≤3）找 .slx/.mdl，模块 = 模型文件所在目录；
 * 同目录的 _DD.sldd/.xlsx 记为字典/接口表；根级独立 .sldd 记入 dictionaries。
 * 只读目录结构，不解析模型内容，无 MATLAB 依赖。
 */
export function scanModelRoot(inputPath: string, { allowEmpty = false } = {}): ModelScanView & { fileCount: number } {
  if (!/^[a-z]:[\\/]/i.test(inputPath) && !inputPath.startsWith('\\\\')) throw Error('MODEL_ROOT_ABSOLUTE_PATH_REQUIRED');
  const root = path.resolve(inputPath);
  let stat: fs.Stats;
  try { stat = fs.statSync(root); } catch { throw Error('MODEL_ROOT_NOT_FOUND'); }
  if (!stat.isDirectory()) throw Error('MODEL_ROOT_NOT_DIRECTORY');
  const models: string[] = [];
  const dictionaries: string[] = [];
  let projectFile: string | null = null;
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if (allowEmpty) throw error; return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 3 && !SKIP_DIRS.has(entry.name.toLowerCase())) walk(full, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).replaceAll('\\', '/');
      if (/\.prj$/i.test(entry.name)) projectFile ??= rel;
      else if (/\.(slx|mdl)$/i.test(entry.name)) models.push(rel);
      else if (/\.sldd$/i.test(entry.name)) dictionaries.push(rel);
    }
  };
  walk(root, 0);
  if (!models.length && !allowEmpty) throw Error('MODEL_ROOT_NO_MODELS');
  if (models.length > 800) throw Error('MODEL_ROOT_TOO_MANY_MODELS');
  const modules = new Map<string, ModelModule>();
  const moduleDirs = new Set(models.map(rel => path.dirname(rel).replaceAll('\\', '/')));
  for (const rel of models.sort((a, b) => a.localeCompare(b))) {
    const dir = path.dirname(rel).replaceAll('\\', '/');
    const base = path.basename(rel).replace(/\.(slx|mdl)$/i, '');
    // 同目录多模型（ Harness 等）合并进该目录的模块，主模型取非 Harness 的第一个。
    if (/(_harness|harness_|_test_|^test_)/i.test(base)) continue;
    const existing = modules.get(dir);
    if (existing) { if (rel.length < existing.model.length) existing.model = rel; existing.name = existing.name || base; continue; }
    const dirEntries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
    const dictionary = dirEntries.find(n => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_DD\\.sldd$`, 'i').test(n)) ?? dirEntries.find(n => /\.sldd$/i.test(n)) ?? null;
    const interfaceFile = dirEntries.find(n => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_DD\\.xlsx$`, 'i').test(n)) ?? dirEntries.find(n => /\.xlsx$/i.test(n) && !/^~/i.test(n)) ?? null;
    modules.set(dir, { key: dir, name: base, dir, model: rel, dictionary: dictionary ? `${dir}/${dictionary}`.replace(/^\//, '') : null, interface: interfaceFile ? `${dir}/${interfaceFile}`.replace(/^\//, '') : null, kind: classify(dir), excluded: classify(dir) === 'test' });
  }
  // 根级字典：不属于任何模块目录的 .sldd（如 03_Data/TMS_DataType.sldd）。
  const rootDictionaries = dictionaries.filter(rel => { const dir = path.dirname(rel); return dir === '.' || !moduleDirs.has(dir); });
  const rootName = path.basename(root);
  return { rootName, label: rootName, path: root, projectFile, dictionaries: rootDictionaries.slice(0, 100), modules: [...modules.values()].slice(0, 500), scannedAt: Date.now(), fileCount: models.length };
}

type StoredModelIndex = ModelIndexView & { markedHeadings?: ModelIndexedItem[] };

/** 旧索引把章节混在 items 中；按同一规则读取旧记录和同步结果，显式标注的章节单独保留。 */
function requirementIndex(index: Omit<StoredModelIndex, 'total' | 'annotated'>): StoredModelIndex {
  const items = index.items.filter(item => !isHeadingType(item.type));
  const markedHeadings = index.markedHeadings ?? index.items.filter(item => isHeadingType(item.type) && item.marks.length);
  return { ...index, items, total: items.length, annotated: items.filter(item => item.marks.length).length, ...(markedHeadings.length ? { markedHeadings } : {}) };
}

function cachedModelIndex(store: Store, projectId: string) {
  const index = store.get<StoredModelIndex>('model-index', projectId);
  return index && requirementIndex(index);
}

function indexedAnnotations(index?: StoredModelIndex) {
  return index ? [...index.items.filter(item => item.marks.length), ...(index.markedHeadings ?? [])] : [];
}

/** 会话注入用的模型概况摘要：roots + 模块 + 需求覆盖计数（读本机缓存，无 IO 等待）。 */
export function modelContextDigest(store: Store, projectId: string): string {
  const cached = store.get<{ roots: ModelRoot[] }>('model-roots', projectId);
  const index = cachedModelIndex(store, projectId);
  const roots = cached?.roots ?? [];
  const lines: string[] = [];
  const digestRoot = (root: ModelRoot, platformMode: boolean) => {
    const modules = root.modules.filter(m => !m.excluded);
    if (!modules.length) return;
    lines.push(`${root.label}：${platformMode ? '（平台固定模块目录，本项目未配置模型根目录）' : `${root.path}${root.projectFile ? `（Simulink 工程 ${root.projectFile}）` : ''}${root.dictionaries.length ? `（公共字典 ${root.dictionaries.join(', ')}）` : ''}`}`);
    for (const module of modules.slice(0, 40)) {
      const count = index?.items.filter(item => item.marks.some(mark => mark.rootId === root.id && mark.modules.includes(module.key))).length ?? 0;
      lines.push(`  - ${module.name}（${module.key}${module.dictionary ? ` · 字典 ${module.dictionary}` : ''}${module.interface ? ` · 接口表 ${module.interface}` : ''}${module.kind !== 'module' ? ` · ${module.kind}` : ''}）· 已关联需求 ${count} 条`);
    }
    if (modules.length > 40) lines.push(`  …共 ${modules.length} 个模块，完整清单用 model_trace(action="overview") 查询`);
  };
  if (roots.length) {
    for (const root of roots) digestRoot(root, false);
  } else {
    const platform = platformRoot(store);
    if (platform) digestRoot(platform, true);
  }
  if (index) lines.push(`需求覆盖：已标注 ${index.annotated}/${index.total}（索引 ${new Date(index.syncedAt).toLocaleString('zh-CN')}）`);
  return lines.join('\n');
}

export class Model {
  private store: Store; private drafts: Drafts;
  constructor(store: Store, drafts: Drafts) { this.store = store; this.drafts = drafts; }
  /** 平台模块目录：全局一份，跨项目共用；项目未配置模型根目录时，AI 初关联与手标注落到这套目录。 */
  platformCatalog(): ModelModule[] {
    const catalog = this.store.get<{ modules: ModelModule[] }>(PLATFORM_CATALOG_KEY, 'global');
    return catalog?.modules ?? [];
  }
  savePlatformCatalog(modules: ModelModule[]): ModelModule[] {
    // 以 key 去重、规范化 kind/excluded，保证提示词与 UI 多选都以 key 为准。
    const byKey = new Map<string, ModelModule>();
    for (const module of modules) byKey.set(module.key, ModelModuleSchema.parse({ ...module, dir: '', model: '', dictionary: null, interface: null, kind: module.kind || 'module' }));
    const clean = [...byKey.values()];
    this.store.put(PLATFORM_CATALOG_KEY, 'global', { modules: clean });
    return clean;
  }

  private remote(): Polarion { if (!(this.drafts.remote instanceof Polarion)) throw Error('POLARION_UNAVAILABLE'); return this.drafts.remote; }
  private typeCandidates(): string[] {
    const configured = this.store.settings().changeRecordType.trim();
    return [...new Set([configured, 'task', 'changeRequest', 'change', 'risk', 'defect'].filter(Boolean))];
  }

  /** 读取项目模型配置：Polarion 为准，本机缓存兜底。 */
  async roots(target: Target): Promise<ModelRootsView> {
    const localPaths = this.store.get<Record<string, string>>('model-root-paths', target.projectId) ?? {};
    try {
      const remote = this.remote();
      const row = (await remote.changeList(target, 20, `title:${TITLE}*`))[0];
      const view: ModelRootsView = { roots: [], source: 'polarion', ...(row ? { workItemId: row.workItemId, updated: row.updated } : {}) };
      const attachment = (row?.attachments ?? []).find(item => item.file_name === FILE);
      if (row && attachment?.file_name) {
        const raw = await remote.changeRead(target, row.workItemId, attachment.file_name);
        const payload = gunzipJson<{ v?: number; roots?: unknown }>(raw.dataBase64);
        const roots = Array.isArray(payload.roots) ? payload.roots : [];
        const validated: ModelRoot[] = [];
        for (const item of roots.slice(0, 10)) {
          const parsed = ModelRootSchema.safeParse(item);
          if (!parsed.success) continue;
          const root = parsed.data;
          // v1 默认排除 Com_Lib。只迁移这个已知库，v2 中保存的手动排除始终优先。
          const modules = (payload.v ?? 1) < 2 ? root.modules.map(m => m.kind === 'library' && m.name.toLowerCase() === 'com_lib' ? { ...m, excluded: false } : m) : root.modules;
          validated.push({ ...root, modules, path: localPaths[root.id] ?? '' });
        }
        view.roots = validated;
      }
      this.store.put('model-roots', target.projectId, { roots: view.roots, workItemId: view.workItemId, updated: view.updated, at: Date.now() });
      return view;
    } catch { /* Polarion 暂不可达：退回本机缓存 */ }
    const cached = this.store.get<{ roots: ModelRoot[]; workItemId?: string; updated?: string }>('model-roots', target.projectId);
    return cached ? { roots: cached.roots, source: 'cache', workItemId: cached.workItemId, updated: cached.updated } : { roots: [], source: 'empty' };
  }

  /** 标注视图：配置根目录为空时，追加平台模块目录作为兜底根，工作项备注照常标注。 */
  async viewRoots(target: Target): Promise<ModelRootsView> {
    const view = await this.roots(target);
    if (view.roots.length) return view;
    const platform = platformRoot(this.store);
    return platform ? { ...view, roots: [platform] } : view;
  }

  bindLocal(target: Target, rootId: string, localPath: string) {
    const cached = this.store.get<ModelRootsView>('model-roots', target.projectId);
    const root = cached?.roots.find(item => item.id === rootId);
    if (!cached || !root) throw Error('MODEL_ROOT_NOT_FOUND');
    const scan = scanModelRoot(localPath);
    if (!scan.modules.some(module => root.modules.some(previous => previous.key === module.key))) throw Error('所选目录与当前配置没有相同模块，请选择对应的模型根目录。');
    const paths = this.store.get<Record<string, string>>('model-root-paths', target.projectId) ?? {};
    this.store.put('model-root-paths', target.projectId, { ...paths, [rootId]: scan.path });
    this.store.put('model-roots', target.projectId, { ...cached, roots: cached.roots.map(item => item.id === rootId ? { ...item, path: scan.path } : item) });
    return { path: scan.path };
  }

  /** 保存配置到项目工作项；冲突报专用错误让前端引导重新加载。 */
  async rootsSave(target: Target, roots: ModelRoot[], expectedUpdated?: string | null): Promise<ModelRootsView> {
    const remote = this.remote();
    const row = (await remote.changeList(target, 20, `title:${TITLE}*`))[0];
    if (expectedUpdated !== undefined && expectedUpdated !== (row?.updated ?? null)) throw Error('MODEL_ROOTS_CONFLICT：配置刚被他人更新，请重新加载后再保存。');
    const description = '<h2>Polarion Sidebar · 模型关联（项目共享）</h2><p>本项目需求与本地 Simulink 模型目录的关联配置。附件由侧边栏维护，请勿手改；SVN 路径是本机的，其他成员需在本机重新绑定路径，模块备注不受影响。</p>';
    let last: unknown;
    for (const type of this.typeCandidates()) {
      try {
        const written = await remote.changeWrite({ target, ...(row ? { workItemId: row.workItemId, expectedUpdated: row.updated } : { type }), title: `${TITLE} 模型关联`, description, fileName: FILE, attachmentTitle: 'Polarion Sidebar 模型关联配置', dataBase64: gzipJson({ v: 2, roots: roots.map(({ path: _localPath, ...shared }) => shared) }) });
        this.store.put('model-root-paths', target.projectId, Object.fromEntries(roots.map(root => [root.id, root.path])));
        this.store.put('model-roots', target.projectId, { roots, workItemId: written.workItemId, updated: written.updated, at: Date.now() });
        return { roots, source: 'polarion', workItemId: written.workItemId, updated: written.updated };
      } catch (error) {
        const message = String((error as Error).message);
        if (/CONFLICT/.test(message)) throw Error('MODEL_ROOTS_CONFLICT：配置刚被他人更新，请重新加载后再保存。');
        last = error;
        if (!/CHANGE_RECORD_CREATE_FAILED/.test(message)) throw error;
      }
    }
    throw last instanceof Error ? last : Error('CHANGE_RECORD_CREATE_FAILED');
  }

  async noteRead(target: Target, workItemId: string): Promise<ModelNote> {
    const remote = this.remote();
    if (!remote.modelNoteRead) throw Error('MODEL_BACKEND_UNAVAILABLE');
    const value = await remote.modelNoteRead(target, workItemId);
    const parsed = ModelNoteSchema.safeParse(value.note);
    return parsed.success ? parsed.data : { format: 'polarion-sidebar-model-note', version: 1, marks: [] };
  }

  async noteWrite(target: Target, workItemId: string, note: ModelNote): Promise<{ verified: boolean; updated?: string }> {
    const remote = this.remote();
    if (!remote.modelNoteWrite) throw Error('MODEL_BACKEND_UNAVAILABLE');
    return remote.modelNoteWrite(target, workItemId, ModelNoteSchema.parse(note));
  }

  /** 批量同步当前文档工作项的模块备注 → 本机索引（SQLite）。
   * Polarion 查询不支持 document: 字段（真机验证两种写法均 0 条），因此全项目拉取后
   * 按当前文档 outline 的条目集合过滤——既不混入其他文档/空间，也不依赖查询语法。 */
  async indexSync(target: Target, query: string): Promise<ModelIndexView> {
    const remote = this.remote();
    if (!remote.modelNotes) throw Error('MODEL_BACKEND_UNAVAILABLE');
    const effective = query.trim() || 'NOT(title:PSB-*)';
    const result = await remote.modelNotes(target, effective);
    let documentTypes: Map<string, string> | undefined;
    try {
      const outline = await remote.outline(target);
      if (outline.items.length) documentTypes = new Map(outline.items.map(item => [item.id, item.type]));
    } catch { /* outline 不可用时保留项目查询结果 */ }
    const scoped = documentTypes ? result.items.filter(item => documentTypes.has(item.workItemId)) : result.items;
    const items = scoped.map(item => ({ ...item, type: documentTypes?.get(item.workItemId)?.trim() || item.type }));
    const view = requirementIndex({ items, syncedAt: Date.now(), query: effective, ...(result.partial || scoped.length < result.items.length ? { partial: true } : {}) });
    this.store.put('model-index', target.projectId, view);
    return view;
  }

  /** 追溯视图：roots（缓存）+ 索引（缓存）→ 模块分组、未标注清单、零需求模块。
   * 项目未配置模型根目录时，平台模块目录作为兜底根参与分组（有平台标注时即使有配置根也显示）。 */
  async traceView(target: Target): Promise<ModelTraceView> {
    const rootsView = await this.roots(target);
    const index = cachedModelIndex(this.store, target.projectId);
    const items = index?.items ?? [];
    const groups: ModelTraceGroup[] = [];
    const pushGroups = (root: ModelRoot) => {
      for (const module of root.modules) {
        if (module.excluded) continue;
        const linked = (item: ModelIndexedItem) => item.marks.some(mark => mark.rootId === root.id && mark.modules.includes(module.key));
        const matched = items.filter(linked);
        const markedHeadings = index?.markedHeadings?.filter(linked);
        groups.push({ rootId: root.id, rootLabel: root.label, moduleKey: module.key, moduleName: module.name, kind: module.kind, items: matched, missing: matched.length === 0, ...(markedHeadings?.length ? { markedHeadings } : {}) });
      }
    };
    for (const root of rootsView.roots) pushGroups(root);
    if (!rootsView.roots.length || items.some(item => item.marks.some(mark => mark.rootId === PLATFORM_ROOT_ID))) {
      const platform = platformRoot(this.store);
      if (platform) {
        pushGroups(platform);
        rootsView.roots = [...rootsView.roots, platform];
      }
    }
    return { roots: rootsView.roots, groups, unannotated: items.filter(item => !item.marks.length), total: index?.total ?? 0, annotated: index?.annotated ?? 0, syncedAt: index?.syncedAt ?? 0, stale: !index };
  }


  // ---- 一致性巡检：内容指纹基准 + 双侧变更检测。 ----

  /** 巡检跟踪的文件：每个模块的模型/字典/接口表 + 根级公共字典（相对根目录路径）。 */
  private fileOwners(scan: Pick<ModelScanView, 'modules' | 'dictionaries'>) {
    const owners = new Map<string, FileOwner | null>();
    for (const dictionary of scan.dictionaries) owners.set(dictionary, null);
    for (const module of scan.modules) {
      const owner = { key: module.key, name: module.name };
      for (const file of [module.model, module.dictionary, module.interface]) if (file) owners.set(file, owner);
    }
    return owners;
  }
  /** 旧基准只存指纹；已从配置移除的模块仍可从基准中同目录的主模型定位。 */
  private baselineOwners(baseline: PatrolBaseline, root: ModelRoot) {
    if (baseline.owners) return new Map(Object.entries(baseline.owners));
    const known = this.fileOwners(root);
    const byDir = new Map<string, FileOwner>();
    for (const file of Object.keys(baseline.files)) {
      if (!/\.(slx|mdl)$/i.test(file)) continue;
      const key = path.posix.dirname(file);
      byDir.set(key, { key, name: path.posix.parse(file).name });
    }
    for (const file of Object.keys(baseline.files)) {
      if (!known.has(file)) known.set(file, byDir.get(path.posix.dirname(file)) ?? null);
    }
    return known;
  }
  private hashFile(rootPath: string, rel: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(rootPath, ...rel.split('/')))).digest('hex');
  }
  /** 已绑定本机目录的根：配置缓存里找 root，本机路径表里找 path。 */
  private boundRoot(target: Target, rootId: string): { root: ModelRoot; path: string } {
    const cached = this.store.get<ModelRootsView>('model-roots', target.projectId);
    const root = cached?.roots.find(item => item.id === rootId);
    const localPath = this.store.get<Record<string, string>>('model-root-paths', target.projectId)?.[rootId] ?? root?.path ?? '';
    if (!root) throw Error('MODEL_ROOT_NOT_FOUND');
    if (!localPath) throw Error('MODEL_ROOT_PATH_UNBOUND：请先在模型关联工作台为本根目录绑定本机路径。');
    return { root, path: localPath };
  }
  /** 拍基准：当前文件内容指纹 + 已标注需求的修订时间。之后巡检以这份快照判定谁变了。 */
  async baselineSet(target: Target, rootId: string): Promise<ModelCheckView> {
    const { root, path: rootPath } = this.boundRoot(target, rootId);
    const scan = scanModelRoot(rootPath);
    const owners = this.fileOwners(scan);
    const files: Record<string, string> = {};
    for (const rel of owners.keys()) files[rel] = this.hashFile(rootPath, rel);
    const index = cachedModelIndex(this.store, target.projectId);
    const items = indexedAnnotations(index).filter(item => item.marks.some(mark => mark.rootId === rootId)).map(item => ({ workItemId: item.workItemId, title: item.title, updated: item.updated }));
    this.store.put('model-baseline', `${target.projectId}:${rootId}`, { id: `${target.projectId}:${rootId}`, rootId, label: root.label, at: Date.now(), files, owners: Object.fromEntries(owners), items });
    return this.check(target, rootId);
  }
  baselines(projectId: string): ModelBaselineInfo[] {
    const prefix = `${projectId}:`;
    return this.store.list<{ id: string; rootId: string; label: string; at: number; files: Record<string, string>; items: unknown[] }>('model-baseline')
      .filter(row => typeof row.id === 'string' && row.id.startsWith(prefix))
      .map(row => ({ rootId: row.rootId, rootLabel: row.label, at: row.at, files: Object.keys(row.files).length, items: row.items.length }));
  }
  /** AI 初关联提示词：先了解全部模块、再逐条读全部需求，双向匹配后写第一版实现模块备注，供人工修正。 */
  autolinkPrompt(target: Target): { prompt: string; count: number; mode: 'models' | 'platform' } {
    const cached = this.store.get<ModelRootsView>('model-roots', target.projectId);
    const roots = (cached?.roots ?? []).filter(root => root.path);
    const platform = platformRoot(this.store);
    const index = cachedModelIndex(this.store, target.projectId);
    if (!roots.length && !platform) throw Error('MODEL_AUTOLINK_NEEDS_ROOT：请先绑定本机模型目录，或在模型关联工作台维护平台模块目录。');
    if (!index) throw Error('MODEL_AUTOLINK_NEEDS_INDEX：请先点「同步需求备注」构建需求索引。');
    if (!index.total) throw Error('MODEL_AUTOLINK_NO_REQUIREMENTS：当前索引中没有可关联的需求。');
    const pending = index.items.filter(item => !item.marks.length);
    if (!pending.length) throw Error('MODEL_AUTOLINK_ALL_ANNOTATED：全部工作项上已有实现模块备注，无需初关联。');
    const usePlatform = !roots.length && !!platform;
    const moduleRoots = usePlatform ? [platform!] : roots;
    const moduleLines = moduleRoots.flatMap(root => root.modules.filter(module => !module.excluded).map(module =>
      `- rootId=${root.id}｜${root.label}｜${module.name}（key=${module.key}${module.dictionary ? `｜字典 ${module.dictionary}` : ''}${module.interface ? `｜接口表 ${module.interface}` : ''}${module.kind !== 'module' ? `｜${module.kind}` : ''}）`));
    const itemLines = pending.slice(0, 400).map(item => `- ${item.workItemId}｜${item.title || '(无标题)'}｜${item.type}`);
    const prompt = [
      '【模型初关联】为本项目需求与 Simulink 模块建立第一版实现关联，结果供人工逐条修正。',
      '流程（先了解模型，再读需求，最后才关联；不许跳步）:',
      '阶段一 · 了解模型侧：先用 mcp__polarion_drafts__model_trace 的 action=overview 通览全部模块（路径/字典/接口表/类型/已有标注分布），对照下方模块清单逐个归纳「该模块负责什么」；',
      '对标注较多或职责不明的模块，再用 action=requirements 查看已关联需求样例加深理解，直到形成完整的「模块职责表」才进入下一阶段。',
      '阶段二 · 读需求侧：用 peek_work_item 逐条读取下方全部待关联工作项的标题与正文，不要只看标题；每条提取：要求什么功能、涉及什么信号/接口/参数、约束是什么。',
      '阶段三 · 双向匹配：把每条需求与模块职责表对照，证据要来自两侧（需求侧功能词/信号名/接口名 ↔ 模块侧职责/字典/接口表/已有标注）；一条需求可关联多个模块。',
      '规则：',
      '1. 只处理清单里的工作项（都还没有备注）；其他已有备注的一律不动。',
      '2. 每条结论用 mcp__polarion_drafts__model_trace 的 action=note_write 写入，marks 形如 [{rootId:"…",modules:["key"]}]——rootId 和 key 必须严格来自下方模块清单，禁止编造。',
      '3. 仅标题相似而正文没有证据时不要关联；把握不足宁可不写，列入「待人工确认」并给一句理由。',
      '4. 全部处理后输出汇总：已关联（工作项→模块→一句依据）、待人工确认（理由）、未关联；提醒用户回到模型关联工作台点「同步需求备注」刷新矩阵，再逐条修正。',
      `模块清单（${moduleLines.length} 个）${usePlatform ? '（项目未配置模型根目录，本次按平台模块目录关联）' : ''}：`, ...moduleLines,
      `待关联工作项（${Math.min(pending.length, 400)}/${pending.length} 条）：`, ...itemLines,
    ].join('\n');
    return { prompt, count: Math.min(pending.length, 400), mode: usePlatform ? 'platform' : 'models' };
  }
  /**
   * 巡检：重扫本机文件指纹，对比基准 → 模型侧变化；对比需求修订时间 → 需求侧变化；
   * 同一模块两侧都动过 → both（需人工裁决）。模型侧变化模块的关联需求标“疑似过期”。
   */
  async check(target: Target, rootId: string): Promise<ModelCheckView> {
    const { root, path: rootPath } = this.boundRoot(target, rootId);
    const key = `${target.projectId}:${rootId}`;
    const baseline = this.store.get<PatrolBaseline>('model-baseline', key);
    if (!baseline) return { at: Date.now(), baselineAt: null, ok: false, message: '尚未设定基准。先点「设为基准」，之后的模型或需求变更才会被对比。', checkedFiles: 0, changedFiles: 0, findings: [] };
    const scan = scanModelRoot(rootPath, { allowEmpty: true });
    const owners = this.fileOwners(scan);
    const previousOwners = this.baselineOwners(baseline, root);
    const current: Record<string, string> = {};
    let checkedFiles = 0;
    let unreadable = 0;
    for (const rel of owners.keys()) {
      try { current[rel] = this.hashFile(rootPath, rel); checkedFiles++; }
      catch { unreadable++; }
    }
    const changes: ModelFileChange[] = [];
    for (const [rel, hash] of Object.entries(current)) {
      if (!(rel in baseline.files)) changes.push({ path: rel, change: 'added' });
      else if (baseline.files[rel] !== hash) changes.push({ path: rel, change: 'modified' });
    }
    for (const rel of Object.keys(baseline.files)) if (!owners.has(rel)) changes.push({ path: rel, change: 'removed' });
    const moduleNames = new Map(root.modules.map(module => [module.key, module.name]));
    const modelSide = new Map<string, ModelFileChange[]>();
    for (const change of changes) {
      const module = (change.change === 'removed' ? previousOwners : owners).get(change.path);
      const moduleKey = module?.key ?? '';
      if (module) moduleNames.set(moduleKey, module.name);
      if (!modelSide.has(moduleKey)) modelSide.set(moduleKey, []);
      modelSide.get(moduleKey)!.push(change);
    }
    // 需求侧：基准后更新过（或新标注）的已关联工作项。
    const index = cachedModelIndex(this.store, target.projectId);
    const items = indexedAnnotations(index);
    const baselineItems = new Map(baseline.items.map(item => [item.workItemId, item.updated]));
    const requirementSide = new Map<string, Map<string, { workItemId: string; title: string; requirementChanged: boolean }>>();
    for (const item of items) {
      const previous = baselineItems.get(item.workItemId);
      const changed = previous === undefined || previous !== item.updated;
      if (!changed) continue;
      for (const mark of item.marks.filter(m => m.rootId === rootId)) {
        for (const moduleKey of mark.modules) {
          if (!requirementSide.has(moduleKey)) requirementSide.set(moduleKey, new Map());
          requirementSide.get(moduleKey)!.set(item.workItemId, { workItemId: item.workItemId, title: item.title, requirementChanged: true });
        }
      }
    }
    // 基准内已有、现在仍关联但本次未变的工作项：作为模型侧变化的影响对象列出（requirementChanged=false）。
    const findings: ModelCheckFinding[] = [];
    const moduleKeys = new Set([...modelSide.keys(), ...requirementSide.keys()]);
    for (const moduleKey of moduleKeys) {
      const files = modelSide.get(moduleKey) ?? [];
      const changedItems = requirementSide.get(moduleKey);
      if (!files.length && !changedItems?.size) continue;
      const affected = new Map<string, { workItemId: string; title: string; requirementChanged: boolean }>();
      if (files.length) for (const item of items) if (item.marks.some(mark => mark.rootId === rootId && mark.modules.includes(moduleKey))) affected.set(item.workItemId, { workItemId: item.workItemId, title: item.title, requirementChanged: false });
      for (const entry of changedItems?.values() ?? []) affected.set(entry.workItemId, { ...entry, requirementChanged: true });
      findings.push({
        rootId, rootLabel: root.label, moduleKey, moduleName: moduleNames.get(moduleKey) ?? (moduleKey || '公共字典/未归属文件'),
        side: files.length && changedItems?.size ? 'both' : files.length ? 'model' : 'requirement',
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
        workItems: [...affected.values()].sort((a, b) => a.workItemId.localeCompare(b.workItemId)),
      });
    }
    findings.sort((a, b) => (a.side === 'both' ? 0 : a.side === 'model' ? 1 : 2) - (b.side === 'both' ? 0 : b.side === 'model' ? 1 : 2) || a.moduleName.localeCompare(b.moduleName));
    const messages: string[] = [];
    if (unreadable) messages.push(`${unreadable} 个文件读取失败（可能被占用）`);
    if (!index) messages.push('追溯索引为空：先同步需求备注，需求侧变化才可判定');
    else if (index.syncedAt < baseline.at) messages.push(`追溯索引早于基准（${new Date(index.syncedAt).toLocaleString('zh-CN')}），建议先同步需求备注再判定需求侧`);
    const view: ModelCheckView = { at: Date.now(), baselineAt: baseline.at, ok: findings.length === 0, ...(messages.length ? { message: messages.join('；') } : {}), checkedFiles, changedFiles: changes.length, findings };
    this.store.put('model-check', key, view);
    return view;
  }
}
