export function redact(value:unknown,limit=600){return String(value??'').replace(/((?:authorization|cookie|token|secret|password|api[_-]?key)\s*["']?\s*[:=]\s*["']?)[^\s,;"']+/gi,'$1[redacted]').replace(/\b(?:sk-[\w-]{12,}|Bearer\s+[^\s"']+)/gi,'[redacted]').slice(0,limit);}
export function toolPresentation(name:string,input:Record<string,unknown>,workItem?:string){
 const n=name.replace('mcp__polarion_drafts__','');const object=String(input.workItemId??workItem??'当前工作项');
 const labels:Record<string,string>={context:'确认本轮选区与目标',open_work_item:`读取工作项 ${object}`,read_draft:`读取 ${object} 的本地草稿`,read_rich_document:`读取 ${object} 的文档结构`,replace_text:`修改 ${object} 的文字`,update_rich_document:`更新 ${object} 的富文本草稿`,format_text:`调整 ${object} 的文字格式`,read_attachment:'读取对话附件',Read:'读取本地文件',Glob:'查找本地文件',Grep:'搜索文件内容',Skill:'加载本机 Skill',ToolSearch:'查找可用工具',Bash:'执行本地命令',AskUserQuestion:'需要你补充信息'};
 const detail=n==='Bash'?input.command:n==='Read'||n==='Edit'||n==='Write'?input.file_path:n==='Grep'||n==='Glob'?input.pattern:n==='Skill'?input.skill:input.workItemId??input.draftId??input.assetId??input.query;
 return {title:redact(typeof input.description==='string'&&/[\u4e00-\u9fff]/.test(input.description)?input.description:labels[n]??`调用 ${n}`,140),detail:redact(detail),name,workItemId:workItem};
}
