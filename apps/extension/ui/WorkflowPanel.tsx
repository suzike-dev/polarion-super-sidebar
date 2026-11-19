import React, { useCallback, useEffect, useState } from 'react';
import { Workflow, Plus, Trash2, ChevronUp, ChevronDown, Play, X, PenLine, Sparkles, BookmarkPlus, Timer, Zap } from 'lucide-react';
import { rpc } from '../lib/client';
import type { Guideline, Macro, Target, WorkflowDef, WorkflowHistoryItem, WorkflowRunView } from '../../../packages/protocol/index';
import './workflows.css';

/** 编辑态的步骤草稿：guidelineId 空串表示不附加；check=null 表示普通步骤。 */
type StepDraft = { id: string; title: string; prompt: string; guidelineId: string; pause: boolean; check: { retryTo: string; maxRetries: number } | null };
type DefDraft = { id: string; name: string; description: string; steps: StepDraft[]; createdAt: number };

const runStatusLabels: Record<string, string> = { running: '运行中', paused: '已暂停', done: '已完成', failed: '失败', cancelled: '已终止' };
const stepStatusLabels: Record<string, string> = { pending: '未执行', running: '运行中', done: '完成', failed: '失败', cancelled: '取消', interrupted: '被打断' };
const emptyStep = (): StepDraft => ({ id: '', title: '', prompt: '', guidelineId: '', pause: false, check: null });
const toDraft = (def: WorkflowDef): DefDraft => ({ id: def.id, name: def.name, description: def.description, createdAt: def.createdAt, steps: def.steps.map(step => ({ id: step.id, title: step.title, prompt: step.prompt, guidelineId: step.guidelineId ?? '', pause: step.pause, check: step.check ? { retryTo: step.check.retryTo, maxRetries: step.check.maxRetries } : null })) });

export function WorkflowPanel({ target, defs, guidelines, active, onDefsChange, onRun, onPlan, onCaptureMacro, onRunMacro, onRunBatch, onClose }: {
  target: Target; defs: WorkflowDef[]; guidelines: Guideline[]; active: WorkflowRunView | null;
  onDefsChange: (rows: WorkflowDef[]) => void; onRun: (def: WorkflowDef, note: string) => void; onPlan: (goal: string) => void;
  onCaptureMacro: (name: string, count: number) => void; onRunMacro: (id: string) => void; onRunBatch: (def: WorkflowDef, ids: string[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<DefDraft | null>(null);
  const [note, setNote] = useState('');
  const [goal, setGoal] = useState('');
  const [keeping, setKeeping] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteArmed, setDeleteArmed] = useState('');
  const [macros, setMacros] = useState<Macro[]>([]);
  const [macroName, setMacroName] = useState('');
  const [macroCount, setMacroCount] = useState(3);
  const [macroBusy, setMacroBusy] = useState(false);
  const [tab, setTab] = useState<'design' | 'trace'>('design');
  const [history, setHistory] = useState<WorkflowHistoryItem[] | null>(null);
  const [batchFor, setBatchFor] = useState('');
  const [batchText, setBatchText] = useState('');
  const sendGuidelines = guidelines.filter(g => g.kind === 'send');
  const dynamicDefs = defs.filter(def => def.origin === 'dynamic');
  const savedDefs = defs.filter(def => def.origin !== 'dynamic');
  const reloadMacros = useCallback(async () => {
    try { setMacros(await rpc<Macro[]>({ method: 'macros.list', projectId: target.projectId })); } catch { /* 宏区失败不阻断工作流面板 */ }
  }, [target.projectId]);
  useEffect(() => { void reloadMacros(); }, [reloadMacros]);
  const scheduleMacro = async (id: string, scheduleAt: string) => {
    setMacroBusy(true); setError('');
    try { await rpc({ method: 'macros.schedule', id, scheduleAt: scheduleAt.trim(), target }); await reloadMacros(); }
    catch (e) { setError('宏定时失败：' + ((e as Error).message ?? '')); }
    finally { setMacroBusy(false); }
  };
  const loadHistory = useCallback(async () => {
    try { setHistory(await rpc<WorkflowHistoryItem[]>({ method: 'workflows.history', projectId: target.projectId, limit: 20 })); } catch { setHistory([]); }
  }, [target.projectId]);
  useEffect(() => { if (tab === 'trace' && history === null) void loadHistory(); }, [tab, history, loadHistory]);
  const seedTemplates = async () => {
    setError('');
    try { onDefsChange(await rpc<WorkflowDef[]>({ method: 'workflows.seed', projectId: target.projectId })); }
    catch (e) { setError('模板安装失败：' + ((e as Error).message ?? '')); }
  };
  const scheduleWorkflow = async (id: string, scheduleAt: string) => {
    setError('');
    try { await rpc({ method: 'workflows.schedule', id, scheduleAt: scheduleAt.trim(), target }); } catch (e) { setError('工作流定时失败：' + ((e as Error).message ?? '')); }
  };
  const reload = async () => { const rows = await rpc<WorkflowDef[]>({ method: 'workflows.list', projectId: target.projectId }); onDefsChange(rows); };
  const startNew = () => { setError(''); setDraft({ id: crypto.randomUUID(), name: '', description: '', createdAt: Date.now(), steps: [{ ...emptyStep(), title: '第一步', prompt: '' }] }); };
  const patchStep = (index: number, patch: Partial<StepDraft>) => setDraft(current => current ? { ...current, steps: current.steps.map((step, i) => i === index ? { ...step, ...patch } : step) } : current);
  const moveStep = (index: number, delta: -1 | 1) => setDraft(current => {
    if (!current) return current;
    const to = index + delta; if (to < 0 || to >= current.steps.length) return current;
    const steps = [...current.steps]; [steps[index], steps[to]] = [steps[to]!, steps[index]!];
    return { ...current, steps };
  });
  const saveDraft = async () => {
    if (!draft || saving) return;
    const name = draft.name.trim();
    if (!name) { setError('请填写工作流名称。'); return; }
    if (!draft.steps.length) { setError('至少需要一个步骤。'); return; }
    for (const [index, step] of draft.steps.entries()) {
      if (!step.title.trim()) { setError(`第 ${index + 1} 步缺少标题。`); return; }
      if (!step.prompt.trim()) { setError(`第 ${index + 1} 步「${step.title.trim()}」缺少提示词。`); return; }
      if (step.check) {
        const targetIndex = draft.steps.findIndex((other, otherIndex) => otherIndex < index && (other.id || `s${otherIndex + 1}`) === step.check!.retryTo);
        if (targetIndex < 0) { setError(`第 ${index + 1} 步「${step.title.trim()}」的返工目标无效：只能回到更早的步骤。`); return; }
      }
    }
    setSaving(true); setError('');
    try {
      await rpc({ method: 'workflows.save', def: { id: draft.id, projectId: target.projectId, name, description: draft.description.trim(), origin: 'manual', createdAt: draft.createdAt, updatedAt: 0, steps: draft.steps.map((step, index) => ({ id: step.id || `s${index + 1}`, title: step.title.trim(), prompt: step.prompt.trim(), ...(step.guidelineId ? { guidelineId: step.guidelineId } : {}), pause: step.pause, ...(step.check ? { check: { retryTo: step.check.retryTo, maxRetries: step.check.maxRetries } } : {}) })) } });
      await reload(); setDraft(null);
    } catch (e) { setError('保存失败：' + ((e as Error).message ?? '')); }
    finally { setSaving(false); }
  };
  const removeDef = async (def: WorkflowDef) => {
    if (deleteArmed !== def.id) { setDeleteArmed(def.id); return; }
    setDeleteArmed(''); setError('');
    try { await rpc({ method: 'workflows.delete', id: def.id }); await reload(); }
    catch (e) { setError('删除失败：' + ((e as Error).message ?? '')); }
  };
  const keepDef = async () => {
    if (!keeping) return;
    setError('');
    try {
      await rpc({ method: 'workflows.keep', id: keeping.id, name: keeping.name.trim() || '动态工作流' });
      setKeeping(null);
      await reload();
    } catch (e) { setError('保存失败：' + ((e as Error).message ?? '')); }
  };
  return <section className="workflow-panel" aria-label="工作流管理" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (draft) { setDraft(null); setError(''); } else onClose(); } }}>
    <header><div><strong>工作流</strong><small>自定义多步骤流程 · 输入 /wf:名称 运行</small></div>{!draft && <button className="primary" onClick={startNew}><Plus size={13}/>新建</button>}<button className="icon" title="关闭工作流面板" onClick={onClose}><X size={16}/></button></header>
    {error && <div className="workflow-error" role="alert">{error}<button className="icon" title="关闭提示" onClick={() => setError('')}><X size={13}/></button></div>}
    <div className="workflow-tabs" role="tablist" aria-label="工作流视图">
      <button role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'selected' : ''} onClick={() => setTab('design')}>设计</button>
      <button role="tab" aria-selected={tab === 'trace'} className={tab === 'trace' ? 'selected' : ''} onClick={() => { setTab('trace'); void loadHistory(); }}>运行轨迹</button>
    </div>
        {draft && tab === 'design' ? <div className="workflow-editor">
      <label>名称<input value={draft.name} maxLength={60} aria-label="工作流名称" placeholder="例如：需求三连审" onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      <label>描述<input value={draft.description} maxLength={300} aria-label="工作流描述" placeholder="这个流程做什么、什么时候用" onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
      <div className="workflow-steps">
        {draft.steps.map((step, index) => <div className="workflow-step" key={index}>
          <div className="workflow-step-head">
            <span className="workflow-step-index">{index + 1}</span>
            <input value={step.title} maxLength={80} aria-label={`第 ${index + 1} 步标题`} placeholder="步骤标题，如：需求质量评审" onChange={e => patchStep(index, { title: e.target.value })}/>
            <button className="icon" title="上移" disabled={index === 0} onClick={() => moveStep(index, -1)}><ChevronUp size={13}/></button>
            <button className="icon" title="下移" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}><ChevronDown size={13}/></button>
            <button className="icon danger" title="删除此步骤" disabled={draft.steps.length <= 1} onClick={() => setDraft(current => current ? { ...current, steps: current.steps.filter((_, i) => i !== index) } : current)}><Trash2 size={13}/></button>
          </div>
          <textarea value={step.prompt} aria-label={`第 ${index + 1} 步提示词`} placeholder="提示词。可用变量：{{item}} 当前工作项、{{prev}} 上一步结果、{{steps.步骤id}} 指定步骤结果" onChange={e => patchStep(index, { prompt: e.target.value })}/>
          <div className="workflow-step-foot">
            {sendGuidelines.length > 0 ? <select value={step.guidelineId} aria-label={`第 ${index + 1} 步附加指令`} onChange={e => patchStep(index, { guidelineId: e.target.value })}><option value="">不附加指令</option>{sendGuidelines.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select> : <small>暂无「发送」类附加指令</small>}
            {step.check ? <span className="workflow-checks" title="检查步：结果末行输出结论标记。PASS 继续、FAIL 回到指定步骤返工、NEED_MANUAL 或缺标记转人工暂停。">
              <label><input type="checkbox" checked onChange={e => patchStep(index, { check: e.target.checked ? step.check : null })}/>检查步</label>
              <label>不通过回到<select value={step.check.retryTo} aria-label={`第 ${index + 1} 步返工目标`} onChange={e => patchStep(index, { check: { ...step.check!, retryTo: e.target.value } })}>{draft.steps.slice(0, index).map((earlier, i) => <option key={earlier.id || 's' + (i + 1)} value={earlier.id || `s${i + 1}`}>{i + 1}·{(earlier.title || '未命名').slice(0, 12)}</option>)}</select></label>
              <label>返工上限<input type="number" min={1} max={5} value={step.check.maxRetries} aria-label={`第 ${index + 1} 步返工上限`} onChange={e => patchStep(index, { check: { ...step.check!, maxRetries: Math.min(5, Math.max(1, Number(e.target.value) || 1)) } })}/></label>
            </span> : index > 0 ? <label className="workflow-checks" title="勾选后本步成为检查步：结论 FAIL 自动回到之前的步骤返工，证据不足转人工。"><input type="checkbox" checked={false} onChange={() => patchStep(index, { check: { retryTo: draft.steps[index - 1]!.id || `s${index}`, maxRetries: 1 } })}/>检查步</label> : null}
            <label className="workflow-pause"><input type="checkbox" checked={step.pause} onChange={e => patchStep(index, { pause: e.target.checked })}/>完成后暂停确认</label>
          </div>
        </div>)}
        <button className="workflow-add-step" disabled={draft.steps.length >= 30} onClick={() => setDraft(current => current ? { ...current, steps: [...current.steps, emptyStep()] } : current)}><Plus size={13}/>添加步骤</button>
      </div>
      <footer><span className="muted">步骤按顺序在同一会话执行；检查步 FAIL 自动返工、证据不足转人工；上下文与工具权限沿用当前会话设置。</span><div><button className="secondary" onClick={() => { setDraft(null); setError(''); }}>取消</button><button className="primary" disabled={saving} onClick={() => void saveDraft()}>{saving ? '保存中…' : '保存'}</button></div></footer>
    </div>
    : <div className="workflow-listing" hidden={tab !== 'design'}>
      <button className="workflow-seed" title="安装内置工程模板：需求三连审/模型一致性巡检/写前查重合并/体检清零/新需求起草" onClick={() => void seedTemplates()}>安装内置模板</button>
      <div className="workflow-plan-row" role="group" aria-label="动态拆解">
        <label className="workflow-note-row goal">说出目标<input value={goal} maxLength={2000} aria-label="动态工作流目标" placeholder="如：评审 SPE-951 与模型一致性，发现问题给出修复建议" onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && goal.trim()) { onPlan(goal.trim()); setGoal(''); } }} onChange={e => setGoal(e.target.value)}/></label>
        <button className="primary" disabled={!goal.trim()} title="当前会话把目标拆成结构化步骤并立即执行；跑完满意可保存复用" onClick={() => { onPlan(goal.trim()); setGoal(''); }}><Sparkles size={12}/>拆解并执行</button>
      </div>
      <label className="workflow-note-row">运行附注<input value={note} maxLength={2000} aria-label="本次运行附注" placeholder="可选；随每一步注入，如：重点关注接口定义" onChange={e => setNote(e.target.value)}/></label>
      {active && ['running', 'paused'].includes(active.status) && <p className="workflow-active-hint">{active.status === 'paused' ? `「${active.defName}」已暂停，请在输入框上方继续或终止。` : `「${active.defName}」正在运行（步骤 ${Math.min(active.currentIndex + 1, active.total)}/${active.total}）。`}</p>}
      {dynamicDefs.length > 0 && <>
        <div className="workflow-dynamic-head">目标拆解产生的流程 · 满意就保存，或直接丢弃</div>
        {dynamicDefs.map(def => <div className="workflow-row dynamic" key={def.id}>
          <div className="workflow-row-main">
            {keeping?.id === def.id
              ? <input className="workflow-keep-name" value={keeping.name} maxLength={60} autoFocus aria-label="保存名称" onChange={e => setKeeping({ id: def.id, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void keepDef(); if (e.key === 'Escape') setKeeping(null); }}/>
              : <strong>{def.name}</strong>}
            <small>{def.steps.length} 步{def.description ? ' · ' + def.description : ''}</small>
          </div>
          <div className="workflow-row-actions">
            {keeping?.id === def.id
              ? <button className="secondary" title="确认保存为正式工作流" onClick={() => void keepDef()}>保存</button>
              : <button className="secondary" title="保存为正式工作流，之后可 /wf:名称 复用或编辑" onClick={() => setKeeping({ id: def.id, name: def.name.replace(/^动态 · /, '') })}><BookmarkPlus size={12}/>保存复用</button>}
            <button className="secondary" title="对当前会话再次运行" onClick={() => onRun(def, note.trim())}><Play size={12}/>运行</button>
            {deleteArmed === def.id
              ? <button className="workflow-delete armed" title="再次点击确认删除" onClick={() => void removeDef(def)}>删除?</button>
              : <button className="icon danger" title="丢弃这份拆解" onClick={() => void removeDef(def)}><Trash2 size={13}/></button>}
          </div>
        </div>)}
      </>}
      {savedDefs.length ? savedDefs.map(def => <div className="workflow-row" key={def.id}>
        <div className="workflow-row-main">
          <strong>{def.name}</strong>
          <small>{def.steps.length} 步{def.description ? ' · ' + def.description : ''}</small>
        </div>
        <div className="workflow-row-actions">
          <button className="secondary" title="对当前会话运行此工作流" onClick={() => onRun(def, note.trim())}><Play size={12}/>运行</button>
          <button className="secondary" title="批量：每行一个工作项编号，各开一个独立会话跑同一流程" onClick={() => { setBatchFor(batchFor === def.id ? '' : def.id); setBatchText(''); }}>批量</button>
          <label className="workflow-macro-schedule" title="每日定时触发（留空取消）；需要当前文档所在项目"><Timer size={11}/><input type="time" defaultValue={def.scheduleAt ?? ''} aria-label={`工作流 ${def.name} 定时`} onChange={event => void scheduleWorkflow(def.id, event.target.value)}/></label>
          <button className="icon" title="编辑" onClick={() => { setDeleteArmed(''); setError(''); setDraft(toDraft(def)); }}><PenLine size={13}/></button>
          {deleteArmed === def.id
            ? <button className="workflow-delete armed" title="再次点击确认删除" onClick={() => void removeDef(def)}>删除?</button>
            : <button className="icon danger" title="删除工作流" onClick={() => void removeDef(def)}><Trash2 size={13}/></button>}
        </div>
      </div>) : <p className="muted workflow-empty">{dynamicDefs.length ? '还没有保存的正式工作流。' : '还没有保存的工作流。说出目标让 AI 拆解执行，跑顺后保存复用；也可手动新建。'}</p>}
      {batchFor && <div className="workflow-batch" role="group" aria-label="批量运行">
        <strong>批量运行「{savedDefs.find(def => def.id === batchFor)?.name}」</strong>
        <small>每行一个工作项编号（最多 10 条）；每条各开一个独立会话，按同一流程执行，可在运行轨迹里逐条查看。</small>
        <textarea rows={3} aria-label="批量工作项编号" placeholder={'SPE-101'} value={batchText} onChange={event => setBatchText(event.target.value)}/>
        <div className="workflow-batch-actions">
          <button className="secondary" onClick={() => setBatchFor('')}>取消</button>
          <button className="primary" disabled={!batchText.trim()} onClick={() => { const ids = batchText.split(/[\s,，、]+/).map(value => value.trim()).filter(Boolean); const def = savedDefs.find(row => row.id === batchFor); if (ids.length && def) { onRunBatch(def, ids); setBatchFor(''); } }}>开始批量</button>
        </div>
      </div>}
      <div className="workflow-dynamic-head">宏 · 把当前会话跑顺的连续指令存下来一键重放</div>
      <div className="workflow-macro-form">
        <input aria-label="宏名称" placeholder="宏名称" maxLength={60} value={macroName} onChange={event => setMacroName(event.target.value)}/>
        <label title="录制当前会话最近 N 条指令">最近<input aria-label="录制条数" type="number" min={1} max={10} value={macroCount} onChange={event => setMacroCount(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}/>条</label>
        <button className="primary" disabled={!macroName.trim() || macroBusy} title="只录制你发出的普通指令（工作流/预审等自动轮不算）" onClick={() => { onCaptureMacro(macroName.trim(), macroCount); setMacroName(''); }}><Zap size={12}/>录制</button>
      </div>
      {macros.map(macro => <div className="workflow-row" key={macro.id}>
        <div className="workflow-row-main">
          <strong>{macro.name}</strong>
          <small>{macro.steps.length} 条指令{macro.scheduleAt ? ` · 每日 ${macro.scheduleAt}` : ''}</small>
        </div>
        <div className="workflow-row-actions">
          <button className="secondary" title="对当前会话按原顺序重放" onClick={() => onRunMacro(macro.id)}><Play size={12}/>重放</button>
          <label className="workflow-macro-schedule" title="设置每日定时（留空取消）；需要当前会话所在项目与文档">
            <Timer size={11}/>
            <input type="time" defaultValue={macro.scheduleAt ?? ''} disabled={macroBusy} aria-label={`宏 ${macro.name} 定时`} onChange={event => void scheduleMacro(macro.id, event.target.value)}/>
          </label>
          <button className="icon danger" title="删除宏" onClick={async () => { try { await rpc({ method: 'macros.delete', id: macro.id }); await reloadMacros(); } catch (e) { setError('删除失败：' + ((e as Error).message ?? '')); } }}><Trash2 size={13}/></button>
        </div>
      </div>)}
      {tab === 'trace' && <div className="workflow-trace">
        {!history && <p className="muted">正在读取运行轨迹…</p>}
        {history && !history.length && <p className="muted workflow-empty">还没有运行过。运行列表、每步结果与返工证据都会记在这里。</p>}
        {history?.map(run => <div className="workflow-trace-run" key={run.id}>
          <div className="workflow-trace-head">
            <b>{run.defName}</b>
            <span className={'wf-status ' + run.status}>{runStatusLabels[run.status]}</span>
            <small>{new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })}{run.note ? ` · ${run.note}` : ''}{run.error ? ` · ${run.error}` : ''}</small>
          </div>
          {run.steps.map((step, index) => <div className={'workflow-trace-step ' + step.status} key={step.stepId + ':' + index} title={step.resultPreview}>
            <i>{index + 1}</i>
            <span>{step.title}{step.checkRule ? '（检查步）' : ''}{step.retries ? ` · 返工${step.retries}次` : ''}</span>
            <small>{stepStatusLabels[step.status]}{step.resultPreview ? ` · ${step.resultPreview.slice(0, 80)}` : ''}</small>
          </div>)}
        </div>)}
      </div>}
      <footer><Workflow size={12}/>输入 /wf::目标 动态拆解执行 · /wf:名称 运行已保存流程 · 对话里跑顺的流程让 AI 用 save_workflow 存下来。</footer>
    </div>}
  </section>;
}
