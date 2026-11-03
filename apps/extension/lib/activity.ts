import type {RunEvent} from '../../../packages/protocol/index';
export function activitySteps(events:RunEvent[]){
 const results=new Map(events.filter(e=>e.kind==='tool-result').map(e=>[(e.data as any).id,e.data as any]));
 return events.filter(e=>e.kind==='tool').map(e=>{const d=e.data as any,r=results.get(d.id);return{...d,seq:e.seq,at:e.at,title:d.title??(d.name==='Bash'?'执行本地命令':d.name==='Read'?'读取本地文件':d.name?.replace('mcp__polarion_drafts__','')),legacy:!d.title,status:r?.status??'unknown',durationMs:r?.durationMs,summary:r?.summary};});
}
