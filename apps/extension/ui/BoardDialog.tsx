import React,{useEffect,useRef,useState} from 'react';
import {browser} from 'wxt/browser';
import type {Draft} from '../../../packages/protocol/index';
import type {BoardRecord,BoardGenerationRequest} from '../../host/boards';
import type {BoardCode} from '../lib/board-code';
type BoardDialogProps = {code?:BoardCode; onClose:()=>void} & (
  {draft:Draft;record?:BoardRecord;generationRequest?:BoardGenerationRequest;onSaved:(record:BoardRecord)=>Promise<void>;onContext:(text:string)=>void;onToggleAI:()=>void;onShowAI:()=>void} |
  {code:BoardCode; draft?:undefined;record?:never;generationRequest?:never;onSaved?:never;onContext?:never;onToggleAI?:never;onShowAI?:never}
);
export function BoardDialog({draft,record,generationRequest,code,onSaved,onClose,onContext,onToggleAI,onShowAI}:BoardDialogProps){
  const frame=useRef<HTMLIFrameElement>(null),[channel]=useState(()=>crypto.randomUUID()),[error,setError]=useState('');
  const latest=useRef({onSaved,onClose,onContext,onToggleAI,onShowAI});latest.current={onSaved,onClose,onContext,onToggleAI,onShowAI};
  useEffect(()=>{const listener=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||event.origin!==new URL(browser.runtime.getURL('/')).origin||event.data?.channel!==channel)return;const data=event.data;if(data.type==='ready')frame.current?.contentWindow?.postMessage({type:'load',channel,draftId:draft?.id,target:draft?.target,record,generationRequest,code},event.origin);if(data.type==='saved')void latest.current.onSaved?.(data.record).catch(e=>setError(String(e)));if(data.type==='close')latest.current.onClose();if(data.type==='toggle-ai')latest.current.onToggleAI?.();if(data.type==='show-ai')latest.current.onShowAI?.();if(data.type==='context'&&typeof data.text==='string')latest.current.onContext?.(data.text.slice(0,60000));};window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);},[channel,draft?.id,code]);
  return <div className="board-overlay" role="dialog" aria-modal="true" aria-label="可编辑工程画板">{error&&<div className="rich-alert">{error}<button onClick={onClose}>返回正文，保留画板备份</button></div>}<iframe ref={frame} title="工程画板编辑器" allow="clipboard-write" src={browser.runtime.getURL('/board.html')+'#'+channel}/></div>;
}
