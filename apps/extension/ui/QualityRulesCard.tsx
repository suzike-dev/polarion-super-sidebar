import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { defaultRulePack, RulePackSchema, type LintRule, type RulePack } from '../../../packages/core/requirement-lint';
import type { Target } from '../../../packages/protocol/index';
import { announceRulePack } from '../lib/quality-lint';
import { rpc } from '../lib/client';
import type { RulesView } from '../../host/rules';
import './quality-rules.css';

const sourceLabels = { polarion: '项目规则包', cache: '本机缓存', default: '内置基线' } as const;
const typeLabels: Record<LintRule['type'], string> = { 'fuzzy-word': '模糊词表', anaphora: '指代词表', 'non-atomic': '多义务', 'no-criterion': '无判据', 'no-condition': '无触发条件', 'long-sentence': '单条过长' };
type Category = NonNullable<LintRule['category']> | 'custom';
const sections: { key: Category; label: string; hint: string; tone: string }[] = [
  { key: 'verifiability', label: '可验证性', hint: '每条义务都要能量化验证：时限、数量、状态值', tone: '#c98a2b' },
  { key: 'atomicity', label: '原子性', hint: '一条需求只说一个可验证行为，拆开才好评审和测试', tone: '#4f8c86' },
  { key: 'clarity', label: '明确性', hint: '指代展开、触发条件写全，下游建模才能对上', tone: '#6a74b8' },
  { key: 'consistency', label: '一致性', hint: '', tone: '#62816b' },
  { key: 'custom', label: '项目自定义', hint: '团队补充与历史导入的规则', tone: '#9a9d92' },
];

type DraftRule = LintRule & { wordsText?: string };
type DraftTerm = RulePack['glossary'][number] & { aliasesText?: string };
type DraftPack = Omit<RulePack, 'lintRules' | 'glossary'> & { lintRules: DraftRule[]; glossary: DraftTerm[] };
type Props = { target: Target; hidden?: boolean; onDeepCheck?: () => void; onDirtyChange?: (dirty: boolean) => void };
const splitList = (text: string) => text.split(/[,，、\n]/).map(word => word.trim()).filter(Boolean);

export function QualityRulesCard(props: Props) {
  return <ProjectRules key={`${props.target.origin}/${props.target.projectId}`} {...props}/>;
}

function ProjectRules({ target, hidden, onDeepCheck, onDirtyChange }: Props) {
  const [view, setView] = useState<RulesView | null>(null);
  const [pack, setPack] = useState<DraftPack | null>(null);
  const [busy, setBusy] = useState('正在加载…');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 规则按项目共享。切换本项目的文档时保留正在编辑的输入。
  const projectTarget = useRef(target).current;
  const request = useRef(0);
  const load = useCallback(async (refresh: boolean, replacingDraft = false) => {
    const id = ++request.current;
    setBusy(refresh ? '正在读取项目规则包…' : '正在加载…');
    setMessage(null);
    try {
      const next = await rpc<RulesView>({ method: 'rules.get', target: projectTarget, refresh });
      if (id !== request.current) return;
      if (replacingDraft && next.error && next.source !== 'polarion') {
        setMessage({ text: `${next.error}。已保留未保存的输入。`, error: true });
        return;
      }
      setView(next); setPack(next.pack); announceRulePack(projectTarget, next.pack);
      if (next.error) setMessage({ text: next.error });
    } catch (error) {
      if (id === request.current) setMessage({ text: (error as Error).message, error: true });
    } finally { if (id === request.current) setBusy(''); }
  }, [projectTarget]);
  useEffect(() => {
    void load(false);
    return () => { request.current++; };
  }, [load]);

  const dirty = useMemo(() => !!pack && !!view && pack !== view.pack && JSON.stringify(pack) !== JSON.stringify(view.pack), [pack, view]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const edit = (update: (current: DraftPack) => DraftPack) => {
    setMessage(null);
    setPack(current => current && update(current));
  };
  const patchRule = (id: string, patch: Partial<DraftRule>) => edit(current => ({ ...current, lintRules: current.lintRules.map(rule => rule.id === id ? { ...rule, ...patch } : rule) }));
  const patchTerm = (index: number, patch: Partial<DraftTerm>) => edit(current => ({ ...current, glossary: current.glossary.map((entry, i) => i === index ? { ...entry, ...patch } : entry) }));
  const save = async () => {
    if (!pack || !view || busy || !dirty) return;
    // 保留输入法、尾部分隔符和换行，直到提交才解析。未编辑的旧词表原样提交。
    const parsed = RulePackSchema.safeParse({
      version: view.pack.version + 1,
      lintRules: pack.lintRules.map(({ wordsText, ...rule }) => ({ ...rule, words: wordsText === undefined ? rule.words : splitList(wordsText) })),
      glossary: pack.glossary.map(({ aliasesText, ...entry }) => ({ ...entry, aliases: aliasesText === undefined ? entry.aliases : splitList(aliasesText) })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const [group, index, field] = issue.path;
      const position = typeof index === 'number' ? `第 ${index + 1} 条` : '';
      const hint = field === 'aliases' ? '别名最多 40 个，每个最多 80 字。' : field === 'term' ? '标准术语须为 1 至 80 字。' : field === 'words' ? '词表最多 200 个词，每个最多 40 字。' : issue.message;
      setMessage({ text: `${group === 'glossary' ? '术语表' : '规则'}${position}：${hint}`, error: true });
      return;
    }
    setBusy('正在保存到项目（PSB-RULES）…'); setMessage(null);
    try {
      const next = await rpc<RulesView>({ method: 'rules.save', target, pack: parsed.data, expectedUpdated: view.remoteUpdated ?? null });
      setView(next); setPack(next.pack); announceRulePack(target, next.pack);
      setMessage({ text: `已保存 v${next.pack.version}，对全部项目成员生效。` });
    } catch (error) {
      const text = (error as Error).message;
      setMessage({ text: /RULES_CONFLICT/.test(text) ? '项目规则已被他人更新。请先复制要保留的输入，再重新读取并合并修改。' : text, error: true });
    } finally { setBusy(''); }
  };
  const workItemUrl = view?.workItemId ? `${target.origin}/polarion#/project/${encodeURIComponent(target.projectId)}/workitem/${encodeURIComponent(view.workItemId)}` : '';
  const enabledCount = pack?.lintRules.filter(rule => rule.enabled).length ?? 0;

  return <div className="sp-card qc" hidden={hidden} aria-busy={!!busy}>
    <div className="qc-content" role="region" aria-label="质量规则内容" tabIndex={0}>
      <div className="qc-summary">
        <span className="qc-shield"><ShieldCheck size={15}/></span>
        <div className="qc-summary-title"><strong>质量规则</strong><small>行内体检的判定基线</small></div>
        <div className="qc-summary-stat"><b>{enabledCount}</b><span>/{pack?.lintRules.length ?? 0} 条启用</span></div>
        <div className="qc-summary-meta">
          <span className={'qc-badge src-' + (view?.source ?? 'default')}>{view ? sourceLabels[view.source] : '…'}</span>
          <span className="qc-ver">v{view?.pack.version ?? '—'}</span>
          {dirty && <span className="qc-badge src-cache">未保存</span>}
          {workItemUrl && <a href={workItemUrl} target="_blank" rel="noreferrer" title="在 Polarion 中打开配置工作项">PSB-RULES</a>}
        </div>
      </div>
      <p className="qc-lead">命中即在编辑器高亮；内置严格基线可停用或补充词表。0 命中只是下限筛查——判据充分性、场景完整性、上下游一致性用 AI 深度预审。</p>
      {pack && <>
        {sections.map(section => {
          const rules = pack.lintRules.filter(rule => (rule.category ?? 'custom') === section.key);
          if (!rules.length) return null;
          return <section className="qc-section" key={section.key}>
            <header className="qc-section-head"><i className="qc-dot" style={{ background: section.tone }}/><b>{section.label}</b>{section.hint && <small>{section.hint}</small>}</header>
            {rules.map(rule => <div className={'qc-row' + (rule.enabled ? '' : ' off')} key={rule.id}>
              <button type="button" role="switch" aria-checked={rule.enabled} aria-label={rule.title || typeLabels[rule.type]} className={'qc-switch' + (rule.enabled ? ' on' : '')} disabled={!!busy} onClick={() => patchRule(rule.id, { enabled: !rule.enabled })}><i/></button>
              <div className="qc-row-body">
                <div className="qc-row-title">
                  <i className={'qc-sev ' + rule.severity} title={rule.severity === 'warn' ? '警示' : '提示'}/>
                  <strong>{rule.title || typeLabels[rule.type]}</strong>
                  {(rule.type === 'fuzzy-word' || rule.type === 'anaphora') && <button type="button" className="qc-words" aria-label={`编辑${rule.title || typeLabels[rule.type]}词表`} aria-expanded={expanded === rule.id} onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}>{rule.wordsText === undefined ? rule.words.length : splitList(rule.wordsText).length} 词<ChevronDown size={12} className={expanded === rule.id ? 'open' : ''}/></button>}
                </div>
                {expanded !== rule.id && <small className="qc-row-desc">{rule.message}</small>}
                {expanded === rule.id && <div className="qc-edit">
                  <label>词表 <span>逗号或换行分隔</span><textarea rows={2} disabled={!!busy} value={rule.wordsText ?? rule.words.join('，')} onChange={event => patchRule(rule.id, { wordsText: event.target.value === rule.words.join('，') ? undefined : event.target.value })}/></label>
                  <label>提示语 <span>最多 200 字</span><textarea rows={1} maxLength={200} disabled={!!busy} value={rule.message} onChange={event => patchRule(rule.id, { message: event.target.value })}/></label>
                </div>}
              </div>
            </div>)}
          </section>;
        })}
        <section className="qc-section">
          <header className="qc-section-head"><i className="qc-dot" style={{ background: '#7d8f6b' }}/><b>术语表</b><small>别名命中提示替换为标准术语；勾「禁用」则标准词本身也违规</small></header>
          {pack.glossary.length === 0
            ? <p className="qc-empty">还没有术语。例：标准词「刹车助力」，别名「制动助力、BrakeBoost」。</p>
            : <div className="qc-terms">{pack.glossary.map((entry, index) => <div className="qc-term" key={index}>
                <label className="qc-term-name">标准术语<textarea rows={1} placeholder="标准术语" maxLength={80} disabled={!!busy} value={entry.term} onChange={event => patchTerm(index, { term: event.target.value })}/></label>
                <label className="qc-term-alias">别名，逗号或换行分隔<textarea rows={1} placeholder="别名" disabled={!!busy} value={entry.aliasesText ?? entry.aliases.join('，')} onChange={event => patchTerm(index, { aliasesText: event.target.value === entry.aliases.join('，') ? undefined : event.target.value })}/></label>
                <label className="qc-forbidden" title="标准词本身是禁用词"><input type="checkbox" disabled={!!busy} checked={entry.forbidden} onChange={event => patchTerm(index, { forbidden: event.target.checked })}/>禁用</label>
                <button type="button" className="qc-icon danger" aria-label={`删除术语 ${entry.term || index + 1}`} title="删除这条术语" disabled={!!busy} onClick={() => edit(current => ({ ...current, glossary: current.glossary.filter((_, i) => i !== index) }))}><Trash2 size={14}/></button>
              </div>)}</div>}
          <button type="button" className="qc-add" onClick={() => edit(current => ({ ...current, glossary: [...current.glossary, { term: '', aliases: [], forbidden: false }] }))} disabled={!!busy}><Plus size={13}/>新增术语</button>
        </section>
      </>}
    </div>
    <div className="qc-footer">
      {busy && <p className="qc-note" role="status">{busy}</p>}
      {message && <p className="qc-note" role={message.error ? 'alert' : 'status'} tabIndex={0}>{message.text}</p>}
      <div className="qc-actions">
        <button type="button" className="qc-text" disabled={!!busy} onClick={() => { if (!dirty || window.confirm('重新读取将替换本次未保存的修改，继续吗？')) void load(true, dirty); }}><RefreshCw size={13}/>重新读取</button>
        <button type="button" className="qc-text" disabled={!!busy || !pack} onClick={() => { if (!pack) return; const defaults = defaultRulePack(); setPack({ ...defaults, version: pack.version }); setMessage({ text: '已载入内置基线。保存到项目后生效。' }); }}><RotateCcw size={13}/>恢复内置基线</button>
        <button type="button" className="qc-text" disabled={!!busy || !dirty} onClick={() => { setPack(view?.pack ?? null); setMessage(null); }}>放弃修改</button>
        {onDeepCheck && <button type="button" className="qc-secondary" disabled={!!busy} onClick={() => { if (!dirty || window.confirm('进入 AI 深度预审会关闭设置并放弃未保存的规则修改，继续吗？')) onDeepCheck(); }} title="对当前文档整册做 AI 深度预审"><Sparkles size={13}/>AI 深度预审</button>}
        <button type="button" className="qc-primary" disabled={!!busy || !dirty} onClick={() => void save()}><Save size={13}/>{dirty || !view ? '保存到项目' : '已保存'}</button>
      </div>
    </div>
  </div>;
}
