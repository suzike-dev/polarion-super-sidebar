import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CopyButton} from './CopyButton';
function CodeBlock({children}:React.ComponentProps<'pre'>){
 const code=React.isValidElement<{children?:React.ReactNode;className?:string}>(children)?children:null;
 const language=code?.props.className?.match(/language-([\w+-]+)/)?.[1];
 const text=typeof code?.props.children==='string'?code.props.children:'';
 return <div className="answer-code-wrap"><details className="answer-code"><summary>{language?`${language} · 代码详情`:'代码与技术详情'}</summary><pre>{children}</pre></details><CopyButton text={text} label="复制代码"/></div>;
}
export const AssistantMarkdown=React.memo(function AssistantMarkdown({text}:{text:string}){
 return <div className="assistant-message"><Markdown remarkPlugins={[remarkGfm]} components={{a:props=><a {...props} target="_blank" rel="noopener noreferrer"/>,table:props=><div className="answer-table"><table {...props}/></div>,pre:CodeBlock}}>{text}</Markdown></div>;
});
