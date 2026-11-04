import { query } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
const abort = new AbortController(); const timer = setTimeout(()=>abort.abort(),35000);
const q = query({ prompt:'/context',options:{cwd:path.join(process.env.LOCALAPPDATA,'Nanju/PolarionSidebar/workspaces/test01'),pathToClaudeCodeExecutable:path.join(process.env.APPDATA,'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'),executable:'node',settingSources:['user','project','local'],permissionMode:'default',abortController:abort,canUseTool:async()=>({behavior:'deny',message:'Native command probe'}),stderr:()=>{}}});
try { for await(const m of q) console.log(JSON.stringify({type:m.type,subtype:m.subtype,keys:Object.keys(m),isError:m.is_error,text:m.type==='result'?m.result?.slice(0,700):undefined})); }
catch(e){console.log({error:e.message?.slice(0,200)});process.exitCode=1;}finally{clearTimeout(timer);q.close();}
