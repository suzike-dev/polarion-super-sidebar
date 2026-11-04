import React, { useEffect, useRef, useState } from 'react';
import {filterCommands} from '../lib/commands';
import { RefreshCw, X, Search, TerminalSquare, Blocks, Sparkles, ChevronRight } from 'lucide-react';
import type { EngineCapabilities } from '../../../packages/protocol/index';
export function CapabilitiesPanel({ value, loading, error, connected, onManage, onRefresh, onCommand, onClose }: { value: EngineCapabilities | null; loading: boolean; error: string; connected:boolean; onManage:(action:'reload-skills'|'reconnect-mcp',server?:string)=>void; onRefresh: () => void; onCommand: (command: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState('commands'), [filter, setFilter] = useState('');
  const search=useRef<HTMLInputElement>(null);
  useEffect(()=>{search.current?.focus();},[]);
  const commands = filterCommands(value?.commands.filter(c => tab === 'skills' ? !c.builtin : c.builtin) ?? [], filter);
  const status: Record<string,string> = { connected: '已连接', pending: '连接中', failed: '连接失败', 'needs-auth': '需要登录', disabled: '已停用' };
  return <section className="capabilities-panel" aria-label="Claude Code 原生能力" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}><header><div><strong>Claude Code</strong><small>本机命令 · Skills · MCP</small></div><button className="icon" title="重新读取本机能力" disabled={loading} onClick={onRefresh}><RefreshCw size={15} className={loading ? 'spin' : ''}/></button><button className="icon" title="关闭原生能力面板" onClick={onClose}><X size={16}/></button></header>
    <nav>{[['commands','命令',TerminalSquare],['skills','Skills',Sparkles],['mcp','MCP',Blocks]].map(([key,label,Icon]:any)=><button key={key} className={tab===key?'selected':''} onClick={()=>setTab(key)}><Icon size={13}/>{label}<small>{key==='mcp'?value?.servers.length:value?.commands.filter(c=>key==='skills'?!c.builtin:c.builtin).length}</small></button>)}</nav>
    <label className="capability-search"><Search size={14}/><input ref={search} aria-label="搜索本机能力" placeholder={tab==='mcp'?'搜索服务器或工具…':'搜索名称、描述与别名…'} value={filter} onChange={e=>setFilter(e.target.value)}/></label>
    {error&&<p className="inline-error">{error}</p>}
    {tab==='skills'&&<div className="capability-actions"><button className="secondary" disabled={!connected||loading} onClick={()=>onManage('reload-skills')}>重载当前会话 Skills</button></div>}
    {tab==='mcp'&&<div className="capability-actions"><select aria-label="选择需要重连的 MCP" defaultValue="" disabled={!connected||loading} onChange={e=>{if(e.target.value)onManage('reconnect-mcp',e.target.value);e.target.value='';}}><option value="">重连当前会话的 MCP…</option>{value?.servers.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</select></div>}
    <div className="capability-list">{!loading&&tab!=='mcp'&&!commands.length&&<p className="muted">没有匹配的本机命令或 Skill。</p>}{loading&&!value?<p className="muted">正在读取本地 Claude Code 的实际配置…</p>:tab==='mcp'?value?.servers.filter(s=>`${s.name} ${s.tools.map(t=>t.name).join(' ')}`.toLowerCase().includes(filter.toLowerCase())).map(s=><details key={s.name}><summary><i className={'mcp-status '+s.status}/><strong>{s.name}</strong><small>{status[s.status]??s.status} · {s.tools.length} 工具</small></summary>{s.tools.map(t=><div className="mcp-tool" key={t.name}><code>{t.name}</code><p>{t.description}</p></div>)}{!s.tools.length&&<p className="muted">尚未取得工具清单；此状态来自最近一次原生运行时读取。</p>}</details>):commands.map(c=><button className="command-item" key={c.name} onClick={()=>onCommand('/'+c.name+' ')}><div><strong>/{c.name}</strong>{c.argumentHint&&<code>{c.argumentHint}</code>}<p>{c.description}</p></div><ChevronRight size={13}/></button>)}</div>
    <footer>{tab!=='mcp'&&<div>{commands.length} 项匹配</div>}{value?`${connected?'已连接的当前会话':'最近运行时快照'} · ${new Date(value.at).toLocaleTimeString()} · ${value.agents.length} 个原生 Agent`:'读取过程不发送模型请求'}{!connected&&<div>下次任务启动时重新读取本机配置</div>}</footer>
  </section>;
}
