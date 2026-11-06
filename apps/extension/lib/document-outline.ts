import type {DocumentOutlineItem} from '../../../packages/protocol/index';
/** 章节色相：功能卡三元组——绿 142 / 蓝灰 205 / 沙棕 30，粉彩章带。 */
export const OUTLINE_HUES = [142, 205, 30] as const;
/** 分组色相：章内三级子容器在三元组上偏移 +16°，保持家族一致。 */
export const OUTLINE_GROUP_HUES = [158, 218, 44] as const;
export type OutlineGroup = { num: string; title: string; hue: number; items: DocumentOutlineItem[] };
export type OutlineChapter = { num: string; title: string; hue: number; groups: OutlineGroup[] };

const baseOutline = (outline: string) => (outline || '').replace(/-\d+$/, '');
const segments = (outline: string) => baseOutline(outline).split('.').filter(Boolean);
const numeric = (value: string) => Number(value) || 0;
/**
 * 章节标题判定：优先用 SOAP 返回的 type；若整份数据都没有 type（字段降级），
 * 退回结构规则——LiveDoc 的章节（heading）没有 `-n` 后缀，真实需求才有。
 */
const sectionTest = (items: readonly DocumentOutlineItem[]) => {
  const typeKnown = items.some(item => !!item.type);
  return typeKnown
    ? (item: DocumentOutlineItem) => item.type === 'heading'
    : (item: DocumentOutlineItem) => !/-\d+$/.test(item.outline || '');
};

/**
 * 把平铺的工作项按 outline 序号还原成「章 → 分组 → 条目」。
 * 规则：
 * - 章节条目只提供标题，本身不出条目（否则 199 条章节名会淹没真实需求）。
 * - outline 去掉末尾的 `-n`（子项序号）后再按前两段归组。
 * - 文档根（outline 为空）不是需求，直接丢弃，不参与「未分节」。
 * - 其余没有编号的工作项归入末尾的「未分节」，不允许静默丢失。
 */
export function buildOutlineChapters(items: readonly DocumentOutlineItem[]): OutlineChapter[] {
  const isSection = sectionTest(items);
  const headings = new Map<string, string>();
  for (const item of items) {
    if (isSection(item) && item.outline) headings.set(baseOutline(item.outline), item.title);
  }
  const chapters = new Map<string, Map<string, OutlineGroup>>();
  for (const item of items) {
    if (isSection(item)) continue;
    const path = segments(item.outline);
    // 无编号的真实需求归入「未分节」；无编号的章节已在上面被跳过（文档根）。
    const chapterNum = path[0] ?? '0';
    const groupNum = path.slice(0, 2).join('.') || '0';
    if (!chapters.has(chapterNum)) chapters.set(chapterNum, new Map());
    const buckets = chapters.get(chapterNum)!;
    if (!buckets.has(groupNum)) buckets.set(groupNum, {num: groupNum, title: headings.get(groupNum) ?? '', hue: 0, items: []});
    buckets.get(groupNum)!.items.push(item);
  }
  return [...chapters.entries()]
    // 未分节（0）固定排在最后，其余按章号数值排序。
    .sort(([a], [b]) => (a === '0' ? 1 : b === '0' ? -1 : numeric(a) - numeric(b)))
    .map(([chapterNum, buckets], index) => {
      const groups = [...buckets.values()]
        .sort((a, b) => numeric(a.num.split('.').at(-1) ?? '0') - numeric(b.num.split('.').at(-1) ?? '0'))
        .map((group, groupIndex) => ({
          ...group,
          title: group.title || (group.num === chapterNum ? '' : ''),
          hue: OUTLINE_GROUP_HUES[(index + groupIndex) % OUTLINE_GROUP_HUES.length]!,
        }));
      return {
        num: chapterNum,
        title: headings.get(chapterNum) ?? (chapterNum === '0' ? '未分节' : chapterNum),
        hue: OUTLINE_HUES[index % OUTLINE_HUES.length]!,
        groups,
      };
    });
}

/** 关键字过滤：空查询返回全部；匹配编号或标题。 */
export function filterOutlineChapters(chapters: readonly OutlineChapter[], query: string): OutlineChapter[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...chapters];
  const hit = (item: DocumentOutlineItem) => item.id.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle);
  return chapters
    .map(chapter => ({...chapter, groups: chapter.groups.map(group => ({...group, items: group.items.filter(hit)})).filter(group => group.items.length > 0)}))
    .filter(chapter => chapter.groups.length > 0);
}

export function countOutlineItems(chapters: readonly OutlineChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + chapter.groups.reduce((n, group) => n + group.items.length, 0), 0);
}
