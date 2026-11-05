import React,{useEffect,useMemo,useState} from 'react';
import {Check,ChevronDown,Clock,Loader2,AlertCircle,TerminalSquare,Paperclip,Square,MousePointer2} from 'lucide-react';
import type {Run,RunEvent} from '../../../packages/protocol/index';
import {activitySteps} from '../lib/activity';
const stepIcon=(kind?:string)=>{switch(kind){case 'attachment':return Paperclip;case 'command':return TerminalSquare;case 'steer':return Square;default:return MousePointer2;}};
export const Activity=React.memo(function Activity({run,events}:{run:Run;events:RunEvent[]}){
 const live=['running','waiting'].includes(run.status),[now,setNow]=useState(Date.now()),[open,setOpen]=useState(false);
 useEffect(()=>{if(!live)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[live]);
 const steps=useMemo(()=>activitySteps(events),[events]),pending=steps.filter(s=>s.status==='unknown'&&!s.legacy),last=pending.at(-1)??steps.at(-1),progress=events.filter(e=>e.kind==='progress').at(-1)?.data as any;
 const elapsed=Math.max(0,Math.floor(((run.endedAt??now)-run.startedAt)/1000));
 const duration=elapsed>=60?`${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`:`${elapsed} 秒`;
 const label=run.status==='queued'?'已排队，等待上一轮结束后自动开始':run.status==='waiting'?'等待你的确认':live?(pending.length?last?.title:steps.length?'正在分析结果':progress?.title??'正在连接智能体'):run.status==='completed'?'本轮已完成':run.status==='cancelled'?'任务已停止':run.status==='failed'?'任务执行失败':run.status==='interrupted'?'已被引导输入打断':'任务已中断';
 const statusIcon=run.status==='waiting'?<AlertCircle size={15}/>:live?<Loader2 size={15} className="spin"/>:run.status==='queued'?<Clock size={15}/>:run.status==='completed'?<Check size={15}/>:<AlertCircle size={15}/>;
 return <div className={'activity-card '+(live?'is-live':'')} aria-live="polite">
  <div className="activity-heading">{statusIcon}<strong>{label}</strong><span><Clock size={11}/>{duration}</span></div>
  {live&&<p className="activity-current">{last?.detail??progress?.detail??'正在读取当前请求'}{pending.length>1?` · 另有 ${pending.length-1} 项进行中`:''}</p>}
  {!live&&steps.some(s=>s.legacy)&&<p className="activity-note">此历史任务仅保存了工具名称，无法还原每次调用的内容与结果。</p>}
  {steps.length>0&&<div className="activity-timeline">
   <button type="button" className="activity-toggle" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><ChevronDown size={13} className={open?'flip':''}/>{steps.length} 次操作{open?' · 收起':' · 展开执行记录'}</button>
   {open&&<ol>{steps.map(s=>{const Icon=stepIcon(s.kind);return <li key={s.seq} data-status={s.status}><details><summary><span className="step-dot"/><Icon size={12} className="step-icon"/><span>{s.title}</span><small>{s.status==='completed'?'完成':s.status==='failed'?'失败':s.legacy?'历史记录':live?'处理中':'未收到结果'}</small></summary><div className="step-detail"><span><TerminalSquare size={12}/>{s.name}</span>{s.detail?<pre>{s.detail}</pre>:null}{s.summary?<p>{s.summary}{s.durationMs!=null?` · ${(s.durationMs/1000).toFixed(1)} 秒`:''}</p>:s.detail?null:<p>此记录没有保存参数详情。</p>}</div></details></li>;})}</ol>}
  </div>}
 </div>;
});
