import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.ts';
import type { Context } from '../../packages/protocol/index.ts';
import { CommandSchema } from '../../packages/protocol/index.ts';
const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Fixture' };
test('fresh and legacy settings use compact answer type without changing engine preferences', () => {
  const store=new Store(':memory:');
  try {
    assert.equal(store.settings().assistantFontSize,13);
    const legacy={defaultEngine:'codex',claudeModel:'existing-local-model',codexModel:'gpt-6.1-sol'};
    store.put('settings','global',legacy);
    assert.deepEqual(store.settings(),{...legacy,assistantFontSize:13});
    assert.deepEqual(store.get('settings','global'),legacy,'reading old settings must not write them');
  } finally {store.close();}
});

test('answer font size accepts integer boundaries and rejects invalid settings writes', () => {
  const settings={defaultEngine:'claude',claudeModel:'',codexModel:'gpt-6.1-sol'};
  for(const assistantFontSize of [12,13,18]) {
    const command=CommandSchema.parse({method:'settings.write',settings:{...settings,assistantFontSize}});
    assert.equal(command.method,'settings.write');
    if(command.method!=='settings.write')throw Error('Unexpected command');
    assert.equal(command.settings.assistantFontSize,assistantFontSize);
  }
  for(const assistantFontSize of [11,19,13.5,NaN,Infinity,'14',null]) {
    assert.equal(CommandSchema.safeParse({method:'settings.write',settings:{...settings,assistantFontSize}}).success,false);
  }
  const legacy=CommandSchema.parse({method:'settings.write',settings});
  if(legacy.method!=='settings.write')throw Error('Unexpected command');
  assert.equal(legacy.settings.assistantFontSize,13);
});

test('saved answer font size survives closing and reopening the settings store', () => {
  const directory=mkdtempSync(join(tmpdir(),'polarion-font-settings-'));
  const filename=join(directory,'settings.sqlite');
  let store:Store|undefined;
  try {
    store=new Store(filename);
    store.put('settings','global',{...store.settings(),claudeModel:'local-model',assistantFontSize:18});
    store.close();store=undefined;
    store=new Store(filename);
    assert.equal(store.settings().assistantFontSize,18);
    assert.equal(store.settings().claudeModel,'local-model');
    store.put('settings','global',{...store.settings(),assistantFontSize:13});
    store.close();store=undefined;
    store=new Store(filename);
    assert.equal(store.settings().assistantFontSize,13);
    assert.equal(store.settings().claudeModel,'local-model');
  } finally {
    store?.close();
    for(const file of [filename,filename+'-wal',filename+'-shm'])rmSync(file,{force:true});
    rmdirSync(directory);
  }
});

test('new turns default to auto while explicit and legacy permissions remain frozen', () => {
  const store = new Store(':memory:');
  try {
    const session=store.createSession(target,'permission defaults');
    const command=CommandSchema.parse({method:'runs.start',sessionId:session.id,requestId:crypto.randomUUID(),target,prompt:'default',contexts:[]});
    assert.equal(command.method,'runs.start');
    if(command.method!=='runs.start') throw Error('Unexpected command');
    assert.equal(command.permissionMode,'auto');
    const {run}=store.startRun(session.id,command.requestId,command.prompt,[]);
    assert.equal(run.permissionMode,'auto');
    assert.throws(()=>store.startRun(session.id,command.requestId,command.prompt,[],target,[],'ask'),/REQUEST_ID_REUSED/);
    store.put('run',run.id,{...run,status:'completed'});
    const explicit=store.startRun(session.id,crypto.randomUUID(),'explicit ask',[],target,[],'ask').run;
    assert.equal(explicit.permissionMode,'ask');
    const {permissionMode,...legacy}=explicit;
    store.put('run',explicit.id,legacy);
    assert.equal(store.startRun(session.id,explicit.requestId,explicit.prompt,[],target,[],'ask').created,false);
    assert.throws(()=>store.startRun(session.id,explicit.requestId,explicit.prompt,[],target,[]),/REQUEST_ID_REUSED/);
  } finally {store.close();}
});
test('session engine affinity, immutable context and idempotent turn submission', () => {
  const store = new Store(':memory:');
  const session = store.createSession(target, 'test');
  store.put('settings', 'global', { defaultEngine: 'codex', claudeModel: '', codexModel: 'gpt-6.1-sol' });
  assert.equal(store.require<any>('session', session.id).engine, 'claude');
  assert.equal(store.createSession(target, 'next').engine, 'codex');
  const contexts: Context[] = [{ id: crypto.randomUUID(), target, text: 'initial', source: 'selection', capturedAt: 1, prefix: '', suffix: '', pinned: false }];
  const request = crypto.randomUUID();
  const { run } = store.startRun(session.id, request, 'edit', contexts);
  assert.equal(store.startRun(session.id, request, 'edit', contexts).created, false);
  contexts[0].text = 'changed after sending';
  assert.equal(store.require<any>('run', run.id).contexts[0].text, 'initial');
  assert.throws(() => store.startRun(session.id, request, 'different', contexts), /REQUEST_ID_REUSED/);
  assert.throws(() => store.startRun(session.id, crypto.randomUUID(), 'second', []), /SESSION_BUSY/);
  store.close();
});
test('cross-document context rejected and interrupted turns never silently rerun', () => {
  const store = new Store(':memory:'); const session = store.createSession(target, 'test');
  assert.throws(() => store.startRun(session.id, crypto.randomUUID(), 'x', [{ id: crypto.randomUUID(), target: { ...target, projectId: 'production' }, text: 'x', source: 'selection', capturedAt: 1, prefix: '', suffix: '', pinned: false }]), /CONTEXT_TARGET_MISMATCH/);
  const { run } = store.startRun(session.id, crypto.randomUUID(), 'x', []);
  store.recoverInterruptedRuns();
  assert.equal(store.require<any>('run', run.id).status, 'interrupted');
  assert.equal(store.events(session.id, 0).length, 2);
  assert.equal(store.events(session.id, 1)[0].kind, 'status'); store.close();
});
test('project session spans documents but each turn target stays frozen', () => {
  const store = new Store(':memory:'); const session = store.createSession(target, 'project session');
  const nextTarget = { ...target, document: 'Requirements/Next' };
  const { run } = store.startRun(session.id, crypto.randomUUID(), 'next document', [], nextTarget);
  nextTarget.document = 'Requirements/Unexpected';
  assert.equal(run.target.document, 'Requirements/Next');
  assert.equal(store.require<any>('session', session.id).target.document, 'Requirements/Next');
  assert.throws(() => store.startRun(session.id, crypto.randomUUID(), 'other project', [], { ...target, projectId: 'other' }), /SESSION_PROJECT_MISMATCH/);
  store.close();
});
