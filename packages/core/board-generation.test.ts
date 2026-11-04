import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoardDiagramSchema,generateBoardDiagram,boardPreviewDimensions,checkBoardCanvas} from './board-generation.ts';
import {applyBoardPatches,boardSceneSignature} from './board-changes.ts';
import {validateBoardSource} from './board-contract.ts';

const namespace='00000000-0000-4000-8000-000000000001';
const diagram={title:'冷却请求流程',summary:'采集温度并检查冷却请求，执行或等待。',direction:'down',nodes:[{id:'start',kind:'ellipse',text:'采集温度'},{id:'check',kind:'diamond',text:'需要冷却？'},{id:'cool',text:'启动冷却',tone:'accent'},{id:'wait',text:'保持待机'}],edges:[{id:'a',from:'start',to:'check'},{id:'b',from:'check',to:'cool',label:'是'},{id:'c',from:'check',to:'wait',label:'否'}]};
test('diagram compiler creates deterministic editable shapes, text and bound arrows without embedded images',()=>{
  const first=generateBoardDiagram(diagram,namespace),again=generateBoardDiagram(diagram,namespace);
  assert.deepEqual(first,again);assert.equal(first.summary.nodes,4);assert.equal(first.summary.edges,3);
  const source=validateBoardSource(JSON.stringify({type:'excalidraw',version:2,elements:first.elements,files:{}}));
  assert.equal(source.elements.filter((e:any)=>e.type==='arrow').length,3);assert.equal(source.elements.filter((e:any)=>e.type==='image').length,0);
  const byId=new Map(first.elements.map(e=>[e.id,e]));
  for(const element of first.elements){assert.ok(Number.isFinite(element.width)&&element.width>=0);assert.ok(Number.isFinite(element.height)&&element.height>=0);if(element.containerId)assert.ok(byId.get(element.containerId)?.boundElements.some((bound:any)=>bound.id===element.id));for(const binding of [element.startBinding,element.endBinding])if(binding)assert.ok(byId.get(binding.elementId)?.boundElements.some((bound:any)=>bound.id===element.id));}
  const label=first.elements.find(e=>e.type==='text'&&e.originalText==='启动冷却')!;
  const patched=applyBoardPatches(first.elements,[{id:label.id,text:'降速冷却'}]);assert.equal(patched.elements.find(e=>e.id===label.id)!.text,'降速冷却');assert.notEqual(boardSceneSignature(first.elements),boardSceneSignature(patched.elements));
});
test('bounded DSL rejects unsafe content, unknown fields, excessive nodes, invalid coordinates and references',()=>{
  const bad=[{...diagram,source:'<svg/>'},{...diagram,nodes:[{id:'a',text:'<script>alert(1)</script>'}]},{...diagram,nodes:[{id:'a',text:'url',link:'javascript:alert(1)'}]},{...diagram,nodes:Array.from({length:41},(_,i)=>({id:'a'+i,text:'node'}))},{...diagram,nodes:[{id:'a',text:'a',x:10001,y:0}]},{...diagram,nodes:[{id:'a',text:'a',x:0}]},{...diagram,nodes:[{id:'a',text:'a',x:Infinity,y:0}]},{...diagram,edges:[{id:'a',from:'start',to:'missing'}]},{...diagram,edges:[{id:'a',from:'start',to:'start'}]},{...diagram,edges:[{id:'start',from:'start',to:'check'}]},{...diagram,nodes:[{id:'start',kind:'text',text:'note'},{id:'check',text:'box'}],edges:[{id:'a',from:'start',to:'check'}]}];
  for(const input of bad)assert.equal(BoardDiagramSchema.safeParse(input).success,false,JSON.stringify(input));
});
test('compiler preserves branch placement, safe comparison text and cyclic connections',()=>{
  const result=generateBoardDiagram({title:'分支',summary:'温度 < 10 时等待',direction:'right',nodes:[{id:'a',text:'温度 < 10',x:96,y:280},{id:'b',text:'继续',x:456,y:144},{id:'c',text:'等待',x:456,y:440}],edges:[{id:'ab',from:'a',to:'b'},{id:'ac',from:'a',to:'c'},{id:'ca',from:'c',to:'a'}]},namespace);
  assert.equal(result.elements.find(e=>e.id.endsWith('-n_b'))!.y,144);assert.equal(result.elements.find(e=>e.id.endsWith('-n_c'))!.y,440);
  const arrow=result.elements.find(e=>e.id.endsWith('-e_ab'))!;assert.equal(arrow.elbowed,true);assert.ok(arrow.points.every((p:number[],i:number)=>!i||p[0]===arrow.points[i-1][0]||p[1]===arrow.points[i-1][1]));assert.equal(result.summary.checks.ok,true);
});
test('compiler rejects overlapping connection endpoints and namespaces generated identities',()=>{
  assert.throws(()=>generateBoardDiagram({title:'same',summary:'same',nodes:[{id:'a',text:'one',x:100,y:200},{id:'b',text:'two',x:100,y:200}],edges:[{id:'ab',from:'a',to:'b'}]},namespace),/NODE_OVERLAP/);
  const namespaced=generateBoardDiagram({title:'same',summary:'same',nodes:[{id:'a',text:'one'},{id:'a-text',text:'two'},{id:'title',text:'title'}]},namespace);assert.equal(new Set(namespaced.elements.map(e=>e.id)).size,namespaced.elements.length);
});
test('fixed frames reserve readable title blocks and reject titles that need more than two lines',()=>{
  for(const text of ['工程控制模式与温度请求判断流程'.repeat(3),'W'.repeat(58),'第一行\n第二行']){const {elements}=generateBoardDiagram({title:text,summary:'标题不遮挡图形',nodes:[{id:'a',text:'开始'},{id:'b',text:'结束'}]},namespace),title=elements.find(e=>e.customData?.boardRole==='title')!;
    assert.equal(title.fontSize,28);assert.equal(title.originalText,text);assert.equal(title.height,title.text.split('\n').length*28*title.lineHeight);
    assert.ok(title.text.split('\n').every((line:string)=>Array.from(line).length*28<=title.width));
    assert.ok(elements.filter(e=>!['canvas','title'].includes(e.customData?.boardRole)).every(element=>element.y-(title.y+title.height)>=24-1e-9));
  }
  for(const title of ['W'.repeat(160),'第一行\n第二行\n第三行'])assert.throws(()=>generateBoardDiagram({title,summary:'过长标题',nodes:[{id:'a',text:'开始'}]},namespace),/BOARD_TITLE_TOO_LONG/);
});
test('generation rejects off-frame coordinates while the manual-board export cap remains bounded',()=>{
  for(const[x,y]of[[-10000,-10000],[10000,10000],[0,0],[1200,700]])assert.throws(()=>generateBoardDiagram({title:'越界图',summary:'不能靠最后缩小掩盖越界',size:'slide-16x9',nodes:[{id:'a',text:'开始',x,y}]},namespace),/BOARD_CANVAS_OVERFLOW/);
  const raster=boardPreviewDimensions(20000,16000);assert.deepEqual(raster,{width:2400,height:1920,scale:.12});
  assert.deepEqual(boardPreviewDimensions(600,320),{width:600,height:320,scale:1});
  for(const [w,h] of [[Infinity,20],[20,NaN],[0,20],[-1,20]])assert.throws(()=>boardPreviewDimensions(w!,h!),/EXPORT_SIZE_INVALID/);
});
test('flowchart contract enforces 9 nodes, 12 arrows, 2 accents and labeled decision exits',()=>{
  const nodes=Array.from({length:10},(_,i)=>({id:'n'+i,text:'节点'}));assert.equal(BoardDiagramSchema.safeParse({title:'预算',summary:'node budget',nodes}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...diagram,edges:Array.from({length:13},(_,i)=>({id:'e'+i,from:'start',to:'cool'}))}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...diagram,nodes:diagram.nodes.map(n=>({...n,tone:'accent'}))}).success,false);
  for(const edges of [[{id:'a',from:'check',to:'cool',label:'是'}],[{id:'a',from:'check',to:'cool',label:'是'},{id:'b',from:'check',to:'wait'}],[{id:'a',from:'check',to:'cool',label:'a'.repeat(15)},{id:'b',from:'check',to:'wait',label:'否'}]])assert.equal(BoardDiagramSchema.safeParse({...diagram,edges}).success,false);
});
test('nine-node branching, convergence and retry loop produce editable native elbows with independent paper labels',()=>{
  const nodes=[['start','ellipse','开始'],['sample','rectangle','采集温度'],['check','diamond','需要冷却？'],['cool','rectangle','执行冷却'],['hold','rectangle','保持待机'],['verify','diamond','反馈满足？'],['retry','rectangle','记录并重试'],['finish','rectangle','归档结果'],['end','ellipse','结束']].map(([id,kind,text],index)=>({id,kind,text,tone:index===2||index===7?'accent':'neutral'}));
  const edges=[['a','start','sample'],['b','sample','check'],['c','check','cool','是'],['d','check','hold','否'],['e','cool','verify'],['f','hold','verify'],['g','verify','finish','是'],['h','verify','retry','否'],['i','retry','sample','重试'],['j','finish','end']].map(([id,from,to,label])=>({id,from,to,label}));
  const result=generateBoardDiagram({title:'冷却请求分支合流与重试',summary:'隔离验收样例，不是正式需求。',nodes,edges},namespace);
  assert.equal(result.summary.checks.ok,true);assert.equal(result.summary.checks.nodes,9);assert.equal(result.summary.checks.arrows,10);assert.equal(result.summary.checks.accents,2);
  const arrows=result.elements.filter(e=>e.type==='arrow'),shapes=result.elements.filter(e=>e.customData?.boardRole==='node'),masks=result.elements.filter(e=>e.customData?.boardRole==='edge-label-mask');
  assert.equal(arrows.length,10);assert.equal(masks.length,5);assert.ok(shapes.some(e=>e.type==='diamond')&&shapes.some(e=>e.type==='ellipse')&&shapes.some(e=>e.type==='rectangle'));
  assert.ok(shapes.every(e=>[e.x,e.y,e.width,e.height].every(value=>value%4===0)));
  assert.ok(arrows.every(e=>e.elbowed&&e.startBinding?.fixedPoint&&e.endBinding?.fixedPoint&&e.points.every((point:number[],i:number)=>!i||point[0]===e.points[i-1][0]||point[1]===e.points[i-1][1])));
  assert.ok(Math.max(...arrows.map(e=>result.elements.indexOf(e)))<Math.min(...shapes.map(e=>result.elements.indexOf(e))));
  for(const mask of masks){assert.equal(mask.backgroundColor,'#ffffff');assert.ok(mask.customData.gap>=6&&mask.customData.gap<=10);assert.equal(mask.boundElements.length,1);const text=result.elements.find(e=>e.id===mask.boundElements[0].id)!;assert.equal(text.containerId,mask.id);assert.notEqual(text.containerId,arrows.find(e=>e.customData.logicalId===mask.customData.edgeId)!.id);}
  const loop=result.routes.find(r=>r.id==='i')!;assert.equal(loop.from,'retry');assert.equal(loop.to,'sample');assert.ok(loop.points.length>=2);assert.deepEqual(generateBoardDiagram({title:'冷却请求分支合流与重试',summary:'隔离验收样例，不是正式需求。',nodes,edges},namespace),result);
});

test('explicit size produces locked exact bounds and centered editable text without scaling the type ramp',()=>{
  for(const[size,width,height]of[['slide-16x9',1280,720],['doc-wide',1280,720],['doc-inline',960,600]] as const){const result=generateBoardDiagram({...diagram,size},namespace),canvas=result.elements[0]!;
    assert.deepEqual([canvas.x,canvas.y,canvas.width,canvas.height],[0,0,width,height]);assert.equal(canvas.customData.boardRole,'canvas');assert.equal(canvas.locked,true);assert.equal(canvas.strokeColor,'transparent');assert.equal(canvas.backgroundColor,'#ffffff');assert.equal(canvas.strokeWidth,0);
    assert.equal(result.summary.checks.canvas.width,width);assert.equal(result.summary.checks.canvas.height,height);
    const title=result.elements.find(e=>e.customData?.boardRole==='title')!;assert.equal(title.fontSize,size==='slide-16x9'?40:28);
    for(const shape of result.elements.filter(e=>e.customData?.boardRole==='node')){const text=result.elements.find(e=>e.containerId===shape.id)!;assert.equal(text.fontSize,18);assert.equal(text.textAlign,'center');assert.equal(text.verticalAlign,'middle');assert.ok(text.x>=shape.x&&text.y>=shape.y&&text.x+text.width<=shape.x+shape.width&&text.y+text.height<=shape.y+shape.height);}
    for(const route of result.routes){assert.ok(route.points.every(([x,y])=>x>=32&&x<=width-32&&y>=result.summary.checks.canvas.contentBounds.y&&y<=height-32));if(route.label)assert.ok(route.label.x>=32&&route.label.y>=result.summary.checks.canvas.contentBounds.y&&route.label.x+route.label.width<=width-32&&route.label.y+route.label.height<=height-32);}
  }
});

test('auto bounds a real nine-node branching graph and twelve-arrow grid without removing relationships',()=>{
  const nodes=[['start','ellipse','开始'],['retry','rectangle','记录并重试'],['sample','rectangle','采集温度'],['check','diamond','需要冷却？'],['hold','rectangle','保持待机'],['cool','rectangle','执行冷却'],['verify','diamond','反馈满足？'],['finish','rectangle','归档结果'],['end','ellipse','结束']].map(([id,kind,text])=>({id,kind,text}));
  const edges=[['a','start','sample'],['b','sample','check'],['c','check','cool','是'],['d','check','hold','否'],['e','cool','verify'],['f','hold','verify'],['g','verify','finish','满足'],['h','finish','end'],['i','verify','retry','不满足'],['j','retry','sample']].map(([id,from,to,label])=>({id,from,to,label}));
  for(const size of ['auto','slide-16x9']){const result=generateBoardDiagram({title:'热管理闭环 · 隔离验收示例',summary:'真实Agent图结构回归',size,nodes,edges},namespace);assert.equal(result.summary.checks.ok,true);assert.equal(result.summary.nodes,9);assert.equal(result.summary.edges,10);assert.ok(result.summary.checks.canvas.width<=1280&&result.summary.checks.canvas.height<=1000);assert.deepEqual(result.routes.map(r=>[r.id,r.from,r.to]),edges.map(e=>[e.id,e.from,e.to]));}
  const gridNodes=Array.from({length:9},(_,i)=>({id:'n'+i,text:'步骤 '+i})),gridEdges=[];for(let row=0;row<3;row++)for(let col=0;col<3;col++){const i=row*3+col;if(col<2)gridEdges.push({id:'r'+i,from:'n'+i,to:'n'+(i+1)});if(row<2)gridEdges.push({id:'d'+i,from:'n'+i,to:'n'+(i+3)});}const grid=generateBoardDiagram({title:'九节点十二连线',summary:'预算上限保留全部关系',nodes:gridNodes,edges:gridEdges},namespace);assert.equal(grid.summary.edges,12);assert.equal(grid.summary.checks.ok,true);
});

test('actual source frame checker detects escaped shapes, arrow points, labels and title collisions',()=>{
  const result=generateBoardDiagram(diagram,namespace);assert.equal(checkBoardCanvas(result.elements).ok,true);
  const escaped=structuredClone(result.elements),node=escaped.find(e=>e.customData?.boardRole==='node')!;node.x=-20;assert.ok(checkBoardCanvas(escaped).errors.some(e=>e.startsWith('BOARD_CANVAS_OVERFLOW:')));
  const arrowSource=structuredClone(result.elements),arrow=arrowSource.find(e=>e.type==='arrow')!;arrow.points[1]=[5000,5000];assert.ok(checkBoardCanvas(arrowSource).errors.some(e=>e.startsWith('BOARD_CANVAS_OVERFLOW:')));
  const labelSource=structuredClone(result.elements),mask=labelSource.find(e=>e.customData?.boardRole==='edge-label-mask')!;mask.y=1000;assert.ok(checkBoardCanvas(labelSource).errors.some(e=>e.startsWith('BOARD_CANVAS_OVERFLOW:')));
  const titleSource=structuredClone(result.elements),title=titleSource.find(e=>e.customData?.boardRole==='title')!,other=titleSource.find(e=>e.customData?.boardRole==='node')!;other.x=title.x;other.y=title.y;assert.ok(checkBoardCanvas(titleSource).errors.some(e=>e.startsWith('BOARD_TITLE_OVERLAP:')));
});
