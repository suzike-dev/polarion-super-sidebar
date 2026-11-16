import type {ChangeItem, ChangeRecord, ChangeRecordPreview} from '../protocol/index.ts';

/**
 * 变更记录的展示名。
 * 新记录直接用变动工作项的编号与标题命名；老记录只有一句 AI 摘要标题，展示时把
 * “集中在 …” 后面的真正重点提出来，避免列表里全是“本次共变更 N 个工作项”。
 */

function clip(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

/** 记录名：最多列两个工作项，更多的折叠成“等 N 项”。 */
export function recordNameFromItems(items: ChangeItem[], changedItems = items.length): string {
  const named = items
    .filter(item => item.title?.trim())
    .slice(0, 2)
    .map(item => `${item.workItemId} ${item.title.trim().replace(/\s+/g, ' ')}`);
  if (!named.length) return '';
  return clip(named.length < changedItems ? `${named.join(' · ')} 等 ${changedItems} 项` : named.join(' · '), 200);
}

export function friendlyRecordName(headline: string, documentTitle: string, changedItems: number): string {
  let text = headline.trim().replace(/\*\*/g, '').replace(/\s+/g, ' ');
  if (!text) return `${changedItems} 项变更`;
  const prefix = documentTitle.trim() ? `${documentTitle.trim()}：` : '';
  if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length).trim();
  const focused = /集中在[：:，,\s]*(.+)$/.exec(text);
  if (focused) {
    const detail = focused[1]!.trim().replace(/[。.]$/, '');
    if (detail) {
      // “集中在第 4 章”只说明位置，补上数量才看得懂；真正的功能点直接作为记录名。
      return /^第\s*\d+\s*章$/.test(detail) || detail === '未分节' ? `${detail} · ${changedItems} 项变更` : clip(detail, 120);
    }
  }
  if (/^(本次共变更|共变更)\s*\d+\s*个工作项/.test(text)) return `${changedItems} 项变更`;
  return clip(text, 200);
}

/** 悬停卡片里的摘要只留具体要点，跳过“本次共变更 N 项”“区间：”这类卡片头部已有信息的句子。 */
export function summaryLeadLines(text: string, limit = 2): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const clean = line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
    if (!clean || /^(本次共变更|共变更|区间：)/.test(clean)) continue;
    lines.push(clean);
    if (lines.length >= limit) break;
  }
  return lines;
}

/** 从完整记录生成悬停卡片用的轻量预览，避免把大段 HTML 与图片传给侧栏。 */
export function recordPreview(record: ChangeRecord): ChangeRecordPreview {
  const summary = record.aiSummary.status === 'ready' && record.aiSummary.text.trim() ? record.aiSummary.text : record.heuristicSummary;
  return {
    id: record.id, documentTitle: record.documentTitle, headline: record.headline,
    baselineAt: record.baselineAt, endedAt: record.endedAt,
    changedItems: record.changedItems, modified: record.modified, added: record.added, removed: record.removed,
    items: record.changes.slice(0, 4).map(change => ({workItemId: change.workItemId, title: change.title, kind: change.kind})),
    summaryLines: summaryLeadLines(summary),
  };
}
