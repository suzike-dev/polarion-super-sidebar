import {defineContentScript} from 'wxt/utils/define-content-script';
import {markUserEvent} from '../lib/ui-event-trust';
export default defineContentScript({
  matches:['https://polarion.pufafen.com/polarion/*'],runAt:'document_start',allFrames:false,
  main(ctx){
    // Polarion's window capture shortcuts run before shadow-root bubble isolation.
    // Forward keys only inside our shadow tree, retaining trusted browser defaults.
    const isolate=(event:KeyboardEvent)=>{
      if(!event.isTrusted)return;const path=event.composedPath();
      if(!path.some(node=>node instanceof Element&&node.localName==='polarion-super-sidebar'))return;
      const target=path[0];if(!(target instanceof Element))return;event.stopImmediatePropagation();
      const copy=new KeyboardEvent(event.type,{key:event.key,code:event.code,location:event.location,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey,repeat:event.repeat,isComposing:event.isComposing,bubbles:true,cancelable:event.cancelable,composed:false,view:window});
      for(const key of ['keyCode','charCode','which'] as const)Object.defineProperty(copy,key,{value:event[key]});
      if(!target.dispatchEvent(copy))event.preventDefault();
    };
    for(const type of ['keydown','keyup','keypress'])window.addEventListener(type,isolate as EventListener,true);
    const isolateClick=(event:MouseEvent)=>{if(!event.isTrusted)return;const path=event.composedPath();if(!path.some(n=>n instanceof Element&&n.localName==='polarion-super-sidebar'))return;const target=path[0];if(!(target instanceof Element))return;event.stopImmediatePropagation();
      const copy=new MouseEvent(event.type,{bubbles:true,cancelable:true,composed:false,view:window,detail:event.detail,screenX:event.screenX,screenY:event.screenY,clientX:event.clientX,clientY:event.clientY,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey,button:event.button,buttons:event.buttons});markUserEvent(copy);
      const accepted=target.dispatchEvent(copy);if(event.type==='click'||!accepted)event.preventDefault();
    };
    for(const type of ['click','dblclick'])window.addEventListener(type,isolateClick as EventListener,true);
    ctx.onInvalidated(()=>{for(const type of ['keydown','keyup','keypress'])window.removeEventListener(type,isolate as EventListener,true);for(const type of ['click','dblclick'])window.removeEventListener(type,isolateClick as EventListener,true);});
  },
});
