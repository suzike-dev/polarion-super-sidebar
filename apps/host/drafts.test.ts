import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { Drafts, type RemoteItem } from './polarion.ts';
const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/Fixture' };
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
test('image container write can reconcile a lost response without a second remote write',async()=>{
 const store=new Store(':memory:');let item={id:'T-1',title:'x',description:'<h2>base</h2><p style="background-color:#fef3c7"><img src="workitemimg:existing.png"></p>',updated:'1'},writes=0;
 const drafts=new Drafts(store,{read:async()=>({...item}),save:async draft=>{writes++;item={...item,description:draft.html,updated:'2'};throw Error('RESPONSE_LOST');}});
 const draft=await drafts.open(target,'T-1'),edited=drafts.replace(draft.id,0,draft.nodes.find(n=>n.text==='base')!.id,'base','next');await assert.rejects(drafts.save(draft.id,edited.revision,'clean'),/RESPONSE_LOST/);assert.equal(drafts.read(draft.id).state,'uncertain');
 const recovered=await drafts.reconcile(draft.id);assert.equal(recovered.state,'clean');assert.equal(recovered.html,item.description);assert.equal(recovered.baseHtml,item.description);assert.equal(recovered.revision,edited.revision+1);assert.equal(writes,1);assert.match(recovered.html,/^<div data-polarion-sidebar-document/);store.close();
});
test('serialization-only readback changes adopt the authoritative HTML but lost headings remain uncertain',async()=>{
 const store=new Store(':memory:');let item={id:'T-1',title:'x',description:'<p style="color:red;text-align:center">base</p>',updated:'1'};
 const drafts=new Drafts(store,{read:async()=>({...item}),save:async draft=>{item={...item,description:draft.html.replace('color:red;text-align:center','color: red; text-align: center;'),updated:'2'};return item;}});
 const d=await drafts.open(target,'T-1'),edited=drafts.replace(d.id,0,d.nodes.find(n=>n.text==='base')!.id,'base','next');const saved=await drafts.save(d.id,edited.revision,'clean');assert.equal(saved.state,'clean');assert.equal(saved.html,item.description);assert.equal(saved.baseHtml,saved.html);store.close();
 const other=new Store(':memory:');let remote={id:'T-2',title:'x',description:'<h2>base</h2>',updated:'1'};const service=new Drafts(other,{read:async()=>({...remote}),save:async draft=>{remote={...remote,description:draft.html.replace(/<\/?h2>/g,''),updated:'2'};return remote;}});const a=await service.open(target,'T-2'),b=service.replace(a.id,0,a.nodes.find(n=>n.text==='base')!.id,'base','next');await assert.rejects(service.save(a.id,b.revision,'clean'),/READBACK_MISMATCH/);assert.equal(service.read(a.id).state,'uncertain');other.close();
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
test('manual and AI edits share revisions; conflict blocks remote writes', async () => {
  const store = new Store(':memory:'); let item: RemoteItem = { id: 'T-1', title: 'x', description: '<p style="color:red">initial</p>', updated: 'v1' }; let writes = 0;
  const drafts = new Drafts(store, { read: async () => ({ ...item }), save: async d => { writes++; item = { ...item, description: d.html, updated: 'v2' }; return item; } });
  const draft = await drafts.open(target, 'T-1'); const node = draft.nodes.find(n => n.text === 'initial')!;
  const edited = drafts.replace(draft.id, 0, node.id, 'initial', 'next');
  assert.equal(edited.html, '<p style="color:red">next</p>');
  assert.throws(() => drafts.replace(draft.id, 0, node.id, 'initial', 'stale'), /STALE_DRAFT/);
  await assert.rejects(drafts.save(draft.id, 1, 'unknown'), /NATIVE_EDITOR_UNKNOWN/);
  item.updated = 'other'; await assert.rejects(drafts.save(draft.id, 1, 'clean'), /REMOTE_CONFLICT/); assert.equal(writes, 0);
  item.updated = 'v1'; const saved = await drafts.save(draft.id, 1, 'clean'); assert.equal(saved.state, 'clean'); assert.equal(writes, 1); store.close();
});
test('lost write response is uncertain and cannot be retried blindly', async () => {
  const store = new Store(':memory:'); const drafts = new Drafts(store, { read: async () => ({ id: 'T-1', title: 'x', description: '<p>x</p>', updated: '1' }), save: async () => { throw Error('NETWORK_LOST'); } });
  const d = await drafts.open(target, 'T-1'); drafts.replace(d.id, 0, d.nodes.find(n => n.text === 'x')!.id, 'x', 'y');
  await assert.rejects(drafts.save(d.id, 1, 'clean'), /NETWORK_LOST/);
  assert.equal(drafts.read(d.id).state, 'uncertain');
  const uncertain=drafts.read(d.id);assert.throws(()=>drafts.replace(d.id,uncertain.revision,uncertain.nodes.find(n=>n.text==='y')!.id,'y','z'),/READBACK_REQUIRED/);
  await assert.rejects(drafts.save(d.id, 1, 'clean'), /READBACK_REQUIRED/); store.close();
});

test('verified unchanged server response is not an unknown write and retains the local draft',async()=>{
  const store=new Store(':memory:');const item={id:'T-1',title:'x',description:'<p>same</p>',updated:'1'},drafts=new Drafts(store,{read:async()=>({...item}),save:async()=>({...item})});
  const d=await drafts.open(target,'T-1'),rich=drafts.richRead(d.id);rich.document.content![0]!.attrs!.textAlign='center';const edited=drafts.richApply(d.id,rich.editorId,0,rich.document);
  await assert.rejects(drafts.save(d.id,edited.revision,'clean'),/SAVE_NOT_APPLIED/);assert.equal(drafts.read(d.id).state,'dirty');assert.match(drafts.read(d.id).html,/text-align:center/);assert.equal(store.list<any>('save')[0].phase,'not-applied');store.close();
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
