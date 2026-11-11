import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import type {Command} from '../../../packages/protocol/index.ts';

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
    for(const key of ['window','document','location','sessionStorage','HTMLElement','HTMLTextAreaElement','Element','Event','Node','MutationObserver'])expose(key,Reflect.get(dom.window,key));
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
      builder.onLoad({filter:/[\\/]DraftEditor\.tsx$/},()=>({contents:`import React from "react";
        export function DraftEditor(props){
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
    const asset=(id:string)=>({id,target,name:id+'.txt',mime:'text/plain',size:3,state:'ready',extraction:'text'});
    const draft=(id:string)=>({id,target,workItemId:id,title:'Synthetic '+id,state:'clean',revision:1,nodes:[{text:'Fixture '+id}]});
    const input=()=>{const element=document.querySelector('textarea');assert(element);return element;};
    const click=async(element:Element|null|undefined)=>{assert(element instanceof HTMLElement);await act(async()=>{element.click();});};
    const type=async(value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input(),value);input().dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
    const tab=async(label:string)=>click([...document.querySelectorAll<HTMLButtonElement>('.tabs button')].find(element=>element.textContent===label));
    const navigate=async(project:string,documentName='Other')=>{await act(async()=>{dom.window.history.replaceState(null,'',`#/project/${project}/wiki/Requirements/${documentName}`);window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));});};
    const sessionTitle=()=>document.querySelector('.session-bar > button span')?.textContent;

    async function mount(withSession=true,options:{runs?:unknown[];settings?:unknown;guidelines?:unknown[];events?:unknown[]}={}){
      dom.window.history.replaceState(null,'','#/project/test01/wiki/Requirements/Synthetic');sessionStorage.clear();
      const calls:Command[]=[],send=deferred(),create=deferred(),rename=deferred(),uploaded=deferred(),nativeCheck=deferred(),nativeRefresh=deferred(),experience=deferred();
      const nativeCalls:{phase:string;workItemId:string}[]=[];
      const editors=new Map<string,{onUpdate:(value:ReturnType<typeof draft>)=>void;prepareNativeSave:()=>Promise<string>;onSaved:(value:ReturnType<typeof draft>)=>Promise<void>;testInstance:object;testRevision:()=>number;testCompleteLocalSave:(value:ReturnType<typeof draft>)=>void}>();expose('__appRuntimeEditors',editors);
      const drafts=new Map<string,ReturnType<typeof deferred>>();
      const listeners=new Set<unknown>();
      expose('__appRuntimeBrowser',{storage:{local:{get:async()=>({'active-project-session:test01':withSession?'s':undefined,'composer-attachments:test01':[asset('sent')]}),set:async()=>{},remove:async()=>{}}},runtime:{onMessage:{addListener:(listener:unknown)=>listeners.add(listener),removeListener:(listener:unknown)=>listeners.delete(listener)},sendMessage:async(message:{request:{command:Command};type?:string;phase:string;workItemId:string})=>{
        if(message.type==='native-workitem-refresh'){nativeCalls.push({phase:message.phase,workItemId:message.workItemId});return message.phase==='check'?nativeCheck.promise:nativeRefresh.promise;}
        const command=message.request.command;calls.push(command);let value:unknown;
        switch(command.method){
          case 'health':value={};break;
          case 'settings.read':value=options.settings??{};break;
          case 'guidelines.list':value=options.guidelines??[];break;
          case 'engine.context':value={connected:false};break;
          case 'sessions.list':value=withSession&&command.projectId===target.projectId?[session]:[];break;
          case 'sessions.read':value={session,runs:options.runs??[],events:options.events??[]};break;
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
      return {calls,send,create,rename,uploaded,drafts,editors,nativeCalls,nativeCheck,nativeRefresh,experience};
    }
    async function run(name:string,check:(fixture:Awaited<ReturnType<typeof mount>>)=>Promise<void>,withSession=true,options:{runs?:unknown[];settings?:unknown;guidelines?:unknown[];events?:unknown[]}={}){
      await t.test(name,async()=>{try{await check(await mount(withSession,options));}finally{await cleanupRoot?.();cleanupRoot=undefined;}});
    }

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

    await run('session bar opens the local experience viewer',async fixture=>{
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
      await click(document.querySelector('.session-bar button[title*="经验沉淀"]'));
      assert(document.querySelector('.experience-layer'));
      assert.match(document.querySelector('.experience-body')!.textContent!,/还没有沉淀经验/);
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
      await act(async()=>{await assert.doesNotReject(old.onSaved({...draft('A'),revision:2}));});
      assert.equal(fixture.nativeCalls.length,0);assert.equal(document.querySelector('.save-notice')===null,true);
    });
    await run('native refresh completion after navigation does not show an old target save receipt',async fixture=>{
      // 原生基线在 DOM 静止 1s 后建立；本用例依赖 state()==='clean'，先等基线。
      await new Promise(resolve=>setTimeout(resolve,1150));
      const old=await open(fixture,'A'),refreshing=old.onSaved({...draft('A'),revision:2});assert.equal(fixture.nativeCalls.length,1);
      await navigate('test01');await act(async()=>{fixture.nativeRefresh.resolve({ok:true});await assert.doesNotReject(refreshing);});
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
