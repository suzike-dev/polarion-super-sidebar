import http from 'node:http';
import os from 'node:os';
import {resolveImages, sanitizeBlockHtml, textOfHtml} from '../../packages/core/change-diff.ts';
import {diffTextParts} from '../../packages/core/text-diff.ts';
import {diffTable} from '../../packages/core/table-diff.ts';
import type {ChangeBlock, ChangeRecord, ChangeRecordSummary, Target} from '../../packages/protocol/index.ts';
import type {Store} from './store.ts';

/**
 * 分享页只做只读展示：
 * - 链接里带随机 token，页面上不再发起任何外部请求（图片已内联为 data URL）；
 * - 无脚本，只用 details/anchor 做折叠与章节跳转；
 * - 数据每次从 Polarion 读取，链接不会展示过期的本地副本。
 */

export interface ChangeShareSource {
  resolveToken(token: string): Target | undefined;
  list(target: Target): Promise<ChangeRecordSummary[]>;
  read(recordId: string): Promise<ChangeRecord>;
}

export type ShareStatus = {running: boolean; port?: number; urls?: string[]; historyUrl?: string};

type ShareConfig = {port?: number; token?: string};

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stamp(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayLabel(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function docLabel(target: Target) {
  return target.document.split('/').filter(Boolean).at(-1) ?? target.document;
}

function durationLabel(from: number, to: number) {
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}

function renderMarkdown(text: string) {
  const lines = text.split(/\r?\n/);
  const html: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (!list) return;
    html.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = null;
  };
  const inline = (value: string) => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^#{2,4}\s+/.test(line)) {
      flush();
      const level = Math.min(4, (line.match(/^#+/) ?? ['##'])[0].length);
      html.push(`<h${level}>${inline(line.replace(/^#+\s+/, ''))}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      list ??= [];
      list.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
    if (/^\d+[.、]\s+/.test(line)) {
      list ??= [];
      list.push(line.replace(/^\d+[.、]\s+/, ''));
      continue;
    }
    flush();
    html.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return html.join('');
}

function blockHtml(html: string, images: Record<string, string>) {
  return resolveImages(sanitizeBlockHtml(html, 8000, true), images);
}

function renderTextParts(parts: ReturnType<typeof diffTextParts>, side: 'before' | 'after', changeIds: Set<number>) {
  return parts.map(part => {
    if (part.kind === 'same') return `<span class="cw-same-text">${escapeHtml(part.text)}</span>`;
    changeIds.add(part.id);
    const tip = (value: string) => escapeHtml(value.length > 220 ? value.slice(0, 219) + '…' : value);
    const tooltip = tip(side === 'before' ? '变更后：' + (part.after || '（已删除）') : '变更前：' + (part.before || '（新增）'));
    if (side === 'before') {
      if (!part.before) return (part.after?.length ?? 0) >= 6 ? `<span class="cw-diff-marker" data-cw-change="${part.id}" data-cw-side="before" data-cw-tip="${tooltip}">＋新增</span>` : '';
      return `<span class="cw-diff-del${part.after ? '' : ' cw-deleted'}" data-cw-change="${part.id}" data-cw-side="before" data-cw-tip="${tooltip}">${escapeHtml(part.before)}</span>`;
    }
    if (!part.after) return (part.before?.length ?? 0) >= 6 ? `<span class="cw-diff-marker" data-cw-change="${part.id}" data-cw-side="after" data-cw-tip="${tooltip}">－删除</span>` : '';
    return `<span class="cw-diff-ins ${part.before ? 'cw-modified' : 'cw-added'}" data-cw-change="${part.id}" data-cw-side="after" data-cw-tip="${tooltip}">${escapeHtml(part.after)}</span>`;
  }).join('');
}

function renderBlockSide(block: ChangeBlock, side: 'before' | 'after', images: Record<string, string>, changeIds: Set<number>) {
  if (block.kind === 'same') return block.html
    ? `<div class="cw-same-block">${blockHtml(block.html, images)}</div>`
    : `<div class="cw-same">${escapeHtml(block.text ?? '')}</div>`;
  if (block.kind === 'added') return side === 'before'
    ? '<div class="cw-diff-void">（此处为新增内容）</div>'
    : `<div class="cw-rich cw-added-content">${block.after ? blockHtml(block.after, images) : ''}</div>`;
  if (block.kind === 'removed') return side === 'after'
    ? '<div class="cw-diff-void">（此处已删除）</div>'
    : `<div class="cw-rich cw-removed-content">${block.before ? blockHtml(block.before, images) : ''}</div>`;
  const isTable = block.tag === 'table';
  if (isTable) {
    const tableDiff = diffTable(block.before ?? '', block.after ?? '');
    if (tableDiff.changed) return `<div class="cw-rich cw-table-scroll">${side === 'before' ? tableDiff.before : tableDiff.after}</div>`;
  }
  const nested = /<(?:img|table)\b/i.test((block.before ?? '') + (block.after ?? ''));
  if (!isTable && !nested) {
    const beforeText = textOfHtml(block.before ?? '', 6000), afterText = textOfHtml(block.after ?? '', 6000);
    const parts = diffTextParts(beforeText, afterText);
    if ((beforeText || afterText) && parts.some(part => part.kind === 'change')) {
      return `<p class="cw-diff-text">${renderTextParts(parts, side, changeIds)}</p>`;
    }
  }
  return `<div class="cw-rich">${blockHtml(side === 'before' ? block.before ?? '' : block.after ?? '', images)}</div>`;
}

function renderDiffGrid(blocks: ChangeBlock[], images: Record<string, string>, changeIds: Set<number>) {
  return blocks.map(block => {
    const rowClass = 'cw-diff-row ' + (block.kind === 'same' ? 'cw-unchanged' : 'cw-changed') + (block.tag === 'table' ? ' cw-table' : '');
    const beforeClass = 'cw-diff-cell cw-before' + (block.kind === 'added' ? ' cw-void-side' : '') + (block.kind === 'removed' ? ' cw-removed-side' : '');
    const afterClass = 'cw-diff-cell cw-after' + (block.kind === 'removed' ? ' cw-void-side' : '') + (block.kind === 'added' ? ' cw-added-side' : '');
    return `<div class="${rowClass}"><div class="${beforeClass}">${renderBlockSide(block, 'before', images, changeIds)}</div><div class="${afterClass}">${renderBlockSide(block, 'after', images, changeIds)}</div></div>`;
  }).join('');
}

function renderFields(record: ChangeRecord) {
  const rows = record.changes.flatMap(change => change.fields.map(field => ({id: change.workItemId, title: change.title, field})));
  if (!rows.length) return '';
  return `<section class="cw-fields"><h2>属性与位置变化</h2><div class="cw-table-wrap"><table><thead><tr><th>工作项</th><th>属性</th><th>变更前</th><th>变更后</th></tr></thead><tbody>${rows.map(row => `<tr><td><code>${escapeHtml(row.id)}</code></td><td>${escapeHtml(row.field.name)}</td><td>${escapeHtml(row.field.before)}</td><td>${escapeHtml(row.field.after)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderChapters(record: ChangeRecord) {
  if (!record.chapters.length) return '';
  const max = Math.max(...record.chapters.map(chapter => chapter.items), 1);
  return `<section class="cw-chapters"><h2>章节变更地图</h2>${record.chapters.map(chapter => `<a class="cw-chapter" href="#chapter-${encodeURIComponent(chapter.num)}"><span class="cw-chapter-num">${chapter.num === '0' ? '—' : escapeHtml(chapter.num)}</span><span class="cw-chapter-name">${escapeHtml(chapter.title || (chapter.num === '0' ? '未分节' : `第 ${chapter.num} 章`))}</span><span class="cw-chapter-bar"><i style="width:${Math.max(8, Math.round(chapter.items / max * 100))}%"></i></span><em>${chapter.items} 项</em></a>`).join('')}</section>`;
}

function renderChange(record: ChangeRecord, change: ChangeRecord['changes'][number], changeIds: Set<number>) {
  const kind = {modified: '修改', added: '新增', removed: '删除', moved: '移动'}[change.kind];
  const counts = [
    change.counts.added ? `新增 ${change.counts.added} 段` : '',
    change.counts.removed ? `删除 ${change.counts.removed} 段` : '',
    change.counts.modified ? `改写 ${change.counts.modified} 段` : '',
  ].filter(Boolean).join(' · ');
  return `<article class="cw-item cw-${change.kind}" id="item-${escapeHtml(change.workItemId)}">
    <header class="cw-item-head">
      <span class="cw-kind cw-kind-${change.kind}">${kind}</span>
      <div class="cw-item-title"><h3>${escapeHtml(change.workItemId)} ${escapeHtml(change.title || '')}</h3><small>${escapeHtml(change.sectionAfter || change.sectionBefore || change.outlineAfter || change.outlineBefore || '未编号')}${change.chapterAfter !== change.chapterBefore && change.kind !== 'added' ? ` · 从 ${escapeHtml(change.chapterBefore)} 章移到 ${escapeHtml(change.chapterAfter)} 章` : ''}</small></div>
      ${counts ? `<span class="cw-counts">${counts}</span>` : ''}
      <a class="cw-item-link" href="${escapeHtml(polarionItemUrl(record.target, change.workItemId))}" target="_blank" rel="noopener noreferrer" title="在 Polarion 中打开 ${escapeHtml(change.workItemId)}">Polarion ↗</a>
    </header>
    ${change.fields.length ? `<div class="cw-field-chips">${change.fields.map(field => `<span>${escapeHtml(field.name)}：<s>${escapeHtml(field.before)}</s> → <b>${escapeHtml(field.after)}</b></span>`).join('')}</div>` : ''}
    <div class="cw-diff-head"><span>变更前</span><span>变更后</span></div><div class="cw-diff-grid">${renderDiffGrid(change.blocks, record.images, changeIds)}</div>
  </article>`;
}

const PAGE_CSS = `
:root{--ink:#1b272e;--muted:#7d8a80;--line:#e2e7d9;--paper:#f6f8f0;--card:#fff;--green:#174630;--green-2:#1e573c;--green-soft:#e9f1e4;--lime:#cfe28f;--red:#9b443c;--red-soft:#fbedeb;--amber:#80651d;--amber-soft:#fbf3dc;--shadow:0 18px 50px rgba(30,45,32,.08)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.75 "Microsoft YaHei","PingFang SC","Noto Sans SC",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--green-2);text-decoration:none}a:hover{text-decoration:underline}
.cw-page{max-width:1180px;margin:0 auto;padding:26px 28px 80px}
.cw-top{display:flex;align-items:center;gap:14px;padding:4px 0 22px;color:var(--muted);font-size:12px;letter-spacing:.04em}
.cw-brand{display:flex;align-items:center;gap:8px;color:var(--green);font-weight:700;letter-spacing:.02em}
.cw-brand i{width:22px;height:22px;border-radius:7px;background:linear-gradient(135deg,var(--green),#3d7a52);display:inline-block;position:relative}
.cw-brand i:after{content:"";position:absolute;inset:6px;border:1.5px solid var(--lime);border-radius:4px}
.cw-top-link{margin-left:8px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:11.5px;color:#405344;background:#fff;white-space:nowrap}
.cw-top-link:hover{border-color:#b9cbae;background:#f6f9f0;text-decoration:none}
.cw-top-link.primary{background:var(--green);border-color:var(--green);color:#f4f8ee;font-weight:600}
.cw-top-link.primary:hover{background:#174630}
.cw-item-link{flex:none;margin-top:2px;font-size:11px;color:#5d7462;border:1px solid var(--line);border-radius:5px;padding:1px 7px;white-space:nowrap}
.cw-item-link:hover{color:#174630;border-color:#b9cbae;background:#f6f9f0;text-decoration:none}
.cw-top .cw-spacer{flex:1}
.cw-hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#123b28 0%,#1e573c 58%,#3f704f 100%);color:#f4f8ee;border-radius:18px;padding:30px 32px 26px;box-shadow:var(--shadow)}
.cw-hero:after{content:"";position:absolute;right:-80px;top:-100px;width:340px;height:340px;border-radius:50%;border:44px solid rgba(207,226,143,.12)}
.cw-kicker{font-size:11px;letter-spacing:.18em;color:#cfe28f;text-transform:uppercase;font-weight:700}
.cw-hero h1{margin:8px 0 6px;font-size:30px;line-height:1.3;font-weight:700;letter-spacing:-.01em}
.cw-hero .cw-range{color:#dcebcf;font-size:13px}
.cw-project-badge{display:inline-block;margin-top:7px;padding:2px 9px;border:1px solid rgba(207,226,143,.45);border-radius:99px;color:#eaf3df;font-size:11px;letter-spacing:.04em}
.cw-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:24px;position:relative;z-index:1}
.cw-stat{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:11px 13px}
.cw-stat b{display:block;font-size:24px;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.cw-stat span{display:block;margin-top:4px;font-size:11px;color:#d8e7cd;letter-spacing:.06em}
.cw-section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin-top:16px;box-shadow:0 1px 0 rgba(30,45,32,.02)}
.cw-section>h2{margin:0 0 14px;font-size:15px;letter-spacing:.02em}
.cw-summary{border-left:4px solid var(--green-2)}
.cw-summary .cw-label{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--green-2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}
.cw-summary .cw-label:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 3px var(--green-soft)}
.cw-summary h2,.cw-summary h4{display:flex;align-items:center;gap:8px;margin:18px 0 7px;font-size:14px;letter-spacing:.05em;color:var(--green)}
.cw-summary h2:first-child,.cw-summary h4:first-child{margin-top:2px}
.cw-summary h2:before,.cw-summary h4:before{content:"";width:16px;height:3px;border-radius:99px;background:linear-gradient(90deg,var(--green),var(--lime))}
.cw-summary h3{display:inline-block;margin:12px 0 5px;padding:3px 11px;border:1px solid #d3e2c8;border-radius:99px;background:#f2f7ec;font-size:13.5px;font-weight:600;color:#234332}
.cw-summary p{margin:7px 0;color:#33453a}
.cw-summary li{margin:3px 0}
.cw-summary li::marker{color:#8fae7c}
.cw-summary ul{margin:6px 0 10px;padding-left:20px}
.cw-summary strong{color:#1B272E}
.cw-summary li{margin:3px 0}
.cw-summary code{background:#f0f4e9;border:1px solid #e2e8d7;border-radius:4px;padding:0 4px;font-size:.9em}
.cw-chapters{display:flex;flex-direction:column;gap:6px}
.cw-chapter{display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid #e7ecdf;border-radius:8px;color:var(--ink)}
.cw-chapter:hover{background:#f8faf3;text-decoration:none;border-color:#cfdcc2}
.cw-chapter-num{flex:0 0 30px;font:600 11px/1.4 ui-monospace,Consolas,monospace;color:#5b7461}
.cw-chapter-name{flex:0 1 230px;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-chapter-bar{flex:1;height:8px;background:#edf1e5;border-radius:99px;overflow:hidden}
.cw-chapter-bar i{display:block;height:100%;background:linear-gradient(90deg,#3f7a55,var(--lime));border-radius:99px}
.cw-chapter em{flex:0 0 auto;font-size:11px;color:var(--muted);font-style:normal;font-variant-numeric:tabular-nums}
.cw-item{border:1px solid var(--line);border-radius:13px;background:var(--card);margin-top:14px;overflow:hidden}
.cw-item-head{display:flex;align-items:flex-start;gap:10px;padding:15px 18px;background:#fbfcf7;border-bottom:1px solid #edf1e5;flex-wrap:wrap}
.cw-kind{flex:0 0 auto;font-size:10.5px;font-weight:700;letter-spacing:.06em;border-radius:99px;padding:2px 8px;margin-top:2px}
.cw-kind-modified{background:var(--amber-soft);color:var(--amber);border:1px solid #ead9a9}
.cw-kind-added{background:var(--green-soft);color:var(--green-2);border:1px solid #cfe0c4}
.cw-kind-removed{background:var(--red-soft);color:var(--red);border:1px solid #eccac6}
.cw-kind-moved{background:#eef1f4;color:#51616b;border:1px solid #dbe2e6}
.cw-item-title{flex:1;min-width:0}
.cw-item-title h3{margin:0;font-size:14.5px;line-height:1.5;font-weight:650}
.cw-item-title small{display:block;margin-top:2px;color:var(--muted);font-size:11px}
.cw-counts{flex:0 0 auto;font-size:11px;color:var(--muted);white-space:nowrap;padding-top:3px}
.cw-field-chips{display:flex;flex-wrap:wrap;gap:6px;padding:11px 18px;background:#fcfcf8;border-bottom:1px solid #eef2e7}
.cw-field-chips span{font-size:11.5px;background:#f5f7ef;border:1px solid #e5eadb;border-radius:6px;padding:2px 7px;color:#5b6a5f}
.cw-field-chips s{color:#a05c55}.cw-field-chips b{color:var(--green-2)}
.cw-diff-head{display:grid;grid-template-columns:1fr 1fr;margin:14px 0 0;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;overflow:hidden;background:#f3f6ed}
.cw-diff-head span{padding:7px 12px;font-size:11px;font-weight:700;letter-spacing:.05em;color:#5d7462}
.cw-diff-head span:first-child{border-right:1px solid var(--line)}
.cw-diff-grid{border:1px solid var(--line);border-radius:0 0 10px 10px;overflow:hidden;background:#fff}
.cw-diff-row{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #eef2e7}
.cw-diff-row:first-child{border-top:0}
.cw-diff-row.cw-changed{background:#fffdf7}
.cw-diff-cell{padding:12px 14px;min-width:0;overflow-wrap:anywhere;background:#fbfcfa}
.cw-diff-cell.cw-before{border-right:1px solid #e7ecdf}
.cw-diff-cell.cw-void-side{background:#fafbf6}
.cw-diff-cell.cw-added-side{background:#f5fbf1}
.cw-diff-cell.cw-removed-side{background:#fdf5f3}
.cw-diff-void{color:#a2aca0;font-size:12px;font-style:italic}
.cw-added-content,.cw-added-content *{color:#2f7048 !important;font-weight:600 !important}
.cw-removed-content,.cw-removed-content *{color:#1B272E !important;font-weight:600 !important;text-decoration:line-through !important}
.cw-table-scroll{overflow-x:auto}
.cw-diff-cell .cw-diff-text{font-size:14px;line-height:1.85}
.cw-diff-cell .cw-same-block{font-size:13.5px}
.cw-diff-cell .cw-same-block table{min-width:460px}
.cw-blocks{padding:16px 18px 20px}
.cw-same{color:#9aa69b;font-size:12.5px;line-height:1.7;margin:5px 0;padding-left:10px;border-left:2px solid #edf0e7;white-space:pre-wrap;overflow-wrap:anywhere}
.cw-same-blocks{display:flex;flex-direction:column;gap:3px}
.cw-same-block{color:#8a958c !important;font-size:13px;line-height:1.8;overflow-wrap:anywhere}
.cw-same-block :is(p,li,span,td,th,h1,h2,h3,h4,h5,h6,a,strong,em,b,i,u){color:#8a958c !important}
.cw-same-block :is(p,ul,ol){margin:5px 0}
.cw-same-block table{width:100%;border-collapse:collapse;background:#fff}
.cw-same-block :is(td,th){border:1px solid #e4e9de;padding:5px 7px;background:#fff !important;text-align:left;vertical-align:top}
.cw-same-block img{max-width:100%;height:auto;border:1px solid #e2e8d8;border-radius:4px}
.cw-same-run{margin:8px 0;border:1px dashed #dde4d4;border-radius:8px;background:#fbfcf7}
.cw-same-run>summary{cursor:pointer;padding:6px 10px;font-size:11.5px;color:#8a988d;list-style:none}
.cw-same-run>summary::-webkit-details-marker{display:none}
.cw-same-run>summary:before{content:"▸ ";color:#a8b3a2}
.cw-same-run[open]>summary:before{content:"▾ "}
.cw-same-run .cw-same{padding:1px 12px}
.cw-block{margin:12px 0;border-radius:10px;padding:12px 14px 12px 14px;position:relative}
.cw-block .cw-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;border-radius:99px;padding:1px 7px;margin-bottom:7px}
.cw-added{background:var(--green-soft);border:1px solid #cfe2c4;border-left:4px solid #4d8a60}
.cw-added .cw-tag{background:#dcecd4;color:var(--green-2)}
.cw-removed{background:var(--red-soft);border:1px solid #eed2ce;border-left:4px solid #b45b51}
.cw-removed .cw-tag{background:#f6dcd8;color:var(--red)}
.cw-removed .cw-blocks,.cw-removed{text-decoration-color:#b45b51}
.cw-modified{background:#fcfcf8;border:1px solid #e3e8da;padding:0}
[data-cw-change]{position:relative}
[data-cw-change]:hover::after{content:attr(data-cw-tip);position:absolute;left:0;bottom:calc(100% + 6px);z-index:20;max-width:340px;width:max-content;white-space:normal;background:#1b272e;color:#f4f8ee;font-size:12px;line-height:1.55;padding:6px 9px;border-radius:6px;box-shadow:0 8px 22px rgba(20,30,24,.25);pointer-events:none}
.cw-diff-text{color:#8a958c}
.cw-same-text{color:#8a958c}
.cw-diff-del{color:#1B272E;font-weight:700}
.cw-diff-del.cw-deleted{text-decoration:line-through}
.cw-diff-ins{font-weight:700}
.cw-diff-ins.cw-modified{color:#b42318}
.cw-diff-ins.cw-added{color:#2f7048}
.cw-diff-marker{display:inline-block;color:#9aa69b;font-size:11px;border:1px dashed #d7ddd2;border-radius:4px;padding:0 4px;margin:0 1px;line-height:1.5}
.cw-text-diff .cw-before{background:#fbfcfa;border-right:1px solid #e2e7d9}
.cw-text-diff .cw-after{background:#fbfcfa}
.cw-diff-table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}
.cw-diff-table :is(td,th){border:1px solid #e4e9de;padding:5px 7px;color:#8a958c !important;background:#fff !important;text-align:left;vertical-align:top}
.cw-before .cw-diff-table [data-cw-row="removed"],.cw-before .cw-diff-table [data-cw-row="removed"] *{color:#1B272E !important;font-weight:700 !important;text-decoration:line-through !important;background:#f4f4f2 !important}
.cw-after .cw-diff-table [data-cw-row="added"],.cw-after .cw-diff-table [data-cw-row="added"] *{color:#2f7048 !important;font-weight:700 !important;background:#f3faf0 !important}
.cw-before .cw-diff-table [data-cw-cell="changed"],.cw-before .cw-diff-table [data-cw-cell="changed"] *{color:#1B272E !important;font-weight:700 !important;background:#f2f2ef !important}
.cw-after .cw-diff-table [data-cw-cell="changed"],.cw-after .cw-diff-table [data-cw-cell="changed"] *{color:#b42318 !important;font-weight:700 !important;background:#fff5f4 !important}
.cw-diff-table [data-cw-row="gap"] td{border:0 !important;background:transparent !important;height:24px}
.cw-pair{display:grid;grid-template-columns:1fr 1fr;gap:0}
.cw-text-diff .cw-before{background:#fbfcfa;border-right:1px solid #e2e7d9}
.cw-text-diff .cw-after{background:#fbfcfa}
.cw-same-text{color:#8a958c}
.cw-diff-text{margin:0;font-size:14px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere}
.cw-diff-text del{background:#f8dcd7;color:#8c3a34;text-decoration:line-through;border-radius:2px;padding:0 1px}
.cw-diff-text ins{background:#dcecd4;color:#174630;text-decoration:none;border-radius:2px;padding:0 1px}
.cw-side{padding:12px 14px;min-width:0;overflow-wrap:anywhere}
.cw-before{background:#fdf4f2;border-right:1px solid #eedfda}
.cw-after{background:#f5faf0}
.cw-before .cw-tag{background:#f6ded9;color:var(--red)}
.cw-after .cw-tag{background:#dfeeda;color:var(--green-2)}
.cw-empty{color:#a8b1a6;font-size:12px;margin:0}
.cw-blocks p{margin:6px 0}
.cw-blocks ul,.cw-blocks ol{margin:6px 0;padding-left:22px}
.cw-blocks li{margin:2px 0}
.cw-blocks h1,.cw-blocks h2,.cw-blocks h3,.cw-blocks h4,.cw-blocks h5,.cw-blocks h6{margin:12px 0 6px;line-height:1.4;font-size:15px;color:var(--green)}
.cw-blocks table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12.5px;background:#fff}
.cw-blocks th,.cw-blocks td{border:1px solid #dfe6d6;padding:5px 7px;vertical-align:top;text-align:left}
.cw-blocks th{background:#f1f5ea;font-weight:600;color:#43564a}
.cw-blocks tr:nth-child(even) td{background:#fbfcf8}
.cw-blocks img{max-width:100%;height:auto;border:1px solid #e2e8d8;border-radius:6px;background:#fff}
.cw-blocks blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid #cfdcc2;background:#f8faf3;color:#617065}
.cw-blocks code{background:#f2f5ec;border:1px solid #e3e8d9;border-radius:4px;padding:0 4px;font:.9em ui-monospace,Consolas,monospace}
.cw-img-missing{display:inline-block;font-size:10.5px;color:#8d9a8e;border:1px dashed #cfd8c8;border-radius:5px;padding:1px 6px;background:#fafbf6}
.cw-macro{display:inline-block;font-size:10.5px;color:#8d9a8e;border:1px dashed #cfd8c8;border-radius:5px;padding:1px 6px}
.cw-large{color:#8d9a8e;font-size:12px}
.cw-note-card{border-left:4px solid var(--lime)}
.cw-note-card h2{color:var(--green)}
.cw-note-card p{margin:0;font-size:13px;line-height:1.8;color:#405344}
.cw-fields table{width:100%;border-collapse:collapse;font-size:12.5px}
.cw-fields th,.cw-fields td{border-bottom:1px solid #e7ecdf;padding:7px 9px;text-align:left;vertical-align:top}
.cw-fields th{color:#5f7064;font-weight:600;background:#f8faf3}
.cw-fields code{font-family:ui-monospace,Consolas,monospace;font-size:11px}
.cw-table-wrap{overflow-x:auto}
.cw-list{display:flex;flex-direction:column;gap:8px}
.cw-day{margin-top:16px;font-size:11px;font-weight:700;letter-spacing:.08em;color:#7f8d82;padding:0 2px}
.cw-record{display:flex;align-items:center;gap:14px;padding:13px 15px;background:var(--card);border:1px solid var(--line);border-radius:11px;color:var(--ink)}
.cw-record:hover{border-color:#c9d8bc;background:#fbfcf7;text-decoration:none}
.cw-record-time{flex:0 0 86px;font:600 12px/1.5 ui-monospace,Consolas,monospace;color:#5b7461}
.cw-record-main{flex:1;min-width:0}
.cw-record-main b{display:block;font-size:13.5px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-record-main small{display:block;margin-top:2px;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cw-record-stats{flex:0 0 auto;display:flex;gap:5px;font-size:10.5px;color:var(--muted)}
.cw-record-stats i{font-style:normal;background:#f3f6ed;border:1px solid #e4eadb;border-radius:5px;padding:1px 5px}
.cw-record-arrow{color:#9aa79b;font-size:15px}
.cw-empty-state{padding:60px 20px;text-align:center;color:var(--muted);font-size:13px}
.cw-foot{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);color:#98a399;font-size:11px;line-height:1.7}
@keyframes cw-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.cw-hero{animation:cw-rise .4s ease-out both}
.cw-section,.cw-item{animation:cw-rise .36s ease-out both}
.cw-section:nth-of-type(2){animation-delay:.03s}.cw-section:nth-of-type(3){animation-delay:.06s}.cw-section:nth-of-type(4){animation-delay:.09s}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media(max-width:820px){.cw-page{padding:16px 14px 60px}.cw-hero{padding:22px 20px;border-radius:14px}.cw-hero h1{font-size:22px}.cw-stats{grid-template-columns:repeat(2,1fr)}.cw-section{padding:16px}.cw-record-time{flex-basis:64px}.cw-record-stats{display:none}.cw-chapter-name{flex-basis:150px}}
@media print{body{background:#fff}.cw-page{max-width:none;padding:0}.cw-hero{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cw-section,.cw-item{box-shadow:none;break-inside:avoid}.cw-same-run{display:none}.cw-item{break-inside:auto}.cw-pair{grid-template-columns:1fr 1fr}}
`;

function page(title: string, body: string, extraCss = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="referrer" content="no-referrer"/><title>${escapeHtml(title)}</title><style>${PAGE_CSS}${extraCss}</style></head><body><div class="cw-page">${body}<footer class="cw-foot">由 Polarion 超级侧边栏生成 · 记录保存在 Polarion 项目工作项中 · 页面只读，不修改任何需求</footer></div></body></html>`;
}

/** Polarion 深链：文档带 ?psb=changes 时侧栏自动展开变更工作台。 */
function polarionDocUrl(target: Target, openChanges = false) {
  const doc = target.document.split('/').map(encodeURIComponent).join('/');
  return `${target.origin}/polarion/#/project/${encodeURIComponent(target.projectId)}/wiki/${doc}${openChanges ? '?psb=changes' : ''}`;
}
function polarionItemUrl(target: Target, workItemId: string) {
  return `${target.origin}/polarion/#/project/${encodeURIComponent(target.projectId)}/workitem?id=${encodeURIComponent(workItemId)}`;
}

function topBar(back?: string, polarion?: {label: string; href: string; itemLabel?: string; itemHref?: string}) {
  const actions = polarion ? [
    polarion.itemHref ? `<a class="cw-top-link" href="${escapeHtml(polarion.itemHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(polarion.itemLabel ?? '记录工作项')}</a>` : '',
    `<a class="cw-top-link primary" href="${escapeHtml(polarion.href)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(polarion.label)}</a>`,
  ].filter(Boolean).join('') : '';
  return `<div class="cw-top"><span class="cw-brand"><i></i>Polarion · 变更记录</span><span class="cw-spacer"></span>${actions}${back ? `<a href="${escapeHtml(back)}">← 全部变更</a>` : ''}</div>`;
}

export class ChangeShare {
  private readonly store: Store;
  private readonly source: ChangeShareSource;
  private server?: http.Server;
  private port = 0;
  private starting?: Promise<void>;
  constructor(store: Store, source: ChangeShareSource) { this.store = store; this.source = source; }

  status(): ShareStatus {
    if (!this.server || !this.port) return {running: false};
    return {running: true, port: this.port, urls: this.baseUrls()};
  }

  async publish(token: string) {
    await this.ensureServer();
    const urls = this.baseUrls();
    const historyUrl = `${urls[0]}/changes/${token}`;
    return {running: true, port: this.port, urls, historyUrl, token};
  }

  stop(): ShareStatus {
    if (this.server) {
      this.server.close();
      this.server = undefined;
      this.port = 0;
    }
    return {running: false};
  }

  private config(): ShareConfig {
    return this.store.get<ShareConfig>('change-share-config', 'global') ?? {};
  }

  private baseUrls() {
    return this.addresses().map(address => `http://${address}:${this.port}`);
  }

  private addresses() {
    const values: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const entry of list ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) values.push(entry.address);
      }
    }
    if (!values.length) {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) values.push(entry.address);
      }
    }
    if (!values.length) values.push('127.0.0.1');
    return [...new Set(values)];
  }

  private async ensureServer(): Promise<void> {
    if (this.server) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const saved = this.config().port;
      const candidates = [...new Set([saved, 47830, 47831, 47832, 47833, 47834, 47835].filter((value): value is number => Number.isInteger(value) && value! > 0))];
      for (const port of candidates) {
        try {
          await new Promise<void>((resolve, reject) => {
            const server = http.createServer((request, response) => { void this.handle(request, response); });
            server.once('error', reject);
            server.listen(port, '0.0.0.0', () => {
              server.off('error', reject);
              this.server = server;
              this.port = port;
              resolve();
            });
          });
          this.store.put('change-share-config', 'global', {port});
          return;
        } catch { /* 端口占用时继续尝试下一个 */ }
      }
      throw Error('CHANGE_SHARE_START_FAILED');
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const send = (status: number, contentType: string, body: string, extra?: Record<string, string>) => {
      response.writeHead(status, {
        'content-type': `${contentType}; charset=utf-8`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ...extra,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'text/plain', 'Method Not Allowed');
      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = /^\/changes\/([a-f0-9]{32,64})(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
      if (!match) return send(404, 'text/plain', 'Not Found');
      const token = match[1]!, recordId = match[2];
      const target = this.source.resolveToken(token);
      if (!target) return send(404, 'text/plain', 'Not Found');
      if (recordId) {
        const record = await this.source.read(recordId);
        if (record.target.projectId !== target.projectId || record.target.document !== target.document) return send(404, 'text/plain', 'Not Found');
        const records = await this.source.list(target).catch(() => []);
        const download = url.searchParams.get('download') === '1';
        return send(200, 'text/html', this.recordPage(record, token, records), download ? {'content-disposition': `attachment; filename="change-${recordId}.html"`} : undefined);
      }
      const records = await this.source.list(target);
      return send(200, 'text/html', this.historyPage(target, token, records));
    } catch {
      return send(500, 'text/plain', 'Share page unavailable');
    }
  }

  private historyPage(target: Target, token: string, records: ChangeRecordSummary[]) {
    const groups = new Map<string, ChangeRecordSummary[]>();
    for (const record of records) {
      const day = dayLabel(record.endedAt);
      groups.set(day, [...(groups.get(day) ?? []), record]);
    }
    const list = groups.size
      ? [...groups.entries()].map(([day, rows]) => `<div class="cw-day">${escapeHtml(day)}</div><div class="cw-list">${rows.map(record => `<a class="cw-record" href="/changes/${token}/${record.id}"><span class="cw-record-time">${stamp(record.baselineAt).slice(11)}<br/>${stamp(record.endedAt).slice(11)}</span><span class="cw-record-main"><b>${escapeHtml(record.headline || `${record.changedItems} 个工作项变更`)}</b><small>${record.changedItems} 项 · 修改 ${record.modified} · 新增 ${record.added} · 删除 ${record.removed} · 基线 ${escapeHtml(stamp(record.baselineAt))}</small></span><span class="cw-record-stats"><i>改 ${record.modified}</i><i>增 ${record.added}</i><i>删 ${record.removed}</i></span><span class="cw-record-arrow">›</span></a>`).join('')}</div>`).join('')
      : '<div class="cw-empty-state">这个文档还没有变更记录。设定基准并结束一次变更后，记录会出现在这里。</div>';
    const latest = records[0];
    return page(`变更历史 · ${docLabel(target)}`, `${topBar(undefined, {label: '在 Polarion 中打开变更工作台', href: polarionDocUrl(target, true)})}<section class="cw-hero"><div class="cw-kicker">Change history · ${escapeHtml(target.projectId)}</div><h1>${escapeHtml(docLabel(target))}</h1><div class="cw-range">${records.length} 次变更记录${latest ? ` · 最近一次 ${escapeHtml(stamp(latest.endedAt))}` : ''}</div><div class="cw-stats"><div class="cw-stat"><b>${records.length}</b><span>变更记录</span></div><div class="cw-stat"><b>${records.reduce((sum, record) => sum + record.changedItems, 0)}</b><span>累计变更工作项</span></div><div class="cw-stat"><b>${records.reduce((sum, record) => sum + record.modified, 0)}</b><span>累计修改</span></div><div class="cw-stat"><b>${records.reduce((sum, record) => sum + record.added + record.removed, 0)}</b><span>累计新增 / 删除</span></div></div></section><section class="cw-section"><h2>按天回看</h2>${list}</section>`);
  }

  private recordPage(record: ChangeRecord, token: string, records: ChangeRecordSummary[]) {
    const changeIds = new Set<number>();
    const changesHtml = record.changes.map(change => renderChange(record, change, changeIds)).join('');
    const summary = record.aiSummary.status === 'ready' && record.aiSummary.text
      ? renderMarkdown(record.aiSummary.text)
      : renderMarkdown(record.heuristicSummary);
    const ai = record.aiSummary.status === 'ready'
      ? '<span class="cw-label">AI 变更总结</span>'
      : '<span class="cw-label">变更总结</span>';
    const itemNav = `<section class="cw-section"><h2>工作项索引</h2><div class="cw-list">${record.changes.map(change => `<a class="cw-record" href="#item-${escapeHtml(change.workItemId)}"><span class="cw-record-time">${escapeHtml(change.workItemId)}</span><span class="cw-record-main"><b>${escapeHtml(change.title || '')}</b><small>${escapeHtml(change.outlineAfter || change.outlineBefore || '未编号')} · ${change.counts.added} 增 / ${change.counts.removed} 删 / ${change.counts.modified} 改</small></span><span class="cw-record-arrow">›</span></a>`).join('')}</div></section>`;
    const note = record.note ? `<section class="cw-section cw-note-card"><h2>作者补充</h2><p>${escapeHtml(record.note).replace(/\r?\n/g, '<br/>')}</p></section>` : '';
    const hoverCss = [...changeIds].map(id => `.cw-text-diff:has([data-cw-change="${id}"][data-cw-side="before"]:hover) [data-cw-change="${id}"][data-cw-side="after"],.cw-text-diff:has([data-cw-change="${id}"][data-cw-side="after"]:hover) [data-cw-change="${id}"][data-cw-side="before"]{outline:2px solid #1e573c;outline-offset:2px;background:#fff8d6;border-radius:2px}`).join('');
    return page(`变更记录 · ${record.documentTitle}`, `${topBar(`/changes/${token}`, {label: '在 Polarion 中打开变更工作台', href: polarionDocUrl(record.target, true), itemLabel: record.workItemId ? `记录工作项 ${record.workItemId}` : undefined, itemHref: record.workItemId ? polarionItemUrl(record.target, record.workItemId) : undefined})}<section class="cw-hero"><div class="cw-kicker">项目 ${escapeHtml(record.target.projectId)} · CHANGE RECORD</div><h1>${escapeHtml(record.documentTitle)}</h1><div class="cw-project-badge">项目：${escapeHtml(record.target.projectId)}</div><div class="cw-range">${escapeHtml(stamp(record.baselineAt))} → ${escapeHtml(stamp(record.endedAt))} · 历时 ${durationLabel(record.baselineAt, record.endedAt)}</div><div class="cw-stats"><div class="cw-stat"><b>${record.changedItems}</b><span>变更工作项</span></div><div class="cw-stat"><b>${record.modified}</b><span>修改</span></div><div class="cw-stat"><b>${record.added}</b><span>新增</span></div><div class="cw-stat"><b>${record.removed}</b><span>删除</span></div></div></section><section class="cw-section cw-summary">${ai}${summary}</section>${note}${renderChapters(record)}${renderFields(record)}${itemNav}<section class="cw-section"><h2>逐项对照</h2>${changesHtml || '<div class="cw-empty-state">本次基准期间没有检测到正文或属性变化。</div>'}</section><section class="cw-section"><h2>历史变更</h2><div class="cw-list">${records.filter(row => row.id !== record.id).slice(0, 12).map(row => `<a class="cw-record" href="/changes/${token}/${row.id}"><span class="cw-record-time">${escapeHtml(stamp(row.endedAt).slice(0, 10))}</span><span class="cw-record-main"><b>${escapeHtml(row.headline || `${row.changedItems} 个工作项变更`)}</b><small>${escapeHtml(stamp(row.endedAt))} · 修改 ${row.modified} · 新增 ${row.added} · 删除 ${row.removed}</small></span><span class="cw-record-arrow">›</span></a>`).join('') || '<div class="cw-empty-state">暂无其他历史记录</div>'}</div></section>`, hoverCss);
  }

}
