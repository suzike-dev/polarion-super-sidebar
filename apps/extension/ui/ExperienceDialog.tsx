import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, X, PenLine, Trash2, Check, Sparkles, Send } from 'lucide-react';
import { AssistantMarkdown } from './AssistantMarkdown';
import { rpc } from '../lib/client';
import { lineDiff } from '../../../packages/core/line-diff';
import { captureExperienceSelection, experienceHistory, experienceHistoryLimit, experienceLimitError, formatExperienceIntent, type ExperienceQuote } from '../lib/experience-selection';
import type { ExperienceRefineView, ExperienceView } from '../../../packages/protocol/index';
import './experience.css';

/** 共编消息：assistant 携带完整提议稿与处置状态，状态随对话推进流转。 */
type CopilotMessage = { role: 'user' | 'assistant'; text: string; quote?: ExperienceQuote; proposal?: string; state?: 'pending' | 'applied' | 'discarded' | 'superseded' };
const stateLabel: Record<NonNullable<CopilotMessage['state']>, string> = { pending: '待应用', applied: '已应用', discarded: '已放弃', superseded: '已被新稿取代' };

/** 经验沉淀浮窗：查看/手改/AI 共编三态。共编时左侧全文、右侧对话，AI 给完整修改稿，差异确认后应用。 */
export function ExperienceDialog({ view, projectId, model, onClose, onView }: { view: ExperienceView; projectId: string; model?: string; onClose: () => void; onView: (view: ExperienceView) => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'assist'>('view');
  const [text, setText] = useState(view.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  const [chat, setChat] = useState<CopilotMessage[]>([]);
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  const [quote, setQuote] = useState<ExperienceQuote | null>(null);
  const sending = useRef(false);
  const [preview, setPreview] = useState<'diff' | 'render'>('diff');
  const railInput = useRef<HTMLTextAreaElement>(null);
  const railMessages = useRef<HTMLDivElement>(null);
  // view 变化（保存/清空/应用修改稿）只同步手改文本与瞬时状态；共编对话保留，应用后可继续追问。
  useEffect(() => { setText(view.text); setClearArmed(false); setError(''); }, [view]);
  const proposal = useMemo(() => [...chat].reverse().find(message => message.state === 'pending')?.proposal ?? null, [chat]);
  const base = proposal ?? view.text;
  const intent = formatExperienceIntent(ask, quote);
  const limitError = experienceLimitError(base, intent);
  const diffRows = useMemo(() => {
    if (proposal === null) return [];
    let oldLine = 0, newLine = 0;
    return lineDiff(view.text, proposal).map(row => {
      if (row.kind !== 'ins') oldLine++;
      if (row.kind !== 'del') newLine++;
      const label = row.kind === 'del' ? `删除 原稿 L${oldLine}` : row.kind === 'ins' ? `新增 修改稿 L${newLine}` : `未变 原稿 L${oldLine} / 修改稿 L${newLine}`;
      return { ...row, label };
    });
  }, [view.text, proposal]);
  const diffStats = useMemo(() => ({ del: diffRows.filter(row => row.kind === 'del').length, ins: diffRows.filter(row => row.kind === 'ins').length }), [diffRows]);
  useEffect(() => { railMessages.current?.scrollTo({ top: railMessages.current.scrollHeight }); }, [chat, asking, error]);
  useEffect(() => { setQuote(null); }, [view.text, proposal]);
  useEffect(() => { if (mode === 'assist') railInput.current?.focus(); }, [mode]);
  // 输入框随内容自动增高，与主会话输入区一致；上限内不出现内部滚动。
  useEffect(() => {
    const el = railInput.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(150, Math.max(64, el.scrollHeight)) + 'px';
  }, [ask, mode]);

  const save = async () => {
    if (busy) return; setBusy(true); setError('');
    try { onView(await rpc<ExperienceView>({ method: 'experience.write', projectId, text, expectedUpdated: view.updatedAt })); setMode('view'); }
    catch (e) { setError(conflictHint(e)); }
    finally { setBusy(false); }
  };
  // 冲突提示：文件被其他页面/外部编辑改过时，引导重载后再合并，而不是盲目覆盖。
  const conflictHint = (e: unknown) => { const message = (e as Error).message ?? String(e); return /EXPERIENCE_CONFLICT/.test(message) ? '经验文件已被其他页面或外部编辑修改：请关闭浮窗重新打开（会自动载入最新版），把你的修改合并进去后再保存。' : message; };
  const reload = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { onView(await rpc<ExperienceView>({ method: 'experience.read', projectId })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    if (!clearArmed) { setClearArmed(true); return; }
    if (busy) return; setBusy(true); setError('');
    try { onView(await rpc<ExperienceView>({ method: 'experience.clear', projectId })); setChat([]); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setClearArmed(false); }
  };
  const capture = (container: HTMLElement) => {
    if (sending.current || busy) return;
    const surface = container.querySelector<HTMLElement>('.experience-diff, .assistant-message');
    if (!surface) return;
    const selected = captureExperienceSelection(surface, proposal === null ? 'saved' : preview === 'diff' ? 'diff' : 'proposal');
    if (selected) { setQuote(selected); setError(''); }
  };
  const send = async () => {
    if (!ask.trim() || limitError || sending.current || busy) return;
    sending.current = true;
    const user: CopilotMessage = { role: 'user', text: ask.trim(), ...(quote ? { quote } : {}) };
    setAsking(true); setError('');
    try {
      const result = await rpc<ExperienceRefineView>({ method: 'experience.refine', text: base, messages: experienceHistory(chat, intent), ...(model ? { model } : {}) });
      const assistant: CopilotMessage = { role: 'assistant', text: result.note, proposal: result.text, state: 'pending' };
      setChat(messages => [...messages.map(message => message.state === 'pending' ? { ...message, state: 'superseded' as const } : message), user, assistant].slice(-experienceHistoryLimit));
      setAsk(''); setQuote(null); setPreview('diff');
    }
    catch (e) { setError(`生成修改稿失败（${(e as Error).message}）。可直接重新发送。`); }
    finally { sending.current = false; setAsking(false); }
  };
  const applyProposal = async () => {
    if (!proposal || busy) return; setBusy(true); setError('');
    try {
      const saved = await rpc<ExperienceView>({ method: 'experience.write', projectId, text: proposal, expectedUpdated: view.updatedAt });
      onView(saved);
      setChat(messages => messages.map(message => message.state === 'pending' ? { ...message, state: 'applied' as const } : message));
    }
    catch (e) { setError(conflictHint(e)); }
    finally { setBusy(false); }
  };
  const discardProposal = () => setChat(messages => messages.map(message => message.state === 'pending' ? { ...message, state: 'discarded' as const } : message));

  return <div className="experience-layer" role="dialog" aria-label="经验沉淀" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <div className={'experience-panel' + (mode === 'assist' ? ' assist' : '')}>
      <header><span className="experience-icon"><Lightbulb size={15}/></span><div className="experience-title"><span className="eyebrow">本地经验 · 后续会话每轮自动注入</span><h2>经验沉淀</h2><small title={view.path}>{view.path}</small></div><button className="icon" title="关闭" onClick={onClose}><X size={15}/></button></header>
      {mode === 'assist' ? <div className="experience-split">
        <div className="experience-main">
          {proposal !== null && <div className="experience-banner">
            <span className="experience-banner-title">AI 修改稿</span>
            <span className="experience-banner-stats">+{diffStats.ins} −{diffStats.del}</span>
            <span className="experience-banner-toggle">
              <button type="button" className={preview === 'diff' ? 'on' : ''} onClick={() => setPreview('diff')}>差异</button>
              <button type="button" className={preview === 'render' ? 'on' : ''} onClick={() => setPreview('render')}>新版预览</button>
            </span>
            <span className="experience-banner-actions">
              <button type="button" className="secondary" disabled={busy || asking} onClick={discardProposal}>放弃</button>
              <button type="button" className="primary" disabled={busy || asking} onClick={() => void applyProposal()}><Check size={13}/>应用修改</button>
            </span>
          </div>}
          <div className="experience-main-scroll" onMouseUp={event => { if (event.button === 0) capture(event.currentTarget); }}>
            {proposal !== null && preview === 'diff'
              ? (diffRows.some(row => row.kind !== 'same')
                  ? <div className="experience-diff">{diffRows.map((row, index) => <div key={index} className={'experience-dl ' + row.kind} data-experience-line={row.label}><span className="experience-dl-sign" aria-hidden="true">{row.kind === 'del' ? '−' : row.kind === 'ins' ? '+' : ''}</span><span className="experience-dl-text">{row.text}</span></div>)}</div>
                  : <p className="muted">AI 判断当前无需改动；可继续追问或放弃。</p>)
              : proposal !== null && preview === 'render'
                ? <AssistantMarkdown text={proposal}/>
                : view.text.trim() ? <AssistantMarkdown text={view.text}/> : <p className="muted">还没有经验。在右侧描述你的工程偏好，AI 帮你起草第一版；也可以先在会话里沉淀。</p>}
          </div>
        </div>
        <aside className="experience-rail">
          <div className="experience-rail-head"><span className="t"><Sparkles size={12}/>AI 共编</span><small>可在左侧划选要改的文字，再输入修改要求。修改稿经你确认后应用。</small></div>
          <div className="experience-rail-messages" ref={railMessages}>
            {chat.length === 0 && !asking && <div className="experience-rail-empty">
              <p>直接描述修改意图，或试试：</p>
              <button type="button" onClick={() => { setAsk('去重精简：合并重复或相似的条目，删掉啰嗦的修饰词。'); railInput.current?.focus(); }}>去重精简</button>
              <button type="button" onClick={() => { setAsk('按分类重新整理全文，把条目挪到最贴切的分类下。'); railInput.current?.focus(); }}>按分类整理</button>
              <button type="button" onClick={() => { setAsk('逐条检查矛盾或已过时的经验，先在说明里列出，再给出改写。'); railInput.current?.focus(); }}>检查矛盾</button>
            </div>}
            {chat.map((message, index) => message.role === 'user'
              ? <div key={index} className="experience-msg user">{message.quote && <q title={message.quote.location}>{message.quote.text}</q>}{message.text}</div>
              : <div key={index} className="experience-msg assistant">
                  <p>{message.text}</p>
                  {message.state && <span className={'experience-tag ' + message.state}>{stateLabel[message.state]}</span>}
                </div>)}
            {asking && <><div className="experience-msg user">{quote && <q title={quote.location}>{quote.text}</q>}{ask.trim()}</div><div className="experience-msg assistant loading" role="status">正在生成修改稿…</div></>}
            {error && <p className="inline-error">{error}</p>}
          </div>
          <div className="experience-rail-composer">
            <div className="experience-composer-box">
              {quote && <div className="experience-quote" aria-label="已引用文字"><div><small>{quote.location}</small><blockquote>{quote.text}</blockquote></div><button type="button" disabled={asking} title="移除引用" aria-label="移除引用" onClick={() => setQuote(null)}><X size={13}/></button></div>}
              {limitError && <p className="inline-error" role="alert">{limitError}</p>}
              <textarea ref={railInput} value={ask} readOnly={asking} aria-label="对 AI 说怎么改" placeholder="例如：把排版类的第 2、3 条合并成一条" onChange={e => setAsk(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>
              <span className="experience-composer-actions">
                <button type="button" className="experience-send" title="发送（Enter 发送，Shift+Enter 换行）" disabled={asking || busy || !ask.trim() || !!limitError} onClick={() => void send()}>{asking ? <span className="experience-dot-pulse"/> : <Send size={13}/>}</button>
              </span>
            </div>
          </div>
        </aside>
      </div>
      : <div className="experience-body">
        {mode === 'edit'
          ? <textarea value={text} onChange={e => setText(e.target.value)} aria-label="编辑经验内容" spellCheck={false}/>
          : view.text.trim() ? <AssistantMarkdown text={view.text}/> : <p className="muted">还没有沉淀经验。在回答下方点击「经验沉淀」，从本次会话与你的纠正中提炼。</p>}
        {error && <p className="inline-error">{error}</p>}
      </div>}
      <footer><span className="muted">{view.updatedAt ? '已保存 · ' + new Date(view.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未保存'}</span><div>
        {mode === 'view' && <button className="secondary" disabled={busy} title="和 AI 一起编辑：描述意图，确认差异后应用" onClick={() => { setMode('assist'); setPreview('diff'); }}><Sparkles size={13}/>AI 共编</button>}
        {mode === 'edit'
          ? <>{/EXPERIENCE_CONFLICT|已被其他页面/.test(error) && <button className="secondary" disabled={busy} onClick={() => void reload()}>重新载入</button>}<button className="secondary" disabled={busy} onClick={() => { setMode('view'); setText(view.text); }}>取消</button><button className="primary" disabled={busy} onClick={() => void save()}><Check size={13}/>保存修改</button></>
          : mode === 'view' && <button className="secondary" disabled={busy} onClick={() => setMode('edit')}><PenLine size={13}/>编辑</button>}
        {mode === 'assist' && <button className="secondary" disabled={busy || asking} onClick={() => setMode('view')}>完成共编</button>}
        <button className={clearArmed ? 'primary danger-confirm' : 'secondary'} disabled={busy} title={clearArmed ? '再次点击确认清空本地经验' : '清空本项目的本地经验'} onClick={() => void clear()}><Trash2 size={13}/>{clearArmed ? '确认清空' : '清空'}</button>
        <button className="secondary" onClick={onClose}>关闭</button>
      </div></footer>
    </div>
  </div>;
}
