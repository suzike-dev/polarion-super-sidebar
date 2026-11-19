import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Inbox, RefreshCw, Sparkles, X } from 'lucide-react';
import type { BriefView, MeetingRecordView, Proposal, Target, TimelineView, WatchView, WorkEvent } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './proposal-inbox.css';

const errorText = (e: unknown) => (e as Error).message ?? String(e);
const sourceLabels: Record<Proposal['source'], string> = { agent: '助手', lint: '体检', workflow: '工作流', manual: '手动' };
const statusLabels: Record<Proposal['status'], string> = { pending: '待审批', approved: '已批准', applied: '已应用', rejected: '已拒绝', failed: '失败' };
const kindLabels: Record<WorkEvent['kind'], string> = { save: '保存', note: '备注', check: '基准', proposal: '提案', lint: '体检', watcher: '巡检', brief: '晨报' };

/**
 * 统一收件箱（S2 + S3）：待审批（提案）/ 动态与警报（守望者 + 事件流 + 晨报 + 会议分诊 + 问 AI）/ 时间线。
 */
export function ProposalInbox({ target, right, top, initialTab = 'pending', timelineItemId, onClose, onOpenItem, onAskAi }: {
  target: Target; right: number; top: number; initialTab?: 'pending' | 'feed' | 'timeline'; timelineItemId?: string;
  onClose: () => void; onOpenItem: (workItemId: string) => void; onAskAi: (prompt: string) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [watch, setWatch] = useState<WatchView | null>(null);
  const [events, setEvents] = useState<WorkEvent[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineView | null>(null);
  const [meetings, setMeetings] = useState<MeetingRecordView[] | null>(null);
  const [meetingText, setMeetingText] = useState('');
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [brief, setBrief] = useState<{ digest: string; sent?: boolean; reason?: string } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const load = useCallback(async () => {
    setError('');
    try {
      const [proposals, watchView, eventRows, timelineView, meetingRows] = await Promise.all([
        rpc<Proposal[]>({ method: 'proposals.list', target }),
        rpc<WatchView>({ method: 'watch.view', target }),
        rpc<WorkEvent[]>({ method: 'events.list', projectId: target.projectId, limit: 60 }),
        rpc<TimelineView>({ method: 'timeline.view', target, ...(timelineItemId ? { workItemId: timelineItemId } : {}) }),
        rpc<MeetingRecordView[]>({ method: 'meeting.list', target }),
      ]);
      setRows(proposals); setWatch(watchView); setEvents(eventRows); setTimeline(timelineView); setMeetings(meetingRows);
    } catch (e) { setError(errorText(e)); }
  }, [target, timelineItemId]);
  useEffect(() => { void load(); }, [load]);
  const decide = async (proposal: Proposal, allow: boolean) => {
    if (busy) return;
    setBusy(proposal.id); setError('');
    try {
      if (allow) await rpc({ method: 'proposals.approve', id: proposal.id });
      else await rpc({ method: 'proposals.reject', id: proposal.id });
      await load();
    } catch (e) {
      const message = errorText(e);
      setError(/NATIVE_EDITOR|REMOTE_CONFLICT|STALE_DRAFT|PROPOSAL_TARGET_MISMATCH/.test(message)
        ? `「${proposal.workItemId ?? proposal.summary}」需要在编辑工作台处理：${message}`
        : '处理失败：' + message);
      await load();
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
      // 复用工作区会话；没有会话时由宿主报错引导，先在助手面板发起一次对话即可。
      const session = await rpc<{ id: string }>({ method: 'sessions.create', target, title: '会议分诊' });
      await rpc({ method: 'meeting.triage', sessionId: session.id, target, contexts: [], permissionMode: 'auto', text: meetingText.trim() });
      setMeetingText('');
      await load();
      window.dispatchEvent(new Event('polarion-sidebar-run-started'));
    } catch (e) { setError('会议分诊发起失败：' + errorText(e)); }
    finally { setMeetingBusy(false); }
  };
  const decideMeeting = async (id: string, actionId: string, decision: 'done' | 'open') => {
    if (busy) return;
    setBusy(actionId); setError('');
    try { await rpc({ method: 'meeting.decide', id, actionId, decision }); await load(); }
    catch (e) { setError('处置失败：' + errorText(e)); }
    finally { setBusy(''); }
  };
  const pending = (rows ?? []).filter(row => row.status === 'pending');
  const engineOwned = (row: Proposal) => row.op.kind === 'tool' || row.op.kind === 'gate';
  const history = (rows ?? []).filter(row => row.status !== 'pending').slice(0, 50);
  const renderRow = (row: Proposal) => {
    const detail = expanded === row.id;
    return <div className={'pi-row' + (row.status === 'pending' ? '' : ' settled') + (engineOwned(row) ? ' engine' : '')} key={row.id}>
      <div className="pi-line">
        <span className={'pi-source ' + row.source}>{sourceLabels[row.source]}</span>
        {row.workItemId ? <button className="pi-item" title="打开工作项" onClick={() => onOpenItem(row.workItemId!)}>{row.workItemId}</button> : <span className="pi-item none">（无工作项）</span>}
        <span className="pi-summary" title={row.summary}>{row.summary}</span>
        {row.matchCount !== undefined && row.matchCount > 1 && <span className="pi-count">×{row.matchCount}</span>}
        <span className="pi-time">{new Date(row.createdAt).toLocaleTimeString('zh-CN')}</span>
        {row.status !== 'pending' && <span className={'pi-status ' + row.status}>{statusLabels[row.status]}{row.error ? ' · ' + row.error.slice(0, 60) : ''}</span>}
      </div>
      {row.status === 'pending' && <div className="pi-actions">
        {engineOwned(row)
          ? <span className="pi-engine-note">{row.op.kind === 'gate' ? '工作流暂停门：在会话上方继续/终止' : '工具写入提案：随所属任务审批'}</span>
          : <>
            <button className="secondary" disabled={busy === row.id} onClick={() => setExpanded(detail ? null : row.id)}>{detail ? '收起差异' : '查看差异'}<ChevronRight size={12} className={detail ? 'open' : ''}/></button>
            <button className="secondary" disabled={busy === row.id} onClick={() => void decide(row, false)}>拒绝</button>
            <button className="primary" disabled={busy === row.id} onClick={() => void decide(row, true)}>批准并应用</button>
          </>}
      </div>}
      {detail && row.diffPreview && <div className="pi-diff">{(['before', 'after'] as const).map(side => <section key={side}>
        <b>{side === 'before' ? '改前' : '改后'}</b>
        <p>{row.diffPreview![side].slice(-14).map((segment, i) => segment.kind === 'del' ? <del key={i}>{segment.text}</del> : segment.kind === 'ins' ? <ins key={i}>{segment.text}</ins> : segment.text)}</p>
      </section>)}</div>}
    </div>;
  };
  return <div className="pi-layer" style={{ right, top, '--pi-right': right + 'px' } as React.CSSProperties} role="dialog" aria-label="统一收件箱" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pi-panel">
      <header className="pi-head">
        <span className="pi-icon"><Inbox size={15}/></span>
        <div className="pi-title"><strong>统一收件箱</strong><small>{target.projectId} · 提案审批 · 守望警报 · 时间线</small></div>
        <div className="pi-tabs" role="tablist" aria-label="收件箱视图">
          <button role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'selected' : ''} onClick={() => setTab('pending')}>待审批{pending.length ? ` ${pending.length}` : ''}</button>
          <button role="tab" aria-selected={tab === 'feed'} className={tab === 'feed' ? 'selected' : ''} onClick={() => setTab('feed')}>动态与警报</button>
          <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'selected' : ''} onClick={() => setTab('timeline')}>时间线</button>
        </div>
        <button className="icon" title="重新读取" onClick={() => void load()}><RefreshCw size={14}/></button>
        <button className="icon" title="关闭（Esc）" onClick={onClose}><X size={16}/></button>
      </header>
      {error && <p className="pi-error" role="alert">{error}<button onClick={() => setError('')}><X size={12}/></button></p>}
      {tab === 'pending' && <div className="pi-body">
        {!rows && <p className="pi-muted">正在读取提案…</p>}
        {rows && !pending.length && <p className="pi-muted ok">没有待审批的提案。</p>}
        {pending.map(renderRow)}
        {rows && history.length > 0 && <>
          <button className="pi-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            <ChevronRight size={12} className={showHistory ? 'open' : ''}/>处理记录 {history.length} 条
          </button>
          {showHistory && history.map(renderRow)}
        </>}
      </div>}
      {tab === 'feed' && <div className="pi-body">
        <div className="pi-feed-head">守望警报</div>
        {watch?.alerts.map((alert, index) => <div className={'pi-alert ' + alert.level} key={index}>
          <b>{alert.level === 'warn' ? '⚠' : 'ℹ'} {alert.title}</b>
          <small>{alert.detail}{alert.at ? ` · 数据截至 ${new Date(alert.at).toLocaleString('zh-CN')}` : ''}</small>
        </div>)}
        <div className="pi-feed-head">晨报</div>
        <div className="pi-brief">
          <label className="pi-brief-toggle"><input type="checkbox" checked={!!watch?.brief.enabled} disabled={briefBusy} onChange={() => void toggleBrief()}/>每日 {watch?.brief.at ?? '07:30'} 自动体检+巡检并发卡</label>
          <button className="secondary" disabled={briefBusy} onClick={() => void runBrief(false)}><Sparkles size={12}/>预览晨报</button>
          <button className="secondary" disabled={briefBusy} onClick={() => void runBrief(true)} title="发送到项目飞书群（PSB-FEISHU 配置的群）">立即发送</button>
        </div>
        {brief && <pre className="pi-brief-digest">{brief.digest}{brief.sent === false && brief.reason ? `\n（${brief.reason}）` : ''}{brief.sent ? '\n（已发送到飞书群）' : ''}</pre>}
        <div className="pi-feed-head">会议纪要分诊</div>
        <div className="pi-meeting">
          <textarea aria-label="会议纪要" rows={3} placeholder="粘贴会议纪要；AI 会拆成动作卡（谁、做什么、优先级、关联条目）" value={meetingText} maxLength={20000} onChange={event => setMeetingText(event.target.value)}/>
          <button className="primary" disabled={!meetingText.trim() || meetingBusy} onClick={() => void startMeeting()}>{meetingBusy ? '分诊中…' : '发起分诊'}</button>
        </div>
        {meetings?.map(meeting => <div className="pi-meeting-record" key={meeting.id}>
          <div className="pi-meeting-head">
            <b>{new Date(meeting.at).toLocaleString('zh-CN', { hour12: false })}</b>
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
                  <button className="secondary" title="把这条动作作为指令发给当前会话执行" onClick={() => onAskAi(action.workItemId ? `${action.workItemId}：${action.title}` : action.title)}>发 AI 执行</button>
                  <button className="secondary" disabled={busy === action.id} onClick={() => void decideMeeting(meeting.id, action.id, 'done')}>完成</button>
                </>
              : <span className="pi-settled">✓</span>}
          </div>)}
        </div>)}
        <div className="pi-feed-head">事件流</div>
        {events?.length ? <>
          <div className="pi-event-actions"><button className="secondary" onClick={() => onAskAi(`请基于本项目最近动态回答我的问题（事件摘要：${events.slice(0, 20).map(event => `[${event.kind}] ${event.subject}`).join('；')}）。`)}>就最近动态问 AI</button></div>
          {events.map(event => <div className="pi-event" key={event.id}>
            <span className={'pi-kind ' + event.kind}>{kindLabels[event.kind]}</span>
            {event.workItemId ? <button className="pi-item" title="打开工作项" onClick={() => onOpenItem(event.workItemId!)}>{event.workItemId}</button> : null}
            <span className="pi-summary" title={event.subject}>{event.subject}</span>
            <span className="pi-time">{new Date(event.at).toLocaleString('zh-CN', { hour12: false })}</span>
          </div>)}
        </> : <p className="pi-muted">还没有事件：保存、提案、备注、巡检、体检都会记到这里。</p>}
      </div>}
      {tab === 'timeline' && <div className="pi-body">
        <div className="pi-feed-head">{timelineItemId ? `一条需求的一生 · ${timelineItemId}` : '文档时间线'}（事件倒序）</div>
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
