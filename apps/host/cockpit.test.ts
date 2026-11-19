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
import { Service } from './service.ts';
import { Drafts, Polarion } from './polarion.ts';
import { PROJECT_EVENT_LIMIT, isCoverageOrphan, isInboxPendingProposal, openReviewIssues, type Command, type CoverageView, type DashboardView, type DocumentQualityReport, type Proposal, type ReviewRecordView, type Target, type TimelineView, type WatchView, type WorkEvent } from '../../packages/protocol/index.ts';

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

async function request<T>(service: Service, command: Command): Promise<T> {
  const reply = await service.request({ protocol: 1, id: crypto.randomUUID(), command });
  if (!reply.ok) assert.fail(`${command.method}: ${reply.error}`);
  return reply.value as T;
}

function offlineService(t: TestContext) {
  const store = openStore(t);
  const remote = new Polarion();
  remote.start = () => { throw Error('Unexpected remote transport'); };
  return { store, remote, service: new Service(store, new Drafts(store, remote)) };
}

test('dashboard drilldowns use exact document proposals, warning alerts, project reviews and the newest 500 project events', async t => {
  const { store, service } = offlineService(t);
  const otherDocument = { ...target, document: 'Requirements/Other' };
  const otherProject = { ...target, projectId: 'elsewhere' };
  for (const [id, scope, status, kind] of [
    ['mine', target, 'pending', 'replace-all-text'], ['tool', target, 'pending', 'tool'], ['gate', target, 'pending', 'gate'],
    ['history', target, 'applied', 'replace-all-text'], ['other-doc', otherDocument, 'pending', 'replace-all-text'], ['other-project', otherProject, 'pending', 'replace-all-text'],
  ] as const) store.put('proposal', id, { id, target: scope, status, op: { kind }, createdAt: 1 });
  const putReview = (id: string, at: number, scope: Target, status: string, cards: string[]) => store.put('review-record', id, {
    id, at, projectId: scope.projectId, document: scope.document, status, issues: cards.map((status, index) => ({ id: `${id}-${index}`, severity: 'minor', summary: id, status })),
  });
  putReview('outside-window', 1, target, 'open', ['open']);
  for (let at = 2; at <= 18; at++) putReview(`finished-${at}`, at, target, 'done', []);
  putReview('closed-with-old-card', 19, target, 'done', ['open']);
  putReview('local', 20, target, 'open', ['open', 'resolved', 'ignored']);
  putReview('foreign-doc', 21, otherDocument, 'open', ['open', 'open']);
  putReview('foreign-project', 22, otherProject, 'open', ['open']);
  store.put('model-roots', target.projectId, { roots: [{ id: 'one', label: 'one', path: 'fixture' }, { id: 'two', label: 'two', path: 'fixture' }] });
  store.put('model-check', target.projectId + ':one', { baselineAt: 1, at: 2, findings: [{ side: 'model', moduleName: 'X', workItems: [] }] });
  seedCoverage(store, [
    { id: 'O', title: '孤立', text: '' }, { id: 'V', title: '只有验证', text: '', forward: [{ workItemId: 'T-1', role: 'validates' }] },
    { id: 'M', title: '只有实现', text: '', modules: ['M'] }, { id: 'U', title: '只有上游', text: '', forward: [{ workItemId: 'U-1', role: 'derives' }] },
  ]);
  for (const [id, scope, origin] of [['dynamic', target, 'dynamic'], ['saved', target, 'manual'], ['elsewhere', otherProject, 'manual']] as const) {
    store.put('workflow-def', id, { id, projectId: scope.projectId, origin, updatedAt: 1 });
  }
  service.worksets.save(target, { name: 'm', kind: 'orphans', query: '' });
  service.worksets.save(otherProject, { name: 'elsewhere', kind: 'gaps', query: '' });
  for (let n = 1; n <= 505; n++) service.events.record(target.projectId, 'note', String(n), { workItemId: n % 2 ? 'IN-DOC' : 'OTHER-DOC' });
  service.events.record(otherProject.projectId, 'note', 'unrelated');
  const dashboard = await request<DashboardView>(service, { method: 'dashboard.view', target });
  const proposals = await request<Proposal[]>(service, { method: 'proposals.list', target });
  const alerts = await request<WatchView>(service, { method: 'watch.view', target });
  const reviews = await request<ReviewRecordView[]>(service, { method: 'review.list', target });
  const coverage = await request<CoverageView>(service, { method: 'coverage.view', target });
  const events = await request<WorkEvent[]>(service, { method: 'events.list', projectId: target.projectId, limit: PROJECT_EVENT_LIMIT });
  assert.deepEqual(proposals.filter(isInboxPendingProposal).map(row => row.id), ['mine']);
  assert.equal(dashboard.pendingProposals, 1);
  assert.deepEqual(alerts.alerts.map(row => row.level), ['warn', 'info']); assert.equal(dashboard.alerts, 1);
  assert.equal(reviews.length, 20); assert.equal(reviews[0]?.document, otherDocument.document);
  assert.deepEqual(reviews.flatMap(openReviewIssues).map(card => card.id), ['foreign-doc-0', 'foreign-doc-1', 'local-0']); assert.equal(dashboard.reviewOpen, 3);
  assert.deepEqual(coverage.items.filter(isCoverageOrphan).map(row => row.workItemId), ['O']); assert.equal(dashboard.coverage?.orphans, 1);
  assert.deepEqual([dashboard.workflows, dashboard.worksets], [2, 1]);
  assert.equal(dashboard.events, 500); assert.equal(events.length, dashboard.events);
  assert.equal(events[0]?.subject, '505'); assert.equal(events.at(-1)?.subject, '6');
  assert(events.every(row => row.projectId === target.projectId)); assert.equal(new Set(events.map(row => row.workItemId)).size, 2);
  const projectTimeline = await request<TimelineView>(service, { method: 'timeline.view', target });
  const itemTimeline = await request<TimelineView>(service, { method: 'timeline.view', target, workItemId: 'IN-DOC' });
  assert.equal(projectTimeline.scope, 'project'); assert.equal(projectTimeline.entries.length, 400);
  assert.equal(itemTimeline.scope, 'item'); assert.equal(itemTimeline.entries.length, 200);
  const overflow = await service.request({ protocol: 1, id: crypto.randomUUID(), command: { method: 'events.list', projectId: target.projectId, limit: 501 } });
  assert.equal(overflow.ok, false);
});

test('last quality report preserves historical and foreign-document data without running a scan or recording an event', async t => {
  const { store, service } = offlineService(t);
  const empty: DocumentQualityReport = { at: 5, total: 0, checked: 0, clean: 0, items: [], byRule: [], ruleSource: 'default' };
  assert.equal(await request(service, { method: 'quality.document.last', target }), null);
  store.put('quality-report', target.projectId, empty);
  assert.deepEqual(await request(service, { method: 'quality.document.last', target }), empty);
  assert.equal((await request<DashboardView>(service, { method: 'dashboard.view', target })).quality?.findings, 0);
  const otherDocument = { ...empty, document: 'Requirements/Second', at: 9 };
  store.put('quality-report', target.projectId, otherDocument);
  assert.deepEqual(await request(service, { method: 'quality.document.last', target }), otherDocument);
  assert.equal(await request(service, { method: 'quality.document.last', target: { ...target, projectId: 'elsewhere' } }), null);
  assert.equal(service.events.list(target.projectId).length, 0);
});

test('document quality includes text past 1200 characters, dirty draft bodies, read-only references and unreadable items', async t => {
  const { store, remote, service } = offlineService(t);
  const ids = ['LONG', 'DIRTY', 'REFERENCE', 'UNREADABLE', 'CLEAN'];
  remote.outline = async () => ({ documentId: target.document, title: 'fixture', items: ids.map((id, i) => ({ id, title: id, type: 'requirement', status: 'draft', outline: String(i + 1) })) });
  remote.changeList = async () => [];
  const reads: string[] = [];
  remote.read = async (_scope, id) => {
    reads.push(id);
    if (id === 'REFERENCE') throw Error('WORK_ITEM_DOCUMENT_MISMATCH');
    if (id === 'UNREADABLE') throw Error('unavailable');
    return { id, title: id, description: id === 'LONG' ? `<p>${'读取；'.repeat(450)}</p><table><tr><td><p>尽快</p></td></tr></table>` : '<p>100 ms</p>', updated: 'v1' };
  };
  remote.peek = async (_scope, workItemId) => ({ workItemId, title: workItemId, description: '<p>尽快</p>' });
  const dirty = { id: crypto.randomUUID(), target, workItemId: 'DIRTY', title: '本地标题', state: 'dirty', revision: 2, baseHtml: '<p>100 ms</p>', baseUpdated: 'v1', html: '<p>尽快</p>' };
  store.put('draft', dirty.id, dirty);
  const report = await request<DocumentQualityReport>(service, { method: 'quality.document.check', target, limit: 300 });
  assert.equal(report.document, target.document); assert.deepEqual([report.total, report.checked, report.clean], [5, 5, 1]);
  for (const id of ['LONG', 'DIRTY', 'REFERENCE']) assert(report.items.find(row => row.workItemId === id)?.issues.some(issue => issue.ruleId === 'fuzzy-default' && issue.matchedText === '尽快'), id);
  assert.equal(report.items.find(row => row.workItemId === 'DIRTY')?.title, dirty.title); assert(!reads.includes('DIRTY'));
  assert.equal(report.items.find(row => row.workItemId === 'REFERENCE')?.readOnlyReference, true);
  assert.equal(report.items.find(row => row.workItemId === 'UNREADABLE')?.unreadable, true);
  assert.deepEqual(await request(service, { method: 'quality.document.last', target }), report);
  assert.equal((await request<DashboardView>(service, { method: 'dashboard.view', target })).quality?.findings, 4);
  assert.equal(service.events.list(target.projectId).length, 1);
  const qualitySet = service.worksets.save(target, { name: '最近报告', kind: 'quality', query: '' });
  const items = service.worksets.items({ ...target, document: 'Requirements/Other' }, qualitySet.id).items;
  assert.deepEqual(items.map(row => row.workItemId), ['LONG', 'DIRTY', 'REFERENCE', 'UNREADABLE']);
  assert.equal(items[1]!.title, dirty.title); assert.equal(items.at(-1)?.reason, '正文读取失败');
});

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
  seedCoverage(store, Array.from({ length: 310 }, (_, n) => ({ id: `SPE-${n}`, title: '高压', text: '' })));
  assert.equal(worksets.items(target, search.id).items.length, 310);
  assert.equal(worksets.items(target, gaps.id).items.length, 310);
  worksets.remove(search.id);
  assert.equal(worksets.list(target.projectId).length, 3);
});

test('morning cards use receiver acknowledgements and schedule one attempt per local day', async t => {
  const { store, service } = offlineService(t);
  const start = new Date(2026, 10, 20, 0, 6, 0);
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: start });
  const responses: Record<string, string> = { ok: '{"code":0}', rejected: '{"code":19024}', legacy: '{"StatusCode":0}', denied: '{"StatusCode":19024}', invalid: '<html>', empty: '{}' };
  const packets: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const endpoint = new URL(url).pathname.slice(1);
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(String(init.body)).msg_type, 'interactive');
    packets.push(endpoint);
    return new Response(responses[endpoint]);
  });
  const configure = (...routes: string[]) => store.put('change-feishu', target.projectId, { groups: routes.map(route => ({ id: crypto.randomUUID(), label: route, webhook: `http://127.0.0.1/${route}`, secret: '' })) });
  const preview = await request<{ digest: string }>(service, { method: 'brief.preview', target });
  assert(preview.digest);
  assert.equal((await request<{sent: boolean}>(service, {method: 'brief.send', target})).sent, false);
  assert.deepEqual(packets, []);
  configure(...Object.keys(responses));
  const delivery = await request<{sent: boolean; reason: string; results: {ok: boolean}[]}>(service, {method: 'brief.send', target});
  assert.deepEqual(delivery.results.map(row => row.ok), [true, false, true, false, false, false]);
  assert.equal(delivery.sent, true); assert.match(delivery.reason, /部分发送成功（2\/6 个群）/);
  configure('rejected');
  store.put('brief-config', target.projectId, { at: '00:07' });
  await request(service, {method: 'brief.toggle', target, enabled: true});
  const count = packets.length;
  service.startBriefScheduler();
  t.mock.timers.tick(60_000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(packets.slice(count), ['rejected']);
  assert.match(service.events.list(target.projectId)[0]!.subject, /定时晨报发送失败（0\/1 个群）/);
  assert(store.get('brief-sent', `brief-sent:${target.projectId}:2026-11-20`));
  store.put('brief-config', target.projectId, {id: target.projectId, document: target.document, at: '00:08', enabled: true});
  t.mock.timers.tick(60_000);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(packets.length, count + 1);
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
  const reviews = { list: () => [{ status: 'open', issues: [{ status: 'open' }, { status: 'resolved' }] }, { status: 'done', issues: [{ status: 'open' }] }] } as unknown as Reviews;
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
