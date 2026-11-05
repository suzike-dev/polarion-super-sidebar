import type {BoardElement} from './board-changes.ts';

export type InstantiateOptions={centerX:number;centerY:number;prefix?:string};
export type InstantiateResult={elements:BoardElement[];ids:string[]};
export type ElementBounds={left:number;top:number;right:number;bottom:number};

/** Visible extent of one element. Line art carries its real geometry in `points`
 * (which may run left/above the origin and wider than the nominal box), so shells
 * and centring must not trust x+width/y+height for lines and arrows. */
export function elementBounds(element:BoardElement):ElementBounds {
  const points=element.points;
  if((element.type==='line'||element.type==='arrow')&&Array.isArray(points)&&points.length){
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const point of points){
      if(!Array.isArray(point)||point.length<2)continue;
      const px=Number(point[0]),py=Number(point[1]);
      if(!Number.isFinite(px)||!Number.isFinite(py))continue;
      left=Math.min(left,element.x+px);right=Math.max(right,element.x+px);
      top=Math.min(top,element.y+py);bottom=Math.max(bottom,element.y+py);
    }
    if(Number.isFinite(left))return{left,top,right,bottom};
  }
  return{left:element.x,top:element.y,right:element.x+element.width,bottom:element.y+element.height};
}

/** Combined visible extent of several elements. */
export function elementsBounds(elements:readonly BoardElement[]):ElementBounds {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const element of elements){const box=elementBounds(element);left=Math.min(left,box.left);top=Math.min(top,box.top);right=Math.max(right,box.right);bottom=Math.max(bottom,box.bottom);}
  return Number.isFinite(left)?{left,top,right,bottom}:{left:0,top:0,right:0,bottom:0};
}

/** Clone template elements into a scene at a new centre with fresh identities.
 * Bindings, text containers, groups and group-scoped references are remapped so the
 * inserted copy is fully independent from the library item it came from. */
export function instantiateElements(source:readonly BoardElement[],options:InstantiateOptions):InstantiateResult{
  if(!source.length)return{elements:[],ids:[]};
  const prefix=options.prefix??('tpl-'+Math.random().toString(36).slice(2,10)+'-');
  const live=source.filter(element=>!element.isDeleted);
  if(!live.length)return{elements:[],ids:[]};
  const idMap=new Map<string,string>(),groupMap=new Map<string,string>();
  live.forEach((element,index)=>{idMap.set(element.id,prefix+index);for(const group of element.groupIds??[])if(!groupMap.has(group))groupMap.set(group as string,prefix+'g'+groupMap.size);});
  const bounds=elementsBounds(live);
  const offsetX=options.centerX-(bounds.left+bounds.right)/2,offsetY=options.centerY-(bounds.top+bounds.bottom)/2;
  const elements=live.map(element=>{
    const clone=structuredClone(element) as BoardElement;
    clone.id=idMap.get(element.id)!;
    clone.x+=offsetX;clone.y+=offsetY;
    clone.containerId=element.containerId?idMap.get(element.containerId)??null:null;
    clone.groupIds=(element.groupIds??[]).map((group:string)=>groupMap.get(group)!);
    clone.boundElements=element.boundElements?.map((bound:{id:string;type:string})=>({...bound,id:idMap.get(bound.id)??bound.id}));
    for(const key of ['startBinding','endBinding'] as const){const binding=(clone as any)[key];if(binding&&typeof binding.elementId==='string')(binding as any).elementId=idMap.get(binding.elementId)??null;}
    clone.customData={...(element.customData??{}),boardTemplate:true};
    return clone;
  });
  return{elements,ids:elements.map(element=>element.id)};
}
