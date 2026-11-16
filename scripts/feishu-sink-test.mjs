// 飞书卡片离线自检：本地假 webhook 接收贺卡，校验结构与按钮地址，不向真实群发送任何消息。
// 用法：node scripts/feishu-sink-test.mjs [recordId]
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {buildChangeCard, sendCardToGroups} from '../apps/host/feishu.ts';
import {parseChangeDeepLink, pendingChangeRecordId} from '../apps/extension/lib/change-deep-link.ts';

const data = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Nanju', 'PolarionSidebar');
const db = new DatabaseSync(path.join(data, 'state.sqlite'), {readOnly: true});
const rows = db.prepare("SELECT id, json FROM records WHERE kind='change-record'").all();
db.close();
const wanted = process.argv[2];
const row = wanted ? rows.find(r => r.id === wanted) : rows[0];
if (!row) throw Error('没有可用的变更记录缓存（先在工作台打开一条记录）');
const record = JSON.parse(row.json);

let received = null;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    received = {headers: request.headers, body};
    response.writeHead(200, {'content-type': 'application/json'});
    response.end('{"code":0,"msg":"success"}');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const origin = 'https://polarion.pufafen.com';
const detailUrl = `${origin}/polarion/#/project/${encodeURIComponent(record.target.projectId)}/workitem?id=${encodeURIComponent(record.workItemId ?? 'SPE-0000')}&psb=changes&psbChange=${encodeURIComponent(record.id)}&psbDoc=${encodeURIComponent(record.target.document)}`;
const card = buildChangeCard({record, url: 'http://127.0.0.1/share-page', detailUrl});
const results = await sendCardToGroups([{label: '本地假群', webhook: `http://127.0.0.1:${port}/hook`, secret: 'test-secret'}], card);
await new Promise(resolve => server.close(resolve));

const check = (name, ok, extra = '') => console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
console.log('发送结果:', JSON.stringify(results));
check('假 webhook 收到请求', !!received);
if (!received) process.exit(1);
const payload = JSON.parse(received.body);
check('msg_type = interactive', payload.msg_type === 'interactive');
check('带签名 timestamp/sign', typeof payload.timestamp === 'string' && typeof payload.sign === 'string');
const elements = payload.card?.elements ?? [];
const header = payload.card?.header ?? {};
check('题头为绿色', header.template === 'green');
check('题头主标题 = 文档标题', header.title?.content === record.documentTitle, header.title?.content ?? '');
check('题头副标题含项目号', String(header.subtitle?.content ?? '').includes(record.target.projectId), header.subtitle?.content ?? '');
check('题头标签含工作项数', (header.text_tag_list ?? []).some(tag => String(tag.text?.content ?? '').includes(String(record.changedItems))));
const statStrip = elements[0] ?? {};
const statTexts = (statStrip.columns ?? []).map(column => String(column.elements?.[0]?.text?.content ?? ''));
check('首屏是四格统计条', statStrip.tag === 'column_set' && statTexts.length === 4, `${statStrip.tag} × ${statTexts.length}`);
check('统计条覆盖工作项/修改/新增/删除', ['变更工作项', '修改', '新增', '删除'].every(label => statTexts.some(text => text.includes(label))), statTexts.map(text => text.replace(/\n/g, ' ')).join(' | '));
const greyBlocks = elements.filter(element => element.tag === 'column_set');
const summaryBlock = greyBlocks.map(element => String(element.columns?.[0]?.elements?.[0]?.text?.content ?? '')).find(text => text.startsWith('**变更总结**')) ?? '';
check('变更总结使用灰底引用块', !!summaryBlock);
check('总结标注生成方式', /AI 生成|自动摘要/.test(summaryBlock), summaryBlock.slice(0, 60).replace(/\n/g, ' '));
check('变更区间单行展示', elements.some(element => String(element.text?.content ?? '').includes('变更区间') && String(element.text?.content ?? '').includes('历时')));
const buttons = elements.filter(element => element.tag === 'action').flatMap(element => element.actions ?? []);
check('只有一个按钮', buttons.length === 1, `实际 ${buttons.length}`);
const button = buttons[0] ?? {};
check('按钮文案 = 打开变更详情', button.text?.content === '打开变更详情', button.text?.content ?? '');
const buttonUrl = String(button.url ?? '');
check('按钮指向记录工作项深链', buttonUrl.includes('/polarion/#/project/') && buttonUrl.includes('/workitem?id=') && buttonUrl.includes('psb=changes') && buttonUrl.includes('psbChange='), buttonUrl.slice(0, 120));
check('按钮不再指向附件下载地址', !buttonUrl.includes('/wi-attachment/'));
const parsed = parseChangeDeepLink(new URL(buttonUrl).hash, origin);
check('深链能换到同一篇文档页', !!parsed && parsed.recordId === record.id && parsed.docUrl.includes('/wiki/'), parsed?.docUrl.slice(0, 120) ?? '');
check('深链保留原始记录 id', pendingChangeRecordId(new URL(buttonUrl).hash) === record.id);
check('卡片提示包含插件安装说明', elements.some(element => String(element.elements?.[0]?.content ?? '').includes('未安装插件')));
console.log('变更总结长度:', summaryBlock.length, '字');
console.log('卡片结构:', elements.map(element => element.tag).join(' → '));
console.log('记录:', record.workItemId, record.target.projectId, record.changedItems + ' 项变更');
