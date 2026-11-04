import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('account form clears passwords, reports failed login and saves on explicit action',async()=>{
  const temp=await mkdtemp(resolve('.account-ui-test-')),dom=new JSDOM('<div id="root"></div>',{url:'https://polarion.pufafen.com'});
  const globals=globalThis as any,prior=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){prior.set(key,Object.getOwnPropertyDescriptor(globals,key));Object.defineProperty(globals,key,{value,configurable:true,writable:true});}
  let root:any;
  try {
    const bundle=join(temp,'ui.mjs');await build({entryPoints:[resolve('apps/extension/ui/PolarionAccount.tsx')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},plugins:[{name:'rpc',setup(b){b.onResolve({filter:/\/lib\/client$/},()=>({path:'rpc',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const rpc = (...args) => globalThis.__accountRpc(...args);',loader:'js'}));}}]});
    const calls:any[]=[],busy:boolean[]=[];let accept:(v:any)=>void=()=>{},reject:(e:Error)=>void=()=>{},connected=0;
    globals.__accountRpc=async(command:any)=>{calls.push({...command});if(command.method.endsWith('.status'))return {configured:false,username:''};return new Promise((res,rej)=>{accept=res;reject=rej;});};
    const {createRoot}=await import('react-dom/client'),{act,createElement}=await import('react'),{PolarionAccount}=await import(pathToFileURL(bundle).href);
    root=createRoot(document.getElementById('root')!);await act(async()=>root.render(createElement(PolarionAccount,{onBusy:(v:boolean)=>busy.push(v),onConnected:()=>connected++})));
    const inputs=()=>[...document.querySelectorAll('input')],button=()=>document.querySelector('button')!;
    const type=async(index:number,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(inputs()[index],value);inputs()[index]!.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
    assert.equal(button().disabled,true);await type(0,'fixture');await type(1,'synthetic-password');assert.equal(inputs()[1]!.type,'password');
    await act(async()=>button().click());assert.equal(inputs()[1]!.value,'');assert.equal(button().disabled,true);
    await act(async()=>reject(Error('POLARION_AUTHENTICATION_FAILED')));assert.match(document.body.textContent!,/原有凭据保留/);assert.equal(connected,0);
    await type(1,'synthetic-password');await act(async()=>button().click());await act(async()=>accept({connected:true}));
    assert.match(document.body.textContent!,/账号已保存/);assert.equal(connected,1);assert.equal(inputs()[1]!.value,'');assert.deepEqual(busy,[true,false,true,false]);
    assert.equal(calls.filter(c=>c.method.endsWith('.save')).length,2);
  } finally {if(root){const {act}=await import('react');await act(async()=>root.unmount());}dom.window.close();delete globals.__accountRpc;for(const [key,value]of prior){if(value)Object.defineProperty(globals,key,value);else delete globals[key];}await rm(temp,{recursive:true,force:true});}
});
