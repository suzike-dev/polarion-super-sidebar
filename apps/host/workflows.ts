import type { Proposals } from './proposals.ts';
import { Store } from './store.ts';
import type { Engines } from './engine.ts';
import type { Context, Run, Session, Target, WorkflowDef, WorkflowRun, WorkflowRunView, WorkflowStepRun, WorkflowStepRunStatus, PermissionMode, WorkflowHistoryItem } from '../../packages/protocol/index.ts';
import { WorkflowDefSchema, MAX_WORKFLOW_STEPS } from '../../packages/protocol/index.ts';

/** {{prev}}/{{steps.<id>}} 注入的上一步结果长度上限：过长结果截尾，全文模型可从会话历史读取。 */
const RESULT_TAIL_CHARS = 4000;
/** 终态实例在会话视图里的保留窗口：让用户看到完成/失败结果，过后不再占据工作流条。 */
const SETTLED_VISIBLE_MS = 5 * 60 * 1000;

/** 检查步结论：模型按提示词硬规则在结果末行输出【结论:PASS/FAIL/NEED_MANUAL】，取最后一次出现；缺失视为需人工。 */
export type WorkflowCheckVerdict = 'pass' | 'fail' | 'need_manual';
const CHECK_VERDICT_RE = /【\s*结论\s*[:：]\s*(PASS|FAIL|NEED_MANUAL)\s*】/gu;
export function parseCheckVerdict(result?: string): WorkflowCheckVerdict {
  let verdict: WorkflowCheckVerdict | undefined;
  if (result) for (const match of result.matchAll(CHECK_VERDICT_RE)) verdict = match[1]!.toLowerCase() as WorkflowCheckVerdict;
  return verdict ?? 'need_manual';
}

const stepSettledText: Record<string, string> = { failed: '执行失败', cancelled: '被取消', interrupted: '被打断' };
function runStatusToStepStatus(status: Run['status'] | undefined): WorkflowStepRunStatus {
  return status === 'completed' ? 'done' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : status === 'interrupted' ? 'interrupted' : 'running';
}

/** 步骤提示词组装：头行（对话流与模型都靠它识别流程位置）+ 变量插值 + 触发附注。 */
export function composeWorkflowStepPrompt(wr: WorkflowRun, index: number): string {
  const steps = wr.def.steps, step = steps[index]!;
  const item = [...wr.contexts].reverse().find(c => c.workItemId)?.workItemId ?? '（未指定，以本轮资料快照为准）';
  const tailOf = (i: number) => (i >= 0 && i < wr.steps.length ? wr.steps[i]!.resultTail : undefined) ?? '（该步骤尚无结果）';
  const body = step.prompt
    .replace(/\{\{\s*item\s*\}\}/gu, item)
    .replace(/\{\{\s*prev\s*\}\}/gu, () => tailOf(index - 1))
    .replace(/\{\{\s*steps\.([a-z0-9-]+)\s*\}\}/giu, (_match, id: string) => {
      const found = steps.findIndex(candidate => candidate.id.toLowerCase() === id.toLowerCase());
      return found >= 0 ? tailOf(found) : `（未找到步骤 ${id}）`;
    });
  const checkRule = step.check ? '\n（本步是检查步：正文写清核查位置与证据后，最后一行必须单独输出结论标记，只能是：【结论:PASS】通过 / 【结论:FAIL】不通过需返工 / 【结论:NEED_MANUAL】证据不足需人工。没有标记视为需人工。）' : '';
  // 该步处于某次返工区间内：提示模型别原样重复上一轮产出。
  const reworking = wr.def.steps.some((checkStep, checkIndex) => {
    if (!checkStep.check || !wr.steps[checkIndex]?.retries) return false;
    const from = steps.findIndex(candidate => candidate.id.toLowerCase() === checkStep.check!.retryTo.toLowerCase());
    return from >= 0 && index >= from && index <= checkIndex;
  });
  const reworkHint = reworking ? '\n（本流程上一轮检查未通过，当前是返工重做：请针对检查结论指出的问题修改，不要原样重复上一轮产出。）' : '';
  return `【工作流「${wr.defName}」步骤 ${index + 1}/${steps.length}：${step.title}】\n（本条消息由用户保存的工作流自动发出，属于既定流程的一步；完成后将自动继续。）\n${body}${checkRule}${reworkHint}${wr.note?.trim() ? `\n（用户本次运行的补充说明：${wr.note.trim()}）` : ''}`;
}

/**
 * 动态工作流编排器：把工作流定义展开成同会话的普通 run 顺序执行。
 * 推进点挂在 Engines.pump 的会话空闲处；全部状态落 sqlite，刷新/关页/重启可恢复。
 */
export class Workflows {
  store: Store;
  /** 由 Service 在构造后注入，避免与 Engines 的循环构造依赖。 */
  engines?: Engines;
  proposals?: Proposals;
  constructor(store: Store) { this.store = store; }

  // ---- 定义：列表 / 保存 / 删除。 ----
  defs(projectId: string): WorkflowDef[] {
    return this.store.list<WorkflowDef>('workflow-def').filter(d => d.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  saveDef(input: unknown): WorkflowDef {
    const def = WorkflowDefSchema.parse(input);
    if (new Set(def.steps.map(step => step.id)).size !== def.steps.length) throw Error('WORKFLOW_STEP_ID_DUPLICATE');
    for (const [index, step] of def.steps.entries()) if (step.check) {
      const target = def.steps.findIndex((other, otherIndex) => otherIndex < index && other.id.toLowerCase() === step.check!.retryTo.toLowerCase());
      if (target < 0) throw Error('WORKFLOW_CHECK_TARGET_INVALID');
    }
    for (const step of def.steps) if (step.guidelineId && !this.store.get('guideline', step.guidelineId)) throw Error('GUIDELINE_NOT_FOUND');
    if (this.defs(def.projectId).some(other => other.name === def.name && other.id !== def.id)) throw Error('WORKFLOW_NAME_EXISTS');
    const existing = this.store.get<WorkflowDef>('workflow-def', def.id);
    const value: WorkflowDef = { ...def, createdAt: existing?.createdAt ?? def.createdAt, updatedAt: Date.now() };
    this.store.put('workflow-def', value.id, value);
    return value;
  }
  /** save_workflow 模型工具入口：模型给自然步骤，这里补 slug id 与时间戳。 */
  createFromAgent(projectId: string, name: string, description: string, steps: { title: string; prompt: string; pause?: boolean; guidelineId?: string }[]): WorkflowDef {
    return this.saveDef({ id: crypto.randomUUID(), projectId, name, description: description.trim(), origin: 'agent', createdAt: Date.now(), updatedAt: 0, steps: steps.map((step, index) => ({ id: `s${index + 1}`, title: step.title, prompt: step.prompt, ...(step.guidelineId ? { guidelineId: step.guidelineId } : {}), pause: step.pause ?? false })) });
  }
  removeDef(id: string) {
    const def = this.store.require<WorkflowDef>('workflow-def', id);
    // 在跑实例已快照步骤定义，删除定义不影响它们继续执行。
    this.store.remove('workflow-def', id);
    return { removed: def.id };
  }

  // ---- 运行：发起 / 推进 / 继续 / 终止。 ----
  run(defId: string, sessionId: string, target: Target, contexts: Context[], permissionMode: PermissionMode, note: string): WorkflowRunView {
    const def = this.store.require<WorkflowDef>('workflow-def', defId);
    if (def.projectId !== target.projectId) throw Error('WORKFLOW_PROJECT_MISMATCH');
    const session = this.store.require<Session>('session', sessionId);
    if (session.target.projectId !== target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
    if (this.store.list<WorkflowRun>('workflow-run').some(w => w.sessionId === sessionId && ['running', 'paused'].includes(w.status))) throw Error('WORKFLOW_SESSION_BUSY');
    const wr: WorkflowRun = {
      id: crypto.randomUUID(), defId, defName: def.name, sessionId, target: structuredClone(target), contexts: structuredClone(contexts),
      permissionMode, ...(note.trim() ? { note: note.trim() } : {}), status: 'running', currentIndex: 0,
      steps: def.steps.map(step => ({ stepId: step.id, status: 'pending' as const })),
      def: { name: def.name, steps: structuredClone(def.steps) }, startedAt: Date.now(), updatedAt: Date.now(),
    };
    this.store.put('workflow-run', wr.id, wr);
    this.advance(sessionId);
    return this.view(wr);
  }

  // ---- 动态拆解：说出目标 → 拆成结构化步骤 → 立即执行 → 满意后保存复用。 ----

  /** 动态拆解的提示词：让模型把目标落成带变量与检查配置的步骤数组，末行 ```json 输出。 */
  static planPrompt(goal: string): string {
    return [
      `【动态工作流拆解】用户目标：${goal}`,
      '结合会话上下文与可用工具，把目标拆成 1-6 个可顺序执行的步骤，每步独立可验收。',
      '提示词里可用变量：{{item}} 当前工作项、{{prev}} 上一步结果、{{steps.sN}} 指定步骤结果（步骤 id 为 s1..sN）。',
      '上一步产出需要复核时，把复核步配成检查步（check），不通过自动回到 retryTo 指定的更早步骤返工。',
      '先用一两句话说明拆解思路，然后必须单独输出一个 ```json 代码块，内容是步骤数组，不要输出其他 JSON：',
      '```json',
      '[{"title":"步骤标题","prompt":"这一步做什么、用什么工具、产出什么","pause":false,"check":{"retryTo":"s1","maxRetries":1}}]',
      '```',
      'check 可省略；pause 为 true 时该步完成后暂停等人工确认。不要编造不存在的工具。',
    ].join('\n');
  }

  /** 发起目标拆解：一轮普通会话 run 完成拆解，完成后由引擎回调 launchPlanned 落地执行。 */
  plan(sessionId: string, target: Target, contexts: Context[], permissionMode: PermissionMode, goal: string): { runId: string } {
    const session = this.store.require<Session>('session', sessionId);
    if (session.target.projectId !== target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
    if (this.store.list<WorkflowRun>('workflow-run').some(w => w.sessionId === sessionId && ['running', 'paused'].includes(w.status))) throw Error('WORKFLOW_SESSION_BUSY');
    const result = this.store.startRun(sessionId, crypto.randomUUID(), Workflows.planPrompt(goal), structuredClone(contexts), target, [], permissionMode, 'queue', undefined, { workflowRunId: '', defName: '目标拆解', stepIndex: 0, stepTotal: 1, stepTitle: '拆解目标', planGoal: goal });
    if (result.created) { if (result.run.status === 'queued') this.engines?.pump(sessionId); else void this.engines?.execute(result.run); }
    return { runId: result.run.id };
  }

  /** 从拆解结果解析步骤数组：取最后一个 ```json 围栏，规范化 id/序号引用并校验 check 目标；无 JSON 时降级按行拆步骤。 */
  static parsePlanSteps(raw: string): { title: string; prompt: string; pause?: boolean; check?: { retryTo: string; maxRetries: number } }[] {
    const blocks = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(match => match[1]!.trim());
    const candidates = [blocks.at(-1), raw.trim()];
    for (const candidate of candidates) {
      if (!candidate) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(candidate); } catch { continue; }
      if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_WORKFLOW_STEPS) continue;
      const steps: { title: string; prompt: string; pause: boolean; check?: { retryTo: string; maxRetries: number } }[] = [];
      let valid = true;
      for (const item of parsed.slice(0, MAX_WORKFLOW_STEPS)) {
        if (!item || typeof item !== 'object') { valid = false; break; }
        const row = item as Record<string, unknown>;
        const title = typeof row.title === 'string' ? row.title.trim().slice(0, 80) : '';
        const prompt = typeof row.prompt === 'string' ? row.prompt.trim().slice(0, 20000) : '';
        if (!title || !prompt) { valid = false; break; }
        const step: typeof steps[number] = { title, prompt, pause: row.pause === true };
        if (row.check && typeof row.check === 'object') {
          const check = row.check as Record<string, unknown>;
          // retryTo 允许 s1 / 1 / “第1步”，统一折算成 sN 并要求指向更早的步骤。
          const match = /(?:^s|^)(\d+)$/.exec(String(check.retryTo ?? '').trim().toLowerCase().replace(/^第/, ''));
          const index = match ? Number(match[1]) - 1 : -1;
          if (index >= 0 && index < steps.length) {
            const maxRetries = Math.min(5, Math.max(1, Number(check.maxRetries) || 1));
            step.check = { retryTo: `s${index + 1}`, maxRetries };
          }
        }
        steps.push(step);
      }
      if (valid) return steps;
    }
    // 降级：模型没给 JSON 时按编号行（“1. 步骤名：说明”或“步骤一”）拆出可执行步骤，最后一步后暂停供人工确认。
    const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const fallback: { title: string; prompt: string; pause: boolean }[] = [];
    for (const line of lines) {
      const match = /^(?:步骤?[一二三四五六七八九十0-9]+|[0-9]+[.、)])\s*(.{4,})$/.exec(line);
      if (!match) continue;
      const body = match[1]!;
      const split = body.split(/[:：]/);
      const title = (split[0] ?? body).trim().slice(0, 40);
      const prompt = body.slice(0, 20000);
      fallback.push({ title: title || `第 ${fallback.length + 1} 步`, prompt, pause: false });
      if (fallback.length >= 6) break;
    }
    if (fallback.length >= 2) {
      fallback.at(-1)!.pause = true;
      return fallback;
    }
    throw Error('PLAN_STEPS_UNPARSEABLE');
  }

  /** 拆解轮完成后落地：解析步骤 → 存 dynamic 定义 → 立即按顺序执行。解析失败在会话里给出可读说明。 */
  launchPlanned(run: Run) {
    const goal = run.workflow?.planGoal;
    if (!goal || run.status !== 'completed') return;
    const session = this.store.get<Session>('session', run.sessionId);
    if (!session) return;
    const text = this.resultText(run.id) ?? '';
    try {
      const steps = Workflows.parsePlanSteps(text);
      const def = this.saveDef({
        id: crypto.randomUUID(), projectId: session.target.projectId,
        name: `动态 · ${goal.slice(0, 24)}`, description: `目标拆解生成：${goal.slice(0, 200)}`,
        origin: 'dynamic', createdAt: Date.now(), updatedAt: 0,
        steps: steps.map((step, index) => ({ id: `s${index + 1}`, title: step.title, prompt: step.prompt, pause: step.pause, ...(step.check ? { check: step.check } : {}) })),
      });
      this.run(def.id, run.sessionId, run.target, run.contexts, run.permissionMode ?? 'auto', `目标：${goal}`);
    } catch (error) {
      this.store.event(run, 'result', { text: `动态工作流启动失败：${error instanceof Error ? error.message : String(error)}。请在对话里说明每一步的要求，或重新发起目标拆解。` });
    }
  }

  /** 把动态拆解的临时定义转成正式可复用定义（改名+转正）。 */
  keep(id: string, name: string): WorkflowDef {
    const def = this.store.require<WorkflowDef>('workflow-def', id);
    if (def.origin !== 'dynamic') throw Error('WORKFLOW_NOT_DYNAMIC');
    return this.saveDef({ ...def, name, origin: 'agent', updatedAt: 0 });
  }

  /** 批量运行：每个工作项各开一个会话跑同一流程；返回对应的 sessionId，便于逐条查看。 */
  runBatch(target: Target, defId: string, workItemIds: string[], permissionMode: PermissionMode, note: string) {
    const def = this.store.require<WorkflowDef>('workflow-def', defId);
    if (def.projectId !== target.projectId) throw Error('WORKFLOW_PROJECT_MISMATCH');
    const ids = [...new Set(workItemIds.map(id => id.trim()).filter(Boolean))].slice(0, 10);
    if (!ids.length) throw Error('WORKFLOW_BATCH_EMPTY');
    return ids.map(workItemId => {
      const session = this.store.createSession(target, `批量 · ${def.name} · ${workItemId}`.slice(0, 100));
      const contexts: Context[] = [{ id: crypto.randomUUID(), target, workItemId, text: '', prefix: '', suffix: '', source: 'work-item', capturedAt: Date.now(), pinned: false }];
      this.run(defId, session.id, target, contexts, permissionMode, note);
      return { workItemId, sessionId: session.id };
    });
  }

  /** 运行轨迹：历史实例 + 每步执行证据（结果摘要）。 */
  history(projectId: string, limit = 20): WorkflowHistoryItem[] {
    return this.store.list<WorkflowRun>('workflow-run')
      .filter(run => run.target?.projectId === projectId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(run => {
        const session = run.sessionId ? this.store.get<Session>('session', run.sessionId) : undefined;
        const sessionId = session && session.target?.projectId !== projectId ? undefined : run.sessionId;
        const workItemId = run.contexts?.findLast(context => context.target?.projectId === projectId && context.workItemId)?.workItemId;
        return {
          id: run.id, defName: run.defName, status: run.status, startedAt: run.startedAt, ...(run.endedAt ? { endedAt: run.endedAt } : {}),
          ...(sessionId ? { sessionId } : {}), ...(workItemId ? { workItemId } : {}),
          ...(run.note ? { note: run.note } : {}), ...(run.error ? { error: run.error } : {}),
          steps: run.steps.map((stepRun, index) => {
            const def = run.def.steps[index];
            return {
              stepId: stepRun.stepId, title: def?.title ?? stepRun.stepId, status: stepRun.status,
              ...(stepRun.retries ? { retries: stepRun.retries } : {}), ...(stepRun.resultTail ? { resultPreview: stepRun.resultTail.slice(0, 200) } : {}),
              ...(def?.check ? { checkRule: true } : {}),
            };
          }),
        };
      });
  }

  /** 工作流每日定时（空=取消）；document 记录触发目标。 */
  schedule(id: string, scheduleAt: string, target?: Target) {
    const def = this.store.require<WorkflowDef>('workflow-def', id);
    const next: WorkflowDef = { ...def, ...(scheduleAt ? { scheduleAt, ...(target ? { document: target.document } : {}) } : { scheduleAt: undefined, document: undefined }), updatedAt: Date.now() };
    // 走 saveDef 复用校验（步骤不重复、check 目标合法），但保留 id/时间戳。
    const existing = this.store.get<WorkflowDef>('workflow-def', id);
    this.store.put('workflow-def', id, { ...next, createdAt: existing?.createdAt ?? def.createdAt });
    return next;
  }

  /** 供调度器：当天未触发过的定时工作流。 */
  dueWorkflow(now: Date, projectId: string): (WorkflowDef & { marker: string })[] {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = localDay(now);
    return this.defs(projectId)
      .filter(def => def.scheduleAt === hhmm && def.document)
      .filter(def => !this.store.get('workflow-sent', `${def.id}:${today}`))
      .map(def => ({ ...def, marker: `${def.id}:${today}` }));
  }

  // ---- 内置工程模板：开箱即用的常见流程，安装幂等。 ----
  static builtinTemplates(): { name: string; description: string; steps: { id: string; title: string; prompt: string; pause?: boolean; check?: { retryTo: string; maxRetries: number } }[] }[] {
    return [
      {
        name: '需求三连审', description: '质量评审 → 一致性复核（不过返工）→ 结论暂停等确认',
        steps: [
          { id: 's1', title: '需求质量评审', prompt: '对 {{item}} 做质量评审：用 peek_work_item 读正文，指出判据缺失、多条职责、术语不一致；逐条给出改法。' },
          { id: 's2', title: '一致性复核', prompt: '复核上一步指出的问题是否都已给出可执行改法：\n{{prev}}\n全部有改法且依据充分时通过。', check: { retryTo: 's1', maxRetries: 1 } },
          { id: 's3', title: '出结论', prompt: '汇总评审结论（发现数、改法清单、遗留风险），按重要性排序，供人工确认。', pause: true },
        ],
      },
      {
        name: '模型一致性巡检', description: '巡检差异 → 逐项修复建议 → 人工裁决',
        steps: [
          { id: 's1', title: '巡检差异', prompt: '用 mcp__polarion_drafts__model_trace 的 action=check 巡检 {{item}} 所在项目的模型与需求一致性，列出哪侧变了、哪些文件、受影响需求。' },
          { id: 's2', title: '修复建议', prompt: '对巡检发现逐项给出修复方向（以需求为准还是以模型为准）、具体改法和验证方式：\n{{prev}}' },
          { id: 's3', title: '人工裁决', prompt: '把修复建议整理成裁决清单（每项：差异、建议方向、影响），等待人工选择。', pause: true },
        ],
      },
      {
        name: '写前查重合并', description: '查重 → 差异对比 → 复用结论',
        steps: [
          { id: 's1', title: '查重', prompt: '用 dedup_search 把 {{item}} 的正文与文档已索引条目比对，列出相似条目与共享术语。' },
          { id: 's2', title: '差异对比', prompt: '对查重命中的最高分条目逐条对比：哪些内容重复可合并、哪些是本条新增价值：\n{{prev}}' },
          { id: 's3', title: '复用结论', prompt: '给出结论：复用/合并/保留两条并说明理由。' },
        ],
      },
      {
        name: '体检清零', description: '逐条修复体检发现 → 复验不过返工 → 汇总',
        steps: [
          { id: 's1', title: '逐条修复', prompt: '读取 {{item}} 的体检发现（规则包），逐条给出并应用改写：模糊词具体化、拆分多条职责、补判据；改完列出剩余问题。' },
          { id: 's2', title: '复验', prompt: '复核修复后的条目还有没有体检命中（逐条核对规则），全部清零才通过：\n{{prev}}', check: { retryTo: 's1', maxRetries: 2 } },
          { id: 's3', title: '汇总', prompt: '汇总本轮体检清零结果（修复数、剩余、建议人工复核项）。' },
        ],
      },
      {
        name: '新需求起草', description: '读上游 → 按句式起草 → 自检不过返工',
        steps: [
          { id: 's1', title: '读上游', prompt: '用 peek_work_item 读 {{item}} 及其上游/引用条目，提炼要实现的行为、接口和约束。' },
          { id: 's2', title: '按句式起草', prompt: '按工程句式（验证准则/信号定义/状态跳变）起草需求正文，量化所有判据，输出完整草稿：\n上游要点：\n{{prev}}' },
          { id: 's3', title: '自检', prompt: '自检草稿：每条职责单一、判据可量化验证、无模糊词，通过才结束：\n{{prev}}', check: { retryTo: 's2', maxRetries: 1 } },
        ],
      },
    ];
  }

  /** 安装缺失的内置模板（幂等）；返回项目全部定义。 */
  seedTemplates(projectId: string): WorkflowDef[] {
    for (const template of Workflows.builtinTemplates()) {
      if (this.defs(projectId).some(def => def.name === template.name)) continue;
      this.saveDef({ id: crypto.randomUUID(), projectId, name: template.name, description: template.description, origin: 'agent', createdAt: Date.now(), updatedAt: 0, steps: template.steps.map(step => ({ id: step.id, title: step.title, prompt: step.prompt, pause: step.pause ?? false, ...(step.check ? { check: step.check } : {}) })) });
    }
    return this.defs(projectId);
  }
  /** 会话空闲推进（由 Engines.pump 调用，也用于 run/resume/recover 之后）。同步执行：状态检查与落库之间无 await。 */
  advance(sessionId: string) {
    const wr = this.store.list<WorkflowRun>('workflow-run').filter(w => w.sessionId === sessionId && w.status === 'running').sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!wr) return;
    const stepRun = wr.steps[wr.currentIndex];
    if (!stepRun) { this.finish(wr, 'done'); return; }
    const inFlight = this.store.list<Run>('run').filter(r => r.sessionId === sessionId && ['running', 'waiting', 'queued'].includes(r.status));
    if (inFlight.some(r => r.id === stepRun.runId)) { this.markStepRunning(wr, stepRun); return; }
    if (inFlight.length) return; // 用户插话/其他任务先走；它们结束后 pump 会再次推进
    if (stepRun.runId) {
      const run = this.store.get<Run>('run', stepRun.runId);
      if (run && ['running', 'waiting', 'queued'].includes(run.status)) { this.markStepRunning(wr, stepRun); return; }
      if (stepRun.status === 'pending' || stepRun.status === 'running') {
        stepRun.status = runStatusToStepStatus(run?.status);
        stepRun.resultTail = this.resultTail(stepRun.runId);
      }
      if (stepRun.status !== 'done') { this.finish(wr, 'failed', `步骤「${wr.def.steps[wr.currentIndex]!.title}」${stepSettledText[stepRun.status] ?? '未完成'}`); return; }
      const step = wr.def.steps[wr.currentIndex]!;
      if (step.check) {
        const verdict = parseCheckVerdict(stepRun.resultTail);
        if (verdict === 'fail') {
          stepRun.retries = (stepRun.retries ?? 0) + 1;
          if (stepRun.retries <= step.check.maxRetries) { this.rework(wr, wr.currentIndex, step.check.retryTo); return; }
          wr.status = 'paused'; wr.error = 'CHECK_REWORK_EXHAUSTED'; this.touch(wr); return;
        }
        if (verdict === 'need_manual') { wr.status = 'paused'; wr.error = 'CHECK_NEED_MANUAL'; this.touch(wr); return; }
      }
      if (wr.currentIndex >= wr.def.steps.length - 1) { this.finish(wr, 'done'); return; }
      if (step.pause) {
        stepRun.gateProposalId = this.proposals?.runtime({target:wr.target, source:'workflow', summary:`确认工作流步骤「${step.title}」`, op:{kind:'gate',workflowRunId:wr.id,stepId:step.id}}).id;
        wr.status = 'paused'; this.touch(wr); return;
      }
      wr.currentIndex += 1; this.touch(wr);
    }
    this.launch(wr);
  }
  /** 暂停后继续：跳过已确认的暂停步，进入下一步。 */
  resume(id: string): WorkflowRunView {
    const wr = this.store.require<WorkflowRun>('workflow-run', id);
    if (wr.status !== 'paused') throw Error('WORKFLOW_NOT_PAUSED');
    const gate = wr.steps[wr.currentIndex]?.gateProposalId;
    if (gate && this.proposals) { this.proposals.decideRuntime(gate,true); this.proposals.finishRuntime(gate); }
    wr.status = 'running'; wr.error = undefined; wr.currentIndex += 1;
    this.touch(wr);
    if (wr.currentIndex >= wr.def.steps.length) this.finish(wr, 'done');
    else this.advance(wr.sessionId);
    return this.view(wr);
  }
  cancel(id: string): WorkflowRunView {
    const wr = this.store.require<WorkflowRun>('workflow-run', id);
    if (wr.status === 'done' || wr.status === 'cancelled') throw Error('WORKFLOW_NOT_ACTIVE');
    const stepRun = wr.steps[wr.currentIndex];
    if (wr.status === 'paused' && stepRun?.gateProposalId) this.proposals?.decideRuntime(stepRun.gateProposalId,false);
    if (stepRun?.runId) {
      try { this.engines?.cancel(stepRun.runId); } catch { /* 该步骤 run 已终态 */ }
      if (stepRun.status === 'pending' || stepRun.status === 'running') stepRun.status = 'cancelled';
    }
    this.finish(wr, 'cancelled');
    return this.view(wr);
  }
  /** Host 启动恢复：已完成的当前步自动续跑；被重启打断的转暂停，由用户决定继续（跳过该步）或终止。 */
  recover() {
    for (const wr of this.store.list<WorkflowRun>('workflow-run')) {
      if (wr.status !== 'running') continue;
      const stepRun = wr.steps[wr.currentIndex];
      const run = stepRun?.runId ? this.store.get<Run>('run', stepRun.runId) : undefined;
      if (!stepRun?.runId || run?.status === 'completed') { this.advance(wr.sessionId); continue; }
      wr.status = 'paused'; wr.error = 'HOST_RESTARTED'; this.touch(wr);
    }
  }

  /** 会话当前要展示的工作流实例：运行/暂停优先，终态结果保留 5 分钟。 */
  viewOf(sessionId: string): WorkflowRunView | undefined {
    const wr = this.store.list<WorkflowRun>('workflow-run').filter(w => w.sessionId === sessionId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!wr) return undefined;
    if (!['running', 'paused'].includes(wr.status) && (!wr.endedAt || Date.now() - wr.endedAt > SETTLED_VISIBLE_MS)) return undefined;
    return this.view(wr);
  }
  private view(wr: WorkflowRun): WorkflowRunView {
    return {
      id: wr.id, defId: wr.defId, defName: wr.defName, status: wr.status, currentIndex: wr.currentIndex, total: wr.def.steps.length,
      steps: wr.steps.map((stepRun, index) => ({ stepId: stepRun.stepId, title: wr.def.steps[index]?.title ?? stepRun.stepId, status: stepRun.status, pause: wr.def.steps[index]?.pause ?? false, ...(stepRun.retries ? { retries: stepRun.retries } : {}) })),
      ...(wr.note ? { note: wr.note } : {}), ...(wr.error ? { error: wr.error } : {}), startedAt: wr.startedAt, updatedAt: wr.updatedAt, ...(wr.endedAt ? { endedAt: wr.endedAt } : {}),
    };
  }
  private launch(wr: WorkflowRun) {
    const index = wr.currentIndex, step = wr.def.steps[index]!, stepRun = wr.steps[index]!;
    const prompt = composeWorkflowStepPrompt(wr, index);
    const badge = { workflowRunId: wr.id, defName: wr.defName, stepIndex: index, stepTotal: wr.def.steps.length, stepTitle: step.title };
    try {
      const result = this.store.startRun(wr.sessionId, crypto.randomUUID(), prompt, wr.contexts, wr.target, [], wr.permissionMode, 'queue', step.guidelineId, badge);
      stepRun.runId = result.run.id; stepRun.status = result.run.status === 'queued' ? 'pending' : 'running';
      this.touch(wr);
      if (result.created) { if (result.run.status === 'queued') this.engines?.pump(wr.sessionId); else void this.engines?.execute(result.run); }
    } catch (error) {
      // 启动失败（如附加指令被删）不让工作流卡死，也不让异常穿透到 pump/execute 的收尾路径。
      this.finish(wr, 'failed', `步骤「${step.title}」无法启动：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private markStepRunning(wr: WorkflowRun, stepRun: WorkflowStepRun) {
    if (stepRun.status !== 'pending') return;
    stepRun.status = 'running'; this.touch(wr);
  }
  /** 检查步判 FAIL：回到 retryTo 重做一段。各步保留上一轮 resultTail，返工提示词可用 {{steps.检查步id}} 引用失败原因。 */
  private rework(wr: WorkflowRun, checkIndex: number, retryTo: string) {
    const from = wr.def.steps.findIndex(step => step.id.toLowerCase() === retryTo.toLowerCase());
    if (from < 0 || from > checkIndex) { this.finish(wr, 'failed', `步骤「${wr.def.steps[checkIndex]!.title}」的返工目标无效：${retryTo}`); return; }
    for (let index = from; index <= checkIndex; index++) {
      const stepRun = wr.steps[index]!;
      stepRun.status = 'pending'; stepRun.runId = undefined; delete stepRun.gateProposalId;
    }
    wr.currentIndex = from;
    this.touch(wr);
    this.launch(wr);
  }
  private resultText(runId: string): string | undefined {
    const row = this.store.db.prepare("SELECT data FROM events WHERE run_id=? AND kind='result' ORDER BY seq DESC LIMIT 1").get(runId) as { data: string } | undefined;
    if (!row) return undefined;
    try {
      const text = String((JSON.parse(row.data) as { text?: unknown }).text ?? '');
      return text || undefined;
    } catch { return undefined; }
  }
  private resultTail(runId: string): string | undefined {
    const text = this.resultText(runId);
    return text ? text.slice(-RESULT_TAIL_CHARS) : undefined;
  }
  private finish(wr: WorkflowRun, status: WorkflowRun['status'], error?: string) {
    wr.status = status; wr.error = error; wr.endedAt = Date.now(); this.touch(wr);
  }
  private touch(wr: WorkflowRun) { wr.updatedAt = Date.now(); this.store.put('workflow-run', wr.id, wr); }
}

/** 本地日期 YYYY-MM-DD：定时去重按用户本地时区算，不能直接用 UTC（跨零点会错一天）。 */
export function localDay(now: Date) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
