import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Proposal } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import type { LintIssue } from '../../../packages/core/requirement-lint';

/* v0.14 体检 UI：状态栏徽章 + 问题面板 + 行内悬停解释卡。
   术语类问题（带 suggestion）可在面板内二次确认后，经提案管线全文替换并落变更记录（source=lint）。 */

const severityLabel = { warn: '警示', info: '提示' } as const;

/** 状态栏徽章：显示警示/提示计数，点击展开体检面板；有范围的问题可跳转定位，有建议的可一键替换。 */
export function QualityLintStatus({ issues, onJump, onPreview, onFix, onRewrite, onDeepLint, disabled }: {
  issues: LintIssue[]; onJump: (issue: LintIssue) => void; disabled: boolean;
  onPreview: (issue: LintIssue) => Promise<Proposal>; onFix: (p: Proposal, event: Event) => Promise<void>;
  onRewrite: (issue: LintIssue) => Promise<void>; onDeepLint?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<Proposal | null>(null), mounted = useRef(false), lock = useRef(false);
  const reject = (p: Proposal) => rpc({method:'proposals.reject',id:p.id});
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; if (active.current) void reject(active.current).catch(() => {}); }; }, []);
  const action = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setFixing(true); setError('');
    try { await operation(); } catch (reason) { if (mounted.current) setError((reason as Error).message); }
    finally { lock.current = false; if (mounted.current) setFixing(false); }
  };
  const cancel = async () => { if (active.current) await reject(active.current); active.current = null; setPreview(null); };
  const chip = useRef<HTMLButtonElement>(null);
  const [panelAt, setPanelAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !chip.current) return;
    const rect = chip.current.getBoundingClientRect();
    setPanelAt({ left: Math.max(12, Math.min(window.innerWidth - 348, rect.left)), top: Math.max(12, rect.top - 8) });
  }, [open]);
  const warn = issues.filter(issue => issue.severity === 'warn').length, info = issues.length - warn;
  const key = (issue: LintIssue, index: number) => `${issue.ruleId}:${issue.from ?? 'item'}:${index}`;
  return <>
    <button ref={chip} type="button" className={'psb-quality-chip' + (warn ? ' has-warn' : '')} aria-pressed={open} title="需求质量体检（内置严格基线 + 项目规则 · 本地运行；0 发现只是下限筛查，深度检查用 AI 深检）" disabled={fixing} onClick={() => void action(async () => { if (open) await cancel(); setOpen(!open); })}>体检 {issues.length ? `${warn}警示 ${info}提示` : '0 发现'}</button>
    {open && panelAt && <div className="psb-quality-panel" role="dialog" aria-label="质量体检结果" style={{ position: 'fixed', left: panelAt.left, bottom: window.innerHeight - panelAt.top }}>
      <header><strong>质量体检</strong><span>{issues.length ? `${issues.length} 处发现` : '项目规则未发现问题'}</span></header>
      {issues.length === 0 && <p className="psb-quality-empty">内置基线未命中——这只是下限筛查通过，不代表质量好。判据充分性、场景完整性、上下游一致性请点下方「AI 深检本条」或用整册 AI 预审。</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <div className="psb-quality-confirm" role="group" aria-label="确认替换">
        <strong>{preview.workItemId} · 全文替换 {preview.matchCount} 处</strong>
        <div className="psb-quality-diff">{(['before','after'] as const).map(side => <section key={side}><b>{side === 'before' ? '保存前' : '保存后'}</b><p>{preview.diffPreview?.[side].map((segment,i) => segment.kind === 'del' ? <del key={i}>{segment.text}</del> : segment.kind === 'ins' ? <ins key={i}>{segment.text}</ins> : segment.text)}</p></section>)}</div>
        {preview.includesDraftEdits && <span>本次将一并保存该条目已有的草稿修改。</span>}
        <button type="button" className="primary" disabled={fixing || disabled} onClick={e => { const click = e.nativeEvent; void action(async () => { active.current = null; try { await onFix(preview,click); } finally { await reject(preview).catch(() => {}); setPreview(null); } }); }}>确认并保存到 Polarion</button>
        <button type="button" disabled={fixing} onClick={() => void action(cancel)}>取消</button>
      </div>}
      {!preview && issues.slice(0, 50).map((issue, index) => {
        const id = key(issue, index);
        return <div className={'psb-quality-item' + (issue.severity === 'warn' ? ' warn' : '')} key={id}>
          <button type="button" className="psb-quality-jump" disabled={issue.from === undefined} onClick={() => onJump(issue)}>
            <i>{severityLabel[issue.severity]}</i>
            <span>{issue.matchedText ? `「${issue.matchedText}」` : '条目级'}</span>
            <small>{issue.message}</small>
            {issue.suggestion && <em>建议「{issue.suggestion}」</em>}
          </button>
          <button type="button" className="psb-quality-fix" disabled={fixing || disabled} onClick={() => void action(async () => {
            if (!issue.suggestion) { await onRewrite(issue); setOpen(false); return; }
            const p = await onPreview(issue);
            if (!mounted.current) { await reject(p); return; }
            active.current = p; setPreview(p);
          })}>{issue.suggestion ? `预览替换为「${issue.suggestion}」` : 'AI 改写'}</button>
        </div>;
      })}
      {issues.length > 50 && <p className="psb-quality-empty">仅显示前 50 处，修复后自动重算。</p>}
      {onDeepLint && <div className="psb-quality-deep"><button type="button" className="psb-quality-fix" onClick={() => { onDeepLint(); setOpen(false); }}>AI 深检本条（最严格标准）</button></div>}
      <footer>术语修复保存到当前工作项，AI 改写交给当前会话；基线是下限筛查。</footer>
    </div>}
  </>;
}

/** 行内高亮的悬停解释卡：纯展示（pointer-events:none），不与点击语义竞争。 */
export function QualityLintCard({ issue, left, top }: { issue: LintIssue; left: number; top: number }) {
  return <div className="psb-quality-card" role="status" style={{ position: 'fixed', left, top }}>
    <header><span className={issue.severity}>{severityLabel[issue.severity]}</span><strong>{issue.matchedText ? `「${issue.matchedText}」` : '条目级发现'}</strong></header>
    <p>{issue.message}</p>
    {issue.suggestion && <p className="suggest">建议替换为「{issue.suggestion}」（在体检面板中一键应用）</p>}
    <footer>{issue.ruleId} · 本地体检</footer>
  </div>;
}
