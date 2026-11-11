import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, CalendarClock, Check, ChevronRight, CircleDot, Copy, Download, ExternalLink, FileDiff, Link2, Loader2, Play, Plus, RefreshCw, Search, Send, Share2, Sparkles, Trash2, X} from 'lucide-react';
import type {ChangeAiSummary, ChangeBlock, ChangeCompareOptions, ChangeJobView, ChangeRecord, ChangeRecordSummary, ChangeSessionView, ChangeShareFeishuResult, ChangeWorkspace, FeishuGroup, FeishuGroupsView, Target} from '../../../packages/protocol/index';
import {rpc} from '../lib/client';
import {diffTextParts} from '../../../packages/core/text-diff';
import {diffTable} from '../../../packages/core/table-diff';
import {AssistantMarkdown} from './AssistantMarkdown';
import './change-workbench.css';

/** 同一记录自动重试 AI 总结的最小间隔，避免反复打开时耗掉调用额度。 */
const summaryAttempts = new Map<string, number>();

const pad = (value: number) => String(value).padStart(2, '0');
function stamp(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function dayKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function duration(from: number, to: number) {
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}
const ERROR_TEXT: Record<string, string> = {
  CHANGE_SESSION_ACTIVE: '当前文档已有进行中的变更基准，请先结束或取消它。',
  CHANGE_SESSION_BUSY: '变更基准正在处理中，请稍候。',
  CHANGE_SESSION_NOT_READY: '基准还没有写入完成，请稍后再试。',
  CHANGE_SESSION_NOT_FOUND: '这条变更基准已不存在，请刷新。',
  CHANGE_JOB_LOST: '后台任务已中断，请取消基准后重新设定。',
  CHANGE_JOB_NOT_FOUND: '后台任务已结束，请刷新。',
  CHANGE_RECORD_CREATE_FAILED: '无法在项目中创建变更工作项：请确认当前账号有创建工作项的权限，或项目里存在可用的工作项类型。',
  CHANGE_RECORD_WRITE_FAILED: '写入 Polarion 变更工作项失败，请检查网络后重试。',
  CHANGE_RECORD_CONFLICT: '这条变更记录刚被其他人更新，请刷新后重试。',
  CHANGE_RECORD_NOT_FOUND: '没有找到这条变更记录的工作项。',
  CHANGE_RECORD_READ_FAILED: '读取变更记录失败，请检查 Polarion 连接。',
  CHANGE_RECORD_ATTACHMENT_FAILED: '写入变更记录附件失败。',
  CHANGE_RECORD_READBACK_MISMATCH: '变更记录写入后校验不一致，请重试。',
  CHANGE_SNAPSHOT_FAILED: '读取文档正文失败，请检查 Polarion 连接。',
  CHANGE_HISTORY_FAILED: '读取工作项历史版本失败。',
  CHANGE_BACKEND_UNAVAILABLE: '本地 Host 未连接 Polarion。',
  CHANGE_COMPARE_RANGE_INVALID: '变更前时间必须早于变更后时间。',
  CHANGE_COMPARE_AFTER_FUTURE: '变更后时间不能晚于现在。',
  CHANGE_OPERATION_FAILED: '变更操作失败，请稍后重试。',
  CHANGE_SUMMARY_BUSY: 'AI 总结正在生成，请稍候。',
  CHANGE_SUMMARY_FAILED: 'AI 总结失败，已保留自动摘要。',
  CHANGE_SHARE_START_FAILED: '分享服务启动失败，请检查端口占用。',
  AI_SUMMARY_UNAVAILABLE: 'AI 总结暂不可用，已保留自动摘要；可点击重试。',
  AI_SUMMARY_TIMEOUT: 'AI 总结超时，已保留自动摘要。',
  AI_SUMMARY_FAILED: 'AI 总结失败，已保留自动摘要。',
  HOST_REQUEST_TIMEOUT: '本地 Host 响应超时。',
  POLARION_TIMEOUT_VERIFY_BEFORE_RETRY: 'Polarion 响应超时，写操作状态未知；请先刷新确认，不要直接重复提交。',
  POLARION_AUTHENTICATION_FAILED: 'Polarion 认证失败，请在设置中检查账号。',
  POLARION_CONNECTION_FAILED: '无法连接 Polarion，请检查账号或网络。',
};

function changeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (ERROR_TEXT[raw]) return ERROR_TEXT[raw]!;
  const token = raw.match(/[A-Z][A-Z0-9_]{2,}/g)?.find(value => ERROR_TEXT[value]);
  return token ? ERROR_TEXT[token]! : raw || 'CHANGE_OPERATION_FAILED';
}

/** 记录里的 block HTML 已在 Host 端净化；这里只把图片引用换成内嵌 data URL。 */
function withImages(html: string, images: Record<string, string>) {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    const data = images[src];
    if (!data) return '<span class="cw-img-missing">[图片：需在 Polarion 中查看]</span>';
    return tag.replace(/\bsrc\s*=\s*"[^"]*"/i, `src="${data}"`);
  });
}

function blockText(html: string): string {
  const node = document.createElement('div');
  node.innerHTML = html;
  return (node.textContent ?? '').replace(/ /g, ' ').trim();
}
function htmlText(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function ChangeItemView({change, record, onlyChanges, onOpenItem, index, canOpen}: {
  change: ChangeRecord['changes'][number];
  record: ChangeRecord;
  onlyChanges: boolean;
  onOpenItem: (id: string) => void;
  index: number;
  canOpen: boolean;
}) {
  const [hoverChange, setHoverChange] = useState<number | null>(null);
  const kindLabel = {modified: '修改', added: '新增', removed: '删除', moved: '移动'}[change.kind];
  const counts = [
    change.counts.added ? `新增 ${change.counts.added} 段` : '',
    change.counts.removed ? `删除 ${change.counts.removed} 段` : '',
    change.counts.modified ? `改写 ${change.counts.modified} 段` : '',
  ].filter(Boolean).join(' · ');
  const linkedClass = (id: number) => hoverChange === id ? ' cw-linked' : '';
  const renderParts = (parts: ReturnType<typeof diffTextParts>, side: 'before' | 'after') => parts.map((part, partIndex) => {
    if (part.kind === 'same') return <span className="cw-same-text" key={'s' + partIndex}>{part.text}</span>;
    const hoverProps = {onMouseEnter: () => setHoverChange(part.id), onMouseLeave: () => setHoverChange(null)};
    if (side === 'before') {
      if (!part.before) return (part.after?.length ?? 0) >= 6 ? <span key={'b' + partIndex} className={'cw-diff-marker' + linkedClass(part.id)} data-cw-change={part.id} data-cw-tip={'新增：' + (part.after ?? '')} {...hoverProps}>＋新增</span> : null;
      return <span key={'b' + partIndex} className={'cw-diff-del' + (part.after ? '' : ' cw-deleted') + linkedClass(part.id)} data-cw-change={part.id} data-cw-tip={'变更后：' + (part.after || '（已删除）')} {...hoverProps}>{part.before}</span>;
    }
    if (!part.after) return (part.before?.length ?? 0) >= 6 ? <span key={'a' + partIndex} className={'cw-diff-marker' + linkedClass(part.id)} data-cw-change={part.id} data-cw-tip={'删除：' + (part.before ?? '')} {...hoverProps}>－删除</span> : null;
    return <span key={'a' + partIndex} className={'cw-diff-ins ' + (part.before ? 'cw-modified' : 'cw-added') + linkedClass(part.id)} data-cw-change={part.id} data-cw-tip={'变更前：' + (part.before || '（新增）')} {...hoverProps}>{part.after}</span>;
  });
  const renderSide = (block: ChangeBlock, side: 'before' | 'after') => {
    if (block.kind === 'same') {
      return block.html
        ? <div className="cw-same-block" dangerouslySetInnerHTML={{__html: withImages(block.html, record.images)}}/>
        : <div className="cw-same">{block.text ?? ''}</div>;
    }
    if (block.kind === 'added') {
      return side === 'before'
        ? <div className="cw-diff-void">（此处为新增内容）</div>
        : <div className="cw-rich cw-added-content" dangerouslySetInnerHTML={{__html: withImages(block.after ?? '', record.images)}}/>;
    }
    if (block.kind === 'removed') {
      return side === 'after'
        ? <div className="cw-diff-void">（此处已删除）</div>
        : <div className="cw-rich cw-removed-content" dangerouslySetInnerHTML={{__html: withImages(block.before ?? '', record.images)}}/>;
    }
    const isTable = block.tag === 'table';
    if (isTable) {
      const tableDiff = diffTable(block.before ?? '', block.after ?? '');
      if (tableDiff.changed) return <div className="cw-rich cw-table-scroll" dangerouslySetInnerHTML={{__html: side === 'before' ? tableDiff.before : tableDiff.after}}/>;
    }
    const nestedStructure = /<(?:img|table)\b/i.test((block.before ?? '') + (block.after ?? ''));
    if (!isTable && !nestedStructure) {
      const beforeText = blockText(block.before ?? ''), afterText = blockText(block.after ?? '');
      const parts = diffTextParts(beforeText, afterText);
      if ((beforeText || afterText) && parts.some(part => part.kind === 'change')) {
        return <p className="cw-inline-text">{renderParts(parts, side)}</p>;
      }
    }
    return <div className="cw-rich" dangerouslySetInnerHTML={{__html: withImages(side === 'before' ? block.before ?? '' : block.after ?? '', record.images)}}/>;
  };
  return <article className={'cw-change cw-change-' + change.kind} data-item={change.workItemId} style={{'--i': index} as React.CSSProperties}>
    <header className="cw-change-head">
      <span className={'cw-kind cw-kind-' + change.kind}>{kindLabel}</span>
      <div className="cw-change-title">
        <h3><code>{change.workItemId}</code> {change.title || '(无标题)'}</h3>
        <small>{change.sectionAfter || change.sectionBefore || change.outlineAfter || change.outlineBefore || '未编号'}{change.chapterAfter !== change.chapterBefore && change.kind !== 'added' ? ` · 从 ${change.chapterBefore} 章移到 ${change.chapterAfter} 章` : ''}</small>
      </div>
      {counts && <span className="cw-change-counts">{counts}</span>}
      {canOpen && <button className="cw-link" title={`在 Polarion 中打开 ${change.workItemId}`} onClick={() => onOpenItem(change.workItemId)}>打开<ExternalLink size={11}/></button>}
    </header>
    {change.fields.length > 0 && <div className="cw-field-chips">{change.fields.map(field => <span key={field.name}>{field.name}：<s>{field.before}</s> <b>{field.after}</b></span>)}</div>}
    <div className="cw-diff-head"><span>变更前</span><span>变更后</span></div>
    <div className="cw-diff-grid">
      {change.blocks.filter(block => !onlyChanges || block.kind !== 'same').map((block, blockIndex) => <div
        className={'cw-diff-row' + (block.kind === 'same' ? ' cw-unchanged' : ' cw-changed') + (block.tag === 'table' ? ' cw-table' : '')}
        key={blockIndex}
      >
        <div className={'cw-diff-cell cw-before' + (block.kind === 'added' ? ' cw-void-side' : '') + (block.kind === 'removed' ? ' cw-removed-side' : '')}>{renderSide(block, 'before')}</div>
        <div className={'cw-diff-cell cw-after' + (block.kind === 'removed' ? ' cw-void-side' : '') + (block.kind === 'added' ? ' cw-added-side' : '')}>{renderSide(block, 'after')}</div>
      </div>)}
    </div>
  </article>;
}

export function ChangeWorkbench({target, right, top, onClose, onOpenItem}: {
  target: Target;
  right: number;
  top: number;
  onClose: () => void;
  onOpenItem: (workItemId: string) => void;
}) {
  const [workspace, setWorkspace] = useState<ChangeWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [job, setJob] = useState<ChangeJobView | null>(null);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<ChangeRecord | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [compareOptions, setCompareOptions] = useState<ChangeCompareOptions | null>(null);
  const [compareOptionsLoading, setCompareOptionsLoading] = useState(false);
  const [manualBeforeAt, setManualBeforeAt] = useState(0);
  const [manualAfterAt, setManualAfterAt] = useState(0);
  const [share, setShare] = useState<{recordUrl: string; historyUrl: string; port: number} | null>(null);
  const [copied, setCopied] = useState('');
  const [sent, setSent] = useState(false);
  const [scope, setScope] = useState<'document' | 'project'>('document');
  const [recordQuery, setRecordQuery] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteSaved, setNoteSaved] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [feishuOpen, setFeishuOpen] = useState(false);
  const [feishuView, setFeishuView] = useState<FeishuGroupsView | null>(null);
  /** null 表示未改动，直接展示项目里的共享配置。 */
  const [feishuDraft, setFeishuDraft] = useState<FeishuGroup[] | null>(null);
  const [feishuBusy, setFeishuBusy] = useState(false);
  const [feishuError, setFeishuError] = useState('');
  const [feishuNotice, setFeishuNotice] = useState('');
  const [feishuTesting, setFeishuTesting] = useState('');
  const [feishuTested, setFeishuTested] = useState<Record<string, {ok: boolean; error?: string}>>({});
  const [confirmState, setConfirmState] = useState<{title: string; message: string; label: string; danger?: boolean; action: () => void | Promise<void>} | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const summaryRequests = useRef(new Set<string>());
  const selectSeq = useRef(0);
  const jobSeq = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const value = await rpc<ChangeWorkspace>({method: 'changes.workspace.read', target});
      setWorkspace(value);
      if (value.warning) setNotice(value.warning);
      return value;
    } catch (exception) {
      setError(changeError(exception));
      return undefined;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [target]);

  const generateSummary = useCallback(async (recordId: string, force = false) => {
    if (summaryRequests.current.has(recordId)) return;
    summaryRequests.current.add(recordId);
    summaryAttempts.set(recordId, Date.now());
    setSummaryBusy(true); setSummaryError('');
    try {
      const value = await rpc<{summary: ChangeAiSummary; record: ChangeRecord}>({method: 'changes.record.summarize', recordId, force});
      if (!closed.current) {
        setRecord(current => current?.id === recordId ? value.record : current);
        setWorkspace(current => current ? {
          ...current,
          records: current.records.map(row => row.id === recordId ? {...row, aiStatus: value.summary.status, headline: value.record.headline} : row),
        } : current);
      }
    } catch (exception) {
      if (!closed.current) {
        setSummaryError(changeError(exception));
        try {
          const refreshed = await rpc<ChangeRecord>({method: 'changes.record.read', recordId});
          if (!closed.current) setRecord(current => current?.id === recordId ? refreshed : current);
        } catch { /* 保留当前展示 */ }
      }
    } finally {
      summaryRequests.current.delete(recordId);
      if (!closed.current) setSummaryBusy(false);
    }
  }, []);

  const openRecord = useCallback(async (recordId: string) => {
    const seq = ++selectSeq.current;
    setSelectedId(recordId); setRecord(null); setSummaryError(''); setShare(null); setError('');
    try {
      const value = await rpc<ChangeRecord>({method: 'changes.record.read', recordId});
      if (seq !== selectSeq.current || closed.current) return;
      setRecord(value);
      const lastAttempt = summaryAttempts.get(recordId) ?? 0;
      if (value.aiSummary.status !== 'ready' && Date.now() - lastAttempt > 5 * 60_000) {
        summaryAttempts.set(recordId, Date.now());
        void generateSummary(recordId);
      }
    } catch (exception) {
      if (seq === selectSeq.current && !closed.current) setError(changeError(exception));
    }
  }, [generateSummary]);

  useEffect(() => {
    setNoteDraft(record?.note ?? '');
    setNoteSaved('');
    setItemQuery('');
  }, [record?.id]);

  const saveNote = async () => {
    if (!record || noteBusy) return;
    setNoteBusy(true);
    try {
      const value = await rpc<{note: string; record: ChangeRecord}>({method: 'changes.record.note', recordId: record.id, note: noteDraft});
      setRecord(value.record);
      setNoteSaved('已保存到项目');
      window.setTimeout(() => setNoteSaved(''), 2200);
    } catch (exception) {
      setSummaryError(changeError(exception));
    } finally {
      setNoteBusy(false);
    }
  };

  const followJob = useCallback(async (jobId: string) => {
    const seq = ++jobSeq.current;
    for (;;) {
      if (seq !== jobSeq.current || closed.current) return;
      let value: ChangeJobView;
      try {
        value = await rpc<ChangeJobView>({method: 'changes.job.read', jobId});
      } catch (exception) {
        if (seq === jobSeq.current && !closed.current) { setJob(null); setError(changeError(exception)); }
        return;
      }
      if (seq !== jobSeq.current || closed.current) return;
      setJob(value);
      if (value.state === 'done') {
        setJob(null);
        await load(true);
        if (value.recordId) await openRecord(value.recordId);
        return;
      }
      if (value.state === 'failed') {
        setJob(null);
        setError(changeError(value.error ?? 'CHANGE_OPERATION_FAILED'));
        await load(true);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  }, [load, openRecord]);

  useEffect(() => {
    closed.current = false;
    void load();
    closeButton.current?.focus();
    return () => {
      closed.current = true;
      selectSeq.current++;
      jobSeq.current++;
    };
  }, [load]);

  useEffect(() => {
    const running = workspace?.session?.job;
    if (running?.state === 'running') void followJob(running.id);
  }, [workspace?.session?.job?.id, workspace?.session?.job?.state, followJob]);

  const start = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await rpc<{session: ChangeSessionView}>({method: 'changes.session.start', target, note: sessionNote});
      setWorkspace(current => current ? {...current, session: value.session} : current);
      setSessionNote('');
      if (value.session.job?.state === 'running') { setJob(value.session.job); void followJob(value.session.job.id); }
      else if (value.session.jobId) void followJob(value.session.jobId);
    } catch (exception) {
      setError(changeError(exception));
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try { await confirmState.action(); }
    finally { setConfirmBusy(false); setConfirmState(null); }
  };

  const finish = () => {
    const session = workspace?.session;
    if (!session || busy) return;
    setConfirmState({
      title: '结束并生成变更记录？',
      message: '记录会写入当前 Polarion 项目，项目成员都能看到。',
      label: '结束并生成',
      action: async () => {
        setBusy(true); setError('');
        try {
          const value = await rpc<{jobId: string}>({method: 'changes.session.finish', sessionId: session.id});
          void followJob(value.jobId);
        } catch (exception) { setError(changeError(exception)); }
        finally { setBusy(false); }
      },
    });
  };

  const cancel = () => {
    const session = workspace?.session;
    if (!session || busy) return;
    setConfirmState({
      title: '取消这次变更基准？',
      message: '取消后不会生成变更记录，基准快照会从项目中清理。',
      label: '取消基准',
      danger: true,
      action: async () => {
        setBusy(true); setError('');
        try {
          await rpc({method: 'changes.session.cancel', sessionId: session.id});
          setRecord(null); setSelectedId(null);
          await load(true);
        } catch (exception) { setError(changeError(exception)); }
        finally { setBusy(false); }
      },
    });
  };

  const removeRecord = (value: ChangeRecord) => {
    if (busy) return;
    setConfirmState({
      title: '删除这条变更记录？',
      message: `会删除 Polarion 中的工作项 ${value.workItemId ?? ''}，项目成员将无法再看到这条记录。此操作不可撤销。`,
      label: '删除记录',
      danger: true,
      action: async () => {
        setBusy(true); setError('');
        try {
          await rpc({method: 'changes.record.delete', recordId: value.id});
          setRecord(null); setSelectedId(null); setShare(null);
          await load(true);
        } catch (exception) { setError(changeError(exception)); }
        finally { setBusy(false); }
      },
    });
  };

  const openManual = async () => {
    setManualOpen(true); setCompareOptions(null); setCompareOptionsLoading(true); setError('');
    try {
      const value = await rpc<ChangeCompareOptions>({method: 'changes.compare.options', target});
      setCompareOptions(value);
      const latest = value.events[0];
      setManualBeforeAt(latest?.beforeAt ?? value.points.find(point => point.kind === 'start')?.at ?? Date.now() - 24 * 3600_000);
      setManualAfterAt(latest?.at ?? Date.now());
    } catch (exception) {
      setError(changeError(exception));
    } finally {
      setCompareOptionsLoading(false);
    }
  };

  const createManual = async (beforeAt = manualBeforeAt, afterAt = manualAfterAt) => {
    if (!beforeAt || !afterAt || beforeAt >= afterAt) { setError('变更前基准必须早于变更后基准。'); return; }
    if (afterAt > Date.now() + 60_000) { setError('变更后基准不能晚于现在。'); return; }
    setManualOpen(false); setBusy(true); setError('');
    try {
      const value = await rpc<{jobId: string}>({method: 'changes.compare.create', target, beforeAt, afterAt});
      void followJob(value.jobId);
    } catch (exception) {
      setError(changeError(exception));
    } finally {
      setBusy(false);
    }
  };

  const publish = async (): Promise<string | undefined> => {
    if (!record || busy) return undefined;
    setBusy(true); setError('');
    try {
      const value = await rpc<{recordUrl: string; historyUrl: string; port: number}>({method: 'changes.share.publish', recordId: record.id});
      setShare(value);
      return value.recordUrl;
    } catch (exception) {
      setError(changeError(exception));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1800);
    } catch {
      setNotice('复制失败，请手动选择链接文本。');
    }
  };

  const feishuText = (value: ChangeRecord, url: string) => `【需求变更】${value.documentTitle}\n${stamp(value.baselineAt)} → ${stamp(value.endedAt)} · ${value.changedItems} 个工作项变更（修改 ${value.modified}、新增 ${value.added}、删除 ${value.removed}）\n${value.headline}${value.note ? '\n说明：' + value.note : ''}\n查看详情：${url}`;

  /** 预览分享页：先同步开空标签保住用户手势，再启动分享服务并跳转，避免被弹窗拦截。 */
  const previewShare = async () => {
    if (!record || busy) return;
    const win = window.open('about:blank', '_blank');
    const url = share?.recordUrl ?? await publish();
    if (!url) { win?.close(); return; }
    if (win) win.location.href = url;
    else window.open(url, '_blank', 'noopener');
  };

  const copyFeishu = async () => {
    if (!record || !share?.recordUrl) return;
    await copy(feishuText(record, share.recordUrl), '飞书消息');
  };

  const shareToFeishu = async () => {
    if (!record || busy) return;
    setBusy(true); setError('');
    try {
      // Host 端先确保分享服务已发布，再把交互卡片发到本项目设置里配置的全部群。
      const value = await rpc<ChangeShareFeishuResult>({method: 'changes.share.feishu', recordId: record.id});
      setShare(value);
      const done = value.results.filter(row => row.ok);
      const failed = value.results.filter(row => !row.ok);
      if (done.length) {
        setNotice(`变更卡片已发送到：${done.map(row => row.label).join('、')}${failed.length ? `；${failed.map(row => `${row.label} 失败（${row.error}）`).join('、')}` : ''}`);
        setSent(true); window.setTimeout(() => setSent(false), 1800);
      } else {
        setNotice(`全部群发送失败（${failed.map(row => `${row.label}：${row.error}`).join('；')}），已复制纯文本消息，可手动粘贴到飞书。`);
        await copy(feishuText(record, value.recordUrl), '飞书消息');
      }
    } catch (exception) {
      const message = changeError(exception);
      if (message.includes('NO_FEISHU_GROUPS')) {
        // 本项目还没配群机器人：不算错误，回落到旧的“发布 + 复制纯文本”流程。
        setBusy(false);
        if (!share?.recordUrl) {
          const url = await publish();
          if (url) setNotice('分享链接已生成。本项目还没有配置飞书推送群（点右上角纸飞机图标配置，保存后全项目共用）；也可以点“复制飞书消息”手动粘贴。');
        } else await copyFeishu();
      } else setError(message);
    } finally { setBusy(false); }
  };

  /* ------------------- 飞书推送群（项目共享） ------------------- */

  const feishuGroups = feishuDraft ?? feishuView?.groups ?? [];

  const loadFeishu = async () => {
    setFeishuBusy(true); setFeishuError(''); setFeishuNotice('');
    try {
      const view = await rpc<FeishuGroupsView>({method: 'changes.feishu.groups', target});
      setFeishuView(view); setFeishuDraft(null); setFeishuTested({});
    } catch (exception) { setFeishuError(changeError(exception)); }
    finally { setFeishuBusy(false); }
  };

  const patchFeishuGroup = (id: string, value: Partial<FeishuGroup>) => setFeishuDraft(feishuGroups.map(group => group.id === id ? {...group, ...value} : group));

  const addFeishuGroup = () => setFeishuDraft([...feishuGroups, {id: crypto.randomUUID(), label: '飞书项目群', webhook: '', secret: ''}]);

  const removeFeishuGroup = (id: string) => setFeishuDraft(feishuGroups.filter(group => group.id !== id));

  const testFeishuGroup = async (group: FeishuGroup) => {
    const webhook = group.webhook.trim();
    if (!/^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\//.test(webhook)) {
      setFeishuTested(state => ({...state, [group.id]: {ok: false, error: 'webhook 地址应形如 https://open.feishu.cn/open-apis/bot/v2/hook/…'}}));
      return;
    }
    setFeishuTesting(group.id);
    try {
      const value = await rpc<{results: {ok: boolean; error?: string}[]}>({method: 'changes.share.feishuTest', webhook, secret: group.secret, projectId: target.projectId});
      setFeishuTested(state => ({...state, [group.id]: value.results[0] ?? {ok: false, error: '没有返回结果'}}));
    } catch (exception) {
      setFeishuTested(state => ({...state, [group.id]: {ok: false, error: exception instanceof Error ? exception.message : String(exception)}}));
    } finally { setFeishuTesting(''); }
  };

  const saveFeishuGroups = async () => {
    for (const group of feishuGroups) {
      if (!group.label.trim()) { setFeishuError('每个群都要填一个群名称（发送结果里显示）。'); return; }
      if (!/^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\//.test(group.webhook.trim())) { setFeishuError(`「${group.label}」的 webhook 地址应形如 https://open.feishu.cn/open-apis/bot/v2/hook/…`); return; }
    }
    setFeishuBusy(true); setFeishuError(''); setFeishuNotice('');
    try {
      const view = await rpc<FeishuGroupsView>({method: 'changes.feishu.groups.save', target, groups: feishuGroups});
      setFeishuView(view); setFeishuDraft(null);
      setFeishuNotice(view.groups.length ? `已保存 ${view.groups.length} 个群，本项目所有成员即刻共用。` : '已保存（当前为空配置）。');
    } catch (exception) {
      const message = changeError(exception);
      setFeishuError(message.includes('FEISHU_GROUPS_CONFLICT') ? '配置刚被其他成员更新，点「重新加载」拿到最新配置后再改。' : message);
    } finally { setFeishuBusy(false); }
  };

  const copyMarkdown = async () => {
    if (!record) return;
    const kindLabel = {modified: '修改', added: '新增', removed: '删除', moved: '移动'} as const;
    const lines = [
      `# ${record.documentTitle}`,
      '',
      `${stamp(record.baselineAt)} → ${stamp(record.endedAt)} · ${record.changedItems} 个工作项变更（修改 ${record.modified}、新增 ${record.added}、删除 ${record.removed}）`,
      '',
      record.aiSummary.status === 'ready' && record.aiSummary.text ? record.aiSummary.text : record.heuristicSummary,
      '',
    ];
    if (record.note) lines.push(`> 补充说明：${record.note}`, '');
    lines.push('## 变更明细');
    for (const change of record.changes) {
      const parts = [
        change.counts.added ? `新增 ${change.counts.added} 段` : '',
        change.counts.removed ? `删除 ${change.counts.removed} 段` : '',
        change.counts.modified ? `改写 ${change.counts.modified} 段` : '',
        change.fields.length ? `属性：${change.fields.map(field => field.name).join('、')}` : '',
      ].filter(Boolean).join('、');
      lines.push(`- **${kindLabel[change.kind]}** \`${change.workItemId}\` ${change.title}${parts ? '：' + parts : ''}`);
    }
    if (share?.recordUrl) lines.push('', `详情：${share.recordUrl}`);
    await copy(lines.join('\n'), 'Markdown');
  };

  const jumpTo = (workItemId: string) => {
    const node = detail.current?.querySelector(`[data-item="${workItemId}"]`);
    node?.scrollIntoView({block: 'start', behavior: 'smooth'});
  };
  const jumpChapter = (chapter: string) => {
    const first = record?.changes.find(change => (change.chapterAfter !== '0' ? change.chapterAfter : change.chapterBefore) === chapter);
    if (first) jumpTo(first.workItemId);
  };

  const listRows = scope === 'project' ? (workspace?.projectRecords ?? []) : (workspace?.records ?? []);
  const filteredRows = useMemo(() => {
    const query = recordQuery.trim().toLowerCase();
    if (!query) return listRows;
    return listRows.filter(row => row.headline.toLowerCase().includes(query) || row.documentTitle.toLowerCase().includes(query) || stamp(row.endedAt).includes(query));
  }, [listRows, recordQuery]);
  const groupedRecords = useMemo(() => {
    const groups = new Map<string, ChangeRecordSummary[]>();
    for (const row of filteredRows) {
      const key = dayKey(row.endedAt);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()];
  }, [filteredRows]);

  const session = workspace?.session ?? null;
  const running = job ?? session?.job ?? null;
  const progress = running && running.total > 0 ? Math.min(100, Math.round(running.done / running.total * 100)) : 0;

  const renderSession = () => {
    if (running) return <div className="cw-session cw-running">
      <div className="cw-session-title"><Loader2 size={14} className="cw-spin"/><b>{running.kind === 'compare' ? '正在补建变更' : running.kind === 'finish' ? '正在生成变更记录' : '正在设定基准'}</b></div>
      <p className="cw-phase">{running.phase}</p>
      {running.total > 0 && <div className="cw-progress" role="progressbar" aria-valuemin={0} aria-valuemax={running.total} aria-valuenow={running.done}><i style={{'--cw-progress': progress + '%'} as React.CSSProperties}/><span>{running.done} / {running.total}</span></div>}
      <p className="cw-hint">大型文档需要几十秒；期间可以先看历史记录。</p>
    </div>;
    if (session && session.state === 'failed') return <div className="cw-session cw-failed">
      <div className="cw-session-title"><AlertTriangle size={14}/><b>基准没有完成</b></div>
      <p className="cw-phase">{changeError(session.error ?? 'CHANGE_OPERATION_FAILED')}</p>
      <div className="cw-actions"><button className="secondary" disabled={busy} onClick={() => void cancel()}>清理这次基准</button></div>
    </div>;
    if (session && (session.state === 'active' || session.state === 'finishing')) return <div className="cw-session cw-active">
      <div className="cw-session-title"><CircleDot size={13}/><b>基准已设定</b><span className={'cw-source ' + (session.source === 'cache' ? 'cache' : '')}>{session.source === 'cache' ? '本机缓存' : 'Polarion'}</span></div>
      <dl className="cw-session-meta">
        <div><dt>基准时间</dt><dd>{stamp(session.baselineAt)}</dd></div>
        <div><dt>检查范围</dt><dd>{session.itemCount} 个工作项</dd></div>
        {session.author && <div><dt>设定人</dt><dd>{session.author}</dd></div>}
      </dl>
      {session.note && <p className="cw-session-purpose"><b>修改目的</b>{session.note}</p>}
      <p className="cw-hint">中间保存不会通知任何人；点“结束并生成”才会形成一条项目变更记录。</p>
      <div className="cw-actions"><button className="primary" disabled={busy || session.state === 'finishing'} onClick={() => void finish()}><Play size={13}/>结束并生成</button><button className="danger-ghost" disabled={busy} onClick={() => void cancel()}>取消基准</button></div>
    </div>;
    return <div className="cw-session cw-idle">
      <div className="cw-session-title"><FileDiff size={14}/><b>当前没有进行中的变更</b></div>
      <p className="cw-hint">修改前点“设定基准”，系统会把此刻整篇文档写入项目；改完后再点“结束并生成”。中途保存多少次都不会打扰别人。</p>
      <textarea className="cw-session-note" rows={2} maxLength={2000} value={sessionNote} onChange={event => setSessionNote(event.target.value)} placeholder="本次修改目的（可选）：例如客户要求 8 月前锁定…"/>
      <div className="cw-actions"><button className="primary" disabled={busy} onClick={() => void start()}><Play size={13}/>设定基准</button><button className="secondary" disabled={busy} onClick={openManual}><CalendarClock size={13}/>按时间补建</button></div>
    </div>;
  };

  const renderOverview = () => {
    if (loading) return <div className="cw-state"><Loader2 size={16} className="cw-spin"/>正在读取项目变更记录…</div>;
    if (selectedId && !record) return <div className="cw-state"><Loader2 size={16} className="cw-spin"/>正在读取变更详情…</div>;
    return <div className="cw-empty">
      <span className="cw-empty-mark"><FileDiff size={26}/></span>
      <h2>{session ? '基准已设定，等你结束' : '把一次需求修改，变成一份可回看的记录'}</h2>
      <p>{session ? `当前基准包含 ${session.itemCount} 个工作项。继续编辑，改完点左侧“结束并生成”。` : '设定基准后，系统会记录整篇文档的当前状态；结束时自动比对并生成逐项对照。'}</p>
      <div className="cw-empty-actions">
        {!session && <button className="primary" disabled={busy} onClick={() => void start()}><Play size={13}/>设定基准</button>}
        <button className="secondary" disabled={busy} onClick={openManual}><CalendarClock size={13}/>按时间补建变更</button>
      </div>
      <ul className="cw-steps">
        <li><b>1</b><span><strong>设定基准</strong>记录修改前的整篇文档，写入当前 Polarion 项目。</span></li>
        <li><b>2</b><span><strong>正常编辑</strong>中间保存多少次都不影响，基准不会移动。</span></li>
        <li><b>3</b><span><strong>结束并生成</strong>逐项对比变更前/后，AI 总结 + 详细对照一起保存。</span></li>
      </ul>
      <p className="cw-empty-note">忘了点基准？用“按时间补建”，选择变更前和变更后的时间点即可。记录按项目隔离，项目成员看到的是同一份。</p>
    </div>;
  };

  const renderRecord = (value: ChangeRecord) => {
    const canOpen = value.target.projectId === target.projectId && value.target.document === target.document;
    const recordWorkItemUrl = value.workItemId
      ? `https://polarion.pufafen.com/polarion/#/project/${encodeURIComponent(value.target.projectId)}/workitem?id=${encodeURIComponent(value.workItemId)}`
      : '';
    const documentUrl = `https://polarion.pufafen.com/polarion/#/project/${encodeURIComponent(value.target.projectId)}/wiki/${value.target.document.split('/').map(encodeURIComponent).join('/')}?psb=changes`;
    const query = itemQuery.trim().toLowerCase();
    const visibleChanges = query ? value.changes.filter(change => {
      if (change.workItemId.toLowerCase().includes(query) || change.title.toLowerCase().includes(query) || (change.outlineAfter || change.outlineBefore).toLowerCase().includes(query)) return true;
      return change.blocks.some(block => (block.text ?? '').toLowerCase().includes(query) || htmlText(block.before ?? '').toLowerCase().includes(query) || htmlText(block.after ?? '').toLowerCase().includes(query));
    }) : value.changes;
    return <div className="cw-detail" ref={detail}>
      <header className="cw-detail-head">
        <div className="cw-detail-title">
          <div className="cw-record-context"><span className="cw-eyebrow">CHANGE RECORD</span><span className="cw-project-badge">项目：{value.target.projectId}</span></div>
          <h2>{value.documentTitle}</h2>
          <p>{value.changedItems} 个工作项 · 历时 {duration(value.baselineAt, value.endedAt)} · 记录在 Polarion 项目</p>
        </div>
        <div className="cw-detail-actions">
          {!canOpen && <a className="secondary" href={documentUrl} target="_blank" rel="noopener noreferrer" title="在 Polarion 中打开这篇文档"><ExternalLink size={13}/>前往文档</a>}
          {recordWorkItemUrl && <a className="secondary" href={recordWorkItemUrl} target="_blank" rel="noopener noreferrer" title="在 Polarion 中打开这条变更记录的工作项"><FileDiff size={13}/>记录工作项</a>}
          <button className="secondary" disabled={busy} onClick={() => void copyMarkdown()}><Copy size={13}/>{copied === 'Markdown' ? '已复制' : '复制 Markdown'}</button>
          <button className="secondary" disabled={busy} onClick={() => void previewShare()} title="预览分享给别人的页面"><ExternalLink size={13}/>预览分享页</button>
          <button className="secondary" disabled={busy} onClick={() => void shareToFeishu()} title="把变更卡片直接发到本项目设置的飞书群"><Share2 size={13}/>{sent ? '已发送' : copied === '飞书消息' ? '已复制' : '分享到飞书'}</button>
          <button className="cw-danger-link" title="删除这条变更记录" disabled={busy} onClick={() => void removeRecord(value)}><Trash2 size={12}/>删除</button>
        </div>
      </header>
      <div className="cw-timeline" aria-hidden="true">
        <span className="cw-timeline-dot"/><span className="cw-timeline-line"/><span className="cw-timeline-dot cw-timeline-end"/>
        <div className="cw-timeline-labels"><span>基准 {stamp(value.baselineAt)}</span><em>{duration(value.baselineAt, value.endedAt)}</em><span>结束 {stamp(value.endedAt)}</span></div>
      </div>
      {share && <div className="cw-share-row"><Link2 size={13}/><code>{share.recordUrl}</code><button title="复制链接" onClick={() => void copy(share.recordUrl, '链接')}>{copied === '链接' ? <Check size={12}/> : <Copy size={12}/>}</button><button className="cw-share-copy" onClick={() => void copyFeishu()}>{copied === '飞书消息' ? '已复制' : '复制飞书消息'}</button><a href={share.recordUrl} target="_blank" rel="noopener noreferrer" title="打开分享页"><ExternalLink size={12}/></a><a href={share.recordUrl + '?download=1'} title="下载单文件 HTML"><Download size={12}/></a></div>}
      <section className="cw-summary-card">
        <div className="cw-summary-head"><span className="cw-ai-mark"><Sparkles size={13}/></span><b>{value.aiSummary.status === 'ready' ? 'AI 变更总结' : '变更总结（自动）'}</b>{value.aiSummary.status === 'ready' && <span className="cw-ready">已生成</span>}{summaryBusy && <span className="cw-generating"><Loader2 size={11} className="cw-spin"/>生成中…</span>}<button className="cw-text-button" disabled={summaryBusy} onClick={() => void generateSummary(value.id, true)}>{value.aiSummary.status === 'ready' ? '重新生成' : '重试'}</button></div>
        {value.aiSummary.status === 'ready' && value.aiSummary.text ? <AssistantMarkdown text={value.aiSummary.text} onWorkItem={canOpen ? onOpenItem : undefined}/> : <div className="cw-heuristic"><AssistantMarkdown text={value.heuristicSummary} onWorkItem={canOpen ? onOpenItem : undefined}/></div>}
        {summaryError && <div className="cw-inline-error"><AlertTriangle size={12}/>{summaryError}</div>}
        <div className="cw-note-editor">
          <div className="cw-note-head"><span>补充说明</span><small>保存到项目记录，AI 总结会参考它</small>{noteSaved && <em>{noteSaved}</em>}</div>
          <textarea rows={2} maxLength={4000} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="为什么改、影响谁、是否需要重新评审…"/>
          <div className="cw-note-actions"><span>{noteDraft.length} / 4000</span><button className="cw-text-button" disabled={noteBusy || noteDraft === (value.note ?? '')} onClick={() => void saveNote()}>{noteBusy ? <><Loader2 size={11} className="cw-spin"/>保存中…</> : '保存说明'}</button></div>
        </div>
      </section>
      <section className="cw-stat-grid">
        <div className="cw-stat"><b>{value.changedItems}</b><span>变更工作项</span></div>
        <div className="cw-stat"><b>{value.modified}</b><span>修改</span></div>
        <div className="cw-stat cw-stat-add"><b>{value.added}</b><span>新增</span></div>
        <div className="cw-stat cw-stat-remove"><b>{value.removed}</b><span>删除</span></div>
      </section>
      {value.chapters.length > 0 && <nav className="cw-chapters" aria-label="章节变更地图">{value.chapters.map(chapter => <button key={chapter.num} onClick={() => jumpChapter(chapter.num)} title={`跳到第 ${chapter.num} 章`}><b>{chapter.num === '0' ? '未分节' : '第 ' + chapter.num + ' 章'}</b><span>{chapter.title && chapter.title !== chapter.num ? chapter.title : ''}</span><em>{chapter.items} 项</em><i style={{width: Math.max(6, Math.round(chapter.items / Math.max(...value.chapters.map(item => item.items), 1) * 100)) + '%'}}/></button>)}</nav>}
      <div className="cw-filter-row">
        <label><input type="checkbox" checked={onlyChanges} onChange={event => setOnlyChanges(event.target.checked)}/>只看变更</label>
        
        <span className="cw-item-search"><Search size={12}/><input value={itemQuery} onChange={event => setItemQuery(event.target.value)} placeholder="在工作项与正文中搜索…" aria-label="搜索变更内容"/></span>
        {query && <span className="cw-search-count">{visibleChanges.length} / {value.changes.length} 项</span>}
        <span className="cw-legend" aria-label="颜色图例"><span><i className="cw-dot-same"/>未变</span><span><i className="cw-dot-before"/>变更前</span><span><i className="cw-dot-mod"/>修改</span><span><i className="cw-dot-add"/>新增</span><span><i className="cw-dot-del"/>删除</span></span>
        <span className="cw-saved-hint">记录已保存在 Polarion 项目</span>
      </div>
      <div className="cw-changes">
        {value.changes.length === 0 && <div className="cw-state">这两个时间点之间没有检测到正文或属性变化。</div>}
        {value.changes.length > 0 && visibleChanges.length === 0 && <div className="cw-state">没有匹配“{itemQuery.trim()}”的变更。</div>}
        {visibleChanges.map((change, index) => <ChangeItemView key={change.workItemId + ':' + change.kind} change={change} record={value} onlyChanges={onlyChanges} onOpenItem={onOpenItem} index={index} canOpen={canOpen}/>)}
      </div>
    </div>;
  };

  return <div className="change-workbench" ref={panel} style={{right, top, '--cw-right': right + 'px'} as React.CSSProperties} role="dialog" aria-label="变更管理" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (manualOpen) setManualOpen(false); else if (feishuOpen) setFeishuOpen(false); else onClose(); }
  }}>
    <header className="cw-head">
      <span className="cw-mark"><FileDiff size={16}/></span>
      <div className="cw-titles"><strong>变更管理</strong><span><b>项目 {target.projectId}</b> · {target.document.split('/').at(-1)}</span></div>
      <span className={'cw-connection ' + (workspace?.online ? 'online' : 'offline')} title={workspace?.online ? '已连接 Polarion，记录按项目共享' : 'Polarion 暂不可用，显示本机缓存'}>{workspace?.online ? '项目共享' : '本机缓存'}</span>
      <div className="cw-head-actions">
        <button className="cw-icon" title="飞书推送群（项目共享，一人配置全项目共用）" onClick={() => {setFeishuOpen(true); if (!feishuView) void loadFeishu();}}><Send size={14}/></button>
        <button className="cw-icon" title="刷新" aria-busy={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'cw-spin' : ''}/></button>
        <button ref={closeButton} className="cw-icon" title="关闭变更管理（Esc）" onClick={onClose}><X size={16}/></button>
      </div>
    </header>
    {error && <div className="cw-error" role="alert"><AlertTriangle size={13}/><span>{error}</span><button title="关闭提示" onClick={() => setError('')}><X size={12}/></button></div>}
    {notice && <div className="cw-notice"><span>{notice}</span><button title="关闭提示" onClick={() => setNotice('')}><X size={12}/></button></div>}
    <div className="cw-body">
      <aside className="cw-side">
        {renderSession()}
        <div className="cw-side-head"><span>变更历史</span><button onClick={openManual} title="选择两个时间点补建变更记录"><CalendarClock size={12}/>补建</button></div>
        <div className="cw-scope" role="tablist" aria-label="变更记录范围">
          <button type="button" role="tab" aria-selected={scope === 'document'} className={scope === 'document' ? 'on' : ''} onClick={() => setScope('document')}>本文档</button>
          <button type="button" role="tab" aria-selected={scope === 'project'} className={scope === 'project' ? 'on' : ''} onClick={() => setScope('project')}>本项目</button>
        </div>
        <input className="cw-search" value={recordQuery} onChange={event => setRecordQuery(event.target.value)} placeholder="搜索变更记录或文档…" aria-label="搜索变更记录"/>
        <div className="cw-records">
          {loading && !workspace && <div className="cw-side-state"><Loader2 size={13} className="cw-spin"/>读取中…</div>}
          {workspace && listRows.length === 0 && <div className="cw-side-state">{scope === 'project' ? '这个项目还没有变更记录。' : '这篇文档还没有变更记录。'}<br/>设定基准或按时间补建后，记录会写进当前项目。</div>}
          {!loading && listRows.length > 0 && filteredRows.length === 0 && <div className="cw-side-state">没有匹配的记录。</div>}
          {groupedRecords.map(([day, rows]) => <div className="cw-day" key={day}><div className="cw-day-head">{day}</div>{rows.map(row => <button key={row.id} className={'cw-record' + (selectedId === row.id ? ' selected' : '')} onClick={() => void openRecord(row.id)}>
            <span className="cw-record-time">{stamp(row.baselineAt).slice(11)}<br/>{stamp(row.endedAt).slice(11)}</span>
            <span className="cw-record-main"><b>{row.headline || `${row.changedItems} 个工作项变更`}</b><small>{scope === 'project' ? row.documentTitle + ' · ' : ''}{row.changedItems} 项 · 改 {row.modified} · 增 {row.added} · 删 {row.removed}</small></span>
            <ChevronRight size={13} className="cw-record-arrow"/>
          </button>)}</div>)}
        </div>
      </aside>
      <main className="cw-main">{record ? renderRecord(record) : renderOverview()}</main>
    </div>
    {feishuOpen && <div className="cw-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFeishuOpen(false); }}>
      <section className="cw-modal cw-feishu-modal" role="dialog" aria-modal="true" aria-label="飞书推送群" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFeishuOpen(false); } }}>
        <header><div><strong>飞书推送群 · 项目共享</strong><small>一人配置，本项目成员共用；「分享到飞书」把变更卡片发到全部群。</small></div><button title="关闭" onClick={() => setFeishuOpen(false)}><X size={14}/></button></header>
        <div className="cw-modal-body">
          {feishuBusy && !feishuView && <div className="cw-state"><Loader2 size={14} className="cw-spin"/>正在读取项目推送群…</div>}
          {feishuView && <>
            <div className="cw-feishu-meta">{feishuView.source === 'polarion' ? (feishuView.groups.length ? `已连接项目（工作项 ${feishuView.workItemId ?? '—'}）` : '项目里还没有推送群配置，添加第一个群并保存。') : 'Polarion 暂不可达，显示本机缓存；联网后点「重新加载」。'}</div>
            {feishuGroups.map(group => {const state = feishuTested[group.id]; return <div className="cw-feishu-row" key={group.id}>
              <div className="cw-feishu-line">
                <label><span>群名称</span><input maxLength={60} value={group.label} disabled={feishuBusy} onChange={event => patchFeishuGroup(group.id, {label: event.target.value})}/></label>
                <label><span>签名密钥 <small>机器人开启「签名校验」才填</small></span><input type="password" placeholder="可留空" maxLength={200} value={group.secret} disabled={feishuBusy} onChange={event => patchFeishuGroup(group.id, {secret: event.target.value})}/></label>
              </div>
              <label className="cw-feishu-webhook"><span>Webhook 地址 <small>群设置 → 群机器人 → 添加自定义机器人</small></span><input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…" maxLength={500} value={group.webhook} disabled={feishuBusy} onChange={event => patchFeishuGroup(group.id, {webhook: event.target.value})}/></label>
              <div className="cw-feishu-actions">
                <button type="button" className="secondary" disabled={feishuBusy || feishuTesting === group.id || !group.webhook.trim()} onClick={() => void testFeishuGroup(group)}>{feishuTesting === group.id ? '发送中…' : '发送测试卡片'}</button>
                <button type="button" className="cw-danger-link" disabled={feishuBusy} onClick={() => removeFeishuGroup(group.id)}><Trash2 size={12}/>删除</button>
                {state && <span className={state.ok ? 'cw-feishu-ok' : 'cw-feishu-error'} role="status">{state.ok ? '已发送，请在群里查看' : `发送失败：${state.error}`}</span>}
              </div>
            </div>;})}
            {feishuGroups.length === 0 && <p className="cw-modal-note">每个目标群添加一个「自定义机器人」，把 webhook 填进来；保存后本项目任何人点「分享到飞书」都会发到这些群。</p>}
            <button type="button" className="cw-feishu-add" disabled={feishuBusy} onClick={addFeishuGroup}><Plus size={13}/>新增飞书群</button>
          </>}
          {feishuError && <div className="cw-inline-error"><AlertTriangle size={12}/>{feishuError}</div>}
          {feishuNotice && <div className="cw-feishu-ok" role="status">{feishuNotice}</div>}
        </div>
        <footer>
          <button className="secondary" disabled={feishuBusy} onClick={() => void loadFeishu()}><RefreshCw size={13} className={feishuBusy ? 'cw-spin' : ''}/>重新加载</button>
          <button className="primary" disabled={feishuBusy || !feishuView || feishuDraft === null} onClick={() => void saveFeishuGroups()}>保存到项目</button>
        </footer>
      </section>
    </div>}
    {manualOpen && <div className="cw-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setManualOpen(false); }}>
      <section className="cw-modal" role="dialog" aria-modal="true" aria-label="选择变更基准" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setManualOpen(false); } }}>
        <header><div><strong>选择变更基准</strong><small>从最近变更时间线里选，不用手写时间；系统还原整篇文档后比较。</small></div><button title="关闭" onClick={() => setManualOpen(false)}><X size={14}/></button></header>
        <div className="cw-modal-body">
          {compareOptionsLoading && <div className="cw-state"><Loader2 size={14} className="cw-spin"/>正在读取最近变更时间线…</div>}
          {!compareOptionsLoading && compareOptions && <>
            <div className="cw-modal-section-title">最近变更 <span>点“对比这次”直接比较该次修改前后</span></div>
            <div className="cw-event-list">
              {compareOptions.events.length ? compareOptions.events.slice(0, 6).map(event => <button type="button" className="cw-event" key={event.at} onClick={() => void createManual(event.beforeAt, event.at)}>
                <span className="cw-event-time">{event.label}</span>
                <span className="cw-event-count">{event.count} 个工作项更新</span>
                <span className="cw-event-action">对比这次</span>
              </button>) : <p className="cw-modal-note">没有可用的历史变更点；可以直接比较“今天开始”和“现在”。</p>}
            </div>
            <div className="cw-modal-section-title">自定义区间 <span>变更前 / 变更后都从时间线里选</span></div>
            <div className="cw-range-picker">
              <label><span>变更前</span><select value={manualBeforeAt} onChange={event => setManualBeforeAt(Number(event.target.value))}>{compareOptions.points.map(point => <option key={point.at} value={point.at}>{point.label}</option>)}</select></label>
              <label><span>变更后</span><select value={manualAfterAt} onChange={event => setManualAfterAt(Number(event.target.value))}>{compareOptions.points.map(point => <option key={point.at} value={point.at}>{point.label}</option>)}</select></label>
            </div>
            <p className="cw-modal-note">时间点来自工作项更新历史，按分钟聚合；补建只包含当前仍在文档中的工作项。历史读取较多时可能需要几十秒。</p>
          </>}
        </div>
        <footer><button className="secondary" onClick={() => setManualOpen(false)}>取消</button><button className="primary" disabled={busy || compareOptionsLoading || !compareOptions} onClick={() => void createManual()}><CalendarClock size={13}/>开始比对</button></footer>
      </section>
    </div>}
    {confirmState && <div className="cw-modal-backdrop cw-confirm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !confirmBusy) setConfirmState(null); }}>
      <section className="cw-modal cw-confirm" role="alertdialog" aria-modal="true" aria-label={confirmState.title}>
        <header><div><strong>{confirmState.title}</strong><small>{confirmState.message}</small></div></header>
        <footer><button className="secondary" disabled={confirmBusy} onClick={() => setConfirmState(null)}>取消</button><button className={confirmState.danger ? 'cw-danger-confirm' : 'primary'} disabled={confirmBusy} onClick={() => void runConfirm()}>{confirmBusy ? '处理中…' : confirmState.label}</button></footer>
      </section>
    </div>}
  </div>;
}