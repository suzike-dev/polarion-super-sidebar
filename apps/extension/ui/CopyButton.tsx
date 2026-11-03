import React,{useEffect,useRef,useState} from 'react';
import {Check,Copy} from 'lucide-react';
export function CopyButton({text,label='复制',rich}:{text:string;label?:string;rich?:()=>{html:string;text:string}}){
 const [state,setState]=useState<'idle'|'copied'|'failed'>('idle'),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 return <button type="button" className="copy-content" aria-label={label} title={state==='failed'?'复制失败，请选中文字后复制':label} onClick={async()=>{clearTimeout(timer.current);try{if(rich){const content=rich();await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([content.html],{type:'text/html'}),'text/plain':new Blob([content.text],{type:'text/plain'})})]);}else await navigator.clipboard.writeText(text);setState('copied');}catch{setState('failed');}timer.current=setTimeout(()=>setState('idle'),2200);}}>{state==='copied'?<Check size={13}/>:<Copy size={13}/>}<span aria-live="polite">{state==='copied'?'已复制':state==='failed'?'复制失败':label}</span></button>;
}
