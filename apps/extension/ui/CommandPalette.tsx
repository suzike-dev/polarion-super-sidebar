import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import type { Target } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import './cockpit.css';

export type PaletteCommand = { id: string; label: string; hint?: string; run: () => void };

/** Ctrl+K 全局命令面板：一切皆可寻址——命令 + 工作项快速打开（workitems.search）。 */
export function CommandPalette({ commands, target, onClose, onOpenItem }: { commands: PaletteCommand[]; target: Target | null; onClose: () => void; onOpenItem: (workItemId: string) => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [searchHits, setSearchHits] = useState<{ workItemId: string; title: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    setIndex(0);
    const needle = query.trim();
    if (!target || needle.length < 2 || /^[/]/.test(needle)) { setSearchHits([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void rpc<{ items: { workItemId: string; title: string }[] }>({ method: 'workitems.search', target, query: needle, limit: 5 })
        .then(result => { if (!cancelled) setSearchHits(result.items ?? []); })
        .catch(() => { if (!cancelled) setSearchHits([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, target]);
  const needle = query.trim().toLowerCase();
  const matched = useMemo(() => commands.filter(command => !needle || command.label.toLowerCase().includes(needle) || command.hint?.toLowerCase().includes(needle)), [commands, needle]);
  const rows = useMemo(() => [
    ...matched.map(command => ({ kind: 'command' as const, command })),
    ...searchHits.map(hit => ({ kind: 'item' as const, hit })),
  ], [matched, searchHits]);
  useEffect(() => { setIndex(current => Math.min(current, Math.max(0, rows.length - 1))); }, [rows.length]);
  const activate = (row: typeof rows[number]) => {
    if (row.kind === 'command') { onClose(); row.command.run(); }
    else { onClose(); onOpenItem(row.hit.workItemId); }
  };
  return <div className="palette-layer" role="dialog" aria-label="全局命令面板" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="palette">
      <div className="palette-input">
        <Search size={14}/>
        <input ref={input} value={query} placeholder="命令或工作项编号…" aria-label="搜索命令或工作项" onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(value + 1, rows.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(value - 1, 0)); }
          if (event.key === 'Enter' && rows[index]) { event.preventDefault(); activate(rows[index]); }
        }}/>
        <span>ESC</span>
      </div>
      <div className="palette-rows" role="listbox">
        {rows.map((row, rowIndex) => row.kind === 'command'
          ? <button key={'c:' + row.command.id} role="option" aria-selected={rowIndex === index} className={rowIndex === index ? 'selected' : ''} onMouseEnter={() => setIndex(rowIndex)} onClick={() => activate(row)}>
              <b>{row.command.label}</b>{row.command.hint && <small>{row.command.hint}</small>}
              {rowIndex === index && <CornerDownLeft size={12}/>}
            </button>
          : <button key={'i:' + row.hit.workItemId} role="option" aria-selected={rowIndex === index} className={rowIndex === index ? 'selected' : ''} onMouseEnter={() => setIndex(rowIndex)} onClick={() => activate(row)}>
              <b>{row.hit.workItemId}</b><small>{row.hit.title || '打开工作项'}</small>
              {rowIndex === index && <CornerDownLeft size={12}/>}
            </button>)}
        {!rows.length && <p className="palette-empty">没有匹配的命令{target ? '或工作项' : ''}。</p>}
      </div>
      <div className="palette-foot">↑↓ 选择 · Enter 执行 · 输入 ≥2 字搜工作项</div>
    </div>
  </div>;
}
