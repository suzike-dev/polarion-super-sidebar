import React, {useRef, useState} from 'react';
import Markdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CopyButton} from './CopyButton';
import {linkifyWorkItems, tableToMarkdown} from '../lib/workitem-refs';

function CodeBlock({children}:React.ComponentProps<'pre'>){
 const code=React.isValidElement<{children?:React.ReactNode;className?:string}>(children)?children:null;
 const language=code?.props.className?.match(/language-([\w+-]+)/)?.[1];
 const text=typeof code?.props.children==='string'?code.props.children:'';
 return <div className="answer-code-wrap"><details className="answer-code"><summary>{language?`${language} · 代码详情`:'代码与技术详情'}</summary><pre>{children}</pre></details><CopyButton text={text} label="复制代码"/></div>;
}

/** 表格工具条：悬停时在右上角出现，把当前渲染结果还原成 Markdown。 */
function TableBlock({children,...props}:React.ComponentProps<'table'>){
 const table=useRef<HTMLTableElement>(null);
 const [copied,setCopied]=useState(false);
 const copy=async()=>{
  if(!table.current)return;
  try{await navigator.clipboard.writeText(tableToMarkdown(table.current));setCopied(true);setTimeout(()=>setCopied(false),1600);}
  catch{setCopied(false);}
 };
 return <div className="answer-table-wrap">
  <div className="answer-table"><table ref={table} {...props}>{children}</table></div>
  <button type="button" className={copied?'table-copy copied':'table-copy'} title="把表格复制为 Markdown" aria-label="复制表格为 Markdown" onClick={()=>void copy()}>{copied?'已复制':'复制表格'}</button>
 </div>;
}

/** 把工作项编号转为可点击节点（remark 插件形式，跳过代码与已有链接）。 */
const remarkWorkItems = () => (tree: unknown) => { linkifyWorkItems(tree as never); };

export const AssistantMarkdown=React.memo(function AssistantMarkdown({text,onWorkItem}:{text:string;onWorkItem?:(workItemId:string)=>void}){
 return <div className="assistant-message"><Markdown remarkPlugins={[remarkGfm, remarkWorkItems]} urlTransform={url => url.startsWith('workitem:') ? url : defaultUrlTransform(url)} components={{
  a:props=>{const href=props.href??'';if(href.startsWith('workitem:')){const id=href.slice('workitem:'.length);return <button type="button" className="workitem-ref" title={`打开 ${id} 的完整预览`} onClick={event=>{event.preventDefault();onWorkItem?.(id);}}>{props.children}</button>;}return <a {...props} target="_blank" rel="noopener noreferrer"/>;},
  table:props=><TableBlock {...props}/>,
  pre:CodeBlock,
 }}>{text}</Markdown></div>;
});
