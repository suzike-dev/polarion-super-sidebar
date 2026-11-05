import type {RunEvent} from '../../../packages/protocol/index';
export type ActivityStep={seq:number;at:number;title:string;name?:string;detail?:string;status:'unknown'|'completed'|'failed';durationMs?:number;summary?:string;legacy?:boolean;kind:'tool'|'attachment'|'command'|'steer'};
/**
 * 执行时间线：工具调用与附件读取、原生命令、引导打断统一成一条有序记录，
 * 避免在回答流里散落多行提示。需要按钮的操作（画板提案、草稿链接）仍留在时间线外。
 */
export function activitySteps(events:RunEvent[]):ActivityStep[]{
 const results=new Map(events.filter(e=>e.kind==='tool-result').map(e=>[(e.data as any).id,e.data as any]));
 const tools:ActivityStep[]=events.filter(e=>e.kind==='tool').map(e=>{const d=e.data as any,r=results.get(d.id);return{...d,seq:e.seq,at:e.at,title:d.title??(d.name==='Bash'?'执行本地命令':d.name==='Read'?'读取本地文件':d.name?.replace('mcp__polarion_drafts__','')),legacy:!d.title,status:r?.status??'unknown',durationMs:r?.durationMs,summary:r?.summary,kind:'tool'};});
 const extras:ActivityStep[]=events.flatMap<ActivityStep>(e=>{
  const d=e.data as any,at=e.at,seq=e.seq;
  switch(e.kind){
   case 'attachment-read': return [{seq,at,title:`读取附件 ${d.name}`,detail:d.truncated?'内容较长，已截断':'已提取文本',status:'completed' as const,kind:'attachment' as const,name:'read_attachment'}];
   case 'attachment-input': return [{seq,at,title:`传递图像 ${d.name}`,status:'completed' as const,kind:'attachment' as const,name:'image'}];
   case 'command-expanded': return [{seq,at,title:`加载原生命令 /${d.name}`,detail:d.source?`来源 ${d.source}`:undefined,status:'completed' as const,kind:'command' as const,name:'/'+d.name}];
   case 'command-completed': return [{seq,at,title:'原生命令已结束',status:'completed' as const,kind:'command' as const,name:String(d.command??'command')}];
   case 'steer': return [{seq,at,title:'收到引导输入，本轮提前收尾',status:'completed' as const,kind:'steer' as const,name:'steer'}];
   case 'steer-failed': return [{seq,at,title:'引导打断未送达，已按排队继续',detail:'本地 CLI 可能不支持打断；新输入会在本轮结束后发送',status:'completed' as const,kind:'steer' as const,name:'steer'}];
   default: return [];
  }
 });
 return [...tools,...extras].sort((a,b)=>a.seq-b.seq);
}
