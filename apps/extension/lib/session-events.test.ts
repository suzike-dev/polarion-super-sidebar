import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendSessionEvents, emptyEventHistory, readSessionBatch, reconcileRuns} from './session-events.ts';
import type {Run, RunEvent} from '../../../packages/protocol/index.ts';

const event = (seq:number, runId='first'):RunEvent => ({seq,runId,sessionId:'s',kind:'delta',data:{text:'x'},at:seq});
const run = (id:string, status:Run['status']='completed') => ({id,status,startedAt:1} as Run);
test('history appends preserve untouched turn identity and reject cursor replays',()=>{
  const first=appendSessionEvents(emptyEventHistory(),[event(1),event(2,'second')]);
  const second=appendSessionEvents(first,[event(2,'second'),event(3,'second')]);
  assert.equal(second.events.length,3);
  assert.equal(second.byRun.get('first'),first.byRun.get('first'));
  assert.notEqual(second.byRun.get('second'),first.byRun.get('second'));
  assert.equal(appendSessionEvents(second,[event(1)]),second);
});
test('long history drains bounded pages then resumes without gaps or duplicates',async()=>{
  const source=Array.from({length:2001},(_,i)=>event(i+1)); const calls:number[]=[];
  const read=async(after:number)=>{calls.push(after);return {runs:[run('first')],events:source.filter(e=>e.seq>after).slice(0,120)};};
  let history=emptyEventHistory(),more=true;
  while(more){const batch=await readSessionBatch(read,history.cursor);assert.ok(batch.events.length<=960);history=appendSessionEvents(history,batch.events);more=batch.more;}
  assert.deepEqual(history.events,source);assert.equal(calls.length,17);
  assert.equal(calls[8],960);assert.equal(history.cursor,2001);
});
test('exact page boundary is resolved by an empty read; cancellation stops further reads',async()=>{
  let calls=0;
  const batch=await readSessionBatch(async after=>{calls++;return {runs:[],events:after?[]:Array.from({length:120},(_,i)=>event(i+1))};},0);
  assert.equal(batch.more,false);assert.equal(calls,2);
  let cancelled=false;
  const stopped=await readSessionBatch(async()=>{cancelled=true;return {runs:[],events:[event(1)]};},0,()=>cancelled);
  assert.equal(stopped.events.length,0);assert.equal(stopped.cursor,0);
});
test('stalled cursor rejects instead of scheduling an unbounded drain',async()=>{
  await assert.rejects(readSessionBatch(async()=>({runs:[],events:[event(1)]}),1),/游标未推进/);
});
test('run metadata reconciliation isolates status updates from settled turns',()=>{
  const original=[run('first'),run('second','running')];
  assert.equal(reconcileRuns(original,structuredClone(original)),original);
  const next=reconcileRuns(original,[run('first'),run('second')]);
  assert.equal(next[0],original[0]);assert.notEqual(next[1],original[1]);
});
