import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PenTool,MessageSquare,LibraryBig} from 'lucide-react';
import {browser} from 'wxt/browser';
import type {ExcalidrawImperativeAPI,LibraryItems} from '@excalidraw/excalidraw/types';
import {BoardLibraryStorage,BOARD_LIBRARY_LOCK,supplementBoardLibrary} from '../../lib/board-library-storage';
import {rpc} from '../../lib/client';
import {uploadAsset,assetBlob} from '../../lib/assets';
import type {Asset,Target} from '../../../../packages/protocol/index';
import {applyBoardPatches,boardSceneSignature} from '../../../../packages/core/board-changes';
import {boardPreviewDimensions,checkBoardCanvas} from '../../../../packages/core/board-generation';
import type {BoardProposal,BoardGenerationRequest,BoardGenerationProposal} from '../../../host/boards';
import type {BoardRecord} from '../../../host/boards';
import {validateBoardSource} from '../../../../packages/core/board-contract';
import '@excalidraw/excalidraw/index.css';
import './style.css';
// All fonts are packaged with the extension; the editor never needs its public CDN.
(window as any).EXCALIDRAW_ASSET_PATH=browser.runtime.getURL('/')+'board-assets/';
const engine=await import('@excalidraw/excalidraw');
const {Excalidraw,MainMenu,exportToBlob,serializeAsJSON,hashElementsVersion,restoreElements,CaptureUpdateAction}=engine;
const channel=location.hash.slice(1),parentOrigin='https://polarion.pufafen.com';
const send=(type:string,data:object={})=>parent.postMessage({type,channel,...data},parentOrigin);
// Native library previews are already rendered in batches by Excalidraw. The artwork
// module is loaded only by the board, never by the surrounding document workbench.
const builtinLibrary=()=>import('../../lib/board-library-items').then(module=>module.createBoardLibraryItems());
type Input={draftId:string;target:Target;record?:BoardRecord;generationRequest?:BoardGenerationRequest};
function publishGenerationContext(request:BoardGenerationRequest,title:string,restored=false){
  send('context',{text:'BOARD_GENERATION_CONTEXT\n'+JSON.stringify({draftId:request.draftId,requestId:request.requestId,localBoardId:request.localBoardId,baselineSignature:request.baselineSignature})+'\n当前画板「'+title+'」尚未插入正文，用户可用一句描述生成完整可编辑图。必须先 read_board_generation_context，再调用 propose_board_generation 提交整图草案；先预览，用户明确应用后才能进入画板。请直接根据用户描述生成节点与连线，不要求用户先手工画图或先插入正文。'+(restored?' 本次恢复原生成请求，现有待审草案仍保留；若工具报告请求已过期或基线变化，请提示用户重新点击「AI 生成整图」。':'')});
}
function scenePadding(elements:readonly any[]){const result=checkBoardCanvas(elements as any);if(!result.ok)throw Error('图形超出画幅或与标题重叠，请移回画幅内后再操作。'+result.errors.join('；'));return result.canvas?0:24;}
function DiagramPreview({src,title,onClose}:{src:string;title:string;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),viewport=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement>(null),[zoom,setZoom]=useState(1);
  const fit=()=>{const box=viewport.current,img=image.current;if(box&&img?.naturalWidth)setZoom(Math.min(1,(box.clientWidth-48)/img.naturalWidth,(box.clientHeight-48)/img.naturalHeight));};
  useEffect(()=>{const modal=dialog.current,trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;modal?.showModal();return()=>{modal?.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  return <dialog ref={dialog} className="diagram-preview-dialog" aria-label={'放大预览：'+title} onCancel={e=>{e.preventDefault();onClose();}}><header><strong>{title}</strong><div><button onClick={()=>setZoom(v=>Math.max(.1,v-.25))} aria-label="缩小预览">−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(v=>Math.min(4,v+.25))} aria-label="放大预览">＋</button><button onClick={fit}>适合窗口</button><button onClick={()=>setZoom(1)}>原始尺寸</button><button autoFocus onClick={onClose}>关闭预览</button></div></header><div className="diagram-preview-scroll" ref={viewport}><img ref={image} src={src} alt={title} onLoad={fit} style={{width:image.current?.naturalWidth?image.current.naturalWidth*zoom:undefined,maxWidth:'none'}}/></div><p>可放大后滚动检查文字与连线。此草案尚未应用到画板。</p></dialog>;
}
function GenerationCard({proposal,busy,onDecide}:{proposal:BoardGenerationProposal;busy:boolean;onDecide:(proposal:BoardGenerationProposal,action:'apply'|'reject')=>Promise<void>}){
  const [preview,setPreview]=useState(''),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[expanded,setExpanded]=useState(false);
  useEffect(()=>{let cancelled=false,url='';setError('');setPreview('');void (async()=>{try{const elements=restoreElements(proposal.elements as any,null,{refreshDimensions:true,repairBindings:true});const blob=await exportToBlob({elements,appState:{viewBackgroundColor:'#ffffff',exportBackground:true,exportWithDarkMode:false},files:{},mimeType:'image/png',exportPadding:scenePadding(elements),getDimensions:(w:number,h:number)=>{const scale=Math.min(1.5,1400/Math.max(w,h));return{width:w*scale,height:h*scale,scale};}});if(cancelled)return;url=URL.createObjectURL(blob);setPreview(url);}catch(e){if(!cancelled)setError('预览生成失败：'+(e as Error).message);}})();return()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};},[proposal.proposalId,attempt]);
  return <article className="generation-card"><div className="generation-image">{preview?<button className="generation-preview-trigger" onClick={()=>setExpanded(true)} title="放大检查文字与连线"><img src={preview} alt={'待应用整图草案：'+proposal.diagram.title}/><span>点击放大预览</span></button>:<span role="status">{error||'正在生成草案预览…'}{error&&<button onClick={()=>setAttempt(v=>v+1)}>重试预览</button>}</span>}</div><div className="generation-detail"><strong>{proposal.diagram.title}</strong><p>{proposal.summary.text}</p><small>{proposal.summary.nodes} 个节点 · {proposal.summary.edges} 条连线 · 可继续编辑</small><small>应用将替换请求时的整张画板；尚未插入正文或保存</small><div><button disabled={busy} onClick={()=>void onDecide(proposal,'reject')}>拒绝草案</button><button className="primary" disabled={busy||!preview} onClick={()=>void onDecide(proposal,'apply')}>应用整图草案</button></div></div>{expanded&&preview&&<DiagramPreview src={preview} title={proposal.diagram.title} onClose={()=>setExpanded(false)}/>}</article>;
}
function Board(){
  const [input,setInput]=useState<Input|null>(null),[initial,setInitial]=useState<any>(null),[title,setTitle]=useState('工程流程图'),[status,setStatus]=useState('正在准备画板'),[issue,setIssue]=useState(''),[busy,setBusy]=useState(false);
  const [fitRequest,setFitRequest]=useState(0),baseline=useRef('');
  const [proposals,setProposals]=useState<BoardProposal[]>([]),[aiPreview,setAiPreview]=useState('');
  const [generation,setGeneration]=useState<BoardGenerationRequest|null>(null),[generated,setGenerated]=useState<BoardGenerationProposal[]>([]),[generationRestored,setGenerationRestored]=useState(false);
  const requestRef=useRef<BoardGenerationRequest|null>(null),localBoardId=useRef<string>(crypto.randomUUID());
  const library=useRef<BoardLibraryStorage|null>(null);
  if(!library.current)library.current=new BoardLibraryStorage(browser.storage.local,async task=>await navigator.locks.request(BOARD_LIBRARY_LOCK,task));
  const saveLibrary=(items:LibraryItems)=>{void library.current!.save(items).catch(()=>setIssue('素材库未能保存到本地，请保持画板打开并重试。'));};
  const supplementLibrary=async()=>{if(!api.current)return;try{if(!library.current!.isReady)throw Error('本地素材库尚未载入，请重新打开画板后重试。');const builtins=await builtinLibrary();await api.current.updateLibrary({libraryItems:current=>supplementBoardLibrary(current,builtins),openLibraryMenu:true});await library.current!.flush();setStatus('已补齐内置素材，保留现有素材与修改');}catch(e){setIssue('补齐素材失败：'+(e as Error).message);}};
  useEffect(()=>()=>{if(aiPreview)URL.revokeObjectURL(aiPreview);},[aiPreview]);
  useEffect(()=>{if(!input?.record)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const rows=await rpc<BoardProposal[]>({method:'boards.proposals',draftId:input.draftId,objectId:input.record!.manifest.objectId,snapshotId:input.record!.manifest.snapshotId});if(!stopped)setProposals(old=>JSON.stringify(old)===JSON.stringify(rows)?old:rows);}catch(e){if(!stopped)setIssue((e as Error).message);}finally{if(!stopped)timer=setTimeout(poll,1500);}};void poll();return()=>{stopped=true;clearTimeout(timer);};},[input]);
  useEffect(()=>{if(!input||!generation)return;let stopped=false;let pollTimer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const rows=await rpc<BoardGenerationProposal[]>({method:'boards.generation.proposals',draftId:input.draftId,requestId:generation.requestId});if(!stopped)setGenerated(old=>JSON.stringify(old)===JSON.stringify(rows)?old:rows);}catch(e){if(!stopped)setIssue((e as Error).message);}finally{if(!stopped)pollTimer=setTimeout(poll,1500);}};void poll();return()=>{stopped=true;clearTimeout(pollTimer);};},[input,generation]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const api=useRef<ExcalidrawImperativeAPI|null>(null),data=useRef<{elements:readonly any[];appState:any;files:any}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),version=useRef(''),key=useRef(''),write=useRef(Promise.resolve()),lastContext=useRef(''),name=useRef(title);name.current=title;
  useEffect(()=>{let frame=0,attempts=0,previous='',stable=0;const fit=()=>{const instance=api.current,state=instance?.getAppState(),elements=instance?.getSceneElements();if(instance&&state&&state.width>100&&state.height>100&&elements?.length){const dimensions=state.width+':'+state.height;stable=dimensions===previous?stable+1:0;previous=dimensions;if(stable>=2){instance.scrollToContent(elements,{fitToContent:true,viewportZoomFactor:checkBoardCanvas(elements as any).canvas ? .9 : .65,animate:false});return;}}if(++attempts<120)frame=requestAnimationFrame(fit);};frame=requestAnimationFrame(fit);return()=>cancelAnimationFrame(frame);},[initial,fitRequest]);
  const persist=()=>{if(!data.current||!key.current)return write.current;const scene=serializeAsJSON(data.current.elements,data.current.appState,data.current.files,'local'),checkpoint={scene,title:name.current,localBoardId:localBoardId.current,generation:requestRef.current,at:Date.now()};write.current=write.current.catch(()=>{}).then(()=>browser.storage.local.set({[key.current]:checkpoint}));return write.current;};
  useEffect(()=>{
    let loaded=false;
    const listener=async(event:MessageEvent)=>{
      if(event.source!==parent||event.origin!==parentOrigin||event.data?.channel!==channel||event.data?.type!=='load'||loaded)return;
      loaded=true;
      try{
        const value=event.data as Input;setInput(value);key.current='board-recovery:'+value.draftId+':'+(value.record?.manifest.snapshotId??(value.generationRequest?'generated:'+value.generationRequest.localBoardId:'new'));
        const stored=(await browser.storage.local.get(key.current))[key.current] as any;let scene:any,recoveredRequest:BoardGenerationRequest|null=null;
        if(value.record){const originalAsset=await rpc<Asset>({method:'assets.metadata',assetId:value.record.sourceId});const original=validateBoardSource(await(await assetBlob(originalAsset)).text());baseline.current=boardSceneSignature(restoreElements(original.elements,null,{refreshDimensions:false}) as any);}
        if(stored){
          scene=validateBoardSource(stored.scene);
          if(typeof stored.localBoardId==='string'&&/^[a-f0-9-]{36}$/i.test(stored.localBoardId))localBoardId.current=stored.localBoardId;
          if(!value.record&&stored.generation?.localBoardId===localBoardId.current&&stored.generation?.draftId===value.draftId){
            recoveredRequest=stored.generation;requestRef.current=recoveredRequest;setGeneration(recoveredRequest);setGenerationRestored(true);
          }
          setTitle(stored.title);setStatus(recoveredRequest?'已恢复画板和原生成请求；若请求过期，请重新生成':'已恢复上次未插入的画板');
        }else if(value.record){
          const asset=await rpc<Asset>({method:'assets.metadata',assetId:value.record.sourceId});scene=validateBoardSource(await(await assetBlob(asset)).text());setTitle(value.record.manifest.title);setStatus('已读取可编辑源文件');
        }else{scene={elements:[],files:{},appState:{}};if(value.generationRequest){localBoardId.current=value.generationRequest.localBoardId;requestRef.current=value.generationRequest;setGeneration(value.generationRequest);setStatus('需求配图草案 · 请预览后应用');}else setStatus('新画板 · 本地自动保存');}
        let libraryItems:LibraryItems|undefined;
        try{libraryItems=await library.current!.load(await builtinLibrary());}catch(e){setIssue('素材库未载入：'+(e as Error).message);}
        setInitial({...scene,libraryItems,scrollToContent:true,appState:{...scene.appState,viewBackgroundColor:'#ffffff',currentItemRoughness:0,currentItemFontFamily:2,currentItemStrokeColor:'#334640',currentItemBackgroundColor:'#f5f6f5',currentItemFillStyle:'solid',currentItemStrokeWidth:2}});
        // Republish the original identity only after the stored scene has been read successfully.
        // Creating a replacement request here would invalidate the user's pending proposals.
        if(recoveredRequest)publishGenerationContext(recoveredRequest,stored.title,true);else if(value.generationRequest)publishGenerationContext(value.generationRequest,'工程流程图',true);
      }catch(e){setIssue((e as Error).message);}
    };
    window.addEventListener('message',listener);send('ready');return()=>window.removeEventListener('message',listener);
  },[]);
  const decide=async(proposal:BoardProposal,action:'apply'|'reject')=>{
    if(!input?.record||!api.current)return;setBusy(true);setIssue('');
    try{
      let restored:ReturnType<typeof restoreElements>|undefined;
      if(action==='apply'){
        if(proposal.objectId!==input.record.manifest.objectId||proposal.snapshotId!==input.record.manifest.snapshotId||proposal.sourceHash!==input.record.manifest.source.sha256)throw Error('画板版本已变化，请重新读取并生成提案。');
        const current=api.current.getSceneElements();
        if(boardSceneSignature(current as any)!==baseline.current)throw Error('画板已有手工修改或已应用其他提案；请先插入正文草稿，再重新打开画板让 AI 读取新版本。');
        const result=applyBoardPatches(current as any,proposal.patches);
        restored=restoreElements(result.elements as any,current,{refreshDimensions:true,repairBindings:false});
      }
      await rpc({method:'boards.decide',draftId:input.draftId,proposalId:proposal.proposalId,action});
      if(restored){
        api.current.updateScene({elements:restored,captureUpdate:CaptureUpdateAction.IMMEDIATELY});
        data.current={elements:restored,appState:api.current.getAppState(),files:api.current.getFiles()};await persist();
        const blob=await exportToBlob({elements:restored,appState:{...api.current.getAppState(),exportBackground:true,exportWithDarkMode:false},files:api.current.getFiles(),mimeType:'image/png',exportPadding:scenePadding(restored),getDimensions:boardPreviewDimensions});
        setAiPreview(URL.createObjectURL(blob));setStatus('AI 变更已应用到画板；请插入正文草稿');
      }else setStatus('已拒绝 AI 提案，画板保持原样');
      setProposals(rows=>rows.filter(p=>p.proposalId!==proposal.proposalId));
    }catch(e){setIssue((e as Error).message);}finally{setBusy(false);}
  };
  const sceneSignature=async()=>{
    if(!api.current)throw Error('画板尚未准备好');
    const text=JSON.stringify({title:name.current,elements:boardSceneSignature(api.current.getSceneElements() as any)});
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  };
  const openAI=async()=>{
    if(!input||!api.current)return;
    if(input.record){send('toggle-ai');return;}
    setBusy(true);setIssue('');
    try{
      const signature=await sceneSignature();
      // A deliberate generation request refreshes both the local scene and the host draft revision.
      const request=await rpc<BoardGenerationRequest>({method:'boards.generation.begin',draftId:input.draftId,localBoardId:localBoardId.current,baselineSignature:signature});
      requestRef.current=request;setGeneration(request);setGenerationRestored(false);setGenerated([]);await persist();
      publishGenerationContext(request,name.current);
      send('show-ai');setStatus('在 AI 对话中描述要画的图，草案将在此处预览');
    }catch(e){setIssue((e as Error).message);}finally{setBusy(false);}
  };
  const decideGeneration=async(proposal:BoardGenerationProposal,action:'apply'|'reject')=>{
    if(!input||!api.current)return;setBusy(true);setIssue('');
    try{
      const signature=await sceneSignature();
      if(action==='apply'&&(proposal.requestId!==requestRef.current?.requestId||proposal.localBoardId!==localBoardId.current||proposal.baselineSignature!==signature))throw Error('画板已有手工修改，保留了当前内容。请拒绝旧草案后，重新点击 AI 协作生成。');
      // Prepare and export before acknowledging application, so a render error leaves the proposal reviewable.
      const elements=action==='apply'?restoreElements(proposal.elements as any,null,{refreshDimensions:true,repairBindings:true}):null;
      const preview=elements?await exportToBlob({elements,appState:{viewBackgroundColor:'#ffffff',exportBackground:true,exportWithDarkMode:false},files:{},mimeType:'image/png',exportPadding:scenePadding(elements),getDimensions:boardPreviewDimensions}):null;
      if(action==='apply'&&await sceneSignature()!==signature)throw Error('画板在预览期间发生变化，请重新生成草案。');
      await rpc({method:'boards.generation.decide',draftId:input.draftId,proposalId:proposal.proposalId,action,baselineSignature:signature});
      if(elements){
        if(await sceneSignature()!==signature){requestRef.current=null;setGeneration(null);setGenerated([]);await persist();throw Error('画板在应用期间发生变化，已保留手工内容。请重新点击 AI 生成整图。');}
        api.current.updateScene({elements,appState:{selectedElementIds:{},viewBackgroundColor:'#ffffff'},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
        data.current={elements,appState:api.current.getAppState(),files:api.current.getFiles()};
        name.current=proposal.diagram.title;setTitle(proposal.diagram.title);requestRef.current=null;setGeneration(null);setGenerated([]);setFitRequest(v=>v+1);await persist();
        setAiPreview('');setStatus('整图已应用，可继续手工编辑；完成后插入正文草稿');
      }else{setGenerated(rows=>rows.filter(p=>p.proposalId!==proposal.proposalId));setStatus('已拒绝整图草案，画板保持原样');}
    }catch(e){setIssue((e as Error).message);}finally{setBusy(false);}
  };
  const save=async()=>{if(!input||!api.current||!data.current)return;if(timer.current)clearTimeout(timer.current);setBusy(true);setIssue('');try{await persist();await library.current!.flush();setStatus('生成可编辑源文件和阅读预览…');const elements=api.current.getSceneElements();if(!elements.length)throw Error('请先添加图形或文字。');const files=api.current.getFiles(),appState=api.current.getAppState();const source=serializeAsJSON(elements,appState,files,'local');validateBoardSource(source);const preview=await exportToBlob({elements,appState:{...appState,exportBackground:true,exportWithDarkMode:false},files,mimeType:'image/png',exportPadding:scenePadding(elements),getDimensions:(w:number,h:number)=>{const scale=Math.min(2,2400/Math.max(w,h));return{width:w*scale,height:h*scale,scale};}});const s=await uploadAsset(new File([source],'board.excalidraw.json',{type:'application/json'}),input.target),p=await uploadAsset(new File([preview],'board.png',{type:'image/png'}),input.target);const record=await rpc<BoardRecord>({method:'boards.create',draftId:input.draftId,title:title.trim()||'工程画板',sourceId:s.id,previewId:p.id,parentSnapshotId:input.record?.manifest.snapshotId});send('saved',{record});setStatus('已生成画板版本，正在写入正文草稿');}catch(e){setIssue((e as Error).message);setStatus('画板尚未插入 · 可继续编辑');setBusy(false);}};
  const close=async()=>{setBusy(true);try{if(timer.current)clearTimeout(timer.current);await persist();await library.current!.flush();send('close');}catch(e){setIssue(String(e));setBusy(false);}};
  return <main><header><div className="board-mark"><PenTool size={21}/></div><div className="board-title"><small>Polarion · 工程画板</small><input aria-label="画板名称" disabled={busy} value={title} maxLength={160} onChange={e=>setTitle(e.target.value)} onBlur={()=>void persist()}/></div><div className="board-actions"><span role="status">{status}</span><button disabled={!initial||busy} onClick={()=>void openAI()}><MessageSquare size={15}/>{input?.record?'AI 协作':'AI 生成整图'}</button><button disabled={busy} onClick={()=>void close()}>返回正文</button><button className="primary" disabled={!initial||busy} onClick={()=>void save()}>{busy?'正在处理…':'插入正文草稿'}</button></div></header>{issue&&<div role="alert" className="board-error">{issue}</div>}{generated.length>0&&<aside className="board-proposals generation-proposals" aria-label="AI 整图草案预览">{generated.map(p=><GenerationCard key={p.proposalId} proposal={p} busy={busy} onDecide={decideGeneration}/>)}</aside>}{!input?.record&&initial&&generated.length===0&&<div className="generation-hint">{generation?(generationRestored?'已恢复原生成请求和待审草案。可继续在 AI 对话中描述；若请求已过期，请点击「AI 生成整图」重新生成。':'已建立当前画板的生成请求。请在 AI 对话中描述图形，生成后先预览再应用。'):'点击「AI 生成整图」，用一句描述创建可编辑图形，也可以直接手工绘制。'}</div>}{proposals.length>0&&<aside className="board-proposals" aria-label="AI 待应用变更">{proposals.map(p=><article key={p.proposalId}><strong>{p.title}</strong><small>基于草稿版本 {p.revision} · 尚未应用或保存</small><ul>{p.summary.map(change=><li key={change.id}><code>{change.id}</code>{Object.entries(change.after).filter(([key])=>key!=='id').map(([key,value])=><span key={key}>{({text:'文字',x:'水平位置',y:'垂直位置',width:'宽度',height:'高度',strokeColor:'线条颜色',backgroundColor:'填充颜色',points:'连线路径'} as Record<string,string>)[key]}：{typeof change.before[key]==='object'?JSON.stringify(change.before[key]):String(change.before[key]??'')} → {typeof value==='object'?JSON.stringify(value):String(value)}</span>)}</li>)}</ul><button disabled={busy} onClick={()=>void decide(p,'reject')}>拒绝</button><button className="primary" disabled={busy} onClick={()=>void decide(p,'apply')}>应用到画板</button></article>)}</aside>}{aiPreview&&<div className="ai-preview"><img src={aiPreview} alt="应用 AI 变更后的真实画板预览"/><span>预览已刷新 · 尚未插入正文草稿</span><button onClick={()=>setAiPreview('')}>收起</button></div>}<section className={'canvas '+(busy?'saving':'')}>{initial?<Excalidraw initialData={initial} onLibraryChange={saveLibrary} excalidrawAPI={instance=>{api.current=instance;}} langCode="zh-CN" theme="light" name={title} aiEnabled={false} UIOptions={{canvasActions:{loadScene:true,saveAsImage:true,export:{saveFileToDisk:true},toggleTheme:false}}} onChange={(elements,appState,files)=>{data.current={elements,appState,files};const stamp=hashElementsVersion(elements)+':'+Object.keys(files).join(',');if(stamp!==version.current){version.current=stamp;if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void persist().then(()=>setStatus('画板已保存到本地')).catch(()=>setIssue('本地备份未写入，请保持窗口打开。')),350);}const selectedElements=elements.filter(e=>appState.selectedElementIds[e.id]||('containerId'in e&&e.containerId&&appState.selectedElementIds[e.containerId]));const selected=selectedElements.length?JSON.stringify(selectedElements.map(e=>({id:e.id,type:e.type,...('text'in e?{text:e.text}:{}),x:e.x,y:e.y,width:e.width,height:e.height,...('startBinding'in e?{startBinding:e.startBinding,endBinding:e.endBinding}:{})}))):'';if(input?.record&&selected&&selected!==lastContext.current){lastContext.current=selected;send('context',{text:'画板对象协作上下文（必须先 read_board 再 propose_board_changes，用户审阅应用）：'+JSON.stringify({draftId:input.draftId,objectId:input.record.manifest.objectId,snapshotId:input.record.manifest.snapshotId,sourceHash:input.record.manifest.source.sha256,selectedIds:selectedElements.map(e=>e.id)})+'\n画板「'+name.current+'」选区：\n'+selected});}}}><MainMenu><MainMenu.DefaultItems.LoadScene/><MainMenu.DefaultItems.SaveToActiveFile/><MainMenu.DefaultItems.Export/><MainMenu.DefaultItems.SaveAsImage/><MainMenu.DefaultItems.SearchMenu/><MainMenu.DefaultItems.ClearCanvas/><MainMenu.Separator/><MainMenu.Item icon={<LibraryBig size={16}/>} onSelect={()=>void supplementLibrary()}>补齐内置工程素材</MainMenu.Item></MainMenu></Excalidraw>:<div className="board-loading">正在载入画板引擎…</div>}</section><footer><span>图形、文字、连线和图片均可继续编辑</span><span>插入正文后，点击「保存到 Polarion」同步源文件与预览</span></footer></main>;
}
createRoot(document.querySelector('#root')!).render(<Board/>);
