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
