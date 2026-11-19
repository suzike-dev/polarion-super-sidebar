/** Runs in Polarion's MAIN world through chrome.scripting. Extension-owned HTML
 * is used only for comparison, never inserted. The adapter invokes the observed 21R2
 * native read-only document request and the same state adoption used after Save.
 * A different GWT build must be verified before adding an adapter. */
export async function nativeWorkItemRefresh(input:{href:string;workItemId:string;phase:'check'|'refresh';expectedHtml?:string;expectedTitle?:string}) {
  let stopTrackingInput: (() => void) | undefined;
  try {
    if(location.href!==input.href||location.origin!=='https://polarion.pufafen.com'||!/^[\w-]+$/.test(input.workItemId))throw Error('NATIVE_DOCUMENT_CHANGED');
    const frame=document.querySelector<HTMLIFrameElement>('#gwt-debug-polarion-DLE-area-debug-id');
    const runtime=document.getElementById('com.polarion.UI') as HTMLIFrameElement|null;
    const g=runtime?.contentWindow as any;
    if(!frame?.src.includes('6CFA8B41DF5960703FD822D08642B011')||!g)throw Error('NATIVE_REFRESH_UNSUPPORTED');
    const e=g.ieu?.D?.d?.a?.e,body=frame.contentDocument?.body;
    if (!body || !e?.C || typeof g.Sql !== 'function' || typeof g.RYh !== 'function') throw Error('NATIVE_EDITOR_UNKNOWN');
    let nativeInput = false;
    const check=()=>{
      if(location.href!==input.href||g.ieu?.D?.d?.a?.e!==e||frame.contentDocument?.body!==body||document.getElementById(frame.id)!==frame)throw Error('NATIVE_DOCUMENT_CHANGED');
      const dirty = g.Sql(g.RYh(e.C));
      if(nativeInput||dirty)throw Error('NATIVE_EDITOR_DIRTY');
      const save=document.getElementById('gwt-debug-toolbar-save');
      if(dirty !== false||!save?.className.includes('Button-disabled'))throw Error('NATIVE_EDITOR_UNKNOWN');
    };
    // The write guard checks the open document, including edits to other items.
    // Target membership and conflict protection for the write belong to the host.
    check();
    if(input.phase==='check')return{ok:true};
    if(typeof input.expectedHtml !== 'string')throw Error('INVALID_NATIVE_REFRESH');
    const baseId = 'polarion_wiki macro name=module-workitem;params=id=' + input.workItemId;
    const findPart = (root: ParentNode) => {
      const parts = Array.from(root.querySelectorAll(`[id="${baseId}"],[id^="${baseId}|"]`)).filter(el =>
        /^(?:\|(?:layout|level)=\d+)*$/.test(el.id.slice(baseId.length)) && !el.classList.contains('polarion-dle-workitem-basic-external'));
      if (parts.length !== 1) throw Error('NATIVE_ITEM_NOT_LOADED');
      return parts[0]!;
    };
    findPart(body);
    if (!e.i?.q) throw Error('NATIVE_REFRESH_UNSUPPORTED');
    for(const name of ['JEh','lte','Wsi','g5r','img','lmo','EXh','AXh','$Bi','bmw','Wlw','amw','SWh','hWh','uGi','wsi','xsi'])if(typeof g[name]!=='function')throw Error('NATIVE_REFRESH_UNSUPPORTED');
    const onInput = () => { nativeInput = true; };
    const editEvents = ['beforeinput', 'compositionstart', 'input'];
    for (const type of editEvents) body.ownerDocument.addEventListener(type, onInput, true);
    stopTrackingInput = () => { for (const type of editEvents) body.ownerDocument.removeEventListener(type, onInput, true); };
    const parse = (html: string) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.content;
    };
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
    const documentItem = findPart(parse(fresh.i.C));
    const id = documentItem.id;
    const items=new g.JEh;g.lte(items.a,new g.Wsi(id));g.g5r();
    const result=await read(new g.$Bi(fresh.p,fresh.w.a,items));
    check();
    const entries:any[]=[];
    for(const iterator=new g.bmw(new g.Wlw(result.f.a));iterator.d!==iterator.e.a.d;)entries.push(g.amw(iterator));
    if(entries.length!==1||entries[0].f!==id||typeof entries[0].g!=='string')throw Error('NATIVE_REFRESH_INVALID_RESPONSE');
    // executeScript serializes this function without its module scope. Parse in
    // inert templates and only read the live nodes in the post-install check.
    const fields = '.polarion-dle-workitem-icon-container,.polarion-dle-workitem-icon-container-decorations,[id="polarion_editor_fields_container_start"],[id="polarion_editor_fields_container_end"]';
    const titleSelector = ':scope > span[id="polarion_editor_field=title"].polarion-dle-workitem-title';
    const clean = (text: string) => text.replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    const titleText = (el: Element) => clean(Array.from(el.childNodes, node =>
      node.nodeType === 1 && (node as Element).matches(fields) ? '' : node.textContent ?? '').join(''));
    /** Word multiset of the visible body. Polarion may re-wrap blocks, split
     * spans or add generated reference labels; the actual words must match. */
    const wordKey = (root: ParentNode) => {
      let out = '';
      const titleField = root.querySelector(titleSelector);
      const visit = (node: Node) => {
        if (node.nodeType === 3) { out += node.textContent; return; }
        if (node.nodeType !== 1) return;
        const el = node as Element;
        if (el === titleField || el.matches(fields)) return;
        if (el.matches('span[data-type="workItem" i][data-item-id]')) { out += ' ref:' + (el.getAttribute('data-scope') ?? '') + ':' + (el.getAttribute('data-item-id') ?? '') + ' '; return; }
        if (el.localName === 'a' && el.hasAttribute('href')) out += ' href:' + (el.getAttribute('href') ?? '') + ' ';
        if (el.localName === 'ul' || el.localName === 'ol') {
          const items = Array.from(el.children).filter(child => child.localName === 'li');
          const neutral = items.length > 0 && items.every(item => /list-style\s*:\s*none/i.test(item.getAttribute('style') ?? ''));
          if (!neutral) out += ' L ';
        }
        const block = /^(p|div|h[1-6]|li|tr|td|th|table|ul|ol|br)$/.test(el.localName);
        if (block) out += ' ';
        el.childNodes.forEach(visit);
        if (block) out += ' ';
      };
      root.childNodes.forEach(visit);
      const words = out.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      return JSON.stringify(words.sort());
    };
    const headingLevel = (el: Element) => /^h[1-6]$/.test(el.localName) ? el.localName : el.localName === 'div' &&
      Array.from(el.classList).find(name => /^heading-(?:[7-9]|[1-9]\d+)$/.test(name));
    const signature = (root: DocumentFragment | Element, native = false, titleField?: Element | null) => {
      const tokens: (string | string[])[] = [];
      let text = '';
      const flush = () => { const value = clean(text); if (value) tokens.push(value); text = ''; };
      const token = (...parts: string[]) => { flush(); tokens.push(parts); };
      const visit = (node: Node) => {
        if (node.nodeType === 3) { text += node.textContent; return; }
        if (node.nodeType !== 1) return;
        const el = node as Element, tag = el.localName;
        if (el === titleField || (native && el.parentNode === root && el.matches(fields))) return;
        if (tag === 'script' || tag === 'style') return;
        if (el.matches('span[data-type="workItem" i][data-item-id]')) {
          // Both resolved links and missing-item messages are generated labels.
          token('workItem', el.getAttribute('data-scope') ?? '', el.getAttribute('data-item-id')!, el.getAttribute('data-revision') ?? '');
          return;
        }
        if (tag === 'a' && el.hasAttribute('href')) {
          let href = el.getAttribute('href')!;
          try { href = new URL(href, document.baseURI).href; } catch { /* Keep malformed targets distinct. */ }
          token(tag, href);
          el.childNodes.forEach(visit);
          token('/a');
          return;
        }
        if (el.id.startsWith('polarion_wiki macro name=') && tag !== 'table') { token('macro', el.id); return; }
        if (tag === 'img' || tag === 'hr') { token(tag); return; }
        if (tag === 'br') { text += ' '; return; }
        const structure = /^(table|tr|td|th|ol|ul|li)$/.test(tag);
        if (tag === 'td' || tag === 'th') token(tag, el.getAttribute('colspan') ?? '1', el.getAttribute('rowspan') ?? '1');
        else if (tag === 'ol') token(tag, el.getAttribute('start') ?? '1');
        else if (structure) token(tag);
        const block = /^(p|div|h[1-6])$/.test(tag);
        if (block) text += ' ';
        el.childNodes.forEach(visit);
        if (block) text += ' ';
        // The renderer can put a child list immediately after its parent LI.
        // List boundaries and each item start still encode the nesting/order.
        if (structure && tag !== 'li') token('/' + tag);
      };
      root.childNodes.forEach(visit);
      flush();
      return JSON.stringify(tokens);
    };
    const mismatch = () => Error('NATIVE_REFRESH_CONTENT_MISMATCH');
    const expected = signature(parse(input.expectedHtml));
    const expectedWords = wordKey(parse(input.expectedHtml));
    const expectedTitle = input.expectedTitle === undefined ? undefined : clean(input.expectedTitle);
    const card = parse(entries[0].g).firstElementChild;
    if (!card) throw mismatch();
    const cardTitle = card.querySelector(titleSelector);
    const expectedCardTitle = cardTitle ? expectedTitle ?? titleText(cardTitle) : undefined;
    const matchesCard = (el: Element) => {
      if (el.id !== id || el.localName !== 'div' || headingLevel(el) || el.getAttribute('name') === 'wi-placeholder') return false;
      const field = el.querySelector(titleSelector);
      return (field ? titleText(field) : undefined) === expectedCardTitle && signature(el, true, field) === expected;
    };
    // The freshly fetched card is the authoritative B. Accept it when its words
    // match B even if Polarion wrapped them differently; reject a stale card.
    // Never compare the still-old LiveDoc projection before updating.
    const cardField = card.querySelector(titleSelector);
    if (cardField && expectedCardTitle !== undefined && titleText(cardField) !== expectedCardTitle) throw mismatch();
    if (!matchesCard(card) && wordKey(card) !== expectedWords) throw mismatch();
    const heading = headingLevel(documentItem);
    const x=frame.contentWindow!.scrollX,y=frame.contentWindow!.scrollY;
    // Adopt the native server model atomically with its metadata and conflict
    // baseline. The existing iframe, body and extension editors remain mounted.
    // The old LiveDoc DOM is expected to differ; only the fresh card is checked.
    g.AXh(e,fresh);
    if (!heading) {
      g.SWh(e.i.q,{Up:(transaction:any)=>{
        const part=g.hWh(transaction,id);
        if(!part?.d?.k)throw Error('NATIVE_ITEM_NOT_LOADED');
        g.uGi(part.d,entries[0].g);
      }});
      g.wsi(new g.xsi(e,result));
    }
    // Best-effort confirmation that the visible projection now carries B.
    // A failed check is reported as degraded, never as a refused refresh.
    const installedMatches = () => {
      const rendered = body.ownerDocument.getElementById(id);
      if (!rendered) return false;
      if (heading) return headingLevel(rendered) === heading && titleText(rendered) === expectedTitle;
      const field = rendered.querySelector(titleSelector);
      const titleOk = !field || expectedCardTitle === undefined || titleText(field) === expectedCardTitle;
      return titleOk && (matchesCard(rendered) || wordKey(rendered) === expectedWords);
    };
    // GWT may finish its render on a later frame. Hidden or occluded tabs can
    // suspend rAF. Every wake-up leads to the same installed-DOM check.
    if (!document.hidden || !installedMatches()) await new Promise<void>(resolve => {
      let frameId = 0;
      const finish = () => {
        clearTimeout(timer);
        cancelAnimationFrame(frameId);
        document.removeEventListener('visibilitychange', onVisibility);
        resolve();
      };
      const onVisibility = () => { if (document.hidden && installedMatches()) finish(); };
      const timer = setTimeout(finish, 250);
      document.addEventListener('visibilitychange', onVisibility);
      frameId = requestAnimationFrame(() => { frameId = requestAnimationFrame(finish); });
    });
    check();
    const verified = installedMatches();
    frame.contentWindow!.scrollTo(x,y);
    const base = heading ? {ok: true, projection: 'heading'} : {ok: true};
    return verified ? base : {...base, degraded: true};
  }catch(error){return{ok:false,error:error instanceof Error?error.message:'NATIVE_REFRESH_FAILED'};}
  finally { stopTrackingInput?.(); }
}
