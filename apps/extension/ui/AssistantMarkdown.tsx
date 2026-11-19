import React, {useRef, useState} from 'react';
import Markdown, {defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {CopyButton} from './CopyButton';
import {linkifyWorkItems, tableToMarkdown} from '../lib/workitem-refs';
import {highlightToHtml} from '../../../packages/core/code-highlight';

import {detectBoardCode, openCodeInDraft, type BoardCode} from '../lib/board-code';
import {BoardDialog} from './BoardDialog';

function CodeBlock({children}:React.ComponentProps<'pre'>){
 const [preview,setPreview]=useState<BoardCode|null>(null);
 const code=React.isValidElement<{children?:React.ReactNode;className?:string}>(children)?children:null;
 const language=code?.props.className?.match(/language-([\w+-]+)/)?.[1];
 const text=typeof code?.props.children==='string'?code.props.children:'';
 const source=detectBoardCode(language??'',text);
 const highlighted=language?highlightToHtml(text,language):null;
 const body=highlighted!==null&&code?<pre><code className={code.props.className} dangerouslySetInnerHTML={{__html:highlighted}}/></pre>:<pre>{children}</pre>;
 return <div className="answer-code-wrap"><details className="answer-code"><summary>{language?`${language} · 代码详情`:'代码与技术详情'}</summary>{body}</details><CopyButton text={text} label="复制代码"/>{source&&<button type="button" onClick={()=>{if(!openCodeInDraft(source))setPreview(source);}}>在画板中打开</button>}{preview&&<BoardDialog code={preview} onClose={()=>setPreview(null)}/>}</div>;
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
 return <div className="assistant-message"><Markdown remarkPlugins={[remarkGfm, remarkWorkItems, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={url => url.startsWith('workitem:') ? url : defaultUrlTransform(url)} components={{
  a:props=>{const href=props.href??'';if(href.startsWith('workitem:')){const id=href.slice('workitem:'.length);return <button type="button" className="workitem-ref" title={`打开 ${id} 的完整预览`} onClick={event=>{event.preventDefault();onWorkItem?.(id);}}>{props.children}</button>;}return <a {...props} target="_blank" rel="noopener noreferrer"/>;},
  table:props=><TableBlock {...props}/>,
  pre:CodeBlock,
 }}>{text}</Markdown></div>;
});
