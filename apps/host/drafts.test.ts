import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Service } from './service.ts';
import type { Command } from '../../packages/protocol/index.ts';
import { build } from 'esbuild';
import { Store } from './store.ts';
import { Drafts, Polarion, previewText, type RemoteItem } from './polarion.ts';
import { richSchema } from '../../packages/core/rich-schema.ts';
import { qualitySentence } from '../../packages/core/editor-text.ts';
import { defaultRulePack, lintDocument } from '../../packages/core/requirement-lint.ts';
import { tidyDocument } from '../../packages/core/document-tidy.ts';
const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Fixture' };
test('draft RPC saves a tidy through SOAP and follows the server when a write is ignored', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'draft-save-soap-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const worker = path.join(dir, 'worker.mjs'), stateFile = path.join(dir, 'state.json');
  const initial = '<table>\n <tbody>\n  <tr><td>Label<br>\n        Value</td></tr></tbody></table>';
  await writeFile(stateFile, JSON.stringify({ html: initial, updated: 1, writes: 0, ignore: false, deny: false }));
  const fixtureFetch = async (_url: string, { body }: { body: string }) => {
    const fs = await import('node:fs/promises');
    const file = process.env.FIXTURE_STATE!, state = JSON.parse(await fs.readFile(file, 'utf8'));
    const soap = (xml: string) => new Response('<Envelope><Body>' + xml + '</Body></Envelope>');
    const uri = 'subterra:data-service:objects:/default/test01${WorkItem}T-7';
    if (body.includes('<svc:logInWithToken>')) return soap('<sessionID>fixture</sessionID>');
    if (body.includes('<svc:getModuleByLocation>')) return soap('<getModuleByLocationReturn uri="module"><id>Fixture</id></getModuleByLocationReturn>');
    if (body.includes('<svc:getWorkItemById>')) {
      if (state.deny) return new Response('', { status: 403 });
      return soap(`<getWorkItemByIdReturn uri="${uri}" unresolvable="false"><id>T-7</id><title>Fixture</title><moduleURI>module</moduleURI><updated>${state.updated}</updated><description><type>text/html</type><content>${state.html.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</content><contentLossy>false</contentLossy></description></getWorkItemByIdReturn>`);
    }
    const update = /<svc:updateWorkItem><svc:content uri="([^"]+)"><trk:description><typ:type>text\/html<\/typ:type><typ:content>([^<]*)<\/typ:content><typ:contentLossy>false<\/typ:contentLossy><\/trk:description><\/svc:content><\/svc:updateWorkItem>/.exec(body);
    if (!update || update[1] !== uri) throw Error('unexpected SOAP operation or fields');
    state.writes++;
    if (!state.ignore) {
      const submitted = update[2]!.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
      state.html = submitted.replaceAll('>\n <', '><').replaceAll('>\n  <', '><').replaceAll('<br>\n', '<br>');
      state.updated++;
    }
    await fs.writeFile(file, JSON.stringify(state));
    return soap('<updateWorkItemResponse/>');
  };
  await build({ entryPoints: [path.join(import.meta.dirname, 'polarion-worker.ts')], outfile: worker, bundle: true, platform: 'node', format: 'esm', banner: { js: `globalThis.fetch = ${fixtureFetch.toString()};` } });
  const remote = new Polarion();
  t.mock.method(remote, 'call', async (request: object) => {
    const result = execFileSync(process.execPath, [worker], { input: JSON.stringify({ ...request, id: 'fixture' }) + '\n', encoding: 'utf8', timeout: 10000,
      env: { SystemRoot: process.env.SystemRoot, FIXTURE_STATE: stateFile, POLARION_AUTH_MODE: 'access_token', POLARION_ACCESS_TOKEN: 'fixture' } });
    const reply = JSON.parse(result); if (!reply.ok) throw Error(reply.error);
    return reply.value;
  });
  const store = new Store(':memory:'); t.after(() => store.close());
  const service = new Service(store, new Drafts(store, remote));
  const rpc = async <T,>(command: Command) => {
    const reply = await service.request({ protocol: 1, id: crypto.randomUUID(), command });
    if (!reply.ok) throw Error(reply.error);
    return reply.value as T;
  };
  const server = async () => JSON.parse(await readFile(stateFile, 'utf8'));
  type View = ReturnType<Drafts['read']>;
  const draft = await rpc<View>({ method: 'drafts.open', target, workItemId: 'T-7' });
  const rich = await rpc<ReturnType<Drafts['richRead']>>({ method: 'drafts.rich.read', draftId: draft.id });
  const tidy = tidyDocument(rich.document);
  assert.equal(tidy.changes.spaces, 1);
  const apply = (revision: number) => rpc<View>({ method: 'drafts.rich.apply', draftId: draft.id, editorId: rich.editorId, expectedRevision: revision, document: tidy.doc });
  const save = (revision: number) => rpc<View>({ method: 'drafts.save', draftId: draft.id, expectedRevision: revision, nativeState: 'clean' });
  const edited = await apply(draft.revision);
  await assert.rejects(save(draft.revision), /STALE_DRAFT/);
  const saved = await save(edited.revision);
  assert.equal(saved.state, 'clean'); assert.equal(saved.html, '<table><tbody><tr><td>Label<br> Value</td></tr></tbody></table>');
  assert.equal(saved.baseHtml, (await server()).html);
  // Earlier versions could retain this same proposal after a reviewed keep-local decision.
  store.put('draft', draft.id, { ...store.require<object>('draft', draft.id), html: edited.html, revision: saved.revision + 1, state: 'dirty' });
  const adopted = await save(saved.revision + 1);
  assert.equal(adopted.html, saved.html); assert.equal(adopted.state, 'clean'); assert.equal((await server()).writes, 2);
  const text = await rpc<View>({ method: 'drafts.replaceText', draftId: draft.id, expectedRevision: adopted.revision, nodeId: adopted.nodes.find(n => n.text === 'Label')!.id, expectedText: 'Label', text: 'Edited' });
  await writeFile(stateFile, JSON.stringify({ ...await server(), deny: true }));
  await assert.rejects(save(text.revision), /PERMISSION_DENIED|POLARION_OPERATION_FAILED/); assert.equal((await server()).writes, 2);
  await writeFile(stateFile, JSON.stringify({ ...await server(), deny: false, ignore: true }));
  // An acknowledged but ignored write must not be called success. The draft
  // stays intact and editable so the next click can try again.
  await assert.rejects(save(text.revision), /SAVE_NOT_APPLIED/);
  const retained = await rpc<View>({ method: 'drafts.read', draftId: draft.id });
  assert.equal(retained.state, 'dirty'); assert.equal(retained.html, text.html); assert.equal(retained.baseHtml, adopted.baseHtml);
  await writeFile(stateFile, JSON.stringify({ ...await server(), ignore: false }));
  assert.equal((await save(retained.revision)).html, saved.html.replace('Label', 'Edited'));
  assert.equal((await server()).writes, 4);
});

test('an open rich editor survives normalized save, undo, image alias and a second save',async()=>{
 const store=new Store(':memory:');let item:RemoteItem={id:'T-1',title:'x',description:'<p>base</p>',updated:'1'},writes=0;
 const id=crypto.randomUUID();const drafts=new Drafts(store,{read:async()=>({...item}),save:async d=>{writes++;const html=d.html.replaceAll('polarion-asset:'+id,'workitemimg:saved.png');item={...item,description:html,updated:String(writes+1)};return{...item,submittedHtml:html,uploadedAssets:[{localId:id,attachmentId:'saved.png',sha256:'test'}]};}});
 const d=await drafts.open(target,'T-1'),rich=drafts.richRead(d.id),edited=structuredClone(rich.document);edited.content![0]!.content!.push({type:'image',attrs:{assetId:id,src:'polarion-asset:'+id,alt:'image'}});
 const applied=drafts.richApply(d.id,rich.editorId,d.revision,edited),saved=await drafts.save(d.id,applied.revision,'clean');
 assert.equal(drafts.richApply(d.id,rich.editorId,saved.revision,edited).state,'clean');
 const undo=drafts.richApply(d.id,rich.editorId,saved.revision,rich.document);assert.equal(undo.state,'dirty');
 const redo=drafts.richApply(d.id,rich.editorId,undo.revision,edited);assert.equal(redo.state,'clean');
 edited.content![0]!.content![0]!.text='next';const next=drafts.richApply(d.id,rich.editorId,redo.revision,edited);assert.match(next.html,/workitemimg:saved.png/);assert.doesNotMatch(next.html,/polarion-asset:/);
 const second=await drafts.save(d.id,next.revision,'clean');assert.equal(second.state,'clean');assert.equal(writes,2);store.close();
});
test('revision-checked recovery verifies a lost normalized save and keeps a stripped cell available for review', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const line = '<div>First<br>\n second</div>';
  const cell = '<td><span style="font-size:10pt"></span></td>';
  const base = `<ol><li><table id="polarion_wiki macro name=table;params=keep"><tr>${cell}<td>Other</td></tr></table></li><ol><li>Last</li></ol></ol>`;
  let item = { id: 'T-7', title: 'Fixture', description: line, updated: '1' }, reads = 0, writes = 0;
  const drafts = new Drafts(store, {
    read: async () => { reads++; return { ...item }; },
    save: async draft => { writes++; item = { ...item, description: draft.html, updated: '4' }; return item; },
  });
  const service = new Service(store, drafts), opened = await drafts.open(target, item.id);
  const rpc = (command: Command) => service.request({ protocol: 1, id: crypto.randomUUID(), command });
  const check = (rev: number) => rpc({ method: 'drafts.reconcile', draftId: opened.id, expectedRevision: rev });
  const rich = drafts.richRead(opened.id);
  const pending = { ...store.require<typeof opened>('draft', opened.id), state: 'uncertain' as const };
  store.put('draft', opened.id, pending);
  item = { ...item, description: line.replace('<br>\n', '<br>'), updated: '2' };
  assert.deepEqual(await check(1).then(r => r.ok ? 'ok' : r.error), 'STALE_DRAFT'); assert.equal(reads, 1);
  const retried = await drafts.save(opened.id, pending.revision, 'clean');
  assert.equal(retried.state, 'clean'); assert.equal(retried.baseHtml, item.description);
  assert.equal(writes, 1);

  const retained = { ...pending, baseHtml: base, baseUpdated: '2', html: base.replace('</span></td>', '</span> </td>'), revision: 4 };
  store.put('draft', opened.id, retained);
  const stripped = base.replace(cell, '<td></td>').replace('<ol><li>Last</li></ol></ol>', '<li style="list-style:none"><ol><li>Last</li></ol></li></ol>');
  item = { ...item, description: stripped, updated: '3' };
  assert.ok((await check(4)).ok);
  const conflict = drafts.read(opened.id);
  assert.equal(conflict.state, 'conflict'); assert.equal(conflict.html, retained.html); assert.equal(conflict.baseHtml, base);
  const review = await drafts.conflictRead(opened.id);
  const latest = await drafts.resolveConflict(opened.id, 4, review.remoteHash, review.remoteUpdated, 'use-remote');
  assert.equal(store.list<{ previous: typeof retained }>('conflict-resolution')[0]!.previous.html, retained.html);
  assert.equal(writes, 1);
  const edited = drafts.replace(opened.id, latest.revision, latest.nodes.find(n => n.text === 'Other')!.id, 'Other', 'Revised');
  const saved = await drafts.save(opened.id, edited.revision, 'clean');
  assert.equal(saved.html, stripped.replace('Other', 'Revised')); assert.equal(saved.state, 'clean'); assert.equal(writes, 2);
});

test('image container write can reconcile a lost response without a second remote write',async()=>{
 const store=new Store(':memory:');let item={id:'T-1',title:'x',description:'<h2>base</h2><p style="background-color:#fef3c7"><img src="workitemimg:existing.png"></p>',updated:'1'},writes=0;
 const drafts=new Drafts(store,{read:async()=>({...item}),save:async draft=>{writes++;item={...item,description:draft.html,updated:'2'};throw Error('RESPONSE_LOST');}});
 const draft=await drafts.open(target,'T-1'),edited=drafts.replace(draft.id,0,draft.nodes.find(n=>n.text==='base')!.id,'base','next');await assert.rejects(drafts.save(draft.id,edited.revision,'clean'),/RESPONSE_LOST/);assert.equal(drafts.read(draft.id).state,'uncertain');
 const recovered=await drafts.reconcile(draft.id);assert.equal(recovered.state,'clean');assert.equal(recovered.html,item.description);assert.equal(recovered.baseHtml,item.description);assert.equal(recovered.revision,edited.revision+1);assert.equal(writes,1);assert.match(recovered.html,/^<div data-polarion-sidebar-document/);store.close();
});
test('readback confirms the saved body and reports lost heading markup as not applied',async()=>{
 const store=new Store(':memory:');let item={id:'T-1',title:'x',description:'<p style="color:red;text-align:center">base</p>',updated:'1'};
 const drafts=new Drafts(store,{read:async()=>({...item}),save:async draft=>{item={...item,description:draft.html.replace('color:red;text-align:center','color: red; text-align: center;'),updated:'2'};return item;}});
 const d=await drafts.open(target,'T-1'),edited=drafts.replace(d.id,0,d.nodes.find(n=>n.text==='base')!.id,'base','next');const saved=await drafts.save(d.id,edited.revision,'clean');assert.equal(saved.state,'clean');assert.equal(saved.html,item.description);assert.equal(saved.baseHtml,saved.html);store.close();
 const other=new Store(':memory:');let remote={id:'T-2',title:'x',description:'<h2>base</h2>',updated:'1'};const service=new Drafts(other,{read:async()=>({...remote}),save:async draft=>{remote={...remote,description:draft.html.replace(/<\/?h2>/g,''),updated:'2'};return remote;}});const a=await service.open(target,'T-2'),b=service.replace(a.id,0,a.nodes.find(n=>n.text==='base')!.id,'base','next');await assert.rejects(service.save(a.id,b.revision,'clean'),/READBACK_MISMATCH/);const kept=service.read(a.id);assert.equal(kept.state,'dirty');assert.match(kept.html,/<h2>next<\/h2>/);other.close();
});
test('conflict review resolution retains both versions, checks the reviewed remote revision and never saves remotely',async()=>{
  const store=new Store(':memory:');let item={id:'T-1',title:'x',description:'<p>base</p>',updated:'1'},writes=0;
  const drafts=new Drafts(store,{read:async()=>({...item}),save:async()=>{writes++;return item;}}),d=await drafts.open(target,'T-1');
  drafts.replace(d.id,0,d.nodes.find(n=>n.text==='base')!.id,'base','local');item={...item,description:'<p>remote</p>',updated:'2'};
  const review=await drafts.conflictRead(d.id);item.updated='3';await assert.rejects(drafts.resolveConflict(d.id,1,review.remoteHash,review.remoteUpdated,'keep-local'),/REMOTE_CHANGED_SINCE_REVIEW/);
  const next=await drafts.conflictRead(d.id),resolved=await drafts.resolveConflict(d.id,1,next.remoteHash,next.remoteUpdated,'keep-local');assert.equal(resolved.html,'<p>local</p>');assert.equal(resolved.baseHtml,'<p>remote</p>');assert.equal(resolved.state,'dirty');assert.equal(writes,0);assert.equal(store.list<any>('conflict-resolution')[0].previous.baseHtml,'<p>base</p>');
  await assert.rejects(drafts.resolveConflict(d.id,1,next.remoteHash,next.remoteUpdated,'use-remote'),/STALE_DRAFT/);
  const accepted=await drafts.resolveConflict(d.id,resolved.revision,next.remoteHash,next.remoteUpdated,'use-remote');assert.equal(accepted.state,'clean');assert.equal(accepted.html,'<p>remote</p>');store.close();
});
test('single quality rewrite preserves nested table and list markup, inline objects, original spelling and style boundaries', async t => {
  const sentence = '系统应及时响应。';
  const macro = '<span id="polarion_wiki macro name=fixture;params=keep">及时</span>';
  const html = `<ol id='steps'><li>${sentence}<table class='native'><tbody data-x='1'><tr><td><h3 id='keep'>` +
    `<strong class='original'>记录&#x2460;。系统应及</strong><em>时</em>响应。${macro}<img src='workitemimg:keep.png'>${sentence}` +
    `</h3></td><td>${sentence}</td></tr></tbody></table></li></ol>`;
  const store = new Store(':memory:'); t.after(() => store.close());
  const drafts = new Drafts(store, { read: async () => ({ id: 'T-1', title: 'fixture', description: html }), save: async () => { throw Error('unexpected remote write'); } });
  const draft = await drafts.open(target, 'T-1');
  const doc = richSchema.nodeFromJSON(drafts.richRead(draft.id).document);
  const issues = lintDocument(doc, defaultRulePack()).filter(issue => issue.matchedText === '及时');
  assert.equal(issues.length, 4);
  const hit = issues[1]!;
  const scope = { ...qualitySentence(doc, hit.from!, hit.to!, hit.matchedText), draftId: draft.id, workItemId: draft.workItemId, expectedRevision: draft.revision, ruleId: hit.ruleId, message: hit.message };
  assert.equal(scope.sentence, sentence);
  const result = drafts.applyQualityRewrite(target, scope, '系统应按约响应。');
  assert.equal(result.html, html.replace('及</strong><em>时', '按</strong><em>约'));
  assert.equal(result.revision, 1);
  assert.equal(store.list('draft-checkpoint').length, 1);
});

test('a repeated finding within one sentence can only change at the clicked occurrence', async t => {
  const sentence = '及时登记并及时通知。', html = `<p>${sentence}</p>`;
  const store = new Store(':memory:'); t.after(() => store.close());
  const drafts = new Drafts(store, { read: async () => ({ id: 'T-1', title: 'fixture', description: html }), save: async () => { throw Error('unexpected remote write'); } });
  const draft = await drafts.open(target, 'T-1');
  const doc = richSchema.nodeFromJSON(drafts.richRead(draft.id).document);
  const hit = lintDocument(doc, defaultRulePack()).filter(issue => issue.matchedText === '及时')[1]!;
  const scope = { ...qualitySentence(doc, hit.from!, hit.to!, hit.matchedText), draftId: draft.id, workItemId: draft.workItemId, expectedRevision: 0, ruleId: hit.ruleId, message: hit.message };
  for (const wrong of [{ ...scope, expectedRevision: 1 }, { ...scope, draftId: crypto.randomUUID() }, { ...scope, workItemId: 'T-2' },
    { ...scope, from: 2, sentence: sentence.slice(1) }, { ...scope, matchedText: '按期' }]) {
    assert.throws(() => drafts.applyQualityRewrite(target, wrong, sentence), /过期.*重新体检/);
  }
  assert.throws(() => drafts.applyQualityRewrite({ ...target, document: 'Other' }, scope, sentence), /过期.*重新体检/);
  for (const bad of ['按期登记并及时通知。', '按期登记并按期通知。', '及时登记并按期通知。改另一句。', '及时登记并按期通知。\n再写一段']) {
    assert.throws(() => drafts.applyQualityRewrite(target, scope, bad), /草稿未修改/);
  }
  assert.equal(drafts.read(draft.id).html, html);
  assert.equal(drafts.applyQualityRewrite(target, scope, sentence).revision, 0);
  assert.equal(drafts.applyQualityRewrite(target, scope, '及时登记并按期通知。').html, '<p>及时登记并按期通知。</p>');
});

test('rich edits, undo, Host restart and AI edits obey one shared revision', async () => {
  const store = new Store(':memory:'); const remote = { read: async () => ({ id: 'T-1', title: 'x', description: '<p class="original">base</p>', updated: 'v1' }), save: async () => { throw Error('not called'); } };
  let drafts = new Drafts(store, remote); const d = await drafts.open(target, 'T-1'); const rich = drafts.richRead(d.id);
  const edited = structuredClone(rich.document); edited.content![0]!.content![0]!.text = 'edited';
  assert.equal(drafts.richApply(d.id, rich.editorId, 0, edited).html, '<p class="original">edited</p>');
  drafts = new Drafts(store, remote); // Editor snapshot is durable across Host restarts.
  assert.equal(drafts.richApply(d.id, rich.editorId, 1, rich.document).state, 'clean');
  const latest = drafts.read(d.id); const leaf = latest.nodes.find(n => n.text === 'base')!;
  drafts.replace(d.id, latest.revision, leaf.id, 'base', 'AI change');
  assert.throws(() => drafts.richApply(d.id, rich.editorId, 2, edited), /STALE_DRAFT/);
  assert.equal(drafts.read(d.id).html, '<p class="original">AI change</p>'); store.close();
});
test('rich apply recovers old omitted cell blocks and orphan inline runs using their original editing session', async t => {
  const macro = '<span id="polarion_wiki macro name=fixture;params=keep">untouched</span>';
  const html = '<ol id="steps"><li>one</li><ol class="nested"><li>two</li></ol></ol>' +
    '<table id="polarion_wiki macro name=table;params=keep"><tbody class="rows"><tr><td><p id="empty" style="color:blue"></p></td>' +
    `<td colspan="2"><p id='first'>before &amp; text</p><p class='middle'>middle</p><p data-last="yes">after` + macro + '</p></td></tr></tbody></table>';
  const store = new Store(':memory:'); t.after(() => store.close());
  const remote = { read: async () => ({ id: 'T-1', title: 'fixture', description: html }), save: async () => { throw Error('unexpected remote save'); } };
  let drafts = new Drafts(store, remote);
  const opened = await drafts.open(target, 'T-1');
  const session = drafts.richRead(opened.id);
  const legacy: typeof session.document = JSON.parse(JSON.stringify(session.document, (key, value) => key === 'sourceHasAttributes' ? undefined : value));
  legacy.content![0]!.content![1]!.content!.shift(); // old tidy removed the virtual list item's leading paragraph
  const [empty, mixed] = legacy.content![1]!.content![0]!.content!;
  delete empty!.content; // PM omits the content field for an empty fragment
  const [first, middle, last] = mixed!.content!;
  first!.content![0]!.text = 'edited & text';
  mixed!.content = [...first!.content!, middle!, ...last!.content!];
  assert.throws(() => richSchema.nodeFromJSON(legacy).check(), /Invalid content for node/);
  drafts = new Drafts(store, remote); // model reconstructed from the persisted source and editor ID
  const saved = drafts.richApply(opened.id, session.editorId, opened.revision, legacy);
  assert.equal(saved.html, html.replace('before &amp; text', 'edited &amp; text'));
  assert.equal(saved.revision, opened.revision + 1);
  assert.equal(saved.state, 'dirty');
  const reopened = drafts.richRead(opened.id);
  richSchema.nodeFromJSON(reopened.document).check();
  assert.equal((await drafts.readOnly(target, 'T-1')).html, saved.html);
  assert.equal(drafts.richApply(opened.id, reopened.editorId, saved.revision, reopened.document).revision, saved.revision);
  assert.equal(drafts.richApply(opened.id, session.editorId, saved.revision, legacy).revision, saved.revision);
  assert.throws(() => drafts.richApply(opened.id, session.editorId, opened.revision, legacy), /STALE_DRAFT/);

  for (const [kind, error] of [['removed', /PROTECTED_OBJECT_REMOVED/], ['changed', /PROTECTED_OBJECT_CHANGED/], ['unknown', /Unknown node type/], ['duplicate', /DUPLICATE_RICH_ANCHOR/]] as const) {
    const broken = structuredClone(legacy);
    const children = broken.content![1]!.content![0]!.content![1]!.content!;
    if (kind === 'removed') children.pop();
    if (kind === 'changed') children.at(-1)!.attrs!.text = 'rewritten';
    if (kind === 'unknown') children.push({ type: 'unsupportedWidget' });
    if (kind === 'duplicate') children.push(children[1]!);
    assert.throws(() => drafts.richApply(opened.id, session.editorId, saved.revision, broken), error);
  }
  assert.throws(() => drafts.richApply(opened.id, session.editorId, saved.revision, { type: 'paragraph' }), /INVALID_RICH_DOCUMENT_ROOT/);
  assert.equal(drafts.read(opened.id).html, saved.html);
  assert.equal(store.list('draft-checkpoint').length, 1);
});

test('tidy saves and rereads nested native lists and empty cells as valid rich documents', async t => {
  const html = '<ol><li>top</li><ol id="nested"><li>pending  edit</li></ol></ol>' +
    '<table class="native" style="border:1px solid black"><tr><th></th><td></td><td><p id="body"></p></td></tr></table>';
  const store = new Store(':memory:'); t.after(() => store.close());
  const drafts = new Drafts(store, { read: async () => ({ id: 'T-2', title: 'fixture', description: html }), save: async () => { throw Error('unexpected remote save'); } });
  const draft = await drafts.open(target, 'T-2');
  const { document, editorId } = drafts.richRead(draft.id);
  const tidy = tidyDocument(document, { tableDefaults: true });
  richSchema.nodeFromJSON(tidy.doc).check();
  const result = drafts.richApply(draft.id, editorId, draft.revision, tidy.doc);
  assert.equal(result.html, html.replace('pending  edit', 'pending edit'));
  const reopened = drafts.richRead(draft.id);
  richSchema.nodeFromJSON(reopened.document).check();
  const next = tidyDocument(reopened.document, { tableDefaults: true });
  assert.ok(Object.values(next.changes).every(count => count === 0));
  assert.equal(drafts.richApply(draft.id, reopened.editorId, result.revision, next.doc).revision, result.revision);
});

test('manual and AI edits share revisions and a save replaces an externally changed body', async () => {
  const store = new Store(':memory:'); let item: RemoteItem = { id: 'T-1', title: 'x', description: '<p style="color:red">initial</p>', updated: 'v1' }; let writes = 0, overwriteSeen = false;
  const drafts = new Drafts(store, { read: async () => ({ ...item }), save: async (d, _scope, overwrite) => { writes++; overwriteSeen = overwrite === true; item = { ...item, description: d.html, updated: 'v2' }; return item; } });
  const draft = await drafts.open(target, 'T-1'); const node = draft.nodes.find(n => n.text === 'initial')!;
  const edited = drafts.replace(draft.id, 0, node.id, 'initial', 'next');
  assert.equal(edited.html, '<p style="color:red">next</p>');
  assert.throws(() => drafts.replace(draft.id, 0, node.id, 'initial', 'stale'), /STALE_DRAFT/);
  await assert.rejects(drafts.save(draft.id, 1, 'unknown'), /NATIVE_EDITOR_UNKNOWN/);
  item.updated = 'other'; item.description = '<p style="color:red">edited elsewhere</p>'; const saved = await drafts.save(draft.id, 1, 'clean'); assert.equal(saved.state, 'clean'); assert.equal(writes, 1); assert.equal(overwriteSeen, true); assert.equal(item.description, '<p style="color:red">next</p>'); store.close();
});
test('lost write response stays editable and the next save overwrites', async () => {
  const store = new Store(':memory:'); let attempts = 0, description = '<p>x</p>';
  const drafts = new Drafts(store, { read: async () => ({ id: 'T-1', title: 'x', description, updated: '1' }), save: async draft => {
    attempts++;
    if (attempts === 1) throw Error('NETWORK_LOST');
    description = draft.html; return { id: 'T-1', title: 'x', description, updated: '2' };
  } });
  const d = await drafts.open(target, 'T-1'); drafts.replace(d.id, 0, d.nodes.find(n => n.text === 'x')!.id, 'x', 'y');
  await assert.rejects(drafts.save(d.id, 1, 'clean'), /NETWORK_LOST/);
  assert.equal(drafts.read(d.id).state, 'uncertain');
  const uncertain = drafts.read(d.id);
  const edited = drafts.replace(d.id, uncertain.revision, uncertain.nodes.find(n => n.text === 'y')!.id, 'y', 'z');
  assert.equal(edited.html, '<p>z</p>');
  const saved = await drafts.save(d.id, edited.revision, 'clean');
  assert.equal(saved.state, 'clean'); assert.equal(saved.html, '<p>z</p>'); assert.equal(attempts, 2); store.close();
});

test('an unchanged server response is reported as not applied and keeps the edit',async()=>{
  const store=new Store(':memory:');const item={id:'T-1',title:'x',description:'<p>same</p>',updated:'1'},drafts=new Drafts(store,{read:async()=>({...item}),save:async()=>({...item})});
  const d=await drafts.open(target,'T-1'),rich=drafts.richRead(d.id);rich.document.content![0]!.attrs!.textAlign='center';const edited=drafts.richApply(d.id,rich.editorId,0,rich.document);
  await assert.rejects(drafts.save(d.id,edited.revision,'clean'),/SAVE_NOT_APPLIED/);const kept=drafts.read(d.id);assert.equal(kept.state,'dirty');assert.match(kept.html,/text-align:center/);assert.equal(store.list<any>('save')[0].phase,'not-applied');store.close();
});
test('reconciliation recognizes a committed write without issuing a second write', async () => {
  const store = new Store(':memory:'); let item = { id: 'T-1', title: 'x', description: '<p>x</p>', updated: '1' }; let writes = 0;
  const drafts = new Drafts(store, { read: async () => ({ ...item }), save: async draft => { writes++; item = { ...item, description: draft.html, updated: '2' }; throw Error('RESPONSE_LOST'); } });
  const d = await drafts.open(target, 'T-1'); drafts.replace(d.id, 0, d.nodes.find(n => n.text === 'x')!.id, 'x', 'y');
  await assert.rejects(drafts.save(d.id, 1, 'clean'), /RESPONSE_LOST/);
  assert.equal(drafts.read(d.id).state, 'uncertain');
  assert.equal((await drafts.reconcile(d.id)).state, 'clean'); assert.equal(writes, 1);
  assert.equal(store.list<any>('save')[0].phase, 'uncertain'); assert.equal(store.list<any>('reconciliation')[0].state, 'clean'); store.close();
});
test('uploaded image references become the saved baseline only after independent exact readback',async()=>{
  const store=new Store(':memory:');let item:RemoteItem={id:'T-1',title:'x',description:'<p>base</p>',updated:'1'};
  const drafts=new Drafts(store,{read:async()=>({...item}),save:async draft=>{const html=draft.html.replace(/polarion-asset:[0-9a-f-]+/g,'workitemimg:fixture.png');item={...item,description:html,updated:'2'};return{...item,submittedHtml:html};}});
  const d=await drafts.open(target,'T-1'),rich=drafts.richRead(d.id);rich.document.content![0]!.content!.push({type:'image',attrs:{assetId:crypto.randomUUID(),src:'',alt:'fixture',align:'center',width:320}});
  const edited=drafts.richApply(d.id,rich.editorId,d.revision,rich.document);const saved=await drafts.save(d.id,edited.revision,'clean');assert.equal(saved.state,'clean');assert(saved.html.includes('workitemimg:fixture.png'));assert.equal(saved.html,saved.baseHtml);assert.equal(saved.revision,edited.revision+1);store.close();
});
test('work item preview prefers the local draft and caches remote reads for hover',async()=>{
 const store=new Store(':memory:');let reads=0;
 const drafts=new Drafts(store,{read:async(_target,id)=>{reads++;return{id,title:'远程标题',description:'<h2>标题</h2><p>远程正文</p>',updated:'1'};},save:async()=>{throw Error('unused');}});
 const localId=crypto.randomUUID();
 store.put('draft',localId,{id:localId,target,workItemId:'LOCAL-1',title:'本地标题',baseHtml:'',html:'<h2>本地</h2><p>本地正文</p>',baseUpdated:'',revision:1,state:'dirty'});
 const local=await drafts.peek(target,'LOCAL-1');
 assert.equal(local.source,'draft');assert.equal(local.title,'本地标题');assert.match(local.text,/本地正文/);assert.equal(local.state,'dirty');assert.equal(reads,0);
 const remote=await drafts.peek(target,'REMOTE-1');
 assert.equal(remote.source,'remote');assert.equal(remote.title,'远程标题');assert.match(remote.text,/远程正文/);assert.equal(reads,1);
 await drafts.peek(target,'REMOTE-1');assert.equal(reads,1,'hover repeats reuse the cached preview');
 store.close();
});
test('preview text prefers prose and never dumps table cells as a field-name list',()=>{
 const structured='<ol><li><span>功能描述</span></li><li><span>输入输出接口</span><table><tbody><tr><th>信号名称</th><th>信号描述</th></tr><tr><td>ECC_OperMod</td><td>0x2</td></tr></tbody></table></li></ol>';
 const text=previewText(structured);
 assert.match(text,/功能描述/);
 assert.match(text,/输入输出接口/);
 assert.doesNotMatch(text,/信号名称/,'table cells are excluded from the summary');
 assert.match(text,/含 1 个表格/);
 const prose='<p>系统上电后进入待机状态，等待控制侧下发使能信号。</p><p>接收到使能信号后按既定顺序自检并上报状态。</p>'.repeat(1);
 assert.equal(previewText(prose).includes('表格'),false);
 assert.match(previewText(prose),/系统上电后进入待机状态/);
 const tablesOnly='<table><tbody><tr><td>a</td></tr></tbody></table>';
 assert.match(previewText(tablesOnly),/正文以表格/);
});
test('work item full read returns renderable nodes for local drafts and remote items',async()=>{
 const store=new Store(':memory:');
 const drafts=new Drafts(store,{read:async(_target,id)=>({id,title:'远程标题',description:'<h2>标题</h2><p>远程正文</p>',updated:'9'}),save:async()=>{throw Error('unused');}});
 const localId=crypto.randomUUID();
 store.put('draft',localId,{id:localId,target,workItemId:'LOCAL-1',title:'本地标题',baseHtml:'',html:'<h2>本地</h2><p>本地正文</p>',baseUpdated:'',revision:2,state:'dirty'});
 const local=await drafts.readOnly(target,'LOCAL-1');
 assert.equal(local.source,'draft');assert.equal(local.revision,2);assert.ok(local.nodes.some(node=>node.text?.includes('本地正文')));
 const remote=await drafts.readOnly(target,'REMOTE-1');
 assert.equal(remote.source,'remote');assert.equal(remote.title,'远程标题');assert.ok(remote.nodes.some(node=>node.text?.includes('远程正文')));
 store.close();
});
test('reference reads isolate origin and project, fall back only on document mismatch and never open an editable draft', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  for (const foreign of [{ ...target, projectId: 'other' }, { ...target, origin: 'https://other.invalid' }]) {
    const id = crypto.randomUUID();
    store.put('draft', id, { id, target: foreign, workItemId: 'R-1', title: 'private', baseHtml: '', html: '<p>private local</p>', baseUpdated: 'v1', revision: 1, state: 'dirty' });
  }
  let error = 'WORK_ITEM_DOCUMENT_MISMATCH', reads = 0, peeks = 0, writes = 0;
  const drafts = new Drafts(store, {
    read: async (scope, id) => { assert.deepEqual(scope, target); assert.equal(id, 'R-1'); reads++; throw Error(error); },
    peek: async (scope, id) => { assert.deepEqual(scope, target); peeks++; return { workItemId: id, title: 'reference', description: '<p>project body</p>' }; },
    save: async () => { writes++; throw Error('unexpected write'); },
  });
  const view = await drafts.readOnly(target, 'R-1');
  assert.equal(view.html, '<p>project body</p>'); assert.equal(view.readOnlyReference, true);
  const hover = await drafts.peek(target, 'R-1');
  assert.equal(hover.text, 'project body'); assert.equal(hover.readOnlyReference, true);
  assert.equal(reads, 2); assert.equal(peeks, 2);
  assert.throws(() => drafts.richRead(view.id), /NOT_FOUND/);
  await assert.rejects(drafts.save(view.id, view.revision, 'clean'), /NOT_FOUND/);
  await assert.rejects(drafts.open(target, 'R-1'), /WORK_ITEM_DOCUMENT_MISMATCH/);
  error = 'PERMISSION_DENIED';
  await assert.rejects(drafts.readOnly(target, 'R-1'), /PERMISSION_DENIED/);
  assert.equal(peeks, 2); assert.equal(store.drafts(target).length, 0); assert.equal(writes, 0);
});

test('the Worker rejects SOAP tombstones before document checks and preserves empty items and lookup faults', async t => {
  const directory = await mkdtemp(path.resolve(import.meta.dirname, '../../.worker-read-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = path.join(directory, 'worker.mjs');
  const fixtureFetch = async (_url: string, { body }: { body: string }) => {
    const soap = (xml: string) => new Response('<Envelope><Body>' + xml + '</Body></Envelope>');
    if (body.includes('<svc:logInWithToken>')) return soap('<sessionID>fixture-session</sessionID>');
    if (body.includes('<svc:getModuleByLocation>')) return soap('<getModuleByLocationReturn uri="module-1"><id>Fixture</id></getModuleByLocationReturn>');
    const id = /<svc:workitemId>([^<]+)<\/svc:workitemId>/.exec(body)?.[1];
    if (!id) throw Error('unexpected SOAP operation');
    const uri = 'subterra:data-service:objects:/default/test01${WorkItem}' + id;
    if (id === 'R-0') return soap(`<getWorkItemByIdReturn uri="${uri}" unresolvable="true"/>`);
    if (id === 'R-3') return new Response('', { status: 403 });
    if (id === 'R-4') throw Error('connection reset (fixture-read-token)');
    return soap(`<getWorkItemByIdReturn uri="${uri}" unresolvable="false"><id>${id === 'R-2' ? 'unexpected' : id}</id><moduleURI>${id === 'R-5' ? 'module-2' : 'module-1'}</moduleURI></getWorkItemByIdReturn>`);
  };
  await build({
    entryPoints: [path.join(import.meta.dirname, 'polarion-worker.ts')], outfile: worker,
    bundle: true, platform: 'node', format: 'esm', packages: 'external',
    banner: { js: `globalThis.fetch = ${fixtureFetch.toString()};` },
  });
  const requests = ['read', 'peek'].flatMap(method =>
    ['R-0', 'R-1', 'R-2', 'R-3', 'R-4', 'R-5'].map(workItemId => ({ method, workItemId, target, id: method + '/' + workItemId })));
  const output = execFileSync(process.execPath, [worker], {
    input: requests.map(request => JSON.stringify(request)).join('\n') + '\n', encoding: 'utf8', timeout: 15000,
    env: { SystemRoot: process.env.SystemRoot, POLARION_AUTH_MODE: 'access_token', POLARION_ACCESS_TOKEN: 'fixture-read-token' },
  });
  assert.doesNotMatch(output, /fixture-read-token/);
  const replies = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.length, requests.length);
  const errors: Record<string, string | undefined> = {
    'R-0': 'WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE',
    'R-2': 'WORK_ITEM_ID_MISMATCH',
    'R-3': 'PERMISSION_DENIED',
    'R-4': 'POLARION_OPERATION_FAILED: connection reset ([REDACTED])',
  };
  for (const [index, { method, workItemId, id }] of requests.entries()) {
    const reply = replies[index]; assert.equal(reply.id, id);
    const error = workItemId === 'R-5' && method === 'read' ? 'WORK_ITEM_DOCUMENT_MISMATCH' : errors[workItemId];
    if (error) assert.deepEqual(reply, { id, ok: false, error });
    else {
      assert.equal(reply.ok, true); assert.equal(reply.value[method === 'read' ? 'id' : 'workItemId'], workItemId);
      assert.equal(reply.value.uri, 'subterra:data-service:objects:/default/test01${WorkItem}' + workItemId);
      assert.equal(reply.value.unresolvable, false); assert.equal(reply.value.description ?? '', '');
    }
  }
});

test('Worker replies must identify the resolved project item even when its description is empty', async t => {
  const remote = new Polarion(), workItemId = 'R-731';
  const uri = 'subterra:data-service:objects:/default/test01${WorkItem}' + workItemId;
  let reply: object = {};
  t.mock.method(remote, 'call', async () => reply);
  for (const method of ['read', 'peek'] as const) {
    const identity = method === 'read' ? 'id' : 'workItemId';
    const load = () => remote[method](target, workItemId);
    reply = { uri, unresolvable: true, attachments: [], linked_work_items: [] };
    await assert.rejects(load, { message: 'WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE' });
    reply = { uri, unresolvable: false };
    await assert.rejects(load, { message: 'WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE' });
    reply = { [identity]: workItemId, uri, unresolvable: true };
    await assert.rejects(load, { message: 'WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE' });
    reply = { [identity]: workItemId, title: '', description: '' }; // old Worker substituted the requested ID
    await assert.rejects(load, { message: 'WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE' });
    reply = { [identity]: 'R-732', uri };
    await assert.rejects(load, { message: 'WORK_ITEM_ID_MISMATCH' });
    reply = { [identity]: workItemId, uri: uri.replace('/test01', '/other') };
    await assert.rejects(load, { message: 'WORK_ITEM_ID_MISMATCH' });
    reply = { [identity]: workItemId, uri, unresolvable: false, title: 'empty item', description: '' };
    assert.equal((await load()).description, '');
  }
});

test('full and hover previews validate IDs from both remote lookups before accepting an empty body', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let scoped = true, returnedId = 'R-2', projectReads = 0;
  const drafts = new Drafts(store, {
    read: async () => { if (!scoped) throw Error('WORK_ITEM_DOCUMENT_MISMATCH'); return { id: returnedId, title: '', description: '' }; },
    peek: async () => { projectReads++; return { workItemId: returnedId, title: '', description: '' }; },
    save: async () => { throw Error('unexpected write'); },
  });
  for (const useScope of [true, false]) {
    scoped = useScope;
    for (const [id, error] of [['R-2', 'WORK_ITEM_ID_MISMATCH'], ['', 'WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE']]) {
      returnedId = id;
      await assert.rejects(drafts.readOnly(target, 'R-1'), { message: error });
      await assert.rejects(drafts.peek(target, 'R-1'), { message: error });
    }
    returnedId = 'R-1';
    const view = await drafts.readOnly(target, 'R-1');
    assert.equal(view.html, ''); assert.equal(view.readOnlyReference, !useScope);
    const hover = await drafts.peek(target, 'R-1');
    assert.equal(hover.text, ''); assert.equal(hover.readOnlyReference, !useScope);
  }
  assert.equal(projectReads, 6);
  assert.equal(store.drafts(target).length, 0);
});

test('failed reads clear earlier hover results, expose access and transport errors and preserve pending drafts', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let error = '', reads = 0, projectReads = 0;
  const drafts = new Drafts(store, {
    read: async (_target, id) => { reads++; if (error) throw Error(error); return { id, title: 'item', description: '<p>old</p>', updated: '1' }; },
    peek: async () => { projectReads++; throw Error('unexpected project read'); },
    save: async () => { throw Error('unexpected write'); },
  });
  const opened = await drafts.open(target, 'R-1');
  for (const reason of ['WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE', 'PERMISSION_DENIED', 'CONNECTION_RESET']) {
    error = ''; assert.equal((await drafts.peek(target, 'R-1')).text, 'old');
    error = reason;
    await assert.rejects(drafts.readOnly(target, 'R-1'), { message: reason });
    await assert.rejects(drafts.peek(target, 'R-1'), { message: reason });
    await assert.rejects(drafts.open(target, 'R-1'), { message: reason });
    assert.equal(drafts.read(opened.id).revision, opened.revision);
  }
  const edited = drafts.replace(opened.id, opened.revision, opened.nodes.find(n => n.text === 'old')!.id, 'old', 'unsaved');
  const priorReads = reads;
  assert.equal((await drafts.readOnly(target, 'R-1')).html, edited.html);
  assert.equal((await drafts.peek(target, 'R-1')).text, 'unsaved');
  assert.equal((await drafts.open(target, 'R-1')).html, edited.html);
  assert.equal(reads, priorReads); assert.equal(projectReads, 0);
});

test('local references prefer the active document and preserve the owning target of dirty and clean sibling drafts', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const sibling = { ...target, document: 'Other/Fixture' };
  const local = { id: 'a', workItemId: 'R-2', target: sibling, title: 'sibling', baseHtml: '<p>base</p>', html: '<p>pending</p>', baseUpdated: 'v1', state: 'dirty', revision: 3 };
  store.put('draft', local.id, local);
  let reads = 0;
  const drafts = new Drafts(store, {
    read: async (scope, id) => { assert.deepEqual(scope, sibling); reads++; return { id, title: 'new', description: '<p>latest sibling</p>', updated: 'v2' }; },
    save: async () => { throw Error('unexpected remote write'); },
  });
  const dirty = await drafts.readOnly(target, 'R-2');
  assert.deepEqual(dirty.target, sibling); assert.equal(dirty.html, local.html); assert.equal(dirty.readOnlyReference, true);
  assert.throws(() => drafts.richRead(dirty.id), /NOT_FOUND/);
  await assert.rejects(drafts.save(dirty.id, dirty.revision, 'clean'), /NOT_FOUND/);
  const dirtyHover = await drafts.peek(target, 'R-2');
  assert.deepEqual(dirtyHover.target, sibling); assert.equal(dirtyHover.text, 'pending'); assert.equal(reads, 0);
  const clean = { ...local, state: 'clean', html: local.baseHtml, revision: 4 };
  store.put('draft', local.id, clean);
  const fresh = await drafts.readOnly(target, 'R-2'), freshHover = await drafts.peek(target, 'R-2');
  assert.deepEqual(fresh.target, sibling); assert.equal(fresh.html, '<p>latest sibling</p>'); assert.equal(fresh.readOnlyReference, true);
  assert.deepEqual(freshHover.target, sibling); assert.equal(freshHover.text, 'latest sibling'); assert.equal(freshHover.readOnlyReference, true);
  assert.deepEqual(store.get('draft', local.id), clean); // viewing from another document cannot overwrite its draft
  const active = { ...local, id: 'z', target, html: '<p>current document</p>' }; store.put('draft', active.id, active);
  const current = await drafts.readOnly(target, 'R-2'), currentHover = await drafts.peek(target, 'R-2');
  assert.equal(current.id, active.id); assert.equal(current.html, active.html); assert.ok(!current.readOnlyReference);
  assert.deepEqual(currentHover.target, target); assert.equal(currentHover.text, 'current document'); assert.ok(!currentHover.readOnlyReference);
});

test('an in-flight clean preview cannot replace a newer pending edit', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const local = { id: 'test', target, workItemId: 'T-1', title: 'item', baseHtml: '<p>base</p>', html: '<p>base</p>', baseUpdated: 'v1', revision: 0, state: 'clean' };
  store.put('draft', local.id, local);
  let finishRead!: (item: RemoteItem) => void;
  const response = new Promise<RemoteItem>(resolve => { finishRead = resolve; });
  const drafts = new Drafts(store, { read: () => response, save: async () => { throw Error('unexpected save'); } });
  const pending = drafts.readOnly(target, 'T-1');
  const changed = drafts.replace(local.id, 0, drafts.read(local.id).nodes.find(node => node.text === 'base')!.id, 'base', 'local edit');
  finishRead({ id: 'T-1', title: 'remote', description: '<p>new remote</p>', updated: 'v2' });
  const view = await pending;
  assert.equal(view.html, changed.html); assert.equal(view.state, 'dirty'); assert.equal(drafts.read(local.id).revision, changed.revision);
});

test('registered variants use their main item and link role in both readers before a draft exists', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  store.put('variant', 'record', { target, workItemId: 'V-1', mainWorkItemId: 'T-1', linkRole: 'parent' });
  const drafts = new Drafts(store, {
    read: async (requested, id, scope) => { assert.deepEqual(requested, target); assert.deepEqual(scope, { mainWorkItemId: 'T-1', role: 'parent' }); return { id, title: 'variant', description: '<p>linked</p>' }; },
    peek: async () => { throw Error('unexpected project fallback'); }, save: async () => { throw Error('unexpected write'); },
  });
  assert.ok(!(await drafts.readOnly(target, 'V-1')).readOnlyReference);
  assert.ok(!(await drafts.peek(target, 'V-1')).readOnlyReference);
  assert.equal((await drafts.open(target, 'V-1')).variantOf, 'T-1');
});

test('work item search merges local drafts with remote hits and dedupes by id',async()=>{
 const store=new Store(':memory:');
 const queries:string[]=[];
 const remote:(target:unknown,query:string,limit:number)=>Promise<{workItemId:string;title:string}[]>=async(_target,query)=>{queries.push(query);return query.includes('TEST\\-7')?[{workItemId:'TEST-729',title:'重复项'},{workItemId:'TEST-777',title:'远端结果'}]:[];};
 const drafts=new Drafts(store,{read:async()=>{throw Error('unused');},save:async()=>{throw Error('unused');},search:remote as never});
 const localId=crypto.randomUUID();
 store.put('draft',localId,{id:localId,target,workItemId:'TEST-729',title:'本地标题',baseHtml:'',html:'',baseUpdated:'',revision:0,state:'clean',savedAt:5});
 const hits=await drafts.searchItems(target,'test-7');
 assert.deepEqual(hits,[{workItemId:'TEST-729',title:'本地标题',source:'draft'},{workItemId:'TEST-777',title:'远端结果',source:'remote'}]);
 assert.ok(queries[0]!.includes('TEST\\-7'),'lucene special characters are escaped');
 const byTitle=await drafts.searchItems(target,'本地');
 assert.deepEqual(byTitle.map(h=>h.workItemId),['TEST-729']);
 const none=await drafts.searchItems(target,'不存在且远端失败');
 assert.deepEqual(none,[]);
 store.close();
});
test('a clean local draft follows native-page saves: readers and reopen show the new remote content', async () => {
  const store = new Store(':memory:');
  let item: RemoteItem = { id: 'T-1', title: 'x', description: '<p>old</p>', updated: 'v1' };
  const drafts = new Drafts(store, { read: async () => ({ ...item }), save: async () => { throw Error('not called'); } });
  const opened = await drafts.open(target, 'T-1');          // 本地留下 clean 草稿
  assert.equal(opened.html, '<p>old</p>');
  item = { ...item, description: '<p>native-page new</p>', updated: 'v2' };   // 模拟用户在原生页面直接保存
  const ro = await drafts.readOnly(target, 'T-1');          // 阅读预览必须显示新内容
  assert.equal(ro.html, '<p>native-page new</p>');
  assert.equal(ro.baseUpdated, 'v2');
  const peek = await drafts.peek(target, 'T-1');            // 悬停小卡同样取远端
  assert.match(peek.text, /native-page new/);
  assert.equal(peek.source, 'remote');
  const again = await drafts.open(target, 'T-1');           // 再次打开编辑工作台也不再是旧内容
  assert.equal(again.html, '<p>native-page new</p>');
  assert.equal(again.revision, opened.revision + 1);        // 旧编辑会话按修订失效
  store.close();
});
test('dirty drafts still win locally so unsaved edits are never hidden by remote updates', async () => {
  const store = new Store(':memory:');
  let item: RemoteItem = { id: 'T-1', title: 'x', description: '<p>old</p>', updated: 'v1' };
  const drafts = new Drafts(store, { read: async () => ({ ...item }), save: async () => { throw Error('not called'); } });
  const draft = await drafts.open(target, 'T-1');
  const edited = drafts.replace(draft.id, 0, draft.nodes.find(n => n.text === 'old')!.id, 'old', 'local edit');
  item = { ...item, description: '<p>remote new</p>', updated: 'v2' };
  const ro = await drafts.readOnly(target, 'T-1');
  assert.equal(ro.html, edited.html);                       // 未保存修改优先本地
  assert.equal(ro.source, 'draft');
  const peek = await drafts.peek(target, 'T-1');
  assert.match(peek.text, /local edit/);
  assert.equal(peek.source, 'draft');
  store.close();
});
