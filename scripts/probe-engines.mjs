import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
const cwd = path.resolve(import.meta.dirname, '..');
const out = path.join(cwd, '.research/s1');
await fs.mkdir(out, { recursive: true });
const phrase = 'amber-finch-731';
const firstPrompt = `Local integration capability test. Do not use any tools or read/write files. Remember the test phrase ${phrase} for my next message and reply with S1_READY only.`;
const secondPrompt = 'What was the exact test phrase in my previous message? Do not use tools. Reply with only the phrase.';
let summary;try {summary=JSON.parse(await fs.readFile(path.join(out,'engine-resume.json'),'utf8'));}catch {summary={ at: new Date().toISOString(), scope: 'two short inference turns per engine, restart then resume; no file or Polarion actions', engines: {} };}

function startCodex() {
  const child = spawn('C:/Users/Lenovo/AppData/Local/OpenAI/CodexCLI/0.142.5/codex.exe', ['app-server'], { cwd, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const pending = new Map(); let seq = 0; const messages = []; const watchers = new Set();
  const send = obj => child.stdin.write(JSON.stringify(obj) + '\n');
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let obj; try { obj=JSON.parse(line); } catch { return; }
    if (obj.id !== undefined && obj.method) { send({ id:obj.id, error:{ code:-32601, message:'Capability probe does not allow tool requests' } }); return; }
    if (obj.id !== undefined) { const p=pending.get(obj.id); if(p){pending.delete(obj.id);clearTimeout(p.timer);obj.error?p.reject(Error('RPC '+p.method+': '+obj.error.message)):p.resolve(obj.result);} return; }
    messages.push(obj); for(const fn of watchers)fn(obj);
  });
  child.stderr.resume();
  const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq; const timer=setTimeout(()=>{pending.delete(id);reject(Error('RPC timeout: '+method));},90000);pending.set(id,{resolve,reject,timer,method});send({id,method,params});});
  const completed=(threadId,from)=>new Promise((resolve,reject)=>{
    const ready=messages.slice(from).find(m=>m.method==='turn/completed'&&m.params?.threadId===threadId);if(ready){resolve(ready);return;}
    const timer=setTimeout(()=>{watchers.delete(fn);reject(Error('Turn timeout'));},180000);
    const fn=m=>{if(m.method==='turn/completed'&&m.params?.threadId===threadId){clearTimeout(timer);watchers.delete(fn);resolve(m);}};watchers.add(fn);
  });
  const stop=async()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Probe closed'));}pending.clear();await new Promise(resolve=>{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('exit',resolve);killer.once('error',()=>{child.kill();resolve();});});lines.close();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();};
  return {request,send,messages,completed,stop};
}
async function codex() {
  let api=startCodex(); let sessionId; const turns=[];
  try {
    const init=await api.request('initialize',{clientInfo:{name:'polarion_sidebar_s1',version:'0.1.0'}});api.send({method:'initialized'});
    const requestedModel=process.env.POLARION_PROBE_MODEL;
    const started=await api.request('thread/start',{cwd,sandbox:'read-only',approvalPolicy:'never',ephemeral:false,...(requestedModel?{model:requestedModel}:{}),developerInstructions:'This is an integration probe. No tools or external actions. Answer the two test messages only.'});
    sessionId=started.thread.id;
    const run=async(prompt)=>{const index=api.messages.length;const at=Date.now();const result=await api.request('turn/start',{threadId:sessionId,input:[{type:'text',text:prompt}],effort:'low'});const done=await api.completed(sessionId,index);const events=api.messages.slice(index);const texts=events.filter(m=>m.method==='item/completed'&&m.params?.item?.type==='agentMessage').map(m=>m.params.item.text);return {id:result.turn?.id,status:done.params.turn.status,elapsed_ms:Date.now()-at,text:texts.join('\n'),error:done.params.turn.error,event_types:[...new Set(events.map(m=>m.method))]};};
    turns.push(await run(firstPrompt));
    if(turns[0].status==='failed')return{status:'inference_failed',protocol:'app-server',native_session_id:sessionId,model:started.model,provider:started.modelProvider,turns};
    await api.stop();api=startCodex();await api.request('initialize',{clientInfo:{name:'polarion_sidebar_s1',version:'0.1.0'}});api.send({method:'initialized'});
    await api.request('thread/resume',{threadId:sessionId,cwd,sandbox:'read-only',approvalPolicy:'never'});
    turns.push(await run(secondPrompt));
    return {status:turns.some(t=>t.status==='failed')?'inference_failed':turns[1].text.trim()===phrase?'resume_pass':'unexpected_reply',protocol:'app-server',native_session_id:sessionId,model:started.model,provider:started.modelProvider,configuration_sources:started.instructionSources??[],turns};
  } finally { await api.stop(); }
}
function claudeTurn(prompt,sessionId) {
  return new Promise((resolve,reject)=>{
    const args=['-p',prompt,'--output-format','stream-json','--include-partial-messages','--verbose','--setting-sources','user,project,local'];if(sessionId)args.push('--resume',sessionId);
    const at=Date.now();const child=spawn('C:/Users/Lenovo/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const kinds=new Set();let result;let init;
    const lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{let obj;try{obj=JSON.parse(line);}catch{return;}kinds.add(obj.type+(obj.subtype?'/'+obj.subtype:''));if(obj.type==='system'&&obj.subtype==='init')init={session_id:obj.session_id,model:obj.model,tool_count:obj.tools?.length,mcp_count:obj.mcp_servers?.length,skill_count:obj.skills?.length,permission_mode:obj.permissionMode};if(obj.type==='result')result=obj;});
    child.stderr.resume();const timer=setTimeout(()=>{child.kill();reject(Error('Claude capability probe timed out'));},180000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);lines.close();resolve({code,elapsed_ms:Date.now()-at,init,session_id:result?.session_id??init?.session_id,text:result?.is_error?'[Engine reported an error]':result?.result,is_error:result?.is_error??!result,event_types:[...kinds]});});
  });
}
async function claude() { const one=await claudeTurn(firstPrompt);if(one.is_error||!one.session_id)return{status:'first_turn_failed',turns:[one]};const two=await claudeTurn(secondPrompt,one.session_id);return {status:two.text?.trim()===phrase?'resume_pass':'unexpected_reply',protocol:'CLI stream-json',native_session_id:one.session_id,turns:[one,two]}; }
if (process.argv[2]==='codex-models') {
  const api=startCodex();
  try {await api.request('initialize',{clientInfo:{name:'polarion_sidebar_s1',version:'0.1.0'}});api.send({method:'initialized'});const listed=await api.request('model/list',{limit:100});const models=listed.data.map(m=>({id:m.id,model:m.model,displayName:m.displayName,isDefault:m.isDefault}));await fs.writeFile(path.join(out,'codex-models.json'),JSON.stringify(models,null,2));console.log(JSON.stringify(models));}finally{await api.stop();}process.exit(0);
}
if (process.argv[2]==='codex-diagnose') {
  const prior=JSON.parse(await fs.readFile(path.join(out,'engine-resume.json'),'utf8'));
  const api=startCodex();
  try {
    await api.request('initialize',{clientInfo:{name:'polarion_sidebar_s1',version:'0.1.0'}});api.send({method:'initialized'});
    const read=await api.request('thread/read',{threadId:prior.engines.codex.native_session_id,includeTurns:true});
    const failures=read.thread.turns.map(t=>({status:t.status,error:t.error}));
    await fs.writeFile(path.join(out,'codex-failures.json'),JSON.stringify(failures,null,2));console.log(JSON.stringify(failures));
  } finally { await api.stop(); }
  process.exit(0);
}
for(const [name,fn] of Object.entries({codex,claude}).filter(([name])=>!process.argv[2]||process.argv[2]===name)) {
  console.log(JSON.stringify({engine:name,phase:'started'}));
  try {summary.engines[name]=await fn();}catch(error){summary.engines[name]={status:'failed',reason:error.message.replace(/(token|secret|password|cookie|authorization)\s*[:=]\s*\S+/gi,'$1=[redacted]')};}
  await fs.writeFile(path.join(out,'engine-resume.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({engine:name,...summary.engines[name]}));
}
