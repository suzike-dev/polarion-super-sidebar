import React from 'react';
import { createRoot } from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { App } from '../ui/App';
import '../ui/styles.css';
import '../ui/markdown.css';
import '../ui/rich-surface.css';
import '../ui/rich-editor.css';
import '../ui/format-properties.css';
import '../ui/capabilities.css';
import '../ui/attachments.css';
import '../ui/assistant-content.css';
import '../ui/compact-workspace.css';
import '../ui/editor-toolbar.css';
export default defineContentScript({
  matches: ['https://polarion.pufafen.com/polarion/*'], allFrames: false,
  cssInjectionMode: 'ui', runAt: 'document_idle',
  async main(ctx) {
    if (window !== window.top) return;
    const ui = await createShadowRootUi(ctx, {
      name: 'polarion-super-sidebar', position: 'inline', anchor: 'body', isolateEvents: true,
      onMount(container) { const root = createRoot(container); root.render(<App />); return root; },
      onRemove(root) { root?.unmount(); },
    });
    ui.mount(); ctx.onInvalidated(() => ui.remove());
  },
});
