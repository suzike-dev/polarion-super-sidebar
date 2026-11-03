import React, { useMemo, useRef, useEffect } from 'react';
import type { Draft } from '../../../packages/protocol/index';
import type { SourceNode } from '../../../packages/core/lossless-html';
import { richPreview } from '../lib/rich-preview';
import {imageResolver} from '../lib/editor-images';
export function RichSurface({ draft, onSelect, onContext,title='工作项富文本正文',onReady }: { draft: Draft & { nodes: SourceNode[] }; onSelect: (node: SourceNode) => void; onContext: (text: string) => void;title?:string;onReady?:(doc:Document)=>void }) {
  const frame = useRef<HTMLIFrameElement>(null); const cleanup = useRef<() => void>(() => {});
  const html = useMemo(() => richPreview(draft.html, draft.nodes, draft.target), [draft.html, draft.revision]);
  useEffect(() => () => cleanup.current(), []);
  return <iframe className="rich-surface" title={title} sandbox="allow-same-origin" ref={frame} srcDoc={html} onLoad={() => {
    cleanup.current(); const d = frame.current?.contentDocument; if (!d) return;const resolver=imageResolver(draft);
    for (const image of Array.from(d.images)) {
      const unavailable = () => { const label = d.createElement('span'); label.setAttribute('data-protected', 'true'); label.textContent = '图片暂不可预览 · 原始引用保留'; image.replaceWith(label); };
      const source=image.getAttribute('data-image-source');if(source){image.addEventListener('error',unavailable,{once:true});void resolver.resolve(source).then(url=>{if(image.isConnected)image.src=url;}).catch(unavailable);}else if (image.complete && image.naturalWidth === 0) unavailable(); else image.addEventListener('error', unavailable, { once: true });
    }
    const clicked = (event: MouseEvent) => {
      const element = event.target as Element; if (element.closest('a')) event.preventDefault();
      const leaf = element.closest('[data-source-node]'); const node = draft.nodes.find(n => n.id === leaf?.getAttribute('data-source-node'));
      if (node) { onSelect(node); const selected = d.getSelection()?.toString().trim(); onContext(selected || node.text || ''); }
    };
    d.addEventListener('click', clicked);onReady?.(d); cleanup.current = () => {d.removeEventListener('click', clicked);resolver.dispose();};
  }}/>;
}
