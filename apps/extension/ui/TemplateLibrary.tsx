import React, {useCallback, useEffect, useState} from 'react';
import {BookOpen, FilePlus2, FileStack, RotateCcw} from 'lucide-react';
import {rpc} from '../lib/client';
import type {Target} from '../../../packages/protocol/index.ts';
import {SettingsSchema} from '../../../packages/protocol/index.ts';
type AssistantSettings = ReturnType<typeof SettingsSchema.parse>;
import './template-library.css';

/** Host 错误码转可读文案。 */
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
type TemplateView = { id: string; title: string; category: string; origin: 'builtin' | 'custom'; html: string };

/** 设置 → 需求模板库：模板=Polarion 真实工作项（library 项目「需求模板库」文档）。
 * 「打开/再编辑」直接以普通工作项打开（同一套编辑工作台与保存链路）。 */
export function TemplateLibrary({target, config, onConfig, hidden, onOpenTemplate}: {
  target: Target;
  config: AssistantSettings | null;
  onConfig: (next: AssistantSettings) => void;
  hidden: boolean;
  onOpenTemplate: (template: TemplateView) => void;
}) {
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const refresh = useCallback(async () => {
    try { const result = await rpc<{items: TemplateView[]; ensureErrors?: string[]}>({method: 'templates.list', target}); setTemplates(result.items); if (result.ensureErrors?.length) setError('模板安装：' + result.ensureErrors.join('；')); }
    catch (loadError) { setError(errorText(loadError)); }
  }, [target]);
  useEffect(() => { void refresh(); }, [refresh]);

  const reset = async (item: TemplateView) => {
    if (!window.confirm(`恢复「${item.title}」为软件内置标准版？当前编辑内容将被覆盖。`)) return;
    setBusyId(item.id); setError('');
    try { await rpc({method: 'templates.reset', target, templateId: item.id}); await refresh(); }
    catch (resetError) { setError(errorText(resetError)); } finally { setBusyId(''); }
  };
  const create = async () => {
    if (!newTitle.trim() || !newCategory.trim()) return;
    setCreating(true); setError('');
    try {
      const skeleton = '<h3>1. 功能描述</h3><p><em>说明本功能的用户价值与控制行为。</em></p>'
        + '<h3>2. 输入接口表</h3><p><em>触发与约束本功能的输入信号。</em></p>'
        + '<h3>3. 输出接口表</h3><p><em>本功能产出的输出信号。</em></p>'
        + '<h3>4. 标定量表</h3><p><em>本功能用到的全部标定量。</em></p>';
      const result = await rpc<{ workItemId: string }>({method: 'templates.createCustom', target, title: newTitle.trim(), category: newCategory.trim(), html: skeleton});
      setNewTitle(''); setNewCategory(''); setCreating(false);
      await refresh();
      const created = (await rpc<TemplateView[]>({method: 'templates.list', target})).find(item => item.id === result.workItemId);
      if (created) onOpenTemplate(created);
    } catch (createError) { setError(errorText(createError)); setCreating(false); }
  };

  const toggle = config?.useRequirementTemplates ?? false;
  const groups = [...new Set((templates ?? []).map(item => item.category))].map(category => ({
    category, items: (templates ?? []).filter(item => item.category === category),
  }));
  return <div hidden={hidden}>
    <div className="sp-card sp-guide-card">
      <div className="sp-card-head"><span className="sp-icon"><FileStack size={14}/></span><div><h4>需求模板库</h4><p>模板是 Polarion 里的真实工作项（存放于 library 项目「需求模板库」文档，所有项目通用）。「打开」用与正常工作项完全相同的编辑工作台与保存链路；插入时以副本写入，模板原件不会被改动。</p></div></div>
      <div className="tpl-switch-row">
        <div><strong>参考模板</strong><small>开启后，AI 新建工作项或改造已有需求时自动按匹配类别的模板组织正文。</small></div>
        <button type="button" role="switch" aria-checked={toggle} className={'tpl-pill' + (toggle ? ' on' : '')} onClick={() => { if (config) onConfig({...config, useRequirementTemplates: !toggle}); }}>
          {toggle ? '已开启' : '已关闭'}
        </button>
      </div>
      <p className="tpl-note">开关随下方「保存全部设置」一起生效。</p>
      {!!error && <p className="inline-error" role="alert">{error}</p>}
      {!templates && !error && <p className="sp-empty">正在读取模板库…</p>}
      {templates && <>
        {groups.map(group => <div key={group.category}>
          <p className="tpl-group-title">{group.category}</p>
          {group.items.map(item => <div className="tpl-card" key={item.id}>
            <div className="tpl-card-head">
              <strong>{item.title}</strong>
              <span className={`tpl-badge ${item.origin === 'custom' ? 'custom' : 'builtin'}`}>{item.origin === 'custom' ? '自定义' : '内置'}</span>
            </div>
            <div className="tpl-actions">
              <button type="button" onClick={() => onOpenTemplate(item)}><BookOpen size={12}/>打开编辑</button>
              {item.origin === 'builtin' && <button type="button" className="danger" disabled={busyId === item.id} onClick={() => void reset(item)}><RotateCcw size={12}/>恢复标准</button>}
            </div>
          </div>)}
        </div>)}
        <p className="tpl-group-title">新建模板（= 在模板库里新建一个工作项）</p>
        <div className="tpl-actions" style={{gap: 8, flexWrap: 'wrap'}}>
          <input maxLength={80} placeholder="模板名称（如：诊断类需求模板）" value={newTitle} onChange={event => setNewTitle(event.target.value)} style={{border: '1px solid var(--line,#d8e0da)', borderRadius: 7, padding: '6px 8px', fontSize: 12, minWidth: 200}} />
          <input maxLength={20} placeholder="类别（如：诊断类）" value={newCategory} onChange={event => setNewCategory(event.target.value)} style={{border: '1px solid var(--line,#d8e0da)', borderRadius: 7, padding: '6px 8px', fontSize: 12, width: 130}} />
          <button type="button" className="tpl-add" style={{width: 'auto'}} disabled={creating || !newTitle.trim() || !newCategory.trim()} onClick={() => void create()}><FilePlus2 size={14}/>{creating ? '创建中…' : '创建并编辑'}</button>
        </div>
      </>}
    </div>
  </div>;
}
