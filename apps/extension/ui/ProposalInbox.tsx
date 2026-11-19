import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Inbox, RefreshCw, Sparkles, X } from 'lucide-react';
import { PROJECT_EVENT_LIMIT, isInboxPendingProposal, projectDocumentUrl, type BriefView, type MeetingAction, type MeetingRecordView, type Proposal, type Target, type TimelineView, type WatchView, type WorkEvent } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './proposal-inbox.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
const sourceLabels: Record<Proposal['source'], string> = { agent: '助手', lint: '体检', workflow: '工作流', manual: '手动' };
const statusLabels: Record<Proposal['status'], string> = { pending: '待审批', approved: '已批准', applied: '已应用', rejected: '已拒绝', failed: '失败' };
const kindLabels: Record<WorkEvent['kind'], string> = { save: '保存', note: '备注', check: '基准', proposal: '提案', lint: '体检', watcher: '巡检', brief: '晨报' };

/**
 * 统一收件箱（S2 + S3）：待审批（提案）/ 动态与警报（守望者 + 事件流 + 晨报 + 会议分诊 + 问 AI）/ 时间线。
 */
export type InboxView = 'pending' | 'actionable' | 'feed' | 'alerts' | 'events' | 'meeting' | 'timeline';
export function ProposalInbox({ target, right, top, initialTab = 'pending', timelineItemId, onClose, onOpenItem, onAskAi }: {
  target: Target; right: number; top: number; initialTab?: InboxView; timelineItemId?: string;
  onClose: () => void; onOpenItem: (workItemId: string) => void; onAskAi: (prompt: string, action?: MeetingAction) => Promise<void>;
}) {
  const [view, setView] = useState(initialTab);
  const tab = view === 'actionable' || view === 'pending' ? 'pending' : view === 'timeline' ? 'timeline' : 'feed';
  const [historyLimit, setHistoryLimit] = useState(50);
  const [eventLimit, setEventLimit] = useState(60);
  const loadTicket = useRef(0);
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [watch, setWatch] = useState<WatchView | null>(null);
  const [loadedEvents, setLoadedEvents] = useState<WorkEvent[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineView | null>(null);
  const [meetings, setMeetings] = useState<MeetingRecordView[] | null>(null);
  const [meetingText, setMeetingText] = useState('');
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [submittedAction, setSubmittedAction] = useState('');
  const meetingTicket = useRef(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [brief, setBrief] = useState<{ digest: string; sent?: boolean; reason?: string } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const timelineFilter = tab === 'timeline' ? timelineItemId : undefined;
  const eventWindow = view === 'events' ? PROJECT_EVENT_LIMIT : 60;
  const events = loadedEvents && loadedEvents.length > eventWindow ? loadedEvents.slice(0, eventWindow) : loadedEvents;
  const showMeetings = view === 'meeting' || view === 'feed';
  const readMeetings = useCallback(async () => {
    const ticket = ++meetingTicket.current;
    try {
      const records = await rpc<MeetingRecordView[]>({ method: 'meeting.list', target });
      if (ticket === meetingTicket.current) setMeetings(records);
    } catch (cause) { if (ticket === meetingTicket.current) setError(errorText(cause)); }
  }, [target]);
  const load = useCallback(async () => {
    const ticket = ++loadTicket.current;
    setError('');
    const receive = async <T,>(request: Promise<T>, update: (value: T) => void) => {
      try { const value = await request; if (ticket === loadTicket.current) update(value); }
      catch (e) { if (ticket === loadTicket.current) setError(errorText(e)); }
    };
    const jobs: Promise<void>[] = [];
    if (view === 'pending' || view === 'actionable') jobs.push(receive(rpc<Proposal[]>({ method: 'proposals.list', target }), setRows));
    if (view === 'feed' || view === 'alerts') jobs.push(receive(rpc<WatchView>({ method: 'watch.view', target }), setWatch));
    if (view === 'feed' || view === 'events') jobs.push(receive(rpc<WorkEvent[]>({ method: 'events.list', projectId: target.projectId, limit: eventWindow }), setLoadedEvents));
    if (showMeetings) jobs.push(readMeetings());
    if (view === 'timeline') jobs.push(receive(rpc<TimelineView>({ method: 'timeline.view', target, workItemId: timelineFilter }), setTimeline));
    await Promise.all(jobs);
  }, [target, timelineFilter, view, eventWindow, showMeetings, readMeetings]);
  useEffect(() => { void load(); return () => { loadTicket.current++; meetingTicket.current++; }; }, [load]);
  const pollingMeetings = showMeetings && meetings?.some(meeting => meeting.status === 'running');
  useEffect(() => {
    if (!pollingMeetings) return;
    let stopped = false;
    const poll = async () => {
      await readMeetings();
      if (!stopped) timer = window.setTimeout(poll, 3000);
    };
    let timer = window.setTimeout(poll, 3000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [pollingMeetings, readMeetings]);
  const decide = async (proposal: Proposal, allow: boolean) => {
    if (busy) return;
    setBusy(proposal.id); setError('');
    try {
      if (allow) await rpc({ method: 'proposals.approve', id: proposal.id });
      else await rpc({ method: 'proposals.reject', id: proposal.id });
      await load();
    } catch (e) {
      const message = errorText(e);
      await load();
      setError(/NATIVE_EDITOR|REMOTE_CONFLICT|STALE_DRAFT|PROPOSAL_TARGET_MISMATCH/.test(message)
        ? `「${proposal.workItemId ?? proposal.summary}」需要在编辑工作台处理：${message}`
        : '处理失败：' + message);
    } finally { setBusy(''); }
  };
  const toggleBrief = async () => {
    if (!watch || briefBusy) return;
    setBriefBusy(true); setError('');
    try { const next = await rpc<WatchView['brief']>({ method: 'brief.toggle', target, enabled: !watch.brief.enabled }); setWatch({ ...watch, brief: next }); }
    catch (e) { setError('晨报开关失败：' + errorText(e)); }
    finally { setBriefBusy(false); }
  };
  const runBrief = async (send: boolean) => {
    setBriefBusy(true); setError('');
    try {
      const view = await rpc<BriefView>({ method: send ? 'brief.send' : 'brief.preview', target });
      setBrief({ digest: view.digest, sent: view.sent, reason: view.reason });
      if (send) await load();
    } catch (e) { setError((send ? '发送晨报失败：' : '生成晨报失败：') + errorText(e)); }
    finally { setBriefBusy(false); }
  };
  const startMeeting = async () => {
    if (!meetingText.trim() || meetingBusy) return;
    setMeetingBusy(true); setError('');
    try {
      // 分诊使用自己的会话，动作卡由用户逐项派发。
      const session = await rpc<{ id: string }>({ method: 'sessions.create', target, title: '会议分诊' });
      await rpc({ method: 'meeting.triage', sessionId: session.id, target, contexts: [], permissionMode: 'auto', text: meetingText.trim() });
      setMeetingText('');
      await readMeetings();
      window.dispatchEvent(new Event('polarion-sidebar-run-started'));
    } catch (e) { setError('会议分诊发起失败：' + errorText(e)); }
    finally { setMeetingBusy(false); }
  };
  const dispatchMeeting = async (action: MeetingAction) => {
    if (busy) return;
    setBusy(action.id); setError(''); setSubmittedAction('');
    try {
      await onAskAi(action.workItemId ? `${action.workItemId}：${action.title}` : action.title, action);
      setSubmittedAction(action.id);
    } catch (cause) { setError('派发动作失败：' + errorText(cause)); }
    finally { setBusy(''); }
  };
  const decideMeeting = async (id: string, actionId: string, decision: 'done' | 'open') => {
    if (busy) return;
    setBusy(actionId); setError('');
    try { await rpc({ method: 'meeting.decide', id, actionId, decision }); await readMeetings(); }
    catch (e) { setError('处置失败：' + errorText(e)); }
    finally { setBusy(''); }
  };
  const pending = (rows ?? []).filter(row => view === 'actionable' ? isInboxPendingProposal(row) : row.status === 'pending');
  const alerts = watch?.alerts.filter(alert => view !== 'alerts' || alert.level === 'warn');
  const engineOwned = (row: Proposal) => row.op.kind === 'tool' || row.op.kind === 'gate';
  const history = (rows ?? []).filter(row => row.status !== 'pending');
  const renderRow = (row: Proposal) => {
    const detail = expanded === row.id;
    return <div className={'pi-row' + (row.status === 'pending' ? '' : ' settled') + (engineOwned(row) ? ' engine' : '')} key={row.id}>
      <div className="pi-line">
        <span className={'pi-source ' + row.source}>{sourceLabels[row.source]}</span>
        {row.workItemId ? <button className="pi-item" title="打开工作项" onClick={() => onOpenItem(row.workItemId!)}>{row.workItemId}</button> : <span className="pi-item none">（无工作项）</span>}
        <span className="pi-summary" title={row.summary}>{row.summary}</span>
        {row.matchCount !== undefined && row.matchCount > 1 && <span className="pi-count">×{row.matchCount}</span>}
        <span className="pi-time">{new Date(row.createdAt).toLocaleTimeString('zh-CN')}</span>
        {row.status !== 'pending' && <span className={'pi-status ' + row.status}>{statusLabels[row.status]}</span>}
      </div>
      {row.error && <details><summary>处理错误</summary><p className="pi-muted">{row.error}</p></details>}
      {row.status !== 'pending' && row.diffPreview && <button className="secondary" aria-expanded={detail} onClick={() => setExpanded(detail ? null : row.id)}>{detail ? '收起差异' : '查看差异'}</button>}
      {row.status === 'pending' && <div className="pi-actions">
        {engineOwned(row)
          ? <span className="pi-engine-note">{row.op.kind === 'gate' ? '工作流暂停门：在会话上方继续/终止' : '工具写入提案：随所属任务审批'}</span>
          : <>
            {row.diffPreview && <button className="secondary" aria-expanded={detail} disabled={busy === row.id} onClick={() => setExpanded(detail ? null : row.id)}>{detail ? '收起差异' : '查看差异'}<ChevronRight size={12} className={detail ? 'open' : ''}/></button>}
            <button className="secondary" disabled={busy === row.id} onClick={() => void decide(row, false)}>拒绝</button>
            <button className="primary" disabled={busy === row.id} onClick={() => void decide(row, true)}>批准并应用</button>
          </>}
      </div>}
      {detail && row.diffPreview && <div className="pi-diff">{(['before', 'after'] as const).map(side => <section key={side}>
        <b>{side === 'before' ? '改前' : '改后'}</b>
        <p>{row.diffPreview![side].map((segment, i) => segment.kind === 'del' ? <del key={i}>{segment.text}</del> : segment.kind === 'ins' ? <ins key={i}>{segment.text}</ins> : segment.text)}</p>
      </section>)}</div>}
    </div>;
  };
  return <div className="pi-layer" style={{ right, top, '--pi-right': right + 'px' } as React.CSSProperties} role="dialog" aria-label="统一收件箱" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }} onMouseDown={event => { if (event.button === 0 && event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <section className="pi-panel">
      <header className="pi-head">
        <span className="pi-icon"><Inbox size={15}/></span>
        <div className="pi-title"><strong>统一收件箱</strong><small>{target.projectId} · 提案审批 · 守望警报 · 时间线</small></div>
        <div className="pi-tabs" role="tablist" aria-label="收件箱视图">
          <button role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'selected' : ''} onClick={() => setView('pending')}>待审批{pending.length ? ` ${pending.length}` : ''}</button>
          <button role="tab" aria-selected={tab === 'feed'} className={tab === 'feed' ? 'selected' : ''} onClick={() => setView('feed')}>动态与警报</button>
          <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'selected' : ''} onClick={() => setView('timeline')}>时间线</button>
        </div>
        <button className="icon" title="重新读取" onClick={() => void load()}><RefreshCw size={14}/></button>
        <button autoFocus className="icon" title="关闭收件箱（Esc）" onClick={onClose}><X size={16}/></button>
      </header>
      {error && <p className="pi-error" tabIndex={0} role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}><X size={12}/></button></p>}
      {tab === 'pending' && <div className="pi-body" tabIndex={0}>
        {view === 'actionable' && <div className="pi-feed-head">当前文档 · 可在收件箱审批 {rows && `· ${pending.length} 条`} <button className="secondary" onClick={() => setView('pending')}>查看全部提案</button></div>}
        {!rows && !error && <p className="pi-muted">正在读取提案…</p>}
        {rows && !pending.length && <p className="pi-muted ok">没有待审批的提案。</p>}
        {pending.map(renderRow)}
        {view === 'pending' && rows && history.length > 0 && <>
          <button className="pi-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <ChevronRight size={12} className={showHistory ? 'open' : ''}/>处理记录 {history.length} 条
          </button>
          {showHistory && history.slice(0, historyLimit).map(renderRow)}
          {showHistory && historyLimit < history.length && <button className="secondary" onClick={() => setHistoryLimit(n => n + 50)}>显示更多处理记录（{historyLimit}/{history.length}）</button>}
        </>}
      </div>}
      {tab === 'feed' && <div className="pi-body" tabIndex={0}>
        {view !== 'feed' && <button className="secondary" onClick={() => setView('feed')}>查看全部动态与警报</button>}
        {(view === 'feed' || view === 'alerts') && <>
        <div className="pi-feed-head">守望警报{view === 'alerts' && ` · 仅警告${alerts ? ` · ${alerts.length} 条` : ''}`}</div>
        {!watch && !error && <p className="pi-muted">正在读取警报…</p>}
        {alerts?.length === 0 && <p className="pi-muted">没有警告级别的守望警报。</p>}
        {alerts?.map((alert, index) => <div className={'pi-alert ' + alert.level} key={index}>
          <b>{alert.level === 'warn' ? '⚠' : 'ℹ'} {alert.title}</b>
          <small>{alert.detail}{alert.at ? ` · 数据截至 ${new Date(alert.at).toLocaleString('zh-CN')}` : ''}</small>
        </div>)}
        </>}
        {view === 'feed' && <>
        <div className="pi-feed-head">晨报</div>
        <div className="pi-brief">
          <label className="pi-brief-toggle"><input type="checkbox" checked={!!watch?.brief.enabled} disabled={briefBusy} onChange={() => void toggleBrief()}/>每日 {watch?.brief.at ?? '07:30'} 自动体检+巡检并发卡</label>
          <button className="secondary" disabled={briefBusy} onClick={() => void runBrief(false)}><Sparkles size={12}/>预览晨报</button>
          <button className="secondary" disabled={briefBusy} onClick={() => void runBrief(true)} title="发送到项目飞书群（PSB-FEISHU 配置的群）">立即发送</button>
        </div>
        {brief && <pre className="pi-brief-digest" role="status">{brief.digest}{brief.reason ? `\n（${brief.reason}）` : brief.sent ? '\n（已发送到飞书群）' : ''}</pre>}
        </>}
        {(view === 'feed' || view === 'meeting') && <>
        <div className="pi-feed-head">会议纪要分诊</div>
        <div className="pi-meeting">
          <textarea aria-label="会议纪要" rows={3} placeholder="粘贴会议纪要；AI 会拆成动作卡（谁、做什么、优先级、关联条目）" value={meetingText} maxLength={20000} onChange={event => setMeetingText(event.target.value)}/>
          <button className="primary" disabled={!meetingText.trim() || meetingBusy} onClick={() => void startMeeting()}>{meetingBusy ? '分诊中…' : '发起分诊'}</button>
        </div>
        {meetings?.map(meeting => <div className="pi-meeting-record" key={meeting.id}>
          <div className="pi-meeting-head">
            <b>{new Date(meeting.at).toLocaleString('zh-CN', { hour12: false })}</b>
            {meeting.document && meeting.document !== target.document && <a href={projectDocumentUrl(target, meeting.document)} target="_blank" rel="noreferrer" title="到来源文档派发动作">{meeting.document}</a>}
            <span className={'pi-status ' + (meeting.status === 'open' ? 'open' : meeting.status === 'done' ? 'done' : 'failed')}>{meeting.status === 'running' ? '分诊中…' : meeting.status === 'open' ? `${meeting.actions.filter(action => action.status === 'open').length} 项待办` : meeting.status === 'done' ? '已清空' : '失败'}</span>
          </div>
          {meeting.digest && <p className="pi-meeting-digest">{meeting.digest}</p>}
          {meeting.actions.map(action => <div className={'pi-action ' + action.priority + ' ' + action.status} key={action.id}>
            <i>{action.priority === 'high' ? '高' : action.priority === 'low' ? '低' : '中'}</i>
            {action.workItemId && <button className="pi-item" onClick={() => onOpenItem(action.workItemId!)}>{action.workItemId}</button>}
            <span className="pi-summary" title={action.title}>{action.title}</span>
            {action.owner && <small>{action.owner}</small>}
            {action.status === 'open'
              ? <>
                  {(meeting.document ? meeting.document === target.document : !!action.workItemId) && <button className="secondary" disabled={!!busy} title="把这条动作作为指令发给当前会话执行" onClick={() => void dispatchMeeting(action)}>发 AI 执行</button>}
                  <button className="secondary" disabled={!!busy} onClick={() => void decideMeeting(meeting.id, action.id, 'done')}>完成</button>
                  {submittedAction === action.id && <small role="status">已提交到会话</small>}
                </>
              : <span className="pi-settled">✓</span>}
          </div>)}
        </div>)}
        </>}
        {(view === 'feed' || view === 'events') && <>
        <div className="pi-feed-head">项目事件流 · 最近 {eventWindow} 条{events && ` · 共 ${events.length} 条`}</div>
        {events === null ? !error && <p className="pi-muted">正在读取项目事件…</p> : events.length ? <>
          <div className="pi-event-actions"><button className="secondary" onClick={() => onAskAi(`请基于本项目最近动态回答我的问题（事件摘要：${events.slice(0, 20).map(event => `[${event.kind}] ${event.subject}`).join('；')}）。`)}>就最近动态问 AI</button></div>
          {events.slice(0, eventLimit).map(event => <div className="pi-event" key={event.id}>
            <span className={'pi-kind ' + event.kind}>{kindLabels[event.kind]}</span>
            {event.workItemId && <button className="pi-item" title="打开项目工作项阅读预览" onClick={() => onOpenItem(event.workItemId!)}>{event.workItemId}</button>}
            <span className="pi-summary" title={event.subject}>{event.subject}</span>
            <span className="pi-time">{new Date(event.at).toLocaleString('zh-CN', { hour12: false })}</span>
          </div>)}
          {events.length > eventLimit && <button className="secondary" onClick={() => setEventLimit(n => n + 60)}>显示更多事件（{eventLimit}/{events.length}）</button>}
        </> : <p className="pi-muted">本项目还没有事件。</p>}
        </>}
      </div>}
      {tab === 'timeline' && <div className="pi-body" tabIndex={0}>
        <div className="pi-feed-head">{timelineItemId ? `一条需求的一生 · ${timelineItemId}` : '项目时间线'}（最近 400 条项目事件内，按时间倒序）</div>
        {!timeline && <p className="pi-muted">正在读取时间线…</p>}
        {timeline && !timeline.entries.length && <p className="pi-muted">{timelineItemId ? '该条目还没有记录：保存、提案、备注会自动累积。' : '还没有任何事件。'}</p>}
        {timeline?.entries.map((entry, index) => <div className="pi-tl-row" key={index}>
          <span className="pi-tl-time">{new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}</span>
          <span className={'pi-kind ' + entry.kind}>{kindLabels[entry.kind as WorkEvent['kind']] ?? entry.kind}</span>
          <span className="pi-summary" title={entry.subject}>{entry.subject}</span>
        </div>)}
        {timelineItemId && <p className="pi-muted">正在编辑的工作项自动成为过滤范围；编辑器「影响分析」里可导出该条目完整证据链。</p>}
      </div>}
      <footer>{tab === 'pending' ? '体检类提案应用后自动写入 Polarion 并记审计；助手改写在批准后落到草稿，保存仍由你确认。' : tab === 'feed' ? '警报从最近一次巡检与索引推导；事件由保存/提案/备注/巡检/体检/晨报自动记录。' : '时间线来自事件总线；条目级视角 = 一条需求的一生。'}</footer>
    </section>
  </div>;
}
