import {z} from 'zod';
export const BoardPatchSchema=z.object({id:z.string().min(1).max(200),text:z.string().max(10000).optional(),x:z.number().finite().min(-100000).max(100000).optional(),y:z.number().finite().min(-100000).max(100000).optional(),width:z.number().positive().max(20000).optional(),height:z.number().positive().max(20000).optional(),strokeColor:z.string().regex(/^#[a-f0-9]{6}$/i).optional(),backgroundColor:z.string().regex(/^(#[a-f0-9]{6}|transparent)$/i).optional()}).strict();
export const BoardPatchesSchema=z.array(BoardPatchSchema).min(1).max(100);
export type BoardPatch=z.infer<typeof BoardPatchSchema>;
export type BoardElement=Record<string,any>&{id:string;type:string;x:number;y:number;width:number;height:number};
// Ignore runtime versions; retain all persisted visual/content/binding fields for optimistic checks.
export function boardSceneSignature(elements:readonly BoardElement[]){
 const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!['version','versionNonce','updated','index'].includes(k)&&v[k]!==undefined).map(k=>[k,clean(v[k])])):v;
 return JSON.stringify(elements.filter(e=>!e.isDeleted).map(e=>clean(e)));
}
export function applyBoardPatches(elements:readonly BoardElement[],input:unknown){
 const patches=BoardPatchesSchema.parse(input),old=new Map(elements.map(e=>[e.id,e])),next=new Map(elements.map(e=>[e.id,structuredClone(e)])),changed=new Set<string>();
 if(new Set(patches.map(p=>p.id)).size!==patches.length)throw Error('BOARD_DUPLICATE_PATCH');
 const geometry=new Set<string>();
 for(const patch of patches){const e=next.get(patch.id);if(!e||e.isDeleted)throw Error('BOARD_ELEMENT_MISSING');if(e.locked)throw Error('BOARD_ELEMENT_LOCKED');
  const fields=Object.keys(patch).filter(k=>k!=='id');if(!fields.length)throw Error('BOARD_EMPTY_PATCH');
  if(patch.text!==undefined&&e.type!=='text')throw Error('BOARD_TEXT_ID_REQUIRED: 请修改绑定文字对象的 ID');
  if(fields.some(k=>['x','y','width','height'].includes(k))){
   if(!['rectangle','ellipse','diamond','text'].includes(e.type)||e.angle||e.frameId||e.groupIds?.length)throw Error('BOARD_GEOMETRY_UNSUPPORTED: 仅支持未旋转、未编组的节点与文字');
   if(e.containerId)throw Error('BOARD_BOUND_TEXT_GEOMETRY: 请移动所属节点');
   if(e.type==='text'&&(patch.width!==undefined||patch.height!==undefined))throw Error('BOARD_TEXT_SIZE_AUTOMATIC: 文字尺寸由编辑器测量');
   geometry.add(e.id);
  }
  Object.assign(e,patch);if(patch.text!==undefined){e.originalText=patch.text;e.autoResize=true;}changed.add(e.id);
 }
 // Move bound labels with their node. Never remove or invent a binding.
 for(const e of next.values())if(e.containerId&&geometry.has(e.containerId)){
  const before=old.get(e.containerId)!,after=next.get(e.containerId)!;
  if(e.locked)throw Error('BOARD_ELEMENT_LOCKED');
  if(!['rectangle','ellipse','diamond'].includes(before.type))throw Error('BOARD_BINDING_UNSUPPORTED');
  e.x+=after.x-before.x+(after.width-before.width)/2;e.y+=after.y-before.y+(after.height-before.height)/2;changed.add(e.id);
 }
 for(const e of next.values())if(e.startBinding||e.endBinding){
  const moveStart=geometry.has(e.startBinding?.elementId),moveEnd=geometry.has(e.endBinding?.elementId);if(!moveStart&&!moveEnd)continue;
  if(e.locked)throw Error('BOARD_ELEMENT_LOCKED');
  if(e.type!=='arrow'||e.elbowed||e.angle||e.points?.length!==2||e.boundElements?.length)throw Error('BOARD_CONNECTION_GEOMETRY_UNSUPPORTED: 此节点含折线、旋转或带标签连线，请手动调整');
  const points=e.points.map((p:number[])=>[e.x+p[0]!,e.y+p[1]!]);
  for(const [i,binding] of [[0,e.startBinding],[1,e.endBinding]] as const){if(!binding||!geometry.has(binding.elementId))continue;const before=old.get(binding.elementId)!,after=next.get(binding.elementId)!;
   points[i]=[after.x+(points[i][0]-before.x)*after.width/before.width,after.y+(points[i][1]-before.y)*after.height/before.height];
  }
  e.x=points[0][0];e.y=points[0][1];e.points=[[0,0],[points[1][0]-e.x,points[1][1]-e.y]];e.width=Math.abs(e.points[1][0]);e.height=Math.abs(e.points[1][1]);changed.add(e.id);
 }
 return {elements:elements.map(e=>next.get(e.id)!),changedIds:[...changed],summary:[...changed].map(id=>{const before=old.get(id)!,after=next.get(id)!,keys=['text','x','y','width','height','strokeColor','backgroundColor','points'].filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));return{id,before:Object.fromEntries(keys.map(k=>[k,before[k]])),after:{id,...Object.fromEntries(keys.map(k=>[k,after[k]]))}};})};
}
