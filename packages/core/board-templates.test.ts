import {test} from 'node:test';
import assert from 'node:assert/strict';
import {elementsBounds,instantiateElements} from './board-templates.ts';
import type {BoardElement} from './board-changes.ts';

const el=(id:string,type:string,x:number,y:number,width:number,height:number,extra:Partial<BoardElement>={}):BoardElement=>({id,type,x,y,width,height,angle:0,strokeColor:'#000',backgroundColor:'transparent',strokeWidth:2,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:[],updated:0,link:null,locked:false,...extra} as BoardElement);

test('template instantiation remaps ids, bindings, containers and groups, and centres the copy',()=>{
  const source=[
    el('box','rectangle',0,0,160,80,{groupIds:['g1'],boundElements:[{id:'arrow',type:'arrow'},{id:'label',type:'text'}]}),
    el('label','text',10,20,120,20,{groupIds:['g1'],containerId:'box'}),
    el('target','ellipse',300,100,120,60,{groupIds:['g2'],boundElements:[{id:'arrow',type:'arrow'}]}),
    el('arrow','arrow',160,40,140,60,{groupIds:['g1'],points:[[0,0],[140,60]],startBinding:{elementId:'box',focus:0,gap:8,fixedPoint:[1,.5]},endBinding:{elementId:'target',focus:0,gap:8,fixedPoint:[0,.5]}}),
  ];
  const result=instantiateElements(source,{centerX:500,centerY:300,prefix:'copy-'});
  assert.equal(result.elements.length,4);
  assert.equal(new Set(result.ids).size,4);
  for(const element of result.elements)assert.ok(element.id.startsWith('copy-'),'fresh identities');
  const ids=new Set(result.elements.map(element=>element.id));
  for(const old of ['box','label','target','arrow'])assert.ok(!result.elements.some(element=>element.id===old));
  const byOld=new Map(source.map((element,index)=>[element.id,result.elements[index]!]));
  const box=byOld.get('box')!,label=byOld.get('label')!,arrow=byOld.get('arrow')!,target=byOld.get('target')!;
  assert.ok(ids.has(label.containerId!),'text container remapped');
  assert.equal(arrow.startBinding!.elementId,box.id);assert.equal(arrow.endBinding!.elementId,target.id);
  assert.ok(box.boundElements!.every((bound:{id:string})=>ids.has(bound.id)),'bound element ids remapped');
  assert.ok(result.elements.every(element=>element.customData?.boardTemplate===true));
  const left=Math.min(...result.elements.map(element=>element.x)),right=Math.max(...result.elements.map(element=>element.x+element.width));
  const top=Math.min(...result.elements.map(element=>element.y)),bottom=Math.max(...result.elements.map(element=>element.y+element.height));
  assert.ok(Math.abs((left+right)/2-500)<1e-6,'horizontal centre');
  assert.ok(Math.abs((top+bottom)/2-300)<1e-6,'vertical centre');
  // 两次实例化互不共享身份
  const again=instantiateElements(source,{centerX:0,centerY:0,prefix:'second-'});
  assert.equal([...ids].filter(id=>again.ids.includes(id)).length,0);
  assert.equal(source[0]!.id,'box','source template is untouched');
});

test('centring uses the true extent of line art instead of the nominal x+width box',()=>{
  const source=[
    el('box','rectangle',0,0,128,64),
    el('loop','arrow',288,72,224,56,{points:[[0,0],[0,56],[-224,56],[-224,0]]}),
    el('chevron','line',32,0,200,64,{points:[[0,0],[136,0],[168,32],[-32,32],[0,0]]}),
  ];
  const result=instantiateElements(source,{centerX:500,centerY:300,prefix:'centre-'});
  const bounds=elementsBounds(result.elements);
  assert.ok(Math.abs((bounds.left+bounds.right)/2-500)<1e-6,'horizontal centre follows the visible points');
  assert.ok(Math.abs((bounds.top+bounds.bottom)/2-300)<1e-6,'vertical centre');
  // True artwork extent is 0..288; the nominal boxes would claim 0..512 and shift the copy.
  assert.equal(result.elements[0]!.x,356,'offset comes from the 288px visible extent, not the 512px nominal box');
});
