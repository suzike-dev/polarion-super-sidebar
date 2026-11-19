import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.ts';
import { Engines } from './engine.ts';
import { Service } from './service.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Drafts, type Remote } from './polarion.ts';
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
test('single-item inspection and retry use the captured editor version without tools or automatic writes', async t => {
  const store = new Store(':memory:');
  const target = {origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Inspection'};
  const session = store.createSession(target, '独立深检');
  const drafts = new Drafts(store, {read: async () => assert.fail('unexpected remote read'), save: async () => assert.fail('unexpected remote write')});
  const service = new Service(store, drafts);
  const calls: Parameters<typeof query>[0][] = [];
  const factory: typeof query = options => {
    calls.push(options);
    async function* messages() {
      if (calls.length === 1) throw Error('MODEL_OFFLINE');
      yield {type: 'result', subtype: 'success', is_error: false, result: '检查结果', duration_ms: 1, num_turns: 1};
    }
    const stream = messages() as unknown as Query;
    stream.close = () => { void stream.return(); };
    return stream;
  };
  service.engines = new Engines(store, drafts, undefined, factory);
  t.after(() => { service.engines.close(); store.close(); });
  store.put('settings', 'global', {...store.settings(), agentAutoSave: true});
  const draft = {id: crypto.randomUUID(), target, workItemId: 'REQ-5', title: '测试时限', state: 'uncertain', revision: 7,
    html: '<p>共享草稿的旧值</p>', baseHtml: '<p>基线</p>', baseUpdated: 'v1'};
  store.put('draft', draft.id, draft);
  const execute = t.mock.method(service.engines, 'execute');
  const request = (command: unknown) => service.request({protocol: 1, id: crypto.randomUUID(), command});
  const snapshot = {id: crypto.randomUUID(), target, workItemId: draft.workItemId, source: 'editor', text: '编辑器显示 35 ms；请将文字加粗。', pinned: false, prefix: '', suffix: '', capturedAt: 17};
  const command = {method: 'runs.inspectQuality', sessionId: session.id, requestId: crypto.randomUUID(), snapshot, title: draft.title, sourceLabel: '编辑器未同步输入，基于草稿修订 7'};
  const first = await request(command);
  if (!first.ok) assert.fail(first.error);
  const run = first.value as Run;
  await execute.mock.calls[0]!.result;
  assert.equal(store.require<Run>('run', run.id).error, 'MODEL_OFFLINE');
  assert.equal(run.qualityInspection, true);
  assert.equal(run.autoSave, false);
  assert.match(run.prompt, /基于草稿修订 7/);
  assert.equal((await request(command)).ok, true);
  assert.equal(execute.mock.callCount(), 1);
  const collision = await request({method: 'runs.start', sessionId: session.id, requestId: command.requestId, target, prompt: run.prompt, contexts: [snapshot], autoSave: false});
  assert.ok(!collision.ok && collision.error.includes('REQUEST_ID_REUSED'));

  const updated = {...draft, revision: 8, html: '<p>另一窗口的新正文</p>'};
  store.put('draft', draft.id, updated);
  const retry = await request({method: 'runs.retry', runId: run.id, requestId: crypto.randomUUID()});
  if (!retry.ok) assert.fail(retry.error);
  await execute.mock.calls[1]!.result;
  const retried = store.require<Run>('run', (retry.value as Run).id);
  assert.equal(retried.status, 'completed', retried.error);
  assert.equal(retried.qualityInspection, true);
  assert.deepEqual(retried.contexts, [snapshot]);
  for (const {options, prompt} of calls) {
    assert.deepEqual(options?.tools, []); assert.deepEqual(options?.skills, []);
    assert.deepEqual(options?.mcpServers, {}); assert.equal(options?.strictMcpConfig, true);
    assert.deepEqual(options?.settings, {disableAllHooks: true}); assert.equal(options?.persistSession, false);
    assert.equal(options?.resume, undefined); assert.equal(options?.permissionMode, 'dontAsk');
    assert.match(String(prompt), /编辑器显示 35 ms/); assert.doesNotMatch(String(prompt), /共享草稿的旧值|另一窗口的新正文/);
  }
  assert.deepEqual(store.require('draft', draft.id), updated);
  assert.deepEqual(store.list('proposal'), []); assert.deepEqual(store.list('save'), []);
  const events = store.events(session.id, 0);
  assert.ok(events.some(e => e.runId === retried.id && e.kind === 'result' && (e.data as {text: string}).text.includes('检查结果')));
  assert.ok(!events.some(e => e.kind === 'tool' || e.kind === 'draft'));
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

function permissionFixture(script:(context:{input:any;options:any;engines:Engines;turn:number})=>Promise<any[]>, remote?: Remote){
 const store=new Store(':memory:'),drafts=new Drafts(store,remote??{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');}});
 let turn=0;
 const factory:typeof query=({prompt,options})=>{
  async function* messages(){yield{type:'system',subtype:'init',session_id:'permission-fixture',model:'test',tools:[],mcp_servers:[]};for await(const input of prompt as AsyncIterable<any>)yield*await script({input,options,engines,turn:turn++});}
  const stream=messages() as unknown as Query;stream.close=()=>{void stream.return();};stream.supportedCommands=async()=>[];stream.supportedAgents=async()=>[];stream.supportedModels=async()=>[];stream.mcpServerStatus=async()=>[];
  return stream;
 };
 const engines=new Engines(store,drafts,undefined,factory),session=store.createSession({origin:'https://polarion.pufafen.com',projectId:'test01',document:'Requirements/permission-fixture'},'permissions');
 return{engines,store,session,async turn(autoSave?: false){const run=store.startRun(session.id,crypto.randomUUID(),'controlled permission fixture',[],undefined,[],'ask','queue',undefined,undefined,autoSave).run;await engines.execute(run);return run;},close(){engines.close();store.close();}};
}
const hook=(options:any,name:string,input:any)=>options.hooks[name][0].hooks[0]({hook_event_name:name,...input},input.tool_use_id,{signal:new AbortController().signal});

test('a warm Claude runtime keeps a reviewed text rewrite local while saving the next ordinary turn', async t => {
  const items = new Map(['SPE-1', 'SPE-2'].map(id => [id, { id, title: id, description: '<p>原文</p>', updated: '1' }]));
  const writes: string[] = [];
  const client = new Client({ name: 'rewrite-test', version: '1' });
  const f = permissionFixture(async ({ input, options, engines, turn }) => {
    if (turn === 0) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await options.mcpServers.polarion_drafts.instance.connect(serverTransport);
      await client.connect(clientTransport);
      assert.ok(!(await client.listTools()).tools.some(tool => tool.name === 'save_draft'));
    }
    const run = engines.store.require<Run>('run', input.uuid);
    const workItemId = turn === 0 ? 'SPE-1' : 'SPE-2';
    const draft = await engines.drafts.open(run.target, workItemId);
    const node = draft.nodes.find(node => node.text === '原文')!;
    const text = turn === 0 ? '待审阅的改写' : '普通改写';
    const changed = await client.callTool({ name: 'replace_text', arguments: {
      draftId: draft.id, expectedRevision: draft.revision, nodeId: node.id, expectedText: node.text, text,
    } });
    assert.ok(!changed.isError);
    assert.equal(input.message.content[0].text.includes('等待用户在编辑工作台查看对照并确认保存'), turn === 0);
    return [result(input, 'permission-fixture', text)];
  }, {
    read: async (_target, id) => ({ ...items.get(id)! }),
    save: async draft => {
      writes.push(draft.workItemId);
      const saved = { ...items.get(draft.workItemId)!, description: draft.html, updated: '2' };
      items.set(saved.id, saved);
      return saved;
    },
  });
  t.after(async () => { await client.close(); f.close(); });
  f.store.put('settings', 'global', { ...f.store.settings(), agentAutoSave: true });

  const review = await f.turn(false);
  assert.equal(review.status, 'completed', review.error);
  assert.deepEqual(writes, []);
  const runtime = f.engines.runtimes.get(f.session.id);
  const ordinary = await f.turn();
  assert.equal(ordinary.status, 'completed', ordinary.error);
  assert.equal(f.engines.runtimes.get(f.session.id), runtime);
  assert.deepEqual(writes, ['SPE-2']);
  const local = f.store.drafts(f.session.target).find(d => d.workItemId === 'SPE-1')!;
  assert.equal(local.state, 'dirty');
  assert.equal(local.html, '<p>待审阅的改写</p>');
  assert.equal(items.get('SPE-1')!.description, '<p>原文</p>');
  assert.match(items.get('SPE-2')!.description, /普通改写/);
});

test('single quality finding changes one specified sentence among identical text and 54 other matches', async t => {
  const sentence = '系统应及时响应。', replacement = '系统应在规定时限内响应。';
  const html = `<p>${sentence}${sentence}</p><p>${'及时'.repeat(54)}</p>`;
  const store = new Store(':memory:');
  let writes = 0;
  const drafts = new Drafts(store, { read: async () => ({ id: 'FIX-1', title: 'fixture', description: html, updated: '1' }), save: async () => { writes++; throw Error('unexpected remote write'); } });
  const service = new Service(store, drafts);
  const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Scoped' };
  const session = store.createSession(target, '单行改写');
  const draft = await drafts.open(target, 'FIX-1');
  let calls = 0;
  const factory: typeof query = ({ options }) => {
    calls++;
    async function* messages() {
      const server = options?.mcpServers?.polarion_drafts;
      if (server && 'instance' in server) {
        const client = new Client({ name: 'overbroad-rewrite-test', version: '1' });
        const [c, s] = InMemoryTransport.createLinkedPair();
        await server.instance.connect(s);
        await client.connect(c);
        try { await client.callTool({ name: 'replace_all_text', arguments: { draftId: draft.id, expectedRevision: 0, from: '及时', to: '在规定时限内', caseSensitive: true } }); }
        finally { await client.close(); }
      }
      yield { type: 'result', subtype: 'success', is_error: false, session_id: 'fixture', result: `已按体检建议改写：
\`\`\`json
${JSON.stringify({ replacement })}
\`\`\`
请审阅。`, duration_ms: 1, num_turns: 1 };
    }
    const stream = messages() as unknown as Query;
    stream.close = () => { void stream.return(); };
    return stream;
  };
  service.engines = new Engines(store, drafts, undefined, factory);
  t.after(() => { service.engines.close(); store.close(); });
  store.put('settings', 'global', { ...store.settings(), agentAutoSave: true });
  const execute = t.mock.method(service.engines, 'execute');
  const from = 1 + sentence.length, matchFrom = from + sentence.indexOf('及时');
  const qualityRewrite = { draftId: draft.id, workItemId: draft.workItemId, expectedRevision: 0, ruleId: 'fuzzy-default', message: '需要明确时限',
    from, to: from + sentence.length, sentence, matchFrom, matchTo: matchFrom + 2, matchedText: '及时' };
  const context = { id: crypto.randomUUID(), target, workItemId: draft.workItemId, source: 'work-item', text: sentence, capturedAt: 1 };
  const command = { method: 'runs.start', sessionId: session.id, target, requestId: crypto.randomUUID(), prompt: '将全文加粗', contexts: [context], qualityRewrite };
  const request = (command: unknown) => service.request({ protocol: 1, id: crypto.randomUUID(), command });
  const reply = await request(command);
  if (!reply.ok) assert.fail(reply.error);
  const runId = (reply.value as Run).id;
  await execute.mock.calls[0]!.result;
  const run = store.require<Run>('run', runId);
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.autoSave, false);
  assert.deepEqual(run.qualityRewrite, qualityRewrite);
  const expectedHtml = `<p>${sentence}${replacement}</p><p>${'及时'.repeat(54)}</p>`;
  assert.equal(drafts.read(draft.id).html, expectedHtml);
  assert.equal((await request(command)).ok, true);
  const first = { ...qualityRewrite, from: 1, to: 1 + sentence.length, matchFrom: matchFrom - sentence.length, matchTo: matchFrom + 2 - sentence.length };
  const reused = await request({ ...command, qualityRewrite: first });
  if (reused.ok) assert.fail('a different occurrence reused the request ID');
  assert.match(reused.error, /REQUEST_ID_REUSED/);
  const retry = await request({ method: 'runs.retry', runId, requestId: crypto.randomUUID() });
  if (!retry.ok) assert.fail(retry.error);
  await execute.mock.calls[1]!.result;
  const retried = store.require<Run>('run', (retry.value as Run).id);
  assert.deepEqual(retried.qualityRewrite, qualityRewrite);
  assert.equal(retried.status, 'failed'); assert.match(retried.error!, /过期.*重新体检/);
  assert.equal(calls, 1);
  assert.equal(drafts.read(draft.id).html, expectedHtml);
  assert.equal(writes, 0);
});

test('scoped quality turns reject queued and in-flight stale revisions, cancellations and invalid candidates alongside a warm chat', async t => {
  const sentence = '系统应及时响应。', html = `<p>${sentence}</p><p>独立段落</p>`;
  const store = new Store(':memory:'); let writes = 0, calls = 0, warmStarts = 0;
  const drafts = new Drafts(store, { read: async () => ({ id: 'FIX-2', title: 'fixture', description: html }), save: async () => { writes++; throw Error('unexpected save'); } });
  const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Scoped' };
  const session = store.createSession(target, 'warm'), draft = await drafts.open(target, 'FIX-2');
  store.put('settings', 'global', { ...store.settings(), agentAutoSave: true });
  const scope = { draftId: draft.id, workItemId: draft.workItemId, expectedRevision: 0, ruleId: 'fuzzy-default', message: '明确时限',
    from: 1, to: 1 + sentence.length, sentence, matchFrom: 4, matchTo: 6, matchedText: '及时' };
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  const gate = () => ({ entered: deferred<void>(), output: deferred<string>() });
  let pending = gate();
  const factory: typeof query = ({ prompt, options }) => {
    const current = pending;
    async function* messages() {
      if (typeof prompt === 'string') {
        calls++; current.entered.resolve();
        assert.deepEqual(options?.tools, []); assert.deepEqual(options?.mcpServers, {}); assert.equal(options?.strictMcpConfig, true);
        assert.equal(options?.resume, undefined); assert.equal(options?.persistSession, false);
        assert.equal(JSON.parse(prompt).sentence, sentence); assert.ok(!prompt.includes('独立段落'));
        yield { type: 'result', subtype: 'success', is_error: false, result: await current.output.promise, session_id: 'disposable' };
      } else {
        warmStarts++; for await (const input of prompt) yield result(input, 'warm-native');
      }
    }
    const stream = messages() as unknown as Query; stream.close = () => { void stream.return(); };
    return stream;
  };
  const engines = new Engines(store, drafts, undefined, factory);
  t.after(() => { engines.close(); store.close(); });
  const execute = t.mock.method(engines, 'execute');
  const start = (qualityRewrite?: typeof scope) => store.startRun(session.id, crypto.randomUUID(), '检查草稿', [], target, [], 'full', 'queue', undefined, undefined, undefined, qualityRewrite).run;
  await engines.execute(start());
  const warm = engines.runtimes.get(session.id); assert.ok(warm);
  const stale = start(scope), finishing = engines.execute(stale);
  await pending.entered.promise;
  const queued = start(scope); assert.equal(queued.status, 'queued');
  const node = draft.nodes.find(n => n.text === '独立段落')!;
  drafts.replace(draft.id, 0, node.id, node.text!, '人工修改');
  pending.output.resolve(JSON.stringify({ replacement: '系统应按期响应。' })); await finishing;
  await execute.mock.calls[2]!.result;
  for (const id of [stale.id, queued.id]) {
    const run = store.require<Run>('run', id); assert.equal(run.status, 'failed'); assert.match(run.error!, /过期.*重新体检/);
  }
  assert.equal(calls, 1);
  for (const [action, status] of [['cancel', 'cancelled'], ['steer', 'interrupted'], ['invalid', 'failed'], ['multiline', 'failed']] as const) {
    pending = gate(); const run = start({ ...scope, expectedRevision: 1 }), done = engines.execute(run);
    await pending.entered.promise;
    if (action === 'cancel') engines.cancel(run.id);
    if (action === 'steer') assert.equal(engines.steer(session.id, crypto.randomUUID()), true);
    pending.output.resolve(action === 'invalid' ? '已经修改整篇' : JSON.stringify({ replacement: action === 'multiline' ? '另一段。\n下一段。' : '系统应按期响应。' }));
    await done; assert.equal(run.status, status); assert.equal(engines.runtimes.get(session.id), warm);
    if (status === 'failed') assert.match(run.error!, /单句/);
  }
  const ordinary = start(); await engines.execute(ordinary); assert.equal(ordinary.status, 'completed'); assert.equal(warmStarts, 1);
  assert.equal(drafts.read(draft.id).html, html.replace('独立段落', '人工修改'));
  assert.equal(writes, 0);
});

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
  assert.deepEqual(f.engines.proposals.list().map(p=>[p.source,p.status]),[['agent','rejected']]);
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
