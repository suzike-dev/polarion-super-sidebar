import { test } from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {Changes} from './changes.ts';
import {Assets} from './assets.ts';
import { Store } from './store.ts';
import { Service } from './service.ts';
import { Proposals } from './proposals.ts';
import { Drafts, type ChangeWriteInput } from './polarion.ts';
import { ProposalOpSchema, type Run, type Target } from '../../packages/protocol/index.ts';
import { lintDocument, RulePackSchema } from '../../packages/core/requirement-lint.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';
import { richSchema } from '../../packages/core/rich-schema.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'PSB', document: '_wiki/测试文档' };
const other: Target = { ...target, document: '_wiki/另一文档' };
async function fixture(mode: 'ok' | 'conflict' | 'lost' | 'record-error' = 'ok', html = '<p>前制动助力。制动助力后</p>') {
  const store = new Store(':memory:');
  let item = {id:'SPE-1',title:'助力',description:html,updated:'1'}, writes = 0;
  const records: ChangeWriteInput[] = [];
  const drafts = new Drafts(store, {
    read:async () => ({...item}),
    save:async d => { writes++; item = {...item,description:d.html,updated:'2'}; if (mode === 'lost') throw Error('RESPONSE_LOST'); return item; },
    changeWrite:async input => { if (mode === 'record-error') throw Error('ACCESS_DENIED'); records.push(input); return {workItemId:'CHANGE-1', updated:'1', attachmentId:'record-1', uri:'fixture://CHANGE-1'}; },
    changeList:async () => records.map(r => ({workItemId:'CHANGE-1',title:r.title,description:r.description,created:'1',updated:'1',type:'task',status:'open',attachments:[]})),
  });
  const changes = new Changes(store,drafts,new Assets(store));
  const proposals = new Proposals(store,drafts,changes), draft = await drafts.open(target,'SPE-1');
  const input = {source:'lint' as const,target,workItemId:draft.workItemId,summary:'统一助力术语',op:{kind:'replace-all-text' as const,draftId:draft.id,expectedRevision:draft.revision,from:'制动助力',to:'刹车助力',caseSensitive:true}};
  if (mode === 'conflict') item.updated = '3';
  return {store,drafts,draft,input,proposals,changes,records,get writes(){return writes;}};
}

test('预览冻结版本、逐字标注两处；确认后独立回读并写入可重新加载的项目记录',async () => {
  const f = await fixture();
  try {
    const p = f.proposals.create(f.input);
    assert.equal(p.status,'pending'); assert.equal(f.writes,0); assert.equal(p.matchCount,2);
    assert.equal(p.diffPreview!.before.filter(s => s.kind === 'del').map(s => s.text).join(''),'制动制动');
    assert.equal(p.diffPreview!.after.map(s => s.text).join(''),'前刹车助力。刹车助力后');
    const saving = f.proposals.approve(p.id,'clean');
    assert.equal(f.proposals.get(p.id).status,'approved');
    await assert.rejects(f.proposals.approve(p.id,'clean'),/NOT_PENDING/);
    const {proposal,draft} = await saving;
    assert.equal(proposal.status,'applied'); assert.equal(proposal.savedToPolarion,true); assert.equal(proposal.recordId,p.id);
    assert.equal(draft?.state,'clean'); assert.equal(f.writes,1); assert.equal(f.records.length,1);
    const payload = JSON.parse(gunzipSync(Buffer.from(f.records[0]!.dataBase64,'base64')).toString());
    assert.equal(payload.source,'lint'); assert.equal(payload.changedItems,1); assert.equal(payload.changes[0].workItemId,'SPE-1');
    const workspace = await f.changes.workspace(target); assert.equal(workspace.online,true); assert.equal(workspace.records[0]?.source,'lint'); assert.equal(workspace.proposalActivity?.length,0);
  } finally { f.store.close(); }
});

test('混排术语的预览和重启后确认只改两处有效别名，保留跨标记格式、标准词与宏', async t => {
  const macro = "<span id='polarion_wiki macro name=fixture;params=keep'>示例信号</span>";
  const html = "<p class='native'>验收示例信号｜示例信号｜<b id='b'>示例</b><i style='color:red'>信号</i>｜示例信号扩展｜" + macro + '｜示例<br>信号</p>';
  const expected = "<p class='native'>验收示例信号｜验收示例信号｜<b id='b'>验收示例</b><i style='color:red'>信号</i>｜示例信号扩展｜" + macro + '｜示例<br>信号</p>';
  const f = await fixture('ok', html); t.after(() => f.store.close());
  const pack = RulePackSchema.parse({ glossary: [{ term: '验收示例信号', aliases: ['示例信号'] }, { term: '扩展量', aliases: ['示例信号扩展'] }] });
  f.store.put('rule-pack', target.projectId, { pack });
  const doc = richSchema.nodeFromJSON(new RichDocument(html).document);
  const hits = lintDocument(doc, pack).filter(issue => issue.suggestion === '验收示例信号');
  assert.equal(hits.length, 2);
  const op = ProposalOpSchema.parse({ ...f.input.op, from: '示例信号', to: '验收示例信号', caseSensitive: false, lintMatches: hits.map(({ from, to }) => ({ from, to })) });
  const p = f.proposals.create({ ...f.input, op });
  assert.equal(p.matchCount, 2);
  assert.equal(p.diffPreview!.after.filter(s => s.kind === 'ins').map(s => s.text).join('|'), '验收|验收');
  const reopened = new Proposals(f.store, f.drafts, f.changes);
  const { draft, replacements } = await reopened.approve(p.id, 'clean');
  assert.equal(replacements, 2); assert.equal(draft?.html, expected); assert.equal(f.writes, 1);
  const saved = richSchema.nodeFromJSON(new RichDocument(draft!.html).document); saved.check();
  assert.equal(p.diffPreview!.after.map(s => s.text).join(''), saved.textBetween(0, saved.content.size, '\n', '\uFFFC'));
  assert.deepEqual(lintDocument(saved, pack).map(issue => issue.matchedText), ['示例信号扩展']);
  assert.throws(() => reopened.create({ ...f.input, op: { ...f.input.op, from: '示例信号', to: '验收示例信号', expectedRevision: draft!.revision } }), /REPLACE_TEXT_NOT_FOUND/);
});

test('升级前待确认的字面术语提案须与有效范围一致，普通全文替换仍逐字执行', async t => {
  const f = await fixture('ok', '<p>验收示例信号，示例信号。</p>'); t.after(() => f.store.close());
  const op = { ...f.input.op, from: '示例信号', to: '验收示例信号' };
  const manual = f.proposals.create({ ...f.input, source: 'manual', op });
  assert.equal(manual.matchCount, 2);
  const legacy = { ...manual, id: crypto.randomUUID(), source: 'lint' as const };
  f.store.put('proposal', legacy.id, legacy); // persisted before proposals carried lint ranges
  const rejected = await f.proposals.approve(legacy.id, 'clean');
  assert.equal(rejected.proposal.status, 'failed'); assert.match(rejected.proposal.error!, /重新预览/);
  assert.equal(f.drafts.read(f.draft.id).html, f.draft.html); assert.equal(f.writes, 0);
  const result = await f.proposals.approve(manual.id);
  assert.equal(result.draft?.html, '<p>验收验收示例信号，验收示例信号。</p>'); assert.equal(f.writes, 0);

  const safe = await fixture(); t.after(() => safe.store.close());
  const old = safe.proposals.create({ ...safe.input, source: 'manual' });
  safe.store.put('proposal', old.id, { ...old, source: 'lint' });
  assert.equal((await safe.proposals.approve(old.id, 'clean')).proposal.savedToPolarion, true);
});

test('大小写修复覆盖同一别名的多种拼写，服务器核对编辑器范围并按已预览的修订应用', async t => {
  const html = "<p>RPM，rpm，<b class='unit'>rP</b><i>m</i>，RPMRate</p><p>r<br>pm</p>";
  const f = await fixture('ok', html); t.after(() => f.store.close());
  const pack = RulePackSchema.parse({ glossary: [{ term: 'RPM', aliases: ['rpm'] }, { term: 'RPMRate' }] });
  f.store.put('rule-pack', target.projectId, { pack });
  const op = { ...f.input.op, from: 'rpm', to: 'RPM', caseSensitive: false };
  assert.throws(() => f.proposals.create({ ...f.input, op: { ...op, lintMatches: [{ from: 1, to: 4 }] } }), /重新.*预览/);
  assert.equal(f.proposals.list().length, 0);
  const p = f.proposals.create({ ...f.input, op });
  assert.equal(p.matchCount, 2);
  f.store.put('rule-pack', target.projectId, { pack: RulePackSchema.parse({ glossary: [] }) });
  const { draft } = await f.proposals.approve(p.id, 'clean');
  assert.equal(draft?.html, "<p>RPM，RPM，<b class='unit'>RP</b><i>M</i>，RPMRate</p><p>r<br>pm</p>");
  assert.deepEqual(lintDocument(richSchema.nodeFromJSON(new RichDocument(draft!.html).document), pack), []);
});

test('长草稿的保存预览分别标注未保存的编辑和两次术语替换', async t => {
  const middle = '界'.repeat(6500);
  const f = await fixture('ok', `<p>甲</p><p>示例信号${middle}示例信号</p>`); t.after(() => f.store.close());
  const dirty = f.drafts.replace(f.draft.id, 0, f.draft.nodes.find(node => node.text === '甲')!.id, '甲', '乙');
  const p = f.proposals.create({ ...f.input, op: { ...f.input.op, from: '示例信号', to: '验收示例信号', expectedRevision: dirty.revision } });
  assert.equal(p.matchCount, 2); assert.equal(p.includesDraftEdits, true);
  const diff = p.diffPreview!;
  assert.ok(diff.before.filter(s => s.kind === 'del').every(s => s.text === '甲'));
  assert.ok(diff.after.filter(s => s.kind === 'ins').every(s => s.text === '乙' || s.text === '验收'));
  assert.equal(diff.after.filter(s => s.kind === 'ins').length, 3);
  assert.equal(diff.after.map(s => s.text).join(''), `乙\n验收示例信号${middle}验收示例信号`);
  assert.equal((await f.proposals.approve(p.id, 'clean')).draft!.html, `<p>乙</p><p>验收示例信号${middle}验收示例信号</p>`);
});

test('拒绝、原生状态与草稿作用域校验均不写正文',async () => {
  const f = await fixture(); try {
    assert.throws(() => f.proposals.create({...f.input,target:other}),/TARGET_MISMATCH/);
    assert.throws(() => f.proposals.create({...f.input,workItemId:'SPE-2'}),/TARGET_MISMATCH/);
    const p = f.proposals.create(f.input); assert.equal(f.proposals.list(other).length,0);
    assert.equal(f.proposals.reject(p.id).status,'rejected'); await assert.rejects(f.proposals.approve(p.id,'clean'),/NOT_PENDING/);
    for(const state of [undefined,'dirty','unknown'] as const) {
      const {proposal} = await f.proposals.approve(f.proposals.create(f.input).id,state); assert.match(proposal.error!,/NATIVE_EDITOR/); assert.equal(proposal.status,'failed');
    }
    assert.equal(f.drafts.read(f.draft.id).revision,0); assert.equal(f.writes,0);
  } finally { f.store.close(); }
});

test('节点替换保留草稿语义；预览后编辑导致陈旧提案失败',async () => {
  const f = await fixture(); try {
    const lint = f.proposals.create(f.input),leaf = f.draft.nodes.find(n => n.text)!;
    const p = f.proposals.create({...f.input,source:'manual',op:{kind:'replace-text',draftId:f.draft.id,expectedRevision:0,nodeId:leaf.id,expectedText:leaf.text!,text:'编辑了制动助力'}});
    assert.equal((await f.proposals.approve(p.id)).draft?.state,'dirty');
    const result = await f.proposals.approve(lint.id,'clean'); assert.equal(result.proposal.error,'STALE_DRAFT'); assert.equal(result.proposal.status,'failed'); assert.equal(f.writes,0);
    const again = f.proposals.create({...f.input,op:{...f.input.op,expectedRevision:1}}); assert.equal(again.includesDraftEdits,true); assert.match(again.diffPreview!.before.map(s => s.text).join(''),/前制动/);
  } finally { f.store.close(); }
});

test('体检改写与重试仅修改本地草稿，确认后可保存，同会话普通轮遵循全局自动保存', async t => {
  const f = await fixture();
  const service = new Service(f.store, f.drafts);
  t.after(() => { service.engines.close(); f.store.close(); });
  f.store.put('settings', 'global', { ...f.store.settings(), agentAutoSave: true });
  const session = f.store.createSession(target, '审阅草稿');
  const executions = t.mock.method(service.engines, 'execute');
  const rpc = (command: Record<string, unknown>) => service.request({ protocol: 1, id: crypto.randomUUID(), command });
  const runTurn = async (command: Record<string, unknown>) => {
    const reply = await rpc(command);
    if (!reply.ok) assert.fail(reply.error);
    await executions.mock.calls.at(-1)!.result;
    const run = f.store.require<Run>('run', (reply.value as Run).id);
    assert.equal(run.status, 'completed', run.error);
    return run;
  };
  const start = { method: 'runs.start', sessionId: session.id, requestId: crypto.randomUUID(), target, prompt: '文字加粗',
    contexts: [{ id: crypto.randomUUID(), target, workItemId: f.draft.workItemId, text: '制动助力', source: 'work-item', capturedAt: 1 }] };
  const review = await runTurn({ ...start, autoSave: false });
  assert.equal(f.writes, 0, '审阅前不应写入 Polarion');
  const draft = f.drafts.read(f.draft.id);
  assert.equal(draft.state, 'dirty');
  assert.equal(draft.baseHtml, f.draft.html);
  assert.notEqual(draft.html, draft.baseHtml);
  assert.ok(draft.revision > f.draft.revision);
  assert.equal(review.autoSave, false);

  const retry = await runTurn({ method: 'runs.retry', runId: review.id, requestId: crypto.randomUUID() });
  assert.equal(retry.autoSave, false);
  assert.equal(f.writes, 0);
  assert.equal(f.records.length, 0);
  assert.equal(f.proposals.list().length, 0);
  assert.ok(!f.store.events(session.id, 0).some(event => event.kind === 'tool' && (event.data as { name?: string }).name === 'mcp__polarion_drafts__save_draft'));

  const reviewed = f.drafts.read(f.draft.id);
  const confirmed = await rpc({ method: 'drafts.save', draftId: reviewed.id, expectedRevision: reviewed.revision, nativeState: 'clean' });
  assert.equal(confirmed.ok, true);
  assert.equal(f.writes, 1);
  assert.equal(f.drafts.read(f.draft.id).state, 'clean');

  const ordinary = await runTurn({ ...start, requestId: crypto.randomUUID(), prompt: '文字改为蓝色' });
  assert.equal(ordinary.autoSave, undefined);
  assert.equal(f.writes, 2);
  assert.equal(f.records.length, 1);
  const saved = f.drafts.read(f.draft.id);
  assert.equal(saved.state, 'clean');
  assert.match(saved.baseHtml, /#2563eb/i);
  const ordinaryRetry = await runTurn({ method: 'runs.retry', runId: ordinary.id, requestId: crypto.randomUUID() });
  assert.equal(ordinaryRetry.autoSave, undefined);
});

for (const source of ['agent','workflow'] as const) test(`自动保存的共享记录保留来源 ${source}`,async () => {
  const f = await fixture();
  try {
    const session = f.store.createSession(target,'自动保存验收');
    const {run} = f.store.startRun(session.id,crypto.randomUUID(),'修订术语',[],target);
    if (source === 'workflow') run.workflow = {workflowRunId:crypto.randomUUID(),defName:'验收',stepIndex:0,stepTitle:'修订',stepTotal:1};
    f.drafts.replaceAll(f.draft.id,0,'制动助力','刹车助力',true);
    const result = await f.proposals.autoSave(run,f.drafts.read(f.draft.id),crypto.randomUUID());
    assert.equal(result.saved.state,'clean'); assert.equal(result.proposal.savedToPolarion,true);
    assert.equal(result.proposal.recordId,result.proposal.id);
    assert.equal((await f.changes.workspace(target)).records[0]?.source,source);
  } finally { f.store.close(); }
});

for (const mode of ['conflict','lost','record-error'] as const) test(`保存与审计分开报告 ${mode}`,async () => {
  const f = await fixture(mode); try {
    const p = f.proposals.create(f.input), {proposal,draft} = await f.proposals.approve(p.id,'clean');
    if (mode === 'record-error') { assert.equal(proposal.status,'applied'); assert.equal(proposal.recordError,'ACCESS_DENIED'); assert.equal(proposal.savedToPolarion,true); }
    else if (mode === 'conflict') { assert.equal(proposal.status,'applied'); assert.equal(proposal.savedToPolarion,true); assert.equal(draft?.state,'clean'); }
    else { assert.equal(proposal.status,'failed'); assert.equal(proposal.appliedAt,undefined); assert.equal(draft?.state,'uncertain'); }
    assert.equal(f.writes,1); assert.equal(f.records.length,mode === 'conflict' ? 1 : 0); await assert.rejects(f.proposals.approve(p.id,'clean'),/NOT_PENDING/);
  } finally { f.store.close(); }
});
