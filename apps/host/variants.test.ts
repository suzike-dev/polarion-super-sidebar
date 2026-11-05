import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './store.ts';
import {Drafts, type Remote, type RemoteItem} from './polarion.ts';
import {Assets} from './assets.ts';
import {Variants} from './variants.ts';
import {Boards} from './boards.ts';
import {authorizeWorkItemScope,chooseLinkRole,labelFromTitle,variantTitle,workItemIdFromUri} from './variant-access.ts';
import type {Draft,Target,VariantScope} from '../../packages/protocol/index.ts';
const target:Target={origin:'https://polarion.pufafen.com',projectId:'test01',document:'Requirements/Fixture'};
const boardSource=JSON.stringify({type:'excalidraw',version:2,elements:[{id:'a',type:'rectangle',x:0,y:0,width:100,height:60}],files:{}});
const boardPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6s8AAAAASUVORK5CYII=','base64');

class FakeRemote implements Remote {
  items=new Map<string,RemoteItem>();
  scopes:{workItemId:string;scope?:VariantScope}[]=[];
  links=new Map<string,string>();
  metadata=new Map<string,Record<string,unknown>>();
  rolesList=[{id:'parent'},{id:'relates_to'}];
  images=new Map<string,{id:string;name:string}>(); 
  async read(_target:Target,workItemId:string,scope?:VariantScope){this.scopes.push({workItemId,scope});const item=this.items.get(workItemId);if(!item)throw Error('NOT_FOUND');return{...item};}
  async save(draft:{workItemId:string;baseUpdated:string;baseHtml:string;html:string},scope?:VariantScope){
    this.scopes.push({workItemId:draft.workItemId,scope});
    const item=this.items.get(draft.workItemId);
    if(!item||item.updated!==draft.baseUpdated||(item.description??'')!==draft.baseHtml)throw Error('REMOTE_CONFLICT');
    const updated={...item,description:draft.html,updated:'u-'+crypto.randomUUID()};
    this.items.set(draft.workItemId,updated);
    return {...updated,submittedHtml:draft.html};
  }
  async create(_target:Target,title:string,type:string){
    const id='V-'+this.items.size;
    const item:RemoteItem={id,title,type,description:'',updated:'u-'+crypto.randomUUID()};
    this.items.set(id,item);return{...item};
  }  async link(_target:Target,sourceWorkItemId:string,targetWorkItemId:string,role:string){this.links.set(sourceWorkItemId+'|'+targetWorkItemId,role);return{verified:true};}
  async unlink(_target:Target,sourceWorkItemId:string,targetWorkItemId:string){this.links.delete(sourceWorkItemId+'|'+targetWorkItemId);return{verified:true};}
  async backLinks(_target:Target,mainWorkItemId:string){return[...this.links].filter(([key])=>key.endsWith('|'+mainWorkItemId)).map(([key,role])=>({workItemId:key.split('|')[0]!,role}));}
  async roles(){return this.rolesList;}
  async rename(_target:Target,workItemId:string,title:string){const item=this.items.get(workItemId);if(!item)throw Error('NOT_FOUND');const updated={...item,title,updated:'u-'+crypto.randomUUID()};this.items.set(workItemId,updated);return updated;}
  async metadataRead(_target:Target,workItemId:string,_scope?:VariantScope,name='sidebar-variant.json'){return this.metadata.get(workItemId+':'+name)??null;}
  async metadataWrite(_target:Target,workItemId:string,details:Record<string,unknown>,_scope?:VariantScope,name='sidebar-variant.json'){
    this.metadata.set(workItemId+':'+name,details);
    const item=this.items.get(workItemId);
    if(!item)return{verified:true};
    const updated='m-'+crypto.randomUUID();this.items.set(workItemId,{...item,updated});return{verified:true,updated};
  }
  async image(_target:Target,workItemId:string,src:string,scope?:VariantScope){this.scopes.push({workItemId,scope});const image=this.images.get(src);if(!image)throw Error('INVALID_ASSET');return image as never;}
}

function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-variants-')),store=new Store(':memory:'),remote=new FakeRemote(),drafts=new Drafts(store,remote),assets=new Assets(store,directory),variants=new Variants(store,drafts,assets);
  return{directory,store,remote,drafts,assets,variants};
}
function cleanup(directory:string){for(const file of fs.readdirSync(directory))fs.rmSync(path.join(directory,file),{recursive:true,force:true});fs.rmSync(directory,{recursive:true,force:true});}

test('variant access requires the main item to stay inside the target document and the link role to match',()=>{
  assert.equal(authorizeWorkItemScope({itemUri:'wi-v',itemModuleUri:'module-1',documentUri:'module-1',links:[],}),'document');
  assert.equal(authorizeWorkItemScope({itemUri:'wi-v',documentUri:'module-1',mainModuleUri:'module-1',links:[{work_item_uri:'wi-v',role:'parent'}],scope:{mainWorkItemId:'S-1',role:'parent'}}),'variant');
  assert.throws(()=>authorizeWorkItemScope({itemUri:'wi-v',documentUri:'module-1',mainModuleUri:'module-2',links:[{work_item_uri:'wi-v',role:'parent'}],scope:{mainWorkItemId:'S-1',role:'parent'}}),/WORK_ITEM_DOCUMENT_MISMATCH/);
  assert.throws(()=>authorizeWorkItemScope({itemUri:'wi-v',documentUri:'module-1',mainModuleUri:'module-1',links:[{work_item_uri:'wi-v',role:'relates_to'}],scope:{mainWorkItemId:'S-1',role:'parent'}}),/VARIANT_LINK_REQUIRED/);
  assert.throws(()=>authorizeWorkItemScope({itemUri:'wi-v',documentUri:'module-1',mainModuleUri:'module-1',links:[]}),/WORK_ITEM_DOCUMENT_MISMATCH/);
  assert.equal(chooseLinkRole([{id:'relates_to'},{id:'parent'}]),'parent');
  assert.equal(chooseLinkRole([{id:'hidden_parent',hidden:true},{id:'relates_to'}]),'relates_to');
  assert.throws(()=>chooseLinkRole([]),/VARIANT_LINK_ROLE_REQUIRED/);
  assert.equal(variantTitle('需求 A','客户甲'),'需求 A · 变体：客户甲');
  assert.equal(labelFromTitle('需求 A · 变体：客户甲','spe'),'客户甲');
  assert.equal(workItemIdFromUri('subterra:data-service:objects:/default/test01${WorkItem}SPE-12'),'SPE-12');
});

test('creating a variant writes a Polarion work item, links it, and seeds a copy without touching the main item',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const result=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:true,role:''});
    assert.equal(result.variant.linkState,'linked');
    assert.equal(result.variant.label,'客户甲');
    assert.equal(remote.links.get(result.variant.workItemId+'|S-1'),'parent');
    assert.equal(remote.items.get('S-1')!.description,'<p>主内容</p>','主工作项保持原样');
    assert.equal(result.draft!.html,'<p>主内容</p>','变体草稿复制主草稿内容');
    assert.equal(result.draft!.variantOf,'S-1');
    assert.equal(result.draft!.state,'dirty');
    assert.ok(remote.scopes.some(entry=>entry.workItemId===result.variant.workItemId&&entry.scope?.mainWorkItemId==='S-1'&&entry.scope.role==='parent'),'变体读取携带作用域');
    assert.equal(store.settings().variantLinkRole,'parent','首次创建固化链接角色');
  }finally{cleanup(directory);store.close();}
});

test('variant saves use the variant scope while the main item remains untouched',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    const draft=store.require<Draft>('draft',created.draft!.id);
    store.put('draft',draft.id,{...draft,html:'<p>变体内容</p>',revision:draft.revision+1,state:'dirty'});
    const saved=await drafts.save(draft.id,draft.revision+1,'clean');
    assert.equal(saved.html,'<p>变体内容</p>');
    assert.equal(remote.items.get(created.variant.workItemId)!.description,'<p>变体内容</p>');
    assert.equal(remote.items.get('S-1')!.description,'<p>主内容</p>','保存变体不会改动主工作项');
    assert.ok(remote.scopes.some(entry=>entry.workItemId===created.variant.workItemId&&entry.scope?.role==='parent'),'保存时读取变体带作用域');
  }finally{cleanup(directory);store.close();}
});

test('applying a variant overwrites the main work item, records a snapshot, and undo restores it',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    remote.items.set(created.variant.workItemId,{id:created.variant.workItemId,title:created.variant.title,type:'requirement',description:'<p>变体内容</p>',updated:'v2'});
    await drafts.open(target,'S-1');
    const applied=await variants.apply(created.variant.id);
    assert.equal(remote.items.get('S-1')!.description,'<p>变体内容</p>');
    assert.equal(applied.apply.previousHtml,'<p>主内容</p>');
    assert.equal(applied.draft.state,'clean');
    assert.equal(applied.draft.baseHtml,'<p>变体内容</p>');
    const undone=await variants.undo(applied.apply.id);
    assert.equal(remote.items.get('S-1')!.description,'<p>主内容</p>');
    assert.equal(undone.html,'<p>主内容</p>');
  }finally{cleanup(directory);store.close();}
});

test('apply refuses dirty drafts and a variant that still has unsaved local edits',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:true,role:'parent'});
    await assert.rejects(()=>variants.apply(created.variant.id),/VARIANT_DRAFT_DIRTY/,'复制后的变体草稿尚未保存时拒绝接入');
    const variantDraft=store.require<Draft>('draft',created.draft!.id);
    await drafts.save(variantDraft.id,created.draft!.revision,'clean');
    const mainDraft=await drafts.open(target,'S-1');
    const rawMain=store.require<Draft>('draft',mainDraft.id);
    store.put('draft',rawMain.id,{...rawMain,html:'<p>本地未保存</p>',revision:rawMain.revision+1,state:'dirty'});
    await assert.rejects(()=>variants.apply(created.variant.id),/MAIN_DRAFT_DIRTY/);
  }finally{cleanup(directory);store.close();}
});

test('variants are rediscovered from Polarion back-links on another machine and the active one is inferred by content',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    store.put('settings','global',{...store.settings(),variantLinkRole:'parent'});
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>相同内容</p>',updated:'u1'});
    remote.items.set('V-9',{id:'V-9',title:'需求 A · 变体：客户乙',type:'requirement',description:'<p>相同内容</p>',updated:'v9'});
    remote.links.set('V-9|S-1','parent');
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.variants.length,1);
    assert.equal(listed.variants[0]!.workItemId,'V-9');
    assert.equal(listed.variants[0]!.label,'客户乙');
    assert.equal(listed.activeVariantId,listed.variants[0]!.id,'内容一致时判定为当前启用');
  }finally{cleanup(directory);store.close();}
});

test('renaming a variant updates the Polarion title so the label travels with the work item',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    const renamed=await variants.rename(created.variant.id,'客户丙');
    assert.equal(renamed.label,'客户丙');
    assert.equal(remote.items.get(created.variant.workItemId)!.title,'需求 A · 变体：客户丙');
  }finally{cleanup(directory);store.close();}
});

test('a pending link blocks opening the variant and can be retried',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const originalLink=remote.link.bind(remote);
    remote.link=async()=>{throw Error('LINK_DOWN');};
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    assert.equal(created.variant.linkState,'pending');
    assert.equal(created.draft,null);
    remote.link=originalLink;
    const linked=await variants.link(created.variant.id);
    assert.equal(linked.linkState,'linked');
    const draft=await variants.open(created.variant.id);
    assert.equal(draft.workItemId,created.variant.workItemId);
  }finally{cleanup(directory);store.close();}
});

test('the main work item appears as the default variant until its body is captured',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.variants.length,0);
    assert.ok(listed.defaultVariant);
    assert.equal(listed.defaultVariant!.workItemId,'S-1');
    assert.equal(listed.defaultVariant!.label,'默认');
    assert.equal(listed.activeVariantId,undefined,'默认行由主工作项正文承担');
  }finally{cleanup(directory);store.close();}
});

test('the first apply captures the main body as a default variant before overwriting',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    remote.items.set(created.variant.workItemId,{id:created.variant.workItemId,title:created.variant.title,type:'requirement',description:'<p>变体内容</p>',updated:'v2'});
    const variantDraft=store.drafts(target).find(d=>d.workItemId===created.variant.workItemId)!;
    store.put('draft',variantDraft.id,{...variantDraft,html:'<p>变体内容</p>',baseHtml:'<p>变体内容</p>',baseUpdated:'v2',state:'clean'});
    await drafts.open(target,'S-1');
    const applied=await variants.apply(created.variant.id);
    assert.ok(applied.defaultVariant);
    assert.equal(remote.items.get(applied.defaultVariant!.workItemId)!.description,'<p>主内容</p>','主工作项原正文被保存为默认变体');
    assert.equal(remote.items.get('S-1')!.description,'<p>变体内容</p>');
    assert.equal(store.list<any>('variant').filter(record=>record.kind==='default').length,1);
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.variants.length,2,'默认 + 客户甲');
    assert.equal(listed.defaultVariant,null);
    const active=listed.variants.find(variant=>variant.id===listed.activeVariantId);
    assert.equal(active?.workItemId,created.variant.workItemId);
    // 再次接入不会重复捕获默认变体。
    await variants.undo(applied.apply.id);
    const second=await variants.apply(created.variant.id);
    assert.equal(store.list<any>('variant').filter(record=>record.kind==='default').length,1);
    assert.equal(second.defaultVariant!.workItemId,applied.defaultVariant!.workItemId);
  }finally{cleanup(directory);store.close();}
});

test('variant details round-trip through the Polarion metadata attachment and are visible in the list',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    const saved=await variants.saveDetails(target,created.variant.id,{label:'客户甲',customer:'客户甲',project:'项目 A',vehicle:'车型 X',configuration:'高配',notes:'只改报警阈值'});
    assert.equal(saved.customer,'客户甲');
    assert.equal(remote.metadata.get(created.variant.workItemId+':sidebar-variant.json')!.notes,'只改报警阈值');
    assert.equal(remote.metadata.get(created.variant.workItemId+':sidebar-variant.json')!.kind,'custom');
    const loaded=await variants.details(target,created.variant.id);
    assert.equal(loaded.vehicle,'车型 X');
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.variants.find(variant=>variant.id===created.variant.id)!.details!.configuration,'高配');
    // 主工作项默认行的详细配置写在主工作项自己的附件中。
    await variants.saveDetails(target,'default:S-1',{label:'默认',customer:'',project:'',vehicle:'',configuration:'基线',notes:'默认配置'});
    assert.equal(remote.metadata.get('S-1:sidebar-variant.json')!.configuration,'基线');
    const after=await variants.list(target,'S-1');
    assert.equal(after.defaultVariant!.details!.notes,'默认配置');
  }finally{cleanup(directory);store.close();}
});

test('removing a draft also clears checkpoints and attachment receipts that have no id field',()=>{
  const{directory,store,drafts}=fixture();
  try{
    const draft:Draft={id:crypto.randomUUID(),target,workItemId:'S-1',title:'receipt fixture',baseHtml:'<p></p>',html:'<p></p>',baseUpdated:'u1',revision:0,state:'clean'};
    store.put('draft',draft.id,draft);
    store.put('draft-checkpoint',crypto.randomUUID(),{draftId:draft.id,revision:0,html:'<p></p>',at:Date.now(),source:'rich-editor'});
    store.put('attachment-receipt',draft.id+':asset-1',{draftId:draft.id,localId:'asset-1',revision:0,at:Date.now()});
    assert.deepEqual(drafts.remove([draft.id]),[draft.id]);
    assert.equal(store.get('draft',draft.id),undefined);
    assert.equal(store.list('draft-checkpoint').length,0);
    assert.equal(store.list('attachment-receipt').length,0);
  }finally{cleanup(directory);store.close();}
});

test('copying a main body with a board rebinds a new board snapshot to the variant',async()=>{
  const{directory,store,remote,assets,variants}=fixture();
  try{
    const boards=new Boards(store,assets);
    const sourceAsset=boards.putBytes(target,'source.excalidraw.json','application/json',Buffer.from(boardSource));
    const previewAsset=boards.putBytes(target,'preview.png','image/png',boardPng);
    const board=boards.create(target,'S-1','控制流程',sourceAsset.id,previewAsset.id);
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const mainDraft:Draft={id:crypto.randomUUID(),target,workItemId:'S-1',title:'需求 A',baseHtml:'<p>主内容</p>',html:'<p><img src="polarion-asset:'+board.previewId+'"></p>',baseUpdated:'u1',revision:1,state:'clean'};
    store.put('draft',mainDraft.id,mainDraft);
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:true,role:'parent'});
    const html=created.draft!.html,match=/polarion-asset:([0-9a-f-]{36})/.exec(html);
    assert.ok(match);
    assert.notEqual(match![1],board.previewId);
    const copy=boards.byPreview(match![1]!)!;
    assert.equal(copy.manifest.workItemId,created.variant.workItemId);
    assert.equal(copy.manifest.objectId,board.manifest.objectId);
    assert.equal(copy.manifest.parentSnapshotId,board.manifest.snapshotId);
  }finally{cleanup(directory);store.close();}
});

test('applying a board-containing variant rebinds the board snapshot to the main work item',async()=>{
  const{directory,store,remote,drafts,assets,variants}=fixture();
  try{
    const boards=new Boards(store,assets);
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    const sourceAsset=boards.putBytes(target,'source.excalidraw.json','application/json',Buffer.from(boardSource));
    const previewAsset=boards.putBytes(target,'preview.png','image/png',boardPng);
    const board=boards.create(target,created.variant.workItemId,'控制流程',sourceAsset.id,previewAsset.id);
    const html='<p><img src="polarion-asset:'+board.previewId+'"></p>';
    remote.items.set(created.variant.workItemId,{id:created.variant.workItemId,title:created.variant.title,type:'requirement',description:html,updated:'v2'});
    const variantDraft=store.drafts(target).find(d=>d.workItemId===created.variant.workItemId)!;
    store.put('draft',variantDraft.id,{...variantDraft,html,baseHtml:html,baseUpdated:'v2',state:'clean'});
    await drafts.open(target,'S-1');
    const applied=await variants.apply(created.variant.id);
    const saved=remote.items.get('S-1')!.description??'',match=/polarion-asset:([0-9a-f-]{36})/.exec(saved);
    assert.ok(match,'主工作项正文包含复制后的画板引用');
    const copy=boards.byPreview(match![1]!)!;
    assert.equal(copy.manifest.workItemId,'S-1');
    assert.equal(copy.manifest.objectId,board.manifest.objectId);
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.activeVariantId,created.variant.id,'接入记录覆盖图片/画板附件 ID 差异');
    await variants.undo(applied.apply.id);
    const restored=await variants.list(target,'S-1');
    assert.equal(restored.activeVariantId,applied.defaultVariant!.id,'撤销后恢复默认变体');
  }finally{cleanup(directory);store.close();}
});

test('first apply captures a board-containing main body into the default variant',async()=>{
  const{directory,store,remote,drafts,assets,variants}=fixture();
  try{
    const boards=new Boards(store,assets);
    const sourceAsset=boards.putBytes(target,'source.excalidraw.json','application/json',Buffer.from(boardSource));
    const previewAsset=boards.putBytes(target,'preview.png','image/png',boardPng);
    const board=boards.create(target,'S-1','控制流程',sourceAsset.id,previewAsset.id);
    const mainHtml='<p><img src="polarion-asset:'+board.previewId+'"></p>';
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:mainHtml,updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    remote.items.set(created.variant.workItemId,{id:created.variant.workItemId,title:created.variant.title,type:'requirement',description:'<p>变体内容</p>',updated:'v2'});
    const variantDraft=store.drafts(target).find(d=>d.workItemId===created.variant.workItemId)!;
    store.put('draft',variantDraft.id,{...variantDraft,html:'<p>变体内容</p>',baseHtml:'<p>变体内容</p>',baseUpdated:'v2',state:'clean'});
    await drafts.open(target,'S-1');
    const applied=await variants.apply(created.variant.id);
    assert.ok(applied.defaultVariant);
    assert.equal(remote.metadata.get(applied.defaultVariant!.workItemId+':sidebar-variant.json')!.kind,'default');
    const captured=remote.items.get(applied.defaultVariant!.workItemId)!.description??'',match=/polarion-asset:([0-9a-f-]{36})/.exec(captured);
    assert.ok(match,'默认变体正文包含复制后的画板引用');
    const copy=boards.byPreview(match![1]!)!;
    assert.equal(copy.manifest.workItemId,applied.defaultVariant!.workItemId);
    assert.equal(copy.manifest.objectId,board.manifest.objectId);
  }finally{cleanup(directory);store.close();}
});

test('a fresh local store rediscovers variants, detailed config, and the Polarion active marker',async()=>{
  const{directory,store,remote,drafts,assets,variants}=fixture();
  const freshDir=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-variants-fresh-'));
  let freshStore:Store|undefined;
  try{
    const boards=new Boards(store,assets);
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    const sourceAsset=boards.putBytes(target,'source.excalidraw.json','application/json',Buffer.from(boardSource));
    const previewAsset=boards.putBytes(target,'preview.png','image/png',boardPng);
    const board=boards.create(target,created.variant.workItemId,'控制流程',sourceAsset.id,previewAsset.id);
    const html='<p><img src="polarion-asset:'+board.previewId+'"></p>';
    remote.items.set(created.variant.workItemId,{id:created.variant.workItemId,title:created.variant.title,type:'requirement',description:html,updated:'v2'});
    const variantDraft=store.drafts(target).find(d=>d.workItemId===created.variant.workItemId)!;
    store.put('draft',variantDraft.id,{...variantDraft,html,baseHtml:html,baseUpdated:'v2',state:'clean'});
    await variants.saveDetails(target,created.variant.id,{label:'客户甲',customer:'跨机客户',project:'项目 A',vehicle:'车型 X',configuration:'高配',notes:'跨机可见'});
    await drafts.open(target,'S-1');
    const applied=await variants.apply(created.variant.id);
    freshStore=new Store(':memory:');
    freshStore.put('settings','global',{...freshStore.settings(),variantLinkRole:'parent'});
    const fresh=new Variants(freshStore,new Drafts(freshStore,remote),new Assets(freshStore,freshDir));
    const listed=await fresh.list(target,'S-1');
    const row=listed.variants.find(variant=>variant.workItemId===created.variant.workItemId)!;
    assert.ok(row);
    assert.equal(row.details!.customer,'跨机客户');
    assert.equal(row.details!.notes,'跨机可见');
    assert.equal(row.kind,'custom');
    const defaultRow=listed.variants.find(variant=>variant.kind==='default');
    assert.ok(defaultRow,'默认变体的 kind 跨机器可识别');
    assert.equal(defaultRow!.workItemId,applied.defaultVariant!.workItemId);
    assert.equal(listed.activeVariantId,row.id,'Polarion 当前接入标记跨机器可见');
  }finally{freshStore?.close();cleanup(freshDir);cleanup(directory);store.close();}
});

test('copying a main body with a work-item attachment image rehosts it to the variant',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const assetId='22222222-2222-4222-8222-222222222222';
    remote.images.set('attachment:photo.png',{id:assetId,name:'photo.png'});
    const mainDraft:Draft={id:crypto.randomUUID(),target,workItemId:'S-1',title:'需求 A',baseHtml:'<p>主内容</p>',html:'<p><img src="attachment:photo.png"></p>',baseUpdated:'u1',revision:1,state:'clean'};
    store.put('draft',mainDraft.id,mainDraft);
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:true,role:'parent'});
    assert.match(created.draft!.html,new RegExp('polarion-asset:'+assetId));
    assert.equal(created.draft!.html.includes('attachment:photo.png'),false);
  }finally{cleanup(directory);store.close();}
});

test('concurrent list refreshes upsert a single record per variant work item',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    store.put('settings','global',{...store.settings(),variantLinkRole:'parent'});
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    remote.items.set('V-9',{id:'V-9',title:'需求 A · 变体：客户乙',type:'requirement',description:'<p>乙</p>',updated:'v9'});
    remote.links.set('V-9|S-1','parent');
    const originalRead=remote.read.bind(remote);
    let waiting=0,release=()=>{};
    const gate=new Promise<void>(resolve=>{release=resolve;});
    // 三个刷新同时停在变体读取上，模拟面板并发同步。
    remote.read=async(t,workItemId,scope)=>{
      if(workItemId==='V-9'){waiting++;if(waiting>=2)release();await gate;}
      return originalRead(t,workItemId,scope);
    };
    const listed=await Promise.all([variants.list(target,'S-1'),variants.list(target,'S-1'),variants.list(target,'S-1')]);
    assert.equal(store.list<any>('variant').filter(record=>record.workItemId==='V-9').length,1);
    for(const result of listed)assert.equal(result.variants.filter(variant=>variant.workItemId==='V-9').length,1,'每个刷新结果只出现一次');
    // 同一工作项即使通过另一个主工作项被再次发现，也复用同一条本地记录。
    remote.items.set('S-2',{id:'S-2',title:'需求 B',type:'requirement',description:'<p>另一个主项</p>',updated:'u2'});
    remote.links.set('V-9|S-2','parent');
    await Promise.all([variants.list(target,'S-1'),variants.list(target,'S-2')]);
    assert.equal(store.list<any>('variant').filter(record=>record.workItemId==='V-9').length,1,'target+workItemId 唯一');
  }finally{cleanup(directory);store.close();}
});

test('a failed default capture rolls the default draft back so apply can be retried',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    remote.items.set(created.variant.workItemId,{id:created.variant.workItemId,title:created.variant.title,type:'requirement',description:'<p>变体内容</p>',updated:'v2'});
    await drafts.open(target,'S-1');
    const originalSave=remote.save.bind(remote);
    let failures=1;
    remote.save=async(draft,scope)=>{
      if(draft.workItemId!=='S-1'&&failures>0){failures--;throw Error('SAVE_DOWN');}
      return originalSave(draft,scope);
    };
    await assert.rejects(()=>variants.apply(created.variant.id),/SAVE_DOWN/);
    const defaultRecord=store.list<any>('variant').find(record=>record.kind==='default');
    assert.ok(defaultRecord,'默认变体记录已创建，失败后可复用');
    const defaultDraft=store.drafts(target).find(draft=>draft.workItemId===defaultRecord!.workItemId)!;
    assert.equal(defaultDraft.state,'clean','捕获失败后默认草稿不能永久停在 dirty');
    assert.equal(remote.items.get(defaultRecord!.workItemId)!.description,'','远端默认变体仍为空');
    assert.equal(remote.items.get('S-1')!.description,'<p>主内容</p>','主工作项未被改动');
    const applied=await variants.apply(created.variant.id);
    assert.equal(applied.defaultVariant!.workItemId,defaultRecord!.workItemId);
    assert.equal(remote.items.get(defaultRecord!.workItemId)!.description,'<p>主内容</p>','重试后默认正文捕获成功');
    assert.equal(remote.items.get('S-1')!.description,'<p>变体内容</p>');
  }finally{cleanup(directory);store.close();}
});

test('saving details merges the remote label instead of overwriting a rename from another machine',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    // 模拟另一台机器把变体改名；本机记录仍是旧名称。
    remote.items.set(created.variant.workItemId,{...remote.items.get(created.variant.workItemId)!,title:'需求 A · 变体：客户乙',updated:'u-remote'});
    const loaded=await variants.details(target,created.variant.id);
    assert.equal(loaded.label,'客户乙','读取详细配置时以远端标题为准');
    // 旧界面仍提交本地旧 label，但只改了备注：不能把远端标题改回旧名称。
    const saved=await variants.saveDetails(target,created.variant.id,{...loaded,label:'客户甲',notes:'旧界面保存'});
    assert.equal(saved.label,'客户乙');
    assert.equal(remote.items.get(created.variant.workItemId)!.title,'需求 A · 变体：客户乙','远端重命名未被旧 label 覆盖');
    const metadata=remote.metadata.get(created.variant.workItemId+':sidebar-variant.json')!;
    assert.equal(metadata.label,'客户乙');
    assert.equal(metadata.notes,'旧界面保存');
    const local=store.get<any>('variant',created.variant.id)!;
    assert.equal(local.label,'客户乙','本地缓存同步远端名称');
    assert.equal(local.title,'需求 A · 变体：客户乙');
    // 用户明确修改名称时仍然同步到 Polarion 标题。
    const renamed=await variants.saveDetails(target,created.variant.id,{...loaded,label:'客户丙'});
    assert.equal(renamed.label,'客户丙');
    assert.equal(remote.items.get(created.variant.workItemId)!.title,'需求 A · 变体：客户丙');
  }finally{cleanup(directory);store.close();}
});

test('list exposes only usable link roles and creating with an invalid configured role self-corrects',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    store.put('settings','global',{...store.settings(),variantLinkRole:'missing_role'});
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    remote.items.set('V-9',{id:'V-9',title:'需求 A · 变体：客户乙',type:'requirement',description:'<p>乙</p>',updated:'v9'});
    remote.links.set('V-9|S-1','parent');
    await assert.rejects(()=>variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'missing_role'}),/VARIANT_LINK_ROLE_INVALID/,'显式指定不存在的角色仍然报错');
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.role,'','不可用的配置角色不返回给 UI');
    assert.equal(listed.variants.length,1,'配置角色失效时仍能发现已有变体');
    assert.equal(listed.variants[0]!.workItemId,'V-9');
    const created=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:''});
    assert.equal(created.variant.linkRole,'parent','配置角色失效时自动选择项目可用角色');
    assert.equal(store.settings().variantLinkRole,'parent','失效配置被修正');
    assert.equal(remote.links.get(created.variant.workItemId+'|S-1'),'parent');
  }finally{cleanup(directory);store.close();}
});

test('list keeps the configured role when the backend cannot list roles',async()=>{
  const{directory,store,remote,variants}=fixture();
  try{
    store.put('settings','global',{...store.settings(),variantLinkRole:'relates_to'});
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    remote.roles=async()=>{throw Error('ROLES_DOWN');};
    assert.equal((await variants.list(target,'S-1')).role,'relates_to','角色清单读取失败时降级为配置值');
    Object.defineProperty(remote,'roles',{value:undefined,configurable:true});
    assert.equal((await variants.list(target,'S-1')).role,'relates_to','后端没有 roles 能力时同样降级');
  }finally{cleanup(directory);store.close();}
});

test('undo restores the previously active custom variant',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const first=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    remote.items.set(first.variant.workItemId,{id:first.variant.workItemId,title:first.variant.title,type:'requirement',description:'<p>甲内容</p>',updated:'a2'});
    await drafts.open(target,'S-1');
    await variants.apply(first.variant.id);
    const second=await variants.create({target,mainWorkItemId:'S-1',label:'客户乙',title:'',copy:false,role:'parent'});
    remote.items.set(second.variant.workItemId,{id:second.variant.workItemId,title:second.variant.title,type:'requirement',description:'<p>乙内容</p>',updated:'b2'});
    const applied=await variants.apply(second.variant.id);
    assert.equal(applied.apply.previousVariantWorkItemId,first.variant.workItemId,'接入前记录当前变体');
    await variants.undo(applied.apply.id);
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.activeVariantId,first.variant.id,'撤销后回到接入前的变体');
    assert.equal(listed.lastApply,null,'撤销记录不再显示');
    assert.equal(listed.diverged,false);
    assert.equal(remote.items.get('S-1')!.description,'<p>甲内容</p>');
  }finally{cleanup(directory);store.close();}
});

test('undo after a direct main edit does not claim the default variant is active',async()=>{
  const{directory,store,remote,drafts,variants}=fixture();
  try{
    remote.items.set('S-1',{id:'S-1',title:'需求 A',type:'requirement',description:'<p>主内容</p>',updated:'u1'});
    const first=await variants.create({target,mainWorkItemId:'S-1',label:'客户甲',title:'',copy:false,role:'parent'});
    remote.items.set(first.variant.workItemId,{id:first.variant.workItemId,title:first.variant.title,type:'requirement',description:'<p>甲内容</p>',updated:'a2'});
    await drafts.open(target,'S-1');
    await variants.apply(first.variant.id);
    // 直接在主工作项上编辑并保存，正文不再属于任何已保存变体。
    const mainDraft=store.require<Draft>('draft',(await drafts.open(target,'S-1')).id);
    store.put('draft',mainDraft.id,{...mainDraft,html:'<p>直接编辑</p>',revision:mainDraft.revision+1,state:'dirty'});
    await drafts.save(mainDraft.id,mainDraft.revision+1,'clean');
    const second=await variants.create({target,mainWorkItemId:'S-1',label:'客户乙',title:'',copy:false,role:'parent'});
    remote.items.set(second.variant.workItemId,{id:second.variant.workItemId,title:second.variant.title,type:'requirement',description:'<p>乙内容</p>',updated:'b2'});
    const applied=await variants.apply(second.variant.id);
    assert.equal(applied.apply.previousVariantWorkItemId,undefined,'接入前正文不属于任何变体');
    await variants.undo(applied.apply.id);
    const listed=await variants.list(target,'S-1');
    assert.equal(listed.activeVariantId,undefined,'撤销后不应伪造默认变体为当前接入');
    assert.equal(listed.diverged,true,'直接编辑的正文仍显示为分歧状态');
    assert.equal(remote.items.get('S-1')!.description,'<p>直接编辑</p>');
  }finally{cleanup(directory);store.close();}
});
