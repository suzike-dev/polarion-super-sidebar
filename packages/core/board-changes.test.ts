import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBoardPatches,boardSceneSignature} from './board-changes.ts';
const scene=()=>[
 {id:'a',type:'rectangle',x:0,y:0,width:100,height:60,boundElements:[{id:'label',type:'text'},{id:'line',type:'arrow'}]},
 {id:'b',type:'rectangle',x:300,y:0,width:100,height:60,boundElements:[{id:'line',type:'arrow'}]},
 {id:'label',type:'text',x:20,y:20,width:60,height:20,text:'旧需求',originalText:'旧需求',containerId:'a'},
 {id:'line',type:'arrow',x:100,y:30,width:200,height:0,points:[[0,0],[200,0]],startBinding:{elementId:'a',focus:0,gap:0},endBinding:{elementId:'b',focus:0,gap:0}},
];
test('Chinese label and moved/resized node retain IDs, label and both arrow bindings',()=>{
 const original=scene(),result=applyBoardPatches(original,[{id:'a',x:50,y:20,width:120},{id:'label',text:'冷却液目标温度 ≤ 35 ℃'}]);
 const [a,b,label,line]=result.elements;
 assert.equal(original[0]!.x,0);assert.deepEqual(a!.boundElements,original[0]!.boundElements);assert.equal(label!.text,'冷却液目标温度 ≤ 35 ℃');assert.equal(label!.originalText,label!.text);assert.equal(label!.x,80);assert.equal(label!.y,40);
 assert.deepEqual(line!.startBinding,original[3]!.startBinding);assert.deepEqual(line!.endBinding,original[3]!.endBinding);assert.equal(line!.x,170);assert.equal(line!.y,50);assert.deepEqual(line!.points,[[0,0],[130,-20]]);assert.deepEqual(b,original[1]);
});
test('patches reject deletion, binding replacement, out-of-schema fields and unsafe geometry',()=>{
 assert.throws(()=>applyBoardPatches(scene(),[{id:'a',isDeleted:true}]));assert.throws(()=>applyBoardPatches(scene(),[{id:'line',endBinding:null}]));
 const elbow=scene();(elbow[3] as any).elbowed=true;assert.throws(()=>applyBoardPatches(elbow,[{id:'a',x:20}]),/CONNECTION_GEOMETRY_UNSUPPORTED/);
 assert.throws(()=>applyBoardPatches(scene(),[{id:'label',x:20}]),/BOUND_TEXT_GEOMETRY/);
 assert.throws(()=>applyBoardPatches(scene(),[{id:'a',text:'wrong'}]),/TEXT_ID_REQUIRED/);
 assert.throws(()=>applyBoardPatches(scene(),[{id:'a',x:1},{id:'a',y:2}]),/DUPLICATE_PATCH/);
});
test('optimistic signature ignores runtime versions but detects manual content or binding edits',()=>{
 const a=scene(),b=scene();(b[0] as any).version=42;(b[0] as any).index='a0';assert.equal(boardSceneSignature(a),boardSceneSignature(b));b[2]!.text='新文字';assert.notEqual(boardSceneSignature(a),boardSceneSignature(b));
});
