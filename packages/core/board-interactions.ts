import type {BoardElement} from './board-changes.ts';

/** Element types Excalidraw can bind arrows to. Lines never bind. */
const BINDABLE=new Set(['rectangle','diamond','ellipse','text','image','frame']);
export type InteractionPoint={x:number;y:number};

/** Topmost connector target under a pointer. Grouped artwork resolves to its bind
 * shell (or any bindable member) so one click anywhere on an asset connects it. */
export function connectorTargetAt(elements:readonly BoardElement[],point:InteractionPoint):{element:BoardElement;groupId?:string}|null{
  const live=elements.filter(element=>!element.isDeleted);
  const byId=new Map(live.map(element=>[element.id,element]));
  const inside=(element:BoardElement)=>point.x>=element.x&&point.x<=element.x+element.width&&point.y>=element.y&&point.y<=element.y+element.height;
  const hits=live.filter(inside);
  for(let index=hits.length-1;index>=0;index--){
    const hit=hits[index]!,group=hit.groupIds?.[0];
    // 绑定文字不能作为箭头端点（Excalidraw 也不允许）；解析到它的容器。
    const resolved=hit.type==='text'&&hit.containerId?byId.get(hit.containerId)??hit:hit;
    if(BINDABLE.has(resolved.type)&&!(resolved.type==='text'&&resolved.containerId))return{element:resolved,...(group?{groupId:group}:{})};
    if(!group)continue;
    const members=live.filter(element=>element.groupIds?.includes(group));
    const shell=members.find(element=>element.customData?.role==='bind-shell');
    // 只有点到不可绑定的组员（线条、连接线）时才用组内代表；点到具体形状应连到该形状。
    if(shell)return{element:shell,groupId:group};
    const bindable=members.filter(element=>BINDABLE.has(element.type)&&!(element.type==='text'&&element.containerId));
    if(bindable.length)return{element:bindable[bindable.length-1]!,groupId:group};
  }
  return null;
}

export type QuickConnectGeometry={x:number;y:number;width:number;height:number;points:[number,number][];startFixedPoint:[number,number];endFixedPoint:[number,number]};

/** Straight-to-elbow geometry between two boxes: nearest side pair, 8px gap, one bend. */
export function quickConnectGeometry(from:BoardElement,to:BoardElement):QuickConnectGeometry{
  const fromCenter={x:from.x+from.width/2,y:from.y+from.height/2},toCenter={x:to.x+to.width/2,y:to.y+to.height/2};
  const dx=toCenter.x-fromCenter.x,dy=toCenter.y-fromCenter.y,gap=8;
  let sx:number,sy:number,ex:number,ey:number,startFixedPoint:[number,number],endFixedPoint:[number,number];
  if(Math.abs(dx)>=Math.abs(dy)){
    const right=dx>=0;
    sx=right?from.x+from.width+gap:from.x-gap;ex=right?to.x-gap:to.x+to.width+gap;
    sy=fromCenter.y;ey=toCenter.y;
    startFixedPoint=[right?1:0,.5];endFixedPoint=[right?0:1,.5];
  }else{
    const down=dy>=0;
    sy=down?from.y+from.height+gap:from.y-gap;ey=down?to.y-gap:to.y+to.height+gap;
    sx=fromCenter.x;ex=toCenter.x;
    startFixedPoint=[.5,down?1:0];endFixedPoint=[.5,down?0:1];
  }
  const horizontal=Math.abs(dx)>=Math.abs(dy);
  const points:[number,number][]=horizontal&&sy!==ey?[[sx,sy],[(sx+ex)/2,sy],[(sx+ex)/2,ey],[ex,ey]]:!horizontal&&sx!==ex?[[sx,sy],[sx,(sy+ey)/2],[ex,(sy+ey)/2],[ex,ey]]:[[sx,sy],[ex,ey]];
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  const left=Math.min(...xs),top=Math.min(...ys);
  return{x:left,y:top,width:Math.max(...xs)-left,height:Math.max(...ys)-top,points:points.map(([x,y])=>[x-left,y-top]),startFixedPoint,endFixedPoint};
}

type SelectionBox={x:number;y:number;width:number;height:number};
const selectionBox=(elements:readonly BoardElement[]):SelectionBox|undefined=>{
  if(!elements.length)return undefined;
  const left=Math.min(...elements.map(element=>element.x)),top=Math.min(...elements.map(element=>element.y));
  const right=Math.max(...elements.map(element=>element.x+element.width)),bottom=Math.max(...elements.map(element=>element.y+element.height));
  return{x:left,y:top,width:right-left,height:bottom-top};
};
const expandGroups=(elements:readonly BoardElement[],ids:readonly string[]):Set<string>=>{
  const selected=new Set(ids),groups=new Set(elements.filter(element=>selected.has(element.id)).flatMap(element=>element.groupIds??[]));
  for(const element of elements)if(element.groupIds?.some((group:string)=>groups.has(group)))selected.add(element.id);
  return selected;
};
const pointOnBox=(element:BoardElement,fixedPoint:readonly [number,number],gap:number)=>{
  const x=element.x+element.width*fixedPoint[0],y=element.y+element.height*fixedPoint[1];
  const directionX=fixedPoint[0]<=0?-1:fixedPoint[0]>=1?1:0,directionY=fixedPoint[1]<=0?-1:fixedPoint[1]>=1?1:0;
  return{x:x+directionX*gap,y:y+directionY*gap};
};
/** Rebuild bound arrows after their nodes move so connections stay attached. */
function reflowArrow(arrow:BoardElement,elements:readonly BoardElement[]):BoardElement{
  const byId=new Map(elements.map(element=>[element.id,element]));
  const startElement=arrow.startBinding?byId.get(arrow.startBinding.elementId):undefined;
  const endElement=arrow.endBinding?byId.get(arrow.endBinding.elementId):undefined;
  // 目标被删除后 Excalidraw 对非折线箭头会保留悬空绑定；此时保持原样，不能解引用 undefined。
  if(arrow.startBinding&&!startElement)return arrow;
  if(arrow.endBinding&&!endElement)return arrow;
  if(!startElement&&!endElement)return arrow;
  const start=arrow.startBinding?pointOnBox(startElement!,arrow.startBinding.fixedPoint??[.5,.5],arrow.startBinding.gap??8):undefined;
  const end=arrow.endBinding?pointOnBox(endElement!,arrow.endBinding.fixedPoint??[.5,.5],arrow.endBinding.gap??8):undefined;
  const sx=start?.x??arrow.x,sy=start?.y??arrow.y;
  const ex=end?.x??arrow.x+arrow.points.at(-1)![0],ey=end?.y??arrow.y+arrow.points.at(-1)![1];
  const horizontal=Math.abs(ex-sx)>=Math.abs(ey-sy);
  const points:[number,number][]=horizontal&&sy!==ey?[[sx,sy],[(sx+ex)/2,sy],[(sx+ex)/2,ey],[ex,ey]]:!horizontal&&sx!==ex?[[sx,sy],[sx,(sy+ey)/2],[ex,(sy+ey)/2],[ex,ey]]:[[sx,sy],[ex,ey]];
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]),left=Math.min(...xs),top=Math.min(...ys);
  const local=points.map(([x,y])=>[x-left,y-top] as [number,number]);
  return{...arrow,x:left,y:top,width:Math.max(...xs)-left,height:Math.max(...ys)-top,points:local,fixedSegments:local.slice(2,-1).map((endPoint,index)=>({index:index+2,start:local[index+1],end:endPoint}))};
}

type Unit={members:BoardElement[];box:SelectionBox};
/** Groups move as one unit: aligning must not collapse relative layout inside a group. */
function selectionUnits(elements:readonly BoardElement[],ids:readonly string[]):Unit[]{
  const selected=expandGroups(elements,ids),members=elements.filter(element=>selected.has(element.id)&&!(element.type==='text'&&element.containerId)),units=new Map<string,BoardElement[]>(),loose:BoardElement[]=[];
  for(const element of members){const group=element.groupIds?.[0];if(group){units.set(group,[...(units.get(group)??[]),element]);}else loose.push(element);}
  const result:Unit[]=[];
  for(const groupMembers of units.values())result.push({members:groupMembers,box:selectionBox(groupMembers)!});
  for(const element of loose)result.push({members:[element],box:selectionBox([element])!});
  // 容器内的文字不单独参与对齐；容器移动时文字跟同一位移，避免框动字不动。
  const unitOf=new Map<string,Unit>();for(const unit of result)for(const member of unit.members)unitOf.set(member.id,unit);
  for(const text of elements){if(text.type!=='text'||!text.containerId||!selected.has(text.containerId))continue;const unit=unitOf.get(text.containerId);if(unit)unit.members.push(text);}
  return result;
}
function moveUnits(units:Unit[],targets:Map<Unit,number>,axis:'x'|'y'):Map<string,{x:number;y:number}>{
  const moves=new Map<string,{x:number;y:number}>();
  for(const unit of units){const target=targets.get(unit);if(target===undefined)continue;const delta=target-(axis==='x'?unit.box.x:unit.box.y);
    for(const element of unit.members)moves.set(element.id,axis==='x'?{x:element.x+delta,y:element.y}:{x:element.x,y:element.y+delta});}
  return moves;
}

export type AlignEdge='left'|'centerX'|'right'|'top'|'centerY'|'bottom';
/** Align the selection (expanded to whole groups) and keep bound arrows attached. */
export function alignSelection(elements:readonly BoardElement[],ids:readonly string[],edge:AlignEdge):BoardElement[]{
  const units=selectionUnits(elements,ids),box=selectionBox(units.flatMap(unit=>unit.members));
  if(!box||units.length<2)return elements.slice();
  const targets=new Map<Unit,number>();
  for(const unit of units){
    if(edge==='left')targets.set(unit,box.x);
    else if(edge==='right')targets.set(unit,box.x+box.width-unit.box.width);
    else if(edge==='centerX')targets.set(unit,box.x+(box.width-unit.box.width)/2);
    else if(edge==='top')targets.set(unit,box.y);
    else if(edge==='bottom')targets.set(unit,box.y+box.height-unit.box.height);
    else targets.set(unit,box.y+(box.height-unit.box.height)/2);
  }
  return applyMoves(elements,moveUnits(units,targets,edge==='left'||edge==='centerX'||edge==='right'?'x':'y'));
}

/** Even spacing between the two outermost units; bound arrows stay attached. */
export function distributeSelection(elements:readonly BoardElement[],ids:readonly string[],axis:'x'|'y'):BoardElement[]{
  const units=selectionUnits(elements,ids);
  if(units.length<3)return elements.slice();
  const size=(unit:Unit)=>axis==='x'?unit.box.width:unit.box.height;
  const sorted=[...units].sort((a,b)=>(axis==='x'?a.box.x-b.box.x:a.box.y-b.box.y));
  const start=axis==='x'?sorted[0]!.box.x:sorted[0]!.box.y;
  const end=axis==='x'?sorted.at(-1)!.box.x+sorted.at(-1)!.box.width:sorted.at(-1)!.box.y+sorted.at(-1)!.box.height;
  const total=sorted.reduce((sum,unit)=>sum+size(unit),0),gap=(end-start-total)/(sorted.length-1);
  if(gap<0)return elements.slice();
  const targets=new Map<Unit,number>();let cursor=start;
  for(const unit of sorted){targets.set(unit,cursor);cursor+=size(unit)+gap;}
  return applyMoves(elements,moveUnits(units,targets,axis));
}

function applyMoves(elements:readonly BoardElement[],moved:Map<string,{x:number;y:number}>):BoardElement[]{
  const originals=new Map(elements.map(element=>[element.id,element]));
  const updated=elements.map(element=>{const move=moved.get(element.id);return move?{...element,x:move.x,y:move.y,version:(element.version??1)+1,versionNonce:Math.floor(Math.random()*2147483646)+1}:element;});
  const result=updated.map(element=>element.type==='arrow'&&(element.startBinding||element.endBinding)?reflowArrow(element,updated):element);
  // 关系标签是独立分组元素，箭头重排后按箭头位移同步平移；否则线动标签留在旧位置。
  for(let index=0;index<result.length;index++){
    const arrow=result[index]!;if(arrow.type!=='arrow')continue;
    const before=originals.get(arrow.id);if(!before)continue;
    const dx=arrow.x-before.x,dy=arrow.y-before.y;if(!dx&&!dy)continue;
    for(let labelIndex=0;labelIndex<result.length;labelIndex++){
      const label=result[labelIndex]!;if(label.customData?.edgeId!==arrow.id||moved.has(label.id))continue;
      result[labelIndex]={...label,x:label.x+dx,y:label.y+dy,version:(label.version??1)+1,versionNonce:Math.floor(Math.random()*2147483646)+1};
    }
  }
  return result;
}

/** Sticky note palette shared by the insert action and the context toolbar. */
export const STICKY_COLORS=[{name:'琥珀',value:'#f6ecc9'},{name:'青灰',value:'#e3edf0'},{name:'灰绿',value:'#e9f0e4'},{name:'浅紫',value:'#ece7f2'}] as const;
export type ArrowStyle='solid'|'dashed'|'plain';
const bump=(element:BoardElement):BoardElement=>({...element,version:(element.version??1)+1,versionNonce:Math.floor(Math.random()*2147483646)+1,updated:Date.now()});

/** Recolor only the selected sticky notes; every other element is untouched. */
export function applyStickyColor(elements:readonly BoardElement[],ids:readonly string[],color:string):BoardElement[]{
  const selected=new Set(ids);
  return elements.map(element=>selected.has(element.id)&&element.customData?.boardRole==='sticky'?bump({...element,backgroundColor:color}):element);
}

/** Line style for selected connectors: solid, dashed, or a plain line without heads. */
export function applyArrowStyle(elements:readonly BoardElement[],ids:readonly string[],style:ArrowStyle):BoardElement[]{
  const selected=new Set(ids);
  return elements.map(element=>{
    if(!selected.has(element.id)||element.type!=='arrow')return element;
    // 实线/虚线只改线型，保留继承空心三角、组合菱形、crowfoot 基数等语义箭头。
    if(style==='plain')return bump({...element,startArrowhead:null,endArrowhead:null});
    return bump({...element,strokeStyle:style==='dashed'?'dashed':'solid'});
  });
}
