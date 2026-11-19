import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Proposal } from '../../../packages/protocol/index';
import type { LintIssue } from '../../../packages/core/requirement-lint';
import { rpc } from '../lib/client';

const severityLabel = { warn: '警示', info: '提示' } as const;
async function rejectPreview(proposal: Proposal) {
  try { await rpc({method: 'proposals.reject', id: proposal.id}); }
  catch (reason) {
    // The inbox may already have decided the proposal while this preview was open.
    if (!(reason instanceof Error && reason.message === 'PROPOSAL_NOT_PENDING')) throw reason;
  }
}
const progressText = { preview: '正在生成预览…', rewrite: '正在请求改写…', deep: '正在提交 AI 深检…', save: '正在保存…', reject: '正在取消预览…' };
type Operation = keyof typeof progressText;

/** The assistant can occupy the right or bottom of the visual viewport. Keep the popover in the visible editor. */
function visibleEditorBounds(frame: Element | null) {
  const view = window.visualViewport;
  const x = view?.offsetLeft ?? 0, y = view?.offsetTop ?? 0;
  const viewportRight = x + (view?.width ?? window.innerWidth);
  const viewportBottom = y + (view?.height ?? window.innerHeight);
  const box = frame?.getBoundingClientRect();
  const visibleFrame = box && box.right > x && box.left < viewportRight && box.bottom > y && box.top < viewportBottom;
  const left = (visibleFrame ? Math.max(x, box.left) : x) + 8;
  const right = (visibleFrame ? Math.min(viewportRight, box.right) : viewportRight) - 8;
  const top = (visibleFrame ? Math.max(y, box.top) : y) + 8;
  const bottom = (visibleFrame ? Math.min(viewportBottom, box.bottom) : viewportBottom) - 8;
  return { left, right, top, bottom };
}

function trackPlacement(place: () => void, ...elements: (Element | null | undefined)[]) {
  place();
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  for (const element of elements) if (element) observer?.observe(element);
  const view = window.visualViewport;
  window.addEventListener('resize', place);
  view?.addEventListener('resize', place);
  view?.addEventListener('scroll', place);
  return () => {
    observer?.disconnect(); window.removeEventListener('resize', place);
    view?.removeEventListener('resize', place); view?.removeEventListener('scroll', place);
  };
}

function placeResults(panel: HTMLElement, chip: HTMLElement, frame: Element | null, comparing: boolean) {
  const { left, right, top, bottom } = visibleEditorBounds(frame);
  const anchor = chip.getBoundingClientRect();
  const width = Math.max(1, Math.min(comparing ? 700 : 460, right - left));
  const above = Math.max(0, Math.min(anchor.top - 6, bottom) - top);
  const below = Math.max(0, bottom - Math.max(anchor.bottom + 6, top));
  // In a very short editor, let the panel cover its trigger and use the full visible height.
  const fill = Math.max(above, below) < 200;
  const lift = !fill && above >= below;
  const height = Math.max(1, Math.min(comparing ? 640 : 560, fill ? bottom - top : Math.max(above, below)));
  Object.assign(panel.style, {
    left: `${Math.max(left, Math.min(anchor.left, right - width))}px`, width: `${width}px`, maxHeight: `${height}px`,
    top: `${fill ? top : lift ? top + above : bottom - below}px`, transform: lift ? 'translateY(-100%)' : 'none',
  });
  panel.dataset.short = String(height < 220);
}

export function QualityLintStatus({ issues, onJump, onPreview, onFix, onRewrite, onDeepLint, inspectionSource, writeDisabled }: {
  issues: LintIssue[]; onJump: (issue: LintIssue) => void; writeDisabled: boolean;
  onPreview: (issue: LintIssue) => Promise<Proposal>; onFix: (p: Proposal, event: Event) => Promise<void>;
  onRewrite: (issue: LintIssue) => Promise<void>; onDeepLint: () => Promise<void>; inspectionSource: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const chip = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null), errorText = useRef<HTMLParagraphElement>(null);
  const findingAction = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<Operation | null>(null), active = useRef<Proposal | null>(null);
  const generation = useRef(0), panelId = useId();
  const warn = issues.filter(issue => issue.severity === 'warn').length;
  const committing = busy === 'save' || busy === 'reject';

  useLayoutEffect(() => () => {
    generation.current++;
    if (active.current && pending.current !== 'reject') void rejectPreview(active.current).catch(() => {});
  }, []);

  const run = useCallback(async (operation: Operation, work: (current: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    const ticket = generation.current;
    const current = () => ticket === generation.current;
    pending.current = operation; setBusy(operation); setError('');
    try { await work(current); }
    catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current()) { pending.current = null; setBusy(null); } }
  }, []);

  const hide = useCallback((restoreFocus: boolean) => {
    generation.current++; pending.current = null; findingAction.current = null;
    setBusy(null); setError(''); setPreview(null); setOpen(false);
    if (restoreFocus) chip.current?.focus({preventScroll: true});
  }, []);

  const dismiss = useCallback((closePanel: boolean, restoreFocus = true) => {
    if (pending.current === 'save' || pending.current === 'reject') return;
    const proposal = active.current;
    if (!proposal) { if (closePanel) hide(restoreFocus); return; }
    void run('reject', async current => {
      await rejectPreview(proposal);
      if (!current()) return;
      active.current = null; setPreview(null);
      if (closePanel) hide(restoreFocus);
    });
  }, [hide, run]);

  useLayoutEffect(() => {
    const element = panel.current, anchor = chip.current;
    if (!open || !element || !anchor) return;
    const frame = anchor.closest('.rich-workbench');
    return trackPlacement(() => placeResults(element, anchor, frame, !!preview), anchor, frame, frame?.querySelector(':scope > footer'));
  }, [open, preview]);

  useLayoutEffect(() => {
    if (!open) return;
    if (busy) {
      if (busy !== 'reject') heading.current?.focus({preventScroll: true});
      return;
    }
    if (error) { errorText.current?.focus(); return; }
    const action = findingAction.current;
    if (!preview && action?.isConnected && !action.disabled) {
      action.focus(); findingAction.current = null;
    } else heading.current?.focus({preventScroll: true});
  }, [open, preview, busy, error]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (panel.current && chip.current && !path.includes(panel.current) && !path.includes(chip.current)) dismiss(true, false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, dismiss]);

  function showAssistant() {
    hide(true);
    const anchor = chip.current;
    requestAnimationFrame(() => {
      if (anchor?.isConnected && (anchor.getRootNode() as Document | ShadowRoot).activeElement === anchor) {
        anchor.closest('.workspace-root')?.querySelector<HTMLTextAreaElement>('.floating-assistant .composer textarea')?.focus({preventScroll: true});
      }
    });
  }

  function fixFinding(issue: LintIssue, button: HTMLButtonElement) {
    if (writeDisabled || pending.current) return;
    findingAction.current = button;
    if (!issue.suggestion) {
      void run('rewrite', async current => { await onRewrite(issue); if (current()) showAssistant(); });
      return;
    }
    void run('preview', async current => {
      const proposal = await onPreview(issue);
      if (!current()) { await rejectPreview(proposal); return; }
      active.current = proposal; setPreview(proposal);
    });
  }

  function confirm(click: Event) {
    const proposal = active.current;
    if (!proposal || writeDisabled) return;
    void run('save', async current => {
      // The editor verifies this native click and the draft revision. Never reject a save in flight on unmount.
      active.current = null;
      try { await onFix(proposal, click); }
      catch (reason) { await rejectPreview(proposal).catch(() => {}); throw reason; }
      finally { if (current()) setPreview(null); }
    });
  }

  const layer = chip.current?.closest('.rich-layer') ?? chip.current?.ownerDocument.body;
  const alert = error && <p ref={errorText} className="psb-quality-error" role="alert" tabIndex={-1}>{error}</p>;
  return <>
    <button ref={chip} type="button" className={'psb-quality-chip' + (warn ? ' has-warn' : '')} title="需求质量体检" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-disabled={committing || undefined} onClick={() => open ? dismiss(true) : setOpen(true)}>体检 {issues.length ? `${warn}警示 ${issues.length - warn}提示` : '0 发现'}</button>
    {open && layer && createPortal(<div ref={panel} id={panelId} className="psb-quality-panel" role="dialog" aria-label="质量体检结果" aria-modal="false" aria-busy={!!busy}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); dismiss(true); }
      }} onBlur={event => {
        const next = event.relatedTarget;
        if (next && next !== chip.current && !event.currentTarget.contains(next)) dismiss(true, false);
      }}>
      <header className="psb-quality-heading">
        <div><h2 ref={heading} tabIndex={-1}>{preview ? '预览替换' : '质量体检'}</h2>{busy ? <span role="status">{progressText[busy]}</span> : !preview && <span>{issues.length} 处发现</span>}</div>
        {!preview && <button type="button" className="psb-quality-deep" aria-describedby={`${panelId}-inspection-source`} disabled={!!busy} onClick={() => void run('deep', async current => { await onDeepLint(); if (current()) showAssistant(); })}>AI 深检本条</button>}
        <button type="button" className="psb-quality-close" title="关闭体检面板" aria-label="关闭体检面板" disabled={committing} onClick={() => dismiss(true)}><X size={17} aria-hidden="true"/></button>
      </header>
      <div className="psb-quality-list" hidden={!!preview} role="region" aria-label="体检发现" tabIndex={0}>
        {!preview && alert}
        <p id={`${panelId}-inspection-source`} className="psb-quality-empty">{!issues.length && '本地规则未发现问题。'}AI 深检将只读分析{inspectionSource}。</p>
        <ul>{issues.map((issue, index) => <li className={'psb-quality-item ' + issue.severity} key={`${issue.ruleId}:${issue.from ?? 'item'}:${index}`}>
          <div className="psb-quality-head"><span className="psb-quality-severity">{severityLabel[issue.severity]}</span><strong id={`${panelId}-finding-${index}`}>{issue.matchedText ? `「${issue.matchedText}」` : '条目级发现'}</strong></div>
          <p className="psb-quality-msg">{issue.message}</p>
          {issue.suggestion && <p className="psb-quality-sug">建议替换为「{issue.suggestion}」</p>}
          <div className="psb-quality-actions">
            <button type="button" className="psb-quality-locate" aria-describedby={`${panelId}-finding-${index}`} disabled={!!busy || issue.from === undefined || issue.to === undefined} onClick={() => { hide(false); onJump(issue); }}>定位</button>
            <button type="button" className="psb-quality-fix" aria-describedby={`${panelId}-finding-${index}`} disabled={!!busy || writeDisabled} onClick={event => fixFinding(issue, event.currentTarget)}>{issue.suggestion ? '预览替换' : 'AI 改写'}</button>
          </div>
        </li>)}</ul>
      </div>
      {preview && <div className="psb-quality-confirm" role="group" aria-label="确认替换">
        <div className="psb-quality-list psb-quality-preview" role="region" aria-label="替换前后对比" tabIndex={0}>
          {alert}
          <p className="psb-quality-scope">{preview.workItemId} · 全文替换 {preview.matchCount} 处</p>
          <div className="psb-quality-diff">{(['before', 'after'] as const).map(side => <section key={side}>
            <h3>{side === 'before' ? '保存前' : '保存后'}</h3>
            <p>{preview.diffPreview?.[side].map((part, i) => part.kind === 'del' ? <del key={i}>{part.text}</del> : part.kind === 'ins' ? <ins key={i}>{part.text}</ins> : part.text)}</p>
          </section>)}</div>
        </div>
        <div className="psb-quality-confirm-footer">
          {preview.includesDraftEdits && <p>本次将一并保存该条目已有的草稿修改。</p>}
          <div className="psb-quality-actions">
            <button type="button" disabled={!!busy} onClick={() => dismiss(false)}>取消</button>
            <button type="button" className="primary" disabled={!!busy || writeDisabled} onClick={event => confirm(event.nativeEvent)}>{busy === 'save' ? '正在保存…' : '确认并保存到 Polarion'}</button>
          </div>
        </div>
      </div>}
    </div>, layer)}
  </>;
}

/** The hover card is a non-interactive summary of the corresponding finding in the results panel. */
export function QualityLintCard({ issue, left, top }: { issue: LintIssue; left: number; top: number }) {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = card.current!;
    const frame = element.closest('.rich-layer')?.querySelector('.rich-workbench') ?? null;
    return trackPlacement(() => {
      const area = visibleEditorBounds(frame);
      const width = Math.max(1, Math.min(320, area.right - area.left));
      element.style.width = `${width}px`;
      element.style.left = `${Math.max(area.left, Math.min(left, area.right - width))}px`;
      element.style.top = `${Math.max(area.top, Math.min(top, area.bottom - element.offsetHeight))}px`;
    }, frame);
  }, [issue, left, top]);
  return <div ref={card} className="psb-quality-card" role="status" style={{ position: 'fixed' }}>
    <header><span className={issue.severity}>{severityLabel[issue.severity]}</span><strong>{issue.matchedText ? `「${issue.matchedText}」` : '条目级发现'}</strong></header>
    <p>{issue.message}</p>
    {issue.suggestion && <p className="suggest">建议替换为「{issue.suggestion}」</p>}
    <footer>{issue.ruleId} · 本地体检</footer>
  </div>;
}
