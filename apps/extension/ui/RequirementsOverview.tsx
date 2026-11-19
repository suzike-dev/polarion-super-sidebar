import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ClipboardCheck, RefreshCw, Search, ShieldCheck, X} from 'lucide-react';
import type {DocumentOutline, DocumentQualityReport, GatePolicy, GatesItemView, GatesView, Target} from '../../../packages/protocol/index';
import {defaultGatePolicy} from '../../../packages/protocol/index';
import {buildOutlineChapters, countOutlineItems, filterOutlineChapters, type OutlineChapter} from '../lib/document-outline';
import {rpc} from '../lib/client';
import './requirements-overview.css';

export function RequirementsOverview({target, right, top, onClose, onOpenItem, onReview, onRewrite}: {target: Target; right: number; top: number; onClose: () => void; onOpenItem: (workItemId: string) => void; onReview: () => void; onRewrite?: (workItemId: string, title: string, issues: { message: string; matchedText?: string }[]) => void}) {
  const [outline, setOutline] = useState<DocumentOutline | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const [qualityMode, setQualityMode] = useState(false);
  const [report, setReport] = useState<DocumentQualityReport | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState('');
  const [gates, setGates] = useState<GatesView | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policy, setPolicy] = useState<GatePolicy>(defaultGatePolicy());
  const [policyBusy, setPolicyBusy] = useState(false);
  const [gatesNote, setGatesNote] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const loadTicket = useRef(0);
  const runQuality = useCallback(async () => {
    setQualityLoading(true); setQualityError('');
    try { setReport(await rpc<DocumentQualityReport>({ method: 'quality.document.check', target, limit: 300 })); }
    catch (e) { setQualityError((e as Error).message || '整册体检失败'); }
    finally { setQualityLoading(false); }
  }, [target]);
  useEffect(() => { if (qualityMode && !report && !qualityLoading && !qualityError) void runQuality(); }, [qualityMode, report, qualityLoading, qualityError, runQuality]);
  // 门禁：体检模式打开即取（基于覆盖索引，读缓存秒回）。
  useEffect(() => {
    if (!qualityMode) return;
    let cancelled = false;
    setGates(null); setGatesNote('');
    void rpc<GatesView>({ method: 'gates.view', target })
      .then(view => { if (!cancelled) { setGates(view); setPolicy(view.policy); } })
      .catch(e => { if (!cancelled) setGatesNote((e as Error).message); });
    return () => { cancelled = true; };
  }, [qualityMode, target]);
  const savePolicy = async (next: GatePolicy) => {
    if (policyBusy) return;
    setPolicyBusy(true);
    try {
      await rpc({ method: 'gates.policy.save', projectId: target.projectId, policy: next });
      setPolicy(next);
      setGates(await rpc<GatesView>({ method: 'gates.view', target }));
      setPolicyOpen(false);
    } catch (e) { setGatesNote('保存门禁策略失败：' + (e as Error).message); }
    finally { setPolicyBusy(false); }
  };
  const gatesByItem = useMemo(() => new Map((gates?.items ?? []).map(item => [item.workItemId, item])), [gates]);
  const gateBadge = (workItemId: string) => {
    const item = gatesByItem.get(workItemId);
    if (!item) return null;
    const failed = item.gates.filter(gate => !gate.pass);
    return <span className={'ro-gate ' + (item.passed ? 'pass' : 'fail')} title={item.gates.map(gate => `${gate.pass ? '✓' : '✗'} ${gate.label}：${gate.detail}`).join('\n')}>{item.passed ? '门禁✓' : `门禁✗${failed.length}`}</span>;
  };

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
        <button className="ro-icon" title="AI 预审：会话对整册产出问题卡，逐条处置后可发飞书汇总" onClick={onReview}><ShieldCheck size={14}/></button>
        <button className={'ro-icon' + (qualityMode ? ' active' : '')} title={qualityMode ? '回到结构总览' : '整册质量体检：逐条扫描全部工作项并汇总规则命中'} aria-pressed={qualityMode} onClick={() => { setQualityMode(value => !value); setQualityError(''); }}><ClipboardCheck size={14}/></button>
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
      {qualityMode && <>
        {qualityLoading && <div className="ro-state">正在逐条体检整册需求…大文档约需几十秒。</div>}
        {qualityError && <div className="ro-state ro-failed"><span>{qualityError}</span><button onClick={() => void runQuality()}>重试</button></div>}
        {!qualityLoading && report && (() => {
          const match = (item: { outline: string; workItemId: string; title: string }) => !query.trim() || `${item.outline} ${item.workItemId} ${item.title}`.toLowerCase().includes(query.trim().toLowerCase());
          const rows = report.items.filter(item => item.issues.length || item.unreadable).filter(match);
          const cleanGates = gates?.items.filter(item => item.passed && match(item)) ?? [];
          const score = report.checked ? Math.round((report.clean / report.checked) * 100) : 0;
          const chapterOf = (outlineNumber?: string) => (String(outlineNumber ?? '').match(/^\d+/)?.[0] ?? '0');
          const chapters = new Map<string, typeof rows>();
          for (const item of rows) {
            const key = chapterOf(item.outline);
            if (!chapters.has(key)) chapters.set(key, []);
            chapters.get(key)!.push(item);
          }
          return <>
            <div className="ro-quality-score">
              <div className="score-ring" data-score={score}><b>{score}</b><small>体检分</small></div>
              <div className="score-facts">
                <span><b>{report.clean}</b>/{report.checked} 通过 · <b>{report.checked - report.clean}</b> 有发现</span>
                {report.byRule.slice(0, 6).map(rule => <span key={rule.ruleId} className="ro-rule-chip" title={`规则 ${rule.ruleId} 命中 ${rule.count} 次`}>{rule.ruleId} ×{rule.count}</span>)}
                {gates && <button type="button" className="ro-policy-btn" aria-expanded={policyOpen} onClick={() => setPolicyOpen(v => !v)}>门禁策略{policy.minQualityScore ? ` · 阈值${policy.minQualityScore}` : ''}</button>}
                {gates && <span className="ro-gates-line">门禁全过 <b>{gates.summary.passed}</b>/{gates.summary.total}{Object.entries(gates.summary.byGate).filter(([, fails]) => fails > 0).map(([gate, fails]) => ` · ${({quality:'质量',criterion:'准则',upstream:'链接',module:'模块'} as Record<string,string>)[gate]}✗${fails}`).join('')}</span>}
                {gatesNote && <span className="ro-gates-line muted">{gatesNote}</span>}
                {gates && cleanGates.length > 0 && <span className="ro-gates-line muted">门禁全过但无体检命中的 {cleanGates.length} 条未在下方列出。</span>}
              </div>
            </div>
            {policyOpen && <div className="ro-policy" role="dialog" aria-label="门禁策略">
              <strong>门禁策略</strong>
              <small>停用的门不参与判定；质量分阈值用于发版提醒（0 关闭）</small>
              {([['quality','质量体检'],['criterion','验证准则'],['upstream','上游链接'],['module','实现模块']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={policy.enabled[key]} onChange={event => setPolicy(current => ({ ...current, enabled: { ...current.enabled, [key]: event.target.checked } }))}/>{label}</label>)}
              <label className="ro-policy-score">质量分阈值<input type="number" min={0} max={100} value={policy.minQualityScore} aria-label="质量分阈值" onChange={event => setPolicy(current => ({ ...current, minQualityScore: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))}/>分{gates && gates.summary.qualityScore < policy.minQualityScore ? <em>当前 {gates.summary.qualityScore} 分，低于阈值</em> : null}</label>
              <div className="ro-policy-actions"><button onClick={() => setPolicyOpen(false)}>取消</button><button className="primary" disabled={policyBusy} onClick={() => void savePolicy(policy)}>{policyBusy ? '保存中…' : '保存策略'}</button></div>
            </div>}
            {[...chapters.entries()].map(([chapter, items], index) => <div key={chapter} className="ro-quality-chapter" style={{'--h': (chapter.charCodeAt(0) * 37 + index * 53) % 360} as React.CSSProperties}>
              <h4>{chapter === '0' ? '未分节' : `第 ${chapter} 章`}<span>{items.length} 条有发现</span></h4>
              {items.map(item => <div key={item.workItemId} className="ro-quality-row">
                <button type="button" className="ro-quality-open" title="打开该工作项" onClick={() => onOpenItem(item.workItemId)}>
                  <span className="ro-id">{item.outline ? item.outline + ' ' : ''}{item.workItemId}</span>
                  <span className="ro-name">{item.title || '(无标题)'}</span>
                  {gateBadge(item.workItemId)}
                  {item.unreadable
                    ? <i className="unreadable">正文读取失败</i>
                    : item.issues.slice(0, 3).map((issue, issueIndex) => <i key={issueIndex} className={issue.severity}>{issue.matchedText ? `「${issue.matchedText}」` : '条目级'}{issue.message}</i>)}
                  {item.issues.length > 3 && <i className="more">+{item.issues.length - 3}</i>}
                </button>
                {onRewrite && item.issues.length > 0 && <button type="button" className="ro-quality-rewrite" title="交给当前会话按规则逐处改写该条目；改完重跑整册体检复验" onClick={() => onRewrite(item.workItemId, item.title, item.issues)}>AI 改写</button>}
              </div>)}
            </div>)}
            {!rows.length && <div className="ro-state">{query.trim() ? '没有匹配的工作项' : '整册通过：当前规则未命中任何问题。'}</div>}
          </>;
        })()}
      </>}
      {!qualityMode && loading && <div className="ro-state">正在读取文档结构…</div>}
      {!qualityMode && !loading && failed && <div className="ro-state ro-failed"><span>读取文档结构失败</span><button onClick={() => void load()}>重试</button></div>}
      {!qualityMode && !loading && !failed && !shown && <div className="ro-state">{query.trim() ? '没有匹配的工作项' : '该文档没有可展示的工作项'}</div>}
      {!qualityMode && !loading && !failed && (() => {
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
    <footer className="ro-foot"><span>{qualityMode ? '点条目打开完整内容逐条处置 · 体检逐条运行项目规则包 · Esc 关闭' : '点条目打开完整内容 · Ctrl+F 搜索 · Esc 关闭'}</span></footer>
  </div>;
}
