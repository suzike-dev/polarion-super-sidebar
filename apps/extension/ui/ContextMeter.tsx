import React, {useEffect, useRef, useState} from 'react';
import {RefreshCw, X} from 'lucide-react';
import type {EngineContext} from '../../../packages/protocol/index';
import {rpc} from '../lib/client';
import './context-meter.css';

const tokens = (n: number) => n.toLocaleString('zh-CN', {maximumFractionDigits: 0});
const short = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : tokens(n);
const labels: Record<string,string> = {'System prompt':'系统指令','System tools':'内置工具','MCP tools':'MCP 工具','Custom agents':'自定义 Agent','Memory files':'项目记忆','Skills':'Skills','Messages':'会话消息','Free space':'剩余空间','Autocompact buffer':'压缩预留','MCP instructions':'MCP 指令'};

export function ContextMeter({sessionId, engine, busy, online}: {sessionId?:string; engine?:string; busy:boolean; online:boolean}) {
  const [state,setState] = useState<EngineContext|null>(null);
  const [open,setOpen] = useState(false), [loading,setLoading] = useState(false), [failed,setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const identity = useRef(sessionId); identity.current = sessionId;
  const request = useRef(0);
  const read = async (refresh = false) => {
    if (!sessionId || engine === 'codex' || !online) return;
    const id = sessionId, ticket = ++request.current;
    if (refresh) setLoading(true);
    try {
      const value = await rpc<EngineContext>({method:'engine.context',sessionId:id,refresh});
      if (identity.current === id && ticket === request.current) {setState(value);setFailed(false);}
    } catch {if (identity.current === id && ticket === request.current) setFailed(true);}
    finally {if (identity.current === id && refresh) setLoading(false);}
  };
  useEffect(()=>{setState(null);setOpen(false);setFailed(false);setLoading(false);request.current++;},[sessionId,engine]);
  useEffect(()=>{
    void read();
    const timer = setInterval(()=>{if (!document.hidden) void read();},busy ? 4000 : 15000);
    return ()=>{clearInterval(timer);request.current++;};
  },[sessionId,engine,busy,online]);
  useEffect(()=>{
    if (!open) return;
    const outside = (event:PointerEvent) => {if (!event.composedPath().includes(root.current!)) setOpen(false);};
    const escape = (event:KeyboardEvent) => {if (event.key==='Escape') {event.preventDefault();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const usage = online ? state?.usage : null;
  const percent = usage ? Math.round(usage.percentage * 10) / 10 : null;
  const level = percent === null ? 'unknown' : percent >= 90 ? 'critical' : percent > 80 ? 'warning' : 'normal';
  const description = usage ? `上下文占用 ${percent}% · ${tokens(usage.usedTokens)} / ${tokens(usage.windowTokens)} tokens` : !online ? '本地服务未连接' : engine==='codex' ? 'Codex 上下文统计尚未接入' : !sessionId ? '发送第一条消息后显示上下文占用' : '上下文尚未读取，发送消息后更新';
  return <div className="context-meter" ref={root} data-level={level}>
    <button ref={trigger} type="button" className="context-meter-trigger" title={description} aria-label={description} aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)void read();}}>
      <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true"><path className="meter-track" d="M 3.94 13.5 A 7 7 0 1 1 16.06 13.5"/><path className="meter-value" pathLength="100" strokeDasharray="100" strokeDashoffset={100-Math.max(0,Math.min(100,percent??0))} d="M 3.94 13.5 A 7 7 0 1 1 16.06 13.5"/></svg>
      <span>{state?.compacting ? '压缩中' : percent === null ? '—' : `${percent}%`}</span>
    </button>
    {open && <section className="context-meter-popover" aria-label="上下文占用详情">
      <header><strong>上下文占用</strong><button className="icon" title="关闭上下文详情" onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={15}/></button></header>
      {usage ? <>
        <div className="context-meter-total"><strong>{short(usage.usedTokens)}<small> / {short(usage.windowTokens)} tokens</small></strong><span>{percent}%</span></div>
        <div className="context-meter-bar" role="meter" aria-label="有效上下文窗口占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,percent!)} aria-valuetext={description}><i style={{width:Math.min(100,percent!)+'%'}}/></div>
        <dl className="context-meter-breakdown">{usage.categories.filter(c=>c.tokens>0&&c.kind!=='deferred').map((c,i)=><div key={i}><dt>{labels[c.name]??c.name}</dt><dd>{tokens(c.tokens)}</dd></div>)}</dl>
        <p className="context-meter-note">本地 Claude Code 估计值，按当前有效压缩窗口计算；不是累计用量或订阅额度。{busy?' 本轮执行中，显示最近一次快照。':''}</p>
        {state?.compacting&&<p role="status">正在压缩会话，完成后更新占用。</p>}
        {percent!>80&&!state?.compacting&&<p className="context-meter-advice">窗口接近占满，可通过 /compact 压缩会话后继续。</p>}
        <footer><span title={usage.model}>{new Date(usage.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} 更新</span><button disabled={loading||!state?.connected||!online} onClick={()=>void read(true)}><RefreshCw size={13} className={loading?'spinning':''}/>{loading?'读取中':'刷新'}</button></footer>
      </> : <div className="context-meter-empty"><p>{description}</p><small>未取得统计时不显示 0%，也不会为了统计额外启动模型会话。</small>{state?.connected&&<button disabled={loading} onClick={()=>void read(true)}>{loading?'正在读取…':'读取当前占用'}</button>}</div>}
      {failed&&<p className="context-meter-note" role="status">本次读取失败；已有数值保留为上次快照。</p>}
    </section>}
  </div>;
}
