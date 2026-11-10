import {parseFragment, serializeOuter, type DefaultTreeAdapterTypes} from 'parse5';
import {canonicalStyle} from './html-equivalence.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

/** 变更对照的最小单元：一个正文块（段落、列表项、表格、图片等）。 */
export type ChangeBlock = {
  kind: 'same' | 'added' | 'removed' | 'modified';
  tag: string;
  /** 未变更块的完整 HTML；左右两栏都要完整展示，不能用占位符省略。 */
  html?: string;
  /** 未变更块的纯文本，供搜索和摘要使用。 */
  text?: string;
  before?: string;
  after?: string;
};

export type ChangeBlockCounts = {added: number; removed: number; modified: number; same: number};

const DROP_TAGS = new Set(['script', 'style', 'template', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math']);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'source', 'wbr']);
/** 顶层容器只用于排版时展开，避免整页被包在一个 div 里导致只有一处变更。 */
const FLATTEN_TAGS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside']);
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'figure', 'figcaption', 'hr', 'img', 'dl', 'dt', 'dd']);

const ALLOWED_TAGS = new Set(['p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'img', 'a', 'blockquote', 'pre', 'code', 'sub', 'sup', 'small', 'big', 'font', 'center', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd']);
const ALLOWED_ATTRS = new Set(['style', 'class', 'rowspan', 'colspan', 'width', 'height', 'align', 'valign', 'src', 'alt', 'title', 'href', 'target', 'rel', 'scope', 'span', 'start', 'type', 'color', 'face', 'size']);
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/)/i;

function textNode(node: Node): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function isElement(node: Node): node is Element {
  return node.nodeName !== '#text' && node.nodeName !== '#comment' && node.nodeName !== '#documentType' && node.nodeName !== '#document';
}

function rawText(node: Node): string {
  if (textNode(node)) return node.value;
  if (!isElement(node)) return '';
  if (DROP_TAGS.has(node.nodeName)) return '';
  const children = 'childNodes' in node ? node.childNodes : [];
  return children.map(rawText).join('');
}

/** 纯文本：压缩空白，保留可读的中文段落。 */
export function textOfHtml(html: string, limit = 6000): string {
  const fragment = parseFragment(html);
  const value = fragment.childNodes.map(rawText).join(' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  return value.length > limit ? value.slice(0, limit) + '…' : value;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function canonicalNode(node: Node): unknown {
  if (textNode(node)) {
    const value = node.value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return value || null;
  }
  if (!isElement(node)) return null;
  if (DROP_TAGS.has(node.nodeName) || node.nodeName === 'body') return null;
  const attrs = (node.attrs ?? [])
    // id 会被 Polarion 宏/编辑器重新生成，不能当成内容变化。
    .filter(attr => attr.name !== 'id' && !/^on/i.test(attr.name))
    .map(attr => [attr.namespace ?? '', attr.name, attr.name === 'style' ? canonicalStyle(attr.value) : attr.name === 'src' ? attr.value.trim() : attr.value])
    .sort((left, right) => JSON.stringify(left.slice(0, 2)).localeCompare(JSON.stringify(right.slice(0, 2))));
  const children = ('childNodes' in node ? node.childNodes : []).map(canonicalNode).filter(value => value !== null && value !== '');
  return [node.nodeName, attrs, children];
}

/** 只比较内容语义：空白、属性顺序、样式声明空格、Polarion 重生成的 id 都不算变更。 */
export function htmlChangeSignature(html: string): string {
  return JSON.stringify(parseFragment(html).childNodes.map(canonicalNode).filter(value => value !== null && value !== ''));
}

export function blocksSignature(block: {tag: string; html: string}): string {
  return block.tag + ':' + htmlChangeSignature(block.html);
}

type RawBlock = {tag: string; html: string; signature: string};

function meaningfulBlock(node: Node): boolean {
  if (textNode(node)) return node.value.replace(/\u00a0/g, ' ').trim().length > 0;
  if (!isElement(node)) return false;
  if (DROP_TAGS.has(node.nodeName)) return false;
  const text = rawText(node).replace(/\u00a0/g, ' ').trim();
  if (text) return true;
  // 只有图片/表格/分隔线等没有文字的块仍然有意义。
  const html = serializeOuter(node).toLowerCase();
  return /<(img|table|hr)\b/.test(html);
}

function collectBlocks(nodes: readonly Node[], out: RawBlock[], depth = 0) {
  for (const node of nodes) {
    if (textNode(node)) {
      if (node.value.replace(/\u00a0/g, ' ').trim()) {
        const html = '<p>' + escapeHtml(node.value) + '</p>';
        out.push({tag: 'p', html, signature: blocksSignature({tag: 'p', html})});
      }
      continue;
    }
    if (!isElement(node) || DROP_TAGS.has(node.nodeName) || node.nodeName === '#comment') continue;
    if (!meaningfulBlock(node)) continue;
    // 纯排版容器展开成子块，保证“第 2 段变了”能够被单独标记。
    const children = 'childNodes' in node ? node.childNodes : [];
    if (depth < 20 && FLATTEN_TAGS.has(node.nodeName) && children.some(child => isElement(child) && BLOCK_TAGS.has(child.nodeName))) {
      collectBlocks(children, out, depth + 1);
      continue;
    }
    const html = serializeOuter(node);
    out.push({tag: node.nodeName, html, signature: blocksSignature({tag: node.nodeName, html})});
  }
}

export function extractBlocks(html: string): RawBlock[] {
  const out: RawBlock[] = [];
  collectBlocks(parseFragment(html).childNodes, out);
  return out;
}

function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  if (a.length * b.length <= 250_000) {
    const rows = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        rows[i]![j] = a[i] === b[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
      }
    }
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) pairs.push([i++, j++]);
      else if (rows[i + 1]![j]! >= rows[i]![j + 1]!) i++;
      else j++;
    }
    return pairs;
  }
  // 超大文档退化为前后缀匹配：至少保留未变更上下文，不阻塞保存。
  let head = 0;
  while (head < Math.min(a.length, b.length) && a[head] === b[head]) { pairs.push([head, head]); head++; }
  const tail: Array<[number, number]> = [];
  let x = a.length - 1, y = b.length - 1;
  while (x >= head && y >= head && a[x] === b[y]) tail.push([x--, y--]);
  return [...pairs, ...tail.reverse()];
}

function sameBlock(block: RawBlock): ChangeBlock {
  const tag = block.tag;
  const text = tag === 'table' ? textOfHtml(block.html, 2000) : /<img\b/i.test(block.html) ? '[图片]' : textOfHtml(block.html);
  // html 用于左右两栏完整展示；text 仅用于搜索和摘要，不能拿它替代完整内容。
  return {kind: 'same', tag, text, html: block.html};
}

/** 计算一个工作项正文的块级差异。输入是两次快照的原始 HTML。 */
export function diffItemHtml(beforeHtml: string, afterHtml: string): {blocks: ChangeBlock[]; counts: ChangeBlockCounts; changed: boolean} {
  if (htmlChangeSignature(beforeHtml) === htmlChangeSignature(afterHtml)) {
    const blocks = extractBlocks(afterHtml);
    return {blocks: blocks.map(sameBlock), counts: {added: 0, removed: 0, modified: 0, same: blocks.length}, changed: false};
  }
  const before = extractBlocks(beforeHtml), after = extractBlocks(afterHtml);
  const pairs = lcsPairs(before.map(block => block.signature), after.map(block => block.signature));
  const blocks: ChangeBlock[] = [];
  const counts: ChangeBlockCounts = {added: 0, removed: 0, modified: 0, same: 0};
  let ai = 0, bi = 0;
  const similarity = (left: RawBlock, right: RawBlock) => {
    const a = textOfHtml(left.html, 4000), b = textOfHtml(right.html, 4000);
    if (!a && !b) return left.signature === right.signature ? 1 : 0;
    if (!a || !b) return 0;
    let prefix = 0;
    while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    return (prefix + suffix) / Math.max(a.length, b.length, 1);
  };
  const emitModified = (oldBlock: RawBlock, newBlock: RawBlock) => {
    blocks.push({kind: 'modified', tag: newBlock.tag, before: oldBlock.html, after: newBlock.html});
    counts.modified++;
  };
  /**
   * LCS 只保证完全相同的块配对；编辑后结构变化（段落拆分/合并、标签变化）会让整段落入
   * remove + add，用户看到的就是“全删了再全加”。这里对剩余块按文字相似度补配对，
   * 只有真正无关的块才标记为删除/新增。
   */
  const flushGap = (oldEnd: number, newEnd: number) => {
    const oldBlocks = before.slice(ai, oldEnd), newBlocks = after.slice(bi, newEnd);
    if (!oldBlocks.length && !newBlocks.length) return;
    if (oldBlocks.length === 1 && newBlocks.length === 1) { emitModified(oldBlocks[0]!, newBlocks[0]!); return; }
    if (oldBlocks.length === 1 && newBlocks.length > 1) {
      const merged: RawBlock = {tag: newBlocks[0]!.tag, html: newBlocks.map(block => block.html).join(''), signature: ''};
      if (similarity(oldBlocks[0]!, merged) >= 0.35) { emitModified(oldBlocks[0]!, merged); return; }
    }
    if (oldBlocks.length > 1 && newBlocks.length === 1) {
      const merged: RawBlock = {tag: oldBlocks[0]!.tag, html: oldBlocks.map(block => block.html).join(''), signature: ''};
      if (similarity(merged, newBlocks[0]!) >= 0.35) { emitModified(merged, newBlocks[0]!); return; }
    }
    const candidates: Array<{oldIndex: number; newIndex: number; score: number}> = [];
    for (const [oldIndex, oldBlock] of oldBlocks.entries()) {
      for (const [newIndex, newBlock] of newBlocks.entries()) {
        const score = similarity(oldBlock, newBlock);
        if (score >= 0.35) candidates.push({oldIndex, newIndex, score});
      }
    }
    candidates.sort((left, right) => right.score - left.score || left.oldIndex - right.oldIndex || left.newIndex - right.newIndex);
    const usedOld = new Set<number>(), usedNew = new Set<number>(), pairs = new Map<number, number>();
    for (const candidate of candidates) {
      if (usedOld.has(candidate.oldIndex) || usedNew.has(candidate.newIndex)) continue;
      usedOld.add(candidate.oldIndex); usedNew.add(candidate.newIndex); pairs.set(candidate.oldIndex, candidate.newIndex);
    }
    for (const [oldIndex, oldBlock] of oldBlocks.entries()) {
      const newIndex = pairs.get(oldIndex);
      if (newIndex !== undefined) emitModified(oldBlock, newBlocks[newIndex]!);
      else { blocks.push({kind: 'removed', tag: oldBlock.tag, before: oldBlock.html}); counts.removed++; }
    }
    for (const [newIndex, newBlock] of newBlocks.entries()) {
      if (!usedNew.has(newIndex)) { blocks.push({kind: 'added', tag: newBlock.tag, after: newBlock.html}); counts.added++; }
    }
  };
  for (const [i, j] of [...pairs, [before.length, after.length] as [number, number]]) {
    flushGap(i, j);
    if (i < before.length && j < after.length) {
      blocks.push(sameBlock(before[i]!));
      counts.same++;
    }
    ai = i + 1; bi = j + 1;
  }
  return {blocks, counts, changed: counts.added + counts.removed + counts.modified > 0};
}

/* ------------------------------------------------------------------ */
/* 安全渲染：Polarion 正文可能包含宏、图片引用和外部链接，分享页必须净化。 */
/* ------------------------------------------------------------------ */

function safeStyle(value: string): string {
  return canonicalStyle(value).replace(/expression\s*\([^)]*\)/gi, '').replace(/javascript\s*:/gi, '').replace(/behavior\s*:/gi, '').replace(/position\s*:\s*fixed/gi, '');
}

function sanitizeAttrs(el: Element, tag: string, keepImageRefs = false): string {
  const parts: string[] = [];
  for (const attr of el.attrs ?? []) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name) || /^on/i.test(name)) continue;
    let value = attr.value;
    if (name === 'style') value = safeStyle(value);
    if (name === 'href' && !SAFE_URL.test(value.trim())) continue;
    if (name === 'src' && !/^data:image\//i.test(value) && !(keepImageRefs && /^(workitemimg:|attachment:)/i.test(value))) continue;
    parts.push(`${name}="${escapeHtml(value)}"`);
  }
  if (tag === 'a') {
    if (!parts.some(part => part.startsWith('target='))) parts.push('target="_blank"');
    parts.push('rel="noopener noreferrer"');
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

const IMG_MISSING = '<span class="cw-img-missing">[图片：需在 Polarion 中查看]</span>';

/** 输出仅含白名单标签的内联 HTML；宏容器展开为内容，危险节点整体丢弃。 */
export function sanitizeBlockHtml(html: string, maxNodes = 5000, keepImageRefs = false): string {
  const fragment = parseFragment(html);
  let visited = 0, truncated = false;
  const render = (node: Node): string => {
    if (++visited > maxNodes) { truncated = true; return ''; }
    if (textNode(node)) return escapeHtml(node.value);
    if (!isElement(node)) return '';
    const tag = node.nodeName.toLowerCase();
    if (DROP_TAGS.has(tag)) return '';
    if (tag === 'img') {
      const src = (node.attrs ?? []).find(attr => attr.name === 'src')?.value ?? '';
      const allowed = /^data:image\//i.test(src) || (keepImageRefs && /^(workitemimg:|attachment:)/i.test(src));
      if (!allowed) return IMG_MISSING;
      const attrs = sanitizeAttrs(node, tag, keepImageRefs);
      return `<img${attrs}${/\balt=/.test(attrs) ? '' : ' alt=""'}/>`;
    }
    const children = ('childNodes' in node ? node.childNodes : []).map(render).join('');
    if (!ALLOWED_TAGS.has(tag)) return children;
    if (VOID_TAGS.has(tag)) return `<${tag}${sanitizeAttrs(node, tag)}/>`;
    return `<${tag}${sanitizeAttrs(node, tag)}>${children}</${tag}>`;
  };
  const output = fragment.childNodes.map(render).join('');
  return truncated ? output + '<p class="cw-truncated">…内容过长，对照视图已截断；完整内容请在 Polarion 中查看。</p>' : output;
}

export function collectImageSources(html: string): string[] {
  const sources = new Set<string>();
  for (const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) if (match[1]) sources.add(match[1]);
  return [...sources];
}

/** 把已解析出的图片替换成内嵌 data URL；无法解析的图片显示明确占位，不留破图。 */
export function resolveImages(html: string, images: Record<string, string>): string {
  return html.replace(/<img\b[^>]*\/?>/gi, tag => {
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    const data = images[src];
    if (!data) return IMG_MISSING;
    return tag.replace(/\bsrc\s*=\s*"[^"]*"/i, `src="${data}"`);
  });
}

/** 章节路径：outline 去掉末尾 `-n` 后的前两段。 */
export function outlineBase(outline: string): string {
  return (outline || '').replace(/-\d+$/, '');
}

export function chapterOf(outline: string): string {
  return outlineBase(outline).split('.').filter(Boolean)[0] ?? '0';
}
