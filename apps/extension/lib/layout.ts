import {canonicalStyle} from '../../../packages/core/html-equivalence.ts';
/** Only touch the two observed split-pane styles, and restore exactly what was there. */
export class Layout {
  private restore?: () => void;
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
    this.reset();this.current={content,sidebar,width,overlay};
    const oldContent = content.getAttribute('style'); const oldSidebar = sidebar?.getAttribute('style');
    if (!overlay) content.style.setProperty('right', width + 'px', 'important');
    if (sidebar) sidebar.style.setProperty('visibility', 'hidden', 'important');
    this.restore = () => { oldContent === null ? content.removeAttribute('style') : content.setAttribute('style', oldContent); if (sidebar) oldSidebar == null ? sidebar.removeAttribute('style') : sidebar.setAttribute('style', oldSidebar); };
    return { top: Math.max(0, bounds.top), overlay };
  }
  reset() { this.restore?.(); this.restore = undefined; this.current=undefined; }
}
export function documentFrame() { return document.querySelector<HTMLIFrameElement>('#gwt-debug-polarion-DLE-area-debug-id'); }
export function outline() {
  try { return Array.from(documentFrame()?.contentDocument?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6') ?? []).filter(n => n.innerText.trim()).map((n, index) => ({ index, text: n.innerText.trim().slice(0, 160), level: Number(n.tagName[1]) })); } catch { return []; }
}
export function navigateHeading(index: number) { try { documentFrame()?.contentDocument?.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} }
export function contentFingerprint(body: HTMLElement) {
  const copy = body.cloneNode(true) as HTMLElement;
  // These exact elements are observed Polarion decorations, not requirement content.
  copy.querySelectorAll('.polarion-dle-workitem-icon-container-decorations').forEach(n => n.remove());
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
export class NativeState {
  private doc?: Document; private baseline?: string; private candidate?: string; private edited = false;
  private onInput = () => { this.edited = true; };
  bind() {
    const next = documentFrame()?.contentDocument; if (!next) return;
    if (this.doc !== next) {
      this.doc?.removeEventListener('input', this.onInput, true); this.doc = next; this.edited = false;
      this.baseline = undefined; this.candidate = undefined; next.addEventListener('input', this.onInput, true);
    }
    if (!this.baseline && !this.edited && next.body?.querySelector('[id*="module-workitem"]')) {
      const current = contentFingerprint(next.body);
      if (this.candidate === current) this.baseline = current;
      else this.candidate = current;
    }
  }
  state(): 'clean' | 'dirty' | 'unknown' {
    this.bind(); if (!this.doc || !this.baseline) return 'unknown';
    if (this.edited) return 'dirty';
    // A DOM baseline is supplementary; the server is always reread independently.
    const save = document.querySelector('[title="保存"]');
    if (save && !/disabled/i.test(save.className) && save.getAttribute('aria-disabled') !== 'true') return 'unknown';
    return contentFingerprint(this.doc.body) === this.baseline ? 'clean' : 'unknown';
  }
  close() { this.doc?.removeEventListener('input', this.onInput, true); }
}
