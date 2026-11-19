import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { openReviewIssues, projectDocumentUrl, type ReviewRecordView, type Target } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './cockpit.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
const severityLabels: Record<string, string> = { blocker: '阻断', major: '重要', minor: '建议' };

/**
 * v0.16 AI 预审评审台：发起预审（会话产出结构化问题卡）→ 逐条处置（解决/忽略/打开条目）→ 发飞书汇总。
 */
export function ReviewPanel({ target, right, top, initialOpenOnly = false, onClose, onOpenItem, onStart, onApply, starting }: {
  target: Target; right: number; top: number; initialOpenOnly?: boolean; onClose: () => void; onOpenItem: (workItemId: string) => void; onStart: () => Promise<void>;
  /** 把评审建议交给当前会话执行（AI 按建议改写对应条目）。 */
  onApply: (workItemId: string, summary: string, suggestion: string) => Promise<void>; starting: boolean;
}) {
  const [records, setRecords] = useState<ReviewRecordView[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [openOnly, setOpenOnly] = useState(initialOpenOnly);
  const loadTicket = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  React.useLayoutEffect(() => {
    const button = closeButton.current!;
    const root = button.getRootNode() as Document | ShadowRoot;
    const previous = root.activeElement;
    button.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected && !previous.closest('[hidden]')) previous.focus({ preventScroll: true }); };
  }, []);
  const load = useCallback(async () => {
    const ticket = ++loadTicket.current;
    try { const value = await rpc<ReviewRecordView[]>({ method: 'review.list', target }); if (ticket === loadTicket.current) setRecords(value); }
    catch (e) { if (ticket === loadTicket.current) setError(errorText(e)); }
  }, [target]);
  useEffect(() => { void load(); return () => { loadTicket.current++; }; }, [load]);
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
  const openCount = records?.reduce((count, record) => count + openReviewIssues(record).length, 0);
  return <div className="rp-layer" style={{ right, top, '--rp-right': right + 'px' } as React.CSSProperties} role="dialog" aria-label="AI 预审评审台" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }} onMouseDown={event => { if (event.button === 0 && event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <section className="rp-panel">
      <header className="rp-head">
        <span className="rp-icon"><ShieldCheck size={15}/></span>
        <div className="rp-title"><strong>AI 预审评审</strong><small>{target.projectId} · 会话预审产出问题卡，人工逐条处置</small></div>
        <button className="primary" disabled={starting} title="当前会话对整册做一轮结构化预审" onClick={async () => { setError(''); try { await onStart(); setOpenOnly(false); await load(); } catch (cause) { setError('发起预审失败。' + errorText(cause)); } }}>{starting ? '发起中…' : '发起 AI 预审'}</button>
        <button className="icon" title="刷新" onClick={() => { setError(''); void load(); }}><RefreshCw size={14}/></button>
        <button ref={closeButton} className="icon" title="关闭评审台（Esc）" onClick={onClose}><X size={16}/></button>
      </header>
      {error && <p className="rp-error" tabIndex={0} role={error.includes('已发送') ? 'status' : 'alert'}>{error}<button aria-label="关闭提示" onClick={() => setError('')}><X size={12}/></button></p>}
      <div className="rp-body" tabIndex={0}>
        <label className="rp-muted"><input type="checkbox" checked={openOnly} onChange={event => setOpenOnly(event.target.checked)}/>只看未决问题{openCount !== undefined && `（${openCount}）`}</label>
        {!records && !error && <p className="rp-muted">正在读取评审记录…</p>}
        {openOnly && openCount === 0 && <p className="rp-muted">本项目最近 20 次预审记录中没有未决问题。</p>}
        {!openOnly && records && !records.length && <p className="rp-muted">还没有评审过。点「发起 AI 预审」，当前会话会逐条读需求并产出问题卡。</p>}
        {records?.map(record => {
          const open = openReviewIssues(record);
          if (openOnly && !open.length) return null;
          const currentDocument = record.document === target.document;
          return <div className="rp-record" key={record.id}>
            <div className="rp-record-head">
              <b>{new Date(record.at).toLocaleString('zh-CN', { hour12: false })}</b>
              <span className={'rp-status ' + record.status}>{statusLabels[record.status]}{record.status === 'open' ? ` · 未决 ${open.length}` : ''}</span>
              {record.document && <a href={projectDocumentUrl(target, record.document)} target="_blank" rel="noreferrer">{record.document}</a>}
              {record.error && <small>{record.error}</small>}
              {open.length > 0 && <button className="secondary" disabled={!!busy} title="把未决问题汇总发到项目飞书群" onClick={() => void share(record.id)}><Send size={12}/>发汇总</button>}
            </div>
            {(openOnly ? open : record.issues).map(issue => <div className={'rp-issue ' + issue.severity + ' ' + issue.status} key={issue.id}>
              <div className="rp-issue-main">
                <i className="sev">{severityLabels[issue.severity]}</i>
                {issue.workItemId && <button className="rp-item" title="打开阅读预览" onClick={() => onOpenItem(issue.workItemId!)}>{issue.workItemId}</button>}
                <span className="loc">{issue.location}</span>
                <span className="summary">{issue.summary}</span>
              </div>
              {issue.suggestion && <p className="rp-suggest">建议：{issue.suggestion}</p>}
              {record.status === 'open' && issue.status === 'open'
                ? <div className="rp-issue-actions">
                    {currentDocument && issue.workItemId && issue.suggestion && <button className="rp-apply" disabled={!!busy} title="交给当前会话按建议改写该条目，改完人工审阅保存" onClick={async () => {
                      setBusy(issue.id); setError('');
                      try { await onApply(issue.workItemId!, issue.summary, issue.suggestion!); }
                      catch (cause) { setError(`提交 ${issue.workItemId} 改写失败。${errorText(cause)}`); }
                      finally { setBusy(''); }
                    }}>AI 按建议改</button>}
                    <button className="secondary" disabled={busy === issue.id} onClick={() => void decide(record.id, issue.id, 'resolved')}>已解决</button>
                    <button className="secondary" disabled={busy === issue.id} onClick={() => void decide(record.id, issue.id, 'ignored')}>忽略</button>
                  </div>
                : <span className="rp-settled">{issue.status === 'resolved' ? '✓ 已解决' : issue.status === 'ignored' ? '— 已忽略' : '记录已关闭'}</span>}
            </div>)}
            {record.status === 'running' && <p className="rp-muted">预审运行中，完成后自动刷新（约几十秒）。</p>}
          </div>;
        })}
      </div>
      <footer>问题卡由会话 Agent 结构化产出；处置记录留档，飞书汇总只发未决项。</footer>
    </section>
  </div>;
}
