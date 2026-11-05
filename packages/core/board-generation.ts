import {z} from 'zod';
import type {BoardElement} from './board-changes.ts';
import {routeBoard,grid,gridUp,textBudget,boxesOverlap,segmentHitsBox,segmentIntersectsBox,type Box,type Rect} from './board-routing.ts';

const plainText=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|<\/?[a-z][^>]*>|(?<![a-z0-9_])(?:javascript|vbscript|data)\s*:/i.test(s),'BOARD_PLAIN_TEXT_REQUIRED');
const identity=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/);
const coordinate=z.number().finite().min(-10000).max(10000);
export const BoardDiagramSchema=z.object({
  title:plainText(160),summary:plainText(1000),size:z.enum(['auto','slide-16x9','doc-inline','doc-wide']).default('auto'),direction:z.enum(['right','down']).default('down'),
  kind:z.enum(['flow','swimlane','sequence','class','er']).default('flow'),
  lanes:z.array(z.object({id:identity,name:plainText(24)}).strict()).min(2).max(4).optional(),
  participants:z.array(z.object({id:identity,name:plainText(32)}).strict()).min(2).max(6).optional(),
  messages:z.array(z.object({id:identity,from:identity,to:identity,text:plainText(120),kind:z.enum(['sync','return','self']).default('sync')}).strict()).min(1).max(14).optional(),
  classes:z.array(z.object({id:identity,name:plainText(40),attributes:z.array(plainText(60)).max(8).default([]),methods:z.array(plainText(60)).max(8).default([])}).strict()).min(2).max(6).optional(),
  relations:z.array(z.object({id:identity,from:identity,to:identity,kind:z.enum(['association','aggregation','composition','inheritance','dependency']).default('association'),label:plainText(20).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_RELATION_LABEL_SHORT_SINGLE_LINE_REQUIRED').optional()}).strict()).max(10).optional(),
  entities:z.array(z.object({id:identity,name:plainText(40),fields:z.array(z.object({name:plainText(40),type:plainText(30).optional(),pk:z.boolean().default(false)}).strict()).min(1).max(10)}).strict()).min(2).max(6).optional(),
  entityRelations:z.array(z.object({id:identity,from:identity,to:identity,cardinality:z.enum(['one-one','one-many','many-many']).default('one-many'),label:plainText(20).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_RELATION_LABEL_SHORT_SINGLE_LINE_REQUIRED').optional()}).strict()).max(10).optional(),
  nodes:z.array(z.object({id:identity,kind:z.enum(['rectangle','diamond','ellipse','text']).default('rectangle'),text:plainText(240),tone:z.enum(['neutral','accent']).default('neutral'),lane:identity.optional(),x:coordinate.optional(),y:coordinate.optional(),width:z.number().finite().min(120).max(480).optional(),height:z.number().finite().min(64).max(400).optional()}).strict().refine(n=>(n.x===undefined)===(n.y===undefined),'BOARD_COORDINATES_PAIR_REQUIRED')).max(9).default([]),
  edges:z.array(z.object({id:identity,from:identity,to:identity,label:plainText(56).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_EDGE_LABEL_SHORT_SINGLE_LINE_REQUIRED').optional()}).strict()).max(12).default([]),
}).strict().superRefine((diagram,ctx)=>{
  const ids=new Set<string>();
  for(const item of [...diagram.nodes,...diagram.edges,...(diagram.participants??[]),...(diagram.messages??[]),...(diagram.classes??[]),...(diagram.relations??[]),...(diagram.entities??[]),...(diagram.entityRelations??[])]){if(ids.has(item.id))ctx.addIssue({code:'custom',message:'BOARD_DUPLICATE_ID'});ids.add(item.id);}
  if(diagram.kind==='er'){
    if(!diagram.entities||diagram.entities.length<2)ctx.addIssue({code:'custom',message:'BOARD_ER_ENTITIES_REQUIRED: ER 图需要2–6个实体'});
    if(diagram.nodes.length||diagram.edges.length)ctx.addIssue({code:'custom',message:'BOARD_ER_NO_NODES: ER 图请使用 entities/entityRelations，不要使用 nodes/edges'});
    if(diagram.classes||diagram.relations)ctx.addIssue({code:'custom',message:'BOARD_CLASS_FIELDS_ONLY: classes/relations 仅用于 kind=class'});
    if(diagram.participants||diagram.messages)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_FIELDS_ONLY: participants/messages 仅用于 kind=sequence'});
    if(diagram.lanes)ctx.addIssue({code:'custom',message:'BOARD_LANES_SWIMLANE_ONLY: lanes 仅用于 kind=swimlane'});
    const known=new Set((diagram.entities??[]).map(entity=>entity.id));
    for(const relation of diagram.entityRelations??[]){
      if(relation.from===relation.to||!known.has(relation.from)||!known.has(relation.to))ctx.addIssue({code:'custom',message:'BOARD_ER_REFERENCE_INVALID: 关系端点必须是已声明的实体，且不能自关联'});
    }
    return;
  }
  if(diagram.entities||diagram.entityRelations)ctx.addIssue({code:'custom',message:'BOARD_ER_FIELDS_ONLY: entities/entityRelations 仅用于 kind=er'});
  if(diagram.kind==='class'){
    if(!diagram.classes||diagram.classes.length<2)ctx.addIssue({code:'custom',message:'BOARD_CLASS_CLASSES_REQUIRED: 类图需要2–6个类'});
    if(diagram.nodes.length||diagram.edges.length)ctx.addIssue({code:'custom',message:'BOARD_CLASS_NO_NODES: 类图请使用 classes/relations，不要使用 nodes/edges'});
    if(diagram.participants||diagram.messages)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_FIELDS_ONLY: participants/messages 仅用于 kind=sequence'});
    if(diagram.lanes)ctx.addIssue({code:'custom',message:'BOARD_LANES_SWIMLANE_ONLY: lanes 仅用于 kind=swimlane'});
    const known=new Set((diagram.classes??[]).map(entry=>entry.id));
    for(const relation of diagram.relations??[]){
      if(relation.from===relation.to||!known.has(relation.from)||!known.has(relation.to))ctx.addIssue({code:'custom',message:'BOARD_CLASS_REFERENCE_INVALID: 关系端点必须是已声明的类，且不能自关联'});
    }
    return;
  }
  if(diagram.classes||diagram.relations)ctx.addIssue({code:'custom',message:'BOARD_CLASS_FIELDS_ONLY: classes/relations 仅用于 kind=class'});
  if(diagram.kind==='sequence'){
    if(!diagram.participants||diagram.participants.length<2)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_PARTICIPANTS_REQUIRED: 时序图需要2–6个参与者'});
    if(!diagram.messages||!diagram.messages.length)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_MESSAGES_REQUIRED: 时序图至少需要1条消息'});
    if(diagram.nodes.length||diagram.edges.length)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_NO_NODES: 时序图请使用 participants/messages，不要使用 nodes/edges'});
    if(diagram.lanes)ctx.addIssue({code:'custom',message:'BOARD_LANES_SWIMLANE_ONLY: lanes 仅用于 kind=swimlane'});
    if(diagram.direction!=='down')ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_DIRECTION_DOWN: 时序图固定自上而下'});
    const known=new Set((diagram.participants??[]).map(p=>p.id));
    for(const message of diagram.messages??[]){
      if(!known.has(message.from)||!known.has(message.to))ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_REFERENCE_INVALID: 消息端点必须是已声明的参与者'});
      if(message.kind==='self'&&message.from!==message.to)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_SELF_REFERENCE: 自调用消息的起点与终点必须相同'});
      if(message.kind!=='self'&&message.from===message.to)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_SELF_KIND_REQUIRED: 同参与者消息请标记 kind=self'});
    }
    return;
  }
  if(diagram.participants||diagram.messages)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_FIELDS_ONLY: participants/messages 仅用于 kind=sequence'});
  if(!diagram.nodes.length)ctx.addIssue({code:'custom',message:'BOARD_NODES_REQUIRED: 请至少提供一个节点'});
  const nodes=new Map(diagram.nodes.map(n=>[n.id,n]));
  for(const edge of diagram.edges)if(edge.from===edge.to||!nodes.has(edge.from)||!nodes.has(edge.to)||nodes.get(edge.from)?.kind==='text'||nodes.get(edge.to)?.kind==='text')ctx.addIssue({code:'custom',message:'BOARD_EDGE_REFERENCE_INVALID'});
  if(diagram.nodes.filter(n=>n.tone==='accent').length>2)ctx.addIssue({code:'custom',message:'BOARD_ACCENT_BUDGET: 最多2个强调节点'});
  for(const node of diagram.nodes.filter(n=>n.kind==='diamond')){const outgoing=diagram.edges.filter(e=>e.from===node.id);if(outgoing.length<2||outgoing.length>3||outgoing.some(e=>!e.label))ctx.addIssue({code:'custom',message:'BOARD_DECISION_BRANCHES_REQUIRED: 决策须有2–3条带标签的出边'});}
  if(diagram.kind==='swimlane'){
    const laneIds=new Set<string>();
    if(!diagram.lanes||diagram.lanes.length<2)ctx.addIssue({code:'custom',message:'BOARD_SWIMLANE_LANES_REQUIRED: 泳道图需要声明2–4个泳道'});
    else{
      for(const lane of diagram.lanes){if(laneIds.has(lane.id))ctx.addIssue({code:'custom',message:'BOARD_DUPLICATE_ID'});laneIds.add(lane.id);}
      if(diagram.direction!=='down')ctx.addIssue({code:'custom',message:'BOARD_SWIMLANE_DIRECTION_DOWN: 泳道图固定为纵向泳道、自上而下'});
      if(diagram.nodes.some(n=>n.x!==undefined||n.y!==undefined))ctx.addIssue({code:'custom',message:'BOARD_SWIMLANE_AUTO_LAYOUT: 泳道图按泳道自动布局，不能提供 x/y'});
      for(const node of diagram.nodes)if(!node.lane||!laneIds.has(node.lane))ctx.addIssue({code:'custom',message:'BOARD_SWIMLANE_LANE_REFERENCE_INVALID: 每个节点必须归属一个声明的泳道'});
    }
  }else if(diagram.lanes||diagram.nodes.some(n=>n.lane!==undefined))ctx.addIssue({code:'custom',message:'BOARD_LANES_SWIMLANE_ONLY: lanes 与节点 lane 仅用于 kind=swimlane'});
});
export type BoardDiagram=z.infer<typeof BoardDiagramSchema>;

export const BOARD_CANVASES={wide:{width:1280,height:720},standard:{width:960,height:720},portrait:{width:800,height:1000},inline:{width:960,height:600}} as const;
export type BoardDiagramChecks={ok:boolean;frameContained:boolean;canvas:{size:string;width:number;height:number;contentBounds:Rect};accents:number;budget:Record<string,number>;cornerRadius:string}&Record<string,unknown>;
export type BoardDiagramResult={diagram:BoardDiagram;elements:BoardElement[];summary:{nodes:number;edges:number;lanes:number;text:string;checks:BoardDiagramChecks};routes:SimpleRoute[]};
export type SimpleRoute={id:string;from:string;to:string;points:[number,number][];start:{fixedPoint:[number,number]};end:{fixedPoint:[number,number]};label?:Rect&{text:string;segment:number;gap:number}};
/** Last-resort connection: straight line between facing sides. Used for class/ER graphs
 * whose relations cannot be routed orthogonally; a readable diagram beats a failed one. */
export function straightConnectionRoutes(boxes:Box[],edges:{id:string;from:string;to:string}[]):SimpleRoute[]{
  const byId=new Map(boxes.map(box=>[box.id,box]));
  return edges.map(edge=>{
    const from=byId.get(edge.from)!,to=byId.get(edge.to)!;
    const fromCenter={x:from.x+from.width/2,y:from.y+from.height/2},toCenter={x:to.x+to.width/2,y:to.y+to.height/2};
    const dx=toCenter.x-fromCenter.x,dy=toCenter.y-fromCenter.y;
    let sx:number,sy:number,ex:number,ey:number,sfp:[number,number],efp:[number,number];
    if(Math.abs(dx)>=Math.abs(dy)){
      const right=dx>=0;
      sx=right?from.x+from.width:from.x;ex=right?to.x:to.x+to.width;sy=fromCenter.y;ey=toCenter.y;
      sfp=[right?1:0,.5];efp=[right?0:1,.5];
    }else{
      const down=dy>=0;
      sy=down?from.y+from.height:from.y;ey=down?to.y:to.y+to.height;sx=fromCenter.x;ex=toCenter.x;
      sfp=[.5,down?1:0];efp=[.5,down?0:1];
    }
    return{id:edge.id,from:edge.from,to:edge.to,points:[[sx,sy],[ex,ey]],start:{fixedPoint:sfp},end:{fixedPoint:efp}};
  });
}
/** Orthogonal routing first; straight fallback when every routing attempt fails. */
function routeOrStraight(boxes:Box[],edges:{id:string;from:string;to:string}[],bounds:Rect):{routes:SimpleRoute[];fallback:boolean}{
  for(const direction of ['down','right'] as const){
    for(const nodeGap of [40,56]){
      try{const result=routeBoard(boxes,edges,direction,{bounds,nodeGap,escape:24,nodeClearance:12});return{routes:result.routes as unknown as SimpleRoute[],fallback:false};}
      catch{/* try the next option */}
    }
  }
  return{routes:straightConnectionRoutes(boxes,edges),fallback:true};
}

type SizedNode={node:BoardDiagram['nodes'][number];width:number;height:number;text:BoardElement};
type SwimlanePlan={boxes:Box[];laneWidth:number;margin:number;lanes:NonNullable<BoardDiagram['lanes']>};

/** Vertical swimlanes: each lane is one column; rows are topological steps shared
 * across lanes, so cross-lane edges run between clearly aligned bands. */
function swimlanePlan(diagram:BoardDiagram,sizes:SizedNode[],bounds:Rect,levels:Map<string,number>):SwimlanePlan|undefined{
  const lanes=diagram.lanes!;
  const laneWidth=grid(Math.floor(bounds.width/lanes.length));
  const margin=grid((bounds.width-laneWidth*lanes.length)/2);
  if(laneWidth<160||sizes.some(s=>s.width>laneWidth-56))return undefined;
  const laneIndex=new Map(lanes.map((lane,index)=>[lane.id,index]));
  const sizeOf=new Map(sizes.map(s=>[s.node.id,s]));
  const inputIndex=new Map(diagram.nodes.map((node,index)=>[node.id,index]));
  const positions=new Map<string,{x:number;y:number}>();
  const maxLevel=Math.max(...diagram.nodes.map(node=>levels.get(node.id)!));
  let y=bounds.y+56;
  for(let level=0;level<=maxLevel;level++){
    const atLevel=diagram.nodes.filter(node=>levels.get(node.id)===level).sort((a,b)=>laneIndex.get(a.lane!)!-laneIndex.get(b.lane!)!||inputIndex.get(a.id)!-inputIndex.get(b.id)!);
    const stack=new Map<number,number>();
    for(const node of atLevel){
      const column=laneIndex.get(node.lane!)!,size=sizeOf.get(node.id)!,offset=stack.get(column)??0;
      positions.set(node.id,{x:grid(bounds.x+margin+column*laneWidth+(laneWidth-size.width)/2),y:grid(y+offset)});
      stack.set(column,offset+size.height+24);
    }
    if(stack.size)y+=Math.max(...stack.values())-24+40;
  }
  const boxes=sizes.map(s=>({id:s.node.id,kind:s.node.kind,...positions.get(s.node.id)!,width:s.width,height:s.height}));
  if(boxes.some(box=>box.y+box.height>bounds.y+bounds.height))return undefined;
  return{boxes,laneWidth,margin,lanes};
}

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
    if(title&&element!==title){const hitsTitle=points?points.slice(1).some((p:[number,number],i:number)=>segmentIntersectsBox(points[i]!,p,title)):boxesOverlap(element,title);if(hitsTitle)errors.push('BOARD_TITLE_OVERLAP:'+element.id);}
  }
  // Opaque label masks and message labels must not hide boxes or each other. Generated labels
  // are placed with this rule; the check also catches labels dragged after generation.
  const labelRoles=new Set(['edge-label-mask','relation-label-mask','er-label-mask','message-label']),boxRoles=new Set(['node','class','entity','participant']);
  const labelElements=live.filter(element=>labelRoles.has(String(element.customData?.boardRole))),boxElements=live.filter(element=>boxRoles.has(String(element.customData?.boardRole))),reportedLabels=new Set<string>();
  const reportLabel=(label:BoardElement,other:BoardElement)=>{const key=label.id+':'+other.id;if(reportedLabels.has(key))return;reportedLabels.add(key);errors.push('BOARD_LABEL_OVERLAP:'+key);};
  labelElements.forEach((label,index)=>{for(const box of boxElements)if(boxesOverlap(label,box))reportLabel(label,box);for(const other of labelElements.slice(0,index))if(boxesOverlap(label,other))reportLabel(label,other);});
  return{ok:!errors.length,errors,canvas};
}

// Pure, bounded conversion. Models cannot supply source objects, URLs, scripts, files or bindings.
export function generateBoardDiagram(input:unknown,namespace:string):BoardDiagramResult{
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
  // Row heights follow the wrapped text so long fields never overlap the next row.
  const measureRows=(texts:string[],width:number,size:number,minRow:number)=>{
    let total=0;
    const rows=texts.map(text=>{const element=label('measure',text,0,0,width,null,size);const height=Math.max(minRow,element.height+4);total+=height;return{text,height};});
    return{rows,total:Math.max(total,minRow)};
  };
  // Relation labels use opaque masks, so the mask must never cover a class/entity box or
  // another label. Height follows the wrapped text; above/below are both tested, then other
  // segments, then a bounded free-space sweep. Only a genuinely full content area fails.
  const placeRelationLabel=(route:SimpleRoute,text:string,bounds:Rect,obstacles:Box[],placed:Rect[]):Rect=>{
    const width=Math.min(160,gridUp(textBudget(text,14)+16)),measured=label('measure',text,0,0,width-16,null,14),height=Math.max(24,gridUp(measured.height+5));
    const segments=route.points.slice(1).map((point,index)=>{const previous=route.points[index]!,length=Math.abs(previous[0]-point[0])+Math.abs(previous[1]-point[1]);return{x:(previous[0]+point[0])/2,y:(previous[1]+point[1])/2,length};}).sort((a,b)=>b.length-a.length);
    const taken=[...obstacles,...placed],clampX=(x:number)=>Math.max(bounds.x,Math.min(grid(x),bounds.x+bounds.width-width)),fits=(x:number,y:number)=>y>=bounds.y-1e-9&&y+height<=bounds.y+bounds.height+1e-9&&!taken.some(box=>boxesOverlap({x,y,width,height},box));
    const candidates:{x:number;y:number}[]=[];
    for(const segment of segments){const x=clampX(segment.x-width/2);candidates.push({x,y:Math.max(bounds.y,grid(segment.y-2-height))},{x,y:grid(segment.y+6)});}
    for(const candidate of candidates)if(fits(candidate.x,candidate.y))return{...candidate,width,height};
    const anchor=segments[0]!,step=4;let best:{x:number;y:number;score:number}|undefined;
    for(let y=bounds.y;y+height<=bounds.y+bounds.height+1e-9;y+=step)for(let x=bounds.x;x+width<=bounds.x+bounds.width+1e-9;x+=step){
      if(!fits(x,y))continue;
      const score=(x+width/2-anchor.x)**2+(y+height/2-anchor.y)**2;
      if(!best||score<best.score)best={x,y,score};
    }
    if(best)return{x:best.x,y:best.y,width,height};
    throw Error('BOARD_LABEL_UNPLACEABLE: 关系标签“'+text+'”找不到不压住框或其他标签的位置，请减少关系标签、缩短标签或拆分图表');
  };
  // Sequence diagrams use lifelines instead of routed edges. Each lifeline is a 2px
  // rectangle so Excalidraw can bind message arrows to it; dragging a participant moves
  // the whole group and the bound messages follow.
  if(diagram.kind==='sequence'){
    const participants=diagram.participants!;
    const messages=diagram.messages!;
    const width=diagram.size==='doc-inline'?960:diagram.size==='slide-16x9'||diagram.size==='doc-wide'?1280:participants.length>4?1280:960;
    const titleSize=diagram.size==='slide-16x9'?40:28;
    const title=label('title',diagram.title,32,32,width-64,null,titleSize,true);
    if(title.text.split('\n').length>2)throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');
    title.customData={boardRole:'title'};
    const headerW=120,baseHeaderH=48,baseRowH=56,gapBelowHeader=48,contentX=32,contentW=width-64;
    const gap=(contentW-participants.length*headerW)/(participants.length-1);
    if(gap<88)throw Error('BOARD_SEQUENCE_TOO_WIDE: 参与者过多，画幅放不下可读的生命线间距；请减少参与者或拆图');
    const columns=participants.map((participant,index)=>({participant,x:grid(contentX+index*(headerW+gap))}));
    // Headers grow with the wrapped participant name; the lifeline starts at the real bottom.
    const nameHeights=new Map(participants.map(participant=>{const measured=label('pn_'+participant.id,participant.name,0,0,headerW-16,null,16);return[participant.id,measured.height] as const;}));
    const singleNameHeight=16*lineHeight,headerH=Math.max(baseHeaderH,gridUp(Math.max(...participants.map(participant=>nameHeights.get(participant.id)!))+16));
    const headerY=gridUp(title.y+title.height+24),lifelineTop=headerY+headerH;
    // Message labels sit above their arrow. Measure the wrapped label first so row pitches and
    // canvas height include the actual text height instead of assuming one 18.9px line.
    const plans=messages.map(message=>{
      const from=columns.find(c=>c.participant.id===message.from)!,to=columns.find(c=>c.participant.id===message.to)!,fromX=from.x+headerW/2,toX=to.x+headerW/2;
      const labelWidth=message.from===message.to?160:Math.min(240,Math.max(96,Math.abs(toX-fromX)-24));
      const labelX=message.from===message.to?(fromX+64+labelWidth<=width-32?fromX+64:fromX-64-labelWidth):(fromX+toX)/2-labelWidth/2;
      const measured=label('ml_'+message.id,message.text,labelX,0,labelWidth,null,14);
      return{message,from,to,fromX,toX,labelWidth,labelX,labelHeight:measured.height};
    });
    const baseLabelHeight=14*lineHeight,firstGap=Math.max(gapBelowHeader,gridUp(plans[0]!.labelHeight+24));
    const rowYs=plans.map((plan,index)=>lifelineTop+firstGap+plans.slice(1,index+1).reduce((sum,previous)=>sum+Math.max(baseRowH,gridUp(previous.labelHeight+16)),0));
    const lastRowY=rowYs.at(-1)!,lifelineBottom=lastRowY+40,height=gridUp(Math.max(600,lifelineBottom+32));
    if(height>1400)throw Error('BOARD_LAYOUT_TOO_DENSE: 时序图消息过多，请拆成多张时序图');
    const elements:BoardElement[]=[],lifelines=new Map<string,BoardElement>(),headers:BoardElement[]=[];
    for(const {participant,x} of columns){
      const group=prefix+'pg_'+participant.id,nameHeight=nameHeights.get(participant.id)!;
      const header=base('pt_'+participant.id,'rectangle',x,headerY,headerW,headerH);
      header.backgroundColor='#e9f0f1';header.strokeColor='#356c7c';header.roundness={type:3,value:8};header.groupIds=[group];header.customData={boardRole:'participant',logicalId:participant.id};
      const name=label('pn_'+participant.id,participant.name,x+8,headerY+(nameHeight<=singleNameHeight+1e-9?(headerH-18*lineHeight)/2:(headerH-nameHeight)/2),headerW-16,header.id,16);
      name.groupIds=[group];name.customData={boardRole:'participant-name',logicalId:participant.id};
      header.boundElements=[{id:name.id,type:'text'}];
      const lifeline=base('ll_'+participant.id,'rectangle',x+headerW/2-1,lifelineTop,2,lifelineBottom-lifelineTop);
      lifeline.backgroundColor='transparent';lifeline.strokeColor='#687176';lifeline.strokeWidth=2;lifeline.groupIds=[group];lifeline.customData={boardRole:'lifeline',logicalId:participant.id};
      lifelines.set(participant.id,lifeline);headers.push(header);
      elements.push(lifeline,header,name);
    }
    const fraction=(y:number)=>Math.max(.02,Math.min(.98,(y-lifelineTop)/(lifelineBottom-lifelineTop)));
    plans.forEach((plan,index)=>{
      const {message,from,to,fromX,toX,labelWidth,labelX,labelHeight}=plan,y=rowYs[index]!;
      const start=lifelines.get(message.from)!,end=lifelines.get(message.to)!;
      let arrow:BoardElement;
      if(message.from===message.to){
        const loopW=56,loopH=32;
        arrow={...base('msg_'+message.id,'arrow',fromX+1,y,loopW,loopH),strokeColor:'#687176',points:[[0,0],[loopW,0],[loopW,loopH],[1,loopH]],lastCommittedPoint:null,startBinding:{elementId:start.id,focus:0,gap:4,fixedPoint:[1,fraction(y)]},endBinding:{elementId:end.id,focus:0,gap:4,fixedPoint:[1,fraction(y+loopH)]},startArrowhead:null,endArrowhead:'arrow',elbowed:false,fixedSegments:[],startIsSpecial:false,endIsSpecial:false};
      }else{
        const dx=toX-fromX,left=Math.min(fromX,toX);
        arrow={...base('msg_'+message.id,'arrow',left,y,Math.abs(dx),0),strokeColor:'#687176',points:[[fromX-left,0],[toX-left,0]],lastCommittedPoint:null,startBinding:{elementId:start.id,focus:0,gap:4,fixedPoint:[.5,fraction(y)]},endBinding:{elementId:end.id,focus:0,gap:4,fixedPoint:[.5,fraction(y)]},startArrowhead:null,endArrowhead:'arrow',elbowed:false,fixedSegments:[],startIsSpecial:false,endIsSpecial:false};
      }
      if(message.kind==='return')arrow.strokeStyle='dashed';
      arrow.customData={boardRole:'message',messageId:message.id,from:message.from,to:message.to,kind:message.kind};
      start.boundElements!.push({id:arrow.id,type:'arrow'});end.boundElements!.push({id:arrow.id,type:'arrow'});
      const text=label('ml_'+message.id,message.text,labelX,y-26-Math.max(0,labelHeight-baseLabelHeight),labelWidth,null,14);
      text.customData={boardRole:'message-label',messageId:message.id};
      elements.push(arrow,text);
    });
    const canvas={...base('canvas','rectangle',0,0,width,height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width,height}};
    const all:BoardElement[]=[canvas,title,...elements];
    if(new Set(all.map(e=>e.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const errors:string[]=[];
    const inside=(x:number,y:number)=>x>=-1e-6&&y>=-1e-6&&x<=width+1e-6&&y<=height+1e-6;
    for(const element of all){if(element===canvas||element===title)continue;
      if(!inside(element.x,element.y)||!inside(element.x+element.width,element.y+element.height)){errors.push('BOARD_CANVAS_OVERFLOW:'+element.id);continue;}
      if(element.customData?.boardRole==='lifeline'&&element.width>4)errors.push('BOARD_SEQUENCE_LIFELINE_INVALID:'+element.id);
      if(element.customData?.boardRole==='message'){const points=(element.points??[]) as number[][];const horizontal=points.every(point=>point[1]===points[0]![1]);const loop=points.length===4&&points.every((point,i)=>!i||point[0]===points[i-1]![0]||point[1]===points[i-1]![1]);if(!horizontal&&!loop)errors.push('BOARD_SEQUENCE_MESSAGE_NOT_HORIZONTAL:'+element.id);}
      if(element.customData?.boardRole==='message-label'&&headers.some(header=>boxesOverlap(element,header)))errors.push('BOARD_SEQUENCE_LABEL_OVERLAP:'+element.id);
    }
    if(errors.length)throw Error(errors.join(';'));
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:participants.length,edges:messages.length,lanes:0,text:diagram.summary,checks:{ok:true,participants:participants.length,messages:messages.length,frameContained:true,canvas:{size:diagram.size,width,height,contentBounds:{x:contentX,y:headerY,width:contentW,height:lifelineBottom-headerY}},accents:0,budget:{nodes:9,arrows:12,accents:2,lanes:4,participants:6,messages:14},cornerRadius:'native-elbow-max-16'}},routes:[]};
  }
  // ER diagrams: entity boxes with typed fields; cardinality uses native crowfoot heads.
  if(diagram.kind==='er'){
    const entities=diagram.entities!;
    const relations=diagram.entityRelations??[];
    const cols=entities.length<=4?2:3,width=cols===2?960:1280,titleSize=diagram.size==='slide-16x9'?40:28;
    const title=label('title',diagram.title,32,32,width-64,null,titleSize,true);
    if(title.text.split('\n').length>2)throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');
    title.customData={boardRole:'title'};
    const fieldText=(field:{name:string;type?:string;pk:boolean})=>(field.pk?'PK · ':'')+field.name+(field.type?' : '+field.type:'');
    const contentX=32,contentW=width-64,contentTop=gridUp(title.y+title.height+24),cellMax=cols===2?300:280,padX=12,rowH=22,headerH=36,gapX=64,gapY=64;
    const widest=(list:string[],size:number)=>list.reduce((max,line)=>Math.max(max,textBudget(line,size)),0);
    const sizes=entities.map(entity=>{const fields=entity.fields.map(fieldText);const budget=Math.max(textBudget(entity.name,18),widest(fields,14),120);const boxWidth=Math.max(200,Math.min(cellMax,gridUp(budget+padX*2)));const nameElement=label('measure-name',entity.name,0,0,boxWidth-padX*2,null,18);const headerHeight=Math.max(headerH,nameElement.height+10);const fieldRows=measureRows(fields,boxWidth-padX*2,14,rowH);return{entity,fields,width:boxWidth,height:gridUp(headerHeight+fieldRows.total+10),fieldsH:fieldRows.total,headerH:headerHeight,fieldRows:fieldRows.rows};});
    const rows:typeof sizes[]=[];for(let i=0;i<sizes.length;i+=cols)rows.push(sizes.slice(i,i+cols));
    const rowHeights=rows.map(row=>Math.max(...row.map(item=>item.height)));
    const totalH=rowHeights.reduce((sum,value)=>sum+value,0)+gapY*(rows.length-1);
    const height=gridUp(Math.max(600,contentTop+totalH+32));
    if(height>1400)throw Error('BOARD_LAYOUT_TOO_DENSE: ER 图过高，请减少实体或字段');
    const placed=new Map<string,{x:number;y:number;width:number;height:number}>(),boxes:Box[]=[];
    rows.forEach((row,rowIndex)=>{
      const rowY=contentTop+rowHeights.slice(0,rowIndex).reduce((sum,value)=>sum+value,0)+gapY*rowIndex;
      const rowWidth=row.reduce((sum,item)=>sum+item.width,0)+gapX*(row.length-1);
      let cursor=contentX+Math.round((contentW-rowWidth)/2);
      for(const item of row){const x=grid(cursor),y=grid(rowY);placed.set(item.entity.id,{x,y,width:item.width,height:item.height});boxes.push({id:item.entity.id,kind:'rectangle',x,y,width:item.width,height:item.height});cursor+=item.width+gapX;}
    });
    const bounds={x:contentX,y:contentTop,width:contentW,height:height-contentTop-32};
    const routingEdges=relations.map(relation=>({id:relation.id,from:relation.from,to:relation.to}));
    const routing=routeOrStraight(boxes,routingEdges,bounds);
    const elements:BoardElement[]=[],elementIdById=new Map<string,string>();
    for(const item of sizes){
      const pos=placed.get(item.entity.id)!,group=prefix+'eg_'+item.entity.id,boxId=prefix+'ent_'+item.entity.id;
      elementIdById.set(item.entity.id,boxId);
      const box=base('ent_'+item.entity.id,'rectangle',pos.x,pos.y,item.width,item.height);
      box.backgroundColor='#ffffff';box.strokeColor='#356c7c';box.roundness={type:3,value:6};box.groupIds=[group];box.customData={boardRole:'entity',logicalId:item.entity.id};
      const name=label('entname_'+item.entity.id,item.entity.name,pos.x+padX,pos.y+8,item.width-padX*2,null,18);
      name.textAlign='center';name.groupIds=[group];name.customData={boardRole:'entity-name',logicalId:item.entity.id};
      const separator=base('entline_'+item.entity.id,'line',pos.x,pos.y+item.headerH,item.width,0);
      Object.assign(separator,{points:[[0,0],[item.width,0]],strokeColor:'#356c7c',strokeWidth:1,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:null,lastCommittedPoint:null,groupIds:[group],customData:{boardRole:'entity-separator',logicalId:item.entity.id}});
      elements.push(box,separator,name);
      let fieldY=pos.y+item.headerH+4;
      item.fieldRows.forEach((row,index)=>{const line=label('entf_'+item.entity.id+'_'+index,row.text,pos.x+padX,fieldY,item.width-padX*2,null,14);line.groupIds=[group];line.customData={boardRole:'entity-field',logicalId:item.entity.id};elements.push(line);fieldY+=row.height;});
    }
    const headsByCardinality={'one-one':['crowfoot_one','crowfoot_one'],'one-many':['crowfoot_one','crowfoot_many'],'many-many':['crowfoot_many','crowfoot_many']} as const;
    const cardinalityById=new Map(relations.map(relation=>[relation.id,relation.cardinality]));
    const labels:BoardElement[]=[],labelRects:Rect[]=[];
    for(const route of routing.routes){
      const fromId=elementIdById.get(route.from)!,toId=elementIdById.get(route.to)!,a=route.points[0]!,points=route.points.map(point=>[point[0]-a[0],point[1]-a[1]]);
      const heads=headsByCardinality[cardinalityById.get(route.id)??'one-many'];
      const arrow:BoardElement={...base('errel_'+route.id,'arrow',a[0],a[1],Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]))),strokeColor:'#356c7c',points,lastCommittedPoint:null,startBinding:{elementId:fromId,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:toId,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead:heads[0],endArrowhead:heads[1],elbowed:points.length>2,fixedSegments:points.slice(2,-1).map((end,index)=>({index:index+2,start:points[index+1],end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'er-relation',logicalId:route.id,cardinality:cardinalityById.get(route.id)??'one-many',from:route.from,to:route.to}};
      const fromElement=elements.find(element=>element.id===fromId)!,toElement=elements.find(element=>element.id===toId)!;
      fromElement.boundElements!.push({id:arrow.id,type:'arrow'});toElement.boundElements!.push({id:arrow.id,type:'arrow'});elements.push(arrow);
      const relation=relations.find(item=>item.id===route.id);
      if(relation?.label){
        const box=placeRelationLabel(route,relation.label,bounds,boxes,labelRects);
        const mask=base('ermask_'+route.id,'rectangle',box.x,box.y,box.width,box.height),text=label('erlabel_'+route.id,relation.label,box.x+8,box.y+5,box.width-16,mask.id,14);
        mask.backgroundColor='#ffffff';mask.strokeColor='#ffffff';mask.strokeWidth=1;mask.customData={boardRole:'er-label-mask',relationId:route.id};mask.boundElements=[{id:text.id,type:'text'}];text.customData={boardRole:'er-label',relationId:route.id};
        const group=prefix+'erlabelgroup_'+route.id;mask.groupIds=[group];text.groupIds=[group];labels.push(mask,text);labelRects.push(box);
      }
    }
    const canvas={...base('canvas','rectangle',0,0,width,height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width,height}};
    const all:BoardElement[]=[canvas,title,...elements,...labels];
    if(new Set(all.map(element=>element.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:entities.length,edges:relations.length,lanes:0,text:diagram.summary,checks:{ok:true,entities:entities.length,relations:relations.length,frameContained:true,fallbackRouting:routing.fallback,canvas:{size:diagram.size,width,height,contentBounds:bounds},accents:0,budget:{nodes:9,arrows:12,accents:2,lanes:4,participants:6,messages:14,classes:6,relations:10,entities:6},cornerRadius:'native-elbow-max-16'}},routes:routing.routes};
  }
  // Class diagrams: three-compartment boxes on a centered grid, relations routed
  // orthogonally with UML arrowheads (hollow triangle/diamond, filled diamond, dashed arrow).
  if(diagram.kind==='class'){
    const classes=diagram.classes!;
    const relations=diagram.relations??[];
    const cols=classes.length<=4?2:3,width=cols===2?960:1280,titleSize=diagram.size==='slide-16x9'?40:28;
    const title=label('title',diagram.title,32,32,width-64,null,titleSize,true);
    if(title.text.split('\n').length>2)throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');
    title.customData={boardRole:'title'};
    const contentX=32,contentW=width-64,contentTop=gridUp(title.y+title.height+24),cellMax=cols===2?300:280,padX=12,rowH=22,headerH=36,gapX=64,gapY=64;
    const widest=(list:string[],size:number)=>list.reduce((max,line)=>Math.max(max,textBudget(line,size)),0);
    const sizes=classes.map(entry=>{const budget=Math.max(textBudget(entry.name,18),widest(entry.attributes,14),widest(entry.methods,14),120);const boxWidth=Math.max(200,Math.min(cellMax,gridUp(budget+padX*2)));const nameElement=label('measure-name',entry.name,0,0,boxWidth-padX*2,null,18);const headerHeight=Math.max(headerH,nameElement.height+10);const attributes=measureRows(entry.attributes,boxWidth-padX*2,14,rowH);const methods=measureRows(entry.methods,boxWidth-padX*2,14,rowH);return{entry,width:boxWidth,height:gridUp(headerHeight+attributes.total+methods.total+12),attrsH:attributes.total,methodsH:methods.total,headerH:headerHeight,attributeRows:attributes.rows,methodRows:methods.rows};});
    const rows:typeof sizes[]=[];for(let i=0;i<sizes.length;i+=cols)rows.push(sizes.slice(i,i+cols));
    const rowHeights=rows.map(row=>Math.max(...row.map(item=>item.height)));
    const totalH=rowHeights.reduce((sum,value)=>sum+value,0)+gapY*(rows.length-1);
    const height=gridUp(Math.max(600,contentTop+totalH+32));
    if(height>1400)throw Error('BOARD_LAYOUT_TOO_DENSE: 类图过高，请减少类数量或拆图');
    const placed=new Map<string,{x:number;y:number;width:number;height:number}>(),boxes:Box[]=[];
    rows.forEach((row,rowIndex)=>{
      const rowY=contentTop+rowHeights.slice(0,rowIndex).reduce((sum,value)=>sum+value,0)+gapY*rowIndex;
      const rowWidth=row.reduce((sum,item)=>sum+item.width,0)+gapX*(row.length-1);
      let cursor=contentX+Math.round((contentW-rowWidth)/2);
      for(const item of row){const x=grid(cursor),y=grid(rowY);placed.set(item.entry.id,{x,y,width:item.width,height:item.height});boxes.push({id:item.entry.id,kind:'rectangle',x,y,width:item.width,height:item.height});cursor+=item.width+gapX;}
    });
    const bounds={x:contentX,y:contentTop,width:contentW,height:height-contentTop-32};
    // Route without labels first: relation multiplicities sit outside the routing box,
    // so an unresolvable label never blocks an otherwise valid class layout.
    const routingEdges=relations.map(relation=>({id:relation.id,from:relation.from,to:relation.to}));
    const routing=routeOrStraight(boxes,routingEdges,bounds);
    const elements:BoardElement[]=[],elementIdById=new Map<string,string>();
    for(const item of sizes){
      const pos=placed.get(item.entry.id)!,group=prefix+'cg_'+item.entry.id,boxId=prefix+'cls_'+item.entry.id;
      elementIdById.set(item.entry.id,boxId);
      const box=base('cls_'+item.entry.id,'rectangle',pos.x,pos.y,item.width,item.height);
      box.backgroundColor='#ffffff';box.strokeColor='#356c7c';box.roundness={type:3,value:6};box.groupIds=[group];box.customData={boardRole:'class',logicalId:item.entry.id};
      const name=label('clsname_'+item.entry.id,item.entry.name,pos.x+padX,pos.y+8,item.width-padX*2,null,18);
      name.textAlign='center';name.groupIds=[group];name.customData={boardRole:'class-name',logicalId:item.entry.id};
      const separators=[item.headerH,item.headerH+item.attrsH].map((offset,index)=>{const line=base('clsline'+index+'_'+item.entry.id,'line',pos.x,pos.y+offset,item.width,0);Object.assign(line,{points:[[0,0],[item.width,0]],strokeColor:'#356c7c',strokeWidth:1,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:null,lastCommittedPoint:null,groupIds:[group],customData:{boardRole:'class-separator',logicalId:item.entry.id}});return line;});
      elements.push(box,...separators,name);
      let attributeY=pos.y+item.headerH+4;
      item.attributeRows.forEach((row,index)=>{const line=label('clsa_'+item.entry.id+'_'+index,row.text,pos.x+padX,attributeY,item.width-padX*2,null,14);line.groupIds=[group];line.customData={boardRole:'class-attribute',logicalId:item.entry.id};elements.push(line);attributeY+=row.height;});
      let methodY=pos.y+item.headerH+item.attrsH+4;
      item.methodRows.forEach((row,index)=>{const line=label('clsm_'+item.entry.id+'_'+index,row.text,pos.x+padX,methodY,item.width-padX*2,null,14);line.groupIds=[group];line.customData={boardRole:'class-method',logicalId:item.entry.id};elements.push(line);methodY+=row.height;});
    }
    const headByKind={inheritance:'triangle_outline',composition:'diamond',aggregation:'diamond_outline',dependency:'arrow',association:null} as const;
    const kindById=new Map(relations.map(relation=>[relation.id,relation.kind]));
    const labels:BoardElement[]=[],labelRects:Rect[]=[];
    for(const route of routing.routes){
      const fromId=elementIdById.get(route.from)!,toId=elementIdById.get(route.to)!,a=route.points[0]!,points=route.points.map(point=>[point[0]-a[0],point[1]-a[1]]);
      const arrow:BoardElement={...base('rel_'+route.id,'arrow',a[0],a[1],Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]))),strokeColor:'#356c7c',points,lastCommittedPoint:null,startBinding:{elementId:fromId,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:toId,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead:null,endArrowhead:headByKind[kindById.get(route.id)??'association'],elbowed:points.length>2,fixedSegments:points.slice(2,-1).map((end,index)=>({index:index+2,start:points[index+1],end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'relation',logicalId:route.id,relationKind:kindById.get(route.id)??'association',from:route.from,to:route.to}};
      if(kindById.get(route.id)==='dependency')arrow.strokeStyle='dashed';
      const fromElement=elements.find(element=>element.id===fromId)!,toElement=elements.find(element=>element.id===toId)!;
      fromElement.boundElements!.push({id:arrow.id,type:'arrow'});toElement.boundElements!.push({id:arrow.id,type:'arrow'});elements.push(arrow);
      const relation=relations.find(item=>item.id===route.id);
      if(relation?.label){
        // Place the multiplicity beside the longest segment, above the line by default and
        // below when a class box or another label would be covered.
        const box=placeRelationLabel(route,relation.label,bounds,boxes,labelRects);
        const mask=base('relmask_'+route.id,'rectangle',box.x,box.y,box.width,box.height),text=label('rellabel_'+route.id,relation.label,box.x+8,box.y+5,box.width-16,mask.id,14);
        mask.backgroundColor='#ffffff';mask.strokeColor='#ffffff';mask.strokeWidth=1;mask.customData={boardRole:'relation-label-mask',relationId:route.id};mask.boundElements=[{id:text.id,type:'text'}];text.customData={boardRole:'relation-label',relationId:route.id};
        const group=prefix+'relgroup_'+route.id;mask.groupIds=[group];text.groupIds=[group];labels.push(mask,text);labelRects.push(box);
      }
    }
    const canvas={...base('canvas','rectangle',0,0,width,height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width,height}};
    const all:BoardElement[]=[canvas,title,...elements,...labels];
    if(new Set(all.map(element=>element.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:classes.length,edges:relations.length,lanes:0,text:diagram.summary,checks:{ok:true,classes:classes.length,relations:relations.length,frameContained:true,fallbackRouting:routing.fallback,canvas:{size:diagram.size,width,height,contentBounds:bounds},accents:0,budget:{nodes:9,arrows:12,accents:2,lanes:4,participants:6,messages:14,classes:6,relations:10},cornerRadius:'native-elbow-max-16'}},routes:routing.routes};
  }
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
  const frames=diagram.kind==='swimlane'
    ?(diagram.size==='auto'?(diagram.lanes!.length>=4?[BOARD_CANVASES.wide]:[BOARD_CANVASES.standard,BOARD_CANVASES.wide,BOARD_CANVASES.portrait]):[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide])
    :(diagram.size==='auto'?[BOARD_CANVASES.standard,BOARD_CANVASES.wide,BOARD_CANVASES.portrait]:[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide]);
  let chosen:{frame:{width:number;height:number};bounds:Rect;title:BoardElement;boxes:Box[];routing:ReturnType<typeof routeBoard>;swimlane?:SwimlanePlan}|undefined;const failures:string[]=[];
  for(const frame of frames){const titleSize=diagram.size==='slide-16x9'?40:28,title=label('title',diagram.title,32,32,frame.width-64,null,titleSize,true);if(title.text.split('\n').length>2){failures.push('BOARD_TITLE_TOO_LONG');continue;}title.customData={boardRole:'title'};const top=gridUp(title.y+title.height+24),bounds={x:32,y:top,width:frame.width-64,height:frame.height-top-32};
    const swimlane=diagram.kind==='swimlane'?swimlanePlan(diagram,sizes,bounds,levels):undefined;
    if(diagram.kind==='swimlane'&&!swimlane){failures.push('BOARD_SWIMLANE_FIT: 泳道宽度或总高度无法容纳所有节点，请减少泳道、缩短文字或拆分详图');continue;}
    const candidates=swimlane?[swimlane.boxes]:compactCandidates(diagram,sizes,bounds,levels);
    // Lane headers occupy the top strip; arrows must stay inside the content area below them.
    const routingBounds=swimlane?{x:bounds.x,y:bounds.y+56,width:bounds.width,height:bounds.height-56}:bounds;
    for(const boxes of candidates){try{const routing=routeBoard(boxes,diagram.edges,diagram.direction,{bounds:routingBounds,nodeGap:40,escape:24,nodeClearance:12});chosen={frame,bounds,title,boxes,routing,...(swimlane?{swimlane}:{})};break;}catch(error){failures.push((error as Error).message);}}
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
  const laneFrames:BoardElement[]=[];
  if(chosen.swimlane){const{laneWidth,margin,lanes}=chosen.swimlane;
    lanes.forEach((lane,index)=>{
      const laneX=grid(chosen.bounds.x+margin+index*laneWidth);
      const header=base('lane_'+lane.id,'rectangle',laneX,chosen.bounds.y,laneWidth,40);
      header.backgroundColor='#e9f0f1';header.strokeColor='#356c7c';header.customData={boardRole:'lane',laneId:lane.id,part:'header'};
      const name=label('lt_'+lane.id,lane.name,laneX+16,chosen.bounds.y+6,laneWidth-32,header.id,18);
      header.boundElements=[{id:name.id,type:'text'}];name.customData={boardRole:'lane-title',laneId:lane.id};
      const body=base('lanebody_'+lane.id,'rectangle',laneX,chosen.bounds.y+40,laneWidth,chosen.bounds.height-40);
      body.backgroundColor='transparent';body.strokeColor='#687176';body.customData={boardRole:'lane',laneId:lane.id,part:'body'};
      laneFrames.push(header,name,body);
    });
  }
  if(laneFrames.length)elements.unshift(...laneFrames);
  const canvas={...base('canvas','rectangle',0,0,chosen.frame.width,chosen.frame.height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width:chosen.frame.width,height:chosen.frame.height}};
  elements.unshift(canvas,chosen.title);
  // All generated roles have distinct ID prefixes, independent of caller-selected identifiers.
  if(new Set(elements.map(e=>e.id)).size!==elements.length)throw Error('BOARD_RESERVED_ID_COLLISION');
  const frameCheck=checkBoardCanvas(elements);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
  return{diagram,elements,summary:{nodes:diagram.nodes.length,edges:diagram.edges.length,lanes:chosen.swimlane?chosen.swimlane.lanes.length:0,text:diagram.summary,checks:{...check,frameContained:true,canvas:{size:diagram.size,...chosen.frame,contentBounds:chosen.bounds},accents:diagram.nodes.filter(n=>n.tone==='accent').length,budget:{nodes:9,arrows:12,accents:2,lanes:4},cornerRadius:'native-elbow-max-16'}},routes};
}
