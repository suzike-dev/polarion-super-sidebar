import React,{useState} from 'react';
import type {Editor} from '@tiptap/core';
import {applyFormat,formatTargets,type FormatScope} from '../lib/editor-format';
import {styleValues} from '../../../packages/core/rich-style';

export function FormatProperties({editor,scope,onDone}:{editor:Editor;scope:FormatScope;onDone:()=>void}) {
  const [targets]=useState(()=>formatTargets(editor,scope));
  const [initial]=useState(()=>styleValues(targets[0]?.node.attrs.sourceStyle));
  const [patch,setPatch]=useState<Record<string,string|null>>({});
  const [callout,setCallout]=useState<string|null>(null);
  const value=(key:string,fallback='')=>key in patch?patch[key]??'':initial[key]??fallback;
  const set=(key:string,v:string)=>setPatch(p=>({...p,[key]:v||null}));
  const number=(label:string,key:string,max:number,fallback=0)=><label>{label}<div className="property-unit"><input aria-label={label} type="number" min="0" max={max} value={parseFloat(value(key,String(fallback)))||0} onChange={e=>set(key,e.target.value?e.target.value+'px':'')}/><span>px</span></div></label>;
  const select=(label:string,key:string,options:[string,string][],fallback:string)=><label>{label}<select aria-label={label} value={value(key,fallback)} onChange={e=>set(key,e.target.value)}>{options.map(([v,text])=><option value={v} key={v}>{text}</option>)}</select></label>;
  return <form className="format-properties" onSubmit={event=>{event.preventDefault();if(!applyFormat(editor,scope,patch))return;if(callout==='clear')editor.chain().focus().lift('callout').run();else if(callout){if(editor.isActive('callout'))editor.chain().focus().updateAttributes('callout',{tone:callout}).run();else editor.chain().focus().wrapIn('callout',{tone:callout}).run();}onDone();}}>
    <p className="property-hint">{scope==='paragraph'?`所选 ${targets.length} 个段落`:scope==='cell'?`所选 ${targets.length} 个单元格`:'当前表格'} · 只更改你调整的属性</p>
    <div className="property-grid">
      {scope==='paragraph'&&<>{number('段前间距','margin-top',120)}{number('段后间距','margin-bottom',120,12)}{number('左侧缩进','margin-left',240)}{number('首行缩进','text-indent',120)}</>}
      {scope==='table'&&<>
        <label>表格宽度<div className="property-unit"><input aria-label="表格宽度" type="number" min="10" max={value('width','100%').endsWith('%')?100:2400} value={parseFloat(value('width','100%'))||100} onChange={e=>set('width',e.target.value+(value('width','100%').endsWith('%')?'%':'px'))}/><select aria-label="表格宽度单位" value={value('width','100%').endsWith('%')?'%':'px'} onChange={e=>set('width',(e.target.value==='%'?Math.min(100,parseFloat(value('width','100%'))):parseFloat(value('width','100%')))+e.target.value)}><option value="%">%</option><option value="px">px</option></select></div></label>
        {select('边框模式','border-collapse',[['collapse','合并边框'],['separate','独立边框']],'collapse')}{number('单元格间距','border-spacing',40)}
        {select('表格分页','break-inside',[['auto','允许分页'],['avoid','尽量整表同页']],'auto')}
      </>}
      {scope==='cell'&&<>{number('单元格内边距','padding',60,8)}{select('垂直对齐','vertical-align',[['top','顶部'],['middle','居中'],['bottom','底部']],'top')}{select('文本换行','white-space',[['normal','自动换行'],['nowrap','不换行'],['pre-wrap','保留空白并换行']],'normal')}</>}
      <label>背景颜色<input aria-label="属性背景颜色" type="color" value={/^#[a-f0-9]{6}$/i.test(value('background-color'))?value('background-color'):'#ffffff'} onChange={e=>set('background-color',e.target.value)}/></label>
      {scope!=='paragraph'&&<label>边框样式<select aria-label="边框样式" value={value('border','1px solid #cbd5e1')} onChange={e=>set('border',e.target.value)}><option value="1px solid #cbd5e1">细线 · 灰</option><option value="1px solid #64748b">细线 · 深灰</option><option value="2px solid #2563eb">粗线 · 蓝</option><option value="1px dashed #94a3b8">虚线</option><option value="none">无边框</option></select></label>}
    </div>
    {scope==='paragraph'&&<div className="callout-presets"><span>提示色块</span>{([['信息','info','#eff6ff','#2563eb'],['说明','note','#ecfdf5','#0f766e'],['注意','warning','#fff7ed','#c2410c']] as const).map(([label,tone,bg,line])=><button type="button" key={label} aria-pressed={callout===tone} style={{borderLeft:`3px solid ${line}`,background:bg}} onClick={()=>{setCallout(tone);setPatch(p=>({...p,'background-color':null,'border-left':null,padding:null}));}}>{label}</button>)}<button type="button" onClick={()=>{setCallout('clear');setPatch(p=>({...p,'background-color':null,'border-left':null,padding:null}));}}>清除色块</button></div>}
    <div className="property-actions"><button className="secondary" type="button" onClick={onDone}>取消</button><button className="primary" type="submit" disabled={!Object.keys(patch).length}>应用属性</button></div>
  </form>;
}
