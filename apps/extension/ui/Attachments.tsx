import React, { useEffect, useState } from 'react';
import { FileText, Image, X, Download, Paperclip } from 'lucide-react';
import type { Asset } from '../../../packages/protocol/index';
import { assetBlob, readableSize } from '../lib/assets';
import { rpc } from '../lib/client';
export function AttachmentCards({ assets, onRemove, onPreview }: { assets: Asset[]; onRemove?: (id:string)=>void; onPreview:(a:Asset)=>void }) {
  return <div className="attachment-cards">{assets.map(a=><div className="attachment-card" key={a.id}><button className="attachment-open" onClick={()=>onPreview(a)}>{a.extraction==='image'?<Image size={19}/>:<FileText size={19}/>}<span><strong>{a.name}</strong><small>{readableSize(a.size)} · {a.extraction==='text'?(a.truncated?'已提取部分文字':'文字已提取'):a.extraction==='image'?'图像上下文':a.extraction==='failed'?'需原生工具解析':'待原生工具读取'}</small></span></button>{onRemove&&<button className="icon" title={'移除附件 '+a.name} onClick={()=>onRemove(a.id)}><X size={12}/></button>}</div>)}</div>;
}
export function AttachmentPreview({ asset, onClose }: { asset:Asset;onClose:()=>void }) {
  const [url,setUrl]=useState(''),[text,setText]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let disposed=false;let objectUrl='';void(async()=>{try{if(asset.extraction==='text'){const result=await rpc<{text:string}>({method:'assets.text',assetId:asset.id});if(!disposed)setText(result.text);}else{const blob=await assetBlob(asset);objectUrl=URL.createObjectURL(blob);if(disposed)URL.revokeObjectURL(objectUrl);else setUrl(objectUrl);}}catch(e){if(!disposed)setError((e as Error).message);}})();return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl);};},[asset.id]);
  return <div className="attachment-preview-layer"><section className="attachment-preview" role="dialog" aria-label="附件预览"><header><Paperclip size={16}/><strong>{asset.name}</strong><small>{readableSize(asset.size)}</small><button className="icon" title="关闭附件预览" onClick={onClose}><X size={18}/></button></header><div className="attachment-preview-body">{error?<p className="inline-error">{error}</p>:asset.extraction==='image'&&url?<img src={url} alt={asset.name}/>:text?<pre>{text}</pre>:url?<div className="file-preview-empty"><FileText size={34}/><p>原始文件已保存在本地，可交由 Claude Code 的原生工具或 Skill 读取。</p><a className="secondary" href={url} download={asset.name}><Download size={14}/>下载原文件</a></div>:<p className="muted">正在读取附件…</p>}</div>{asset.truncated&&<footer>这里只展示已提取部分；原文件仍完整保留。</footer>}</section></div>;
}
