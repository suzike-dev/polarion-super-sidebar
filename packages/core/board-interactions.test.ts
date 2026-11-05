import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectorTargetAt,quickConnectGeometry,alignSelection,distributeSelection,applyStickyColor,applyArrowStyle,STICKY_COLORS} from './board-interactions.ts';
import type {BoardElement} from './board-changes.ts';

const el=(id:string,type:string,x:number,y:number,width:number,height:number,extra:Partial<BoardElement>={}):BoardElement=>({id,type,x,y,width,height,angle:0,strokeColor:'#000',backgroundColor:'transparent',strokeWidth:2,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:[],updated:0,link:null,locked:false,...extra} as BoardElement);

test('connector targets resolve grouped artwork to its bind shell and reject line-only hits',()=>{
  const shell=el('s1','rectangle',100,100,160,120,{customData:{role:'bind-shell'},groupIds:['g1']});
  const line=el('l1','line',120,140,100,10,{groupIds:['g1']});
  const text=el('t1','text',130,180,60,20,{groupIds:['g1']});
  const rect=el('r1','rectangle',400,100,120,80);
  const plainLine=el('l2','line',400,400,100,0);
  const elements=[line,text,shell,rect,plainLine];
  assert.equal(connectorTargetAt(elements,{x:150,y:150})?.element.id,'s1','clicking artwork resolves to shell');
  assert.equal(connectorTargetAt(elements,{x:450,y:140})?.element.id,'r1');
  assert.equal(connectorTargetAt(elements,{x:450,y:400}),null,'a line without a bindable host is not a target');
  assert.equal(connectorTargetAt(elements,{x:10,y:10}),null);
  const deleted=el('d1','rectangle',0,0,50,50,{isDeleted:true});
  assert.equal(connectorTargetAt([...elements,deleted],{x:20,y:20}),null,'deleted shapes never bind');
  const groupedNoShell=[el('a','line',0,0,100,0,{groupIds:['g2']}),el('b','diamond',20,20,60,60,{groupIds:['g2']})];
  assert.equal(connectorTargetAt(groupedNoShell,{x:10,y:0})?.element.id,'b','group without shell falls back to a bindable member');
});

test('quick connect places orthogonal elbows outside both boxes with correct fixed points',()=>{
  const from=el('a','rectangle',100,100,120,60),to=el('b','rectangle',400,220,120,60);
  const horizontal=quickConnectGeometry(from,to);
  assert.equal(horizontal.startFixedPoint[0],1);assert.equal(horizontal.endFixedPoint[0],0);
  const start=[horizontal.x+horizontal.points[0]![0],horizontal.y+horizontal.points[0]![1]];
  const end=[horizontal.x+horizontal.points.at(-1)![0],horizontal.y+horizontal.points.at(-1)![1]];
  assert.ok(start[0]>=from.x+from.width,'starts outside the source');
  assert.ok(end[0]<=to.x,'ends outside the target');
  assert.ok(horizontal.points.every((point,index)=>!index||point[0]===horizontal.points[index-1]![0]||point[1]===horizontal.points[index-1]![1]),'orthogonal elbow');
  assert.ok(horizontal.points.length>=2);
  const vertical=quickConnectGeometry(el('c','rectangle',100,100,100,80),el('d','rectangle',120,400,100,80));
  assert.equal(vertical.startFixedPoint[1],1);assert.equal(vertical.endFixedPoint[1],0);
  assert.ok(vertical.points.every((point,index)=>!index||point[0]===vertical.points[index-1]![0]||point[1]===vertical.points[index-1]![1]));
});

test('alignSelection moves whole groups and reflows bound connectors',()=>{
  const a=el('a','rectangle',100,100,100,60,{groupIds:['ga']});
  const aShadow=el('a2','text',110,120,40,20,{groupIds:['ga']});
  const b=el('b','rectangle',300,150,80,40);
  const arrow=el('conn','arrow',210,130,90,0,{points:[[0,0],[90,0]],startBinding:{elementId:'a',focus:0,gap:8,fixedPoint:[1,.5]},endBinding:{elementId:'b',focus:0,gap:8,fixedPoint:[0,.5]},elbowed:true});
  a.boundElements=[{id:'conn',type:'arrow'}];b.boundElements=[{id:'conn',type:'arrow'}];
  const aligned=alignSelection([a,aShadow,b,arrow],['a','b'],'left');
  const byId=new Map(aligned.map(element=>[element.id,element]));
  assert.equal(byId.get('a')!.x,100);assert.equal(byId.get('b')!.x,100);
  assert.equal(byId.get('a2')!.x,110,'group shadow follows its group');
  assert.equal(byId.get('a')!.y,100);assert.equal(byId.get('b')!.y,150,'non-axis coordinate is preserved');
  const moved=byId.get('conn')!;
  const start=[moved.x+moved.points[0]![0],moved.y+moved.points[0]![1]];
  const end=[moved.x+moved.points.at(-1)![0],moved.y+moved.points.at(-1)![1]];
  assert.ok(Math.abs(start[0]-(byId.get('a')!.x+100+8))<1e-6,'start stays 8px right of the moved box');
  assert.ok(Math.abs(end[0]-(byId.get('b')!.x-8))<1e-6,'end stays 8px left of the target box');
  assert.ok(moved.points.every((point:number[],index:number)=>!index||point[0]===moved.points[index-1]![0]||point[1]===moved.points[index-1]![1]));
});

test('distributeSelection equalizes gaps on one axis without touching the other',()=>{
  const elements=[el('a','rectangle',0,10,40,20),el('b','rectangle',70,50,60,20),el('c','rectangle',300,90,40,20)];
  const distributed=distributeSelection(elements,['a','b','c'],'x');
  const byId=new Map(distributed.map(element=>[element.id,element]));
  const gap1=byId.get('b')!.x-(byId.get('a')!.x+byId.get('a')!.width),gap2=byId.get('c')!.x-(byId.get('b')!.x+byId.get('b')!.width);
  assert.ok(Math.abs(gap1-gap2)<1e-6,'gaps are equal');
  assert.equal(byId.get('a')!.x,0);assert.equal(byId.get('c')!.x,300);
  assert.deepEqual([byId.get('a')!.y,byId.get('b')!.y,byId.get('c')!.y],[10,50,90],'cross-axis positions are preserved');
  assert.equal(distributeSelection(elements,['a','b'],'x').length,elements.length,'fewer than three members is a no-op');
});

test('grouped quick-connect targets the clicked shape instead of the last member',()=>{
  const first=el('q1','rectangle',100,100,100,60,{groupIds:['gq']});
  const second=el('q2','rectangle',300,100,100,60,{groupIds:['gq']});
  const label=el('q3','text',110,120,80,20,{groupIds:['gq'],containerId:'q1'});
  const elements=[first,second,label];
  assert.equal(connectorTargetAt(elements,{x:150,y:130})?.element.id,'q1','clicking the first class/ER box resolves to that box');
  assert.equal(connectorTargetAt(elements,{x:350,y:130})?.element.id,'q2','clicking the second box resolves to the second box');
  assert.equal(connectorTargetAt(elements,{x:120,y:125})?.element.id,'q1','clicking a bound text resolves to its container');
});

test('alignment moves container text with its container and survives dangling bindings',()=>{
  const box=el('box','rectangle',200,100,200,100);
  const text=el('text','text',210,130,180,40,{containerId:'box'});
  const other=el('other','rectangle',100,300,100,60);
  const dangling=el('dangling','arrow',0,0,100,0,{points:[[0,0],[100,0]],startBinding:{elementId:'missing',focus:0,gap:8,fixedPoint:[1,.5]},endBinding:null});
  const aligned=alignSelection([box,text,other,dangling],['box','other'],'left');
  const byId=new Map(aligned.map(element=>[element.id,element]));
  assert.equal(byId.get('box')!.x,100);assert.equal(byId.get('other')!.x,100);
  assert.equal(byId.get('text')!.x,110,'bound text keeps its offset inside the moved container');
  assert.deepEqual(byId.get('dangling'),dangling,'a dangling binding is left untouched instead of throwing');
});
test('sticky color and arrow style only touch matching selected elements and keep bindings',()=>{
  const sticky=el('s','rectangle',0,0,200,132,{customData:{boardRole:'sticky'}});
  const stickyText=el('st','text',10,10,180,20,{customData:{boardRole:'sticky-text'},containerId:'s'});
  const arrow=el('a','arrow',0,0,100,0,{points:[[0,0],[100,0]],endArrowhead:'arrow',strokeStyle:'solid',startBinding:{elementId:'s',focus:0,gap:8,fixedPoint:[1,.5]},endBinding:null});
  const other=el('o','rectangle',300,0,100,60,{customData:{boardRole:'class'}});
  const colored=applyStickyColor([sticky,stickyText,arrow,other],['s','st','a'],'#e3edf0');
  assert.equal(colored.find(element=>element.id==='s')!.backgroundColor,'#e3edf0');
  assert.equal(colored.find(element=>element.id==='st')!.backgroundColor,stickyText.backgroundColor,'sticky text is not recolored');
  assert.equal(colored.find(element=>element.id==='o')!.backgroundColor,other.backgroundColor);
  assert.ok(colored.find(element=>element.id==='s')!.version>sticky.version,'selected sticky bumps its version');
  const dashed=applyArrowStyle(colored,['a'],'dashed');
  const dashedArrow=dashed.find(element=>element.id==='a')!;
  assert.equal(dashedArrow.strokeStyle,'dashed');assert.equal(dashedArrow.endArrowhead,'arrow');
  assert.deepEqual(dashedArrow.startBinding,arrow.startBinding,'bindings survive restyling');
  const plain=applyArrowStyle(dashed,['a'],'plain').find(element=>element.id==='a')!;
  assert.equal(plain.endArrowhead,null);assert.equal(plain.startArrowhead,null);assert.equal(plain.strokeStyle,'dashed','plain only removes arrowheads and keeps the chosen line style');
  const untouched=applyArrowStyle(colored,['s'],'dashed');
  assert.equal(untouched.find(element=>element.id==='a')!.strokeStyle,'solid','unselected arrows are untouched');
});
