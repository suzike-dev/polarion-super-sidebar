import React, { useMemo, useRef, useEffect, useState } from 'react';
import type { Draft } from '../../../packages/protocol/index';
import type { SourceNode } from '../../../packages/core/lossless-html';
import { richPreviewDocument } from '../lib/rich-preview';
import { listenWorkbenchKeydown } from '../lib/workbench-keyboard';
import {imageResolver} from '../lib/editor-images';
import { X } from 'lucide-react';
import {detectBoardCode,type BoardCode} from '../lib/board-code';
import {BoardDialog} from './BoardDialog';
/** 预览图片灯箱：点击放大查看，Esc/点击遮罩关闭；只在预览层生效，不影响编辑与保存。 */
function Lightbox({image,onClose}:{image:{src:string;alt:string}|null;onClose:()=>void}){
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!image) return;
    const root = close.current?.getRootNode() as ShadowRoot | undefined;
    const previous = root?.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); } };
    const removeKey = listenWorkbenchKeydown(window, key);
    return () => { removeKey(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [image]);
  if(!image)return null;
  return <div className="preview-lightbox" role="dialog" aria-label="图片放大预览" onClick={onClose}><button ref={close} className="icon" title="关闭放大预览" onClick={onClose}><X size={18}/></button><img src={image.src} alt={image.alt} onClick={event=>event.stopPropagation()}/></div>;
}
export function RichSurface({ draft, onSelect, onContext,title='工作项富文本正文',onReady,onWorkItem,onBoardCode,onEscape,emptyState }: { emptyState?: React.ReactNode; onEscape?: () => void; draft: Draft & { nodes: SourceNode[] }; onSelect: (node: SourceNode) => void; onContext: (text: string) => void;title?:string;onBoardCode?:(code:BoardCode)=>void;onReady?:(doc:Document)=>void;onWorkItem?:(workItemId:string)=>void }) {
  const frame = useRef<HTMLIFrameElement>(null); const cleanup = useRef<() => void>(() => {});
  const [codePreview,setCodePreview]=useState<BoardCode|null>(null);
  const boardCallback=useRef(onBoardCode);boardCallback.current=onBoardCode;
  const [lightbox,setLightbox]=useState<{src:string;alt:string}|null>(null);
  const {html, hasContent} = useMemo(() => richPreviewDocument(draft.html, draft.nodes, draft.target), [draft.html, draft.nodes, draft.target]);
  const showEmpty = !hasContent && emptyState !== undefined;
  useEffect(() => { if (showEmpty) cleanup.current(); }, [showEmpty]);
  useEffect(() => () => cleanup.current(), []);
  if (showEmpty) return <>{emptyState}</>;
  return <>
    <iframe className="rich-surface" title={title} sandbox="allow-same-origin" ref={frame} srcDoc={html} onLoad={() => {
    cleanup.current(); const d = frame.current?.contentDocument; if (!d) return;const resolver=imageResolver(draft);
    for (const image of Array.from(d.images)) {
      const unavailable = () => { const label = d.createElement('span'); label.setAttribute('data-protected', 'true'); label.textContent = '图片暂不可预览 · 原始引用保留'; image.replaceWith(label); };
      const source=image.getAttribute('data-image-source');if(source){image.addEventListener('error',unavailable,{once:true});void resolver.resolve(source).then(url=>{if(image.isConnected)image.src=url;}).catch(unavailable);}else if (image.complete && image.naturalWidth === 0) unavailable(); else image.addEventListener('error', unavailable, { once: true });
    }
    const clicked = (event: MouseEvent) => {
      const element = event.target as Element; if (element.closest('a')) event.preventDefault();
      const button=element.closest('button[data-open-board]');
      if(button){
        const code=button.previousElementSibling?.querySelector('code');
        const source=code&&detectBoardCode(code.className.replace(/^language-/,''),code.textContent??'');
        if(source)(boardCallback.current??setCodePreview)(source);
        return;
      }
      const image = element.closest('img'); if (image) {
        const source=image.getAttribute('data-image-source');
        if (source) void resolver.resolve(source).then(url=>setLightbox({src:url,alt:image.getAttribute('alt')??''})).catch(()=>{});
        else if (image.src) setLightbox({src:image.src,alt:image.getAttribute('alt')??''});
        return;
      }
      const reference = element.closest('[data-workitem-ref]'); const referenceId = reference?.getAttribute('data-workitem-ref');
      if (referenceId) { event.preventDefault(); onWorkItem?.(referenceId); return; }
      const leaf = element.closest('[data-source-node]'); const node = draft.nodes.find(n => n.id === leaf?.getAttribute('data-source-node'));
      if (node) { onSelect(node); const selected = d.getSelection()?.toString().trim(); onContext(selected || node.text || ''); }
    };
    const keydown = (event: KeyboardEvent) => {
      if (onEscape && event.key === 'Escape' && !event.isComposing) { event.preventDefault(); onEscape(); }
    };
    d.addEventListener('click', clicked); d.addEventListener('keydown', keydown); onReady?.(d);
    cleanup.current = () => { d.removeEventListener('click', clicked); d.removeEventListener('keydown', keydown); resolver.dispose(); };
  }}/>
  {codePreview&&<BoardDialog code={codePreview} onClose={()=>setCodePreview(null)}/>}
  <Lightbox image={lightbox} onClose={()=>setLightbox(null)}/>
  </>;
}
