import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RefreshCw, Search, X} from 'lucide-react';
import type {DocumentOutline, Target} from '../../../packages/protocol/index';
import {buildOutlineChapters, countOutlineItems, filterOutlineChapters, type OutlineChapter} from '../lib/document-outline';
import {rpc} from '../lib/client';
import './requirements-overview.css';

export function RequirementsOverview({target, right, top, onClose, onOpenItem}: {target: Target; right: number; top: number; onClose: () => void; onOpenItem: (workItemId: string) => void}) {
  const [outline, setOutline] = useState<DocumentOutline | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const loadTicket = useRef(0);

  const cacheKey = `ro-outline:${target.projectId}:${target.document}`;
  const load = useCallback(async () => {
    const ticket = ++loadTicket.current;
    // 首次打开先用本地缓存秒开，再后台刷新；SOAP 拉 400+ 条需要几秒。
    let cached: DocumentOutline | null = null;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {at: number; value: DocumentOutline};
        if (Date.now() - parsed.at < 10 * 60_000 && parsed.value?.items?.length) cached = parsed.value;
      }
    } catch { /* 缓存不可用则直接请求 */ }
    if (cached) { setOutline(cached); setLoading(false); } else setLoading(true);
    setFailed('');
    try {
      const value = await rpc<DocumentOutline>({method: 'document.outline', target});
      if (ticket !== loadTicket.current) return;
      setOutline(value);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({at: Date.now(), value})); } catch { /* 忽略配额错误 */ }
    } catch (error) {
      if (ticket === loadTicket.current && !cached) setFailed((error as Error).message || 'DOCUMENT_OUTLINE_FAILED');
    } finally { if (ticket === loadTicket.current) setLoading(false); }
  }, [target, cacheKey]);
  useEffect(() => { void load(); return () => { loadTicket.current++; }; }, [load]);

  useEffect(() => { search.current?.focus(); }, []);

  const chapters = useMemo(() => buildOutlineChapters(outline?.items ?? []), [outline]);
  const visible = useMemo(() => filterOutlineChapters(chapters, query), [chapters, query]);
  const total = useMemo(() => countOutlineItems(chapters), [chapters]);
  const shown = useMemo(() => countOutlineItems(visible), [visible]);

  // 直属于章、没有三级分组的工作项不能挤成一根竖列：整章跨满宽度平铺，按容器自适应多列。
  const renderTiles = (items: OutlineChapter['groups'][number]['items']) => <div className="ro-tiles">
    {items.map(item => <button key={item.id} type="button" className="ro-tile" title={item.id + ' ' + item.title} onClick={() => onOpenItem(item.id)}>
      <span className="ro-id">{item.id}</span><span className="ro-name">{item.title || '(无标题)'}</span>
    </button>)}
  </div>;
  const renderGroups = (chapter: OutlineChapter) => {
    const flat = chapter.groups.length === 1 && chapter.groups[0]!.num === chapter.num;
    if (flat) {
      const group = chapter.groups[0]!;
      return <div className="ro-group ro-flat" style={{'--h': group.hue} as React.CSSProperties}>
        {group.title && group.title !== chapter.title && <div className="ro-group-head"><b>{group.title}</b><span>{group.items.length}</span></div>}
        {renderTiles(group.items)}
      </div>;
    }
    // 大分组按 18 项切块，块在章内并排成多列，避免单列拉到整章高度。
    return chapter.groups.flatMap(group => {
      const chunks: typeof group.items[] = [];
      for (let index = 0; index < group.items.length; index += 18) chunks.push(group.items.slice(index, index + 18));
      return chunks.map((items, index) => <div key={group.num + ':' + index} className="ro-group" style={{'--h': group.hue} as React.CSSProperties}>
        <div className="ro-group-head"><b>{index === 0 ? group.num + (group.title ? ' ' + group.title : '') : group.num + ' 续'}</b>{index === 0 && <span>{group.items.length}</span>}</div>
        {renderTiles(items)}
      </div>);
    });
  };
  return <div className="requirements-overview" ref={panel} style={{right, top, '--ro-right': right + 'px'} as React.CSSProperties} role="dialog" aria-label="软件需求分析总览" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.current?.focus(); search.current?.select(); }
  }}>
    <header className="ro-head">
      <div className="ro-titles">
        <strong>需求总览</strong>
        <span>{target.projectId} · {outline?.title || target.document.split('/').at(-1)}</span>
      </div>
      <span className="ro-count" aria-live="polite">{(shown === total ? total : shown + ' / ' + total)} 项</span>
      <div className="ro-actions">
        <button className="ro-icon" title="重新读取文档结构" onClick={() => void load()} aria-busy={loading}><RefreshCw size={14} className={loading ? 'ro-spin' : ''}/></button>
        <button className="ro-icon" title="关闭总览（Esc）" onClick={onClose}><X size={15}/></button>
      </div>
    </header>
    <div className="ro-search">
      <Search size={13}/>
      <input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工作项编号或名称" aria-label="搜索工作项"/>
      {query && <button className="ro-clear" title="清空" onClick={() => setQuery('')}><X size={12}/></button>}
      <span className="ro-kbd">CTRL F</span>
    </div>
    <div className="ro-body">
      {loading && <div className="ro-state">正在读取文档结构…</div>}
      {!loading && failed && <div className="ro-state ro-failed"><span>读取文档结构失败</span><button onClick={() => void load()}>重试</button></div>}
      {!loading && !failed && !shown && <div className="ro-state">{query.trim() ? '没有匹配的工作项' : '该文档没有可展示的工作项'}</div>}
      {!loading && !failed && (() => {
        // 一页铺满：小章各自一个小容器（左栏竖排），大章占满右侧并按体量分宽、内部多列，章内滚动。
        const totals = visible.map(chapter => chapter.groups.reduce((n, group) => n + group.items.length, 0));
        const small = visible.filter((_, index) => totals[index]! <= 12);
        const big = visible.filter((_, index) => totals[index]! > 12);
        return <div className="ro-layout">
          {small.length > 0 && <div className="ro-side">
            {small.map(chapter => {
              const index = visible.indexOf(chapter);
              return <section key={chapter.num} className="ro-chapter ro-mini" style={{'--h': chapter.hue} as React.CSSProperties}>
                <h3 className="ro-chapter-head"><b>{chapter.num === '0' ? (chapter.title || '未分节') : chapter.title && chapter.title !== chapter.num ? chapter.num + ' ' + chapter.title : chapter.num}</b><span>{totals[index]}</span></h3>
                <div className="ro-groups">
                  {renderGroups(chapter)}
                </div>
              </section>;
            })}
          </div>}
          <div className="ro-main" style={{flex: small.length ? '1 1 0%' : '1 1 100%'}}>
            {(big.length ? big : []).map(chapter => {
              const index = visible.indexOf(chapter);
              const weight = Math.round(Math.sqrt(totals[index]!) * 4) + 2;
              return <section key={chapter.num} className="ro-chapter" style={{'--h': chapter.hue, flex: weight + ' 1 0%'} as React.CSSProperties}>
                <h3 className="ro-chapter-head"><b>{chapter.num === '0' ? (chapter.title || '未分节') : chapter.title && chapter.title !== chapter.num ? chapter.num + ' ' + chapter.title : chapter.num}</b><span>{totals[index]}</span></h3>
                <div className="ro-groups">
                  {renderGroups(chapter)}
                </div>
              </section>;
            })}
            {!big.length && small.length > 0 && <div className="ro-fill"/>}
          </div>
        </div>;
      })()}
    </div>
    <footer className="ro-foot"><span>点条目打开完整内容 · Ctrl+F 搜索 · Esc 关闭</span></footer>
  </div>;
}
