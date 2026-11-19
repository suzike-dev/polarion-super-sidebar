import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ClipboardCheck, RefreshCw, Search, ShieldCheck, X} from 'lucide-react';
import type {DocumentOutline, DocumentQualityItem, DocumentQualityReport, GatePolicy, GatesItemView, GatesView, ImpactView, Target} from '../../../packages/protocol/index';
import {defaultGatePolicy, projectDocumentUrl} from '../../../packages/protocol/index';
import {defaultRulePack} from '../../../packages/core/requirement-lint';
import {buildOutlineChapters, countOutlineItems, filterOutlineChapters, type OutlineChapter} from '../lib/document-outline';
import {rpc} from '../lib/client';
import './requirements-overview.css';

type RewriteItem = (workItemId: string, title: string, issues: DocumentQualityItem['issues']) => Promise<void>;
export type OverviewMode = 'outline' | 'quality' | 'lastQuality';

const baselineRules = new Map(defaultRulePack().lintRules.map(rule => [rule.id, rule]));
const ruleSourceLabels = { polarion: '项目规则包', cache: '本机缓存规则', default: '内置基线规则' };

function reportRuleLabel(id: string, message?: string) {
  const rule = baselineRules.get(id);
  // 旧报告只保存了编号和当时的说明。项目改过同名规则时，以报告中的文字为准。
  if (rule?.title && (!message || message === rule.message || message.startsWith(`${rule.message}（当前 `))) return rule.title;
  if (id === 'glossary-ambiguous' && message?.endsWith('对应多个术语条目，请核对项目术语表。')) return '术语对应多个词条';
  return message || id;
}

function QualityRow({item, gate, target, currentDocument, onOpenItem, onRewrite}: {
  item: DocumentQualityItem; gate?: GatesItemView; target: Target; currentDocument: boolean;
  onOpenItem: (id: string) => void; onRewrite?: RewriteItem;
}) {
  const [expanded, setExpanded] = useState(false);
  const [impact, setImpact] = useState<ImpactView | string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState('');
  const detailId = React.useId();
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    void rpc<ImpactView>({ method: 'impact.view', target, workItemId: item.workItemId })
      .then(value => { if (active) setImpact(value); })
      .catch(e => { if (active) setImpact((e as Error).message); });
    return () => { active = false; };
  }, [expanded, item.workItemId, target]);
  const title = item.title || '(无标题)';
  const rules = useMemo(() => {
    const groups = new Map<string, { issue: DocumentQualityItem['issues'][number]; count: number }>();
    for (const issue of item.issues) {
      const group = groups.get(issue.ruleId);
      if (group) group.count++;
      else groups.set(issue.ruleId, { issue, count: 1 });
    }
    return [...groups.values()];
  }, [item.issues]);
  const gateText = gate?.gates.map(g => `${g.label} · ${g.pass ? '通过' : '未过'} · ${g.detail}`).join('\n');
  const links = (name: string, rows: ImpactView['upstream']) => rows.length > 0 && <div className="ro-link-group"><b>{name}</b>{rows.map((link, index) => <button key={index} type="button" className="ro-impact-link" onClick={() => onOpenItem(link.workItemId)}>{link.workItemId} · {link.role}</button>)}</div>;
  return <div className="ro-quality-row">
    <div className="ro-quality-line">
      <button type="button" className="ro-quality-open" title={`${item.workItemId} ${title} · 打开阅读预览`} onClick={() => onOpenItem(item.workItemId)}>
        <span className="ro-id">{item.outline && item.outline + ' '}{item.workItemId}</span>
        <span className="ro-name">{title}</span>
      </button>
      <div className="ro-quality-actions">
        <button type="button" className="ro-quality-toggle" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} aria-describedby={`${detailId}-summary`} aria-label={`${expanded ? '收起' : '展开'} ${item.workItemId} 的体检详情`} onClick={() => setExpanded(v => !v)}>
          <span className="ro-findings" id={`${detailId}-summary`}>
            {gate && <span className={'ro-gate ' + (gate.passed ? 'pass' : 'fail')} title={gateText}>{gate.passed ? '门禁通过' : `${gate.gates.filter(g => !g.pass).length} 项门禁未过`}</span>}
            {item.unreadable && <span className="ro-unreadable">正文读取失败</span>}
            {rules.slice(0, 3).map(({issue, count}) => <span key={issue.ruleId} className={'ro-finding ' + issue.severity} title={`${issue.ruleId} · ${issue.message}${issue.matchedText ? '\n' + issue.matchedText : ''}`}>
              {reportRuleLabel(issue.ruleId, issue.message)}{count > 1 && ` ×${count}`}
            </span>)}
            {rules.length > 3 && <span>+{rules.length - 3} 项规则</span>}
            {item.issues.length > 0 && <span>{item.issues.length} 条命中</span>}
          </span>
          <span className="ro-more">{expanded ? '收起' : '详情'}</span>
        </button>
        {onRewrite && currentDocument && !item.readOnlyReference && item.issues.length > 0 && <button type="button" disabled={rewriting} className="ro-quality-rewrite" title={`按规则改写 ${item.workItemId}`} onClick={async () => {
          setRewriting(true); setRewriteError('');
          try { await onRewrite(item.workItemId, title, item.issues); }
          catch (cause) { setRewriteError(`提交 ${item.workItemId} 改写失败。${(cause as Error).message}`); }
          finally { setRewriting(false); }
        }}>{rewriting ? '正在提交…' : 'AI 改写'}</button>}
      </div>
    </div>
    {rewriteError && <p className="ro-quality-detail" role="alert">{rewriteError}</p>}
    {expanded && <div className="ro-quality-detail" id={detailId}>
      <strong>{item.outline} <button type="button" className="ro-quality-id" onClick={() => onOpenItem(item.workItemId)}>{item.workItemId}</button> · {title}</strong>
      {item.unreadable && <p>本次体检未能读取该工作项的正文。</p>}
      {item.issues.length > 0 && <ol>{item.issues.map((issue, index) => <li key={index}>
        <span className="ro-detail-meta">{issue.severity === 'warn' ? '警示' : '提示'} · {issue.ruleId}</span>
        <p className="ro-detail-rule">{issue.message || reportRuleLabel(issue.ruleId)}</p>
        <p>{issue.matchedText ? `命中原文「${issue.matchedText}」` : '条目级发现'}</p>{issue.suggestion && <p>建议 · {issue.suggestion}</p>}
      </li>)}</ol>}
      {gate && <ul aria-label="门禁明细">{gate.gates.map(g => <li key={g.gate}><b>{g.label} · {g.pass ? '通过' : '未过'}</b>　{g.detail}</li>)}</ul>}
      {impact === null ? <p role="status">正在读取关联条目…</p> : typeof impact === 'string' ? <p>{impact}</p> : <>
        {links('上游链接', impact.upstream)}{links('下游链接', impact.downstream)}{links('验证链接', impact.verification)}
        {impact.modules.length > 0 && <p>实现模块 · {impact.modules.map(m => `${m.rootLabel} / ${m.moduleName}（${m.moduleKey}）`).join('、')}</p>}
        {!impact.upstream.length && !impact.downstream.length && !impact.verification.length && <p>覆盖索引中没有关联工作项链接。</p>}
      </>}
    </div>}
  </div>;
}

export function RequirementsOverview({target, right, top, initialMode = 'outline', onClose, onOpenItem, onReview, onRewrite}: {target: Target; right: number; top: number; initialMode?: OverviewMode; onClose: () => void; onOpenItem: (workItemId: string) => void; onReview: () => void; onRewrite?: RewriteItem}) {
  const [outline, setOutline] = useState<DocumentOutline | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const [query, setQuery] = useState('');
  const [qualityMode, setQualityMode] = useState(initialMode !== 'outline');
  const [outlineRequested, setOutlineRequested] = useState(initialMode === 'outline');
  const [qualityRequest, setQualityRequest] = useState<{ source: 'last' | 'current' } | null>(() => initialMode === 'outline' ? null : { source: initialMode === 'lastQuality' ? 'last' : 'current' });
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
  useEffect(() => {
    if (!qualityRequest) return;
    let active = true;
    const requestedAt = Date.now();
    setQualityLoading(true); setQualityError(''); setReport(null);
    const request = qualityRequest.source === 'last'
      ? rpc<DocumentQualityReport | null>({ method: 'quality.document.last', target })
      : rpc<DocumentQualityReport>({ method: 'quality.document.check', target, limit: 300 });
    void request.then(value => { if (active) setReport(value); })
      .catch(async e => {
        if (!active) return;
        const message = (e as Error).message || '整册体检失败';
        // 体检请求超时后 Host 仍会把报告写完；读取刚落盘的新报告，避免把已完成的结果当成失败。
        if (qualityRequest.source === 'current') {
          try {
            const latest = await rpc<DocumentQualityReport | null>({ method: 'quality.document.last', target });
            if (!active) return;
            if (latest && latest.at >= requestedAt) { setReport(latest); return; }
          } catch { /* 读取兜底报告失败时保留原始错误 */ }
          if (!active) return;
        }
        setQualityError(message);
      })
      .finally(() => { if (active) setQualityLoading(false); });
    return () => { active = false; };
  }, [qualityRequest, target]);
  const checkCurrent = () => setQualityRequest({ source: 'current' });
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
  const closePolicy = () => { if (gates) setPolicy(gates.policy); setPolicyOpen(false); };
  const findings = useMemo(() => report?.items.filter(item => item.issues.length || item.unreadable) ?? [], [report]);
  const reportMessages = useMemo(() => {
    const messages = new Map<string, string>();
    for (const item of findings) {
      for (const issue of item.issues) {
        if (issue.message && !messages.has(issue.ruleId)) messages.set(issue.ruleId, issue.message);
      }
    }
    return messages;
  }, [findings]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? findings.filter(item => `${item.outline} ${item.workItemId} ${item.title}`.toLowerCase().includes(needle)) : findings;
  }, [findings, query]);

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
  useEffect(() => { if (outlineRequested) void load(); return () => { loadTicket.current++; }; }, [load, outlineRequested]);

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
  return <div className={'requirements-overview' + (qualityMode ? ' ro-report' : '')} ref={panel} style={{right: qualityMode ? undefined : right, top, '--ro-right': right + 'px'} as React.CSSProperties} role="dialog" aria-label={qualityMode ? '整册体检报告' : '软件需求分析总览'} onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (policyOpen) closePolicy(); else onClose(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.current?.focus(); search.current?.select(); }
  }}>
    <header className="ro-head">
      <div className="ro-titles">
        <strong>{qualityMode ? '整册体检报告' : '需求总览'}</strong>
        <span title={qualityMode ? report?.document : target.document}>{target.projectId} · {qualityMode ? (report?.document ?? (qualityRequest?.source === 'last' ? '项目最近报告' : target.document)) : (outline?.title || target.document)}</span>
      </div>
      <span className="ro-count" aria-live="polite">{qualityMode ? report && `${query.trim() ? `${rows.length} / ` : ''}${findings.length} 项有发现` : `${shown === total ? total : shown + ' / ' + total} 项`}</span>
      <div className="ro-actions">
        <button className="ro-icon" title="AI 预审：会话对整册产出问题卡，逐条处置后可发飞书汇总" onClick={onReview}><ShieldCheck size={14}/></button>
        <button className={'ro-icon' + (qualityMode ? ' active' : '')} title={qualityMode ? '回到结构总览' : '整册质量体检：逐条扫描全部工作项并汇总规则命中'} aria-pressed={qualityMode} onClick={() => { if (qualityMode) setOutlineRequested(true); else setQualityRequest(current => current?.source === 'current' ? current : { source: 'current' }); setQualityMode(value => !value); }}><ClipboardCheck size={14}/></button>
        <button className="ro-icon" title={qualityMode ? `重新体检当前文档 ${target.document}` : '重新读取文档结构'} onClick={() => qualityMode ? checkCurrent() : void load()} disabled={qualityMode && qualityLoading} aria-busy={qualityMode ? qualityLoading : loading}><RefreshCw size={14} className={(qualityMode ? qualityLoading : loading) ? 'ro-spin' : ''}/></button>
        <button className="ro-icon" title="关闭总览（Esc）" onClick={onClose}><X size={15}/></button>
      </div>
    </header>
    <div className="ro-search">
      <Search size={13}/>
      <input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索工作项编号或名称" aria-label="搜索工作项"/>
      {query && <button className="ro-clear" title="清空" onClick={() => setQuery('')}><X size={12}/></button>}
      <span className="ro-kbd">CTRL F</span>
    </div>
    <div className={'ro-body' + (qualityMode ? ' ro-report-body' : '')} tabIndex={qualityMode ? 0 : undefined}>
      {qualityMode && <>
        {qualityLoading && <div className="ro-state" role="status">{qualityRequest?.source === 'last' ? '正在读取最近一次体检报告…' : '正在逐条体检当前文档…'}</div>}
        {qualityError && <div className="ro-state ro-failed" role="alert"><span>{qualityError}</span><button onClick={() => qualityRequest && setQualityRequest({ ...qualityRequest })}>重试</button></div>}
        {!qualityLoading && !qualityError && !report && qualityRequest?.source === 'last' && <div className="ro-state"><p>本项目还没有已保存的体检报告。</p><button className="secondary" onClick={checkCurrent}>体检当前文档</button></div>}
        {!qualityLoading && report && (() => {
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
              <div className="score-ring" style={{ '--score': score } as React.CSSProperties}><b>{score}</b><small>体检分</small></div>
              <div className="score-facts">
                <div className="ro-result-counts">
                  <span><b>{report.clean}</b>/{report.checked} 通过</span>
                  <span><b>{report.checked - report.clean}</b> 项有发现</span>
                  <span><b>{report.byRule.reduce((sum, rule) => sum + rule.count, 0)}</b> 条命中记录</span>
                </div>
                <span className="ro-report-source">{new Date(report.at).toLocaleString('zh-CN', { hour12: false })} · {report.document ? <a href={projectDocumentUrl(target, report.document)} target="_blank" rel="noreferrer">{report.document}</a> : '历史报告未记录来源文档'} · 已检查 {report.checked}/{report.total} 项{ruleSourceLabels[report.ruleSource] && ` · ${ruleSourceLabels[report.ruleSource]}`}</span>
              </div>
              {(gates || gatesNote) && <div className="ro-gates-line">
                {gates && <><span>项目覆盖索引 · 门禁全过 <b>{gates.summary.passed}</b>/{gates.summary.total}{Object.entries(gates.summary.byGate).filter(([, fails]) => fails > 0).map(([gate, fails]) => ` · ${({quality:'质量',criterion:'准则',upstream:'链接',module:'模块'} as Record<string,string>)[gate]}✗${fails}`).join('')}</span>
                  <button type="button" className="ro-policy-btn" aria-expanded={policyOpen} onClick={() => policyOpen ? closePolicy() : setPolicyOpen(true)}>门禁策略{gates.policy.minQualityScore ? ` · 阈值${gates.policy.minQualityScore}` : ''}</button></>}
                {gatesNote && <span>{gatesNote}</span>}
              </div>}
              {report.byRule.length > 0 && <ul className="ro-rule-totals" aria-label="整册规则命中次数">{report.byRule.map(rule =>
                <li key={rule.ruleId} className="ro-rule-chip" title={rule.ruleId}>
                  {reportRuleLabel(rule.ruleId, reportMessages.get(rule.ruleId))} <b>{rule.count} 次</b>
                </li>)}
              </ul>}
            </div>
            {policyOpen && <div className="ro-policy" role="dialog" aria-label="门禁策略">
              <strong>门禁策略</strong>
              <small>停用的门不参与判定；质量分阈值用于发版提醒（0 关闭）</small>
              {([['quality','质量体检'],['criterion','验证准则'],['upstream','上游链接'],['module','实现模块']] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={policy.enabled[key]} onChange={event => setPolicy(current => ({ ...current, enabled: { ...current.enabled, [key]: event.target.checked } }))}/>{label}</label>)}
              <label className="ro-policy-score">质量分阈值<input type="number" min={0} max={100} value={policy.minQualityScore} aria-label="质量分阈值" onChange={event => setPolicy(current => ({ ...current, minQualityScore: Math.min(100, Math.max(0, Number(event.target.value) || 0)) }))}/>分{gates && gates.summary.qualityScore < policy.minQualityScore ? <em>当前 {gates.summary.qualityScore} 分，低于阈值</em> : null}</label>
              <div className="ro-policy-actions"><button onClick={closePolicy}>取消</button><button className="primary" disabled={policyBusy} onClick={() => void savePolicy(policy)}>{policyBusy ? '保存中…' : '保存策略'}</button></div>
            </div>}
            {[...chapters.entries()].map(([chapter, items], index) => <div key={chapter} className="ro-quality-chapter" style={{'--h': (chapter.charCodeAt(0) * 37 + index * 53) % 360} as React.CSSProperties}>
              <h4>{chapter === '0' ? '未分节' : `第 ${chapter} 章`}<span>{items.length} 项有发现</span></h4>
              {items.map(item => <QualityRow key={item.workItemId} item={item} gate={gatesByItem.get(item.workItemId)} target={target} currentDocument={report.document === target.document} onOpenItem={onOpenItem} onRewrite={onRewrite}/>)}
            </div>)}
            {!rows.length && <div className="ro-state">{query.trim() ? '没有匹配的工作项' : '本次检查的条目中没有体检发现。'}</div>}
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
    <footer className="ro-foot"><span>{qualityMode ? '点编号打开工作项 · 点发现或「详情」查看完整规则、门禁与关联条目 · Esc 关闭' : '点条目打开完整内容 · Ctrl+F 搜索 · Esc 关闭'}</span></footer>
  </div>;
}
