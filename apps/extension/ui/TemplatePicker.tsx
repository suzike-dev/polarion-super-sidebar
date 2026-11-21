import React, {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {rpc} from '../lib/client';
import {browser} from 'wxt/browser';
import type {Target} from '../../../packages/protocol/index.ts';
type TemplateView = { id: string; title: string; category: string; origin: 'builtin' | 'custom'; html: string };
import {templateCategories as builtinCategories} from '../../../packages/core/requirement-templates.ts';
import './template-library.css';

/** Host 错误码 → 用户可读文案（插入失败时在浮窗内显示）。 */
function reasonText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('TEMPLATE_APPLY_TARGET_NOT_EMPTY')) return '目标工作项正文不是空白：插入模板会覆盖已有内容，已拒绝。请选择空白条目，或先在原生页面清空该条目。';
  if (raw.includes('WORK_ITEM_NOT_FOUND_OR_INACCESSIBLE')) return '目标工作项读不到：请确认该条目已保存（未保存的条目没有正式编号），且你有访问权限。';
  if (raw.includes('WORK_ITEM_DOCUMENT_MISMATCH')) return '目标工作项不属于当前文档：请在该条目所在文档页操作。';
  if (raw.includes('TEMPLATE_NOT_FOUND')) return '模板读不到：请在设置→模板库确认该模板存在。';
  if (raw.includes('NATIVE_EDITOR_DIRTY')) return '原生编辑器里有未保存的输入：请先在原生页面保存，再插入模板。';
  if (raw.includes('HOST_CONNECTION_LOST')) return raw;
  return raw;
}

/** 模板写入浮窗（只保留「插入到已有工作项」）：
 *  流程：① 原生新建工作项 → ② 原生保存（获得正式编号）→ ③ 选模板插入（内容立即写入并显示）。
 *  位置与目标条目均来自光标自动识别；未识别时可手填。 */
export function TemplatePicker({target, workItemId, onClose, onApplied, onNotify}: {
  target: Target;
  workItemId?: string;
  onClose: () => void;
  onApplied: (result: { workItemId: string; html: string; title: string }) => void;
  onNotify: (message: string, kind?: 'error') => void;
}) {
  const [targetId, setTargetId] = useState(workItemId ?? '');
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    let live = true;
    rpc<{ items: TemplateView[]; ensureErrors?: string[] } | TemplateView[]>({method: 'templates.list', target})
      .then(result => {
        if (!live) return;
        const list = Array.isArray(result) ? result : (result?.items ?? []);
        setTemplates(list);
        if (!Array.isArray(result) && result?.ensureErrors?.length) onNotify('模板安装提示：' + result.ensureErrors.join('；'), 'error');
      })
      .catch(error => { if (live) setTemplates([]); onNotify(String(error), 'error'); });
    return () => { live = false; };
  }, []);
  const blocked = !picked || busy || !targetId.trim();
  const blockedReason = busy ? '正在执行…' : !targetId.trim() ? '请先把光标放到已保存的工作项内（或手动填入条目标 ID）' : '请先在下方选择一个模板';
  const insert = async () => {
    if (blocked) { setIssue(blockedReason); return; }
    const id = targetId.trim().toUpperCase();
    setBusy(true); setIssue(''); setStatus('正在检查原生编辑器状态…');
    try {
      // 原生编辑器有未保存输入时不写入（避免与用户输入冲突）。
      const check = await browser.runtime.sendMessage({type: 'native-workitem-refresh', workItemId: id, phase: 'check'});
      if (check && !check.ok && (check.error === 'NATIVE_EDITOR_DIRTY' || check.error === 'NATIVE_EDITOR_UNKNOWN')) {
        setIssue('原生编辑器里有未保存的输入：请先在原生页面保存该工作项，再插入模板。');
        setBusy(false); setStatus('');
        return;
      }
      setStatus('正在写入模板正文…');
      const result = await rpc<{ workItemId: string; html: string; title: string }>({method: 'templates.apply', target, workItemId: id, templateId: picked});
      setStatus('已写入，正在同步原生页面…');
      onApplied(result);
      onClose();
    } catch (error) {
      setIssue(reasonText(error));
      onNotify(`插入模板失败：${reasonText(error)}`, 'error');
      setBusy(false); setStatus('');
    }
  };
  const categoryOf = (key: string) => builtinCategories.find(category => category.key === key)?.label ?? key;
  const groups = [...new Set((templates ?? []).map(item => item.category))].map(key => ({
    key,
    label: categoryOf(key),
    hint: builtinCategories.find(category => category.key === key)?.hint ?? '',
    items: (templates ?? []).filter(item => item.category === key),
  }));
  const ready = !!targetId.trim();
  return <div className="tpl-layer" role="dialog" aria-label="插入模板" onKeyDown={event => { if (event.key === 'Escape') {event.stopPropagation(); onClose();} }}>
    <div className="tpl-dialog" style={{height: 'min(640px, calc(100vh - 90px))'}}>
      <header className="tpl-dialog-head"><strong>插入模板到已有工作项</strong><small>模板正文写入该工作项（要求正文空白），写入后立即在原生页面显示</small><span style={{flex: 1}} /><button type="button" className="icon" title="关闭" onClick={onClose}><X size={15}/></button></header>
      <div className="tpl-dialog-body">
        {/* 三步流程：当前步高亮、已完成打勾 */}
        <div className="tpl-flow" aria-label="操作流程">
          <div className={'tpl-flow-step' + (ready ? ' done' : ' current')}>
            <span className="tpl-flow-num">{ready ? '✓' : '1'}</span>
            <div><strong>新建工作项</strong><small>在文档光标处用原生方式新建空条目</small></div>
          </div>
          <span className="tpl-flow-arrow">→</span>
          <div className={'tpl-flow-step' + (ready ? ' done' : '')}>
            <span className="tpl-flow-num">{ready ? '✓' : '2'}</span>
            <div><strong>保存工作项</strong><small>按原生 Save，获得正式编号</small></div>
          </div>
          <span className="tpl-flow-arrow">→</span>
          <div className={'tpl-flow-step' + (ready ? ' current' : '')}>
            <span className="tpl-flow-num">3</span>
            <div><strong>插入模板内容</strong><small>选模板后点「插入模板」，内容立即生效</small></div>
          </div>
        </div>
        {ready
          ? <div className="tpl-picker-title-row"><span className="tpl-note" style={{flex: 1}}>位置：光标所在工作项 <strong>{targetId.trim().toUpperCase()}</strong>（自动识别；如需更换可直接改）</span><input style={{width: 120}} maxLength={100} value={targetId} onChange={event => setTargetId(event.target.value)} /></div>
          : <div className="tpl-picker-title-row"><span className="tpl-note" style={{flex: 1, color: '#b45309'}}>⚠ 未识别到工作项：请先把光标放到已保存的工作项内再打开此窗口，或在此输入条目标 ID。</span><input style={{width: 140}} maxLength={100} placeholder="条目标 ID" value={targetId} onChange={event => setTargetId(event.target.value)} /></div>}
        <div className="tpl-picker-body">
          {groups.map(group => <React.Fragment key={group.key}>
            <p className="tpl-group-title">{group.label}<small title={group.hint}>{group.hint}</small></p>
            {group.items.map(item => <button type="button" key={item.id} className={'tpl-card' + (picked === item.id ? ' picked' : '')} onClick={() => setPicked(item.id)}>
              <div className="tpl-card-head"><strong>{item.title}</strong>{item.origin === 'custom' && <span className="tpl-badge custom">自定义</span>}</div>
              <p className="usage">{item.html ? item.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) + '…' : group.hint}</p>
            </button>)}
          </React.Fragment>)}
          {templates === null && <p className="tpl-note">正在读取模板库…</p>}
          {templates !== null && groups.every(group => group.items.length === 0) && <p className="tpl-note">模板库为空：请在设置→模板库确认 5 个内置模板已安装。</p>}
        </div>
      </div>
      {(issue || status) && <div style={{padding: '8px 16px', borderTop: '1px solid var(--ui-line,#e2e8f0)'}}>
        {issue ? <p className="inline-error" role="alert" style={{margin: 0}}>{issue}</p> : <p className="tpl-note" style={{margin: 0}}>{status}</p>}
      </div>}
      <footer className="tpl-dialog-foot">
        <span className="tpl-note" style={{flex: 1, textAlign: 'left'}}>{blocked && !busy ? blockedReason : ''}</span>
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" className="primary" disabled={blocked} title={blocked ? blockedReason : ''} onClick={() => void insert()}>{busy ? '正在插入…' : '插入模板'}</button>
      </footer>
    </div>
  </div>;
}
