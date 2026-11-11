// 飞书卡片离线自检：本地假 webhook 接收贺卡，校验结构与按钮地址，不向真实群发送任何消息。
// 用法：node scripts/feishu-sink-test.mjs [recordId]
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {buildChangeCard, sendCardToGroups} from '../apps/host/feishu.ts';

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

const compareUrl = `https://polarion.pufafen.com/polarion/wi-attachment/${encodeURIComponent(record.target.projectId)}/${encodeURIComponent(record.workItemId ?? 'SPE-0000')}/sidebar-change-${record.id}.html`;
const card = buildChangeCard({record, url: 'http://127.0.0.1/share-page', compareUrl});
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
const buttons = elements.filter(element => element.tag === 'action').flatMap(element => element.actions ?? []);
check('只有一个按钮', buttons.length === 1, `实际 ${buttons.length}`);
const button = buttons[0] ?? {};
check('按钮文案 = 打开逐项对照页', button.text?.content === '打开逐项对照页', button.text?.content ?? '');
check('按钮指向 Polarion 对照页附件', String(button.url ?? '').includes('/polarion/wi-attachment/') && String(button.url ?? '').endsWith('.html'), String(button.url ?? '').slice(0, 90));
check('题头为绿色', payload.card?.header?.template === 'green');
check('题头含项目号', String(payload.card?.header?.title?.content ?? '').includes(record.target.projectId));
const digest = elements.find(element => String(element.text?.content ?? '').startsWith('**变更总结**'));
console.log('变更总结长度:', digest ? String(digest.text.content).length : 0, '字');
console.log('记录:', record.workItemId, record.target.projectId, record.changedItems + ' 项变更');
