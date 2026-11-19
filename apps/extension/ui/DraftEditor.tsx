import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import { Editor, Extension, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import { DOMParser as PMParser } from '@tiptap/pm/model';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Quote, Link, Undo2, Redo2, Table2, Plus, Minus, X, Check, Maximize2, Minimize2, ChevronDown, Subscript, Superscript, Eraser, Highlighter, Palette, Code, Columns3, Rows3, PanelTop, WrapText, CopyCheck, GitFork, Search, Download, ImagePlus, MessageSquare, PenTool, GitBranch, Sigma, ListCollapse, Tags, Wand2 } from 'lucide-react';
import { browser } from 'wxt/browser';
import { richExtensions,richSchema,sanitizeRichJSON } from '../../../packages/core/rich-schema';
import {sameTarget,type Asset,type Draft,type DedupMatch,type ImpactView,type Target} from '../../../packages/protocol/index';
import type { SourceNode } from '../../../packages/core/lossless-html';
import { rpc } from '../lib/client';
import { RichSurface } from './RichSurface';
import { matchWorkItemQuery } from '../lib/workitem-picker';
import { documentWorkItems, filterWorkItems, type DocumentWorkItem } from '../lib/document-items';
import {uploadAsset} from '../lib/assets';
import {editableImage,imageResolver} from '../lib/editor-images';
import {FormatProperties} from './FormatProperties';
import {moveAxis,selectTableScope,setParagraphLineHeight,clearTextFormatting} from '../lib/editor-format';
import {TableQuickMenu} from './TableQuickMenu';
import {CellSelection} from '@tiptap/pm/tables';
import {DocumentTableView} from '../lib/editor-table';
import {pasteRichContent} from '../../../packages/core/rich-paste';
import {findTextMatches,replaceSelectedMatch,replaceAllMatches} from '../../../packages/core/editor-text';
import {imageClipboardSerializer,internalClipboardImage} from '../../../packages/core/rich-clipboard';
import {applyTablePreset,tidyDocument,tablePresetLabels,type TablePreset} from '../../../packages/core/document-tidy';
import {lintDocument,defaultRulePack,type LintIssue} from '../../../packages/core/requirement-lint';
import {qualityLintExtension,lintHover,loadRulePack,watchRulePack} from '../lib/quality-lint';
import {QualityLintStatus,QualityLintCard} from './QualityLint';
import type {Proposal} from '../../../packages/protocol/index';
import './quality-lint.css';
import {handleRichPaste,richEditorExtras,withFormulaViews} from '../lib/editor-rich';
import {ConflictReview} from './ConflictReview';
import {isUserEvent} from '../lib/ui-event-trust';
import {saveError} from '../lib/save-feedback';
import {BoardDialog} from './BoardDialog';
import {placeBoardImage,replaceBoardPreview} from '../lib/board-placement';
import {registerBoardReceiver,codeRecoverySuffix,type BoardCode} from '../lib/board-code';
import {DocumentReview} from './DocumentReview';
import type {BoardRecord,BoardGenerationRequest} from '../../host/boards';
import {EditorDocTools} from './EditorDocTools';
import {VariantPanel} from './VariantPanel';
import {ModuleNotePanel} from './ModuleNotePanel';
import './editor-tools.css';
import {SingleLineToolbar,ToolbarMenu,nativeFontSizes,selectionTypography} from './EditorToolbar';
import {editorPopoverPlacement} from '../lib/editor-popover';
type DraftView = Draft & { nodes: SourceNode[]; version: string };
type RichReply = { editorId: string; draft: DraftView; document: JSONContent };
type Props = { onLintRewrite: (issue: LintIssue, text: string) => Promise<void>; requestedBoard?:BoardGenerationRequest|null;onBoardOpened:()=>void;draft: DraftView; onUpdate: (d: DraftView) => void; onClose: () => void; onError: (e: unknown) => void; prepareNativeSave: () => Promise<'clean' | 'dirty' | 'unknown'>; onContext: (text: string) => void; onSaved: (saved:DraftView) => Promise<void>;initialScrollTop?:number;aiOpen:boolean;onToggleAI:()=>void;onShowAI:()=>void;onClearBoardContext:()=>void;onPrepareAI:(handler:(()=>Promise<void>)|null)=>void;remoteRevision?:number; onOpenVariant:(workItemId:string)=>void; onOpenWorkItem:(workItemId:string)=>void; onDeepLint?:(workItemId:string,title:string)=>void; onVariantChanged:(saved:DraftView,notice:string)=>Promise<void>; onClearError:()=>void };
const colors = ['#24374b', '#2563eb', '#0f766e', '#c2410c', '#b91c1c', '#7c3aed'];
const fills = ['#ffffff', '#eff6ff', '#ecfdf5', '#fff7ed', '#fef2f2', '#f5f3ff'];
/** 工程句式库（v0.16 句式模式库一期）：常用需求句型模板，占位符 <> 由作者替换；沉淀自项目评审高频问题。 */
const engineeringSnippets: { label: string; text: string }[] = [
  { label: '验证准则', text: '验收准则：当 <条件> 时，<系统>应在 <时限> 内 <行为>，<可量化判据>。' },
  { label: '信号定义', text: '信号定义：<信号名>（<单位>）：0x0=<含义>；0x1=<含义>。' },
  { label: '状态跳变', text: '当 <信号> 由 <值A> 跳变为 <值B> 时，<系统>应在 <时限> 内 <动作>。' },
  { label: '故障处理', text: '故障处理：检测到 <故障> 持续 <时间> 时，<系统>应 <降级或恢复动作>，并记录 DTC <码>。' },
  { label: '时序要求', text: '时序要求：<事件A> 后 <时限> 内完成 <事件B>；超时按 <策略> 处理。' },
  { label: '接口约定', text: '接口：输入 <信号/参数>（<范围/单位>）；输出 <信号/参数>（<范围/单位>）；通信 <CAN/CANFD>，周期 <ms>。' },
  { label: '异常场景', text: '异常场景：<异常输入/环境> 时，<系统>应 <安全行为>，不得 <禁止行为>。' },
  { label: '上游派生', text: '本条由 <上游需求编号> 派生，实现其 <子功能> 部分。' },
];
function editorGuard(onProtected: () => void) {
  return Extension.create({ name: 'sourceGuard', addProseMirrorPlugins() { return [new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      const before = new Set<string>(), after = new Set<string>();
      state.doc.descendants(n => { if (n.type.name.startsWith('protected')) before.add(n.attrs.sid); });
      tr.doc.descendants(n => { if (n.type.name.startsWith('protected')) after.add(n.attrs.sid); });
      if ([...before].some(id => !after.has(id))) { onProtected(); return false; } return true;
    },
    appendTransaction(_transactions, _old, state) {
      if(!_transactions.some(tr=>tr.docChanged))return null;
      const ids = new Set<string>(); const tr = state.tr;
      state.doc.descendants((n, pos) => { const id = n.attrs.sid; if (!id) return; if (ids.has(id) && !n.type.name.startsWith('protected')) tr.setNodeMarkup(pos, undefined, { ...n.attrs, sid: null }); else ids.add(id); });
      return tr.docChanged ? tr : null;
    },
  })]; } });
}

export function DraftEditor(props: Props) {
  const { draft, onUpdate, onClose, onError, prepareNativeSave, onContext, onSaved, onOpenVariant, onOpenWorkItem, onVariantChanged, onClearError } = props;
  const surface = useRef<HTMLDivElement>(null); const editor = useRef<Editor | null>(null); const latest = useRef(props); latest.current = props;
  const [variantsOpen,setVariantsOpen]=useState(false);
  useEffect(()=>{setVariantsOpen(false);},[draft.id]);
  const session = useRef<RichReply | null>(null); const revision = useRef(draft.revision); const pending = useRef<JSONContent | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const inFlight = useRef<Promise<void> | null>(null);
  const checkpointWrites=useRef<Promise<void>>(Promise.resolve());
  const renderFrame=useRef(0);
  const updateToolbar=()=>{if(!renderFrame.current)renderFrame.current=requestAnimationFrame(()=>{renderFrame.current=0;setTick(v=>v+1);});};
  const [ready, setReady] = useState(false), [mode, setMode] = useState<'edit' | 'diff' | 'preview'>('edit'), [ribbon, setRibbon] = useState('text'), [focus, setFocus] = useState(true);
  useEffect(() => { setFocus(true); }, [draft.id]);
  const [busy, setBusy] = useState(false), [sync, setSync] = useState('正在载入'), [issue, setIssue] = useState(''), [tick, setTick] = useState(0),[loadError,setLoadError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0);
  const [tableMenu,setTableMenu]=useState<{left:number;top:number}|null>(null);
  const [popup, setPopup] = useState<string | null>(null), [link, setLink] = useState(''), [search, setSearch] = useState(''), [replace, setReplace] = useState('');
  const [linkText,setLinkText]=useState(''),[caseSensitive,setCaseSensitive]=useState(false);
  const searchState=useRef({query:'',caseSensitive:false});searchState.current={query:popup==='search'?search:'',caseSensitive};
  // 行内质量体检（先行版：内置规则本地运行；PSB-RULES 规则包与修复提案随接线版本接入）。
  const lintPack=useRef(defaultRulePack());const lintIssues=useRef<LintIssue[]>([]);const [lintTick,setLintTick]=useState(0);
  const [lintCard,setLintCard]=useState<{issue:LintIssue;left:number;top:number}|null>(null);const lintTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  // 整篇操作（排版整理等）的独立提示：用浮动提示条展示，不依赖会被保存链覆盖的 sync 文案。
  const [tidyNote,setTidyNote]=useState('');const tidyNoteTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const showTidyNote=(message:string)=>{setTidyNote(message);if(tidyNoteTimer.current)clearTimeout(tidyNoteTimer.current);tidyNoteTimer.current=setTimeout(()=>setTidyNote(''),4000);};
  const runLint=(e:Editor)=>{lintIssues.current=lintDocument(e.state.doc,lintPack.current);setLintTick(v=>v+1);};
  useEffect(() => watchRulePack((projectId, pack) => {
    if (projectId !== draft.target.projectId) return;
    lintPack.current = pack;
    const e = editor.current;
    if (e && !e.isDestroyed) {
      runLint(e);
      e.view.dispatch(e.state.tr.setMeta('quality-lint', true).setMeta('addToHistory', false));
    }
  }), [draft.target.projectId]);
  const openLink=(e:Editor)=>{if(e.state.selection.empty)e.commands.extendMarkRange('link');setLink(e.getAttributes('link').href??'');setLinkText(e.state.doc.textBetween(e.state.selection.from,e.state.selection.to,''));setPopup('link');};
  // 正文内 @ 引用工作项：尾部 @ 片段触发候选，回车/点击插入原生引用标记。
  type RefHit = { workItemId: string; title: string; source: 'document' | 'draft' | 'remote' };
  const [refQuery, setRefQuery] = useState<string | null>(null);
  const refHits = useRef<RefHit[]>([]); const refIndex = useRef(0); const refRange = useRef<{ from: number; to: number } | null>(null);
  const refTotal = useRef(0); const refPicker = useRef<HTMLDivElement>(null); const refInput = useRef<HTMLInputElement>(null);
  const refPos = useRef({ left: 0, top: 0 }); const refTicket = useRef(0);
  const [refTick, setRefTick] = useState(0);
  useEffect(() => { refPicker.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [refTick]);
  const documentItems = useRef<DocumentWorkItem[] | null>(null);
  const insertWorkItemRef = (workItemId: string) => {
    const e = editor.current; const range = refRange.current; setRefQuery(null); refRange.current = null;
    if (!e || !range) return;
    // 区间在异步搜索/光标移动后可能已失效：只删除仍然是 @查询 的那一段，避免误删正文。
    let text = '';
    try { text = e.state.doc.textBetween(range.from, range.to); } catch { return; }
    if (!/^@[A-Za-z0-9_-]*$/.test(text)) return;
    e.chain().focus().deleteRange(range).insertContentAt(range.from, { type: 'workItemRef', attrs: { workItemId } }).insertContent(' ').run();
  };
  const insertRefRef = useRef(insertWorkItemRef); insertRefRef.current = insertWorkItemRef;
  useEffect(() => {
    if (refQuery === null) { refHits.current = []; refRange.current = null; return; }
    // 本文档工作项先本地过滤并立即显示，再补上草稿与 Polarion 搜索，保证 @ 一出现就有候选。
    if (!documentItems.current || refQuery === '') documentItems.current = documentWorkItems();
    const local = filterWorkItems(documentItems.current, refQuery).map(item => ({ ...item, source: 'document' as const }));
    refTotal.current = local.length; refHits.current = local.slice(0, 300); refIndex.current = 0; setRefTick(value => value + 1);
    const ticket = ++refTicket.current; const timer = setTimeout(() => {
      void rpc<{ workItemId: string; title: string; source: 'draft' | 'remote' }[]>({ method: 'workitems.search', target: draft.target, query: refQuery, limit: 8 }).then(rows => {
        if (ticket !== refTicket.current) return;
        const seen = new Set(local.map(item => item.workItemId));
        const extra = rows.filter(row => !seen.has(row.workItemId));
        refTotal.current = local.length + extra.length;
        refHits.current = [...local, ...extra].slice(0, 300); refIndex.current = 0; setRefTick(value => value + 1);
      }).catch(() => { if (ticket === refTicket.current) setRefTick(value => value + 1); });
    }, 220);
    return () => clearTimeout(timer);
  }, [refQuery, draft.target]);
  // 滚动、缩放或切走焦点时，@ 候选不能悬在原地。滚动事件不跨 shadow root 冒泡，直接监听编辑画布。
  useEffect(() => {
    if (refQuery === null) return;
    const close = () => setRefQuery(null);
    const canvas = surface.current?.closest<HTMLElement>('.rich-canvas');
    canvas?.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => { canvas?.removeEventListener('scroll', close); window.removeEventListener('resize', close); };
  }, [refQuery]);
  const detectRefQuery = (current: import('@tiptap/core').Editor) => {
    const { $from } = current.state.selection; if (!$from.parent.inlineContent) { setRefQuery(null); return; }
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const match = before.match(/(?<![A-Za-z0-9._%+-])@([A-Za-z0-9_-]*)$/u);
    if (!match) { if (refQueryRef.current !== null) setRefQuery(null); return; }
    // 只替换 @ 与查询本身，保留前面的分隔空白，避免“参考TEST-728”粘连。
    refRange.current = { from: $from.pos - (match[1]?.length ?? 0) - 1, to: $from.pos };
    try { const box = current.view.coordsAtPos($from.pos); refPos.current = { left: Math.max(12, Math.min(window.innerWidth - 372, box.left)), top: Math.max(12, Math.min(box.bottom + 6, window.innerHeight - 346)) }; } catch {}
    setRefQuery(match[1] ?? '');
  };
  const refQueryRef = useRef<typeof refQuery>(null); refQueryRef.current = refQuery;
  const detectRefQueryRef = useRef(detectRefQuery); detectRefQueryRef.current = detectRefQuery;
  // 候选框自带的搜索框：输入直接过滤，↑↓/Enter/Esc 不离开候选框；正文里的 @ 片段保持到选中。
  const refInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); setRefQuery(null); editor.current?.view.focus(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (refHits.current.length) { refIndex.current = (refIndex.current + (event.key === 'ArrowDown' ? 1 : refHits.current.length - 1)) % refHits.current.length; setRefTick(value => value + 1); } return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const hit = refHits.current[Math.min(refIndex.current, refHits.current.length - 1)]; if (hit) insertRefRef.current(hit.workItemId); }
  };
  const openLinkRef=useRef(openLink);openLinkRef.current=openLink;
  useEffect(()=>{const e=editor.current;if(e&&!e.isDestroyed)e.view.dispatch(e.state.tr.setMeta('search-update',true).setMeta('addToHistory',false));},[search,caseSensitive,popup]);
  const popupRoot=useRef<HTMLDivElement>(null);
  const layer=useRef<HTMLDivElement>(null);
  const [popupPosition,setPopupPosition]=useState<React.CSSProperties>({position:'fixed',pointerEvents:'auto'});
  useLayoutEffect(()=>{
    if(!popup)return;const frame=surface.current?.closest<HTMLElement>('.rich-workbench'),panel=popupRoot.current;if(!frame||!panel)return;
    const place=()=>{const bounds=frame.getBoundingClientRect(),anchor=frame.querySelector('.rich-controls')?.getBoundingClientRect().bottom??bounds.top;
      const next={position:'fixed' as const,pointerEvents:'auto' as const,minWidth:0,maxWidth:'none',zIndex:1500,...editorPopoverPlacement(bounds,anchor,{width:innerWidth,height:innerHeight},panel.scrollHeight+2)};
      setPopupPosition(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    place();const resize=new ResizeObserver(place);resize.observe(frame);window.addEventListener('resize',place);return()=>{resize.disconnect();window.removeEventListener('resize',place);};
  },[popup,focus,props.aiOpen]);
  const closePopup=()=>{setPopup(null);editor.current?.view.focus();};
  useEffect(()=>{if(popup){const root=popupRoot.current;(root?.querySelector<HTMLElement>('input:not([type=color]),select')??root?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();}},[popup]);
  useEffect(()=>{setTableMenu(null);setPopup(null);},[mode,busy]);
  const [rows, setRows] = useState(3), [cols, setCols] = useState(3), [cellWidth, setCellWidth] = useState(140), [cellHeight, setCellHeight] = useState(40), [recovery, setRecovery] = useState<any>(null);
  const [formula, setFormula] = useState({ tex: '', kind: 'block' as 'block' | 'inline' });
  const [selected, setSelected] = useState(false); const inTable = !!editor.current?.isActive('table');
  const [bubble,setBubble]=useState<{left:number;top:number}|null>(null);
  const brush=useRef<JSONContent['marks']|null>(null);const [brushing,setBrushing]=useState(false),[customColor,setCustomColor]=useState('#2563eb');
  const [reviewing,setReviewing]=useState(false);
  const [board,setBoard]=useState<{record?:BoardRecord;generationRequest?:BoardGenerationRequest;code?:BoardCode;original?:{pos:number;src:string};bookmark:any;manual?:boolean}|null>(null);
  // 自动打开（需求配图）时光标从未被用户设置过，插入前先让用户点击指定位置。
  const [pendingBoard,setPendingBoard]=useState<BoardRecord|null>(null);
  const pendingBoardRef=useRef<BoardRecord|null>(null);
  const hasUserSelection=useRef(false);
  const openBoard=async(existing=false,generationRequest?:BoardGenerationRequest,code?:BoardCode)=>{
    const e=editor.current;
    if(!e||busy||board||draft.state==='uncertain')return;
    setBusy(true);e.setEditable(false,false);
    try {
      await flushRef.current();
      const bookmark=e.state.selection.getBookmark();
      const original=existing?{pos:e.state.selection.from,src:String(e.getAttributes('image').src??'')}:undefined;
      const record=original?await rpc<BoardRecord>({method:'boards.open',draftId:draft.id,src:original.src}):undefined;
      setBoard({record,generationRequest,code,original,bookmark,manual:!code&&!generationRequest&&hasUserSelection.current});
    }catch(error){setIssue((error as Error).message);setBusy(false);e.setEditable(true,false);}
  };
  useEffect(()=>{if(ready&&props.requestedBoard?.draftId===draft.id&&!board){const request=props.requestedBoard;props.onBoardOpened();void openBoard(false,request);}},[ready,props.requestedBoard,draft.id]);
  useEffect(()=>registerBoardReceiver(code=>{
    if(!ready||busy||board||draft.state==='uncertain')return false;
    void openBoard(false,undefined,code);
    return true;
  }),[ready,busy,board,draft.state,draft.id]);
  const closeBoard=()=>{pendingBoardRef.current=null;setPendingBoard(null);latest.current.onClearBoardContext();setBoard(null);setBusy(false);editor.current?.setEditable(latest.current.draft.state!=='uncertain',false);};
  const boardAttrs=(record:BoardRecord)=>({src:'polarion-asset:'+record.previewId,assetId:record.previewId,alt:record.manifest.title,title:'可编辑工程画板 · 源文件与预览一起保存',width:760,height:null,align:'center'});
  const finishBoardInsert=async()=>{
    try {
      await flushRef.current();
      const suffix=board?.record?.manifest.snapshotId??(board?.generationRequest?'generated:'+board.generationRequest.localBoardId:board?.code?await codeRecoverySuffix(board.code):'new');
      await browser.storage.local.remove('board-recovery:'+draft.id+':'+suffix);
    } catch(error){setIssue((error as Error).message);} finally {closeBoard();}
  };
  const insertBoard=async(record:BoardRecord)=>{
    const e=editor.current;if(!e||!board)throw Error('EDITOR_CLOSED');
    if(board.original){
      e.view.dispatch(replaceBoardPreview(e.state,board.original.pos,board.original.src,record.previewId));
    }else if(board.manual){
      e.view.dispatch(placeBoardImage(e.state,board.bookmark.resolve(e.state.doc).from,boardAttrs(record)));
    }else{
      setMode('edit');pendingBoardRef.current=record;setPendingBoard(record);
      setSync('画板已就绪 · 请在正文中点击插入位置');return;
    }
    await finishBoardInsert();
  };
  const placeBoard=async(record:BoardRecord,pos:number)=>{
    const e=editor.current;if(!e||!board||pendingBoardRef.current!==record)return;
    try{e.view.dispatch(placeBoardImage(e.state,pos,boardAttrs(record)));}
    catch(error){setIssue((error as Error).message);return;}
    pendingBoardRef.current=null;
    await finishBoardInsert();
  };
  const placeBoardRef=useRef(placeBoard);placeBoardRef.current=placeBoard;
  const imageFiles=useRef<HTMLInputElement>(null),imageCleanup=useRef<()=>void>(()=>{}),imageBusy=useRef(false),replaceImage=useRef(false);
  const [imageProperties,setImageProperties]=useState({alt:'',width:'',height:'',align:'left'});
  const imageDimensionsValid=[imageProperties.width,imageProperties.height].every(value=>value===''||(/^\d+$/.test(value)&&Number(value)>=1&&Number(value)<=9999));
  const importImages=async(files:File[])=>{
    const e=editor.current;if(!e||imageBusy.current||!files.length)return;imageBusy.current=true;setBusy(true);e.setEditable(false,false);const selection=e.state.selection.getBookmark();
    try{const nodes:JSONContent[]=[];for(const file of files){if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type))throw Error('请选择 PNG、JPEG、GIF 或 WebP 图片。');setSync('正在加入图片…');const asset=await uploadAsset(file,draft.target);if(asset.extraction!=='image')throw Error('文件不是可识别的图片。');nodes.push({type:'image',attrs:{src:'polarion-asset:'+asset.id,assetId:asset.id,alt:file.name,align:'left',width:null,height:null}});}if(e.isDestroyed)return;e.view.dispatch(e.state.tr.setSelection(selection.resolve(e.state.doc)));if(replaceImage.current&&nodes.length===1)e.commands.updateAttributes('image',nodes[0]!.attrs!);else e.commands.insertContent(nodes);await flushRef.current();}
    catch(error){setIssue((error as Error).message);}finally{replaceImage.current=false;imageBusy.current=false;if(!e.isDestroyed)e.setEditable(latest.current.draft.state!=='uncertain',false);setBusy(false);}
  };
  const importImagesRef=useRef(importImages);importImagesRef.current=importImages;
  const importRichClipboard=async(html:string,files:File[],event:ClipboardEvent)=>{
    const e=editor.current;if(!e||imageBusy.current)return;imageBusy.current=true;setBusy(true);e.setEditable(false,false);const bookmark=e.state.selection.getBookmark();
    try{
      if(html.length>35_000_000)throw Error('单次富文本粘贴过大，请分段粘贴。');const dom=new DOMParser().parseFromString(html,'text/html');const images=[...dom.querySelectorAll('img')];if(images.length>20)throw Error('单次混合粘贴最多 20 张图片，请分段粘贴。');
      // Untrusted clipboard markup is parsed as inert HTML and enters only the editor schema.
      dom.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n=>n.remove());
      for(let index=0;index<images.length;index++){
        const img=images[index]!,src=img.getAttribute('src')??'';let file:File|undefined;
        const internal=internalClipboardImage(img,{target:draft.target,workItemId:draft.workItemId});
        if(internal?.startsWith('polarion-asset:')||internal?.startsWith('workitemimg:')){
          let asset:Asset;
          if(internal.startsWith('polarion-asset:'))asset=await rpc<Asset>({method:'assets.metadata',assetId:internal.slice(15)});
          else if(/sidebar-board-[0-9a-f-]{36}\.png/i.test(internal)){const board=await rpc<BoardRecord>({method:'boards.open',draftId:draft.id,src:internal});asset=await rpc<Asset>({method:'assets.metadata',assetId:board.previewId});}
          else asset=await rpc<Asset>({method:'images.resolve',target:draft.target,workItemId:draft.workItemId,src:internal});
          if(asset.extraction!=='image'||!sameTarget(asset.target,draft.target))throw Error('剪贴板图片归属或格式不匹配；本次内容尚未插入。');
          img.setAttribute('src','polarion-asset:'+asset.id);img.setAttribute('data-polarion-asset',asset.id);img.removeAttribute('srcset');continue;
        }
        if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)){
          if(src.length>35_000_000)throw Error('粘贴图片超过 25 MB。');const response=await fetch(src),blob=await response.blob();file=new File([blob],`粘贴图片-${index+1}.${blob.type.split('/')[1]}`,{type:blob.type});
        }else if(files.length===images.length&&files[index]?.type.startsWith('image/'))file=files[index];
        else{
          const path=internal?.startsWith('attachment:')?draft.target.origin+'/polarion/module-attachment/'+encodeURIComponent(draft.target.projectId)+'/'+draft.target.document.split('/').map(encodeURIComponent).join('/')+'/'+encodeURIComponent(internal.slice(11)):src;
          if(!path.trim())throw Error('剪贴板图片地址缺失；本次内容尚未插入。');
          const url=new URL(path,location.href);if(url.origin!==location.origin||!/^https?:$/.test(url.protocol))throw Error('这次粘贴包含无法读取的外部图片，请同时复制图片文件或先将图片拖入编辑器；本次内容尚未插入。');
          const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('粘贴图片读取失败；本次内容尚未插入。');const blob=await response.blob();file=new File([blob],`粘贴图片-${index+1}`,{type:blob.type});
        }
        if(!file)throw Error('剪贴板图片缺失；本次内容尚未插入。');setSync(`正在导入图片 ${index+1}/${images.length}…`);const asset=await uploadAsset(file,draft.target);if(asset.extraction!=='image')throw Error('粘贴内容含有无法识别的图片；本次内容尚未插入。');
        img.setAttribute('src','polarion-asset:'+asset.id);img.setAttribute('data-polarion-asset',asset.id);img.removeAttribute('srcset');
      }
      if(e.isDestroyed)return;const slice=PMParser.fromSchema(e.schema).parseSlice(dom.body),selection=bookmark.resolve(e.state.doc);
      pasteRichContent(e.view,event,slice,selection);await flushRef.current();
    }catch(error){setIssue((error as Error).message);}finally{imageBusy.current=false;if(!e.isDestroyed)e.setEditable(latest.current.draft.state!=='uncertain',false);setBusy(false);}
  };
  const importRichClipboardRef=useRef(importRichClipboard);importRichClipboardRef.current=importRichClipboard;
  const checkpointKey = 'rich-recovery:' + draft.id;
  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) { await inFlight.current; if (pending.current) return flush(); return; }
    if (!pending.current || !session.current) return;
    const value = pending.current; pending.current = null;
    const action = (async () => {
      setSync('保存本地草稿…');
      try {
        const result = await rpc<DraftView>({ method: 'drafts.rich.apply', draftId: draft.id, editorId: session.current!.editorId, expectedRevision: revision.current, document: value });
        revision.current = result.revision; session.current!.draft = result; latest.current.onUpdate(result); setSync('已保存到本地'); setIssue('');
        checkpointWrites.current=checkpointWrites.current.catch(()=>{}).then(async()=>{if(!pending.current)await browser.storage.local.remove(checkpointKey);else await browser.storage.local.set({[checkpointKey]:{editorId:session.current!.editorId,revision:revision.current,document:pending.current,draftId:draft.id}});});
        await checkpointWrites.current;if(!pending.current)setRecovery(null);
      } catch (e) { if (!pending.current) pending.current = value; setSync('本地修改尚未同步'); setIssue((e as Error).message === 'STALE_DRAFT' ? '共享草稿已被 AI 或另一窗口修改。当前输入仍保留，请导出当前内容后再载入最新草稿。' : (e as Error).message); throw e; }
    })(); inFlight.current = action;
    try { await action; } finally { inFlight.current = null; }
    if (pending.current) await flush();
  };
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(()=>{props.onPrepareAI(()=>flushRef.current());return()=>props.onPrepareAI(null);},[draft.id]);
  const create = (view: RichReply) => {
    hasUserSelection.current=false;
    setTableMenu(null);setPopup(null);setRefQuery(null);
    editor.current?.destroy();imageCleanup.current();const resolver=imageResolver(view.draft);imageCleanup.current=resolver.dispose; session.current = view; revision.current = view.draft.revision; pending.current = null;
    const e = new Editor({ element: surface.current!, extensions: withFormulaViews([...richExtensions().map(extension=>extension.name==='image'?editableImage(resolver.resolve):extension.name==='table'?extension.configure({View:DocumentTableView}):extension), richEditorExtras(), Extension.create({name:'documentSearch',addProseMirrorPlugins(){return[new Plugin({props:{decorations(state){const s=searchState.current;if(!s.query)return null;return DecorationSet.create(state.doc,findTextMatches(state.doc,s.query,s.caseSensitive).map(m=>Decoration.inline(m.from,m.to,{class:m.from===state.selection.from&&m.to===state.selection.to?'search-match search-match-current':'search-match'})));}}})];}}),qualityLintExtension(lintIssues),editorGuard(() => setIssue('此操作会移除特殊宏。原始对象已保留，请在其前后编辑正文。'))]), content: sanitizeRichJSON(view.document),
      editorProps: {
        attributes: { 'aria-label': '工作项富文本编辑器', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
        clipboardSerializer:imageClipboardSerializer(richSchema,{target:draft.target,workItemId:draft.workItemId}),
        handlePaste(view, event) {
          return handleRichPaste(view, event, {
            importRichClipboard: importRichClipboardRef.current,
            importImages: importImagesRef.current,
            reportIssue: setIssue,
          });
        },
        handleDrop(view,event,movedSlice,moved){if(moved||!event.dataTransfer?.files.length)return false;event.preventDefault();const pos=view.posAtCoords({left:event.clientX,top:event.clientY});if(pos)editor.current?.commands.setTextSelection(pos.pos);void importImagesRef.current(Array.from(event.dataTransfer.files));return true;},
        handleClick(_view,pos){hasUserSelection.current=true;const record=pendingBoardRef.current;if(record){void placeBoardRef.current(record,pos);return true;}return false;},
        handleDOMEvents:{contextmenu(view,event){
          if(!view.editable)return false;
          const cell=(event.target as Element).closest('td,th');if(!cell||!view.dom.contains(cell))return false;
          const pos=view.posAtDOM(cell,0)-1;if(!['tableCell','tableHeader'].includes(view.state.doc.nodeAt(pos)?.type.name??''))return false;
          event.preventDefault();
          if(!cell.classList.contains('selectedCell'))view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc,pos)));
          setBubble(null);setPopup(null);setTableMenu({left:event.clientX,top:event.clientY});return true;
        }},
        handleKeyDown(_view,event){if(event.isComposing)return false;if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['Shift','Control','Meta','Alt','CapsLock','Escape','Tab'].includes(event.key))hasUserSelection.current=true;if(refQueryRef.current!==null){if(event.key==='Escape'){event.preventDefault();setRefQuery(null);return true;}if(refHits.current.length){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();refIndex.current=(refIndex.current+(event.key==='ArrowDown'?1:refHits.current.length-1))%refHits.current.length;setRefTick(v=>v+1);return true;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();const hit=refHits.current[Math.min(refIndex.current,refHits.current.length-1)];if(hit)insertRefRef.current(hit.workItemId);return true;}}}if((event.ctrlKey||event.metaKey)&&['Home','End'].includes(event.key)){event.preventDefault();hasUserSelection.current=true;editor.current?.commands.focus(event.key==='Home'?'start':'end');return true;}if((event.ctrlKey||event.metaKey)&&['f','h','k'].includes(event.key.toLowerCase())){event.preventDefault();if(event.key.toLowerCase()==='k'&&editor.current)openLinkRef.current(editor.current);else setPopup('search');return true;}if(event.key==='Escape'&&brush.current){brush.current=null;setBrushing(false);return true;}return false;},
      },
      onUpdate({ editor: current }) {
        const json = current.getJSON(); pending.current = json; setSync('正在编辑'); updateToolbar(); detectRefQuery(current);
        const checkpoint={editorId:view.editorId,revision:revision.current,document:json,draftId:draft.id};checkpointWrites.current=checkpointWrites.current.catch(()=>{}).then(()=>browser.storage.local.set({[checkpointKey]:checkpoint}));
        if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flushRef.current().catch(() => {}), 450);
        if (lintTimer.current) clearTimeout(lintTimer.current); lintTimer.current = setTimeout(() => { const ed = editor.current; if (ed && !ed.isDestroyed) { runLint(ed); ed.view.dispatch(ed.state.tr.setMeta('quality-lint', true).setMeta('addToHistory', false)); } }, 300);
      },
      onSelectionUpdate({ editor: current }) {
        updateToolbar(); const s = current.state.selection; setSelected(!s.empty);
        const node=(s as any).node;if(node?.type.name==='image')latest.current.onContext('选中图片或画板：'+(node.attrs.alt||'未命名图片')+'\n原始引用：'+node.attrs.src);
        if(!s.empty && s.$from.parent.inlineContent && s.$to.parent.inlineContent){const box=current.view.coordsAtPos(s.from);setBubble({left:Math.max(12,Math.min(window.innerWidth-330,box.left)),top:Math.max(12,box.top-46)});}else setBubble(null);
        if (!s.empty) { const text = current.state.doc.textBetween(s.from, s.to, '\n').trim(); if (text) latest.current.onContext(text.slice(0, 60000)); }
        if(!s.empty&&brush.current){const marks=brush.current;brush.current=null;setBrushing(false);const tr=current.state.tr;for(const name of ['bold','italic','underline','strike','subscript','superscript','code','paint','sourceSpan'])tr.removeMark(s.from,s.to,current.schema.marks[name]);for(const mark of marks)tr.addMark(s.from,s.to,current.schema.marks[mark.type]!.create(mark.attrs));current.view.dispatch(tr);}
        detectRefQueryRef.current(current);
      },
      onTransaction({transaction}) { if(transaction.docChanged||transaction.selectionSet||transaction.storedMarksSet)updateToolbar(); },
      onBlur() { setTimeout(() => { const root = refPicker.current?.getRootNode() as ShadowRoot | Document | undefined; const active = root && 'activeElement' in root ? root.activeElement : null; if (!refPicker.current || !active || !refPicker.current.contains(active)) setRefQuery(null); }, 0); },
    });
    editor.current = e; setReady(true); setSync('已保存到本地'); setIssue(''); runLint(e); latest.current.onUpdate(view.draft);
  };
  const previewLintFix = async (issue: LintIssue) => {
    if (!issue.suggestion || !issue.matchedText) throw Error('这条提示没有可用的替换建议。');
    await flushRef.current();
    return rpc<Proposal>({ method:'proposals.create', source:'lint', target:draft.target, workItemId:draft.workItemId, summary:`术语统一：${issue.matchedText} → ${issue.suggestion}`, op:{kind:'replace-all-text',draftId:draft.id,expectedRevision:revision.current,from:issue.matchedText,to:issue.suggestion,caseSensitive:true} });
  };
  const applyLintFix = async (proposal: Proposal, click: Event) => {
    if (!isUserEvent(click)) throw Error('请点击确认按钮保存体检修复。');
    const e = editor.current;
    if (!e || e.isDestroyed || busy) throw Error('编辑器忙，请重新预览。');
    const panel = document.querySelector<HTMLElement>('.polarion-dle-MainDockPanel'), wasInert = panel?.inert;
    if (panel) panel.inert = true;
    e.setEditable(false,false); setBusy(true);
    try {
      await flushRef.current();
      if (proposal.op.kind !== 'replace-all-text' || proposal.op.expectedRevision !== revision.current) throw Error('草稿已更新，请重新预览。');
      const nativeState = draft.variantOf ? 'clean' : await prepareNativeSave();
      if (e.isDestroyed) throw Error('编辑器已关闭。');
      const result = await rpc<{proposal:Proposal; draft?:DraftView}>({method:'proposals.approve',id:proposal.id,nativeState});
      const verified = result.proposal.savedToPolarion === true && result.proposal.status === 'applied';
      if (!e.isDestroyed && result.draft) {
        latest.current.onUpdate(result.draft);
        try { const view = await rpc<RichReply>({method:'drafts.rich.read',draftId:draft.id}); if (!e.isDestroyed && !pending.current) create(view); }
        catch (error) { setIssue('重新载入草稿失败：' + (error as Error).message); }
      }
      if (!verified || !result.draft) { setSync('体检修复未完成，请核对草稿状态'); throw Error(result.proposal.error ?? '保存尚未核实'); }
      setSync(`已保存并回读 · 替换 ${result.proposal.matchCount} 处 · ${result.proposal.recordId ? '项目变更记录已写入' : '项目变更记录待核对'}`);
      try { await onSaved(result.draft); } catch (error) { setIssue('正文已保存，原生页面刷新失败：' + (error as Error).message); }
      if (result.proposal.recordError) setIssue('正文已保存，变更记录写入失败：' + result.proposal.recordError);
    } finally { if (panel) panel.inert = wasInert ?? false; setBusy(false); }
  };
  const rewriteLintIssue = async (issue: LintIssue) => {
    await flushRef.current();
    const e = editor.current;
    if (!e || e.isDestroyed) throw Error('编辑器已关闭。');
    await props.onLintRewrite(issue,e.getText());
  };
  useEffect(() => {
    let disposed = false;setReady(false);setLoadError('');
    void (async () => {
      try { const [view, stored] = await Promise.all([rpc<RichReply>({ method: 'drafts.rich.read', draftId: draft.id }), browser.storage.local.get(checkpointKey)]); if (disposed) return; create(view); if (stored[checkpointKey]) setRecovery(stored[checkpointKey]); void loadRulePack(draft.target).then(pack => { if (disposed) return; lintPack.current = pack; const e = editor.current; if (e && !e.isDestroyed) { runLint(e); e.view.dispatch(e.state.tr.setMeta('quality-lint', true).setMeta('addToHistory', false)); } }); }
      catch (e) { if (!disposed) {setLoadError('这条正文暂时无法载入编辑器。原始内容仍可阅读，请重试或查看阅读模式。');setIssue((e as Error).message); setSync('载入失败'); } }
    })();
    const beforeUnload = (event: BeforeUnloadEvent) => { if (pending.current || inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { disposed = true; if (timer.current) clearTimeout(timer.current); if (lintTimer.current) clearTimeout(lintTimer.current); cancelAnimationFrame(renderFrame.current);renderFrame.current=0;editor.current?.destroy();imageCleanup.current(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [draft.id,loadAttempt]);
  const act = (run: (e: Editor) => void) => { if (!editor.current) return; run(editor.current); setTick(v => v + 1); };
  // 公式：双击正文公式可改源码；工具栏入口支持新插行内/块级公式。
  const openFormulaEditor = () => { const selected = (editor.current?.state.selection as { node?: { type: { name: string }; attrs: { tex?: string } } } | undefined)?.node; const existing = selected && ['formula', 'formulaInline'].includes(selected.type.name) ? selected : undefined; setFormula({ tex: existing?.attrs?.tex ?? '', kind: existing?.type.name === 'formulaInline' ? 'inline' : 'block' }); setPopup('formula'); };
  const applyFormula = () => { const e = editor.current; const tex = formula.tex.trim().slice(0, 4000); if (!e || !tex) { setIssue('请输入公式的 TeX 源码，例如 \\frac{P}{Q} 或 x^2+2x+1。'); return; } const selected = (e.state.selection as { node?: { type: { name: string } } }).node; if (selected && ['formula', 'formulaInline'].includes(selected.type.name)) e.chain().focus().updateAttributes(selected.type.name, { tex }).run(); else e.chain().focus().insertContent({ type: formula.kind === 'inline' ? 'formulaInline' : 'formula', attrs: { tex } }).insertContent(' ').run(); setPopup(null); };
  const insertDetails = () => act(e => { e.chain().focus().insertContent({ type: 'details', attrs: { open: false }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: '折叠块标题' }] }, { type: 'paragraph', content: [{ type: 'text', text: '折叠内容：在此编辑' }] }] }).run(); });
  const insertBadge = (tone: 'signal' | 'status' | 'alert') => act(e => { const preset = { signal: { background: '#e7f3ec', color: '#0f766e' }, status: { background: '#e8f0fb', color: '#22577a' }, alert: { background: '#fdf1e3', color: '#9a5b16' } }[tone]; e.chain().focus().insertContent({ type: 'text', text: '徽章文本', marks: [{ type: 'paint', attrs: preset }] }).run(); });
  const currentTablePos = (e: Editor) => { const { $from } = e.state.selection; for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'table') return $from.before(depth); return -1; };
  const applyPresetToDoc = (preset: TablePreset) => act(e => {
    const pos = currentTablePos(e);
    if (pos >= 0) { const node = e.state.doc.nodeAt(pos); if (!node) return; const transformed = applyTablePreset(node.toJSON(), preset).doc; e.view.dispatch(e.state.tr.replaceWith(pos, pos + node.nodeSize, e.state.schema.nodeFromJSON(transformed))); setSync(`已为当前表格套用「${tablePresetLabels[preset]}」· 可撤销`); }
    else { const result = applyTablePreset(e.getJSON(), preset); e.commands.setContent(result.doc); setSync(result.tables ? `已为全文 ${result.tables} 张表格套用「${tablePresetLabels[preset]}」· 可撤销` : '正文里还没有表格'); }
  });
  const tidyAll = () => act(e => { const result = tidyDocument(e.getJSON(), { tableDefaults: true }); e.commands.setContent(result.doc); const parts: string[] = []; if (result.changes.emptyParagraphs) parts.push(`清理空段 ${result.changes.emptyParagraphs} 处`); if (result.changes.resizedImages) parts.push(`图片限宽 ${result.changes.resizedImages} 张`); if (result.changes.tables) parts.push(`补全表格边框 ${result.changes.tables} 张`); if (result.changes.quotes) parts.push(`引号规范 ${result.changes.quotes} 处`); if (result.changes.hexPrefixes) parts.push(`十六进制前缀 ${result.changes.hexPrefixes} 处`); if (result.changes.spaces) parts.push(`多余空格 ${result.changes.spaces} 处`); if (result.changes.punctuation) parts.push(`重复标点 ${result.changes.punctuation} 处`); const message = parts.length ? `排版整理完成：${parts.join(' · ')} · 可撤销` : '排版已经整洁（单个空行按正文分段保留；连续空行、首尾空段会被合并清理）';
    // setContent 触发的 onUpdate→本地保存链会不断覆盖 sync 文案，因此用独立提示条显示结果。
    showTidyNote(message); });
  useEffect(()=>{if(!ready||busy||!props.remoteRevision||props.remoteRevision<=revision.current)return;if(pending.current||inFlight.current){setIssue('AI 已更新共享草稿；你尚未同步的输入仍保留，请先审阅差异。');return;}let cancelled=false;void rpc<RichReply>({method:'drafts.rich.read',draftId:draft.id}).then(view=>{if(!cancelled&&!pending.current&&!inFlight.current&&view.draft.revision>revision.current){create(view);setSync('AI 更新已载入 · 可查看修改对照');}}).catch(e=>setIssue(String(e)));return()=>{cancelled=true;};},[props.remoteRevision,ready,busy]);
  useEffect(()=>{editor.current?.setEditable(!busy&&draft.state!=='uncertain',false);},[ready,busy,draft.state]);
  const button = (title: string, icon: React.ReactNode, run: (e: Editor) => void, active = false, disabled = false) => <button type="button" className={'rt-button ' + (active ? 'active' : '')} aria-label={title} title={title} disabled={!ready || disabled || busy || draft.state==='uncertain'} onMouseDown={e => e.preventDefault()} onClick={() => act(run)}>{icon}</button>;
  const paint = (attrs: Record<string, string>) => act(e => { e.chain().focus().setMark('paint', attrs).run(); });
  const captureFormat=(e:Editor)=>{if(brush.current){brush.current=null;setBrushing(false);return;}let marks=e.state.selection.$from.marks();let found=false;e.state.doc.nodesBetween(e.state.selection.from,e.state.selection.to,node=>{if(!found&&node.isText){marks=node.marks;found=true;}});brush.current=marks.filter(m=>!['sourceText','link'].includes(m.type.name)).map(m=>({type:m.type.name,attrs:{...m.attrs,sid:null}}));setBrushing(true);setPopup(null);};
  const exportCurrent = () => { const data = JSON.stringify({ target: draft.target, workItemId: draft.workItemId, editorId: session.current?.editorId, revision: revision.current, document: editor.current?.getJSON() }, null, 2); const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = draft.workItemId + '-local-edit.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const findNext = (replaceCurrent = false,backwards=false) => {
    const e = editor.current; if (!e || !search) return;
    if(replaceCurrent){const tr=replaceSelectedMatch(e.state,search,replace,caseSensitive);if(tr)e.view.dispatch(tr);}
    const matches=findTextMatches(e.state.doc,search,caseSensitive);
    const match = backwards?(matches.findLast(m=>m.to<=e.state.selection.from)??matches.at(-1)):(matches.find(m => m.from >= e.state.selection.to) ?? matches[0]); if (match) e.chain().setTextSelection(match).scrollIntoView().run();
  };
  const searchMatches=editor.current&&search?findTextMatches(editor.current.state.doc,search,caseSensitive):[];
  const searchIndex=searchMatches.findIndex(m=>m.from===editor.current?.state.selection.from&&m.to===editor.current?.state.selection.to);
  useEffect(()=>{if(ready&&props.initialScrollTop!==undefined){const canvas=surface.current?.closest<HTMLElement>('.rich-canvas');if(canvas)canvas.scrollTop=props.initialScrollTop;}},[ready,props.initialScrollTop]);
  const save = async (event: React.MouseEvent) => {
    const background=!!draft.variantOf;
    if (!isUserEvent(event.nativeEvent)) {setIssue(`保存没有收到有效的用户点击，请重新点击“${background?'保存到变体':'保存到 Polarion'}”。`);return;} setBusy(true);setIssue('');setSync('正在同步本地修改…');
    const panel = document.querySelector<HTMLElement>('.polarion-dle-MainDockPanel'); const wasInert = panel?.inert; if (panel) panel.inert = true;
    editor.current?.setEditable(false,false);
    let verified=false;const canvas=surface.current?.closest<HTMLElement>('.rich-canvas'),scrollTop=canvas?.scrollTop??0;
    try { await flushRef.current();const nativeState=background?'clean':await prepareNativeSave();setSync('正在写入并回读核对…'); const result = await rpc<DraftView>({ method: 'drafts.save', draftId: draft.id, expectedRevision: revision.current, nativeState }); verified=true;onUpdate(result);revision.current=result.revision;if(session.current)session.current.draft=result;setSync(background?'已保存到变体 · 主工作项未改动':'已写入 Polarion · 回读一致');onClearError();await onSaved(result);
      // 守望推送：保存成功后读缓存影响卡（不触发扫描），关联模块疑似过期时提示做一致性巡检。
      if (!background) void rpc<{ staleCount: number }>({ method: 'impact.view', target: draft.target, workItemId: draft.workItemId })
        .then(view => { if (view.staleCount > 0) setIssue(`已保存。守望提醒：${view.staleCount} 个关联实现模块在基准后变化过（疑似过期），建议在模型工作台做一次一致性巡检。`); })
        .catch(() => { /* 影响卡依赖覆盖索引，未建时静默跳过 */ }); }
    catch (e) {
      if(verified){setSync('已写入 Polarion · 回读一致');setIssue('保存已成功，原生正文尚未同步：'+(e as Error).message);}
      else {onError(e);setSync('保存未完成 · 草稿已保留');setIssue(saveError(e));try{latest.current.onUpdate(await rpc<DraftView>({method:'drafts.read',draftId:draft.id}));}catch{/* Preserve the original write error. */}}
    }
    finally { if (panel) panel.inert = wasInert ?? false; editor.current?.setEditable(latest.current.draft.state!=='uncertain',false); setBusy(false);requestAnimationFrame(()=>{if(canvas?.isConnected)canvas.scrollTop=scrollTop;}); }
  };
  const stateLabel = { clean: '与基线一致', dirty: '待保存到 Polarion', conflict: '待合并', uncertain: '待回读核对' }[draft.state];
  const characterCount=useMemo(()=>editor.current?.getText().length??0,[tick,ready]);
  const typography=ready?selectionTypography(editor.current):{size:'10pt',font:'',line:'1.5'};
  const fontOptions=[['Microsoft YaHei, sans-serif','微软雅黑'],['SimSun, serif','宋体'],['Arial, sans-serif','Arial'],['Consolas, monospace','Consolas']];
  const selectedFont=fontOptions.find(([value])=>typography.font.replaceAll('"','').startsWith(value!.split(',')[0]!))?.[0]??'';
  return <div ref={layer} className={'editor-layer rich-layer ' + (focus ? 'focus-mode ' : '')+(props.aiOpen?'with-ai':'')}><section className="editor rich-workbench" role="dialog" aria-modal="false" aria-label="工作项编辑工作台" onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing&&popup){event.preventDefault();event.stopPropagation();closePopup();}}}>
    <header className="rich-header"><div className="rich-doc-icon"><FileBadge/></div><div className="rich-heading"><span className="eyebrow">{(draft.variantOf?'变体':'工作项')} · {draft.workItemId}</span><h2>{draft.title}</h2>{draft.variantOf&&<button className="variant-chip" title={'返回主工作项 '+draft.variantOf} onClick={()=>onOpenVariant(draft.variantOf!)}><GitBranch size={11}/>主工作项 {draft.variantOf}</button>}</div><div className="rich-window-actions">{!draft.variantOf && <ModuleNotePanel target={draft.target} workItemId={draft.workItemId} toolbar onError={setIssue} />}{!draft.variantOf&&<button className="editor-ai-toggle" aria-pressed={variantsOpen} title="变体管理" onClick={()=>setVariantsOpen(value=>!value)}><GitBranch size={14}/>变体</button>}<button className="editor-ai-toggle" aria-pressed={props.aiOpen} onClick={props.onToggleAI}><MessageSquare size={14}/>AI 协作</button><span className={'sync-status ' + (issue ? 'warning' : '')}><i/>{sync}</span><button className="icon" title={focus ? '退出专注编辑' : '专注编辑'} onClick={() => setFocus(v => !v)}>{focus ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button><button className="icon" title="关闭，保留本地草稿" disabled={busy} onClick={() => void flushRef.current().then(onClose).catch(error => { onError(error); onClose(); })}><X size={19}/></button></div></header>
    <nav className="editor-toolbar rich-tabs"><div>{[['edit','编辑正文'],['preview','阅读预览'],['diff','修改对照']].map(([key,label]) => <button key={key} className={mode === key ? 'selected' : ''} onClick={() => void flushRef.current().then(() => setMode(key as any)).catch(onError)}>{label}</button>)}</div><span>修订 {draft.revision} <b>·</b> {stateLabel}</span></nav>
    <div className="rich-controls" hidden={mode !== 'edit'}>
      <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple ref={imageFiles} aria-label="插入正文图片文件" onChange={e=>{if(e.target.files)void importImagesRef.current(Array.from(e.target.files));e.target.value='';}}/>
      <div className="ribbon-tabs"><button className={ribbon === 'text' ? 'active' : ''} onClick={() => setRibbon('text')}>文字与段落</button><button className={ribbon === 'table' ? 'active' : ''} onClick={() => setRibbon('table')}>表格 {inTable && <i/>}</button><button className={ribbon === 'insert' ? 'active' : ''} onClick={() => setRibbon('insert')}>插入与查找</button><span>Ctrl+B / I / U · Ctrl+Z 撤销</span></div>
      <SingleLineToolbar mode={ribbon} tick={tick} disabled={!ready||busy||draft.state==='uncertain'}>
        <div aria-label="编辑历史">{button('撤销 Ctrl+Z',<Undo2 size={16}/>,e=>{e.chain().focus().undo().run();},false,!editor.current?.can().undo())}{button('重做 Ctrl+Y',<Redo2 size={16}/>,e=>{e.chain().focus().redo().run();},false,!editor.current?.can().redo())}</div>
        {ribbon==='text'&&<>
          <div aria-label="字体与段落样式"><select aria-label="段落样式" value={editor.current?.isActive('heading')?String(editor.current.getAttributes('heading').level):'p'} onChange={event=>act(e=>{const value=event.target.value;value==='p'?e.chain().focus().setParagraph().run():e.chain().focus().setHeading({level:Number(value) as any}).run();})}><option value="p">正文</option>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>标题 {n}</option>)}</select><select aria-label="字体" value={selectedFont} onChange={event=>paint({font:event.target.value})}><option value="" disabled>{typography.font.split(',')[0]?.replaceAll('"','')||'默认字体'}</option>{fontOptions.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select><select aria-label="字号" title="字号（pt），与 Polarion 原生字号一致" value={typography.size} onChange={event=>paint({size:event.target.value})}>{!nativeFontSizes.includes(parseFloat(typography.size))&&<option value={typography.size}>{parseFloat(typography.size)} pt</option>}{nativeFontSizes.map(n=><option key={n} value={n+'pt'}>{n} pt</option>)}</select></div>
          <div aria-label="常用文字格式">{button('加粗 Ctrl+B',<Bold size={16}/>,e=>{e.chain().focus().toggleBold().run();},editor.current?.isActive('bold'))}{button('斜体 Ctrl+I',<Italic size={16}/>,e=>{e.chain().focus().toggleItalic().run();},editor.current?.isActive('italic'))}{button('下划线 Ctrl+U',<Underline size={16}/>,e=>{e.chain().focus().toggleUnderline().run();},editor.current?.isActive('underline'))}{button('文字颜色',<Palette size={16}/>,()=>setPopup(popup==='color'?null:'color'))}{button('文字高亮',<Highlighter size={16}/>,()=>setPopup(popup==='highlight'?null:'highlight'))}<ToolbarMenu label="格式" disabled={!ready||busy}>{button('删除线',<Strikethrough size={16}/>,e=>{e.chain().focus().toggleStrike().run();},editor.current?.isActive('strike'))}{button('下标',<Subscript size={16}/>,e=>{e.chain().focus().toggleSubscript().run();},editor.current?.isActive('subscript'))}{button('上标',<Superscript size={16}/>,e=>{e.chain().focus().toggleSuperscript().run();},editor.current?.isActive('superscript'))}<hr/>{button('格式刷：复制当前格式后选择目标文字',<><Palette size={16}/><span>{brushing?'选择目标文字…':'格式刷'}</span></>,captureFormat,brushing)}{button('清除文字格式',<Eraser size={16}/>,clearTextFormatting)}</ToolbarMenu></div>
          <div aria-label="段落与列表"><ToolbarMenu label="段落" disabled={!ready||busy}>{[['left',AlignLeft,'左对齐'],['center',AlignCenter,'居中'],['right',AlignRight,'右对齐'],['justify',AlignJustify,'两端对齐']].map(([v,Icon,label]:any)=><React.Fragment key={v}>{button(label,<Icon size={16}/>,e=>{e.chain().focus().setTextAlign(v).run();},editor.current?.isActive({textAlign:v}))}</React.Fragment>)}<hr/>{button('无序列表',<List size={16}/>,e=>{e.chain().focus().toggleBulletList().run();},editor.current?.isActive('bulletList'))}{button('有序列表',<ListOrdered size={16}/>,e=>{e.chain().focus().toggleOrderedList().run();},editor.current?.isActive('orderedList'))}{button('列表增加层级',<span>增加缩进</span>,e=>{e.chain().focus().sinkListItem(e.isActive('taskItem')?'taskItem':'listItem').run();},false,!editor.current?.can().sinkListItem(editor.current?.isActive('taskItem')?'taskItem':'listItem'))}{button('列表减少层级',<span>减少缩进</span>,e=>{e.chain().focus().liftListItem(e.isActive('taskItem')?'taskItem':'listItem').run();},false,!editor.current?.can().liftListItem(editor.current?.isActive('taskItem')?'taskItem':'listItem'))}{button('引用',<Quote size={16}/>,e=>{e.chain().focus().toggleBlockquote().run();},editor.current?.isActive('blockquote'))}<hr/><label>行距<select aria-label="行距" value={typography.line} onChange={event=>act(e=>{setParagraphLineHeight(e,event.target.value);})}>{!['1','1.2','1.5','1.75','2'].includes(typography.line)&&<option value={typography.line}>{typography.line} 倍</option>}{['1','1.2','1.5','1.75','2'].map(n=><option key={n} value={n}>{n} 倍</option>)}</select></label>{button('段落属性与提示色块',<span>段落属性与提示色块…</span>,()=>setPopup('paragraph-properties'))}</ToolbarMenu></div>
        </>}
        {ribbon==='table'&&<>
          <div aria-label="表格设置与插入"><ToolbarMenu label="表格设置" disabled={!inTable}>{button('选择整张表格',<span>选择整张表格</span>,e=>{selectTableScope(e,'table');},false,!inTable)}{button('切换表头行',<PanelTop size={16}/>,e=>{e.chain().focus().toggleHeaderRow().run();},false,!inTable)}{button('表格属性',<span>表格属性…</span>,()=>setPopup('table-properties'),false,!inTable)}<hr/>{button('删除表格',<span>删除表格</span>,e=>{e.chain().focus().deleteTable().run();},false,!inTable)}</ToolbarMenu>{button('插入表格',<><Table2 size={16}/><span>插入表格</span></>,()=>setPopup('table'))}</div>
          <div aria-label="行与列"><ToolbarMenu label="行" icon={<Rows3 size={16}/>} disabled={!inTable}>{button('选择整行',<span>选择整行</span>,e=>{selectTableScope(e,'row');},false,!inTable)}{button('上方插入行',<span>在上方插入</span>,e=>{e.chain().focus().addRowBefore().run();},false,!inTable)}{button('下方插入行',<span>在下方插入</span>,e=>{e.chain().focus().addRowAfter().run();},false,!inTable)}{([-1,1] as const).map(direction=><React.Fragment key={direction}>{button(direction<0?'行上移':'行下移',<span>{direction<0?'上移一行':'下移一行'}</span>,e=>{if(!moveAxis(e,'row',direction))setIssue('已到表格边界，或当前合并区域不支持此次移动。');},false,!inTable)}</React.Fragment>)}<hr/>{button('删除当前行',<span>删除当前行</span>,e=>{e.chain().focus().deleteRow().run();},false,!inTable)}</ToolbarMenu><ToolbarMenu label="列" icon={<Columns3 size={16}/>} disabled={!inTable}>{button('选择整列',<span>选择整列</span>,e=>{selectTableScope(e,'column');},false,!inTable)}{button('左侧插入列',<span>在左侧插入</span>,e=>{e.chain().focus().addColumnBefore().run();},false,!inTable)}{button('右侧插入列',<span>在右侧插入</span>,e=>{e.chain().focus().addColumnAfter().run();},false,!inTable)}{([-1,1] as const).map(direction=><React.Fragment key={direction}>{button(direction<0?'列左移':'列右移',<span>{direction<0?'左移一列':'右移一列'}</span>,e=>{if(!moveAxis(e,'column',direction))setIssue('已到表格边界，或当前合并区域不支持此次移动。');},false,!inTable)}</React.Fragment>)}<hr/>{button('删除当前列',<span>删除当前列</span>,e=>{e.chain().focus().deleteColumn().run();},false,!inTable)}</ToolbarMenu></div>
          <div aria-label="单元格">{button('合并选中单元格',<span>合并</span>,e=>{e.chain().focus().mergeCells().run();},false,!editor.current?.can().mergeCells())}{button('拆分单元格',<span>拆分</span>,e=>{e.chain().focus().splitCell().run();},false,!editor.current?.can().splitCell())}{button('单元格底色',<Palette size={16}/>,()=>setPopup('cell-color'),false,!inTable)}<ToolbarMenu label="单元格" disabled={!inTable}>{button('单元格尺寸与对齐',<WrapText size={16}/>,()=>setPopup('cell-size'),false,!inTable)}{button('单元格属性',<span>单元格属性…</span>,()=>setPopup('cell-properties'),false,!inTable)}</ToolbarMenu></div>
          <div aria-label="表格样式"><ToolbarMenu label="表格样式" icon={<Wand2 size={16}/>}>{(['plain','threeLine','zebra','minimal'] as TablePreset[]).map(preset=><React.Fragment key={preset}>{button(inTable?`当前表格套用「${tablePresetLabels[preset]}」`:`全文表格套用「${tablePresetLabels[preset]}」`,<><Table2 size={16}/><span>{tablePresetLabels[preset]}</span></>,()=>applyPresetToDoc(preset))}</React.Fragment>)}</ToolbarMenu></div>

        </>}
        {ribbon==='insert'&&<>
          <div aria-label="插入内容">{button('插入图片',<><ImagePlus size={16}/><span>图片</span></>,()=>{replaceImage.current=false;imageFiles.current?.click();})}{button('插入表格',<><Table2 size={16}/><span>表格</span></>,()=>setPopup('table'))}{button('插入或编辑链接',<><Link size={16}/><span>链接</span></>,openLink)}{button('插入可编辑画板',<><PenTool size={16}/><span>画板</span></>,()=>void openBoard())}{button('插入公式（行内/块级，LaTeX 语法）',<><Sigma size={16}/><span>公式</span></>,openFormulaEditor)}<ToolbarMenu label="更多插入">{button('插入折叠块（原生 details，Polarion 原生视图不折叠时内容仍完整）',<><ListCollapse size={16}/><span>折叠块</span></>,insertDetails)}{button('插入分隔线',<><Minus size={16}/><span>分隔线</span></>,e=>{e.chain().focus().setHorizontalRule().run();})}{button('行内代码',<><Code size={16}/><span>行内代码</span></>,e=>{e.chain().focus().toggleCode().run();})}{button('代码块',<><Code size={16}/><span>代码块</span></>,e=>{e.chain().focus().toggleCodeBlock().run();},editor.current?.isActive('codeBlock'))}{editor.current?.isActive('codeBlock')&&<label>语言<select aria-label="代码语言" value={editor.current.getAttributes('codeBlock').language??''} onChange={event=>act(e=>{e.chain().focus().updateAttributes('codeBlock',{language:event.target.value||null}).run();})}>{[['','纯文本'],['c','C'],['cpp','C++'],['matlab','MATLAB'],['python','Python'],['json','JSON']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}<hr/>{button('插入徽章：信号',<><Tags size={16}/><span>信号徽章</span></>,()=>insertBadge('signal'))}{button('插入徽章：状态',<><Tags size={16}/><span>状态徽章</span></>,()=>insertBadge('status'))}{button('插入徽章：告警',<><Tags size={16}/><span>告警徽章</span></>,()=>insertBadge('alert'))}<hr/>{engineeringSnippets.map(snippet => button(`插入工程句式：${snippet.label}`,<span>{snippet.label}句式</span>,e=>{e.chain().focus().insertContent(snippet.text).run();}))}<hr/>{button('图片属性',<span>图片属性…</span>,e=>{const a=e.getAttributes('image');setImageProperties({alt:a.alt??'',width:a.width?String(a.width):'',height:a.height?String(a.height):'',align:a.align??'left'});setPopup('image');},false,!editor.current?.isActive('image'))}{button('继续编辑选中画板',<span>继续编辑选中画板…</span>,()=>void openBoard(true),false,!editor.current?.isActive('image'))}</ToolbarMenu></div>
          <div aria-label="查找与备份">{button('一键排版整理：空段清理、图片限宽、表格补边框、引号/十六进制/空格/重复标点规范（代码与公式不动）',<><Wand2 size={16}/><span>排版整理</span></>,tidyAll)}{button('写前查重：与当前文档已索引条目比对，找相似需求和共享术语',<><CopyCheck size={16}/><span>写前查重</span></>,()=>setPopup(popup==='dedup'?null:'dedup'))}{button('影响分析：本条目的实现模块（含疑似过期）、上下游与验证链接',<><GitFork size={16}/><span>影响分析</span></>,()=>setPopup(popup==='impact'?null:'impact'))}{button('查找与替换',<><Search size={16}/><span>查找替换</span></>,()=>setPopup(popup==='search'?null:'search'))}{button('导出当前编辑备份',<Download size={16}/>,exportCurrent)}</div>
        </>}
        <div aria-label="文档操作">{ready&&editor.current&&<div inert={busy||draft.state==='uncertain'}><EditorDocTools compact editor={editor.current} onPopup={name=>{if(name==='link')openLink(editor.current!);else setPopup(name);}} onImage={()=>{replaceImage.current=false;imageFiles.current?.click();}} onBoard={()=>void openBoard()} onIssue={setIssue}/></div>}</div>
      </SingleLineToolbar>

      {popup && layer.current && createPortal(<div className="rich-popover" ref={popupRoot} style={popupPosition} role="dialog" aria-label="编辑属性" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePopup();}}}><div className="popover-title"><strong>{{ color:'文字颜色', highlight:'文字高亮', 'cell-color':'单元格底色', table:'插入表格', link:'编辑链接', 'cell-size':'单元格设置', search:'查找与替换',image:'图片属性','paragraph-properties':'段落属性','table-properties':'表格属性','cell-properties':'单元格属性',formula:'插入公式',dedup:'写前查重',impact:'影响分析' }[popup]}</strong><button className="icon" title="关闭工具面板" onClick={closePopup}><X size={14}/></button></div>
        {popup.endsWith('-properties')&&editor.current&&<FormatProperties key={popup} editor={editor.current} scope={popup.split('-')[0] as 'paragraph'|'table'|'cell'} onDone={closePopup}/>}
        {popup==='dedup'&&<DedupPanel target={draft.target} selfId={draft.workItemId} getText={() => draft.title + '\n' + (editor.current?.getText() ?? '')} onOpenItem={onOpenWorkItem}/>}
        {popup==='impact'&&<ImpactPanel target={draft.target} workItemId={draft.workItemId} onOpenItem={onOpenWorkItem}/>}
        {popup==='image'&&<><div className="inline-fields"><label>说明<input aria-label="图片说明" value={imageProperties.alt} onChange={e=>setImageProperties(p=>({...p,alt:e.target.value}))}/></label><label>宽度<input aria-label="图片宽度" type="number" min="1" max="9999" placeholder="自动" value={imageProperties.width} onChange={e=>setImageProperties(p=>({...p,width:e.target.value}))}/></label><label>高度<input aria-label="图片高度" type="number" min="1" max="9999" placeholder="自动" value={imageProperties.height} onChange={e=>setImageProperties(p=>({...p,height:e.target.value}))}/></label><select aria-label="图片对齐" value={imageProperties.align} onChange={e=>setImageProperties(p=>({...p,align:e.target.value}))}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></div><div className="inline-fields"><button className="primary" disabled={!imageDimensionsValid} onClick={()=>{act(e=>{e.chain().focus().updateAttributes('image',{alt:imageProperties.alt,width:imageProperties.width?Number(imageProperties.width):null,height:imageProperties.height?Number(imageProperties.height):null,align:imageProperties.align}).run();});setPopup(null);}}>应用图片属性</button><button className="secondary" onClick={()=>{replaceImage.current=true;imageFiles.current?.click();}}>替换图片</button><button className="secondary" onClick={()=>{act(e=>{e.chain().focus().deleteSelection().run();});setPopup(null);}}>删除图片</button></div><p role={imageDimensionsValid?undefined:'status'}>{imageDimensionsValid?'只填写宽度时保持原图比例。图片随正文保存到当前工作项附件。':'图片宽度和高度须为 1–9999 的整数，或留空使用原始比例。'}</p></>}
        {['color','highlight','cell-color'].includes(popup) && <div className="swatches">{(popup === 'color' ? colors : fills).map(color => <button key={color} aria-label={color} title={color} style={{ backgroundColor: color }} onMouseDown={e => e.preventDefault()} onClick={() => { if (popup === 'cell-color') act(e => { e.chain().focus().setCellAttribute('fill', color).run(); }); else paint({ [popup === 'color' ? 'color' : 'background']: color }); setPopup(null); }}/>)}</div>}
        {['color','highlight','cell-color'].includes(popup)&&<div className="inline-fields"><input type="color" aria-label="自定义颜色选择" value={/^#[a-f0-9]{6}$/i.test(customColor)?customColor:'#2563eb'} onChange={e=>setCustomColor(e.target.value)}/><input aria-label="自定义颜色值" value={customColor} placeholder="#2563eb" maxLength={7} onChange={e=>setCustomColor(e.target.value)}/><button className="primary" disabled={!/^#[a-f0-9]{6}$/i.test(customColor)} onClick={()=>{if(popup==='cell-color')act(e=>{e.chain().focus().setCellAttribute('fill',customColor).run();});else paint({[popup==='color'?'color':'background']:customColor});setPopup(null);}}>应用颜色</button></div>}
        {popup === 'table' && <><div className="table-grid">{Array.from({ length: 48 }, (_,i) => <button key={i} aria-label={`插入 ${Math.floor(i / 8) + 1} 行 ${i % 8 + 1} 列表格`} className={Math.floor(i / 8) < rows && i % 8 < cols ? 'selected' : ''} onMouseEnter={() => { setRows(Math.floor(i / 8) + 1); setCols(i % 8 + 1); }} onMouseDown={e => e.preventDefault()} onClick={() => { act(e => { e.chain().focus().insertTable({ rows: Math.floor(i / 8) + 1, cols: i % 8 + 1, withHeaderRow: true }).run(); }); setPopup(null); }}/>)}</div><div className="inline-fields"><label>行<input type="number" min="1" max="100" value={rows} onChange={e => setRows(Math.max(1, Math.min(100, Number(e.target.value))))}/></label><label>列<input type="number" min="1" max="30" value={cols} onChange={e => setCols(Math.max(1, Math.min(30, Number(e.target.value))))}/></label><button className="primary" onClick={() => { act(e => { e.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(); }); setPopup(null); }}>插入</button></div><p>支持嵌套表格 · 首行默认为表头 · 输入 <code>|列1|列2|</code> 后回车可快速建表</p></>}
        {popup === 'formula' && <div className="editor-search-fields"><label>TeX 源码<textarea className="formula-input" rows={3} aria-label="公式 TeX 源码" placeholder="例如：T_{amb} \ge 38.5\,^\circ C \Rightarrow P_{comp} = P_{max}" value={formula.tex} onChange={e => setFormula(f => ({ ...f, tex: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormula(); } }}/></label><div className="inline-fields"><label className="formula-kind"><input type="radio" name="formula-kind" checked={formula.kind === 'block'} onChange={() => setFormula(f => ({ ...f, kind: 'block' }))}/>块级公式（独立成行）</label><label className="formula-kind"><input type="radio" name="formula-kind" checked={formula.kind === 'inline'} onChange={() => setFormula(f => ({ ...f, kind: 'inline' }))}/>行内公式（随文字排版）</label><button className="primary" disabled={!formula.tex.trim()} onClick={applyFormula}>插入公式</button></div><p>LaTeX 语法 · 侧边栏渲染为排版公式，Polarion 原生视图显示等宽源码 · 正文输入 <code>$公式$</code> 收尾或 <code>$$…$$</code> 回车可快捷创建</p></div>}
        {popup === 'link' && <div className="editor-search-fields"><label>显示文字<input aria-label="链接显示文字" value={linkText} placeholder="留空时使用链接地址" onChange={e=>setLinkText(e.target.value)}/></label><label>链接地址<input aria-label="链接地址" placeholder="https://… 或 /polarion/…" value={link} onChange={e => setLink(e.target.value)}/></label><div className="inline-fields"><button className="primary" onClick={() => { if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(link.trim())) { setIssue('请输入有效的网页或 Polarion 链接。'); return; } act(e => {const text=linkText||link.trim(),{from,to}=e.state.selection,current=e.state.doc.textBetween(from,to,'');if(current===text)e.chain().focus().setLink({href:link.trim()}).run();else e.chain().focus().insertContent({type:'text',text,marks:[{type:'link',attrs:{href:link.trim()}}]}).run();});setPopup(null); }} >应用链接</button><button className="secondary" onClick={() => { act(e => { e.chain().focus().extendMarkRange('link').unsetLink().run(); }); setPopup(null); }}>移除链接</button></div></div>}
        {popup === 'cell-size' && <><div className="inline-fields"><label>列宽<input type="number" min="40" max="1200" value={cellWidth} onChange={e => setCellWidth(Number(e.target.value))}/></label><label>行高<input type="number" min="24" max="600" value={cellHeight} onChange={e => setCellHeight(Number(e.target.value))}/></label><button className="primary" onClick={() => { act(e => { e.chain().focus().setCellAttribute('colwidth', [Math.max(40, Math.min(1200, cellWidth))]).setCellAttribute('cellHeight', Math.max(24, Math.min(600, cellHeight))).run(); }); setPopup(null); }}>应用 px</button></div><div className="inline-fields">{[['top','顶部'],['middle','居中'],['bottom','底部']].map(([v,label]) => <button className="secondary" key={v} onMouseDown={e => e.preventDefault()} onClick={() => act(e => { e.chain().focus().setCellAttribute('valign', v).run(); })}>{label}对齐</button>)}</div></>}
        {popup === 'search' && <div className="editor-search-fields"><input type="text" aria-label="查找文字" placeholder="查找" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();findNext(false,e.shiftKey);}}}/><input type="text" aria-label="替换文字" placeholder="替换为" value={replace} onChange={e => setReplace(e.target.value)}/><label><button type="button" className="search-case-toggle" role="checkbox" aria-label="区分大小写" aria-checked={caseSensitive} onClick={()=>setCaseSensitive(v=>!v)}><span aria-hidden="true">{caseSensitive&&<Check size={12}/>}</span>区分大小写</button><span className="editor-search-count" role="status">{searchMatches.length?`${searchIndex<0?'—':searchIndex+1} / ${searchMatches.length} 处匹配`:search?'未找到匹配':'输入查找内容'}</span></label><div className="editor-search-actions"><button className="secondary" disabled={!searchMatches.length} onClick={() => findNext(false,true)}>上一个</button><button className="secondary" disabled={!searchMatches.length} onClick={() => findNext()}>下一个</button><button className="primary" disabled={searchIndex<0} onClick={() => findNext(true)}>替换当前</button><button className="secondary" disabled={!searchMatches.length} onClick={()=>act(e=>{const {tr,count}=replaceAllMatches(e.state,search,replace,caseSensitive);if(count){e.view.dispatch(tr);setSync(`已替换 ${count} 处 · 可撤销`);}})}>全部替换</button></div></div>}
      </div>,layer.current)}
    </div>
    {tableMenu&&editor.current&&<TableQuickMenu editor={editor.current} position={tableMenu} onClose={()=>setTableMenu(null)} onProperties={()=>setPopup('cell-properties')}/>}
    {lintCard&&layer.current&&createPortal(<QualityLintCard issue={lintCard.issue} left={lintCard.left} top={lintCard.top}/>,layer.current)}
    {recovery && <div className="rich-alert"><span>检测到上次未同步的编辑，可先导出备份，或恢复到当前编辑器。</span><button onClick={() => { session.current = { ...session.current!, editorId: recovery.editorId }; revision.current = recovery.revision; editor.current?.commands.setContent(recovery.document); setRecovery(null); }}>恢复编辑</button><button onClick={() => { void browser.storage.local.remove(checkpointKey); setRecovery(null); }}>忽略</button></div>}
    {pendingBoard && <div className="rich-alert board-placement" role="status"><span>画板「{pendingBoard.manifest.title}」已就绪：在正文中点击要插入的位置</span><button className="primary" onClick={() => { const e = editor.current; if (e) void placeBoardRef.current(pendingBoard, e.state.doc.content.size); }}>插入到文档末尾</button><button onClick={() => { void placeBoardRef.current(pendingBoard, 0); }}>插入到开头</button><button onClick={closeBoard}>取消放置</button></div>}
    {issue && <div className="rich-alert" role="alert"><span>{issue}</span><button onClick={exportCurrent}>导出备份</button><button title="关闭编辑提示" onClick={() => setIssue('')}><X size={14}/></button></div>}
    {bubble&&mode==='edit'&&!popup&&<div className="selection-toolbar" role="toolbar" aria-label="选区快捷工具" style={bubble}>{button('选区加粗',<Bold size={16}/>,e=>{e.chain().focus().toggleBold().run();},editor.current?.isActive('bold'))}{button('选区斜体',<Italic size={16}/>,e=>{e.chain().focus().toggleItalic().run();})}{button('选区高亮',<Highlighter size={16}/>,e=>{e.chain().focus().setMark('paint',{background:'#fef3c7'}).run();})}{button('选区链接',<Link size={16}/>,openLink)}<span>已加入 AI 上下文</span></div>}
    {draft.state==='conflict'&&<div className="rich-alert"><span>服务端与本地基线不同。先比较两个版本，再决定保留哪份内容。</span><button disabled={!!pending.current||busy} onClick={()=>setReviewing(true)}>比较并处理差异</button></div>}
    {draft.state==='uncertain'&&<div className="rich-alert"><span>上次保存结果尚未确认，编辑已暂停，请先核对服务端。</span></div>}
    {reviewing&&<ConflictReview draftId={draft.id} onClose={()=>setReviewing(false)} onResolved={async()=>{await checkpointWrites.current;await browser.storage.local.remove(checkpointKey);setRecovery(null);create(await rpc<RichReply>({method:'drafts.rich.read',draftId:draft.id}));setReviewing(false);}}/>}
    {refQuery !== null && ready && mode === 'edit' && <div ref={refPicker} className="workitem-ref-picker" role="listbox" aria-label="引用工作项候选" style={{ position: 'fixed', left: refPos.current.left, top: refPos.current.top }}><div className="workitem-ref-hint"><input ref={refInput} value={refQuery} onChange={event => setRefQuery(event.target.value)} onKeyDown={refInputKeyDown} placeholder="搜索工作项编号或标题…" aria-label="搜索工作项"/><div className="workitem-ref-meta"><span>共 {refTotal.current} 项{refHits.current.length < refTotal.current ? ` · 显示前 ${refHits.current.length}` : ''}</span><small>↑↓ 选择 · Enter 插入 · Esc 关闭</small></div></div>{refHits.current.length ? refHits.current.map((hit, index) => <button key={hit.workItemId} type="button" role="option" aria-selected={index === refIndex.current} className={index === refIndex.current ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => insertWorkItemRef(hit.workItemId)}><strong>{hit.workItemId}</strong><span>{hit.title || '未命名工作项'}</span><i>{hit.source === 'document' ? '本文档' : hit.source === 'draft' ? '本地草稿' : 'Polarion'}</i></button>) : <div className="workitem-ref-empty">没有匹配的工作项，继续输入编号或标题</div>}</div>}
    <div className="editor-body rich-canvas" data-mode={mode} onScroll={()=>{setBubble(null);setLintCard(null);}}>
      <div className="rich-paper" hidden={mode !== 'edit'}><div className="tiptap-mount" ref={surface} onMouseOver={event => { const hit = lintHover(event, lintIssues.current); if (hit) setLintCard({ issue: hit.issue, left: Math.max(12, Math.min(window.innerWidth - 332, hit.rect.left)), top: Math.max(12, Math.min(window.innerHeight - 150, hit.rect.bottom + 6)) }); }} onMouseOut={event => { if ((event.target as Element).closest('.psb-lint')) setLintCard(null); }} onClickCapture={event => {
        // 编辑器里的引用 chip 单击即打开完整阅读预览，与正文引用保持同一语义。
        const chip = (event.target as Element).closest('[data-type="workItem"][data-item-id]'); const id = chip?.getAttribute('data-item-id');
        if (!id) return; event.preventDefault(); event.stopPropagation(); props.onOpenWorkItem(id);
      }}/>{!ready && <div className={'rich-loading '+(loadError?'failed':'')} role="status">{loadError?<><h3>正文未能载入</h3><p>{loadError}</p><div><button onClick={()=>setLoadAttempt(v=>v+1)}>重新载入</button><button onClick={()=>setMode('preview')}>阅读原始正文</button></div></>:<><span className="loading-indicator"/><span>正在载入正文…</span></>}</div>}</div>
      {mode === 'preview' && <RichSurface onBoardCode={code=>void openBoard(false,undefined,code)} draft={draft} onSelect={() => {}} onContext={onContext} onWorkItem={props.onOpenWorkItem}/>}
      {mode === 'diff' && <DocumentReview draft={draft} onRead={()=>setMode('preview')}/>}
    </div>
    {tidyNote&&<div className="rich-toast" role="status" aria-live="polite">{tidyNote}</div>}
    <div className="rich-statusbar"><QualityLintStatus key={draft.id} issues={lintIssues.current} onDeepLint={() => { props.onShowAI?.(); showTidyNote('已发起 AI 深检，结果在右侧 AI 协作面板查看。'); props.onDeepLint?.(draft.workItemId, draft.title); }} disabled={!ready || busy || draft.state === 'uncertain' || draft.state === 'conflict'} onPreview={previewLintFix} onRewrite={rewriteLintIssue} onFix={applyLintFix} onJump={issue => { const e = editor.current; if (!e || issue.from === undefined || issue.to === undefined) return; e.chain().setTextSelection({ from: issue.from, to: issue.to }).scrollIntoView().run(); e.view.focus(); }}/><span>{characterCount} 字 <b>·</b> {inTable ? '表格编辑 · 右键快捷操作 · Tab 下一格' : selected ? '选区已传入助手上下文' : '手工与 AI 共用本地草稿'}</span><span>本地自动保存 <b>·</b> 服务端需明确保存</span></div>
    <footer><span className="muted">{draft.workItemId} <b>·</b> {stateLabel}{draft.variantOf?' · 变体不影响主工作项':''}</span>{['uncertain','conflict'].includes(draft.state) && <button className="secondary" disabled={busy} onClick={() => void rpc<DraftView>({ method: 'drafts.reconcile', draftId: draft.id }).then(onUpdate).catch(onError)}>核对服务端</button>}<button className="secondary" disabled={busy || !!pending.current} onClick={async () => { try { await flushRef.current(); create(await rpc<RichReply>({ method: 'drafts.rich.read', draftId: draft.id })); } catch (e) { onError(e); } }}>载入最新草稿</button><button className="primary save-polarion" disabled={busy || !ready || (draft.state !== 'dirty' && !pending.current)} onClick={save}><Check size={15}/>{busy ? '正在核对并保存…' : draft.variantOf ? '保存到变体' : '保存到 Polarion'}</button></footer>
    {variantsOpen&&!draft.variantOf&&<VariantPanel draft={draft} beforeApply={()=>flushRef.current()} prepareNativeSave={prepareNativeSave} onOpenVariant={onOpenVariant} onChanged={onVariantChanged} onError={onError} onClearError={onClearError} onClose={()=>setVariantsOpen(false)}/>}
  </section>{board&&!pendingBoard&&<BoardDialog code={board.code} draft={draft} record={board.record} generationRequest={board.generationRequest} onSaved={insertBoard} onClose={closeBoard} onContext={onContext} onToggleAI={props.onToggleAI} onShowAI={props.onShowAI}/>}</div>;
}
function FileBadge() { return <svg width="23" height="26" viewBox="0 0 23 26" fill="none"><path d="M4 1H14L21 8V23C21 24.1 20.1 25 19 25H4C2.9 25 2 24.1 2 23V3C2 1.9 2.9 1 4 1Z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 1V8H21M6 13H16M6 17H16M6 21H12" stroke="currentColor" strokeWidth="1.5"/></svg>; }

/** 写前查重面板：当前草稿与覆盖索引比对，高分条目先打开比对再决定写新条还是复用。 */
function DedupPanel({ target, selfId, getText, onOpenItem }: { target: Target; selfId: string; getText: () => string; onOpenItem: (workItemId: string) => void }) {
  const [state, setState] = useState<{ loading: boolean; error: string; matches: DedupMatch[]; indexed: number; done: boolean }>({ loading: false, error: '', matches: [], indexed: 0, done: false });
  const run = async () => {
    const text = getText();
    if (!text.trim()) { setState(current => ({ ...current, error: '正文为空，先写下需求再查重。' })); return; }
    setState(current => ({ ...current, loading: true, error: '' }));
    try {
      const result = await rpc<{ matches: DedupMatch[]; indexed: number }>({ method: 'dedup.search', target, text, limit: 5, exclude: selfId });
      setState({ loading: false, error: '', matches: result.matches, indexed: result.indexed, done: true });
    } catch (e) { setState(current => ({ ...current, loading: false, error: (e as Error).message })); }
  };
  return <div className="editor-search-fields">
    <p style={{ margin: 0, fontSize: 11, color: 'var(--ui-muted)' }}>与当前文档已索引的 {state.done ? state.indexed : '…'} 条需求比对（标题+正文关键词、信号名、参数值）。分数越高越可能重复。</p>
    {state.error && <p role="alert" style={{ margin: 0, color: 'var(--ui-danger)', fontSize: 11 }}>{state.error}</p>}
    <div className="inline-fields"><button className="primary" disabled={state.loading} onClick={() => void run()}>{state.loading ? '比对中…' : '开始查重'}</button></div>
    {state.matches.map(match => <div className="dedup-match" key={match.workItemId}>
      <button type="button" className="dedup-open" title="打开比对" onClick={() => onOpenItem(match.workItemId)}>
        <strong>{match.workItemId}</strong><span>{match.title || '(无标题)'}</span>
        <i className={match.score >= 0.5 ? 'high' : match.score >= 0.3 ? 'mid' : 'low'}>{Math.round(match.score * 100)}%</i>
      </button>
      {match.sharedTerms.length > 0 && <small>共享：{match.sharedTerms.join('、')}</small>}
    </div>)}
    {state.done && !state.matches.length && <p style={{ margin: 0, fontSize: 11, color: '#0f766e' }}>未发现相似条目（阈值 15%），可以放心写新需求。</p>}
  </div>;
}

/** 影响前置卡：改这条需求前先看牵动哪些模块、上下游与验证；含生命周期门禁与证据链导出。 */
function ImpactPanel({ target, workItemId, onOpenItem }: { target: Target; workItemId: string; onOpenItem: (workItemId: string) => void }) {
  const [view, setView] = useState<ImpactView | null>(null);
  const [gates, setGates] = useState<{ label: string; pass: boolean; detail: string }[] | null>(null);
  const [gatesNote, setGatesNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setGates(null); setGatesNote('');
    void rpc<ImpactView>({ method: 'impact.view', target, workItemId })
      .then(value => { if (!cancelled) setView(value); })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void rpc<{ items: { workItemId: string; gates: { label: string; pass: boolean; detail: string }[] }[] }>({ method: 'gates.view', target })
      .then(result => { if (!cancelled) setGates(result.items.find(item => item.workItemId === workItemId)?.gates ?? null); })
      .catch(() => { if (!cancelled) setGatesNote('门禁需要覆盖索引（模型工作台构建）'); });
    return () => { cancelled = true; };
  }, [target, workItemId]);
  if (loading) return <p role="status" style={{ margin: 0, fontSize: 11 }}>正在汇总影响面…</p>;
  if (error) return <p role="alert" style={{ margin: 0, color: 'var(--ui-danger)', fontSize: 11 }}>{error}</p>;
  if (!view) return null;
  const exportEvidence = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await rpc<{ markdown: string }>({ method: 'evidence.markdown', target, workItemId });
      const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${workItemId}-证据链.md`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError('导出失败：' + (e as Error).message); }
    finally { setExporting(false); }
  };
  const linkRow = (label: string, rows: { workItemId: string; role: string }[]) => <div className="impact-links">
    <b>{label}{rows.length ? ` ${rows.length}` : ''}</b>
    {rows.length ? rows.map(link => <button key={link.workItemId + link.role} onClick={() => onOpenItem(link.workItemId)}><strong>{link.workItemId}</strong><small>{link.role}</small></button>) : <small>无</small>}
  </div>;
  return <div className="impact-card">
    {gates && gates.length > 0 && <div className="impact-gates">
      <b>生命周期门禁{gates.every(gate => gate.pass) ? ' · 全过' : ''}</b>
      {gates.map(gate => <span key={gate.label} className={gate.pass ? 'pass' : 'fail'} title={gate.detail}>{gate.pass ? '✓' : '✗'} {gate.label}</span>)}
    </div>}
    {gatesNote && <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ui-muted)' }}>{gatesNote}</p>}
    {view.modules.length > 0 && <div className="impact-modules">
      <b>实现模块 {view.modules.length}{view.staleCount > 0 ? ` · ${view.staleCount} 个疑似过期` : ''}</b>
      {view.modules.map(module => <span key={module.rootId + module.moduleKey} className={module.stale ? 'stale' : ''} title={`${module.rootLabel} · ${module.moduleKey}${module.stale ? ' · 基准后模型侧有变化' : ''}`}>{module.moduleName}</span>)}
    </div>}
    {!view.modules.length && <p style={{ margin: 0, fontSize: 11, color: 'var(--ui-muted)' }}>该条目尚未标注实现模块（模型工作台可标注或 AI 初关联）。</p>}
    {linkRow('上游/派生', view.upstream)}
    {linkRow('下游/引用', view.downstream)}
    {linkRow('验证链接', view.verification)}
    {view.staleCount > 0 && <p role="status" style={{ margin: 0, fontSize: 11, color: '#9a5b16' }}>基准后模型侧变化过 {view.staleCount} 个关联模块：改完本条后建议做一次一致性巡检。</p>}
    <div className="inline-fields" style={{ marginTop: 4 }}>
      <button className="secondary" disabled={exporting} onClick={() => void exportEvidence()}>{exporting ? '导出中…' : '导出证据链 .md'}</button>
      <small style={{ color: 'var(--ui-muted)' }}>覆盖索引 {view.coverageAt ? new Date(view.coverageAt).toLocaleString('zh-CN') : '—'}</small>
    </div>
  </div>;
}
