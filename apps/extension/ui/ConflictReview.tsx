import React,{useEffect,useState} from 'react';
import type {Draft} from '../../../packages/protocol';
import {rpc} from '../lib/client';
import {RichSurface} from './RichSurface';
type Review={draft:Draft & {nodes?:never[]};remoteHtml:string;remoteHash:string;remoteUpdated:string};
export function ConflictReview({draftId,onResolved,onClose}:{draftId:string;onResolved:()=>Promise<void>;onClose:()=>void}){
  const [review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[base,setBase]=useState(false);
  useEffect(()=>{void rpc<Review>({method:'drafts.conflict.read',draftId}).then(setReview).catch(e=>setError(e.message));},[draftId]);
  const resolve=async(strategy:'keep-local'|'use-remote')=>{if(!review)return;setBusy(true);try{await rpc({method:'drafts.conflict.resolve',draftId,expectedRevision:review.draft.revision,remoteHash:review.remoteHash,remoteUpdated:review.remoteUpdated,strategy});await onResolved();}catch(e){setError((e as Error).message==='REMOTE_CHANGED_SINCE_REVIEW'?'服务端又有新修改，请关闭后重新比较。':(e as Error).message);}finally{setBusy(false);}};
  return <div className="conflict-review" role="dialog" aria-label="比较本地与服务端版本"><header><div><strong>比较本地与服务端版本</strong><p>选择只更新本地草稿；保留本地内容后仍需明确保存到 Polarion。</p></div><button className="secondary" disabled={busy} onClick={onClose}>返回编辑</button></header>{error&&<div role="alert" className="rich-alert">{error}</div>}{review?<><div className="conflict-columns"><section><h3>{base?'最初读取基线':'当前本地草稿'}</h3><RichSurface draft={{...review.draft,nodes:[],html:base?review.draft.baseHtml:review.draft.html}} onSelect={()=>{}} onContext={()=>{}}/></section><section><h3>刚读取的服务端内容</h3><RichSurface draft={{...review.draft,nodes:[],html:review.remoteHtml}} onSelect={()=>{}} onContext={()=>{}}/></section></div><footer><button className="secondary" onClick={()=>setBase(v=>!v)}>{base?'查看本地草稿':'查看最初基线'}</button><button className="secondary" disabled={busy} onClick={()=>void resolve('use-remote')}>采用服务端内容</button><button className="primary" disabled={busy} onClick={()=>void resolve('keep-local')}>保留本地内容，更新比较基线</button></footer></>:<p>正在独立读取服务端版本…</p>}</div>;
}
