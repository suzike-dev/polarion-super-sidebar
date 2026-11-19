import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { defaultRulePack, type LintIssue, type RulePack } from '../../../packages/core/requirement-lint';
import type { Target } from '../../../packages/protocol/index';
import { rpc } from './client';

/* 行内质量体检（v0.14）：规则包来自 PSB-RULES 项目工作项（一人配置、全项目共用），Host 未就绪时回退内置默认。 */

/** 与 documentSearch 同款插件模式：装饰内容来自外部 ref，meta 事务驱动重绘。 */
export function qualityLintExtension(issues: { current: LintIssue[] }): Extension {
  return Extension.create({ name: 'qualityLint', addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      const list = issues.current.filter(issue => issue.from !== undefined && issue.to !== undefined);
      if (!list.length) return null;
      return DecorationSet.create(state.doc, list.map(issue => Decoration.inline(issue.from!, issue.to!, { class: 'psb-lint ' + (issue.severity === 'warn' ? 'psb-lint-warn' : 'psb-lint-info'), 'data-lint': `${issue.from}:${issue.to}` })));
    } } })];
  } });
}

const listeners = new Set<(projectId: string, pack: RulePack) => void>();
export function announceRulePack(target: Target, pack: RulePack) {
  for (const listener of listeners) listener(target.projectId, pack);
}
export function watchRulePack(listener: (projectId: string, pack: RulePack) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 规则包加载：PSB-RULES 优先（含缓存/默认包回退，Host 内完成），RPC 不可达时用内置默认。 */
export async function loadRulePack(target: Target): Promise<RulePack> {
  try { return (await rpc<{ pack: RulePack }>({ method: 'rules.get', target, refresh: false })).pack; } catch { return defaultRulePack(); }
}

/** 悬停在体检高亮上时，把 DOM 事件还原为对应的问题项与屏幕位置。 */
export function lintHover(event: { target: EventTarget | null }, issues: LintIssue[]): { issue: LintIssue; rect: DOMRect } | null {
  const element = (event.target as Element | undefined)?.closest?.('.psb-lint');
  if (!element) return null;
  const [from, to] = String(element.getAttribute('data-lint') ?? '').split(':').map(Number);
  const issue = issues.find(item => item.from === from && item.to === to);
  return issue ? { issue, rect: element.getBoundingClientRect() } : null;
}
