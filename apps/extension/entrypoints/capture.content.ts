import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
export default defineContentScript({
  matches: ['https://polarion.pufafen.com/polarion/*'], allFrames: true, matchAboutBlank: true, runAt: 'document_start',
  main(ctx) {
    if (window.frameElement?.classList.contains('rich-surface')) return;
    // 同时识别工作项正文块与正文里的内联工作项引用（data-item-id / workitem 链接）。
    const itemFor = (node: Node | null) => {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element) {
        const fromBody = element.id.match(/module-workitem;params=id=([^;|]+)/)?.[1];
        const fromData = element.getAttribute('data-item-id')?.trim();
        const fromHref = element.getAttribute('href')?.match(/[?&#]id=([A-Z][A-Z0-9_]{1,23}-\d{1,7})/i)?.[1];
        const id = fromBody || fromData || fromHref;
        if (id && !element.id.includes('|new=1')) return { id, element };
        element = element.parentElement;
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
    // 只把“引用”本身当引用：链接、data-type=workItem 或带 data-item-id 的链接；工作项正文块不当引用。
    const referenceFor = (node: Node | null) => {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element) {
        const dataId = element.getAttribute('data-item-id')?.trim();
        const hrefId = element.getAttribute('href')?.match(/[?&#]id=([A-Z][A-Z0-9_]{1,23}-\d{1,7})/i)?.[1];
        const linkLike = element.matches?.('a[href], .polarion-rte-link, [data-type="workItem"], [data-type="workitem"]');
        if ((dataId || hrefId) && linkLike) return { id: dataId || hrefId!, element };
        if (element.id?.includes('module-workitem;params=id=')) return undefined;
        element = element.parentElement;
      }
      return undefined;
    };
    // 单击被引用的编号即打开完整阅读预览：按下时触发，不依赖松开后的 click；正文块空白处不拦截。
    const openReference = (reference: { id: string }) => {
      void browser.runtime.sendMessage({ type: 'open-workitem', workItemId: reference.id }).catch(() => {});
      try { window.top?.postMessage({ __polarionSidebar: 'open-workitem', workItemId: reference.id }, location.origin); } catch {}
    };
    const handlePress = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const reference = referenceFor(event.target as Node); if (!reference) return;
      // Polarion 自己会在按下/松开时跳转工作项页；必须拦住同一事件上更早注册的监听器。
      event.preventDefault(); event.stopImmediatePropagation(); openReference(reference);
    };
    const blockPress = (event: MouseEvent) => {
      const reference = referenceFor(event.target as Node); if (!reference) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const handleClick = (event: MouseEvent) => {
      const reference = referenceFor(event.target as Node); if (!reference) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    ctx.addEventListener(window, 'pointerdown', handlePress, { capture: true });
    ctx.addEventListener(window, 'mousedown', blockPress, { capture: true });
    ctx.addEventListener(window, 'mouseup', blockPress, { capture: true });
    ctx.addEventListener(window, 'click', handleClick, { capture: true });

    // 悬停只针对正文里的“整个工作项”块：引用编号不弹小卡，点击直接进入完整预览。
    const blockFor = (node: Node | null) => {
      let element = node instanceof Element ? node : node?.parentElement;
      while (element) {
        const id = element.id.match(/module-workitem;params=id=([^;|]+)/)?.[1];
        if (id && !element.id.includes('|new=1')) return { id, element };
        element = element.parentElement;
      }
      return undefined;
    };
    // 悬停：右下角小卡片展示工作项摘要；不拦截任何点击。
    let hovered = ''; let hoverTimer = 0;
    const handleHover = (event: PointerEvent) => {
      const item = blockFor(event.target as Node); if (!item || hovered === item.id) return;
      clearTimeout(hoverTimer); hovered = item.id;
      hoverTimer = ctx.setTimeout(() => {
        const rect = item.element.getBoundingClientRect();
        void browser.runtime.sendMessage({ type: 'preview', workItemId: item.id, text: item.element.textContent?.trim().slice(0, 700) ?? '', rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }).catch(() => {});
      }, 350);
    };
    ctx.addEventListener(window, 'pointerover', handleHover, { capture: true });
  },
});
