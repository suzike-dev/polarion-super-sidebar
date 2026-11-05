import React, {useEffect, useRef, useState} from 'react';
import {RefreshCw, X} from 'lucide-react';
import type {EngineContext} from '../../../packages/protocol/index';
import {rpc} from '../lib/client';
import './context-meter.css';

const tokens = (n: number) => n.toLocaleString('zh-CN', {maximumFractionDigits: 0});
const short = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : tokens(n);
const labels: Record<string,string> = {'System prompt':'系统指令','System tools':'内置工具','MCP tools':'MCP 工具','Custom agents':'自定义 Agent','Memory files':'项目记忆','Skills':'Skills','Messages':'会话消息','Free space':'剩余空间','Autocompact buffer':'压缩预留','MCP instructions':'MCP 指令'};
// 剩余空间与压缩预留是“未使用”区，排在明细末尾并用中性底色，避免和已用分类争夺视线。
const trailing = new Set(['剩余空间', '压缩预留']);
const palette = ['#2f6db3', '#7c5cbf', '#3a8f75', '#c2843a', '#b3603f', '#5f8f3e', '#8f5f8f', '#3f8fa0', '#4a6fa5', '#a0633f'];
const special: Record<string,string> = {'剩余空间': 'var(--meter-free)', '压缩预留': 'var(--meter-buffer)'};
const colorOf = (label: string, index: number) => special[label] ?? palette[index % palette.length]!;

export function ContextMeter({sessionId, engine, busy, online}: {sessionId?:string; engine?:string; busy:boolean; online:boolean}) {
  const [state,setState] = useState<EngineContext|null>(null);
  const [open,setOpen] = useState(false), [loading,setLoading] = useState(false), [failed,setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
  // 悬停自动展开：短暂停留后打开，离开后延迟收起；进入面板本身会取消收起。
  const openNow = () => { clearTimeout(hoverTimer.current); setOpen(true); };
  useEffect(()=>{setState(null);setOpen(false);setFailed(false);setLoading(false);request.current++;},[sessionId,engine]);
  useEffect(()=>()=>clearTimeout(hoverTimer.current),[]);
  useEffect(()=>{
    void read();
    const timer = setInterval(()=>{if (!document.hidden) void read();},busy ? 4000 : 15000);
    return ()=>{clearInterval(timer);request.current++;};
  },[sessionId,engine,busy,online]);
  useEffect(()=>{
    if (!open) return;
    const outside = (event:PointerEvent) => {if (!event.composedPath().includes(root.current!)) setOpen(false);};
    document.addEventListener('pointerdown',outside);
    return ()=>{document.removeEventListener('pointerdown',outside);};
  },[open]);
  const usage = online ? state?.usage : null;
  const percent = usage ? Math.round(usage.percentage * 10) / 10 : null;
  const level = percent === null ? 'unknown' : percent >= 90 ? 'critical' : percent > 80 ? 'warning' : 'normal';
  const description = usage ? `上下文占用 ${percent}% · ${tokens(usage.usedTokens)} / ${tokens(usage.windowTokens)} tokens` : !online ? '本地服务未连接' : engine==='codex' ? 'Codex 上下文统计尚未接入' : !sessionId ? '发送第一条消息后显示上下文占用' : '上下文尚未读取，发送消息后更新';
  const visible = usage ? usage.categories.filter(c=>c.tokens>0&&c.kind!=='deferred') : [];
  const segments = visible
    .map((c,i)=>({name:labels[c.name]??c.name,tokens:c.tokens,color:colorOf(labels[c.name]??c.name,i),share:usage!.windowTokens>0?c.tokens/usage!.windowTokens*100:0}))
    .sort((a,b)=>(trailing.has(a.name)?1:0)-(trailing.has(b.name)?1:0)||b.tokens-a.tokens);
  const rawTotal = segments.reduce((sum,s)=>sum+s.share,0);
  const scale = rawTotal>100 ? 100/rawTotal : 1;
  const circumference = 2*Math.PI*24;
  return <div className="context-meter" ref={root} data-level={level}
    onMouseEnter={()=>{clearTimeout(hoverTimer.current);hoverTimer.current=setTimeout(()=>{openNow();void read();},180);}}
    onMouseLeave={()=>{clearTimeout(hoverTimer.current);hoverTimer.current=setTimeout(()=>setOpen(false),280);}}
    onKeyDown={event=>{if(open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <button ref={trigger} type="button" className="context-meter-trigger" title={description} aria-label={description} aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)void read();}}>
      <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true"><path className="meter-track" d="M 3.94 13.5 A 7 7 0 1 1 16.06 13.5"/><path className="meter-value" pathLength="100" strokeDasharray="100" strokeDashoffset={100-Math.max(0,Math.min(100,percent??0))} d="M 3.94 13.5 A 7 7 0 1 1 16.06 13.5"/></svg>
      <span>{state?.compacting ? '压缩中' : percent === null ? '—' : `${percent}%`}</span>
    </button>
    {open && <section className="context-meter-popover" aria-label="上下文占用详情">
      <header><strong>上下文占用</strong>{usage&&<small title={usage.model}>{short(usage.windowTokens)} 上下文窗口</small>}<button className="icon" title="关闭上下文详情" onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={15}/></button></header>
      {usage ? <>
        <div className="meter-hero">
          <svg className="meter-donut" width="60" height="60" viewBox="0 0 60 60" role="img" aria-label={`占用 ${percent}%`}>
            <circle className="donut-track" cx="30" cy="30" r="24"/>
            <circle className="donut-value" cx="30" cy="30" r="24" strokeDasharray={circumference} strokeDashoffset={circumference*(1-Math.min(100,percent!)/100)}/>
            <text x="30" y="34" textAnchor="middle">{percent}%</text>
          </svg>
          <div className="meter-hero-numbers">
            <strong>{tokens(usage.usedTokens)}<small> / {tokens(usage.windowTokens)} tokens</small></strong>
            <span className="meter-hero-remaining">剩余 {tokens(Math.max(0,usage.windowTokens-usage.usedTokens))} · {(100-percent!).toFixed(1)}%</span>
          </div>
        </div>
        <div className="meter-stack" aria-hidden="true">
          {segments.map(s=><i key={s.name} style={{width:(s.share*scale).toFixed(2)+'%',background:s.color}} title={`${s.name} ${tokens(s.tokens)}（${s.share.toFixed(1)}%）`}/>)}
          <b className="meter-tick" style={{left:'80%'}} title="80% 预警线"/>
          <b className="meter-tick critical" style={{left:'90%'}} title="90% 危险线"/>
        </div>
        <div className="meter-scale"><span>0%</span><span>压缩预警 80%</span><span>90%</span><span>100%</span></div>
        <ul className="meter-legend">
          {segments.map(s=><li key={s.name}><i className="dot" style={{background:s.color}}/><span className="name">{s.name}</span><em>{tokens(s.tokens)}</em><small>{s.share.toFixed(1)}%</small></li>)}
        </ul>
        <p className="context-meter-note">本地 Claude Code 估计值，按当前有效压缩窗口计算；不是累计用量或订阅额度。{busy?' 本轮执行中，显示最近一次快照。':''}</p>
        {state?.compacting&&<p role="status">正在压缩会话，完成后更新占用。</p>}
        {percent!>80&&!state?.compacting&&<p className="context-meter-advice">窗口接近占满，可通过 /compact 压缩会话后继续。</p>}
        <footer><span title={usage.model}>{new Date(usage.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} 更新</span><button disabled={loading||!state?.connected||!online} onClick={()=>void read(true)}><RefreshCw size={13} className={loading?'spinning':''}/>{loading?'读取中':'刷新'}</button></footer>
      </> : <div className="context-meter-empty"><p>{description}</p><small>未取得统计时不显示 0%，也不会为了统计额外启动模型会话。</small>{state?.connected&&<button disabled={loading} onClick={()=>void read(true)}>{loading?'正在读取…':'读取当前占用'}</button>}</div>}
      {failed&&<p className="context-meter-note" role="status">本次读取失败；已有数值保留为上次快照。</p>}
    </section>}
  </div>;
}
