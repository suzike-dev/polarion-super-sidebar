import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './store.ts';
import {Interactions,questionForm,mcpForm} from './interactions.ts';
const target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/test'};
test('native questions survive page reload, validate answers and settle only once',async()=>{
  const store=new Store(':memory:'),service=new Interactions(store),session=store.createSession(target,'test');
  const {run}=store.startRun(session.id,crypto.randomUUID(),'test',[]),controller=new AbortController();
  const form=questionForm({questions:[{question:'工程审阅方式',options:[{label:'逐项'}]}]});
  const task=service.ask(run,form,controller.signal);const event=store.events(session.id,0).find(e=>e.kind==='interaction')!.data as any;
  assert.equal(run.status,'waiting');assert.throws(()=>service.answer('wrong',event.id,{action:'accept',values:{}}),/EXPIRED/);
  assert.throws(()=>service.answer(run.id,event.id,{action:'accept',values:{}}),/请填写/);
  service.answer(run.id,event.id,{action:'accept',values:{'工程审阅方式':'用户自定义'}});
  assert.equal((await task).values['工程审阅方式'],'用户自定义');assert.equal(run.status,'running');
  assert.throws(()=>service.answer(run.id,event.id,{action:'cancel',values:{}}),/EXPIRED/);
  assert(!JSON.stringify(store.events(session.id,0)).includes('用户自定义'));store.close();
});
test('cancellation settles native questions without reviving run',async()=>{
  const store=new Store(':memory:'),service=new Interactions(store),session=store.createSession(target,'test');
  const {run}=store.startRun(session.id,crypto.randomUUID(),'test',[]),controller=new AbortController();
  const task=service.ask(run,questionForm({questions:[{question:'Q',options:[]}]}),controller.signal);
  run.status='cancelled';store.put('run',run.id,run);controller.abort();
  assert.equal((await task).action,'cancel');assert.equal(run.status,'cancelled');assert.equal(service.pending.size,0);store.close();
});
test('MCP form preserves types and rejects missing fields or out-of-range engineering values',()=>{
  const {form,validate}=mcpForm({serverName:'fixture',message:'Parameters',requestedSchema:{type:'object',properties:{duration:{type:'number',minimum:0,maximum:100},enabled:{type:'boolean'},mode:{type:'string',enum:['A','B']}},required:['duration','enabled','mode'],additionalProperties:false}});
  assert.equal(form.fields[0]?.type,'number');validate({duration:1.5,enabled:false,mode:'A'});
  assert.throws(()=>validate({duration:101,enabled:true,mode:'A'}),/校验失败/);assert.throws(()=>validate({duration:1,enabled:true}),/校验失败/);
});
