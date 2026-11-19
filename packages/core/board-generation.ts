import {z} from 'zod';
import type {BoardElement} from './board-changes.ts';
import {routeBoard,grid,gridUp,textBudget,boxesOverlap,segmentHitsBox,segmentIntersectsBox,type Box,type Rect} from './board-routing.ts';

const plainText=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|<\/?[a-z][^>]*>|(?<![a-z0-9_])(?:javascript|vbscript|data)\s*:/i.test(s),'BOARD_PLAIN_TEXT_REQUIRED');
const identity=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/);
const coordinate=z.number().finite().min(-10000).max(10000);
const shortLabel=plainText(56).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_EDGE_LABEL_SHORT_SINGLE_LINE_REQUIRED');
/** One quiet accent (deep forest green, matching the sidebar token family) plus one
 * muted hue per semantic type: strokes stay mid-saturation, fills are ~8% tints —
 * the archify-style "typed color" language adapted to paper-white document boards. */
export const BOARD_ACCENT='#2f6f4f';
export const BOARD_ACCENT_TINT='#e7f2ee';
export const KIND_LABELS={flow:'流程图',architecture:'架构图',swimlane:'泳道图',sequence:'时序图',class:'类图',er:'ER 图',state:'状态机',tree:'层级图'} as const;
export const BOARD_NODE_TYPES={
  process:{label:'处理 / 步骤',fill:'#f7f9fa',stroke:'#46586b',dashed:false},
  data:{label:'数据 / 存储',fill:'#f4f2fa',stroke:'#7b6cb4',dashed:false},
  user:{label:'角色 / 用户',fill:'#faf5e9',stroke:'#9c7a3c',dashed:false},
  external:{label:'外部系统',fill:'#f3f4f6',stroke:'#8a94a0',dashed:true},
  security:{label:'安全边界',fill:'#faf1f2',stroke:'#b25b6a',dashed:true},
  focal:{label:'焦点',fill:'#e7f2ee',stroke:BOARD_ACCENT,dashed:false},
} as const;
export type BoardNodeType=keyof typeof BOARD_NODE_TYPES;
const nodeType=z.enum(Object.keys(BOARD_NODE_TYPES) as [BoardNodeType,...BoardNodeType[]]).default('process');
export const BoardDiagramSchema=z.object({
  title:plainText(160),summary:plainText(1000),size:z.enum(['auto','slide-16x9','doc-inline','doc-wide']).default('auto'),
  // Horizontal-first: when omitted, flow and state diagrams run left-to-right on a wide
  // canvas so the full picture fits one screen; explicit "down" keeps the vertical reading.
  direction:z.enum(['right','down']).optional(),
  kind:z.enum(['flow','architecture','swimlane','sequence','class','er','state','tree']).default('flow'),
  legend:z.enum(['auto','none']).default('auto'),
  lanes:z.array(z.object({id:identity,name:plainText(24)}).strict()).min(2).max(4).optional(),
  participants:z.array(z.object({id:identity,name:plainText(32),type:nodeType}).strict()).min(2).max(6).optional(),
  messages:z.array(z.object({id:identity,from:identity,to:identity,text:plainText(120),kind:z.enum(['sync','return','self']).default('sync')}).strict()).min(1).max(14).optional(),
  classes:z.array(z.object({id:identity,name:plainText(40),attributes:z.array(plainText(60)).max(8).default([]),methods:z.array(plainText(60)).max(8).default([])}).strict()).min(2).max(6).optional(),
  relations:z.array(z.object({id:identity,from:identity,to:identity,kind:z.enum(['association','aggregation','composition','inheritance','dependency']).default('association'),label:plainText(20).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_RELATION_LABEL_SHORT_SINGLE_LINE_REQUIRED').optional()}).strict()).max(10).optional(),
  entities:z.array(z.object({id:identity,name:plainText(40),fields:z.array(z.object({name:plainText(40),type:plainText(30).optional(),pk:z.boolean().default(false)}).strict()).min(1).max(10)}).strict()).min(2).max(6).optional(),
  entityRelations:z.array(z.object({id:identity,from:identity,to:identity,cardinality:z.enum(['one-one','one-many','many-many']).default('one-many'),label:plainText(20).refine(text=>Array.from(text).length<=14&&!/[\r\n\t]/.test(text),'BOARD_RELATION_LABEL_SHORT_SINGLE_LINE_REQUIRED').optional()}).strict()).max(10).optional(),
  states:z.array(z.object({id:identity,name:plainText(40).optional(),initial:z.boolean().default(false),final:z.boolean().default(false)}).strict().refine(state=>!state.initial||!state.final,'BOARD_STATE_INITIAL_FINAL_EXCLUSIVE')).min(2).max(8).optional(),
  transitions:z.array(z.object({id:identity,from:identity,to:identity,label:shortLabel.optional()}).strict()).min(1).max(16).optional(),
  groups:z.array(z.object({id:identity,label:plainText(40),nodes:z.array(identity).min(2).max(12)}).strict()).min(1).max(4).optional(),
  nodes:z.array(z.object({id:identity,kind:z.enum(['rectangle','diamond','ellipse','text']).default('rectangle'),text:plainText(240),type:nodeType,tone:z.enum(['neutral','accent']).default('neutral'),sub:plainText(60).optional(),lane:identity.optional(),x:coordinate.optional(),y:coordinate.optional(),width:z.number().finite().min(120).max(480).optional(),height:z.number().finite().min(64).max(400).optional()}).strict().refine(n=>(n.x===undefined)===(n.y===undefined),'BOARD_COORDINATES_PAIR_REQUIRED')).max(12).default([]),
  edges:z.array(z.object({id:identity,from:identity,to:identity,variant:z.enum(['solid','dashed','emphasis']).default('solid'),label:shortLabel.optional()}).strict()).max(16).default([]),
}).strict().superRefine((diagram,ctx)=>{
  const ids=new Set<string>();
  for(const item of [...diagram.nodes,...diagram.edges,...(diagram.participants??[]),...(diagram.messages??[]),...(diagram.classes??[]),...(diagram.relations??[]),...(diagram.entities??[]),...(diagram.entityRelations??[]),...(diagram.states??[]),...(diagram.transitions??[]),...(diagram.groups??[])]){if(ids.has(item.id))ctx.addIssue({code:'custom',message:'BOARD_DUPLICATE_ID'});ids.add(item.id);}
  if(diagram.kind==='er'){
    if(!diagram.entities||diagram.entities.length<2)ctx.addIssue({code:'custom',message:'BOARD_ER_ENTITIES_REQUIRED: ER 图需要2–6个实体'});
    if(diagram.nodes.length||diagram.edges.length)ctx.addIssue({code:'custom',message:'BOARD_ER_NO_NODES: ER 图请使用 entities/entityRelations，不要使用 nodes/edges'});
    if(diagram.classes||diagram.relations)ctx.addIssue({code:'custom',message:'BOARD_CLASS_FIELDS_ONLY: classes/relations 仅用于 kind=class'});
    if(diagram.participants||diagram.messages)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_FIELDS_ONLY: participants/messages 仅用于 kind=sequence'});
    if(diagram.lanes)ctx.addIssue({code:'custom',message:'BOARD_LANES_SWIMLANE_ONLY: lanes 仅用于 kind=swimlane'});
    if(diagram.states||diagram.transitions)ctx.addIssue({code:'custom',message:'BOARD_STATE_FIELDS_ONLY: states/transitions 仅用于 kind=state'});
    if(diagram.groups)ctx.addIssue({code:'custom',message:'BOARD_GROUPS_FLOW_ONLY: groups 仅用于 kind=flow'});
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
    if(diagram.states||diagram.transitions)ctx.addIssue({code:'custom',message:'BOARD_STATE_FIELDS_ONLY: states/transitions 仅用于 kind=state'});
    if(diagram.groups)ctx.addIssue({code:'custom',message:'BOARD_GROUPS_FLOW_ONLY: groups 仅用于 kind=flow'});
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
    if(diagram.states||diagram.transitions)ctx.addIssue({code:'custom',message:'BOARD_STATE_FIELDS_ONLY: states/transitions 仅用于 kind=state'});
    if(diagram.groups)ctx.addIssue({code:'custom',message:'BOARD_GROUPS_FLOW_ONLY: groups 仅用于 kind=flow'});
    if(diagram.direction==='right')ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_DIRECTION_DOWN: 时序图固定自上而下'});
    const known=new Set((diagram.participants??[]).map(p=>p.id));
    for(const message of diagram.messages??[]){
      if(!known.has(message.from)||!known.has(message.to))ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_REFERENCE_INVALID: 消息端点必须是已声明的参与者'});
      if(message.kind==='self'&&message.from!==message.to)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_SELF_REFERENCE: 自调用消息的起点与终点必须相同'});
      if(message.kind!=='self'&&message.from===message.to)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_SELF_KIND_REQUIRED: 同参与者消息请标记 kind=self'});
    }
    return;
  }
  if(diagram.participants||diagram.messages)ctx.addIssue({code:'custom',message:'BOARD_SEQUENCE_FIELDS_ONLY: participants/messages 仅用于 kind=sequence'});
  if(diagram.kind==='state'){
    if(!diagram.states||diagram.states.length<2)ctx.addIssue({code:'custom',message:'BOARD_STATE_STATES_REQUIRED: 状态图需要2–8个状态'});
    if(!diagram.transitions||!diagram.transitions.length)ctx.addIssue({code:'custom',message:'BOARD_STATE_TRANSITIONS_REQUIRED: 状态图至少需要1条转移'});
    if(diagram.nodes.length||diagram.edges.length)ctx.addIssue({code:'custom',message:'BOARD_STATE_NO_NODES: 状态图请使用 states/transitions，不要使用 nodes/edges'});
    if(diagram.lanes)ctx.addIssue({code:'custom',message:'BOARD_LANES_SWIMLANE_ONLY: lanes 仅用于 kind=swimlane'});
    if(diagram.groups)ctx.addIssue({code:'custom',message:'BOARD_GROUPS_FLOW_ONLY: groups 仅用于 kind=flow'});
    const known=new Set((diagram.states??[]).map(state=>state.id));
    for(const state of diagram.states??[]){
      if(!state.initial&&!state.final&&!state.name)ctx.addIssue({code:'custom',message:'BOARD_STATE_NAME_REQUIRED: 非起始/终态必须命名'});
    }
    if((diagram.states??[]).filter(state=>state.initial).length>2)ctx.addIssue({code:'custom',message:'BOARD_STATE_INITIAL_BUDGET: 最多2个起始态'});
    if((diagram.states??[]).filter(state=>state.final).length>2)ctx.addIssue({code:'custom',message:'BOARD_STATE_FINAL_BUDGET: 最多2个终态'});
    for(const transition of diagram.transitions??[]){
      if(!known.has(transition.from)||!known.has(transition.to))ctx.addIssue({code:'custom',message:'BOARD_STATE_REFERENCE_INVALID: 转移端点必须是已声明的状态'});
      if(transition.from===transition.to)ctx.addIssue({code:'custom',message:'BOARD_STATE_SELF_TRANSITION: 自转移请拆为中间状态（布线不支持自环）'});
    }
    return;
  }
  if(diagram.kind==='tree'){
    if(diagram.lanes||diagram.participants||diagram.messages||diagram.classes||diagram.relations||diagram.entities||diagram.entityRelations||diagram.states||diagram.transitions||diagram.groups)ctx.addIssue({code:'custom',message:'BOARD_TREE_FIELDS_ONLY: 层级图只用 nodes/edges（edges 表达父→子）'});
    if(diagram.nodes.length<2)ctx.addIssue({code:'custom',message:'BOARD_TREE_NODES_REQUIRED: 层级图至少 2 个节点'});
    if(diagram.edges.length!==diagram.nodes.length-1)ctx.addIssue({code:'custom',message:'BOARD_TREE_EDGE_COUNT: 层级图的边数必须等于节点数-1（每节点恰有一个父，根除外）'});
    if(diagram.edges.some(e=>e.label))ctx.addIssue({code:'custom',message:'BOARD_TREE_NO_LABEL: 层级图连线不支持标签，请把信息写进节点文字或 sub'});
    const parentOf=new Map<string,string>();
    for(const edge of diagram.edges){
      if(parentOf.has(edge.to))ctx.addIssue({code:'custom',message:'BOARD_TREE_SINGLE_PARENT: 每个节点最多一个父节点'});
      parentOf.set(edge.to,edge.from);
    }
    const known=new Set(diagram.nodes.map(n=>n.id));
    const roots=diagram.nodes.filter(n=>!parentOf.has(n.id)).map(n=>n.id);
    if(roots.length!==1)ctx.addIssue({code:'custom',message:'BOARD_TREE_SINGLE_ROOT: 层级图必须有且只有一个根节点'});
    else{
      const childrenOf=new Map<string,string[]>();
      for(const edge of diagram.edges){if(!known.has(edge.from)||!known.has(edge.to))ctx.addIssue({code:'custom',message:'BOARD_EDGE_REFERENCE_INVALID'});else childrenOf.set(edge.from,[...(childrenOf.get(edge.from)??[]),edge.to]);}
      const seen=new Set<string>(roots),queue=[...roots];
      while(queue.length){const id=queue.shift()!;for(const child of childrenOf.get(id)??[])if(!seen.has(child)){seen.add(child);queue.push(child);}}
      if(seen.size!==diagram.nodes.length)ctx.addIssue({code:'custom',message:'BOARD_TREE_CONNECTED: 层级图必须连通且无环（检查 edges 是否成环或有游离节点）'});
    }
    return;
  }
  if(diagram.states||diagram.transitions)ctx.addIssue({code:'custom',message:'BOARD_STATE_FIELDS_ONLY: states/transitions 仅用于 kind=state'});
  if(!diagram.nodes.length)ctx.addIssue({code:'custom',message:'BOARD_NODES_REQUIRED: 请至少提供一个节点'});
  const nodes=new Map(diagram.nodes.map(n=>[n.id,n]));
  for(const edge of diagram.edges)if(edge.from===edge.to||!nodes.has(edge.from)||!nodes.has(edge.to)||nodes.get(edge.from)?.kind==='text'||nodes.get(edge.to)?.kind==='text')ctx.addIssue({code:'custom',message:'BOARD_EDGE_REFERENCE_INVALID'});
  if(diagram.nodes.filter(n=>n.type==='focal'||n.tone==='accent').length>2)ctx.addIssue({code:'custom',message:'BOARD_ACCENT_BUDGET: 最多2个焦点节点（type=focal）'});
  if(diagram.groups){
    if(!['flow','architecture'].includes(diagram.kind))ctx.addIssue({code:'custom',message:'BOARD_GROUPS_FLOW_ONLY: groups 仅用于 kind=flow/architecture'});
    const assigned=new Set<string>();
    for(const group of diagram.groups){
      for(const nodeId of group.nodes){
        if(!nodes.has(nodeId))ctx.addIssue({code:'custom',message:'BOARD_GROUP_REFERENCE_INVALID: 分组成员必须是已声明的节点'});
        if(assigned.has(nodeId))ctx.addIssue({code:'custom',message:'BOARD_GROUP_MEMBER_UNIQUE: 每个节点最多属于一个分组'});
        assigned.add(nodeId);
      }
    }
  }
  for(const node of diagram.nodes.filter(n=>n.kind==='diamond')){const outgoing=diagram.edges.filter(e=>e.from===node.id);if(outgoing.length<2||outgoing.length>3||outgoing.some(e=>!e.label))ctx.addIssue({code:'custom',message:'BOARD_DECISION_BRANCHES_REQUIRED: 决策须有2–3条带标签的出边'});}
  if(diagram.kind==='swimlane'){
    const laneIds=new Set<string>();
    if(!diagram.lanes||diagram.lanes.length<2)ctx.addIssue({code:'custom',message:'BOARD_SWIMLANE_LANES_REQUIRED: 泳道图需要声明2–4个泳道'});
    else{
      for(const lane of diagram.lanes){if(laneIds.has(lane.id))ctx.addIssue({code:'custom',message:'BOARD_DUPLICATE_ID'});laneIds.add(lane.id);}
      if(diagram.direction==='right')ctx.addIssue({code:'custom',message:'BOARD_SWIMLANE_DIRECTION_DOWN: 泳道图固定为纵向泳道、自上而下'});
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

type SizedNode={node:BoardDiagram['nodes'][number];width:number;height:number;text:BoardElement;sub?:BoardElement};
/** Ignore DFS back-edges for rank assignment; shared by flow and state layouts. */
function rankByTopology(nodeIds:string[],edges:readonly{id:string;from:string;to:string}[]):Map<string,number>{
  const levels=new Map(nodeIds.map(id=>[id,0])),incoming=new Map(nodeIds.map(id=>[id,0]));
  const mark=new Map<string,number>(),backEdges=new Set<string>();
  const visit=(id:string)=>{mark.set(id,1);for(const edge of edges){if(edge.from!==id)continue;if(mark.get(edge.to)===1)backEdges.add(edge.id);else if(!mark.has(edge.to))visit(edge.to);}mark.set(id,2);};
  for(const id of nodeIds)if(!mark.has(id))visit(id);
  const forward=edges.filter(e=>!backEdges.has(e.id));
  for(const e of forward)incoming.set(e.to,incoming.get(e.to)!+1);
  const queue=nodeIds.filter(id=>!incoming.get(id)),visited=new Set<string>();
  while(queue.length){const id=queue.shift()!;visited.add(id);for(const e of forward.filter(e=>e.from===id)){levels.set(e.to,Math.max(levels.get(e.to)!,levels.get(id)!+1));incoming.set(e.to,incoming.get(e.to)!-1);if(incoming.get(e.to)===0)queue.push(e.to);}}
  if(visited.size!==nodeIds.length)nodeIds.forEach((id,i)=>levels.set(id,i));
  return levels;
}
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
// Shared by flow and state layouts: edges/direction/groupRank are passed so both kinds
// use the same ranked, annealed placement search.
function compactCandidates(sizes:ReadonlyArray<{node:{id:string;kind:string;x?:number;y?:number};width:number;height:number}>,edges:readonly{from:string;to:string}[],direction:'right'|'down',bounds:Rect,levels:Map<string,number>,groupRank?:Map<string,number>):Box[][]{
  const result:Box[][]=[],fixed=sizes.every(s=>s.node.x!==undefined);
  const add=(positions:{x:number;y:number}[])=>{const boxes=sizes.map((s,i)=>({id:s.node.id,kind:s.node.kind,x:grid(s.node.x??positions[i]!.x),y:grid(s.node.y??positions[i]!.y),width:s.width,height:s.height}));if(boxes.every(b=>b.x>=bounds.x&&b.y>=bounds.y&&b.x+b.width<=bounds.x+bounds.width&&b.y+b.height<=bounds.y+bounds.height))result.push(boxes);};
  if(fixed){add(sizes.map(s=>({x:s.node.x!,y:s.node.y!})));return result;}
  // Within a rank, grouped members stay adjacent so boundary boxes stay compact.
  const orderKey=(id:string)=>((groupRank?.get(id)??99)*1000)+(levels.get(id)??0);
  const ranks=[...new Set(levels.values())].sort((a,b)=>a-b),inset=32;
  // Tight first, then roomy variants: horizontal chains need wider columns so edge
  // labels fit between ranks; deep chains often only route legibly with the extra room.
  for(const crossGap of [40,64])for(const direction2 of [direction,direction==='down'?'right':'down'] as const)for(const axisGap of direction2==='right'?[104,72,48,136]:[48,72,96]){
    let axis=direction2==='down'?bounds.y+inset:bounds.x+inset;const positions=new Map<string,{x:number;y:number}>();
    for(const rank of ranks){const group=sizes.filter(s=>levels.get(s.node.id)===rank).sort((a,b)=>orderKey(a.node.id)-orderKey(b.node.id)),crossSize=group.reduce((sum,s)=>sum+(direction2==='down'?s.width:s.height),0)+(group.length-1)*crossGap;let cross=(direction2==='down'?bounds.x:bounds.y)+((direction2==='down'?bounds.width:bounds.height)-crossSize)/2;for(const s of group){positions.set(s.node.id,direction2==='down'?{x:cross,y:axis}:{x:axis,y:cross});cross+=(direction2==='down'?s.width:s.height)+crossGap;}axis+=Math.max(...group.map(s=>direction2==='down'?s.height:s.width))+(group.some(s=>s.node.kind==='diamond')?Math.max(64,axisGap):axisGap);}
    add(sizes.map(s=>positions.get(s.node.id)!));
  }
  // Compact grid candidates use a bounded deterministic placement search. It is a
  // layout heuristic, not a promise to embed every graph; the router rejects failures.
  const ids=sizes.map(s=>s.node.id),edgeIndices=edges.map(e=>[ids.indexOf(e.from),ids.indexOf(e.to)] as const);
  // Cluster only matters within a rank: pulling cross-rank members into one column
  // would break the left-to-right flow and force U-shaped detours.
  const groupPairs:[number,number][]=[];if(groupRank)for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const gi=groupRank.get(ids[i]!);if(gi!==undefined&&gi===groupRank.get(ids[j]!)&&(levels.get(ids[i]!)??0)===(levels.get(ids[j]!)??0))groupPairs.push([i,j]);}
  for(const columns of (direction==='right'?[4,5,3,6,2]:[3,4,2,5]) as number[]){
    const rows=Math.ceil(sizes.length/columns),cellW=(bounds.width-inset*2)/columns,cellH=(bounds.height-inset*2)/rows;
    if(sizes.some(s=>s.width+40>cellW||s.height+40>cellH))continue;
    const slots=Array.from({length:columns*rows},(_,i)=>({x:bounds.x+inset+(i%columns+.5)*cellW,y:bounds.y+inset+(Math.floor(i/columns)+.5)*cellH}));
    const score=(order:number[])=>{let cost=0;const ps=order.slice(0,sizes.length).map(i=>slots[i]!);for(const [a,b]of edgeIndices){const u=ps[a]!,v=ps[b]!;cost+=Math.abs(u.x-v.x)+Math.abs(u.y-v.y);
      // Forward edges (rank increases) must advance along the main direction; otherwise
      // the router is forced into S-shaped detours that read backwards.
      const rankFrom=levels.get(ids[a]!)??0,rankTo=levels.get(ids[b]!)??0;
      if(rankTo>rankFrom&&(direction==='right'?v.x<u.x+40:v.y<u.y+40))cost+=9000;
      for(let i=0;i<ps.length;i++){if(i===a||i===b)continue;const p=ps[i]!,cross=(v.x-u.x)*(p.y-u.y)-(v.y-u.y)*(p.x-u.x);if(Math.abs(cross)<1&&p.x>=Math.min(u.x,v.x)&&p.x<=Math.max(u.x,v.x)&&p.y>=Math.min(u.y,v.y)&&p.y<=Math.max(u.y,v.y))cost+=3000;}}
      for(let i=0;i<edgeIndices.length;i++)for(let j=0;j<i;j++){const[a,b]=edgeIndices[i]!,[c,d]=edgeIndices[j]!;if([a,b].includes(c)||[a,b].includes(d))continue;const u=ps[a]!,v=ps[b]!,p=ps[c]!,q=ps[d]!,cross=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(cross(u,v,p)*cross(u,v,q)<0&&cross(p,q,u)*cross(p,q,v)<0)cost+=8000;}
      for(let i=0;i<sizes.length;i++){const p=ps[i]!;if(!edgeIndices.some(([,to])=>to===i))cost+=(p.x-bounds.x)*3+(p.y-bounds.y)*5;if(!edgeIndices.some(([from])=>from===i))cost+=(bounds.x+bounds.width-p.x)*3+(bounds.y+bounds.height-p.y)*5;}
      for(const [a,b] of groupPairs){const u=ps[a]!,v=ps[b]!;cost+=(Math.abs(u.x-v.x)+Math.abs(u.y-v.y))*2;}
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
  // Short accent rule under the title: the brand-band language shared with the PDF cards.
  const titleBand=(title:BoardElement):BoardElement=>{const band=base('titleband','rectangle',32,grid(title.y+title.height+8),48,4);band.backgroundColor=BOARD_ACCENT;band.strokeColor='transparent';band.strokeWidth=0;band.locked=true;band.customData={boardRole:'title-band'};return band;};
  // Compact bottom-right legend, frameless: an 8px dot + 11px label per row, right-aligned.
  // Locked chrome outside the routed content area; the footer reserve covers its height.
  const legendPanel=(entries:readonly{label:string;fill:string;stroke:string;dashed?:boolean;shape?:'node'|'edge'}[],frame:{width:number;height:number}):BoardElement[]=>{
    const rowH=18,items:BoardElement[]=[];
    entries.forEach((entry,index)=>{
      const text=label('lgtxt_'+index,entry.label,0,0,gridUp(textBudget(entry.label,11)+4),null,11);
      const w=gridUp(text.width+22),x=grid(frame.width-24-w),y=grid(frame.height-24-entries.length*rowH+index*rowH+3);
      // Node kinds show a dot; edge kinds show a line sample, matching what they mean.
      const swatch=entry.shape==='edge'?Object.assign(base('lgsw_'+index,'line',x,y+4,18,0),{points:[[0,0],[18,0]],strokeColor:entry.stroke,strokeWidth:3,strokeStyle:entry.dashed?'dashed':'solid',startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:null,lastCommittedPoint:null}):(()=>{const dot=base('lgsw_'+index,'ellipse',x,y,10,10);dot.backgroundColor=entry.stroke;dot.strokeColor=entry.dashed?'#8f979d':entry.stroke;dot.strokeWidth=entry.dashed?1.5:1;dot.strokeStyle=entry.dashed?'dashed':'solid';return dot;})();
      swatch.locked=true;swatch.customData={boardRole:'legend-swatch',entry:index,...(entry.shape?{shape:entry.shape}:{})};
      Object.assign(text,{x:x+16,y:grid(frame.height-24-entries.length*rowH+index*rowH+1)});text.strokeColor='#3a4147';text.locked=true;text.customData={boardRole:'legend-item',entry:index};
      items.push(swatch,text);
    });
    return items;
  };
  // Eyebrow + title block, shared by every kind: a small muted kind tag above the title.
  const titleBlock=(width:number,titleSize:number):{title:BoardElement;kindTag:BoardElement;top:number}=>{
    const title=label('title',diagram.title,32,32,width-64,null,titleSize,true);
    title.customData={boardRole:'title'};
    // Kind tag rides the top-right corner of the empty margin: archify's eyebrow without
    // spending any vertical space.
    const kindTag=label('kindtag',KIND_LABELS[diagram.kind],0,16,gridUp(textBudget(KIND_LABELS[diagram.kind],11)+4),null,11);
    kindTag.x=grid(width-32-kindTag.width);kindTag.strokeColor='#7a858c';kindTag.customData={boardRole:'kind-tag'};
    return{title,kindTag,top:gridUp(title.y+title.height+20)};
  };
  // Bottom-left figure caption: kind tag + the model's summary, one muted line.
  const summaryNote=(frame:{width:number;height:number}):BoardElement=>{
    const full=KIND_LABELS[diagram.kind]+' · '+diagram.summary;
    const text=Array.from(full).length>44?Array.from(full).slice(0,43).join('')+'…':full;
    const note=label('summary',text,32,grid(frame.height-26),Math.min(frame.width-64,grid(frame.width*.58)),null,12);
    note.strokeColor='#687176';note.locked=true;note.customData={boardRole:'summary-note'};
    return note;
  };
  /** Trim the fixed preset's unused bottom band: a diagram whose content is 380px tall
   * should not ship a 720px canvas with a dead half. Never below 480 so the figure still
   * reads as a plate rather than a strip. */
  const settleFrame=(all:readonly BoardElement[],frame:{width:number;height:number},reserve:number)=>{
    const content=all.filter(element=>{const role=String(element.customData?.boardRole);return role!=='canvas'&&!role.startsWith('legend')&&role!=='summary-note';});
    if(!content.length)return frame;
    const bottom=Math.max(...content.map(element=>element.y+element.height));
    const height=gridUp(Math.max(480,Math.min(frame.height,bottom+24+reserve)));
    if(height===frame.height)return frame;
    const canvas=all.find(element=>element.customData?.boardRole==='canvas');
    if(canvas){canvas.height=height;canvas.customData={...canvas.customData,height};}
    return{width:frame.width,height};
  };
  // Legend shows the semantic palette actually used; tone=accent renders as focal.
  const nodeTypeOf=(node:BoardDiagram['nodes'][number])=>node.type==='focal'||node.tone==='accent'?'focal':node.type;
  const usedTypes=[...new Set(diagram.nodes.filter(n=>n.kind!=='text').map(nodeTypeOf))].map(type=>({label:BOARD_NODE_TYPES[type].label,fill:BOARD_NODE_TYPES[type].fill,stroke:BOARD_NODE_TYPES[type].stroke,...(BOARD_NODE_TYPES[type].dashed?{dashed:true as const}:{})}));
  const usedVariants=new Set(diagram.edges.map(edge=>edge.variant));
  const variantEntries=[...(usedVariants.has('emphasis')?[{label:'主路径',fill:'#ffffff',stroke:BOARD_ACCENT,shape:'edge' as const}]:[]),...(usedVariants.has('dashed')?[{label:'异步 / 可选',fill:'#ffffff',stroke:'#8f979d',dashed:true as const,shape:'edge' as const}]:[])];
  const legendEntries=diagram.legend==='none'?[]:[...usedTypes,...variantEntries];
  const footerReserve=legendEntries.length>=2?gridUp(legendEntries.length*18+18):24;
  // Content-driven widths: a 4-character label never reserves 224px of empty box, so
  // deep chains still fit a wide canvas and the whole picture stays one screen wide.
  const measureNodes=():SizedNode[]=>diagram.nodes.map(node=>{const budget=Math.max(textBudget(node.text,18),node.sub?textBudget(node.sub,12):0),natural=Math.max(120,Math.min(480,gridUp(budget+40))),width=gridUp(node.width??(node.kind==='diamond'?Math.max(224,natural):node.kind==='ellipse'?Math.max(160,natural):node.kind==='text'?natural:natural)),inner=width*(node.kind==='diamond'?.64:node.kind==='ellipse'?.68:1)-(node.kind==='rectangle'||node.kind==='text'?32:24),text=label('t_'+node.id,node.text,0,0,inner),sub=node.sub?label('s_'+node.id,node.sub,0,0,inner,null,12):undefined,block=text.height+(sub?sub.height+6:0),minimum=block*(node.kind==='diamond'?2:node.kind==='ellipse'?1.5:1)+32,height=gridUp(Math.max(node.height??(node.kind==='diamond'?104:64),minimum));if(height>400)throw Error('BOARD_NODE_TEXT_TOO_LARGE: 请缩短节点文字或拆分为详情图');return{node,width,height,text,...(sub?{sub}:{})};});
  /** Shared node renderer for flow/architecture/tree/swimlane: typed colors, two-tier
   * labels and the type sigil dot; returns elements plus the shape lookup for edges. */
  const renderFlowNodes=(sizes:ReadonlyArray<SizedNode>,boxes:readonly Box[])=>{
    const out:BoardElement[]=[],placed=new Map<string,BoardElement>();
    for(const {node,width,height,text,sub} of sizes){const {x,y}=boxes.find(b=>b.id===node.id)!;
      if(node.kind==='text'){Object.assign(text,{id:prefix+'n_'+node.id,x,y,width,textAlign:'left',containerId:null});out.push(text);placed.set(node.id,text);continue;}
      const type=nodeTypeOf(node),style=BOARD_NODE_TYPES[type],group=prefix+'ng_'+node.id;
      const shape=base('n_'+node.id,node.kind,x,y,width,height);shape.backgroundColor=style.fill;shape.strokeColor=style.stroke;shape.strokeWidth=type==='focal'?2.5:2;shape.strokeStyle=style.dashed?'dashed':'solid';shape.roundness=node.kind==='rectangle'?{type:3,value:8}:null;shape.customData={boardRole:'node',logicalId:node.id,nodeType:type};shape.groupIds=[group];text.groupIds=[group];
      if(node.kind==='rectangle'){const dot=base('nd_'+node.id,'ellipse',x+10,y+10,8,8);dot.backgroundColor=style.stroke;dot.strokeColor='transparent';dot.strokeWidth=0;dot.groupIds=[group];dot.customData={boardRole:'node-dot',logicalId:node.id};out.push(dot);}
      if(sub){
        const block=text.height+6+sub.height,topY=grid(y+(height-block)/2);
        Object.assign(text,{x:x+(width-text.width)/2,y:topY,containerId:shape.id,textAlign:'center',verticalAlign:'top'});
        Object.assign(sub,{x:x+(width-sub.width)/2,y:grid(topY+text.height+6),containerId:null,textAlign:'center'});
        sub.strokeColor='#687176';sub.customData={boardRole:'node-sub',logicalId:node.id};sub.groupIds=[group];
        shape.boundElements=[{id:text.id,type:'text'}];out.push(shape,text,sub);
      }else{
        Object.assign(text,{x:x+(width-text.width)/2,y:y+(height-text.height)/2,containerId:shape.id,textAlign:'center',verticalAlign:'middle'});shape.boundElements=[{id:text.id,type:'text'}];out.push(shape,text);
      }
      placed.set(node.id,shape);
    }
    return{elements:out,placed};
  };

  // Sequence diagrams use lifelines instead of routed edges. Each lifeline is a 2px
  // rectangle so Excalidraw can bind message arrows to it; dragging a participant moves
  // the whole group and the bound messages follow.
  if(diagram.kind==='sequence'){
    const participants=diagram.participants!;
    const messages=diagram.messages!;
    const width=diagram.size==='doc-inline'?960:diagram.size==='slide-16x9'||diagram.size==='doc-wide'?1280:participants.length>4?1280:960;
    const titleSize=diagram.size==='slide-16x9'?40:28;
    const {title,kindTag,top}=titleBlock(width,titleSize);
    if(title.text.split('\n').length>2)throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');
    const headerW=120,baseHeaderH=48,baseRowH=56,gapBelowHeader=48,contentX=32,contentW=width-64;
    const gap=(contentW-participants.length*headerW)/(participants.length-1);
    if(gap<88)throw Error('BOARD_SEQUENCE_TOO_WIDE: 参与者过多，画幅放不下可读的生命线间距；请减少参与者或拆图');
    const columns=participants.map((participant,index)=>({participant,x:grid(contentX+index*(headerW+gap))}));
    // Headers grow with the wrapped participant name; the lifeline starts at the real bottom.
    const nameHeights=new Map(participants.map(participant=>{const measured=label('pn_'+participant.id,participant.name,0,0,headerW-16,null,16);return[participant.id,measured.height] as const;}));
    const singleNameHeight=16*lineHeight,headerH=Math.max(baseHeaderH,gridUp(Math.max(...participants.map(participant=>nameHeights.get(participant.id)!))+16));
    const headerY=top,lifelineTop=headerY+headerH;
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
      const pStyle=BOARD_NODE_TYPES[participant.type];header.backgroundColor=pStyle.fill;header.strokeColor=pStyle.stroke;header.strokeStyle=pStyle.dashed?'dashed':'solid';header.roundness={type:3,value:8};header.groupIds=[group];header.customData={boardRole:'participant',logicalId:participant.id};
      const name=label('pn_'+participant.id,participant.name,x+8,headerY+(nameHeight<=singleNameHeight+1e-9?(headerH-18*lineHeight)/2:(headerH-nameHeight)/2),headerW-16,header.id,16);
      name.groupIds=[group];name.customData={boardRole:'participant-name',logicalId:participant.id};
      header.boundElements=[{id:name.id,type:'text'}];
      const lifeline=base('ll_'+participant.id,'rectangle',x+headerW/2-1,lifelineTop,2,lifelineBottom-lifelineTop);
      lifeline.backgroundColor='transparent';lifeline.strokeColor='#9aa1a7';lifeline.strokeWidth=2;lifeline.strokeStyle='dashed';lifeline.groupIds=[group];lifeline.customData={boardRole:'lifeline',logicalId:participant.id};
      lifelines.set(participant.id,lifeline);headers.push(header);
      elements.push(lifeline,header,name);
    }
    // Activation bars: the UML "busy" span on each lifeline, from its first involved
    // message to its last, sits under the arrows and over the dashed lifeline.
    const spanOf=new Map<string,{top:number;bottom:number}>();
    plans.forEach((plan,index)=>{const y=rowYs[index]!,reach=plan.message.from===plan.message.to?32:0;for(const id of [plan.message.from,plan.message.to]){const span=spanOf.get(id)??{top:y-12,bottom:y+12};span.top=Math.min(span.top,y-12);span.bottom=Math.max(span.bottom,y+reach+12);spanOf.set(id,span);}});
    for(const {participant,x} of columns){
      const span=spanOf.get(participant.id);if(!span)continue;
      const activation=base('act_'+participant.id,'rectangle',grid(x+headerW/2-6),grid(span.top),12,gridUp(span.bottom-span.top));
      activation.backgroundColor='#ffffff';activation.strokeColor='#3a4147';activation.strokeWidth=1.5;activation.groupIds=[prefix+'pg_'+participant.id];activation.customData={boardRole:'activation',logicalId:participant.id};
      elements.push(activation);
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
      start.boundElements!.push({id:arrow.id,type:'arrow'});
      if(end.id!==start.id)end.boundElements!.push({id:arrow.id,type:'arrow'});
      const text=label('ml_'+message.id,message.text,labelX,y-26-Math.max(0,labelHeight-baseLabelHeight),labelWidth,null,14);
      text.customData={boardRole:'message-label',messageId:message.id};
      elements.push(arrow,text);
    });
    const canvas={...base('canvas','rectangle',0,0,width,height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width,height}};
    const all:BoardElement[]=[canvas,kindTag,title,titleBand(title),...elements,summaryNote({width,height})];
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
    return{diagram,elements:all,summary:{nodes:participants.length,edges:messages.length,lanes:0,text:diagram.summary,checks:{ok:true,participants:participants.length,messages:messages.length,frameContained:true,canvas:{size:diagram.size,width,height,contentBounds:{x:contentX,y:headerY,width:contentW,height:lifelineBottom-headerY}},accents:0,budget:{nodes:12,arrows:16,focal:2,lanes:4,participants:6,messages:14,states:8,transitions:16,groups:4},cornerRadius:'native-elbow-max-16'}},routes:[]};
  }
  // ER diagrams: entity boxes with typed fields; cardinality uses native crowfoot heads.
  if(diagram.kind==='er'){
    const entities=diagram.entities!;
    const relations=diagram.entityRelations??[];
    const cols=entities.length<=4?2:3,width=cols===2?960:1280,titleSize=diagram.size==='slide-16x9'?40:28;
    const {title,kindTag,top}=titleBlock(width,titleSize);
    if(title.text.split('\n').length>2)throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');
    const fieldText=(field:{name:string;type?:string;pk:boolean})=>(field.pk?'PK · ':'')+field.name+(field.type?' : '+field.type:'');
    const contentX=32,contentW=width-64,contentTop=top,cellMax=cols===2?300:280,padX=12,rowH=22,headerH=36,gapX=64,gapY=64;
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
      box.backgroundColor='#ffffff';box.strokeColor=BOARD_ACCENT;box.roundness={type:3,value:6};box.groupIds=[group];box.customData={boardRole:'entity',logicalId:item.entity.id};
      const name=label('entname_'+item.entity.id,item.entity.name,pos.x+padX,pos.y+8,item.width-padX*2,null,18);
      name.textAlign='center';name.groupIds=[group];name.customData={boardRole:'entity-name',logicalId:item.entity.id};
      const separator=base('entline_'+item.entity.id,'line',pos.x,pos.y+item.headerH,item.width,0);
      Object.assign(separator,{points:[[0,0],[item.width,0]],strokeColor:BOARD_ACCENT,strokeWidth:1,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:null,lastCommittedPoint:null,groupIds:[group],customData:{boardRole:'entity-separator',logicalId:item.entity.id}});
      const nameBar=base('entnb_'+item.entity.id,'rectangle',pos.x+1,pos.y+1,item.width-2,item.headerH-1);
      nameBar.backgroundColor='#eef2f0';nameBar.strokeColor='transparent';nameBar.strokeWidth=0;nameBar.groupIds=[group];nameBar.customData={boardRole:'entity-namebar',logicalId:item.entity.id};
      elements.push(box,nameBar,separator,name);
      let fieldY=pos.y+item.headerH+4;
      item.fieldRows.forEach((row,index)=>{const line=label('entf_'+item.entity.id+'_'+index,row.text,pos.x+padX,fieldY,item.width-padX*2,null,14);line.groupIds=[group];line.customData={boardRole:'entity-field',logicalId:item.entity.id};elements.push(line);fieldY+=row.height;});
    }
    const headsByCardinality={'one-one':['crowfoot_one','crowfoot_one'],'one-many':['crowfoot_one','crowfoot_many'],'many-many':['crowfoot_many','crowfoot_many']} as const;
    const cardinalityById=new Map(relations.map(relation=>[relation.id,relation.cardinality]));
    const labels:BoardElement[]=[],labelRects:Rect[]=[];
    for(const route of routing.routes){
      const fromId=elementIdById.get(route.from)!,toId=elementIdById.get(route.to)!,a=route.points[0]!,points=route.points.map(point=>[point[0]-a[0],point[1]-a[1]]);
      const heads=headsByCardinality[cardinalityById.get(route.id)??'one-many'];
      const arrow:BoardElement={...base('errel_'+route.id,'arrow',a[0],a[1],Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]))),strokeColor:BOARD_ACCENT,points,lastCommittedPoint:null,startBinding:{elementId:fromId,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:toId,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead:heads[0],endArrowhead:heads[1],elbowed:points.length>2,fixedSegments:points.slice(2,-1).map((end,index)=>({index:index+2,start:points[index+1],end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'er-relation',logicalId:route.id,cardinality:cardinalityById.get(route.id)??'one-many',from:route.from,to:route.to}};
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
    const all:BoardElement[]=[canvas,kindTag,title,titleBand(title),...elements,...labels,summaryNote({width,height})];
    if(new Set(all.map(element=>element.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:entities.length,edges:relations.length,lanes:0,text:diagram.summary,checks:{ok:true,entities:entities.length,relations:relations.length,frameContained:true,fallbackRouting:routing.fallback,canvas:{size:diagram.size,width,height,contentBounds:bounds},accents:0,budget:{nodes:12,arrows:16,focal:2,lanes:4,participants:6,messages:14,classes:6,relations:10,entities:6,states:8,transitions:16,groups:4},cornerRadius:'native-elbow-max-16'}},routes:routing.routes};
  }
  // Class diagrams: three-compartment boxes on a centered grid, relations routed
  // orthogonally with UML arrowheads (hollow triangle/diamond, filled diamond, dashed arrow).
  if(diagram.kind==='class'){
    const classes=diagram.classes!;
    const relations=diagram.relations??[];
    const cols=classes.length<=4?2:3,width=cols===2?960:1280,titleSize=diagram.size==='slide-16x9'?40:28;
    const {title,kindTag,top}=titleBlock(width,titleSize);
    if(title.text.split('\n').length>2)throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');
    const contentX=32,contentW=width-64,contentTop=top,cellMax=cols===2?300:280,padX=12,rowH=22,headerH=36,gapX=64,gapY=64;
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
      box.backgroundColor='#ffffff';box.strokeColor=BOARD_ACCENT;box.roundness={type:3,value:6};box.groupIds=[group];box.customData={boardRole:'class',logicalId:item.entry.id};
      const name=label('clsname_'+item.entry.id,item.entry.name,pos.x+padX,pos.y+8,item.width-padX*2,null,18);
      name.textAlign='center';name.groupIds=[group];name.customData={boardRole:'class-name',logicalId:item.entry.id};
      const separators=[item.headerH,item.headerH+item.attrsH].map((offset,index)=>{const line=base('clsline'+index+'_'+item.entry.id,'line',pos.x,pos.y+offset,item.width,0);Object.assign(line,{points:[[0,0],[item.width,0]],strokeColor:BOARD_ACCENT,strokeWidth:1,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:null,lastCommittedPoint:null,groupIds:[group],customData:{boardRole:'class-separator',logicalId:item.entry.id}});return line;});
      const nameBar=base('clsnb_'+item.entry.id,'rectangle',pos.x+1,pos.y+1,item.width-2,item.headerH-1);
      nameBar.backgroundColor='#eef2f0';nameBar.strokeColor='transparent';nameBar.strokeWidth=0;nameBar.groupIds=[group];nameBar.customData={boardRole:'class-namebar',logicalId:item.entry.id};
      elements.push(box,nameBar,...separators,name);
      let attributeY=pos.y+item.headerH+4;
      item.attributeRows.forEach((row,index)=>{const line=label('clsa_'+item.entry.id+'_'+index,row.text,pos.x+padX,attributeY,item.width-padX*2,null,14);line.groupIds=[group];line.customData={boardRole:'class-attribute',logicalId:item.entry.id};elements.push(line);attributeY+=row.height;});
      let methodY=pos.y+item.headerH+item.attrsH+4;
      item.methodRows.forEach((row,index)=>{const line=label('clsm_'+item.entry.id+'_'+index,row.text,pos.x+padX,methodY,item.width-padX*2,null,14);line.groupIds=[group];line.customData={boardRole:'class-method',logicalId:item.entry.id};elements.push(line);methodY+=row.height;});
    }
    // Ordered from the DSL's `from` endpoint to `to`: ownership runs owner → part.
    const headsByKind={
      composition:['diamond',null],
      aggregation:['diamond_outline',null],
      inheritance:[null,'triangle_outline'],
      dependency:[null,'arrow'],
      association:[null,null],
    } as const;
    const relationById=new Map(relations.map(relation=>[relation.id,relation]));
    const labels:BoardElement[]=[],labelRects:Rect[]=[];
    for(const route of routing.routes){
      const fromId=elementIdById.get(route.from)!,toId=elementIdById.get(route.to)!,a=route.points[0]!,points=route.points.map(point=>[point[0]-a[0],point[1]-a[1]]);
      const relation=relationById.get(route.id)!;
      const [startArrowhead,endArrowhead]=headsByKind[relation.kind];
      const arrow:BoardElement={...base('rel_'+route.id,'arrow',a[0],a[1],Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]))),strokeColor:BOARD_ACCENT,points,lastCommittedPoint:null,startBinding:{elementId:fromId,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:toId,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead,endArrowhead,elbowed:points.length>2,fixedSegments:points.slice(2,-1).map((end,index)=>({index:index+2,start:points[index+1],end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'relation',logicalId:route.id,relationKind:relation.kind,from:route.from,to:route.to}};
      if(relation.kind==='dependency')arrow.strokeStyle='dashed';
      const fromElement=elements.find(element=>element.id===fromId)!,toElement=elements.find(element=>element.id===toId)!;
      fromElement.boundElements!.push({id:arrow.id,type:'arrow'});toElement.boundElements!.push({id:arrow.id,type:'arrow'});elements.push(arrow);
      if(relation.label){
        // Place the multiplicity beside the longest segment, above the line by default and
        // below when a class box or another label would be covered.
        const box=placeRelationLabel(route,relation.label,bounds,boxes,labelRects);
        const mask=base('relmask_'+route.id,'rectangle',box.x,box.y,box.width,box.height),text=label('rellabel_'+route.id,relation.label,box.x+8,box.y+5,box.width-16,mask.id,14);
        mask.backgroundColor='#ffffff';mask.strokeColor='#ffffff';mask.strokeWidth=1;mask.customData={boardRole:'relation-label-mask',relationId:route.id};mask.boundElements=[{id:text.id,type:'text'}];text.customData={boardRole:'relation-label',relationId:route.id};
        const group=prefix+'relgroup_'+route.id;mask.groupIds=[group];text.groupIds=[group];labels.push(mask,text);labelRects.push(box);
      }
    }
    const canvas={...base('canvas','rectangle',0,0,width,height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width,height}};
    const all:BoardElement[]=[canvas,kindTag,title,titleBand(title),...elements,...labels,summaryNote({width,height})];
    if(new Set(all.map(element=>element.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:classes.length,edges:relations.length,lanes:0,text:diagram.summary,checks:{ok:true,classes:classes.length,relations:relations.length,frameContained:true,fallbackRouting:routing.fallback,canvas:{size:diagram.size,width,height,contentBounds:bounds},accents:0,budget:{nodes:12,arrows:16,focal:2,lanes:4,participants:6,messages:14,classes:6,relations:10,states:8,transitions:16,groups:4},cornerRadius:'native-elbow-max-16'}},routes:routing.routes};
  }
  // State machines: capsule states, solid initial dots, double-ring finals. Transitions
  // reuse the ranked + annealed placement and the orthogonal router with masked labels.
  if(diagram.kind==='state'){
    const states=diagram.states!,transitions=diagram.transitions!;
    const levels=rankByTopology(states.map(item=>item.id),transitions);
    const sizing=states.map(item=>{
      if(item.initial||item.final){const diameter=item.final?40:28;return{item,width:diameter,height:diameter,text:null as BoardElement|null};}
      const text=label('t_'+item.id,item.name!,0,0,240,null,16);
      const lineWide=Math.max(...String(text.text).split('\n').map(line=>Array.from(line).reduce((sum,c)=>sum+textBudget(c,16),0)));
      const width=gridUp(Math.max(104,lineWide+40)),height=gridUp(Math.max(48,text.height+20));
      return{item,width,height,text};
    });
    const frames=diagram.size==='auto'?[BOARD_CANVASES.wide,BOARD_CANVASES.standard,BOARD_CANVASES.portrait]:[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide];
    let chosen:{frame:{width:number;height:number};title:BoardElement;kindTag:BoardElement;boxes:Box[];routing:ReturnType<typeof routeBoard>}|undefined;const failures:string[]=[];
    for(const frame of frames){
      const titleSize=diagram.size==='slide-16x9'?40:28,{title,kindTag,top}=titleBlock(frame.width,titleSize);
      if(title.text.split('\n').length>2){failures.push('BOARD_TITLE_TOO_LONG');continue;}
      const bounds={x:32,y:top,width:frame.width-64,height:frame.height-top-32};
      const lite=sizing.map(s=>({node:{id:s.item.id,kind:s.item.initial||s.item.final?'ellipse':'rectangle'},width:s.width,height:s.height}));
      for(const boxes of compactCandidates(lite,transitions,diagram.direction??'right',bounds,levels)){
        try{const routing=routeBoard(boxes,transitions.map(t=>({id:t.id,from:t.from,to:t.to,...(t.label?{label:t.label}:{})})),diagram.direction??'right',{bounds,nodeGap:40,escape:24,nodeClearance:12});chosen={frame,title,kindTag,boxes,routing};break;}
        catch(error){failures.push((error as Error).message);}
      }
      if(chosen)break;
    }
    if(!chosen){if(failures.length&&failures.every(f=>f==='BOARD_TITLE_TOO_LONG'))throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');throw Error('BOARD_LAYOUT_TOO_DENSE: 状态图在固定画幅与可读字号下无法可靠布线，请减少状态或拆分',{cause:{failures:failures.slice(0,6)}});}
    const stateElements:BoardElement[]=[],statePlaced=new Map<string,BoardElement>();
    for(const s of sizing){
      const pos=chosen.boxes.find(b=>b.id===s.item.id)!,group=prefix+'sg_'+s.item.id;
      if(s.item.initial||s.item.final){
        const marker=base('st_'+s.item.id,'ellipse',pos.x,pos.y,s.width,s.height);
        marker.groupIds=[group];marker.customData={boardRole:'state',logicalId:s.item.id,...(s.item.initial?{initial:true}:{final:true})};
        if(s.item.initial){marker.backgroundColor='#3a4147';marker.strokeColor='#3a4147';}
        else{marker.backgroundColor='#ffffff';marker.strokeColor='#3a4147';marker.strokeWidth=2;
          const inner=base('sti_'+s.item.id,'ellipse',grid(pos.x+s.width/2-8),grid(pos.y+s.height/2-8),16,16);
          inner.backgroundColor='#3a4147';inner.strokeColor='#3a4147';inner.groupIds=[group];inner.customData={boardRole:'state-final-core',logicalId:s.item.id};
          stateElements.push(inner);statePlaced.set(s.item.id,marker);}
        stateElements.push(marker);if(!statePlaced.has(s.item.id))statePlaced.set(s.item.id,marker);
        if(s.item.name){const cap=label('stn_'+s.item.id,s.item.name,grid(pos.x+s.width/2-80),grid(pos.y+s.height+8),160,null,12);cap.textAlign='center';cap.strokeColor='#687176';cap.groupIds=[group];cap.customData={boardRole:'state-name',logicalId:s.item.id};stateElements.push(cap);}
        continue;
      }
      const capsule=base('st_'+s.item.id,'rectangle',pos.x,pos.y,s.width,s.height);
      capsule.backgroundColor='#ffffff';capsule.strokeColor='#3a4147';capsule.roundness={type:3,value:Math.floor(s.height/2)};capsule.groupIds=[group];capsule.customData={boardRole:'state',logicalId:s.item.id};
      const name=label('t_'+s.item.id,s.item.name!,grid(pos.x+(s.width-s.text!.width)/2),grid(pos.y+(s.height-s.text!.height)/2),s.text!.width,capsule.id,16);
      name.groupIds=[group];name.customData={boardRole:'state-name',logicalId:s.item.id};
      capsule.boundElements=[{id:name.id,type:'text'}];
      stateElements.push(capsule,name);statePlaced.set(s.item.id,capsule);
    }
    const {routes,check}=chosen.routing,transitionElements:BoardElement[]=[],stateLabels:BoardElement[]=[];
    for(const route of routes){
      const from=statePlaced.get(route.from)!,to=statePlaced.get(route.to)!,a=route.points[0]!,points=route.points.map(p=>[p[0]-a[0],p[1]-a[1]]),width=Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),height=Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]));
      const arrow:BoardElement={...base('tr_'+route.id,'arrow',a[0],a[1],width,height),strokeColor:'#687176',points,lastCommittedPoint:null,startBinding:{elementId:from.id,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:to.id,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead:null,endArrowhead:'arrow',elbowed:true,fixedSegments:points.slice(2,-1).map((end,i)=>({index:i+2,start:points[i+1]!,end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'transition',logicalId:route.id,from:route.from,to:route.to}};
      from.boundElements!.push({id:arrow.id,type:'arrow'});to.boundElements!.push({id:arrow.id,type:'arrow'});transitionElements.push(arrow);
      if(route.label){const box=route.label,mask=base('m_'+route.id,'rectangle',box.x,box.y,box.width,box.height),text=label('l_'+route.id,box.text,box.x+8,box.y+6,box.width-16,mask.id,14);mask.backgroundColor='#ffffff';mask.strokeColor='#ffffff';mask.strokeWidth=1;mask.customData={boardRole:'edge-label-mask',edgeId:route.id,gap:box.gap};mask.boundElements=[{id:text.id,type:'text'}];text.customData={boardRole:'edge-label',edgeId:route.id};const maskGroup=prefix+'label-group_'+route.id;mask.groupIds=[maskGroup];text.groupIds=[maskGroup];stateLabels.push(mask,text);}
    }
    const canvas={...base('canvas','rectangle',0,0,chosen.frame.width,chosen.frame.height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width:chosen.frame.width,height:chosen.frame.height}};
    const all:BoardElement[]=[canvas,chosen.kindTag,chosen.title,titleBand(chosen.title),...transitionElements,...stateLabels,...stateElements];
    const finalFrame=diagram.size!=='auto'?chosen.frame:settleFrame(all,chosen.frame,24);
    all.push(summaryNote(finalFrame));
    if(new Set(all.map(e=>e.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:states.length,edges:transitions.length,lanes:0,text:diagram.summary,checks:{...check,frameContained:true,canvas:{size:diagram.size,...chosen.frame,contentBounds:{x:32,y:gridUp(chosen.title.y+chosen.title.height+24),width:chosen.frame.width-64,height:chosen.frame.height-gridUp(chosen.title.y+chosen.title.height+24)-32}},accents:0,budget:{states:8,transitions:16},cornerRadius:'native-elbow-max-16'}},routes};
  }
  // Trees: bus-style hierarchy — a parent's right edge fans through one shared vertical
  // trunk into its stacked children; the classic decomposition / org-chart drawing.
  if(diagram.kind==='tree'){
    const childrenOf=new Map<string,string[]>();
    for(const edge of diagram.edges)childrenOf.set(edge.from,[...(childrenOf.get(edge.from)??[]),edge.to]);
    const rootId=diagram.nodes.find(node=>!diagram.edges.some(edge=>edge.to===node.id))!.id;
    const sizes=measureNodes(),sizeOf=new Map(sizes.map(s=>[s.node.id,s]));
    const crossOf=new Map<string,number>();
    const measure=(id:string):number=>{const kids=childrenOf.get(id)??[];const self=sizeOf.get(id)!.height;if(!kids.length)return self;return Math.max(self,kids.reduce((sum,kid)=>sum+measure(kid),0)+(kids.length-1)*40);};
    for(const node of diagram.nodes)crossOf.set(node.id,measure(node.id));
    const frames=diagram.size==='auto'?[BOARD_CANVASES.wide,BOARD_CANVASES.standard,BOARD_CANVASES.portrait]:[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide];
    let chosen:{frame:{width:number;height:number};title:BoardElement;kindTag:BoardElement;boxes:Box[]}|undefined;const failures:string[]=[];
    for(const frame of frames){
      const titleSize=diagram.size==='slide-16x9'?40:28,{title,kindTag,top}=titleBlock(frame.width,titleSize);
      if(title.text.split('\n').length>2){failures.push('BOARD_TITLE_TOO_LONG');continue;}
      const bounds={x:32,y:top,width:frame.width-64,height:frame.height-top-32-footerReserve};
      const boxes:Box[]=[];let overflow=false;
      const place=(id:string,axisX:number,topY:number)=>{
        const size=sizeOf.get(id)!,cross=crossOf.get(id)!,y=grid(topY+(cross-size.height)/2);
        if(y<bounds.y||y+size.height>bounds.y+bounds.height||axisX+size.width>bounds.x+bounds.width)overflow=true;
        boxes.push({id,kind:size.node.kind,x:axisX,y,width:size.width,height:size.height});
        let cursor=topY;
        // 120px rank gap leaves a real bus corridor: parent → vertical trunk → stacked children.
        for(const kid of childrenOf.get(id)??[]){place(kid,grid(axisX+size.width+120),cursor);cursor+=crossOf.get(kid)!+40;}
      };
      place(rootId,bounds.x,grid(bounds.y+Math.max(0,(bounds.height-crossOf.get(rootId)!))/2));
      if(!overflow&&!boxes.some((box,index)=>boxes.some((other,j)=>j<index&&boxesOverlap(box,other)))){chosen={frame,title,kindTag,boxes};break;}
      failures.push('BOARD_TREE_FIT');
    }
    if(!chosen){if(failures.length&&failures.every(f=>f==='BOARD_TITLE_TOO_LONG'))throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');throw Error('BOARD_LAYOUT_TOO_DENSE: 层级图在固定画幅下放不下，请减少层级、缩短文字或拆图',{cause:{failures:failures.slice(0,4)}});}
    const rendered=renderFlowNodes(sizes,chosen.boxes);
    const treeArrows:BoardElement[]=[];
    for(const edge of diagram.edges){
      const from=rendered.placed.get(edge.from)!,to=rendered.placed.get(edge.to)!;
      const px=from.x+from.width,py=from.y+from.height/2,cx=to.x,cy=to.y+to.height/2,midX=grid((px+cx)/2);
      const absolute:[number,number][]=py===cy?[[px,py],[cx,cy]]:[[px,py],[midX,py],[midX,cy],[cx,cy]];
      const points=absolute.map(([x,y])=>[x-px,y-py]);
      const left=Math.min(...absolute.map(([x])=>x)),topY=Math.min(...absolute.map(([,y])=>y));
      const arrow:BoardElement={...base('e_'+edge.id,'arrow',left,topY,Math.max(...absolute.map(([x])=>x))-left,Math.max(...absolute.map(([,y])=>y))-topY),strokeColor:edge.variant==='emphasis'?BOARD_ACCENT:'#687176',strokeWidth:edge.variant==='emphasis'?3:2,strokeStyle:edge.variant==='dashed'?'dashed':'solid',points,lastCommittedPoint:null,startBinding:{elementId:from.id,focus:0,gap:8,fixedPoint:[1,.5]},endBinding:{elementId:to.id,focus:0,gap:8,fixedPoint:[0,.5]},startArrowhead:edge.variant==='emphasis'?'dot':null,endArrowhead:'arrow',elbowed:points.length>2,fixedSegments:points.slice(2,-1).map((end,i)=>({index:i+2,start:points[i+1]!,end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'edge',logicalId:edge.id,from:edge.from,to:edge.to,variant:edge.variant}};
      from.boundElements!.push({id:arrow.id,type:'arrow'});to.boundElements!.push({id:arrow.id,type:'arrow'});treeArrows.push(arrow);
    }
    const canvas={...base('canvas','rectangle',0,0,chosen.frame.width,chosen.frame.height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width:chosen.frame.width,height:chosen.frame.height}};
    const all:BoardElement[]=[canvas,chosen.kindTag,chosen.title,titleBand(chosen.title),...treeArrows,...rendered.elements];
    const finalFrame=diagram.size!=='auto'?chosen.frame:settleFrame(all,chosen.frame,footerReserve);
    if(legendEntries.length>=2)all.push(...legendPanel(legendEntries,finalFrame));
    all.push(summaryNote(finalFrame));
    if(new Set(all.map(e=>e.id)).size!==all.length)throw Error('BOARD_RESERVED_ID_COLLISION');
    const frameCheck=checkBoardCanvas(all);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
    return{diagram,elements:all,summary:{nodes:diagram.nodes.length,edges:diagram.edges.length,lanes:0,text:diagram.summary,checks:{ok:true,tree:true,frameContained:true,canvas:{size:diagram.size,...chosen.frame,contentBounds:{x:32,y:gridUp(chosen.title.y+chosen.title.height+20),width:chosen.frame.width-64,height:chosen.frame.height-gridUp(chosen.title.y+chosen.title.height+20)-32-footerReserve}},accents:diagram.nodes.filter(node=>nodeTypeOf(node)==='focal').length,budget:{nodes:12,arrows:16,focal:2,lanes:4,groups:4,states:8,transitions:16},cornerRadius:'native-elbow-max-16'}},routes:[]};
  }
  const levels=rankByTopology(diagram.nodes.map(n=>n.id),diagram.edges),flowDirection=diagram.direction??'right';
  const sizes=measureNodes();
  const frames=diagram.kind==='swimlane'
    ?(diagram.size==='auto'?[BOARD_CANVASES.wide,BOARD_CANVASES.standard,BOARD_CANVASES.portrait]:[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide])
    :(diagram.size==='auto'?[BOARD_CANVASES.wide,BOARD_CANVASES.standard,BOARD_CANVASES.portrait]:[diagram.size==='doc-inline'?BOARD_CANVASES.inline:BOARD_CANVASES.wide]);
  const groupRank=new Map<string,number>();diagram.groups?.forEach((group,index)=>group.nodes.forEach(id=>groupRank.set(id,index)));
  let chosen:{frame:{width:number;height:number};bounds:Rect;title:BoardElement;kindTag:BoardElement;boxes:Box[];routing:ReturnType<typeof routeBoard>;swimlane?:SwimlanePlan}|undefined;const failures:string[]=[];
  for(const frame of frames){const titleSize=diagram.size==='slide-16x9'?40:28,{title,kindTag,top}=titleBlock(frame.width,titleSize);if(title.text.split('\n').length>2){failures.push('BOARD_TITLE_TOO_LONG');continue;}const contentTop=gridUp(top+(diagram.groups?.length?44:0)),bounds={x:32,y:contentTop,width:frame.width-64,height:frame.height-contentTop-32-footerReserve};
    const swimlane=diagram.kind==='swimlane'?swimlanePlan(diagram,sizes,bounds,levels):undefined;
    if(diagram.kind==='swimlane'&&!swimlane){failures.push('BOARD_SWIMLANE_FIT: 泳道宽度或总高度无法容纳所有节点，请减少泳道、缩短文字或拆分详图');continue;}
    const candidates=swimlane?[swimlane.boxes]:compactCandidates(sizes,diagram.edges,flowDirection,bounds,levels,groupRank);
    // Lane headers occupy the top strip; arrows must stay inside the content area below them.
    const routingBounds=swimlane?{x:bounds.x,y:bounds.y+56,width:bounds.width,height:bounds.height-56}:bounds;
    for(const boxes of candidates){try{const routing=routeBoard(boxes,diagram.edges,flowDirection,{bounds:routingBounds,nodeGap:40,escape:24,nodeClearance:12});chosen={frame,bounds,title,kindTag,boxes,routing,...(swimlane?{swimlane}:{})};break;}catch(error){failures.push((error as Error).message);}}
    if(chosen)break;
  }
  if(!chosen){if(failures.length&&failures.every(f=>f==='BOARD_TITLE_TOO_LONG'))throw Error('BOARD_TITLE_TOO_LONG: 标题最多占两行，请缩短标题');if(diagram.nodes.some(n=>n.x!==undefined)&&!failures.length)throw Error('BOARD_CANVAS_OVERFLOW: 显式坐标或节点尺寸超出所选画幅内容区');if(diagram.nodes.every(n=>n.x!==undefined)&&failures.some(f=>f.startsWith('BOARD_NODE_OVERLAP')))throw Error(failures.find(f=>f.startsWith('BOARD_NODE_OVERLAP')));throw Error('BOARD_LAYOUT_TOO_DENSE: 在固定画幅与可读字号下无法可靠布线，请拆成概览与详情图或调整坐标',{cause:{failures:failures.slice(0,6)}});}
  const renderedNodes=renderFlowNodes(sizes,chosen.boxes);elements.push(...renderedNodes.elements);const placed=renderedNodes.placed;
  const edgeVariantById=new Map(diagram.edges.map(edge=>[edge.id,edge.variant]));
  const {routes,check}=chosen.routing,arrows:BoardElement[]=[],labels:BoardElement[]=[];
  for(const route of routes){const from=placed.get(route.from)!,to=placed.get(route.to)!,a=route.points[0]!,points=route.points.map(p=>[p[0]-a[0],p[1]-a[1]]),width=Math.max(...route.points.map(p=>p[0]))-Math.min(...route.points.map(p=>p[0])),height=Math.max(...route.points.map(p=>p[1]))-Math.min(...route.points.map(p=>p[1]));
    const variant=edgeVariantById.get(route.id)??'solid';
    const arrow:BoardElement={...base('e_'+route.id,'arrow',a[0],a[1],width,height),strokeColor:variant==='emphasis'?BOARD_ACCENT:'#687176',strokeWidth:variant==='emphasis'?3:2,strokeStyle:variant==='dashed'?'dashed':'solid',points,lastCommittedPoint:null,startBinding:{elementId:from.id,focus:0,gap:8,fixedPoint:route.start.fixedPoint},endBinding:{elementId:to.id,focus:0,gap:8,fixedPoint:route.end.fixedPoint},startArrowhead:variant==='emphasis'?'dot':null,endArrowhead:'arrow',elbowed:true,fixedSegments:points.slice(2,-1).map((end,i)=>({index:i+2,start:points[i+1]!,end})),startIsSpecial:false,endIsSpecial:false,customData:{boardRole:'edge',logicalId:route.id,from:route.from,to:route.to,variant}};from.boundElements.push({id:arrow.id,type:'arrow'});to.boundElements.push({id:arrow.id,type:'arrow'});arrows.push(arrow);
    if(route.label){const box=route.label,mask=base('m_'+route.id,'rectangle',box.x,box.y,box.width,box.height),text=label('l_'+route.id,box.text,box.x+8,box.y+6,box.width-16,mask.id,14);mask.backgroundColor='#ffffff';mask.strokeColor='#ffffff';mask.strokeWidth=1;mask.customData={boardRole:'edge-label-mask',edgeId:route.id,gap:box.gap};mask.boundElements=[{id:text.id,type:'text'}];text.customData={boardRole:'edge-label',edgeId:route.id};const group=prefix+'label-group_'+route.id;mask.groupIds=[group];text.groupIds=[group];labels.push(mask,text);}
  }
  elements.unshift(...arrows,...labels);
  // Group boundaries wrap their members with a quiet dashed frame; the group name sits
  // in a pill chip straddling the top edge (archify's region-label language).
  const groupFrames:BoardElement[]=[];
  for(const group of diagram.groups??[]){
    const members=chosen.boxes.filter(box=>group.nodes.includes(box.id));
    if(members.length<2)continue;
    const left=grid(Math.min(...members.map(b=>b.x))-28),topY=grid(Math.min(...members.map(b=>b.y))-44),right=Math.max(...members.map(b=>b.x+b.width))+28,bottom=Math.max(...members.map(b=>b.y+b.height))+28;
    const frameEl=base('grp_'+group.id,'rectangle',left,topY,gridUp(right-left),gridUp(bottom-topY));
    frameEl.backgroundColor='#f5f7f6';frameEl.strokeColor='#9db3a7';frameEl.strokeStyle='dashed';frameEl.strokeWidth=1;frameEl.roundness={type:3,value:8};frameEl.customData={boardRole:'group-frame',groupId:group.id};
    const chipH=24,chipW=gridUp(textBudget(group.label,12)+24);
    const chip=base('grpchip_'+group.id,'rectangle',left+12,grid(topY-chipH/2),chipW,chipH);
    chip.backgroundColor='#ffffff';chip.strokeColor='#9db3a7';chip.strokeWidth=1;chip.roundness={type:3,value:12};chip.customData={boardRole:'group-chip',groupId:group.id};
    const chipText=label('grpchipt_'+group.id,group.label,left+12+10,grid(topY-chipH/2)+4,chipW-20,chip.id,12);
    chipText.strokeColor='#3f5b4d';chip.boundElements=[{id:chipText.id,type:'text'}];chipText.customData={boardRole:'group-chip-text',groupId:group.id};
    groupFrames.push(frameEl,chip,chipText);
  }
  if(groupFrames.length)elements.unshift(...groupFrames);
  const laneFrames:BoardElement[]=[];
  if(chosen.swimlane){const{laneWidth,margin,lanes}=chosen.swimlane;
    lanes.forEach((lane,index)=>{
      const laneX=grid(chosen.bounds.x+margin+index*laneWidth);
      const header=base('lane_'+lane.id,'rectangle',laneX,chosen.bounds.y,laneWidth,40);
      header.backgroundColor=BOARD_ACCENT_TINT;header.strokeColor=BOARD_ACCENT;header.customData={boardRole:'lane',laneId:lane.id,part:'header'};
      const name=label('lt_'+lane.id,lane.name,laneX+16,chosen.bounds.y+6,laneWidth-32,header.id,18);
      header.boundElements=[{id:name.id,type:'text'}];name.customData={boardRole:'lane-title',laneId:lane.id};
      const body=base('lanebody_'+lane.id,'rectangle',laneX,chosen.bounds.y+40,laneWidth,chosen.bounds.height-40);
      body.backgroundColor=index%2?'#f6f8f7':'transparent';body.strokeColor='#687176';body.customData={boardRole:'lane',laneId:lane.id,part:'body'};
      laneFrames.push(header,name,body);
    });
  }
  if(laneFrames.length)elements.unshift(...laneFrames);
  const canvas={...base('canvas','rectangle',0,0,chosen.frame.width,chosen.frame.height),strokeColor:'transparent',backgroundColor:'#ffffff',strokeWidth:0,locked:true,customData:{boardRole:'canvas',size:diagram.size,width:chosen.frame.width,height:chosen.frame.height}};
  elements.unshift(canvas,chosen.kindTag,chosen.title,titleBand(chosen.title));
  const finalFrame=chosen.swimlane||diagram.size!=='auto'?chosen.frame:settleFrame(elements,chosen.frame,footerReserve);
  elements.push(summaryNote(finalFrame));
  if(legendEntries.length>=2)elements.push(...legendPanel(legendEntries,finalFrame));
  // All generated roles have distinct ID prefixes, independent of caller-selected identifiers.
  if(new Set(elements.map(e=>e.id)).size!==elements.length)throw Error('BOARD_RESERVED_ID_COLLISION');
  const frameCheck=checkBoardCanvas(elements);if(!frameCheck.ok)throw Error(frameCheck.errors.join(';'));
  return{diagram,elements,summary:{nodes:diagram.nodes.length,edges:diagram.edges.length,lanes:chosen.swimlane?chosen.swimlane.lanes.length:0,text:diagram.summary,checks:{...check,frameContained:true,canvas:{size:diagram.size,...chosen.frame,contentBounds:chosen.bounds},accents:diagram.nodes.filter(node=>nodeTypeOf(node)==='focal').length,groups:diagram.groups?.length??0,budget:{nodes:12,arrows:16,focal:2,lanes:4,groups:4,states:8,transitions:16},cornerRadius:'native-elbow-max-16'}},routes};
}
