import React, { useEffect, useState } from 'react';
import { Lightbulb, X, PenLine, Trash2, Check } from 'lucide-react';
import { AssistantMarkdown } from './AssistantMarkdown';
import { rpc } from '../lib/client';
import type { ExperienceView } from '../../../packages/protocol/index';
import './experience.css';

/** 经验沉淀浮窗：独立覆盖层，展示本地已沉淀经验，可编辑/清空；不挤占侧边栏与既有浮窗。 */
export function ExperienceDialog({ view, projectId, onClose, onView }: { view: ExperienceView; projectId: string; onClose: () => void; onView: (view: ExperienceView) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(view.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => { setText(view.text); setEditing(false); setClearArmed(false); setError(''); }, [view]);
  const save = async () => {
    if (busy) return; setBusy(true); setError('');
    try { onView(await rpc<ExperienceView>({ method: 'experience.write', projectId, text })); setEditing(false); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!clearArmed) { setClearArmed(true); return; }
    if (busy) return; setBusy(true); setError('');
    try { onView(await rpc<ExperienceView>({ method: 'experience.clear', projectId })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setClearArmed(false); }
  };
  return <div className="experience-layer" role="dialog" aria-label="经验沉淀" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <div className="experience-panel">
      <header><span className="experience-icon"><Lightbulb size={15}/></span><div className="experience-title"><span className="eyebrow">本地经验 · 后续会话每轮自动注入</span><h2>经验沉淀</h2><small title={view.path}>{view.path}</small></div><button className="icon" title="关闭" onClick={onClose}><X size={15}/></button></header>
      <div className="experience-body">
        {editing
          ? <textarea value={text} onChange={e => setText(e.target.value)} aria-label="编辑经验内容" spellCheck={false}/>
          : view.text.trim() ? <AssistantMarkdown text={view.text}/> : <p className="muted">还没有沉淀经验。在回答下方点击「经验沉淀」，从本次会话与你的纠正中提炼。</p>}
        {error && <p className="inline-error">{error}</p>}
      </div>
      <footer><span className="muted">{view.updatedAt ? '已保存 · ' + new Date(view.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未保存'}</span><div>
        {editing
          ? <><button className="secondary" disabled={busy} onClick={() => { setEditing(false); setText(view.text); }}>取消</button><button className="primary" disabled={busy} onClick={() => void save()}><Check size={13}/>保存修改</button></>
          : <button className="secondary" disabled={busy} onClick={() => setEditing(true)}><PenLine size={13}/>编辑</button>}
        <button className={clearArmed ? 'primary danger-confirm' : 'secondary'} disabled={busy} title={clearArmed ? '再次点击确认清空本地经验' : '清空本项目的本地经验'} onClick={() => void clear()}><Trash2 size={13}/>{clearArmed ? '确认清空' : '清空'}</button>
        <button className="secondary" onClick={onClose}>关闭</button>
      </div></footer>
    </div>
  </div>;
}
