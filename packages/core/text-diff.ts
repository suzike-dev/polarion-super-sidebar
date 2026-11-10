export type TextDiffSegment = {kind: 'same' | 'del' | 'ins'; text: string};
export type TextDiffPart = {kind: 'same'; text: string} | {kind: 'change'; id: number; before?: string; after?: string};

/**
 * 块内文字差异：中文按字、英文按词、空白按段切 token，再做 LCS。
 * 变更组把同一处的删除/新增合并成一个 id，供左右联动和悬停对照使用。
 */
export function diffTextParts(before: string, after: string): TextDiffPart[] {
  if (before === after) return before ? [{kind: 'same', text: before}] : [];
  const a = tokenize(before), b = tokenize(after);
  if (!a.length || !b.length || a.length * b.length > 4_000_000 || a.length > 6000 || b.length > 6000) {
    return fallbackParts(before, after);
  }
  const rows = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i]![j] = a[i] === b[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
    }
  }
  const parts: TextDiffPart[] = [];
  const pushSame = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === 'same') last.text += text;
    else parts.push({kind: 'same', text});
  };
  let i = 0, j = 0, id = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      let text = '';
      while (i < a.length && j < b.length && a[i] === b[j]) text += a[i++], j++;
      pushSame(text);
      continue;
    }
    let deleted = '', inserted = '';
    while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i] === b[j])) {
      if (i < a.length && (j >= b.length || rows[i + 1]![j]! >= rows[i]![j + 1]!)) deleted += a[i++]!;
      else if (j < b.length) inserted += b[j++]!;
      else break;
    }
    if (deleted || inserted) parts.push({kind: 'change', id: ++id, ...(deleted ? {before: deleted} : {}), ...(inserted ? {after: inserted} : {})});
  }
  return parts;
}

/** 兼容块级渲染：把变更组拆成左右两套 segment。 */
export function diffText(before: string, after: string): {before: TextDiffSegment[]; after: TextDiffSegment[]} {
  const parts = diffTextParts(before, after);
  const beforeSegments: TextDiffSegment[] = [], afterSegments: TextDiffSegment[] = [];
  for (const part of parts) {
    if (part.kind === 'same') {
      beforeSegments.push({kind: 'same', text: part.text});
      afterSegments.push({kind: 'same', text: part.text});
    } else {
      if (part.before) beforeSegments.push({kind: 'del', text: part.before});
      if (part.after) afterSegments.push({kind: 'ins', text: part.after});
    }
  }
  return {before: beforeSegments, after: afterSegments};
}

function tokenize(value: string): string[] {
  return value.match(/\s+|[A-Za-z0-9_]+|[\u3400-\u9fff]|[^\s]/g) ?? [];
}

function fallbackParts(before: string, after: string): TextDiffPart[] {
  let prefix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < Math.min(before.length, after.length) - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const head = before.slice(0, prefix), tail = before.slice(before.length - suffix);
  const beforeMiddle = before.slice(prefix, before.length - suffix);
  const afterMiddle = after.slice(prefix, after.length - suffix);
  const parts: TextDiffPart[] = [];
  if (head) parts.push({kind: 'same', text: head});
  if (beforeMiddle || afterMiddle) parts.push({kind: 'change', id: 1, ...(beforeMiddle ? {before: beforeMiddle} : {}), ...(afterMiddle ? {after: afterMiddle} : {})});
  if (tail) parts.push({kind: 'same', text: tail});
  return parts;
}
