import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.ts';
import type { Context, Draft, Session } from '../../packages/protocol/index.ts';
import { CommandSchema } from '../../packages/protocol/index.ts';
const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Fixture' };
test('fresh and legacy settings use compact answer type without changing engine preferences', () => {
  const store=new Store(':memory:');
  try {
    assert.equal(store.settings().assistantFontSize,13);
    assert.equal(store.settings().defaultPermissionMode,'auto');
    assert.equal(store.settings().defaultTurnDelivery,'queue');
    const legacy={defaultEngine:'codex',claudeModel:'existing-local-model',codexModel:'gpt-6.1-sol'};
    store.put('settings','global',legacy);
    assert.deepEqual(store.settings(),{...legacy,assistantFontSize:13,defaultPermissionMode:'auto',defaultTurnDelivery:'queue',draftsFolder:'',variantLinkRole:''});
    assert.deepEqual(store.get('settings','global'),legacy,'reading old settings must not write them');
  } finally {store.close();}
});

test('answer font size accepts integer boundaries and rejects invalid settings writes', () => {
  const settings={defaultEngine:'claude',claudeModel:'',codexModel:'gpt-6.1-sol'};
  for(const assistantFontSize of [9,12,18]) {
    const command=CommandSchema.parse({method:'settings.write',settings:{...settings,assistantFontSize}});
    assert.equal(command.method,'settings.write');
    if(command.method!=='settings.write')throw Error('Unexpected command');
    assert.equal(command.settings.assistantFontSize,assistantFontSize);
  }
  for(const assistantFontSize of [8,19,13.5,NaN,Infinity,'14',null]) {
    assert.equal(CommandSchema.safeParse({method:'settings.write',settings:{...settings,assistantFontSize}}).success,false);
  }
  assert.equal(CommandSchema.safeParse({method:'settings.write',settings:{...settings,defaultPermissionMode:'yolo'}}).success,false);
  assert.equal(CommandSchema.safeParse({method:'settings.write',settings:{...settings,defaultTurnDelivery:'now'}}).success,false);
  const legacy=CommandSchema.parse({method:'settings.write',settings});
  if(legacy.method!=='settings.write') throw Error('Unexpected command');
  assert.equal(legacy.settings.assistantFontSize,13);
  assert.equal(legacy.settings.defaultTurnDelivery,'queue');
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
    assert.equal(command.delivery,'queue');
    const steerCommand=CommandSchema.parse({method:'runs.start',sessionId:session.id,requestId:crypto.randomUUID(),target,prompt:'steer',contexts:[],delivery:'steer'});
    if(steerCommand.method!=='runs.start')throw Error('Unexpected command');
    assert.equal(steerCommand.delivery,'steer');
    const {run}=store.startRun(session.id,command.requestId,command.prompt,[]);
    assert.equal(run.permissionMode,'auto');
    assert.throws(()=>store.startRun(session.id,command.requestId,command.prompt,[],target,[],'ask'),/REQUEST_ID_REUSED/);
    assert.throws(()=>store.startRun(session.id,command.requestId,command.prompt,[],target,[],'auto','steer'),/REQUEST_ID_REUSED/);
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
  // 会话运行中不再拒绝新输入：默认排队、先进先出，超过队列上限才拒绝。
  const queued = store.startRun(session.id, crypto.randomUUID(), 'second', []);
  assert.equal(queued.run.status, 'queued');
  assert.ok(queued.run.startedAt > run.startedAt, 'queued runs keep FIFO order');
  for (let i = 0; i < 4; i++) store.startRun(session.id, crypto.randomUUID(), 'q' + i, []);
  assert.throws(() => store.startRun(session.id, crypto.randomUUID(), 'overflow', []), /SESSION_QUEUE_FULL/);
  store.put('run', run.id, { ...run, status: 'completed' });
  const next = store.claimQueued(session.id);
  assert.equal(next!.prompt, 'second'); assert.equal(next!.status, 'running');
  assert.equal(store.claimQueued(session.id)!.prompt, 'q0');
  // 引导输入插队：比它早排队的普通消息让位。
  store.startRun(session.id, crypto.randomUUID(), 'early queue', [], undefined, [], 'auto', 'queue');
  store.startRun(session.id, crypto.randomUUID(), 'late steer', [], undefined, [], 'auto', 'steer');
  assert.equal(store.claimQueued(session.id)!.prompt, 'late steer');
  assert.equal(store.claimQueued(session.id)!.prompt, 'q1', '普通排队仍按先进先出');
  store.close();
});
test('drafts move to a custom folder and back, and guidelines round-trip', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polarion-drafts-folder-'));
  let store: Store | undefined;
  try {
    store = new Store(join(directory, 'state.sqlite'));
    const session = store.createSession(target, 'folder session');
    const draft: Draft = { id: crypto.randomUUID(), target, workItemId: 'S-1', title: 'fixture', baseHtml: '<p>a</p>', html: '<p>b</p>', baseUpdated: '2026-01-01T00:00:00Z', revision: 2, state: 'dirty' };
    store.put('draft', draft.id, draft);
    assert.equal(store.drafts(target).length, 1);
    const folder = join(directory, 'custom-drafts');
    store.setDraftsFolder(folder);
    assert.equal(store.require<Draft>('draft', draft.id).html, '<p>b</p>');
    assert.ok(existsSync(join(folder, draft.id + '.json')), 'draft persisted as JSON in the custom folder');
    assert.equal(store.drafts(target).length, 1);
    const updated = { ...draft, html: '<p>c</p>', revision: 3 };
    store.put('draft', draft.id, updated);
    assert.equal(store.require<Draft>('draft', draft.id).html, '<p>c</p>');
    assert.throws(() => store!.setDraftsFolder('relative/path'), /DRAFTS_FOLDER_NOT_ABSOLUTE/);
    store.setDraftsFolder('');
    assert.equal(store.require<Draft>('draft', draft.id).html, '<p>c</p>', 'draft migrated back to the internal database');
    assert.equal(store.drafts(target).length, 1);
    const guideline = { id: crypto.randomUUID(), kind: 'send' as const, name: '写标准需求', description: '标准模板', content: '模板正文', files: [], file: '' };
    store.put('guideline', guideline.id, guideline);
    assert.deepEqual(store.guidelines(), [guideline]);
    // 旧版单文件字段在读取时折叠为带备注的文件列表，多文件按顺序保留。
    const legacy = { id: crypto.randomUUID(), kind: 'library' as const, name: '变量定义', description: '', content: '', file: 'C:/docs/vars.md' };
    store.put('guideline', legacy.id, legacy);
    assert.deepEqual(store.guidelines().find(g => g.id === legacy.id)!.files, [{ path: 'C:/docs/vars.md', label: '' }]);
    const multi = { ...guideline, id: crypto.randomUUID(), kind: 'library' as const, content: '', files: [{ path: 'C:/a.md', label: '模板 v2' }, { path: 'C:/b.md', label: '' }] };
    store.put('guideline', multi.id, multi);
    assert.deepEqual(store.guidelines().find(g => g.id === multi.id)!.files.map(f => f.label), ['模板 v2', '']);
    store.startRun(session.id, crypto.randomUUID(), 'busy turn', []);
    const attached = store.startRun(session.id, crypto.randomUUID(), 'with guideline', [], undefined, [], 'auto', 'queue', guideline.id).run;
    assert.equal(attached.guidelineId, guideline.id);
    assert.equal(attached.status, 'queued');
    assert.equal((store.events(session.id, 0).filter(e => e.kind === 'user').at(-1)!.data as any).guideline.name, '写标准需求');
    assert.throws(() => store!.startRun(session.id, crypto.randomUUID(), 'missing guideline', [], undefined, [], 'auto', 'queue', crypto.randomUUID()), /GUIDELINE_NOT_FOUND/);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
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
test('draft folder ignores unrelated JSON and equivalent path spellings keep drafts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'polarion-drafts-safety-'));
  const store = new Store(join(directory, 'state.sqlite'));
  try {
    const draft: Draft = { id: crypto.randomUUID(), target, workItemId: 'S-1', title: 'fixture', baseHtml: '<p>a</p>', html: '<p>b</p>', baseUpdated: '2026-01-01T00:00:00Z', revision: 2, state: 'dirty' };
    store.put('draft', draft.id, draft);
    const folder = join(directory, 'drafts');
    store.setDraftsFolder(folder);
    // 共享目录里的 package.json/其它 JSON 不能被当作草稿，否则 d.target 为 undefined 会让整条链路抛错。
    writeFileSync(join(folder, 'package.json'), '{"name":"workspace"}');
    writeFileSync(join(folder, 'notes.json'), '{"id":"not-a-draft"}');
    assert.deepEqual(store.list<Draft>('draft').map(item => item.id), [draft.id]);
    // 同一目录的另一种写法不能触发迁移删除：写入和删除的会是同一批文件。
    store.setDraftsFolder(folder.replaceAll('\\', '/') + '/');
    assert.deepEqual(store.list<Draft>('draft').map(item => item.id), [draft.id]);
    assert.ok(existsSync(join(folder, draft.id + '.json')));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('session archive and group round trip through the store without touching updatedAt', () => {
  const store=new Store(':memory:');
  try {
    const session=store.createSession(target,'新工程会话');
    const order=session.updatedAt;
    const archived=CommandSchema.parse({method:'sessions.archive',sessionId:session.id,archived:true});
    assert.equal(archived.method,'sessions.archive');
    const current=store.require<Session>('session',session.id);
    current.archived=true;store.put('session',current.id,current);
    assert.equal(store.require<Session>('session',session.id).archived,true);
    const grouped=CommandSchema.parse({method:'sessions.group',sessionId:session.id,group:'  S1 验收  '});
    assert.equal(grouped.method,'sessions.group');
    const renamed=store.require<Session>('session',session.id);
    renamed.group='S1 验收';store.put('session',renamed.id,renamed);
    const back=store.require<Session>('session',session.id);
    assert.equal(back.group,'S1 验收');
    assert.equal(back.archived,true);
    assert.equal(back.updatedAt,order,'archiving and grouping must not reorder sessions');
    const clear=CommandSchema.parse({method:'sessions.group',sessionId:session.id,group:''});
    assert.equal(clear.method,'sessions.group');
  } finally {store.close();}
});

test('session delete purges runs, events and request mappings and rejects busy sessions', () => {
  const store=new Store(':memory:');
  try {
    const session=store.createSession(target,'待删除会话');
    const context:Context={id:'c1',target,text:'上下文',prefix:'',suffix:'',source:'work-item',pinned:false,capturedAt:Date.now()};
    const {run}=store.startRun(session.id,'req-del-1','你好',[context]);
    store.event(run,'status',{status:'completed'});
    assert.ok(store.events(session.id,0).length>=1);
    // 运行中的会话必须拒绝删除
    assert.throws(()=>store.deleteSession(session.id),/SESSION_BUSY/);
    // 结束任务后删除：联动清理 runs/事件/请求映射
    run.status='completed';run.endedAt=Date.now();store.put('run',run.id,run);
    const result=store.deleteSession(session.id);
    assert.deepEqual(result,{deleted:session.id});
    assert.equal(store.get('session',session.id),undefined);
    assert.equal(store.list<{sessionId:string}>('run').filter(r=>r.sessionId===session.id).length,0);
    assert.equal(store.events(session.id,0).length,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM requests').get()?.n,0,'stale request mappings must be purged');
    assert.throws(()=>store.deleteSession(session.id),/NOT_FOUND/);
  } finally {store.close();}
});

test('session groups registry: create dedupes, delete disbands and strips sessions', () => {
  const store=new Store(':memory:');
  try {
    const s1=store.createSession(target,'组内会话');
    const s2=store.createSession(target,'散会话');
    s1.group='逻辑';store.put('session',s1.id,s1);
    const created=store.get<{name:string}>('session-group','逻辑');
    assert.equal(created,undefined,'registry starts empty; UI creates via command path');
    store.put('session-group','逻辑',{name:'逻辑',createdAt:Date.now()});
    store.put('session-group','逻辑',{name:'逻辑',createdAt:Date.now()+1});
    const rows=store.list<{name:string}>('session-group');
    assert.equal(rows.length,1,'duplicate create must overwrite same key, not duplicate');
    assert.equal(store.list<{group?:string}>('session').filter(x=>x.group==='逻辑').length,1);
    // 解散：清登记 + 清所有会话上的该分组
    store.remove('session-group','逻辑');
    for (const s of store.list<{id:string;group?:string}>('session')) if (s.group==='逻辑') store.put('session',s.id,{...s,group:undefined});
    assert.equal(store.list<{group?:string}>('session-group').length,0);
    assert.equal(store.require<Session>('session',s1.id).group,undefined);
    assert.equal(store.require<Session>('session',s2.id).group,undefined);
    assert.ok(store.get('session',s1.id),'disband must keep sessions themselves');
  } finally {store.close();}
});
