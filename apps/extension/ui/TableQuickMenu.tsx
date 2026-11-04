import React,{useEffect,useRef} from 'react';
import type {Editor} from '@tiptap/core';
import {selectTableScope} from '../lib/editor-format';

export function TableQuickMenu({editor,position,onClose,onProperties}:{editor:Editor;position:{left:number;top:number};onClose:()=>void;onProperties:()=>void}) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const menu=root.current!;const box=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(position.left,innerWidth-box.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(position.top,innerHeight-box.height-8))+'px';
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside=(event:PointerEvent)=>{if(!event.composedPath().includes(menu))onClose();};
    document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);
  },[position]);
  const done=(action:()=>void)=>{action();onClose();editor.commands.focus();};
  const item=(label:string,action:()=>void,disabled=false)=><button role="menuitem" disabled={disabled} onClick={()=>done(action)}>{label}</button>;
  return <div ref={root} className="table-quick-menu" role="menu" aria-label="表格快捷操作" style={position} onMouseDown={e=>e.preventDefault()} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();editor.commands.focus();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(event.target as HTMLButtonElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}
    if(event.key==='Tab'){onClose();}
  }}>
    <div className="table-menu-group">
      {item('选择整行',()=>{selectTableScope(editor,'row');})}{item('选择整列',()=>{selectTableScope(editor,'column');})}{item('选择整张表格',()=>{selectTableScope(editor,'table');})}
    </div><div className="table-menu-group">
      {item('上方插入行',()=>{editor.chain().focus().addRowBefore().run();})}{item('下方插入行',()=>{editor.chain().focus().addRowAfter().run();})}
      {item('左侧插入列',()=>{editor.chain().focus().addColumnBefore().run();})}{item('右侧插入列',()=>{editor.chain().focus().addColumnAfter().run();})}
    </div><div className="table-menu-group">
      {item('合并选中单元格',()=>{editor.chain().focus().mergeCells().run();},!editor.can().mergeCells())}
      {item('拆分单元格',()=>{editor.chain().focus().splitCell().run();},!editor.can().splitCell())}
      <button role="menuitem" onClick={()=>{onClose();onProperties();}}>单元格颜色、边框与间距…</button>
    </div><div className="table-menu-group">
      {item('删除所选行',()=>{editor.chain().focus().deleteRow().run();})}{item('删除所选列',()=>{editor.chain().focus().deleteColumn().run();})}
    </div>
  </div>;
}
