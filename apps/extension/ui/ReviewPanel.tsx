import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import type { ReviewRecordView, Target } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './cockpit.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
const severityLabels: Record<string, string> = { blocker: '阻断', major: '重要', minor: '建议' };

/**
 * v0.16 AI 预审评审台：发起预审（会话产出结构化问题卡）→ 逐条处置（解决/忽略/打开条目）→ 发飞书汇总。
 */
export function ReviewPanel({ target, right, top, onClose, onOpenItem, onStart, onApply, starting }: {
  target: Target; right: number; top: number; onClose: () => void; onOpenItem: (workItemId: string) => void; onStart: () => void;
  /** 把评审建议交给当前会话执行（AI 按建议改写对应条目）。 */
  onApply: (workItemId: string | undefined, summary: string, suggestion: string) => void; starting: boolean;
}) {
  const [records, setRecords] = useState<ReviewRecordView[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const load = useCallback(async () => {
    setError('');
    try { setRecords(await rpc<ReviewRecordView[]>({ method: 'review.list', target })); }
    catch (e) { setError(errorText(e)); }
  }, [target]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!records?.some(record => record.status === 'running')) return;
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [records, load]);
  const decide = async (recordId: string, issueId: string, decision: 'resolved' | 'ignored') => {
    if (busy) return;
    setBusy(issueId); setError('');
    try { await rpc({ method: 'review.decide', id: recordId, issueId, decision }); await load(); }
    catch (e) { setError('处置失败：' + errorText(e)); }
    finally { setBusy(''); }
  };
  const share = async (recordId: string) => {
    if (busy) return;
    setBusy('share:' + recordId); setError('');
    try {
      const result = await rpc<{ results: { ok: boolean }[]; sent: number }>({ method: 'review.share', id: recordId, target });
      setError(result.results.some(row => row.ok) ? `已发送汇总卡（未决 ${result.sent} 条）到飞书群。` : '发送失败：见动态页事件流。');
    } catch (e) { setError('发送失败：' + errorText(e)); }
    finally { setBusy(''); }
  };
  const statusLabels: Record<string, string> = { running: '预审中…', open: '待处置', done: '已完成', failed: '失败' };
  return <div className="rp-layer" style={{ right, top }} role="dialog" aria-label="AI 预审评审台" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="rp-panel">
      <header className="rp-head">
        <span className="rp-icon"><ShieldCheck size={15}/></span>
        <div className="rp-title"><strong>AI 预审评审</strong><small>{target.projectId} · 会话预审产出问题卡，人工逐条处置</small></div>
        <button className="primary" disabled={starting} title="当前会话对整册做一轮结构化预审" onClick={onStart}>{starting ? '发起中…' : '发起 AI 预审'}</button>
        <button className="icon" title="刷新" onClick={() => void load()}><RefreshCw size={14}/></button>
        <button className="icon" title="关闭（Esc）" onClick={onClose}><X size={16}/></button>
      </header>
      {error && <p className="rp-error" role={error.includes('已发送') ? 'status' : 'alert'}>{error}<button onClick={() => setError('')}><X size={12}/></button></p>}
      <div className="rp-body">
        {!records && <p className="rp-muted">正在读取评审记录…</p>}
        {records && !records.length && <p className="rp-muted">还没有评审过。点「发起 AI 预审」，当前会话会逐条读需求并产出问题卡。</p>}
        {records?.map(record => {
          const open = record.issues.filter(issue => issue.status === 'open');
          return <div className="rp-record" key={record.id}>
            <div className="rp-record-head">
              <b>{new Date(record.at).toLocaleString('zh-CN', { hour12: false })}</b>
              <span className={'rp-status ' + record.status}>{statusLabels[record.status]}{record.status === 'open' ? ` · 未决 ${open.length}` : ''}</span>
              {record.error && <small>{record.error}</small>}
              {open.length > 0 && <button className="secondary" disabled={!!busy} title="把未决问题汇总发到项目飞书群" onClick={() => void share(record.id)}><Send size={12}/>发汇总</button>}
            </div>
            {record.issues.map(issue => <div className={'rp-issue ' + issue.severity + ' ' + issue.status} key={issue.id}>
              <div className="rp-issue-main">
                <i className="sev">{severityLabels[issue.severity]}</i>
                {issue.workItemId && <button className="rp-item" title="打开工作项" onClick={() => onOpenItem(issue.workItemId!)}>{issue.workItemId}</button>}
                <span className="loc">{issue.location}</span>
                <span className="summary">{issue.summary}</span>
              </div>
              {issue.suggestion && <p className="rp-suggest">建议：{issue.suggestion}</p>}
              {issue.status === 'open'
                ? <div className="rp-issue-actions">
                    {issue.suggestion && <button className="rp-apply" title="交给当前会话按建议改写该条目，改完人工审阅保存" onClick={() => onApply(issue.workItemId, issue.summary, issue.suggestion!)}>AI 按建议改</button>}
                    <button className="secondary" disabled={busy === issue.id} onClick={() => void decide(record.id, issue.id, 'resolved')}>已解决</button>
                    <button className="secondary" disabled={busy === issue.id} onClick={() => void decide(record.id, issue.id, 'ignored')}>忽略</button>
                  </div>
                : <span className="rp-settled">{issue.status === 'resolved' ? '✓ 已解决' : '— 已忽略'}</span>}
            </div>)}
            {record.status === 'running' && <p className="rp-muted">预审运行中，完成后自动刷新（约几十秒）。</p>}
          </div>;
        })}
      </div>
      <footer>问题卡由会话 Agent 结构化产出；处置记录留档，飞书汇总只发未决项。</footer>
    </section>
  </div>;
}
