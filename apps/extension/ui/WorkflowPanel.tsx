import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BookmarkPlus, ChevronDown, ChevronUp, ExternalLink, PenLine, Play, Plus, RefreshCw, Sparkles, Timer, Trash2, Workflow, X, Zap } from 'lucide-react';
import { rpc } from '../lib/client';
import type { Guideline, Macro, Target, WorkflowDef, WorkflowHistoryItem, WorkflowRunView, WorkflowStep } from '../../../packages/protocol/index';
import './workflows.css';

type BatchSession = { workItemId: string; sessionId: string };
type PanelProps = {
  target: Target;
  defs: WorkflowDef[];
  guidelines: Guideline[];
  active: WorkflowRunView | null;
  definitionsRequest?: number;
  onDefsChange: (rows: WorkflowDef[]) => void;
  onRun: (def: WorkflowDef, note: string) => Promise<void>;
  onPlan: (goal: string) => Promise<void>;
  onCaptureMacro: (name: string, count: number) => Promise<Macro>;
  onRunMacro: (id: string) => Promise<void>;
  onRunBatch: (def: WorkflowDef, ids: string[], note: string) => Promise<BatchSession[]>;
  onOpenSession: (sessionId: string) => Promise<void>;
  onClose: () => void;
};
type Notice = { error?: boolean; text: string };
const runStatusLabels = { running: '运行中', paused: '已暂停', done: '已完成', failed: '失败', cancelled: '已终止' };
const stepStatusLabels = { pending: '未执行', running: '运行中', done: '完成', failed: '失败', cancelled: '已取消', interrupted: '被打断' };
const actionErrors: Record<string, string> = {
  MACRO_NAME_EXISTS: '已有同名宏，请更换名称',
  MACRO_PROJECT_MISMATCH: '宏与当前会话属于不同项目',
  WORKFLOW_NAME_EXISTS: '已有同名工作流，请更换名称',
  WORKFLOW_SESSION_BUSY: '当前会话已有工作流，请先继续或终止该流程',
  WORKFLOW_PROJECT_MISMATCH: '工作流与当前目标属于不同项目',
  GUIDELINE_NOT_FOUND: '所选附加指令已被删除，请重新选择',
  HOST_UNAVAILABLE: '无法连接本地 Host',
};
function errorText(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return actionErrors[raw] ? `${actionErrors[raw]}（${raw}）` : raw;
}
const emptyStep = (steps: WorkflowStep[]): WorkflowStep => {
  let number = steps.length + 1;
  while (steps.some(step => step.id === `s${number}`)) number++;
  return { id: `s${number}`, title: '', prompt: '', pause: false };
};

function DefinitionSteps({ def, guidelines }: { def: WorkflowDef; guidelines: Guideline[] }) {
  return <details className="workflow-details">
    <summary><ChevronDown size={14}/>查看步骤（{def.steps.length}）</summary>
    <ol className="workflow-evidence-list">{def.steps.map((step, index) => {
      const retryTo = step.check?.retryTo.toLowerCase();
      const retryTarget = def.steps.find(other => other.id === retryTo);
      return <li key={step.id}>
        <span className="workflow-step-index">{index + 1}</span>
        <div><strong>{step.title}</strong><small className="workflow-step-meta">
          <code>{step.id}</code>{step.pause && ' · 完成后暂停确认'}
          {step.guidelineId && ` · 附加指令 ${guidelines.find(g => g.id === step.guidelineId)?.name ?? step.guidelineId}`}
          {step.check && ` · 检查步，失败回到「${retryTarget?.title ?? step.check.retryTo}」，最多返工 ${step.check.maxRetries} 次`}
        </small><p className="workflow-evidence">{step.prompt}</p></div>
      </li>;
    })}</ol>
  </details>;
}

function WorkflowEditor({ draft, setDraft, guidelines, busy, onSave, onCancel }: {
  draft: WorkflowDef; setDraft: (draft: WorkflowDef) => void; guidelines: Guideline[]; busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  const patchStep = (index: number, patch: Partial<WorkflowStep>) => setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, ...patch } : step) });
  const moveStep = (index: number, delta: number) => {
    const steps = [...draft.steps];
    [steps[index], steps[index + delta]] = [steps[index + delta]!, steps[index]!];
    setDraft({ ...draft, steps });
  };
  return <fieldset className="workflow-editor" disabled={busy}>
    <label>名称<input autoFocus value={draft.name} maxLength={60} aria-label="工作流名称" placeholder="需求三连审" onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
    <label>描述<textarea rows={2} value={draft.description} maxLength={300} aria-label="工作流描述" placeholder="这个流程做什么、什么时候用" onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
    <div className="workflow-steps">{draft.steps.map((step, index) => {
      const earlier = draft.steps.slice(0, index);
      const check = step.check;
      return <div className="workflow-step" key={step.id}>
        <div className="workflow-step-head"><span className="workflow-step-index">{index + 1}</span><code>{step.id}</code>
          <div className="workflow-step-tools">
            <button className="icon" title="上移" aria-label={`上移第 ${index + 1} 步`} disabled={index === 0} onClick={() => moveStep(index, -1)}><ChevronUp size={15}/></button>
            <button className="icon" title="下移" aria-label={`下移第 ${index + 1} 步`} disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}><ChevronDown size={15}/></button>
            <button className="icon danger" title="删除此步骤" aria-label={`删除第 ${index + 1} 步`} disabled={draft.steps.length <= 1} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}><Trash2 size={14}/></button>
          </div>
        </div>
        <input value={step.title} maxLength={80} aria-label={`第 ${index + 1} 步标题`} placeholder="步骤标题" onChange={e => patchStep(index, { title: e.target.value })}/>
        <textarea rows={3} value={step.prompt} maxLength={20000} aria-label={`第 ${index + 1} 步提示词`} placeholder="提示词可引用 {{item}}、{{prev}} 或 {{steps.步骤id}}" onChange={e => patchStep(index, { prompt: e.target.value })}/>
        <div className="workflow-step-foot">
          {(guidelines.length > 0 || step.guidelineId) && <select value={step.guidelineId ?? ''} aria-label={`第 ${index + 1} 步附加指令`} onChange={e => patchStep(index, { guidelineId: e.target.value || undefined })}>
            <option value="">不附加指令</option>{step.guidelineId && !guidelines.some(g => g.id === step.guidelineId) && <option value={step.guidelineId}>{step.guidelineId}</option>}
            {guidelines.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>}
          {(index > 0 || check) && <label><input type="checkbox" checked={!!check} onChange={e => patchStep(index, { check: e.target.checked ? { retryTo: earlier.at(-1)!.id, maxRetries: 1 } : undefined })}/>检查步</label>}
          <label><input type="checkbox" checked={step.pause} onChange={e => patchStep(index, { pause: e.target.checked })}/>完成后暂停确认</label>
          {check && <div className="workflow-checks">
            <label>不通过回到<select value={check.retryTo.toLowerCase()} aria-label={`第 ${index + 1} 步返工目标`} onChange={e => patchStep(index, { check: { ...check, retryTo: e.target.value } })}>
              {!earlier.some(other => other.id === check.retryTo.toLowerCase()) && <option value={check.retryTo.toLowerCase()}>请选择更早的步骤</option>}
              {earlier.map((other, i) => <option key={other.id} value={other.id}>{i + 1} · {other.title || other.id}</option>)}
            </select></label>
            <label>返工上限<input type="number" min={1} max={5} value={check.maxRetries} aria-label={`第 ${index + 1} 步返工上限`} onChange={e => patchStep(index, { check: { ...check, maxRetries: Math.min(5, Math.max(1, Math.trunc(Number(e.target.value)) || 1)) } })}/></label>
          </div>}
        </div>
      </div>;
    })}</div>
    <button className="workflow-add-step" disabled={draft.steps.length >= 30} onClick={() => setDraft({ ...draft, steps: [...draft.steps, emptyStep(draft.steps)] })}><Plus size={14}/>添加步骤</button>
    <footer><small>各步依次在同一会话执行。检查步可返工，证据不足时暂停等待人工确认。</small>
      <div className="workflow-actions"><button className="secondary" onClick={onCancel}>取消</button><button className="primary" onClick={onSave}>{busy ? '保存中…' : '保存'}</button></div>
    </footer>
  </fieldset>;
}

function ScheduleEditor({ label, savedTime, savedDocument, targetDocument, busy, onSave }: {
  label: string; savedTime?: string; savedDocument?: string; targetDocument: string; busy: string; onSave: (time: string) => void;
}) {
  const [time, setTime] = useState(savedTime ?? '');
  return <div className="workflow-inline-form" role="group" aria-label={`${label}定时设置`} aria-busy={busy === 'schedule'}>
    <label className="workflow-time">每日定时<input type="time" aria-label={`${label} 定时`} value={time} disabled={!!busy} onChange={event => setTime(event.target.value)}/></label>
    <small>{savedTime ? `当前计划为每日 ${savedTime}${savedDocument ? ` · ${savedDocument}` : ''}` : '尚未设置定时'}<br/>保存到当前文档 {targetDocument}</small>
    <div className="workflow-actions">
      <button className="primary" disabled={!!busy || !time || (time === savedTime && targetDocument === savedDocument)} onClick={() => onSave(time)}>{busy === 'schedule' ? '更新中…' : '保存定时'}</button>
      {savedTime && <button className="secondary" disabled={!!busy} onClick={() => onSave('')}>取消定时</button>}
    </div>
  </div>;
}

function BatchForm({ def, note, busy, onRun, onCancel }: {
  def: WorkflowDef; note: string; busy: string; onRun: (ids: string[]) => void; onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const tokens = text.split(/[\s,，、]+/).filter(Boolean);
  const ids = [...new Set(tokens)];
  const duplicates = tokens.length - ids.length;
  const invalid = ids.length > 10 ? '每批最多 10 个工作项，请减少编号。' : ids.some(id => id.length > 100) ? '单个工作项编号最多 100 个字符。' : '';
  const helpId = useId();
  return <div className="workflow-inline-form workflow-batch" role="group" aria-label={`批量运行 ${def.name}`}>
    <label>批量工作项编号<textarea autoFocus rows={3} aria-label="批量工作项编号" aria-invalid={!!invalid} aria-describedby={helpId} placeholder={'SPE-101\nSPE-102'} value={text} disabled={!!busy} onChange={event => setText(event.target.value)}/></label>
    <small id={helpId}>每行一个编号。每个工作项使用独立会话，最多 10 个。{note && `本批运行附注为「${note}」。`}</small>
    <small className={invalid ? 'workflow-invalid' : ''} role="status">已选 {ids.length} 个{duplicates > 0 && ` · 已合并 ${duplicates} 个重复编号`}{invalid && ` · ${invalid}`}</small>
    <div className="workflow-actions"><button className="primary" disabled={!!busy || !ids.length || !!invalid} onClick={() => onRun(ids)}>{busy === 'batch' ? '正在启动…' : '开始批量'}</button><button className="secondary" disabled={!!busy} onClick={onCancel}>取消</button></div>
  </div>;
}

function TraceCard({ run, first, current, busy, onOpen }: { run: WorkflowHistoryItem; first: boolean; current: boolean; busy: boolean; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(first);
  const stepsId = useId();
  return <article className="workflow-trace-run">
    <div className="workflow-trace-head"><strong>{run.defName}</strong><span className={'wf-status ' + run.status}>{runStatusLabels[run.status]}</span></div>
    <small className="workflow-trace-meta"><time dateTime={new Date(run.startedAt).toISOString()}>{new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })}</time>{run.workItemId && <code>{run.workItemId}</code>}</small>
    {run.note && <p className="workflow-run-note">{run.note}</p>}{run.error && <p className="workflow-run-note workflow-invalid">{run.error}</p>}
    <div className="workflow-actions">
      <button className="secondary" aria-expanded={expanded} aria-controls={expanded ? stepsId : undefined} onClick={() => setExpanded(value => !value)}><ChevronDown size={13} className={expanded ? 'workflow-arrow-open' : ''}/>步骤与结果（{run.steps.length}）</button>
      {(run.sessionId || current) && <button className="secondary" disabled={busy} onClick={onOpen}><ExternalLink size={12}/>查看会话全文</button>}
    </div>
    {expanded && <ol id={stepsId} className="workflow-evidence-list">{run.steps.map((step, index) => <li className={'workflow-trace-step ' + step.status} key={step.stepId}>
      <span className="workflow-step-index">{index + 1}</span><div><strong>{step.title}</strong>
        <small className="workflow-step-meta">{stepStatusLabels[step.status]}{step.checkRule && ' · 检查步'}{step.retries ? ` · 返工 ${step.retries} 次` : ''}</small>
        {step.resultPreview && <p className="workflow-evidence"><span className="workflow-result-label">结果摘要</span>{step.resultPreview}</p>}
      </div>
    </li>)}</ol>}
  </article>;
}

function WorkflowTrace({ projectId, active, busy, onOpenSession, onClose }: { projectId: string; active: WorkflowRunView | null; busy: boolean; onOpenSession: (id: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<WorkflowHistoryItem[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      setLoading(true); setError('');
      try {
        const runs = await rpc<WorkflowHistoryItem[]>({ method: 'workflows.history', projectId, limit: 20 });
        if (disposed) return;
        setRows(runs);
        if (runs.some(run => run.status === 'running')) timer = setTimeout(() => void read(), 5000);
      } catch (cause) { if (!disposed) setError('读取运行轨迹失败。' + errorText(cause)); }
      finally { if (!disposed) setLoading(false); }
    };
    void read();
    return () => { disposed = true; clearTimeout(timer); };
  }, [projectId, revision, active?.id, active?.updatedAt]);
  return <div className="workflow-trace">
    <div className="workflow-section-head"><strong>{rows ? `最近 ${rows.length} 次运行` : '最近运行'}</strong><button className="secondary" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={12}/>{loading ? '读取中…' : '刷新轨迹'}</button></div>
    {error && <p className="workflow-inline-error" role="alert">{error}</p>}
    {rows === null && loading && <p className="workflow-empty" role="status">正在读取运行轨迹…</p>}
    {rows?.length === 0 && !error && <p className="workflow-empty">还没有运行记录。工作流执行后可在这里查看每步结果与返工次数。</p>}
    {rows?.map((run, index) => <TraceCard key={run.id} run={run} first={index === 0} current={run.id === active?.id} busy={busy} onOpen={() => run.sessionId ? onOpenSession(run.sessionId) : onClose()}/>)}
  </div>;
}

export function WorkflowPanel(props: PanelProps) {
  return <WorkflowWorkspace key={JSON.stringify([props.target.projectId, props.target.document])} {...props}/>;
}

function WorkflowWorkspace({ target, defs, guidelines, active, definitionsRequest = 0, onDefsChange, onRun, onPlan, onCaptureMacro, onRunMacro, onRunBatch, onOpenSession, onClose }: PanelProps) {
  const [tab, setTab] = useState<'design' | 'trace'>('design');
  const [draft, setDraft] = useState<WorkflowDef | null>(null);
  const [editing, setEditing] = useState(false);
  const [definitionsRevision, setDefinitionsRevision] = useState(0);
  const [definitionsError, setDefinitionsError] = useState('');
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [note, setNote] = useState('');
  const [goal, setGoal] = useState('');
  const [keeping, setKeeping] = useState<{ id: string; name: string } | null>(null);
  const [deleteArmed, setDeleteArmed] = useState('');
  const [scheduleFor, setScheduleFor] = useState('');
  const [batchFor, setBatchFor] = useState('');
  const [receipt, setReceipt] = useState<{ defId: string; sessions: BatchSession[] } | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [macroName, setMacroName] = useState('');
  const [macroCount, setMacroCount] = useState(3);
  const [macroRevision, setMacroRevision] = useState(0);
  const [macroListError, setMacroListError] = useState('');
  const [macroLoading, setMacroLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const action = useRef('');
  const mounted = useRef(false);
  const latestDefs = useRef(defs);
  const definitionWrites = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const definitions = useRef<HTMLHeadingElement>(null);
  const designTab = useRef<HTMLButtonElement>(null);
  const traceTab = useRef<HTMLButtonElement>(null);
  const tabId = useId();
  const projectDefs = defs.filter(def => def.projectId === target.projectId);
  const dynamicDefs = projectDefs.filter(def => def.origin === 'dynamic');
  const savedDefs = projectDefs.filter(def => def.origin !== 'dynamic');
  useLayoutEffect(() => { latestDefs.current = defs; }, [defs]);
  useLayoutEffect(() => {
    mounted.current = true;
    const element = panel.current!;
    const root = element.getRootNode() as ShadowRoot | Document;
    const previous = root.activeElement;
    designTab.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      if (previous instanceof HTMLElement && previous.isConnected && (!root.activeElement || element.contains(root.activeElement))) previous.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (definitionsRequest <= 0) return;
    setTab('design'); setEditing(false);
    // The definitions list is mounted after leaving the editor. Keep the document behind it stationary.
    const frame = requestAnimationFrame(() => {
      const heading = definitions.current;
      const viewport = heading?.closest<HTMLElement>('.workflow-viewport');
      if (!heading || !viewport) return;
      heading.focus({ preventScroll: true });
      viewport.scrollTop += heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 6;
    });
    return () => cancelAnimationFrame(frame);
  }, [definitionsRequest]);
  useEffect(() => {
    let disposed = false;
    const writes = definitionWrites.current;
    setDefinitionsLoading(true); setDefinitionsError('');
    void rpc<WorkflowDef[]>({ method: 'workflows.list', projectId: target.projectId })
      .then(rows => {
        if (disposed || definitionWrites.current !== writes) return;
        latestDefs.current = rows;
        onDefsChange(rows);
      })
      .catch(cause => { if (!disposed && definitionWrites.current === writes) setDefinitionsError('读取工作流定义失败。' + errorText(cause)); })
      .finally(() => { if (!disposed) setDefinitionsLoading(false); });
    return () => { disposed = true; };
  }, [target.projectId, active?.defId, definitionsRequest, definitionsRevision, onDefsChange]);
  useEffect(() => {
    let disposed = false;
    setMacroLoading(true); setMacroListError('');
    void rpc<Macro[]>({ method: 'macros.list', projectId: target.projectId })
      .then(rows => { if (!disposed) setMacros(rows); })
      .catch(cause => { if (!disposed) setMacroListError('读取宏失败。' + errorText(cause)); })
      .finally(() => { if (!disposed) setMacroLoading(false); });
    return () => { disposed = true; };
  }, [target.projectId, macroRevision]);

  async function perform(key: string, failure: string, operation: () => Promise<string | void>) {
    if (action.current) return;
    action.current = key; setBusy(key); setNotice(null);
    try {
      const text = await operation();
      if (mounted.current && text) setNotice({ text });
    } catch (cause) { if (mounted.current) setNotice({ error: true, text: failure + '。' + errorText(cause) }); }
    finally { action.current = ''; if (mounted.current) setBusy(''); }
  }
  function publish(rows: WorkflowDef[]) {
    if (!mounted.current) return;
    definitionWrites.current++;
    latestDefs.current = rows;
    onDefsChange(rows);
  }
  function replaceDef(def: WorkflowDef) {
    const rows = latestDefs.current.filter(row => row.projectId === target.projectId);
    publish(rows.some(row => row.id === def.id) ? rows.map(row => row.id === def.id ? def : row) : [def, ...rows]);
  }
  function startEditor(def?: WorkflowDef) {
    if (def) setDraft(draft?.id === def.id ? draft : def);
    else if (!draft) setDraft({ id: crypto.randomUUID(), projectId: target.projectId, name: '', description: '', origin: 'manual', createdAt: Date.now(), updatedAt: 0, steps: [{ ...emptyStep([]), title: '第一步' }] });
    setTab('design'); setEditing(true); setNotice(null); setDeleteArmed('');
  }
  function cancelEditor() {
    setDraft(null); setEditing(false); setNotice(null);
    if (designTab.current?.getAttribute('aria-selected') === 'true') designTab.current.focus({ preventScroll: true });
  }
  function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    let invalid = !name ? '请填写工作流名称。' : !draft.steps.length ? '至少需要一个步骤。' : '';
    for (const [index, step] of draft.steps.entries()) {
      if (invalid) break;
      if (!step.title.trim()) invalid = `第 ${index + 1} 步缺少标题。`;
      else if (!step.prompt.trim()) invalid = `第 ${index + 1} 步「${step.title}」缺少提示词。`;
      else if (step.check && !draft.steps.slice(0, index).some(other => other.id === step.check!.retryTo.toLowerCase())) invalid = `第 ${index + 1} 步的返工目标必须位于该步之前。`;
    }
    if (invalid) { setNotice({ error: true, text: invalid }); return; }
    void perform('save', '保存工作流失败', async () => {
      // Scheduling can be changed while this draft is parked in the definitions list.
      const live = latestDefs.current.find(row => row.id === draft.id) ?? draft;
      const saved = await rpc<WorkflowDef>({ method: 'workflows.save', def: { ...draft, scheduleAt: live.scheduleAt, document: live.document, name, description: draft.description.trim(), steps: draft.steps.map(step => ({ ...step, title: step.title.trim(), prompt: step.prompt.trim() })) } });
      replaceDef(saved); cancelEditor(); return `已保存「${saved.name}」。`;
    });
  }
  function keepDef() {
    if (!keeping) return;
    void perform('keep', '保存工作流失败', async () => {
      const saved = await rpc<WorkflowDef>({ method: 'workflows.keep', id: keeping.id, name: keeping.name.trim() || '动态工作流' });
      replaceDef(saved); setKeeping(null); return `已保存「${saved.name}」，可在定义列表中再次运行。`;
    });
  }
  function remove(id: string, name: string, kind: 'workflow' | 'macro') {
    if (deleteArmed !== id) { setDeleteArmed(id); return; }
    void perform('delete', '删除失败', async () => {
      await rpc({ method: kind === 'workflow' ? 'workflows.delete' : 'macros.delete', id });
      if (kind === 'workflow') {
        publish(latestDefs.current.filter(row => row.id !== id));
        if (draft?.id === id) cancelEditor();
      } else { setMacros(rows => rows.filter(row => row.id !== id)); setMacroRevision(n => n + 1); }
      setDeleteArmed(''); return `已删除「${name}」。`;
    });
  }
  function saveSchedule(item: WorkflowDef | Macro, kind: 'workflow' | 'macro', time: string) {
    void perform('schedule', '保存定时失败', async () => {
      if (kind === 'workflow') replaceDef(await rpc<WorkflowDef>({ method: 'workflows.schedule', id: item.id, scheduleAt: time, target }));
      else {
        const saved = await rpc<Macro>({ method: 'macros.schedule', id: item.id, scheduleAt: time, target });
        setMacros(rows => rows.map(row => row.id === saved.id ? saved : row)); setMacroRevision(n => n + 1);
      }
      setScheduleFor(''); return time ? `「${item.name}」已设为每日 ${time} 执行。` : `已取消「${item.name}」的定时。`;
    });
  }
  function openSession(id: string) { void perform('session', '打开会话失败', () => onOpenSession(id)); }
  function plan() {
    if (goal.trim()) void perform('plan', '拆解工作流失败', async () => { await onPlan(goal.trim()); setGoal(''); });
  }
  function scheduleButton(item: WorkflowDef | Macro) {
    return <button className="secondary" disabled={!!busy} aria-expanded={scheduleFor === item.id} title={`设置「${item.name}」的每日定时`} onClick={() => { setScheduleFor(scheduleFor === item.id ? '' : item.id); setBatchFor(''); }}><Timer size={13}/>{item.scheduleAt ? `每日 ${item.scheduleAt}` : '定时'}</button>;
  }
  function deleteButton(item: WorkflowDef | Macro, kind: 'workflow' | 'macro') {
    return deleteArmed === item.id ? <><button className="workflow-delete" disabled={!!busy} onClick={() => remove(item.id, item.name, kind)}>确认删除</button><button className="secondary" disabled={!!busy} onClick={() => setDeleteArmed('')}>取消</button></> : <button className="icon danger" disabled={!!busy} title={kind === 'macro' ? '删除宏' : '删除工作流'} aria-label={`删除${kind === 'macro' ? '宏' : '工作流'} ${item.name}`} onClick={() => remove(item.id, item.name, kind)}><Trash2 size={14}/></button>;
  }
  function renderDefinition(def: WorkflowDef) {
    const dynamic = def.origin === 'dynamic';
    return <article className={'workflow-row' + (dynamic ? ' dynamic' : '')} key={def.id} aria-label={def.name}>
      <div className="workflow-row-main"><strong>{def.name}</strong>{def.description && <p>{def.description}</p>}</div>
      <div className="workflow-row-actions">
        <button className="secondary" disabled={!!busy} onClick={() => void perform('run:' + def.id, '启动工作流失败', () => onRun(def, note.trim()))}><Play size={12}/>{busy === 'run:' + def.id ? '启动中…' : '运行'}</button>
        {dynamic ? <button className="secondary" disabled={!!busy} aria-expanded={keeping?.id === def.id} onClick={() => setKeeping(keeping?.id === def.id ? null : { id: def.id, name: def.name.replace(/^动态 · /, '') })}><BookmarkPlus size={13}/>保存复用</button> : <>
          <button className="secondary" disabled={!!busy} aria-expanded={batchFor === def.id} onClick={() => { setBatchFor(batchFor === def.id ? '' : def.id); setScheduleFor(''); }}>批量</button>
          {scheduleButton(def)}<button className="icon" title="编辑" aria-label={`编辑 ${def.name}`} disabled={!!busy} onClick={() => startEditor(def)}><PenLine size={14}/></button>
        </>}{deleteButton(def, 'workflow')}
      </div>
      {keeping?.id === def.id && <form className="workflow-inline-form" onSubmit={e => { e.preventDefault(); keepDef(); }} onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); setKeeping(null); } }}>
        <label>保存名称<input autoFocus value={keeping.name} maxLength={60} aria-label="保存名称" placeholder="动态工作流" disabled={!!busy} onChange={e => setKeeping({ id: def.id, name: e.target.value })}/></label>
        <div className="workflow-actions"><button className="primary" disabled={!!busy}>保存</button><button type="button" className="secondary" disabled={!!busy} onClick={() => setKeeping(null)}>取消</button></div>
      </form>}
      {scheduleFor === def.id && <ScheduleEditor label={'工作流 ' + def.name} savedTime={def.scheduleAt} savedDocument={def.document} targetDocument={target.document} busy={busy} onSave={time => saveSchedule(def, 'workflow', time)}/>}
      {batchFor === def.id && <BatchForm def={def} note={note.trim()} busy={busy} onCancel={() => setBatchFor('')} onRun={ids => void perform('batch', '批量启动失败', async () => {
        const sessions = await onRunBatch(def, ids, note.trim());
        setReceipt({ defId: def.id, sessions }); setBatchFor(''); return `「${def.name}」已启动 ${sessions.length} 个独立会话。`;
      })}/>}
      {receipt?.defId === def.id && <div className="workflow-inline-form workflow-receipt"><strong>批量运行会话（{receipt.sessions.length}）</strong><div className="workflow-actions">{receipt.sessions.map(row => <button key={row.sessionId} className="secondary" disabled={!!busy} title={`打开 ${row.workItemId} 的运行会话`} onClick={() => openSession(row.sessionId)}><ExternalLink size={12}/>{row.workItemId}</button>)}</div><button className="workflow-text-button" onClick={() => setTab('trace')}>查看运行轨迹</button></div>}
      <DefinitionSteps def={def} guidelines={guidelines}/>
    </article>;
  }
  return <section ref={panel} className="workflow-panel" aria-label="工作流管理" onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault(); event.stopPropagation();
    if (tab === 'design' && editing) { if (!busy) cancelEditor(); }
    else onClose();
  }}>
    <header><div><strong>工作流</strong><small>输入 /wf:名称 运行已保存的流程</small></div>
      {(!editing || tab !== 'design') && <button className="primary" disabled={!!busy} onClick={() => startEditor()}>{draft ? <PenLine size={14}/> : <Plus size={14}/>} {draft ? '继续编辑' : '新建'}</button>}
      <button className="icon" aria-label="关闭工作流面板" title="关闭工作流面板" onClick={onClose}><X size={16}/></button>
    </header>
    {notice && <div className={notice.error ? 'workflow-notice error' : 'workflow-notice'} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button className="icon" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={13}/></button></div>}
    <div className="workflow-tabs" role="tablist" aria-label="工作流视图" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 'design' : event.key === 'End' ? 'trace' : tab === 'design' ? 'trace' : 'design';
      setTab(next); (next === 'design' ? designTab : traceTab).current?.focus();
    }}>
      <button ref={designTab} id={tabId + '-design'} role="tab" aria-controls={tabId + '-definitions'} aria-selected={tab === 'design'} tabIndex={tab === 'design' ? 0 : -1} onClick={() => setTab('design')}>设计</button>
      <button ref={traceTab} id={tabId + '-trace'} role="tab" aria-controls={tabId + '-history'} aria-selected={tab === 'trace'} tabIndex={tab === 'trace' ? 0 : -1} onClick={() => setTab('trace')}>运行轨迹</button>
    </div>
    <div id={tabId + '-definitions'} role="tabpanel" aria-labelledby={tabId + '-design'} className="workflow-viewport" hidden={tab !== 'design'}>
      {editing && draft ? <WorkflowEditor draft={draft} setDraft={setDraft} guidelines={guidelines.filter(g => g.kind === 'send')} busy={!!busy} onSave={saveDraft} onCancel={cancelEditor}/> : <div className="workflow-listing">
        <div className="workflow-plan-row"><label className="workflow-note-row">说出目标<textarea rows={2} value={goal} maxLength={2000} aria-label="动态工作流目标" placeholder="评审 SPE-951 与模型的一致性" disabled={!!busy} onChange={event => setGoal(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); plan(); } }}/></label>
          <button className="primary" disabled={!!busy || !goal.trim()} onClick={plan}><Sparkles size={13}/>{busy === 'plan' ? '启动中…' : '拆解并执行'}</button></div>
        <label className="workflow-note-row">运行附注<textarea rows={1} value={note} maxLength={2000} aria-label="本次运行附注" placeholder="可选，随工作流的每一步发送" disabled={!!busy} onChange={event => setNote(event.target.value)}/></label>
        {active && ['running', 'paused'].includes(active.status) && <p className="workflow-active-hint">{active.status === 'paused' ? `「${active.defName}」已暂停。` : `「${active.defName}」正在运行，第 ${Math.min(active.currentIndex + 1, active.total)}/${active.total} 步。`} <button className="workflow-text-button" onClick={onClose}>返回当前会话</button></p>}
        {dynamicDefs.length > 0 && <section><div className="workflow-section-head"><h3>动态拆解</h3></div>{dynamicDefs.map(renderDefinition)}</section>}
        <section><div className="workflow-section-head"><h3 tabIndex={-1} ref={definitions}>工作流定义</h3><div className="workflow-actions">
          <button className="icon" title="刷新工作流定义" aria-label="刷新工作流定义" disabled={definitionsLoading || !!busy} onClick={() => setDefinitionsRevision(n => n + 1)}><RefreshCw size={13}/></button>
          <button className="secondary workflow-seed" disabled={!!busy} onClick={() => void perform('seed', '安装模板失败', async () => {
            const rows = await rpc<WorkflowDef[]>({ method: 'workflows.seed', projectId: target.projectId });
            publish(rows); setDefinitionsError(''); return `内置模板已就绪。当前共有 ${rows.filter(row => row.origin !== 'dynamic').length} 个已保存的工作流。`;
          })}>{busy === 'seed' ? '安装中…' : '安装内置模板'}</button>
        </div></div>
          {definitionsError && <p className="workflow-inline-error" role="alert">{definitionsError}</p>}
          {savedDefs.map(renderDefinition)}
          {!savedDefs.length && !definitionsError && <p className="workflow-empty" role="status">{definitionsLoading ? '正在读取工作流定义…' : '还没有保存的工作流。可安装内置模板，也可新建或保存一次动态拆解。'}</p>}
        </section>
        <section><div className="workflow-section-head"><h3>宏</h3></div><div className="workflow-macro-form">
          <label className="workflow-macro-name">宏名称<input aria-label="宏名称" placeholder="接口复核" maxLength={60} value={macroName} disabled={!!busy} onChange={event => setMacroName(event.target.value)}/></label>
          <label>最近指令数<input aria-label="录制条数" type="number" min={1} max={10} value={macroCount} disabled={!!busy} onChange={event => setMacroCount(Math.min(10, Math.max(1, Math.trunc(Number(event.target.value)) || 1)))}/></label>
          <button className="primary" disabled={!macroName.trim() || !!busy} title="录制当前会话最近发送的普通指令" onClick={() => void perform('capture', '录制宏失败', async () => {
            const macro = await onCaptureMacro(macroName.trim(), macroCount);
            setMacros(rows => [macro, ...rows.filter(row => row.id !== macro.id)]); setMacroName(''); setMacroRevision(n => n + 1);
            return `已录制「${macro.name}」，共 ${macro.steps.length} 条指令。`;
          })}><Zap size={13}/>{busy === 'capture' ? '录制中…' : '录制'}</button>
        </div>
        {macroListError && <div className="workflow-inline-error" role="alert">{macroListError} <button className="workflow-text-button" onClick={() => setMacroRevision(n => n + 1)}>重新读取</button></div>}
        {!macros.length && !macroListError && <small role="status">{macroLoading ? '正在读取宏…' : '尚未录制宏。可以录制当前会话最近的普通指令，按原顺序重放。'}</small>}
        {macros.map(macro => <article className="workflow-row" key={macro.id} aria-label={macro.name}>
          <div className="workflow-row-main"><strong>{macro.name}</strong></div><div className="workflow-row-actions">
            <button className="secondary" disabled={!!busy} onClick={() => void perform('replay:' + macro.id, '重放宏失败', () => onRunMacro(macro.id))}><Play size={12}/>{busy === 'replay:' + macro.id ? '启动中…' : '重放'}</button>
            {scheduleButton(macro)}{deleteButton(macro, 'macro')}
          </div>
          {scheduleFor === macro.id && <ScheduleEditor label={'宏 ' + macro.name} savedTime={macro.scheduleAt} savedDocument={macro.document} targetDocument={target.document} busy={busy} onSave={time => saveSchedule(macro, 'macro', time)}/>}
          <details className="workflow-details"><summary><ChevronDown size={14}/>查看指令（{macro.steps.length}）</summary><ol className="workflow-evidence-list">{macro.steps.map((text, i) => <li key={i}><span className="workflow-step-index">{i + 1}</span><p className="workflow-evidence">{text}</p></li>)}</ol></details>
        </article>)}
        </section>
        <footer><Workflow size={14}/><span>输入 /wf::目标 拆解并执行，也可在对话中使用 save_workflow 保存流程。</span></footer>
      </div>}
    </div>
    <div id={tabId + '-history'} role="tabpanel" aria-labelledby={tabId + '-trace'} className="workflow-viewport" hidden={tab !== 'trace'}>
      {tab === 'trace' && <WorkflowTrace projectId={target.projectId} active={active} busy={!!busy} onOpenSession={openSession} onClose={onClose}/>}
    </div>
  </section>;
}
