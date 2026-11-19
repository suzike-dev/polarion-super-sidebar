import React, {useEffect, useRef, useState} from 'react';
import {BookOpen, PencilLine, X} from 'lucide-react';
import {isHeadingType, projectDocumentUrl, projectWorkItemUrl, type DocumentOutline, type Draft} from '../../../packages/protocol/index';
import {rpc} from '../lib/client';
import {requirementsInSection} from '../lib/document-outline';
import type {SourceNode} from '../../../packages/core/lossless-html';
import {RichSurface} from './RichSurface';
import {listenWorkbenchKeydown} from '../lib/workbench-keyboard';
import {ModuleNotePanel} from './ModuleNotePanel';
import './workitem-reader.css';

export type WorkItemView = Draft & { nodes: SourceNode[]; version: string; type?: string; source?: 'draft' | 'remote'; readOnlyReference?: boolean };

function EmptyReaderBody({view, onWorkItem}: {view: WorkItemView; onWorkItem?: (id: string) => void}) {
  const [outline, setOutline] = useState<DocumentOutline | 'unavailable' | null>(null);
  // 旧草稿可能没有类型；只用当前文档的大纲补充章节信息。
  const lookup = !view.readOnlyReference && (!view.type || isHeadingType(view.type));
  useEffect(() => {
    if (!lookup) return;
    let current = true;
    void rpc<DocumentOutline>({method: 'document.outline', target: view.target})
      .then(value => { if (current) setOutline(value); })
      .catch(() => { if (current) setOutline('unavailable'); });
    return () => { current = false; };
  }, [lookup, view.target]);
  const items = outline && outline !== 'unavailable' ? outline.items : undefined;
  const section = items?.find(item => item.id === view.workItemId);
  const heading = isHeadingType(view.type || section?.type);
  const children = heading && section?.outline && items ? requirementsInSection(items, section) : undefined;
  return <section className="reader-empty">
    <h3>{heading ? `章节标题${section?.outline ? ` · ${section.outline}` : ''}` : view.state === 'clean' ? '此工作项暂无正文' : '这份草稿暂无正文'}</h3>
    {heading && <p>此章节标题暂无正文。</p>}
    {!view.readOnlyReference && <div className="reader-empty-links">
      <a href={projectWorkItemUrl(view.target, view.workItemId)} target="_blank" rel="noreferrer">在 Polarion 中查看工作项</a>
      {heading && <a href={projectDocumentUrl(view.target, view.target.document)} target="_blank" rel="noreferrer">打开所在文档</a>}
    </div>}
    {heading && lookup && (children ? children.length ? <>
      <h4>本章需求（{children.length}）</h4>
      <ul>{children.map(item => <li key={item.id}>{onWorkItem
        ? <button type="button" onClick={() => onWorkItem(item.id)}>{item.outline} · {item.id} {item.title}</button>
        : <a href={projectWorkItemUrl(view.target, item.id)} target="_blank" rel="noreferrer">{item.outline} · {item.id} {item.title}</a>}</li>)}</ul>
    </> : <p>本章暂无下级需求。</p> : <p role="status">{outline ? '当前大纲无法列出本章需求，可打开所在文档查看。' : '正在读取本章需求…'}</p>)}
  </section>;
}

export type ReaderAction = { kind: 'read' | 'edit'; workItemId: string; error?: string };

export function ReaderNotice({ action, onRetry, onDismiss }: { action: ReaderAction; onRetry: () => void; onDismiss: () => void }) {
  return <div className="reader-notice" role={action.error ? 'alert' : 'status'}>
    <span><strong>{action.workItemId}</strong> · {action.error || (action.kind === 'edit' ? '正在打开编辑工作台…' : '正在读取正文…')}</span>
    {action.error && <button className="secondary" onClick={onRetry}>重试</button>}
    <button className="icon" onClick={onDismiss} aria-label={action.error ? '关闭读取提示' : '取消打开'}><X size={15}/></button>
  </div>;
}

export function WorkItemReader({ view, notice, opening, onClose, onOpenEditor, onWorkItem }: { view: WorkItemView; notice?: React.ReactNode; opening: boolean; onClose: () => void; onOpenEditor: () => void; onWorkItem?: (workItemId: string) => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const root = closeButton.current?.getRootNode() as ShadowRoot | Document | undefined;
    const previous = (root && 'activeElement' in root ? root.activeElement : null) as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || root?.querySelector('.reader-panel [role="dialog"], .palette-layer')) return;
      event.preventDefault(); event.stopImmediatePropagation(); closeRef.current();
    };
    const removeKey = listenWorkbenchKeydown(document, onKey);
    return () => { removeKey(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
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
      {notice}
      {!view.readOnlyReference && <ModuleNotePanel key={view.workItemId} target={view.target} workItemId={view.workItemId} dense/>}
      <div className="reader-body"><RichSurface key={view.workItemId} draft={view} onSelect={() => {}} onContext={() => {}} onWorkItem={onWorkItem} onEscape={onClose} emptyState={<EmptyReaderBody view={view} onWorkItem={onWorkItem}/>} title={`工作项 ${view.workItemId} 只读预览`}/></div>
      <footer>
        <span className="muted">{view.readOnlyReference ? '这是同项目的跨文档引用，可在 Polarion 查看原工作项。' : '正文为只读预览。保存实现模块会更新此工作项的备注附件。'}</span>
        <div><button className="secondary" onClick={onClose}>关闭</button>{view.readOnlyReference
          ? <a className="secondary" href={projectWorkItemUrl(view.target, view.workItemId)} target="_blank" rel="noreferrer">在 Polarion 中打开</a>
          : <button className="primary" disabled={opening} onClick={onOpenEditor}><PencilLine size={14}/>打开编辑工作台</button>}</div>
      </footer>
    </section>
  </div>;
}
