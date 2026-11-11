import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.ts';
import { Engines } from './engine.ts';
import { Drafts } from './polarion.ts';
import { writeExperience } from './experience.ts';
import type { Run } from '../../packages/protocol/index.ts';
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
 return{engines,store,session,async turn(){const run=store.startRun(session.id,crypto.randomUUID(),'controlled permission fixture',[],undefined,[],'ask').run;await engines.execute(run);return run;},close(){engines.close();store.close();}};
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

const waitUntil=async(check:()=>boolean)=>{for(let i=0;i<400&&!check();i++)await new Promise(resolve=>setTimeout(resolve,5));if(!check())throw Error('TEST_CONDITION_TIMEOUT');};

function deliveryFixture(interruptible:'graceful'|'reject'|'none'){
 const store=new Store(':memory:'),drafts=new Drafts(store,{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');}});
 let starts=0,consumed=0,interrupted=false;let releaseFirst!:(value:void)=>void;const gate=new Promise<void>(resolve=>{releaseFirst=resolve;});
 const factory:typeof query=({prompt})=>{
  starts++;const nativeId='native-delivery';
  async function* messages(){
   yield{type:'system',subtype:'init',session_id:nativeId,model:'test',tools:[],mcp_servers:[]};
   for await(const value of prompt as AsyncIterable<any>){
    consumed++;
    if(consumed===1)await gate;
    if(interrupted){interrupted=false;yield{type:'result',subtype:'error_during_execution',is_error:true,errors:['prompt_check: the turn was stopped before its prompt was checked'],session_id:nativeId,user_message_uuid:value.uuid,result:'已停止',duration_ms:1,num_turns:1};continue;}
    yield result(value,nativeId,'answer '+consumed);
   }
  }
  const stream=messages() as unknown as Query;stream.close=()=>{void stream.return();};stream.supportedCommands=async()=>[];stream.supportedAgents=async()=>[];stream.supportedModels=async()=>[];stream.mcpServerStatus=async()=>[];
  if(interruptible==='graceful')stream.interrupt=async()=>{interrupted=true;releaseFirst();return undefined as any;};
  if(interruptible==='reject')stream.interrupt=async()=>{throw Error('INTERRUPT_UNSUPPORTED');};
  return stream;
 };
 const engines=new Engines(store,drafts,undefined,factory),target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/Delivery'},session=store.createSession(target,'delivery session');
 return {store,engines,session,get starts(){return starts;},get consumed(){return consumed;},releaseFirst,
  close(){engines.close();store.close();}};
}

test('queued input starts after the active turn on the same warm runtime',async()=>{
 const f=deliveryFixture('none');
 try{
  const first=f.store.startRun(f.session.id,crypto.randomUUID(),'first turn',[]).run;
  const firstDone=f.engines.execute(first);
  const queued=f.store.startRun(f.session.id,crypto.randomUUID(),'queued turn',[],undefined,[],'auto','queue');
  assert.equal(queued.run.status,'queued');
  f.releaseFirst();
  await firstDone;assert.equal(first.status,'completed');
  await waitUntil(()=>f.store.require<Run>('run',queued.run.id).status==='completed');
  assert.equal(f.starts,1,'queued turn reuses the warm runtime');
  assert.equal(f.consumed,2);
  assert.equal(f.engines.active.size,0);
 }finally{f.close();}
});

test('steer interrupts the active turn gracefully and the steered message continues the conversation',async()=>{
 const f=deliveryFixture('graceful');
 try{
  const first=f.store.startRun(f.session.id,crypto.randomUUID(),'long turn',[]).run;
  const firstDone=f.engines.execute(first);
  const steered=f.store.startRun(f.session.id,crypto.randomUUID(),'steer me',[],undefined,[],'auto','steer');
  assert.equal(steered.run.status,'queued');
  await waitUntil(()=>f.engines.runtimes.has(f.session.id)); // 等 SDK 会话建立后再引导，走优雅打断路径
  assert.equal(f.engines.steer(f.session.id,steered.run.id),true);
  await firstDone;
  assert.equal(first.status,'interrupted');assert.ok(!first.error,'a steered turn is not a failure');
  assert.ok(f.store.events(f.session.id,0).some(e=>e.runId===first.id&&e.kind==='steer'));
  assert.equal((f.store.events(f.session.id,0).find(e=>e.runId===first.id&&e.kind==='result')!.data as any).text,'已停止','interrupted turn keeps the CLI result text');
  await waitUntil(()=>f.store.require<Run>('run',steered.run.id).status==='completed');
  assert.equal(f.starts,1,'the steered message continues the same native conversation');
 }finally{f.close();}
});

test('a rejected interrupt is reported honestly and the queued input still continues after the run',async()=>{
 const f=deliveryFixture('reject');
 try{
  const first=f.store.startRun(f.session.id,crypto.randomUUID(),'long turn',[]).run;
  const firstDone=f.engines.execute(first);
  const steered=f.store.startRun(f.session.id,crypto.randomUUID(),'steer me',[],undefined,[],'auto','steer').run;
  await waitUntil(()=>f.engines.runtimes.has(f.session.id));
  assert.equal(f.engines.steer(f.session.id,steered.id),true);
  await waitUntil(()=>f.store.events(f.session.id,0).some(e=>e.runId===first.id&&e.kind==='steer-failed'));
  f.releaseFirst();
  await firstDone;assert.equal(first.status,'completed','interrupt 失败时本轮正常完成，不误标 interrupted');
  await waitUntil(()=>f.store.require<Run>('run',steered.id).status==='completed');
  assert.equal(f.starts,1);assert.equal(f.consumed,2);
 }finally{f.releaseFirst();f.close();}
});

test('cancelling a queued input skips it and later turns still run',async()=>{
 const f=deliveryFixture('none');
 try{
  const first=f.store.startRun(f.session.id,crypto.randomUUID(),'first turn',[]).run;
  const firstDone=f.engines.execute(first);
  const queued=f.store.startRun(f.session.id,crypto.randomUUID(),'never runs',[],undefined,[],'auto','queue').run;
  f.engines.cancel(queued.id);
  assert.equal(f.store.require<Run>('run',queued.id).status,'cancelled');
  f.releaseFirst();
  await firstDone;
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(f.engines.active.size,0);assert.equal(f.consumed,1);assert.equal(f.starts,1);
  const after=f.store.startRun(f.session.id,crypto.randomUUID(),'after cancel',[]).run;
  await f.engines.execute(after);assert.equal(after.status,'completed');
 }finally{f.close();}
});

test('run-scoped allowance lets later calls of the same tool through without a new prompt',async()=>{
 const f=permissionFixture(async({input,options,engines})=>{
  await hook(options,'PreToolUse',{tool_use_id:'scope-1',tool_name:'Bash',tool_input:{command:'echo one'}});
  const first=options.canUseTool('Bash',{command:'echo one'},{toolUseID:'scope-1',signal:new AbortController().signal});
  const [id]=[...engines.permissions].find(([,p])=>p.runId===input.uuid)!;
  engines.answer(input.uuid,id,true,'run');
  assert.equal((await first).behavior,'allow');
  await hook(options,'PreToolUse',{tool_use_id:'scope-2',tool_name:'Bash',tool_input:{command:'echo two'}});
  const second=options.canUseTool('Bash',{command:'echo two'},{toolUseID:'scope-2',signal:new AbortController().signal});
  assert.equal((await second).behavior,'allow','same tool passes without prompting');
  assert.equal(engines.permissions.size,0,'no second permission was created');
  await hook(options,'PreToolUse',{tool_use_id:'scope-3',tool_name:'Ftp',tool_input:{host:'example.com'}});
  const third=options.canUseTool('Ftp',{host:'example.com'},{toolUseID:'scope-3',signal:new AbortController().signal});
  const [readId]=[...engines.permissions].find(([,p])=>p.runId===input.uuid)!;
  engines.answer(input.uuid,readId,false);
  assert.equal((await third).behavior,'deny','other tools still ask');
  return[result(input,'permission-fixture','done')];
 });
 try{const run=await f.turn();assert.equal(run.status,'completed','error: '+run.error);assert.equal(f.engines.runAllows.size,0,'allowance cleared after the run');}
 finally{f.close();}
});

test('steerQueued promotes a queued input to jump the queue and interrupt the active turn',async()=>{
 const f=deliveryFixture('graceful');
 try{
  const first=f.store.startRun(f.session.id,crypto.randomUUID(),'long turn',[]).run;
  const firstDone=f.engines.execute(first);
  const q1=f.store.startRun(f.session.id,crypto.randomUUID(),'queued first',[],undefined,[],'auto','queue').run;
  const q2=f.store.startRun(f.session.id,crypto.randomUUID(),'queued second',[],undefined,[],'auto','queue').run;
  await waitUntil(()=>f.engines.runtimes.has(f.session.id));
  const promoted=f.engines.steerQueued(q2.id);
  assert.equal(promoted.delivery,'steer');
  await firstDone;assert.equal(first.status,'interrupted');
  await waitUntil(()=>f.store.require<Run>('run',q1.id).status==='completed'&&f.store.require<Run>('run',q2.id).status==='completed');
  const results=f.store.events(f.session.id,0).filter(e=>e.kind==='result');
  const seqOf=(runId:string)=>results.find(e=>e.runId===runId)!.seq;
  assert.ok(seqOf(q2.id)<seqOf(q1.id),'steered input runs before the earlier queued input');
  assert.equal(f.starts,1,'same warm conversation');
  await assert.rejects(async()=>f.engines.steerQueued(q1.id),/RUN_NOT_QUEUED/);
 }finally{f.close();}
});

test('distilled local experience is injected into every turn prompt',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'psb-experience-'));
 const store=new Store(':memory:'),drafts=new Drafts(store,{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');}});
 const prompts:string[]=[];
 const factory:typeof query=({prompt})=>{
  async function* messages(){yield{type:'system',subtype:'init',session_id:'native-exp',model:'test',tools:[],mcp_servers:[]};for await(const value of prompt as AsyncIterable<any>){prompts.push(JSON.stringify(value.message.content));yield{type:'result',subtype:'success',is_error:false,session_id:'native-exp',result:'ok',duration_ms:1,num_turns:1};}}
  const stream=messages() as unknown as Query;stream.close=()=>{void stream.return();};stream.supportedCommands=async()=>[];stream.supportedAgents=async()=>[];stream.supportedModels=async()=>[];stream.mcpServerStatus=async()=>[];return stream;
 };
 try{
  writeExperience('test01','## 沟通与输出\n- 不要输出整页源码，先解释具体动作。',dir);
  const engines=new Engines(store,drafts,undefined,factory,dir);
  const session=store.createSession({origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/Experience'},'experience session');
  const first=store.startRun(session.id,crypto.randomUUID(),'first',[]).run;await engines.execute(first);
  const second=store.startRun(session.id,crypto.randomUUID(),'second',[]).run;await engines.execute(second);
  assert.equal(prompts.length,2);
  for(const prompt of prompts){assert.match(prompt,/历史经验沉淀/);assert.match(prompt,/不要输出整页源码/);assert.match(prompt,/必须遵循，避免重犯/);}
  engines.close();
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
