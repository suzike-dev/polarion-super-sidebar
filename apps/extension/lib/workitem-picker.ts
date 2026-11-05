/** 输入框里的 @ 工作项查询：只识别结尾的 @片段；中文/全角标点后可触发，邮箱仍不误伤。 */
const QUERY = /(?<![A-Za-z0-9._%+-])@([A-Za-z0-9_-]*)$/u;
const WORK_ITEM = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9_]{1,23}-\d{1,7})(?![A-Za-z0-9_-])/g;

export function matchWorkItemQuery(value: string): string | null {
  const match = value.match(QUERY);
  return match ? match[1] ?? '' : null;
}

/** 把结尾的 @ 查询替换成选中的工作项编号，保留原有文字。 */
export function applyWorkItemPick(value: string, workItemId: string): string {
  const match = value.match(QUERY);
  if (!match) return value;
  return value.slice(0, value.length - (match[1] ?? '').length - 1) + workItemId + ' ';
}

export type TextPart = { text: string } | { workItemId: string };

/** 把一段普通文字按工作项编号切分，供用户消息渲染成可点击 chip。 */
export function splitWorkItems(value: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of value.matchAll(WORK_ITEM)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: value.slice(last, index) });
    parts.push({ workItemId: match[1]! });
    last = index + match[1]!.length;
  }
  if (last < value.length) parts.push({ text: value.slice(last) });
  return parts.length ? parts : [{ text: value }];
}
