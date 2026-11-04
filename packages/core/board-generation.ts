import {z} from 'zod';
import type {BoardElement} from './board-changes.ts';
import {routeBoard,grid,gridUp,textBudget,boxesOverlap,segmentHitsBox,type Box,type Rect} from './board-routing.ts';

const plainText=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|<\s*\/?\s*[a-z][^>]*>|(?:javascript|vbscript|data)\s*:/i.test(s),'BOARD_PLAIN_TEXT_REQUIRED');
const identity=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/);
const coordinate=z.number().finite().min(-10000).max(10000);
export const BoardDiagramSchema=z.object({
  title:plainText(160),summary:plainText(1000),size:z.enum(['auto','slide-16x9','doc-inline','doc-wide']).default('auto'),direction:z.enum(['right','down']).default('down'),
  nodes:z.array(z.object({id:identity,kind:z.enum(['rectangle','diamond','ellipse','text']).default('rectangle'),text:plainText(240),tone:z.enum(['neutral','accent']).default('neutral'),x:coordinate.optional(),y:coordinate.optional(),width:z.number().finite().min(120).max(480).optional(),height:z.number().finite().min(64).max(400).optional()}).strict().refine(n=>(n.x===undefined)===(n.y===undefined),'BOARD_COORDINATES_PAIR_REQUIRED')).min(1).max(9),
  edges:z.array(z.object({id:identity,from:identity,to:identity,label:plainText(56).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_EDGE_LABEL_SHORT_SINGLE_LINE_REQUIRED').optional()}).strict()).max(12).default([]),
}).strict().superRefine((diagram,ctx)=>{
  const ids=new Set<string>();
  for(const item of [...diagram.nodes,...diagram.edges]){if(ids.has(item.id))ctx.addIssue({code:'custom',message:'BOARD_DUPLICATE_ID'});ids.add(item.id);}
  const nodes=new Map(diagram.nodes.map(n=>[n.id,n]));
  for(const edge of diagram.edges)if(edge.from===edge.to||!nodes.has(edge.from)||!nodes.has(edge.to)||nodes.get(edge.from)?.kind==='text'||nodes.get(edge.to)?.kind==='text')ctx.addIssue({code:'custom',message:'BOARD_EDGE_REFERENCE_INVALID'});
  if(diagram.nodes.filter(n=>n.tone==='accent').length>2)ctx.addIssue({code:'custom',message:'BOARD_ACCENT_BUDGET: 最多2个强调节点'});
  for(const node of diagram.nodes.filter(n=>n.kind==='diamond')){const outgoing=diagram.edges.filter(e=>e.from===node.id);if(outgoing.length<2||outgoing.length>3||outgoing.some(e=>!e.label))ctx.addIssue({code:'custom',message:'BOARD_DECISION_BRANCHES_REQUIRED: 决策须有2–3条带标签的出边'});}
});
export type BoardDiagram=z.infer<typeof BoardDiagramSchema>;

export const BOARD_CANVASES={wide:{width:1280,height:720},standard:{width:960,height:720},portrait:{width:800,height:1000},inline:{width:960,height:600}} as const;
type SizedNode={node:BoardDiagram['nodes'][number];width:number;height:number;text:BoardElement};

// Candidate coordinates are decided before routing. Font sizes never shrink to fit a canvas.
function compactCandidates(diagram:BoardDiagram,sizes:SizedNode[],bounds:Rect,levels:Map<string,number>):Box[][]{
  const result:Box[][]=[],fixed=sizes.every(s=>s.node.x!==undefined);
  const add=(positions:{x:number;y:number}[])=>{const boxes=sizes.map((s,i)=>({id:s.node.id,kind:s.node.kind,x:grid(s.node.x??positions[i]!.x),y:grid(s.node.y??positions[i]!.y),width:s.width,height:s.height}));if(boxes.every(b=>b.x>=bounds.x&&b.y>=bounds.y&&b.x+b.width<=bounds.x+bounds.width&&b.y+b.height<=bounds.y+bounds.height))result.push(boxes);};
  if(fixed){add(sizes.map(s=>({x:s.node.x!,y:s.node.y!})));return result;}
  const ranks=[...new Set(levels.values())].sort((a,b)=>a-b),inset=32;
  for(const direction of [diagram.direction,diagram.direction==='down'?'right':'down'] as const){
    let axis=direction==='down'?bounds.y+inset:bounds.x+inset;const positions=new Map<string,{x:number;y:number}>();
    for(const rank of ranks){const group=sizes.filter(s=>levels.get(s.node.id)===rank),crossSize=group.reduce((sum,s)=>sum+(direction==='down'?s.width:s.height),0)+(group.length-1)*40;let cross=(direction==='down'?bounds.x:bounds.y)+((direction==='down'?bounds.width:bounds.height)-crossSize)/2;for(const s of group){positions.set(s.node.id,direction==='down'?{x:cross,y:axis}:{x:axis,y:cross});cross+=(direction==='down'?s.width:s.height)+40;}axis+=Math.max(...group.map(s=>direction==='down'?s.height:s.width))+(group.some(s=>s.node.kind==='diamond')?64:48);}
    add(sizes.map(s=>positions.get(s.node.id)!));
  }
  // Compact grid candidates use a bounded deterministic placement search. It is a
  // layout heuristic, not a promise to embed every graph; the router rejects failures.
  const ids=sizes.map(s=>s.node.id),edgeIndices=diagram.edges.map(e=>[ids.indexOf(e.from),ids.indexOf(e.to)] as const);
  for(const columns of [3,4,2]){
    const rows=Math.ceil(sizes.length/columns),cellW=(bounds.width-inset*2)/columns,cellH=(bounds.height-inset*2)/rows;
    if(sizes.some(s=>s.width+40>cellW||s.height+40>cellH))continue;
    const slots=Array.from({length:columns*rows},(_,i)=>({x:bounds.x+inset+(i%columns+.5)*cellW,y:bounds.y+inset+(Math.floor(i/columns)+.5)*cellH}));
    const score=(order:number[])=>{let cost=0;const ps=order.slice(0,sizes.length).map(i=>slots[i]!);for(const [a,b]of edgeIndices){const u=ps[a]!,v=ps[b]!;cost+=Math.abs(u.x-v.x)+Math.abs(u.y-v.y);for(let i=0;i<ps.length;i++){if(i===a||i===b)continue;const p=ps[i]!,cross=(v.x-u.x)*(p.y-u.y)-(v.y-u.y)*(p.x-u.x);if(Math.abs(cross)<1&&p.x>=Math.min(u.x,v.x)&&p.x<=Math.max(u.x,v.x)&&p.y>=Math.min(u.y,v.y)&&p.y<=Math.max(u.y,v.y))cost+=3000;}}
      for(let i=0;i<edgeIndices.length;i++)for(let j=0;j<i;j++){const[a,b]=edgeIndices[i]!,[c,d]=edgeIndices[j]!;if([a,b].includes(c)||[a,b].includes(d))continue;const u=ps[a]!,v=ps[b]!,p=ps[c]!,q=ps[d]!,cross=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(cross(u,v,p)*cross(u,v,q)<0&&cross(p,q,u)*cross(p,q,v)<0)cost+=8000;}
      for(let i=0;i<sizes.length;i++){const p=ps[i]!;if(!edgeIndices.some(([,to])=>to===i))cost+=(p.x-bounds.x)*3+(p.y-bounds.y)*5;if(!edgeIndices.some(([from])=>from===i))cost+=(bounds.x+bounds.width-p.x)*3+(bounds.y+bounds.height-p.y)*5;}
      return cost;};
    let random=7919+columns;const rand=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};const pool:{order:number[];score:number}[]=[];
    for(let restart=0;restart<12;restart++){let order=Array.from({length:slots.length},(_,i)=>i);if(restart)for(let i=order.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[order[i],order[j]]=[order[j]!,order[i]!];}let current=score(order),best=order.slice(),bestScore=current;for(let step=0;step<360;step++){const a=Math.floor(rand()*order.length),b=Math.floor(rand()*order.length);if(a===b)continue;[order[a],order[b]]=[order[b]!,order[a]!];const next=score(order),temperature=800*(1-step/360);if(next<current||rand()<Math.exp((current-next)/Math.max(1,temperature))){current=next;if(next<bestScore){bestScore=next;best=order.slice();}}else[order[a],order[b]]=[order[b]!,order[a]!];}pool.push({order:best,score:bestScore});}
    for(const candidate of pool.sort((a,b)=>a.score-b.score).slice(0,8))add(sizes.map((s,i)=>({x:slots[candidate.order[i]!]!.x-s.width/2,y:slots[candidate.order[i]!]!.y-s.height/2})));
  }
  const seen=new Set<string>();return result.filter(boxes=>{const key=boxes.map(b=>b.x+','+b.y).join(';');if(seen.has(key))return false;seen.add(key);return true;});
}

export function boardPreviewDimensions(width:number,height:number){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('BOARD_EXPORT_SIZE_INVALID');
  const scale=Math.min(1,2400/Math.max(width,height));
  return {width:width*scale,height:height*scale,scale};
}

/** Check actual native scene geometry, including edits made after generation. */
export function checkBoardCanvas(elements:readonly BoardElement[]){
  const live=elements.filter(e=>!e.isDeleted),frames=live.filter(e=>e.customData?.boardRole==='canvas');
  if(!frames.length)return{ok:true,errors:[] as string[],canvas:null};
  const frame=frames[0]!,errors:string[]=[],canvas={size:String(frame.customData.size),width:frame.width,height:frame.height};
  if(frames.length!==1||frame.type!=='rectangle'||frame.x!==0||frame.y!==0||frame.angle!==0||!frame.locked||!Number.isFinite(frame.width)||!Number.isFinite(frame.height)||frame.width<=0||frame.height<=0)errors.push('BOARD_CANVAS_INVALID');
  const inside=(x:number,y:number)=>Number.isFinite(x)&&Number.isFinite(y)&&x>=-1e-6&&y>=-1e-6&&x<=frame.width+1e-6&&y<=frame.height+1e-6;
  const title=live.find(e=>e.customData?.boardRole==='title');
  for(const element of live){if(element===frame)continue;
    if(element.angle!==0){errors.push('BOARD_CANVAS_ROTATED:'+element.id);continue;}
    const points=Array.isArray(element.points)?element.points.map((p:number[])=>[element.x+p[0]!,element.y+p[1]!] as [number,number]):null;
    if(points?!points.every(([x,y]:[number,number])=>inside(x,y)):!inside(element.x,element.y)||!inside(element.x+element.width,element.y+element.height))errors.push('BOARD_CANVAS_OVERFLOW:'+element.id);
    if(title&&element!==title){const hitsTitle=points?points.slice(1).some((p:[number,number],i:number)=>segmentHitsBox(points[i]!,p,title)):boxesOverlap(element,title);if(hitsTitle)errors.push('BOARD_TITLE_OVERLAP:'+element.id);}
  }
  return{ok:!errors.length,errors,canvas};
}

// Pure, bounded conversion. Models cannot supply source objects, URLs, scripts, files or bindings.
export function generateBoardDiagram(input:unknown,namespace:string){
  if(!/^[a-f0-9-]{36}$/i.test(namespace))throw Error('BOARD_GENERATION_ID_INVALID');
  const diagram=BoardDiagramSchema.parse(input),elements:BoardElement[]=[],prefix='gen-'+namespace+'-',fontSize=18,lineHeight=1.35;
  const seed=(id:string)=>{let v=2166136261;for(const c of id)v=Math.imul(v^c.charCodeAt(0),16777619);return (v>>>0)%2147483646+1;};
  const base=(id:string,type:string,x:number,y:number,width:number,height:number):BoardElement=>({id:prefix+id,type,x,y,width,height,angle:0,strokeColor:'#292f32',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id+'nonce'),isDeleted:false,boundElements:[],updated:0,link:null,locked:false});
  const charWidth=(c:string,size:number,fullEm:boolean)=>fullEm?size:textBudget(c,size);
  const wrap=(text:string,width:number,size:number,fullEm:boolean)=>text.split('\n').flatMap(line=>{const lines:string[]=[];let row='',used=0;for(const c of line){const next=charWidth(c,size,fullEm);if(row&&used+next>width){lines.push(row);row='';used=0;}row+=c;used+=next;}lines.push(row);return lines;}).join('\n');
  const label=(id:string,text:string,x:number,y:number,width:number,containerId:string|null=null,size=fontSize,fullEm=false):BoardElement=>{
    const wrapped=wrap(text,width,size,fullEm),height=wrapped.split('\n').length*size*lineHeight;
    return {...base(id,'text',x,y,width,height),strokeWidth:1,fontSize:size,fontFamily:2,text:wrapped,originalText:text,textAlign:containerId?'center':'left',verticalAlign:containerId?'middle':'top',containerId,autoResize:false,lineHeight};
  };
  // Ignore DFS back-edges for rank assignment, then route them through independent outer lanes.
  const levels=new Map(diagram.nodes.map(n=>[n.id,0])),incoming=new Map(diagram.nodes.map(n=>[n.id,0]));
  const state=new Map<string,number>(),backEdges=new Set<string>();
  const visit=(id:string)=>{state.set(id,1);for(const edge of diagram.edges.filter(e=>e.from===id)){if(state.get(edge.to)===1)backEdges.add(edge.id);else if(!state.has(edge.to))visit(edge.to);}state.set(id,2);};
  for(const node of diagram.nodes)if(!state.has(node.id))visit(node.id);
  const forward=diagram.edges.filter(e=>!backEdges.has(e.id));
  for(const e of forward)incoming.set(e.to,incoming.get(e.to)!+1);
  const queue=diagram.nodes.filter(n=>!incoming.get(n.id)).map(n=>n.id),visited=new Set<string>();
  while(queue.length){const id=queue.shift()!;visited.add(id);for(const e of forward.filter(e=>e.from===id)){levels.set(e.to,Math.max(levels.get(e.to)!,levels.get(id)!+1));incoming.set(e.to,incoming.get(e.to)!-1);if(incoming.get(e.to)===0)queue.push(e.to);}}
  if(visited.size!==diagram.nodes.length)diagram.nodes.forEach((n,i)=>levels.set(n.id,i));
  const placed=new Map<string,BoardElement>();
  const sizes=diagram.nodes.map(node=>{const width=gridUp(node.width??(node.kind==='diamond'?224:node.kind==='ellipse'?160:176)),inner=width*(node.kind==='diamond'?.64:node.kind==='ellipse'?.68:1)-(node.kind==='rectangle'||node.kind==='text'?32:24),text=label('t_'+node.id,node.text,0,0,inner),minimum=text.height*(node.kind==='diamond'?2:node.kind==='ellipse'?1.5:1)+32,height=gridUp(Math.max(node.height??(node.kind==='diamond'?104:64),minimum));if(height>400)throw Error('BOARD_NODE_TEXT_TOO_LARGE: 请缩短节点文字或拆分为详情图');return{node,width,height,text};});
  const frames=diagram.size==='auto'?[BOARD_CANVASES.standard,BOARD_CANVASES.wide,BOARD_CANVASES.portrait]:[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide];
  let chosen:{frame:{width:number;height:number};bounds:Rect;title:BoardElement;boxes:Box[];routing:ReturnType<typeof routeBoard>}|undefined;const failures:string[]=[];
  for(const frame of frames){const titleSize=diagram.size==='slide-16x9'?40:28,title=label('title',diagram.title,32,32,frame.width-64,null,titleSize,true);if(title.text.split('\n').length>2){failures.push('BOARD_TITLE_TOO_LONG');continue;}title.customData={boardRole:'title'};const top=gridUp(title.y+title.height+24),bounds={x:32,y:top,width:frame.width-64,height:frame.height-top-32};
    const candidates=compactCandidates(diagram,sizes,bounds,levels);
    for(const boxes of candidates){try{const routing=routeBoard(boxes,diagram.edges,diagram.direction,{bounds,nodeGap:40,escape:24,nodeClearance:12});chosen={frame,bounds,title,boxes,routing};break;}catch(error){failures.push((error as Error).message);}}
    if(chosen)break;
  }
  if(!chosen){if(failures.length&&failures.every(f=>f==='BOARD_TITLE_TOO_LONG'))throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');if(diagram.nodes.some(n=>n.x!==undefined)&&!failures.length)throw Error('BOARD_CANVAS_OVERFLOW: 显式坐标或节点尺寸超出所选画幅内容区');if(diagram.nodes.every(n=>n.x!==undefined)&&failures.some(f=>f.startsWith('BOARD_NODE_OVERLAP')))throw Error(failures.find(f=>f.startsWith('BOARD_NODE_OVERLAP')));throw Error('BOARD_LAYOUT_TOO_DENSE: 在固定画幅与可读字号下无法可靠布线，请拆成概览与详情图或调整坐标',{cause:{failures:failures.slice(0,6)}});}
  for(const {node,width,height,text} of sizes){const {x,y}=chosen.boxes.find(b=>b.id===node.id)!;
    if(node.kind==='text'){Object.assign(text,{id:prefix+'n_'+node.id,x,y,width,textAlign:'left',containerId:null});elements.push(text);placed.set(node.id,text);continue;}
    const shape=base('n_'+node.id,node.kind,x,y,width,height);shape.backgroundColor=node.tone==='accent'?'#e9f0f1':'#ffffff';shape.strokeColor=node.tone==='accent'?'#356c7c':'#687176';shape.roundness=node.kind==='rectangle'?{type:3,value:8}:null;shape.customData={boardRole:'node',logicalId:node.id};
    Object.assign(text,{x:x+(width-text.width)/2,y:y+(height-text.height)/2,containerId:shape.id,textAlign:'center',verticalAlign:'middle'});shape.boundElements=[{id:text.id,type:'text'}];elements.push(shape,text);placed.set(node.id,shape);
  }
  const {routes,check}=chosen.routing,arrows:BoardElement[]=[],labels:BoardElement[]=[];
  for(const route of routes){const from=placed.get(route.from)!,to=placed.get(route.to)!,a=route.points[0]!,points=route.points.map(p=>[p[0]-a[0],p[1]-a[1]]),width=Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),height=Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]));
    const arrow:BoardElement={...base('e_'+route.id,'arrow',a[0],a[1],width,height),strokeColor:'#687176',points,lastCommittedPoint:null,startBinding:{elementId:from.id,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:to.id,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead:null,endArrowhead:'arrow',elbowed:true,fixedSegments:points.slice(2,-1).map((end,i)=>({index:i+2,start:points[i+1],end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'edge',logicalId:route.id,from:route.from,to:route.to}};from.boundElements.push({id:arrow.id,type:'arrow'});to.boundElements.push({id:arrow.id,type:'arrow'});arrows.push(arrow);
    if(route.label){const box=route.label,mask=base('m_'+route.id,'rectangle',box.x,box.y,box.width,box.height),text=label('l_'+route.id,box.text,box.x+8,box.y+6,box.width-16,mask.id,14);mask.backgroundColor='#ffffff';mask.strokeColor='#ffffff';mask.strokeWidth=1;mask.customData={boardRole:'edge-label-mask',edgeId:route.id,gap:box.gap};mask.boundElements=[{id:text.id,type:'text'}];text.customData={boardRole:'edge-label',edgeId:route.id};const group=prefix+'label-group_'+route.id;mask.groupIds=[group];text.groupIds=[group];labels.push(mask,text);}
  }
  elements.unshift(...arrows,...labels);
  const canvas={...base('canvas','rectangle',0,0,chosen.frame.width,chosen.frame.height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width:chosen.frame.width,height:chosen.frame.height}};
  elements.unshift(canvas,chosen.title);
  // All generated roles have distinct ID prefixes, independent of caller-selected identifiers.
  if(new Set(elements.map(e=>e.id)).size!==elements.length)throw Error('BOARD_RESERVED_ID_COLLISION');
  const frameCheck=checkBoardCanvas(elements);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
  return{diagram,elements,summary:{nodes:diagram.nodes.length,edges:diagram.edges.length,text:diagram.summary,checks:{...check,frameContained:true,canvas:{size:diagram.size,...chosen.frame,contentBounds:chosen.bounds},accents:diagram.nodes.filter(n=>n.tone==='accent').length,budget:{nodes:9,arrows:12,accents:2},cornerRadius:'native-elbow-max-16'}},routes};
}
