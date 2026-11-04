import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Image, X, Download, Paperclip } from 'lucide-react';
import type { Asset } from '../../../packages/protocol/index';
import { assetBlob, readableSize } from '../lib/assets';
import { rpc } from '../lib/client';
export function AttachmentCards({ assets, onRemove, onPreview }: { assets: Asset[]; onRemove?: (id:string)=>void; onPreview:(a:Asset)=>void }) {
  return <div className="attachment-cards">{assets.map(a=><div className="attachment-card" key={a.id}><button className="attachment-open" onClick={()=>onPreview(a)}>{a.extraction==='image'?<Image size={19}/>:<FileText size={19}/>}<span><strong>{a.name}</strong><small>{readableSize(a.size)} · {a.extraction==='text'?(a.truncated?'已提取部分文字':'文字已提取'):a.extraction==='image'?'图像上下文':a.extraction==='failed'?'需原生工具解析':'待原生工具读取'}</small></span></button>{onRemove&&<button className="icon" title={'移除附件 '+a.name} onClick={()=>onRemove(a.id)}><X size={12}/></button>}</div>)}</div>;
}
export function AttachmentPreview({ asset, onClose }: { asset:Asset;onClose:()=>void }) {
  const [url,setUrl]=useState(''),[text,setText]=useState(''),[error,setError]=useState('');
  const dialog=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
  useLayoutEffect(()=>{
    const panel=dialog.current;if(!panel)return;
    const tree=panel.getRootNode() as Document|ShadowRoot,previous=tree.activeElement;
    const layer=panel.parentElement;
    const background=Array.from(layer?.parentElement?.children??[]).filter((element):element is HTMLElement=>element instanceof HTMLElement&&element!==layer).map(element=>({element,inert:element.inert}));
    for(const item of background)item.element.inert=true;
    close.current?.focus();
    return()=>{for(const item of background)item.element.inert=item.inert;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
  },[]);
  const handleKey=(event:React.KeyboardEvent<HTMLElement>)=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const panel=dialog.current;if(!panel)return;
    const items=Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0);
    const current=(panel.getRootNode() as Document|ShadowRoot).activeElement,index=items.findIndex(element=>element===current);
    if(!items.length){event.preventDefault();panel.focus();}
    else if(event.shiftKey&&index<=0){event.preventDefault();items.at(-1)!.focus();}
    else if(!event.shiftKey&&(index<0||index===items.length-1)){event.preventDefault();items[0]!.focus();}
  };
  useEffect(()=>{let disposed=false;let objectUrl='';void(async()=>{try{if(asset.extraction==='text'){const result=await rpc<{text:string}>({method:'assets.text',assetId:asset.id});if(!disposed)setText(result.text);}else{const blob=await assetBlob(asset);objectUrl=URL.createObjectURL(blob);if(disposed)URL.revokeObjectURL(objectUrl);else setUrl(objectUrl);}}catch(e){if(!disposed)setError((e as Error).message);}})();return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[asset.id]);
  return <div className="attachment-preview-layer"><section ref={dialog} className="attachment-preview" role="dialog" aria-modal="true" aria-label="附件预览" tabIndex={-1} onKeyDown={handleKey}><header><Paperclip size={16}/><strong>{asset.name}</strong><small>{readableSize(asset.size)}</small><button ref={close} className="icon" title="关闭附件预览" onClick={onClose}><X size={18}/></button></header><div className="attachment-preview-body">{error?<p className="inline-error">{error}</p>:asset.extraction==='image'&&url?<img src={url} alt={asset.name}/>:text?<pre>{text}</pre>:url?<div className="file-preview-empty"><FileText size={34}/><p>原始文件已保存在本地，可交由 Claude Code 的原生工具或 Skill 读取。</p><a className="secondary" href={url} download={asset.name}><Download size={14}/>下载原文件</a></div>:<p className="muted">正在读取附件…</p>}</div>{asset.truncated&&<footer>这里只展示已提取部分；原文件仍完整保留。</footer>}</section></div>;
}
