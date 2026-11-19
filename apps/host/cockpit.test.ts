import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.ts';
import { Gates } from './gates.ts';
import { Reviews, parseJsonBlock } from './reviews.ts';
import { Worksets } from './worksets.ts';
import { Snapshots } from './snapshots.ts';
import type { Coverage } from './coverage.ts';
import { Macros } from './macros.ts';
import { defaultRulePack } from '../../packages/core/requirement-lint.ts';
import type { Run, Target, WorkEvent } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'ck-test', document: 'Requirements/Ck' };

function openStore(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-db-'));
  const store = new Store(path.join(dir, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

function seedCoverage(store: Store, rows: { id: string; title: string; text: string; modules?: string[]; forward?: { workItemId: string; role: string }[]; back?: { workItemId: string; role: string }[] }[]) {
  store.put('coverage-index', target.projectId, {
    id: target.projectId, projectId: target.projectId, at: Date.now(), total: rows.length,
    items: rows.map(row => ({ workItemId: row.id, title: row.title, type: 'Requirement', outline: '', updated: 'v1', marks: row.modules ? [{ rootId: 'r1', modules: row.modules }] : [], text: row.text, forwardLinks: row.forward ?? [], backLinks: row.back ?? [] })),
  });
}

test('parseJsonBlock：围栏优先，兜底整段，失败抛错', () => {
  assert.deepEqual(parseJsonBlock('说明\n```json\n[1,2]\n```\n尾注'), [1, 2]);
  assert.deepEqual(parseJsonBlock('{"a":1}'), { a: 1 });
  assert.throws(() => parseJsonBlock('完全不是 JSON'), /JSON_BLOCK_UNPARSEABLE/);
});

test('Gates：四道门逐条判定与汇总（质量/准则/链接/模块）', async t => {
  const store = openStore(t);
  // @ts-expect-error 测试桩：只用 read()，不触达 Polarion。
  const gates = new Gates(store, { read: async () => ({ pack: defaultRulePack(), source: 'default' }) });
  await assert.rejects(() => gates.view(target), /GATES_INDEX_EMPTY/);
  seedCoverage(store, [
    { id: 'SPE-1', title: '全过条目', text: '系统应在 300ms 内退出高压状态，满足判据要求。', modules: ['A'], forward: [{ workItemId: 'SYS-1', role: 'derives' }] },
    { id: 'SPE-2', title: '缺准则', text: '系统尽快退出高压。', modules: ['A'], forward: [{ workItemId: 'SYS-2', role: 'relates_to' }] },
    { id: 'SPE-3', title: '缺链接', text: '当信号由 0x0 跳变为 0x1 时应在 100ms 内动作。', modules: [] },
  ]);
  const view = await gates.view(target);
  assert.equal(view.summary.total, 3);
  assert.equal(view.summary.passed, 1);
  assert.equal(view.summary.byGate.criterion, 1);
  assert.equal(view.summary.byGate.upstream, 1);
  assert.equal(view.summary.byGate.module, 1);
  assert.equal(view.summary.byGate.quality, 1); // “尽快”命中严格基线的模糊词
  const pass = view.items.find(item => item.workItemId === 'SPE-1')!;
  assert.ok(pass.passed);
  const noCriterion = view.items.find(item => item.workItemId === 'SPE-2')!;
  assert.equal(noCriterion.gates.find(gate => gate.gate === 'criterion')!.pass, false);
});

test('Reviews：decide 处置问题卡，全部处置完自动 done', t => {
  const store = openStore(t);
  const reviews = new Reviews(store);
  store.put('review-record', 'rv1', { id: 'rv1', projectId: target.projectId, document: target.document, at: 1, status: 'open', issues: [
    { id: 'i1', workItemId: 'SPE-1', severity: 'major', summary: '判据不可验证', status: 'open' },
    { id: 'i2', severity: 'minor', summary: '措辞建议', status: 'open' },
  ] });
  const afterFirst = reviews.decide('rv1', 'i1', 'resolved');
  assert.equal(afterFirst.status, 'open');
  const afterAll = reviews.decide('rv1', 'i2', 'ignored');
  assert.equal(afterAll.status, 'done');
  assert.equal(afterAll.issues[0]!.status, 'resolved');
  assert.equal(reviews.list(target)[0]!.issues.length, 2);
  assert.throws(() => reviews.decide('rv1', 'nope', 'resolved'), /REVIEW_ISSUE_NOT_FOUND/);
});

test('Worksets：四类活队列 + 重名保护', t => {
  const store = openStore(t);
  const worksets = new Worksets(store);
  const gaps = worksets.save(target, { name: '覆盖缺口', kind: 'gaps', query: '' });
  worksets.save(target, { name: '孤立', kind: 'orphans', query: '' });
  const search = worksets.save(target, { name: '高压相关', kind: 'search', query: '高压' });
  assert.throws(() => worksets.save(target, { name: '覆盖缺口', kind: 'gaps', query: '' }), /WORKSET_NAME_EXISTS/);
  seedCoverage(store, [
    { id: 'SPE-1', title: '高压下电', text: '高压部件 300ms 内退出。', modules: ['A'], forward: [{ workItemId: 'SYS-1', role: 'derives' }], back: [{ workItemId: 'TC-1', role: 'verifies' }] },
    { id: 'SPE-2', title: 'CAN 唤醒', text: '唤醒后进入正常模式。' },
    { id: 'SPE-3', title: '高压上电', text: '高压上电自检。', modules: ['A'] },
  ]);
  const gapItems = worksets.items(target, gaps.id);
  assert.deepEqual(gapItems.items.map(item => item.workItemId), ['SPE-2', 'SPE-3']); // SPE-3 缺链接、SPE-2 全缺
  assert.match(gapItems.items[0]!.reason, /上游.*模块.*验证/);
  const orphanItems = worksets.items(target, worksets.list(target.projectId).find(set => set.kind === 'orphans')!.id);
  assert.deepEqual(orphanItems.items.map(item => item.workItemId), ['SPE-2']);
  const searchItems = worksets.items(target, search.id);
  assert.deepEqual(searchItems.items.map(item => item.workItemId), ['SPE-1', 'SPE-3']);
  // quality 活队列：读取最近一次整册体检结果。
  store.put('quality-report', target.projectId, { at: 1, total: 2, checked: 2, clean: 1, items: [
    { workItemId: 'SPE-1', title: '高压下电', outline: '', issues: [] },
    { workItemId: 'SPE-2', title: 'CAN 唤醒', outline: '', issues: [{ ruleId: 'r', severity: 'warn', message: '模糊词', matchedText: '尽快' }] },
  ], byRule: [], ruleSource: 'default' });
  const qualitySet = worksets.save(target, { name: '体检发现', kind: 'quality', query: '' });
  assert.deepEqual(worksets.items(target, qualitySet.id).items.map(item => item.workItemId), ['SPE-2']);
  worksets.remove(search.id);
  assert.equal(worksets.list(target.projectId).length, 3);
});

test('Macros：从会话录制（跳过工作流自动轮）、定时到点去重', t => {
  const store = openStore(t);
  const session = store.createSession(target, '宏会话');
  const seedRun = (prompt: string, workflow: boolean, startedAt: number) => {
    const run = store.startRun(session.id, crypto.randomUUID(), prompt, [], target).run;
    run.startedAt = startedAt;
    if (workflow) run.workflow = { workflowRunId: 'w', defName: 'd', stepIndex: 0, stepTotal: 1, stepTitle: 's' };
    store.put('run', run.id, run);
    return run;
  };
  seedRun('第一条用户指令', false, 100);
  seedRun('工作流自动轮（不应录）', true, 200);
  seedRun('第二条用户指令', false, 300);
  const macros = new Macros(store);
  const macro = macros.capture(session.id, '每日巡检话术', 3);
  assert.deepEqual(macro.steps, ['第一条用户指令', '第二条用户指令']);
  assert.throws(() => macros.capture(session.id, '每日巡检话术', 1), /MACRO_NAME_EXISTS/);
  // 定时：到点出现且当天只出现一次。
  const scheduled = macros.schedule(macro.id, '07:30', target);
  assert.equal(scheduled.scheduleAt, '07:30');
  const at = new Date('2026-11-20T07:30:00');
  assert.equal(macros.due(at).length, 1);
  store.put('macro-sent', macros.due(at)[0]!.marker, { at: 1 });
  assert.equal(macros.due(at).length, 0);
  // 取消定时。
  macros.schedule(macro.id, '', target);
  assert.equal(macros.due(at).length, 0);
});

test('门禁策略：停用的门直接通过、质量分与阈值随策略返回并可持久化', async t => {
  const store = openStore(t);
  // @ts-expect-error 测试桩：read 返回内置规则包
  const gates = new Gates(store, { read: async () => ({ pack: defaultRulePack(), source: 'default' }) });
  seedCoverage(store, [
    { id: 'SPE-1', title: '全过', text: '当检测到碰撞时应在 300ms 内断开高压。', modules: ['A'], forward: [{ workItemId: 'SYS-1', role: 'derives' }] },
    { id: 'SPE-2', title: '缺模块缺链接', text: '系统应尽快响应。' },
  ]);
  let view = await gates.view(target);
  assert.equal(view.policy.enabled.module, true);
  assert.equal(view.summary.passed, 1);
  assert.equal(view.summary.qualityScore, 50); // SPE-2 命中“尽快”警示
  // 停用质量门与模块门 → 只剩准则/链接
  gates.savePolicy(target.projectId, { enabled: { quality: false, criterion: true, upstream: true, module: false }, minQualityScore: 0 });
  view = await gates.view(target);
  const missing = view.items.find(item => item.workItemId === 'SPE-2')!;
  assert.equal(missing.gates.find(gate => gate.gate === 'quality')!.pass, true);
  assert.match(missing.gates.find(gate => gate.gate === 'quality')!.detail, /已停用/);
  assert.equal(missing.gates.find(gate => gate.gate === 'module')!.detail, '策略已停用');
  assert.equal(missing.gates.find(gate => gate.gate === 'upstream')!.pass, false); // 未停用的门照常判定
  assert.equal(gates.policy(target.projectId).enabled.quality, false);
});

test('基线快照：保存/列出/前后对比增量', async t => {
  const store = openStore(t);
  let orphanCount = 3, qualityClean = 2, gatesPassed = 1;
  const coverage = { view: () => ({ items: new Array(5).fill(null).map((_, index) => ({ workItemId: 'W' + index })), summary: { withUpstream: 1, withModule: 2, withVerification: 0, orphans: orphanCount } }) } as unknown as Coverage;
  const gates = { view: async () => ({ summary: { total: 5, passed: gatesPassed, byGate: { quality: 0, criterion: 1, upstream: 1, module: 2 } } }) } as unknown as Gates;
  const reviews = { list: () => [{ issues: [{ status: 'open' }, { status: 'resolved' }] }] } as unknown as Reviews;
  const snapshots = new Snapshots(store, coverage, gates, reviews);
  store.put('quality-report', target.projectId, { checked: 5, clean: qualityClean, byRule: [] });
  const first = await snapshots.save(target, '发版前');
  assert.equal(first.coverage!.orphans, 3);
  assert.equal(first.quality!.score, 40);
  assert.equal(first.gates!.passed, 1);
  assert.equal(first.openIssues, 1);
  orphanCount = 1; qualityClean = 4; gatesPassed = 4;
  store.put('quality-report', target.projectId, { checked: 5, clean: qualityClean, byRule: [] }); // 重新跑过体检
  const second = await snapshots.save(target, '一周后');
  const list = snapshots.list(target.projectId);
  assert.deepEqual(list.map(row => row.label), ['一周后', '发版前']);
  const diff = snapshots.diff(target);
  assert.equal(diff.previous!.id, first.id);
  assert.deepEqual(diff.delta, { coverageOrphans: -2, qualityScore: 40, gatesPassed: 3, openIssues: 0 });
  assert.equal(second.quality!.score, 80);
  assert.throws(() => new Snapshots(store, coverage, gates, reviews).diff({ ...target, projectId: 'empty' }), /SNAPSHOT_EMPTY/);
});

test('宏重放：新会话首条 run（初始即 running）必须直接 execute，而不是只 pump', (t) => {
  const store = openStore(t);
  const session = store.createSession(target, '宏源');
  const run = store.startRun(session.id, crypto.randomUUID(), '第一条', [], target).run;
  run.status = 'completed'; store.put('run', run.id, run);
  const macros = new Macros(store);
  const macro = macros.capture(session.id, '重放验证', 1);
  const executed: string[] = [];
  let pumped = 0;
  macros['engines'] = { execute: async (r: { id: string }) => { executed.push(r.id); }, pump: () => { pumped++; } } as never;
  const fresh = store.createSession(target, '宏目标');
  const result = macros.run(fresh.id, macro.id, target, [], 'auto');
  assert.equal(result.started, 1);
  assert.equal(executed.length, 1, '首条必须被 execute'); // 回归：以前这里为 0，pump 也未被调用
  assert.equal(pumped, 0);
});
