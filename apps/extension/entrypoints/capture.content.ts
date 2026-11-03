import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
export default defineContentScript({
  matches: ['https://polarion.pufafen.com/polarion/*'], allFrames: true, matchAboutBlank: true, runAt: 'document_idle',
  main(ctx) {
    if (window.frameElement?.classList.contains('rich-surface')) return;
    const itemFor = (node: Node | null) => {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element) {
        const id = element.id.match(/module-workitem;params=id=([^;|]+)/)?.[1];
        if (id && !element.id.includes('|new=1')) return { id, element }; element = element.parentElement;
      }
      return undefined;
    };
    let timer = 0;
    ctx.addEventListener(document, 'selectionchange', () => {
      clearTimeout(timer); timer = ctx.setTimeout(() => {
        const selection = window.getSelection(); const text = selection?.toString().trim();
        if (!text || !selection?.anchorNode || selection.anchorNode.getRootNode() !== document || document.querySelector('input[type="password"]')) return;
        const item = itemFor(selection.anchorNode); const surrounding = item?.element.textContent ?? ''; const index = surrounding.indexOf(text);
        void browser.runtime.sendMessage({ type: 'selection', context: { id: crypto.randomUUID(), text: text.slice(0, 60000), workItemId: item?.id, source: 'selection', capturedAt: Date.now(), prefix: index < 0 ? '' : surrounding.slice(Math.max(0, index - 100), index), suffix: index < 0 ? '' : surrounding.slice(index + text.length, index + text.length + 100) } }).catch(() => {});
      }, 160);
    });
    let hovered = ''; let hoverTimer = 0;
    ctx.addEventListener(document, 'pointerover', event => {
      const item = itemFor(event.target as Node); if (!item || hovered === item.id) return;
      clearTimeout(hoverTimer); hovered = item.id;
      hoverTimer = ctx.setTimeout(() => { void browser.runtime.sendMessage({ type: 'hover', workItemId: item.id, text: item.element.textContent?.trim().slice(0, 700) ?? '' }).catch(() => {}); }, 400);
    });
    ctx.addEventListener(document, 'pointerout', event => { if (!itemFor(event.relatedTarget as Node)) { hovered = ''; clearTimeout(hoverTimer); } });
  },
});
