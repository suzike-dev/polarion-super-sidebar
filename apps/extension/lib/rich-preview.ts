import { macroNameOf, type SourceNode } from '../../../packages/core/lossless-html.ts';
import type { Target } from '../../../packages/protocol/index';
import {headingSizes} from '../../../packages/core/document-presentation.ts';
import {highlightToHtml, highlightThemeCss} from '../../../packages/core/code-highlight.ts';
import katex from 'katex';
import {detectBoardCode} from './board-code.ts';
const tags = new Set('a b blockquote br caption code col colgroup details div em font h1 h2 h3 h4 h5 h6 hr i img li mark ol p pre s span strong sub summary sup table tbody td tfoot th thead tr u ul'.split(' '));
const cssProperties = new Set('color background-color font-family font-size font-weight font-style text-decoration text-align vertical-align white-space width min-width max-width height min-height max-height border border-top border-right border-bottom border-left border-width border-style border-color border-collapse border-spacing border-radius padding padding-left padding-right padding-top padding-bottom margin margin-left margin-right margin-top margin-bottom line-height list-style-type'.split(' '));
const attrs = new Set(['colspan', 'rowspan', 'span', 'width', 'height', 'align', 'valign', 'start', 'reversed', 'type', 'alt', 'title', 'color', 'face', 'size', 'data-source-node', 'data-protected', 'data-review-change', 'data-sidebar-formula', 'data-tex', 'data-sidebar-details', 'data-sidebar-callout', 'data-sidebar-tasks', 'data-sidebar-task', 'data-checked', 'data-task-marker', 'data-task-content', 'open']);
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Display-only transformation. This HTML must never be used as the source of a save. */
export function richPreview(source: string, nodes: readonly SourceNode[], target: Target, Parser: typeof DOMParser = DOMParser) {
  return richPreviewDocument(source, nodes, target, Parser).html;
}

export function richPreviewDocument(source: string, nodes: readonly SourceNode[], target: Target, Parser: typeof DOMParser = DOMParser) {
  const edits: { start: number; end: number; html: string }[] = [];
  const opaque = nodes.filter(n => { const macro = macroNameOf(n.polarionId); return macro !== null && macro !== 'table'; });
  const outerOpaque = opaque.filter(n => !opaque.some(parent => parent !== n && parent.start <= n.start && parent.end >= n.end));
  for (const n of outerOpaque) edits.push({ start: n.start, end: n.end, html: '<span data-protected="true">受保护的 Polarion 内容 · 原始片段保留</span>' });
  for (const n of nodes) if (n.text?.trim() && !outerOpaque.some(p => p.start <= n.start && p.end >= n.end)) edits.push({ start: n.start, end: n.end, html: `<span data-source-node="${escape(n.id)}">${source.slice(n.start, n.end)}</span>` });
  let html = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.html + html.slice(edit.end);
  const parsed = new Parser().parseFromString(html, 'text/html');
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    const workItem = tag === 'span' && (!element.hasAttribute('data-type') || element.getAttribute('data-type')?.toLowerCase() === 'workitem') ? element.getAttribute('data-item-id')?.trim() : undefined;
    if (!tags.has(tag)) { element.replaceWith(parsed.createTextNode(['script', 'style', 'iframe', 'object', 'embed'].includes(tag) ? '[受保护内容]' : element.textContent ?? '')); continue; }
    for (const attr of Array.from(element.attributes)) {
      const key = attr.name.toLowerCase();
      if (key === 'style') {
        const style = (element as HTMLElement).style;
        for (const property of Array.from(style)) if (!cssProperties.has(property) || /url\s*\(|expression\s*\(|@import/i.test(style.getPropertyValue(property))) style.removeProperty(property);
      } else if (key === 'src' && tag === 'img') {
        if(/^(polarion-asset:|workitemimg:|attachment:)/.test(attr.value)){element.setAttribute('data-image-source',attr.value);element.removeAttribute('src');continue;}
        try { const url = new URL(attr.value, target.origin + '/polarion/'); if (url.origin !== target.origin && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(attr.value)) element.removeAttribute(key); else element.setAttribute(key, url.href); } catch { element.removeAttribute(key); }
      } else if (key === 'href' && tag === 'a') {
        try { const url = new URL(attr.value, target.origin + '/polarion/'); if (!['https:', 'http:'].includes(url.protocol)) element.removeAttribute(key); else element.setAttribute(key, url.href); } catch { element.removeAttribute(key); }
      } else if (key === 'class' && tag === 'code') {
        const lang=attr.value.split(/\s+/).find(value=>/^language-[\w+-]{1,40}$/.test(value));
        if(lang)element.setAttribute('class',lang);else element.removeAttribute(key);
      } else if (!attrs.has(key)) element.removeAttribute(key);
    }
    // 原生引用是空 span，由 Polarion 脚本补文字；本地预览自己补上编号并保留可点击标记。
    if (workItem) {
      const button = parsed.createElement('button');
      button.type = 'button'; button.className = 'preview-workitem-ref';
      button.setAttribute('data-workitem-ref', workItem); button.textContent = workItem;
      element.replaceChildren(button);
    }
  }
  // Keep explicit source table widths inside a local scroll region. This wrapper is
  // display-only, added after sanitization, and never becomes editable/save content.
  for (const table of Array.from(parsed.body.querySelectorAll('table'))) {
    if (table.parentElement?.closest('table')) continue;
    const wrapper = parsed.createElement('div');
    wrapper.className = 'preview-table';
    table.replaceWith(wrapper); wrapper.append(table);
  }
  // 代码高亮：渲染层装饰，写回内容不受影响。
  for (const code of Array.from(parsed.body.querySelectorAll('pre > code'))) {
    const language = Array.from(code.classList).find(c => c.startsWith('language-'))?.slice(9) ?? '';
    const text=code.textContent??'';
    if(detectBoardCode(language,text)){
      const open=parsed.createElement('button');open.type='button';open.setAttribute('data-open-board','');open.textContent='在画板中打开';
      code.parentElement!.after(open);
    }
    const highlighted = highlightToHtml(text, language);
    if (highlighted !== null) code.innerHTML = highlighted;
  }
  // 公式：KaTeX MathML 输出（浏览器原生渲染，无需字体资源）；失败时保留等宽源码文本。
  for (const formula of Array.from(parsed.body.querySelectorAll('[data-sidebar-formula]'))) {
    const tex = formula.getAttribute('data-tex') ?? formula.textContent ?? '';
    const block = formula.getAttribute('data-sidebar-formula') === 'block';
    try { formula.innerHTML = katex.renderToString(tex, { output: 'mathml', throwOnError: false, displayMode: block }); formula.classList.add(block ? 'formula-block' : 'formula-inline'); } catch { /* 保留源码 */ }
  }
  const hasContent = /[^\s\u200b-\u200d\u2060\ufeff]/u.test(parsed.body.textContent ?? '') || !!parsed.body.querySelector('img, table, hr, [data-sidebar-formula], [data-workitem-ref], [data-protected]');
  const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://polarion.pufafen.com data: blob:; style-src 'unsafe-inline'"><style>
html{min-height:100%;background:#fff}
body{font:10pt/1.5 'Segoe UI',Selawik,'Open Sans',Arial,sans-serif;color:#000000;margin:0;padding:24px 28px;box-sizing:border-box;min-width:0;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.5;margin:0}h1,h2,h3{line-height:1.2}
${headingSizes.map((size,i)=>`h${i+1}{font-size:${size}pt;font-weight:600}`).join('')}
body> :first-child{margin-top:0}
table{border-collapse:collapse;max-width:100%}
.preview-table{max-width:100%;overflow:auto;margin:12px 0;scrollbar-width:thin;scrollbar-color:#b9c7d8 transparent}
td,th{border:1px solid #cbd6e5;padding:9px 11px;min-width:48px;vertical-align:top;font-size:13px}
th{background:#edf3fb;font-weight:600;text-align:left}
img{max-width:100%;height:auto}
p{margin:0}
ul,ol{padding-left:26px;margin:10px 0}
li>p{margin:3px 0}
a{color:#2c67b4;text-decoration:underline;text-underline-offset:3px}
blockquote{border-left:3px solid #87a9d4;background:#f6f9fd;padding:12px 17px;margin:16px 0}
code{background:#eef2f7;padding:2px 5px;color:#af4e66;font-size:.92em;font-family:Consolas,monospace}
[data-source-node]{cursor:text;border-radius:2px}
[data-source-node]:hover{background:#eaf2fd;outline:1px dashed #9dbce5}
[data-protected]{display:inline-block;padding:8px 12px;border:1px dashed #c6d2e3;border-radius:5px;background:#f4f6f9;color:#5b6e85;font-size:12px}
.preview-workitem-ref{display:inline-block;padding:0 5px;border:1px solid #e6d5bb;border-radius:4px;background:#fbf4e8;color:#7a5316;font-size:12.5px;white-space:nowrap;cursor:pointer;text-decoration:none}
.preview-workitem-ref{font-family:inherit;line-height:inherit}
.preview-workitem-ref:hover,.preview-workitem-ref:focus-visible{background:#f6ead4;border-color:#d9c19c}
pre{white-space:pre-wrap;max-width:100%;overflow:auto}
${highlightThemeCss}
[data-sidebar-formula]{font-family:Consolas,'Courier New',monospace}
.formula-block{display:block;margin:10px 0;padding:8px 12px;background:#f6f8fa;overflow-x:auto}
.formula-inline{padding:0 3px}
details[data-sidebar-details]{margin:12px 0;border:1px solid #d7e1ed;border-radius:4px;padding:0}
details[data-sidebar-details]>summary{padding:8px 12px;font-weight:600;cursor:pointer;color:#22577a}
ul[data-sidebar-tasks]{list-style:none;padding-left:6px}
ul[data-sidebar-tasks] li[data-sidebar-task]{position:relative;padding-left:22px;margin:4px 0}
ul[data-sidebar-tasks] li[data-sidebar-task]>span[data-task-marker]{position:absolute;left:0;top:0}
img{cursor:zoom-in}
@media(max-width:600px){body{padding:18px 16px}}
</style></head><body>${parsed.body.innerHTML}</body></html>`;
  return { html: documentHtml, hasContent };
}
