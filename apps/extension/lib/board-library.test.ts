import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBoardLibraryItems,BOARD_LIBRARY_COUNT,BOARD_LIBRARY_CATEGORIES,BOARD_LIBRARY_SHELL_EXEMPT} from './board-library-items.ts';
import {BoardLibraryStorage,BOARD_LIBRARY_STORAGE_KEY,supplementBoardLibrary} from './board-library-storage.ts';
import {elementBounds,elementsBounds} from '../../../packages/core/board-templates.ts';
import type {BoardElement} from '../../../packages/core/board-changes';
import type {LibraryItem,LibraryItems} from '@excalidraw/excalidraw/types';

const originals=createBoardLibraryItems();
const userItem=(id:string):LibraryItem=>({...structuredClone(originals[0]!),id,name:'用户自建 · '+id,status:'unpublished'});
function fixture(initial?:unknown){
  const values:Record<string,unknown>=initial===undefined?{}:{[BOARD_LIBRARY_STORAGE_KEY]:structuredClone(initial)};
  let writes=0,fail=false,tail:Promise<unknown>=Promise.resolve();
  const storage={get:async(key:string)=>({[key]:structuredClone(values[key])}),set:async(next:Record<string,unknown>)=>{if(fail)throw Error('storage unavailable');writes++;Object.assign(values,structuredClone(next));}};
  const lock=<T>(task:()=>Promise<T>):Promise<T>=>{const next=tail.catch(()=>{}).then(task);tail=next;return next;};
  return {client:()=>new BoardLibraryStorage(storage,lock),items:()=>((values[BOARD_LIBRARY_STORAGE_KEY] as any)?.libraryItems??[]) as LibraryItems,state:()=>values[BOARD_LIBRARY_STORAGE_KEY],writes:()=>writes,fail:(value:boolean)=>{fail=value;}};
}

test('70 original vector items have stable identities, readable text and closed native bindings',()=>{
  assert.equal(originals.length,BOARD_LIBRARY_COUNT);
  assert.deepEqual(originals,createBoardLibraryItems());
  assert.equal(new Set(originals.map(item=>item.id)).size,BOARD_LIBRARY_COUNT);
  const categories=new Set<string>();
  for(const item of originals){
    assert.ok(item.name?.includes(' · '));
    const ids=new Map(item.elements.map(element=>[element.id,element]));
    assert.equal(ids.size,item.elements.length);
    for(const e of item.elements){
      assert.ok(['rectangle','ellipse','diamond','line','arrow','text'].includes(e.type),item.name+': '+e.type);
      assert.equal(e.locked,false);assert.equal(e.roughness,0);assert.equal(e.link,null);
      assert.ok([e.x,e.y,e.width,e.height].every(Number.isFinite));
      categories.add(e.customData!.boardLibrary.category);
      if(e.type==='text'){
        assert.ok(e.fontSize>=16);assert.equal(e.fontFamily,2);
        assert.ok(e.text.length>0);
        if(e.containerId){const parent=ids.get(e.containerId)!;assert.ok(parent);assert.ok(parent.boundElements?.some(bound=>bound.type==='text'&&bound.id===e.id));}
      }
      if(e.type==='arrow'){
        assert.equal(('elbowed' in e && e.elbowed),true);
        for(const binding of [e.startBinding,e.endBinding]){assert.ok(binding);const parent=ids.get(binding.elementId)!;assert.ok(parent);assert.ok(parent.boundElements?.some(bound=>bound.type==='arrow'&&bound.id===e.id));}
        for(let i=1;i<e.points.length;i++)assert.ok(e.points[i][0]===e.points[i-1][0]||e.points[i][1]===e.points[i-1][1],item.name+' has diagonal connector');
      }
      for(const bound of e.boundElements??[])assert.ok(ids.has(bound.id));
    }
  }
  assert.deepEqual([...categories],BOARD_LIBRARY_CATEGORIES);
  assert.ok(Buffer.byteLength(JSON.stringify(originals))<400_000,'bounded native library payload');
  // Every single-asset item carries a full-extent white bind shell (Excalidraw never
  // binds arrows to line art); lane frames and whole-diagram templates are exempt.
  const exempt=new Set(BOARD_LIBRARY_SHELL_EXEMPT.map(key=>'pss-builtin-v1-'+key));
  for(const item of originals){
    const shell=item.elements[0]!;
    if(exempt.has(item.id)){assert.ok(!item.elements.some(e=>e.customData?.role==='bind-shell'),item.id+' must stay frame-only');continue;}
    assert.equal(shell.type,'rectangle',item.id+' lacks bind shell');
    assert.equal(shell.backgroundColor,'#ffffff');assert.equal(shell.strokeColor,'transparent');assert.equal(shell.strokeWidth,0);
    assert.equal(shell.customData!.role,'bind-shell');
    assert.ok(item.elements.slice(1).every(e=>{const box=elementBounds(e);return box.left>=shell.x-1e-6&&box.top>=shell.y-1e-6&&box.right<=shell.x+shell.width+1e-6&&box.bottom<=shell.y+shell.height+1e-6;}),item.id+' shell does not cover the artwork');
    assert.ok(shell.groupIds.length>0,'shell moves with the artwork group');
  }
});

test('bind shells use the true extent of line art, not the nominal arrow box',()=>{
  const item=(key:string)=>originals.find(entry=>entry.id==='pss-builtin-v1-'+key)!;
  const retry=item('retry'),retryShell=retry.elements[0]!,retryBounds=elementsBounds(retry.elements.slice(1));
  assert.equal(retryBounds.right,352,'the loop arrow ends at the step box');
  assert.equal(retryShell.x+retryShell.width,Math.ceil(retryBounds.right)+4);
  assert.ok(retryShell.x+retryShell.width<512,'the loop arrow no longer inflates the shell by its origin + nominal width');
  const prepare=item('prepare'),prepareShell=prepare.elements[0]!,prepareBounds=elementsBounds(prepare.elements.slice(1));
  assert.equal(prepareBounds.left,0,'the chevron reaches left of its first point');
  assert.equal(prepareShell.x,Math.floor(prepareBounds.left)-4);
  assert.ok(prepareShell.x+prepareShell.width>=prepareBounds.right);
});

test('first load installs defaults once; reopening never duplicates them',async()=>{
  const f=fixture();assert.equal((await f.client().load(originals)).length,70);
  assert.equal((await f.client().load(originals)).length,70);assert.equal(f.writes(),1);
});

test('existing personal material survives initialization, native changes and reopen',async()=>{
  const personal=userItem('my-pump');
  const f=fixture({schema:1,libraryItems:[personal],installedBuiltinIds:[]}),client=f.client();
  const initial=await client.load(originals);assert.deepEqual(initial[0],personal);
  const added=userItem('my-control');await client.save([added,...initial]);
  const reopened=await f.client().load(originals);assert.equal(reopened.length,72);
  assert.deepEqual(reopened.find(item=>item.id===personal.id),personal);assert.deepEqual(reopened.find(item=>item.id===added.id),added);
});

test('deleted default stays removed; supplement restores only missing originals',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals);
  await client.save(initial.slice(1));const reopened=await f.client().load(originals);assert.equal(reopened.length,69);
  const customized={...structuredClone(reopened[0]!),name:'我的结束标记'};
  const supplemented=supplementBoardLibrary([customized,...reopened.slice(1)],originals);
  assert.equal(supplemented.length,70);assert.deepEqual(supplemented[0],customized);
  assert.equal(new Set(supplemented.map(item=>item.id)).size,70);
});

test('an added release installs only new identities and preserves edits and tombstones',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals);
  const edited={...structuredClone(initial[1]!),name:'定制结束'};
  await client.save([edited,...initial.slice(2)]);
  const nextRelease=[...originals,{...structuredClone(originals[0]!),id:'pss-builtin-v2-new'}];
  const reopened=await f.client().load(nextRelease);assert.equal(reopened.length,70);
  assert.ok(!reopened.some(item=>item.id===originals[0]!.id));assert.equal(reopened.find(item=>item.id===edited.id)?.name,'定制结束');
});

test('two board instances save their own deltas without erasing each other',async()=>{
  const f=fixture(),a=f.client(),b=f.client();const [aItems,bItems]=await Promise.all([a.load(originals),b.load(originals)]);
  await Promise.all([a.save([userItem('A'),...aItems]),b.save([userItem('B'),...bItems])]);
  assert.equal(f.items().length,72);assert.ok(f.items().some(item=>item.id==='A'));assert.ok(f.items().some(item=>item.id==='B'));
  // B has never seen A; deleting one local default must retain A as well.
  await b.save([userItem('B'),...bItems.slice(1)]);assert.equal(f.items().length,71);assert.ok(f.items().some(item=>item.id==='A'));
});

test('a stale edit cannot resurrect a default explicitly deleted by another tab',async()=>{
  const f=fixture(),a=f.client(),b=f.client();const [aItems,bItems]=await Promise.all([a.load(originals),b.load(originals)]);
  const target=bItems[1]!,edited={...structuredClone(target),name:'B 的旧编辑'};
  await a.save(aItems.filter(item=>item.id!==target.id));assert.equal(f.items().length,69);
  await b.save([userItem('B-new'),...bItems.map(item=>item.id===target.id?edited:item)]);
  assert.ok(!f.items().some(item=>item.id===target.id),'the explicit deletion wins over the stale copy');
  assert.ok(f.items().some(item=>item.id==='B-new'),'unrelated local additions still merge');
  assert.equal(f.items().length,70);
  await b.save([userItem('B-new'),...bItems.map(item=>item.id===target.id?{...edited,name:'B 再次编辑'}:item)]);
  assert.ok(!f.items().some(item=>item.id===target.id),'repeated stale edits stay deleted');
});

test('ordered rapid saves keep additions and intentional deletion',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals);
  await Promise.all([client.save([userItem('draft'),...initial]),client.save([userItem('final'),...initial])]);
  assert.ok(!f.items().some(item=>item.id==='draft'));assert.ok(f.items().some(item=>item.id==='final'));assert.equal(f.items().length,71);
});

test('a failed save is visible and the same snapshot can be retried without data loss',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals),next=[userItem('retry'),...initial];
  f.fail(true);await assert.rejects(client.save(next),/storage unavailable/);await assert.rejects(client.flush());
  f.fail(false);await client.save(next);assert.equal(f.items().length,71);assert.ok(f.items().some(item=>item.id==='retry'));
});

test('unknown storage schema is preserved; empty callbacks after failed load cannot erase it',async()=>{
  const original={schema:2,libraryItems:[userItem('protected')],installedBuiltinIds:[]};const f=fixture(original),client=f.client();
  await assert.rejects(client.load(originals),/格式不兼容/);await client.save([]);assert.deepEqual(f.state(),original);assert.equal(f.writes(),0);
});

test('legacy installs gain the missing bind shell without losing edits or resurrecting deletions',async()=>{
  const legacy=originals.map(item=>({...structuredClone(item),elements:item.elements.filter(element=>element.customData?.role!=='bind-shell')}));
  const edited={...structuredClone(legacy[1]!),name:'我的结束标记'};
  const f=fixture({schema:1,libraryItems:[edited,...legacy.slice(2)],installedBuiltinIds:originals.map(item=>item.id)});
  const loaded=await f.client().load(originals);
  assert.equal(loaded.length,BOARD_LIBRARY_COUNT-1,'a deleted builtin stays deleted');
  assert.equal(loaded.find(item=>item.id===edited.id)?.name,'我的结束标记','user edits survive the shell upgrade');
  const exempt=new Set(BOARD_LIBRARY_SHELL_EXEMPT.map(key=>'pss-builtin-v1-'+key));
  for(const item of loaded){
    const shells=item.elements.filter(element=>element.customData?.role==='bind-shell');
    assert.equal(shells.length,exempt.has(item.id)?0:1,item.id+' shell presence');
    assert.equal(new Set(item.elements.map(element=>element.id)).size,item.elements.length,item.id+' duplicate ids');
  }
  assert.equal(f.writes(),1);
  // A second load is a no-op: shells already present.
  await f.client().load(originals);
  assert.equal(f.writes(),1);
});

test('legacy shell upgrade follows edited geometry and reuses the user group id',async()=>{
  const source=structuredClone(originals.find(item=>item.id==='pss-builtin-v1-retry')!);
  const edited={...source,elements:source.elements.filter(element=>element.customData?.role!=='bind-shell') as unknown as BoardElement[]};
  for(const element of edited.elements){
    element.x=element.x*1.5+401;element.y=element.y*1.5+250;element.width*=1.5;element.height*=1.5;
    if(Array.isArray(element.points))element.points=element.points.map((point:number[])=>[point[0]!*1.5,point[1]!*1.5]);
    element.groupIds=['user-retry-group'];
  }
  const f=fixture({schema:1,libraryItems:[edited],installedBuiltinIds:originals.map(item=>item.id)});
  const loaded=await f.client().load(originals);
  const item=loaded.find(candidate=>candidate.id===edited.id)!;
  const artwork=item.elements.filter(element=>element.customData?.role!=='bind-shell');
  assert.deepEqual(artwork,edited.elements,'moves, scales and reordering survive verbatim');
  const shell=item.elements.find(element=>element.customData?.role==='bind-shell')!;
  const bounds=elementsBounds(artwork);
  assert.equal(shell.x,Math.floor(bounds.left)-4);
  assert.equal(shell.y,Math.floor(bounds.top)-4);
  assert.equal(shell.width,Math.ceil(bounds.right)-Math.floor(bounds.left)+8);
  assert.equal(shell.height,Math.ceil(bounds.bottom)-Math.floor(bounds.top)+8);
  assert.deepEqual(shell.groupIds,['user-retry-group'],'shell joins the existing user group');
  assert.equal(item.elements.filter(element=>element.customData?.role==='bind-shell').length,1);
  assert.equal(new Set(item.elements.map(element=>element.id)).size,item.elements.length);
});

test('an existing stale shell is rebuilt in place from the edited artwork',async()=>{
  const source=structuredClone(originals.find(item=>item.id==='pss-builtin-v1-retry')!);
  const elements=source.elements as unknown as BoardElement[],shell=elements[0]!;
  for(const element of elements.slice(1)){
    element.x+=420;element.y+=180;element.width*=1.5;element.height*=1.5;
    if(Array.isArray(element.points))element.points=element.points.map((point:number[])=>[point[0]!*1.5,point[1]!*1.5]);
    element.groupIds=['user-stale-group'];
  }
  shell.groupIds=['stale-builtin-group'];
  const f=fixture({schema:1,libraryItems:[source],installedBuiltinIds:originals.map(item=>item.id)});
  const loaded=await f.client().load(originals);
  const item=loaded.find(candidate=>candidate.id===source.id)!;
  const corrected=item.elements.find(element=>element.customData?.role==='bind-shell')!;
  const bounds=elementsBounds(item.elements.filter(element=>!element.isDeleted&&element.customData?.role!=='bind-shell'));
  assert.equal(corrected.id,shell.id,'the existing shell identity is reused');
  assert.equal(item.elements[0]!.id,shell.id,'the corrected shell keeps its position');
  assert.equal(corrected.x,Math.floor(bounds.left)-4);
  assert.equal(corrected.y,Math.floor(bounds.top)-4);
  assert.equal(corrected.width,Math.ceil(bounds.right)-Math.floor(bounds.left)+8);
  assert.equal(corrected.height,Math.ceil(bounds.bottom)-Math.floor(bounds.top)+8);
  assert.deepEqual(corrected.groupIds,['user-stale-group'],'the user regrouped artwork wins');
  assert.equal(item.elements.filter(element=>element.customData?.role==='bind-shell').length,1);
  await f.client().load(originals);
  assert.equal(f.writes(),1,'a corrected shell is stable on the next load');
});
