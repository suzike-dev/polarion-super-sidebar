import React, {useEffect, useRef} from 'react';
import {BookOpen, PencilLine, X} from 'lucide-react';
import type {Draft} from '../../../packages/protocol/index';
import type {SourceNode} from '../../../packages/core/lossless-html';
import {RichSurface} from './RichSurface';
import './workitem-reader.css';

export type WorkItemView = Draft & { nodes: SourceNode[]; version: string; source?: 'draft' | 'remote' };

/** 独立的完整阅读预览：只读渲染，不触碰草稿与 Polarion；需要修改时再进入编辑工作台。 */
export function WorkItemReader({ view, onClose, onOpenEditor, onWorkItem }: { view: WorkItemView; onClose: () => void; onOpenEditor: () => void; onWorkItem?: (workItemId: string) => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const root = closeButton.current?.getRootNode() as ShadowRoot | Document | undefined;
    const previous = (root && 'activeElement' in root ? root.activeElement : null) as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="reader-layer" role="dialog" aria-modal="true" aria-label={`工作项 ${view.workItemId} 阅读预览`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="reader-panel">
      <header>
        <span className="reader-icon"><BookOpen size={16}/></span>
        <div className="reader-title">
          <span className="eyebrow">阅读预览 · {view.source === 'remote' ? 'Polarion 正文' : '本地草稿'}</span>
          <h2>{view.title || view.workItemId}</h2>
          <small>{view.workItemId} · 修订 {view.revision}{view.state !== 'clean' ? ' · 含未保存修改' : ''}</small>
        </div>
        <button ref={closeButton} className="icon" aria-label="关闭阅读预览" title="关闭阅读预览（Esc）" onClick={onClose}><X size={17}/></button>
      </header>
      <div className="reader-body"><RichSurface draft={view} onSelect={() => {}} onContext={() => {}} onWorkItem={onWorkItem} title={`工作项 ${view.workItemId} 只读预览`}/></div>
      <footer>
        <span className="muted">只读预览，不修改草稿，也不会写入 Polarion。</span>
        <div><button className="secondary" onClick={onClose}>关闭</button><button className="primary" onClick={onOpenEditor}><PencilLine size={14}/>打开编辑工作台</button></div>
      </footer>
    </section>
  </div>;
}
