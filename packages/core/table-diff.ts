import {parseFragment, serializeOuter, type DefaultTreeAdapterTypes} from 'parse5';
import {textOfHtml} from './change-diff.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

type Row = {html: string; text: string; cells: Array<{html: string; text: string}>; columns: number};

const isElement = (node: Node): node is Element => node.nodeName !== '#text' && node.nodeName !== '#comment' && node.nodeName !== '#documentType' && node.nodeName !== '#document';

function findTable(nodes: readonly Node[]): Element | undefined {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.nodeName === 'table') return node;
    const child = findTable(node.childNodes ?? []);
    if (child) return child;
  }
  return undefined;
}

function rowsOf(table: Element): Row[] {
  const rows: Element[] = [];
  for (const child of table.childNodes ?? []) {
    if (!isElement(child)) continue;
    if (child.nodeName === 'tr') rows.push(child);
    else if (['thead', 'tbody', 'tfoot'].includes(child.nodeName)) {
      for (const row of child.childNodes ?? []) if (isElement(row) && row.nodeName === 'tr') rows.push(row);
    }
  }
  return rows.map(row => {
    const cells = (row.childNodes ?? []).filter(isElement).filter(node => node.nodeName === 'td' || node.nodeName === 'th');
    const html = serializeOuter(row);
    return {
      html,
      text: textOfHtml(html, 4000).replace(/\s+/g, ' ').trim(),
      columns: cells.length,
      cells: cells.map(cell => {
        const cellHtml = serializeOuter(cell);
        return {html: cellHtml, text: textOfHtml(cellHtml, 4000).replace(/\s+/g, ' ').trim()};
      }),
    };
  }).filter(row => row.columns > 0);
}

function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  if (!a.length || !b.length) return [];
  if (a.length * b.length > 120_000) {
    const pairs: Array<[number, number]> = [];
    let index = 0;
    while (index < Math.min(a.length, b.length) && a[index] === b[index]) { pairs.push([index, index]); index++; }
    return pairs;
  }
  const rows = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      rows[i]![j] = a[i] === b[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (rows[i + 1]![j]! >= rows[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function markRow(html: string, kind: 'same' | 'removed' | 'added' | 'modified'): string {
  return html.replace(/^<tr\b/i, `<tr data-cw-row="${kind}"`);
}

function changedRow(before: Row, after: Row, side: 'before' | 'after'): string {
  const cells = (side === 'before' ? before.cells : after.cells).map((cell, index) => {
    const other = (side === 'before' ? after.cells : before.cells)[index];
    if (other && other.text === cell.text) return cell.html;
    return cell.html.replace(/^<(td|th)\b/i, `<$1 data-cw-cell="changed"`);
  });
  return `<tr data-cw-row="modified">${cells.join('')}</tr>`;
}

function placeholder(columns: number): string {
  return `<tr data-cw-row="gap"><td colspan="${Math.max(1, columns)}"></td></tr>`;
}

/**
 * 表格按行对齐、单元格高亮：
 * - 未变行灰显；
 * - 修改行只给发生变化的具体单元格加底色；
 * - 新增/删除行整行着色，另一侧留占位行保持左右行对齐。
 * 返回可直接渲染的两段表格 HTML（调用方负责外层容器与滚动）。
 */
export function diffTable(beforeHtml: string, afterHtml: string): {before: string; after: string; changed: boolean} {
  const beforeTable = findTable(parseFragment(beforeHtml).childNodes);
  const afterTable = findTable(parseFragment(afterHtml).childNodes);
  if (!beforeTable || !afterTable) return {before: beforeHtml, after: afterHtml, changed: false};
  const beforeRows = rowsOf(beforeTable), afterRows = rowsOf(afterTable);
  if (!beforeRows.length || !afterRows.length || beforeRows.length > 400 || afterRows.length > 400) return {before: beforeHtml, after: afterHtml, changed: false};
  const pairs = lcsPairs(beforeRows.map(row => row.text), afterRows.map(row => row.text));
  const beforeOut: string[] = [], afterOut: string[] = [];
  let changed = false;
  let ai = 0, bi = 0;
  const flushGap = (oldEnd: number, newEnd: number) => {
    const oldRows = beforeRows.slice(ai, oldEnd), newRows = afterRows.slice(bi, newEnd);
    const columns = Math.max(1, ...oldRows.map(row => row.columns), ...newRows.map(row => row.columns));
    const count = Math.max(oldRows.length, newRows.length);
    for (let index = 0; index < count; index++) {
      const oldRow = oldRows[index], newRow = newRows[index];
      if (oldRow && newRow) {
        beforeOut.push(changedRow(oldRow, newRow, 'before'));
        afterOut.push(changedRow(oldRow, newRow, 'after'));
        changed = true;
      } else if (oldRow) {
        beforeOut.push(markRow(oldRow.html, 'removed'));
        afterOut.push(placeholder(columns));
        changed = true;
      } else if (newRow) {
        beforeOut.push(placeholder(columns));
        afterOut.push(markRow(newRow.html, 'added'));
        changed = true;
      }
    }
  };
  for (const [i, j] of [...pairs, [beforeRows.length, afterRows.length] as [number, number]]) {
    flushGap(i, j);
    if (i < beforeRows.length && j < afterRows.length) {
      beforeOut.push(markRow(beforeRows[i]!.html, 'same'));
      afterOut.push(markRow(afterRows[j]!.html, 'same'));
    }
    ai = i + 1; bi = j + 1;
  }
  return {
    before: `<table class="cw-diff-table"><tbody>${beforeOut.join('')}</tbody></table>`,
    after: `<table class="cw-diff-table"><tbody>${afterOut.join('')}</tbody></table>`,
    changed,
  };
}
