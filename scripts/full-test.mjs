// 全功能 + 性能测试（真实 Polarion / 真实飞书）：用修正后的客户端
import {call} from './host-client.mjs';

const target = {origin: 'https://polarion.pufafen.com', projectId: '45_SPE25_BQ1_TM_002', document: 'Design/Software Requirement Specification SWR'};
const recordId = '372a32ae-f67f-49bb-8859-3bab5eee75bc';
const step = async (label, command, timeoutMs) => {
  const reply = await call(command, timeoutMs);
  console.log(`${label}: ${reply.ok ? 'OK' : 'FAIL[' + String(reply.error).slice(0, 90) + ']'} ${reply.ms}ms`);
  return reply;
};

const health = await step('health', {method: 'health'}, 15000);
console.log('  host pid:', health.value?.pid);

for (let i = 1; i <= 3; i++) await step(`record.read #${i}`, {method: 'changes.record.read', recordId}, 60000);
await step('workspace.read', {method: 'changes.workspace.read', target}, 120000);
await step('feishu.groups', {method: 'changes.feishu.groups', target}, 60000);
await step('share.publish', {method: 'changes.share.publish', recordId}, 120000);

const share = await step('share.feishu（卡片 + HTML 附件 + 推送）', {method: 'changes.share.feishu', recordId}, 300000);
if (share.ok) {
  console.log('  recordUrl:', share.value.recordUrl);
  for (const row of share.value.results ?? []) console.log('  群:', row.label, row.ok ? '✓' : '✗ ' + row.error);
}
process.exit(0);
