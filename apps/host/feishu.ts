import {createHmac} from 'node:crypto';
import type {ChangeRecord, FeishuSendResult} from '../../packages/protocol/index.ts';

/**
 * 飞书推送：把变更记录做成交互卡片，经群自定义机器人 webhook 直发。
 * - 用经典 card JSON（绿色题头 + 两列字段 + 按钮），不依赖卡片 2.0，各端飞书都能渲染；
 * - 机器人开启「签名校验」时按官方算法附 timestamp + sign（HMAC-SHA256，密钥为 timestamp+"\n"+secret）；
 * - webhook 与密钥是凭证：只存本机 store，不写日志，报错也不回显地址。
 */

type CardElement = Record<string, unknown>;
type Card = {config: Record<string, unknown>; header: Record<string, unknown>; elements: CardElement[]};

type SendTarget = Pick<import('../../packages/protocol/index.ts').FeishuGroup, 'label' | 'webhook' | 'secret'>;

function md(text: string) {
  return {tag: 'lark_md', content: text};
}

function stamp(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** lark_md 里 * 是加粗语法：用户可控的标题/备注去重处理，避免内容破坏卡片结构。 */
function plain(value: string) {
  return value.replace(/\*/g, '＊');
}

/** AI 总结转卡片摘要：标题行降为粗体、列表转圆点，超长截断并提示看链接。 */
export function cardDigest(summary: string, limit = 1100): string {
  const lines: string[] = [];
  let size = 0;
  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{2,4}\s+(.*)$/.exec(line);
    let text = heading
      ? `**${heading[1]!.replace(/\*\*/g, '')}**`
      : line.replace(/^[-*]\s+/, '• ');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[ \t]+/g, ' ');
    if (size + text.length > limit) {
      lines.push('……（其余要点见详情链接）');
      break;
    }
    lines.push(text);
    size += text.length + 1;
  }
  return lines.join('\n');
}

export function buildChangeCard(input: {record: ChangeRecord; url: string; workItemUrl?: string; compareUrl?: string}): Card {
  const {record, url, workItemUrl, compareUrl} = input;
  const summary = record.aiSummary.status === 'ready' && record.aiSummary.text.trim() ? record.aiSummary.text : record.heuristicSummary;
  const elements: CardElement[] = [
    {tag: 'div', text: md(`**${plain(record.documentTitle)}**`)},
    {tag: 'div', fields: [
      {is_short: true, text: md(`**变更区间**\n${stamp(record.baselineAt)} → ${stamp(record.endedAt)}`)},
      {is_short: true, text: md(`**变更规模**\n${record.changedItems} 个工作项（改 ${record.modified} · 增 ${record.added} · 删 ${record.removed}）`)},
    ]},
    {tag: 'div', text: md(`**变更总结**\n${cardDigest(summary)}`)},
  ];
  if (record.note?.trim()) elements.push({tag: 'div', text: md(`**备注**\n${plain(record.note.trim())}`)});
  // 唯一入口指向逐项对照页：对照页作为 HTML 附件存在 Polarion 记录工作项下，任何项目成员都能打开，不依赖分享者的电脑。
  const target = compareUrl ?? workItemUrl ?? url;
  elements.push(
    {tag: 'hr'},
    {tag: 'action', actions: [{tag: 'button', text: {tag: 'plain_text', content: '打开逐项对照页'}, type: 'primary', url: target}]},
    {tag: 'note', elements: [{tag: 'plain_text', content: `对照页已随记录存入 Polarion${record.workItemId ? `（工作项 ${record.workItemId} 附件）` : ''}；点击按钮即可打开。`}]},
    {tag: 'note', elements: [{tag: 'plain_text', content: `Polarion 超级侧边栏 · ${stamp(Date.now())} 推送`}]},
  );
  return {
    config: {wide_screen_mode: true},
    header: {template: 'green', title: {tag: 'plain_text', content: `需求变更速览 · ${record.target.projectId}`}},
    elements,
  };
}

export function buildTestCard(projectId: string): Card {
  return {
    config: {wide_screen_mode: true},
    header: {template: 'green', title: {tag: 'plain_text', content: `Polarion 变更推送已连通${projectId ? ` · ${projectId}` : ''}`}},
    elements: [
      {tag: 'div', text: md(`**测试卡片**\n机器人配置成功。此后「分享到飞书」会把${projectId ? ` ${projectId} 的` : ''}变更总结与详情链接作为卡片发到本群。`)},
      {tag: 'note', elements: [{tag: 'plain_text', content: 'Polarion 超级侧边栏 · 设置测试发送'}]},
    ],
  };
}

/** 逐群发送；单群失败不影响其他群，错误信息不含 webhook 地址。 */
export async function sendCardToGroups(groups: SendTarget[], card: Card): Promise<FeishuSendResult[]> {
  return Promise.all(groups.map(async group => {
    try {
      const body: Record<string, unknown> = {msg_type: 'interactive', card};
      const secret = group.secret.trim();
      if (secret) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        body.timestamp = timestamp;
        body.sign = createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
      }
      const response = await fetch(group.webhook, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return {label: group.label, ok: false, error: `HTTP ${response.status}`};
      // 飞书 webhook 出错时通常仍返回 200，用 body 里的 code 表达。
      let payload: {code?: number; msg?: string} = {};
      try { payload = JSON.parse(await response.text()) as {code?: number; msg?: string}; } catch { /* 非 JSON 按原文为空处理 */ }
      if (payload.code && payload.code !== 0) return {label: group.label, ok: false, error: payload.msg || `code ${payload.code}`};
      return {label: group.label, ok: true};
    } catch (exception) {
      const message = exception instanceof Error ? exception.message : String(exception);
      return {label: group.label, ok: false, error: message.split('\n')[0]};
    }
  }));
}
