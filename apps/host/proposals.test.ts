import { test } from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {Changes} from './changes.ts';
import {Assets} from './assets.ts';
import { Store } from './store.ts';
import { Proposals } from './proposals.ts';
import { Drafts, type ChangeWriteInput } from './polarion.ts';
import type { Target } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'PSB', document: '_wiki/测试文档' };
const other: Target = { ...target, document: '_wiki/另一文档' };
async function fixture(mode: 'ok' | 'conflict' | 'lost' | 'record-error' = 'ok') {
  const store = new Store(':memory:');
  let item = {id:'SPE-1',title:'助力',description:'<p>前制动助力。制动助力后</p>',updated:'1'}, writes = 0;
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
    else { assert.equal(proposal.status,'failed'); assert.equal(proposal.appliedAt,undefined); assert.equal(draft?.state, mode === 'conflict' ? 'conflict' : 'uncertain'); }
    assert.equal(f.writes,mode === 'conflict' ? 0 : 1); assert.equal(f.records.length,0); await assert.rejects(f.proposals.approve(p.id,'clean'),/NOT_PENDING/);
  } finally { f.store.close(); }
});
