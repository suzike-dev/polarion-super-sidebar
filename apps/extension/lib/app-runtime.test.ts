import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import type {Command} from '../../../packages/protocol/index.ts';
import type {Editor} from '@tiptap/core';
import type {Query} from '@anthropic-ai/claude-agent-sdk';
import type {NativeSaveResult} from './save-feedback.ts';

function deferred<T=unknown>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}

// Exercise the real App's event handlers and React state transitions. Only the
// extension transport and the heavyweight editor receiving the draft are fakes.
test('App keeps asynchronous replies bound to the submitted input and document',async t=>{
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
  // Keep package resolution next to the checkout's node_modules, and remove the
  // temporary bundle even when an assertion or build fails.
  const temporary=await mkdtemp(join(repo,'.app-runtime-test-'));
  const globals=globalThis as unknown as Record<string,unknown>;
  const original=new Map<string,PropertyDescriptor|undefined>();
  const expose=(key:string,value:unknown)=>{if(!original.has(key))original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
  const dom=new JSDOM('<div id="gwt-debug-toolbar-save" title="保存" class="Button-disabled"></div><div class="polarion-dle-SplitPanel"><div style="right:240px"><iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe></div><div class="polarion-dle-SidebarContainer"></div></div><div id="root"></div>',{url:'https://polarion.pufafen.com/polarion/#/project/test01/wiki/Requirements/Synthetic',pretendToBeVisual:true});
  let cleanupRoot:(()=>Promise<void>)|undefined;
  try{
    for(const key of ['window','document','location','sessionStorage','HTMLElement','HTMLTextAreaElement','Element','Event','Node','MutationObserver','DOMParser'])expose(key,Reflect.get(dom.window,key));
    expose('innerWidth',1600);expose('IS_REACT_ACT_ENVIRONMENT',true);
    expose('requestAnimationFrame',dom.window.requestAnimationFrame.bind(dom.window));expose('cancelAnimationFrame',dom.window.cancelAnimationFrame.bind(dom.window));
    const nativeDoc=document.querySelector('iframe')!.contentDocument!;
    nativeDoc.body.innerHTML='<h2 id="polarion_wiki macro name=module-workitem;params=id=S-1">Synthetic heading</h2>';
    Object.defineProperty(nativeDoc.body.firstElementChild!,'innerText',{get(){return this.textContent;}});
    document.querySelector<HTMLElement>('.polarion-dle-SplitPanel')!.getBoundingClientRect=()=>({width:1600,top:46} as DOMRect);
    const bundle=join(temporary,'app.mjs');
    await build({absWorkingDir:repo,entryPoints:['apps/extension/ui/App.tsx'],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},plugins:[{name:'app-runtime-fixture',setup(builder){
      builder.onResolve({filter:/^wxt\/browser$/},()=>({path:'browser',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const browser=new Proxy({}, {get:(_,key)=>globalThis.__appRuntimeBrowser[key]});',loader:'js'}));
      builder.onResolve({filter:/^\.\/DraftEditor$/},()=>({path:'editor',namespace:'editor-fixture'}));
      builder.onLoad({filter:/.*/,namespace:'editor-fixture'},()=>({resolveDir:join(repo,'apps/extension/ui'),contents:`import React from "react";
        import {DraftEditor as RealEditor} from './DraftEditor.tsx';
        export function DraftEditor(props){return React.createElement(globalThis.__appRuntimeRealEditor ? RealEditor : StubEditor,props);}
        function StubEditor(props){
          const {draft,onClose}=props,instance=React.useRef({}),revision=React.useRef(draft.revision);
          const [saveStatus,setSaveStatus]=React.useState('idle');
          React.useEffect(()=>{revision.current=draft.revision;},[draft.id]);
          globalThis.__appRuntimeEditors.set(draft.id,{...props,testInstance:instance.current,testRevision:()=>revision.current,
            testCompleteLocalSave:saved=>{revision.current=saved.revision;setSaveStatus('saved:'+saved.workItemId);}});
          return <div data-test-editor={draft.workItemId} data-test-save-status={saveStatus}><button data-test-close onClick={onClose}>Close fixture</button></div>;
        }`,loader:'tsx'}));
    }}]});
    // ReactDOM must initialize after the DOM globals, so its input event system
    // follows the same path as a browser instead of its DOM-less fallback.
    const {createRoot}=await import('react-dom/client');
    const {act,createElement}=await import('react');
    const {App}=await import(pathToFileURL(bundle).href);
    const target={origin:'https://polarion.pufafen.com',projectId:'test01',document:'Requirements/Synthetic'};
    const session={id:'s',target,title:'Existing session',engine:'claude',createdAt:1,updatedAt:1};
    const workflow={id:crypto.randomUUID(),projectId:target.projectId,name:'隔离流程',description:'',origin:'manual',createdAt:1,updatedAt:1,steps:[{id:'s1',title:'检查',prompt:'只读检查',pause:false}]};
    const asset=(id:string)=>({id,target,name:id+'.txt',mime:'text/plain',size:3,state:'ready',extraction:'text'});
    const draft=(id:string)=>({id,target,workItemId:id,title:'Synthetic '+id,state:'clean',revision:1,nodes:[{text:'Fixture '+id}]});
    const input=()=>{const element=document.querySelector('textarea');assert(element);return element;};
    const click=async(element:Element|null|undefined)=>{assert(element instanceof HTMLElement);await act(async()=>{element.click();});};
    const type=async(value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input(),value);input().dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
    const tab=async(label:string)=>click([...document.querySelectorAll<HTMLButtonElement>('.tabs button')].find(element=>element.textContent===label));
    const navigate=async(project:string,documentName='Other')=>{await act(async()=>{dom.window.history.replaceState(null,'',`#/project/${project}/wiki/Requirements/${documentName}`);window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));});};
    const sessionTitle=()=>document.querySelector('.session-bar > button span')?.textContent;

    async function mount(withSession=true,options:{sessionId?:string;runs?:unknown[];settings?:unknown;guidelines?:unknown[];events?:unknown[]}={}){
      const activeSession = options.sessionId ? { ...session, id: options.sessionId } : session;
      dom.window.history.replaceState(null,'','#/project/test01/wiki/Requirements/Synthetic');sessionStorage.clear();
      const calls:Command[]=[],send=deferred(),create=deferred(),rename=deferred(),uploaded=deferred(),nativeCheck=deferred(),nativeRefresh=deferred(),experience=deferred();
      const replies=new Map<Command['method'],(command:Command)=>unknown>();
      const nativeCalls:{phase:string;workItemId:string}[]=[];
      const editors=new Map<string,{onUpdate:(value:ReturnType<typeof draft>)=>void;prepareNativeSave:()=>Promise<string>;onSaved:(value:ReturnType<typeof draft>)=>Promise<NativeSaveResult>;remoteRevision?:number;testInstance:object;testRevision:()=>number;testCompleteLocalSave:(value:ReturnType<typeof draft>)=>void}>();expose('__appRuntimeEditors',editors);
      const drafts=new Map<string,ReturnType<typeof deferred>>();
      const listeners=new Set<unknown>();
      expose('__appRuntimeBrowser',{storage:{local:{get:async()=>({'active-project-session:test01':withSession?activeSession.id:undefined,'composer-attachments:test01':[asset('sent')]}),set:async()=>{},remove:async()=>{}}},runtime:{onMessage:{addListener:(listener:unknown)=>listeners.add(listener),removeListener:(listener:unknown)=>listeners.delete(listener)},sendMessage:async(message:{request:{command:Command};type?:string;phase:string;workItemId:string})=>{
        if(message.type==='native-workitem-refresh'){nativeCalls.push(message);return message.phase==='check'?nativeCheck.promise:nativeRefresh.promise;}
        const command=message.request.command;calls.push(command);let value:unknown;
        const reply=replies.get(command.method);
        if(reply)return reply(command);
        switch(command.method){
          case 'health':value={};break;
          case 'workflows.list':value=command.projectId===target.projectId?[workflow]:[];break;
          case 'macros.list':case 'workflows.history':value=[];break;
          case 'settings.read':value=options.settings??{};break;
          case 'guidelines.list':value=options.guidelines??[];break;
          case 'engine.context':value={connected:false};break;
          case 'sessions.list':value=withSession&&command.projectId===target.projectId?[activeSession]:[];break;
          case 'sessions.read':value={session:activeSession,runs:options.runs??[],events:options.events??[]};break;
          case 'sessionGroups.list':value=[];break;
          case 'drafts.list':value=['A','B','C'].map(draft);break;
          case 'runs.start':value=await send.promise;break;
          case 'runs.steer':value={};break;
          case 'runs.cancel':value={requested:true};break;
          case 'experience.read':value={text:'',path:'C:/data/experience/test01.md',updatedAt:0};break;
          case 'experience.distill':value=await experience.promise;break;
          case 'experience.write':value={text:command.text,path:'C:/data/experience/test01.md',updatedAt:9};break;
          case 'experience.clear':value={text:'',path:'C:/data/experience/test01.md',updatedAt:0};break;
          case 'sessions.create':value=await create.promise;break;
          case 'sessions.rename':value=await rename.promise;break;
          case 'drafts.open':{const reply=deferred();drafts.set(command.workItemId,reply);value=await reply.promise;break;}
          case 'assets.begin':value=asset('added');break;
          case 'assets.chunk':value={};break;
          case 'assets.finish':value=asset('added');uploaded.resolve(undefined);break;
          default:throw Error('Unexpected fixture RPC '+command.method);
        }
        return {ok:true,value};
      }}});
      const root=createRoot(document.getElementById('root')!);
      cleanupRoot=async()=>{await act(async()=>{root.unmount();});assert.equal(listeners.size,0);};
      await act(async()=>{root.render(createElement(App));});
      assert(input());assert.equal(sessionTitle(),withSession?'Existing session':'新工程会话');
      return {calls,replies,send,create,rename,uploaded,drafts,editors,nativeCalls,nativeCheck,nativeRefresh,experience};
    }
    async function run(name:string,check:(fixture:Awaited<ReturnType<typeof mount>>)=>Promise<void>,withSession=true,options:{runs?:unknown[];settings?:unknown;guidelines?:unknown[];events?:unknown[]}={}){
      await t.test(name,async()=>{try{await check(await mount(withSession,options));}finally{await cleanupRoot?.();cleanupRoot=undefined;}});
    }

    await t.test('clicking a real quality row flushes the editor and sends only that occurrence through runs.start to the local Host', { timeout: 15000 }, async t => {
      // Load the Node Host at runtime so this browser test does not type-check the Host with the browser tsconfig.
      const host = (name: string) => import(pathToFileURL(join(repo, 'apps/host', name + '.ts')).href);
      const [{ Store }, { Drafts }, { Engines }, { Service }] = await Promise.all([host('store'), host('polarion'), host('engine'), host('service')]);
      const sentence = '系统应及时响应。', replacement = '系统应按期响应。';
      const html = `<p>${sentence}${sentence}</p><p>${'及时'.repeat(54)}</p>`, workItemId = 'FIX-7';
      const store = new Store(':memory:'); let writes = 0;
      const drafts = new Drafts(store, { read: async () => ({ id: workItemId, title: '条目', description: html }), save: async () => { writes++; throw Error('unexpected remote save'); } });
      const service = new Service(store, drafts);
      service.engines = new Engines(store, drafts, undefined, () => {
        async function* messages() { yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({replacement}) }; }
        const stream = messages() as unknown as Query; stream.close = () => { void stream.return(); }; return stream;
      });
      const execute = t.mock.method(service.engines, 'execute');
      const submitted = deferred<{ok: boolean; error?: string}>(), sync = deferred();
      const hostSession = store.createSession({ ...target, origin: 'https://polarion.pufafen.com' }, session.title);
      store.put('settings', 'global', { ...store.settings(), agentAutoSave: true });
      const draft = await drafts.open(hostSession.target, workItemId);
      expose('__appRuntimeRealEditor', true);
      expose('ResizeObserver', class { observe() {} disconnect() {} });
      expose('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
      expose('ShadowRoot', dom.window.ShadowRoot); expose('innerHeight', 800);
      try {
        const f = await mount(true, { sessionId: hostSession.id });
        const request = (command: Command) => service.request({ protocol: 1, id: crypto.randomUUID(), command });
        f.replies.set('workitems.read', () => ({ ok: true, value: draft }));
        f.replies.set('drafts.open', request); f.replies.set('drafts.rich.read', request);
        f.replies.set('runs.inspectQuality', request);
        f.replies.set('drafts.rich.apply', async c => { await sync.promise; return request(c); });
        f.replies.set('runs.start', async c => {
          if (c.method !== 'runs.start' || !c.qualityRewrite) return { ok: true, value: { id: crypto.randomUUID(), status: 'queued' } };
          const reply = await request(c); submitted.resolve(reply); return reply;
        });
        await act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { origin: location.origin, data: { __polarionSidebar: 'open-workitem', workItemId } })); });
        await click(document.querySelector('.reader-panel footer .primary'));
        const chip = () => click(document.querySelector('.psb-quality-chip'));
        const rows = () => [...document.querySelectorAll('.psb-quality-item')];
        const hits = () => rows().filter(row => row.querySelector('strong')?.textContent === '「及时」');
        const requests = () => f.calls.filter(c => c.method === 'runs.start');
        await chip(); assert.equal(hits().length, 56);
        const itemRow = rows().find(row => row.querySelector('.psb-quality-locate:disabled') && row.querySelector('strong')?.textContent?.includes('应、应'));
        await click(itemRow?.querySelector('.psb-quality-fix'));
        assert.equal(requests().length, 1);
        const itemRun = requests()[0]!;
        assert.equal(itemRun.qualityRewrite, undefined); assert.equal(itemRun.contexts[0]?.source, 'work-item'); assert.equal(itemRun.autoSave, false);
        await chip(); await click(document.querySelector('.psb-quality-deep'));
        const inspection = f.calls.find(c => c.method === 'runs.inspectQuality'); assert.ok(inspection);
        assert.equal(inspection.snapshot.workItemId, workItemId); assert.ok(inspection.snapshot.text.includes('及时'.repeat(54)));
        await execute.mock.calls[0]!.result; assert.equal(drafts.read(draft.id).revision, 0);
        await chip(); await click(hits()[0]!.querySelector('.psb-quality-fix'));
        assert.match(document.querySelector('.psb-quality-panel [role=alert]')?.textContent ?? '', /请更新/);
        assert.equal(requests().length, 1, 'an older Host must not receive a broad rewrite');
        f.replies.set('health', request);
        const stale = hits()[1]!.querySelector<HTMLButtonElement>('.psb-quality-fix')!;
        const editor = (document.querySelector('.tiptap-mount .ProseMirror') as HTMLElement & {editor: Editor}).editor;
        const inserted = '说明。';
        await act(async () => { editor.view.dispatch(editor.state.tr.insertText(inserted, 1)); stale.click(); });
        assert.match(document.querySelector('.psb-quality-panel [role=alert]')?.textContent ?? '', /重新体检/);
        assert.equal(requests().length, 1);
        await act(async () => { await new Promise(done => setTimeout(done, 340)); });
        await click(hits()[1]!.querySelector('.psb-quality-fix'));
        assert.equal(requests().length, 1, 'a pending local write must finish before the ranged request');
        await act(async () => { sync.resolve(undefined); const reply = await submitted.promise; assert.ok(reply.ok, reply.error); await execute.mock.calls[1]!.result; });
        const run = requests()[1]!, scope = run.qualityRewrite!, from = 1 + inserted.length + sentence.length;
        assert.deepEqual(run.target, hostSession.target); assert.equal(run.autoSave, false);
        assert.deepEqual(run.contexts.map(c => [c.source, c.workItemId, c.text]), [['selection', workItemId, sentence]]);
        assert.deepEqual([scope.draftId, scope.workItemId, scope.expectedRevision, scope.sentence, scope.from, scope.to, scope.matchedText, scope.matchFrom, scope.matchTo],
          [draft.id, workItemId, 1, sentence, from, from + sentence.length, '及时', from + 3, from + 5]);
        assert.equal(drafts.read(draft.id).html, `<p>${inserted}${sentence}${replacement}</p><p>${'及时'.repeat(54)}</p>`); assert.equal(writes, 0);
      } finally {
        await cleanupRoot?.(); cleanupRoot = undefined; expose('__appRuntimeRealEditor', false); service.engines.close(); store.close();
      }
    });

    await run('sending preserves edits and newly added attachments made before the reply',async fixture=>{
      await type('submitted message');await click(document.querySelector('.send'));
      const request=fixture.calls.find(command=>command.method==='runs.start');assert(request&&request.method==='runs.start');
      assert.equal(request.prompt,'submitted message');assert.deepEqual(request.attachments,['sent']);
      await type('next message');
      const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
      Object.defineProperty(paste,'clipboardData',{value:{files:[new File(['abc'],'added.txt',{type:'text/plain'})]}});
      await act(async()=>{input().dispatchEvent(paste);await fixture.uploaded.promise;});
      assert.equal(document.querySelectorAll('.attachment-card').length,2);
      await act(async()=>{fixture.send.resolve({id:'started-run'});});
      assert.equal(input().value,'next message');assert.deepEqual([...document.querySelectorAll('.attachment-open strong')].map(element=>element.textContent),['added.txt']);
      assert.equal(fixture.calls.filter(command=>command.method==='runs.start').length,1);
      assert.equal(fixture.calls.filter(command=>command.method==='runs.cancel').length,0);
    });

    await run('busy-session deletion keeps the named session and explains how to proceed', async fixture => {
      fixture.replies.set('sessions.delete', () => ({ok:false, error:'SESSION_BUSY'}));
      await click(document.querySelector('button[title="会话历史"]'));
      await click(document.querySelector('.history-row button[title="删除会话"]'));
      assert(!fixture.calls.some(c => c.method === 'sessions.delete'));
      await click(document.querySelector('.history-confirm .confirm-yes'));
      assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /请先停止任务或等待结束/);
      assert.equal(sessionTitle(), 'Existing session');
    });

    await run('guideline entry stays available when none are configured and opens the guideline settings tab',async fixture=>{
      const entry=document.querySelector('.guideline-add');assert(entry,'empty state must keep a guideline entry');
      await click(entry);
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,400));});
      assert(document.querySelector('.settings.sp-panel'));
      const activeTab=[...document.querySelectorAll<HTMLButtonElement>('.sp-nav button')].find(button=>button.className.includes('on'));
      assert.equal(activeTab?.textContent?.startsWith('指令'),true,'entry should deep-link to the guideline tab');
    },true,{settings:{defaultEngine:'claude',claudeModel:'',codexModel:'gpt-6.1-sol'}});
    const activeRun={id:'active-run',sessionId:'s',requestId:'r1',target,prompt:'busy',contexts:[],attachments:[],status:'waiting',startedAt:1,permissionMode:'auto',delivery:'queue'};
    const guideline={id:'11111111-1111-4111-8111-111111111111',kind:'send',name:'写标准需求',description:'按标准模板写需求',content:'模板',file:''};
    await run('sending during an active run always queues and keeps the footer constant',async fixture=>{
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
      const permission=document.querySelector<HTMLSelectElement>('select[aria-label="智能体权限"]')!;
      assert.equal(permission.value,'auto','运行中显示本轮冻结的权限，输入框不可切换');
      assert.equal(permission.disabled,true);
      assert.equal(document.querySelector('.delivery-select'),null,'发送一律排队，不再有排队/引导切换');
      assert.equal(document.querySelector('.composer-footer .send.stop'),null,'停止按钮移出恒定底栏');
      assert(document.querySelector('.queue-strip .queue-stop'),'停止在输入框上方的队列条');
      const footerBefore=document.querySelector('.composer-footer')!.innerHTML;
      const guidelineSelect=document.querySelector<HTMLSelectElement>('.guideline-select');
      assert(guidelineSelect);assert.equal(guidelineSelect.value,'');
      await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value')!.set!.call(guidelineSelect,guideline.id);guidelineSelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
      await type('queued message');
      await click(document.querySelector('.send'));
      const request=fixture.calls.find(command=>command.method==='runs.start');assert(request&&request.method==='runs.start');
      assert.equal(request.delivery,'queue','旧设置 defaultTurnDelivery=steer 不再生效');assert.equal(request.permissionMode,'ask');assert.equal(request.guidelineId,guideline.id);
      await act(async()=>{fixture.send.resolve({id:'queued-run',status:'queued'});});
      assert.equal(input().value,'');
      assert.equal(guidelineSelect.value,'','附加指令每次发送后重置');
      assert.equal(document.querySelector('.composer-footer')!.innerHTML.replace(/ disabled=""/g,''),footerBefore.replace(/ disabled=""/g,''),'运行期间底栏排布不变');
    },true,{runs:[activeRun],settings:{defaultEngine:'claude',claudeModel:'',codexModel:'gpt-6.1-sol',defaultPermissionMode:'ask',defaultTurnDelivery:'steer'},guidelines:[guideline]});

    const queuedRun=(id:string,startedAt:number,prompt:string)=>({id,sessionId:'s',requestId:id,target,prompt,contexts:[],attachments:[],status:'queued',startedAt,permissionMode:'ask',delivery:'queue'});
    await run('queue strip lists queued inputs above the composer with steer, cancel and stop',async fixture=>{
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
      assert(document.querySelector('.composer-wrap .queue-strip'),'队列条位于输入框上方');
      assert.equal(document.querySelectorAll('.user-message').length,0,'排队尚未开始执行，不应出现在会话正文');
      const rows=[...document.querySelectorAll('.queue-row')];
      assert.equal(rows.length,2);
      assert.equal(rows[0]!.querySelector('.queue-text')!.textContent,'first queued');
      assert.equal(rows[1]!.querySelector('.queue-text')!.textContent,'second queued');
      await click(rows[0]!.querySelector('.queue-steer'));
      const steer=fixture.calls.find(command=>command.method==='runs.steer');assert(steer&&steer.method==='runs.steer');assert.equal(steer.runId,'q1');
      await click(rows[1]!.querySelector('.queue-cancel'));
      assert(fixture.calls.some(command=>command.method==='runs.cancel'&&command.runId==='q2'));
      await click(document.querySelector('.queue-stop'));
      assert(fixture.calls.some(command=>command.method==='runs.cancel'&&command.runId==='active-run'));
    },true,{runs:[activeRun,queuedRun('q1',2,'first queued'),queuedRun('q2',3,'second queued')],events:[{seq:1,sessionId:'s',runId:'q1',kind:'user',data:{text:'first queued'},at:1}]});

    await run('more than three queued inputs collapse by default and expand on demand',async fixture=>{
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
      assert.equal(document.querySelectorAll('.queue-row').length,0);
      const summary=document.querySelector('.queue-summary');assert(summary);
      assert.match(summary.textContent!,/4 条排队/);
      await click(summary);
      assert.equal(document.querySelectorAll('.queue-row').length,4);
      await click(document.querySelector('.queue-head button'));
      assert.equal(document.querySelectorAll('.queue-row').length,0);
      assert(document.querySelector('.queue-summary'));
    },true,{runs:[activeRun,queuedRun('q1',2,'one'),queuedRun('q2',3,'two'),queuedRun('q3',4,'three'),queuedRun('q4',5,'four')]});

    await run('answer actions keep one copy button and distill experience into a local dialog',async fixture=>{
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
      const actions=document.querySelector('.answer-actions');assert(actions);
      assert.equal([...actions.querySelectorAll('button')].filter(button=>button.textContent?.includes('复制回答')).length,0,'复制回答已移除');
      assert([...actions.querySelectorAll('button')].some(button=>button.textContent?.includes('复制 Markdown')));
      const distillButton=[...actions.querySelectorAll('button')].find(button=>button.textContent?.includes('经验沉淀'));assert(distillButton);
      await click(distillButton);
      await act(async()=>{fixture.experience.resolve({text:'## 工具与流程\n- 必须先走本地草稿。',path:'C:/data/experience/test01.md',updatedAt:9});});
      assert(document.querySelector('.experience-layer'),'沉淀后打开经验浮窗');
      assert.match(document.querySelector('.experience-body')!.textContent!,/必须先走本地草稿/);
      assert(fixture.calls.some(command=>command.method==='experience.distill'&&command.sessionId==='s'));
      await click([...document.querySelectorAll('.experience-panel footer button')].find(button=>button.textContent?.includes('编辑')));
      const area=document.querySelector<HTMLTextAreaElement>('.experience-body textarea');assert(area);
      await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(area,'- 新经验');area.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
      await click([...document.querySelectorAll('.experience-panel footer button')].find(button=>button.textContent?.includes('保存修改')));
      const write=fixture.calls.find(command=>command.method==='experience.write');assert(write&&write.method==='experience.write');assert.equal(write.text,'- 新经验');
      await click([...document.querySelectorAll('.experience-panel footer button')].find(button=>button.textContent==='关闭'));
      assert.equal(document.querySelector('.experience-layer'),null);
    },true,{runs:[{...activeRun,id:'done-run',status:'completed',endedAt:2}],events:[{seq:1,sessionId:'s',runId:'done-run',kind:'user',data:{text:'do it'},at:1},{seq:2,sessionId:'s',runId:'done-run',kind:'result',data:{text:'answer text'},at:2}]});

    const escape = async (element: Element | null = document.activeElement) => {
      assert(element); await act(async () => { element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true, composed:true })); });
    };
    const paletteCommand = async (label: string) => {
      await act(async () => { window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key:'P', ctrlKey:true, shiftKey:true, bubbles:true, cancelable:true })); });
      await click([...document.querySelectorAll('.palette-rows [role=option]')].find(button => button.querySelector('b')?.textContent === label));
    };
    const dashboardVisible = () => !!document.querySelector('.dash-panel') && !document.querySelector('.dash-panel')!.closest('[hidden]');
    const metricButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.dash-metric')].find(button => button.querySelector('span')?.textContent === label);
    const drill = async (label: string) => { assert(dashboardVisible()); const button = metricButton(label); assert(button); button.focus(); await click(button); };
    const openDashboard = () => click(document.querySelector('.header-tool[title^="驾驶舱"]'));
    function dashboardFixture(fixture: Awaited<ReturnType<typeof mount>>) {
      const answer = (method: Command['method'], value: unknown) => fixture.replies.set(method, () => ({ok:true, value}));
      answer('dashboard.view', {pendingProposals:1, alerts:1, reviewOpen:2, events:500, quality:{checked:3,findings:2,byRule:[]}, coverage:{total:2,orphans:1}, workflows:1, worksets:1});
      answer('worksets.list', [{id:'set', name:'测试工作集', kind:'search', query:'查', projectId:target.projectId}]);
      answer('snapshots.list', []);
      answer('document.outline', {title:'当前文档', items:[]});
      const issues = Array.from({length:5}, (_, n) => ({ ruleId:`long-rule-${n}`, severity:'warn', message:`发现 ${n} 的完整描述`, matchedText:`原文${n}`, suggestion:`修改建议${n}` }));
      const report = {document:'Requirements/Other', at:100, total:5, checked:3, clean:1, byRule:issues.map(issue=>({ruleId:issue.ruleId,count:1})), ruleSource:'default', items:[
        {workItemId:'SPE-1', title:'标题', outline:'1.1', issues}, {workItemId:'SPE-2', title:'不可读', outline:'2', issues:[], unreadable:true}, {workItemId:'SPE-3', title:'通过', outline:'2', issues:[]},
      ]};
      answer('quality.document.last', report); answer('quality.document.check', {...report,document:target.document});
      answer('gates.view', {policy:{minQualityScore:0,enabled:{}},items:[{workItemId:'SPE-1',passed:false,gates:[{gate:'upstream',label:'上游链接',pass:false,detail:'需补充来源链接'}]}],summary:{total:1,passed:0,qualityScore:0,byGate:{upstream:1}}});
      answer('impact.view', {upstream:[{workItemId:'UP-1',role:'derives'}],downstream:[],verification:[{workItemId:'TC-4',role:'验证'}],modules:[{rootLabel:'Root',moduleName:'Control',moduleKey:'folder/Control'}]});
      answer('model.roots', {roots:[]}); answer('model.note.read', {marks:[]});
      const item = (id: string, readOnlyReference=false) => ({ ...draft(id), nodes:[], html:'<p>'+id+'</p>', baseHtml:'<p>'+id+'</p>', readOnlyReference });
      fixture.replies.set('workitems.read', c => c.method === 'workitems.read' && ({ok:true,value:item(c.workItemId,c.workItemId.startsWith('FOREIGN'))}));
      return {answer,report,item};
    }

    await run('the model workbench opens an empty requirement and a marked chapter in the reader', async fixture => {
      const {answer, item} = dashboardFixture(fixture);
      const section = {workItemId:'FIX-10', title:'Synthetic section', type:'heading'};
      const requirement = {workItemId:'FIX-11', title:'Synthetic requirement', type:'softwarerequirement'};
      const otherSection = {...section, workItemId:'FIX-12'};
      const root = {id:'root', label:'Fixture', path:'', modules:[], dictionaries:[]};
      answer('model.roots', {roots:[root]}); answer('model.baseline.list', []);
      answer('coverage.view', {items:[]});
      answer('model.trace.view', {roots:[root], groups:[{rootId:root.id,moduleKey:'m',moduleName:'Fixture module',kind:'module',items:[],markedHeadings:[section,otherSection],missing:true}], unannotated:[requirement], total:1, annotated:0, syncedAt:1});
      const entry = (id: string, type: string, outline: string) => ({id, title:id, type, outline, status:''});
      answer('document.outline', {items:[entry('FIX-10','heading','3.1'),entry('FIX-11','softwarerequirement','3.1-1'),entry('FIX-13','heading','3.1.1'),entry('FIX-14','customPolicy','3.1.1-1'),entry('FIX-12','heading','3.10'),entry('FIX-15','softwarerequirement','4-1')]});
      fixture.replies.set('workitems.read', c => c.method === 'workitems.read' && ({ok:true,value:{...item(c.workItemId), source:'remote', type:c.workItemId === requirement.workItemId ? requirement.type : 'heading', html:'<p>&nbsp;<br>\u200b</p>'}}));
      await paletteCommand('模型关联与追溯');
      await click(document.querySelector('.model-trace-row.unannotated > button'));
      await click(document.querySelector('.model-trace-row.unannotated .model-trace-items button'));
      const body = () => document.querySelector('.reader-body')!;
      assert.match(body().textContent ?? '', /暂无正文/);
      assert.equal(body().querySelector('iframe'), null);
      assert.ok(body().querySelector('a[href$="workitem?id=FIX-11"]'));
      assert(document.querySelector('.reader-panel footer .primary'));
      assert(!fixture.calls.some(c => c.method === 'document.outline'));
      await click(document.querySelector('[aria-label="关闭阅读预览"]'));
      await click(document.querySelector('.model-trace-root .model-trace-module'));
      const chapters = document.querySelectorAll('.model-trace-root .model-trace-items button');
      await click(chapters[0]);
      assert.match(body().textContent ?? '', /章节标题/);
      const children = [...body().querySelectorAll('button')];
      assert.deepEqual(children.map(b => b.textContent?.match(/FIX-\d+/)?.[0]), ['FIX-11','FIX-14']);
      await click(children[0]);
      assert.match(document.querySelector('.reader-title')!.textContent!, /FIX-11/);
      await click(document.querySelector('[aria-label="关闭阅读预览"]'));
      await click(chapters[1]);
      assert.match(body().textContent ?? '', /暂无下级需求/);
      assert.equal(body().querySelectorAll('button').length, 0);
      assert(!fixture.calls.some(c => c.method === 'drafts.open' || c.method === 'model.note.write'));
    });

    await run('dashboard metrics stay usable while worksets or snapshots fail to load', async fixture => {
      const {answer} = dashboardFixture(fixture);
      const snapshots = deferred();
      fixture.replies.set('worksets.list', () => ({ok:false, error:'WORKSETS_OFFLINE'}));
      fixture.replies.set('snapshots.list', () => snapshots.promise);
      await openDashboard();
      assert.equal(metricButton('体检发现')?.querySelector('b')?.textContent, '2');
      assert.equal(metricButton('项目事件（近500条）')?.querySelector('b')?.textContent, '500');
      const alertText = () => document.querySelector('.dash-panel [role=alert]')?.textContent ?? '';
      assert.match(alertText(), /工作集读取失败.*WORKSETS_OFFLINE/);
      await act(async () => { snapshots.resolve({ok:false, error:'SNAPSHOTS_OFFLINE'}); });
      assert.match(alertText(), /基线快照读取失败.*SNAPSHOTS_OFFLINE/);
      assert.match(alertText(), /工作集读取失败.*WORKSETS_OFFLINE/);
      await drill('体检发现');
      assert.equal(document.querySelectorAll('.ro-quality-row').length, 2);
      answer('snapshots.list', []);
      answer('worksets.list', []);
      await escape(document.querySelector('.requirements-overview input'));
      assert(dashboardVisible());
      assert.equal(alertText(), '');
      assert.equal(document.activeElement, metricButton('体检发现'));
    });

    await run('empty dashboard entries retain their report, open issue and project event scopes', async fixture => {
      const {answer,report} = dashboardFixture(fixture);
      const empty = {pendingProposals:0, alerts:0, quality:null, coverage:null, workflows:0, events:0, worksets:0, reviewOpen:0, briefEnabled:false};
      answer('dashboard.view', empty);
      answer('worksets.list', []);
      answer('quality.document.last', null);
      answer('review.list', []);
      answer('events.list', []);
      await openDashboard();
      assert.equal(metricButton('体检发现')?.querySelector('b')?.textContent, '—');
      await drill('体检发现');
      assert.match(document.querySelector('.ro-report-body')!.textContent!, /本项目还没有已保存的体检报告/);
      answer('dashboard.view', {...empty,quality:{checked:1,findings:0,byRule:[]}});
      answer('quality.document.last', {...report,total:1,checked:1,clean:1,items:[report.items[2]],byRule:[]});
      await escape();
      assert.equal(metricButton('体检发现')?.querySelector('b')?.textContent, '0');
      await drill('体检发现');
      assert.match(document.querySelector('.ro-report-body')!.textContent!, /本次检查的条目中没有体检发现/);
      assert(!fixture.calls.some(c => c.method === 'quality.document.check'));
      await escape();
      await drill('AI 预审未决');
      const review = document.querySelector('[aria-label="AI 预审评审台"]')!;
      assert(review.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked);
      assert.match(review.textContent!, /最近 20 次预审记录中没有未决问题/);
      await escape();
      await drill('项目事件（近500条）');
      const feed = document.querySelector('.pi-body')!;
      assert.match(feed.textContent!, /最近 500 条 · 共 0 条/);
      assert.match(feed.textContent!, /本项目还没有事件/);
      assert.equal(feed.querySelector('.pi-event'), null);
    });

    await run('dashboard quality opens the saved project report, exposes all details and reopens on the requested view', async fixture => {
      const {answer,report} = dashboardFixture(fixture);
      await tab('属性'); await openDashboard(); await drill('体检发现');
      const overview = () => document.querySelector('.requirements-overview')!;
      assert.match(overview().textContent!, /整册体检报告/); assert.match(overview().textContent!, /已检查 3\/5 项/);
      assert.equal(overview().querySelectorAll('.ro-quality-row').length, 2);
      assert.equal(overview().querySelector('.ro-report-source a')?.getAttribute('href'), target.origin + '/polarion/#/project/test01/wiki/Requirements/Other');
      assert.equal(overview().querySelector('.ro-quality-rewrite'), null);
      assert(!fixture.calls.some(command => command.method === 'quality.document.check' || command.method === 'document.outline'));
      const details = overview().querySelector('[aria-label="展开 SPE-1 的体检详情"]'); assert.match(details!.textContent!, /\+2/); await click(details);
      assert.equal(overview().querySelectorAll('.ro-quality-detail ol li').length, 5);
      assert.match(overview().querySelector('.ro-quality-detail')!.textContent!, /long-rule-4.*发现 4 的完整描述.*原文4.*修改建议4/s);
      assert.match(overview().querySelector('.ro-quality-detail')!.textContent!, /需补充来源链接/);
      assert.equal([...overview().querySelectorAll('.ro-impact-link')].find(link => link.textContent === 'TC-4 · 验证')?.textContent, 'TC-4 · 验证');
      await click(overview().querySelector('[title="回到结构总览"]'));
      assert.match(overview().querySelector('header strong')!.textContent!, /需求总览/);
      await openDashboard(); answer('quality.document.last', {...report,document:undefined}); await drill('体检发现');
      assert.match(overview().textContent!, /历史报告未记录来源文档/); assert.equal(overview().querySelector('.ro-quality-rewrite'), null);
      assert.equal(fixture.calls.filter(c => c.method === 'quality.document.last').length, 2);
      await click(overview().querySelector('[title^="重新体检当前文档"]'));
      assert.equal(overview().querySelector('.ro-report-source a')?.textContent, target.document);
      assert.deepEqual(fixture.calls.findLast(c => c.method === 'quality.document.check'), {method:'quality.document.check',target,limit:300});
      await escape(overview().querySelector('input')); assert(dashboardVisible()); assert.equal(document.activeElement, metricButton('体检发现'));
    });

    await run('quality refresh recovers the completed report after a host timeout', async fixture => {
      const {answer,report} = dashboardFixture(fixture);
      await tab('属性'); await openDashboard(); await drill('体检发现');
      const overview = () => document.querySelector('.requirements-overview')!;
      assert.match(overview().textContent!, /已检查 3\/5 项/);
      const fresh = {...report, document:target.document, at:Date.now(), total:5, checked:5, clean:4,
        items:[{workItemId:'SPE-9', title:'超时后完成', outline:'9', issues:[{ruleId:'r-1', severity:'warn', message:'超时后的新发现'}]}],
        byRule:[{ruleId:'r-1', count:1}]};
      fixture.replies.set('quality.document.check', () => ({ok:false, error:'HOST_REQUEST_TIMEOUT'}));
      fixture.replies.set('quality.document.last', () => ({ok:true, value:fresh}));
      await click(overview().querySelector('[title^="重新体检当前文档"]'));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      assert.equal(overview().querySelector('[role=alert]'), null);
      assert.match(overview().textContent!, /4\/5 通过/);
      assert.match(overview().textContent!, /超时后的新发现/);
      assert.equal(overview().querySelector('.ro-report-source a')?.textContent, target.document);
      // 旧报告不能冒充本次结果。
      fixture.replies.set('quality.document.last', () => ({ok:true, value:{...report, at:1}}));
      await click(overview().querySelector('[title^="重新体检当前文档"]'));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      assert.match(overview().querySelector('[role=alert]')?.textContent ?? '', /HOST_REQUEST_TIMEOUT/);
    });

    await run('coverage detail links open the reading preview instead of a native work item tab', async fixture => {
      const {answer} = dashboardFixture(fixture);
      answer('model.roots', {roots:[{id:'root', label:'Fixture', path:'', modules:[], dictionaries:[]}]});
      answer('model.baseline.list', []);
      answer('model.trace.view', {roots:[], groups:[], unannotated:[], total:0, annotated:0, syncedAt:1, stale:false});
      const base = {title:'需求', type:'softwarerequirement', outline:'1.1', updated:'v1', marks:[], text:'正文', moduleCount:0};
      answer('coverage.view', {items:[{...base, workItemId:'SPE-1', upstream:1, verification:1,
        forwardLinks:[{workItemId:'UP-1', role:'derives'}],
        backLinks:[{workItemId:'TC-1', role:'test'}]}], total:1, at:3, summary:{withUpstream:1,withModule:0,withVerification:1,orphans:0}});
      await paletteCommand('模型关联与追溯');
      await click(document.querySelector('.model-trace button[title^="覆盖矩阵"]'));
      assert.equal(document.querySelectorAll('.model-coverage-row').length, 1);
      await click(document.querySelector('.model-coverage-links'));
      const links = [...document.querySelectorAll<HTMLAnchorElement>('.mc-link-row a')];
      assert.deepEqual(links.map(link => link.textContent?.replace(/\s+/g,' ').trim()), ['UP-1 derives', 'TC-1 test']);
      let notCancelled = true;
      await act(async () => { notCancelled = links[0]!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles:true, cancelable:true})); });
      assert.equal(notCancelled, false, 'primary click must not navigate to a native Polarion tab');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      assert.match(document.querySelector('.reader-title')!.textContent!, /UP-1/);
      assert.ok(fixture.calls.some(command => command.method === 'workitems.read' && command.workItemId === 'UP-1'));
      await escape();
      assert(!document.querySelector('.reader-panel'));
      await act(async () => { notCancelled = links[1]!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles:true, cancelable:true})); });
      assert.equal(notCancelled, false);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      assert.match(document.querySelector('.reader-title')!.textContent!, /TC-1/);
      assert.ok(fixture.calls.some(command => command.method === 'workitems.read' && command.workItemId === 'TC-1'));
    });

    await run('quality rewrite binds only the selected item and restores the expanded report after editing', async fixture => {
      const {answer,report,item} = dashboardFixture(fixture);
      await tab('属性'); await click(document.querySelector('.draft-open')); await act(async () => { fixture.drafts.get('A')!.resolve(draft('A')); });
      answer('quality.document.last', {...report,document:target.document,items:[report.items[0],{...report.items[0],workItemId:'FOREIGN-1',readOnlyReference:true}]});
      await openDashboard(); await drill('体检发现');
      const overview = document.querySelector('.requirements-overview')!;
      assert.equal(overview.querySelectorAll('.ro-quality-rewrite').length, 1);
      const search=overview.querySelector<HTMLInputElement>('input[aria-label="搜索工作项"]')!;
      await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(search,'SPE-1');search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
      await click(overview.querySelector('.ro-quality-toggle'));
      const rewrite = overview.querySelector('.ro-quality-rewrite')!;
      fixture.replies.set('workitems.read', () => ({ok:true,value:item('SPE-1',true)})); await click(rewrite);
      assert.match(overview.querySelector('[role=alert]')!.textContent!, /所属文档/); assert(!fixture.calls.some(c=>c.method==='runs.start'));
      answer('workitems.read', item('SPE-1')); fixture.replies.set('runs.start', () => ({ok:false,error:'FAILED_FIXTURE'})); await click(rewrite);
      assert.match(overview.querySelector('[role=alert]')!.textContent!, /FAILED_FIXTURE/);
      const sent = fixture.calls.findLast(c => c.method === 'runs.start'); assert(sent && sent.method === 'runs.start');
      assert.deepEqual(sent.contexts.map(c => c.workItemId), ['SPE-1']); assert.deepEqual(sent.target,target);
      assert.equal(sent.autoSave, false, 'A suggested rewrite remains a draft for human review');
      answer('drafts.open', item('SPE-1')); answer('drafts.rich.read', {draft:item('SPE-1'),document:{type:'doc'}});
      const openItem = overview.querySelector<HTMLButtonElement>('.ro-quality-open')!; openItem.focus(); await click(openItem);
      await click(document.querySelector('.reader-panel footer .primary'));
      assert.equal(document.querySelector('[data-test-editor]')?.getAttribute('data-test-editor'),'SPE-1'); assert(overview.closest('[hidden]'));
      await click(document.querySelector('[data-test-close]'));
      assert.equal(document.querySelector('.requirements-overview'),overview); assert(!overview.closest('[hidden]')); assert.equal(search.value,'SPE-1');
      assert.equal(overview.querySelector('.ro-quality-toggle')?.getAttribute('aria-expanded'),'true'); assert.equal(document.activeElement,openItem);
      await escape(); assert(dashboardVisible());
    });

    await run('review tile matches open cards in open project records and resets a changed filter', async fixture => {
      const {answer} = dashboardFixture(fixture);
      const card = (id:string, status:string, workItemId:string) => ({id, status, workItemId, severity:'major', summary:id, suggestion:'建议 '+id});
      answer('review.list', [
        {id:'here', at:2, status:'open', document:target.document, issues:[card('local-open','open','SPE-1'),card('resolved','resolved','SPE-2')]},
        {id:'elsewhere', at:1, status:'open', document:'Requirements/Other', issues:[card('foreign-open','open','FOREIGN-1'),card('ignored','ignored','FOREIGN-2')]},
        {id:'closed', at:0, status:'done', document:target.document, issues:[card('closed-card','open','SPE-3')]},
      ]);
      await openDashboard(); await drill('AI 预审未决');
      const check = () => document.querySelector<HTMLInputElement>('.rp-panel input[type=checkbox]')!;
      assert(check().checked); assert.match(check().parentElement!.textContent!, /只看未决问题（2）/);
      assert.deepEqual([...document.querySelectorAll('.rp-issue .summary')].map(n=>n.textContent),['local-open','foreign-open']);
      assert.equal(document.querySelectorAll('.rp-issue .rp-apply').length,1);
      const foreign = [...document.querySelectorAll<HTMLButtonElement>('.rp-issue .rp-item')].find(b=>b.textContent==='FOREIGN-1')!;
      foreign.focus(); await click(foreign); assert(document.querySelector('.reader-panel')); assert(!document.querySelector('.reader-panel footer .primary'));
      await escape(); assert(check().checked); assert.equal(document.activeElement,foreign);
      await click(check()); assert.equal(document.querySelectorAll('.rp-issue').length,5);
      await openDashboard(); await drill('AI 预审未决'); assert(check().checked); assert.equal(document.querySelectorAll('.rp-issue').length,2);
      await escape(check()); assert(dashboardVisible()); await paletteCommand('AI 预审评审'); assert(!check().checked);
      await escape(check()); assert(!dashboardVisible());
    });

    await run('meeting polling updates only the cards and dispatch keeps their target and manual save boundary', async fixture => {
      const {answer} = dashboardFixture(fixture);
      const action = (id: string, workItemId?: string) => ({id, title:id, workItemId, priority:'normal', status:'open'});
      const record = { id:'meeting', document:target.document, at:1, status:'running', actions:[] };
      answer('meeting.list', [record]); answer('watch.view', {alerts:[],brief:{enabled:false,at:'07:30'}}); answer('events.list', []);
      answer('runs.start', {id:'sent'});
      await tab('属性'); await click(document.querySelector('.draft-open'));
      await act(async () => { fixture.drafts.get('A')!.resolve(draft('A')); });
      await paletteCommand('动态与警报');
      const body = document.querySelector<HTMLElement>('.pi-body')!;
      body.scrollTop = 53;
      assert.match(body.textContent!, /分诊中/);
      answer('meeting.list', [
        {...record, status:'open', actions:[action('bound','B'), action('unbound'), action('reference','FOREIGN-1')]},
        {...record, id:'other-doc', document:'Requirements/Other', status:'open', actions:[action('elsewhere','B')]},
      ]);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 3150)); });
      assert.equal(document.querySelector('.pi-body'), body); assert.equal(body.scrollTop, 53);
      assert.equal(fixture.calls.filter(c => c.method === 'events.list').length, 1);
      assert.equal(fixture.calls.filter(c => c.method === 'watch.view').length, 1);
      const [bound, unbound, reference, elsewhere] = Array.from(body.querySelectorAll('.pi-action'));
      const send = (row: Element) => [...row.querySelectorAll('button')].find(b => b.textContent === '发 AI 执行');
      assert.equal(send(elsewhere!), undefined);
      assert.equal(body.querySelector('.pi-meeting-head a')?.getAttribute('href'), target.origin+'/polarion/#/project/test01/wiki/Requirements/Other');
      await click(send(bound!));
      const directed = fixture.calls.findLast(c => c.method === 'runs.start');
      assert(directed?.method === 'runs.start'); assert.equal(directed.autoSave, false);
      assert.deepEqual(directed.contexts.map(c => c.workItemId), ['B']);
      assert.match(bound!.textContent!, /已提交到会话/);
      await click(send(unbound!));
      const general = fixture.calls.findLast(c => c.method === 'runs.start');
      assert(general?.method === 'runs.start'); assert.equal(general.autoSave, false); assert.deepEqual(general.contexts, []);
      await click(send(reference!));
      assert.match(body.parentElement!.querySelector('[role=alert]')!.textContent!, /FOREIGN-1.*所属文档/);
      assert.equal(fixture.calls.filter(c => c.method === 'runs.start').length, 2);
    });

    await run('inbox and group settings show delivery receipts only after explicit send', async fixture => {
      const {answer} = dashboardFixture(fixture);
      answer('watch.view', {alerts:[],brief:{enabled:false,at:'07:30'}}); answer('events.list', []); answer('meeting.list', []);
      answer('brief.preview', {digest:'预览内容'});
      answer('brief.send', {digest:'投递内容',sent:true,reason:'晨报部分发送成功（1/2 个群）：B（拒收）'});
      await paletteCommand('动态与警报');
      const named = (selector: string, text: string) => [...document.querySelectorAll(selector)].find(el => el.textContent === text);
      await click(named('.pi-brief button', '预览晨报'));
      assert.equal(document.querySelector('.pi-brief-digest')?.textContent, '预览内容');
      assert(!fixture.calls.some(c => c.method === 'brief.send'));
      await click(named('.pi-brief button', '立即发送'));
      assert.match(document.querySelector('.pi-brief-digest')!.textContent!, /部分发送成功.*1\/2.*拒收/);
      await escape(document.querySelector('.pi-layer'));
      answer('changes.workspace.read', {target,records:[],projectRecords:[],sessions:[],online:false});
      const group = {id:'temporary',label:'夹具',webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-only',secret:''};
      answer('changes.feishu.groups', {source:'cache',groups:[group]});
      answer('changes.share.feishuTest', [{label:'测试群',ok:true}]);
      await paletteCommand('变更管理'); await click(document.querySelector('[title^="飞书推送群"]'));
      const send = named('.cw-feishu-actions button', '发送测试卡片');
      assert(!fixture.calls.some(c => c.method === 'changes.share.feishuTest'));
      await click(send);
      assert.match(document.querySelector('.cw-feishu-actions [role=status]')!.textContent!, /已发送/);
      answer('changes.share.feishuTest', [{label:'测试群',ok:false,error:'夹具拒收'}]);
      await click(send);
      assert.match(document.querySelector('.cw-feishu-actions [role=status]')!.textContent!, /发送失败.*夹具拒收/);
      assert(!fixture.calls.some(c => c.method === 'changes.feishu.groups.save'));
    });

    await run('Escape cancels a pending reader first and closing the event list discards a late body', async fixture => {
      const {answer,item} = dashboardFixture(fixture);
      answer('events.list', [{id:'event-1',kind:'note',subject:'事件',at:1,workItemId:'SPE-1'}]);
      const first = deferred();
      fixture.replies.set('workitems.read', () => first.promise);
      await openDashboard();
      await drill('项目事件（近500条）');
      const list = document.querySelector('.pi-layer')!;
      const openItem = list.querySelector<HTMLButtonElement>('.pi-event .pi-item')!;
      openItem.focus();
      await click(openItem);
      assert.match(document.querySelector('.reader-notice')!.textContent!, /SPE-1.*正在读取正文/);
      await act(async () => { openItem.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', isComposing:true, bubbles:true, cancelable:true})); });
      assert(document.querySelector('.reader-notice'));
      await escape(openItem);
      assert.equal(document.querySelector('.reader-notice'), null);
      assert.equal(document.querySelector('.pi-layer'), list);
      assert.equal(document.activeElement, openItem);
      await act(async () => { first.resolve({ok:true, value:item('SPE-1')}); });
      assert.equal(document.querySelector('.reader-panel'), null);

      const second = deferred();
      fixture.replies.set('workitems.read', () => second.promise);
      await click(openItem);
      assert(document.querySelector('.reader-notice'));
      const mouseDown = async (button: number) => {
        await act(async () => { list.dispatchEvent(new dom.window.MouseEvent('mousedown', {button, bubbles:true, cancelable:true})); });
      };
      await mouseDown(2);
      assert.equal(document.querySelector('.pi-layer'), list);
      assert(document.querySelector('.reader-notice'));
      await mouseDown(0);
      assert.equal(document.querySelector('.pi-layer'), null);
      assert.equal(document.querySelector('.reader-notice'), null);
      assert(dashboardVisible());
      await act(async () => { second.resolve({ok:true, value:item('SPE-1')}); });
      assert.equal(document.querySelector('.reader-panel'), null);
      assert.equal(document.activeElement, metricButton('项目事件（近500条）'));
    });

    await run('project event tile keeps 500 events independent of the active draft and preserves expanded pages after reading', async fixture => {
      const {answer} = dashboardFixture(fixture);
      const events = Array.from({length:500},(_,n)=>({id:String(n),kind:'note',subject:`事件 ${n}`,at:500-n,workItemId:n%2?'SPE-1':'FOREIGN-2'}));
      fixture.replies.set('events.list', c => c.method==='events.list' && ({ok:true,value:events.slice(0,c.limit)}));
      answer('timeline.view',{entries:[]}); answer('watch.view',{alerts:[],brief:{enabled:false}}); answer('meeting.list',[]);
      await tab('属性'); await click(document.querySelector('.draft-open')); await act(async()=>{fixture.drafts.get('A')!.resolve(draft('A'));});
      await openDashboard(); await drill('项目事件（近500条）');
      assert.deepEqual(fixture.calls.findLast(c=>c.method==='events.list'),{method:'events.list',projectId:target.projectId,limit:500});
      assert(!fixture.calls.some(c=>c.method==='timeline.view')); assert.match(document.querySelector('.pi-body')!.textContent!,/共 500 条/);
      assert.equal(document.querySelectorAll('.pi-event').length,60);
      for (let n=60;n<500;n+=60) await click([...document.querySelectorAll('.pi-body button')].find(b=>b.textContent?.includes('显示更多事件')));
      const eventRows = document.querySelectorAll('.pi-event');
      assert.equal(eventRows.length, 500);
      assert.equal(eventRows[499]!.querySelector('.pi-summary')?.textContent, '事件 499');
      const openItem=document.querySelector<HTMLButtonElement>('.pi-event .pi-item')!; openItem.focus(); await click(openItem);
      await escape(); assert.equal(document.activeElement,openItem); assert.equal(document.querySelectorAll('.pi-event').length,500);
      const feedRefresh = deferred();
      fixture.replies.set('events.list', c => c.method === 'events.list' && (c.limit === 60 ? feedRefresh.promise : {ok:true, value:events}));
      await click([...document.querySelectorAll('.pi-body button')].find(b => b.textContent === '查看全部动态与警报'));
      assert.deepEqual(fixture.calls.findLast(c => c.method === 'events.list'), {method:'events.list',projectId:target.projectId,limit:60});
      assert.equal(document.querySelectorAll('.pi-event').length, 60);
      await act(async () => { feedRefresh.resolve({ok:false, error:'FEED_OFFLINE'}); });
      assert.match(document.querySelector('.pi-error')!.textContent!, /FEED_OFFLINE/);
      assert.match(document.querySelector('.pi-body')!.textContent!, /最近 60 条 · 共 60 条/);
      assert.equal(document.querySelectorAll('.pi-event').length, 60);
      await click([...document.querySelectorAll('.pi-tabs button')].find(b=>b.textContent==='时间线'));
      assert.deepEqual(fixture.calls.findLast(c=>c.method==='timeline.view'),{method:'timeline.view',target,workItemId:'A'});
      await openDashboard(); await drill('项目事件（近500条）'); assert.equal(document.querySelectorAll('.pi-event').length,60);
      await escape(); assert(dashboardVisible());
    });

    await run('proposal, warning, orphan, workset and workflow tiles lead to the counted lists from other tabs and a collapsed sidebar', async fixture => {
      const {answer} = dashboardFixture(fixture);
      answer('proposals.list', ['replace-all-text','tool','gate'].map((kind,n)=>({id:kind,status:'pending',op:{kind},summary:kind,source:'manual',createdAt:n})));
      answer('watch.view', {alerts:[{level:'info',title:'提示'},{level:'warn',title:'需要处理',detail:'详细警报'}],brief:{enabled:false}});
      const base = {title:'需求',forwardLinks:[],backLinks:[],marks:[],moduleCount:0,verification:0};
      answer('coverage.view',{items:[{...base,workItemId:'ORPHAN',upstream:0},{...base,workItemId:'HAS-UPSTREAM',upstream:1}],total:2,at:3,summary:{withUpstream:1,withModule:0,withVerification:0,orphans:1}});
      answer('worksets.items', {items:Array.from({length:31},(_,n)=>({workItemId:'WS-'+n,title:'工作项',reason:'命中'}))});
      // jsdom provides focus and event dispatch but has no layout/scroll implementation.
      dom.window.HTMLElement.prototype.scrollIntoView ??= () => {};
      await tab('大纲'); await openDashboard(); await drill('待审批提案');
      assert.equal(document.querySelectorAll('.pi-row').length,1); assert.match(document.querySelector('.pi-summary')!.textContent!,/replace-all-text/);
      await click([...document.querySelectorAll('.pi-body button')].find(b=>b.textContent==='查看全部提案')); assert.equal(document.querySelectorAll('.pi-row').length,3);
      await escape(document.querySelector('.pi-body')); await drill('守望警报'); assert.equal(document.querySelectorAll('.pi-alert').length,1); assert(!document.querySelector('.pi-alert.info'));
      await escape(); await drill('孤立条目'); assert.equal(document.querySelectorAll('.model-coverage-row').length,1); assert.match(document.querySelector('.model-coverage-row')!.textContent!,/ORPHAN/);
      assert(!fixture.calls.some(c=>c.method==='model.check'||c.method==='model.roots'||c.method==='coverage.sync'));
      await click(document.querySelector('.model-coverage-filter input')); assert.equal(document.querySelectorAll('.model-coverage-row').length,2);
      await openDashboard(); await drill('孤立条目'); assert.equal(document.querySelectorAll('.model-coverage-row').length,1);
      await escape(); await drill('工作集'); assert.equal(document.activeElement?.id,'dashboard-worksets-heading');
      await click(document.querySelector('.dash-ws-main')); assert.equal(document.querySelectorAll('.dash-ws-items button').length,30);
      await click([...document.querySelectorAll('.dash-ws button')].find(b=>b.textContent?.includes('显示更多工作项'))); assert.equal(document.querySelectorAll('.dash-ws-items button').length,31);
      const lastWorksetItem = document.querySelector<HTMLButtonElement>('.dash-ws-items button:last-child')!;
      assert.equal(lastWorksetItem.querySelector('strong')?.textContent, 'WS-30');
      lastWorksetItem.focus(); await click(lastWorksetItem);
      assert.match(document.querySelector('.reader-title')!.textContent!, /WS-30/);
      await escape();
      assert.equal(document.activeElement, lastWorksetItem);
      assert.equal(document.querySelectorAll('.dash-ws-items button').length, 31);
      await click(document.querySelector('[title="收起助手，任务继续运行"]')); assert(!document.querySelector('aside.workspace'));
      await drill('工作流'); assert.equal(document.querySelector('.tabs .selected')?.textContent,'AI 助手'); assert.equal(document.querySelector('.workflow-tabs [aria-selected=true]')?.textContent,'设计');
      await act(async()=>{await new Promise(resolve=>dom.window.requestAnimationFrame(resolve));}); assert.equal(document.activeElement?.textContent,'工作流定义');
      await escape(document.querySelector('.workflow-panel')); assert(dashboardVisible()); assert.equal(document.activeElement,metricButton('工作流'));
      await drill('工作流');
      await click([...document.querySelectorAll('.workflow-tabs button')].find(b=>b.textContent==='运行轨迹'));
      await paletteCommand('工作流与宏'); assert.equal(document.querySelector('.workflow-tabs [aria-selected=true]')?.textContent,'设计');
      await escape(document.querySelector('.workflow-panel')); assert(!dashboardVisible());
      await tab('属性'); await click(document.querySelector('[title="收起助手，任务继续运行"]')); await paletteCommand('动态工作流');
      await act(async()=>{await new Promise(resolve=>dom.window.requestAnimationFrame(resolve));}); assert.equal(input().value,'/wf::'); assert.equal(document.activeElement,input());
    });

    const openWorkflows = () => click(document.querySelector('.session-bar button[title^="工作流"]'));
    const workflowPanel = () => document.querySelector('.workflow-panel');
    const workflowButton = (label:string, scope = workflowPanel()) => click([...scope!.querySelectorAll('button')].find(button => button.textContent?.trim() === label));
    const workflowField = async (label:string, value:string) => {
      const field = workflowPanel()!.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
      assert(field);
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
        field.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
      });
    };
    const workflowAlert = () => workflowPanel()?.querySelector('[role="alert"]')?.textContent ?? '';
    const trace = (id:string) => ({id,defName:'轨迹 '+id,sessionId:id,status:'done',startedAt:1,steps:[]});

    await run('workflow capture returns the Host macro and keeps actionable errors in the panel', async fixture => {
      await openWorkflows();
      await workflowField('宏名称', '测试指令');
      await workflowField('录制条数', '2');
      fixture.replies.set('macros.capture', () => ({ok:false,error:'MACRO_NAME_EXISTS'}));
      await workflowButton('录制');
      assert.match(workflowAlert(), /MACRO_NAME_EXISTS/);
      assert.equal(workflowPanel()!.querySelector<HTMLInputElement>('[aria-label="宏名称"]')?.value, '测试指令');
      const saved = {id:'fixture-macro',projectId:target.projectId,name:'测试指令',steps:['Host 返回的第一条','Host 返回的第二条'],createdAt:1};
      fixture.replies.set('macros.capture', () => ({ok:true,value:saved}));
      fixture.replies.set('macros.list', () => ({ok:true,value:[saved]}));
      await workflowButton('录制');
      assert.deepEqual(fixture.calls.findLast(c => c.method === 'macros.capture'), {method:'macros.capture',sessionId:session.id,name:'测试指令',count:2});
      assert.match(workflowPanel()!.textContent!, /已录制「测试指令」，共 2 条指令/);
      fixture.replies.set('macros.run', () => ({ok:false,error:'MACRO_PROJECT_MISMATCH'}));
      await workflowButton('重放');
      assert.match(workflowAlert(), /MACRO_PROJECT_MISMATCH/);
      fixture.replies.set('macros.run', () => ({ok:true,value:{started:2}}));
      await workflowButton('重放');
      assert.equal(workflowPanel(), null);
      assert.equal(sessionTitle(), session.title);
    });

    for (const kind of ['workflows.run', 'workflows.plan'] as const) await run(`${kind} keeps the panel open until the Host accepts the launch`, async fixture => {
      await openWorkflows();
      const label = kind === 'workflows.run' ? '运行' : '拆解并执行';
      await workflowField(kind === 'workflows.run' ? '本次运行附注' : '动态工作流目标', '只读测试');
      const reply = deferred();
      fixture.replies.set(kind, () => reply.promise);
      await workflowButton(label);
      assert(workflowPanel());
      assert.deepEqual(fixture.calls.findLast(c => c.method === kind), {method:kind,sessionId:session.id,target,contexts:[],permissionMode:'auto',...(kind === 'workflows.run' ? {defId:workflow.id,note:'只读测试'} : {goal:'只读测试'})});
      await act(async () => { reply.resolve({ok:false,error:'WORKFLOW_SESSION_BUSY'}); });
      assert.match(workflowAlert(), /WORKFLOW_SESSION_BUSY/);
      fixture.replies.set(kind, () => ({ok:true,value:{}}));
      await workflowButton(label);
      assert.equal(workflowPanel(), null);
      assert.equal(document.querySelector('.tabs .selected')?.textContent, 'AI 助手');
    });

    await run('slash workflow launches keep their error and draft handling in the composer', async fixture => {
      const submitted = '/wf:' + workflow.name + ' 检查一';
      fixture.replies.set('workflows.run', () => ({ok:false,error:'WORKFLOW_SESSION_BUSY'}));
      await type(submitted); await click(document.querySelector('.send'));
      assert.match(document.querySelector('.workspace .error')?.textContent ?? '', /当前会话已有进行中或暂停的工作流/);
      assert.equal(input().value, submitted);
      const reply = deferred();
      fixture.replies.set('workflows.plan', () => reply.promise);
      await type('/wf::只读目标'); await click(document.querySelector('.send'));
      await type('/wf::更新后的目标');
      await act(async () => { reply.resolve({ok:true,value:{runId:'planning'}}); });
      assert.equal(input().value, '/wf::更新后的目标');
      assert(!workflowPanel());
    });

    await run('batch sends the note and opens a returned session from the current project on a cache miss', async fixture => {
      await openWorkflows();
      await workflowField('本次运行附注', '只检查测试项');
      await workflowButton('批量');
      await workflowField('批量工作项编号', 'T-1\nT-2');
      fixture.replies.set('workflows.runBatch', () => ({ok:false,error:'WORKFLOW_PROJECT_MISMATCH'}));
      await workflowButton('开始批量');
      assert.match(workflowAlert(), /WORKFLOW_PROJECT_MISMATCH/);
      const receipt = [{workItemId:'T-1',sessionId:'batch-1'},{workItemId:'T-2',sessionId:'batch-2'}];
      fixture.replies.set('workflows.runBatch', () => ({ok:true,value:receipt}));
      await workflowButton('开始批量');
      assert.deepEqual(fixture.calls.findLast(c => c.method === 'workflows.runBatch'), {method:'workflows.runBatch',target,defId:workflow.id,workItemIds:['T-1','T-2'],permissionMode:'auto',note:'只检查测试项'});
      assert.equal(workflowPanel()!.querySelectorAll('.workflow-receipt button[title]').length, 2);
      const selected = {...session,id:'batch-2',title:'批量会话 T-2',target:{...target,document:'Requirements/Second'}};
      fixture.replies.set('sessions.list', () => ({ok:true,value:[selected]}));
      await workflowButton('T-2');
      assert.equal(workflowPanel(), null);
      assert.equal(sessionTitle(), selected.title);
      assert.deepEqual(fixture.calls.findLast(c => c.method === 'sessions.list'), {method:'sessions.list',projectId:target.projectId});
      assert(fixture.calls.some(c => c.method === 'sessions.read' && c.sessionId === selected.id));
      assert(!fixture.calls.some(c => c.method === 'sessions.create'));
    });

    await run('trace refuses missing and foreign sessions and opens a cached session without fetching a list', async fixture => {
      fixture.replies.set('workflows.history', () => ({ok:true,value:[trace('absent'),trace('foreign'),trace(session.id)]}));
      fixture.replies.set('sessions.list', () => ({ok:true,value:[{...session,id:'foreign',target:{...target,projectId:'other'}}]}));
      await openWorkflows(); await workflowButton('运行轨迹');
      const cards = workflowPanel()!.querySelectorAll('.workflow-trace-run');
      for (const card of [cards[0]!, cards[1]!]) {
        await workflowButton('查看会话全文', card);
        assert.match(workflowAlert(), /当前项目找不到此会话/);
        assert.equal(sessionTitle(), session.title);
      }
      const before = fixture.calls.filter(c => c.method === 'sessions.list').length;
      await workflowButton('查看会话全文', cards[2]!);
      assert.equal(workflowPanel(), null);
      assert.equal(fixture.calls.filter(c => c.method === 'sessions.list').length, before);
      assert(!fixture.calls.some(c => c.method === 'sessions.read' && c.sessionId === 'foreign'));
    });

    await run('a pending history lookup cannot navigate after the document URL changes', async fixture => {
      fixture.replies.set('workflows.history', () => ({ok:true,value:[trace('late')]}));
      const lookup = deferred();
      fixture.replies.set('sessions.list', () => lookup.promise);
      await openWorkflows(); await workflowButton('运行轨迹'); await workflowButton('查看会话全文');
      assert(workflowPanel());
      // The browser URL changes before React's hashchange listener runs.
      dom.window.history.replaceState(null, '', '#/project/test01/wiki/Requirements/Second');
      await act(async () => { lookup.resolve({ok:true,value:[{...session,id:'late',title:'过期会话'}]}); });
      assert.match(workflowAlert(), /当前文档已切换/);
      assert.equal(sessionTitle(), session.title);
      assert(!fixture.calls.some(c => c.method === 'sessions.read' && c.sessionId === 'late'));
    });

    await run('a history reply after closing and reopening the workflow panel cannot replace the session', async fixture => {
      fixture.replies.set('workflows.history', () => ({ok:true,value:[trace('late')]}));
      const lookup = deferred();
      fixture.replies.set('sessions.list', () => lookup.promise);
      await openWorkflows(); await workflowButton('运行轨迹'); await workflowButton('查看会话全文');
      await click(workflowPanel()!.querySelector('[aria-label="关闭工作流面板"]'));
      await openWorkflows();
      await act(async () => { lookup.resolve({ok:true,value:[{...session,id:'late',title:'上次操作的会话'}]}); });
      assert(workflowPanel());
      assert.equal(sessionTitle(), session.title);
    });

    await run('session bar opens the local experience viewer',async fixture=>{
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
      await click(document.querySelector('.session-bar button[title*="经验沉淀"]'));
      assert(document.querySelector('.experience-layer'));
      assert.match(document.querySelector('.experience-body')!.textContent!,/还没有沉淀经验/);
    });

    await run('a failed editor read preserves the reader and closing it cancels a late retry', async fixture => {
      const item = { ...draft('A'), nodes: [], html: '<p>Original preview</p>', baseHtml: '<p>Original preview</p>' };
      fixture.replies.set('workitems.read', () => ({ ok: true, value: item }));
      fixture.replies.set('drafts.open', () => ({ ok: true, value: item }));
      fixture.replies.set('drafts.rich.read', () => ({ ok: false, error: 'TEMPORARY_READ_FAILURE' }));
      await act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { origin: location.origin, data: { __polarionSidebar: 'open-workitem', workItemId: 'A' } })); });
      await click(document.querySelector('.reader-panel footer .primary'));
      assert.match(document.querySelector('.reader-notice[role=alert]')!.textContent!, /TEMPORARY_READ_FAILURE/);
      assert.equal(document.querySelector('.reader-title h2')?.textContent, item.title);
      const retry = deferred();
      fixture.replies.set('drafts.rich.read', () => retry.promise);
      await click(document.querySelector('.reader-notice .secondary'));
      await click(document.querySelector('[aria-label="关闭阅读预览"]'));
      await act(async () => { retry.resolve({ ok: true, value: { editorId: 'editor-A', draft: item, document: { type: 'doc' } } }); });
      assert.equal(document.querySelector('.reader-panel, .reader-notice, [data-test-editor]'), null);
    });

    await run('newer draft selection wins and a late draft cannot reopen after navigation',async fixture=>{
      await tab('属性');
      const row=(id:string)=>[...document.querySelectorAll<HTMLButtonElement>('.draft-open')].find(element=>element.textContent?.includes(id));
      await click(row('A'));await click(row('B'));assert(fixture.drafts.has('A'));assert(fixture.drafts.has('B'));
      await act(async()=>{fixture.drafts.get('B')!.resolve(draft('B'));});
      await act(async()=>{fixture.drafts.get('A')!.resolve(draft('A'));});
      assert.equal(document.querySelector('[data-test-editor]')?.getAttribute('data-test-editor'),'B');
      await click(document.querySelector('[data-test-close]'));await tab('属性');await click(row('C'));
      await navigate('test01');await act(async()=>{fixture.drafts.get('C')!.resolve(draft('C'));});
      assert.equal(document.querySelector('[data-test-editor]'),null);
    });

    await run('a session rename reply from the previous route cannot replace the new session or start a run',async fixture=>{
      await click(document.querySelector('button[title="新建会话"]'));
      const fresh={...session,id:'fresh',title:'新工程会话'};
      await act(async()=>{fixture.create.resolve(fresh);});await type('rename request');await click(document.querySelector('.send'));
      assert(fixture.calls.some(command=>command.method==='sessions.rename'));
      await navigate('other-project');await act(async()=>{fixture.rename.resolve({...fresh,title:'Stale rename'});});
      assert.equal(sessionTitle(),'新工程会话');assert.equal(fixture.calls.filter(command=>command.method==='runs.start').length,0);
    });

    await run('a session create reply from the previous route cannot replace the new session or start a run',async fixture=>{
      await type('create request');await click(document.querySelector('.send'));
      assert(fixture.calls.some(command=>command.method==='sessions.create'));
      await navigate('other-project');await act(async()=>{fixture.create.resolve({...session,id:'stale-created',title:'Stale created session'});});
      assert.equal(sessionTitle(),'新工程会话');assert.equal(fixture.calls.filter(command=>command.method==='runs.start').length,0);
    },false);

    const open=async(fixture:Awaited<ReturnType<typeof mount>>,id:string)=>{await tab('属性');await click([...document.querySelectorAll<HTMLButtonElement>('.draft-open')].find(element=>element.textContent?.includes(id)));await act(async()=>{fixture.drafts.get(id)!.resolve(draft(id));});return fixture.editors.get(id)!;};
    for(const change of ['close','replace','navigate'] as const)await run(`late editor update cannot reopen or replace the current editor after ${change}`,async fixture=>{
      const old=await open(fixture,'A');
      if(change==='close')await click(document.querySelector('[data-test-close]'));
      else if(change==='replace')await open(fixture,'B');else await navigate('test01');
      await act(async()=>{old.testCompleteLocalSave({...draft('A'),revision:99});old.onUpdate({...draft('A'),revision:2});});
      assert.equal(document.querySelector('[data-test-editor]')?.getAttribute('data-test-editor')??null,change==='replace'?'B':null);
      if(change==='replace'){
        // This is a component-lifetime regression, not a simulation of the full
        // DraftEditor save implementation or proof of a remote write.
        const current=fixture.editors.get('B')!;
        assert.equal(current.testInstance===old.testInstance,false,'different draft IDs must receive different React instances');
        assert.equal(current.testRevision(),draft('B').revision);
        assert.equal(document.querySelector('[data-test-editor]')?.getAttribute('data-test-save-status'),'idle');
      }
    });
    await run('native save preparation rejects a stale editor before sending the native check',async fixture=>{
      const old=await open(fixture,'A');await navigate('test01');fixture.nativeCheck.resolve({ok:true});
      await assert.rejects(old.prepareNativeSave(),/NATIVE_DOCUMENT_CHANGED/);assert.equal(fixture.nativeCalls.length,0);
    });
    await run('native save preparation rechecks the target after its awaited native check',async fixture=>{
      const old=await open(fixture,'A'),checking=old.prepareNativeSave();assert.equal(fixture.nativeCalls.length,1);
      const rejected=assert.rejects(checking,/NATIVE_DOCUMENT_CHANGED/);await navigate('test01');fixture.nativeCheck.resolve({ok:true});await rejected;
      assert.equal(fixture.calls.filter(command=>command.method==='drafts.save').length,0);
    });
    await run('a verified old save skips stale native refresh without rejecting server success',async fixture=>{
      const old=await open(fixture,'A');await navigate('test01');fixture.nativeRefresh.resolve({ok:true});
      await act(async()=>{assert.equal(await old.onSaved({...draft('A'),revision:2}), 'stale');});
      assert.equal(fixture.nativeCalls.length,0);assert.equal(document.querySelector('.save-notice')===null,true);
    });
    for (const matches of [true, false]) await run(matches ? 'a verified save checks both fields and reports a title-only LiveDoc' : 'a verified save propagates a genuine native mismatch without a sync receipt', async fixture => {
      const editor = await open(fixture, 'A');
      // Establish the clean native baseline through the same pre-save callback as the UI.
      fixture.nativeCheck.resolve({ok: true});
      await editor.prepareNativeSave();
      const saved = {...draft('A'), revision: 2, html: '<p>Saved description</p>', title: 'Saved heading'};
      fixture.nativeRefresh.resolve(matches ? {ok: true, projection: 'heading'} : {ok: false, error: 'NATIVE_REFRESH_CONTENT_MISMATCH'});
      if (matches) {
        await act(async () => { assert.equal(await editor.onSaved(saved), 'heading'); });
        assert.equal(document.querySelector('.workspace .save-notice'), null);
      } else {
        await assert.rejects(editor.onSaved(saved), /NATIVE_REFRESH_CONTENT_MISMATCH/);
        assert.equal(document.querySelector('.save-notice'), null);
      }
      assert.deepEqual(fixture.nativeCalls.at(-1), {type: 'native-workitem-refresh', phase: 'refresh', workItemId: saved.workItemId, expectedHtml: saved.html, expectedTitle: saved.title});
    });
    await run('a newer shared draft announced during native refresh invalidates the receipt before the busy editor reloads', async fixture => {
      const editor = await open(fixture, 'A');
      const saved = {...draft('A'), revision: 2};
      fixture.nativeCheck.resolve({ok:true}); await editor.prepareNativeSave();
      await act(async () => { editor.onUpdate(saved); });
      const refreshing = editor.onSaved(saved);
      assert.equal(fixture.nativeCalls.at(-1)?.phase, 'refresh');
      fixture.replies.set('drafts.list', () => ({ok:true, value:[{...saved, revision:3}]}));
      fixture.replies.set('sessions.read', () => ({ok:true, value:{session, runs:[], events:[{seq:1, sessionId:session.id, kind:'draft', data:{workItemId:'A'}, at:1}]}}));
      await act(async () => { window.dispatchEvent(new Event('polarion-sidebar-run-started')); });
      assert.equal(fixture.editors.get('A')?.remoteRevision, 3);
      fixture.nativeRefresh.resolve({ok:true, projection:'heading'});
      assert.equal(await refreshing, 'stale');
      assert.equal(document.querySelector('.workspace .save-notice'), null);
    });
    await run('a native transport error arriving after editor replacement belongs to the old save', async fixture => {
      const old = await open(fixture, 'A');
      fixture.nativeCheck.resolve({ok:true}); await old.prepareNativeSave();
      const refreshing = old.onSaved({...draft('A'), revision:2});
      const replacement = await open(fixture, 'B');
      fixture.nativeRefresh.resolve(Promise.reject(Error('Disconnected')));
      assert.equal(await refreshing, 'stale');
      assert.notEqual(old.testInstance, replacement.testInstance);
      assert.equal(document.querySelector('[data-test-editor]')?.getAttribute('data-test-save-status'), 'idle');
      assert.equal(document.querySelector('.save-notice, .error'), null);
    });
    await run('native refresh completion after navigation does not show an old target save receipt',async fixture=>{
      // 原生基线在 DOM 静止 1s 后建立；本用例依赖 state()==='clean'，先等基线。
      await new Promise(resolve=>setTimeout(resolve,1150));
      const old=await open(fixture,'A'),refreshing=old.onSaved({...draft('A'),revision:2});assert.equal(fixture.nativeCalls.length,1);
      await navigate('test01');await act(async()=>{fixture.nativeRefresh.resolve({ok:true});assert.equal(await refreshing, 'stale');});
      assert.equal(document.querySelector('.save-notice')===null,true);
    });
  }finally{
    try{await cleanupRoot?.();}finally{
      dom.window.close();
      for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globals[key];}
      // temporary is an absolute, mkdtemp-created child of this checkout.
      assert.equal(dirname(temporary),repo);await rm(temporary,{recursive:true,force:true});
    }
  }
});
