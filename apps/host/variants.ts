import {createHash} from 'node:crypto';
import {Store} from './store.ts';
import {Drafts, type Remote, type RemoteItem, type RemoteLink} from './polarion.ts';
import {Assets} from './assets.ts';
import {Boards} from './boards.ts';
import {sameTarget, type Asset, type Draft, type Target, type Variant, type VariantActive, type VariantApply, type VariantDetails, type VariantScope} from '../../packages/protocol/index.ts';
import {chooseLinkRole, labelFromTitle, variantTitle} from './variant-access.ts';

type CreateInput = {
  target: Target;
  mainWorkItemId: string;
  label: string;
  title: string;
  copy: boolean;
  role: string;
};
type ImageCopy = {html: string; failed: number; board: boolean};
const DETAILS_FILE = 'sidebar-variant.json';
const ACTIVE_FILE = 'sidebar-variant-active.json';

/**
 * 变体以 Polarion 工作项为准：工作项本身、归属链接、标题中的 label、正文全部落在服务端；
 * 本地只缓存列表元数据与未保存草稿。换机器后通过主工作项的反向链接重新发现。
 */
export class Variants {
  readonly store: Store;
  readonly drafts: Drafts;
  readonly assets: Assets;
  constructor(store: Store, drafts: Drafts, assets: Assets) {
    this.store = store;
    this.drafts = drafts;
    this.assets = assets;
  }
  private remote(): Remote { return this.drafts.remote; }
  private record(id: string) {
    const value = this.store.get<Variant>('variant', id);
    if (!value) throw Error('VARIANT_NOT_FOUND');
    return value;
  }
  private scope(variant: Variant): VariantScope {
    return {mainWorkItemId: variant.mainWorkItemId, role: variant.linkRole};
  }
  private kind(variant: Variant): 'default' | 'custom' {
    return variant.kind ?? 'custom';
  }
  private text(value: unknown, max: number) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
  private normalizeDetails(raw: Record<string, unknown> | null | undefined, label: string): VariantDetails {
    return {
      label: label.trim().slice(0, 120),
      customer: this.text(raw?.customer, 200),
      project: this.text(raw?.project, 200),
      vehicle: this.text(raw?.vehicle, 200),
      configuration: this.text(raw?.configuration, 200),
      notes: this.text(raw?.notes, 4000),
    };
  }
  private records(target: Target, mainWorkItemId: string) {
    return this.store.list<Variant>('variant').filter(v => sameTarget(v.target, target) && v.mainWorkItemId === mainWorkItemId);
  }
  /** 变体工作项在本地唯一：并发刷新时按 target+workItemId 合并，避免同一工作项出现两条缓存记录。 */
  private findRecord(target: Target, workItemId: string) {
    return this.store.list<Variant>('variant').find(v => sameTarget(v.target, target) && v.workItemId === workItemId);
  }
  private upsertDiscovered(target: Target, mainWorkItemId: string, link: RemoteLink, item: RemoteItem, metadata: Record<string, unknown> | null) {
    const label = labelFromTitle(item.title, link.workItemId);
    const kind: 'default' | 'custom' = metadata?.kind === 'default' || (!metadata && label === '默认') ? 'default' : 'custom';
    // 发现阶段先读远端再写本地；两个刷新可能都通过了读取，写回前必须再查一次。
    const existing = this.findRecord(target, link.workItemId);
    if (existing) {
      const next: Variant = {
        ...existing, mainWorkItemId, label, title: item.title ?? existing.title, linkRole: link.role, kind,
        ...(metadata ? {details: this.normalizeDetails(metadata, label)} : {}), updatedAt: Date.now(),
      };
      if (JSON.stringify(next) !== JSON.stringify(existing)) this.store.put('variant', existing.id, next);
      return next;
    }
    const record: Variant = {
      id: crypto.randomUUID(), target, mainWorkItemId, workItemId: link.workItemId,
      label, title: item.title ?? '', linkRole: link.role, linkState: 'linked',
      kind,
      ...(metadata ? {details: this.normalizeDetails(metadata, label)} : {}),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.store.put('variant', record.id, record);
    return record;
  }
  /** 详细配置里的名称以远端标题/元数据为准，避免用本地旧缓存覆盖另一台机器的修改。 */
  private remoteLabel(item: RemoteItem | undefined, raw: Record<string, unknown> | null | undefined, fallback: string) {
    if (item && (item.title ?? '').trim()) return labelFromTitle(item.title, fallback);
    return this.text(raw?.label, 120) || fallback;
  }
  private activeKey(target: Target, mainWorkItemId: string) {
    return `${target.projectId}:${target.document}:${mainWorkItemId}`;
  }
  private binding(target: Target, mainWorkItemId: string, mainUpdated: string) {
    const value = this.store.get<VariantActive>('variant-active', this.activeKey(target, mainWorkItemId));
    return value && value.mainUpdated === mainUpdated ? value : undefined;
  }
  private hash(html: string) {
    return createHash('sha256').update(html).digest('hex');
  }
  /** 当前接入状态也落到主工作项附件，换机器可读；正文哈希避免直接编辑主工作项后误报。 */
  private async readActiveMarker(target: Target, mainWorkItemId: string, mainHtml: string) {
    const remote = this.remote();
    if (!remote.metadataRead) return undefined;
    try {
      const raw = await remote.metadataRead(target, mainWorkItemId, undefined, ACTIVE_FILE);
      if (!raw || raw.contentHash !== this.hash(mainHtml)) return undefined;
      return {variantWorkItemId: typeof raw.variantWorkItemId === 'string' ? raw.variantWorkItemId : ''};
    } catch { return undefined; }
  }
  private async writeActiveMarker(target: Target, mainWorkItemId: string, variantWorkItemId: string, contentHtml: string, applyId: string) {
    const remote = this.remote();
    if (!remote.metadataWrite) return undefined;
    try {
      const result = await remote.metadataWrite(target, mainWorkItemId, {
        format: 'polarion-sidebar-variant-active', version: 1,
        variantWorkItemId, contentHash: this.hash(contentHtml), applyId, updatedAt: Date.now(),
      }, undefined, ACTIVE_FILE);
      return result.verified ? (result.updated || undefined) : undefined;
    } catch { return undefined; }
  }
  private sameDetails(left: Variant['details'], right: Variant['details']) {
    return (left?.customer ?? '') === (right?.customer ?? '')
      && (left?.project ?? '') === (right?.project ?? '')
      && (left?.vehicle ?? '') === (right?.vehicle ?? '')
      && (left?.configuration ?? '') === (right?.configuration ?? '')
      && (left?.notes ?? '') === (right?.notes ?? '');
  }
  private async roleFor(target: Target, requested: string) {
    const remote = this.remote();
    let roles: {id: string; name?: string; hidden?: boolean}[] | undefined;
    try { roles = remote.roles ? await remote.roles(target) : undefined; } catch { roles = undefined; }
    const requestedRole = requested.trim();
    let role = requestedRole || this.store.settings().variantLinkRole.trim();
    if (!role) {
      if (!roles) throw Error('VARIANT_LINK_ROLE_REQUIRED');
      role = chooseLinkRole(roles);
    } else if (roles && !roles.some(option => option.id === role && !option.hidden)) {
      // 用户显式指定的角色不存在时必须报错；项目配置变更导致的失效配置则自动修正，避免永久卡住。
      if (requestedRole) throw Error('VARIANT_LINK_ROLE_INVALID');
      role = chooseLinkRole(roles);
    }
    if (this.store.settings().variantLinkRole !== role) {
      const settings = this.store.settings(); settings.variantLinkRole = role; this.store.put('settings', 'global', settings);
    }
    return role;
  }
  /** 当前主工作项正文与哪个变体一致；用内容哈希判断，不依赖任何本机绑定。 */
  private async activeVariantId(target: Target, mainWorkItemId: string, variants: Variant[]) {
    if (variants.length > 12) return undefined;
    try {
      const hash = (html: string) => createHash('sha256').update(html).digest('hex');
      const localMain = this.store.drafts(target).find(d => d.workItemId === mainWorkItemId);
      const mainHtml = localMain?.state === 'clean' ? localMain.html : (await this.remote().read(target, mainWorkItemId)).description ?? '';
      const mainHash = hash(mainHtml);
      for (const variant of variants) {
        const local = this.store.drafts(target).find(d => d.workItemId === variant.workItemId);
        const html = local?.state === 'clean' ? local.html : (await this.remote().read(target, variant.workItemId, this.scope(variant))).description ?? '';
        if (hash(html) === mainHash) return variant.id;
      }
    } catch { /* 离线或部分变体不可读时，宁可不显示“当前启用”，也不猜。 */ }
    return undefined;
  }
  async list(target: Target, mainWorkItemId: string) {
    const records = this.records(target, mainWorkItemId);
    const configured = this.store.settings().variantLinkRole.trim();
    // 配置的角色可能来自另一个项目或已被删除；面板展示的必须是当前项目实际可用的角色。
    let role = configured;
    if (configured && this.remote().roles) {
      try {
        const options = await this.remote().roles!(target);
        const available = options.filter(option => option.id && !option.hidden);
        if (!available.some(option => option.id === configured)) role = '';
      } catch { /* 角色清单不可用（旧后端/离线）时保持配置值，创建时再校验。 */ }
    }
    const discovered: Variant[] = [];
    let warning = '';
    if (this.remote().backLinks) {
      try {
        const links = await this.remote().backLinks!(target, mainWorkItemId);
        for (const link of links) {
          if (!link.role) continue;
          // 配置角色可用时按它筛选；配置已失效（role 为空）时不再硬过滤，避免项目里已有的变体全部消失。
          if (role && link.role !== role) continue;
          if (discovered.some(v => v.workItemId === link.workItemId)) continue;
          try {
            const item = await this.remote().read(target, link.workItemId, {mainWorkItemId, role: link.role});
            // 只有标题带变体标记或带本工具配置附件的工作项才算变体；普通父项/关联项不能被接入或解除链接。
            const looksLikeVariant = (item.title ?? '').includes(' · 变体：') || (item.title ?? '').includes(' - 变体：');
            let metadata: Record<string, unknown> | null = null;
            try { metadata = this.remote().metadataRead ? await this.remote().metadataRead!(target, link.workItemId, {mainWorkItemId, role: link.role}) : null; } catch { metadata = null; }
            if (!looksLikeVariant && metadata?.format !== 'polarion-sidebar-variant') continue;
            // 另一台机器改名/改配置后，点同步即可刷新本地缓存；不能用旧 label 覆盖远端元数据。
            discovered.push(this.upsertDiscovered(target, mainWorkItemId, link, item, metadata));
          } catch { warning = '部分关联工作项无法读取，请检查权限或链接角色。'; }
        }
      } catch { warning = '暂时无法从 Polarion 同步变体列表，当前显示本地缓存。'; }
    }
    // 本地缓存也重新读一次详细配置，保证另一台机器修改后点“同步”即可看到。
    if (this.remote().metadataRead) {
      for (const record of records.slice(0, 12)) {
        try {
          const raw = await this.remote().metadataRead!(target, record.workItemId, this.scope(record), DETAILS_FILE);
          if (!raw) continue;
          const details = this.normalizeDetails(raw, record.label);
          const kind: 'default' | 'custom' = raw.kind === 'default' ? 'default' : 'custom';
          if (!this.sameDetails(details, record.details) || kind !== this.kind(record)) {
            this.store.put('variant', record.id, {...record, details, kind, updatedAt: Date.now()});
          }
        } catch { /* 单个变体配置读取失败不影响列表 */ }
      }
    }
    const base = this.records(target, mainWorkItemId).sort((left, right) => (this.kind(left) === 'default' ? 0 : 1) - (this.kind(right) === 'default' ? 0 : 1) || left.createdAt - right.createdAt);
    const variants = base.map(variant => ({
      ...variant,
      draftState: this.store.drafts(target).find(d => d.workItemId === variant.workItemId)?.state ?? 'none',
    }));
    const defaultRecord = variants.find(variant => this.kind(variant) === 'default');
    let mainTitle = this.store.drafts(target).find(d => d.workItemId === mainWorkItemId)?.title ?? defaultRecord?.title ?? '';
    let mainUpdated = '', mainHtml = '';
    try { const main = await this.remote().read(target, mainWorkItemId); mainTitle = main.title || mainTitle; mainUpdated = main.updated ?? ''; mainHtml = main.description ?? ''; } catch { /* 离线时使用本地缓存标题 */ }
    const hashActiveId = await this.activeVariantId(target, mainWorkItemId, base);
    let activeVariantId = hashActiveId;
    // 图片/画板接入后附件 ID 会变，正文哈希无法命中；以主工作项 updated 校验过的本机接入记录为准。
    const activeBinding = mainUpdated ? this.binding(target, mainWorkItemId, mainUpdated) : undefined;
    if (activeBinding) {
      if (activeBinding.variantWorkItemId) {
        activeVariantId = base.find(variant => variant.workItemId === activeBinding.variantWorkItemId)?.id ?? hashActiveId;
      } else {
        activeVariantId = defaultRecord?.id;
      }
    }
    // 当前接入状态优先读主工作项上的 Polarion 附件；换机器没有本地记录时也能显示。
    const marker = await this.readActiveMarker(target, mainWorkItemId, mainHtml);
    if (marker) {
      if (marker.variantWorkItemId) {
        activeVariantId = base.find(variant => variant.workItemId === marker.variantWorkItemId)?.id ?? hashActiveId;
      } else {
        activeVariantId = defaultRecord?.id;
      }
    }
    // 撤销快照兜底：主工作项 updated 未变时，仍认定为最后一次接入的变体；覆盖图片/画板附件 ID 差异。
    const lastApply = this.store.list<VariantApply>('variant-apply')
      .filter(apply => sameTarget(apply.target, target) && apply.mainWorkItemId === mainWorkItemId && apply.state === 'applied')
      .sort((left, right) => right.at - left.at)[0];
    // 只有主工作项仍停在这条接入记录之后的状态，撤销才可能成功；否则不显示必然失败的撤销入口。
    const undoableApply = lastApply && lastApply.serverUpdated === mainUpdated ? lastApply : undefined;
    if (!activeVariantId && lastApply && lastApply.serverUpdated === mainUpdated) {
      activeVariantId = base.find(variant => variant.workItemId === lastApply.variantWorkItemId)?.id;
    }
    // 主工作项正文尚未捕获为独立默认变体时，在面板中显示为“默认”行。
    let defaultVariant: {workItemId: string; label: string; title: string; draftState: string; details?: VariantDetails} | null = null;
    if (!defaultRecord) {
      const mainDraft = this.store.drafts(target).find(d => d.workItemId === mainWorkItemId);
      let details: VariantDetails | undefined;
      try {
        const raw = this.remote().metadataRead ? await this.remote().metadataRead!(target, mainWorkItemId) : null;
        if (raw) details = this.normalizeDetails(raw, '默认');
      } catch { /* 详细配置读取失败不影响列表 */ }
      defaultVariant = {workItemId: mainWorkItemId, label: '默认', title: mainTitle, draftState: mainDraft?.state ?? 'none', ...(details ? {details} : {})};
    }
    // 已捕获默认变体但主工作项正文又与任何变体都不一致，说明有人直接改过主工作项。
    const diverged = !!defaultRecord && !activeVariantId;
    return {variants, defaultVariant, mainTitle, activeVariantId, diverged, warning, role, lastApply: undoableApply ? {applyId: undoableApply.id, variantWorkItemId: undoableApply.variantWorkItemId} : null};
  }
  async roles(target: Target) {
    if (!this.remote().roles) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    return this.remote().roles!(target);
  }
  /** 从主草稿（若存在）或服务端正文取当前内容，并尽量把 workitemimg 转成本地资产。 */
  private async imageCopy(html: string, target: Target, workItemId: string, scope?: VariantScope): Promise<ImageCopy> {
    const remote = this.remote();
    if (!remote.image) return {html, failed: 0, board: false};
    const refs = [...new Set([...html.matchAll(/(?:workitemimg:|attachment:)[^"'\s>]+/g)].map(match => match[0]))];
    let failed = 0, board = false;
    for (const src of refs) {
      try {
        const asset = await remote.image(target, workItemId, src, scope) as Asset;
        if (/^sidebar-board-[0-9a-f-]{36}\.png$/i.test(asset.name)) { board = true; continue; }
        html = html.replaceAll(src, 'polarion-asset:' + asset.id);
      } catch {
        // attachment: 也可能是文档级模块附件，目标文档相同可保留原引用；workitemimg 解析失败才算错误。
        if (!src.startsWith('attachment:')) failed++;
      }
    }
    return {html, failed, board};
  }
  /** 把正文里的画板快照复制到目标工作项：支持本地 polarion-asset 引用和已保存的 workitemimg 附件引用。 */
  private async copyBoards(
    html: string,
    source: {target: Target; workItemId: string; scope?: VariantScope; item?: RemoteItem},
    destination: {target: Target; workItemId: string},
  ) {
    const boards = new Boards(this.store, this.assets);
    const remote = this.remote();
    const attachmentNames = new Map((source.item?.attachments ?? []).flatMap(attachment => attachment.id && attachment.file_name ? [[attachment.id, attachment.file_name] as const] : []));
    const refs = [...new Set([...html.matchAll(/(?:polarion-asset:|workitemimg:)[^"'\s>]+/g)].map(match => match[0]))];
    let copied = 0, failed = 0;
    for (const src of refs) {
      try {
        if (src.startsWith('polarion-asset:')) {
          const record = boards.byPreview(src.slice('polarion-asset:'.length));
          if (!record) continue; // 普通图片，交给现有保存/图片复制链路
          const copy = boards.copy(record, destination.target, destination.workItemId);
          html = html.replaceAll(src, 'polarion-asset:' + copy.previewId);
          copied++;
          continue;
        }
        const attachmentId = src.slice('workitemimg:'.length);
        const name = attachmentNames.get(attachmentId);
        if (!name || !/^sidebar-board-[0-9a-f-]{36}\.png$/i.test(name)) continue; // 普通图片
        if (!remote.board) throw Error('BOARD_READER_UNAVAILABLE');
        const packet = await remote.board(source.target, source.workItemId, src, source.scope);
        const imported = boards.import(source.target, source.workItemId, packet);
        const copy = boards.copy(imported, destination.target, destination.workItemId);
        html = html.replaceAll(src, 'polarion-asset:' + copy.previewId);
        copied++;
      } catch { failed++; }
    }
    return {html, copied, failed};
  }
  private hasBoardAsset(html: string) {
    const ids = [...new Set([...html.matchAll(/polarion-asset:([0-9a-f-]{36})/gi)].map(match => match[1]!))];
    if (!ids.length) return false;
    const boards = new Boards(this.store, this.assets);
    return ids.some(id => !!boards.byPreview(id));
  }
  private hasBoardAttachment(item: RemoteItem) {
    return (item.attachments ?? []).some(attachment => /^sidebar-board-[0-9a-f-]{36}\.png$/i.test(attachment.file_name ?? ''));
  }
  private sourceHtml(target: Target, mainWorkItemId: string, remoteHtml: string) {
    return this.store.drafts(target).find(d => d.workItemId === mainWorkItemId)?.html ?? remoteHtml;
  }
  async create(input: CreateInput) {
    const remote = this.remote();
    if (!remote.create || !remote.link) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    const main = await remote.read(input.target, input.mainWorkItemId);
    if (!main.type) throw Error('VARIANT_TYPE_REQUIRED');
    const role = await this.roleFor(input.target, input.role);
    const title = input.title.trim() || variantTitle(main.title, input.label);
    const created = await remote.create(input.target, title, main.type);
    let linkState: 'linked' | 'pending' = 'pending';
    try { const linked = await remote.link(input.target, created.id, input.mainWorkItemId, role); linkState = linked.verified ? 'linked' : 'pending'; } catch { linkState = 'pending'; }
    const record: Variant = {
      id: crypto.randomUUID(), target: input.target, mainWorkItemId: input.mainWorkItemId,
      workItemId: created.id, label: input.label.trim(), title, linkRole: role, linkState,
      kind: 'custom', createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.store.put('variant', record.id, record);
    if (linkState !== 'linked') return {variant: record, draft: null, warning: '变体工作项已创建，但关联链接尚未确认。请在面板中重试关联后再编辑。'};
    const view = await this.drafts.open(input.target, created.id);
    const notes: string[] = [];
    let seeded = false;
    if (input.copy) {
      const mainDraft = this.store.drafts(input.target).find(d => d.workItemId === input.mainWorkItemId);
      if (mainDraft && mainDraft.state !== 'clean') notes.push('主工作项有未保存或待合并的本地草稿，复制的是当前本地内容。');
      const source = this.sourceHtml(input.target, input.mainWorkItemId, main.description ?? '');
      const boardCopy = await this.copyBoards(source, {target: input.target, workItemId: input.mainWorkItemId, item: main}, {target: input.target, workItemId: created.id});
      const copied = await this.imageCopy(boardCopy.html, input.target, input.mainWorkItemId);
      if (boardCopy.failed) notes.push('部分画板快照无法复制，已创建空变体；可在变体中重新插入画板。');
      else if (copied.board || copied.failed) notes.push('部分图片无法复制，已创建空变体；可稍后重试或手工复制内容。');
      else if (source.trim()) {
        const draft = this.store.require<Draft>('draft', view.id);
        this.store.put('draft', draft.id, {...draft, html: copied.html, revision: draft.revision + 1, state: 'dirty'});
        seeded = true;
      }
    }
    return {variant: record, draft: this.drafts.read(view.id), warning: notes.join(' '), seeded};
  }
  async link(variantId: string) {
    const variant = this.record(variantId);
    const remote = this.remote();
    if (!remote.link) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    const linked = await remote.link(variant.target, variant.workItemId, variant.mainWorkItemId, variant.linkRole);
    const value: Variant = {...variant, linkState: linked.verified ? 'linked' : 'pending', updatedAt: Date.now()};
    this.store.put('variant', value.id, value);
    return value;
  }
  async rename(variantId: string, label: string) {
    const variant = this.record(variantId);
    const remote = this.remote();
    if (!remote.rename) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    const current = await remote.read(variant.target, variant.workItemId, this.scope(variant));
    const main = await remote.read(variant.target, variant.mainWorkItemId);
    const title = variantTitle(main.title, label);
    const updated = await remote.rename(variant.target, variant.workItemId, title, current.updated ?? '', this.scope(variant));
    const value: Variant = {...variant, label: label.trim(), title: updated.title ?? title, updatedAt: Date.now()};
    this.store.put('variant', value.id, value);
    const draft = this.store.drafts(variant.target).find(d => d.workItemId === variant.workItemId);
    if (draft) this.store.put('draft', draft.id, {...draft, title: value.title});
    return value;
  }
  async unlink(variantId: string) {
    const variant = this.record(variantId);
    const remote = this.remote();
    if (remote.unlink) {
      try { await remote.unlink(variant.target, variant.workItemId, variant.mainWorkItemId, variant.linkRole); } catch { /* 本地仍解除；服务端链接可在 Polarion 中清理。 */ }
    }
    const drafts = this.store.drafts(variant.target).filter(d => d.workItemId === variant.workItemId);
    const activeKey = this.activeKey(variant.target, variant.mainWorkItemId);
    if (this.store.get<VariantActive>('variant-active', activeKey)?.variantWorkItemId === variant.workItemId) this.store.remove('variant-active', activeKey);
    // 归属记录是解除操作的主目标；清理本地草稿失败也不应把它留在列表里。
    try { if (drafts.length) this.drafts.remove(drafts.map(d => d.id)); }
    finally { this.store.remove('variant', variant.id); }
    return {removed: true, workItemId: variant.workItemId};
  }
  async open(variantId: string) {
    const variant = this.record(variantId);
    return this.drafts.open(variant.target, variant.workItemId);
  }
  async preview(variantId: string) {
    const variant = this.record(variantId);
    if (variant.linkState !== 'linked') throw Error('VARIANT_LINK_REQUIRED');
    const remote = this.remote();
    const main = await remote.read(variant.target, variant.mainWorkItemId);
    const variantItem = await remote.read(variant.target, variant.workItemId, this.scope(variant));
    const mainDraft = this.store.drafts(variant.target).find(d => d.workItemId === variant.mainWorkItemId);
    const variantDraft = this.store.drafts(variant.target).find(d => d.workItemId === variant.workItemId);
    const warnings: string[] = [];
    if (variantDraft && variantDraft.state !== 'clean') warnings.push('变体仍有未保存的本地修改，接入前需先保存。');
    if (mainDraft && mainDraft.state !== 'clean') warnings.push('主工作项仍有未保存的本地修改，接入会覆盖它。');
    if (this.hasBoardAsset(variantItem.description ?? '') || this.hasBoardAttachment(variantItem)) warnings.push('变体含画板，接入会先把画板快照复制到主工作项。');
    const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!plain(variantItem.description ?? '')) warnings.push('变体正文为空，接入会清空主工作项正文。');
    if (!this.records(variant.target, variant.mainWorkItemId).some(item => this.kind(item) === 'default') && this.kind(variant) !== 'default') warnings.push('首次接入会先把主工作项当前正文保存为「默认」变体，再覆盖主工作项。');
    return {
      variant, mainHtml: main.description ?? '', variantHtml: variantItem.description ?? '',
      mainUpdated: main.updated ?? '', variantUpdated: variantItem.updated ?? '',
      changed: (main.description ?? '') !== (variantItem.description ?? ''), warnings,
    };
  }
  /**
   * 把捕获失败后的默认草稿回滚到远端基线并置为 clean。
   * 否则一次网络/冲突失败会让草稿永久停在 dirty，之后所有接入都被 VARIANT_DEFAULT_DRAFT_DIRTY 挡住。
   */
  private async rollbackCapturedDraft(record: Variant, before: Draft) {
    let html = before.baseHtml, updated = before.baseUpdated;
    try {
      const current = await this.remote().read(record.target, record.workItemId, this.scope(record));
      html = current.description ?? '';
      updated = current.updated ?? '';
    } catch { /* 离线时回到捕获前基线；只要不是 dirty/uncertain，下一次接入就能重试。 */ }
    this.store.put('draft', before.id, {...before, html, baseHtml: html, baseUpdated: updated, revision: before.revision + 1, state: 'clean'});
  }
  /** 把主工作项正文复制进默认变体；已有正文时保留快照，不重复覆盖。 */
  private async captureDefaultBody(record: Variant, main: RemoteItem, remote: Remote): Promise<boolean> {
    const source = main.description ?? '';
    if (!source.trim()) return false;
    const current = await remote.read(record.target, record.workItemId, this.scope(record));
    if ((current.description ?? '').trim()) return false;
    const local = this.store.drafts(record.target).find(d => d.workItemId === record.workItemId);
    if (local && local.state !== 'clean') throw Error('VARIANT_DEFAULT_DRAFT_DIRTY');
    const boardCopy = await this.copyBoards(source, {target: record.target, workItemId: main.id, item: main}, {target: record.target, workItemId: record.workItemId});
    if (boardCopy.failed) throw Error('VARIANT_DEFAULT_CAPTURE_FAILED');
    const copied = await this.imageCopy(boardCopy.html, record.target, main.id);
    if (copied.board || copied.failed) throw Error('VARIANT_DEFAULT_CAPTURE_FAILED');
    const view = await this.drafts.open(record.target, record.workItemId);
    const draft = this.store.require<Draft>('draft', view.id);
    const revision = draft.revision + 1;
    this.store.put('draft', draft.id, {...draft, html: copied.html, revision, state: 'dirty'});
    try { await this.drafts.save(draft.id, revision, 'clean'); }
    catch (error) {
      // 保存失败时草稿可能被 Drafts.save 标成 dirty/uncertain/conflict；恢复到远端基线以便重试。
      await this.rollbackCapturedDraft(record, draft);
      throw error;
    }
    return true;
  }
  /** 首次接入前把主工作项当前正文捕获成独立的「默认」变体，避免覆盖后丢失原始内容。 */
  private async ensureDefaultVariant(target: Target, main: RemoteItem, role: string): Promise<{record: Variant; captured: boolean}> {
    const remote = this.remote();
    const existing = this.records(target, main.id).find(variant => this.kind(variant) === 'default');
    if (existing) {
      // 上次接入可能在创建后中断；默认变体为空时补捕获，已有正文则直接复用。
      const captured = await this.captureDefaultBody(existing, main, remote);
      return {record: existing, captured};
    }
    if (!remote.create || !remote.link) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    if (!main.type) throw Error('VARIANT_TYPE_REQUIRED');
    const title = variantTitle(main.title, '默认');
    const created = await remote.create(target, title, main.type);
    const linked = await remote.link(target, created.id, main.id, role);
    if (!linked.verified) throw Error('VARIANT_LINK_FAILED');
    const record: Variant = {
      id: crypto.randomUUID(), target, mainWorkItemId: main.id, workItemId: created.id,
      label: '默认', title, linkRole: role, linkState: 'linked', kind: 'default',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.store.put('variant', record.id, record);
    // 详细配置一起搬到默认变体；即使主工作项没有配置，也写入 kind=default 供跨机器识别。
    try {
      if (remote.metadataWrite) {
        const mainMetadata = remote.metadataRead ? await remote.metadataRead(target, main.id) : null;
        await remote.metadataWrite(target, created.id, {
          format: 'polarion-sidebar-variant', version: 1, label: '默认',
          customer: typeof mainMetadata?.customer === 'string' ? mainMetadata.customer : '',
          project: typeof mainMetadata?.project === 'string' ? mainMetadata.project : '',
          vehicle: typeof mainMetadata?.vehicle === 'string' ? mainMetadata.vehicle : '',
          configuration: typeof mainMetadata?.configuration === 'string' ? mainMetadata.configuration : '',
          notes: typeof mainMetadata?.notes === 'string' ? mainMetadata.notes : '',
          kind: 'default', mainWorkItemId: main.id, updatedAt: Date.now(),
        }, {mainWorkItemId: main.id, role});
      }
    } catch { /* 详细配置是附加信息，正文捕获优先。 */ }
    const captured = await this.captureDefaultBody(record, main, remote);
    return {record, captured};
  }
  async apply(variantId: string) {
    const variant = this.record(variantId);
    return this.serial(`${variant.target.projectId}:${variant.target.document}:${variant.mainWorkItemId}`, () => this.applyLocked(variant));
  }
  /** 同一主工作项的接入/撤销串行执行；两个窗口同时点击不会各自创建默认变体。 */
  private locks = new Map<string, Promise<unknown>>();
  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    this.locks.set(key, next.catch(() => {}));
    return next;
  }
  private async applyLocked(variant: Variant) {
    if (variant.linkState !== 'linked') throw Error('VARIANT_LINK_REQUIRED');
    const remote = this.remote();
    const variantDraft = this.store.drafts(variant.target).find(d => d.workItemId === variant.workItemId);
    if (variantDraft && variantDraft.state !== 'clean') throw Error('VARIANT_DRAFT_DIRTY');
    const view = await this.drafts.open(variant.target, variant.mainWorkItemId);
    const draft = this.store.require<Draft>('draft', view.id);
    if (draft.state !== 'clean') throw Error('MAIN_DRAFT_DIRTY');
    const main = await remote.read(variant.target, variant.mainWorkItemId);
    if (main.updated !== draft.baseUpdated || (main.description ?? '') !== draft.baseHtml) throw Error('MAIN_CHANGED_SINCE_DRAFT');
    // 覆盖前先捕获默认变体；失败则拒绝接入，保证原始正文不会丢失。
    const defaults = await this.ensureDefaultVariant(variant.target, main, variant.linkRole);
    const defaultVariant = defaults.record;
    // 记录接入前的当前变体：优先本机接入记录，其次正文哈希；首次接入时即刚捕获的默认变体。
    const previousBinding = this.binding(variant.target, variant.mainWorkItemId, main.updated ?? '');
    const previousHashId = previousBinding ? undefined : await this.activeVariantId(variant.target, variant.mainWorkItemId, this.records(variant.target, variant.mainWorkItemId));
    // 主正文已偏离所有变体且不是本次刚捕获的默认正文时，不伪造“默认”归属，撤销后才能正确显示分歧状态。
    const previousVariantWorkItemId = previousBinding
      ? (previousBinding.variantWorkItemId || defaultVariant.workItemId)
      : (previousHashId ?? (defaults.captured ? defaultVariant.workItemId : undefined));
    const variantItem = await remote.read(variant.target, variant.workItemId, this.scope(variant));
    const boardCopy = await this.copyBoards(variantItem.description ?? '', {target: variant.target, workItemId: variant.workItemId, scope: this.scope(variant), item: variantItem}, {target: variant.target, workItemId: variant.mainWorkItemId});
    if (boardCopy.failed) throw Error('VARIANT_BOARD_COPY_FAILED');
    const copied = await this.imageCopy(boardCopy.html, variant.target, variant.workItemId, this.scope(variant));
    if (copied.board) throw Error('VARIANT_BOARD_COPY_FAILED');
    if (copied.failed) throw Error('VARIANT_IMAGE_COPY_FAILED');
    // 远程读取/复制可能耗时；写回前重新核对草稿，期间的人工或 AI 修改不能被静默覆盖。
    const current = this.store.require<Draft>('draft', draft.id);
    if (current.state !== 'clean' || current.revision !== draft.revision || current.html !== draft.html) throw Error('STALE_DRAFT');
    const previousHtml = current.baseHtml, previousUpdated = current.baseUpdated;
    const revision = current.revision + 1;
    this.store.put('draft', current.id, {...current, html: copied.html, revision, state: 'dirty'});
    let saved: Draft;
    try { saved = this.store.require<Draft>('draft', (await this.drafts.save(draft.id, revision, 'clean')).id); }
    catch (error) {
      // 保存失败时保留变体内容作为待处理草稿；用户可在冲突界面选择保留或放弃。
      throw error;
    }
    const applyId = crypto.randomUUID();
    // 当前接入标记写到主工作项附件；附件写入会推进 updated，随后同步主草稿基线，避免下次保存误报冲突。
    const markerUpdated = await this.writeActiveMarker(variant.target, variant.mainWorkItemId, variant.workItemId, saved.baseHtml, applyId);
    const serverUpdated = markerUpdated ?? saved.baseUpdated;
    if (serverUpdated !== saved.baseUpdated) this.store.put('draft', saved.id, {...saved, baseUpdated: serverUpdated});
    const apply: VariantApply = {
      id: applyId, target: variant.target, mainWorkItemId: variant.mainWorkItemId,
      variantWorkItemId: variant.workItemId, previousVariantWorkItemId, previousHtml, previousUpdated,
      serverUpdated, at: Date.now(), state: 'applied',
    };
    this.store.put('variant-apply', apply.id, apply);
    this.store.put('variant-active', this.activeKey(variant.target, variant.mainWorkItemId), {
      target: variant.target, mainWorkItemId: variant.mainWorkItemId,
      variantWorkItemId: variant.workItemId, mainUpdated: serverUpdated,
      applyId: apply.id, at: Date.now(),
    });
    // 撤销快照只保留最近 20 次，避免本地状态库随接入次数无限增长。
    for (const old of this.applies(variant.target, variant.mainWorkItemId).slice(20)) this.store.remove('variant-apply', old.id);
    return {draft: this.drafts.read(saved.id), apply, variant, defaultVariant};
  }
  private resolveVariant(target: Target, id: string) {
    if (id.startsWith('default:')) {
      const workItemId = id.slice('default:'.length);
      if (!workItemId) throw Error('VARIANT_NOT_FOUND');
      return {workItemId, scope: undefined as VariantScope | undefined, record: undefined as Variant | undefined, label: '默认', mainWorkItemId: workItemId};
    }
    const record = this.record(id);
    if (!sameTarget(record.target, target)) throw Error('VARIANT_TARGET_MISMATCH');
    return {workItemId: record.workItemId, scope: this.scope(record), record, label: record.label, mainWorkItemId: record.mainWorkItemId};
  }
  /** 详细配置存放在变体工作项的 sidebar-variant.json 附件中，随 Polarion 走。 */
  async details(target: Target, id: string) {
    const remote = this.remote();
    if (!remote.metadataRead) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    const resolved = this.resolveVariant(target, id);
    const raw = await remote.metadataRead(target, resolved.workItemId, resolved.scope);
    let item: RemoteItem | undefined;
    if (resolved.record) {
      try { item = await remote.read(target, resolved.workItemId, resolved.scope); } catch { item = undefined; }
    }
    // 名称显示远端标题/元数据；本地 record 可能还停在另一台机器改名前的旧值。
    const label = resolved.record ? this.remoteLabel(item, raw, resolved.record.label) : '默认';
    return this.normalizeDetails(raw ?? resolved.record?.details ?? null, label);
  }
  async saveDetails(target: Target, id: string, details: VariantDetails) {
    const remote = this.remote();
    if (!remote.metadataWrite) throw Error('VARIANT_BACKEND_UNAVAILABLE');
    const resolved = this.resolveVariant(target, id);
    let item: RemoteItem | undefined;
    if (resolved.record) {
      try { item = await remote.read(target, resolved.workItemId, resolved.scope); } catch { item = undefined; }
    }
    let raw: Record<string, unknown> | null = null;
    try { raw = remote.metadataRead ? await remote.metadataRead(target, resolved.workItemId, resolved.scope) : null; } catch { raw = null; }
    // 默认变体的名称跟随主工作项标题，不允许在详细配置里改名。
    let label = '默认';
    let renamed = false;
    if (resolved.record) {
      const remoteLabel = this.remoteLabel(item, raw, resolved.record.label);
      const requested = details.label.trim();
      // 用户没有相对本地缓存改名时沿用远端名称，避免旧界面/旧缓存把另一台机器的重命名改回去。
      label = requested && requested !== resolved.record.label ? requested : remoteLabel;
      if (label !== remoteLabel) { await this.rename(resolved.record.id, label); renamed = true; }
    }
    const kind: 'default' | 'custom' = !resolved.record
      ? 'default'
      : raw?.kind === 'default' ? 'default' : raw?.kind === 'custom' ? 'custom' : this.kind(resolved.record);
    const payload = {
      format: 'polarion-sidebar-variant', version: 1, label,
      customer: details.customer, project: details.project, vehicle: details.vehicle,
      configuration: details.configuration, notes: details.notes,
      kind, mainWorkItemId: resolved.mainWorkItemId, updatedAt: Date.now(),
    };
    await remote.metadataWrite(target, resolved.workItemId, payload, resolved.scope);
    if (resolved.record) {
      const current = this.store.get<Variant>('variant', resolved.record.id) ?? resolved.record;
      this.store.put('variant', current.id, {
        ...current, label,
        title: renamed ? current.title : (item?.title ?? current.title),
        details: {customer: details.customer, project: details.project, vehicle: details.vehicle, configuration: details.configuration, notes: details.notes},
        updatedAt: Date.now(),
      });
    }
    return this.normalizeDetails(payload, label);
  }
  async undo(applyId: string) {
    const apply = this.store.get<VariantApply>('variant-apply', applyId);
    if (!apply) throw Error('VARIANT_APPLY_NOT_FOUND');
    return this.serial(`${apply.target.projectId}:${apply.target.document}:${apply.mainWorkItemId}`, () => this.undoLocked(apply));
  }
  private async undoLocked(apply: VariantApply) {
    if (apply.state !== 'applied') throw Error('VARIANT_APPLY_ALREADY_UNDONE');
    const view = await this.drafts.open(apply.target, apply.mainWorkItemId);
    const draft = this.store.require<Draft>('draft', view.id);
    if (draft.state !== 'clean') throw Error('MAIN_DRAFT_DIRTY');
    const main = await this.remote().read(apply.target, apply.mainWorkItemId);
    if ((main.updated ?? '') !== apply.serverUpdated) throw Error('MAIN_CHANGED_SINCE_APPLY');
    // 服务端读取期间本地草稿可能被编辑；不一致就停，避免把人工修改覆盖成撤销前快照。
    const current = this.store.require<Draft>('draft', draft.id);
    if (current.state !== 'clean' || current.revision !== draft.revision || current.html !== draft.html) throw Error('STALE_DRAFT');
    const revision = current.revision + 1;
    this.store.put('draft', current.id, {...current, html: apply.previousHtml, revision, state: 'dirty'});
    const restored = await this.drafts.save(current.id, revision, 'clean');
    const activeKey = this.activeKey(apply.target, apply.mainWorkItemId);
    if (apply.previousVariantWorkItemId === undefined) {
      // 接入时主正文不属于任何变体（例如直接编辑过）：撤销后保持“无当前变体”，不要伪造默认归属。
      this.store.remove('variant-active', activeKey);
    } else {
      const markerUpdated = await this.writeActiveMarker(apply.target, apply.mainWorkItemId, apply.previousVariantWorkItemId, restored.baseHtml, apply.id);
      const serverUpdated = markerUpdated ?? restored.baseUpdated;
      if (serverUpdated !== restored.baseUpdated) this.store.put('draft', restored.id, {...restored, baseUpdated: serverUpdated});
      this.store.put('variant-active', activeKey, {
        target: apply.target, mainWorkItemId: apply.mainWorkItemId,
        variantWorkItemId: apply.previousVariantWorkItemId, mainUpdated: serverUpdated,
        applyId: apply.id, at: Date.now(),
      });
    }
    this.store.put('variant-apply', apply.id, {...apply, state: 'undone'});
    return this.drafts.read(restored.id);
  }
  applies(target: Target, mainWorkItemId: string) {
    return this.store.list<VariantApply>('variant-apply').filter(a => sameTarget(a.target, target) && a.mainWorkItemId === mainWorkItemId).sort((a, b) => b.at - a.at);
  }
}
