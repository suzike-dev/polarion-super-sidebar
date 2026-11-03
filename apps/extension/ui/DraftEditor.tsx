import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Extension, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { DOMParser as PMParser } from '@tiptap/pm/model';
import { handlePaste as pasteTable } from '@tiptap/pm/tables';
import { Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Quote, Link, Undo2, Redo2, Table2, Plus, Minus, X, Check, Maximize2, Minimize2, ChevronDown, Subscript, Superscript, Eraser, Highlighter, Palette, Code, Columns3, Rows3, PanelTop, WrapText, Search, Download, ImagePlus } from 'lucide-react';
import { browser } from 'wxt/browser';
import { richExtensions } from '../../../packages/core/rich-schema';
import type { Draft } from '../../../packages/protocol/index';
import type { SourceNode } from '../../../packages/core/lossless-html';
import { rpc } from '../lib/client';
import { RichSurface } from './RichSurface';
import {uploadAsset} from '../lib/assets';
import {editableImage,imageResolver} from '../lib/editor-images';
import {FormatProperties} from './FormatProperties';
import {moveAxis} from '../lib/editor-format';
import {DocumentTableView} from '../lib/editor-table';
import {pasteRichSlice} from '../../../packages/core/rich-paste';
import {ConflictReview} from './ConflictReview';
import {isUserEvent} from '../lib/ui-event-trust';
import {saveError} from '../lib/save-feedback';
import {BoardDialog} from './BoardDialog';
import {DocumentReview} from './DocumentReview';
import type {BoardRecord} from '../../host/boards';
type DraftView = Draft & { nodes: SourceNode[]; version: string };
type RichReply = { editorId: string; draft: DraftView; document: JSONContent };
type Props = { draft: DraftView; onUpdate: (d: DraftView) => void; onClose: () => void; onError: (e: unknown) => void; nativeState: () => 'clean' | 'dirty' | 'unknown'; onContext: (text: string) => void; onSaved: () => Promise<void>;aiOpen:boolean;onToggleAI:()=>void;onPrepareAI:(handler:(()=>Promise<void>)|null)=>void;remoteRevision?:number };
const colors = ['#24374b', '#2563eb', '#0f766e', '#c2410c', '#b91c1c', '#7c3aed'];
const fills = ['#ffffff', '#eff6ff', '#ecfdf5', '#fff7ed', '#fef2f2', '#f5f3ff'];
const htmlEscape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
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
  const { draft, onUpdate, onClose, onError, nativeState, onContext, onSaved } = props;
  const surface = useRef<HTMLDivElement>(null); const editor = useRef<Editor | null>(null); const latest = useRef(props); latest.current = props;
  const session = useRef<RichReply | null>(null); const revision = useRef(draft.revision); const pending = useRef<JSONContent | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const inFlight = useRef<Promise<void> | null>(null);
  const checkpointWrites=useRef<Promise<void>>(Promise.resolve());
  const renderFrame=useRef(0);
  const updateToolbar=()=>{if(!renderFrame.current)renderFrame.current=requestAnimationFrame(()=>{renderFrame.current=0;setTick(v=>v+1);});};
  const [ready, setReady] = useState(false), [mode, setMode] = useState<'edit' | 'diff' | 'preview'>('edit'), [ribbon, setRibbon] = useState('text'), [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false), [sync, setSync] = useState('正在载入'), [issue, setIssue] = useState(''), [tick, setTick] = useState(0),[loadError,setLoadError]=useState(''),[loadAttempt,setLoadAttempt]=useState(0);
  const [popup, setPopup] = useState<string | null>(null), [link, setLink] = useState(''), [search, setSearch] = useState(''), [replace, setReplace] = useState('');
  const [rows, setRows] = useState(3), [cols, setCols] = useState(3), [cellWidth, setCellWidth] = useState(140), [cellHeight, setCellHeight] = useState(40), [recovery, setRecovery] = useState<any>(null);
  const [selected, setSelected] = useState(false); const inTable = !!editor.current?.isActive('table');
  const [bubble,setBubble]=useState<{left:number;top:number}|null>(null);
  const brush=useRef<JSONContent['marks']|null>(null);const [brushing,setBrushing]=useState(false),[customColor,setCustomColor]=useState('#2563eb');
  const [reviewing,setReviewing]=useState(false);
  const [board,setBoard]=useState<{record?:BoardRecord;position?:number;bookmark:any}|null>(null);
  const openBoard=async(existing=false)=>{const e=editor.current;if(!e)return;setBusy(true);e.setEditable(false,false);try{await flushRef.current();const bookmark=e.state.selection.getBookmark(),record=existing?await rpc<BoardRecord>({method:'boards.open',draftId:draft.id,src:e.getAttributes('image').src}):undefined;setBoard({record,position:existing?e.state.selection.from:undefined,bookmark});}catch(error){setIssue((error as Error).message);setBusy(false);e.setEditable(true,false);}};
  const closeBoard=()=>{setBoard(null);setBusy(false);editor.current?.setEditable(latest.current.draft.state!=='uncertain',false);};
  const insertBoard=async(record:BoardRecord)=>{const e=editor.current;if(!e||!board)throw Error('EDITOR_CLOSED');e.view.dispatch(e.state.tr.setSelection(board.bookmark.resolve(e.state.doc)));const attrs={src:'polarion-asset:'+record.previewId,assetId:record.previewId,alt:record.manifest.title,title:'可编辑工程画板 · 源文件与预览一起保存',width:760,height:null,align:'center'};if(board.position!==undefined)e.commands.updateAttributes('image',attrs);else e.commands.insertContent([{type:'paragraph',content:[{type:'image',attrs}]},{type:'paragraph'}]);await flushRef.current();await browser.storage.local.remove('board-recovery:'+draft.id+':'+(board.record?.manifest.snapshotId??'new'));closeBoard();};
  const imageFiles=useRef<HTMLInputElement>(null),imageCleanup=useRef<()=>void>(()=>{}),imageBusy=useRef(false),replaceImage=useRef(false);
  const [imageProperties,setImageProperties]=useState({alt:'',width:'',height:'',align:'left'});
  const importImages=async(files:File[])=>{
    const e=editor.current;if(!e||imageBusy.current||!files.length)return;imageBusy.current=true;setBusy(true);e.setEditable(false,false);const selection=e.state.selection.getBookmark();
    try{const nodes:JSONContent[]=[];for(const file of files){if(!/^image\/(png|jpeg|gif|webp)$/.test(file.type))throw Error('请选择 PNG、JPEG、GIF 或 WebP 图片。');setSync('正在加入图片…');const asset=await uploadAsset(file,draft.target);if(asset.extraction!=='image')throw Error('文件不是可识别的图片。');nodes.push({type:'image',attrs:{src:'polarion-asset:'+asset.id,assetId:asset.id,alt:file.name,align:'left',width:null,height:null}});}if(e.isDestroyed)return;e.view.dispatch(e.state.tr.setSelection(selection.resolve(e.state.doc)));if(replaceImage.current&&nodes.length===1)e.commands.updateAttributes('image',nodes[0]!.attrs!);else e.commands.insertContent(nodes);await flushRef.current();}
    catch(error){setIssue((error as Error).message);}finally{replaceImage.current=false;imageBusy.current=false;if(!e.isDestroyed)e.setEditable(latest.current.draft.state!=='uncertain',false);setBusy(false);}
  };
  const importImagesRef=useRef(importImages);importImagesRef.current=importImages;
  const importRichClipboard=async(html:string,files:File[])=>{
    const e=editor.current;if(!e||imageBusy.current)return;imageBusy.current=true;setBusy(true);e.setEditable(false,false);const bookmark=e.state.selection.getBookmark();
    try{
      if(html.length>35_000_000)throw Error('单次富文本粘贴过大，请分段粘贴。');const dom=new DOMParser().parseFromString(html,'text/html');const images=[...dom.querySelectorAll('img')];if(images.length>20)throw Error('单次混合粘贴最多 20 张图片，请分段粘贴。');
      // Untrusted clipboard markup is parsed as inert HTML and enters only the editor schema.
      dom.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(n=>n.remove());
      for(let index=0;index<images.length;index++){
        const img=images[index]!,src=img.getAttribute('src')??'';let file:File|undefined;
        if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)){
          if(src.length>35_000_000)throw Error('粘贴图片超过 25 MB。');const response=await fetch(src),blob=await response.blob();file=new File([blob],`粘贴图片-${index+1}.${blob.type.split('/')[1]}`,{type:blob.type});
        }else if(files.length===images.length&&files[index]?.type.startsWith('image/'))file=files[index];
        else{
          const url=new URL(src,location.href);if(url.origin!==location.origin||!/^https?:$/.test(url.protocol))throw Error('这次粘贴包含无法读取的外部图片，请同时复制图片文件或先将图片拖入编辑器；本次内容尚未插入。');
          const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('粘贴图片读取失败；本次内容尚未插入。');const blob=await response.blob();file=new File([blob],`粘贴图片-${index+1}`,{type:blob.type});
        }
        if(!file)throw Error('剪贴板图片缺失；本次内容尚未插入。');setSync(`正在导入图片 ${index+1}/${images.length}…`);const asset=await uploadAsset(file,draft.target);if(asset.extraction!=='image')throw Error('粘贴内容含有无法识别的图片；本次内容尚未插入。');
        img.setAttribute('src','polarion-asset:'+asset.id);img.setAttribute('data-polarion-asset',asset.id);img.removeAttribute('srcset');
      }
      if(e.isDestroyed)return;const slice=PMParser.fromSchema(e.schema).parseSlice(dom.body),selection=bookmark.resolve(e.state.doc);
      e.view.dispatch(pasteRichSlice(e.state,slice,selection));await flushRef.current();
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
    editor.current?.destroy();imageCleanup.current();const resolver=imageResolver(view.draft);imageCleanup.current=resolver.dispose; session.current = view; revision.current = view.draft.revision; pending.current = null;
    const e = new Editor({ element: surface.current!, extensions: [...richExtensions().map(extension=>extension.name==='image'?editableImage(resolver.resolve):extension.name==='table'?extension.configure({View:DocumentTableView}):extension), editorGuard(() => setIssue('此操作会移除特殊宏。原始对象已保留，请在其前后编辑正文。'))], content: view.document,
      editorProps: {
        attributes: { 'aria-label': '工作项富文本编辑器', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
        handlePaste(view, event) {
          const clipboard = event.clipboardData;
          if(clipboard){const html=clipboard.getData('text/html');if(/<img\b/i.test(html)){event.preventDefault();void importRichClipboardRef.current(html,Array.from(clipboard.files));return true;}}
          if(clipboard?.files.length){event.preventDefault();void importImagesRef.current(Array.from(clipboard.files));return true;} if (!clipboard || clipboard.getData('text/html')) return false;
          const text = clipboard.getData('text/plain'); if (!text.includes('\t')) return false;
          const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n'); if (lines.length > 500 || lines.some(l => l.split('\t').length > 100)) { setIssue('单次批量粘贴最多 500 行、100 列。'); return true; }
          const html = '<table><tbody>' + lines.map(l => '<tr>' + l.split('\t').map(c => '<td><p>' + htmlEscape(c) + '</p></td>').join('') + '</tr>').join('') + '</tbody></table>';
          const dom = document.createElement('div'); dom.innerHTML = html;
          const slice = PMParser.fromSchema(view.state.schema).parseSlice(dom);
          if (!pasteTable(view, event, slice)) view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        },
        handleDrop(view,event,movedSlice,moved){if(moved||!event.dataTransfer?.files.length)return false;event.preventDefault();const pos=view.posAtCoords({left:event.clientX,top:event.clientY});if(pos)editor.current?.commands.setTextSelection(pos.pos);void importImagesRef.current(Array.from(event.dataTransfer.files));return true;},
        handleKeyDown(_view,event){if(event.key==='Escape'&&brush.current){brush.current=null;setBrushing(false);return true;}return false;},
      },
      onUpdate({ editor: current }) {
        const json = current.getJSON(); pending.current = json; setSync('正在编辑'); updateToolbar();
        const checkpoint={editorId:view.editorId,revision:revision.current,document:json,draftId:draft.id};checkpointWrites.current=checkpointWrites.current.catch(()=>{}).then(()=>browser.storage.local.set({[checkpointKey]:checkpoint}));
        if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flushRef.current().catch(() => {}), 450);
      },
      onSelectionUpdate({ editor: current }) {
        updateToolbar(); const s = current.state.selection; setSelected(!s.empty);
        const node=(s as any).node;if(node?.type.name==='image')latest.current.onContext('选中图片或画板：'+(node.attrs.alt||'未命名图片')+'\n原始引用：'+node.attrs.src);
        if(!s.empty && s.$from.parent.inlineContent && s.$to.parent.inlineContent){const box=current.view.coordsAtPos(s.from);setBubble({left:Math.max(12,Math.min(window.innerWidth-330,box.left)),top:Math.max(12,box.top-46)});}else setBubble(null);
        if (!s.empty) { const text = current.state.doc.textBetween(s.from, s.to, '\n').trim(); if (text) latest.current.onContext(text.slice(0, 60000)); }
        if(!s.empty&&brush.current){const marks=brush.current;brush.current=null;setBrushing(false);const tr=current.state.tr;for(const name of ['bold','italic','underline','strike','subscript','superscript','code','paint','sourceSpan'])tr.removeMark(s.from,s.to,current.schema.marks[name]);for(const mark of marks)tr.addMark(s.from,s.to,current.schema.marks[mark.type]!.create(mark.attrs));current.view.dispatch(tr);}
      },
      onTransaction({transaction}) { if(transaction.docChanged||transaction.selectionSet||transaction.storedMarksSet)updateToolbar(); },
    });
    editor.current = e; setReady(true); setSync('已保存到本地'); setIssue(''); latest.current.onUpdate(view.draft);
  };
  useEffect(() => {
    let disposed = false;setReady(false);setLoadError('');
    void (async () => {
      try { const [view, stored] = await Promise.all([rpc<RichReply>({ method: 'drafts.rich.read', draftId: draft.id }), browser.storage.local.get(checkpointKey)]); if (disposed) return; create(view); if (stored[checkpointKey]) setRecovery(stored[checkpointKey]); }
      catch (e) { if (!disposed) {setLoadError('这条正文暂时无法载入编辑器。原始内容仍可阅读，请重试或查看阅读模式。');setIssue((e as Error).message); setSync('载入失败'); } }
    })();
    const beforeUnload = (event: BeforeUnloadEvent) => { if (pending.current || inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { disposed = true; if (timer.current) clearTimeout(timer.current); cancelAnimationFrame(renderFrame.current);renderFrame.current=0;editor.current?.destroy();imageCleanup.current(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [draft.id,loadAttempt]);
  const act = (run: (e: Editor) => void) => { if (!editor.current) return; run(editor.current); setTick(v => v + 1); };
  useEffect(()=>{if(!ready||busy||!props.remoteRevision||props.remoteRevision<=revision.current)return;if(pending.current||inFlight.current){setIssue('AI 已更新共享草稿；你尚未同步的输入仍保留，请先审阅差异。');return;}let cancelled=false;void rpc<RichReply>({method:'drafts.rich.read',draftId:draft.id}).then(view=>{if(!cancelled&&!pending.current&&!inFlight.current&&view.draft.revision>revision.current){create(view);setSync('AI 更新已载入 · 可查看修改对照');}}).catch(e=>setIssue(String(e)));return()=>{cancelled=true;};},[props.remoteRevision,ready,busy]);
  useEffect(()=>{editor.current?.setEditable(!busy&&draft.state!=='uncertain',false);},[ready,busy,draft.state]);
  const button = (title: string, icon: React.ReactNode, run: (e: Editor) => void, active = false, disabled = false) => <button type="button" className={'rt-button ' + (active ? 'active' : '')} aria-label={title} title={title} disabled={!ready || disabled || busy || draft.state==='uncertain'} onMouseDown={e => e.preventDefault()} onClick={() => act(run)}>{icon}</button>;
  const paint = (attrs: Record<string, string>) => act(e => { e.chain().focus().setMark('paint', attrs).run(); });
  const captureFormat=(e:Editor)=>{if(brush.current){brush.current=null;setBrushing(false);return;}let marks=e.state.selection.$from.marks();let found=false;e.state.doc.nodesBetween(e.state.selection.from,e.state.selection.to,node=>{if(!found&&node.isText){marks=node.marks;found=true;}});brush.current=marks.filter(m=>!['sourceText','link'].includes(m.type.name)).map(m=>({type:m.type.name,attrs:{...m.attrs,sid:null}}));setBrushing(true);setPopup(null);};
  const exportCurrent = () => { const data = JSON.stringify({ target: draft.target, workItemId: draft.workItemId, editorId: session.current?.editorId, revision: revision.current, document: editor.current?.getJSON() }, null, 2); const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = draft.workItemId + '-local-edit.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const findNext = (replaceCurrent = false) => {
    const e = editor.current; if (!e || !search) return;
    if (replaceCurrent && e.state.doc.textBetween(e.state.selection.from, e.state.selection.to) === search) e.chain().focus().insertContent({ type: 'text', text: replace || ' ' }).run();
    const matches: { from: number; to: number }[] = [];
    e.state.doc.descendants((node, pos) => { if (node.isText) { let start = 0; while ((start = node.text!.indexOf(search, start)) >= 0) { matches.push({ from: pos + start, to: pos + start + search.length }); start += search.length; } } });
    const match = matches.find(m => m.from >= e.state.selection.to) ?? matches[0]; if (match) e.chain().focus().setTextSelection(match).scrollIntoView().run(); else setIssue('没有找到匹配内容。');
  };
  const save = async (event: React.MouseEvent) => {
    if (!isUserEvent(event.nativeEvent)) {setIssue('保存没有收到有效的用户点击，请重新点击“保存到 Polarion”。');return;} setBusy(true);setIssue('');setSync('正在同步本地修改…');
    const panel = document.querySelector<HTMLElement>('.polarion-dle-MainDockPanel'); const wasInert = panel?.inert; if (panel) panel.inert = true;
    editor.current?.setEditable(false,false);
    try { await flushRef.current();setSync('正在写入并回读核对…'); const result = await rpc<DraftView>({ method: 'drafts.save', draftId: draft.id, expectedRevision: revision.current, nativeState: nativeState() }); onUpdate(result);setSync('已写入 Polarion · 回读一致');await browser.storage.local.set({['save-receipt:'+JSON.stringify(draft.target)]:{workItemId:draft.workItemId,at:Date.now()}}); await onSaved(); }
    catch (e) { onError(e);setSync('保存未完成 · 草稿已保留'); setIssue(saveError(e));try{const current=await rpc<DraftView>({method:'drafts.read',draftId:draft.id});latest.current.onUpdate(current);}catch{/* Preserve the original save failure when the Host is unavailable. */} }
    finally { if (panel) panel.inert = wasInert ?? false; editor.current?.setEditable(latest.current.draft.state!=='uncertain',false); setBusy(false); }
  };
  const stateLabel = { clean: '与基线一致', dirty: '待保存到 Polarion', conflict: '待合并', uncertain: '待回读核对' }[draft.state];
  const characterCount=useMemo(()=>editor.current?.getText().length??0,[tick,ready]);
  return <div className={'editor-layer rich-layer ' + (focus ? 'focus-mode ' : '')+(props.aiOpen?'with-ai':'')}><section className="editor rich-workbench" role="dialog" aria-modal="false" aria-label="工作项编辑工作台">
    <header className="rich-header"><div className="rich-doc-icon"><FileBadge/></div><div className="rich-heading"><span className="eyebrow">WORK ITEM / {draft.workItemId}</span><h2>{draft.title}</h2></div><div className="rich-window-actions"><button className="editor-ai-toggle" aria-pressed={props.aiOpen} onClick={props.onToggleAI}>✦ AI 协作</button><span className={'sync-status ' + (issue ? 'warning' : '')}><i/>{sync}</span><button className="icon" title={focus ? '退出专注编辑' : '专注编辑'} onClick={() => setFocus(v => !v)}>{focus ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button><button className="icon" title="关闭，保留本地草稿" disabled={busy} onClick={() => void flushRef.current().then(onClose).catch(onError)}><X size={19}/></button></div></header>
    <nav className="editor-toolbar rich-tabs"><div>{[['edit','编辑正文'],['preview','阅读预览'],['diff','修改对照']].map(([key,label]) => <button key={key} className={mode === key ? 'selected' : ''} onClick={() => void flushRef.current().then(() => setMode(key as any)).catch(onError)}>{label}</button>)}</div><span>修订 {draft.revision} <b>·</b> {stateLabel}</span></nav>
    <div className="rich-controls" hidden={mode !== 'edit'}>
      <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple ref={imageFiles} aria-label="插入正文图片文件" onChange={e=>{if(e.target.files)void importImagesRef.current(Array.from(e.target.files));e.target.value='';}}/>
      <div className="ribbon-tabs"><button className={ribbon === 'text' ? 'active' : ''} onClick={() => setRibbon('text')}>文字与段落</button><button className={ribbon === 'table' ? 'active' : ''} onClick={() => setRibbon('table')}>表格 {inTable && <i/>}</button><button className={ribbon === 'insert' ? 'active' : ''} onClick={() => setRibbon('insert')}>插入与查找</button><span>Ctrl+B / I / U · Ctrl+Z 撤销</span></div>
      <div className="ribbon" role="toolbar" aria-label="富文本工具栏" data-render={tick}>
        <div className="tool-group">{button('撤销 Ctrl+Z', <Undo2 size={16}/>, e => { e.chain().focus().undo().run(); }, false, !editor.current?.can().undo())}{button('重做 Ctrl+Y', <Redo2 size={16}/>, e => { e.chain().focus().redo().run(); }, false, !editor.current?.can().redo())}</div>
        {ribbon === 'text' && <>
          <div className="tool-group"><select aria-label="段落样式" value={editor.current?.isActive('heading') ? String(editor.current.getAttributes('heading').level) : 'p'} onChange={e => act(ed => { const v = e.target.value; v === 'p' ? ed.chain().focus().setParagraph().run() : ed.chain().focus().setHeading({ level: Number(v) as any }).run(); })}><option value="p">正文</option>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>标题 {n}</option>)}</select><select aria-label="字号" defaultValue="" onChange={e => paint({ size: e.target.value })}><option value="" disabled>字号</option>{[12,14,16,18,20,24,32].map(n => <option key={n} value={n + 'px'}>{n}</option>)}</select><select aria-label="字体" defaultValue="" onChange={e=>paint({font:e.target.value})}><option value="" disabled>字体</option><option value="Microsoft YaHei, sans-serif">微软雅黑</option><option value="SimSun, serif">宋体</option><option value="Arial, sans-serif">Arial</option><option value="Consolas, monospace">Consolas</option></select>{button('段落属性与提示色块',<span>段落属性</span>,()=>setPopup('paragraph-properties'))}</div>
          <div className="tool-group">{button('加粗 Ctrl+B', <Bold size={16}/>, e => { e.chain().focus().toggleBold().run(); }, editor.current?.isActive('bold'))}{button('斜体 Ctrl+I', <Italic size={16}/>, e => { e.chain().focus().toggleItalic().run(); }, editor.current?.isActive('italic'))}{button('下划线 Ctrl+U', <Underline size={16}/>, e => { e.chain().focus().toggleUnderline().run(); }, editor.current?.isActive('underline'))}{button('删除线', <Strikethrough size={16}/>, e => { e.chain().focus().toggleStrike().run(); }, editor.current?.isActive('strike'))}{button('下标', <Subscript size={16}/>, e => { e.chain().focus().toggleSubscript().run(); })}{button('上标', <Superscript size={16}/>, e => { e.chain().focus().toggleSuperscript().run(); })}</div>
          <div className="tool-group">{button('文字颜色', <Palette size={16}/>, () => setPopup(popup === 'color' ? null : 'color'))}{button('文字高亮', <Highlighter size={16}/>, () => setPopup(popup === 'highlight' ? null : 'highlight'))}{button('格式刷：复制当前格式后选择目标文字',<span>{brushing?'选择目标…':'格式刷'}</span>,captureFormat,brushing)}{button('清除文字格式', <Eraser size={16}/>, e => { e.chain().focus().unsetAllMarks().run(); })}</div>
          <div className="tool-group">{[['left',AlignLeft,'左对齐'],['center',AlignCenter,'居中'],['right',AlignRight,'右对齐'],['justify',AlignJustify,'两端对齐']].map(([v,Icon,label]: any) => <React.Fragment key={v}>{button(label, <Icon size={16}/>, e => { e.chain().focus().setTextAlign(v).run(); }, editor.current?.isActive({ textAlign: v }))}</React.Fragment>)}</div>
          <div className="tool-group">{button('无序列表', <List size={16}/>, e => { e.chain().focus().toggleBulletList().run(); })}{button('有序列表', <ListOrdered size={16}/>, e => { e.chain().focus().toggleOrderedList().run(); })}{button('列表增加层级',<span>缩进</span>,e=>{e.chain().focus().sinkListItem('listItem').run();},false,!editor.current?.can().sinkListItem('listItem'))}{button('列表减少层级',<span>反缩进</span>,e=>{e.chain().focus().liftListItem('listItem').run();},false,!editor.current?.can().liftListItem('listItem'))}{button('引用', <Quote size={16}/>, e => { e.chain().focus().toggleBlockquote().run(); })}<select aria-label="行距" defaultValue="1.75" onChange={e => act(ed => { ed.chain().focus().updateAttributes(ed.isActive('heading') ? 'heading' : 'paragraph', { lineHeight: e.target.value }).run(); })}>{['1','1.5','1.75','2'].map(n => <option key={n} value={n}>{n} 倍行距</option>)}</select></div>
        </>}
        {ribbon === 'table' && <>
          <div className="tool-group">{button('插入表格', <><Table2 size={16}/><span>插入</span></>, () => setPopup(popup === 'table' ? null : 'table'))}</div>
          <div className="tool-group labeled"><small>行</small>{button('上方插入行', <><Rows3 size={15}/><Plus size={11}/><span>上</span></>, e => { e.chain().focus().addRowBefore().run(); }, false, !inTable)}{button('下方插入行', <><Rows3 size={15}/><Plus size={11}/><span>下</span></>, e => { e.chain().focus().addRowAfter().run(); }, false, !inTable)}{button('删除当前行', <><Rows3 size={15}/><Minus size={11}/></>, e => { e.chain().focus().deleteRow().run(); }, false, !inTable)}</div>
          <div className="tool-group labeled"><small>列</small>{button('左侧插入列', <><Columns3 size={15}/><Plus size={11}/><span>左</span></>, e => { e.chain().focus().addColumnBefore().run(); }, false, !inTable)}{button('右侧插入列', <><Columns3 size={15}/><Plus size={11}/><span>右</span></>, e => { e.chain().focus().addColumnAfter().run(); }, false, !inTable)}{button('删除当前列', <><Columns3 size={15}/><Minus size={11}/></>, e => { e.chain().focus().deleteColumn().run(); }, false, !inTable)}</div>
          <div className="tool-group">{button('合并选中单元格', <span>合并</span>, e => { e.chain().focus().mergeCells().run(); }, false, !editor.current?.can().mergeCells())}{button('拆分单元格', <span>拆分</span>, e => { e.chain().focus().splitCell().run(); }, false, !editor.current?.can().splitCell())}{button('切换表头行', <PanelTop size={16}/>, e => { e.chain().focus().toggleHeaderRow().run(); }, false, !inTable)}</div>
          <div className="tool-group">{button('单元格底色', <Palette size={16}/>, () => setPopup(popup === 'cell-color' ? null : 'cell-color'), false, !inTable)}{button('单元格尺寸与对齐', <WrapText size={16}/>, () => setPopup(popup === 'cell-size' ? null : 'cell-size'), false, !inTable)}{button('删除表格', <span>删表</span>, e => { e.chain().focus().deleteTable().run(); }, false, !inTable)}</div>
          <div className="tool-group">{button('表格属性',<span>表格属性</span>,()=>setPopup('table-properties'),false,!inTable)}{button('单元格属性',<span>单元格属性</span>,()=>setPopup('cell-properties'),false,!inTable)}</div>
          <div className="tool-group">{([['row',-1,'行上移'],['row',1,'行下移'],['column',-1,'列左移'],['column',1,'列右移']] as const).map(([axis,direction,label])=><React.Fragment key={label}>{button(label,<span>{label}</span>,e=>{if(!moveAxis(e,axis,direction))setIssue('已到表格边界，或当前合并区域不支持此次移动。');},false,!inTable)}</React.Fragment>)}</div>
        </>}
        {ribbon === 'insert' && <>
          <div className="tool-group">{button('插入可编辑画板',<span>◇ 画板</span>,()=>void openBoard())}{button('继续编辑选中画板',<span>编辑画板</span>,()=>void openBoard(true),false,!editor.current?.isActive('image'))}</div>
          <div className="tool-group">{button('插入图片',<><ImagePlus size={16}/><span>图片</span></>,()=>{replaceImage.current=false;imageFiles.current?.click();})}{button('图片属性',<span>图片属性</span>,e=>{const a=e.getAttributes('image');setImageProperties({alt:a.alt??'',width:a.width?String(a.width):'',height:a.height?String(a.height):'',align:a.align??'left'});setPopup('image');},false,!editor.current?.isActive('image'))}</div>
          <div className="tool-group">{button('插入表格', <><Table2 size={16}/><span>表格</span></>, () => setPopup('table'))}{button('插入或编辑链接', <><Link size={16}/><span>链接</span></>, e => { setLink(e.getAttributes('link').href ?? ''); setPopup('link'); })}{button('插入分隔线', <><Minus size={16}/><span>分隔线</span></>, e => { e.chain().focus().setHorizontalRule().run(); })}{button('行内代码', <><Code size={16}/><span>代码</span></>, e => { e.chain().focus().toggleCode().run(); })}</div>
          <div className="tool-group">{button('查找与替换', <><Search size={16}/><span>查找</span></>, () => setPopup(popup === 'search' ? null : 'search'))}{button('导出当前编辑备份', <><Download size={16}/><span>备份</span></>, exportCurrent)}</div>
          <div className="tool-group">{button('代码块',<><Code size={16}/><span>代码块</span></>,e=>{e.chain().focus().toggleCodeBlock().run();},editor.current?.isActive('codeBlock'))}{editor.current?.isActive('codeBlock')&&<select aria-label="代码语言" value={editor.current.getAttributes('codeBlock').language??''} onChange={event=>act(e=>{e.chain().focus().updateAttributes('codeBlock',{language:event.target.value||null}).run();})}>{[['','纯文本'],['c','C'],['cpp','C++'],['matlab','MATLAB'],['python','Python'],['json','JSON']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>}</div>
        </>}
      </div>
      {popup && <div className="rich-popover"><div className="popover-title"><strong>{{ color:'文字颜色', highlight:'文字高亮', 'cell-color':'单元格底色', table:'插入表格', link:'编辑链接', 'cell-size':'单元格设置', search:'查找与替换',image:'图片属性','paragraph-properties':'段落属性','table-properties':'表格属性','cell-properties':'单元格属性' }[popup]}</strong><button className="icon" title="关闭工具面板" onClick={() => setPopup(null)}><X size={14}/></button></div>
        {popup.endsWith('-properties')&&editor.current&&<FormatProperties key={popup} editor={editor.current} scope={popup.split('-')[0] as 'paragraph'|'table'|'cell'} onDone={()=>setPopup(null)}/>}
        {popup==='image'&&<><div className="inline-fields"><label>说明<input aria-label="图片说明" value={imageProperties.alt} onChange={e=>setImageProperties(p=>({...p,alt:e.target.value}))}/></label><label>宽度<input aria-label="图片宽度" type="number" min="1" max="9999" placeholder="自动" value={imageProperties.width} onChange={e=>setImageProperties(p=>({...p,width:e.target.value}))}/></label><label>高度<input aria-label="图片高度" type="number" min="1" max="9999" placeholder="保持比例" value={imageProperties.height} onChange={e=>setImageProperties(p=>({...p,height:e.target.value}))}/></label><select aria-label="图片对齐" value={imageProperties.align} onChange={e=>setImageProperties(p=>({...p,align:e.target.value}))}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></div><div className="inline-fields"><button className="primary" onClick={()=>{act(e=>{e.chain().focus().updateAttributes('image',{alt:imageProperties.alt,width:imageProperties.width?Number(imageProperties.width):null,height:imageProperties.height?Number(imageProperties.height):null,align:imageProperties.align}).run();});setPopup(null);}}>应用图片属性</button><button className="secondary" onClick={()=>{replaceImage.current=true;imageFiles.current?.click();}}>替换图片</button><button className="secondary" onClick={()=>{act(e=>{e.chain().focus().deleteSelection().run();});setPopup(null);}}>删除图片</button></div><p>只填写宽度时保持原图比例。图片随正文保存到当前工作项附件。</p></>}
        {['color','highlight','cell-color'].includes(popup) && <div className="swatches">{(popup === 'color' ? colors : fills).map(color => <button key={color} aria-label={color} title={color} style={{ backgroundColor: color }} onMouseDown={e => e.preventDefault()} onClick={() => { if (popup === 'cell-color') act(e => { e.chain().focus().setCellAttribute('fill', color).run(); }); else paint({ [popup === 'color' ? 'color' : 'background']: color }); setPopup(null); }}/>)}</div>}
        {['color','highlight','cell-color'].includes(popup)&&<div className="inline-fields"><input type="color" aria-label="自定义颜色选择" value={/^#[a-f0-9]{6}$/i.test(customColor)?customColor:'#2563eb'} onChange={e=>setCustomColor(e.target.value)}/><input aria-label="自定义颜色值" value={customColor} placeholder="#2563eb" maxLength={7} onChange={e=>setCustomColor(e.target.value)}/><button className="primary" disabled={!/^#[a-f0-9]{6}$/i.test(customColor)} onClick={()=>{if(popup==='cell-color')act(e=>{e.chain().focus().setCellAttribute('fill',customColor).run();});else paint({[popup==='color'?'color':'background']:customColor});setPopup(null);}}>应用颜色</button></div>}
        {popup === 'table' && <><div className="table-grid">{Array.from({ length: 48 }, (_,i) => <button key={i} aria-label={`插入 ${Math.floor(i / 8) + 1} 行 ${i % 8 + 1} 列表格`} className={Math.floor(i / 8) < rows && i % 8 < cols ? 'selected' : ''} onMouseEnter={() => { setRows(Math.floor(i / 8) + 1); setCols(i % 8 + 1); }} onMouseDown={e => e.preventDefault()} onClick={() => { act(e => { e.chain().focus().insertTable({ rows: Math.floor(i / 8) + 1, cols: i % 8 + 1, withHeaderRow: true }).run(); }); setPopup(null); }}/>)}</div><div className="inline-fields"><label>行<input type="number" min="1" max="100" value={rows} onChange={e => setRows(Math.max(1, Math.min(100, Number(e.target.value))))}/></label><label>列<input type="number" min="1" max="30" value={cols} onChange={e => setCols(Math.max(1, Math.min(30, Number(e.target.value))))}/></label><button className="primary" onClick={() => { act(e => { e.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(); }); setPopup(null); }}>插入</button></div><p>支持嵌套表格 · 首行默认为表头</p></>}
        {popup === 'link' && <div className="inline-fields"><input aria-label="链接地址" placeholder="https://… 或 /polarion/…" value={link} onChange={e => setLink(e.target.value)}/><button className="primary" onClick={() => { if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(link)) { setIssue('请输入有效的网页或 Polarion 链接。'); return; } act(e => { e.chain().focus().extendMarkRange('link').setLink({ href: link }).run(); }); setPopup(null); }}>应用</button><button className="secondary" onClick={() => { act(e => { e.chain().focus().unsetLink().run(); }); setPopup(null); }}>移除</button></div>}
        {popup === 'cell-size' && <><div className="inline-fields"><label>列宽<input type="number" min="40" max="1200" value={cellWidth} onChange={e => setCellWidth(Number(e.target.value))}/></label><label>行高<input type="number" min="24" max="600" value={cellHeight} onChange={e => setCellHeight(Number(e.target.value))}/></label><button className="primary" onClick={() => { act(e => { e.chain().focus().setCellAttribute('colwidth', [Math.max(40, Math.min(1200, cellWidth))]).setCellAttribute('cellHeight', Math.max(24, Math.min(600, cellHeight))).run(); }); setPopup(null); }}>应用 px</button></div><div className="inline-fields">{[['top','顶部'],['middle','居中'],['bottom','底部']].map(([v,label]) => <button className="secondary" key={v} onMouseDown={e => e.preventDefault()} onClick={() => act(e => { e.chain().focus().setCellAttribute('valign', v).run(); })}>{label}对齐</button>)}</div></>}
        {popup === 'search' && <div className="inline-fields"><input aria-label="查找文字" placeholder="查找" value={search} onChange={e => setSearch(e.target.value)}/><input aria-label="替换文字" placeholder="替换为" value={replace} onChange={e => setReplace(e.target.value)}/><button className="secondary" onClick={() => findNext()}>下一个</button><button className="primary" onClick={() => findNext(true)}>替换当前</button></div>}
      </div>}
    </div>
    {recovery && <div className="rich-alert"><span>检测到上次未同步的编辑，可先导出备份，或恢复到当前编辑器。</span><button onClick={() => { session.current = { ...session.current!, editorId: recovery.editorId }; revision.current = recovery.revision; editor.current?.commands.setContent(recovery.document); setRecovery(null); }}>恢复编辑</button><button onClick={() => { void browser.storage.local.remove(checkpointKey); setRecovery(null); }}>忽略</button></div>}
    {issue && <div className="rich-alert" role="alert"><span>{issue}</span><button onClick={exportCurrent}>导出备份</button><button title="关闭编辑提示" onClick={() => setIssue('')}><X size={14}/></button></div>}
    {bubble&&mode==='edit'&&!popup&&<div className="selection-toolbar" role="toolbar" aria-label="选区快捷工具" style={bubble}>{button('选区加粗',<Bold size={16}/>,e=>{e.chain().focus().toggleBold().run();},editor.current?.isActive('bold'))}{button('选区斜体',<Italic size={16}/>,e=>{e.chain().focus().toggleItalic().run();})}{button('选区高亮',<Highlighter size={16}/>,e=>{e.chain().focus().setMark('paint',{background:'#fef3c7'}).run();})}{button('选区链接',<Link size={16}/>,e=>{setLink(e.getAttributes('link').href??'');setPopup('link');})}<span>已加入 AI 上下文</span></div>}
    {draft.state==='conflict'&&<div className="rich-alert"><span>服务端与本地基线不同。先比较两个版本，再决定保留哪份内容。</span><button disabled={!!pending.current||busy} onClick={()=>setReviewing(true)}>比较并处理差异</button></div>}
    {draft.state==='uncertain'&&<div className="rich-alert"><span>上次保存结果尚未确认，编辑已暂停，请先核对服务端。</span></div>}
    {reviewing&&<ConflictReview draftId={draft.id} onClose={()=>setReviewing(false)} onResolved={async()=>{await checkpointWrites.current;await browser.storage.local.remove(checkpointKey);setRecovery(null);create(await rpc<RichReply>({method:'drafts.rich.read',draftId:draft.id}));setReviewing(false);}}/>}
    <div className="editor-body rich-canvas" data-mode={mode} onScroll={()=>setBubble(null)}>
      <div className="rich-paper" hidden={mode !== 'edit'}><div className="tiptap-mount" ref={surface}/>{!ready && <div className={'rich-loading '+(loadError?'failed':'')} role="status">{loadError?<><h3>正文未能载入</h3><p>{loadError}</p><div><button onClick={()=>setLoadAttempt(v=>v+1)}>重新载入</button><button onClick={()=>setMode('preview')}>阅读原始正文</button></div></>:<><span className="loading-indicator"/><span>正在载入正文…</span></>}</div>}</div>
      {mode === 'preview' && <RichSurface draft={draft} onSelect={() => {}} onContext={onContext}/>}
      {mode === 'diff' && <DocumentReview draft={draft} onRead={()=>setMode('preview')}/>}
    </div>
    <div className="rich-statusbar"><span>{characterCount} 字 <b>·</b> {inTable ? '表格编辑 · Tab 下一格 · Shift+单击选择多格' : selected ? '选区已传入助手上下文' : '手工与 AI 共用本地草稿'}</span><span>本地自动保存 <b>·</b> 服务端需明确保存</span></div>
    <footer><span className="muted">{draft.workItemId} <b>·</b> {stateLabel}</span>{['uncertain','conflict'].includes(draft.state) && <button className="secondary" disabled={busy} onClick={() => void rpc<DraftView>({ method: 'drafts.reconcile', draftId: draft.id }).then(onUpdate).catch(onError)}>核对服务端</button>}<button className="secondary" disabled={busy || !!pending.current} onClick={async () => { try { await flushRef.current(); create(await rpc<RichReply>({ method: 'drafts.rich.read', draftId: draft.id })); } catch (e) { onError(e); } }}>载入最新草稿</button><button className="primary save-polarion" disabled={busy || !ready || (draft.state !== 'dirty' && !pending.current)} onClick={save}><Check size={15}/>{busy ? '正在核对并保存…' : '保存到 Polarion'}</button></footer>
  </section>{board&&<BoardDialog draft={draft} record={board.record} onSaved={insertBoard} onClose={closeBoard} onContext={onContext} onToggleAI={props.onToggleAI}/>}</div>;
}
function FileBadge() { return <svg width="23" height="26" viewBox="0 0 23 26" fill="none"><path d="M4 1H14L21 8V23C21 24.1 20.1 25 19 25H4C2.9 25 2 24.1 2 23V3C2 1.9 2.9 1 4 1Z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 1V8H21M6 13H16M6 17H16M6 21H12" stroke="currentColor" strokeWidth="1.5"/></svg>; }
