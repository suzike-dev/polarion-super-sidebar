/** Runs in Polarion's MAIN world through chrome.scripting. Extension-owned HTML
 * is used only for comparison, never inserted. The adapter invokes the observed 21R2
 * native read-only document request and the same state adoption used after Save.
 * A different GWT build must be verified before adding an adapter. */
export async function nativeWorkItemRefresh(input:{href:string;workItemId:string;phase:'check'|'refresh';expectedHtml?:string}) {
  try {
    if(location.href!==input.href||location.origin!=='https://polarion.pufafen.com'||!/^[\w-]+$/.test(input.workItemId))throw Error('NATIVE_DOCUMENT_CHANGED');
    const frame=document.querySelector<HTMLIFrameElement>('#gwt-debug-polarion-DLE-area-debug-id');
    const runtime=document.getElementById('com.polarion.UI') as HTMLIFrameElement|null;
    const g=runtime?.contentWindow as any;
    if(!frame?.src.includes('6CFA8B41DF5960703FD822D08642B011')||!g)throw Error('NATIVE_REFRESH_UNSUPPORTED');
    const e=g.ieu?.D?.d?.a?.e,body=frame.contentDocument?.body;
    const id='polarion_wiki macro name=module-workitem;params=id='+input.workItemId;
    if(!e?.i?.q||!body?.ownerDocument.getElementById(id))throw Error('NATIVE_ITEM_NOT_LOADED');
    for(const name of ['Sql','RYh','JEh','lte','Wsi','g5r','img','lmo','EXh','AXh','$Bi','bmw','Wlw','amw','SWh','hWh','uGi','wsi','xsi'])if(typeof g[name]!=='function')throw Error('NATIVE_REFRESH_UNSUPPORTED');
    const check=()=>{
      if(location.href!==input.href||g.ieu?.D?.d?.a?.e!==e||frame.contentDocument?.body!==body)throw Error('NATIVE_DOCUMENT_CHANGED');
      if(g.Sql(g.RYh(e.C)))throw Error('NATIVE_EDITOR_DIRTY');
      const save=document.getElementById('gwt-debug-toolbar-save');
      if(!save||!save.className.includes('Button-disabled'))throw Error('NATIVE_EDITOR_UNKNOWN');
    };
    check();if(input.phase==='check')return{ok:true};
    const items=new g.JEh;g.lte(items.a,new g.Wsi(id));g.g5r();
    // The open reference pins a historical revision. Fetch the current native
    // model, including the conflict baseline. Loading just the rendered item
    // leaves an obsolete baseline and causes a false conflict on native Save.
    const currentReference=Object.assign(Object.create(Object.getPrototypeOf(e.p)),e.p,{e:null});
    const read=(request:any)=>new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('NATIVE_REFRESH_TIMEOUT')),12000);
      g.img(g.lmo(g._4r),request,{Zd:(value:any)=>{clearTimeout(timeout);resolve(value);},ee:()=>{clearTimeout(timeout);reject(Error('NATIVE_REFRESH_FAILED'));}});
    });
    const fresh=await read(new g.EXh(currentReference,e.C.o));check();
    if(!fresh?.w?.a||typeof fresh.i?.C!=='string')throw Error('NATIVE_REFRESH_INVALID_RESPONSE');
    // Use the same freshly read revision for the visible item, including items
    // that the large-document response represents as lazy placeholders.
    const result=await read(new g.$Bi(fresh.p,fresh.w.a,items));
    check();
    const entries:any[]=[];
    for(const iterator=new g.bmw(new g.Wlw(result.f.a));iterator.d!==iterator.e.a.d;)entries.push(g.amw(iterator));
    if(entries.length!==1||entries[0].f!==id||typeof entries[0].g!=='string')throw Error('NATIVE_REFRESH_INVALID_RESPONSE');
    const visibleText=(html:string)=>{const parsed=new DOMParser().parseFromString(html,'text/html');parsed.querySelectorAll('script,style,[id^="polarion_wiki macro name="]:not([id*="module-workitem"])').forEach(n=>n.remove());return(parsed.body.textContent??'').replace(/[\s\u200b\ufeff]+/g,'');};
    const expected=visibleText(input.expectedHtml??'');
    if(expected&&!visibleText(entries[0].g).includes(expected))throw Error('NATIVE_REFRESH_CONTENT_MISMATCH');
    const x=frame.contentWindow!.scrollX,y=frame.contentWindow!.scrollY;
    // Adopt the native server model atomically with its metadata and conflict
    // baseline. The existing iframe, body and extension editors remain mounted.
    // Both checks above reject native input made while the read was in flight.
    g.AXh(e,fresh);
    g.SWh(e.i.q,{Up:(transaction:any)=>{
      const part=g.hWh(transaction,id);
      if(!part?.d?.k)throw Error('NATIVE_ITEM_NOT_LOADED');
      g.uGi(part.d,entries[0].g);
    }});
    g.wsi(new g.xsi(e,result));
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    frame.contentWindow!.scrollTo(x,y);check();
    const rendered=body.ownerDocument.getElementById(id);
    if(!rendered||(expected&&!visibleText(rendered.outerHTML).includes(expected)))throw Error('NATIVE_REFRESH_CONTENT_MISMATCH');
    return{ok:true};
  }catch(error){return{ok:false,error:error instanceof Error?error.message:'NATIVE_REFRESH_FAILED'};}
}
