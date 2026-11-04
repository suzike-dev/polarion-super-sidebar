import { query } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';
const abort = new AbortController(); let release;
const hold = new Promise(resolve => { release = resolve; });
async function* input() { await hold; }
const timer = setTimeout(() => { release(); abort.abort(); }, 45000);
const session = query({ prompt: input(), options: {
  cwd: path.join(process.env.LOCALAPPDATA, 'Nanju/PolarionSidebar/workspaces/test01'),
  pathToClaudeCodeExecutable: path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'), executable: 'node',
  settingSources: ['user','project','local'], abortController: abort,
  permissionMode: 'default', canUseTool: async () => ({ behavior:'deny', message:'Capability discovery only' }), stderr: () => {},
} });
try {
  const [commands, mcp, agents, models] = await Promise.all([session.supportedCommands(),session.mcpServerStatus(),session.supportedAgents(),session.supportedModels()]);
  const result = { at: new Date().toISOString(), commands:commands.map(c=>({name:c.name,builtin:!!c.builtin,aliases:c.aliases??[],description:c.description?.slice(0,180)})), mcp:mcp.map(s=>({name:s.name,status:s.status,tools:s.tools?.map(t=>t.name)??[]})), agents:agents.map(a=>({name:a.name})), models:models.map(m=>({value:m.value,displayName:m.displayName})) };
  await fs.mkdir('.research/s3',{recursive:true}); await fs.writeFile('.research/s3/claude-capabilities.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({commands:commands.length,builtins:result.commands.filter(c=>c.builtin).map(c=>c.name),mcp:result.mcp.map(s=>({name:s.name,status:s.status,tools:s.tools.length})),agents:agents.length,models:result.models}));
} finally { clearTimeout(timer); release(); session.close(); }
