import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activitySteps} from './activity.ts';
test('tool starts pair with results by identity, while legacy history never invents success',()=>{
 const event=(seq:number,kind:string,data:unknown)=>({seq,kind,data,at:seq,runId:'r',sessionId:'s'});
 const steps=activitySteps([event(1,'tool',{id:'old',name:'Bash'}),event(2,'tool',{id:'new',name:'Read',title:'读取需求 A'}),event(3,'tool-result',{id:'new',status:'failed',summary:'文件不存在',durationMs:20})]);
 assert.equal(steps[0]!.legacy,true);assert.equal(steps[0]!.status,'unknown');assert.equal(steps[1]!.status,'failed');assert.equal(steps[1]!.summary,'文件不存在');
});
