import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {Activity} from './Activity';
import {ContextCards} from './ContextCards';
import {CopyButton} from './CopyButton';
import {filterCommands,slashQuery} from '../lib/commands';
import {appendSessionEvents, emptyEventHistory, readSessionBatch, reconcileRuns} from '../lib/session-events';
import {answerClipboard} from '../lib/answer-clipboard';
import {AssistantMarkdown} from './AssistantMarkdown';
import { PanelRightClose, PanelRightOpen, Plus, ArrowUp, Square, Pin, X, Settings, ListTree, MessageSquare, SlidersHorizontal, FileText, History, ChevronRight, Check, ExternalLink, GripVertical, TerminalSquare, Paperclip } from 'lucide-react';
import type { Context, Draft, Run, RunEvent, Session, Target, EngineCapabilities, Asset, PermissionMode } from '../../../packages/protocol/index';
import { routeFromUrl, sameTarget } from '../../../packages/protocol/index';
import type { SourceNode } from '../../../packages/core/lossless-html';
import { rpc } from '../lib/client';

import { DraftEditor } from './DraftEditor';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { NativeInteraction } from './NativeInteraction';
import { AttachmentCards, AttachmentPreview } from './Attachments';
import { uploadAsset } from '../lib/assets';
import { Layout, NativeState, outline, navigateHeading, documentFrame } from '../lib/layout';
type DraftView = Draft & { nodes: SourceNode[]; version: string };
const errors: Record<string, string> = { NATIVE_EDITOR_DIRTY: '原生文档存在输入，请先在原生界面保存或撤销并刷新，再保存草稿。', NATIVE_EDITOR_UNKNOWN: '尚不能确认原生编辑状态。请先保存或放弃原生修改并刷新文档。', REMOTE_CONFLICT: '服务端内容已变化，草稿保留；需要合并后再保存。', STALE_DRAFT: '草稿已被另一处修改，已保留当前版本，请刷新草稿后继续。', DEVELOPMENT_WRITE_SCOPE: '本地服务仍是旧版，请重新加载扩展后再保存。', READBACK_MISMATCH: '保存回读与草稿不一致，请核对服务端内容；不要重复保存。' };
const errorText = (e: unknown) => errors[(e as Error).message] ?? (e as Error).message;
const statusText: Record<string, string> = { running: '正在处理', waiting: '等待工具确认', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: 'Host 重启，任务已中断' };
export function App() {
  const [target, setTarget] = useState<Target | null>(() => routeFromUrl(location.href));
  const [open, setOpen] = useState(true); const [tab, setTab] = useState('ai'); const [pageReady, setPageReady] = useState(false);
  const [width, setWidth] = useState(410); const [geometry, setGeometry] = useState({ top: 46, overlay: false });
  const [health, setHealth] = useState(false); const [error, setError] = useState('');
  const [saveNotice,setSaveNotice]=useState('');
  useEffect(()=>{if(!saveNotice)return;const timer=setTimeout(()=>setSaveNotice(''),10000);return()=>clearTimeout(timer);},[saveNotice]);
  useEffect(()=>{if(!target)return;let disposed=false;const key='save-receipt:'+JSON.stringify(target);void browser.storage.local.get(key).then(async value=>{const receipt=value[key] as {workItemId:string;at:number}|undefined;if(!disposed&&receipt&&Date.now()-receipt.at<120000)setSaveNotice(receipt.workItemId+' 已保存到 Polarion，服务端回读一致。');if(receipt)await browser.storage.local.remove(key);});return()=>{disposed=true;};},[target]);
  const [contexts, setContexts] = useState<Context[]>([]); const [pinnedOutline, setPinnedOutline] = useState(false);
  const [headings, setHeadings] = useState(outline); const [sessions, setSessions] = useState<Session[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null); const [eventHistory, setEventHistory] = useState(emptyEventHistory); const {events, byRun} = eventHistory; const [loadingHistory, setLoadingHistory] = useState(false); const [runs, setRuns] = useState<Run[]>([]);
  const [history, setHistory] = useState(false); const [settings, setSettings] = useState(false); const [config, setConfig] = useState<any>(null);
  const [awayFromLatest,setAwayFromLatest]=useState(false);
  const [permissionMode,setPermissionMode]=useState<PermissionMode>('ask');
  const [input, setInput] = useState(''); const [sending, setSending] = useState(false); const [drafts, setDrafts] = useState<Draft[]>([]);
  const [capabilities, setCapabilities] = useState<EngineCapabilities | null>(null); const [showCapabilities, setShowCapabilities] = useState(false); const [loadingCapabilities, setLoadingCapabilities] = useState(false); const [capabilityError, setCapabilityError] = useState('');
  const composerInput=useRef<HTMLTextAreaElement>(null); const slashMenu=useRef<HTMLDivElement>(null);
  const [slashIndex, setSlashIndex] = useState(0); const [slashHidden, setSlashHidden] = useState(false);
  const [attachments, setAttachments] = useState<Asset[]>([]); const [uploadProgress, setUploadProgress] = useState(''); const [previewAsset, setPreviewAsset] = useState<Asset | null>(null); const [dragOver, setDragOver] = useState(false);
  const uploadCount = useRef(0); const attachmentFiles = useRef<HTMLInputElement>(null); const loadedAttachmentProject = useRef<string | null>(null); const attachmentRef = useRef(attachments); attachmentRef.current = attachments;
  const [draft, setDraft] = useState<DraftView | null>(null); const [hover, setHover] = useState<{ workItemId: string; text: string } | null>(null);
  useEffect(()=>{if(draft?.state==='dirty')setSaveNotice('');},[draft?.state,draft?.revision]);
  const [editorAI,setEditorAI]=useState(true);const prepareAI=useRef<(()=>Promise<void>)|null>(null);const priorTab=useRef('ai');
  const layout = useRef(new Layout()); const native = useRef(new NativeState()); const cursor = useRef(0); const scrolling = useRef<HTMLDivElement>(null); const followOutput=useRef(true);
  const targetRef = useRef(target); targetRef.current = target;
  const sessionRef = useRef(session); sessionRef.current = session;
  useEffect(() => { let disposed=false;loadedAttachmentProject.current=null;if(!target)return;void browser.storage.local.get('composer-attachments:'+target.projectId).then(value=>{if(!disposed){setAttachments((value['composer-attachments:'+target.projectId] as Asset[])??[]);loadedAttachmentProject.current=target.projectId;}});return()=>{disposed=true;};},[target?.projectId]);
  useEffect(() => { if(target&&loadedAttachmentProject.current===target.projectId)void browser.storage.local.set({['composer-attachments:'+target.projectId]:attachments}); },[attachments,target?.projectId]);
  useEffect(() => { void browser.storage.local.get('workspace-preferences').then(value => { const p = value['workspace-preferences'] as any; if (p) { if (typeof p.open === 'boolean') setOpen(p.open); if (typeof p.pinnedOutline === 'boolean') setPinnedOutline(p.pinnedOutline); if (typeof p.width === 'number') setWidth(Math.max(340, Math.min(560, p.width))); } }).finally(() => setPreferencesLoaded(true)); }, []);
  useEffect(() => { if (preferencesLoaded) void browser.storage.local.set({ 'workspace-preferences': { open, width, pinnedOutline } }); }, [open, width, pinnedOutline, preferencesLoaded]);
  useEffect(() => { if (session) void browser.storage.local.set({ ['active-project-session:' + session.target.projectId]: session.id }); }, [session?.id]);
  useEffect(() => { if (!target) return; let disposed = false; const key = 'composer:' + JSON.stringify(target); void browser.storage.local.get(key).then(saved => { if (!disposed && typeof saved[key] === 'string') setInput(saved[key]); }); return () => { disposed = true; }; }, [target]);
  useEffect(() => {
    const update = () => { const next = routeFromUrl(location.href); if (JSON.stringify(next) !== JSON.stringify(targetRef.current)) { const sameProject = next && next.projectId === targetRef.current?.projectId; setTarget(next); setContexts(list => sameProject ? list.filter(c => c.pinned) : []); if (!sameProject) { setSession(null); setEventHistory(emptyEventHistory()); } setDraft(null); setHover(null); } };
    window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'toggle') setOpen(v => !v);
      if (message.type === 'context' && targetRef.current && sameTarget(message.context.target, targetRef.current)) {
        setContexts(list => [...list.filter(c => c.pinned), message.context].slice(-12)); if (message.open) { setOpen(true); setTab('ai'); }
      }
      if (message.type === 'hover') setHover({ workItemId: message.workItemId, text: message.text });
    };
    browser.runtime.onMessage.addListener(listener); return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    const apply = () => { if(document.hidden)return;setPageReady(!!documentFrame()); const geometry=layout.current.apply(open && !!target,width);setGeometry(old=>old.top===geometry.top&&old.overlay===geometry.overlay?old:geometry); native.current.bind(); const headings=outline();setHeadings(old=>JSON.stringify(old)===JSON.stringify(headings)?old:headings); };
    apply(); const timer = setInterval(apply, 2000); window.addEventListener('resize', apply);
    return () => { clearInterval(timer); window.removeEventListener('resize', apply); layout.current.reset(); };
  }, [open, width, target]);
  useEffect(() => () => native.current.close(), []);
  useEffect(() => {
    if (!target) return; let disposed = false;
    const refresh = async () => { try { await rpc({ method: 'health' }); if (disposed) return; setHealth(true); const rows = await rpc<Session[]>({ method: 'sessions.list', projectId: target.projectId }); if (disposed) return; setSessions(old=>JSON.stringify(old)===JSON.stringify(rows)?old:rows);
      if (!sessionRef.current) { const key = 'active-project-session:' + target.projectId; const legacy = 'active-session:' + JSON.stringify(target); const state = await browser.storage.local.get([key, legacy]); const saved = state[key] ?? state[legacy]; const last = rows.find(s => s.id === saved); if (last && !disposed && !sessionRef.current) setSession(last); }
      const localDrafts = await rpc<Draft[]>({ method: 'drafts.list', target }); if (!disposed) setDrafts(old=>JSON.stringify(old)===JSON.stringify(localDrafts)?old:localDrafts);
    } catch (e) { if (!disposed) { setHealth(false); setError(errorText(e)); } } };
    void refresh(); const timer = setInterval(refresh, 6000); return () => { disposed = true; clearInterval(timer); };
  }, [target]);
  useEffect(() => {
    if (!session) { setRuns([]); setLoadingHistory(false); return; }
    let disposed = false; let busy = false; let wakePending = false; let nextPoll:ReturnType<typeof setTimeout>;
    cursor.current = 0; setEventHistory(emptyEventHistory()); setRuns([]); setLoadingHistory(true);
    followOutput.current = true; setAwayFromLatest(false);
    const poll = async () => {
      if (busy) { wakePending = true; return; } busy = true;
      try {
        const response = await readSessionBatch(after => rpc({ method: 'sessions.read', sessionId: session.id, after }), cursor.current, () => disposed);
        if (disposed) return;
        setRuns(previous => reconcileRuns(previous, response.runs));
        cursor.current = response.cursor;
        setEventHistory(previous => appendSessionEvents(previous, response.events));
        setLoadingHistory(response.more);
        if(response.events.some(e=>e.kind==='draft')&&targetRef.current){const t=targetRef.current;void rpc<Draft[]>({method:'drafts.list',target:t}).then(rows=>{if(!disposed&&targetRef.current&&sameTarget(t,targetRef.current))setDrafts(old=>JSON.stringify(old)===JSON.stringify(rows)?old:rows);}).catch(()=>{});}
        nextPoll=setTimeout(poll,response.more||wakePending?0:document.hidden?5000:response.runs.some(r=>['running','waiting'].includes(r.status))?700:2000);
      } catch (e) { if (!disposed) {setError(errorText(e));nextPoll=setTimeout(poll,3000);} } finally { busy = false; wakePending = false; }
    }; const wake=()=>{clearTimeout(nextPoll);void poll();};window.addEventListener('polarion-sidebar-run-started',wake);void poll(); return () => { disposed = true; clearTimeout(nextPoll);window.removeEventListener('polarion-sidebar-run-started',wake); };
  }, [session?.id]);
  useEffect(() => { if (scrolling.current&&followOutput.current) scrolling.current.scrollTop = scrolling.current.scrollHeight; }, [events.length]);
  const active = runs.find(r => ['running', 'waiting'].includes(r.status));
  async function loadCapabilities(refresh = false) { if (!target || loadingCapabilities) return; setLoadingCapabilities(true); setCapabilityError(''); try { setCapabilities(await rpc({ method: 'engine.capabilities', target, sessionId:session?.id, refresh })); } catch (e) { setCapabilityError(errorText(e)); } finally { setLoadingCapabilities(false); } }
  async function manageCapabilities(action:'reload-skills'|'reconnect-mcp',server?:string){if(!session)return;setLoadingCapabilities(true);setCapabilityError('');try{setCapabilities(await rpc({method:'engine.manage',sessionId:session.id,action,server}));}catch(e){setCapabilityError(errorText(e));}finally{setLoadingCapabilities(false);}}
  useEffect(() => { if (input.startsWith('/') && !capabilities && !loadingCapabilities) void loadCapabilities(); }, [input]);
  const commandQuery = slashQuery(input);
  const slashOpen = !slashHidden && commandQuery !== null;
  const slashMatches = useMemo(() => filterCommands(capabilities?.commands ?? [], commandQuery ?? ''), [capabilities, commandQuery]);
  useEffect(() => { setSlashIndex(0); }, [commandQuery, capabilities]);
  useEffect(() => { if(slashOpen) slashMenu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}); }, [slashIndex, slashOpen]);
  useEffect(() => { const el=composerInput.current;if(!el)return;el.style.height='40px';el.style.height=Math.min(140,Math.max(40,el.scrollHeight))+'px'; }, [input, open, draft?.id, editorAI, tab, pageReady, width]);
  const chooseCommand = (value: string) => { setInput(value); setSlashHidden(true); setShowCapabilities(false); composerInput.current?.focus(); };
  const toggleSettings = async () => { try { setConfig(await rpc({method:'settings.read'}));setSettings(v=>!v); } catch(e) {setError(errorText(e));} };
  async function addAttachments(files: File[]) {
    const uploadTarget=targetRef.current;if(!uploadTarget)return;
    if(files.length+attachmentRef.current.length+uploadCount.current>12){setError('每次任务最多添加 12 个附件。');return;}
    uploadCount.current+=files.length;
    for(const file of files){try{setUploadProgress('正在加入 '+file.name);const a=await uploadAsset(file,uploadTarget,n=>setUploadProgress(`${file.name} · ${n}%`));if(targetRef.current?.projectId===uploadTarget.projectId)setAttachments(list=>[...list,a]);else{const key='composer-attachments:'+uploadTarget.projectId;const saved=await browser.storage.local.get(key);await browser.storage.local.set({[key]:[...((saved[key] as Asset[])??[]),a]});}}catch(e){setError(file.name+'：'+errorText(e));}finally{uploadCount.current--;}}
    if(!uploadCount.current)setUploadProgress('');
  }
  async function newSession() { if (!target) return null; const s = await rpc<Session>({ method: 'sessions.create', target, title: '新工程会话' }); setSessions(list => [s, ...list]); setSession(s); setHistory(false); return s; }
  async function send() {
    if ((!input.trim() && !attachments.length) || !target || active || sending || uploadCount.current) return;
    followOutput.current=true; setAwayFromLatest(false); setSending(true); setError('');
    try { await prepareAI.current?.();const current = session ?? await newSession(); if (!current) return; if (current.target.projectId !== target.projectId) throw Error('当前会话属于另一项目，请切换到当前项目的会话。');
      const prompt=input.trim()||'请分析所附文件。';
      if (current.title === '新工程会话') { const renamed = await rpc<Session>({ method: 'sessions.rename', sessionId: current.id, title: prompt.slice(0, 35) }); setSession(renamed); }
      await rpc({ method: 'runs.start', permissionMode, sessionId: current.id, requestId: crypto.randomUUID(), target, prompt, contexts: structuredClone(contexts), attachments:attachments.map(a=>a.id) }); setInput('');setAttachments([]);window.dispatchEvent(new Event('polarion-sidebar-run-started'));
    } catch (e) { setError(errorText(e)); } finally { setSending(false); }
  }
  const openDraft = useCallback(async (workItemId: string) => { if (!target) return; try {await prepareAI.current?.();const next=await rpc<DraftView>({ method: 'drafts.open', target, workItemId });if(!draft)priorTab.current=tab;setDraft(next);setEditorAI(true);setTab('ai');setContexts(list=>list.some(c=>c.workItemId===workItemId&&!c.pinned)?list:[...list.filter(c=>c.pinned),{id:crypto.randomUUID(),target:next.target,workItemId,text:next.title+'\n'+next.nodes.filter(n=>n.text).map(n=>n.text).join('\n').slice(0,30000),prefix:'',suffix:'',source:'work-item',capturedAt:Date.now(),pinned:false}]); setHover(null); } catch (e) { setError(errorText(e)); } }, [target, draft, tab]);
  const answerPermission = useCallback(async (runId: string, id: string, allow: boolean) => { try { await rpc({ method: 'permissions.answer', runId, permissionId: id, allow }); } catch (e) { setError(errorText(e)); } }, []);
  const visibleRuns = useMemo(() => runs.filter(run => byRun.has(run.id)), [runs, byRun]);
  const outlineView = <div className="outline-list">{headings.length ? headings.map(h => <button key={h.index} style={{ paddingLeft: 14 + (h.level - 1) * 12 }} onClick={() => navigateHeading(h.index)}><span className="heading-index">{String(h.index + 1).padStart(2, '0')}</span>{h.text}</button>) : <p className="muted">文档加载后显示章节导航。</p>}</div>;
  if (!target || !pageReady) return null;
  return <>
    {!open && <button className="reopen" onClick={() => setOpen(true)} title="展开 Polarion 助手"><PanelRightOpen size={18}/><span>助手</span>{active && <i className="running-dot"/>}</button>}
    {(draft?editorAI:open) && <aside className={'workspace '+(draft&&editorAI?'floating-assistant':'')} style={{ width, top: geometry.top }} aria-label={draft&&editorAI?'编辑工作台 AI 协作':'Polarion 超级侧边栏'}>
      {draft&&editorAI&&<div className="collaboration-bar"><MessageSquare size={15}/><span>{draft.workItemId} · AI 协作</span><i className={'connection '+(health?'online':'')} title={health?'本地 Host 已连接':'本地 Host 未连接'}/><button className="icon" title="设置" onClick={()=>void toggleSettings()}><Settings size={15}/></button><button className="icon" title="收起编辑区 AI" onClick={()=>setEditorAI(false)}><PanelRightClose size={16}/></button></div>}
      <div className="resize-grip" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(340, Math.min(560, innerWidth * .45, innerWidth - event.clientX))); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}><GripVertical size={12}/></div>
      {!(draft&&editorAI)&&<header className="brand"><div className="brand-mark">P<span>＋</span></div><div><strong>工程助手</strong><small>POLARION WORKSPACE</small></div><span className={'connection ' + (health ? 'online' : '')} title={health ? '本地 Host 已连接' : '本地 Host 未连接'}/><button className="icon" title="设置" onClick={()=>void toggleSettings()}><Settings size={16}/></button><button className="icon" title="收起助手，任务继续运行" onClick={() => setOpen(false)}><PanelRightClose size={18}/></button></header>}
      <div className="document-path"><span>{target.projectId}</span><ChevronRight size={12}/><strong title={target.document}>{target.document.split('/').at(-1)}</strong></div>
      <nav className="tabs" aria-label="工作区模式">{[['outline','大纲',ListTree],['ai','AI 助手',MessageSquare],['properties','属性',SlidersHorizontal]].map(([key,label,Icon]: any) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={15}/>{label}</button>)}</nav>
      {geometry.overlay && <div className="compact-note">窄屏浮层模式 · 收起助手可查看完整正文</div>}
      {error && <div className="error" role="alert"><span>{error}</span><button className="icon" title="关闭提示" onClick={() => setError('')}><X size={14}/></button></div>}
      {saveNotice&&<div className="save-notice" role="status"><Check size={15}/><span>{saveNotice}</span><button className="icon" title="关闭保存结果" onClick={()=>setSaveNotice('')}><X size={14}/></button></div>}
      {settings && config && <section className="settings"><h3>引擎设置</h3><label>新会话默认引擎<select value={config.defaultEngine} onChange={e => setConfig({ ...config, defaultEngine: e.target.value })}><option value="claude">Claude Code</option><option value="codex">Codex · 等待接入补验</option></select></label><label>Claude 模型<input placeholder="跟随本地 Claude Code 配置" value={config.claudeModel} onChange={e => setConfig({ ...config, claudeModel: e.target.value })}/></label><p className="muted">Codex：gpt-6.1-sol。已有会话保留原引擎。</p><button className="primary" onClick={async () => { try { await rpc({ method: 'settings.write', settings: config }); setSettings(false); } catch (e) { setError(errorText(e)); } }}>保存设置</button></section>}
      {tab === 'outline' && <section className="outline-panel"><div className="section-title"><span>文档章节</span><button className={'icon ' + (pinnedOutline ? 'accent' : '')} title="将大纲固定到助手上方" onClick={() => { setPinnedOutline(v => !v); setTab('ai'); }}><Pin size={15}/></button></div>{outlineView}</section>}
      {tab === 'properties' && <section className="properties"><h3>当前工作区</h3><dl><dt>项目</dt><dd>{target.projectId}</dd><dt>文档</dt><dd>{target.document}</dd><dt>最近选中工作项</dt><dd>{contexts.at(-1)?.workItemId ?? hover?.workItemId ?? '尚未选择'}</dd></dl><button className="secondary" onClick={() => setOpen(false)}><ExternalLink size={14}/>打开原生属性与工作流</button><p className="muted">收起助手后，原生副边栏恢复原有位置与状态。</p><div className="section-title">共享草稿 <span>{drafts.length}</span></div>{drafts.map(d => <button className="draft-row" key={d.id} onClick={() => void openDraft(d.workItemId)}><FileText size={16}/><div><strong>{d.workItemId}</strong><small>{d.title}</small></div><span>{d.state === 'clean' ? '已同步' : '待处理'}</span></button>)}</section>}
      {(tab === 'ai'||!!draft&&editorAI) && <>
        {pinnedOutline && <section className="pinned-outline"><div className="section-title"><span>固定大纲</span><button className="icon" title="取消固定大纲" onClick={() => setPinnedOutline(false)}><X size={13}/></button></div>{outlineView}</section>}
        <div className="session-bar"><button title="会话历史" onClick={() => setHistory(v => !v)}><History size={14}/><span>{session?.title ?? '新工程会话'}</span></button><button className="icon" title="Claude Code 命令、Skills 与 MCP" onClick={() => { setShowCapabilities(v => !v); void loadCapabilities(); }}><TerminalSquare size={16}/></button><button className="icon" title="新建会话" onClick={() => void newSession().catch(e => setError(errorText(e)))}><Plus size={17}/></button></div>
        {showCapabilities && <CapabilitiesPanel value={capabilities} loading={loadingCapabilities} error={capabilityError} running={!!active} onManage={(action,server)=>void manageCapabilities(action,server)} onRefresh={() => void loadCapabilities(true)} onCommand={chooseCommand} onClose={() => setShowCapabilities(false)}/>}
        {history && <div className="history">{sessions.length ? sessions.map(s => <button key={s.id} onClick={() => { setSession(s); setHistory(false); }}><span>{s.title}</span><small>{s.engine === 'claude' ? 'Claude Code' : 'Codex'} · {new Date(s.updatedAt).toLocaleDateString()}</small></button>) : <p className="muted">这个项目还没有会话。</p>}</div>}
        <div className="conversation" ref={scrolling} onScroll={e=>{const el=e.currentTarget;const away=el.scrollHeight-el.scrollTop-el.clientHeight>=100;followOutput.current=!away;setAwayFromLatest(away);}}>{!loadingHistory && events.length === 0 && runs.length === 0 && <div className="welcome"><div className="eyebrow">从当前需求开始</div><h2>把想法变成<br/>可审阅的修改。</h2><p>选中正文或打开一个工作项，助手就能带着准确上下文与你协作。</p><div className="suggestions">{['检查当前选区中的歧义与遗漏', '梳理需求对应的验证场景', '改进表述，保留所有工程参数'].map(text => <button key={text} onClick={() => setInput(text)}>{text}<ChevronRight size={14}/></button>)}</div><div className="workflow-note"><span>选取上下文</span><ChevronRight size={12}/><span>审阅草稿</span><ChevronRight size={12}/><span>明确保存</span></div></div>}
          {visibleRuns.map(run => <Turn key={run.id} run={run} events={byRun.get(run.id)!} recovering={loadingHistory} onDraft={openDraft} onPermission={answerPermission}/>)}
          {loadingHistory&&<p className="history-loading" role="status">正在恢复会话记录…已读取 {events.length} 条事件</p>}
          {!loadingHistory&&runs.length>visibleRuns.length&&<p className="history-loading">部分任务没有保存会话事件，无法还原正文。</p>}</div>
        {awayFromLatest&&<button className="jump-latest" onClick={()=>{followOutput.current=true;setAwayFromLatest(false);scrolling.current?.scrollTo({top:scrolling.current.scrollHeight,behavior:'smooth'});}}>回到最新消息 ↓</button>}
        <div className={"composer-wrap " + (dragOver ? "drag-over" : "")} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }} onDragLeave={() => setDragOver(false)} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); void addAttachments(Array.from(e.dataTransfer.files)); } }}><input hidden type="file" multiple ref={attachmentFiles} aria-label="添加对话附件" onChange={e => { if (e.target.files) void addAttachments(Array.from(e.target.files)); e.target.value=""; }}/><AttachmentCards assets={attachments} onRemove={id=>setAttachments(list=>list.filter(a=>a.id!==id))} onPreview={setPreviewAsset}/>{uploadProgress&&<p className="upload-progress">{uploadProgress}</p>}<ContextCards contexts={contexts} target={target} onPin={id=>setContexts(list=>list.map(c=>c.id===id?{...c,pinned:!c.pinned}:c))} onRemove={id=>setContexts(list=>list.filter(c=>c.id!==id))}/>
          {slashOpen && <div className="slash-menu" ref={slashMenu}>
            <div className="slash-menu-header"><span>{loadingCapabilities?'正在读取本机命令…':`${slashMatches.length} / ${capabilities?.commands.length??0} 个命令与 Skills`}</span><button title="重新读取本机命令" disabled={loadingCapabilities} onClick={()=>void loadCapabilities(true)}>刷新</button></div>
            {capabilityError&&<div className="slash-status" role="alert">读取失败：{capabilityError}。可点击刷新重试。</div>}
            {!loadingCapabilities&&!capabilityError&&!slashMatches.length&&<div className="slash-status">没有匹配的本机命令，试试名称、描述或别名。</div>}
            <div role="listbox" id="native-command-list" aria-label="原生命令补全">{slashMatches.map((c,i) => <button role="option" id={'native-command-'+i} aria-selected={i===slashIndex} key={c.name} className={i === slashIndex ? 'selected' : ''} onMouseDown={e => e.preventDefault()} onClick={() => chooseCommand('/' + c.name + ' ')}><strong>/{c.name}<small>{c.builtin ? '命令' : 'Skill'}</small></strong><span>{c.description}</span>{c.aliases.length>0&&<small className="command-aliases">{c.aliases.map(a=>'/'+a).join(' · ')}</small>}</button>)}</div>
            <div className="slash-menu-help">↑ ↓ 选择 · Tab / Enter 补全 · Esc 关闭</div>
          </div>}
          <div className="composer"><textarea ref={composerInput} rows={1} role="combobox" aria-autocomplete="list" aria-expanded={slashOpen} aria-controls="native-command-list" aria-activedescendant={slashOpen&&slashMatches.length?'native-command-'+slashIndex:undefined} title="Enter 发送 · Shift+Enter 换行 · 支持拖入附件和粘贴截图" onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();void addAttachments(files);}}} aria-label="向工程助手发送消息" placeholder="描述任务，或输入 / 调用本地命令与 Skill…" value={input} onChange={e => { setInput(e.target.value); setSlashHidden(false); setSlashIndex(0); }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (slashOpen) { if (e.key === 'Escape') {e.preventDefault();setSlashHidden(true);return;} } if (slashOpen && slashMatches.length) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(v => (v + (e.key === 'ArrowDown' ? 1 : slashMatches.length - 1)) % slashMatches.length); return; } if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) { e.preventDefault(); chooseCommand('/' + slashMatches[Math.min(slashIndex, slashMatches.length - 1)]!.name + ' '); return; } } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/><div className="composer-footer"><button className="icon" title="添加文档、图片或其他附件" onClick={()=>attachmentFiles.current?.click()}><Paperclip size={16}/></button><span><i className={'connection ' + (health ? 'online' : '')}/>{session?.engine === 'codex' ? 'Codex' : 'Claude Code'}{active ? ' · ' + statusText[active.status] : ' · 本地会话'}</span><select className="permission-select" aria-label="智能体权限" title={(permissionMode==='full'?'完全访问：本地命令与工具自动执行；Polarion 仍需明确保存。':permissionMode==='auto'?'自动批准项目工作区内的文件编辑；命令及外部操作仍请求批准。':'请求批准：读取与本地文档草稿操作自动进行，其他操作逐次确认。')+' 本轮权限在发送时固定，切换后对下一轮生效。'} data-mode={permissionMode} disabled={!!active} value={permissionMode} onChange={e=>setPermissionMode(e.target.value as PermissionMode)}><option value="ask">请求批准</option><option value="auto">自动批准</option><option value="full">完全访问</option></select>{active ? <button className="send stop" title="停止当前任务" onClick={() => void rpc({ method: 'runs.cancel', runId: active.id }).catch(e => setError(errorText(e)))}><Square size={14}/></button> : <button className="send" title="发送消息" disabled={(!input.trim() && !attachments.length) || !health || sending || !!uploadProgress} onClick={() => void send()}><ArrowUp size={18}/></button>}</div></div></div>
      </>}
    </aside>}
    {hover && !draft && <div className="hover-card" style={{ right: open ? width + 16 : 60 }}><div><span className="eyebrow">工作项预览</span><button className="icon" title="关闭预览" onClick={() => setHover(null)}><X size={14}/></button></div><strong>{hover.workItemId}</strong><p>{hover.text.slice(0, 240)}</p><button className="secondary" onClick={() => void openDraft(hover.workItemId)}>打开编辑工作台<ChevronRight size={14}/></button></div>}
    {previewAsset && <AttachmentPreview asset={previewAsset} onClose={()=>setPreviewAsset(null)}/>}
    {draft && <DraftEditor draft={draft} onUpdate={setDraft} onClose={() => {setDraft(null);prepareAI.current=null;setTab(priorTab.current);}} aiOpen={editorAI} onToggleAI={()=>{setEditorAI(v=>!v);setTab('ai');}} onPrepareAI={handler=>{prepareAI.current=handler;}} remoteRevision={drafts.find(d=>d.id===draft.id)?.revision} onError={e => setError(errorText(e))} nativeState={() => native.current.state()} onSaved={async () => { await browser.storage.local.set({ ['active-project-session:' + target.projectId]: session?.id ?? null, ['composer:' + JSON.stringify(target)]: input }); location.reload(); }} onContext={text => setContexts(list => [...list.filter(c => c.pinned), { id: crypto.randomUUID(), target: draft.target, workItemId: draft.workItemId, text, prefix: '', suffix: '', source: 'editor', capturedAt: Date.now(), pinned: false }])}/>}</>;
}
const Turn = React.memo(function Turn({ run, events, recovering, onDraft, onPermission }: { run: Run; events: RunEvent[]; recovering: boolean; onDraft: (id: string) => unknown; onPermission: (runId: string, id: string, allow: boolean) => unknown }) {
  const answer=useRef<HTMLDivElement>(null);
  const user = events.find(e => e.kind === 'user')?.data as any;
  const result = events.find(e => e.kind === 'result')?.data as any;
  const text = result?.text || events.filter(e => e.kind === 'delta').map(e => (e.data as any).text).join('');
  const answered = new Set(events.filter(e => e.kind === 'permission-result').map(e => (e.data as any).id));
  const settled = new Set(events.filter(e => e.kind === 'interaction-result').map(e => (e.data as any).id));
  return <article className="turn">{(user?.text||user?.attachments?.length>0)&&<div className="user-message">{user?.text}{user?.attachments?.length>0&&<div className="sent-attachments">{user.attachments.map((a:any)=><span key={a.id}><Paperclip size={11}/>{a.name}</span>)}</div>}</div>}<div className="assistant-label"><span className="mini-mark">P＋</span><strong>工程助手</strong><small>{recovering&&!result?'正在读取记录':statusText[run.status]}</small></div>
    <Activity run={run} events={events}/>
    {events.filter(e=>e.kind==='command-expanded').map(e=><div className="tool-event" key={e.seq}><TerminalSquare size={13}/>原生已加载 /{(e.data as any).name}</div>)}
    {events.filter(e=>e.kind==='attachment-read'||e.kind==='attachment-input').map(e=><div className="tool-event" key={e.seq}><Paperclip size={12}/>{e.kind==='attachment-input'?'已传递图像：':'已读取附件：'}{(e.data as any).name}{(e.data as any).truncated?' · 部分文字':''}</div>)}
    {!text&&!['running','waiting'].includes(run.status)&&<p className="muted">{recovering?'正在读取本轮回答…':'此任务未保存回答正文，可展开执行记录查看操作。'}</p>}
    {text && <><div ref={answer}><AssistantMarkdown text={text}/></div>{!['running','waiting'].includes(run.status)&&<div className="answer-actions"><CopyButton text={text} label="复制回答" rich={()=>answerClipboard(answer.current!)}/><CopyButton text={text} label="复制 Markdown"/></div>}</>}
    {events.filter(e=>e.kind==='interaction'&&!settled.has((e.data as any).id)).map(e=><NativeInteraction key={e.seq} value={e.data as any} disabled={!['running','waiting'].includes(run.status)} onAnswer={async(action,values)=>{await rpc({method:'interactions.answer',runId:run.id,interactionId:(e.data as any).id,action,values});}}/>)}
    {events.filter(e=>e.kind==='interaction-unavailable').map(e=><p key={e.seq} className="inline-error">{(e.data as any).source}：此原生交互尚未接入。{(e.data as any).error}</p>)}
    {events.filter(e => e.kind === 'permission' && ['running','waiting'].includes(run.status) && !answered.has((e.data as any).id)).map(e => { const p = e.data as any; return <div className="permission" key={e.seq}><strong>允许这次工具调用？</strong><small>{p.tool}</small><details><summary>查看操作详情</summary><pre>{p.preview}</pre></details><div><button className="secondary" onClick={() => onPermission(run.id, p.id, false)}>拒绝</button><button className="primary" onClick={() => onPermission(run.id, p.id, true)}>允许本次</button></div></div>; })}
    {Array.from(new Map(events.filter(e => e.kind === 'draft').map(e => [(e.data as any).workItemId,e])).values()).map(e => <button className="draft-link" key={e.seq} onClick={() => onDraft((e.data as any).workItemId)}><FileText size={14}/>{(e.data as any).workItemId} · 审阅草稿<ChevronRight size={14}/></button>)}
    {run.error && <div className="inline-error">{({SELECTION_NOT_FOUND:"选区已变化或包含尚不支持的对象，请在编辑器中重新选中目标文字后再试。",AMBIGUOUS_SELECTION:"正文中有多处相同文字，请扩大选区以明确修改位置。"} as Record<string,string>)[run.error]??run.error}</div>}
  </article>;
});
