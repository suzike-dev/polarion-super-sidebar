import { Marked, Renderer } from 'marked';

/** Markdown 源文识别 + 转编辑器可用 HTML。粘贴纯文本时命中即按富文本结构插入（飞书同款体验）。 */
const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = (value: string) => escapeText(value).replaceAll('"', '&quot;');

/** 启发式判定：多特征叠加才算 Markdown，避免把带星号的普通说明文字误转换。 */
export function looksLikeMarkdown(text: string): boolean {
  if (text.length < 5 || text.length > 200_000) return false;
  if (/^ {0,3}(?:`{3,}|~{3,})/m.test(text) || /==[^=\s\n][^=\n]*==/.test(text)) return true;
  if (/!\[[^\]\n]*\](?:\([^\n)]+\)|\[[^\]\n]*\])/.test(text) || /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/m.test(text)) return true;
  let score = 0;
  if (/^#{1,6}\s+\S/m.test(text)) score += 2;
  // 带分隔行的 GFM 表格是决定性特征；单管道行只作弱信号。
  if (/^\s*\|[\s:|-]*-{2,}[\s:|-]*\|?\s*$/m.test(text)) score += 4;
  else if (/^\s*\|.+\|\s*$/m.test(text) && /\|/.test((text.match(/^\s*\|.+\|\s*$/m)?.[0] ?? '').slice(1, -1))) score += 2;
  if (/\*\*[^*\n]+\*\*/.test(text)) score += 2;
  if (/^\s*[-*+]\s+\S/m.test(text) && (text.match(/^\s*[-*+]\s+\S/gm) ?? []).length >= 2) score += 2;
  if (/^\s*\d+[.)]\s+\S/m.test(text) && (text.match(/^\s*\d+[.)]\s+\S/gm) ?? []).length >= 2) score += 1;
  if (/^\s*>\s?\S/m.test(text)) score += 1;
  if (/`[^`\n]+`/.test(text)) score += 1;
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/m.test(text)) score += 1;
  if (/~~[^~\n]+~~/.test(text)) score += 1;
  if (/\[[^\]\n]+\]\((https?:\/\/|mailto:|#|\/)[^)\n]*\)/.test(text)) score += 1;
  return score >= 3;
}

function formulaHtml(tex: string, block: boolean) {
  const value = tex.trim().slice(0, 4000);
  const tag = block ? 'div' : 'span';
  return `<${tag} data-sidebar-formula="${block ? 'block' : 'inline'}" data-tex="${escapeAttr(value)}">${escapeText(value)}</${tag}>`;
}

// Tokenize at the Markdown boundary so fences, code spans and escaped delimiters stay literal.
const marked = new Marked({ gfm: true, breaks: false, extensions: [
  {
    name: 'blockFormula', level: 'block', start: src => src.indexOf('\n$$'),
    tokenizer(src) {
      const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
      if (match?.[1]?.trim()) return { type: 'blockFormula', raw: match[0], text: match[1] };
    },
    renderer: token => formulaHtml(token.text, true),
  },
  {
    name: 'inlineFormula', level: 'inline', start: src => src.indexOf('$'),
    tokenizer(src) {
      const match = /^\$([\\A-Za-z(][^$\n]*)\$/.exec(src);
      if (match) return { type: 'inlineFormula', raw: match[0], text: match[1] };
    },
    renderer: token => formulaHtml(token.text, false),
  },
  {
    name: 'highlight', level: 'inline', start: src => src.indexOf('=='),
    tokenizer(src) {
      const match = /^==([^=\n]+)==/.exec(src);
      if (match) return { type: 'highlight', raw: match[0], text: match[1] };
    },
    renderer: token => `<span style="background-color:#fff3c4">${escapeText(token.text)}</span>`,
  },
], renderer: {
  list(list) {
    if (!list.items.some(item => item.task)) return false;
    // The schema requires homogeneous lists. Keep ordinary siblings as their own list.
    let html = '';
    for (let from = 0; from < list.items.length;) {
      const task = list.items[from]!.task;
      let end = from + 1;
      while (end < list.items.length && list.items[end]!.task === task) end++;
      const items = list.items.slice(from, end);
      if (task) {
        html += '<ul data-sidebar-tasks="true">' + items.map(item =>
          `<li data-sidebar-task="true" data-checked="${!!item.checked}"><div data-task-content="true">${this.parser.parse(item.tokens, true)}</div></li>`
        ).join('') + '</ul>\n';
      } else {
        html += Renderer.prototype.list.call(this, { ...list, items, start: list.ordered ? Number(list.start) + from : '' });
      }
      from = end;
    }
    return html;
  },
} });

/** Markdown → 编辑器 HTML。支持的内嵌位图交给现有图片导入流程处理。 */
export function markdownToHtml(text: string): string {
  return marked.parse(text, { async: false }).replace(/\s(href|src)="((?:javascript|vbscript|data):[^"]*)"/gi, (_match, attr: string, url: string) => {
    if (attr.toLowerCase() === 'src' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return ` src="${url}"`;
    return attr.toLowerCase() === 'href' ? ' href="#"' : ' src=""';
  });
}
