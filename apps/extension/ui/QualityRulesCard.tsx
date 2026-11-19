import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { defaultRulePack, RulePackSchema, type LintRule, type RulePack } from '../../../packages/core/requirement-lint';
import type { Target } from '../../../packages/protocol/index';
import { announceRulePack } from '../lib/quality-lint';
import { rpc } from '../lib/client';
import type { RulesView } from '../../host/rules';
import './quality-rules.css';

/**
 * 质量规则中心 v3：设置页范式（摘要头 → 分段列表 → 固定底栏）。
 * 行内体检的依据；内置严格基线 + 项目词表/术语扩展，存 PSB-RULES 全项目共享。
 * 0 命中只是下限筛查——深度检查由「AI 深度预审」承担。
 */
const sourceLabels = { polarion: '项目规则包', cache: '本机缓存', default: '内置基线' } as const;
const typeLabels: Record<LintRule['type'], string> = { 'fuzzy-word': '模糊词表', anaphora: '指代词表', 'non-atomic': '多义务', 'no-criterion': '无判据', 'no-condition': '无触发条件', 'long-sentence': '单条过长' };
type Category = NonNullable<LintRule['category']> | 'custom';
const sections: { key: Category; label: string; hint: string; tone: string }[] = [
  { key: 'verifiability', label: '可验证性', hint: '每条义务都要能量化验证：时限、数量、状态值', tone: '#c98a2b' },
  { key: 'atomicity', label: '原子性', hint: '一条需求只说一个可验证行为，拆开才好评审和测试', tone: '#4f8c86' },
  { key: 'clarity', label: '明确性', hint: '指代展开、触发条件写全，下游建模才能对上', tone: '#6a74b8' },
  { key: 'custom', label: '项目自定义', hint: '团队补充与历史导入的规则', tone: '#9a9d92' },
];

export function QualityRulesCard({ target, onDeepCheck }: { target: Target; onDeepCheck?: () => void }) {
  const [view, setView] = useState<RulesView | null>(null);
  const [pack, setPack] = useState<RulePack | null>(null);
  const [savedPack, setSavedPack] = useState<RulePack | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'ok' | 'error'>('ok');
  const [expanded, setExpanded] = useState<string | null>(null);

  const say = (text: string, kind: 'ok' | 'error' = 'ok') => { setMessage(text); setTone(kind); };
  const load = async (refresh: boolean, keepEdits: boolean) => {
    setBusy(refresh ? '正在读取项目规则包…' : '正在加载…');
    try {
      const next = await rpc<RulesView>({ method: 'rules.get', target, refresh });
      setView(next); announceRulePack(target, next.pack);
      if (!keepEdits) { setPack(next.pack); setSavedPack(next.pack); }
      if (next.error) say(next.error, 'ok'); else setMessage('');
    } catch (e) { say((e as Error).message, 'error'); }
    finally { setBusy(''); }
  };
  useEffect(() => { void load(false, false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [target.projectId]);

  const dirty = useMemo(() => !!pack && !!savedPack && JSON.stringify(pack) !== JSON.stringify(savedPack), [pack, savedPack]);
  const save = async () => {
    if (!pack) return;
    setBusy('正在保存到项目（PSB-RULES）…');
    try {
      const parsed = RulePackSchema.parse({ ...pack, version: pack.version + 1 });
      const next = await rpc<RulesView>({ method: 'rules.save', target, pack: parsed, expectedUpdated: view?.remoteUpdated ?? null });
      setView(next); setPack(next.pack); setSavedPack(next.pack); announceRulePack(target, next.pack);
      say(`已保存 v${next.pack.version}，对全部项目成员生效。`);
    } catch (e) {
      const text = (e as Error).message;
      say(/RULES_CONFLICT/.test(text) ? '规则包刚被他人更新：请点「重新读取」后再改再存。' : text, 'error');
    } finally { setBusy(''); }
  };
  const toggleRule = (id: string) => setPack(current => current && { ...current, lintRules: current.lintRules.map(rule => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule) });
  const setRuleWords = (id: string, words: string) => setPack(current => current && { ...current, lintRules: current.lintRules.map(rule => rule.id === id ? { ...rule, words: words.split(/[,，、\n]/).map(word => word.trim()).filter(Boolean).slice(0, 200) } : rule) });
  const setRuleMessage = (id: string, text: string) => setPack(current => current && { ...current, lintRules: current.lintRules.map(rule => rule.id === id ? { ...rule, message: text.slice(0, 200) } : rule) });
  const setGlossary = (index: number, patch: Partial<RulePack['glossary'][number]>) => setPack(current => current && { ...current, glossary: current.glossary.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
  const removeGlossary = (index: number) => setPack(current => current && { ...current, glossary: current.glossary.filter((_, i) => i !== index) });
  const addGlossary = () => setPack(current => current && { ...current, glossary: [...current.glossary, { term: '', aliases: [], forbidden: false }] });
  const workItemUrl = view?.workItemId ? `${target.origin}/polarion#/project/${encodeURIComponent(target.projectId)}/workitem/${encodeURIComponent(view.workItemId)}` : '';

  const enabledCount = pack?.lintRules.filter(rule => rule.enabled).length ?? 0;
  const totalCount = pack?.lintRules.length ?? 0;
  const rulesOf = (key: Category) => (pack?.lintRules ?? []).filter(rule => key === 'custom' ? !rule.category : rule.category === key);

  return <div className="sp-card qc">
    {/* 摘要头：状态一眼看清，主操作在右 */}
    <div className="qc-summary">
      <span className="qc-shield"><ShieldCheck size={15}/></span>
      <div className="qc-summary-title">
        <strong>质量规则</strong>
        <small>行内体检的判定基线</small>
      </div>
      <div className="qc-summary-stat"><b>{enabledCount}</b><span>/{totalCount} 条生效</span></div>
      <div className="qc-summary-meta">
        <span className={'qc-badge src-' + (view?.source ?? 'default')}>{view ? sourceLabels[view.source] : '…'}</span>
        <span className="qc-ver">v{pack?.version ?? '—'}</span>
        {workItemUrl && <a href={workItemUrl} target="_blank" rel="noreferrer" title="在 Polarion 中打开配置工作项">PSB-RULES</a>}
      </div>
    </div>
    <p className="qc-lead">命中即在编辑器高亮；内置严格基线可停用或补充词表。0 命中只是下限筛查——判据充分性、场景完整性、上下游一致性用 AI 深度预审。</p>

    {busy && <p className="qc-note" role="status">{busy}</p>}
    {message && <p className={'qc-note ' + tone} role={tone === 'error' ? 'alert' : 'status'}>{message}</p>}

    {pack && <>
      {sections.map(section => {
        const rules = rulesOf(section.key);
        if (!rules.length) return null;
        return <section className="qc-section" key={section.key}>
          <header className="qc-section-head">
            <i className="qc-dot" style={{ background: section.tone }}/>
            <b>{section.label}</b>
            <small>{section.hint}</small>
          </header>
          <div className="qc-rows">
            {rules.map(rule => <div className={'qc-row' + (rule.enabled ? '' : ' off')} key={rule.id}>
              <button type="button" role="switch" aria-checked={rule.enabled} aria-label={`${rule.title || typeLabels[rule.type]}：${rule.enabled ? '已启用，点击停用' : '已停用，点击启用'}`} className={'qc-switch' + (rule.enabled ? ' on' : '')} disabled={!!busy} onClick={() => toggleRule(rule.id)}><i/></button>
              <div className="qc-row-body">
                <div className="qc-row-title">
                  <i className={'qc-sev ' + rule.severity} title={rule.severity === 'warn' ? '警示' : '提示'}/>
                  <strong>{rule.title || typeLabels[rule.type]}</strong>
                  {(rule.type === 'fuzzy-word' || rule.type === 'anaphora') && <button type="button" className="qc-words" aria-expanded={expanded === rule.id} onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}>{rule.words.length} 词<ChevronDown size={11} className={expanded === rule.id ? 'open' : ''}/></button>}
                </div>
                <small className="qc-row-desc">{rule.message}</small>
                {expanded === rule.id && (rule.type === 'fuzzy-word' || rule.type === 'anaphora') && <div className="qc-edit">
                  <label>词表 <span>逗号或换行分隔，命中即高亮</span><textarea rows={3} defaultValue={rule.words.join('，')} key={rule.id + ':' + rule.words.join(',')} onBlur={event => setRuleWords(rule.id, event.target.value)}/></label>
                  <label>提示语 <input defaultValue={rule.message} key={rule.id + ':m:' + rule.message} onBlur={event => setRuleMessage(rule.id, event.target.value)}/></label>
                </div>}
              </div>
            </div>)}
          </div>
        </section>;
      })}

      <section className="qc-section">
        <header className="qc-section-head">
          <i className="qc-dot" style={{ background: '#7d8f6b' }}/>
          <b>术语表</b>
          <small>别名命中提示替换为标准术语；勾「禁用」则标准词本身也违规</small>
        </header>
        {pack.glossary.length === 0
          ? <p className="qc-empty">还没有术语。例：标准词「刹车助力」，别名「制动助力、BrakeBoost」。</p>
          : <div className="qc-terms">
              {pack.glossary.map((entry, index) => <div className="qc-term" key={index}>
                <input className="qc-term-name" aria-label="标准术语" placeholder="标准术语" maxLength={80} defaultValue={entry.term} key={index + ':t:' + entry.term} onBlur={event => setGlossary(index, { term: event.target.value.trim() })}/>
                <span className="qc-arrow">←</span>
                <input className="qc-term-alias" aria-label="别名，逗号分隔" placeholder="别名，逗号分隔" defaultValue={entry.aliases.join('，')} key={index + ':a:' + entry.aliases.join(',')} onBlur={event => setGlossary(index, { aliases: event.target.value.split(/[,，、]/).map(alias => alias.trim()).filter(Boolean) })}/>
                <label className="qc-forbidden" title="标准词本身是禁用词"><input type="checkbox" checked={entry.forbidden} onChange={event => setGlossary(index, { forbidden: event.target.checked })}/>禁用</label>
                <button type="button" className="qc-icon danger" title="删除这条术语" onClick={() => removeGlossary(index)}><Trash2 size={13}/></button>
              </div>)}
            </div>}
        <button type="button" className="qc-add" onClick={addGlossary} disabled={!!busy}><Plus size={12}/>新增术语</button>
      </section>
    </>}

    {/* 固定底栏：次要动作为文字按钮，主按钮单独在右 */}
    <div className="qc-footer">
      <button type="button" className="qc-text" disabled={!!busy} onClick={() => void load(true, false)}><RefreshCw size={12}/>重新读取</button>
      <button type="button" className="qc-text" disabled={!!busy} onClick={() => { if (!pack) return; const defaults = defaultRulePack(); setPack({ ...defaults, version: pack.version }); announceRulePack(target, defaults); say('本页已恢复内置基线 v2；点「保存到项目」后对成员生效。'); }}><RotateCcw size={12}/>恢复内置基线</button>
      <button type="button" className="qc-text" disabled={!!busy || !dirty} onClick={() => { if (savedPack) announceRulePack(target, savedPack); setPack(savedPack); setMessage(''); }}>放弃修改</button>
      <span className="qc-spacer"/>
      {onDeepCheck && <button type="button" className="qc-secondary" disabled={!!busy} onClick={onDeepCheck} title="对当前文档整册做 AI 深度预审"><Sparkles size={12}/>AI 深度预审</button>}
      <button type="button" className="qc-primary" disabled={!!busy || !dirty} onClick={() => void save()}><Save size={12}/>{dirty ? '保存到项目' : '已保存'}</button>
    </div>
  </div>;
}
