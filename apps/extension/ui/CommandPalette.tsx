import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import type { Target } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './cockpit.css';

export type PaletteCommand = { id: string; label: string; hint?: string; run: () => void };
type Hit = { workItemId: string; title: string };
type PaletteRow = { key: string; kind: 'command' | 'item'; label: string; detail?: string; run: () => void };

export function CommandPalette({ commands, target, onClose, onOpenItem }: {
  commands: PaletteCommand[]; target: Target | null; onClose: () => void; onOpenItem: (workItemId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [composing, setComposing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reply, setReply] = useState<{ key: string; hits: Hit[]; error?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const option = useRef<HTMLButtonElement>(null);
  const revealSelection = useRef(true);
  const listId = useId();
  const needle = query.trim();
  const terms = needle.toLowerCase().replace(/^\/+/, '').split(/\s+/).filter(Boolean);
  const origin = target?.origin, projectId = target?.projectId, documentPath = target?.document;
  const searchKey = target && !composing && needle.length >= 2 && !needle.startsWith('/') ? JSON.stringify([origin, projectId, documentPath, needle]) : '';
  const currentReply = reply?.key === searchKey ? reply : null;
  const pending = !!searchKey && !currentReply;

  useLayoutEffect(() => {
    const field = input.current!;
    const root = field.getRootNode() as ShadowRoot | Document;
    const previous = root.activeElement ?? field.ownerDocument.activeElement;
    const dialog = field.closest('[role="dialog"]');
    field.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && (!root.activeElement || dialog?.contains(root.activeElement))) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!searchKey || !origin || !projectId || !documentPath) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void rpc<Hit[] | { items?: Hit[] }>({ method: 'workitems.search', target: { origin, projectId, document: documentPath }, query: needle, limit: 5 })
        .then(result => { if (!disposed) setReply({ key: searchKey, hits: Array.isArray(result) ? result : result?.items ?? [] }); })
        .catch(cause => { if (!disposed) setReply({ key: searchKey, hits: [], error: (cause instanceof Error ? cause.message : String(cause)) || '未能读取工作项。' }); });
    }, 250);
    return () => { disposed = true; clearTimeout(timer); };
  }, [searchKey, origin, projectId, documentPath, needle, attempt]);

  const rows: PaletteRow[] = [];
  for (const command of commands) {
    const text = `${command.label} ${command.id} ${command.hint ?? ''}`.toLowerCase();
    if (terms.every(term => text.includes(term))) rows.push({ key: 'command/' + command.id, kind: 'command', label: command.label, detail: command.hint, run: command.run });
  }
  for (const hit of currentReply?.hits ?? []) rows.push({ key: `${searchKey}/${hit.workItemId}`, kind: 'item', label: hit.workItemId, detail: hit.title || '打开工作项', run: () => onOpenItem(hit.workItemId) });
  const current = Math.max(0, rows.findIndex(row => row.key === selection));
  const selected = rows[current];
  function scrollToOption() {
    if (!option.current || !list.current) return;
    // Scroll only the result list, including when one long title fills its viewport.
    const bounds = list.current.getBoundingClientRect();
    const item = option.current.getBoundingClientRect();
    if (item.top < bounds.top || item.height > bounds.height) list.current.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) list.current.scrollTop += item.bottom - bounds.bottom;
  }
  useLayoutEffect(() => { if (revealSelection.current) scrollToOption(); }, [selected?.key, current, needle]);

  function activate(row: PaletteRow) { onClose(); row.run(); }
  function handleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key === 'Tab') {
      const stops = event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled):not([tabindex="-1"])');
      const first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (event.target !== input.current || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (selected && !event.repeat) activate(selected);
      return;
    }
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = Math.min(current + 1, rows.length - 1); break;
      case 'ArrowUp': next = Math.max(current - 1, 0); break;
      case 'Home': next = 0; break;
      case 'End': next = rows.length - 1; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); revealSelection.current = true;
    if (next === current) scrollToOption();
    if (rows[next]) setSelection(rows[next]!.key);
  }
  return <div className="palette-layer" role="dialog" aria-modal="true" aria-label="全局命令面板" onKeyDown={handleKey} onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <div className="palette">
      <div className="palette-input"><Search size={17} aria-hidden="true"/>
        <input ref={input} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={selected ? `${listId}-${current}` : undefined} autoComplete="off" spellCheck={false} maxLength={120} value={query} placeholder="搜索命令或工作项…" aria-label="搜索命令或工作项"
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => {
            const value = event.target.value;
            if (value.trim() !== needle) { revealSelection.current = true; setSelection(''); setReply(null); }
            setQuery(value);
          }}/>
        <button type="button" className="palette-close" title="关闭命令面板" aria-label="关闭命令面板" onClick={onClose}>Esc</button>
      </div>
      <div ref={list} className="palette-rows" id={listId} role="listbox" aria-label="命令与工作项结果" aria-busy={pending}>
        {rows.map((row, index) => <React.Fragment key={row.key}>
          {row.kind !== rows[index - 1]?.kind && <div className="palette-group" aria-hidden="true">{row.kind === 'command' ? '命令' : '工作项'}</div>}
          <button ref={index === current ? option : undefined} type="button" id={`${listId}-${index}`} role="option" tabIndex={-1} aria-selected={index === current} data-kind={row.kind} className={index === current ? 'selected' : ''}
            onPointerMove={event => { if (event.pointerType !== 'touch') { revealSelection.current = false; setSelection(row.key); } }} onMouseDown={event => event.preventDefault()} onClick={() => activate(row)}>
            <span className="palette-copy"><b>{row.label}</b>{row.detail && <small>{row.detail}</small>}</span>
            {index === current && <CornerDownLeft size={14} aria-hidden="true"/>}
          </button>
        </React.Fragment>)}
      </div>
      {pending && <p className="palette-status" role="status">正在搜索工作项…</p>}
      {currentReply?.error && <div className="palette-status palette-error" role="status"><span>工作项搜索失败。{currentReply.error}</span><button type="button" onClick={() => { setReply(null); setAttempt(n => n + 1); input.current?.focus(); }}>重试</button></div>}
      {!rows.length && !pending && !currentReply?.error && <p className="palette-status" role="status">{target && !needle.startsWith('/') && needle.length < 2 ? '没有匹配的命令。输入至少 2 个字符可搜索工作项。' : `没有匹配的命令${searchKey ? '或工作项' : ''}。`}</p>}
      <div className="palette-foot"><span>↑↓ 选择</span><span>Enter 执行</span>{target && <span>输入至少 2 个字符搜工作项</span>}<span>Ctrl+Shift+P 开关</span></div>
    </div>
  </div>;
}
