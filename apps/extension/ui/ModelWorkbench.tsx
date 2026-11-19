import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, ChevronRight, FolderOpen, RefreshCw, ShieldCheck, Sparkles, Trash2, X, Check, Grid3x3 } from 'lucide-react';
import type { CoverageView, ModelBaselineInfo, ModelCheckView, ModelIndexView, ModelModule, ModelRoot, ModelRootsView, ModelScanView, ModelTraceView, Target } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './model-workbench.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
const kindLabels: Record<ModelModule['kind'], string> = { module: '功能模块', integration: '集成模型', library: '库', test: '测试', other: '其他' };
const sideLabels: Record<string, string> = { model: '模型侧变化', requirement: '需求侧变化', both: '两侧都变·需裁决' };
const changeMarks: Record<string, string> = { added: '＋', removed: '－', modified: '△' };

const ModuleChoice = React.memo(function ModuleChoice({ module, added, onSelect }: {
  module: ModelModule; added: boolean; onSelect: (key: string, checked: boolean) => void;
}) {
  const files = [module.dictionary, module.interface].filter(Boolean);
  return <button type="button" role="checkbox" aria-checked={!module.excluded} onClick={() => onSelect(module.key, module.excluded)} className={(added ? 'is-new ' : '') + (module.excluded ? 'excluded' : '')}>
    <span className="module-check" aria-hidden="true">{module.excluded ? '' : '✓'}</span>
    <span className="name" title={module.key}>{module.name}</span>
    <span className="kind">{kindLabels[module.kind]}</span>
    <small title={[module.model, ...files].join(' · ')}>{files.length ? '含字典/接口表' : ''}</small>
  </button>;
});

/** 模型关联工作台：绑定本地 Simulink 模型根目录（SVN 目录）、维护模块清单、追溯需求↔模块覆盖。 */
export function ModelWorkbench({ target, right, top, onClose, onOpenItem, onAutolink }: { target: Target; right: number; top: number; onClose: () => void; onOpenItem: (workItemId: string) => void; onAutolink: () => void }) {
  const [rootsView, setRootsView] = useState<ModelRootsView | null>(null);
  const [trace, setTrace] = useState<ModelTraceView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<ModelRoot | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ added: string[]; removed: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showUnannotated, setShowUnannotated] = useState(false);
  const [baselines, setBaselines] = useState<ModelBaselineInfo[]>([]);
  const [checks, setChecks] = useState<Record<string, ModelCheckView>>({});
  const [openFindings, setOpenFindings] = useState<string | null>(null);
  const [checking, setChecking] = useState('');
  const [coverageMode, setCoverageMode] = useState(false);
  const [coverage, setCoverage] = useState<CoverageView | null>(null);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [coverageGapsOnly, setCoverageGapsOnly] = useState(false);
  const [expandedCoverage, setExpandedCoverage] = useState<string | null>(null);
  const addedKeys = React.useMemo(() => new Set(editingDraft?.added), [editingDraft]);
  const selectModule = useCallback((key: string, selected: boolean) => {
    setEditing(current => current && { ...current, modules: current.modules.map(m => m.key === key ? { ...m, excluded: !selected } : m) });
  }, []);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const reload = useCallback(async () => {
    setError('');
    try {
      const [rootsView, trace, baselineRows] = await Promise.all([
        rpc<ModelRootsView>({ method: 'model.roots', target }),
        rpc<ModelTraceView>({ method: 'model.trace.view', target }),
        rpc<ModelBaselineInfo[]>({ method: 'model.baseline.list', projectId: target.projectId }),
      ]);
      setRootsView(rootsView); setTrace(trace); setBaselines(baselineRows);
      // 已有基准的根打开即后台巡检一次：模块上直接给出「疑似过期」。
      for (const info of baselineRows) {
        const root = rootsView.roots.find(r => r.id === info.rootId);
        if (!root?.path) continue;
        void rpc<ModelCheckView>({ method: 'model.check', target, rootId: info.rootId })
          .then(view => setChecks(current => ({ ...current, [info.rootId]: view })))
          .catch(() => { /* 目录暂不可读时保留手动巡检入口 */ });
      }
    }
    catch (e) { setError(errorText(e)); }
  }, [target]);
  useEffect(() => { void reload(); }, [reload]);
  const setBaseline = async (root: ModelRoot) => {
    setError(''); setChecking(root.id);
    try {
      const view = await rpc<ModelCheckView>({ method: 'model.baseline.set', target, rootId: root.id });
      setChecks(current => ({ ...current, [root.id]: view }));
      setBaselines(await rpc<ModelBaselineInfo[]>({ method: 'model.baseline.list', projectId: target.projectId }));
      setOpenFindings(root.id);
    } catch (e) { setError('设定基准失败：' + errorText(e)); }
    finally { setChecking(''); }
  };
  const runCheck = async (root: ModelRoot) => {
    setError(''); setChecking(root.id);
    try { const view = await rpc<ModelCheckView>({ method: 'model.check', target, rootId: root.id }); setChecks(current => ({ ...current, [root.id]: view })); setOpenFindings(root.id); }
    catch (e) { setError('巡检失败：' + errorText(e)); }
    finally { setChecking(''); }
  };
  // 覆盖索引：打开即读缓存，构建走增量同步（首次较慢）。
  useEffect(() => { void rpc<CoverageView>({ method: 'coverage.view', target }).then(setCoverage).catch(() => {}); }, [target]);
  const syncCoverage = async () => {
    setCoverageBusy(true); setError('');
    try { setCoverage(await rpc<CoverageView>({ method: 'coverage.sync', target })); }
    catch (e) { setError('构建覆盖索引失败：' + errorText(e)); }
    finally { setCoverageBusy(false); }
  };
  const addRoot = async () => {
    setError('');
    try {
      const picked = await rpc<{ path: string | null }>({ method: 'dialog.pickFolder', title: '选择 Simulink 模型根目录（如 ModelandCode）', defaultPath: '' });
      if (!picked.path) return;
      setBusy('正在扫描模型目录…');
      const scan = await rpc<ModelScanView & { fileCount: number }>({ method: 'model.roots.scan', path: picked.path });
      setEditing({ id: crypto.randomUUID(), label: scan.rootName || scan.label, path: scan.path, modules: scan.modules, projectFile: scan.projectFile, dictionaries: scan.dictionaries, scannedAt: scan.scannedAt, note: '' });
      setEditingDraft({ added: scan.modules.map(m => m.key), removed: [] });
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const bindLocal = async (root: ModelRoot) => {
    setError('');
    try {
      const picked = await rpc<{ path: string | null }>({ method: 'dialog.pickFolder', title: `为「${root.label}」选择本机目录`, defaultPath: root.path });
      if (!picked.path) return;
      setBusy('正在核对本机模块…');
      await rpc({ method: 'model.roots.bind', target, rootId: root.id, path: picked.path });
      await reload();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const rescan = async (root: ModelRoot) => {
    setError('');
    try {
      setBusy('正在重新扫描 ' + root.label + '…');
      const scan = await rpc<ModelScanView & { fileCount: number }>({ method: 'model.roots.scan', path: root.path });
      const previous = new Map(root.modules.map(m => [m.key, m]));
      const merged: ModelModule[] = scan.modules.map(fresh => ({ ...fresh, excluded: previous.get(fresh.key)?.excluded ?? fresh.excluded }));
      const removed = root.modules.filter(m => !scan.modules.some(fresh => fresh.key === m.key)).map(m => m.key);
      const added = scan.modules.filter(fresh => !previous.has(fresh.key)).map(m => m.key);
      setEditing({ ...root, modules: merged, dictionaries: scan.dictionaries, projectFile: scan.projectFile, scannedAt: scan.scannedAt });
      setEditingDraft({ added, removed });
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const saveEditing = async () => {
    if (!editing || !rootsView) return;
    setError('');
    try {
      const roots = editing.id && rootsView.roots.some(r => r.id === editing.id) ? rootsView.roots.map(r => r.id === editing.id ? editing : r) : [...rootsView.roots, editing];
      setBusy('正在保存配置…');
      await rpc({ method: 'model.roots.save', target, roots, expectedUpdated: rootsView.updated ?? null });
      setEditing(null); setEditingDraft(null);
      await reload();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const removeRoot = async (root: ModelRoot) => {
    if (!rootsView) return;
    setError('');
    try {
      setBusy('正在移除 ' + root.label + '…');
      await rpc({ method: 'model.roots.save', target, expectedUpdated: rootsView.updated ?? null, roots: rootsView.roots.filter(r => r.id !== root.id) });
      await reload();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  const syncIndex = async () => {
    setError(''); setSyncing(true);
    try {
      const index = await rpc<ModelIndexView>({ method: 'model.index.sync', target, query: '' });
      setTrace(await rpc<ModelTraceView>({ method: 'model.trace.view', target }));
      setError(index.partial ? `同步完成（部分分页受限）：已索引 ${index.items.length} 项，标注 ${index.annotated} 项。` : '');
    } catch (e) { setError(errorText(e)); }
    finally { setSyncing(false); }
  };
  const roots = rootsView?.roots ?? [];
  const traceGroups = trace?.groups ?? [];
  const groupsByRoot = traceGroups.reduce<Record<string, typeof traceGroups>>((acc, group) => { (acc[group.rootId] ??= []).push(group); return acc; }, {});
  // 巡检结论：模型侧（含 both）变化过的模块 → 追溯矩阵里标「疑似过期」。
  const staleByRoot = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [rootId, view] of Object.entries(checks)) {
      const set = new Set<string>();
      for (const finding of view.findings) if (finding.side !== 'requirement') set.add(finding.moduleKey);
      if (set.size) map.set(rootId, set);
    }
    return map;
  }, [checks]);
  return <div className="model-layer" style={{ right, top }} role="dialog" aria-modal="false" aria-label="Simulink 模型关联工作台" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="model-panel">
      <header className="model-header">
        <span className="model-icon"><Boxes size={16}/></span>
        <div className="model-title"><span className="eyebrow">需求 ↔ Simulink 模型</span><strong>模型关联与追溯</strong><small>{target.projectId} · 配置随项目共享（PSB-MODEL），SVN 路径是本机的</small></div>
        <button className="icon" aria-label="关闭模型关联" title="关闭（Esc）" onClick={onClose}><X size={17}/></button>
      </header>
      {busy && <p className="model-busy" role="status">{busy}</p>}
      {error && <p className="model-error" role="alert">{error}<button onClick={() => setError('')}><X size={12}/></button></p>}
      <div className="model-body">
        <div className="model-roots">
          <div className="model-section-head">
            <strong>模型根目录 <span>{roots.length}</span></strong>
            <button className="primary" onClick={() => void addRoot()}><FolderOpen size={13}/>绑定模型目录</button>
          </div>
          {!rootsView && <p className="model-muted">正在读取项目配置…</p>}
          {rootsView && !roots.length && <div className="model-empty">
            <p>还没有绑定模型目录。绑定后可为每个工作项标注「实现模块」，并按模块反查需求。</p>
            <p className="model-hint">典型路径：<code>D:\Work\SVN\&lt;项目&gt;\04_Software\04_ASW_Code\ModelandCode</code>（含十几个模块目录、每模块模型/字典/接口表）。扫描只读目录结构，不改动 SVN。</p>
          </div>}
          {roots.map(root => {
            const baseline = baselines.find(info => info.rootId === root.id);
            const check = checks[root.id];
            return <div className="model-root-card" key={root.id}>
            <div className="model-root-line">
              <strong title={root.path}>{root.label}</strong>
              <span>{root.modules.filter(m => !m.excluded).length} 个模块 · {root.scannedAt ? new Date(root.scannedAt).toLocaleString('zh-CN') : '未扫描'}</span>
              <button disabled={!!busy} onClick={() => { setEditing(root); setEditingDraft(null); }}>选择模块</button>
              <button disabled={!!busy} title="此绑定只保存在本机" onClick={() => void bindLocal(root)}><FolderOpen size={13}/>{root.path ? '更换本机目录' : '绑定本机目录'}</button>
              <button disabled={!root.path || !!busy} title="重新扫描并合并差异" onClick={() => void rescan(root)}><RefreshCw size={13}/>重扫</button>
              <button className="danger" title="从本项目移除该模型目录（模块备注不删除）" onClick={() => void removeRoot(root)}><Trash2 size={13}/>移除</button>
            </div>
            <p className="model-root-path" title={root.path}>{root.path || '本机尚未绑定目录'}{root.projectFile ? ` · ${root.projectFile}` : ''}{root.dictionaries.length ? ` · 公共字典 ${root.dictionaries.length} 个` : ''}</p>
            <div className="model-patrol-line">
              <button className="patrol-set" disabled={!root.path || checking === root.id} title="把当前文件内容指纹和需求修订时间拍成基准；之后的巡检据此判定谁变了" onClick={() => void setBaseline(root)}><ShieldCheck size={13}/>{checking === root.id ? '处理中…' : baseline ? '重设基准' : '设为基准'}</button>
              <button disabled={!root.path || checking === root.id || !baseline} title={baseline ? '对比基准，找出模型/需求哪侧变了' : '先设基准，再巡检'} onClick={() => void runCheck(root)}><RefreshCw size={13} className={checking === root.id ? 'spin' : ''}/>立即巡检</button>
              {baseline && <span className="model-baseline-at" title={`${baseline.files} 个文件指纹 · ${baseline.items} 条关联需求`}>基准 {new Date(baseline.at).toLocaleString('zh-CN')}</span>}
              {check && <span className={'model-check-state ' + (check.ok ? 'ok' : 'warn')}>{check.ok ? '巡检一致' : `差异 ${check.findings.length} 项`}</span>}
              {check && !check.ok && <button className="patrol-toggle" aria-expanded={openFindings === root.id} onClick={() => setOpenFindings(openFindings === root.id ? null : root.id)}>{openFindings === root.id ? '收起明细' : '查看明细'}</button>}
            </div>
            {openFindings === root.id && check && <div className="model-findings">
              {check.message && <p className="model-check-note">{check.message}</p>}
              {check.ok && !check.message && <p className="model-check-note ok">基准（{check.baselineAt ? new Date(check.baselineAt).toLocaleString('zh-CN') : '—'}）以来，模型文件与关联需求均无变化。</p>}
              {check.findings.map(finding => <div key={finding.moduleKey || 'root'} className={'model-finding side-' + finding.side}>
                <div className="model-finding-head">
                  <strong>{finding.moduleName}</strong>
                  <span className="model-side">{sideLabels[finding.side]}</span>
                  {finding.files.map(file => <code key={file.path} title={file.path}>{changeMarks[file.change]}{file.path}</code>)}
                </div>
                {finding.workItems.length
                  ? <div className="model-finding-items">{finding.workItems.map(item => <button key={item.workItemId} onClick={() => onOpenItem(item.workItemId)}><strong>{item.workItemId}</strong><span>{item.title || '未命名'}</span><i className={item.requirementChanged ? 'changed' : 'stale'}>{item.requirementChanged ? '需求已更新' : '疑似过期'}</i></button>)}</div>
                  : <p className="model-finding-empty">该模块暂无关联需求——模型变化没有需求跟随，可能是覆盖缺口，也可能是残留模块。</p>}
              </div>)}
            </div>}
          </div>; })}
          {editing && <div className="model-edit" role="dialog" aria-label="模块清单编辑">
            <div className="model-edit-head">
              <label>显示名称<input value={editing.label} maxLength={120} onChange={event => setEditing({ ...editing, label: event.target.value })}/></label>
              <span title={editing.path}>{editing.path}</span>
            </div>
            {editingDraft && (editingDraft.added.length > 0 || editingDraft.removed.length > 0) && <p className="model-diff">{editingDraft.added.length > 0 && <span className="new">新增 {editingDraft.added.length}：{editingDraft.added.slice(0, 6).join('、')}{editingDraft.added.length > 6 ? '…' : ''}</span>}{editingDraft.removed.length > 0 && <span className="gone">目录中已不存在 {editingDraft.removed.length}：{editingDraft.removed.slice(0, 6).join('、')}{editingDraft.removed.length > 6 ? '…' : ''}（对应备注保留）</span>}</p>}
            <div className="model-modules">
              {editing.modules.map(module => <ModuleChoice key={module.key} module={module} added={addedKeys.has(module.key)} onSelect={selectModule} />)}
            </div>
            <div className="model-edit-actions">
              <span>库模块默认纳入追溯，测试目录默认排除。</span>
              <button className="secondary" onClick={() => { setEditing(null); setEditingDraft(null); }}>取消</button>
              <button className="primary" disabled={!!busy} onClick={() => void saveEditing()}><Check size={13}/>保存配置</button>
            </div>
          </div>}
        </div>
        <div className="model-trace">
          <div className="model-section-head">
            <strong>需求 ↔ 模块追溯{trace && !trace.stale && <span>已标注 {trace.annotated}/{trace.total} · {new Date(trace.syncedAt).toLocaleString('zh-CN')}</span>}</strong>
            <button className={coverageMode ? 'active' : ''} title="覆盖矩阵：每条需求的上游链接 / 实现模块 / 验证链接三层色块与孤立条目" aria-pressed={coverageMode} onClick={() => setCoverageMode(value => !value)}><Grid3x3 size={13}/>覆盖视图</button>
            <button disabled={syncing || !roots.length} title="AI 逐条读取未标注需求正文，自动写第一版实现模块备注；结果在会话里汇总，人工再修正" onClick={onAutolink}><Sparkles size={13}/>AI 初关联</button>
            <button disabled={syncing || !roots.length} title="同步当前文档工作项的模块备注附件，重建追溯索引" onClick={() => void syncIndex()}><RefreshCw size={13} className={syncing ? 'spin' : ''}/>{syncing ? '同步中…' : '同步需求备注'}</button>
          </div>
          {trace?.stale && roots.length > 0 && !coverageMode && <p className="model-hint">还没有同步过：点击「同步需求备注」扫描当前文档工作项的模块备注附件，构建追溯索引（默认只收当前文档，不混入其他空间的条目）。</p>}
          {coverageMode && <div className="model-coverage">
            <div className="model-coverage-bar">
              {coverage && coverage.items.length > 0 && <span>上游 {coverage.summary.withUpstream}/{coverage.items.length} · 模块 {coverage.summary.withModule}/{coverage.items.length} · 验证 {coverage.summary.withVerification}/{coverage.items.length} · 孤立 {coverage.summary.orphans}{coverage.partial ? ' · 部分分页受限' : ''} · {new Date(coverage.at).toLocaleString('zh-CN')}</span>}
              <label className="model-coverage-filter"><input type="checkbox" checked={coverageGapsOnly} onChange={event => setCoverageGapsOnly(event.target.checked)}/>只看有缺口</label>
              <button disabled={coverageBusy} onClick={() => void syncCoverage()}><RefreshCw size={12} className={coverageBusy ? 'spin' : ''}/>{coverageBusy ? '构建中…首次较慢' : coverage?.items.length ? '增量重建' : '构建覆盖索引'}</button>
            </div>
            {!coverage?.items.length && <p className="model-hint">覆盖索引还没构建：点「构建覆盖索引」逐条抓取正文摘要、双向链接与模块备注（增量，修订未变的条目秒过）。</p>}
            {coverage && coverage.items.length > 0 && <>
              <div className="model-coverage-head"><span>条目（点开直达）</span><b title="派生/引用等上游链接">上游</b><b title="实现模块备注">模块</b><b title="test/verif 角色链接">验证</b></div>
              {coverage.items
                .filter(item => !coverageGapsOnly || !item.upstream || !item.moduleCount || !item.verification)
                .slice(0, 400)
                .map(item => {
                  const expanded = expandedCoverage === item.workItemId;
                  const upstream = item.forwardLinks.filter(link => !/test|verif|valid/i.test(link.role));
                  const verification = [...item.forwardLinks, ...item.backLinks].filter(link => /test|verif|valid/i.test(link.role));
                  const downstream = item.backLinks.filter(link => !/test|verif|valid/i.test(link.role));
                  const linkCount = item.forwardLinks.length + item.backLinks.length;
                  return <div key={item.workItemId} className={'model-coverage-wrap' + (!item.upstream && !item.moduleCount && !item.verification ? ' orphan' : '')}>
                    <div className="model-coverage-line">
                      <button className="model-coverage-row model-coverage-open" title={`${item.workItemId} ${item.title}`} onClick={() => onOpenItem(item.workItemId)}>
                        <span className="label"><i className="id">{item.outline ? item.outline + ' ' : ''}{item.workItemId}</i><i className="name">{item.title || '(无标题)'}</i></span>
                        <b className={item.upstream ? 'ok' : 'miss'}>{item.upstream || '—'}</b>
                        <b className={item.moduleCount ? 'ok' : 'miss'}>{item.moduleCount || '—'}</b>
                        <b className={item.verification ? 'ok' : 'miss'}>{item.verification || '—'}</b>
                      </button>
                      {linkCount > 0 && <button className="model-coverage-links" aria-expanded={expanded} title={`查看 ${linkCount} 条链接的具体条目`} onClick={() => setExpandedCoverage(expanded ? null : item.workItemId)}>{linkCount} 链接</button>}
                    </div>
                    {expanded && <div className="model-coverage-detail">
                      {upstream.length > 0 && <div className="mc-link-row"><b>上游</b>{upstream.map(link => <button key={'u' + link.workItemId + link.role} onClick={() => onOpenItem(link.workItemId)} title={link.role}>{link.workItemId}<small>{link.role}</small></button>)}</div>}
                      {downstream.length > 0 && <div className="mc-link-row"><b>下游</b>{downstream.map(link => <button key={'d' + link.workItemId + link.role} onClick={() => onOpenItem(link.workItemId)} title={link.role}>{link.workItemId}<small>{link.role}</small></button>)}</div>}
                      {verification.length > 0 && <div className="mc-link-row"><b>验证</b>{verification.map(link => <button key={'v' + link.workItemId + link.role} onClick={() => onOpenItem(link.workItemId)} title={link.role}>{link.workItemId}<small>{link.role}</small></button>)}</div>}
                    </div>}
                  </div>;
                })}
            </>}
          </div>}
          {!coverageMode && trace && !trace.stale && <>
            {Object.entries(groupsByRoot).map(([rootId, groups]) => <div key={rootId} className="model-trace-root">
              <strong>{trace.roots.find(r => r.id === rootId)?.label ?? rootId}</strong>
              {groups.map(group => <div key={group.moduleKey} className={'model-trace-row' + (group.missing ? ' missing' : '')}>
                <button className="model-trace-module" aria-expanded={expanded === group.moduleKey} onClick={() => setExpanded(expanded === group.moduleKey ? null : group.moduleKey)}>
                  <ChevronRight size={12} className={expanded === group.moduleKey ? 'open' : ''}/>
                  <span>{group.moduleName}</span>
                  <small>{kindLabels[group.kind]}</small>
                  {staleByRoot.get(group.rootId)?.has(group.moduleKey) && <em className="model-stale" title="基准后模型侧有变化，关联需求可能过期">疑似过期</em>}
                  <b>{group.items.length}</b>
                </button>
                {expanded === group.moduleKey && <div className="model-trace-items">
                  {group.items.length ? group.items.map(item => <button key={item.workItemId} onClick={() => onOpenItem(item.workItemId)}><strong>{item.workItemId}</strong><span>{item.title || '未命名'}</span></button>) : <p className="model-muted">该模块暂无关联需求——可能是需求缺口，或相关需求尚未标注。</p>}
                </div>}
              </div>)}
            </div>)}
            <div className="model-trace-row unannotated">
              <button className="model-trace-module" aria-expanded={showUnannotated} onClick={() => setShowUnannotated(value => !value)}>
                <ChevronRight size={12} className={showUnannotated ? 'open' : ''}/><span>未标注实现模块的需求</span><b>{trace.unannotated.length}</b>
              </button>
              {showUnannotated && <div className="model-trace-items">{trace.unannotated.length ? trace.unannotated.slice(0, 200).map(item => <button key={item.workItemId} onClick={() => onOpenItem(item.workItemId)}><strong>{item.workItemId}</strong><span>{item.title || '未命名'}</span></button>) : <p className="model-muted">全部需求都已标注实现模块。</p>}</div>}
            </div>
          </>}
          {!roots.length && <p className="model-hint">绑定模型目录后，这里会展示按模块分组的需求清单、未标注需求和零需求模块（覆盖缺口）。</p>}
        </div>
      </div>
      <footer><span className="muted">备注存在各工作项自己的附件上，多人并发互不冲突；AI 会话自动获得模型路径概况，可直接说「审查 TMS_HPMode 与需求的一致性」。</span></footer>
    </section>
  </div>;
}

export const MemoizedModelWorkbench = React.memo(ModelWorkbench);
