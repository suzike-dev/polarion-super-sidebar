import { lowlight } from 'lowlight';
import matlab from 'highlight.js/lib/languages/matlab.js';
import verilog from 'highlight.js/lib/languages/verilog.js';
import tcl from 'highlight.js/lib/languages/tcl.js';

/** 代码高亮：只影响渲染层（编辑器装饰/预览/AI 回答），写回 Polarion 的仍是纯 <code> 文本。 */
lowlight.registerLanguage('matlab', matlab);
lowlight.registerLanguage('verilog', verilog);
lowlight.registerLanguage('vhdl', verilog);
lowlight.registerLanguage('tcl', tcl);

export const highlightLanguages = (() => { const list = lowlight.listLanguages(); list.sort(); return list; })();

export function canHighlight(language: string | null | undefined): boolean {
  if (!language) return false;
  const normalized = language.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 40 && lowlight.registered(normalized);
}

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function renderHast(node: HastNode): string {
  if (node.type === 'text') return escapeHtml(node.value ?? '');
  const children = (node.children ?? []).map(renderHast).join('');
  if (node.type !== 'element') return children;
  const classes = node.properties?.className;
  const cls = Array.isArray(classes) ? ` class="${classes.map(String).join(' ')}"` : '';
  return `<${node.tagName ?? 'span'}${cls}>${children}</${node.tagName ?? 'span'}>`;
}

/** 高亮成带 hljs-* class 的 HTML；语言未注册或代码为空时返回 null（调用方回退纯文本）。 */
export function highlightToHtml(code: string, language: string | null | undefined): string | null {
  const normalized = (language ?? '').trim().toLowerCase();
  if (!normalized || !lowlight.registered(normalized) || !code) return null;
  try {
    const tree = lowlight.highlight(normalized, code.slice(0, 200_000));
    return renderHast(tree as unknown as HastNode);
  } catch { return null; }
}

/** 代码高亮配色（森林体系）：编辑器、预览 iframe 与 AI 回答共用同一组令牌。 */
export const highlightThemeCss = `.hljs-comment,.hljs-quote{color:#7c8b7f;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section,.hljs-doctag,.hljs-type,.hljs-name,.hljs-strong{color:#1d5c4a;font-weight:600}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:#5c7a1d}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-variable,.hljs-template-variable,.hljs-attr,.hljs-selector-attr{color:#9a5b16}
.hljs-title,.hljs-title.function_,.hljs-title.class_,.hljs-built_in,.hljs-builtin-name{color:#22577a;font-weight:600}
.hljs-params{color:#31424f}
.hljs-deletion{color:#a13c3c}
.hljs-emphasis{font-style:italic}
.hljs-meta,.hljs-subst{color:#5b6e85}`;
