/**
 * 当前文档里的工作项清单：直接读 Polarion 正文块（module-workitem macro），
 * 供编辑器与对话的 @ 选择器把“本文档所有工作项”排在候选最前面。
 * Polarion 的正文通常在同源 iframe 里，因此这里同时遍历一层层同源 frame。
 */
const BLOCK = /module-workitem;params=id=([^;|]+)/;

export type DocumentWorkItem = { workItemId: string; title: string };

let cached: { at: number; key: string; items: DocumentWorkItem[] } | null = null;

function titleOf(element: HTMLElement) {
  const selfHeading = /^H[1-6]$/.test(element.tagName) ? element : null;
  const field = element.querySelector<HTMLElement>('[id="polarion_editor_field=title"]');
  const heading = element.querySelector<HTMLElement>('h1,h2,h3,h4,h5,h6');
  // 非标题块优先读取隐藏的 title 字段；加载占位文本不能进入候选标题。
  const raw = field?.textContent || selfHeading?.textContent || heading?.textContent || element.textContent || '';
  return raw.replaceAll('\u200b', '')
    .replace(/[A-Z][A-Za-z0-9_]{1,23}-\d{1,7}\s*[-–—:：]\s*正在加载[.…]*/g, '')
    .replace(/正在加载[.…]*/g, '')
    .replace(/^[A-Za-z][A-Za-z0-9_]{1,23}-\d{1,7}\s*[-–—:：]\s*/, '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

function collect(root: ParentNode, seen: Set<string>, depth: number): DocumentWorkItem[] {
  const items: DocumentWorkItem[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[id*="module-workitem;params=id="]'))) {
    const id = element.id.match(BLOCK)?.[1]?.trim();
    if (!id || element.id.includes('|new=1') || seen.has(id)) continue;
    seen.add(id);
    items.push({ workItemId: id, title: titleOf(element) });
  }
  if (depth < 3) {
    for (const frame of Array.from(root.querySelectorAll('iframe'))) {
      let inner: Document | null = null;
      try { inner = (frame as HTMLIFrameElement).contentDocument; } catch { inner = null; }
      if (inner?.body) items.push(...collect(inner, seen, depth + 1));
    }
  }
  return items;
}

export function documentWorkItems(root: ParentNode = document): DocumentWorkItem[] {
  const isPage = typeof document !== 'undefined' && root === document;
  // SPA 切换文档不会刷新页面，缓存必须和当前文档绑定，否则会把上一篇的条目当成“本文档”。
  const key = isPage ? document.location.href : '';
  if (isPage && cached && cached.key === key && Date.now() - cached.at < 5000) return cached.items;
  const items = collect(root, new Set(), 0);
  if (isPage) cached = { at: Date.now(), key, items };
  return items;
}

/** 按编号或标题做本地即时过滤；空查询返回全部。 */
export function filterWorkItems(items: readonly DocumentWorkItem[], query: string): DocumentWorkItem[] {
  const text = query.trim().toLowerCase();
  return text ? items.filter(item => item.workItemId.toLowerCase().includes(text) || item.title.toLowerCase().includes(text)) : [...items];
}
