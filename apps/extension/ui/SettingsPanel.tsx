import React, {useMemo, useState} from 'react';
import {ArrowLeft, BookOpen, Bot, ChevronRight, FileText, FolderOpen, KeyRound, MessageSquare, Pencil, Plus, SlidersHorizontal, Sparkles, Trash2, Type, X} from 'lucide-react';
import type {Guideline, GuidelineFile, GuidelineKind} from '../../../packages/protocol/index';
import {MAX_GUIDELINE_FILES, SettingsSchema} from '../../../packages/protocol/index';
import {PolarionAccount} from './PolarionAccount';
import {AssistantMarkdown} from './AssistantMarkdown';
import './settings-panel.css';

type AssistantSettings = ReturnType<typeof SettingsSchema.parse>;
type PanelTab = 'general' | 'appearance' | 'storage' | 'guidelines';

function Segmented<T extends string>({label,value,options,onChange,disabled}:{label:string;value:T;options:{value:T;label:string;hint:string}[];onChange:(value:T)=>void;disabled?:boolean}){
  return <div className="sp-field"><span className="sp-label">{label}</span>
    <div className="sp-seg" role="radiogroup" aria-label={label}>{options.map(option=><button key={option.value} type="button" role="radio" aria-checked={value===option.value} className={value===option.value?'on':''} title={option.hint} disabled={disabled} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div>
  </div>;
}

function GuidelineEditor({guideline,disabled,onBack,onChange,onRemove,onPickFiles}:{
  guideline:Guideline;disabled:boolean;onBack:()=>void;
  onChange:(patch:Partial<Guideline>)=>void;onRemove:()=>void;onPickFiles:()=>void;
}){
  const files=guideline.files??[];
  return <div className="sp-detail">
    <div className="sp-detail-head"><button type="button" className="sp-back" onClick={onBack}><ArrowLeft size={13}/>指令列表</button><span className="sp-detail-kind">{guideline.kind==='send'?<MessageSquare size={12}/>:<BookOpen size={12}/>}{guideline.kind==='send'?'随发送附加':'通用指令库'}</span><button type="button" className="sp-icon-btn danger" title="删除这条指令" disabled={disabled} onClick={onRemove}><Trash2 size={13}/></button></div>
    <label className="sp-field"><span className="sp-label">指令名</span><input maxLength={60} placeholder="如：写标准需求 / 需求排版美化 / 绘图规范" value={guideline.name} disabled={disabled} onChange={event=>onChange({name:event.target.value})}/></label>
    <label className="sp-field"><span className="sp-label">用途描述</span><input maxLength={200} placeholder="提示这个指令解决什么问题；随发送指令会显示在输入框提示里" value={guideline.description} disabled={disabled} onChange={event=>onChange({description:event.target.value})}/></label>
    <label className="sp-field"><span className="sp-label">指令正文 <small>Markdown，与本地文件内容一起生效</small></span><textarea rows={5} maxLength={60000} placeholder="直接写执行规范，或只挂本地文件" value={guideline.content} disabled={disabled} onChange={event=>onChange({content:event.target.value})}/></label>
    <div className="sp-files">
      <div className="sp-files-head"><span className="sp-label">本地文件 <small>每次使用重新读取，改文件无需改设置</small></span><button type="button" className="sp-add-file" disabled={disabled||files.length>=MAX_GUIDELINE_FILES} onClick={onPickFiles}><Plus size={12}/>选择文件</button></div>
      {files.length===0&&<p className="sp-empty">还没有文件。可多选 Markdown/文本文件，每个文件都能加备注。</p>}
      {files.map((file,index)=><div className="sp-filerow" key={file.path+index}>
        <FileText size={13}/>
        <div className="sp-filedoc"><strong title={file.path}>{file.path.split(/[\\/]/).pop()}</strong><span title={file.path}>{file.path}</span></div>
        <input className="sp-filenote" maxLength={80} placeholder="备注（例如：模板 v2）" aria-label="文件备注" value={file.label} disabled={disabled} onChange={event=>onChange({files:files.map((item,i)=>i===index?{...item,label:event.target.value}:item)})}/>
        <button type="button" className="sp-icon-btn danger" title="移除文件" disabled={disabled} onClick={()=>onChange({files:files.filter((_,i)=>i!==index)})}><X size={12}/></button>
      </div>)}
      <ManualPath placeholder="手动添加文件绝对路径，回车确认" disabled={disabled||files.length>=MAX_GUIDELINE_FILES} onAdd={path=>onChange({files:[...files,{path,label:''}].slice(0,MAX_GUIDELINE_FILES)})}/>
    </div>
  </div>;
}

/** 系统选择器不可用时的兜底：手动输入绝对路径。 */
function ManualPath({placeholder,disabled,onAdd}:{placeholder:string;disabled:boolean;onAdd:(path:string)=>void}){
  const [value,setValue]=useState('');
  const commit=()=>{const path=value.trim();if(!path)return;onAdd(path);setValue('');};
  return <div className="sp-manual"><input aria-label={placeholder} placeholder={placeholder} maxLength={1000} disabled={disabled} value={value} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();}}}/><button type="button" className="sp-btn" disabled={disabled||!value.trim()} onClick={commit}>添加</button></div>;
}

export function SettingsPanel({config,defaultFontSize,guidelines,loading,saving,error,initialTab='general',onConfig,onGuidelines,onSave,onClose,onPickFolder,onPickFiles}:{
  config:AssistantSettings|null;defaultFontSize:number;guidelines:Guideline[]|null;initialTab?:PanelTab;
  loading:boolean;saving:boolean;error:string;
  onConfig:(next:AssistantSettings)=>void;onGuidelines:(next:Guideline[])=>void;
  onSave:()=>void;onClose:()=>void;
  onPickFolder:(current:string)=>Promise<string|null>;onPickFiles:(id:string)=>Promise<GuidelineFile[]>;
}){
  const [panelTab,setPanelTab]=useState<PanelTab>(initialTab);
  const [kind,setKind]=useState<GuidelineKind>('send');
  const [openId,setOpenId]=useState<string|null>(null);
  const [picking,setPicking]=useState(false);
  const [folderPicking,setFolderPicking]=useState(false);
  const list=guidelines??[];
  const counts=useMemo(()=>({send:list.filter(g=>g.kind==='send').length,library:list.filter(g=>g.kind==='library').length}),[list]);
  const visible=useMemo(()=>list.filter(g=>g.kind===kind),[list,kind]);
  const open=list.find(g=>g.id===openId);
  const patch=(id:string,patchValue:Partial<Guideline>)=>onGuidelines(list.map(g=>g.id===id?{...g,...patchValue}:g));
  const add=()=>{const id=crypto.randomUUID();onGuidelines([...list,{id,kind,name:'',description:'',content:'',files:[],file:''}]);setOpenId(id);};
  const remove=(id:string)=>{if(!window.confirm('删除这条指令？点击「保存全部设置」后生效。'))return;onGuidelines(list.filter(g=>g.id!==id));setOpenId(null);};
  const pickFiles=async(id:string)=>{setPicking(true);try{const files=await onPickFiles(id);if(files.length)patch(id,{files:[...(list.find(g=>g.id===id)?.files??[]),...files].slice(0,MAX_GUIDELINE_FILES)});}finally{setPicking(false);}};
  const pickFolder=async()=>{if(!config)return;setFolderPicking(true);try{const path=await onPickFolder(config.draftsFolder);if(path)onConfig({...config,draftsFolder:path});}finally{setFolderPicking(false);}};
  const tabs:[PanelTab,string,React.ElementType][]=[['general','常规',Bot],['appearance','外观',Type],['storage','存储',FolderOpen],['guidelines','指令',Sparkles]];
  return <section className="settings sp-panel" aria-label="助手设置" aria-busy={loading||saving} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(openId)setOpenId(null);else onClose();}}}>
    <header className="settings-heading sp-header"><div className="sp-title"><span className="sp-title-mark"><SlidersHorizontal size={15}/></span><div><h3>助手设置</h3><small>账号 · 默认行为 · 预设指令 · 存储</small></div></div><button className="icon" title="关闭设置，放弃未保存的调整" aria-label="关闭设置" disabled={saving} autoFocus onClick={onClose}><X size={15}/></button></header>
    {loading&&<p className="muted sp-loading" role="status">正在读取设置…</p>}
    {config&&<>
      <nav className="sp-nav" role="tablist" aria-label="设置分类">{tabs.map(([key,label,Icon])=><button key={key} type="button" role="tab" aria-selected={panelTab===key} className={panelTab===key?'on':''} onClick={()=>setPanelTab(key)}><Icon size={13}/>{label}{key==='guidelines'&&list.length>0?<em>{list.length}</em>:null}</button>)}</nav>
      <div className="sp-scroll">
        {panelTab==='general'&&<>
          <div className="sp-card"><div className="sp-card-head"><span className="sp-icon"><KeyRound size={14}/></span><div><h4>Polarion 账号</h4><p>用于读取与保存工作项正文；密码只保存在本机。</p></div></div><PolarionAccount onBusy={()=>{}} onConnected={()=>{}}/></div>
          <div className="sp-card"><div className="sp-card-head"><span className="sp-icon"><Bot size={14}/></span><div><h4>会话默认</h4><p>保存后立即生效；新建或切换会话时应用，输入框旁仍可按轮更改。</p></div></div>
            <div className="sp-grid2">
              <label className="sp-field"><span className="sp-label">引擎</span><select value={config.defaultEngine} disabled={saving} onChange={event=>onConfig({...config,defaultEngine:event.target.value as AssistantSettings['defaultEngine']})}><option value="claude">Claude Code</option><option value="codex" disabled>Codex · 尚未接入</option></select></label>
              <label className="sp-field"><span className="sp-label">Claude 模型</span><input placeholder="跟随本地配置" maxLength={120} disabled={saving} value={config.claudeModel} onChange={event=>onConfig({...config,claudeModel:event.target.value})}/></label>
            </div>
            <Segmented label="批准方式" value={config.defaultPermissionMode} disabled={saving} onChange={value=>onConfig({...config,defaultPermissionMode:value})} options={[
              {value:'ask',label:'请求批准',hint:'读取与草稿操作自动，其他逐次确认'},
              {value:'auto',label:'自动批准',hint:'命令与工具直接执行，文件编辑限项目工作区'},
              {value:'full',label:'完全访问',hint:'不再询问；Polarion 写回仍需明确保存'},
            ]}/>
            <Segmented label="运行中新输入" value={config.defaultTurnDelivery} disabled={saving} onChange={value=>onConfig({...config,defaultTurnDelivery:value})} options={[
              {value:'queue',label:'排队',hint:'当前任务结束后自动作为下一轮发送'},
              {value:'steer',label:'引导',hint:'打断当前任务，优先处理新输入'},
            ]}/>
            <label className="sp-field"><span className="sp-label">变体链接角色 <small>变体工作项 → 主工作项的 Polarion 链接；留空时首次创建自动选择</small></span><input placeholder="例如 parent / relates_to" maxLength={120} disabled={saving} value={config.variantLinkRole} onChange={event=>onConfig({...config,variantLinkRole:event.target.value})}/></label>
          </div>
        </>}
        {panelTab==='appearance'&&<div className="sp-card"><div className="sp-card-head"><span className="sp-icon"><Type size={14}/></span><div><h4>回答外观</h4><p>只影响 AI 回答，不改变需求正文。</p></div></div>
          <div className="sp-font">
            <div className="sp-font-scale">{[9,10,11,12,13,14,15,16,17,18].map(size=><button key={size} type="button" className={config.assistantFontSize===size?'on':''} disabled={saving} onClick={()=>onConfig({...config,assistantFontSize:size})}>{size}<small>px</small></button>)}</div>
            <button type="button" className="sp-link" disabled={saving||config.assistantFontSize===defaultFontSize} onClick={()=>onConfig({...config,assistantFontSize:defaultFontSize})}>恢复默认 {defaultFontSize}px</button>
          </div>
          <div className="sp-font-preview" aria-label="AI 回答字号预览"><AssistantMarkdown text={'### 回答预览\n需求分析保留清晰层级，参数 `setpoint` 与正文一起调整。'}/></div>
        </div>}
        {panelTab==='storage'&&<div className="sp-card"><div className="sp-card-head"><span className="sp-icon"><FolderOpen size={14}/></span><div><h4>共享草稿存储</h4><p>默认放在内部数据库；选择文件夹后保存为可备份、可迁移的 JSON 文件。</p></div></div>
          <div className="sp-folder-card">
            <span className="sp-folder-icon"><FolderOpen size={15}/></span>
            <div className="sp-folder-path"><strong>{config.draftsFolder.trim()?'自定义文件夹':'内部数据库（默认）'}</strong><span title={config.draftsFolder}>{config.draftsFolder.trim()||'不占用额外文件，随本地状态库一起保存'}</span></div>
            <div className="sp-folder-actions">
              <button type="button" className="sp-btn" disabled={saving||folderPicking} onClick={()=>void pickFolder()}>{folderPicking?'等待选择…':'选择文件夹…'}</button>
              {!!config.draftsFolder.trim()&&<button type="button" className="sp-link" disabled={saving} onClick={()=>onConfig({...config,draftsFolder:''})}>恢复默认</button>}
            </div>
          </div>
          <p className="sp-note">保存时自动迁移现有草稿；迁移失败保留原存储。仅本地草稿，不影响 Polarion 服务端。</p>
          <ManualPath placeholder="手动输入文件夹绝对路径，回车确认" disabled={saving} onAdd={path=>onConfig({...config,draftsFolder:path})}/>
        </div>}
        {panelTab==='guidelines'&&<div className="sp-card sp-guide-card">
          {open?<GuidelineEditor guideline={open} disabled={saving||picking} onBack={()=>setOpenId(null)} onChange={patchValue=>patch(open.id,patchValue)} onRemove={()=>remove(open.id)} onPickFiles={()=>void pickFiles(open.id)}/>:<>
            <div className="sp-card-head"><span className="sp-icon"><Sparkles size={14}/></span><div><h4>预设指令</h4><p>「随发送附加」在输入框选中后随消息发送；「通用指令库」由助手按需求自动查阅。</p></div></div>
            <div className="sp-tabs" role="tablist">{(['send','library'] as const).map(key=><button key={key} type="button" role="tab" aria-selected={kind===key} className={kind===key?'on':''} onClick={()=>setKind(key)}>{key==='send'?<MessageSquare size={13}/>:<BookOpen size={13}/>}{key==='send'?'随发送附加':'通用指令库'}<em>{counts[key]}</em></button>)}</div>
            <div className="sp-list">
              {visible.length===0&&<p className="sp-empty">这个分组还没有指令。点击下方按钮新增。</p>}
              {visible.map(guideline=><button type="button" key={guideline.id} className="sp-row" onClick={()=>setOpenId(guideline.id)}>
                <span className="sp-row-badge">{guideline.kind==='send'?<MessageSquare size={12}/>:<BookOpen size={12}/>}</span>
                <span className="sp-row-text"><strong>{guideline.name||'未命名指令'}</strong><small>{[guideline.description,(guideline.files??[]).length?`${guideline.files.length} 个文件`:'',guideline.content.trim()?`${guideline.content.trim().length} 字`:''].filter(Boolean).join(' · ')||'尚未填写内容'}</small></span>
                <Pencil size={12} className="sp-row-edit"/><ChevronRight size={13} className="sp-row-arrow"/>
              </button>)}
            </div>
            <button type="button" className="sp-add-guide" disabled={saving} onClick={add}><Plus size={14}/>新增{kind==='send'?'随发送指令':'通用指令'}</button>
          </>}
        </div>}
      </div>
    </>}
    {error&&<p className="inline-error sp-error" role="alert">{error}</p>}
    <footer className="settings-actions sp-footer"><button className="secondary" disabled={saving} onClick={onClose}>取消</button>{config&&<button className="primary" disabled={saving} onClick={onSave}>{saving?'正在保存…':'保存全部设置'}</button>}</footer>
  </section>;
}
