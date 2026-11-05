import { RichImage } from '../../../packages/core/rich-schema';
import type {Asset,Draft} from '../../../packages/protocol/index';
import {rpc} from './client';
import {assetBlob} from './assets';
import {safeStyle} from '../../../packages/core/rich-style';
export function imageResolver(draft:Draft){
  const urls=new Set<string>(),pending=new Map<string,Promise<string>>();let disposed=false;
  return{async resolve(src:string,assetId?:string|null){
    const key=assetId??src;if(pending.has(key))return pending.get(key)!;
    const job=(async()=>{
      let asset:Asset|undefined;
      if(assetId||src.startsWith('polarion-asset:'))asset=await rpc({method:'assets.metadata',assetId:assetId??src.slice(15)});
      else if(src.startsWith('workitemimg:'))asset=await rpc({method:'images.resolve',target:draft.target,workItemId:draft.workItemId,src});
      if(asset){if(asset.extraction!=='image')throw Error('IMAGE_NOT_AVAILABLE');const blob=await assetBlob(asset);if(disposed)throw Error('EDITOR_CLOSED');const url=URL.createObjectURL(blob);urls.add(url);return url;}
      if(src.startsWith('attachment:')){
        // 先按工作项附件解析（LiveDoc 会把工作项附件写成 attachment:<文件名>），失败再回退模块附件 URL。
        try{
          const asset=await rpc<Asset>({method:'images.resolve',target:draft.target,workItemId:draft.workItemId,src});
          if(asset.extraction==='image'){const blob=await assetBlob(asset);if(disposed)throw Error('EDITOR_CLOSED');const url=URL.createObjectURL(blob);urls.add(url);return url;}
        }catch{/* fall back to module attachment URL */}
        return draft.target.origin+'/polarion/module-attachment/'+encodeURIComponent(draft.target.projectId)+'/'+draft.target.document.split('/').map(encodeURIComponent).join('/')+'/'+encodeURIComponent(src.slice(11));
      }
      const url=new URL(src,draft.target.origin+'/polarion/');if(url.origin!==draft.target.origin)throw Error('IMAGE_IMPORT_REQUIRED');return url.href;
    })();pending.set(key,job);return job;
  },dispose(){disposed=true;urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();}};
}
export function editableImage(resolve:(src:string,assetId?:string|null)=>Promise<string>){
  return RichImage.extend({addNodeView(){return({node,editor,getPos})=>{
    const dom=document.createElement('span'),frame=document.createElement('span'),img=document.createElement('img'),label=document.createElement('span'),handle=document.createElement('button'),size=document.createElement('span');dom.className='rich-image';dom.contentEditable='false';img.draggable=true;label.className='image-state';frame.className='image-frame';handle.type='button';handle.className='image-resize-handle';handle.setAttribute('aria-label','调整图片大小');handle.title='拖动保持比例缩放 · 方向键每次调整 10 px';size.className='image-size-label';frame.append(img,handle,size);dom.append(frame,label);let current=node,alive=true,version=0;
    const paint=()=>{const a=current.attrs;img.alt=a.alt??'';img.title=a.title??'';img.style.cssText=safeStyle(a.sourceStyle);if(a.width)img.style.width=`${a.width}px`;if(a.height)img.style.height=`${a.height}px`;img.style.maxWidth='100%';dom.style.display='block';dom.style.textAlign=a.align??'left';};
    const resize=(width:number,height:number)=>{const pos=getPos();if(typeof pos==='number'&&editor.isEditable)editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,width,height}));};
    let drag:{x:number;width:number;height:number;nextWidth:number;nextHeight:number}|null=null;
    handle.onpointerdown=event=>{if(!editor.isEditable||event.button!==0)return;event.preventDefault();event.stopPropagation();const box=img.getBoundingClientRect();drag={x:event.clientX,width:box.width,height:box.height,nextWidth:Math.round(box.width),nextHeight:Math.round(box.height)};handle.setPointerCapture(event.pointerId);};
    handle.onpointermove=event=>{if(!drag)return;const max=Math.min(9999,dom.clientWidth||9999);drag.nextWidth=Math.round(Math.max(24,Math.min(max,drag.width+event.clientX-drag.x)));drag.nextHeight=Math.max(1,Math.round(drag.height*drag.nextWidth/drag.width));img.style.width=drag.nextWidth+'px';img.style.height=drag.nextHeight+'px';size.textContent=`${drag.nextWidth} × ${drag.nextHeight}`;};
    handle.onpointerup=event=>{if(!drag)return;const {nextWidth,nextHeight}=drag;drag=null;size.textContent='';if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);resize(nextWidth,nextHeight);};
    handle.onpointercancel=()=>{drag=null;size.textContent='';paint();};
    handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||!editor.isEditable)return;event.preventDefault();event.stopPropagation();const box=img.getBoundingClientRect(),width=Math.round(Math.max(24,Math.min(dom.clientWidth||9999,box.width+(['ArrowRight','ArrowUp'].includes(event.key)?10:-10))));resize(width,Math.max(1,Math.round(box.height*width/box.width)));};
    const load=()=>{const v=++version;label.textContent='正在读取图片…';label.hidden=false;img.hidden=true;void resolve(current.attrs.src,current.attrs.assetId).then(src=>{if(!alive||v!==version)return;img.onload=()=>{label.hidden=true;img.hidden=false;};img.onerror=()=>{label.textContent='图片暂不可显示 · 原始引用保留';};img.src=src;}).catch(()=>{if(alive&&v===version)label.textContent='图片暂不可显示 · 原始引用保留';});};
    paint();load();return{dom,update(next){if(next.type!==current.type)return false;const changed=next.attrs.src!==current.attrs.src||next.attrs.assetId!==current.attrs.assetId;current=next;paint();if(changed)load();return true;},destroy(){alive=false;},stopEvent:event=>handle.contains(event.target as Node),ignoreMutation:()=>true};
  };}});
}
