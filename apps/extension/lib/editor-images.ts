import { RichImage } from '../../../packages/core/rich-schema';
import type {Asset,Draft} from '../../../packages/protocol/index';
import {rpc} from './client';
import {assetBlob} from './assets';
export function imageResolver(draft:Draft){
  const urls=new Set<string>(),pending=new Map<string,Promise<string>>();let disposed=false;
  return{async resolve(src:string,assetId?:string|null){
    const key=assetId??src;if(pending.has(key))return pending.get(key)!;
    const job=(async()=>{
      let asset:Asset|undefined;
      if(assetId||src.startsWith('polarion-asset:'))asset=await rpc({method:'assets.metadata',assetId:assetId??src.slice(15)});
      else if(src.startsWith('workitemimg:'))asset=await rpc({method:'images.resolve',target:draft.target,workItemId:draft.workItemId,src});
      if(asset){if(asset.extraction!=='image')throw Error('IMAGE_NOT_AVAILABLE');const blob=await assetBlob(asset);if(disposed)throw Error('EDITOR_CLOSED');const url=URL.createObjectURL(blob);urls.add(url);return url;}
      if(src.startsWith('attachment:'))return draft.target.origin+'/polarion/module-attachment/'+encodeURIComponent(draft.target.projectId)+'/'+draft.target.document.split('/').map(encodeURIComponent).join('/')+'/'+encodeURIComponent(src.slice(11));
      const url=new URL(src,draft.target.origin+'/polarion/');if(url.origin!==draft.target.origin)throw Error('IMAGE_IMPORT_REQUIRED');return url.href;
    })();pending.set(key,job);return job;
  },dispose(){disposed=true;urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();}};
}
export function editableImage(resolve:(src:string,assetId?:string|null)=>Promise<string>){
  return RichImage.extend({addNodeView(){return({node})=>{
    const dom=document.createElement('span'),img=document.createElement('img'),label=document.createElement('span');dom.className='rich-image';dom.contentEditable='false';img.draggable=true;label.className='image-state';dom.append(img,label);let current=node,alive=true,version=0;
    const paint=()=>{const a=current.attrs;img.alt=a.alt??'';img.title=a.title??'';img.style.width=a.width?`${a.width}px`:'';img.style.height=a.height?`${a.height}px`:'';dom.style.display='block';dom.style.textAlign=a.align??'left';};
    const load=()=>{const v=++version;label.textContent='正在读取图片…';label.hidden=false;img.hidden=true;void resolve(current.attrs.src,current.attrs.assetId).then(src=>{if(!alive||v!==version)return;img.onload=()=>{label.hidden=true;img.hidden=false;};img.onerror=()=>{label.textContent='图片暂不可显示 · 原始引用保留';};img.src=src;}).catch(()=>{if(alive&&v===version)label.textContent='图片暂不可显示 · 原始引用保留';});};
    paint();load();return{dom,update(next){if(next.type!==current.type)return false;const changed=next.attrs.src!==current.attrs.src||next.attrs.assetId!==current.attrs.assetId;current=next;paint();if(changed)load();return true;},destroy(){alive=false;},ignoreMutation:()=>true};
  };}});
}
