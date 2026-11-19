import { z } from 'zod';
import type { Node } from '@tiptap/pm/model';
import type { TextMatch } from './editor-text.ts';

/* ------------------------------------------------------------------ */
/* 需求质量体检：规则包 + 纯文本/文档启发式扫描。v0.14 规格 A/B/C 组。 */
/* 规则包结构与协议层 RulePack 保持一致（协议层只复制类型，不依赖本文件）。 */
/* ------------------------------------------------------------------ */

export const LintSeveritySchema = z.enum(['info', 'warn']);
export type LintSeverity = z.infer<typeof LintSeveritySchema>;
export const GlossaryEntrySchema = z.object({
  term: z.string().trim().min(1).max(80),
  /** 非标准叫法：命中时提示替换为 term；最长匹配优先。 */
  aliases: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  /** true 表示 term 本身是禁用词（整条命中即警示，无替换建议）。 */
  forbidden: z.boolean().default(false),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
export const LintRuleTypeSchema = z.enum(['fuzzy-word', 'anaphora', 'non-atomic', 'no-criterion', 'no-condition', 'long-sentence']);
export type LintRuleType = z.infer<typeof LintRuleTypeSchema>;
export const LintRuleSchema = z.object({
  id: z.string().trim().min(1).max(60),
  severity: LintSeveritySchema,
  type: LintRuleTypeSchema,
  /** fuzzy-word / anaphora 的词表。 */
  words: z.array(z.string().trim().min(1).max(40)).max(200).default([]),
  message: z.string().trim().max(200).default(''),
  enabled: z.boolean().default(true),
  /** 展示用：人话名称与分类（内置基线自带；项目自定义可留空）。 */
  title: z.string().trim().max(60).optional(),
  category: z.enum(['verifiability', 'atomicity', 'clarity', 'consistency']).optional(),
});
export type LintRule = z.infer<typeof LintRuleSchema>;
export const RulePackSchema = z.object({
  version: z.number().int().nonnegative().default(1),
  glossary: z.array(GlossaryEntrySchema).max(2000).default([]),
  lintRules: z.array(LintRuleSchema).max(200).default([]),
});
export type RulePack = z.infer<typeof RulePackSchema>;

/** 一处体检发现：from/to 是 lintText 的字符偏移或 lintDocument 的 PM 位置；条目级规则无范围。 */
export type LintIssue = {
  ruleId: string;
  severity: LintSeverity;
  message: string;
  matchedText: string;
  /** 术语类命中的标准替换词。 */
  suggestion?: string;
  from?: number;
  to?: number;
};

/**
 * 内置基线 v2（严格）：三类七条纯文本启发式——可验证性 / 原子性 / 明确性。
 * 这是需求的“下限筛查”：0 命中不代表质量好，深度检查（判据充分性、场景完整性、上下游一致性）
 * 由 AI 预审/深检承担。项目可在规则中心在此基础上补充词表与术语。
 */
export function defaultRulePack(): RulePack {
  return RulePackSchema.parse({
    version: 2,
    glossary: [],
    lintRules: [
      // 可验证性
      { id: 'fuzzy-default', severity: 'warn', type: 'fuzzy-word', category: 'verifiability', title: '模糊词', message: '模糊词：无法客观验证，改为可度量的表述（时限/数量/状态）', enabled: true,
        words: ['快速', '尽快', '及时', '实时', '可靠', '高效', '合适', '适当', '合理', '必要时', '视情况', '原则上', '显著', '大量', '若干', '等等', '友好', '用户友好', '优化', '完善'] },
      { id: 'no-criterion-default', severity: 'warn', type: 'no-criterion', category: 'verifiability', title: '无量化判据', message: '写了义务但没有可验证判据：补数量/时限/状态值（如“300ms 内”“0x1 时”）', enabled: true },
      // 原子性
      { id: 'non-atomic-default', severity: 'warn', type: 'non-atomic', category: 'atomicity', title: '职责不原子', message: '一条需求包含多个义务且无分号或编号切分，拆分为原子需求（一条=一个可验证行为）', enabled: true },
      { id: 'long-sentence-default', severity: 'info', type: 'long-sentence', category: 'atomicity', title: '单条过长', message: '单条超过 140 字且无结构切分，评审与测试难以逐项对照，建议拆分或编号', enabled: true },
      // 明确性
      { id: 'anaphora-default', severity: 'warn', type: 'anaphora', category: 'clarity', title: '指代不明', message: '指代不明：评审与下游建模无法定位所指，展开为具体对象（信号/系统/模式名）', enabled: true,
        words: ['上述', '如前所述', '以上要求', '前述', '该功能', '该系统', '该信号', '该模块', '该模式', '此功能', '相应', '其对应'] },
      { id: 'no-condition-default', severity: 'info', type: 'no-condition', category: 'clarity', title: '缺触发条件', message: '只写了行为没写何时触发：补“当/若/检测到 …时”的触发条件', enabled: true },
    ],
  });
}

const DUTY = /应当|必须|应|须|不得|不允许/g;
/** 量化判据：限值词+数字，或数字带单位（含中文单位）。裸“之前/之后/阈值”不算。 */
const CRITERION = /(?:不超过|不小于|不大于|小于|大于|至少|最多|超过|以内|范围内?|等于)[^。；\n]{0,12}\d|\d\s*(?:ms|s|min|h|%|±|℃|°C|km\/h|kph|V|A|Hz|kHz|MHz|r\/min|Nm|bar|kPa|毫秒|秒|分钟|小时|公里|米|次|条|位|档)(?![a-z])/i;
const CONDITION = /当\b|若\b|如果|一旦|检测到|接收到|收到|处于|启用|激活|在[^。；\n]{0,12}时/;
const ENUMERATION = /(?:^|\n|\s)[0-9一二三四五六七八九十]+[.、）)]/;

function escapeWord(word: string) { return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Lookahead visits overlapping literal matches and keeps offsets in the original UTF-16 string. */
function wordPattern(word: string) { return new RegExp(`(?=(${escapeWord(word)}))`, 'giu'); }

function wordScanner(pack: RulePack) {
  const standards = [...new Set(pack.glossary.map(entry => entry.term))].map(term => ({ term, pattern: wordPattern(term) }));
  const longestTerm = standards.reduce((length, entry) => Math.max(length, entry.term.length), 0);
  type Finding = Omit<LintIssue, 'from' | 'to' | 'matchedText'>;
  const needles: { word: string; issue: Finding; aliasFor?: string }[] = [];
  for (const rule of pack.lintRules) {
    if (!rule.enabled || (rule.type !== 'fuzzy-word' && rule.type !== 'anaphora')) continue;
    for (const word of rule.words) needles.push({ word, issue: { ruleId: rule.id, severity: rule.severity, message: rule.message } });
  }
  for (const { term, aliases, forbidden } of pack.glossary) {
    const issue: Finding = forbidden
      ? { ruleId: `glossary-forbidden:${term}`, severity: 'warn', message: `禁用术语「${term}」` }
      : { ruleId: `glossary:${term}`, severity: 'warn', message: `术语不统一：建议使用标准术语「${term}」`, suggestion: term };
    if (forbidden) needles.push({ word: term, issue });
    for (const word of aliases) needles.push({ word, aliasFor: term, issue });
  }
  const candidates = needles.sort((a, b) => b.word.length - a.word.length).map(({ word, ...rest }) => ({ pattern: wordPattern(word), ...rest }));
  return (text: string) => {
    const standardsAt = new Map<number, { term: string; end: number }[]>();
    for (const { term, pattern } of standards) for (const match of text.matchAll(pattern)) {
      const entries = standardsAt.get(match.index) ?? [];
      entries.push({ term, end: match.index + match[1]!.length }); standardsAt.set(match.index, entries);
    }
    const overlapsStandard = (from: number, to: number, spelling: string, target: string) => {
      for (let pos = Math.max(0, from - longestTerm + 1); pos < to; pos++) {
        const blocked = standardsAt.get(pos)?.some(({ term, end }) => {
          if (end <= from) return false;
          if (from === pos && to === end) return term !== target || spelling === term;
          return from > pos || to < end; // A whole longer alias may contain a shorter standard.
        });
        if (blocked) return true;
      }
      return false;
    };
    type Hit = LintIssue & { from: number; to: number };
    const issues: Hit[] = [], occupied: (Hit | undefined)[] = [];
    for (const { pattern, issue, aliasFor } of candidates) {
      for (const match of text.matchAll(pattern)) {
        const from = match.index, matchedText = match[1]!, to = from + matchedText.length;
        if (aliasFor && overlapsStandard(from, to, matchedText, aliasFor)) continue;
        let previous: Hit | undefined;
        for (let i = from; i < to && !previous; i++) previous = occupied[i];
        if (!previous) {
          const hit = { ...issue, matchedText, from, to };
          issues.push(hit);
          for (let i = from; i < to; i++) occupied[i] = hit;
        } else if (aliasFor && previous.from === from && previous.to === to && previous.suggestion && previous.suggestion !== issue.suggestion) {
          previous.ruleId = 'glossary-ambiguous'; previous.message = `「${matchedText}」对应多个术语条目，请核对项目术语表。`;
          delete previous.suggestion;
        }
      }
    }
    return issues;
  };
}

function scanItem(text: string, pack: RulePack): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const rule of pack.lintRules) {
    if (!rule.enabled) continue;
    if (rule.type === 'non-atomic') {
      const duties = text.match(DUTY);
      if (duties && duties.length >= 2 && !/[；;]/.test(text) && !ENUMERATION.test(text)) issues.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, matchedText: duties.join('、') });
    } else if (rule.type === 'no-criterion') {
      if (DUTY.test(text) && !CRITERION.test(text)) issues.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, matchedText: '' });
      DUTY.lastIndex = 0;
    } else if (rule.type === 'no-condition') {
      if (DUTY.test(text) && !CONDITION.test(text)) issues.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, matchedText: '' });
      DUTY.lastIndex = 0;
    } else if (rule.type === 'long-sentence') {
      const plain = text.replace(/\s+/g, '');
      if (plain.length > 140 && !/[；;]/.test(text) && !ENUMERATION.test(text)) issues.push({ ruleId: rule.id, severity: rule.severity, message: `${rule.message}（当前 ${plain.length} 字）`, matchedText: '' });
    }
  }
  return issues;
}

/** 纯文本扫描：词级规则带字符偏移，条目级规则（non-atomic / no-criterion）无范围。 */
export function lintText(text: string, pack: RulePack): LintIssue[] {
  return [...wordScanner(pack)(text), ...scanItem(text, pack)].sort((a, b) => (a.from ?? Number.MAX_SAFE_INTEGER) - (b.from ?? Number.MAX_SAFE_INTEGER));
}

/** 文档扫描：词级规则给出 PM 位置（用于行内高亮），条目级规则以整篇纯文本评估。 */
export function lintDocument(doc: Node, pack: RulePack): LintIssue[] {
  const issues: LintIssue[] = [], scanWords = wordScanner(pack);
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return; // 继续进入 Polarion 分组、列表和表格单元格。
    // 与 editor-text.findTextMatches 相同的遍历：跨内联对象的文本不拼成一段，避免高亮范围穿过图片/表格内联节点。
    let text = '', start = pos + 1;
    const flush = () => { if (text) { for (const issue of scanWords(text)) issues.push({ ...issue, from: start + issue.from, to: start + issue.to }); } text = ''; };
    block.forEach((node, offset) => { if (node.isText) { if (!text) start = pos + 1 + offset; text += node.text; } else flush(); });
    flush();
    return false;
  });
  const itemPack: RulePack = { ...pack, lintRules: pack.lintRules.filter(rule => rule.type === 'non-atomic' || rule.type === 'no-criterion' || rule.type === 'no-condition' || rule.type === 'long-sentence') };
  issues.push(...scanItem(doc.textBetween(0, doc.content.size, '\n', '\n'), itemPack));
  return issues.sort((a, b) => (a.from ?? Number.MAX_SAFE_INTEGER) - (b.from ?? Number.MAX_SAFE_INTEGER));
}

export function glossaryAliasPattern(alias: string, caseSensitive: boolean) {
  return new RegExp(`^(?:${escapeWord(alias)})$`, caseSensitive ? 'u' : 'iu');
}

/** Resolve one glossary suggestion against exactly the findings offered by the quality editor. */
export function glossaryFixMatches(doc: Node, pack: RulePack, alias: string, term: string, caseSensitive: boolean): TextMatch[] {
  const spelling = glossaryAliasPattern(alias, caseSensitive);
  return lintDocument(doc, pack).flatMap(issue =>
    issue.suggestion === term && issue.from !== undefined && issue.to !== undefined && spelling.test(issue.matchedText)
      ? [{ from: issue.from, to: issue.to }] : []);
}
