import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BoardDiagramSchema,generateBoardDiagram,boardPreviewDimensions,checkBoardCanvas,straightConnectionRoutes} from './board-generation.ts';
import {applyBoardPatches,boardSceneSignature} from './board-changes.ts';
import {validateBoardSource} from './board-contract.ts';

const namespace='00000000-0000-4000-8000-000000000001';
const overlaps=(a:any,b:any)=>a.x<b.x+b.width-1e-6&&a.x+a.width>b.x+1e-6&&a.y<b.y+b.height-1e-6&&a.y+a.height>b.y+1e-6;
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

test('swimlane kind renders named vertical lanes with lane-owned nodes and deterministic elbows',()=>{
  const swimlane={title:'需求评审泳道流程',summary:'编写与评审职责分离的示例流程。',kind:'swimlane',lanes:[{id:'author',name:'编写方'},{id:'reviewer',name:'评审方'}],nodes:[
    {id:'draft',text:'编写草稿',lane:'author'},
    {id:'submit',text:'提交评审',lane:'author'},
    {id:'check',kind:'diamond',text:'评审通过？',lane:'reviewer',tone:'accent'},
    {id:'publish',text:'归档发布',lane:'author'}],
    edges:[{id:'a',from:'draft',to:'submit'},{id:'b',from:'submit',to:'check'},{id:'c',from:'check',to:'publish',label:'通过'},{id:'d',from:'check',to:'draft',label:'修改'}]};
  const first=generateBoardDiagram(swimlane,namespace),again=generateBoardDiagram(swimlane,namespace);
  assert.deepEqual(first,again);
  assert.equal(first.summary.lanes,2);assert.equal(first.summary.checks.ok,true);
  validateBoardSource(JSON.stringify({type:'excalidraw',version:2,elements:first.elements,files:{}}));
  const headers=first.elements.filter(e=>e.customData?.boardRole==='lane'&&e.customData.part==='header');
  const bodies=first.elements.filter(e=>e.customData?.boardRole==='lane'&&e.customData.part==='body');
  assert.equal(headers.length,2);assert.equal(bodies.length,2);
  assert.deepEqual(headers.map(h=>h.customData.laneId),['author','reviewer']);
  assert.ok(headers[0]!.x+headers[0]!.width<=headers[1]!.x+1e-9,'lanes are side-by-side columns');
  const laneOf=new Map(swimlane.nodes.map(n=>[n.id,n.lane]));
  const nodes=first.elements.filter(e=>e.customData?.boardRole==='node');
  const bodiesByLane=new Map(bodies.map(b=>[b.customData.laneId as string,b]));
  for(const node of nodes){const lane=laneOf.get(node.customData.logicalId as string)!,body=bodiesByLane.get(lane)!;
    assert.ok(node.x>=body.x&&node.x+node.width<=body.x+body.width+1e-9,'node stays inside its lane column: '+node.customData.logicalId);
    assert.ok(node.y>=body.y,'node starts below the lane header');}
  const arrows=first.elements.filter(e=>e.type==='arrow');
  assert.equal(arrows.length,4);
  assert.ok(arrows.every(a=>a.elbowed&&a.startBinding&&a.endBinding&&a.points.every((p:number[],i:number)=>!i||p[0]===a.points[i-1]![0]||p[1]===a.points[i-1]![1])));
  for(const arrow of arrows)for(const binding of [arrow.startBinding,arrow.endBinding])assert.ok(first.elements.some(e=>e.id===binding!.elementId&&e.boundElements.some((b:{id:string;type:string})=>b.id===arrow.id&&b.type==='arrow')));
  assert.ok(first.elements.some(e=>e.customData?.boardRole==='lane-title'&&e.originalText==='编写方'));
});

test('swimlane schema enforces lanes, references, direction and auto layout',()=>{
  const base={title:'泳道',summary:'校验规则',kind:'swimlane',lanes:[{id:'a',name:'甲'},{id:'b',name:'乙'}],nodes:[{id:'n1',text:'步骤',lane:'a'}],edges:[]} as const;
  assert.equal(BoardDiagramSchema.safeParse(base).success,true);
  assert.equal(BoardDiagramSchema.safeParse({...base,nodes:[{id:'n1',text:'步骤'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,nodes:[{id:'n1',text:'步骤',lane:'ghost'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,lanes:[{id:'a',name:'甲'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,direction:'right'}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,nodes:[{id:'n1',text:'步骤',lane:'a',x:10,y:10}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,kind:'flow'}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({title:'流程',summary:'普通流程不能带泳道字段',nodes:[{id:'n1',text:'步骤',lane:'a'}]}).success,false);
});

test('swimlane layout refuses content that cannot fit any frame legibly',()=>{
  const nodes=Array.from({length:9},(_,i)=>({id:'n'+i,text:'步骤',lane:'a'}));
  assert.throws(()=>generateBoardDiagram({title:'超高通量泳道',summary:'任何画幅都无法可读容纳。',kind:'swimlane',lanes:[{id:'a',name:'甲'},{id:'b',name:'乙'}],nodes},namespace),/BOARD_LAYOUT_TOO_DENSE/);
});

test('sequence kind lays out lifelines with bound horizontal messages, returns and self loops',()=>{
  const sequence={title:'评审交互时序',summary:'用户提交评审，服务受理并返回结果。',kind:'sequence',
    participants:[{id:'user',name:'用户'},{id:'ui',name:'界面'},{id:'svc',name:'评审服务'}],
    messages:[
      {id:'m1',from:'user',to:'ui',text:'提交评审请求'},
      {id:'m2',from:'ui',to:'svc',text:'调用评审接口'},
      {id:'m3',from:'svc',to:'svc',text:'校验并记录',kind:'self'},
      {id:'m4',from:'svc',to:'ui',text:'返回结果',kind:'return'},
    ]};
  const first=generateBoardDiagram(sequence,namespace),again=generateBoardDiagram(sequence,namespace);
  assert.deepEqual(first,again);
  validateBoardSource(JSON.stringify({type:'excalidraw',version:2,elements:first.elements,files:{}}));
  assert.equal(first.summary.nodes,3);assert.equal(first.summary.edges,4);assert.equal(first.summary.lanes,0);
  assert.equal(first.summary.checks.participants,3);assert.equal(first.summary.checks.messages,4);
  const byRole=(role:string)=>first.elements.filter(e=>e.customData?.boardRole===role);
  const headers=byRole('participant'),lifelines=byRole('lifeline'),messages=byRole('message'),labels=byRole('message-label');
  assert.equal(headers.length,3);assert.equal(lifelines.length,3);assert.equal(messages.length,4);assert.equal(labels.length,4);
  const lifelineById=new Map(lifelines.map(l=>[l.customData!.logicalId as string,l]));
  for(const header of headers)assert.ok(first.elements.some(e=>e.containerId===header.id&&e.customData?.boardRole==='participant-name'));
  for(const line of lifelines){assert.equal(line.type,'rectangle');assert.ok(line.width<=4,'lifeline must be a thin bindable rectangle');assert.ok(line.height>100);assert.ok(line.groupIds.length>0);}
  const arrows=first.elements.filter(e=>e.type==='arrow');
  assert.equal(arrows.length,4);
  for(const arrow of arrows){
    assert.ok(arrow.startBinding&&arrow.endBinding);
    assert.ok(lifelineById.has(arrow.customData!.from as string)&&lifelineById.has(arrow.customData!.to as string));
    for(const binding of [arrow.startBinding,arrow.endBinding])assert.ok(first.elements.some(e=>e.id===binding!.elementId&&e.boundElements.some((b:{id:string;type:string})=>b.id===arrow.id)));
    const points=arrow.points as number[][];
    if(arrow.customData!.kind==='self'){assert.equal(points.length,4);assert.ok(points.every((p,i)=>!i||p[0]===points[i-1]![0]||p[1]===points[i-1]![1]));assert.equal(arrow.elbowed,false);}
    else{assert.ok(points.every(p=>p[1]===points[0]![1]),'message must be horizontal');assert.equal(arrow.elbowed,false);}
  }
  const self=arrows.find(a=>a.customData!.kind==='self')!,ret=arrows.find(a=>a.customData!.kind==='return')!;
  assert.equal(self.points.length,4);assert.equal(ret.strokeStyle,'dashed');
  const fixedPoints=arrows.map(a=>(a.startBinding!.fixedPoint as number[])[1]);
  assert.equal(new Set(fixedPoints.map(v=>v.toFixed(3))).size,4,'each message attaches at its own lifeline height');
  const canvas=first.summary.checks.canvas;
  assert.ok(canvas.width<=1280);assert.ok(canvas.height<=1400);
  for(const element of first.elements.filter(e=>!['canvas','title'].includes(e.customData?.boardRole as string)))assert.ok(element.x>=0&&element.y>=0&&element.x+element.width<=canvas.width&&element.y+element.height<=canvas.height);
});

test('sequence schema rejects mixed models, unknown participants and unmarked self messages',()=>{
  const base={title:'时序',summary:'校验',kind:'sequence',participants:[{id:'a',name:'甲'},{id:'b',name:'乙'}],messages:[{id:'m1',from:'a',to:'b',text:'请求'}]} as const;
  assert.equal(BoardDiagramSchema.safeParse(base).success,true);
  assert.equal(BoardDiagramSchema.safeParse({...base,nodes:[{id:'n1',text:'节点'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,edges:[{id:'e1',from:'a',to:'b'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,participants:[{id:'a',name:'甲'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,messages:[]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,messages:[{id:'m1',from:'a',to:'ghost',text:'请求'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,messages:[{id:'m1',from:'a',to:'a',text:'请求'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,messages:[{id:'m1',from:'a',to:'b',text:'请求',kind:'self'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,lanes:[{id:'l1',name:'泳道'},{id:'l2',name:'泳道2'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({title:'流程图',summary:'普通流程图不能带参与者',participants:[{id:'a',name:'甲'},{id:'b',name:'乙'}],nodes:[{id:'n1',text:'步骤'}]}).success,false);
  const six=Array.from({length:6},(_,i)=>({id:'p'+i,name:'参与方'+i}));
  assert.throws(()=>generateBoardDiagram({title:'六参与者',summary:'窄画幅放不下',size:'doc-inline',kind:'sequence',participants:six,messages:[{id:'m1',from:'p0',to:'p5',text:'通知'}]},namespace),/BOARD_SEQUENCE_TOO_WIDE/);
});

test('class kind builds three-compartment UML boxes with UML arrowheads and bound relations',()=>{
  const classDiagram={title:'评审服务类图',summary:'用户、评审与评审服务的关系。',kind:'class',classes:[
    {id:'user',name:'User',attributes:['+ id: String','+ name: String'],methods:['+ submit(): void']},
    {id:'review',name:'Review',attributes:['+ id: String','+ state: State'],methods:['+ approve(): void']},
    {id:'service',name:'ReviewService',attributes:['- repo: Repository'],methods:['+ handle(r: Review): void','+ validate(): bool']},
  ],relations:[{id:'r1',from:'user',to:'review',kind:'association',label:'1..*'},{id:'r2',from:'service',to:'review',kind:'dependency'},{id:'r3',from:'review',to:'user',kind:'aggregation'}]};
  const first=generateBoardDiagram(classDiagram,namespace),again=generateBoardDiagram(classDiagram,namespace);
  assert.deepEqual(first,again);
  validateBoardSource(JSON.stringify({type:'excalidraw',version:2,elements:first.elements,files:{}}));
  assert.equal(first.summary.nodes,3);assert.equal(first.summary.edges,3);assert.equal(first.summary.checks.classes,3);
  const byRole=(role:string)=>first.elements.filter(e=>e.customData?.boardRole===role);
  const boxes=byRole('class'),names=byRole('class-name'),attributes=byRole('class-attribute'),methods=byRole('class-method'),separators=byRole('class-separator');
  assert.equal(boxes.length,3);assert.equal(names.length,3);assert.equal(attributes.length,5);assert.equal(methods.length,4);assert.equal(separators.length,6);
  const boxById=new Map(boxes.map(box=>[box.customData!.logicalId as string,box]));
  for(const box of boxes)assert.ok(box.groupIds.length>0,'class parts move together');
  for(const name of names){const box=boxById.get(name.customData!.logicalId as string)!;assert.equal(name.textAlign,'center');assert.ok(name.y>box.y&&name.y+name.height<box.y+36);}
  for(const attribute of attributes){const box=boxById.get(attribute.customData!.logicalId as string)!;assert.ok(attribute.x>=box.x&&attribute.x+attribute.width<=box.x+box.width);assert.ok(attribute.y>box.y+36);}
  const arrows=first.elements.filter(e=>e.type==='arrow');
  assert.equal(arrows.length,3);
  for(const arrow of arrows){assert.ok(arrow.startBinding&&arrow.endBinding);assert.ok(boxById.has(byRole('class').find(box=>box.id===arrow.startBinding!.elementId)!.customData!.logicalId as string));}
  const heads=Object.fromEntries(arrows.map(arrow=>[arrow.customData!.relationKind,arrow.endArrowhead]));
  assert.equal(heads.inheritance,undefined);assert.equal(heads.association,null);assert.equal(heads.aggregation,'diamond_outline');assert.equal(heads.dependency,'arrow');
  const dependency=arrows.find(arrow=>arrow.customData!.relationKind==='dependency')!;
  assert.equal(dependency.strokeStyle,'dashed');
  assert.deepEqual(byRole('relation-label').map(label=>label.originalText),['1..*']);
  const canvas=first.summary.checks.canvas;
  for(const element of first.elements.filter(e=>!['canvas','title'].includes(e.customData?.boardRole as string)))assert.ok(element.x>=0&&element.y>=0&&element.x+element.width<=canvas.width&&element.y+element.height<=canvas.height);
});

test('class schema rejects mixed models, unknown references and self relations',()=>{
  const base={title:'类图',summary:'校验',kind:'class',classes:[{id:'a',name:'A'},{id:'b',name:'B'}],relations:[{id:'r1',from:'a',to:'b'}]} as const;
  assert.equal(BoardDiagramSchema.safeParse(base).success,true);
  assert.equal(BoardDiagramSchema.safeParse({...base,classes:[{id:'a',name:'A'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,nodes:[{id:'n1',text:'节点'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,participants:[{id:'p1',name:'甲'},{id:'p2',name:'乙'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,relations:[{id:'r1',from:'a',to:'ghost'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,relations:[{id:'r1',from:'a',to:'a'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,relations:[{id:'r1',from:'a',to:'b',label:'x'.repeat(15)}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,classes:[{id:'a',name:'A',attributes:Array.from({length:9},(_,i)=>'a'+i)}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({title:'流程图',summary:'不能带类',classes:[{id:'a',name:'A'},{id:'b',name:'B'}],nodes:[{id:'n1',text:'步骤'}]}).success,false);
});

test('er kind builds entity boxes with typed fields and crowfoot cardinality',()=>{
  const erDiagram={title:'车辆数据 ER 图',summary:'车辆、传感器与读数。',kind:'er',entities:[
    {id:'vehicle',name:'Vehicle',fields:[{name:'vin',type:'String',pk:true},{name:'model',type:'String'}]},
    {id:'sensor',name:'Sensor',fields:[{name:'id',type:'String',pk:true},{name:'vehicle_vin',type:'String'}]},
    {id:'reading',name:'Reading',fields:[{name:'id',type:'String',pk:true},{name:'value',type:'Float'}]},
  ],entityRelations:[{id:'r1',from:'vehicle',to:'sensor',cardinality:'one-many',label:'安装'},{id:'r2',from:'sensor',to:'reading',cardinality:'one-many'},{id:'r3',from:'vehicle',to:'reading',cardinality:'one-one',label:'关联'}]};
  const first=generateBoardDiagram(erDiagram,namespace),again=generateBoardDiagram(erDiagram,namespace);
  assert.deepEqual(first,again);
  validateBoardSource(JSON.stringify({type:'excalidraw',version:2,elements:first.elements,files:{}}));
  assert.equal(first.summary.nodes,3);assert.equal(first.summary.edges,3);assert.equal(first.summary.checks.entities,3);
  const byRole=(role:string)=>first.elements.filter(e=>e.customData?.boardRole===role);
  assert.equal(byRole('entity').length,3);assert.equal(byRole('entity-name').length,3);assert.equal(byRole('entity-separator').length,3);
  assert.deepEqual(byRole('entity-field').map(e=>e.originalText).slice(0,2),['PK · vin : String','model : String']);
  const arrows=first.elements.filter(e=>e.type==='arrow');
  assert.equal(arrows.length,3);
  const heads=arrows.map(arrow=>[arrow.customData!.cardinality,arrow.startArrowhead,arrow.endArrowhead]);
  assert.ok(heads.some(([,start,end])=>start==='crowfoot_one'&&end==='crowfoot_many'));
  assert.ok(heads.some(([,start,end])=>start==='crowfoot_one'&&end==='crowfoot_one'));
  for(const arrow of arrows){assert.ok(arrow.startBinding&&arrow.endBinding);assert.equal(arrow.elbowed,arrow.points.length>2);}
  assert.deepEqual(byRole('er-label').map(label=>label.originalText),['安装','关联']);
  const canvas=first.summary.checks.canvas;
  for(const element of first.elements.filter(e=>!['canvas','title'].includes(e.customData?.boardRole as string)))assert.ok(element.x>=0&&element.y>=0&&element.x+element.width<=canvas.width&&element.y+element.height<=canvas.height);
});

test('er schema rejects mixed models, missing fields and invalid endpoints',()=>{
  const base={title:'ER',summary:'校验',kind:'er',entities:[{id:'a',name:'A',fields:[{name:'id'}]},{id:'b',name:'B',fields:[{name:'id'}]}],entityRelations:[{id:'r1',from:'a',to:'b'}]} as const;
  assert.equal(BoardDiagramSchema.safeParse(base).success,true);
  assert.equal(BoardDiagramSchema.safeParse({...base,entities:[{id:'a',name:'A',fields:[{name:'id'}]}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,entities:[{id:'a',name:'A',fields:[]},{id:'b',name:'B',fields:[{name:'id'}]}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,nodes:[{id:'n1',text:'节点'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,classes:[{id:'c1',name:'C'},{id:'c2',name:'D'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,entityRelations:[{id:'r1',from:'a',to:'ghost'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,entityRelations:[{id:'r1',from:'a',to:'a'}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({...base,entityRelations:[{id:'r1',from:'a',to:'b',label:'x'.repeat(15)}]}).success,false);
  assert.equal(BoardDiagramSchema.safeParse({title:'流程图',summary:'不能带实体',entities:[{id:'a',name:'A',fields:[{name:'id'}]},{id:'b',name:'B',fields:[{name:'id'}]}],nodes:[{id:'n1',text:'步骤'}]}).success,false);
});

test('straight fallback connects facing sides when orthogonal routing cannot place every relation',()=>{
  const boxes=[{id:'a',kind:'rectangle',x:0,y:0,width:160,height:100},{id:'b',kind:'rectangle',x:400,y:260,width:160,height:100}];
  const routes=straightConnectionRoutes(boxes,[{id:'r1',from:'a',to:'b'}]);
  assert.equal(routes.length,1);
  const route=routes[0]!;
  assert.equal(route.points.length,2,'fallback uses a single straight segment');
  const [start,end]=route.points;
  assert.equal(start![0],160,'starts on the source right edge');
  assert.equal(end![0],400,'ends on the target left edge');
  assert.equal(start![1],50);assert.equal(end![1],310);
  assert.deepEqual(route.start.fixedPoint,[1,.5]);assert.deepEqual(route.end.fixedPoint,[0,.5]);
  const below={id:'c',kind:'rectangle',x:20,y:520,width:160,height:100};
  const vertical=straightConnectionRoutes([boxes[0]!,below],[{id:'r2',from:'a',to:'c'}])[0]!;
  assert.deepEqual(vertical.start.fixedPoint,[.5,1]);assert.deepEqual(vertical.end.fixedPoint,[.5,0]);
  assert.equal(vertical.points[0]![1],100);assert.equal(vertical.points[1]![1],520);
});

test('title overlap check understands diagonal connectors instead of rejecting every diagonal',()=>{
  const canvas={id:'c',type:'rectangle',x:0,y:0,width:960,height:600,angle:0,locked:true,customData:{boardRole:'canvas'}};
  const title={id:'t',type:'text',x:32,y:32,width:896,height:38,angle:0,customData:{boardRole:'title'}};
  const diagonalBelow={id:'a1',type:'arrow',x:100,y:200,width:200,height:200,angle:0,points:[[0,0],[200,200]],startBinding:null,endBinding:null};
  assert.equal(checkBoardCanvas([canvas,title,diagonalBelow]).ok,true,'a diagonal below the title must not be reported');
  const crossing={id:'a2',type:'arrow',x:100,y:20,width:200,height:180,angle:0,points:[[0,0],[200,180]],startBinding:null,endBinding:null};
  const result=checkBoardCanvas([canvas,title,crossing]);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>error.startsWith('BOARD_TITLE_OVERLAP:a2')));
});

test('long field and attribute text wraps inside its compartment instead of overlapping the next row',()=>{
  const longText='字段名称非常长需要换行显示以验证布局是否仍然正确并且在框内完整呈现'.slice(0,60);
  const erDiagram={title:'长字段 ER',summary:'换行布局',kind:'er',entities:[
    {id:'a',name:'EntityA',fields:[{name:longText,type:'String',pk:true},{name:longText},{name:'id',type:'String'}]},
    {id:'b',name:'EntityB',fields:[{name:'id',type:'String'}]}],
    entityRelations:[{id:'r1',from:'a',to:'b',cardinality:'one-many'}]};
  const er=generateBoardDiagram(erDiagram,namespace);
  const erBox=er.elements.find(e=>e.customData?.boardRole==='entity'&&e.customData.logicalId==='a')!;
  const erFields=er.elements.filter(e=>e.customData?.boardRole==='entity-field'&&e.customData.logicalId==='a').sort((x,y)=>x.y-y.y);
  assert.equal(erFields.length,3);
  for(const field of erFields)assert.ok(field.y>=erBox.y&&field.y+field.height<=erBox.y+erBox.height+1e-6,'field stays inside its entity box');
  for(let index=1;index<erFields.length;index++)assert.ok(erFields[index]!.y>=erFields[index-1]!.y+erFields[index-1]!.height-1e-6,'wrapped rows never overlap');
  assert.ok(erFields[0]!.height>22,'wrapped text is taller than a single row');

  const classDiagram={title:'长属性类图',summary:'换行布局',kind:'class',classes:[
    {id:'a',name:'Service',attributes:[longText,longText],methods:[longText]},
    {id:'b',name:'Repo',attributes:['- id: String'],methods:['+ find(): Repo']}],
    relations:[{id:'r1',from:'a',to:'b',kind:'dependency'}]};
  const cls=generateBoardDiagram(classDiagram,namespace);
  const clsBox=cls.elements.find(e=>e.customData?.boardRole==='class'&&e.customData.logicalId==='a')!;
  const attributes=cls.elements.filter(e=>e.customData?.boardRole==='class-attribute'&&e.customData.logicalId==='a').sort((x,y)=>x.y-y.y);
  const methods=cls.elements.filter(e=>e.customData?.boardRole==='class-method'&&e.customData.logicalId==='a').sort((x,y)=>x.y-y.y);
  for(const element of [...attributes,...methods])assert.ok(element.y>=clsBox.y&&element.y+element.height<=clsBox.y+clsBox.height+1e-6,'class text stays inside the box');
  for(let index=1;index<attributes.length;index++)assert.ok(attributes[index]!.y>=attributes[index-1]!.y+attributes[index-1]!.height-1e-6);
  assert.ok(methods[0]!.y>=attributes.at(-1)!.y+attributes.at(-1)!.height-1e-6,'methods start below the attribute compartment');
});

test('class and er relation labels size masks to wrapped text and keep clear of boxes',()=>{
  const longLabel='关系标签非常长需要换行';
  const cls=generateBoardDiagram({title:'长标签类图',summary:'长标签',kind:'class',classes:[{id:'a',name:'Alpha',attributes:['+ id: String'],methods:['+ run(): void']},{id:'b',name:'Beta',attributes:['+ id: String'],methods:['+ stop(): void']}],relations:[{id:'r1',from:'a',to:'b',kind:'association',label:longLabel}]},namespace);
  const clsMask=cls.elements.find(e=>e.customData?.boardRole==='relation-label-mask')!,clsText=cls.elements.find(e=>e.customData?.boardRole==='relation-label')!;
  assert.ok(clsMask.height>24,'mask height follows the wrapped label');
  assert.equal(clsText.text.split('\n').length,2);
  assert.ok(clsText.y>=clsMask.y&&clsText.y+clsText.height<=clsMask.y+clsMask.height+1e-6,'wrapped relation text stays inside its mask');
  assert.ok(cls.elements.filter(e=>e.customData?.boardRole==='class').every(box=>!overlaps(clsMask,box)),'relation label never covers a class box');
  assert.equal(checkBoardCanvas(cls.elements).ok,true);

  const er=generateBoardDiagram({title:'长标签 ER',summary:'长标签',kind:'er',entities:[{id:'a',name:'Alpha',fields:[{name:'id',type:'String',pk:true}]},{id:'b',name:'Beta',fields:[{name:'id',type:'String'}]}],entityRelations:[{id:'r1',from:'a',to:'b',cardinality:'one-many',label:longLabel},{id:'r2',from:'a',to:'b',cardinality:'one-one',label:longLabel}]},namespace);
  const erMasks=er.elements.filter(e=>e.customData?.boardRole==='er-label-mask'),erTexts=er.elements.filter(e=>e.customData?.boardRole==='er-label'),erBoxes=er.elements.filter(e=>e.customData?.boardRole==='entity');
  assert.equal(erMasks.length,2);assert.ok(erMasks.every(mask=>mask.height>24));
  for(const mask of erMasks){const text=erTexts.find(element=>element.containerId===mask.id)!;assert.ok(text.y>=mask.y&&text.y+text.height<=mask.y+mask.height+1e-6,'wrapped ER label stays inside its mask');assert.ok(erBoxes.every(box=>!overlaps(mask,box)),'ER label never covers an entity box');}
  for(let index=1;index<erMasks.length;index++)assert.equal(overlaps(erMasks[index]!,erMasks[index-1]!),false,'ER labels do not cover each other');
  assert.equal(checkBoardCanvas(er.elements).ok,true);
});

test('dense class and er relations place every wrapped label clear of boxes and other labels',()=>{
  const longLabel='关系标签非常长需要换行',pairs=[['c0','c1'],['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5'],['c5','c0'],['c0','c2'],['c1','c3'],['c2','c4'],['c3','c5']];
  const classes=Array.from({length:6},(_,index)=>({id:'c'+index,name:'Class'+index,attributes:['+ id: String','+ value: String'],methods:['+ run(): void']}));
  const cls=generateBoardDiagram({title:'密集类图',summary:'密集关系',kind:'class',classes,relations:pairs.map(([from,to],index)=>({id:'r'+index,from:from!,to:to!,kind:'association',label:longLabel}))},namespace);
  const entities=Array.from({length:6},(_,index)=>({id:'e'+index,name:'Entity'+index,fields:[{name:'id',type:'String',pk:true},{name:'value',type:'Float'}]}));
  const er=generateBoardDiagram({title:'密集 ER',summary:'密集关系',kind:'er',entities,entityRelations:pairs.map(([from,to],index)=>({id:'r'+index,from:'e'+from!.slice(1),to:'e'+to!.slice(1),cardinality:'one-many',label:longLabel}))},namespace);
  const verify=(result:ReturnType<typeof generateBoardDiagram>,boxRole:string,maskRole:string,textRole:string)=>{
    const masks=result.elements.filter(e=>e.customData?.boardRole===maskRole),boxes=result.elements.filter(e=>e.customData?.boardRole===boxRole),texts=result.elements.filter(e=>e.customData?.boardRole===textRole);
    assert.equal(masks.length,10);assert.ok(masks.every(mask=>mask.height>24));
    for(const mask of masks){const text=texts.find(element=>element.containerId===mask.id)!;assert.ok(text.y>=mask.y&&text.y+text.height<=mask.y+mask.height+1e-6,'label text fits its mask');assert.ok(boxes.every(box=>!overlaps(mask,box)),'label mask keeps clear of '+boxRole);assert.ok(masks.every(other=>other===mask||!overlaps(mask,other)),'label masks never cover each other');}
    assert.ok(masks.every(mask=>mask.x>=0&&mask.y>=0&&mask.x+mask.width<=result.summary.checks.canvas.width&&mask.y+mask.height<=result.summary.checks.canvas.height));
    assert.equal(checkBoardCanvas(result.elements).ok,true);
  };
  verify(cls,'class','relation-label-mask','relation-label');verify(er,'entity','er-label-mask','er-label');
});

test('canvas checker reports relation label masks covering boxes or other labels',()=>{
  const source=structuredClone(generateBoardDiagram({title:'标签遮挡',summary:'标签不得遮挡',kind:'er',entities:[{id:'a',name:'Alpha',fields:[{name:'id'}]},{id:'b',name:'Beta',fields:[{name:'id'}]}],entityRelations:[{id:'r1',from:'a',to:'b',label:'安装'},{id:'r2',from:'a',to:'b',label:'关联'}]},namespace).elements);
  const masks=source.filter(e=>e.customData?.boardRole==='er-label-mask'),box=source.find(e=>e.customData?.boardRole==='entity')!;
  masks[0]!.x=box.x;masks[0]!.y=box.y;
  assert.ok(checkBoardCanvas(source).errors.some(error=>error.startsWith('BOARD_LABEL_OVERLAP:'+masks[0]!.id+':'+box.id)),'a mask dragged onto an entity box is rejected');
  const stacked=structuredClone(generateBoardDiagram({title:'标签遮挡',summary:'标签不得遮挡',kind:'er',entities:[{id:'a',name:'Alpha',fields:[{name:'id'}]},{id:'b',name:'Beta',fields:[{name:'id'}]}],entityRelations:[{id:'r1',from:'a',to:'b',label:'安装'},{id:'r2',from:'a',to:'b',label:'关联'}]},namespace).elements);
  const stackedMasks=stacked.filter(e=>e.customData?.boardRole==='er-label-mask');stackedMasks[0]!.x=stackedMasks[1]!.x;stackedMasks[0]!.y=stackedMasks[1]!.y;
  assert.ok(checkBoardCanvas(stacked).errors.some(error=>error.startsWith('BOARD_LABEL_OVERLAP:')&&error.includes(stackedMasks[0]!.id)&&error.includes(stackedMasks[1]!.id)),'stacked masks are rejected');
});

test('relation labels that cannot fit any free area fail with an explicit layout error',()=>{
  const longAttr='非常长的属性名称需要换行显示并验证布局是否仍然正确并且在框内完整呈现'.slice(0,60),pairs=[['c0','c1'],['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5'],['c5','c0'],['c0','c2'],['c1','c3'],['c2','c4'],['c3','c5']];
  const classes=Array.from({length:6},(_,index)=>({id:'c'+index,name:'Class'+index,attributes:[longAttr,...Array.from({length:7},(_,attr)=>'attr'+attr)],methods:['+ run(): void']}));
  assert.throws(()=>generateBoardDiagram({title:'无位可放',summary:'密集标签',kind:'class',classes,relations:pairs.map(([from,to],index)=>({id:'r'+index,from:from!,to:to!,kind:'association',label:'关系标签非常长需要换行'}))},namespace),/BOARD_LABEL_UNPLACEABLE/);
});

test('sequence rows grow with wrapped message labels instead of pressing arrows or overflowing',()=>{
  const longText='这是一个非常长的消息标签用于测试时序图在高密度布局下是否会压住箭头以及后续消息并且是否会导致画布溢出的真实缺陷'.repeat(2).slice(0,110);
  const messages=Array.from({length:8},(_,index)=>({id:'m'+index,from:index%2?'b':'a',to:index%2?'a':'b',text:index===7?longText:'短消息'+index}));
  const result=generateBoardDiagram({title:'长消息时序',summary:'长消息标签',kind:'sequence',participants:[{id:'a',name:'甲'},{id:'b',name:'乙'}],messages},namespace);
  const arrows=result.elements.filter(e=>e.customData?.boardRole==='message'),labels=result.elements.filter(e=>e.customData?.boardRole==='message-label');
  assert.equal(arrows.length,8);assert.equal(labels.length,8);assert.ok(labels[7]!.height>18.9*4,'the long message wraps to several lines');
  for(let index=0;index<labels.length;index++){assert.ok(labels[index]!.y+labels[index]!.height<=arrows[index]!.y-6,'message label stays above its arrow');if(index)assert.ok(labels[index]!.y>=labels[index-1]!.y+labels[index-1]!.height+8-1e-6,'wrapped labels keep a readable gap');}
  assert.ok(arrows[7]!.y-arrows[6]!.y>56,'row pitch grows for the wrapped label');
  const canvas=result.summary.checks.canvas;assert.ok(labels.every(label=>label.y>=0&&label.y+label.height<=canvas.height),'every label stays inside the taller canvas');
  assert.equal(checkBoardCanvas(result.elements).ok,true);
});

test('sequence participant headers grow with wrapped names and keep lifelines attached',()=>{
  const result=generateBoardDiagram({title:'长参与者名',summary:'表头随名字换行',kind:'sequence',participants:[{id:'a',name:'非常长的参与者名称需要换行显示'},{id:'b',name:'短名'}],messages:[{id:'m1',from:'a',to:'b',text:'请求'},{id:'m2',from:'b',to:'a',text:'返回',kind:'return'}]},namespace);
  const headers=result.elements.filter(e=>e.customData?.boardRole==='participant'),names=result.elements.filter(e=>e.customData?.boardRole==='participant-name'),lifelines=result.elements.filter(e=>e.customData?.boardRole==='lifeline'),labels=result.elements.filter(e=>e.customData?.boardRole==='message-label');
  const header=headers.find(e=>e.customData.logicalId==='a')!,name=names.find(e=>e.customData.logicalId==='a')!,lifeline=lifelines.find(e=>e.customData.logicalId==='a')!;
  assert.ok(header.height>48,'header grows for the wrapped name');
  assert.ok(name.y>=header.y&&name.y+name.height<=header.y+header.height+1e-6,'wrapped participant name stays inside its header');
  assert.ok(headers.every(other=>other.height===header.height));assert.equal(lifeline.y,header.y+header.height,'lifeline starts at the real header bottom');
  assert.ok(labels.every(label=>label.y>=header.y+header.height),'first message label starts below the taller header');
  assert.equal(checkBoardCanvas(result.elements).ok,true);
});

test('sequence layout rejects dense wrapped messages with a bounded-canvas error instead of overflow',()=>{
  const text='这是一个非常长的消息标签用于测试时序图在高密度布局下是否会压住箭头以及后续消息并且是否会导致画布溢出的真实缺陷'.repeat(3).slice(0,120);
  const messages=Array.from({length:14},(_,index)=>({id:'m'+index,from:index%2?'b':'a',to:index%2?'a':'b',text}));
  assert.throws(()=>generateBoardDiagram({title:'超密时序',summary:'长标签',kind:'sequence',participants:[{id:'a',name:'A'},{id:'b',name:'B'}],messages},namespace),/BOARD_LAYOUT_TOO_DENSE/);
});
