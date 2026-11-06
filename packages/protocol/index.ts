import { z } from 'zod';

export const PROTOCOL = 1;
export const PermissionModeSchema=z.enum(['ask','auto','full']);
export type PermissionMode=z.infer<typeof PermissionModeSchema>;
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';
export const TurnDeliverySchema=z.enum(['queue','steer']);
export type TurnDelivery=z.infer<typeof TurnDeliverySchema>;
export const DEFAULT_TURN_DELIVERY: TurnDelivery = 'queue';
export const GuidelineKindSchema=z.enum(['send','library']);
export type GuidelineKind=z.infer<typeof GuidelineKindSchema>;
export const GuidelineFileSchema=z.object({
  path:z.string().trim().min(1).max(1000),
  label:z.string().trim().max(80).default(''),
});
export type GuidelineFile=z.infer<typeof GuidelineFileSchema>;
export const MAX_GUIDELINE_FILES = 8;
export const GuidelineSchema=z.object({
  id:z.string().uuid(),kind:GuidelineKindSchema,name:z.string().trim().min(1).max(60),
  description:z.string().trim().max(200).default(''),
  content:z.string().max(60000).default(''),
  files:z.array(GuidelineFileSchema).max(MAX_GUIDELINE_FILES).default([]),
  /** 旧版单文件路径；读取时折叠进 files，保存后不再写入。 */
  file:z.string().max(1000).default(''),
});
export type Guideline=z.infer<typeof GuidelineSchema>;
/** 兼容旧数据：单文件字段折叠为带备注的文件列表。 */
export function normalizeGuideline(guideline: Guideline): Guideline {
  const files = guideline.files ?? [];
  if (!files.length && (guideline.file ?? '').trim()) return { ...guideline, files: [{ path: guideline.file.trim(), label: '' }], file: '' };
  return { ...guideline, files };
}
export const TargetSchema = z.object({
  origin: z.literal('https://polarion.pufafen.com'),
  projectId: z.string().min(1).max(160).regex(/^[\w.-]+$/),
  document: z.string().min(1).max(512),
});
export type Target = z.infer<typeof TargetSchema>;
export const ContextSchema = z.object({
  id: z.string().uuid(), target: TargetSchema, workItemId: z.string().max(100).optional(),
  text: z.string().max(60000), prefix: z.string().max(300).default(''), suffix: z.string().max(300).default(''),
  source: z.enum(['selection', 'context-menu', 'editor', 'work-item']), capturedAt: z.number(),
  pinned: z.boolean().default(false),
});
export type Context = z.infer<typeof ContextSchema>;
export const SettingsSchema = z.object({
  defaultEngine: z.enum(['claude', 'codex']), claudeModel: z.string().max(120),
  codexModel: z.literal('gpt-6.1-sol'),
  assistantFontSize: z.number().int().min(9).max(18).default(13),
  defaultPermissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE),
  defaultTurnDelivery: TurnDeliverySchema.default(DEFAULT_TURN_DELIVERY),
  draftsFolder: z.string().max(1000).default(''),
  /** 变体工作项与主工作项的 Polarion 链接角色；留空时首次创建自动选择。 */
  variantLinkRole: z.string().max(120).default(''),
});
/** 变体工作项：项目级独立工作项，通过 Polarion 链接归属到一个主工作项。 */
export const VariantSchema = z.object({
  id: z.string().uuid(),
  target: TargetSchema,
  mainWorkItemId: z.string().min(1).max(100),
  workItemId: z.string().min(1).max(100),
  label: z.string().trim().min(1).max(120),
  title: z.string().max(500).default(''),
  linkRole: z.string().max(120).default(''),
  linkState: z.enum(['linked', 'pending']).default('linked'),
  /** default 表示从主工作项正文捕获的默认变体；custom 是用户新建的变体。 */
  kind: z.enum(['default', 'custom']).default('custom'),
  details: z.object({
    customer: z.string().max(200).default(''),
    project: z.string().max(200).default(''),
    vehicle: z.string().max(200).default(''),
    configuration: z.string().max(200).default(''),
    notes: z.string().max(4000).default(''),
  }).optional(),
  createdAt: z.number(),
  updatedAt: z.number().default(0),
});
export type Variant = z.infer<typeof VariantSchema>;
export const VariantDetailsSchema = z.object({
  label: z.string().trim().min(1).max(120),
  customer: z.string().trim().max(200).default(''),
  project: z.string().trim().max(200).default(''),
  vehicle: z.string().trim().max(200).default(''),
  configuration: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(4000).default(''),
});
export type VariantDetails = z.infer<typeof VariantDetailsSchema>;
export type VariantScope = { mainWorkItemId: string; role: string };
/** 一次“接入主工作项”的快照，用于差异审阅与撤销。 */
export const VariantApplySchema = z.object({
  id: z.string().uuid(),
  target: TargetSchema,
  mainWorkItemId: z.string().min(1).max(100),
  variantWorkItemId: z.string().min(1).max(100),
  previousHtml: z.string().max(10_000_000),
  previousUpdated: z.string().max(120).default(''),
  serverUpdated: z.string().max(120).default(''),
  at: z.number(),
  state: z.enum(['applied', 'undone']).default('applied'),
  /** 接入前处于“当前接入”的变体；撤销后恢复该记录。 */
  previousVariantWorkItemId: z.string().max(100).optional(),
});
export type VariantApply = z.infer<typeof VariantApplySchema>;
export const VariantActiveSchema = z.object({
  target: TargetSchema,
  mainWorkItemId: z.string().min(1).max(100),
  /** 空字符串表示主工作项自身的默认正文。 */
  variantWorkItemId: z.string().max(100).default(''),
  mainUpdated: z.string().max(120).default(''),
  applyId: z.string().uuid().optional(),
  at: z.number(),
});
export type VariantActive = z.infer<typeof VariantActiveSchema>;
const id = z.string().uuid();
export const CommandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('health') }),
  z.object({ method: z.literal('engine.capabilities'), target: TargetSchema, sessionId: id.optional(), refresh: z.boolean().default(false) }),
  z.object({ method: z.literal('engine.context'), sessionId: id, refresh: z.boolean().default(false) }),
  z.object({method:z.literal('engine.manage'),sessionId:id,action:z.enum(['reload-skills','reconnect-mcp']),server:z.string().min(1).max(200).optional()}),
  z.object({ method: z.literal('settings.read') }),
  z.object({ method: z.literal('polarion.credentials.status') }),
  z.object({ method: z.literal('polarion.credentials.check') }),
  z.object({ method: z.literal('polarion.credentials.save'), username: z.string().trim().min(1).max(200), password: z.string().min(1).max(2048) }),
  z.object({ method: z.literal('settings.write'), settings: SettingsSchema }),
  z.object({ method: z.literal('guidelines.list') }),
  z.object({ method: z.literal('guidelines.save'), guideline: GuidelineSchema }),
  z.object({ method: z.literal('guidelines.delete'), id: z.string().uuid() }),
  z.object({ method: z.literal('dialog.pickFolder'), title: z.string().max(120).default('选择共享草稿存储文件夹'), defaultPath: z.string().max(1000).default('') }),
  z.object({ method: z.literal('dialog.pickFiles'), title: z.string().max(120).default('选择指令文件'), defaultPath: z.string().max(1000).default('') }),
  z.object({ method: z.literal('sessions.list'), projectId: z.string().max(160) }),
  z.object({ method: z.literal('sessions.create'), target: TargetSchema, title: z.string().min(1).max(100) }),
  z.object({ method: z.literal('sessions.rename'), sessionId: id, title: z.string().min(1).max(100) }),
  z.object({ method: z.literal('sessions.archive'), sessionId: id, archived: z.boolean() }),
  z.object({ method: z.literal('sessions.group'), sessionId: id, group: z.string().max(40) }),
  z.object({ method: z.literal('sessions.delete'), sessionId: id }),
  z.object({ method: z.literal('sessionGroups.list') }),
  z.object({ method: z.literal('sessionGroups.create'), name: z.string().min(1).max(40) }),
  z.object({ method: z.literal('sessionGroups.delete'), name: z.string().min(1).max(40) }),
  z.object({ method: z.literal('sessions.read'), sessionId: id, after: z.number().int().nonnegative().default(0) }),
  z.object({ method: z.literal('runs.start'), permissionMode:PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), delivery:TurnDeliverySchema.default(DEFAULT_TURN_DELIVERY), guidelineId:z.string().uuid().optional(), sessionId: id, requestId: id, target: TargetSchema, prompt: z.string().min(1).max(40000), contexts: z.array(ContextSchema).max(12), attachments: z.array(id).max(12).default([]) }),
  z.object({ method: z.literal('assets.begin'), target: TargetSchema, name: z.string().min(1).max(240), mime: z.string().max(160), size: z.number().int().positive().max(25*1024*1024) }),
  z.object({ method: z.literal('assets.chunk'), assetId: id, offset: z.number().int().nonnegative(), data: z.string().max(700000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }),
  z.object({ method: z.literal('assets.finish'), assetId: id }),
  z.object({ method: z.literal('assets.read'), assetId: id, offset: z.number().int().nonnegative().default(0), length: z.number().int().positive().max(512*1024).default(512*1024) }),
  z.object({ method: z.literal('assets.metadata'), assetId: id }),
  z.object({ method: z.literal('assets.text'), assetId: id }),
  z.object({method:z.literal('images.resolve'),target:TargetSchema,workItemId:z.string().min(1).max(100),src:z.string().max(1000)}),
  z.object({method:z.literal('boards.create'),draftId:id,title:z.string().min(1).max(160),sourceId:id,previewId:id,parentSnapshotId:id.optional()}),
  z.object({method:z.literal('boards.open'),draftId:id,src:z.string().max(1000)}),
  z.object({method:z.literal('boards.proposals'),draftId:id,objectId:id,snapshotId:id}),
  z.object({method:z.literal('boards.decide'),draftId:id,proposalId:id,action:z.enum(['apply','reject'])}),
  z.object({ method: z.literal('runs.cancel'), runId: id }),
  z.object({ method: z.literal('runs.retry'), runId: id, requestId: id }),
  z.object({ method: z.literal('permissions.answer'), runId: id, permissionId: id, allow: z.boolean(), scope: z.enum(['once', 'run']).default('once') }),
  z.object({ method: z.literal('interactions.answer'), runId: id, interactionId: id, action: z.enum(['accept','decline','cancel']), values: z.record(z.string(),z.union([z.string().max(20000),z.number().finite(),z.boolean(),z.array(z.string().max(20000)).max(100)])).default({}) }),
  z.object({ method: z.literal('workitems.peek'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('workitems.search'), target: TargetSchema, query: z.string().trim().max(120).default(''), limit: z.number().int().min(1).max(20).default(8) }),
  z.object({ method: z.literal('workitems.read'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  /** 当前文档的全部工作项（含 outline 序号），供「软件需求分析总览」一次取全。 */
  z.object({ method: z.literal('document.outline'), target: TargetSchema }),
  z.object({ method: z.literal('drafts.list'), target: TargetSchema }),
  z.object({ method: z.literal('drafts.delete'), draftIds: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ method: z.literal('drafts.open'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('drafts.read'), draftId: id }),
  z.object({ method: z.literal('drafts.rich.read'), draftId: id }),
  z.object({method:z.literal('boards.generation.begin'),draftId:id,localBoardId:id,baselineSignature:z.string().regex(/^[a-f0-9]{64}$/)}),
  z.object({method:z.literal('boards.generation.proposals'),draftId:id,requestId:id}),
  z.object({method:z.literal('boards.generation.open'),draftId:id,requestId:id}),
  z.object({method:z.literal('boards.generation.decide'),draftId:id,proposalId:id,action:z.enum(['apply','reject']),baselineSignature:z.string().regex(/^[a-f0-9]{64}$/)}),
  z.object({ method: z.literal('drafts.rich.apply'), draftId: id, editorId: id, expectedRevision: z.number().int().nonnegative(), document: z.record(z.string(), z.unknown()) }),
  z.object({ method: z.literal('drafts.reconcile'), draftId: id }),
  z.object({method:z.literal('drafts.conflict.read'),draftId:id}),
  z.object({method:z.literal('drafts.conflict.resolve'),draftId:id,expectedRevision:z.number().int().nonnegative(),remoteHash:z.string().regex(/^[a-f0-9]{64}$/),remoteUpdated:z.string(),strategy:z.enum(['keep-local','use-remote'])}),
  z.object({ method: z.literal('drafts.replaceText'), draftId: id, expectedRevision: z.number().int().nonnegative(), nodeId: z.string(), expectedText: z.string(), text: z.string().max(100000) }),
  z.object({ method: z.literal('drafts.save'), draftId: id, expectedRevision: z.number().int().nonnegative(), nativeState: z.enum(['clean', 'dirty', 'unknown']) }),
  z.object({method:z.literal('variants.list'),target:TargetSchema,mainWorkItemId:z.string().min(1).max(100)}),
  z.object({method:z.literal('variants.roles'),target:TargetSchema}),
  z.object({method:z.literal('variants.create'),target:TargetSchema,mainWorkItemId:z.string().min(1).max(100),label:z.string().trim().min(1).max(120),title:z.string().trim().max(500).default(''),copy:z.boolean().default(true),role:z.string().max(120).default('')}),
  z.object({method:z.literal('variants.rename'),variantId:id,label:z.string().trim().min(1).max(120)}),
  z.object({method:z.literal('variants.link'),variantId:id}),
  z.object({method:z.literal('variants.unlink'),variantId:id}),
  z.object({method:z.literal('variants.open'),variantId:id}),
  z.object({method:z.literal('variants.preview'),variantId:id}),
  z.object({method:z.literal('variants.apply'),variantId:id}),
  z.object({method:z.literal('variants.undo'),applyId:id}),
  z.object({method:z.literal('variants.details.read'),target:TargetSchema,variantId:z.string().min(1).max(160)}),
  z.object({method:z.literal('variants.details.write'),target:TargetSchema,variantId:z.string().min(1).max(160),details:VariantDetailsSchema}),
]);
export type Command = z.infer<typeof CommandSchema>;
/** 总览用的轻量条目：只要编号、标题、状态与 outline 序号。 */
export type DocumentOutlineItem = { id: string; title: string; status: string; type: string; outline: string };
export type DocumentOutline = { documentId: string; title: string; items: DocumentOutlineItem[] };
export const RequestSchema = z.object({ protocol: z.literal(PROTOCOL), id, command: CommandSchema });
export type Request = z.infer<typeof RequestSchema>;
export type Reply = { protocol: 1; id: string; ok: true; value: unknown } | { protocol: 1; id: string; ok: false; error: string };
export type Session = { id: string; target: Target; title: string; engine: 'claude' | 'codex'; model: string; nativeId?: string; createdAt: number; updatedAt: number; archived?: boolean; group?: string };
export type SessionGroup = { name: string; createdAt: number };
export type ContextUsage = { usedTokens: number; windowTokens: number; percentage: number; model: string; updatedAt: number; categories: { name: string; tokens: number; kind: string }[] };
export type EngineContext = { usage: ContextUsage | null; connected: boolean; compacting: boolean };
export type Run = { permissionMode?:PermissionMode; delivery?:TurnDelivery; guidelineId?:string; id: string; sessionId: string; requestId: string; target: Target; prompt: string; contexts: Context[]; attachments?: string[]; status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; startedAt: number; endedAt?: number; error?: string };
export type RunEvent = { seq: number; sessionId: string; runId: string; kind: string; data: unknown; at: number };
export type Draft = { id: string; target: Target; workItemId: string; title: string; baseHtml: string; html: string; baseUpdated: string; revision: number; savedAt?: number; state: 'clean' | 'dirty' | 'conflict' | 'uncertain'; /** 该草稿属于某个变体时，记录其主工作项。 */ variantOf?: string };
export type EngineCapabilities = { at: number; engine: 'claude'; connected?: boolean; commands: { name: string; description: string; argumentHint: string; aliases: string[]; builtin: boolean }[]; servers: { name: string; status: string; scope?: string; tools: { name: string; description?: string }[] }[]; agents: { name: string; description: string }[]; models: { value: string; displayName: string }[] };
export type Asset = { id: string; target: Target; name: string; mime: string; size: number; received: number; state: 'uploading' | 'ready'; extraction: 'text' | 'image' | 'native-file' | 'failed'; text?: string; textLength?: number; truncated?: boolean; sha256?: string; createdAt: number };
export type InteractionValues = Record<string,string|number|boolean|string[]>;
export type NativeInteraction = { id:string; kind:'question'|'mcp-form'|'mcp-url'; title:string; message:string; url?:string; fields:{key:string;label:string;description?:string;type:'string'|'number'|'integer'|'boolean'|'array';required:boolean;choices?:{value:string;label:string;description?:string}[];allowOther?:boolean;secret?:boolean;minimum?:number;maximum?:number;minLength?:number;maxLength?:number}[] };

export function routeFromUrl(url: string): Target | null {
  try {
    const u = new URL(url);
    if (u.origin !== 'https://polarion.pufafen.com') return null;
    const m = u.hash.match(/^#\/project\/([^/]+)\/wiki\/(.+?)(?:\?|$)/);
    return m ? TargetSchema.parse({ origin: u.origin, projectId: decodeURIComponent(m[1]!), document: decodeURIComponent(m[2]!) }) : null;
  } catch { return null; }
}

export function sameTarget(a: Target, b: Target) { return a.origin === b.origin && a.projectId === b.projectId && a.document === b.document; }
