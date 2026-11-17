import {canonicalStyle} from '../../../packages/core/html-equivalence.ts';
/** Only touch the two observed split-pane styles, and restore exactly what was there. */
export class Layout {
  private restore?: () => void;
  private restoreContent?: () => void;
  private current?: { content: HTMLElement; sidebar: HTMLElement | null; width: number; overlay: boolean };
  apply(open: boolean, width: number) {
    if (!open) { this.reset(); return { top: 46, overlay: false }; }
    const split = document.querySelector<HTMLElement>('.polarion-dle-SplitPanel');
    const frame = split?.querySelector<HTMLIFrameElement>('#gwt-debug-polarion-DLE-area-debug-id');
    if (!split || !frame) { this.reset(); return { top: 0, overlay: true }; }
    let content: HTMLElement = frame;
    while (content.parentElement && content.parentElement !== split) content = content.parentElement;
    const native = split.querySelector<HTMLElement>('.polarion-dle-SidebarContainer');
    let sidebar: HTMLElement | null = native ?? null;
    while (sidebar?.parentElement && sidebar.parentElement !== split) sidebar = sidebar.parentElement;
    const bounds = split.getBoundingClientRect(); const overlay = bounds.width - width < 720;
    const prior=this.current;
    if(prior?.content===content&&prior.sidebar===sidebar&&prior.width===width&&prior.overlay===overlay&&
      (overlay||content.style.getPropertyValue('right')===width+'px')&&(!sidebar||sidebar.style.visibility==='hidden'))
      return {top:Math.max(0,bounds.top),overlay};
    if(prior?.content!==content||prior.sidebar!==sidebar){
      this.reset();
      const oldContent=content.getAttribute('style'),oldSidebar=sidebar?.getAttribute('style');
      const restoreContent=()=>{oldContent===null?content.removeAttribute('style'):content.setAttribute('style',oldContent);};
      this.restoreContent=restoreContent;
      this.restore=()=>{restoreContent();if(sidebar)oldSidebar==null?sidebar.removeAttribute('style'):sidebar.setAttribute('style',oldSidebar);};
    }else if(overlay&&!prior.overlay)this.restoreContent?.();
    this.current={content,sidebar,width,overlay};
    if(!overlay&&content.style.getPropertyValue('right')!==width+'px')content.style.setProperty('right',width+'px','important');
    if(sidebar&&sidebar.style.visibility!=='hidden')sidebar.style.setProperty('visibility','hidden','important');
    return { top: Math.max(0, bounds.top), overlay };
  }
  reset() { this.restore?.(); this.restore = undefined; this.restoreContent=undefined; this.current=undefined; }
}
export function documentFrame() { return document.querySelector<HTMLIFrameElement>('#gwt-debug-polarion-DLE-area-debug-id'); }
export function outline() {
  try { return Array.from(documentFrame()?.contentDocument?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? []).map((n,index)=>({index,text:n.innerText.trim().slice(0,160),level:Number(n.tagName[1])})).filter(h=>h.text); } catch { return []; }
}
/** 大纲跳转：Polarion 在滚动后会把沿途懒加载占位替换成真实工作项，上方高度变化会把目标挤出视口
 *  （表现为“点一下只滚到附近，再点一下才居中”）。跳转后在短时间内持续校正，直到目标稳定停在中央。 */
let navigationEpoch = 0;
export function navigateHeading(index: number, text?: string) {
  const doc = documentFrame()?.contentDocument;
  if (!doc) return;
  const epoch = ++navigationEpoch;
  // 懒加载顶替后标题节点序号可能漂移：优先按标题文本定位，重复标题取离原序号最近的一个。
  const locate = () => {
    const list = Array.from(doc.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
    const wanted = text?.trim();
    let best = -1, bestDistance = Number.MAX_SAFE_INTEGER;
    if (wanted) for (const [position, heading] of list.entries()) {
      if (heading.innerText.trim().slice(0, 160) !== wanted) continue;
      const distance = Math.abs(position - index);
      if (distance < bestDistance) { best = position; bestDistance = distance; }
    }
    return best >= 0 ? list[best]! : list[index];
  };
  const offsetOf = (el: HTMLElement) => { const rect = el.getBoundingClientRect(); return rect.top + rect.height / 2 - (doc.defaultView?.innerHeight ?? 0) / 2; };
  locate()?.scrollIntoView({ block: 'center' });
  // 用户一旦自己滚动/点击正文，立即停止自动校正，避免和用户抢滚动条。
  const cancel = () => { if (epoch === navigationEpoch) navigationEpoch++; };
  const view = doc.defaultView;
  view?.addEventListener('wheel', cancel, { once: true, passive: true });
  view?.addEventListener('touchstart', cancel, { once: true, passive: true });
  view?.addEventListener('pointerdown', cancel, { once: true, passive: true });
  let settled = 0, attempts = 0;
  const correct = () => {
    if (epoch !== navigationEpoch) return; // 已跳转别处，放弃旧目标的校正
    try {
      const el = locate();
      if (!el) return;
      const offset = offsetOf(el);
      if (Math.abs(offset) > 12) { settled = 0; el.scrollIntoView({ block: 'center' }); }
      else settled++;
      // 懒加载顶替通常发生在跳转后 1~2 秒，太早停止会错过重排；至少观察到 ~2.2s 且连续居中才收工。
      if (++attempts >= 16) return;
      if (settled >= 2 && attempts >= 10) return;
      setTimeout(correct, 220);
    } catch { /* 页面已翻篇（如跳转/关闭）时静默停止 */ }
  };
  setTimeout(correct, 220);
}
export function contentFingerprint(body: HTMLElement) {
  const copy = body.cloneNode(true) as HTMLElement;
  // These exact elements are observed Polarion decorations, not requirement content.
  copy.querySelectorAll('.polarion-dle-workitem-icon-container-decorations,.polarion-dle-workitem-icon-container').forEach(n => n.remove());
  copy.querySelectorAll('[last_known_index]').forEach(n => n.removeAttribute('last_known_index'));
  copy.querySelectorAll<HTMLElement>('[id^="polarion_wiki macro name=module-workitem;"]').forEach(n => {
    const classes = [...n.classList].filter(c => !c.startsWith('polarion-dle-workitem-'));
    classes.length ? n.setAttribute('class', classes.join(' ')) : n.removeAttribute('class');
    for (const property of ['border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'background-color']) n.style.removeProperty(property);
    // Polarion appends one caret spacer immediately before its end-field container on focus.
    // Actual user input is tracked separately; only this observed boundary marker is ignored.
    const end = n.querySelector('[id="polarion_editor_fields_container_end"]');
    const previous = end?.previousSibling;
    if (previous?.nodeType === 3 && previous.textContent?.endsWith('\u200b')) previous.textContent = previous.textContent.slice(0, -1);
    if (!n.getAttribute('style')) n.removeAttribute('style');
  });
  // Image hover helpers and the browser rewrite attribute order / style spacing.
  // Those serialization changes are not native edits. Preserve all actual values.
  copy.querySelectorAll('*').forEach(n=>{
    if(n.getAttribute('class')==='')n.removeAttribute('class');
    if(n.hasAttribute('style'))n.setAttribute('style',canonicalStyle(n.getAttribute('style')!));
    const attributes=[...n.attributes].map(a=>[a.name,a.value] as const).sort(([a],[b])=>a.localeCompare(b));
    [...n.attributes].forEach(a=>n.removeAttribute(a.name));attributes.forEach(([name,value])=>n.setAttribute(name,value));
  });
  return copy.innerHTML;
}
/** Accept only an observed lazy placeholder becoming the same rendered work item.
 * Everything else (including already loaded items and interstitial prose) must match.
 * Called only with no native input and an explicitly disabled native Save button.
 */
function matchesLazyLoad(baseline: string, current: string, doc: Document) {
  const before = doc.createElement('template'), after = doc.createElement('template');
  before.innerHTML = baseline; after.innerHTML = current;
  const rendered = new Map([...after.content.querySelectorAll<HTMLElement>('[id^="polarion_wiki macro name=module-workitem;"]')].map(n => [n.id, n]));
  let loaded = false;
  for (const placeholder of before.content.querySelectorAll<HTMLElement>('[name="wi-placeholder"][contenteditable="false"]')) {
    if (!placeholder.id.startsWith('polarion_wiki macro name=module-workitem;')) continue;
    const item = rendered.get(placeholder.id);
    if (!item || item.hasAttribute('name') || item.getAttribute('contenteditable') === 'false' ||
      !item.querySelector('[id="polarion_editor_fields_container_start"]') ||
      !item.querySelector('[id="polarion_editor_fields_container_end"]')) continue;
    placeholder.replaceWith(item.cloneNode(true)); loaded = true;
  }
  return loaded && before.innerHTML === after.innerHTML;
}
export class NativeState {
  private doc?: Document; private baseline?: string; private edited = false;
  private inputEpoch=0;
  private observer?: MutationObserver; private settleTimer?: ReturnType<typeof setTimeout>;
  private onInput = () => { this.edited = true;this.inputEpoch++; };
  bind() {
    const next = documentFrame()?.contentDocument; if (!next) return;
    if (this.doc !== next) {
      this.teardown();
      this.doc = next; this.edited = false; this.baseline = undefined;
      next.addEventListener('input', this.onInput, true);
      // 基线只在 DOM 静止 1s 后建立一次（等价旧轮询的“两次采样相同”），建立后不再更新：
      // 后续懒加载等演进仍由 state() 的 matchesLazyLoad 兜底，语义与轮询版完全一致。
      // 去掉每 2s 的全文档克隆轮询——大文档上那是用户可感知的周期性卡顿来源。
      this.observer = new MutationObserver(() => { if (this.baseline !== undefined || this.edited) return; this.scheduleBaseline(); });
      if (next.body) this.observer.observe(next.body, { childList: true, subtree: true, characterData: true, attributes: true });
      this.scheduleBaseline();
    }
  }
  private scheduleBaseline() {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      const doc = this.doc;
      if (this.edited || !doc?.body?.querySelector('[id*="module-workitem"]')) return;
      this.baseline = contentFingerprint(doc.body);
      this.observer?.disconnect();
    }, 1000);
  }
  private teardown() {
    clearTimeout(this.settleTimer);
    this.observer?.disconnect(); this.observer = undefined;
    this.doc?.removeEventListener('input', this.onInput, true);
  }
  state(): 'clean' | 'dirty' | 'unknown' {
    this.bind();
    if (this.edited) return 'dirty';
    if (!this.doc || !this.baseline) return 'unknown';
    // A DOM baseline is supplementary; the server is always reread independently.
    const save = document.querySelector('#gwt-debug-toolbar-save[title="保存"]');
    const saveDisabled = !!save && (/disabled/i.test(save.className) || save.getAttribute('aria-disabled') === 'true');
    if (save && !saveDisabled) return 'unknown';
    const current = contentFingerprint(this.doc.body);
    if (current === this.baseline) return 'clean';
    if (saveDisabled && matchesLazyLoad(this.baseline, current, this.doc)) {
      this.baseline = current;
      return 'clean';
    }
    return 'unknown';
  }
  acceptDocumentRefresh(){
    if(this.edited||!this.doc||!this.baseline)throw Error('NATIVE_EDITOR_DIRTY');
    if(documentFrame()?.contentDocument!==this.doc)throw Error('NATIVE_DOCUMENT_CHANGED');
    const save=document.getElementById('gwt-debug-toolbar-save');if(!save?.className.includes('Button-disabled'))throw Error('NATIVE_EDITOR_UNKNOWN');
    // Called only after the MAIN-world adapter has adopted and verified the
    // authoritative native model, with native input blocked for the save.
    this.baseline=contentFingerprint(this.doc.body);
  }
  captureVerification(){
    this.bind();
    return {doc:this.doc,epoch:this.inputEpoch,html:this.doc?.body?contentFingerprint(this.doc.body):undefined};
  }
  acceptVerifiedClean(snapshot:ReturnType<NativeState['captureVerification']>){
    // Only called after the pinned MAIN-world adapter confirms the native model
    // is clean. A native Save can finish without replacing the iframe; adopt its
    // new baseline, but never swallow input or DOM changes made during the check.
    if(!snapshot.doc||documentFrame()?.contentDocument!==snapshot.doc||this.doc!==snapshot.doc)throw Error('NATIVE_DOCUMENT_CHANGED');
    if(this.inputEpoch!==snapshot.epoch||contentFingerprint(snapshot.doc.body)!==snapshot.html)throw Error('NATIVE_EDITOR_DIRTY');
    const save=document.getElementById('gwt-debug-toolbar-save');if(!save?.className.includes('Button-disabled'))throw Error('NATIVE_EDITOR_UNKNOWN');
    this.baseline=snapshot.html;this.edited=false;
  }
  close() { this.teardown(); this.doc = undefined; }
}
