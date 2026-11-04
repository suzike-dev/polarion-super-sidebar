import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBoardLibraryItems,BOARD_LIBRARY_COUNT,BOARD_LIBRARY_CATEGORIES} from './board-library-items.ts';
import {BoardLibraryStorage,BOARD_LIBRARY_STORAGE_KEY,supplementBoardLibrary} from './board-library-storage.ts';
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

test('36 original vector items have stable identities, readable text and closed native bindings',()=>{
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
  assert.ok(Buffer.byteLength(JSON.stringify(originals))<300_000,'bounded native library payload');
});

test('first load installs defaults once; reopening never duplicates them',async()=>{
  const f=fixture();assert.equal((await f.client().load(originals)).length,36);
  assert.equal((await f.client().load(originals)).length,36);assert.equal(f.writes(),1);
});

test('existing personal material survives initialization, native changes and reopen',async()=>{
  const personal=userItem('my-pump');
  const f=fixture({schema:1,libraryItems:[personal],installedBuiltinIds:[]}),client=f.client();
  const initial=await client.load(originals);assert.deepEqual(initial[0],personal);
  const added=userItem('my-control');await client.save([added,...initial]);
  const reopened=await f.client().load(originals);assert.equal(reopened.length,38);
  assert.deepEqual(reopened.find(item=>item.id===personal.id),personal);assert.deepEqual(reopened.find(item=>item.id===added.id),added);
});

test('deleted default stays removed; supplement restores only missing originals',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals);
  await client.save(initial.slice(1));const reopened=await f.client().load(originals);assert.equal(reopened.length,35);
  const customized={...structuredClone(reopened[0]!),name:'我的结束标记'};
  const supplemented=supplementBoardLibrary([customized,...reopened.slice(1)],originals);
  assert.equal(supplemented.length,36);assert.deepEqual(supplemented[0],customized);
  assert.equal(new Set(supplemented.map(item=>item.id)).size,36);
});

test('an added release installs only new identities and preserves edits and tombstones',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals);
  const edited={...structuredClone(initial[1]!),name:'定制结束'};
  await client.save([edited,...initial.slice(2)]);
  const nextRelease=[...originals,{...structuredClone(originals[0]!),id:'pss-builtin-v2-new'}];
  const reopened=await f.client().load(nextRelease);assert.equal(reopened.length,36);
  assert.ok(!reopened.some(item=>item.id===originals[0]!.id));assert.equal(reopened.find(item=>item.id===edited.id)?.name,'定制结束');
});

test('two board instances save their own deltas without erasing each other',async()=>{
  const f=fixture(),a=f.client(),b=f.client();const [aItems,bItems]=await Promise.all([a.load(originals),b.load(originals)]);
  await Promise.all([a.save([userItem('A'),...aItems]),b.save([userItem('B'),...bItems])]);
  assert.equal(f.items().length,38);assert.ok(f.items().some(item=>item.id==='A'));assert.ok(f.items().some(item=>item.id==='B'));
  // B has never seen A; deleting one local default must retain A as well.
  await b.save([userItem('B'),...bItems.slice(1)]);assert.equal(f.items().length,37);assert.ok(f.items().some(item=>item.id==='A'));
});

test('ordered rapid saves keep additions and intentional deletion',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals);
  await Promise.all([client.save([userItem('draft'),...initial]),client.save([userItem('final'),...initial])]);
  assert.ok(!f.items().some(item=>item.id==='draft'));assert.ok(f.items().some(item=>item.id==='final'));assert.equal(f.items().length,37);
});

test('a failed save is visible and the same snapshot can be retried without data loss',async()=>{
  const f=fixture(),client=f.client(),initial=await client.load(originals),next=[userItem('retry'),...initial];
  f.fail(true);await assert.rejects(client.save(next),/storage unavailable/);await assert.rejects(client.flush());
  f.fail(false);await client.save(next);assert.equal(f.items().length,37);assert.ok(f.items().some(item=>item.id==='retry'));
});

test('unknown storage schema is preserved; empty callbacks after failed load cannot erase it',async()=>{
  const original={schema:2,libraryItems:[userItem('protected')],installedBuiltinIds:[]};const f=fixture(original),client=f.client();
  await assert.rejects(client.load(originals),/格式不兼容/);await client.save([]);assert.deepEqual(f.state(),original);assert.equal(f.writes(),0);
});
