import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, RefreshCw, Trash2, X } from 'lucide-react';
import { PROJECT_EVENT_LIMIT, type DashboardView, type SnapshotDiff, type SnapshotView, type Target, type Workset, type WorksetView } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './cockpit.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
const deltaText = (value: number | null) => value === null ? '—' : value > 0 ? `+${value}` : String(value);
const kindLabels: Record<Workset['kind'], string> = { gaps: '覆盖缺口', orphans: '孤立条目', quality: '体检有发现', search: '关键词' };
export type DashboardDestination = 'pending' | 'alerts' | 'lastQuality' | 'openReviews' | 'orphans' | 'workflows' | 'events';

function WorksetRow({ set, target, onOpenItem, onRemove }: { set: Workset; target: Target; onOpenItem: (id: string) => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<WorksetView | null>(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setResult(null); setError(''); setLimit(30);
    void rpc<WorksetView>({ method: 'worksets.items', target, id: set.id })
      .then(value => { if (active) setResult(value); })
      .catch(e => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [expanded, set.id, target]);
  return <div className="dash-ws">
    <button className="dash-ws-main" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <b>{set.name}</b><small>{kindLabels[set.kind]}{set.query ? ` ·「${set.query}」` : ''}</small>
    </button>
    <button className="icon" title="删除工作集" aria-label={`删除工作集 ${set.name}`} onClick={onRemove}><Trash2 size={13}/></button>
    {expanded && (result ? <>
      <p className="dash-ws-count">共 {result.items.length} 条</p>
      <div className="dash-ws-items">{result.items.slice(0, limit).map(item => <button key={item.workItemId} title={`${item.workItemId} ${item.title}\n${item.reason}`} onClick={() => onOpenItem(item.workItemId)}><strong>{item.workItemId}</strong><span>{item.title}</span><small>{item.reason}</small></button>)}</div>
      {result.items.length > limit && <button className="secondary" onClick={() => setLimit(n => n + 30)}>显示更多工作项（{limit}/{result.items.length}）</button>}
    </> : <p className="rp-muted" role={error ? 'alert' : 'status'}>{error || '正在读取工作集…'}</p>)}
  </div>;
}

export function DashboardPanel({ target, active, right, top, onClose, onOpenItem, onNavigate }: {
  target: Target; active: boolean; right: number; top: number; onClose: () => void; onOpenItem: (workItemId: string) => void;
  onNavigate: (destination: DashboardDestination) => void;
}) {
  const [view, setView] = useState<DashboardView | null>(null);
  const [worksets, setWorksets] = useState<Workset[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ name: string; kind: Workset['kind']; query: string }>({ name: '', kind: 'gaps', query: '' });
  const [snapshots, setSnapshots] = useState<SnapshotView[] | null>(null);
  const [snapshotDiff, setSnapshotDiff] = useState<SnapshotDiff | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const worksetHeading = useRef<HTMLHeadingElement>(null);
  const loadTicket = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++loadTicket.current;
    setError('');
    const receive = async <T,>(label: string, request: Promise<T>, apply: (value: T) => void | Promise<void>) => {
      try { const result = await request; if (ticket === loadTicket.current) await apply(result); }
      catch (e) { if (ticket === loadTicket.current) setError(previous => [previous, `${label}读取失败。${errorText(e)}`].filter(Boolean).join('\n')); }
    };
    await Promise.all([
      receive('驾驶舱指标', rpc<DashboardView>({ method: 'dashboard.view', target }), setView),
      receive('工作集', rpc<Workset[]>({ method: 'worksets.list', projectId: target.projectId }), setWorksets),
      receive('基线快照', rpc<SnapshotView[]>({ method: 'snapshots.list', projectId: target.projectId, limit: 5 }), async rows => {
        setSnapshots(rows); setSnapshotDiff(null);
        if (rows.length) {
          const diff = await rpc<SnapshotDiff>({ method: 'snapshots.diff', target });
          if (ticket === loadTicket.current) setSnapshotDiff(diff);
        }
      }),
    ]);
  }, [target]);
  const lastMetric = useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => { if (active) lastMetric.current?.focus({ preventScroll: true }); }, [active]);
  useEffect(() => { if (active) void load(); return () => { loadTicket.current++; }; }, [active, load]);
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
  const remove = async (id: string) => {
    setError('');
    try { await rpc({ method: 'worksets.delete', id }); await load(); }
    catch (e) { setError('删除失败：' + errorText(e)); }
  };
  const metric = (label: string, value: string | number, hint: string, onClick: () => void, warn = false) => <button type="button" className={'dash-metric' + (warn ? ' warn' : '')} title={hint} onClick={event => { lastMetric.current = event.currentTarget; onClick(); }}>
    <b>{value}</b><span>{label}</span>
  </button>;
  return <div className="rp-layer" style={{ right, top, '--rp-right': right + 'px' } as React.CSSProperties} role="dialog" aria-label="项目驾驶舱" onMouseDown={event => { if (event.button === 0 && event.target === event.currentTarget) { event.preventDefault(); onClose(); } }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <section className="rp-panel dash-panel">
      <header className="rp-head">
        <span className="rp-icon"><Gauge size={15}/></span>
        <div className="rp-title"><strong>驾驶舱</strong><small>{target.projectId}</small></div>
        <button className="icon" title="刷新驾驶舱" onClick={() => void load()}><RefreshCw size={14}/></button>
        <button className="icon" autoFocus title="关闭驾驶舱（Esc）" onClick={onClose}><X size={16}/></button>
      </header>
      {error && <p className="rp-error" tabIndex={0} role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}><X size={12}/></button></p>}
      <div className="rp-body" tabIndex={0}>
        <div className="dash-metrics">
          {metric('待审批提案', view?.pendingProposals ?? '…', '查看当前文档可在收件箱审批的提案', () => onNavigate('pending'), !!view?.pendingProposals)}
          {metric('守望警报', view?.alerts ?? '…', '查看项目守望警报（警告级别）', () => onNavigate('alerts'), !!view?.alerts)}
          {metric('体检发现', view ? view.quality?.findings ?? '—' : '…', '打开项目最近一次整册体检报告，含正文读取失败的条目', () => onNavigate('lastQuality'), !!view?.quality?.findings)}
          {metric('AI 预审未决', view?.reviewOpen ?? '…', '查看最近 20 次项目预审记录中的未决问题卡', () => onNavigate('openReviews'), !!view?.reviewOpen)}
          {metric('孤立条目', view ? view.coverage?.orphans ?? '—' : '…', '查看上游、实现模块和验证三项均为空的条目', () => onNavigate('orphans'), !!view?.coverage?.orphans)}
          {metric('工作流', view?.workflows ?? '…', '查看项目工作流定义', () => onNavigate('workflows'))}
          {metric('工作集', view?.worksets ?? '…', '定位到智能工作集', () => { worksetHeading.current?.focus({ preventScroll: true }); worksetHeading.current?.scrollIntoView({ block: 'start' }); })}
          {metric(`项目事件（近${PROJECT_EVENT_LIMIT}条）`, view?.events ?? '…', '打开项目事件流', () => onNavigate('events'))}
        </div>
        {view?.coverage && <p className="dash-line">覆盖：模块 {view.coverage.withModule}/{view.coverage.total} · 上游 {view.coverage.withUpstream} · 验证 {view.coverage.withVerification} · 孤立 {view.coverage.orphans}{view.briefEnabled ? ' · 每日晨报已开启' : ''}</p>}
        <div className="dash-snapshots">
          <div className="dash-ws-head">基线快照 · 拍下当前覆盖/体检/门禁，和上一次对比</div>
          <div className="dash-snap-actions">
            <button className="primary" disabled={snapshotBusy} onClick={() => void saveSnapshot()}>{snapshotBusy ? '保存中…' : '保存快照'}</button>
            {snapshotDiff?.previous && <span className="dash-snap-delta">
              较「{snapshotDiff.previous.label || new Date(snapshotDiff.previous.at).toLocaleDateString('zh-CN')}」：
              孤立 {deltaText(snapshotDiff.delta.coverageOrphans)} · 体检分 {deltaText(snapshotDiff.delta.qualityScore)} · 门禁通过 {deltaText(snapshotDiff.delta.gatesPassed)} · 未决 {deltaText(snapshotDiff.delta.openIssues)}
            </span>}
          </div>
          {snapshots && (snapshots.length ? <div className="dash-snap-list">{snapshots.map(row => <span key={row.id} title={row.label || '未命名'}>{new Date(row.at).toLocaleString('zh-CN', { hour12: false })}<b>{row.quality ? row.quality.score + '分' : '—'}</b><i>{row.coverage ? row.coverage.orphans + '孤立' : '—'}</i><em>{row.gates ? row.gates.passed + '/' + row.gates.total : '—'}</em></span>)}</div>
            : <p className="rp-muted">还没有快照。发版前、周会前各拍一张，之后就能看到趋势。</p>)}
        </div>
        <section className="dash-worksets" aria-labelledby="dashboard-worksets-heading">
          <h3 ref={worksetHeading} id="dashboard-worksets-heading" tabIndex={-1} className="dash-ws-head">智能工作集</h3>
          <div className="dash-ws-form">
            <select aria-label="工作集类型" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value as Workset['kind'] }))}>
              {Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
            {form.kind === 'search' && <input aria-label="关键词" placeholder="信号名/关键词…" value={form.query} maxLength={200} onChange={event => setForm(current => ({ ...current, query: event.target.value }))}/>}
            <input aria-label="工作集名称" placeholder="名称（默认按类型）" value={form.name} maxLength={60} onChange={event => setForm(current => ({ ...current, name: event.target.value }))}/>
            <button className="primary" disabled={form.kind === 'search' && !form.query.trim()} onClick={() => void save()}>保存</button>
          </div>
          {worksets?.map(set => <WorksetRow key={set.id} set={set} target={target} onOpenItem={onOpenItem} onRemove={() => void remove(set.id)}/>)}
          {worksets && !worksets.length && <p className="rp-muted">还没有工作集。可保存一个「覆盖缺口」工作集，查看最新的待办条目。</p>}
        </section>
      </div>
      <footer>覆盖缺口、孤立条目和关键词工作集查询当前索引。体检工作集读取项目最近保存的整册报告。</footer>
    </section>
  </div>;
}
