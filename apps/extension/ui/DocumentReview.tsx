import React,{useMemo,useState,useRef,useEffect} from 'react';
import {ChevronUp,ChevronDown} from 'lucide-react';
import type {Draft} from '../../../packages/protocol/index';
import {RichSurface} from './RichSurface';
import {reviewDocument} from '../lib/document-review';
export function DocumentReview({draft,onRead}:{draft:Draft;onRead:()=>void}){
 const [only,setOnly]=useState(false),[index,setIndex]=useState(0),documents=useRef<(Document|null)[]>([null,null]);
 const comparison=useMemo(()=>reviewDocument(draft.baseHtml,draft.html,DOMParser,only),[draft.baseHtml,draft.html,only]);
 const focus=(doc:Document|null,n:number)=>{if(!doc)return;doc.querySelectorAll('[data-review-change]').forEach(e=>(e as HTMLElement).style.outline='');const el=doc.querySelector(`[data-review-change="${n}"]`) as HTMLElement|null;if(el){el.style.outline='2px solid #2563eb';el.style.outlineOffset='3px';doc.defaultView?.scrollTo({top:Math.max(0,el.getBoundingClientRect().top+(doc.defaultView?.scrollY??0)-20),behavior:'instant'});}};
 const jump=(n:number)=>{setIndex(n);documents.current.forEach(doc=>focus(doc,n));};
 useEffect(()=>{setIndex(0);documents.current=[null,null];},[draft.html,draft.baseHtml,only]);
 if(comparison.unchanged)return <div className="review-empty"><span className="review-check">✓</span><h3>当前没有修改</h3><p>正文与读取时的基线一致。编辑后可在这里查看文字、表格、图片和格式的变化。</p><button onClick={onRead}>阅读正文</button></div>;
 return <section className="document-review"><div className="review-summary"><strong>修改对照</strong><span><i className="removed"/>{comparison.removed} 处原内容</span><span><i className="added"/>{comparison.added} 处新内容</span><div className="review-navigation"><button title="上一处变化" aria-label="上一处变化" disabled={!index} onClick={()=>jump(index-1)}><ChevronUp size={15}/></button><span aria-live="polite">{index+1} / {comparison.changes.length}</span><button title="下一处变化" aria-label="下一处变化" disabled={index>=comparison.changes.length-1} onClick={()=>jump(index+1)}><ChevronDown size={15}/></button><button className="review-filter" aria-pressed={only} onClick={()=>setOnly(v=>!v)}>只看变化</button></div></div><div className="review-location">{comparison.changes[index]?.label} <span>文字变化突出显示；格式与结构按内容块标记</span></div><div className="review-panes"><section><h3>修改前 <small>读取基线</small></h3><RichSurface title="修改前正文" draft={{...draft,html:comparison.before,nodes:[]}} onSelect={()=>{}} onContext={()=>{}} onReady={doc=>{documents.current[0]=doc;focus(doc,index);}}/></section><section><h3>修改后 <small>当前草稿</small></h3><RichSurface title="修改后正文" draft={{...draft,html:comparison.after,nodes:[]}} onSelect={()=>{}} onContext={()=>{}} onReady={doc=>{documents.current[1]=doc;focus(doc,index);}}/></section></div></section>;
}
