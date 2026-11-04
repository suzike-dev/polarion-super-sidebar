import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import {Plus,ListTree,MoreHorizontal,ArrowUp,ArrowDown,Copy,Trash2,X} from 'lucide-react';
import {blockTransaction,containsProtected,selectedBlock} from '../lib/editor-blocks';
import {editorPopoverPlacement} from '../lib/editor-popover';
type Command={id:string;label:string;hint:string;keywords:string;run:(e:Editor)=>void};
export function EditorDocTools({editor,onPopup,onImage,onBoard,onIssue,compact=false}:{editor:Editor;onPopup:(name:string)=>void;onImage:()=>void;onBoard:()=>void;onIssue:(message:string)=>void;compact?:boolean}){
  const [menu,setMenu]=useState<'insert'|'blocks'|'outline'|null>(null),[slash,setSlash]=useState<{from:number;to:number;query:string;left:number;top:number}|null>(null),[query,setQuery]=useState(''),[index,setIndex]=useState(0),[tick,setTick]=useState(0);
  const root=useRef<HTMLDivElement>(null),menuRoot=useRef<HTMLDivElement>(null),slashDismissed=useRef<string>('');
  const menuTrigger=useRef<HTMLButtonElement|null>(null);
  const [menuPosition,setMenuPosition]=useState<React.CSSProperties>();
  useLayoutEffect(()=>{
    if(!menu&&!slash)return;const frame=editor.view.dom.closest<HTMLElement>('.rich-workbench'),panel=menuRoot.current;if(!frame||!panel)return;
    const place=()=>{const bounds=frame.getBoundingClientRect(),anchor=root.current?.getBoundingClientRect();if(!anchor)return;
      const placement=editorPopoverPlacement(bounds,slash?slash.top-6:anchor.bottom,{width:innerWidth,height:innerHeight},panel.scrollHeight+2);
      placement.width=Math.min(300,placement.width);placement.left=Math.max(bounds.left+8,Math.min(bounds.right-8-placement.width,slash?.left??anchor.left));
      const next={position:'fixed' as const,...placement};setMenuPosition(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
    };
    place();const resize=new ResizeObserver(place);resize.observe(frame);window.addEventListener('resize',place);return()=>{resize.disconnect();window.removeEventListener('resize',place);};
  },[editor,menu,!!slash,slash?.left,slash?.top]);
  const dismissMenu=()=>{setMenu(null);setSlash(null);const trigger=menu?menuTrigger.current:null;const restore=trigger?.getClientRects().length?trigger:trigger?.closest('[data-collapsed="true"]')?.querySelector<HTMLButtonElement>('.toolbar-group-trigger');if(restore?.isConnected)restore.focus();else editor.commands.focus();};
  const toggleMenu=(next:'insert'|'blocks'|'outline',trigger:HTMLButtonElement)=>{menuTrigger.current=trigger;setSlash(null);setQuery('');setIndex(0);if(menu===next){setMenu(null);trigger.focus();}else setMenu(next);};
  useEffect(()=>{if(!menu)return;const panel=menuRoot.current;const first=panel?.querySelector<HTMLElement>('input,.block-actions button:not(:disabled),.editor-outline-list button')??panel?.querySelector<HTMLElement>('header button');first?.focus();},[menu]);
  const commands:Command[]=[
    {id:'paragraph',label:'正文',hint:'普通段落',keywords:'text wenben zhengwen',run:e=>{e.chain().focus().setParagraph().run();}},
    ...[1,2,3,4].map(level=>({id:'h'+level,label:'标题 '+level,hint:'创建章节层级',keywords:'heading biaoti h'+level,run:(e:Editor)=>{e.chain().focus().setHeading({level:level as 1|2|3|4}).run();}})),
    {id:'bullet',label:'无序列表',hint:'分点表达内容',keywords:'list ul wuxu',run:e=>{e.chain().focus().toggleBulletList().run();}},
    {id:'ordered',label:'有序列表',hint:'步骤与顺序',keywords:'list ol youxu',run:e=>{e.chain().focus().toggleOrderedList().run();}},
    {id:'task',label:'待办清单',hint:'可勾选的完成状态',keywords:'task todo daiban checkbox',run:e=>{e.chain().focus().toggleList('taskList','taskItem').run();}},
    {id:'quote',label:'引用',hint:'引用说明与背景',keywords:'quote yinyong',run:e=>{e.chain().focus().toggleBlockquote().run();}},
    ...[['info','信息提示'],['note','备注提示'],['warning','注意事项']].map(([tone,label])=>({id:tone!,label:label!,hint:'带底色的提示块',keywords:'callout tishi zhuyi',run:(e:Editor)=>{e.chain().focus().wrapIn('callout',{tone}).run();}})),
    {id:'code',label:'代码块',hint:'保留换行与缩进',keywords:'code daima',run:e=>{e.chain().focus().toggleCodeBlock().run();}},
    {id:'table',label:'表格',hint:'选择行列数',keywords:'table biaoge',run:()=>onPopup('table')},
    {id:'image',label:'图片',hint:'上传、拖入或粘贴图片',keywords:'image tupian',run:onImage},
    {id:'link',label:'链接',hint:'网页或 Polarion 引用',keywords:'link lianjie',run:()=>onPopup('link')},
    {id:'board',label:'工程画板',hint:'插入可继续编辑的图示',keywords:'board huaban',run:onBoard},
    {id:'divider',label:'分隔线',hint:'分隔章节内容',keywords:'divider fengexian',run:e=>{e.chain().focus().setHorizontalRule().run();}},
  ];
  const filter=(slash?.query??query).trim().toLocaleLowerCase(),matches=commands.filter(c=>(c.label+' '+c.keywords).toLocaleLowerCase().includes(filter));
  const run=(command:Command)=>{if(slash)editor.commands.deleteRange({from:slash.from,to:slash.to});setMenu(null);setSlash(null);setQuery('');command.run(editor);};
  const state=useRef({slash,matches,index,run});state.current={slash,matches,index,run};
  useEffect(()=>{
    const update=()=>{setTick(n=>n+1);const {selection}=editor.state;if(!selection.empty||!editor.isEditable||!['paragraph','heading'].includes(selection.$from.parent.type.name)){setSlash(null);return;}
      const prefix=selection.$from.parent.textBetween(0,selection.$from.parentOffset,'\ufffc','\ufffc'),match=prefix.match(/(?:^|\s)\/([^\s/]{0,32})$/u);
      if(!match){slashDismissed.current='';setSlash(null);return;}const from=selection.from-match[1]!.length-1,key=from+':'+prefix;if(slashDismissed.current===key)return;
      const box=editor.view.coordsAtPos(from);setSlash(old=>{if(old?.query!==match[1])setIndex(0);return{from,to:selection.from,query:match[1]!,left:Math.max(12,Math.min(innerWidth-320,box.left)),top:Math.max(10,Math.min(innerHeight-350,box.bottom+6))};});setMenu(null);
    };
    const key=(event:KeyboardEvent)=>{const s=state.current;if(event.isComposing||!s.slash)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();const sel=editor.state.selection;slashDismissed.current=s.slash.from+':'+sel.$from.parent.textBetween(0,sel.$from.parentOffset,'\ufffc','\ufffc');setSlash(null);return;}
      if(!s.matches.length)return;if(['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(event.key==='ArrowDown'||event.key==='ArrowUp')setIndex(n=>(n+(event.key==='ArrowDown'?1:s.matches.length-1))%s.matches.length);else s.run(s.matches[Math.min(s.index,s.matches.length-1)]!);}
    };
    const dom=editor.view.dom;editor.on('transaction',update);dom.addEventListener('keydown',key,true);
    return()=>{editor.off('transaction',update);dom.removeEventListener('keydown',key,true);};
  },[editor]);
  useEffect(()=>{if(!menu&&!slash)return;const dom=editor.view.dom;const outside=(event:PointerEvent)=>{if(!event.composedPath().includes(root.current!)&&!event.composedPath().includes(menuRoot.current!)&&!event.composedPath().includes(dom)){setMenu(null);setSlash(null);}};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[editor,menu,!!slash]);
  useEffect(()=>{menuRoot.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[index]);
  const headings:{pos:number;level:number;text:string}[]=[];editor.state.doc.descendants((n,pos)=>{if(n.type.name==='heading')headings.push({pos,level:n.attrs.level,text:n.textContent||'空标题'});});
  const block=selectedBlock(editor.state),protectedBlock=!!block&&containsProtected(block.node);
  return <div className={'document-tools '+(compact?'document-tools-inline':'')} ref={root} data-tick={tick} onKeyDown={event=>{if(event.key==='Escape'&&(menu||slash)){event.preventDefault();event.stopPropagation();dismissMenu();}}}>
    <button aria-label="添加内容" title="添加内容 /" aria-expanded={menu==='insert'} onMouseDown={e=>e.preventDefault()} onClick={e=>toggleMenu('insert',e.currentTarget)}><Plus size={15}/>{compact?'添加':'添加内容'}{!compact&&<span>/</span>}</button>
    <button aria-label="当前内容块操作" title="当前内容块操作" aria-expanded={menu==='blocks'} onMouseDown={e=>e.preventDefault()} onClick={e=>toggleMenu('blocks',e.currentTarget)}><MoreHorizontal size={16}/>{!compact&&'内容块'}</button>
    <button aria-label="工作项正文大纲" title="工作项正文大纲" aria-expanded={menu==='outline'} onMouseDown={e=>e.preventDefault()} onClick={e=>toggleMenu('outline',e.currentTarget)}><ListTree size={15}/>{compact?'大纲':'正文大纲'}{headings.length>0&&<small>{headings.length}</small>}</button>
    {!compact&&<span className="document-shortcuts">/ 插入 · Ctrl+K 链接 · Ctrl+F 查找</span>}
    {(menu||slash)&&createPortal(<div ref={menuRoot} className={'document-tool-menu '+(slash?'slash-insert-menu':'')} style={menuPosition}>
      <header><strong>{slash||menu==='insert'?'添加内容':menu==='blocks'?'当前内容块':'正文大纲'}</strong><button title="关闭内容菜单" onClick={dismissMenu}><X size={14}/></button></header>
      {(slash||menu==='insert')&&<>{!slash&&<input aria-label="搜索内容类型" placeholder="搜索标题、清单、图片…" autoFocus value={query} onChange={e=>{setQuery(e.target.value);setIndex(0);}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setIndex(n=>(n+(event.key==='ArrowDown'?1:Math.max(1,matches.length)-1))%Math.max(1,matches.length));}if(event.key==='Enter'&&matches[index]){event.preventDefault();run(matches[index]!);}}}/>}<div role="listbox" aria-label="内容类型" className="document-command-list">{matches.map((c,i)=><button key={c.id} role="option" aria-selected={i===index} onMouseDown={e=>e.preventDefault()} onClick={()=>run(c)}><strong>{c.label}</strong><small>{c.hint}</small></button>)}{!matches.length&&<p>没有匹配内容，试试中文或英文名称。</p>}</div><footer>↑ ↓ 选择 · Enter 插入 · Esc 关闭</footer></>}
      {menu==='blocks'&&<div className="block-actions">{([['up','上移',ArrowUp],['down','下移',ArrowDown],['duplicate','复制内容块',Copy],['delete','删除内容块',Trash2]] as const).map(([action,label,Icon])=><button key={action} disabled={!block||(protectedBlock&&(action==='duplicate'||action==='delete'))||(action==='up'&&block.index===0)||(action==='down'&&block.index===block.parent.childCount-1)} onMouseDown={e=>e.preventDefault()} onClick={()=>{const tr=blockTransaction(editor.state,action);if(tr){editor.view.dispatch(tr);editor.commands.focus();setMenu(null);}else onIssue('当前内容块不能执行此操作。特殊宏和不完整选区会保持原样。');}}><Icon size={15}/>{label}</button>)}<small>操作当前段落、列表或表格，可撤销。</small></div>}
      {menu==='outline'&&<div className="editor-outline-list">{headings.length?headings.map(h=><button key={h.pos} style={{paddingLeft:12+(h.level-1)*10}} onMouseDown={e=>e.preventDefault()} onClick={()=>{editor.chain().focus().setTextSelection(h.pos+1).scrollIntoView().run();setMenu(null);}}><small>H{h.level}</small>{h.text}</button>):<p>使用标题样式后，可在这里定位章节。</p>}</div>}
    </div>,editor.view.dom.closest('.rich-layer')!)}
  </div>;
}
