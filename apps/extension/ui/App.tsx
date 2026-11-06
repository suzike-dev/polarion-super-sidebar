import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {Activity} from './Activity';
import {ContextCards} from './ContextCards';
import {ContextMeter} from './ContextMeter';
import {CopyButton} from './CopyButton';
import {filterCommands,slashQuery,commandNameMatches} from '../lib/commands';
import {appendSessionEvents, conversationSections, emptyEventHistory, readSessionBatch, reconcileRuns, turnResponseText, windowTurns} from '../lib/session-events';
import {applyWorkItemPick, matchWorkItemQuery, splitWorkItems} from '../lib/workitem-picker';
import {documentWorkItems, filterWorkItems} from '../lib/document-items';
import {answerClipboard} from '../lib/answer-clipboard';
import {AssistantMarkdown} from './AssistantMarkdown';
import { PanelRightClose, PanelRightOpen, Plus, ArrowUp, Square, Pin, X, Settings, ListTree, MessageSquare, SlidersHorizontal, FileText, History, ChevronRight, ChevronDown, Check, ExternalLink, GripVertical, TerminalSquare, Paperclip, AlertCircle, Search, PenLine, ListChecks, Quote, RotateCcw, LayoutGrid, Archive, ArchiveRestore, Trash2, FolderPlus } from 'lucide-react';
import type { Context, Draft, Guideline, Run, RunEvent, Session, SessionGroup, Target, EngineCapabilities, Asset, PermissionMode, TurnDelivery } from '../../../packages/protocol/index';
import { routeFromUrl, sameTarget, DEFAULT_PERMISSION_MODE, DEFAULT_TURN_DELIVERY, SettingsSchema } from '../../../packages/protocol/index';
import type {BoardGenerationRequest} from '../../host/boards';
import type { SourceNode } from '../../../packages/core/lossless-html';
import { rpc } from '../lib/client';
import {consumeSave} from '../lib/save-continuation';
import {polarionFeedback} from '../lib/polarion-feedback';
import {SettingsPanel} from './SettingsPanel';
import {WorkItemReader, type WorkItemView} from './WorkItemReader';
import {RequirementsOverview} from './RequirementsOverview';

import { DraftEditor } from './DraftEditor';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { NativeInteraction } from './NativeInteraction';
import { AttachmentCards, AttachmentPreview } from './Attachments';
import { uploadAsset } from '../lib/assets';
import { Layout, NativeState, outline, navigateHeading, documentFrame } from '../lib/layout';
type DraftView = Draft & { nodes: SourceNode[]; version: string };
type AssistantSettings = ReturnType<typeof SettingsSchema.parse>;
const DEFAULT_ASSISTANT_FONT_SIZE = SettingsSchema.shape.assistantFontSize.parse(undefined);
const errors: Record<string, string> = { NATIVE_EDITOR_DIRTY: '原生文档存在输入，请先在原生界面保存或撤销并刷新，再保存草稿。', NATIVE_EDITOR_UNKNOWN: '尚不能确认原生编辑状态。请先保存或放弃原生修改并刷新文档。', REMOTE_CONFLICT: '服务端内容已变化，草稿保留；需要合并后再保存。', STALE_DRAFT: '草稿已被另一处修改，已保留当前版本，请刷新草稿后继续。', DEVELOPMENT_WRITE_SCOPE: '本地服务仍是旧版，请重新加载扩展后再保存。', READBACK_MISMATCH: '保存回读与草稿不一致，请核对服务端内容；不要重复保存。', SESSION_QUEUE_FULL: '排队请求过多（最多 5 条），请等当前任务推进后再发送。',
  WORK_ITEM_DOCUMENT_MISMATCH: '该工作项不在当前文档，本地也没有对应草稿；请先打开它所在的文档再预览。', DRAFTS_FOLDER_NOT_ABSOLUTE: '共享草稿存储位置必须是绝对路径，例如 D:\\PolarionDrafts。', DRAFTS_FOLDER_INVALID: '共享草稿存储位置无法创建或写入，请检查文件夹权限。', GUIDELINE_NOT_FOUND: '所选附加指令已被删除，请重新选择。', GUIDELINE_EMPTY: '指令内容与本地文件路径不能都为空。', GUIDELINE_FILE_INVALID: '指令文件不存在或不可读，请检查路径。', GUIDELINE_FILE_UNREADABLE: '指令文件当前无法读取，请检查路径。', GUIDELINE_FILE_TOO_LARGE: '指令文件超过 200KB，请精简后重试。',
  VARIANT_NOT_FOUND: '变体记录不存在，请重新同步变体列表。', VARIANT_DRAFT_DIRTY: '变体还有未保存的本地修改，请先打开变体并保存。', MAIN_DRAFT_DIRTY: '主工作项还有未保存的本地修改，请先保存或放弃后再接入变体。', MAIN_CHANGED_SINCE_DRAFT: '主工作项在打开后已被其他位置修改，请先核对服务端。', MAIN_CHANGED_SINCE_APPLY: '主工作项在接入后又发生了变化，不能直接撤销。', VARIANT_BOARD_UNSUPPORTED: '变体正文含画板，当前版本暂不支持跨工作项接入。', VARIANT_BOARD_COPY_FAILED: '画板快照复制失败，主工作项/变体未被修改；请检查画板源文件是否完整。', VARIANT_IMAGE_COPY_FAILED: '变体图片无法复制到主工作项，请先移除或替换相关图片。', VARIANT_LINK_REQUIRED: '变体与主工作项的关联尚未建立，请先重试关联。', VARIANT_LINK_ROLE_INVALID: '配置的链接角色在项目中不可用，请重新选择。', VARIANT_LINK_ROLE_REQUIRED: '项目没有可用的工作项链接角色，无法建立变体归属。', VARIANT_LINK_FAILED: '变体关联写入失败，请稍后重试。', VARIANT_TYPE_REQUIRED: '主工作项缺少类型，无法创建同类型变体。', VARIANT_BACKEND_UNAVAILABLE: '本地 Host 未提供变体写入能力，请重新加载扩展或更新 Host。', WORK_ITEM_CREATE_FAILED: '变体工作项创建失败，请检查项目权限与必填字段。', WORK_ITEM_CREATE_UNVERIFIED: '变体工作项已创建但回读未通过，请在 Polarion 中核对。', VARIANT_APPLY_NOT_FOUND: '找不到这次接入记录，无法撤销。', VARIANT_APPLY_ALREADY_UNDONE: '这次接入已经撤销过了。', VARIANT_DEFAULT_CAPTURE_FAILED: '首次接入需要先把主工作项正文保存为「默认」变体，但保存失败；主工作项未被改动。', VARIANT_DEFAULT_DRAFT_DIRTY: '默认变体还有首次捕获的内容尚未保存；请打开「默认」变体保存后再接入。', VARIANT_DEFAULT_CAPTURE_BOARD: '主工作项正文含画板，无法安全捕获为默认变体；请先移除画板或手动处理。', VARIANT_TARGET_MISMATCH: '变体不属于当前文档，请重新同步变体列表。', NATIVE_ITEM_NOT_LOADED: '主页面当前显示的不是这个工作项，请先回到主工作项再接入。', NATIVE_DOCUMENT_CHANGED: '主页面文档在接入期间发生了变化，请刷新后重试。', NATIVE_REFRESH_FAILED: '主页面正文刷新失败，请手动刷新文档核对。', NATIVE_REFRESH_UNSUPPORTED: '当前 Polarion 版本不支持自动刷新，请手动刷新文档核对。' };
const errorText = (e: unknown) => polarionFeedback((e as Error).message) ?? errors[(e as Error).message] ?? (e as Error).message;
const statusText: Record<string, string> = { running: '正在处理', waiting: '等待工具确认', queued: '已排队 · 等待上一轮', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '已打断' };
// 会话历史按今天/昨天/更早分组，避免平铺列表随会话增长失控。
function sessionGroups(sessions: Session[], registered: SessionGroup[]) {
  const active = sessions.filter(s => !s.archived);
  // 分组登记独立存在（空分组也显示）；会话按组名归入，登记顺序即展示顺序。
  const byGroup = new Map<string, Session[]>();
  const plain: Session[] = [];
  for (const s of [...active].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (s.group) { const rows = byGroup.get(s.group) ?? []; rows.push(s); byGroup.set(s.group, rows); }
    else plain.push(s);
  }
  const named: { label: string; rows: Session[] }[] = [];
  const seen = new Set<string>();
  for (const g of registered) {
    if (seen.has(g.name)) continue;
    seen.add(g.name);
    named.push({ label: g.name, rows: byGroup.get(g.name) ?? [] });
  }
  for (const [label, rows] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))) {
    if (!seen.has(label)) { seen.add(label); named.push({ label, rows }); }
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400000);
  const buckets: { label: string; rows: Session[] }[] = [{ label: '今天', rows: [] }, { label: '昨天', rows: [] }, { label: '更早', rows: [] }];
  for (const session of plain) {
    const updated = new Date(session.updatedAt);
    (updated >= today ? buckets[0]! : updated >= yesterday ? buckets[1]! : buckets[2]!).rows.push(session);
  }
  return [...named, ...buckets.filter(group => group.rows.length > 0)];
}
type PreviewRect = { left: number; top: number; right: number; bottom: number };
type PreviewState = { id: string; text: string; state?: string; source?: 'draft' | 'remote'; loading: boolean; failed?: boolean; rect?: PreviewRect; fallback?: string; revision?: number };

export function App() {
  const [target, setTarget] = useState<Target | null>(() => routeFromUrl(location.href));
  const [open, setOpen] = useState(true); const [tab, setTab] = useState('ai'); const [pageReady, setPageReady] = useState(false);
  const [width, setWidth] = useState(410); const [geometry, setGeometry] = useState({ top: 46, overlay: false });
  const [health, setHealth] = useState(false); const [error, setError] = useState('');
  const [saveNotice,setSaveNotice]=useState('');
  const [requestedBoard,setRequestedBoard]=useState<BoardGenerationRequest|null>(null);
  const [restoredEditorScroll,setRestoredEditorScroll]=useState<number|undefined>();
  useEffect(()=>{if(!saveNotice)return;const timer=setTimeout(()=>setSaveNotice(''),10000);return()=>clearTimeout(timer);},[saveNotice]);
  useEffect(()=>{if(!target)return;let disposed=false;const key='save-receipt:'+JSON.stringify(target);void browser.storage.local.get(key).then(async value=>{const receipt=value[key] as {workItemId:string;at:number}|undefined;if(!disposed&&receipt&&Date.now()-receipt.at<120000)setSaveNotice(receipt.workItemId+' 已保存到 Polarion，服务端回读一致。');if(receipt)await browser.storage.local.remove(key);});return()=>{disposed=true;};},[target]);
  const [contexts, setContexts] = useState<Context[]>([]); const [pinnedOutline, setPinnedOutline] = useState(false);
  const [headings, setHeadings] = useState<ReturnType<typeof outline>>([]); const [sessions, setSessions] = useState<Session[]>([]);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null); const [eventHistory, setEventHistory] = useState(emptyEventHistory); const {events, byRun} = eventHistory; const [loadingHistory, setLoadingHistory] = useState(false); const [runs, setRuns] = useState<Run[]>([]);
  const [history, setHistory] = useState(false); const [settings, setSettings] = useState(false); const [config, setConfig] = useState<AssistantSettings | null>(null);
  const [assistantFontSize,setAssistantFontSize]=useState(DEFAULT_ASSISTANT_FONT_SIZE);
  const [settingsLoading,setSettingsLoading]=useState(false),[settingsSaving,setSettingsSaving]=useState(false),[settingsError,setSettingsError]=useState('');
  const [settingsTab,setSettingsTab]=useState<'general'|'appearance'|'storage'|'guidelines'>('general');
  const settingsRequest=useRef(0),settingsVersion=useRef(0),settingsSaveBusy=useRef(false),settingsTrigger=useRef<HTMLElement|null>(null);
  const closeSettings=useCallback(()=>{if(settingsSaveBusy.current)return;settingsRequest.current++;setSettings(false);setConfig(null);setGuidelineDrafts(null);setSettingsLoading(false);setSettingsError('');settingsTrigger.current?.focus();void rpc<Guideline[]>({method:'guidelines.list'}).then(rows=>setGuidelines(rows)).catch(()=>{});},[]);
  const [awayFromLatest,setAwayFromLatest]=useState(false);
  const [turnWindow,setTurnWindow]=useState(40);
  const [pickerHidden,setPickerHidden]=useState(false);
  const [pickerIndex,setPickerIndex]=useState(0);
  const [permissionMode,setPermissionMode]=useState<PermissionMode>(DEFAULT_PERMISSION_MODE);
  const [delivery,setDelivery]=useState<TurnDelivery>(DEFAULT_TURN_DELIVERY);
  const behaviorDefaults=useRef({permissionMode:DEFAULT_PERMISSION_MODE,delivery:DEFAULT_TURN_DELIVERY});
  const [behaviorDefaultsVersion,setBehaviorDefaultsVersion]=useState(0);
  const [guidelines,setGuidelines]=useState<Guideline[]>([]);
  const [guidelineId,setGuidelineId]=useState('');
  const [guidelineDrafts,setGuidelineDrafts]=useState<Guideline[]|null>(null);
  const persistedGuidelineIds=useRef<Set<string>>(new Set());const deletedGuidelines=useRef<string[]>([]);
  const [draftsFolderNote,setDraftsFolderNote]=useState('');
  const [draftSelection,setDraftSelection]=useState<Set<string>>(new Set());
  const [deleteArmed,setDeleteArmed]=useState(false);const deleteArmTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(()=>{setDeleteArmed(false);clearTimeout(deleteArmTimer.current);},[draftSelection]);
  const [input, setInput] = useState(''); const [sending, setSending] = useState(false); const [drafts, setDrafts] = useState<Draft[]>([]);
  // 草稿列表变化后清理已失效的选中项，避免删除后按钮仍显示旧计数。
  useEffect(()=>{setDraftSelection(current=>{if(!current.size)return current;const alive=new Set(drafts.map(d=>d.id));const next=new Set([...current].filter(id=>alive.has(id)));return next.size===current.size?current:next;});},[drafts]);
  const [capabilities, setCapabilities] = useState<EngineCapabilities | null>(null); const [showCapabilities, setShowCapabilities] = useState(false); const [loadingCapabilities, setLoadingCapabilities] = useState(false); const [capabilityError, setCapabilityError] = useState('');
  const historyTrigger=useRef<HTMLButtonElement>(null),historyPanel=useRef<HTMLDivElement>(null),capabilitiesTrigger=useRef<HTMLButtonElement>(null);
  const closeHistory=useCallback(()=>{setHistory(false);historyTrigger.current?.focus();},[]);
  const closeCapabilities=useCallback(()=>{setShowCapabilities(false);capabilitiesTrigger.current?.focus();},[]);
  useEffect(()=>{if(history)(historyPanel.current?.querySelector('button')??historyPanel.current)?.focus();},[history]);
  const capabilityRequest=useRef(0),capabilityBusy=useRef(false);
  const composerInput=useRef<HTMLTextAreaElement>(null); const slashMenu=useRef<HTMLDivElement>(null);
  const [slashIndex, setSlashIndex] = useState(0); const [slashHidden, setSlashHidden] = useState(false);
  const [attachments, setAttachments] = useState<Asset[]>([]); const [uploadProgress, setUploadProgress] = useState(''); const [previewAsset, setPreviewAsset] = useState<Asset | null>(null); const [dragOver, setDragOver] = useState(false);
  const uploadCount = useRef(0); const attachmentFiles = useRef<HTMLInputElement>(null); const loadedAttachmentProject = useRef<string | null>(null); const attachmentRef = useRef(attachments); attachmentRef.current = attachments;
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [nativePreview, setNativePreview] = useState<PreviewState | null>(null);
  const [reader, setReader] = useState<WorkItemView | null>(null);
  const readerRequest = useRef(0);
  /** 软件需求分析总览：覆盖文档区，不挤占侧边栏；入口只有头部一个按钮。 */
  const [overview, setOverview] = useState(false);
  const previewCache = useRef(new Map<string, { text: string; state?: string; revision?: number; source?: 'draft' | 'remote'; at: number }>());
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const previewHideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const updatePreview = (id: string, patch: Partial<PreviewState>) => setNativePreview(current => current && current.id === id ? { ...current, ...patch } : current);
  /** 正文工作项块悬停的小卡片：先用页面文本即时显示，再补充草稿标题/版本信息。 */
  const schedulePreview = useCallback((id: string, rect?: PreviewRect, fallback?: string) => {
    clearTimeout(previewTimer.current); clearTimeout(previewHideTimer.current);
    previewTimer.current = setTimeout(async () => {
      const cached = previewCache.current.get(id);
      if (cached && Date.now() - cached.at < 60000) { setNativePreview({ id, text: cached.text || fallback?.slice(0, 600) || '', state: cached.state, revision: cached.revision, source: cached.source, loading: false, rect }); return; }
      setNativePreview({ id, text: fallback?.slice(0, 600) ?? '', fallback: fallback?.slice(0, 600), loading: true, rect });
      const currentTarget = targetRef.current; if (!currentTarget) return;
      try {
        const value = await rpc<{ workItemId: string; title: string; text: string; state?: string; revision?: number; source: 'draft' | 'remote' }>({ method: 'workitems.peek', target: currentTarget, workItemId: id });
        const text = (value.text || '').slice(0, 1200);
        previewCache.current.set(id, { text, state: value.state, revision: value.revision, source: value.source, at: Date.now() });
        updatePreview(id, { text: text || fallback?.slice(0, 600) || '', state: value.state, revision: value.revision, source: value.source, loading: false });
      } catch { updatePreview(id, { loading: false, failed: true }); }
    }, 150);
  }, []);
  const hidePreview = useCallback(() => { clearTimeout(previewTimer.current); clearTimeout(previewHideTimer.current); previewHideTimer.current = setTimeout(() => setNativePreview(null), 240); }, []);
  const keepPreview = useCallback(() => { clearTimeout(previewHideTimer.current); }, []);
  const openReader = useCallback(async (workItemId: string) => {
    setNativePreview(null);
    const ticket = ++readerRequest.current;
    try {
      const currentTarget = targetRef.current; if (!currentTarget) return;
      const view = await rpc<WorkItemView>({ method: 'workitems.read', target: currentTarget, workItemId });
      if (ticket !== readerRequest.current || !targetRef.current || !sameTarget(currentTarget, targetRef.current)) return;
      setError(''); setReader(view);
    } catch (e) { if (ticket === readerRequest.current) setError(errorText(e)); }
  }, []);
  const openReaderRef = useRef(openReader); openReaderRef.current = openReader;
  const editDraftRef = useRef<(workItemId: string) => unknown>(() => {});
  const draftRef=useRef(draft);draftRef.current=draft;
  const draftOpenRequest=useRef(0);
  useEffect(()=>{if(draft?.state==='dirty')setSaveNotice('');},[draft?.state,draft?.revision]);
  const [editorAI,setEditorAI]=useState(true);const prepareAI=useRef<(()=>Promise<void>)|null>(null);const priorTab=useRef('ai');
  useEffect(()=>{if(!(draft?editorAI:open))closeSettings();},[draft?.id,editorAI,open,closeSettings]);
  useEffect(()=>{
    if(!health)return;let disposed=false;const version=settingsVersion.current;
    void rpc({method:'settings.read'}).then(value=>{
      if(disposed||version!==settingsVersion.current)return;
      const parsed=SettingsSchema.parse(value);
      setAssistantFontSize(parsed.assistantFontSize);setDraftsFolderNote(parsed.draftsFolder.trim());
      behaviorDefaults.current={permissionMode:parsed.defaultPermissionMode,delivery:parsed.defaultTurnDelivery};setBehaviorDefaultsVersion(v=>v+1);
    }).catch(e=>{if(!disposed&&version===settingsVersion.current)setError('读取助手设置失败：'+errorText(e));});
    void rpc<Guideline[]>({method:'guidelines.list'}).then(rows=>{if(!disposed)setGuidelines(rows);}).catch(()=>{});
    return()=>{disposed=true;};
  },[health]);
  // 会话切换或设置保存后，批准方式与运行中新输入回到默认值；会话内手动选择保持到下次切换。
  useEffect(()=>{setPermissionMode(behaviorDefaults.current.permissionMode);setDelivery(behaviorDefaults.current.delivery);},[session?.id,behaviorDefaultsVersion]);
  useEffect(()=>{setTurnWindow(40);},[session?.id]);
  const layout = useRef(new Layout()); const native = useRef(new NativeState()); const cursor = useRef(0); const scrolling = useRef<HTMLDivElement>(null); const followOutput=useRef(true);
  const layoutSettings=useRef({open,width,target});layoutSettings.current={open,width,target};
  const syncLayout=useCallback(()=>{if(document.hidden)return;const {open,width,target}=layoutSettings.current;const geometry=layout.current.apply(open&&!!target,width);setGeometry(old=>old.top===geometry.top&&old.overlay===geometry.overlay?old:geometry);},[]);
  const outlineVisible=(draft?editorAI:open)&&(tab==='outline'||pinnedOutline);
  const targetRef = useRef(target); targetRef.current = target;
  const routeEpoch=useRef(0);
  const updateCurrentDraft=useCallback((updated:DraftView)=>{const page=routeFromUrl(location.href);setDraft(current=>current?.id===updated.id&&updated.revision>=current.revision&&sameTarget(current.target,updated.target)&&!!page&&sameTarget(updated.target,page)&&!!targetRef.current&&sameTarget(updated.target,targetRef.current)?updated:current);},[]);
  // 变体接入/撤销后，主草稿已在服务端验证写入；同步本地视图并刷新原生正文。
  const variantChanged=useCallback(async(saved:DraftView,notice:string)=>{
    if(!draftRef.current||draftRef.current.id!==saved.id)return;
    setDraft(saved);
    setDrafts(list=>list.map(d=>d.id===saved.id?{...d,revision:saved.revision,state:saved.state}:d));
    try{
      const result=await browser.runtime.sendMessage({type:'native-workitem-refresh',workItemId:saved.workItemId,phase:'refresh',expectedHtml:saved.html});
      if(!result?.ok)throw Error(result?.error??'NATIVE_REFRESH_FAILED');
      native.current.acceptDocumentRefresh();
      setSaveNotice(notice);
    }catch(e){setSaveNotice(notice+' 原生页面尚未刷新：'+errorText(e));}
  },[]);
  const sessionRef = useRef(session); sessionRef.current = session;
  useEffect(() => { let disposed=false;loadedAttachmentProject.current=null;if(!target)return;void browser.storage.local.get('composer-attachments:'+target.projectId).then(value=>{if(!disposed){setAttachments((value['composer-attachments:'+target.projectId] as Asset[])??[]);loadedAttachmentProject.current=target.projectId;}});return()=>{disposed=true;};},[target?.projectId]);
  useEffect(() => { if(target&&loadedAttachmentProject.current===target.projectId)void browser.storage.local.set({['composer-attachments:'+target.projectId]:attachments}); },[attachments,target?.projectId]);
  useEffect(() => { void browser.storage.local.get('workspace-preferences').then(value => { const p = value['workspace-preferences'] as any; if (p) { if (typeof p.open === 'boolean') setOpen(p.open); if (typeof p.pinnedOutline === 'boolean') setPinnedOutline(p.pinnedOutline); if (typeof p.width === 'number') setWidth(Math.max(340, Math.min(560, p.width))); } }).finally(() => setPreferencesLoaded(true)); }, []);
  useEffect(() => { if (!preferencesLoaded)return;const timer=setTimeout(()=>void browser.storage.local.set({ 'workspace-preferences': { open, width, pinnedOutline } }),150);return()=>clearTimeout(timer); }, [open, width, pinnedOutline, preferencesLoaded]);
  useEffect(() => { if (session) void browser.storage.local.set({ ['active-project-session:' + session.target.projectId]: session.id }); }, [session?.id]);
  useEffect(() => { if (!target) return; let disposed = false; const key = 'composer:' + JSON.stringify(target); void browser.storage.local.get(key).then(saved => { if (!disposed && typeof saved[key] === 'string') setInput(saved[key]); }); return () => { disposed = true; }; }, [target]);
  useEffect(() => {
    const update = () => { const next = routeFromUrl(location.href); if (JSON.stringify(next) !== JSON.stringify(targetRef.current)) { routeEpoch.current++;draftOpenRequest.current++;readerRequest.current++;const sameProject = next && next.projectId === targetRef.current?.projectId; setTarget(next); setContexts(list => sameProject ? list.filter(c => c.pinned) : []); if (!sameProject) { setSession(null); setEventHistory(emptyEventHistory()); } setDraft(null); setReader(null); setOverview(false); } };
    window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'toggle') setOpen(v => !v);
      if (message.type === 'context' && targetRef.current && sameTarget(message.context.target, targetRef.current)) {
        setContexts(list => [...list.filter(c => c.pinned), message.context].slice(-12)); if (message.open) { setOpen(true); setTab('ai'); }
      }
      if (message.type === 'preview' && message.workItemId) schedulePreview(String(message.workItemId), message.rect, String(message.text ?? ''));
      if (message.type === 'edit-workitem' && message.workItemId) void editDraftRef.current(String(message.workItemId));
      if (message.type === 'open-workitem' && message.workItemId) void openReaderRef.current?.(message.workItemId);
    };
    const frameMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      const data = event.data as { __polarionSidebar?: string; workItemId?: unknown };
      if (data?.__polarionSidebar === 'open-workitem' && typeof data.workItemId === 'string') void openReaderRef.current?.(data.workItemId);
    };
    window.addEventListener('message', frameMessage);
    browser.runtime.onMessage.addListener(listener);
    return () => { browser.runtime.onMessage.removeListener(listener); window.removeEventListener('message', frameMessage); };
  }, []);
  // Resizing changes pane geometry only; document scans must not run for every pointer move.
  useEffect(()=>{syncLayout();},[open,width,target,syncLayout]);
  useEffect(() => {
    const updateDocument = () => { if(document.hidden)return;setPageReady(!!documentFrame());syncLayout();native.current.bind();if(outlineVisible){const headings=outline();setHeadings(old=>JSON.stringify(old)===JSON.stringify(headings)?old:headings);} };
    updateDocument();const timer=setInterval(updateDocument,2000);window.addEventListener('resize',syncLayout);document.addEventListener('visibilitychange',updateDocument);
    return()=>{clearInterval(timer);window.removeEventListener('resize',syncLayout);document.removeEventListener('visibilitychange',updateDocument);};
  },[target,outlineVisible,syncLayout]);
  useEffect(() => () => {native.current.close();layout.current.reset();}, []);
  useEffect(()=>{
    if(!target||!pageReady)return;
    let saved;try{saved=consumeSave(sessionStorage,target);}catch{return;}if(!saved)return;
    let disposed=false;
    void rpc<DraftView>({method:'drafts.read',draftId:saved.draftId}).then(value=>{
      if(disposed||!sameTarget(value.target,target)||value.workItemId!==saved.workItemId)return;
      setRestoredEditorScroll(saved.editorScrollTop);setDraft(value);setEditorAI(true);setTab('ai');
      setSaveNotice(value.workItemId+' 已保存并回读一致，已恢复编辑工作台。');
      documentFrame()?.contentWindow?.scrollTo(0,saved.scrollTop);
    }).catch(e=>{if(!disposed)setError(errorText(e));});
    return()=>{disposed=true;};
  },[target,pageReady]);
  useEffect(() => {
    if (!target) return; let disposed = false;
    const refresh = async () => { try { await rpc({ method: 'health' }); if (disposed) return; setHealth(true); const rows = await rpc<Session[]>({ method: 'sessions.list', projectId: target.projectId }); if (disposed) return; setSessions(old=>JSON.stringify(old)===JSON.stringify(rows)?old:rows);
      const groupRows = await rpc<SessionGroup[]>({ method: 'sessionGroups.list' }); if (!disposed) setSessionGroupRows(old=>JSON.stringify(old)===JSON.stringify(groupRows)?old:groupRows);
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
        if(response.session)setSession(current=>current?.id===response.session!.id&&JSON.stringify(current)!==JSON.stringify(response.session)?response.session!:current);
        cursor.current = response.cursor;
        setEventHistory(previous => appendSessionEvents(previous, response.events));
        setLoadingHistory(response.more);
        if(response.events.some(e=>e.kind==='draft')&&targetRef.current){const t=targetRef.current;void rpc<Draft[]>({method:'drafts.list',target:t}).then(rows=>{if(!disposed&&targetRef.current&&sameTarget(t,targetRef.current))setDrafts(old=>JSON.stringify(old)===JSON.stringify(rows)?old:rows);}).catch(()=>{});}
        nextPoll=setTimeout(poll,response.more||wakePending?0:document.hidden?5000:response.runs.some(r=>['running','waiting','queued'].includes(r.status))?700:2000);
      } catch (e) { if (!disposed) {setError(errorText(e));nextPoll=setTimeout(poll,3000);} } finally { busy = false; wakePending = false; }
    }; const wake=()=>{clearTimeout(nextPoll);void poll();};window.addEventListener('polarion-sidebar-run-started',wake);void poll(); return () => { disposed = true; clearTimeout(nextPoll);window.removeEventListener('polarion-sidebar-run-started',wake); };
  }, [session?.id]);
  // 流式输出时每帧最多贴底一次，避免逐条事件 setState 造成的抖动；用户向上滚动后不再抢位置。
  useEffect(() => {
    if (!followOutput.current) return;
    const element = scrolling.current; if (!element) return;
    const frame = requestAnimationFrame(() => { if (followOutput.current && element === scrolling.current) element.scrollTop = element.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [events.length]);
  useEffect(() => { const keepBottom = () => { if (!followOutput.current || !scrolling.current) return; scrolling.current.scrollTop = scrolling.current.scrollHeight; }; window.addEventListener('resize', keepBottom); return () => window.removeEventListener('resize', keepBottom); }, []);
  const active = runs.find(r => ['running', 'waiting'].includes(r.status));
  const sendGuidelines = guidelines.filter(g => g.kind === 'send');
  const queuedCount = runs.reduce((count, run) => count + (run.status === 'queued' ? 1 : 0), 0);
  const workItemQuery = matchWorkItemQuery(input);
  // 候选 = 本文档全部工作项（本地即时过滤）+ 本地草稿 + Polarion 搜索（防抖补全）。
  type PickerHit = { workItemId: string; title: string; source: 'document' | 'draft' | 'remote'; state?: Draft['state'] };
  const [documentItems, setDocumentItems] = useState<ReturnType<typeof documentWorkItems>>([]);
  const [remoteItems, setRemoteItems] = useState<PickerHit[]>([]);
  const pickerSearch = useRef(0);
  useEffect(() => {
    if (workItemQuery === null) { setRemoteItems([]); return; }
    setDocumentItems(documentWorkItems());
    if (!target) return;
    const ticket = ++pickerSearch.current; setRemoteItems([]);
    const timer = setTimeout(() => {
      void rpc<PickerHit[]>({ method: 'workitems.search', target, query: workItemQuery, limit: 8 }).then(rows => { if (ticket === pickerSearch.current && targetRef.current?.projectId === target.projectId) setRemoteItems(rows); }).catch(() => { if (ticket === pickerSearch.current) setRemoteItems([]); });
    }, 250);
    return () => clearTimeout(timer);
  }, [workItemQuery, target?.projectId]);
  const workItemCandidates = useMemo<PickerHit[]>(() => {
    if (workItemQuery === null) return [];
    const query = workItemQuery.toLowerCase();
    const localDrafts = drafts
      .filter(draft => !query || draft.workItemId.toLowerCase().includes(query) || draft.title.toLowerCase().includes(query))
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .map(draft => ({ workItemId: draft.workItemId, title: draft.title, source: 'draft' as const, state: draft.state }));
    const fromDocument = filterWorkItems(documentItems, workItemQuery).map(item => ({ ...item, source: 'document' as const }));
    const seen = new Set<string>(); const merged: PickerHit[] = [];
    for (const hit of [...fromDocument, ...localDrafts, ...remoteItems]) { if (seen.has(hit.workItemId)) continue; seen.add(hit.workItemId); merged.push(hit); if (merged.length >= 60) break; }
    return merged;
  }, [drafts, workItemQuery, documentItems, remoteItems]);
  const workItemPickerOpen = workItemQuery !== null && !pickerHidden && !input.startsWith('/') && workItemCandidates.length > 0;
  const chooseWorkItem = (id: string) => { setInput(value => applyWorkItemPick(value, id)); setPickerHidden(true); composerInput.current?.focus(); };

  const displayedPermissionMode=active?.permissionMode??permissionMode;
  async function loadCapabilities(refresh = false) { if (!target || capabilityBusy.current) return; capabilityBusy.current=true;const ticket=++capabilityRequest.current;setLoadingCapabilities(true); setCapabilityError(''); try { const value=await rpc<EngineCapabilities>({ method: 'engine.capabilities', target, sessionId:session?.id, refresh });if(ticket===capabilityRequest.current)setCapabilities(value); } catch (e) { if(ticket===capabilityRequest.current)setCapabilityError(errorText(e)); } finally { if(ticket===capabilityRequest.current){capabilityBusy.current=false;setLoadingCapabilities(false);} } }
  async function manageCapabilities(action:'reload-skills'|'reconnect-mcp',server?:string){if(!session||capabilityBusy.current)return;capabilityBusy.current=true;const ticket=++capabilityRequest.current;setLoadingCapabilities(true);setCapabilityError('');try{const value=await rpc<EngineCapabilities>({method:'engine.manage',sessionId:session.id,action,server});if(ticket===capabilityRequest.current)setCapabilities(value);}catch(e){if(ticket===capabilityRequest.current)setCapabilityError(errorText(e));}finally{if(ticket===capabilityRequest.current){capabilityBusy.current=false;setLoadingCapabilities(false);}}}
  useEffect(()=>{capabilityRequest.current++;capabilityBusy.current=false;setCapabilities(null);setCapabilityError('');setLoadingCapabilities(false);},[session?.id,target?.projectId]);
  useEffect(()=>{if(!showCapabilities)return;void loadCapabilities();const timer=setInterval(()=>{if(!document.hidden)void loadCapabilities();},15000);return()=>clearInterval(timer);},[showCapabilities,session?.id,active?.id]);
  useEffect(() => { if (input.startsWith('/') && !capabilities && !loadingCapabilities) void loadCapabilities(); }, [input]);
  const commandQuery = slashQuery(input);
  const slashOpen = !slashHidden && commandQuery !== null;
  const [slashNavigated,setSlashNavigated]=useState(false);
  const slashMatches = useMemo(() => filterCommands(capabilities?.commands ?? [], commandQuery ?? ''), [capabilities, commandQuery]);
  useEffect(() => { setSlashIndex(0); }, [commandQuery, capabilities]);
  useEffect(() => { setPickerIndex(0); }, [workItemQuery]);
  useEffect(() => { if(slashOpen) slashMenu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}); }, [slashIndex, slashOpen]);
  useEffect(() => { const el=composerInput.current;if(!el)return;el.style.height='40px';el.style.height=Math.min(140,Math.max(40,el.scrollHeight))+'px'; }, [input, open, draft?.id, editorAI, tab, pageReady, width]);
  const chooseCommand = (value: string) => { setInput(value); setSlashHidden(true); setShowCapabilities(false); composerInput.current?.focus(); };
  const toggleSettings = async (trigger:HTMLElement, tab: 'general'|'appearance'|'storage'|'guidelines' = 'general') => {
    if(settingsSaveBusy.current)return;
    if(settings){closeSettings();return;}
    settingsTrigger.current=trigger;setSettingsTab(tab);setSettings(true);setSettingsLoading(true);setSettingsError('');setConfig(null);
    const ticket=++settingsRequest.current;
    try {const next=SettingsSchema.parse(await rpc({method:'settings.read'}));if(ticket===settingsRequest.current){settingsVersion.current++;setAssistantFontSize(next.assistantFontSize);setDraftsFolderNote(next.draftsFolder.trim());setConfig(next);const rows=await rpc<Guideline[]>({method:'guidelines.list'});if(ticket===settingsRequest.current){persistedGuidelineIds.current=new Set(rows.map(g=>g.id));deletedGuidelines.current=[];setGuidelines(rows);setGuidelineDrafts(structuredClone(rows));}}}
    catch(e){if(ticket===settingsRequest.current)setSettingsError('读取设置失败：'+errorText(e));}
    finally{if(ticket===settingsRequest.current)setSettingsLoading(false);}
  };
  const saveSettings=async()=>{
    if(!config||settingsSaveBusy.current)return;
    const drafts=guidelineDrafts??[];
    for(const [index,item] of drafts.entries())if(!item.name.trim()){setSettingsError(`第 ${index+1} 条指令缺少指令名。`);return;}
    for(const [index,item] of drafts.entries())if(!item.content.trim()&&!item.files.length){setSettingsError(`第 ${index+1} 条指令「${item.name.trim()}」既没有正文也没有本地文件。`);return;}
    settingsSaveBusy.current=true;settingsRequest.current++;settingsVersion.current++;setSettingsSaving(true);setSettingsError('');
    try{
      const saved=SettingsSchema.parse(await rpc({method:'settings.write',settings:config}));
      for(const item of drafts)await rpc({method:'guidelines.save',guideline:{...item,file:''}});
      for(const id of deletedGuidelines.current)await rpc({method:'guidelines.delete',id});
      deletedGuidelines.current=[];
      const rows=await rpc<Guideline[]>({method:'guidelines.list'});
      persistedGuidelineIds.current=new Set(rows.map(g=>g.id));setGuidelines(rows);setGuidelineDrafts(structuredClone(rows));
      setAssistantFontSize(saved.assistantFontSize);setDraftsFolderNote(saved.draftsFolder.trim());behaviorDefaults.current={permissionMode:saved.defaultPermissionMode,delivery:saved.defaultTurnDelivery};setBehaviorDefaultsVersion(v=>v+1);
      settingsSaveBusy.current=false;closeSettings();
    }
    catch(e){setSettingsError('保存失败，当前调整尚未确认保存：'+errorText(e));}
    finally{settingsSaveBusy.current=false;setSettingsSaving(false);}
  };
  // 两步确认：第一次点击进入待确认态，4 秒内再次点击才执行，避免误删本地草稿。
  const armDeleteDrafts=()=>{
    if(!draftSelection.size)return;
    if(!deleteArmed){setDeleteArmed(true);clearTimeout(deleteArmTimer.current);deleteArmTimer.current=setTimeout(()=>setDeleteArmed(false),4000);return;}
    clearTimeout(deleteArmTimer.current);setDeleteArmed(false);void deleteSelectedDrafts();
  };
  const deleteSelectedDrafts=async()=>{
    const ids=[...draftSelection];if(!ids.length)return;
    try{
      await rpc({method:'drafts.delete',draftIds:ids});
      const deleted=new Set(ids),deletedItems=new Set(drafts.filter(d=>deleted.has(d.id)).map(d=>d.workItemId));
      setDraftSelection(new Set());setDrafts(list=>list.filter(d=>!deleted.has(d.id)));
      setContexts(list=>list.filter(c=>c.pinned||!c.workItemId||!deletedItems.has(c.workItemId)));
      if(draftRef.current&&deleted.has(draftRef.current.id)){draftOpenRequest.current++;setDraft(null);setRestoredEditorScroll(undefined);prepareAI.current=null;setTab(priorTab.current);}
    }catch(e){setError(errorText(e));}
  };
  async function addAttachments(files: File[]) {
    const uploadTarget=targetRef.current;if(!uploadTarget)return;
    if(files.length+attachmentRef.current.length+uploadCount.current>12){setError('每次任务最多添加 12 个附件。');return;}
    uploadCount.current+=files.length;
    for(const file of files){try{setUploadProgress('正在加入 '+file.name);const a=await uploadAsset(file,uploadTarget,n=>setUploadProgress(`${file.name} · ${n}%`));if(targetRef.current?.projectId===uploadTarget.projectId)setAttachments(list=>[...list,a]);else{const key='composer-attachments:'+uploadTarget.projectId;const saved=await browser.storage.local.get(key);await browser.storage.local.set({[key]:[...((saved[key] as Asset[])??[]),a]});}}catch(e){setError(file.name+'：'+errorText(e));}finally{uploadCount.current--;}}
    if(!uploadCount.current)setUploadProgress('');
  }
  async function newSession() { if (!target) return null;const epoch=routeEpoch.current;const s = await rpc<Session>({ method: 'sessions.create', target, title: '新工程会话' });if(epoch!==routeEpoch.current||!targetRef.current||!sameTarget(target,targetRef.current))return null;setSessions(list => [s, ...list]); setSession(s); setHistory(false); return s; }
  // ---- 会话管理：重命名 / 归档 / 分组 / 删除。错误统一走 setError，操作后本地更新列表。 ----
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [groupingId, setGroupingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  async function renameSession(s: Session, title: string) {
    const name = title.trim(); if (!name) { setRenamingId(null); return; }
    try { const renamed = await rpc<Session>({ method: 'sessions.rename', sessionId: s.id, title: name.slice(0, 100) });
      setSessions(list => list.map(x => x.id === renamed.id ? renamed : x)); if (session?.id === renamed.id) setSession(renamed);
      setRenamingId(null);
    } catch (e) { setError(errorText(e)); }
  }
  async function archiveSession(s: Session, archived: boolean) {
    try { const next = await rpc<Session>({ method: 'sessions.archive', sessionId: s.id, archived });
      setSessions(list => list.map(x => x.id === next.id ? next : x)); if (session?.id === next.id) setSession(next);
      setDeletingId(null); setGroupingId(null);
    } catch (e) { setError(errorText(e)); }
  }
  async function setSessionGroup(s: Session, group: string) {
    try { const next = await rpc<Session>({ method: 'sessions.group', sessionId: s.id, group });
      setSessions(list => list.map(x => x.id === next.id ? next : x)); if (session?.id === next.id) setSession(next);
      setGroupingId(null);
    } catch (e) { setError(errorText(e)); }
  }
  async function removeSession(s: Session) {
    try { await rpc({ method: 'sessions.delete', sessionId: s.id });
      setSessions(list => list.filter(x => x.id !== s.id)); setDeletingId(null);
      if (session?.id === s.id) setSession(null);
    } catch (e) { setError(errorText(e)); }
  }
  // ---- 分组登记：顶部栏新建/解散；会话行只从已有分组中选择。 ----
  const [sessionGroupRows, setSessionGroupRows] = useState<SessionGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [disbandArmed, setDisbandArmed] = useState<string | null>(null);
  const [sectionMarks, setSectionMarks] = useState<Record<string, boolean>>({});
  async function createSessionGroup() {
    const name = newGroupName.trim(); if (!name) return;
    try { const g = await rpc<SessionGroup>({ method: 'sessionGroups.create', name });
      setSessionGroupRows(list => list.some(x => x.name === g.name) ? list : [...list, g].sort((a, b) => a.createdAt - b.createdAt));
      setNewGroupName('');
    } catch (e) { setError(errorText(e)); }
  }
  async function disbandSessionGroup(name: string) {
    try { await rpc({ method: 'sessionGroups.delete', name });
      setSessionGroupRows(list => list.filter(x => x.name !== name));
      // 解散后该组会话回到时间桶：本地同步剥离 group 字段，等下一次轮询收敛。
      setSessions(list => list.map(x => x.group === name ? { ...x, group: undefined } : x));
      if (session?.group === name) setSession(s => s ? { ...s, group: undefined } : s);
      setDisbandArmed(null);
    } catch (e) { setError(errorText(e)); }
  }
  async function send() {
    if ((!input.trim() && !attachments.length) || !target || sending || uploadCount.current) return;
    const epoch=routeEpoch.current;const stillCurrent=()=>epoch===routeEpoch.current&&!!targetRef.current&&sameTarget(target,targetRef.current);
    followOutput.current=true; setAwayFromLatest(false); setSending(true); setError('');
    try { await prepareAI.current?.();if(!stillCurrent())return;const current = session ?? await newSession(); if (!current||!stillCurrent()) return; if (current.target.projectId !== target.projectId) throw Error('当前会话属于另一项目，请切换到当前项目的会话。');
      const prompt=input.trim()||'请分析所附文件。';
      if (current.title === '新工程会话') { const renamed = await rpc<Session>({ method: 'sessions.rename', sessionId: current.id, title: prompt.slice(0, 35) });if(!stillCurrent())return;setSession(renamed); }
      // 悬浮台当前打开的工作项就是本轮上下文目标；陈旧的选区上下文不能越过它。
      const openDraft=draftRef.current;let outgoing=contexts;
      const lastNonPinned=[...contexts].reverse().find(c=>!c.pinned);
      if(openDraft&&(!lastNonPinned||lastNonPinned.workItemId!==openDraft.workItemId)){
        outgoing=[...contexts.filter(c=>c.pinned),{id:crypto.randomUUID(),target:openDraft.target,workItemId:openDraft.workItemId,text:(openDraft.title+'\n'+openDraft.nodes.filter(n=>n.text).map(n=>n.text).join('\n')).slice(0,30000),prefix:'',suffix:'',source:'work-item' as const,capturedAt:Date.now(),pinned:false}];
        setContexts(outgoing);
      }
      const attached=guidelines.find(g=>g.id===guidelineId&&g.kind==='send');
      const sentAttachments=new Set(attachments.map(a=>a.id));
      if(!stillCurrent())return;
      await rpc({ method: 'runs.start', permissionMode, delivery, ...(attached?{guidelineId:attached.id}:{}), sessionId: current.id, requestId: crypto.randomUUID(), target, prompt, contexts: structuredClone(outgoing), attachments:[...sentAttachments] });if(stillCurrent()){setInput(current=>current===input?'':current);setAttachments(current=>current.filter(a=>!sentAttachments.has(a.id)));setGuidelineId('');}window.dispatchEvent(new Event('polarion-sidebar-run-started'));
    } catch (e) { if(stillCurrent())setError(errorText(e)); } finally { setSending(false); }
  }
  const openDraft = useCallback(async (workItemId: string) => { if (!target) return;const ticket=++draftOpenRequest.current;try {await prepareAI.current?.();if(ticket!==draftOpenRequest.current)return;const next=await rpc<DraftView>({ method: 'drafts.open', target, workItemId });if(ticket!==draftOpenRequest.current||!targetRef.current||!sameTarget(target,targetRef.current))return;if(!draft)priorTab.current=tab;setOverview(false);setDraft(next);setEditorAI(true);setTab('ai');setContexts(list=>list.some(c=>c.workItemId===workItemId&&!c.pinned)?list:[...list.filter(c=>c.pinned),{id:crypto.randomUUID(),target:next.target,workItemId,text:next.title+'\n'+next.nodes.filter(n=>n.text).map(n=>n.text).join('\n').slice(0,30000),prefix:'',suffix:'',source:'work-item',capturedAt:Date.now(),pinned:false}]); } catch (e) { if(ticket===draftOpenRequest.current)setError(errorText(e)); } }, [target, draft, tab]); editDraftRef.current = openDraft;
  const openDiagram=useCallback(async(draftId:string,requestId:string)=>{const ticket=++draftOpenRequest.current;try{await prepareAI.current?.();if(ticket!==draftOpenRequest.current)return;const value=await rpc<{draft:DraftView;request:BoardGenerationRequest}>({method:'boards.generation.open',draftId,requestId});if(ticket!==draftOpenRequest.current)return;if(!targetRef.current||!sameTarget(value.draft.target,targetRef.current))throw Error('此草案属于另一个文档，请先回到来源文档。');if(!draft)priorTab.current=tab;setOverview(false);setDraft(value.draft);setRequestedBoard(value.request);setEditorAI(true);setTab('ai');}catch(e){if(ticket===draftOpenRequest.current)setError(errorText(e));}},[draft,tab]);
  const answerPermission = useCallback(async (runId: string, id: string, allow: boolean, scope: 'once' | 'run' = 'once') => { try { await rpc({ method: 'permissions.answer', runId, permissionId: id, allow, scope }); } catch (e) { setError(errorText(e)); } }, []);
  const retryTurn = useCallback(async (run: Run) => { try { await rpc({ method: 'runs.retry', runId: run.id, requestId: crypto.randomUUID() }); window.dispatchEvent(new Event('polarion-sidebar-run-started')); } catch (e) { setError(errorText(e)); } }, []);
  const quoteAnswer = useCallback((text: string) => { const excerpt = text.trim().slice(0, 800); if (!excerpt) return; const quoted = excerpt.split('\n').map(line => '> ' + line).join('\n'); setInput(previous => (previous.trim() ? previous.trimEnd() + '\n\n' : '') + quoted + '\n\n'); composerInput.current?.focus(); }, []);
  const visibleRuns = useMemo(() => runs.filter(run => byRun.has(run.id)), [runs, byRun]);
  const transcript=useMemo(()=>conversationSections(visibleRuns,events),[visibleRuns,events]);
  const outlineView = useMemo(()=><div className="outline-list">{headings.length ? headings.map((h,index) => <button key={h.index} style={{ paddingLeft: 14 + (h.level - 1) * 12 }} onClick={() => navigateHeading(h.index)}><span className="heading-index">{String(index + 1).padStart(2, '0')}</span>{h.text}</button>) : <p className="muted">文档加载后显示章节导航。</p>}</div>,[headings]);
  const editorRequest=draftOpenRequest.current,editorRoute=routeEpoch.current;
  const editorStillCurrent=()=>{const page=routeFromUrl(location.href);return !!draft&&draftRef.current?.id===draft.id&&editorRequest===draftOpenRequest.current&&editorRoute===routeEpoch.current&&!!page&&sameTarget(page,draft.target)&&!!targetRef.current&&sameTarget(targetRef.current,draft.target);};
  if (!target || !pageReady) return null;
  // 可选分组 = 登记分组 ∪ 会话上实际存在的组名（兼容登记前的旧数据）。
  const groupNames = [...new Set([...sessionGroupRows.map(g => g.name), ...sessions.filter(s => s.group).map(s => s.group!)])];
  const groupCounts = new Map<string, number>();
  for (const s of sessions) if (s.group && !s.archived) groupCounts.set(s.group, (groupCounts.get(s.group) ?? 0) + 1);
  const archivedCount = sessions.filter(s => s.archived).length;
  // 折叠三态：'+'=展开 '-'=折叠 无标记=默认（当前会话所在节展开，其余折叠）。
  const sectionOpen = (label: string, rows: Session[]) => sectionMarks['+' + label] === true ? true : sectionMarks['-' + label] === true ? false : rows.some(s => s.id === session?.id);
  const toggleSection = (label: string, rows: Session[], open: boolean) => setSectionMarks(m => ({ ...m, ['+' + label]: open, ['-' + label]: !open }));
  function sessionRow(s: Session) {
    const current = session?.id === s.id;
    if (renamingId === s.id) return <div className="history-row renaming" key={s.id}>
      <input className="rename-input" autoFocus defaultValue={s.title} maxLength={100} aria-label="会话名称"
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') void renameSession(s, e.currentTarget.value); if (e.key === 'Escape') setRenamingId(null); }}
        onBlur={e => void renameSession(s, e.currentTarget.value)} />
    </div>;
    return <div className={'history-row' + (deletingId === s.id ? ' deleting' : '')} key={s.id}>
      <button className={current ? 'history-open current' : 'history-open'} aria-current={current ? 'true' : undefined} onClick={() => { setSession(s); closeHistory(); }}>
        <span>{s.title}{s.group && <em className="history-group-tag">{s.group}</em>}</span>
        <small>{s.engine === 'claude' ? 'Claude Code' : 'Codex'} · {new Date(s.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small>
      </button>
      {deletingId === s.id ? <span className="history-confirm"><span>删除会话及其全部记录？</span><button className="confirm-yes" onClick={() => void removeSession(s)}>删除</button><button className="confirm-no" onClick={() => setDeletingId(null)}>取消</button></span>
        : <span className="history-actions">
          <button className="icon" title="重命名会话" onClick={() => { setGroupingId(null); setDeletingId(null); setRenamingId(s.id); }}><PenLine size={12}/></button>
          <button className="icon" title="移动到分组" onClick={() => { setRenamingId(null); setDeletingId(null); setGroupingId(v => v === s.id ? null : s.id); }}><FolderPlus size={12}/></button>
          <button className="icon" title={s.archived ? '恢复到列表' : '归档会话'} onClick={() => void archiveSession(s, !s.archived)}>{s.archived ? <ArchiveRestore size={12}/> : <Archive size={12}/>}</button>
          <button className="icon danger" title="删除会话" onClick={() => setDeletingId(s.id)}><Trash2 size={12}/></button>
        </span>}
      {groupingId === s.id && <div className="group-menu" onKeyDown={e => e.stopPropagation()}>
        {groupNames.length > 0 ? <div className="group-menu-list">{groupNames.map(name => <button key={name} className={s.group === name ? 'current' : ''} title={s.group === name ? '当前分组' : '归入 ' + name} onClick={() => void setSessionGroup(s, name)}><FolderPlus size={11}/>{name}</button>)}</div>
          : <p className="group-menu-empty">还没有分组，先在历史面板上方新建。</p>}
        {s.group && <button className="group-ungroup" onClick={() => void setSessionGroup(s, '')}>移出分组</button>}
      </div>}
    </div>;
  }

  return <div className={'workspace-root'+(overview?' overview-open':'')} style={{'--assistant-width':width+'px','--assistant-font-size':(settings&&config?config.assistantFontSize:assistantFontSize)+'px'} as React.CSSProperties}>
    {!open && <button className="reopen" onClick={() => setOpen(true)} title="展开 Polarion 助手"><PanelRightOpen size={18}/><span>助手</span>{active && <i className="running-dot"/>}</button>}
    {(draft?editorAI:open) && <aside className={'workspace '+(draft&&editorAI?'floating-assistant':'')} style={{ width, top: geometry.top }} aria-label={draft&&editorAI?'编辑工作台 AI 协作':'Polarion 超级侧边栏'}>
      {draft&&editorAI&&<div className="collaboration-bar"><MessageSquare size={15}/><span>{draft.workItemId} · AI 协作</span><i className={'connection '+(health?'online':'')} title={health?'本地 Host 已连接':'本地 Host 未连接'}/><button className="icon" title={overview?'收起需求总览':'软件需求分析总览'} aria-pressed={overview} onClick={()=>setOverview(value=>!value)}><LayoutGrid size={15}/></button><button className="icon" title="设置" aria-expanded={settings} disabled={settingsSaving} onClick={e=>void toggleSettings(e.currentTarget)}><Settings size={15}/></button><button className="icon" title="收起编辑区 AI" onClick={()=>setEditorAI(false)}><PanelRightClose size={16}/></button></div>}
      <div className="resize-grip" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(340, Math.min(560, innerWidth * .45, innerWidth - event.clientX))); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}><GripVertical size={12}/></div>
      {!(draft&&editorAI)&&<header className="brand"><div className="brand-mark">P<span>＋</span></div><div><strong>工程助手</strong><small>Polarion 工作区</small></div><span className={'connection ' + (health ? 'online' : '')} title={health ? '本地 Host 已连接' : '本地 Host 未连接'}/><button className="icon" title={overview?'收起需求总览':'软件需求分析总览'} aria-pressed={overview} onClick={()=>setOverview(value=>!value)}><LayoutGrid size={16}/></button><button className="icon" title="设置" aria-expanded={settings} disabled={settingsSaving} onClick={e=>void toggleSettings(e.currentTarget)}><Settings size={16}/></button><button className="icon" title="收起助手，任务继续运行" onClick={() => setOpen(false)}><PanelRightClose size={18}/></button></header>}
      <div className="document-path"><span>{target.projectId}</span><ChevronRight size={12}/><strong title={target.document}>{target.document.split('/').at(-1)}</strong></div>
      <nav className="tabs" aria-label="工作区模式">{[['outline','大纲',ListTree],['ai','AI 助手',MessageSquare],['properties','属性',SlidersHorizontal]].map(([key,label,Icon]: any) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={15}/>{label}</button>)}</nav>
      {geometry.overlay && <div className="compact-note">窄屏浮层模式 · 收起助手可查看完整正文</div>}
      {error && <div className="error" role="alert"><span>{error}{error.includes('凭据')&&!settings&&<button className="secondary" onClick={e=>void toggleSettings(e.currentTarget)}>配置 Polarion 账号</button>}</span><button className="icon" title="关闭提示" onClick={() => setError('')}><X size={14}/></button></div>}
      {saveNotice&&<div className="save-notice" role="status"><Check size={15}/><span>{saveNotice}</span><button className="icon" title="关闭保存结果" onClick={()=>setSaveNotice('')}><X size={14}/></button></div>}
      {settings && <SettingsPanel config={config} defaultFontSize={DEFAULT_ASSISTANT_FONT_SIZE} guidelines={guidelineDrafts} loading={settingsLoading} saving={settingsSaving} error={settingsError} initialTab={settingsTab}
        onConfig={next=>setConfig(next)} onGuidelines={next=>{const alive=new Set(next.map(g=>g.id));for(const id of persistedGuidelineIds.current)if(!alive.has(id)&&!deletedGuidelines.current.includes(id))deletedGuidelines.current.push(id);setGuidelineDrafts(next);}}
        onSave={()=>void saveSettings()} onClose={closeSettings}
        onPickFolder={async current=>{try{const value=await rpc<{path:string|null}>({method:'dialog.pickFolder',title:'选择共享草稿存储文件夹',defaultPath:current});return value.path;}catch(e){setSettingsError('打开文件夹选择器失败：'+errorText(e));return null;}}}
        onPickFiles={async id=>{try{const value=await rpc<{paths:string[]}>({method:'dialog.pickFiles',title:'选择指令文件',defaultPath:''});return value.paths.map(path=>({path,label:''}));}catch(e){setSettingsError('打开文件选择器失败：'+errorText(e));return [];}}}
      />}
      {tab === 'outline' && <section className="outline-panel"><div className="section-title"><span>文档章节</span><button className={'icon ' + (pinnedOutline ? 'accent' : '')} title="将大纲固定到助手上方" onClick={() => { setPinnedOutline(v => !v); setTab('ai'); }}><Pin size={15}/></button></div>{outlineView}</section>}
      {tab === 'properties' && <section className="properties"><h3>当前工作区</h3><dl><dt>项目</dt><dd>{target.projectId}</dd><dt>文档</dt><dd>{target.document}</dd><dt>当前工作项</dt><dd>{draft?.workItemId ?? contexts.at(-1)?.workItemId ?? '尚未选择'}</dd></dl><button className="secondary" onClick={() => setOpen(false)}><ExternalLink size={14}/>打开原生属性与工作流</button><p className="muted">收起助手后，原生副边栏恢复原有位置与状态。</p><div className="section-title">共享草稿 <span>{drafts.length}</span>{drafts.length>0&&<button className={deleteArmed?'primary danger-confirm':'secondary'} disabled={!draftSelection.size} title={deleteArmed?'再次点击确认删除所选本地草稿':'点击后需再次确认才会删除'} onClick={armDeleteDrafts}>{deleteArmed?`确认删除 ${draftSelection.size} 项${drafts.some(d=>draftSelection.has(d.id)&&d.state!=='clean')?'（含未保存修改）':''}`:`删除所选${draftSelection.size?` (${draftSelection.size})`:''}`}</button>}</div>{drafts.map(d => <div className={'draft-row'+(draftSelection.has(d.id)?' selected':'')} key={d.id}><input type="checkbox" aria-label={'选择草稿 '+d.workItemId} checked={draftSelection.has(d.id)} onChange={e=>setDraftSelection(current=>{const next=new Set(current);e.target.checked?next.add(d.id):next.delete(d.id);return next;})}/><button className="draft-open" onClick={() => void openDraft(d.workItemId)}><FileText size={16}/><div><strong>{d.workItemId}</strong><small>{d.title}{d.variantOf?' · 变体':''}</small></div></button><span>{d.state === 'clean' ? '已同步' : '待处理'}</span></div>)}<p className="muted">存储位置：{draftsFolderNote||'内部数据库'}。勾选后可批量删除本地草稿，不影响 Polarion 服务端。</p></section>}
      {(tab === 'ai'||!!draft&&editorAI) && <>
        {pinnedOutline && <section className="pinned-outline"><div className="section-title"><span>固定大纲</span><button className="icon" title="取消固定大纲" onClick={() => setPinnedOutline(false)}><X size={13}/></button></div>{outlineView}</section>}
        <div className="session-bar"><button ref={historyTrigger} title="会话历史" aria-expanded={history} aria-controls="sidebar-session-history" onClick={() => {if(history)closeHistory();else{setShowCapabilities(false);setHistory(true);}}}><History size={14}/><span>{session?.title ?? '新工程会话'}</span><ChevronDown size={12} className="chevron"/></button><button ref={capabilitiesTrigger} className="icon" title="Claude Code 命令、Skills 与 MCP" aria-expanded={showCapabilities} onClick={() => {if(showCapabilities)closeCapabilities();else{setHistory(false);setShowCapabilities(true);void loadCapabilities();}}}><TerminalSquare size={16}/></button><button className="icon" title="新建会话" onClick={() => void newSession().catch(e => setError(errorText(e)))}><Plus size={17}/></button></div>
        {showCapabilities && <CapabilitiesPanel value={capabilities} loading={loadingCapabilities} error={capabilityError} connected={health&&capabilities?.connected===true} onManage={(action,server)=>void manageCapabilities(action,server)} onRefresh={() => void loadCapabilities(true)} onCommand={chooseCommand} onClose={closeCapabilities}/>}
        {history && <div ref={historyPanel} id="sidebar-session-history" className="history" aria-label="会话历史" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeHistory();}}}>
          <div className="group-bar">
            <input className="group-bar-new" value={newGroupName} placeholder="新建分组" maxLength={40} aria-label="新建分组" onKeyDown={e => { if (e.key === 'Enter') void createSessionGroup(); if (e.key === 'Escape') setNewGroupName(''); }} onChange={e => setNewGroupName(e.target.value)} />
            <button className="group-bar-add" disabled={!newGroupName.trim()} title="新建分组" onClick={() => void createSessionGroup()}><Plus size={13}/>新建</button>
            {groupNames.length > 0 && <span className="group-bar-chips">{groupNames.map(name => <span key={name} className={'group-chip' + (disbandArmed === name ? ' armed' : '')}>
              <em>{name}{groupCounts.get(name) ? <i>·{groupCounts.get(name)}</i> : null}</em>
              {disbandArmed === name
                ? <button title="确认解散" onClick={() => void disbandSessionGroup(name)}>解散?</button>
                : <button title="解散分组（组内会话回到未分组）" onClick={() => setDisbandArmed(name)}><X size={10}/></button>}
            </span>)}</span>}
          </div>
          {sessions.length ? <>
            {sessionGroups(sessions, sessionGroupRows).map(group => <details className={'history-group' + (group.rows.length === 0 ? ' empty' : '')} key={group.label} open={sectionOpen(group.label, group.rows)} onToggle={e => { const el = e.currentTarget; if (el.open !== sectionOpen(group.label, group.rows)) toggleSection(group.label, group.rows, el.open); }}>
              <summary><span className="hg-name">{group.label}</span><span className="hg-count">{group.rows.length}</span><ChevronRight size={12} className="hg-chevron"/></summary>
              {group.rows.map(s => sessionRow(s))}
            </details>)}
            {archivedCount > 0 && <details className="history-archive">
              <summary>归档 · {archivedCount}</summary>
              {sessions.filter(s => s.archived).map(s => sessionRow(s))}
            </details>}
          </> : groupNames.length === 0 ? <p className="muted">这个项目还没有会话。</p> : <p className="muted">还没有会话。可在上方分组，或直接新建会话。</p>}
        </div>}
        <div className="conversation" ref={scrolling} onScroll={e=>{const el=e.currentTarget;const away=el.scrollHeight-el.scrollTop-el.clientHeight>=100;followOutput.current=!away;setAwayFromLatest(away);}}>{!loadingHistory && events.length === 0 && runs.length === 0 && <div className="welcome"><div className="welcome-mark"><MessageSquare size={13}/><span>从当前文档开始</span></div><h2>把需求对话，<br/>变成可审阅的修改。</h2><p>选中正文或打开工作项，助手会带着准确上下文与你协作。</p><div className="suggestions">{([['检查选区中的歧义与遗漏',Search],['梳理需求对应的验证场景',ListChecks],['改进表述，保留所有工程参数',PenLine]] as [string,React.ElementType][]).map(([text,Icon]) => <button key={text} onClick={() => setInput(text)}><span className="sug-icon"><Icon size={13}/></span><span className="sug-text">{text}</span><ChevronRight size={14}/></button>)}</div><div className="workflow-note"><span>选取上下文</span><ChevronRight size={12}/><span>审阅草稿</span><ChevronRight size={12}/><span>明确保存</span></div></div>}
          {transcript.archived.length>0&&<details className="history-before-reset" key={transcript.boundary!.seq}><summary>查看新对话之前的记录 · {transcript.archived.length} 轮</summary>{transcript.archived.map(run=><Turn key={run.id} run={run} events={byRun.get(run.id)!} recovering={loadingHistory} onDraft={openDraft} onPermission={answerPermission} onDiagram={openDiagram} onRetry={retryTurn} onQuote={quoteAnswer} onWorkItem={openReader} busy={!!active}/>)}</details>}
          {transcript.boundary&&<p className="history-loading" role="status">原生对话已重置；之前的记录已保留，下一条消息使用新的对话上下文。</p>}
          {(() => { const windowed = windowTurns(transcript.current, turnWindow); return <>{windowed.hidden > 0 && <button className="history-more" onClick={() => setTurnWindow(value => value + 40)}>显示更早的 {windowed.hidden} 轮</button>}{windowed.visible.map(run => <Turn key={run.id} run={run} events={byRun.get(run.id)!} recovering={loadingHistory} onDraft={openDraft} onPermission={answerPermission} onDiagram={openDiagram} onRetry={retryTurn} onQuote={quoteAnswer} onWorkItem={openReader} busy={!!active}/>)}</>; })()}
          {loadingHistory&&<p className="history-loading" role="status">正在恢复会话记录…已读取 {events.length} 条事件</p>}
          {!loadingHistory&&runs.length>visibleRuns.length&&<p className="history-loading">部分任务没有保存会话事件，无法还原正文。</p>}</div>
        {awayFromLatest&&<button className="jump-latest" onClick={()=>{followOutput.current=true;setAwayFromLatest(false);scrolling.current?.scrollTo({top:scrolling.current.scrollHeight,behavior:'smooth'});}}>回到最新消息 ↓</button>}
        <div className={"composer-wrap " + (dragOver ? "drag-over" : "")} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }} onDragLeave={e => { const next = e.relatedTarget as Node | null; if (!next || !e.currentTarget.contains(next)) setDragOver(false); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); void addAttachments(Array.from(e.dataTransfer.files)); } }}>{dragOver && <div className="drop-hint" aria-hidden="true"><Paperclip size={15}/><span>松开以添加附件</span></div>}<input hidden type="file" multiple ref={attachmentFiles} aria-label="添加对话附件" onChange={e => { if (e.target.files) void addAttachments(Array.from(e.target.files)); e.target.value=""; }}/><AttachmentCards assets={attachments} onRemove={id=>setAttachments(list=>list.filter(a=>a.id!==id))} onPreview={setPreviewAsset}/>{uploadProgress&&<p className="upload-progress">{uploadProgress}</p>}<ContextCards contexts={contexts} target={target} onPin={id=>setContexts(list=>list.map(c=>c.id===id?{...c,pinned:!c.pinned}:c))} onRemove={id=>setContexts(list=>list.filter(c=>c.id!==id))}/>
          {workItemPickerOpen && <div className="workitem-picker" role="listbox" aria-label="工作项引用候选">
            <div className="workitem-picker-head"><span>引用工作项</span><small>本文档 · 本地草稿 · Polarion</small></div>
            {workItemCandidates.map((hit, index) => <button key={hit.workItemId} role="option" aria-selected={index === pickerIndex} className={index === pickerIndex ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => chooseWorkItem(hit.workItemId)}><strong>{hit.workItemId}</strong><span>{hit.title || '未命名工作项'}</span><i>{hit.source === 'document' ? '本文档' : hit.source === 'remote' ? 'Polarion' : hit.state === 'clean' ? '已同步' : hit.state === 'dirty' ? '待处理' : hit.state === 'conflict' ? '有冲突' : '待核对'}</i></button>)}
          </div>}
          {slashOpen && <div className="slash-menu" ref={slashMenu}>
            <div className="slash-menu-header"><span>{loadingCapabilities?'正在读取本机命令…':`${slashMatches.length} / ${capabilities?.commands.length??0} 个命令与 Skills`}</span><button title="重新读取本机命令" disabled={loadingCapabilities} onClick={()=>void loadCapabilities(true)}>刷新</button></div>
            {capabilityError&&<div className="slash-status" role="alert">读取失败：{capabilityError}。可点击刷新重试。</div>}
            {!loadingCapabilities&&!capabilityError&&!slashMatches.length&&<div className="slash-status">没有匹配的本机命令，试试名称、描述或别名。</div>}
            <div role="listbox" id="native-command-list" aria-label="原生命令补全">{slashMatches.map((c,i) => <button role="option" id={'native-command-'+i} aria-selected={i===slashIndex} key={c.name} className={i === slashIndex ? 'selected' : ''} onMouseDown={e => e.preventDefault()} onClick={() => chooseCommand('/' + c.name + ' ')}><strong>/{c.name}<small>{c.builtin ? '命令' : 'Skill'}</small></strong><span>{c.description}</span>{c.aliases.length>0&&<small className="command-aliases">{c.aliases.map(a=>'/'+a).join(' · ')}</small>}</button>)}</div>
            <div className="slash-menu-help">↑ ↓ 选择 · Tab / Enter 补全 · Esc 关闭</div>
          </div>}
          <div className="composer"><textarea ref={composerInput} rows={1} role="combobox" aria-autocomplete="list" aria-expanded={slashOpen} aria-controls="native-command-list" aria-activedescendant={slashOpen&&slashMatches.length?'native-command-'+slashIndex:undefined} title="Enter 发送 · Shift+Enter 换行 · 支持拖入附件和粘贴截图" onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();void addAttachments(files);}}} aria-label="向工程助手发送消息" placeholder={active?(delivery==='steer'?'输入引导内容，发送后将打断当前任务并优先处理…':'输入排队内容，当前任务结束后自动作为下一轮发送…'):'描述任务，或输入 / 调用本地命令与 Skill…'} value={input} onChange={e => { setInput(e.target.value); setSlashHidden(false); setPickerHidden(false); setSlashIndex(0);setSlashNavigated(false); }} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (workItemPickerOpen) { if (e.key === 'Escape') { e.preventDefault(); setPickerHidden(true); return; } if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(value => (value + (e.key === 'ArrowDown' ? 1 : workItemCandidates.length - 1)) % workItemCandidates.length); return; } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chooseWorkItem(workItemCandidates[Math.min(pickerIndex, workItemCandidates.length - 1)]!.workItemId); return; } } if (slashOpen) { if (e.key === 'Escape') {e.preventDefault();setSlashHidden(true);return;} } if (slashOpen && slashMatches.length) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault();setSlashNavigated(true); setSlashIndex(v => (v + (e.key === 'ArrowDown' ? 1 : slashMatches.length - 1)) % slashMatches.length); return; } if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && (slashNavigated||commandNameMatches(slashMatches[Math.min(slashIndex,slashMatches.length-1)]!,commandQuery??''))) { e.preventDefault(); chooseCommand('/' + slashMatches[Math.min(slashIndex, slashMatches.length - 1)]!.name + ' '); return; } } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/><div className="composer-footer"><button className="icon" title="添加文档、图片或其他附件" onClick={()=>attachmentFiles.current?.click()}><Paperclip size={16}/></button><span title={session?.engine === 'codex' ? 'Codex' : 'Claude Code'}><i className={'connection ' + (health ? 'online' : '')}/>{(width >= 380 || active) && <>{session?.engine === 'codex' ? 'Codex' : 'Claude Code'}{active ? ' · ' + statusText[active.status] : ''}{queuedCount ? ` · ${queuedCount} 条排队` : ''}</>}</span><ContextMeter key={session?.id+":"+(transcript.boundary?.seq??0)} sessionId={session?.id} engine={session?.engine} busy={!!active} online={health}/><div className="footer-selects">{sendGuidelines.length?<select className="permission-select guideline-select" aria-label="附加指令" title="附加指令随本条消息一起发送，每次发送单独选择；不选择则不附加。" value={guidelineId} disabled={sending} onChange={e=>{if(e.target.value==='__manage'){setGuidelineId('');void toggleSettings(e.currentTarget,'guidelines');return;}setGuidelineId(e.target.value);}}><option value="">不附加指令</option>{sendGuidelines.map(g=><option key={g.id} value={g.id} title={g.description||g.name}>{g.name}</option>)}<option value="__manage">管理指令…</option></select>:<button type="button" className="permission-select guideline-add" title="在设置中添加随发送指令（例如：写标准需求 / 排版美化 / 绘图规范）" onClick={e=>void toggleSettings(e.currentTarget,'guidelines')}>＋ 附加指令</button>}<select className="permission-select" aria-label="智能体权限" title={(displayedPermissionMode==='full'?'完全访问：本地命令与工具自动执行；Polarion 仍需明确保存。':displayedPermissionMode==='auto'?'自动批准：命令与工具自动执行，文件编辑仅限项目工作区；Polarion 写操作仍通过草稿明确保存。':'请求批准：读取与本地文档草稿操作自动进行，其他操作逐次确认。')+' 本轮权限在发送时固定，切换后对下一轮生效。'} data-mode={displayedPermissionMode} disabled={!!active} value={displayedPermissionMode} onChange={e=>setPermissionMode(e.target.value as PermissionMode)}><option value="ask">请求批准</option><option value="auto">自动批准</option><option value="full">完全访问</option></select>{active&&<select className="permission-select delivery-select" aria-label="运行中新输入" title={delivery==='steer'?'引导：立即打断当前任务，优先处理这条新输入；对话上下文保留。':'排队：当前任务完成后，这条输入自动作为下一轮发送。'} value={delivery} onChange={e=>setDelivery(e.target.value as TurnDelivery)}><option value="queue">排队发送</option><option value="steer">引导打断</option></select>}</div><div className="send-group">{active&&<button className="send stop" title="停止当前任务" onClick={() => void rpc({ method: 'runs.cancel', runId: active.id }).catch(e => setError(errorText(e)))}><Square size={14}/></button>}<button className="send" title={active?(delivery==='steer'?'引导：打断当前任务并优先处理这条输入':'排队：当前任务结束后自动发送'):'发送消息'} disabled={(!input.trim() && !attachments.length) || !health || sending || !!uploadProgress} onClick={() => void send()}><ArrowUp size={18}/></button></div></div></div></div>
      </>}
    </aside>}
    {nativePreview && <WorkItemPreviewCard preview={nativePreview} style={{ right: open ? width + 16 : 60, bottom: 28 }} onClose={() => setNativePreview(null)} onOpen={() => { setNativePreview(null); void openDraft(nativePreview.id); }} onEnter={() => keepPreview()} onLeave={() => {}} />}
    {previewAsset && <AttachmentPreview asset={previewAsset} onClose={()=>setPreviewAsset(null)}/>}
    {reader && <WorkItemReader view={reader} onClose={() => setReader(null)} onWorkItem={id => { setReader(null); void openReader(id); }} onOpenEditor={() => { const id = reader.workItemId; setReader(null); void openDraft(id); }}/>}
    {overview && target && <RequirementsOverview key={target.projectId + ':' + target.document} target={target} right={draft ? (editorAI ? width + 18 : 0) : open ? width : 0} top={geometry.top} onClose={() => setOverview(false)} onOpenItem={id => void openReader(id)}/>}
    {draft && <DraftEditor key={draft.id} draft={draft} requestedBoard={requestedBoard} onBoardOpened={()=>setRequestedBoard(null)} initialScrollTop={restoredEditorScroll} onUpdate={updateCurrentDraft} onClose={() => {draftOpenRequest.current++;setContexts(list=>list.filter(c=>!c.text.startsWith('BOARD_GENERATION_CONTEXT\n')&&!c.text.startsWith('画板对象协作上下文')));setDraft(null);setRestoredEditorScroll(undefined);prepareAI.current=null;setTab(priorTab.current);}} aiOpen={editorAI} onToggleAI={()=>{setEditorAI(v=>!v);setTab('ai');}} onShowAI={()=>{setEditorAI(true);setTab('ai');}} onClearBoardContext={()=>setContexts(list=>list.filter(c=>!(c.workItemId===draft.workItemId&&(c.text.startsWith('BOARD_GENERATION_CONTEXT\n')||c.text.startsWith('画板对象协作上下文')))))} onPrepareAI={handler=>{prepareAI.current=handler;}} remoteRevision={drafts.find(d=>d.id===draft.id)?.revision} onError={e => setError(errorText(e))} prepareNativeSave={async()=>{if(!editorStillCurrent())throw Error('NATIVE_DOCUMENT_CHANGED');const snapshot=native.current.captureVerification();const result=await browser.runtime.sendMessage({type:'native-workitem-refresh',workItemId:draft.workItemId,phase:'check'});if(!editorStillCurrent())throw Error('NATIVE_DOCUMENT_CHANGED');if(!result?.ok)throw Error(result?.error??'NATIVE_REFRESH_UNSUPPORTED');native.current.acceptVerifiedClean(snapshot);return native.current.state();}} onSaved={async saved => {
      // The remote save has already been verified. A stale view must not refresh
      // another document or turn that verified success into a write failure.
      if(!editorStillCurrent()||saved.id!==draft.id||!sameTarget(saved.target,draft.target))return;
      if(saved.variantOf){setSaveNotice(saved.workItemId+' 已保存到变体，主工作项 '+saved.variantOf+' 未改动。');return;}
      if(native.current.state()!=='clean')throw Error('原生页面在保存期间发生变化，请先处理原生输入。');
      const result=await browser.runtime.sendMessage({type:'native-workitem-refresh',workItemId:draft.workItemId,phase:'refresh',expectedHtml:saved.html});
      if(!editorStillCurrent())return;
      if(!result?.ok)throw Error(result?.error??'NATIVE_REFRESH_FAILED');
      native.current.acceptDocumentRefresh();
      setSaveNotice(draft.workItemId+' 已保存并同步到原生正文。');
    }} onContext={text => setContexts(list => [...list.filter(c => c.pinned), { id: crypto.randomUUID(), target: draft.target, workItemId: draft.workItemId, text, prefix: '', suffix: '', source: 'editor', capturedAt: Date.now(), pinned: false }])} onOpenVariant={workItemId=>void openDraft(workItemId)} onOpenWorkItem={workItemId=>void openReader(workItemId)} onVariantChanged={variantChanged} onClearError={()=>setError('')}/>}</div>;
}
/** 优先取回答内当前选中的文字；没有选区时回退到整条回答。 */
function selectedAnswer(root: HTMLElement | null) {
  if (!root) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString().trim();
  return text ? text.slice(0, 800) : null;
}

/** 工作项预览浮窗：恢复原有紧凑形态（标题 + 摘要 + 单个入口），原生与聊天各一个独立实例。 */
function WorkItemPreviewCard({ preview, style, anchored, onClose, onOpen, onEnter, onLeave }: { preview: PreviewState; style: React.CSSProperties; anchored?: boolean; onClose: () => void; onOpen: () => void; onEnter: () => void; onLeave: () => void }) {
  return <div className={'hover-card workitem-preview' + (anchored ? ' anchored' : '')} style={style} role="dialog" aria-label={`工作项 ${preview.id} 预览`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <div><span className="eyebrow">工作项预览</span><button className="icon" title="关闭预览" onClick={onClose}><X size={14} /></button></div>
    <strong>{preview.id}</strong>
    {preview.source&&<small className="preview-draft">{preview.source==='draft'?`当前 ${preview.id} · 草稿 revision ${preview.revision??'—'}，${preview.state??''}`:`当前 ${preview.id} · 服务端内容（无本地草稿）`}</small>}
    <p>{preview.text ? preview.text.slice(0, 240) : preview.failed ? '无法读取内容，可打开完整预览查看。' : preview.loading ? '正在读取…' : '（这条工作项没有可预览的正文）'}</p>
    <button className="secondary" onClick={onOpen}>打开编辑工作台<ChevronRight size={14} /></button>
  </div>;
}

const Turn = React.memo(function Turn({ run, events, recovering, busy, onDraft, onPermission,onDiagram, onRetry, onQuote, onWorkItem }: { run: Run; events: RunEvent[]; recovering: boolean; busy: boolean; onDraft: (id: string) => unknown; onPermission: (runId: string, id: string, allow: boolean, scope?: 'once' | 'run') => unknown;onDiagram:(draftId:string,requestId:string)=>unknown; onRetry:(run:Run)=>unknown; onQuote:(text:string)=>unknown; onWorkItem:(workItemId:string)=>unknown }) {
  const answer=useRef<HTMLDivElement>(null);
  const user = events.find(e => e.kind === 'user')?.data as any;
  const result = events.find(e => e.kind === 'result')?.data as any;
  const text = turnResponseText(events);
  const answered = new Set(events.filter(e => e.kind === 'permission-result').map(e => (e.data as any).id));
  const settled = new Set(events.filter(e => e.kind === 'interaction-result').map(e => (e.data as any).id));
  return <article className="turn">{(user?.text||user?.attachments?.length>0)&&<div className="user-message">{user?.text && splitWorkItems(user.text).map((part, index) => 'workItemId' in part ? <button key={index} type="button" className="workitem-ref" onClick={() => onWorkItem?.(part.workItemId)}>{part.workItemId}</button> : <span key={index}>{part.text}</span>)}{user?.guideline&&<div className="sent-attachments"><span title="本条消息附加的执行规范">指令 · {user.guideline.name}</span></div>}{user?.attachments?.length>0&&<div className="sent-attachments">{user.attachments.map((a:any)=><span key={a.id}><Paperclip size={11}/>{a.name}</span>)}</div>}</div>}<div className="assistant-label"><span className="mini-mark">P＋</span><strong>工程助手</strong><small>{recovering&&!result?'正在读取记录':run.status==='interrupted'&&run.error==='HOST_RESTARTED'?'Host 重启，任务已中断':statusText[run.status]}</small></div>
    <Activity run={run} events={events}/>
    {events.filter(e=>e.kind==='board-generation-proposal'||e.kind==='board-proposal').map(e=><div className="tool-event" key={e.seq}><FileText size={13}/>{(e.data as any).title} · 已提交画板草案，请在画板中预览、应用或拒绝；尚未保存到 Polarion。{(e.data as any).entry==='requirements'&&<button className="secondary" onClick={()=>onDiagram((e.data as any).draftId,(e.data as any).requestId)}>预览需求配图</button>}</div>)}
    {events.filter(e=>e.kind==='conversation-reset').map(e=><p className="muted" key={e.seq}>此处开始新的原生对话；更早的消息作为历史保留。</p>)}
    {run.status==='queued'&&<div className="tool-event"><Square size={13}/>已排队，将在当前任务结束后自动开始<button className="secondary" onClick={()=>void rpc({method:'runs.cancel',runId:run.id}).catch(()=>{})}>取消排队</button></div>}
    {!text&&!['running','waiting'].includes(run.status)&&<p className="muted">{recovering?'正在读取本轮回答…':events.some(e=>e.kind==='conversation-reset')?'原生对话已重置，本次操作没有文本输出。':events.some(e=>e.kind==='command-completed')?'此原生命令没有文本输出。':'此任务未保存回答正文，可展开执行记录查看操作。'}</p>}
    {text && <><div ref={answer} className={['running','waiting'].includes(run.status)?'streaming':''}><AssistantMarkdown text={text} onWorkItem={onWorkItem}/></div>{!['running','waiting'].includes(run.status)&&<div className="answer-actions"><CopyButton text={text} label="复制回答" rich={()=>answerClipboard(answer.current!)}/><CopyButton text={text} label="复制 Markdown"/><button type="button" className="ghost-action" title="引用选中片段或整条回答到输入框" onClick={()=>onQuote(selectedAnswer(answer.current) ?? text)}><Quote size={12}/>引用</button>{['completed','failed','cancelled','interrupted'].includes(run.status)&&<button type="button" className="ghost-action" title={busy?'当前任务运行中，结束后可重试':'用同样的请求再执行一次'} disabled={busy} onClick={()=>onRetry(run)}><RotateCcw size={12}/>重试</button>}</div>}</>}
    {events.filter(e=>e.kind==='interaction'&&!settled.has((e.data as any).id)).map(e=><NativeInteraction key={e.seq} value={e.data as any} disabled={!['running','waiting'].includes(run.status)} onAnswer={async(action,values)=>{await rpc({method:'interactions.answer',runId:run.id,interactionId:(e.data as any).id,action,values});}}/>)}
    {events.filter(e=>e.kind==='interaction-unavailable').map(e=><p key={e.seq} className="inline-error">{(e.data as any).source}：此原生交互尚未接入。{(e.data as any).error}</p>)}
    {events.filter(e => e.kind === 'permission' && ['running','waiting'].includes(run.status) && !answered.has((e.data as any).id)).map(e => { const p = e.data as any; let command = ''; try { const parsed = JSON.parse(p.preview); if (parsed && typeof parsed.command === 'string') command = parsed.command; } catch {} return <div className="permission" key={e.seq}>
      <div className="permission-head"><AlertCircle size={14}/><strong>需要你的确认</strong><code>{p.tool}</code></div>
      <pre className="permission-command">{command || p.preview}</pre>
      <div className="permission-foot"><span>仅本次执行，拒绝后不会重试</span><div><button className="secondary" onClick={() => onPermission(run.id, p.id, false)}>拒绝</button><button className="secondary" title="本轮任务内该工具的后续调用不再逐次确认" onClick={() => onPermission(run.id, p.id, true, 'run')}>同类都允许</button><button className="primary" onClick={() => onPermission(run.id, p.id, true)}>允许本次</button></div></div>
      <details className="permission-more"><summary>查看完整参数</summary><pre>{p.preview}</pre></details>
    </div>; })}
    {Array.from(new Map(events.filter(e => e.kind === 'draft').map(e => [(e.data as any).workItemId,e])).values()).map(e => <button className="draft-link" key={e.seq} onClick={() => onDraft((e.data as any).workItemId)}><FileText size={14}/>{(e.data as any).workItemId} · 审阅草稿<ChevronRight size={14}/></button>)}
    {run.error && <div className="inline-error">{({SELECTION_NOT_FOUND:"选区已变化或包含尚不支持的对象，请在编辑器中重新选中目标文字后再试。",AMBIGUOUS_SELECTION:"正文中有多处相同文字，请扩大选区以明确修改位置。"} as Record<string,string>)[run.error]??run.error}</div>}
  </article>;
});
