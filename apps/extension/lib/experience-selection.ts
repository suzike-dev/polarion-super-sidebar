import type { ExperienceRefineMessage } from '../../../packages/protocol/index.ts';

export type ExperienceSource = 'saved' | 'proposal' | 'diff';
export type ExperienceQuote = { text: string; before: string; after: string; location: string };

/** Document.getRangeAt can expose only the shadow host. Use endpoints scoped to the panel's root. */
function selectedRange(surface: HTMLElement): Range | null {
  const doc = surface.ownerDocument;
  const root = surface.getRootNode();
  const shadow = 'host' in root ? root as ShadowRoot & { getSelection?: () => Selection | null } : null;
  const selection = doc.getSelection();
  const composed = shadow && selection?.getComposedRanges?.({ shadowRoots: [shadow] });
  const scoped = shadow?.getSelection?.();
  const bounds = composed?.[0] ?? (scoped?.rangeCount ? scoped.getRangeAt(0) : selection?.rangeCount ? selection.getRangeAt(0) : null);
  if (!bounds || bounds.collapsed || !surface.contains(bounds.startContainer) || !surface.contains(bounds.endContainer)) return null;
  const range = doc.createRange();
  range.setStart(bounds.startContainer, bounds.startOffset);
  range.setEnd(bounds.endContainer, bounds.endOffset);
  return range;
}

export const experienceHistoryLimit = 24;

export function formatExperienceIntent(ask: string, quote?: ExperienceQuote | null): string {
  if (!quote) return ask.trim();
  return [`引用来源：${quote.location}`, `前文：${quote.before}`, `选中文字：\n${quote.text}`, `后文：${quote.after}`, `修改意图：${ask.trim()}`].join('\n\n');
}

// experience.refine validates string.length on the full wire message, including citation metadata.
export function experienceLimitError(base: string, intent: string): string {
  if (base.length > 20000) return `当前全文长度 ${base.length}，超过 20000 上限。请先缩短基准稿。`;
  if (intent.length > 4000) return `本条消息长度 ${intent.length}（含引用与前后文），超过 4000 上限。请缩短输入或重新划选较短的片段。`;
  return '';
}

export function experienceHistory(chat: readonly (ExperienceRefineMessage & { quote?: ExperienceQuote })[], intent: string): ExperienceRefineMessage[] {
  return [...chat.slice(1 - experienceHistoryLimit).map(({ role, text, quote }) => ({ role, text: formatExperienceIntent(text, quote) })), { role: 'user', text: intent }];
}

const sources = { saved: '已保存经验', proposal: '新版预览（待应用修改稿）', diff: '差异视图' };
const blocks = 'address,article,blockquote,div,dl,dt,dd,h1,h2,h3,h4,h5,h6,hr,li,ol,p,pre,table,tr,ul';
const controls = 'button:not(.workitem-ref),summary,details:not([open]),.katex-mathml,.experience-dl-sign,svg,[hidden]';

/** Map actual DOM boundaries into one projection of the displayed text. Never re-find the selected words by value. */
export function captureExperienceSelection(surface: HTMLElement, source: ExperienceSource): ExperienceQuote | null {
  const selection = selectedRange(surface);
  if (!selection) return null;
  const range: Range = selection;
  let body = '', start = -1, end = -1, breakBeforeText = false;
  const diffLabels: string[] = [];
  function visit(node: Node) {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? '';
      if (!text || (!text.trim() && node.parentElement?.matches('ul,ol,blockquote,table,thead,tbody,tr,.assistant-message'))) return;
      if (breakBeforeText && body && !body.endsWith('\n')) body += '\n';
      breakBeforeText = false;
      if (range.intersectsNode(node)) {
        const from = node === range.startContainer ? range.startOffset : 0;
        const to = node === range.endContainer ? range.endOffset : text.length;
        if (from < to) {
          if (start === -1) start = body.length + from;
          end = body.length + to;
        }
      }
      body += text;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(controls)) return;
    if (element.tagName === 'BR') { body += '\n'; breakBeforeText = false; return; }
    const label = element.getAttribute('data-experience-line');
    const block = element.matches(blocks);
    if (label !== null) {
      if (diffLabels.length) body += '\n';
      diffLabels.push(label);
      breakBeforeText = false;
    } else if (block) breakBeforeText = true;
    else if (element.matches('td,th') && element.previousElementSibling) body += '\t';
    for (const child of element.childNodes) visit(child);
    if (block) breakBeforeText = true;
  }
  visit(surface);
  if (start < 0 || !body.slice(start, end).trim()) return null;
  const before = body.slice(0, start), text = body.slice(start, end);
  const firstLine = before.split('\n').length;
  const lastLine = firstLine + text.split('\n').length - 1;
  const column = (offset: number) => offset - body.lastIndexOf('\n', offset - 1);
  const position = `渲染正文第 ${firstLine} 行第 ${column(start)} 列至第 ${lastLine} 行第 ${column(end - 1)} 列`;
  const lines = diffLabels.slice(firstLine - 1, lastLine).join('、');
  return { location: `${sources[source]} · ${position}${lines ? `（${lines}）` : ''}`, text, before: before.slice(-80), after: body.slice(end, end + 80) };
}
