export type Point=[number,number];
export type Box={id:string;kind:string;x:number;y:number;width:number;height:number};
export type FlowEdge={id:string;from:string;to:string;label?:string};
export type Rect={x:number;y:number;width:number;height:number};
export type RoutingOptions={bounds?:Rect;nodeGap?:number;escape?:number;nodeClearance?:number};
type Side='top'|'right'|'bottom'|'left';
export type Port={side:Side;point:Point;escape:Point;fixedPoint:Point};
export type Route={id:string;from:string;to:string;points:Point[];start:Port;end:Port;label?:Rect&{text:string;segment:number;gap:number}};
const EPS=1e-6,GRID=4;
export const grid=(n:number)=>Math.round(n/GRID)*GRID;
export const gridUp=(n:number)=>Math.ceil(n/GRID)*GRID;
const inflate=(r:Rect,n:number):Rect=>({x:r.x-n,y:r.y-n,width:r.width+2*n,height:r.height+2*n});
const inside=(p:Point,r:Rect)=>p[0]>r.x+EPS&&p[0]<r.x+r.width-EPS&&p[1]>r.y+EPS&&p[1]<r.y+r.height-EPS;
export const boxesOverlap=(a:Rect,b:Rect)=>a.x<b.x+b.width-EPS&&a.x+a.width>b.x+EPS&&a.y<b.y+b.height-EPS&&a.y+a.height>b.y+EPS;
export const segmentHitsBox=(a:Point,b:Point,r:Rect)=>{
  if(Math.abs(a[0]-b[0])<EPS)return a[0]>r.x+EPS&&a[0]<r.x+r.width-EPS&&Math.max(a[1],b[1])>r.y+EPS&&Math.min(a[1],b[1])<r.y+r.height-EPS;
  if(Math.abs(a[1]-b[1])<EPS)return a[1]>r.y+EPS&&a[1]<r.y+r.height-EPS&&Math.max(a[0],b[0])>r.x+EPS&&Math.min(a[0],b[0])<r.x+r.width-EPS;
  return true;
};
/** True only when the segment actually crosses the rectangle (Liang–Barsky).
 * segmentHitsBox is the router's conservative shortcut and cannot be used for
 * validating user-visible diagonal connectors. */
export const segmentIntersectsBox=(a:Point,b:Point,r:Rect)=>{
  let t0=0,t1=1;const dx=b[0]-a[0],dy=b[1]-a[1];
  const clip=(p:number,q:number)=>{
    if(Math.abs(p)<EPS)return q>=0;
    const t=q/p;
    if(p<0){if(t>t1)return false;if(t>t0)t0=t;}
    else{if(t<t0)return false;if(t<t1)t1=t;}
    return true;
  };
  return clip(-dx,a[0]-r.x)&&clip(dx,r.x+r.width-a[0])&&clip(-dy,a[1]-r.y)&&clip(dy,r.y+r.height-a[1]);
};
const lineBox=(a:Point,b:Point,pad=12)=>inflate({x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(a[0]-b[0]),height:Math.abs(a[1]-b[1])},pad);
const segments=(points:Point[])=>points.slice(1).map((p,i)=>[points[i]!,p] as [Point,Point]);
const distance=(a:Point,b:Point)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
const simplify=(points:Point[])=>{const result:Point[]=[];for(const p of points){if(result.length&&distance(result.at(-1)!,p)<EPS)continue;while(result.length>1){const a=result.at(-2)!,b=result.at(-1)!;if((a[0]===b[0]&&b[0]===p[0])||(a[1]===b[1]&&b[1]===p[1]))result.pop();else break;}result.push(p);}return result;};

// Unicode-wide glyphs consume 1em; remaining glyphs use the skill's 0.60em sans budget.
export function textBudget(text:string,size:number){return Array.from(text).reduce((sum,c)=>sum+(/\p{Mark}/u.test(c)?0:/[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1faff}]/u.test(c)?size:size*.60),0);}

function port(box:Box,side:Side,index:number,total:number,escapeDistance=48):Port{
  const vertical=side==='top'||side==='bottom',length=vertical?box.width:box.height;
  const offset=grid(length*(index+1)/(total+1)),fraction=offset/length;
  if(offset<8||length-offset<8||(total>1&&length/(total+1)<12))throw Error('BOARD_PORT_BUDGET');
  let x=box.x+(vertical?offset:side==='left'?0:box.width),y=box.y+(!vertical?offset:side==='top'?0:box.height);
  if(box.kind==='diamond'){
    if(vertical)y=box.y+box.height/2+(side==='top'?-1:1)*box.height/2*(1-Math.abs(2*fraction-1));
    else x=box.x+box.width/2+(side==='left'?-1:1)*box.width/2*(1-Math.abs(2*fraction-1));
  }else if(box.kind==='ellipse'){
    if(vertical)y=box.y+box.height/2+(side==='top'?-1:1)*box.height/2*Math.sqrt(1-(2*fraction-1)**2);
    else x=box.x+box.width/2+(side==='left'?-1:1)*box.width/2*Math.sqrt(1-(2*fraction-1)**2);
  }
  const normal:Point=side==='top'?[0,-1]:side==='bottom'?[0,1]:side==='left'?[-1,0]:[1,0];
  const point:Point=[x+normal[0]*8,y+normal[1]*8];
  const escape:Point=vertical?[x,side==='top'?box.y-escapeDistance:box.y+box.height+escapeDistance]:[side==='left'?box.x-escapeDistance:box.x+box.width+escapeDistance,y];
  return{side,point,escape,fixedPoint:[(x-box.x)/box.width,(y-box.y)/box.height]};
}

class Heap{
  rows:{id:number;score:number}[]=[];
  push(row:{id:number;score:number}){let i=this.rows.length;this.rows.push(row);while(i){const p=(i-1)>>1;if(this.rows[p]!.score<=row.score)break;this.rows[i]=this.rows[p]!;i=p;}this.rows[i]=row;}
  pop(){const first=this.rows[0],last=this.rows.pop();if(!first||!last)return first;if(this.rows.length){let i=0;while(true){const left=i*2+1,right=left+1;if(left>=this.rows.length)break;const next=right<this.rows.length&&this.rows[right]!.score<this.rows[left]!.score?right:left;if(last.score<=this.rows[next]!.score)break;this.rows[i]=this.rows[next]!;i=next;}this.rows[i]=last;}return first;}
}

const contained=(r:Rect,b:Rect)=>r.x>=b.x-EPS&&r.y>=b.y-EPS&&r.x+r.width<=b.x+b.width+EPS&&r.y+r.height<=b.y+b.height+EPS;
const pointContained=(p:Point,b:Rect)=>contained({x:p[0],y:p[1],width:0,height:0},b);
function search(start:Point,end:Point,obstacles:Rect[],bounds?:Rect):Point[]|null{
  const xs=new Set<number>([start[0],end[0]]),ys=new Set<number>([start[1],end[1]]);
  for(const r of obstacles){xs.add(r.x);xs.add(r.x+r.width);ys.add(r.y);ys.add(r.y+r.height);}
  if(bounds){xs.add(bounds.x);xs.add(bounds.x+bounds.width);ys.add(bounds.y);ys.add(bounds.y+bounds.height);}
  const x=[...xs].filter(v=>!bounds||v>=bounds.x-EPS&&v<=bounds.x+bounds.width+EPS).sort((a,b)=>a-b),y=[...ys].filter(v=>!bounds||v>=bounds.y-EPS&&v<=bounds.y+bounds.height+EPS).sort((a,b)=>a-b);if(!bounds){x.unshift(x[0]!-96);x.push(x.at(-1)!+96);y.unshift(y[0]!-96);y.push(y.at(-1)!+96);}else if(!pointContained(start,bounds)||!pointContained(end,bounds))return null;
  const count=x.length*y.length;if(count>90000)return null;
  const point=(id:number):Point=>[x[Math.floor(id/y.length)]!,y[id%y.length]!],startId=x.indexOf(start[0])*y.length+y.indexOf(start[1]),endId=x.indexOf(end[0])*y.length+y.indexOf(end[1]);
  const blocked=new Map<number,boolean>(),valid=(id:number)=>{if(!blocked.has(id))blocked.set(id,obstacles.some(r=>inside(point(id),r)));return !blocked.get(id);};
  if(!valid(startId)||!valid(endId))return null;
  // State includes arrival axis so bends have a real cost instead of depending on tie ordering.
  const heap=new Heap(),cost=new Map<number,number>(),prev=new Map<number,number>(),initial=startId*3;cost.set(initial,0);heap.push({id:initial,score:distance(start,end)});
  let goal=-1,iterations=0;
  while(heap.rows.length&&iterations++<Math.min(count*6,30000)){const item=heap.pop()!,state=item.id,id=Math.floor(state/3),axis=state%3,current=point(id),spent=cost.get(state)!;
    if(item.score>spent+distance(current,end)+EPS)continue;
    if(id===endId){goal=state;break;}
    const xi=Math.floor(id/y.length),yi=id%y.length;
    for(const [nx,ny,nextAxis] of [[xi-1,yi,1],[xi+1,yi,1],[xi,yi-1,2],[xi,yi+1,2]]){
      if(nx!<0||nx!>=x.length||ny!<0||ny!>=y.length)continue;const nextId=nx!*y.length+ny!,next=point(nextId);if(!valid(nextId)||obstacles.some(r=>segmentHitsBox(current,next,r)))continue;
      const nextState=nextId*3+nextAxis!,nextCost=spent+distance(current,next)+(axis&&axis!==nextAxis?32:0);
      if(nextCost<(cost.get(nextState)??Infinity)){cost.set(nextState,nextCost);prev.set(nextState,state);heap.push({id:nextState,score:nextCost+distance(next,end)});}
    }
  }
  if(goal<0)return null;const path:Point[]=[];for(let cursor=goal;;cursor=prev.get(cursor)!){path.push(point(Math.floor(cursor/3)));if(cursor===initial)break;}return simplify(path.reverse());
}

function placeLabel(text:string,points:Point[],nodes:Box[],routes:Route[],reservedLines:[Point,Point][],bounds?:Rect):Route['label']|null{
  const label=text.replace(/[a-z]/g,c=>c.toUpperCase()),width=gridUp(textBudget(label,14)+16),height=32;
  const choices=segments(points).map(([a,b],segment)=>({a,b,segment,length:distance(a,b)})).sort((a,b)=>b.length-a.length);
  const allLines=[...segments(points),...routes.flatMap(r=>segments(r.points)),...reservedLines];
  for(const {a,b,segment,length} of choices){const horizontal=a[1]===b[1];if(length<(horizontal?width:height)+(bounds?24:48))continue;
    for(const sign of [-1,1]){const x=grid(horizontal?(a[0]+b[0]-width)/2:sign<0?a[0]-8-width:a[0]+8),y=grid(horizontal?(sign<0?a[1]-8-height:a[1]+8):(a[1]+b[1]-height)/2),rect={x,y,width,height};
      const gap=horizontal?(sign<0?a[1]-y-height:y-a[1]):sign<0?a[0]-x-width:x-a[0];
      if(gap<6-EPS||gap>10+EPS||bounds&&!contained(rect,bounds)||nodes.some(n=>boxesOverlap(rect,inflate(n,4)))||routes.some(r=>r.label&&boxesOverlap(rect,inflate(r.label,4)))||allLines.some(([u,v])=>segmentHitsBox(u,v,inflate(rect,2))))continue;
      return{...rect,text:label,segment,gap};
    }
  }
  return null;
}

function preferredSides(from:Box,to:Box,direction:'right'|'down',variant:number):[Side,Side]{
  const dx=to.x+to.width/2-from.x-from.width/2,dy=to.y+to.height/2-from.y-from.height/2;
  if(variant>=2){const horizontal=Math.abs(dx)/(from.width+to.width)>=Math.abs(dy)/(from.height+to.height);return horizontal?(dx>=0?['right','left']:['left','right']):(dy>=0?['bottom','top']:['top','bottom']);}
  if(direction==='down'&&dy<0)return variant%2?['left','left']:['right','right'];
  if(direction==='right'&&dx<0)return variant%2?['top','top']:['bottom','bottom'];
  const horizontal=variant>=2?Math.abs(dx)>EPS:direction==='right'?dx>0:Math.abs(dx)>Math.abs(dy)*1.5;
  return horizontal?(dx>=0?['right','left']:['left','right']):(dy>=0?['bottom','top']:['top','bottom']);
}

export function routeBoard(nodes:Box[],edges:FlowEdge[],direction:'right'|'down',options:RoutingOptions={}){
  const gap=options.nodeGap??24;
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(boxesOverlap(inflate(nodes[i]!,gap/2),inflate(nodes[j]!,gap/2)))throw Error('BOARD_NODE_OVERLAP: 节点之间至少保留'+gap+'px');
  if(options.bounds&&nodes.some(n=>!contained(n,options.bounds!)))throw Error('BOARD_CANVAS_OVERFLOW: 节点超出画幅内容区');
  const map=new Map(nodes.map(n=>[n.id,n])),attempts:string[]=[];
  for(let attempt=0;attempt<12;attempt++){
    const assignments=edges.map(edge=>{const [start,end]=preferredSides(map.get(edge.from)!,map.get(edge.to)!,direction,attempt%4);return{edge,start,end};});
    const groups=new Map<string,{edgeId:string;end:'start'|'end';side:Side}[]>();
    for(const item of assignments)for(const end of ['start','end'] as const){const nodeId=end==='start'?item.edge.from:item.edge.to,side=item[end],key=nodeId+':'+side;groups.set(key,[...(groups.get(key)??[]),{edgeId:item.edge.id,end,side}]);}
    const ports=new Map<string,Port>();let invalid=false;
    for(const [key,group] of groups){const nodeId=key.slice(0,key.lastIndexOf(':')),node=map.get(nodeId)!;group.sort((a,b)=>{const aEdge=edges.find(e=>e.id===a.edgeId)!,bEdge=edges.find(e=>e.id===b.edgeId)!,aOther=map.get(a.end==='start'?aEdge.to:aEdge.from)!,bOther=map.get(b.end==='start'?bEdge.to:bEdge.from)!;return a.side==='top'||a.side==='bottom'?aOther.x-bOther.x:aOther.y-bOther.y;});try{group.forEach((item,index)=>ports.set(item.edgeId+':'+item.end,port(node,item.side,index,group.length,options.escape)));}catch{invalid=true;break;}}
    if(invalid)continue;
    const ordered=edges.slice().sort((a,b)=>{const length=(e:FlowEdge)=>distance(ports.get(e.id+':start')!.point,ports.get(e.id+':end')!.point);return attempt>=8?length(a)-length(b):attempt>=4?b.id.localeCompare(a.id):length(b)-length(a);});
    const routes:Route[]=[];
    for(const edge of ordered){const start=ports.get(edge.id+':start')!,end=ports.get(edge.id+':end')!,priorLines=routes.flatMap(r=>segments(r.points).map(([a,b])=>lineBox(a,b))),labelObstacles=routes.flatMap(r=>r.label?[inflate(r.label,4)]:[]),nodeObstacles=nodes.map(n=>inflate(n,options.nodeClearance??24));
      const reservedLines:[Point,Point][]=edges.filter(e=>e.id!==edge.id).flatMap(e=>['start','end'].map(side=>{const p=ports.get(e.id+':'+side)!;return[p.point,p.escape] as [Point,Point];}));
      const stubs:[[Point,Point,string],[Point,Point,string]]=[[start.point,start.escape,edge.from],[end.point,end.escape,edge.to]];
      if(stubs.some(([a,b,owner])=>nodes.some(n=>n.id!==owner&&segmentHitsBox(a,b,inflate(n,12)))||[...priorLines,...labelObstacles].some(r=>segmentHitsBox(a,b,r)))){attempts.push(attempt+':stub:'+edge.id);invalid=true;break;}
      const path=search(start.escape,end.escape,[...nodeObstacles,...priorLines,...labelObstacles,...reservedLines.map(([a,b])=>lineBox(a,b))],options.bounds);if(!path){attempts.push(attempt+':path:'+edge.id);invalid=true;break;}
      const points=simplify([start.point,...path,end.point]);const label=edge.label?placeLabel(edge.label,points,nodes,routes,reservedLines,options.bounds):undefined;if(edge.label&&!label){attempts.push(attempt+':label:'+edge.id);invalid=true;break;}
      routes.push({id:edge.id,from:edge.from,to:edge.to,points,start,end,...(label?{label}:{})});
    }
    if(!invalid){const orderedRoutes=edges.map(e=>routes.find(r=>r.id===e.id)!);const check=checkBoardRouting(nodes,orderedRoutes,options.bounds);if(check.ok)return{routes:orderedRoutes,check};attempts.push(attempt+':check:'+check.errors.join(','));}
  }
  throw Error('BOARD_LAYOUT_UNROUTABLE: 当前布局无法在不穿框、不交叉且标签清晰的条件下布线；请简化分支或调整节点坐标',{cause:{attempts}});
}

export function checkBoardRouting(nodes:Box[],routes:Route[],bounds?:Rect){
  const errors:string[]=[];
  const ports=new Map<string,Point[]>();
  for(const node of nodes)if([node.x,node.y,node.width,node.height].some(v=>Math.abs(v/4-Math.round(v/4))>EPS))errors.push('OFF_GRID:'+node.id);
  if(bounds)for(const node of nodes)if(!contained(node,bounds))errors.push('CANVAS_NODE:'+node.id);
  for(let i=0;i<routes.length;i++){const route=routes[i]!,parts=segments(route.points);
    if(bounds&&route.points.some(point=>!pointContained(point,bounds)))errors.push('CANVAS_ROUTE:'+route.id);
    for(let point=1;point<route.points.length-1;point++)if(Math.min(distance(route.points[point-1]!,route.points[point]!),distance(route.points[point]!,route.points[point+1]!))<12-EPS)errors.push('SHORT_BEND:'+route.id);
    for(const [nodeId,port,adjacent] of [[route.from,route.start,route.points[1]],[route.to,route.end,route.points.at(-2)]] as const){
      const key=nodeId+':'+port.side,previous=ports.get(key)??[];if(previous.some(point=>distance(point,port.point)<12-EPS))errors.push('PORT_FAN:'+nodeId);ports.set(key,[...previous,port.point]);
      if(!adjacent||((port.side==='top'||port.side==='bottom')?adjacent[0]!==port.point[0]:adjacent[1]!==port.point[1]))errors.push('PORT_DIRECTION:'+route.id);
    }
    for(const [a,b] of parts){if(a[0]!==b[0]&&a[1]!==b[1])errors.push('DIAGONAL:'+route.id);for(const node of nodes)if(node.id!==route.from&&node.id!==route.to&&segmentHitsBox(a,b,node))errors.push('NODE_TRANSIT:'+route.id+':'+node.id);}
    for(let j=0;j<i;j++)for(const [a,b] of parts)for(const [u,v] of segments(routes[j]!.points))if(segmentHitsBox(a,b,lineBox(u,v,12-EPS)))errors.push('ROUTE_COLLISION:'+route.id+':'+routes[j]!.id);
    if(route.label){const label=route.label,[a,b]=parts[label.segment]??[];
      if(bounds&&!contained(label,bounds))errors.push('CANVAS_LABEL:'+route.id);
      const horizontal=a&&b&&a[1]===b[1],gap=a?(horizontal?Math.max(label.y-a[1],a[1]-label.y-label.height):Math.max(label.x-a[0],a[0]-label.x-label.width)):-1;
      if(gap<6-EPS||gap>10+EPS)errors.push('LABEL_GAP:'+route.id);
      if(a&&b&&Math.abs(horizontal?label.x+label.width/2-(a[0]+b[0])/2:label.y+label.height/2-(a[1]+b[1])/2)>2+EPS)errors.push('LABEL_CENTER:'+route.id);
      if([label.x,label.y,label.width,label.height].some(v=>Math.abs(v/4-Math.round(v/4))>EPS))errors.push('LABEL_GRID:'+route.id);
      if(nodes.some(n=>boxesOverlap(n,label)))errors.push('LABEL_NODE:'+route.id);if(routes.flatMap(r=>segments(r.points)).some(([u,v])=>segmentHitsBox(u,v,inflate(label,1))))errors.push('LABEL_LINE:'+route.id);for(let j=0;j<i;j++)if(routes[j]!.label&&boxesOverlap(route.label,routes[j]!.label!))errors.push('LABEL_OVERLAP:'+route.id);
    }
  }
  return{ok:!errors.length,errors:[...new Set(errors)],nodes:nodes.length,arrows:routes.length,orthogonal:!errors.some(e=>e.startsWith('DIAGONAL:')),crossings:errors.filter(e=>e.startsWith('ROUTE_COLLISION:')).length,minParallelGap:12,labelGap:[6,10],grid:4};
}
