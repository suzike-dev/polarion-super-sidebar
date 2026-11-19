import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, Trash2, X } from 'lucide-react';
import type { DashboardView, SnapshotDiff, SnapshotView, Target, Workset, WorksetView } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './cockpit.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
/** 快照增量文案：0 显示 —，正负带符号；higherIsBetter 由调用方通过 sign 表达。 */
function deltaText(value: number | null, positiveSign: string) {
  if (value === null) return '—';
  if (value === 0) return '0';
  return (value > 0 ? positiveSign : '') + value;
}
const kindLabels: Record<Workset['kind'], string> = { gaps: '覆盖缺口', orphans: '孤立条目', quality: '体检有发现', search: '关键词' };

/**
 * v0.17 驾驶舱：一页看全项目状态，数字点得动——待提案进收件箱、警报进模型台、体检进总览；
 * 内嵌智能工作集（保存的动态查询 = 活队列，索引刷新自动变新）。
 */
export function DashboardPanel({ target, right, top, onClose, onOpenItem, onOpenInbox, onOpenModel, onOpenQuality, onOpenWorkflows }: {
  target: Target; right: number; top: number; onClose: () => void; onOpenItem: (workItemId: string) => void;
  onOpenInbox: () => void; onOpenModel: () => void; onOpenQuality: () => void; onOpenWorkflows: () => void;
}) {
  const [view, setView] = useState<DashboardView | null>(null);
  const [worksets, setWorksets] = useState<Workset[]>([]);
  const [items, setItems] = useState<Record<string, WorksetView | string>>({});
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ name: string; kind: Workset['kind']; query: string }>({ name: '', kind: 'gaps', query: '' });
  const [snapshots, setSnapshots] = useState<SnapshotView[]>([]);
  const [snapshotDiff, setSnapshotDiff] = useState<SnapshotDiff | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const [dashboard, sets, snaps] = await Promise.all([
        rpc<DashboardView>({ method: 'dashboard.view', target }),
        rpc<Workset[]>({ method: 'worksets.list', projectId: target.projectId }),
        rpc<SnapshotView[]>({ method: 'snapshots.list', projectId: target.projectId, limit: 8 }),
      ]);
      setView(dashboard); setWorksets(sets); setSnapshots(snaps);
      setSnapshotDiff(snaps.length ? await rpc<SnapshotDiff>({ method: 'snapshots.diff', target }).catch(() => null) : null);
    } catch (e) { setError(errorText(e)); }
  }, [target]);
  useEffect(() => { void load(); }, [load]);
  const saveSnapshot = async () => {
    if (snapshotBusy) return;
    setSnapshotBusy(true); setError('');
    try { await rpc({ method: 'snapshots.save', target, label: '' }); await load(); }
    catch (e) { setError('保存快照失败：' + errorText(e)); }
    finally { setSnapshotBusy(false); }
  };
  const save = async () => {
    setError('');
    try {
      await rpc({ method: 'worksets.save', target, name: form.name.trim() || kindLabels[form.kind], kind: form.kind, query: form.query.trim() });
      setForm({ name: '', kind: 'gaps', query: '' });
      await load();
    } catch (e) { setError('保存失败：' + errorText(e)); }
  };
  const openItems = async (id: string) => {
    setError('');
    setItems(current => ({ ...current, [id]: '加载中…' }));
    try { const value = await rpc<WorksetView>({ method: 'worksets.items', target, id }); setItems(current => ({ ...current, [id]: value })); }
    catch (e) { setItems(current => ({ ...current, [id]: errorText(e) })); }
  };
  const remove = async (id: string) => {
    setError('');
    try { await rpc({ method: 'worksets.delete', id }); await load(); setItems(current => { const next = { ...current }; delete next[id]; return next; }); }
    catch (e) { setError('删除失败：' + errorText(e)); }
  };
  const metric = (label: string, value: string | number, hint: string, onClick?: () => void, tone?: 'warn' | 'ok') => <button className={'dash-metric' + (tone ? ' ' + tone : '')} disabled={!onClick} title={hint} onClick={onClick}>
    <b>{value}</b><span>{label}</span>
  </button>;
  return <div className="rp-layer" style={{ right, top }} role="dialog" aria-label="项目驾驶舱" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="rp-panel dash-panel">
      <header className="rp-head">
        <span className="rp-icon"><Gauge size={15}/></span>
        <div className="rp-title"><strong>驾驶舱</strong><small>{target.projectId} · 看数→干活不换页</small></div>
        <button className="icon" title="刷新" onClick={() => void load()}><RefreshCw size={14}/></button>
        <button className="icon" title="关闭（Esc）" onClick={onClose}><X size={16}/></button>
      </header>
      {error && <p className="rp-error" role="alert">{error}<button onClick={() => setError('')}><X size={12}/></button></p>}
      <div className="rp-body">
        <div className="dash-metrics">
          {metric('待审批提案', view?.pendingProposals ?? '…', '打开收件箱', onOpenInbox, (view?.pendingProposals ?? 0) > 0 ? 'warn' : undefined)}
          {metric('守望警报', view?.alerts ?? '…', '打开模型工作台巡检', onOpenModel, (view?.alerts ?? 0) > 0 ? 'warn' : undefined)}
          {metric('体检发现', view?.quality ? `${view.quality.findings}` : '—', '打开总览体检报告', onOpenQuality, (view?.quality?.findings ?? 0) > 0 ? 'warn' : undefined)}
          {metric('门禁/评审未决', view?.reviewOpen ?? '…', '发起或处置 AI 预审', onOpenQuality)}
          {metric('孤立条目', view?.coverage ? `${view.coverage.orphans}` : '—', '打开模型覆盖视图', onOpenModel, (view?.coverage?.orphans ?? 0) > 0 ? 'warn' : undefined)}
          {metric('工作流', view?.workflows ?? '…', '管理工作流', onOpenWorkflows)}
          {metric('工作集', view?.worksets ?? '…', '下方管理智能工作集')}
          {metric('事件(近500)', view?.events ?? '…', '收件箱动态页查看', onOpenInbox)}
        </div>
        {view?.coverage && <p className="dash-line">覆盖：模块 {view.coverage.withModule}/{view.coverage.total} · 上游 {view.coverage.withUpstream} · 验证 {view.coverage.withVerification} · 孤立 {view.coverage.orphans}{view.briefEnabled ? ' · 每日晨报已开启' : ''}</p>}
        <div className="dash-snapshots">
          <div className="dash-ws-head">基线快照 · 拍下当前覆盖/体检/门禁，和上一次对比</div>
          <div className="dash-snap-actions">
            <button className="primary" disabled={snapshotBusy} onClick={() => void saveSnapshot()}>{snapshotBusy ? '保存中…' : '保存快照'}</button>
            {snapshotDiff?.previous && <span className="dash-snap-delta">
              较「{snapshotDiff.previous.label || new Date(snapshotDiff.previous.at).toLocaleDateString('zh-CN')}」：
              孤立 {deltaText(snapshotDiff.delta.coverageOrphans, '↓')} · 体检分 {deltaText(snapshotDiff.delta.qualityScore, '+')} · 门禁通过 {deltaText(snapshotDiff.delta.gatesPassed, '+')} · 未决 {deltaText(snapshotDiff.delta.openIssues, '+')}
            </span>}
          </div>
          {snapshots.length ? <div className="dash-snap-list">{snapshots.slice(0, 5).map(row => <span key={row.id} title={row.label || '未命名'}>{new Date(row.at).toLocaleString('zh-CN', { hour12: false })}<b>{row.quality ? row.quality.score + '分' : '—'}</b><i>{row.coverage ? row.coverage.orphans + '孤立' : '—'}</i><em>{row.gates ? row.gates.passed + '/' + row.gates.total : '—'}</em></span>)}</div>
            : <p className="rp-muted">还没有快照。发版前、周会前各拍一张，之后就能看到趋势。</p>}
        </div>
                <div className="dash-worksets">
          <div className="dash-ws-head">智能工作集 · 动态查询活队列（索引刷新自动变新）</div>
          <div className="dash-ws-form">
            <select aria-label="工作集类型" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as Workset['kind'] }))}>
              {Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
            {form.kind === 'search' && <input aria-label="关键词" placeholder="信号名/关键词…" value={form.query} maxLength={200} onChange={event => setForm(current => ({ ...current, query: event.target.value }))}/>}
            <input aria-label="工作集名称" placeholder="名称（默认按类型）" value={form.name} maxLength={60} onChange={event => setForm(current => ({ ...current, name: event.target.value }))}/>
            <button className="primary" onClick={() => void save()}>保存</button>
          </div>
          {worksets.map(set => <div className="dash-ws" key={set.id}>
            <button className="dash-ws-main" onClick={() => void openItems(set.id)}>
              <b>{set.name}</b><small>{kindLabels[set.kind]}{set.query ? ` ·「${set.query}」` : ''}</small>
            </button>
            <button className="icon" title="删除工作集" onClick={() => void remove(set.id)}><Trash2 size={13}/></button>
            {items[set.id] !== undefined && (typeof items[set.id] === 'string'
              ? <p className="rp-muted">{items[set.id] as string}</p>
              : <>
                  <p className="dash-ws-count">{(items[set.id] as WorksetView).items.length} 条 · 点击直达</p>
                  <div className="dash-ws-items">{(items[set.id] as WorksetView).items.slice(0, 30).map(item => <button key={item.workItemId} onClick={() => onOpenItem(item.workItemId)}><strong>{item.workItemId}</strong><span>{item.title}</span><small>{item.reason}</small></button>)}</div>
                </>)}
          </div>)}
          {!worksets.length && <p className="rp-muted">还没有工作集。常见用法：存一个「覆盖缺口」集当待办，每天打开处理到空。</p>}
        </div>
      </div>
      <footer>数字来自提案/事件/体检/覆盖索引的实时聚合；工作集条目每次打开现算。</footer>
    </section>
  </div>;
}
