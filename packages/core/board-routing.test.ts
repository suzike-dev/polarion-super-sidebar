import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeBoard,checkBoardRouting,segmentHitsBox,textBudget,type Box} from './board-routing.ts';

test('orthogonal routing goes around an intervening node instead of behind it',()=>{
  const nodes:Box[]=[{id:'a',kind:'rectangle',x:0,y:0,width:240,height:96},{id:'block',kind:'rectangle',x:0,y:256,width:240,height:96},{id:'b',kind:'rectangle',x:0,y:512,width:240,height:96}];
  const {routes,check}=routeBoard(nodes,[{id:'ab',from:'a',to:'b',label:'继续'}],'down');assert.equal(check.ok,true);assert.ok(routes[0]!.points.length>=4);
  for(let i=1;i<routes[0]!.points.length;i++)assert.equal(segmentHitsBox(routes[0]!.points[i-1]!,routes[0]!.points[i]!,nodes[1]!),false);
});
test('shared sides use distinct spaced ports, and checker rejects collisions and off-line mask violations',()=>{
  const nodes:Box[]=[{id:'a',kind:'rectangle',x:400,y:0,width:240,height:96},{id:'b',kind:'rectangle',x:0,y:400,width:240,height:96},{id:'c',kind:'rectangle',x:400,y:400,width:240,height:96},{id:'d',kind:'rectangle',x:800,y:400,width:240,height:96}];
  const {routes,check}=routeBoard(nodes,[{id:'ab',from:'a',to:'b',label:'左分支'},{id:'ac',from:'a',to:'c',label:'中分支'},{id:'ad',from:'a',to:'d',label:'右分支'}],'down');assert.equal(check.ok,true);
  const ports=routes.map(r=>r.start.point);assert.equal(new Set(ports.map(p=>p.join(','))).size,3);
  const stacked=structuredClone(routes);stacked[1]={...structuredClone(stacked[0]!),id:'stacked'};assert.ok(checkBoardRouting(nodes,stacked).errors.some(e=>e.startsWith('ROUTE_COLLISION:')));
  const masked=structuredClone(routes);const label=masked[0]!.label!,point=masked[0]!.points[label.segment]!;label.x=point[0]-4;label.y=point[1]-4;assert.ok(checkBoardRouting(nodes,masked).errors.some(e=>e.startsWith('LABEL_LINE:')));
});
test('routing fails closed for overlapping nodes and text width counts CJK, punctuation and combining marks',()=>{
  assert.throws(()=>routeBoard([{id:'a',kind:'rectangle',x:0,y:0,width:240,height:96},{id:'b',kind:'rectangle',x:100,y:0,width:240,height:96}],[{id:'ab',from:'a',to:'b'}],'down'),/NODE_OVERLAP/);
  assert.equal(textBudget('温度（A1）',14),14*4+14*.6*2);assert.equal(textBudget('a\u0301',14),14*.6);
});
test('a nine-node twelve-arrow graph retains four separate return lanes',()=>{
  const nodes:Box[]=Array.from({length:9},(_,i)=>({id:'n'+i,kind:'rectangle',x:0,y:i*256,width:240,height:96}));
  const edges=[...Array.from({length:8},(_,i)=>({id:'e'+i,from:'n'+i,to:'n'+(i+1)})),...Array.from({length:4},(_,i)=>({id:'b'+i,from:'n'+(8-i),to:'n'+i,label:'返回'}))];
  const {routes,check}=routeBoard(nodes,edges,'down');assert.equal(check.ok,true);assert.equal(routes.length,12);assert.equal(routes.filter(r=>r.id.startsWith('b')&&r.points.length>=4).length,4);
});
test('nonplanar graphs fail closed instead of emitting crossing strokes or incomplete edges',()=>{
  const nodes:Box[]=[0,1,2].flatMap(i=>[{id:'a'+i,kind:'rectangle',x:0,y:i*256,width:240,height:96},{id:'b'+i,kind:'rectangle',x:600,y:i*256,width:240,height:96}]);
  const edges=[0,1,2].flatMap(a=>[0,1,2].map(b=>({id:'e'+a+b,from:'a'+a,to:'b'+b})));
  assert.throws(()=>routeBoard(nodes,edges,'right'),/BOARD_LAYOUT_UNROUTABLE/);
});

test('bounded routes and paper masks stay inside the declared content rectangle',()=>{
  const bounds={x:32,y:112,width:1216,height:576},nodes:Box[]=[{id:'a',kind:'rectangle',x:120,y:180,width:176,height:64},{id:'obstacle',kind:'rectangle',x:520,y:180,width:176,height:64},{id:'b',kind:'rectangle',x:920,y:180,width:176,height:64}];
  const {routes,check}=routeBoard(nodes,[{id:'ab',from:'a',to:'b',label:'绕行'}],'right',{bounds,nodeGap:40,escape:24,nodeClearance:12});assert.equal(check.ok,true);assert.equal(checkBoardRouting(nodes,routes,bounds).ok,true);
  const escaped=structuredClone(routes);escaped[0]!.points[1]![1]=20;assert.ok(checkBoardRouting(nodes,escaped,bounds).errors.includes('CANVAS_ROUTE:ab'));
  const labels=structuredClone(routes);labels[0]!.label!.x=1240;assert.ok(checkBoardRouting(nodes,labels,bounds).errors.includes('CANVAS_LABEL:ab'));
  assert.throws(()=>routeBoard([{...nodes[0]!,x:0}],[],'right',{bounds}),/BOARD_CANVAS_OVERFLOW/);
});
