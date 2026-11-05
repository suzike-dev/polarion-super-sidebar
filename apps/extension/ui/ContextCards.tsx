import React from 'react';
import {Pin,X,ChevronDown,FileText,MousePointer2,MousePointerClick,SquarePen} from 'lucide-react';
import type {Context,Target} from '../../../packages/protocol/index';
import {sameTarget} from '../../../packages/protocol/index';
const sourceNames:Record<Context['source'],string>={selection:'页面选区','context-menu':'右键选区',editor:'编辑器选区','work-item':'工作项正文'};
const sourceIcons:Record<Context['source'],React.ElementType>={selection:MousePointer2,'context-menu':MousePointerClick,editor:SquarePen,'work-item':FileText};
export function ContextCards({contexts,target,onPin,onRemove}:{contexts:Context[];target:Target;onPin:(id:string)=>void;onRemove:(id:string)=>void}){
 return <div className="context-cards">{contexts.map(c=>{const Icon=sourceIcons[c.source];return <details className={'context-card '+(c.pinned?'pinned':'')} key={c.id}><summary><span className="ctx-icon"><Icon size={12}/></span><span className="ctx-main"><strong>{c.workItemId??'文档选区'}</strong><small>{sourceNames[c.source]} · {c.text.length.toLocaleString()} 字{c.pinned?' · 已固定':''}</small></span><ChevronDown size={12}/></summary><div className="context-preview"><div className="context-origin">{c.target.projectId} / {c.target.document}</div><div className="context-text">{c.text||'未捕获到文字内容'}</div><footer><button disabled={!sameTarget(c.target,target)} title={!sameTarget(c.target,target)?'跨文档引用保持固定，可移除后重新选择':c.pinned?'取消固定':'固定后，后续选区不会替换它'} aria-pressed={c.pinned} onClick={()=>onPin(c.id)}><Pin size={12}/>{c.pinned?'取消固定':'固定上下文'}</button><button onClick={()=>onRemove(c.id)}><X size={12}/>移除</button></footer></div></details>;})}</div>;
}
