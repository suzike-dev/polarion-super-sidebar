import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const chromium = process.env.CHROME_PATH ?? [
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
].find(existsSync);

// Use Chromium's local DevTools pipe so the normal suite can drive trusted input without a browser driver package.
async function openBrowser(t: TestContext, executable: string) {
  const profile = await mkdtemp(join(tmpdir(), 'sidebar-editor-keys-'));
  const sandboxArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const child = spawn(executable, ['--headless', ...sandboxArgs, '--no-first-run', '--disable-background-networking', '--disable-sync',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const input = child.stdio[3] as Writable, output = child.stdio[4] as Readable;
  const pending = new Map<number, { resolve: (response: any) => void; reject: (reason: Error) => void }>();
  let id = 0, buffer = '', sessionId: string | undefined;
  function call(method: string, params: Record<string, unknown> = {}, session = sessionId) {
    const requestId = ++id;
    return new Promise<any>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      input.write(JSON.stringify({ id: requestId, method, params, sessionId: session }) + '\0');
    });
  }
  output.setEncoding('utf8').on('data', (chunk: string) => {
    const messages = (buffer + chunk).split('\0'); buffer = messages.pop()!;
    for (const line of messages) {
      const message = JSON.parse(line), request = pending.get(message.id);
      if (message.method === 'Fetch.requestPaused') {
        // Serve the synthetic LiveDoc entirely from memory. No request reaches a server.
        void call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from('<!doctype html><body></body>').toString('base64') });
        continue;
      }
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    }
  });
  const rejectPending = () => { for (const request of pending.values()) request.reject(new Error('Chromium closed its DevTools pipe')); pending.clear(); };
  output.on('end', rejectPending); input.on('error', rejectPending);
  t.signal.addEventListener('abort', () => child.kill(), { once: true });
  t.after(async () => {
    if (child.exitCode === null && !child.killed) await call('Browser.close').catch(() => child.kill());
    await closed;
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }));
  await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await call('Page.navigate', { url: 'https://polarion.pufafen.com/polarion/#/project/offline/wiki/Requirements/Fixture' });
  const { frameTree } = await call('Page.getFrameTree');
  const { executionContextId } = await call('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'sidebar-fixture' });
  async function evaluate(expression: string, extension = true) {
    const reply = await call('Runtime.evaluate', { expression, contextId: extension ? executionContextId : undefined, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  }
  async function click(selector: string, count = 1) {
    const { x, y } = await evaluate(`(() => {
      const element = root.querySelector(${JSON.stringify(selector)}) ?? document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({block:'center'}); const b = element.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()`);
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount });
    }
  }
  async function key(key: string, code: string, windowsVirtualKeyCode: number, modifiers = 0, text = '', repeat = false) {
    const fields = { key, code, windowsVirtualKeyCode, modifiers };
    await call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...fields, text, autoRepeat: repeat });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...fields });
  }
  function waitFor(selector: string, present = true) {
    return evaluate(`new Promise((resolve,reject)=>{
      const ready=()=>!!root.querySelector(${JSON.stringify(selector)})===${present}; if(ready()){resolve();return;}
      const observer=new MutationObserver(()=>{if(ready()){clearTimeout(timer);observer.disconnect();resolve();}});
      const timer=setTimeout(()=>{observer.disconnect();reject(Error('Timed out waiting for '+${JSON.stringify(selector)}));},3000);
      observer.observe(root,{childList:true,subtree:true,attributes:true}); })`);
  }
  return { evaluate, click, key, waitFor };
}

function bundle(contents: string, plugins: Plugin[] = []) {
  return build({ absWorkingDir: repo, stdin: { contents, resolveDir: repo }, bundle: true, write: false, format: 'iife',
    loader: { '.css': 'empty' }, plugins, define: { 'process.env.NODE_ENV': '"production"' } }).then(result => result.outputFiles[0]!.text);
}

const offlineTransport: Plugin = { name: 'offline-extension-transport', setup(builder) {
  builder.onResolve({ filter: /^wxt\/browser$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
    export const browser = {storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}, runtime:{
      onMessage:{addListener(){},removeListener(){}}, async sendMessage({request:{command}}){
        const {method}=command; rpcMethods.push(method);
        if(window.saveFixtureReply) return {ok:true,value:window.saveFixtureReply(command)};
        if(method==='workitems.read') return new Promise(done=>{window.finishRead=()=>done({ok:true,value:{...command,id:'draft',html:'<p>offline</p>',nodes:[],revision:1,state:'clean',title:'Fixture'}});});
        const replies={'health':{},'settings.read':{},'engine.context':{},'experience.read':{text:''},
          'dashboard.view':{pendingProposals:0,alerts:0,reviewOpen:0,events:1,coverage:{total:0,orphans:0},workflows:0,worksets:0},
          'document.outline':{title:'Fixture',items:[]},'events.list':[{id:'event',kind:'note',subject:'Fixture',at:1,workItemId:'SPE-1'}]};
        return {ok:true,value:replies[method]??[]};
      }}};` }));
} };

test('trusted Chromium input in the workbench shadow tree', { skip: chromium ? false : 'Set CHROME_PATH to a Chromium executable', timeout: 60000 }, async t => {
  const { evaluate, click, key, waitFor } = await openBrowser(t, chromium!);
  const [entry, ui] = await Promise.all([
    bundle(`import entry from './apps/extension/entrypoints/editor-keys.content'; entry.main({addEventListener:(target,...args)=>target.addEventListener(...args)});`),
    bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {isUserEvent} from './apps/extension/lib/ui-event-trust'; import {listenWorkbenchKeydown} from './apps/extension/lib/workbench-keyboard';
      const el = React.createElement;
      function Controls() {
        const [checked, setChecked] = React.useState(false);
        return el(React.Fragment,null,
          el('label', null, el('input', {id:'check', type:'checkbox', checked, onChange:e=>{ changes.push(e.target.checked); setChecked(e.target.checked); }}), el('span', {id:'label'}, 'Pause')),
          el('button',{id:'confirm',onClick:e=>{ attempts++; if(isUserEvent(e.nativeEvent)){ confirmations++; lastClick=e.nativeEvent; } }},'Confirm'));
      }
      flushSync(()=>createRoot(root.querySelector('#controls')).render(el(Controls)));
      root.querySelector('#blocked').onclick = e => e.preventDefault();
      root.querySelector('#inner').onkeydown = e => { if(e.key==='Escape') { e.preventDefault(); e.stopPropagation(); localEscapes++; } };
      root.addEventListener('keydown', e=>e.stopPropagation()); // WXT isolateEvents
      window.unlisten = [listenWorkbenchKeydown(window,e=>{ if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyP'){ e.preventDefault(); e.stopPropagation(); if(!e.repeat) commands++; } },'capture'),
        listenWorkbenchKeydown(document,e=>{ if(e.key==='Escape'){ e.preventDefault(); fallbackEscapes++; } })];`),
  ]);
  await evaluate(`window.addEventListener('keydown',e=>{if(e.ctrlKey && e.code==='KeyS') window.lastSaveKey=e;},true);`, false);
  await evaluate(entry);
  await evaluate(`document.body.innerHTML = '<button id="outside">Native</button><polarion-super-sidebar></polarion-super-sidebar>';
    window.hostKeys=0; window.hostClicks=0; window.nativeSaves=0;
    for(const type of ['keydown','keyup','keypress','click','dblclick']) window.addEventListener(type,e=>{
      if(e.target.localName==='polarion-super-sidebar'){ if(type.endsWith('click')) hostClicks++; else hostKeys++; e.preventDefault(); e.stopImmediatePropagation(); }
      else if(type==='keydown' && e.ctrlKey && e.key==='s'){ nativeSaves++; e.preventDefault(); }
    },true);`, false);
  await evaluate(`window.root=document.querySelector('polarion-super-sidebar').attachShadow({mode:'open'});
    root.innerHTML='<div id="controls"></div><input id="r1" type="radio" name="r" checked><label for="r2"><span id="radio-label">Second</span></label><input id="r2" type="radio" name="r"><input id="blocked" type="checkbox"><textarea id="text"></textarea><div id="editable" contenteditable="true">start</div><p id="word" style="width:max-content">selection</p><div id="inner"><input></div>';
    Object.assign(window,{changes:[], radioClicks:0,radioChanges:0, attempts:0,confirmations:0,lastClick:null, commands:0, localEscapes:0, fallbackEscapes:0});
    root.querySelector('#r2').onclick=()=>radioClicks++;root.querySelector('#r2').onchange=()=>radioChanges++;`);
  await evaluate(ui);

  await t.test('checkbox, associated labels, radio group and canceled activation', async () => {
    await click('#check'); assert.equal(await evaluate("root.querySelector('#check').checked"), true);
    await click('#label'); assert.equal(await evaluate("root.querySelector('#check').checked"), false);
    await key(' ', 'Space', 32, 0, ' ');
    assert.deepEqual(await evaluate("[root.querySelector('#check').checked,changes]"), [true, [true, false, true]]);
    await click('#radio-label'); await click('#r2');
    assert.deepEqual(await evaluate("[root.querySelector('#r1').checked,root.querySelector('#r2').checked,radioClicks,radioChanges]"), [false, true, 2, 1]);
    await click('#blocked'); assert.equal(await evaluate("root.querySelector('#blocked').checked"), false);
  });
  await t.test('browser input, keyboard selection and double-click word selection', async () => {
    await click('#text');
    for(const letter of 'abc') await key(letter, 'Key'+letter.toUpperCase(), letter.toUpperCase().charCodeAt(0), 0, letter);
    await key('ArrowLeft', 'ArrowLeft', 37, 8);
    assert.deepEqual(await evaluate("[root.querySelector('#text').value,root.querySelector('#text').selectionStart,root.querySelector('#text').selectionEnd]"), ['abc',2,3]);
    await key('x', 'KeyX', 88, 0, 'x');
    assert.equal(await evaluate("root.querySelector('#text').value"), 'abx');
    await click('#editable'); await key('a', 'KeyA', 65, 2); await key('文', '', 0, 0, '文');
    assert.equal(await evaluate("root.querySelector('#editable').textContent"), '文');
    await key('z', 'KeyZ', 90, 2); assert.equal(await evaluate("root.querySelector('#editable').textContent"), 'start');
    await click('#word', 2); assert.equal(await evaluate('getSelection().toString()'), 'selection');
  });
  await t.test('global command, nested Escape, native save boundary and listener cleanup', async () => {
    await click('#inner input');
    await key('P','KeyP',80,10); await key('P','KeyP',80,10,'',true); await key('Escape','Escape',27);
    await click('#text'); await key('Escape','Escape',27); await key('s','KeyS',83,2);
    assert.deepEqual(await evaluate('[commands,localEscapes,fallbackEscapes,confirmations]'),[1,1,1,0]);
    assert.deepEqual(await evaluate('[hostKeys,hostClicks,nativeSaves,lastSaveKey.defaultPrevented]',false),[0,0,0,true]);
    await click('#outside'); await key('P','KeyP',80,10); await key('s','KeyS',83,2);
    assert.equal(await evaluate('commands'),2); assert.equal(await evaluate('nativeSaves',false),1);
    await evaluate('unlisten.forEach(remove=>remove())'); await click('#text'); await key('P','KeyP',80,10); await key('Escape','Escape',27);
    assert.deepEqual(await evaluate('[commands,fallbackEscapes]'),[2,1]);
  });
  await t.test('explicit pointer and keyboard confirmations each count once', async () => {
    await click('#confirm'); await key('Enter','Enter',13,0,'\r');
    assert.equal(await evaluate('confirmations'),2);
    await evaluate("const button=document.querySelector('polarion-super-sidebar').shadowRoot.querySelector('#confirm'); button.click(); button.dispatchEvent(new MouseEvent('click',{bubbles:true}));",false);
    await evaluate("root.querySelector('#confirm').dispatchEvent(lastClick)");
    assert.deepEqual(await evaluate('[confirmations,attempts]'),[2,4]);
  });
  await t.test('App routes the assistant shortcut and cancels a pending reader before its source overlay', async () => {
    const hostBefore = await evaluate('[hostKeys,hostClicks]',false);
    await evaluate(`document.body.insertAdjacentHTML('beforeend','<iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe>'); window.rpcMethods=[];`);
    await evaluate(await bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {App} from './apps/extension/ui/App';
      const mount = document.createElement('div'); root.append(mount); createRoot(mount).render(React.createElement(App));`, [offlineTransport]));
    await waitFor('.composer textarea'); await click('.composer textarea');
    await key('P','KeyP',80,10); await waitFor('.palette-layer input');
    await key('P','KeyP',80,10,'',true); assert.equal(await evaluate("!!root.querySelector('.palette-layer')"),true);
    await key('Escape','Escape',27); await waitFor('.palette-layer',false);
    assert.equal(await evaluate("root.activeElement===root.querySelector('.composer textarea')"),true);
    await key('k','KeyK',75,2); await waitFor('.palette-layer');
    await key('P','KeyP',80,12); await waitFor('.palette-layer',false);

    await click('button[title^="工作流："]'); await waitFor('.workflow-panel header .primary'); await click('.workflow-panel header .primary');
    const pause = '.workflow-editor input[type="checkbox"]'; await waitFor(pause);
    await click(pause); assert.equal(await evaluate(`root.querySelector('${pause}').checked`),true);
    await key('Escape','Escape',27); await waitFor('.workflow-editor',false);
    await click('.workflow-panel button[aria-label="关闭工作流面板"]');

    await click('.header-tool[title^="驾驶舱"]'); await waitFor('.dash-metric[title="打开项目事件流"]'); await click('.dash-metric[title="打开项目事件流"]');
    const source = '.pi-event .pi-item'; await waitFor(source); await click(source); await waitFor('.reader-notice');
    await key('P','KeyP',80,10); await waitFor('.palette-layer'); await key('Escape','Escape',27); await waitFor('.palette-layer',false);
    assert.equal(await evaluate("!!root.querySelector('.reader-notice')"),true);
    await evaluate(`root.querySelector('${source}').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate("!!root.querySelector('.reader-notice')"),true);
    await key('Escape','Escape',27); await waitFor('.reader-notice',false);
    assert.equal(await evaluate(`root.activeElement===root.querySelector('${source}') && !!root.querySelector('.pi-layer')`),true);
    await evaluate('finishRead()'); await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    assert.equal(await evaluate("!!root.querySelector('.reader-layer')"),false);
    await key('Escape','Escape',27); await waitFor('.pi-layer',false);
    assert.deepEqual(await evaluate("rpcMethods.filter(name=>name.endsWith('.save')||name==='proposals.approve')"),[]);
    assert.deepEqual(await evaluate('[hostKeys,hostClicks]',false),hostBefore);
  });
});

test('the originating rich editor owns a single save receipt, including after replacement', { skip: chromium ? false : 'Set CHROME_PATH to a Chromium executable', timeout: 30000 }, async t => {
  const {evaluate, click, waitFor} = await openBrowser(t, chromium!);
  await evaluate(`window.root = document.body.appendChild(document.createElement('polarion-super-sidebar')).attachShadow({mode:'open'});
    window.rpcMethods = [];`);
  await evaluate(await bundle(`
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {DraftEditor} from './apps/extension/ui/DraftEditor';
    const mount = createRoot(root.appendChild(document.createElement('div')));
    const target = {origin:location.origin,projectId:'offline',document:'Requirements/Fixture'};
    const content = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Fixture'}]}]};
    const draft = id => ({id,workItemId:id,title:id,target,revision:1,state:'dirty',nodes:[],html:'<p>Fixture</p>',baseHtml:''});
    window.saveFixtureReply = command => {
      switch (command.method) {
        case 'drafts.save': return {...draft(command.draftId),revision:2,state:'clean'};
        case 'rules.get': return {pack:{version:1,lintRules:[],glossary:[]}};
        case 'model.note.read': return {marks:[]};
        case 'impact.view': return {staleCount:0};
        default: throw Error('Unexpected receipt fixture RPC '+command.method);
      }
    };
    function Fixture({initial}) {
      const [item, update] = React.useState(initial);
      return React.createElement(DraftEditor, {draft:item,initialRich:{draft:initial,editorId:initial.id,document:content},
        aiOpen:false,onPrepareAI(){},onUpdate:update,onClearError(){},prepareNativeSave:async()=>'clean',
        onSaved:()=>new Promise(resolve=>{window.finishNative=resolve;})});
    }
    window.openFixtureEditor = id => flushSync(()=>mount.render(React.createElement(Fixture,{key:id,initial:draft(id)})));
    openFixtureEditor('SYN-1');`, [offlineTransport]));
  const receipt = '.rich-workbench > footer [role="status"][aria-label="保存回执"]';
  const save = '.save-polarion:enabled';
  await waitFor(save); await click(save); await waitFor(`${receipt}[data-state=pending]`);
  await evaluate(`window.before = root.querySelector('${receipt}'); finishNative('heading')`);
  await waitFor(`${receipt}[data-state=confirmed]`);
  assert.equal(await evaluate(`root.querySelectorAll('.save-notice').length === 1 && root.querySelector('${receipt}') === before`), true);
  assert.match(await evaluate('before.textContent'), /修订 2 .*已保存到 Polarion.*标题已同步/);
  assert.equal(await evaluate("root.querySelector('.sync-status')?.textContent || ''"), '');

  await evaluate("openFixtureEditor('SYN-2')"); await waitFor(save); await click(save);
  await waitFor(`${receipt}[data-state=pending]`);
  await evaluate("openFixtureEditor('SYN-3')"); await waitFor(save);
  await evaluate("finishNative('body'); new Promise(resolve=>requestAnimationFrame(resolve))");
  assert.equal(await evaluate("root.querySelector('.rich-heading h2').textContent"), 'SYN-3');
  assert.equal(await evaluate("root.querySelectorAll('.save-notice,.rich-alert').length"), 0);
  assert.equal(await evaluate("rpcMethods.filter(method=>method==='impact.view').length"), 1);
});
