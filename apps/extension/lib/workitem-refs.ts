/**
 * 回答里的工作项编号（如 SPE-950 / TEST-729）转成可点击节点。
 * 只在普通文本节点内识别，跳过代码块、行内代码、已有链接与 HTML，避免误改。
 */
const WORK_ITEM = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9_]{1,23}-\d{1,7})(?![A-Za-z0-9_-])/g;
const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'html', 'image']);

type Node = { type: string; value?: string; url?: string; children?: Node[] };

function splitText(value: string): Node[] {
  const parts: Node[] = [];
  let last = 0;
  for (const match of value.matchAll(WORK_ITEM)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: 'text', value: value.slice(last, index) });
    parts.push({ type: 'link', url: 'workitem:' + match[1]!, children: [{ type: 'text', value: match[1]! }] });
    last = index + match[1]!.length;
  }
  if (!parts.length) return [{ type: 'text', value }];
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

/** 原地改写 mdast 树，返回是否发生了替换。 */
export function linkifyWorkItems(node: Node): boolean {
  if (!node.children?.length) return false;
  let changed = false;
  const next: Node[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      const parts = splitText(child.value);
      if (parts.length > 1 || parts[0]?.type === 'link') { next.push(...parts); changed = true; }
      else next.push(child);
      continue;
    }
    if (SKIP.has(child.type)) { next.push(child); continue; }
    if (child.children && linkifyWorkItems(child)) changed = true;
    next.push(child);
  }
  node.children = next;
  return changed;
}

/** 把渲染后的表格还原成 Markdown，保留单元格文字并转义竖线。 */
export function tableToMarkdown(table: HTMLTableElement): string {
  const rows = [...table.rows].map(row => [...row.cells].map(cell => (cell.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ')));
  if (!rows.length) return '';
  const header = rows[0]!;
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows.slice(1)) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}
