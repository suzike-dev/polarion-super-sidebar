import { Store } from './store.ts';
import { Rules } from './rules.ts';
import { lintText } from '../../packages/core/requirement-lint.ts';
import type { GateId, GatePolicy, GateResult, GatesItemView, GatesView, Target } from '../../packages/protocol/index.ts';
import { defaultGatePolicy, GatePolicySchema, VERIFICATION_ROLE } from '../../packages/protocol/index.ts';

/**
 * v0.16 生命周期门禁一期：基于覆盖索引对整册逐条判定四道门——
 * 质量体检（无警示命中）、验证准则（含量化判据）、上游链接、实现模块。
 * 全过才算 passed；结果供总览体检页与编辑器影响卡展示，形成“分数/链接/准则”门禁。
 */
const CRITERION_HINT = /(满足|符合|不得|不应|至少|最多|不超过|小于|大于|等于|范围|以内|之前|之后|判据|验收|\d+\s*(ms|s|min|%|℃|°C|km\/h|kph|V|A|Hz))/i;
const gateLabels: Record<GateId, string> = { quality: '质量体检', criterion: '验证准则', upstream: '上游链接', module: '实现模块' };

type CoverageRow = { workItemId: string; title: string; outline: string; text: string; marks: { modules: string[] }[]; forwardLinks: { role: string }[] };

export class Gates {
  private store: Store;
  private rules: Rules;
  constructor(store: Store, rules: Rules) { this.store = store; this.rules = rules; }

  /** 项目门禁策略（缺省全开、阈值关闭）。 */
  policy(projectId: string): GatePolicy {
    const raw = this.store.get<GatePolicy>('gate-policy', projectId);
    const parsed = GatePolicySchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : defaultGatePolicy();
  }
  savePolicy(projectId: string, policy: GatePolicy): GatePolicy {
    const value = GatePolicySchema.parse(policy);
    this.store.put('gate-policy', projectId, value);
    return value;
  }

  async view(target: Target): Promise<GatesView> {
    const coverage = this.store.get<{ at: number; items: CoverageRow[] }>('coverage-index', target.projectId);
    if (!coverage?.items.length) throw Error('GATES_INDEX_EMPTY：先在模型工作台「覆盖视图」构建覆盖索引，门禁才能逐条判定。');
    const policy = this.policy(target.projectId);
    const { pack } = await this.rules.read(target, false);
    const items: GatesItemView[] = coverage.items.map(row => {
      const text = `${row.title}\n${row.text}`;
      const warns = lintText(text, pack).filter(issue => issue.severity === 'warn');
      const hasCriterion = CRITERION_HINT.test(row.text);
      const upstreamCount = (row.forwardLinks ?? []).filter(link => !VERIFICATION_ROLE.test(link.role)).length;
      const moduleCount = (row.marks ?? []).reduce((count, mark) => count + mark.modules.length, 0);
      const gates: GateResult[] = [
        policy.enabled.quality ? { gate: 'quality', label: gateLabels.quality, pass: warns.length === 0, detail: warns.length ? `命中 ${warns.length} 处警示：${warns[0]!.message}` : '规则包无警示命中' } : { gate: 'quality', label: gateLabels.quality, pass: true, detail: '策略已停用' },
        policy.enabled.criterion ? { gate: 'criterion', label: gateLabels.criterion, pass: hasCriterion, detail: hasCriterion ? '检出量化判据/验收条件' : '未检出量化判据（数值/限值/时限）' } : { gate: 'criterion', label: gateLabels.criterion, pass: true, detail: '策略已停用' },
        policy.enabled.upstream ? { gate: 'upstream', label: gateLabels.upstream, pass: upstreamCount > 0, detail: upstreamCount ? `${upstreamCount} 条上游链接` : '无上游/派生链接' } : { gate: 'upstream', label: gateLabels.upstream, pass: true, detail: '策略已停用' },
        policy.enabled.module ? { gate: 'module', label: gateLabels.module, pass: moduleCount > 0, detail: moduleCount ? `${moduleCount} 个实现模块` : '未标注实现模块' } : { gate: 'module', label: gateLabels.module, pass: true, detail: '策略已停用' },
      ];
      return { workItemId: row.workItemId, title: row.title, outline: row.outline, gates, passed: gates.every(gate => gate.pass) };
    });
    const byGate = { quality: 0, criterion: 0, upstream: 0, module: 0 } as Record<GateId, number>;
    for (const item of items) for (const gate of item.gates) if (!gate.pass) byGate[gate.gate] += 1;
    const qualityScore = items.length ? Math.round((items.filter(item => item.gates.find(gate => gate.gate === 'quality')!.pass).length / items.length) * 100) : 0;
    return { items, summary: { total: items.length, passed: items.filter(item => item.passed).length, byGate, qualityScore }, policy, coverageAt: coverage.at };
  }
}
