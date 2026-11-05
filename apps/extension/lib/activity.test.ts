import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activitySteps} from './activity.ts';
test('tool starts pair with results by identity, while legacy history never invents success',()=>{
 const event=(seq:number,kind:string,data:unknown)=>({seq,kind,data,at:seq,runId:'r',sessionId:'s'});
 const steps=activitySteps([event(1,'tool',{id:'old',name:'Bash'}),event(2,'tool',{id:'new',name:'Read',title:'读取需求 A'}),event(3,'tool-result',{id:'new',status:'failed',summary:'文件不存在',durationMs:20})]);
 assert.equal(steps[0]!.legacy,true);assert.equal(steps[0]!.status,'unknown');assert.equal(steps[1]!.status,'failed');assert.equal(steps[1]!.summary,'文件不存在');
});
test('timeline merges attachment, command and steer events into one ordered list',()=>{
 const event=(seq:number,kind:string,data:unknown)=>({seq,kind,data,at:seq,runId:'r',sessionId:'s'});
 const steps=activitySteps([
  event(1,'tool',{id:'t1',name:'Read',title:'读取需求 A'}),
  event(2,'tool-result',{id:'t1',status:'completed',durationMs:12}),
  event(3,'attachment-read',{id:'a1',name:'spec.md',extraction:'text',truncated:true}),
  event(4,'command-expanded',{name:'usage',source:'builtin'}),
  event(5,'steer',{queuedRunId:'q1'}),
  event(6,'steer-failed',{queuedRunId:'q2'}),
 ]);
 assert.deepEqual(steps.map(s=>s.kind),['tool','attachment','command','steer','steer']);
 assert.equal(steps[1]!.detail,'内容较长，已截断');
 assert.equal(steps[3]!.title.includes('引导输入'),true);
 assert.equal(steps[4]!.title.includes('未送达'),true);
});
