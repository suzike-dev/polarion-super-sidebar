import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { Engines } from './engine.ts';
import { Drafts } from './polarion.ts';
import { Workflows, composeWorkflowStepPrompt, parseCheckVerdict } from './workflows.ts';
import type { Context, Run, WorkflowRun } from '../../packages/protocol/index.ts';
import type { query, Query } from '@anthropic-ai/claude-agent-sdk';

const target = { origin: 'https://polarion.pufafen.com' as const, projectId: 'test01', document: 'Requirements/A' };
const context = (workItemId?: string): Context[] => workItemId ? [{ id: crypto.randomUUID(), target, workItemId, text: '正文快照', prefix: '', suffix: '', source: 'work-item', capturedAt: Date.now(), pinned: false }] : [];

/** 轮询等待条件成立：工作流推进由引擎的异步收尾驱动，测试只观察落库结果。全量并发跑时首轮可能较慢，预算给足。 */
async function until(cond: () => boolean, ms = 8000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw Error('等待超时：工作流未按预期推进');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** 伪引擎：每轮按脚本弹出一条 result 文本；isError=true 时该轮失败。 */
function fixture(results: { text: string; error?: boolean }[]) {
  const store = new Store(':memory:');
  const drafts = new Drafts(store, { read: async () => { throw Error('unused'); }, save: async () => { throw Error('unused'); } });
  const remaining = [...results];
  const factory: typeof query = ({ prompt }) => {
    async function* messages() {
      yield { type: 'system', subtype: 'init', session_id: 'native-1', model: 'test', tools: [], mcp_servers: [] };
      for await (const input of prompt as AsyncIterable<any>) {
        const next = remaining.shift() ?? { text: 'fallback' };
        yield { type: 'result', subtype: next.error ? 'error_during_execution' : 'success', is_error: !!next.error, session_id: 'native-1', user_message_uuid: input.uuid, result: next.text, duration_ms: 1, num_turns: 1 };
      }
    }
    const stream = messages() as unknown as Query;
    stream.close = () => { void stream.return(); };
    stream.supportedCommands = async () => []; stream.supportedAgents = async () => []; stream.supportedModels = async () => []; stream.mcpServerStatus = async () => [];
    return stream;
  };
  const engines = new Engines(store, drafts, undefined, factory);
  const workflows = new Workflows(store);
  workflows.engines = engines; workflows.proposals = engines.proposals; engines.workflows = workflows;
  const session = store.createSession(target, 'wf session');
  const def = (steps: { title: string; prompt: string; pause?: boolean; check?: { retryTo: string; maxRetries: number } }[], name = '需求三连审') => workflows.saveDef({ id: crypto.randomUUID(), projectId: target.projectId, name, description: '', createdAt: Date.now(), updatedAt: 0, steps: steps.map((step, index) => ({ id: `s${index + 1}`, title: step.title, prompt: step.prompt, pause: step.pause ?? false, ...(step.check ? { check: step.check } : {}) })) });
  const runs = () => store.list<Run>('run').filter(r => r.workflow).sort((a, b) => a.startedAt - b.startedAt);
  const instance = () => store.list<WorkflowRun>('workflow-run')[0]!;
  return { store, engines, workflows, session, def, runs, instance, close() { engines.close(); store.close(); } };
}

test('顺序两步自动接力：变量插值（{{item}}/{{prev}}）与步骤头行', async () => {
  const f = fixture([{ text: '第一步结论：发现 3 个问题' }, { text: '第二步结论' }]);
  try {
    const def = f.def([{ title: '需求质量评审', prompt: '评审 {{item}}' }, { title: '出结论', prompt: '结合 {{prev}} 汇总' }]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-100'), 'auto', '');
    await until(() => f.instance().status === 'done');
    const runs = f.runs();
    assert.equal(runs.length, 2);
    assert.ok(runs[0]!.prompt.includes('【工作流「需求三连审」步骤 1/2：需求质量评审】'));
    assert.ok(runs[0]!.prompt.includes('REQ-100'));
    assert.ok(runs[1]!.prompt.includes('【工作流「需求三连审」步骤 2/2：出结论】'));
    assert.ok(runs[1]!.prompt.includes('第一步结论：发现 3 个问题'));
    assert.equal(runs[0]!.workflow!.stepIndex, 0);
    assert.equal(runs[1]!.workflow!.stepTitle, '出结论');
    const instance = f.instance();
    assert.equal(instance.steps[0]!.status, 'done');
    assert.ok(instance.steps[0]!.resultTail!.includes('发现 3 个问题'));
  } finally { f.close(); }
});

test('parseCheckVerdict：取最后一次标记，全角冒号可解析，缺失视为需人工', () => {
  assert.equal(parseCheckVerdict('草稿【结论:FAIL】复核后【结论:PASS】'), 'pass');
  assert.equal(parseCheckVerdict('【结论：FAIL】'), 'fail');
  assert.equal(parseCheckVerdict('复核中发现证据不足\n【结论:NEED_MANUAL】'), 'need_manual');
  assert.equal(parseCheckVerdict('没有任何标记的结论'), 'need_manual');
  assert.equal(parseCheckVerdict(undefined), 'need_manual');
});

test('检查步 FAIL 返工一次后 PASS：返工提示带失败原因，实例最终 done', async () => {
  const f = fixture([
    { text: '修复方案 v1' },
    { text: '核查第 3.2 节：判据仍是旧值 100。\n【结论:FAIL】' },
    { text: '修复方案 v2' },
    { text: '已复核 3.2 节，判据已更新。\n【结论:PASS】' },
  ]);
  try {
    const def = f.def([
      { title: '修复', prompt: '修复问题，参考检查结论 {{steps.s2}}' },
      { title: '复查', prompt: '复查修复结果', check: { retryTo: 's1', maxRetries: 1 } },
    ]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-20'), 'auto', '');
    await until(() => f.instance().status === 'done');
    const runs = f.runs();
    assert.equal(runs.length, 4); // 修复 → 检查(FAIL) → 修复返工 → 检查(PASS)
    assert.ok(runs[1]!.prompt.includes('检查步'));
    assert.ok(runs[1]!.prompt.includes('【结论:PASS】'));
    assert.ok(runs[2]!.prompt.includes('返工重做'));
    assert.ok(runs[2]!.prompt.includes('判据仍是旧值 100')); // {{steps.s2}} 注入上一轮检查结论
    const instance = f.instance();
    assert.equal(instance.steps[0]!.status, 'done');
    assert.equal(instance.steps[1]!.status, 'done');
    assert.equal(instance.steps[1]!.retries, 1);
    assert.ok(instance.steps[1]!.resultTail!.includes('【结论:PASS】'));
    const view = f.workflows.viewOf(f.session.id);
    assert.equal(view!.steps[1]!.retries, 1);
  } finally { f.close(); }
});

test('返工超上限转人工：暂停在检查步，人工处理后继续走完剩余步骤', async () => {
  const f = fixture([
    { text: '修复 v1' }, { text: '仍不一致\n【结论:FAIL】' },
    { text: '修复 v2' }, { text: '还是不一致\n【结论:FAIL】' },
    { text: '人工处理完毕' },
  ]);
  try {
    const def = f.def([
      { title: '修复', prompt: '修复' },
      { title: '复查', prompt: '复查', check: { retryTo: 's1', maxRetries: 1 } },
      { title: '收尾', prompt: '收尾' },
    ]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-21'), 'auto', '');
    await until(() => f.instance().status === 'paused');
    assert.equal(f.instance().error, 'CHECK_REWORK_EXHAUSTED');
    assert.equal(f.instance().currentIndex, 1); // 暂停在检查步，保留其两轮结论供人工查看
    assert.equal(f.runs().length, 4);
    assert.equal(f.instance().steps[1]!.retries, 2);
    f.workflows.resume(f.instance().id);
    await until(() => f.instance().status === 'done');
    assert.equal(f.runs().length, 5);
    assert.equal(f.instance().steps[2]!.status, 'done');
  } finally { f.close(); }
});

test('检查结论缺失视为证据不足：转人工暂停，继续后进入下一步', async () => {
  const f = fixture([{ text: '修复 v1' }, { text: '看起来没问题，但没有给标记' }, { text: '第三步结果' }]);
  try {
    const def = f.def([
      { title: '修复', prompt: '修复' },
      { title: '复查', prompt: '复查', check: { retryTo: 's1', maxRetries: 2 } },
      { title: '收尾', prompt: '收尾' },
    ]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-22'), 'auto', '');
    await until(() => f.instance().status === 'paused');
    assert.equal(f.instance().error, 'CHECK_NEED_MANUAL');
    assert.equal(f.runs().length, 2);
    assert.equal(f.instance().steps[1]!.retries, undefined); // 未触发返工
    f.workflows.resume(f.instance().id);
    await until(() => f.instance().status === 'done');
    assert.equal(f.runs().length, 3);
  } finally { f.close(); }
});

test('检查步返工目标校验：未知步骤或指向自身/之后的步骤都拒绝保存', () => {
  const f = fixture([]);
  try {
    assert.throws(() => f.def([{ title: '一', prompt: '一' }, { title: '二', prompt: '二', check: { retryTo: 'nope', maxRetries: 1 } }]), /WORKFLOW_CHECK_TARGET_INVALID/);
    assert.throws(() => f.def([{ title: '一', prompt: '一' }, { title: '二', prompt: '二', check: { retryTo: 's2', maxRetries: 1 } }]), /WORKFLOW_CHECK_TARGET_INVALID/);
    // 合法：回到更早的步骤
    f.def([{ title: '一', prompt: '一' }, { title: '二', prompt: '二', check: { retryTo: 's1', maxRetries: 2 } }]);
  } finally { f.close(); }
});

test('暂停门：pause 步完成后暂停，resume 后继续至完成', async () => {
  const f = fixture([{ text: '评审结果 A' }, { text: '写入结果 B' }]);
  try {
    const def = f.def([{ title: '评审', prompt: '评审', pause: true }, { title: '写入', prompt: '写入' }]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-1'), 'auto', '');
    await until(() => f.instance().status === 'paused');
    assert.equal(f.runs().length, 1); // 暂停时不得提前发出第二步
    assert.equal(f.instance().currentIndex, 0);
    const gate = f.instance().steps[0]!.gateProposalId!;
    assert.equal(f.engines.proposals.get(gate).status,'pending');
    await assert.rejects(f.engines.proposals.approve(gate),/OWNER_MISMATCH/);
    f.workflows.resume(f.instance().id);
    assert.equal(f.engines.proposals.get(gate).status,'applied');
    await until(() => f.instance().status === 'done');
    assert.equal(f.runs().length, 2);
  } finally { f.close(); }
});

test('步骤失败：实例 failed 并保留已完成步骤结果', async () => {
  const f = fixture([{ text: '第一步 OK' }, { text: '引擎错误', error: true }]);
  try {
    const def = f.def([{ title: '评审', prompt: '评审' }, { title: '核对', prompt: '核对' }]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-2'), 'auto', '');
    await until(() => f.instance().status === 'failed');
    assert.ok(f.instance().error!.includes('核对'));
    assert.equal(f.instance().steps[0]!.status, 'done');
    assert.equal(f.instance().steps[1]!.status, 'failed');
  } finally { f.close(); }
});

test('用户插话先于下一步：排队消息按 FIFO 在工作流续步前执行', async () => {
  const f = fixture([{ text: '步骤一结果' }, { text: '用户插话回答' }, { text: '步骤二结果' }]);
  try {
    const def = f.def([{ title: '一', prompt: '一' }, { title: '二', prompt: '二' }]);
    f.workflows.run(def.id, f.session.id, target, context('REQ-3'), 'auto', '');
    // 第一步在飞时用户消息排队：它应先于第二步被执行。
    const queuedId = f.store.startRun(f.session.id, crypto.randomUUID(), '用户插话', [], target).run.id;
    await until(() => f.instance().status === 'done');
    assert.equal(f.store.require<Run>('run', queuedId).status, 'completed');
    const order = f.store.events(f.session.id, 0).filter(e => e.kind === 'result').map(e => (e.data as any).text);
    assert.deepEqual(order, ['步骤一结果', '用户插话回答', '步骤二结果']);
  } finally { f.close(); }
});

test('定义管理：名称冲突与删除', () => {
  const f = fixture([]);
  try {
    f.def([{ title: '一', prompt: '一' }], '唯一名');
    assert.throws(() => f.def([{ title: '一', prompt: '一' }], '唯一名'), /WORKFLOW_NAME_EXISTS/);
    const list = f.workflows.defs(target.projectId);
    assert.equal(list.length, 1);
    f.workflows.removeDef(list[0]!.id);
    assert.equal(f.workflows.defs(target.projectId).length, 0);
  } finally { f.close(); }
});

test('会话内只允许一个进行中实例；暂停中的实例也阻止新发起', async () => {
  const f = fixture([{ text: 'A' }]);
  try {
    const def = f.def([{ title: '评审', prompt: '评审', pause: true }, { title: '写入', prompt: '写入' }]);
    f.workflows.run(def.id, f.session.id, target, context(), 'auto', '');
    await until(() => f.instance().status === 'paused');
    assert.throws(() => f.workflows.run(def.id, f.session.id, target, context(), 'auto', ''), /WORKFLOW_SESSION_BUSY/);
    const gate = f.instance().steps[0]!.gateProposalId!;
    f.workflows.cancel(f.instance().id);
    assert.equal(f.engines.proposals.get(gate).status,'rejected');
    assert.equal(f.instance().status, 'cancelled');
  } finally { f.close(); }
});

test('Host 重启恢复：在飞步骤被打断后转暂停，已完成步骤自动续跑', async () => {
  const f = fixture([{ text: 'A1' }, { text: 'A2' }]);
  try {
    const def = f.def([{ title: '一', prompt: '一' }, { title: '二', prompt: '二' }]);
    f.workflows.run(def.id, f.session.id, target, context(), 'auto', '');
    await until(() => f.instance().status === 'done');
    // 构造重启场景：新实例第一步 run 被标记 interrupted。
    const f2 = fixture([{ text: 'B2' }]);
    try {
      const def2 = f2.def([{ title: '一', prompt: '一' }, { title: '二', prompt: '二' }]);
      // 直接落一个 running 实例 + 一个 interrupted 的步骤 run，模拟 recoverInterruptedRuns 之后的状态。
      const stepRun = f2.store.startRun(f2.session.id, crypto.randomUUID(), '一', [], target).run;
      stepRun.status = 'interrupted'; stepRun.endedAt = Date.now(); stepRun.error = 'HOST_RESTARTED';
      f2.store.put('run', stepRun.id, stepRun);
      const saved = f2.workflows.defs(target.projectId).find(d => d.id === def2.id)!;
      const wr: WorkflowRun = { id: crypto.randomUUID(), defId: def2.id, defName: def2.name, sessionId: f2.session.id, target, contexts: [], permissionMode: 'auto', status: 'running', currentIndex: 0, steps: [{ stepId: 's1', runId: stepRun.id, status: 'running' }, { stepId: 's2', status: 'pending' }], def: { name: saved.name, steps: saved.steps }, startedAt: Date.now(), updatedAt: Date.now() };
      f2.store.put('workflow-run', wr.id, wr);
      f2.workflows.recover();
      const recovered = f2.store.list<WorkflowRun>('workflow-run').find(w => w.id === wr.id)!;
      assert.equal(recovered.status, 'paused');
      assert.equal(recovered.error, 'HOST_RESTARTED');
      // 继续：跳过被打断的步骤，从第二步开始。
      f2.workflows.resume(recovered.id);
      await until(() => f2.store.list<WorkflowRun>('workflow-run').find(w => w.id === wr.id)!.status === 'done');
      assert.equal(f2.store.list<Run>('run').filter(r => r.workflow && r.workflow.stepIndex === 1).length, 1);
    } finally { f2.close(); }
  } finally { f.close(); }
});

test('提示词组装：附注注入与缺失变量的兜底文案', () => {
  const wr: WorkflowRun = {
    id: 'x', defId: 'x', defName: '流程', sessionId: 's', target, contexts: context('REQ-9'), permissionMode: 'auto', note: '重点关注接口',
    status: 'running', currentIndex: 2, steps: [{ stepId: 's1', status: 'done', resultTail: '结论一' }, { stepId: 's2', status: 'done', resultTail: '结论二' }, { stepId: 's3', status: 'pending' }],
    def: { name: '流程', steps: [{ id: 's1', title: '一', prompt: '', pause: false }, { id: 's2', title: '二', prompt: '', pause: false }, { id: 's3', title: '三', prompt: '{{item}} | {{prev}} | {{steps.s1}} | {{steps.nope}}', pause: false }] }, startedAt: 0, updatedAt: 0,
  };
  const prompt = composeWorkflowStepPrompt(wr, 2);
  assert.ok(prompt.includes('REQ-9'));
  assert.ok(prompt.includes('结论二'));
  assert.ok(prompt.includes('结论一'));
  assert.ok(prompt.includes('（未找到步骤 nope）'));
  assert.ok(prompt.includes('重点关注接口'));
});

const planJson = (steps: unknown[]) => '```json\n' + JSON.stringify(steps) + '\n```';

test('parsePlanSteps：取最后一个 json 围栏、规范 check 引用、无效输入报错', () => {
  const steps = Workflows.parsePlanSteps(`先说思路。\n${planJson([{ title: '草稿', prompt: 'x' }])}\n补充说明\n${planJson([
    { title: '修复', prompt: '修复问题' },
    { title: '复查', prompt: '复查', check: { retryTo: 's1', maxRetries: 9 } },
  ])}`);
  assert.equal(steps.length, 2); // 取最后一个围栏，前面的草稿围栏被丢弃
  assert.deepEqual(steps[1]!.check, { retryTo: 's1', maxRetries: 5 }); // 返工上限钳到 5
  // 指向自身/之后的 retryTo 丢弃：
  const dropped = Workflows.parsePlanSteps(planJson([{ title: '复查', prompt: 'x', check: { retryTo: '1', maxRetries: 1 } }]));
  assert.equal(dropped[0]!.check, undefined);
  assert.throws(() => Workflows.parsePlanSteps('完全没有结构化输出'), /PLAN_STEPS_UNPARSEABLE/);
  assert.throws(() => Workflows.parsePlanSteps(planJson([{ title: '', prompt: 'x' }])), /PLAN_STEPS_UNPARSEABLE/);
});

test('动态拆解：目标 → 拆解轮 → 自动落地执行，临时定义可保存复用', async () => {
  const f = fixture([
    { text: `我先拆解。\n${planJson([{ title: '评审', prompt: '评审 {{item}}' }, { title: '写入', prompt: '按 {{prev}} 写入' }])}` },
    { text: '评审结论 A' },
    { text: '写入完成 B' },
  ]);
  try {
    f.workflows.plan(f.session.id, target, context('REQ-30'), 'auto', '把 REQ-30 评审后写入');
    // 拆解轮先跑，完成后 launchPlanned 才创建 WorkflowRun；轮询要容忍实例尚未诞生。
    await until(() => (f.instance() as WorkflowRun | undefined)?.status === 'done');
    // 拆解轮 + 两个步骤轮；拆解轮提示词带目标，步骤提示词走正常组装。
    const runs = f.runs().filter(r => !r.workflow?.planGoal);
    const planRun = f.store.list<Run>('run').find(r => r.workflow?.planGoal)!;
    assert.ok(planRun.prompt.includes('把 REQ-30 评审后写入'));
    assert.ok(planRun.prompt.includes('```json'));
    assert.equal(runs.length, 2);
    assert.ok(runs[0]!.prompt.includes('REQ-30'));
    const def = f.workflows.defs(target.projectId)[0]!;
    assert.equal(def.origin, 'dynamic');
    assert.match(def.name, /^动态 · /);
    // 保存复用：改名 + 转正；重名冲突仍受保护。
    const kept = f.workflows.keep(def.id, '评审后写入');
    assert.equal(kept.origin, 'agent');
    assert.equal(kept.name, '评审后写入');
    assert.throws(() => f.workflows.keep(def.id, '唯一名x'), /WORKFLOW_NOT_DYNAMIC|WORKFLOW_NAME_EXISTS/);
  } finally { f.close(); }
});

test('动态拆解失败：无 JSON 时在会话里给出可读反馈，不创建定义', async () => {
  const f = fixture([{ text: '我直接口头说明步骤：先评审再写入。' }]);
  try {
    f.workflows.plan(f.session.id, target, context(), 'auto', '口头目标');
    await until(() => f.store.events(f.session.id, 0).some(e => e.kind === 'result' && String((e.data as any).text ?? '').includes('动态工作流启动失败')));
    assert.equal(f.workflows.defs(target.projectId).length, 0);
    assert.equal(f.store.list<Run>('run').filter(r => r.workflow && !r.workflow.planGoal).length, 0);
  } finally { f.close(); }
});

test('parsePlanSteps 降级：无 JSON 时按编号行拆步骤，最后一步暂停', () => {
  const steps = Workflows.parsePlanSteps('我的思路是先审后改。\n1. 需求评审：逐条检查判据与原子性\n2. 模型核对：用 model_trace 巡检一致性\n3. 汇总结论：列出修复建议');
  assert.equal(steps.length, 3);
  assert.equal(steps[0]!.title, '需求评审');
  assert.ok(steps[0]!.prompt.includes('逐条检查'));
  assert.equal(steps.at(-1)!.pause, true); // 降级流最后暂停供人工确认
  assert.equal(steps.some(step => step.check), false);
  // 两行以下不成流程。
  assert.throws(() => Workflows.parsePlanSteps('1. 只有一行不算流程'), /PLAN_STEPS_UNPARSEABLE/);
});

test('批量运行：每个工作项独立会话跑同一流程，去重并限 10 条', async () => {
  const f = fixture([{ text: 'A 完成' }, { text: 'B 完成' }]);
  try {
    const def = f.def([{ title: '单步', prompt: '处理 {{item}}' }], '批量流程');
    const results = f.workflows.runBatch(target, def.id, ['SPE-1', 'SPE-2', 'SPE-1', '  '], 'auto', '批量附注');
    assert.equal(results.length, 2); // 去重 + 空值过滤
    assert.deepEqual(results.map(row => row.workItemId), ['SPE-1', 'SPE-2']);
    // 两个独立会话，各自持有工作项上下文并启动 run
    const sessions = f.store.list<import('../../packages/protocol/index.ts').Session>('session');
    assert.ok(sessions.some(row => row.id === results[0]!.sessionId && row.title.includes('SPE-1')));
    // 两个实例都要跑完再结束，避免夹具关闭后仍有异步写入。
    await until(() => f.store.list<WorkflowRun>('workflow-run').length >= 2 && f.store.list<WorkflowRun>('workflow-run').every(row => row.status === 'done'), 12000);
    const prompts = f.store.list<Run>('run').filter(run => run.workflow).map(run => run.prompt);
    assert.ok(prompts.some(prompt => prompt.includes('SPE-1')));
    assert.ok(prompts.some(prompt => prompt.includes('SPE-2')));
    assert.ok(prompts.every(prompt => prompt.includes('批量附注')));
    const history = f.workflows.history(target.projectId);
    assert.deepEqual(history.map(({ workItemId, sessionId }) => ({ workItemId, sessionId })).sort((a, b) => a.workItemId!.localeCompare(b.workItemId!)), results);
    assert.ok(history.every(row => row.note === '批量附注' && row.steps[0]?.status === 'done'));
    assert.throws(() => f.workflows.runBatch(target, def.id, [], 'auto', ''), /WORKFLOW_BATCH_EMPTY/);
  } finally { f.close(); }
});

test('轨迹按项目筛选，从冻结上下文取本项目的最后一个工作项，缺少导航字段的旧记录保留步骤', () => {
  const store = new Store(':memory:');
  try {
    const workflows = new Workflows(store);
    const session = store.createSession(target, '已有会话');
    const otherTarget = { ...target, projectId: 'other' };
    const foreign = { ...context('FOREIGN-1')[0]!, target: otherTarget };
    const run: WorkflowRun = {
      id: 'recent', defId: 'def', defName: '历史流程', sessionId: session.id, target,
      contexts: [...context('PINNED-1'), ...context('LOCAL-2'), foreign], permissionMode: 'auto', status: 'done', currentIndex: 1,
      def: { name: '历史流程', steps: [{ id: 's1', title: '第一步', prompt: '核对', pause: false }] },
      steps: [{ stepId: 's1', status: 'done', resultTail: '历史证据' }], startedAt: 2, updatedAt: 2,
    };
    store.put('workflow-run', run.id, run);
    store.put('workflow-run', 'old', { ...run, id: 'old', contexts: undefined, sessionId: undefined, startedAt: 1 });
    store.put('workflow-run', 'other', { ...run, id: 'other', target: otherTarget, startedAt: 3 });
    const history = workflows.history(target.projectId);
    assert.deepEqual(history.map(row => row.id), ['recent', 'old']);
    assert.equal(history[0]!.sessionId, session.id);
    assert.equal(history[0]!.workItemId, 'LOCAL-2');
    assert.equal('contexts' in history[0]!, false);
    assert.equal('sessionId' in history[1]!, false);
    assert.equal('workItemId' in history[1]!, false);
    assert.equal(history[1]!.steps[0]!.resultPreview, '历史证据');
    assert.deepEqual(workflows.history(target.projectId, 1), [history[0]]);
    const [foreignRun] = workflows.history(otherTarget.projectId);
    assert.equal(foreignRun!.workItemId, 'FOREIGN-1');
    assert.equal('sessionId' in foreignRun!, false);
  } finally { store.close(); }
});

test('批量运行：超过 10 条时截断（独立夹具，不启动引擎）', () => {
  const store = new Store(':memory:');
  const wf = new Workflows(store);
  const def = wf.saveDef({ id: crypto.randomUUID(), projectId: target.projectId, name: '批量上限', description: '', createdAt: Date.now(), updatedAt: 0, steps: [{ id: 's1', title: '单步', prompt: '{{item}}', pause: false }] });
  assert.equal(wf.runBatch(target, def.id, Array.from({ length: 15 }, (_, index) => 'W' + index), 'auto', '').length, 10);
  store.close();
});

test('dueWorkflow：到点且当天未触发的定义才返回，标记后不重复', () => {
  const store = new Store(':memory:');
  const wf = new Workflows(store);
  const at = new Date('2026-11-20T07:30:00');
  const def = wf.saveDef({ id: crypto.randomUUID(), projectId: target.projectId, name: '定时流程', description: '', createdAt: Date.now(), updatedAt: 0, steps: [{ id: 's1', title: '一', prompt: 'x', pause: false }] });
  wf.schedule(def.id, '07:30', target);
  const due = wf.dueWorkflow(at, target.projectId);
  assert.equal(due.length, 1);
  assert.equal(due[0]!.marker, `${def.id}:2026-11-20`);
  store.put('workflow-sent', due[0]!.marker, { at: Date.now() });
  assert.equal(wf.dueWorkflow(at, target.projectId).length, 0); // 当天去重
  assert.equal(wf.dueWorkflow(new Date('2026-11-20T07:31:00'), target.projectId).length, 0); // 非设定分钟
  store.close();
});
