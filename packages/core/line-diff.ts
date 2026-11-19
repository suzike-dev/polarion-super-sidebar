export type LineDiffRow = { kind: 'same' | 'del' | 'ins'; text: string };

/**
 * 行级差异：按行做 LCS，每个改动块先输出删除行再输出新增行（统一 diff 行序）。
 * 行数乘积过大时退化为「整段删除 + 整段新增」，保证任意输入都有可用结果。
 */
export function lineDiff(before: string, after: string): LineDiffRow[] {
  // 空串按零行处理，避免出现「删除一个空行」的幽灵差异。
  const a = before === '' ? [] : before.split('\n'), b = after === '' ? [] : after.split('\n');
  if (before === after) return a.map(text => ({ kind: 'same' as const, text }));
  if (a.length * b.length > 1_000_000) {
    return [...a.map(text => ({ kind: 'del' as const, text })), ...b.map(text => ({ kind: 'ins' as const, text }))];
  }
  const rows = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i]![j] = a[i] === b[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
    }
  }
  const out: LineDiffRow[] = [];
  let dels: string[] = [], inss: string[] = [];
  const flush = () => {
    for (const text of dels) out.push({ kind: 'del', text });
    for (const text of inss) out.push({ kind: 'ins', text });
    dels = []; inss = [];
  };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      out.push({ kind: 'same', text: a[i]! });
      i++; j++;
      continue;
    }
    if (i < a.length && (j >= b.length || rows[i + 1]![j]! >= rows[i]![j + 1]!)) dels.push(a[i++]!);
    else if (j < b.length) inss.push(b[j++]!);
    else break;
  }
  flush();
  return out;
}
