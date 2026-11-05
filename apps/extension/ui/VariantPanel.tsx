import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, Check, GitBranch, Info, Link2, Pencil, Plus, RefreshCw, Unlink, X} from 'lucide-react';
import type {Draft, Target, Variant, VariantDetails} from '../../../packages/protocol/index';
import type {SourceNode} from '../../../packages/core/lossless-html';
import {rpc} from '../lib/client';
import './variants.css';

type DraftView = Draft & {nodes: SourceNode[]; version: string};
type DraftState = 'none' | 'clean' | 'dirty' | 'conflict' | 'uncertain';
type VariantRow = Variant & {draftState: DraftState};
type DefaultVariantRow = {workItemId: string; label: string; title: string; draftState: DraftState; details?: VariantDetails};
type ListResult = {variants: VariantRow[]; defaultVariant?: DefaultVariantRow | null; mainTitle?: string; activeVariantId?: string; diverged?: boolean; warning?: string; role?: string; lastApply?: {applyId: string; variantWorkItemId: string} | null};
type PreviewResult = {variant: Variant; mainHtml: string; variantHtml: string; mainUpdated: string; variantUpdated: string; changed: boolean; warnings: string[]};
type ApplyResult = {draft: DraftView; apply: {id: string}; variant: Variant; defaultVariant?: Variant};
type DetailsState = VariantDetails & {variantId: string; isDefault: boolean};
type Props = {
  draft: DraftView;
  beforeApply: () => Promise<void>;
  prepareNativeSave: () => Promise<'clean' | 'dirty' | 'unknown'>;
  onOpenVariant: (workItemId: string) => void;
  onChanged: (saved: DraftView, notice: string) => Promise<void>;
  onError: (error: unknown) => void;
  onClearError: () => void;
  onClose: () => void;
};

const stateLabel: Record<DraftState, string> = {none: '未打开', clean: '已同步', dirty: '有未保存修改', conflict: '待合并', uncertain: '待核对'};
const friendly: Record<string, string> = {
  VARIANT_DRAFT_DIRTY: '变体还有未保存的本地修改，请先打开变体并保存。',
  MAIN_DRAFT_DIRTY: '主工作项还有未保存的本地修改，请先保存或放弃后再接入变体。',
  MAIN_CHANGED_SINCE_DRAFT: '主工作项在打开后已被其他位置修改，请先核对服务端。',
  VARIANT_BOARD_UNSUPPORTED: '变体正文含画板，当前版本暂不支持跨工作项接入。',
  VARIANT_BOARD_COPY_FAILED: '画板快照复制失败，主工作项/变体未被修改；请检查画板源文件是否完整。',
  VARIANT_IMAGE_COPY_FAILED: '变体图片无法复制到主工作项，请先移除或替换相关图片。',
  VARIANT_LINK_REQUIRED: '变体与主工作项的关联尚未建立，请先重试关联。',
  VARIANT_LINK_ROLE_INVALID: '配置的链接角色在项目中不可用，请重新选择。',
  VARIANT_LINK_ROLE_REQUIRED: '项目没有可用的工作项链接角色，无法建立变体归属。',
  VARIANT_TYPE_REQUIRED: '主工作项缺少类型，无法创建同类型变体。',
  VARIANT_BACKEND_UNAVAILABLE: '本地 Host 未提供变体写入能力，请重新加载扩展或更新 Host。',
  VARIANT_DEFAULT_CAPTURE_FAILED: '首次接入需要先把主工作项正文保存为「默认」变体，但保存失败；主工作项未被改动。',
  VARIANT_DEFAULT_CAPTURE_BOARD: '主工作项正文含画板，无法安全捕获为默认变体；请先移除画板或手动处理。',
  VARIANT_TARGET_MISMATCH: '变体不属于当前文档，请重新同步变体列表。',
  WORK_ITEM_CREATE_FAILED: '变体工作项创建失败，请检查项目权限与必填字段。',
  NATIVE_EDITOR_DIRTY: '主页面原生编辑器有未保存输入，请先保存或撤销后再接入。',
  NATIVE_EDITOR_UNKNOWN: '无法确认主页面原生编辑状态，请先刷新文档再接入。',
  NATIVE_ITEM_NOT_LOADED: '主页面当前显示的不是这个工作项，请先回到主工作项再接入。',
  NATIVE_DOCUMENT_CHANGED: '主页面文档在接入期间发生了变化，请刷新后重试。',
  NATIVE_REFRESH_FAILED: '主页面正文刷新失败，请手动刷新文档核对。',
  NATIVE_REFRESH_UNSUPPORTED: '当前 Polarion 版本不支持自动刷新，请手动刷新文档核对。',
};
const messageOf = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  return friendly[code] ?? code;
};
const textOf = (html: string) => {
  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('script,style').forEach(node => node.remove());
    return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
};

export function VariantPanel({draft, beforeApply, prepareNativeSave, onOpenVariant, onChanged, onError, onClearError, onClose}: Props) {
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [defaultRow, setDefaultRow] = useState<DefaultVariantRow | null>(null);
  const [diverged, setDiverged] = useState(false);
  const [mainTitle, setMainTitle] = useState(draft.title);
  const [activeVariantId, setActiveVariantId] = useState<string | undefined>();
  const [role, setRole] = useState('');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [title, setTitle] = useState('');
  const [copy, setCopy] = useState(true);
  const [roleOptions, setRoleOptions] = useState<{id: string; name?: string}[]>([]);
  const [createRole, setCreateRole] = useState('');
  const [details, setDetails] = useState<DetailsState | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [renaming, setRenaming] = useState<{id: string; value: string} | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [lastApply, setLastApply] = useState<{applyId: string; variantWorkItemId: string} | null>(null);
  const request = useRef(0);
  const target: Target = draft.target;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onClearErrorRef = useRef(onClearError); onClearErrorRef.current = onClearError;

  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    setLoading(true);
    try {
      const value = await rpc<ListResult>({method: 'variants.list', target, mainWorkItemId: draft.workItemId});
      if (ticket !== request.current) return;
      setRows(value.variants); setDefaultRow(value.defaultVariant ?? null); setDiverged(!!value.diverged); setMainTitle(value.mainTitle || draft.title); setActiveVariantId(value.activeVariantId); setWarning(value.warning ?? ''); setRole(value.role ?? ''); setLastApply(value.lastApply ?? null); setError(''); onClearErrorRef.current();
    } catch (e) {
      if (ticket === request.current) { setError(messageOf(e)); onErrorRef.current(e); }
    } finally { if (ticket === request.current) setLoading(false); }
  }, [draft.workItemId, draft.title, target.projectId, target.document]);
  useEffect(() => { void refresh(); }, [refresh]);
  // 新建时给链接角色一个可选项；项目角色受限时不会卡在首次创建。
  useEffect(() => {
    if (!creating) return;
    let disposed = false;
    void rpc<{id: string; name?: string; hidden?: boolean}[]>({method: 'variants.roles', target}).then(options => {
      if (disposed) return;
      const visible = options.filter(option => option.id && !option.hidden).map(option => ({id: option.id, name: option.name}));
      setRoleOptions(visible);
      const preferred = visible.find(option => option.id === 'parent') ?? visible.find(option => option.id === 'relates_to') ?? visible[0];
      setCreateRole(current => current || role || preferred?.id || '');
    }).catch(() => { /* 角色清单不可用时由 Host 自动选择。 */ });
    return () => { disposed = true; };
  }, [creating, target.projectId, target.document]);

  const create = async () => {
    if (busy) return;
    if (!label.trim()) { setError('请填写变体名称，例如：客户甲 / 高配车型 / 项目 A。'); return; }
    setBusy(true); setError('');
    try {
      await beforeApply();
      const value = await rpc<{variant: Variant; draft: DraftView | null; warning?: string}>({
        method: 'variants.create', target, mainWorkItemId: draft.workItemId,
        label: label.trim(), title: title.trim(), copy, role: createRole || role,
      });
      setCreating(false); setLabel(''); setTitle(''); onClearError();
      if (value.variant.linkState !== 'linked') { setWarning(value.warning ?? '变体已创建，关联尚未确认。'); await refresh(); return; }
      if (value.warning) { setWarning(value.warning); await refresh(); return; }
      onOpenVariant(value.variant.workItemId);
    } catch (e) { setError(messageOf(e)); onError(e); } finally { setBusy(false); }
  };
  const relink = async (variant: VariantRow) => {
    setBusy(true); setError('');
    try { await rpc({method: 'variants.link', variantId: variant.id}); await refresh(); }
    catch (e) { setError(messageOf(e)); onError(e); } finally { setBusy(false); }
  };
  const rename = async (variant: VariantRow) => {
    const value = renaming?.value.trim() ?? '';
    if (!value) { setError('变体名称不能为空。'); return; }
    setBusy(true); setError('');
    try { await rpc({method: 'variants.rename', variantId: variant.id, label: value}); setRenaming(null); await refresh(); }
    catch (e) { setError(messageOf(e)); onError(e); } finally { setBusy(false); }
  };
  const unlink = async (variant: VariantRow) => {
    setBusy(true); setError('');
    try { await rpc({method: 'variants.unlink', variantId: variant.id}); setConfirmUnlink(''); onClearError(); await refresh(); }
    catch (e) { setError(messageOf(e)); onError(e); } finally { setBusy(false); }
  };
  const openPreview = async (variant: VariantRow) => {
    setPreviewBusy(true); setError('');
    try { setPreview(await rpc<PreviewResult>({method: 'variants.preview', variantId: variant.id})); }
    catch (e) { setError(messageOf(e)); onError(e); } finally { setPreviewBusy(false); }
  };
  const apply = async () => {
    if (!preview || previewBusy) return;
    setPreviewBusy(true); setError('');
    try {
      await beforeApply();
      const native = await prepareNativeSave();
      if (native !== 'clean') throw Error(native === 'dirty' ? 'NATIVE_EDITOR_DIRTY' : 'NATIVE_EDITOR_UNKNOWN');
      const value = await rpc<ApplyResult>({method: 'variants.apply', variantId: preview.variant.id});
      onClearError(); setLastApply({applyId: value.apply.id, variantWorkItemId: value.variant.workItemId});
      setPreview(null);
      await onChanged(value.draft, `变体 ${value.variant.workItemId} 已接入 ${value.draft.workItemId}，主工作项已更新。`);
      await refresh();
    } catch (e) { setError(messageOf(e)); onError(e); } finally { setPreviewBusy(false); }
  };
  const undo = async () => {
    if (!lastApply || busy) return;
    setBusy(true); setError('');
    try {
      await beforeApply();
      const native = await prepareNativeSave();
      if (native !== 'clean') throw Error(native === 'dirty' ? 'NATIVE_EDITOR_DIRTY' : 'NATIVE_EDITOR_UNKNOWN');
      const saved = await rpc<DraftView>({method: 'variants.undo', applyId: lastApply.applyId});
      onClearError(); setLastApply(null);
      await onChanged(saved, `已撤销接入，${saved.workItemId} 恢复为接入前内容。`);
      await refresh();
    } catch (e) { setError(messageOf(e)); onError(e); } finally { setBusy(false); }
  };
  const openDetails = async (variantId: string) => {
    if (detailsBusy) return;
    setDetailsBusy(true); setError('');
    try {
      const value = await rpc<VariantDetails>({method: 'variants.details.read', target, variantId});
      setDetails({...value, variantId, isDefault: variantId.startsWith('default:')});
    } catch (e) { setError(messageOf(e)); onError(e); } finally { setDetailsBusy(false); }
  };
  const saveDetails = async () => {
    if (!details || detailsBusy) return;
    setDetailsBusy(true); setError('');
    try {
      const {variantId, isDefault, ...payload} = details;
      await rpc({method: 'variants.details.write', target, variantId, details: {...payload, label: isDefault ? '默认' : payload.label}});
      onClearError(); setDetails(null);
      await refresh();
    } catch (e) { setError(messageOf(e)); onError(e); } finally { setDetailsBusy(false); }
  };

  const patchDetails = (patch: Partial<DetailsState>) => setDetails(current => current ? {...current, ...patch} : current);

  return <aside className="variant-panel" role="dialog" aria-label="变体管理">
    <header className="variant-head">
      <div className="variant-title"><GitBranch size={16}/><div><strong>变体管理</strong><small>主文档 {draft.workItemId} · {mainTitle}</small></div></div>
      <button className="icon" title="关闭变体管理" onClick={onClose}><X size={15}/></button>
    </header>
    <p className="variant-note">主工作项默认作为「默认」变体；其他变体是 Polarion 中的独立工作项。变体正文、标题、归属链接、详细配置和当前接入状态都保存在 Polarion，本地只保留未保存草稿。{role && <> 链接角色：<code>{role}</code>。</>}</p>
    {warning && <div className="variant-alert"><AlertTriangle size={14}/><span>{warning}</span></div>}
    {diverged && <div className="variant-alert"><AlertTriangle size={14}/><span>主文档正文已被直接编辑，目前不属于任何已保存变体。可以新建一个变体保存当前内容。</span></div>}
    {error && <div className="variant-alert error" role="alert"><AlertTriangle size={14}/><span>{error}</span><button className="icon" title="关闭提示" onClick={() => setError('')}><X size={12}/></button></div>}
    <div className="variant-actions">
      <button className="primary" disabled={busy} onClick={() => setCreating(value => !value)}><Plus size={13}/>新增变体</button>
      <button className="secondary" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={13}/>{loading ? '同步中…' : '同步'}</button>
    </div>
    {creating && <div className="variant-create">
      <label><span>变体名称</span><input autoFocus maxLength={120} placeholder="例如：客户甲 / 高配车型 / 项目 A" value={label} disabled={busy} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void create(); }}/></label>
      <label><span>Polarion 标题 <small>留空时使用「主标题 · 变体：名称」</small></span><input maxLength={500} value={title} disabled={busy} onChange={event => setTitle(event.target.value)}/></label>
      {roleOptions.length > 0 && <label><span>关联角色 <small>变体 → 主工作项的 Polarion 链接</small></span><select value={createRole} disabled={busy} onChange={event => setCreateRole(event.target.value)}>{roleOptions.map(option => <option key={option.id} value={option.id}>{option.name ?? option.id}</option>)}</select></label>}
      <label className="variant-check"><input type="checkbox" checked={copy} disabled={busy} onChange={event => setCopy(event.target.checked)}/><span>从当前主工作项复制正文（图片与画板会重新绑定到新变体）</span></label>
      <div className="variant-create-actions"><button className="primary" disabled={busy || !label.trim()} onClick={() => void create()}><Check size={13}/>{busy ? '正在创建…' : '创建并编辑'}</button><button className="secondary" disabled={busy} onClick={() => setCreating(false)}>取消</button></div>
    </div>}
    <div className="variant-list">
      {defaultRow && <article className="variant-row default" tabIndex={0}>
        <div className="variant-row-head"><strong title={defaultRow.title}>默认（主文档）</strong>{!activeVariantId && <span className="variant-badge active">当前接入</span>}</div>
        <div className="variant-row-meta"><code>{defaultRow.workItemId}</code><span>{stateLabel[defaultRow.draftState]}</span></div>
        <div className="variant-row-actions">
          <button onClick={() => onOpenVariant(defaultRow.workItemId)}><Pencil size={12}/>编辑主正文</button>
          <button disabled={detailsBusy} onClick={() => void openDetails('default:' + defaultRow.workItemId)}><Info size={12}/>详细配置</button>
        </div>
        <div className="variant-hover" role="tooltip"><strong>默认变体 · {defaultRow.workItemId}</strong><dl><dt>客户</dt><dd>{defaultRow.details?.customer || '—'}</dd><dt>项目</dt><dd>{defaultRow.details?.project || '—'}</dd><dt>车型</dt><dd>{defaultRow.details?.vehicle || '—'}</dd><dt>配置</dt><dd>{defaultRow.details?.configuration || '—'}</dd></dl>{defaultRow.details?.notes && <p>{defaultRow.details.notes}</p>}</div>
      </article>}
      {rows.map(variant => <article className="variant-row" key={variant.id} tabIndex={0}>
        <div className="variant-row-head"><strong title={variant.title}>{variant.label}</strong>
          {variant.kind === 'default' && <span className="variant-badge default">默认</span>}
          {variant.id === activeVariantId && <span className="variant-badge active">当前接入</span>}
          {variant.linkState === 'pending' && <span className="variant-badge pending">待关联</span>}
          {variant.draftState === 'dirty' && <span className="variant-badge dirty">未保存</span>}
        </div>
        <div className="variant-row-meta"><code>{variant.workItemId}</code><span>{stateLabel[variant.draftState]}</span></div>
        <div className="variant-row-actions">
          <button disabled={variant.linkState !== 'linked'} title={variant.linkState === 'linked' ? '打开变体编辑器' : '关联建立后才能编辑'} onClick={() => onOpenVariant(variant.workItemId)}><Pencil size={12}/>打开编辑</button>
          <button disabled={variant.linkState !== 'linked' || previewBusy || busy} title={variant.linkState === 'linked' ? '预览并接入主工作项' : '关联建立后才能接入'} onClick={() => void openPreview(variant)}><GitBranch size={12}/>接入…</button>
          <button disabled={busy || detailsBusy} onClick={() => void openDetails(variant.id)}><Info size={12}/>详细配置</button>
          <button disabled={busy} onClick={() => setRenaming({id: variant.id, value: variant.label})}><Pencil size={12}/>重命名</button>
          {variant.linkState === 'pending' && <button disabled={busy} onClick={() => void relink(variant)}><Link2 size={12}/>重试关联</button>}
          <button className="danger" disabled={busy} onClick={() => setConfirmUnlink(variant.id)}><Unlink size={12}/>解除</button>
        </div>
        {renaming?.id === variant.id && <div className="variant-inline"><input autoFocus maxLength={120} value={renaming.value} disabled={busy} onChange={event => setRenaming({id: variant.id, value: event.target.value})} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void rename(variant); if (event.key === 'Escape') setRenaming(null); }}/><button className="primary" disabled={busy || !renaming.value.trim()} onClick={() => void rename(variant)}>保存</button><button className="secondary" onClick={() => setRenaming(null)}>取消</button></div>}
        {confirmUnlink === variant.id && <div className="variant-inline confirm"><span>解除本地归属与 Polarion 链接？工作项本身会保留，未保存的变体草稿会一并删除。</span><button className="primary danger-confirm" disabled={busy} onClick={() => void unlink(variant)}>确认解除</button><button className="secondary" onClick={() => setConfirmUnlink('')}>取消</button></div>}
        <div className="variant-hover" role="tooltip"><strong>{variant.label} · {variant.workItemId}</strong><dl><dt>客户</dt><dd>{variant.details?.customer || '—'}</dd><dt>项目</dt><dd>{variant.details?.project || '—'}</dd><dt>车型</dt><dd>{variant.details?.vehicle || '—'}</dd><dt>配置</dt><dd>{variant.details?.configuration || '—'}</dd></dl>{variant.details?.notes && <p>{variant.details.notes}</p>}</div>
      </article>)}
      {!loading && !rows.length && !defaultRow && <p className="variant-empty">还没有变体。新增的变体是独立的 Polarion 工作项，不会进入主文档。</p>}
      {loading && !rows.length && !defaultRow && <p className="variant-empty">正在从 Polarion 同步变体…</p>}
    </div>
    {lastApply && <div className="variant-undo"><span>上次接入：<code>{lastApply.variantWorkItemId}</code></span><button className="secondary" disabled={busy} onClick={() => void undo()}>撤销接入</button></div>}
    {preview && <div className="variant-preview" role="dialog" aria-label="确认接入变体">
      <header><strong>接入 {preview.variant.workItemId}</strong><button className="icon" title="关闭预览" onClick={() => setPreview(null)}><X size={14}/></button></header>
      <p className="variant-preview-note">将用变体正文覆盖 <code>{draft.workItemId}</code> 的正文。主工作项 ID、文档位置、评论和审批不变；接入前会自动保存一份可撤销快照。</p>
      {preview.changed ? <span className="variant-badge dirty">正文不同</span> : <span className="variant-badge active">正文相同</span>}
      {preview.warnings.map(text => <div className="variant-alert" key={text}><AlertTriangle size={13}/><span>{text}</span></div>)}
      <section><h4>主工作项当前正文</h4><pre>{textOf(preview.mainHtml).slice(0, 800) || '（空）'}</pre></section>
      <section><h4>变体正文</h4><pre>{textOf(preview.variantHtml).slice(0, 800) || '（空）'}</pre></section>
      <footer><button className="secondary" disabled={previewBusy} onClick={() => setPreview(null)}>取消</button><button className="primary" disabled={previewBusy} onClick={() => void apply()}><Check size={13}/>{previewBusy ? '正在接入…' : '确认接入'}</button></footer>
    </div>}
    {details && <div className="variant-preview variant-details" role="dialog" aria-label="变体详细配置">
      <header><strong>{details.isDefault ? '默认变体详细配置' : '变体详细配置'}</strong><button className="icon" title="关闭详细配置" onClick={() => setDetails(null)}><X size={14}/></button></header>
      <p className="variant-preview-note">配置保存在变体工作项的 <code>sidebar-variant.json</code> 附件中，随 Polarion 同步；保存后可再次编辑。</p>
      <label className="variant-field"><span>名称 <small>{details.isDefault ? '跟随主工作项标题' : '保存时同步到 Polarion 标题'}</small></span><input autoFocus maxLength={120} value={details.label} disabled={details.isDefault || detailsBusy} onChange={event => patchDetails({label: event.target.value})}/></label>
      <label className="variant-field"><span>客户</span><input maxLength={200} value={details.customer} disabled={detailsBusy} onChange={event => patchDetails({customer: event.target.value})}/></label>
      <label className="variant-field"><span>项目</span><input maxLength={200} value={details.project} disabled={detailsBusy} onChange={event => patchDetails({project: event.target.value})}/></label>
      <label className="variant-field"><span>车型</span><input maxLength={200} value={details.vehicle} disabled={detailsBusy} onChange={event => patchDetails({vehicle: event.target.value})}/></label>
      <label className="variant-field"><span>配置</span><input maxLength={200} value={details.configuration} disabled={detailsBusy} onChange={event => patchDetails({configuration: event.target.value})}/></label>
      <label className="variant-field"><span>备注</span><textarea rows={4} maxLength={4000} value={details.notes} disabled={detailsBusy} onChange={event => patchDetails({notes: event.target.value})}/></label>
      <footer><button className="secondary" disabled={detailsBusy} onClick={() => setDetails(null)}>取消</button><button className="primary" disabled={detailsBusy || !details.label.trim()} onClick={() => void saveDetails()}>{detailsBusy ? '正在保存…' : '保存配置'}</button></footer>
    </div>}
  </aside>;
}
