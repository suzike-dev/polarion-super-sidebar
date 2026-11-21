import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Boxes, ChevronDown, Search, X } from 'lucide-react';
import { emptyModelNote, type ModelNote, type ModelRootsView, type Target } from '../../../packages/protocol/index';
import { rpc } from '../lib/client';
import { listenWorkbenchKeydown } from '../lib/workbench-keyboard';

const errorText = (e: unknown) => (e as Error).message ?? String(e);

type Props = { target: Target; workItemId: string; onError?: (message: string) => void; dense?: boolean; toolbar?: boolean };
export function ModuleNotePanel(props: Props) {
  return <ItemModules key={`${props.target.origin}/${props.target.projectId}/${props.workItemId}`} {...props} />;
}

function ItemModules({ target, workItemId, onError, dense = false, toolbar = false }: Props) {
  const [rootsView, setRootsView] = useState<ModelRootsView | null>(null);
  const [note, setNote] = useState<ModelNote>(emptyModelNote());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<ModelNote>(emptyModelNote);
  const [issue, setIssue] = useState('');
  const [badge, setBadge] = useState<ModelNote | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const fail = (message: string) => { setIssue(message); onError?.(message); };
  const shouldLoad = !toolbar || open;
  // 工具栏模式挂载即读备注：图标上的绑定徽标让“该需求属于哪个模块”一眼可见，不必展开浮层。
  useEffect(() => {
    if (!toolbar) return;
    let cancelled = false;
    void rpc<ModelNote>({ method: 'model.note.read', target, workItemId })
      .then(value => { if (!cancelled) setBadge(value); })
      .catch(() => { if (!cancelled) setBadge(emptyModelNote()); });
    return () => { cancelled = true; };
  }, [toolbar, target.projectId, target.origin, workItemId]);
  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    void (async () => {
      try {
        const [roots, current] = await Promise.all([rpc<ModelRootsView>({ method: 'model.roots.forNote', target }), rpc<ModelNote>({ method: 'model.note.read', target, workItemId })]);
        if (!cancelled) { setRootsView(roots); setNote(current); setSaved(current); setBadge(current); setLoaded(true); }
      } catch (error) { if (!cancelled) { setRootsView(null); setLoaded(true); fail('模型备注读取失败：' + errorText(error)); } }
    })();
    return () => { cancelled = true; };
  }, [shouldLoad, target.projectId, workItemId]);
  useEffect(() => {
    if (!toolbar || !open) return;
    const outside = (event: PointerEvent) => {
      if (!saving && anchor.current && !event.composedPath().includes(anchor.current)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (!saving) { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside, true);
    const removeKey = listenWorkbenchKeydown(document, escape);
    return () => { document.removeEventListener('pointerdown', outside, true); removeKey(); };
  }, [toolbar, open, saving]);
  const togglePanel = () => {
    setNote(saved); setIssue(''); setSearch('');
    if (toolbar && !open) setLoaded(false);
    setOpen(!open);
  };
  const closePanel = () => { setOpen(false); trigger.current?.focus(); };
  const roots = rootsView?.roots ?? [];
  const moduleLabel = (rootId: string, key: string) => roots.find(r => r.id === rootId)?.modules.find(m => m.key === key)?.name ?? key;
  const chips = note.marks.flatMap(mark => mark.modules.map(key => ({ rootId: mark.rootId, key, label: moduleLabel(mark.rootId, key), rootLabel: roots.find(r => r.id === mark.rootId)?.label })));
  // 徽标始终有：没加载到模块名时退回 key，保证工作台里一眼看出该需求绑定了几个模块。
  const badgeChips = (loaded && rootsView ? saved : badge)?.marks.flatMap(mark => mark.modules.map(key => ({ key, label: moduleLabel(mark.rootId, key) }))) ?? [];
  const toggle = (rootId: string, key: string) => setNote(current => {
    const mark = current.marks.find(m => m.rootId === rootId);
    if (!mark) return { ...current, marks: [...current.marks, { rootId, modules: [key] }] };
    const modules = mark.modules.includes(key) ? mark.modules.filter(m => m !== key) : [...mark.modules, key];
    return { ...current, marks: current.marks.map(m => m.rootId === rootId ? { ...m, modules } : m).filter(m => m.modules.length) };
  });
  const save = async (value: ModelNote) => {
    setSaving(true); setIssue('');
    try {
      const result = await rpc<{ verified: boolean }>({ method: 'model.note.write', target, workItemId, note: value });
      if (!result.verified) throw Error('附件回读未通过');
      setNote(value); setSaved(value); setBadge(value); closePanel();
    }
    catch (error) { fail('模型备注保存失败：' + errorText(error)); }
    finally { setSaving(false); }
  };
  const groups = useMemo(() => roots.map(root => ({ root, modules: root.modules.filter(m => !m.excluded && (!search.trim() || `${m.name} ${m.key}`.toLowerCase().includes(search.trim().toLowerCase()))) })), [roots, search]);
  if (!toolbar && !loaded) return dense ? null : <div className="module-note loading">正在读取模型关联…</div>;
  if (!toolbar && !roots.length) return issue ? <div className="module-note inline-error" role="alert">{issue}</div> : null;
  return <div ref={anchor} className={toolbar ? 'module-note-anchor' : 'module-note' + (dense ? ' dense' : '')}>
    {toolbar ? <button ref={trigger} type="button" className="icon module-note-toggle" title={badgeChips.length ? `实现模块：${badgeChips.map(chip => chip.label).join('、')}` : '实现模块（未标注）'} aria-label={badgeChips.length ? `实现模块：${badgeChips.map(chip => chip.label).join('、')}` : '实现模块（未标注）'} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} aria-expanded={open} disabled={saving} onClick={togglePanel}><Boxes size={16}/>{badgeChips.length > 0 && <span className="module-note-badge" aria-hidden="true">{badgeChips.length}</span>}</button> : <div className="module-note-row">
      <span className="module-note-label"><Boxes size={13}/>实现模块</span>
      {chips.length ? <span className="module-note-chips">{chips.map(chip => <span key={chip.rootId + ':' + chip.key} className="module-note-chip" title={`${chip.rootLabel ?? ''} · ${chip.key}`}>{chip.label}</span>)}</span> : <span className="module-note-empty">未标注（该需求未关联模型模块）</span>}
      <button ref={trigger} type="button" className="secondary module-note-edit" aria-expanded={open} disabled={saving} onClick={togglePanel}>{open ? <><ChevronDown size={13}/>取消</> : chips.length ? '修改' : '标注'}</button>
    </div>}
    {open && <div id={panelId} className="module-note-panel" role="dialog" aria-label="标注实现模块">
      {toolbar && <div className="module-note-title"><strong>实现模块</strong><span>{workItemId}</span><button className="icon" aria-label="关闭实现模块" disabled={saving} onClick={closePanel}><X size={15}/></button></div>}
      {!loaded && <p role="status">正在读取模型关联…</p>}
      {loaded && !issue && !roots.length && <p>请先在「模型关联与追溯」中绑定项目模型目录，或维护平台模块目录。</p>}
      {issue && <p className="inline-error" role="alert">{issue}</p>}
      {loaded && roots.length > 0 && <>
        <div className="module-note-search"><Search size={13}/><input aria-label="搜索模块" placeholder="搜索模块名…" value={search} onChange={event => setSearch(event.target.value)} autoFocus={toolbar} /></div>
        <div className="module-note-groups">
          {groups.map(({ root, modules }) => modules.length > 0 && <div key={root.id} className="module-note-group">
            <strong title={root.path}>{root.label}</strong>
            <div className="module-note-options">
              {modules.map(module => {
                const checked = note.marks.some(mark => mark.rootId === root.id && mark.modules.includes(module.key));
                return <button type="button" key={module.key} role="checkbox" aria-checked={checked} disabled={saving} onClick={() => toggle(root.id, module.key)} title={`${module.key}${module.dictionary ? ` · 字典 ${module.dictionary}` : ''}${module.interface ? ` · 接口表 ${module.interface}` : ''}`}>
                  <span className="module-check" aria-hidden="true">{checked ? '✓' : ''}</span>{module.name}{module.kind !== 'module' && <small>{module.kind}</small>}
                </button>;
              })}
            </div>
          </div>)}
          {groups.every(group => !group.modules.length) && <p>{search.trim() ? '没有匹配的模块' : '项目中暂无可选模块'}</p>}
        </div>
        <div className="module-note-actions">
          <span>已选 {chips.length} 个模块</span>
          <button type="button" className="secondary" disabled={saving || !chips.length} onClick={() => setNote(emptyModelNote())}>清除选择</button>
          <button type="button" className="primary" disabled={saving} onClick={() => void save(note)}>{saving ? '保存中…' : '保存备注'}</button>
        </div>
      </>}
    </div>}
  </div>;
}
