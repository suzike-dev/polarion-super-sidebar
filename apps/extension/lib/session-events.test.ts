import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendSessionEvents, conversationSections, emptyEventHistory, readSessionBatch, reconcileRuns, turnResponseText} from './session-events.ts';
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
test('conversation resets retain old turns for review and place the reset turn at the new boundary',()=>{
 const runs=[run('old'),run('clear1'),run('middle'),run('clear2'),run('new')];
 const events=[event(1,'old'),{...event(2,'clear1'),kind:'conversation-reset'},event(3,'middle'),{...event(4,'clear2'),kind:'conversation-reset'},event(5,'new')];
 const sections=conversationSections(runs,events);assert.deepEqual(sections.archived.map(r=>r.id),['old','clear1','middle']);assert.deepEqual(sections.current.map(r=>r.id),['clear2','new']);assert.equal(sections.boundary?.seq,4);assert.equal(runs.length,5);assert.equal(events.length,5);
 const restored=appendSessionEvents(emptyEventHistory(),structuredClone(events));assert.deepEqual(conversationSections(runs,restored.events),sections);
});
test('local command outputs and assistant-only command replies remain visible without a result body',()=>{
 const local={...event(1),kind:'local-command-output',data:{text:'usage: 10%'}},empty={...event(2),kind:'result',data:{text:''}},block={...event(3),kind:'assistant-block',data:{text:'native command reply'}};
 assert.equal(turnResponseText([local,empty]),'usage: 10%');assert.equal(turnResponseText([block,empty]),'native command reply');assert.equal(turnResponseText([local,{...empty,data:{text:'usage: 10%'}}]),'usage: 10%');assert.equal(turnResponseText([local,{...empty,data:{text:'next explanation'}}]),'usage: 10%\n\nnext explanation');
});
test('history reads return updated native conversation identity and reset title',async()=>{
 const session={id:'s',nativeId:'fresh-native',title:'新工程会话'} as any;
 const page=await readSessionBatch(async()=>({session,events:[],runs:[]}),0);assert.equal(page.session,session);
});
