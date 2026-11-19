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

function timeOf(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayOf(ms: number) {
  return stamp(ms).slice(0, 10);
}

/** lark_md 里 * 是加粗语法：用户可控的标题/备注去重处理，避免内容破坏卡片结构。 */
function plain(value: string) {
  return value.replace(/\*/g, '＊');
}

function clip(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}

function duration(from: number, to: number) {
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}

/** 灰底数据条 / 引用块：经典卡片没有字号与背景样式，用 column_set 的 grey 底做出杂志式分区。 */
function greyBlock(content: string): CardElement {
  return {
    tag: 'column_set', flex_mode: 'none', background_style: 'grey',
    columns: [{tag: 'column', width: 'weighted', weight: 1, vertical_align: 'top', elements: [{tag: 'div', text: md(content)}]}],
  };
}

function stat(label: string, value: number): CardElement {
  return {
    tag: 'column', width: 'weighted', weight: 1, vertical_align: 'top',
    elements: [{tag: 'div', text: md(`**${value}**\n<font color='grey'>${label}</font>`)}],
  };
}

/** AI 总结转卡片摘要：主小节用绿色竖条标题、条目用圆点、四级标题只加粗；小节之间留空行，超长截断。 */
export function cardDigest(summary: string, limit = 800): string {
  const lines: string[] = [];
  let size = 0;
  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const section = /^#{2,3}\s+(.*)$/.exec(line);
    const minor = /^#{4}\s+(.*)$/.exec(line);
    if (section && lines.length) lines.push('');
    const title = section?.[1] ?? minor?.[1];
    let text = section
      ? `<font color='green'>▎</font>**${title!.replace(/\*\*/g, '')}**`
      : minor
        ? `**${title!.replace(/\*\*/g, '')}**`
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

export function buildChangeCard(input: {record: ChangeRecord; url: string; workItemUrl?: string; detailUrl?: string}): Card {
  const {record, url, workItemUrl, detailUrl} = input;
  const aiReady = record.aiSummary.status === 'ready' && record.aiSummary.text.trim().length > 0;
  const summary = aiReady ? record.aiSummary.text : record.heuristicSummary;
  const range = dayOf(record.baselineAt) === dayOf(record.endedAt)
    ? `${stamp(record.baselineAt)} → ${timeOf(record.endedAt)}`
    : `${stamp(record.baselineAt)} → ${stamp(record.endedAt)}`;
  const elements: CardElement[] = [
    // 数据条：四格等分，像杂志开篇的关键数字横条。
    {tag: 'column_set', flex_mode: 'bisect', background_style: 'grey', columns: [
      stat('变更工作项', record.changedItems), stat('修改', record.modified), stat('新增', record.added), stat('删除', record.removed),
    ]},
    {tag: 'div', text: md(`<font color='grey'>变更区间</font>　${range}　·　历时 ${duration(record.baselineAt, record.endedAt)}`)},
    // 总结放进灰底引用块，和统计条形成两种版式节奏。
    greyBlock(`**变更总结**　<font color='grey'>${aiReady ? 'AI 生成' : '自动摘要'}</font>\n${cardDigest(summary)}`),
  ];
  if (record.note?.trim()) elements.push(greyBlock(`**人工备注**\n${plain(record.note.trim())}`));
  // 唯一入口是变更详情深链：先落到记录工作项页，已安装插件的浏览器会立刻换到文档页并展开这条记录；
  // 没装插件的浏览器留在工作项页，正文里有安装提示（不再直接指向附件地址，避免一点就下载）。
  const target = detailUrl ?? workItemUrl ?? url;
  elements.push(
    {tag: 'hr'},
    {tag: 'action', actions: [{tag: 'button', text: {tag: 'plain_text', content: '打开变更详情'}, type: 'primary', url: target}]},
    {tag: 'note', elements: [{tag: 'plain_text', content: '点击按钮自动展开这条变更的逐项对照；未安装插件的浏览器会看到安装提示。'}]},
    {tag: 'note', elements: [{tag: 'plain_text', content: `记录已保存在 Polarion${record.workItemId ? `（工作项 ${record.workItemId}）` : ''} · Polarion 超级侧边栏 · ${stamp(Date.now())}`}]},
  );
  return {
    config: {wide_screen_mode: true},
    header: {
      template: 'green',
      title: {tag: 'plain_text', content: clip(record.documentTitle || '需求变更记录', 56)},
      subtitle: {tag: 'plain_text', content: `需求变更速览 · ${record.target.projectId}`},
      text_tag_list: [
        ...(aiReady ? [{tag: 'text_tag', text: {tag: 'plain_text', content: 'AI 总结'}, color: 'green'}] : []),
        {tag: 'text_tag', text: {tag: 'plain_text', content: `${record.changedItems} 个工作项`}, color: 'neutral'},
      ],
    },
    elements,
  };
}

export function buildTestCard(projectId: string): Card {
  return {
    config: {wide_screen_mode: true},
    header: {
      template: 'green',
      title: {tag: 'plain_text', content: 'Polarion 变更推送已连通'},
      subtitle: {tag: 'plain_text', content: projectId ? `需求变更速览 · ${projectId}` : '需求变更速览'},
    },
    elements: [
      greyBlock(`**测试卡片**\n机器人配置成功。此后「分享到飞书」会把${projectId ? ` ${projectId} 的` : ''}变更总结与详情入口作为卡片发到本群。`),
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

/** 每日晨报卡：整册体检摘要 + 模型巡检结论 + 待办提示；夜间/手动触发共用。 */
export function buildMorningCard(input: { projectId: string; document: string; at: number; quality: { checked: number; clean: number; findings: number; topRules: { ruleId: string; count: number }[] }; checks: { label: string; ok: boolean; changedFiles: number; findings: number; modules: string[] }[]; pendingProposals: number }): Card {
  const when = new Date(input.at).toLocaleString('zh-CN', { hour12: false });
  const qualityLine = input.quality.checked
    ? `体检 ${input.quality.checked} 条：${input.quality.clean} 通过 · ${input.quality.findings} 条有发现${input.quality.topRules.length ? `\n高频规则：${input.quality.topRules.map(rule => `${rule.ruleId} ×${rule.count}`).join('、')}` : ''}`
    : '整册体检未执行（无规则或读取失败）';
  const checkLines = input.checks.length
    ? input.checks.map(check => check.ok ? `${check.label}：与基准一致` : `${check.label}：${check.changedFiles} 个文件变化、${check.findings} 个模块需关注${check.modules.length ? `（${check.modules.slice(0, 5).join('、')}${check.modules.length > 5 ? '…' : ''}）` : ''}`).join('\n')
    : '模型巡检：未绑定目录或未设基准';
  return {
    config: {wide_screen_mode: true},
    header: {
      template: input.quality.findings || input.checks.some(check => !check.ok) ? 'orange' : 'green',
      title: {tag: 'plain_text', content: `晨报 · ${input.projectId}`},
      subtitle: {tag: 'plain_text', content: `${input.document.split('/').at(-1)} · ${when}`},
    },
    elements: [
      greyBlock(`**质量体检**\n${qualityLine}`),
      greyBlock(`**模型一致性**\n${checkLines}`),
      greyBlock(`**待办**\n待审批提案 ${input.pendingProposals} 条${input.pendingProposals ? '（侧栏收件箱处理）' : ''}`),
      {tag: 'note', elements: [{tag: 'plain_text', content: 'Polarion 超级侧边栏 · 自动晨报'}]},
    ],
  };
}

/** AI 预审评审汇总卡：按严重程度计数 + 未决问题清单；评审完成/分享时发送。 */
export function buildReviewCard(input: { projectId: string; document: string; at: number; issues: { severity: string; summary: string; workItemId?: string; suggestion?: string }[] }): Card {
  const open = input.issues;
  const bySeverity = { blocker: open.filter(issue => issue.severity === 'blocker').length, major: open.filter(issue => issue.severity === 'major').length, minor: open.filter(issue => issue.severity === 'minor').length };
  const lines = open.slice(0, 10).map((issue, index) => `${index + 1}. [${issue.severity}]${issue.workItemId ? ` ${issue.workItemId}：` : ' '}${issue.summary}${issue.suggestion ? `\n   建议：${issue.suggestion}` : ''}`);
  return {
    config: {wide_screen_mode: true},
    header: {
      template: bySeverity.blocker ? 'red' : bySeverity.major ? 'orange' : 'green',
      title: {tag: 'plain_text', content: `AI 预审汇总 · ${input.projectId}`},
      subtitle: {tag: 'plain_text', content: `${input.document.split('/').at(-1)} · ${new Date(input.at).toLocaleString('zh-CN', { hour12: false })}`},
    },
    elements: [
      greyBlock(`**评审结论**\n共 ${open.length} 个未决问题：阻断 ${bySeverity.blocker} · 重要 ${bySeverity.major} · 建议 ${bySeverity.minor}`),
      ...(lines.length ? [greyBlock(`**问题清单（前 10 条）**\n${lines.join('\n')}`)] : []),
      {tag: 'note', elements: [{tag: 'plain_text', content: 'Polarion 超级侧边栏 · AI 预审'}]},
    ],
  };
}
