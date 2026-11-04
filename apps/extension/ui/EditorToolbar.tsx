import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {Editor} from '@tiptap/core';
import {editorPopoverPlacement} from '../lib/editor-popover';

/** LiveDoc normalizes point sizes to these native presets. */
export const nativeFontSizes=[8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72];
export function selectionTypography(editor:Editor|null){
  if(!editor||editor.isDestroyed)return {size:'10pt',font:'',line:'1.5'};
  const {node,offset}=editor.view.domAtPos(editor.state.selection.from),atEnd=node.nodeType===1&&offset===node.childNodes.length;
  let leaf=node.nodeType===1?(node.childNodes[offset]??node.childNodes[offset-1]??node):node;
  while(leaf.nodeType===1&&leaf.childNodes.length)leaf=(atEnd?leaf.lastChild:leaf.firstChild)!;
  const element=(leaf.nodeType===3?leaf.parentElement:leaf) as Element,css=element.ownerDocument.defaultView!.getComputedStyle(element),size=parseFloat(css.fontSize),line=parseFloat(css.lineHeight);
  return {size:`${Math.round(size*.75*100)/100}pt`,font:css.fontFamily,line:Number.isFinite(line/size)?String(Math.round(line/size*100)/100):'1.5'};
}
const focusable=(root:HTMLElement|null)=>root?[...root.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')].filter(e=>e.getClientRects().length):[];
function usePanelPosition(root:React.RefObject<HTMLDivElement|null>,panel:React.RefObject<HTMLDivElement|null>,open:boolean,preferred=286){
  const [position,setPosition]=useState<React.CSSProperties>();
  useLayoutEffect(()=>{
    if(!open)return;const frame=root.current?.closest<HTMLElement>('.rich-workbench');if(!frame||!panel.current)return;
    const place=()=>{const box=root.current!.getBoundingClientRect(),bounds=frame.getBoundingClientRect();
      const next=editorPopoverPlacement(bounds,box.bottom+2,{width:innerWidth,height:innerHeight},panel.current!.scrollHeight+2);
      next.width=Math.min(preferred,next.width);next.left=Math.max(bounds.left+8,Math.min(box.left,bounds.right-next.width-8));
      const style={position:'fixed' as const,...next};setPosition(old=>JSON.stringify(old)===JSON.stringify(style)?old:style);
    };
    place();const resize=new ResizeObserver(place);resize.observe(frame);window.addEventListener('resize',place);return()=>{resize.disconnect();window.removeEventListener('resize',place);};
  },[open,preferred]);
  return open?position:undefined;
}
function useDismiss(open:boolean,close:()=>void,root:React.RefObject<HTMLDivElement|null>){
  const latest=useRef(close);latest.current=close;
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!e.composedPath().includes(root.current!))latest.current();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
}
function panelKeys(event:React.KeyboardEvent,close:()=>void,trigger:HTMLButtonElement|null){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();trigger?.focus();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||(event.target as HTMLElement).matches('select,input'))return;
  const buttons=focusable(event.currentTarget as HTMLElement),index=buttons.indexOf(event.target as HTMLElement);
  if(!buttons.length)return;event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();
}
export function ToolbarMenu({label,icon,children,disabled=false}:{label:string;icon?:React.ReactNode;children:React.ReactNode;disabled?:boolean}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  useDismiss(open,()=>setOpen(false),root);
  const position=usePanelPosition(root,panel,open&&!root.current?.closest('[data-collapsed=true]'),240);
  useEffect(()=>{if(open)focusable(panel.current)[0]?.focus();},[open]);
  return <div className="toolbar-dropdown" ref={root}>
    <button className="rt-button toolbar-menu-trigger" ref={trigger} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>setOpen(v=>!v)}>{icon}<span>{label}</span><ChevronDown size={12}/></button>
    <div ref={panel} className="toolbar-menu-panel" data-open={open} style={position} role="dialog" aria-label={label+'工具'} onChange={()=>setOpen(false)} onKeyDown={e=>{if(!root.current?.closest('[data-collapsed=true]'))panelKeys(e,()=>setOpen(false),trigger.current);}} onClick={e=>{if((e.target as HTMLElement).closest('button.rt-button'))setOpen(false);}}>{children}</div>
  </div>;
}
function flatGroups(children:React.ReactNode):React.ReactElement<any>[]{return React.Children.toArray(children).flatMap(child=>React.isValidElement(child)?child.type===React.Fragment?flatGroups((child.props as any).children):[child]:[]);}
const labels:Record<string,string>={'编辑历史':'编辑','字体与段落样式':'字体','常用文字格式':'文字','段落与列表':'段落','表格设置与插入':'表格','行与列':'行列','单元格':'单元格','插入内容':'插入','查找与备份':'查找','文档操作':'文档'};
function AdaptiveGroup({label,collapsed,children}:{label:string;collapsed:boolean;children:React.ReactNode}){
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),[open,setOpen]=useState(false);
  useDismiss(open,()=>setOpen(false),root);useEffect(()=>setOpen(false),[collapsed]);useEffect(()=>{if(open)focusable(panel.current)[0]?.focus();},[open]);
  const position=usePanelPosition(root,panel,collapsed&&open);
  return <div ref={root} data-toolbar-group data-collapsed={collapsed} className="tool-group toolbar-section" aria-label={label}>
    <button ref={trigger} className="rt-button toolbar-group-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onMouseDown={e=>e.preventDefault()} onClick={()=>setOpen(v=>!v)}>{labels[label]??label}<ChevronDown size={12}/></button>
    <div ref={panel} className="toolbar-group-content" data-open={open} style={position} role={collapsed?'dialog':undefined} aria-label={collapsed?label+'面板':undefined} onChange={()=>{if(collapsed)setOpen(false);}} onKeyDown={e=>{if(collapsed)panelKeys(e,()=>setOpen(false),trigger.current);}} onClick={e=>{if(collapsed&&(e.target as HTMLElement).closest('button.rt-button,.document-tools-inline>button'))setOpen(false);}}>{children}</div>
  </div>;
}
/** Start expanded. Use the fewest named containers needed, and use as much of the row as possible. */
export function SingleLineToolbar({children,mode,tick,disabled=false}:{children:React.ReactNode;mode:string;tick:number;disabled?:boolean}){
  const groups=flatGroups(children),root=useRef<HTMLDivElement>(null),[collapsed,setCollapsed]=useState<number[]>([]);
  useLayoutEffect(()=>{
    const el=root.current!;
    const measure=()=>{
      const probe=el.cloneNode(false) as HTMLDivElement;probe.classList.add('toolbar-measure');probe.setAttribute('aria-hidden','true');probe.inert=true;
      [...el.querySelectorAll<HTMLElement>(':scope>[data-toolbar-group]')].forEach(group=>probe.append(group.cloneNode(true)));el.parentElement!.append(probe);
      const nodes=[...probe.children] as HTMLElement[];
      nodes.forEach(node=>node.dataset.collapsed='false');const full=nodes.map(node=>node.getBoundingClientRect().width);
      nodes.forEach(node=>node.dataset.collapsed='true');const small=nodes.map(node=>node.getBoundingClientRect().width);probe.remove();
      const available=el.clientWidth-16;let best:number[]=[],bestCount=Infinity,bestWidth=-1;
      for(let mask=0;mask<(1<<nodes.length);mask++){
        const chosen=nodes.flatMap((_,i)=>mask&(1<<i)?[i]:[]),width=full.reduce((sum,w,i)=>sum+(mask&(1<<i)?small[i]!:w),0);
        if(width<=available&&(chosen.length<bestCount||chosen.length===bestCount&&width>bestWidth)){best=chosen;bestCount=chosen.length;bestWidth=width;}
      }
      if(bestCount===Infinity)best=nodes.map((_,i)=>i);
      setCollapsed(old=>old.join(',')===best.join(',')?old:best);
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();
  },[mode,groups.length,disabled]);
  return <div ref={root} className="ribbon single-line-toolbar" role="toolbar" aria-label="富文本工具栏" data-render={tick} inert={disabled}>{groups.map((group,i)=><AdaptiveGroup key={mode+':'+i} label={group.props['aria-label']} collapsed={collapsed.includes(i)}>{group.props.children}</AdaptiveGroup>)}</div>;
}
