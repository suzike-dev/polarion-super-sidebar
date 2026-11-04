import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { Engines } from './engine.ts';
import { Drafts } from './polarion.ts';
import type {query,Query} from '@anthropic-ai/claude-agent-sdk';
test('sequential turns reuse native runtime, bind fresh target, and reconnect only after configuration change',async()=>{
 const store=new Store(':memory:'),drafts=new Drafts(store,{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');}});let starts=0,closed=0;const prompts:string[]=[];
 const factory:typeof query=({prompt})=>{
  starts++;const nativeId='native-'+starts;
  async function* messages(){yield {type:'system',subtype:'init',session_id:nativeId,model:'test',tools:[],mcp_servers:[]};for await(const value of prompt as AsyncIterable<any>){prompts.push(JSON.stringify(value.message.content));yield{type:'result',subtype:'success',is_error:false,session_id:nativeId,result:'ok',duration_ms:1,num_turns:1};}}
  const stream=messages() as unknown as Query;stream.close=()=>{closed++;void stream.return();};stream.supportedCommands=async()=>[];stream.supportedAgents=async()=>[];stream.supportedModels=async()=>[];stream.mcpServerStatus=async()=>[];return stream;
 };
 const engines=new Engines(store,drafts,undefined,factory),target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/A'},session=store.createSession(target,'warm session');
 const first=store.startRun(session.id,crypto.randomUUID(),'inspect first',[]).run;await engines.execute(first);assert.equal(first.status,'completed');assert.equal(starts,1);assert.equal(closed,0);
 const second=store.startRun(session.id,crypto.randomUUID(),'inspect second',[],{...target,document:'Requirements/B'}).run;await engines.execute(second);assert.equal(second.status,'completed');assert.equal(starts,1);assert.match(prompts[1]!,/Requirements\/B/);assert.equal((store.events(session.id,0).find(e=>e.runId===second.id&&e.kind==='progress')!.data as any).reused,true);
 const third=store.startRun(session.id,crypto.randomUUID(),'inspect third',[],target,[],'full').run;await engines.execute(third);assert.equal(third.status,'completed');assert.equal(starts,2);assert.equal(closed,1);engines.close();assert.equal(closed,2);store.close();
});
test('a late permission denial cannot revive a cancelled run', async () => {
  const store = new Store(':memory:');
  const drafts = new Drafts(store, { read: async () => { throw Error('not used'); }, save: async () => { throw Error('not used'); } });
  const engines = new Engines(store, drafts);
  const session = store.createSession({ origin: 'https://polarion.pufafen.com', projectId: 'test01', document: 'Requirements/fixture' }, 'test');
  const { run } = store.startRun(session.id, crypto.randomUUID(), 'test', []);
  const controller = new AbortController(); engines.active.set(run.id, controller);
  const pending = engines.permission(run, 'Bash', { command: 'echo test' }, controller.signal);
  assert.equal(run.status, 'waiting'); run.status = 'cancelled'; store.put('run', run.id, run); controller.abort();
  assert.equal(await pending, false); assert.equal(store.require<any>('run', run.id).status, 'cancelled');
  assert.equal(engines.permissions.size, 0); store.close();
});

function commandFixture(scripts:((input:any,nativeId:string)=>any[])[]){
 const store=new Store(':memory:'),drafts=new Drafts(store,{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');}});
 const received:any[]=[],resumes:(string|undefined)[]=[];let closed=0,reloads=0,reconnects=0,script=0;
 const factory:typeof query=({prompt,options})=>{
  resumes.push(options?.resume);const nativeId=options?.resume??'native-before-clear';
  async function* messages(){yield{type:'system',subtype:'init',session_id:nativeId,model:'test',tools:[],mcp_servers:[]};for await(const input of prompt as AsyncIterable<any>){received.push(input);yield*scripts[script++]!(input,nativeId);}}
  const stream=messages() as unknown as Query;stream.close=()=>{closed++;void stream.return();};
  stream.supportedCommands=async()=>[];stream.supportedAgents=async()=>[];stream.supportedModels=async()=>[];stream.mcpServerStatus=async()=>[{name:'fixture',status:'connected',tools:[]}] as any;
  stream.reloadSkills=async()=>{reloads++;return{skills:[]};};stream.reconnectMcpServer=async()=>{reconnects++;};
  stream.getContextUsage=async()=>({totalTokens:100,rawMaxTokens:1000,percentage:10,model:'test',categories:[]}) as any;
  return stream;
 };
 const engines=new Engines(store,drafts,undefined,factory),target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/fixture'},session=store.createSession(target,'before clear');
 return{store,engines,session,received,resumes,get closed(){return closed;},get reloads(){return reloads;},get reconnects(){return reconnects;},async turn(prompt:string){const run=store.startRun(session.id,crypto.randomUUID(),prompt,[]).run;await engines.execute(run);return run;},close(){engines.close();store.close();}};
}
const result=(input:any,id:string,text='ok')=>({type:'result',subtype:'success',is_error:false,session_id:id,user_message_uuid:input.uuid,result:text,duration_ms:1,num_turns:1});
test('local command output is retained when result is empty and an idle warm runtime remains manageable',async()=>{
 const f=commandFixture([(input,id)=>[{type:'system',subtype:'local_command_output',session_id:id,content:'Local usage: 10%'},result(input,id,'')]]);
 try{const run=await f.turn('/usage');assert.equal(run.status,'completed');assert.equal(f.engines.active.size,0);assert.equal(f.engines.runtimes.size,1);assert.equal(f.closed,0);
  assert.equal((f.store.events(f.session.id,0).find(e=>e.kind==='local-command-output')!.data as any).text,'Local usage: 10%');
  assert.equal((await f.engines.manage(f.session.id,'reload-skills')).connected,true);assert.equal(f.reloads,1);
  assert.equal((await f.engines.manage(f.session.id,'reconnect-mcp','fixture')).connected,true);assert.equal(f.reconnects,1);
 }finally{f.close();}
});
test('clear without result completes on its own lifecycle, retains history, and resumes the new native ID without consuming the old result',async()=>{
 const freshId='native-after-clear';
 const f=commandFixture([(input,id)=>[result(input,id,'remembered')],(input,id)=>[
  {type:'conversation_reset',new_conversation_id:freshId,session_id:id,trigger:'clear'},
  {type:'command_lifecycle',command_uuid:'unrelated',state:'completed'},
  {type:'system',subtype:'local_command_output',session_id:id,content:'Conversation cleared'},
  {type:'command_lifecycle',command_uuid:input.uuid,state:'completed'},result(input,id,'stale trailing result')
 ],(input,id)=>[result(input,id,'fresh answer')]]);
 try{const first=await f.turn('remember a fixture');await f.engines.contextUsage.read(f.session.id,true);assert.ok((await f.engines.contextUsage.read(f.session.id)).usage);
  const clear=await f.turn('/clear');assert.equal(clear.status,'completed');assert.equal(f.closed,1);assert.equal(f.engines.runtimes.size,0);
  assert.equal(f.store.require<any>('session',f.session.id).nativeId,freshId);assert.equal(f.store.require<any>('session',f.session.id).title,'新工程会话');assert.equal((await f.engines.contextUsage.read(f.session.id)).usage,null);
  const following=await f.turn('continue fresh');assert.equal(following.status,'completed');assert.equal(f.resumes[1],freshId);assert.equal(f.received[2].session_id,freshId);
  const events=f.store.events(f.session.id,0);assert.ok(events.some(e=>e.runId===first.id&&e.kind==='result'));assert.ok(events.some(e=>e.runId===clear.id&&e.kind==='conversation-reset'));
  assert.equal((events.find(e=>e.runId===following.id&&e.kind==='result')!.data as any).text,'fresh answer');assert.ok(!events.some(e=>e.kind==='result'&&(e.data as any).text==='stale trailing result'));
 }finally{f.close();}
});
test('a reset native ID is not reverted by an old init or result; subsequent warm turn uses the new ID',async()=>{
 const f=commandFixture([(input,id)=>[{type:'conversation_reset',new_conversation_id:'fresh-native',session_id:id,trigger:'clear'},{type:'system',subtype:'init',session_id:id,model:'test',tools:[],mcp_servers:[]},result(input,id,'cleared')],(input)=>[result(input,'fresh-native','next')]]);
 try{assert.equal((await f.turn('/clear')).status,'completed');assert.equal(f.store.require<any>('session',f.session.id).nativeId,'fresh-native');assert.equal((await f.turn('continue')).status,'completed');assert.equal(f.received[1].session_id,'fresh-native');assert.equal(f.resumes.length,1);}finally{f.close();}
});
test('a result-less local command can finish on explicit idle, while failed or unknown lifecycle cannot pass',async()=>{
 const f=commandFixture([(input,id)=>[{type:'system',subtype:'local_command_output',content:'local output',session_id:id},{type:'system',subtype:'session_state_changed',state:'idle',session_id:id}],(input)=>[{type:'command_lifecycle',command_uuid:input.uuid,state:'cancelled'}],(input)=>[{type:'command_lifecycle',command_uuid:input.uuid,state:'failed'}],(input)=>[{type:'command_lifecycle',command_uuid:input.uuid,state:'unknown-future-state'}]]);
 try{assert.equal((await f.turn('/usage')).status,'completed');assert.equal(f.closed,1);
  for(const expected of ['NATIVE_COMMAND_CANCELLED','NATIVE_COMMAND_FAILED','NATIVE_COMMAND_STATE_UNSUPPORTED']){const run=await f.turn('/usage');assert.equal(run.status,'failed');assert.equal(run.error,expected);}
 }finally{f.close();}
});

function permissionFixture(script:(context:{input:any;options:any;engines:Engines;turn:number})=>Promise<any[]>){
 const store=new Store(':memory:'),drafts=new Drafts(store,{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');}});
 let turn=0;
 const factory:typeof query=({prompt,options})=>{
  async function* messages(){yield{type:'system',subtype:'init',session_id:'permission-fixture',model:'test',tools:[],mcp_servers:[]};for await(const input of prompt as AsyncIterable<any>)yield*await script({input,options,engines,turn:turn++});}
  const stream=messages() as unknown as Query;stream.close=()=>{void stream.return();};stream.supportedCommands=async()=>[];stream.supportedAgents=async()=>[];stream.supportedModels=async()=>[];stream.mcpServerStatus=async()=>[];
  return stream;
 };
 const engines=new Engines(store,drafts,undefined,factory),session=store.createSession({origin:'https://polarion.pufafen.com',projectId:'test01',document:'Requirements/permission-fixture'},'permissions');
 return{engines,store,session,async turn(){const run=store.startRun(session.id,crypto.randomUUID(),'controlled permission fixture',[]).run;await engines.execute(run);return run;},close(){engines.close();store.close();}};
}
const hook=(options:any,name:string,input:any)=>options.hooks[name][0].hooks[0]({hook_event_name:name,...input},input.tool_use_id,{signal:new AbortController().signal});

test('explicit refusal has one correlated tool outcome and late hooks cannot overwrite it or attach to a later warm turn',async()=>{
 const f=permissionFixture(async({input,options,engines,turn})=>{
  if(turn===0){
   await hook(options,'PreToolUse',{tool_use_id:'refused-call',tool_name:'Bash',tool_input:{command:'node -p "1+1"'}});
   const permission=options.canUseTool('Bash',{command:'node -p "1+1"'},{toolUseID:'refused-call',signal:new AbortController().signal});
   const [id]=[...engines.permissions].find(([,p])=>p.runId===input.uuid)!;
   engines.answer(input.uuid,id,false);assert.equal((await permission).behavior,'deny');
   await hook(options,'PostToolUseFailure',{tool_use_id:'refused-call',error:'late denial hook'});
  }else{
   await hook(options,'PostToolUse',{tool_use_id:'refused-call',tool_response:{ok:true}});
   await hook(options,'PreToolUse',{tool_use_id:'next-read',tool_name:'Read',tool_input:{file_path:'controlled-fixture.txt'}});
   await hook(options,'PostToolUse',{tool_use_id:'next-read',tool_response:{ok:true}});
  }
  return[result(input,'permission-fixture',turn?'next answer':'request refused')];
 });
 try{
  const first=await f.turn(),second=await f.turn();assert.equal(first.status,'completed');assert.equal(second.status,'completed');
  const outcomes=f.store.events(f.session.id,0).filter(e=>e.kind==='tool-result');
  const refused=outcomes.filter(e=>(e.data as any).id==='refused-call');assert.equal(refused.length,1);assert.equal(refused[0]!.runId,first.id);
  assert.equal((refused[0]!.data as any).status,'failed');assert.equal((refused[0]!.data as any).outcome,'denied');assert.match((refused[0]!.data as any).summary,/用户已拒绝/);
  assert.equal(outcomes.filter(e=>e.runId===second.id).length,1);assert.equal((outcomes.find(e=>e.runId===second.id)!.data as any).status,'completed');
 }finally{f.close();}
});

test('cancelling a permission wait remains cancelled despite late successful hook and result frames',async()=>{
 const f=permissionFixture(async({input,options,engines})=>{
  await hook(options,'PreToolUse',{tool_use_id:'cancel-wait',tool_name:'Bash',tool_input:{command:'node -p "1+1"'}});
  const permission=options.canUseTool('Bash',{command:'node -p "1+1"'},{toolUseID:'cancel-wait',signal:new AbortController().signal});
  engines.cancel(input.uuid);assert.equal((await permission).behavior,'deny');
  await hook(options,'PostToolUse',{tool_use_id:'cancel-wait',tool_response:{ok:true}});
  return[result(input,'permission-fixture','late success')];
 });
 try{
  const run=await f.turn();assert.equal(run.status,'cancelled');assert.equal(f.engines.permissions.size,0);
  const events=f.store.events(f.session.id,0),outcomes=events.filter(e=>e.kind==='tool-result');assert.equal(outcomes.length,1);
  assert.equal((outcomes[0]!.data as any).outcome,'cancelled');assert.equal((outcomes[0]!.data as any).status,'failed');assert.ok(!events.some(e=>e.kind==='result'));
 }finally{f.close();}
});

test('cancelling an already started tool cannot be turned into success by a late completion hook',async()=>{
 const f=permissionFixture(async({input,options,engines})=>{
  await hook(options,'PreToolUse',{tool_use_id:'cancel-active',tool_name:'Read',tool_input:{file_path:'controlled-fixture.txt'}});
  engines.cancel(input.uuid);
  await hook(options,'PostToolUse',{tool_use_id:'cancel-active',tool_response:{ok:true}});
  return[result(input,'permission-fixture','late success')];
 });
 try{
  const run=await f.turn();assert.equal(run.status,'cancelled');
  const events=f.store.events(f.session.id,0),outcomes=events.filter(e=>e.kind==='tool-result');assert.equal(outcomes.length,1);
  assert.equal((outcomes[0]!.data as any).outcome,'cancelled');assert.ok(!events.some(e=>e.kind==='result'));
 }finally{f.close();}
});
