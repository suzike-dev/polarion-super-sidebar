import { z } from 'zod';
import { RulePackSchema } from '../core/requirement-lint.ts';

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
export const PROJECT_EVENT_LIMIT = 500;
export function projectWorkItemUrl(target: Target, workItemId: string) {
  return `${target.origin}/polarion/#/project/${encodeURIComponent(target.projectId)}/workitem?id=${encodeURIComponent(workItemId)}`;
}
export function projectDocumentUrl(target: Target, document: string) {
  return `${target.origin}/polarion/#/project/${encodeURIComponent(target.projectId)}/wiki/${document.split('/').map(encodeURIComponent).join('/')}`;
}
export const MAX_CONTEXT_TEXT = 60000;
export const ContextSchema = z.object({
  id: z.string().uuid(), target: TargetSchema, workItemId: z.string().max(100).optional(),
  text: z.string().max(MAX_CONTEXT_TEXT), prefix: z.string().max(300).default(''), suffix: z.string().max(300).default(''),
  source: z.enum(['selection', 'context-menu', 'editor', 'work-item']), capturedAt: z.number(),
  pinned: z.boolean().default(false),
});
export type Context = z.infer<typeof ContextSchema>;
/** Absolute ProseMirror positions in this revision, with both the finding and its enclosing sentence. */
const QualityRewriteSchema = z.object({
  draftId: z.string().uuid(), workItemId: z.string().min(1).max(100), expectedRevision: z.number().int().nonnegative(),
  ruleId: z.string().min(1).max(160), message: z.string().max(500),
  from: z.number().int().nonnegative(), to: z.number().int().positive(), sentence: z.string().min(1).max(60000),
  matchFrom: z.number().int().nonnegative(), matchTo: z.number().int().positive(), matchedText: z.string().min(1).max(160),
}).refine(s => s.to - s.from === s.sentence.length && s.from <= s.matchFrom && s.matchTo <= s.to &&
  s.matchTo - s.matchFrom === s.matchedText.length && s.sentence.slice(s.matchFrom - s.from, s.matchTo - s.from) === s.matchedText,
  { message: '体检发现的句子与命中位置不一致，请重新体检。' });
export type QualityRewrite = z.infer<typeof QualityRewriteSchema>;
/** 飞书群自定义机器人：配置存在 Polarion 项目（一人配置、全项目共用）；webhook 是凭证，请勿外传。 */
export const FeishuGroupSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  webhook: z.string().trim().url().max(500),
  /** 机器人开启「签名校验」时填写。 */
  secret: z.string().max(200).default(''),
});
export type FeishuGroup = z.infer<typeof FeishuGroupSchema>;
/* ------------------------------------------------------------------ */
/* 动态工作流：用户自定义多步骤流程，保存后可反复对当前工作项运行。      */
/* 设计与分期见 docs/动态工作流引擎设计_20261119.md。                   */
/* ------------------------------------------------------------------ */
export const MAX_WORKFLOW_STEPS = 30;
/** 提示词模板可引用：{{item}} 当前工作项、{{prev}} 上一步结果、{{steps.<id>}} 指定步骤结果。 */
export const WorkflowStepSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(20000),
  guidelineId: z.string().uuid().optional(),
  /** 该步完成后暂停，等人工确认再继续。 */
  pause: z.boolean().default(false),
  /** 检查步：解析结果末行的结论标记。PASS 继续；FAIL 回到 retryTo 步返工（受 maxRetries 限制）；NEED_MANUAL 或缺标记转人工暂停。 */
  check: z.object({
    /** 不通过时要回到的步骤 id，必须在检查步之前。 */
    retryTo: z.string().trim().min(1).max(60),
    /** 返工次数上限，用完仍 FAIL 则转人工暂停。 */
    maxRetries: z.number().int().min(1).max(5).default(1),
  }).optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export const WorkflowDefSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().min(1).max(160).regex(/^[\w.-]+$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  steps: z.array(WorkflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
  /** manual=面板手建；agent=对话 save_workflow 存下或动态拆解后转正；dynamic=目标拆解的临时稿，可保存复用。 */
  origin: z.enum(['manual', 'agent', 'dynamic']).default('manual'),
  /** 每日定时触发（HH:mm）；配合 document 记录触发目标。 */
  scheduleAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  /** 定时触发时运行的目标文档。 */
  document: z.string().max(500).optional(),
  createdAt: z.number(),
  updatedAt: z.number().default(0),
});
export type WorkflowDef = z.infer<typeof WorkflowDefSchema>;
/** 运行实例里一个步骤的执行状态。 */
export type WorkflowStepRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';
export type WorkflowStepRun = { stepId: string; runId?: string; gateProposalId?: string; status: WorkflowStepRunStatus; /** 上一步回答尾部，供 {{prev}}/{{steps.<id>}} 插值。返工后保留上一轮结果。 */ resultTail?: string; /** 检查步已触发的返工次数。 */ retries?: number };
export type WorkflowRunStatus = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
/** 一次工作流运行：启动时快照定义，之后编辑定义不影响在跑实例。 */
export type WorkflowRun = {
  id: string; defId: string; defName: string; sessionId: string; target: Target; contexts: Context[];
  permissionMode: PermissionMode; /** 触发时的附注，注入每一步提示词。 */ note?: string;
  status: WorkflowRunStatus; /** 不变式：下一个要执行的步骤下标（暂停时指向已完成的暂停步；检查步 FAIL 返工时回退到返工目标）。 */
  currentIndex: number; steps: WorkflowStepRun[]; def: { name: string; steps: WorkflowStep[] };
  startedAt: number; updatedAt: number; endedAt?: number; error?: string;
};
/** UI 用的实例视图：剥离冻结上下文与结果长文。 */
export type WorkflowStepRunView = { stepId: string; title: string; status: WorkflowStepRunStatus; pause: boolean; retries?: number };
export type WorkflowRunView = {
  id: string; defId: string; defName: string; status: WorkflowRunStatus;
  currentIndex: number; total: number; steps: WorkflowStepRunView[];
  note?: string; error?: string; startedAt: number; updatedAt: number; endedAt?: number;
};
/** 运行轨迹：历史实例 + 每步执行证据（结果摘要，来自落库 resultTail）。 */
export type WorkflowHistoryStep = { stepId: string; title: string; status: WorkflowStepRunStatus; retries?: number; resultPreview?: string; checkRule?: boolean };
export type WorkflowHistoryItem = {
  id: string; defName: string; status: WorkflowRunStatus; startedAt: number; endedAt?: number;
  /** 旧版轨迹可能没有会话编号，工作项编号取自运行时的上下文。 */
  sessionId?: string; workItemId?: string;
  note?: string; error?: string; steps: WorkflowHistoryStep[];
};
/* ------------------------------------------------------------------ */
/* 需求模板库：内置 5 类必备模板（场景/计算/算法/状态机/混合）+ 个人自定义。*/
/* 软件默认 = 代码内置基线（packages/core/requirement-templates.ts）；    */
/* 个人生效 = 本机 Host 覆盖/自定义（req-template）。                   */
/* ------------------------------------------------------------------ */
/** 模板类别：内置 5 类之外允许用户新增类型（key 唯一，label 展示）。 */
export const TemplateCategorySchema = z.string().trim().min(1).max(40).regex(/^[\w\u4e00-\u9fff-]+$/, '类别只允许中文、字母、数字、下划线与连字符');
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;
/** 类别记录：label=展示名，hint=使用时机说明（模板库与 AI 注入共用）。 */
export const TemplateCategoryRecordSchema = z.object({
  key: TemplateCategorySchema,
  label: z.string().trim().min(1).max(40),
  hint: z.string().trim().max(500).default(''),
  /** builtin=true 的类别不可删除。 */
  builtin: z.boolean().default(false),
});
export type TemplateCategoryRecord = z.infer<typeof TemplateCategoryRecordSchema>;
export const RequirementTemplateSchema = z.object({
  /** 内置模板 id 固定（req-tpl-*）；自定义模板为 uuid。 */
  id: z.string().min(1).max(60),
  category: TemplateCategorySchema,
  name: z.string().trim().min(1).max(80),
  /** 该模板在什么情况下使用（模板库悬浮页展示）。 */
  usageNote: z.string().trim().max(500).default(''),
  /** builtin=代码内置基线或其个人覆盖；custom=个人自定义。 */
  origin: z.enum(['builtin', 'custom']),
  /** 本地记录版本：覆盖内置时=内置基线 version；自定义模板从 1 递增。 */
  version: z.number().int().min(1).max(999),
  /** 本地已覆盖内置基线（UI 显示「已自定义」徽标与「恢复标准」操作）。 */
  overridden: z.boolean().default(false),
  html: z.string().min(1).max(200000),
  updatedAt: z.number(),
});
export type RequirementTemplate = z.infer<typeof RequirementTemplateSchema>;

export const SettingsSchema = z.object({
  defaultEngine: z.enum(['claude', 'codex']), claudeModel: z.string().max(120),
  codexModel: z.literal('gpt-6.1-sol'),
  assistantFontSize: z.number().int().min(9).max(18).default(13),
  /** 界面主题：全部浮层与侧栏统一切换（CSS 令牌组覆盖）；默认深林绿保留。 */
  theme: z.enum(['forest', 'porcelain', 'paper', 'bamboo', 'autumn', 'sky', 'tangerine', 'rouge', 'indigo', 'lotus']).default('forest'),
  defaultPermissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE),
  defaultTurnDelivery: TurnDeliverySchema.default(DEFAULT_TURN_DELIVERY),
  draftsFolder: z.string().max(1000).default(''),
  /** 变体工作项与主工作项的 Polarion 链接角色；留空时首次创建自动选择。 */
  variantLinkRole: z.string().max(120).default(''),
  /** 变更记录工作项类型；留空时自动尝试项目已有的常见类型。 */
  changeRecordType: z.string().max(120).default(''),
  /** AI 修改后自动保存：开启时每轮结束把本轮改过的脏草稿写入 Polarion 并回读；关闭时只落本地草稿由用户手动保存。 */
  agentAutoSave: z.boolean().default(false),
  /** 参考模板（设置→模板库胶囊开关）：开启后 AI 新建/改造工作项时自动按匹配类别的需求模板组织正文。 */
  useRequirementTemplates: z.boolean().default(false),
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
/* ------------------------------------------------------------------ */
/* Simulink 模型关联：项目级模型根目录配置 + 工作项实现模块备注。        */
/* ------------------------------------------------------------------ */
/** 一个模型模块（以 .slx 所在目录为单位）；key 用相对目录名，跨机器稳定。 */
export const ModelModuleSchema = z.object({
  key: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  dir: z.string().max(500).default(''),
  model: z.string().max(400).default(''),
  dictionary: z.string().max(400).nullable().default(null),
  interface: z.string().max(400).nullable().default(null),
  kind: z.enum(['module', 'integration', 'library', 'test', 'other']).default('module'),
  excluded: z.boolean().default(false),
});
export type ModelModule = z.infer<typeof ModelModuleSchema>;
/** 一个模型根目录（如 ModelandCode 或 ModelandCode_BSEV 变体）；模块快照随配置保存。 */
export const ModelRootSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  path: z.string().trim().max(1000).default(''),
  modules: z.array(ModelModuleSchema).max(500).default([]),
  projectFile: z.string().max(400).nullable().default(null),
  dictionaries: z.array(z.string().max(400)).max(100).default([]),
  scannedAt: z.number().default(0),
  note: z.string().max(2000).default(''),
});
export type ModelRoot = z.infer<typeof ModelRootSchema>;
/** 工作项的「实现模块」备注：每个 root 下多选模块；存工作项自己的附件，跨模块实现可多选。 */
export const ModelNoteMarkSchema = z.object({ rootId: z.string().uuid(), modules: z.array(z.string().trim().min(1).max(200)).max(60) });
export const ModelNoteSchema = z.object({
  format: z.literal('polarion-sidebar-model-note'),
  version: z.literal(1),
  marks: z.array(ModelNoteMarkSchema).max(8).default([]),
});
export type ModelNote = z.infer<typeof ModelNoteSchema>;
export type ModelNoteMark = z.infer<typeof ModelNoteMarkSchema>;
export function emptyModelNote(): ModelNote { return { format: 'polarion-sidebar-model-note', version: 1, marks: [] }; }
/* ------------------------------------------------------------------ */
/* S3 提案管线：一切写皆提案（diff 预览 → 审批 → 原子应用 → 变更记录）。 */
/* 与 apps/host/proposals.ts 的 Proposal 结构保持一致。                 */
/* ------------------------------------------------------------------ */
export const ProposalSourceSchema = z.enum(['agent', 'lint', 'workflow', 'manual']);
export type ProposalSource = z.infer<typeof ProposalSourceSchema>;
export const ProposalOpSchema = z.discriminatedUnion('kind', [
  /** 按节点原子替换：来自编辑器的精确位置（nodeId 指 lossless 源节点）。 */
  z.object({
    kind: z.literal('replace-text'),
    draftId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    nodeId: z.string().min(1).max(200),
    expectedText: z.string().max(100000),
    text: z.string().max(100000),
  }),
  /** 全文逐字替换：术语统一等跨条目修复，保留结构与格式。 */
  z.object({
    kind: z.literal('replace-all-text'),
    draftId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    from: z.string().min(1).max(4000),
    to: z.string().max(4000),
    caseSensitive: z.boolean().default(true),
    /** 术语提案在 expectedRevision 上预览并确认的 PM 文本范围。 */
    lintMatches: z.array(z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive() })).optional(),
  }),
]);
export type ProposalOp = z.infer<typeof ProposalOpSchema>;
/** Tool calls and gates are decided only by their owning engine, never via proposals.approve. */
export type RuntimeProposalOp = {kind: 'tool'; runId: string; toolUseId: string; tool: string; draftId?: string; workflowRunId?: string} | {kind: 'gate'; workflowRunId: string; stepId: string};
export type Proposal = {
  id: string; source: ProposalSource; target: Target; workItemId?: string; summary: string;
  op: ProposalOp | RuntimeProposalOp; status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  createdAt: number; decidedAt?: number; appliedAt?: number; error?: string; matchCount?: number;
  diffPreview?: ReturnType<typeof import('../core/text-diff.ts').diffText>;
  includesDraftEdits?: boolean; savedToPolarion?: boolean; recordId?: string; recordError?: string;
};
const id = z.string().uuid();
/** 门禁策略：逐门开关 + 质量分阈值（0 关闭）；项目级覆盖，默认全开。 */
export const GatePolicySchema = z.object({
  enabled: z.object({ quality: z.boolean().default(true), criterion: z.boolean().default(true), upstream: z.boolean().default(true), module: z.boolean().default(true) }).default({ quality: true, criterion: true, upstream: true, module: true }),
  minQualityScore: z.number().int().min(0).max(100).default(0),
});
export type GatePolicy = z.infer<typeof GatePolicySchema>;
export function defaultGatePolicy(): GatePolicy { return { enabled: { quality: true, criterion: true, upstream: true, module: true }, minQualityScore: 0 }; }
/** 项目基线快照：覆盖/体检/门禁的聚合指标，用于任意时间点对比（时间机器一期）。 */
export type SnapshotView = {
  id: string; at: number; label: string;
  coverage: { total: number; withModule: number; withUpstream: number; withVerification: number; orphans: number } | null;
  quality: { checked: number; clean: number; findings: number; score: number } | null;
  gates: { total: number; passed: number; byGate: Record<string, number> } | null;
  openIssues: number;
};

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
  z.object({ method: z.literal('runs.start'), qualityRewrite: QualityRewriteSchema.optional(), autoSave: z.literal(false).optional(), permissionMode:PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), delivery:TurnDeliverySchema.default(DEFAULT_TURN_DELIVERY), guidelineId:z.string().uuid().optional(), useRequirementTemplates: z.boolean().optional(), sessionId: id, requestId: id, target: TargetSchema, prompt: z.string().min(1).max(40000), contexts: z.array(ContextSchema).max(12), attachments: z.array(id).max(12).default([]) }),
  // A distinct method makes older Hosts reject inspection instead of starting an unrestricted run.
  z.object({ method: z.literal('runs.inspectQuality'), sessionId: id, requestId: id, title: z.string().max(4000), sourceLabel: z.string().trim().min(1).max(300),
    snapshot: ContextSchema.extend({ workItemId: z.string().min(1).max(100), source: z.literal('editor'), pinned: z.literal(false) }) }),
  z.object({ method: z.literal('runs.retryQualityInspection'), runId: id, requestId: id }),
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
  /** 把一条排队指令提升为引导：立即打断当前任务并插队优先执行。 */
  z.object({ method: z.literal('runs.steer'), runId: id }),
  /** 经验沉淀：读取/提炼/改写/清空本项目本地经验文件。 */
  z.object({ method: z.literal('experience.read'), projectId: z.string().min(1).max(160) }),
  z.object({ method: z.literal('experience.distill'), sessionId: id }),
  /** expectedUpdated：写入时校验读取时看到的版本（文件 mtime）；不符即冲突，防止两页面/外部编辑互相覆盖。 */
  z.object({ method: z.literal('experience.write'), projectId: z.string().min(1).max(160), text: z.string().max(20000), expectedUpdated: z.number().optional() }),
  z.object({ method: z.literal('experience.clear'), projectId: z.string().min(1).max(160) }),
  /** 经验共编：以对话里的基准稿 + 修改意图生成完整下一稿，不落盘；应用由 experience.write 完成。 */
  z.object({ method: z.literal('experience.refine'), text: z.string().max(20000), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(4000) })).min(1).max(24), model: z.string().min(1).max(60).optional() }),
  z.object({ method: z.literal('permissions.answer'), runId: id, permissionId: id, allow: z.boolean(), scope: z.enum(['once', 'run']).default('once') }),
  z.object({ method: z.literal('interactions.answer'), runId: id, interactionId: id, action: z.enum(['accept','decline','cancel']), values: z.record(z.string(),z.union([z.string().max(20000),z.number().finite(),z.boolean(),z.array(z.string().max(20000)).max(100)])).default({}) }),
  z.object({ method: z.literal('workitems.peek'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('workitems.search'), target: TargetSchema, query: z.string().trim().max(120).default(''), limit: z.number().int().min(1).max(20).default(8) }),
  z.object({ method: z.literal('workitems.read'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  /** 当前文档的全部工作项（含 outline 序号），供「软件需求分析总览」一次取全。 */
  z.object({ method: z.literal('document.outline'), target: TargetSchema }),
  z.object({ method: z.literal('changes.workspace.read'), target: TargetSchema }),
  z.object({ method: z.literal('changes.session.start'), target: TargetSchema, note: z.string().max(2000).default('') }),
  z.object({ method: z.literal('changes.session.cancel'), sessionId: id }),
  z.object({ method: z.literal('changes.session.finish'), sessionId: id }),
  /** 补建变更：按两个时间点还原整篇文档后直接生成记录，不依赖事先设定的基准。 */
  z.object({ method: z.literal('changes.compare.options'), target: TargetSchema }),
  z.object({ method: z.literal('changes.compare.create'), target: TargetSchema, beforeAt: z.number().int().positive(), afterAt: z.number().int().positive() }),
  z.object({ method: z.literal('changes.job.read'), jobId: id }),
  z.object({ method: z.literal('changes.record.read'), recordId: id }),
  /** 悬停预览：只返回工作项与摘要，不传正文 HTML/图片。 */
  z.object({ method: z.literal('changes.record.preview'), recordId: id }),
  z.object({ method: z.literal('changes.record.note'), recordId: id, note: z.string().max(4000) }),
  z.object({ method: z.literal('changes.record.delete'), recordId: id }),
  z.object({ method: z.literal('changes.record.summarize'), recordId: id, force: z.boolean().default(false) }),
  z.object({ method: z.literal('changes.share.publish'), recordId: id }),
  z.object({ method: z.literal('changes.share.stop') }),
  /** 变更卡片直发到项目配置的全部飞书群机器人；返回逐群结果。 */
  z.object({ method: z.literal('changes.share.feishu'), recordId: id }),
  /** 用当前填写的 webhook 实发一张测试卡片，无需先保存。 */
  z.object({ method: z.literal('changes.share.feishuTest'), webhook: z.string().trim().url().max(500), secret: z.string().max(200).default(''), projectId: z.string().max(160).default('') }),
  /** 项目共享的飞书推送群配置：Polarion 工作项为准，本机缓存兜底。 */
  z.object({ method: z.literal('changes.feishu.groups'), target: TargetSchema }),
  z.object({ method: z.literal('changes.feishu.groups.save'), target: TargetSchema, groups: z.array(FeishuGroupSchema).max(20) }),
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
  z.object({ method: z.literal('drafts.reconcile'), draftId: id, expectedRevision: z.number().int().nonnegative().optional() }),
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
  /* 动态工作流：定义存本机（v0.16 发布团队共享），运行实例按会话推进。 */
  z.object({ method: z.literal('workflows.list'), projectId: z.string().min(1).max(160) }),
  z.object({ method: z.literal('workflows.save'), def: WorkflowDefSchema }),
  z.object({ method: z.literal('workflows.delete'), id: z.string().uuid() }),
  z.object({ method: z.literal('workflows.run'), defId: z.string().uuid(), sessionId: id, target: TargetSchema, contexts: z.array(ContextSchema).max(12), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), note: z.string().max(2000).default('') }),
  z.object({ method: z.literal('workflows.resume'), id: z.string().uuid() }),
  z.object({ method: z.literal('workflows.cancel'), id: z.string().uuid() }),
  /** 动态拆解：把目标交给当前会话拆成步骤（结构化 JSON），拆完立即按顺序执行；满意后在面板保存复用。 */
  z.object({ method: z.literal('workflows.plan'), sessionId: id, target: TargetSchema, contexts: z.array(ContextSchema).max(12), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), goal: z.string().trim().min(1).max(2000) }),
  /** 把动态拆解产生的临时工作流转成可复用的正式定义。 */
  z.object({ method: z.literal('workflows.keep'), id: z.string().uuid(), name: z.string().trim().min(1).max(60) }),
  /** 运行轨迹：历史实例与每步执行证据。 */
  z.object({ method: z.literal('workflows.history'), projectId: z.string().min(1).max(160), limit: z.number().int().min(1).max(50).default(20) }),
  /** 安装缺失的内置工程模板（幂等），返回最新定义列表。 */
  z.object({ method: z.literal('workflows.seed'), projectId: z.string().min(1).max(160) }),
  /** 工作流每日定时（scheduleAt 空=取消；target 提供触发目标文档）。 */
  z.object({ method: z.literal('workflows.schedule'), id: z.string().uuid(), scheduleAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^.?$/).max(5), target: TargetSchema.optional() }),
  /** 批量运行：对多个工作项各开一个会话按同一流程执行（上限 10 条）。 */
  z.object({ method: z.literal('workflows.runBatch'), target: TargetSchema, defId: z.string().uuid(), workItemIds: z.array(z.string().min(1).max(100)).min(1).max(10), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), note: z.string().max(2000).default('') }),
  /* 需求模板库：模板=Polarion 真实工作项（library 项目「需求模板库」文档，安装时幂等创建）。 */
  z.object({ method: z.literal('templates.list'), target: TargetSchema }),
  z.object({ method: z.literal('templates.read'), target: TargetSchema, templateId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('templates.reset'), target: TargetSchema, templateId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('templates.createCustom'), target: TargetSchema, title: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(40), html: z.string().min(1).max(200000) }),
  z.object({ method: z.literal('templates.instantiate'), target: TargetSchema, templateId: z.string().min(1).max(100), title: z.string().trim().min(1).max(500), anchorWorkItemId: z.string().min(1).max(100).optional() }),
  z.object({ method: z.literal('templates.apply'), target: TargetSchema, workItemId: z.string().min(1).max(100), templateId: z.string().min(1).max(100) }),
  /* Simulink 模型关联：配置在 PSB-MODEL 项目工作项；备注在各工作项自己的附件。 */
  z.object({ method: z.literal('model.roots'), target: TargetSchema }),
  z.object({ method: z.literal('model.roots.save'), target: TargetSchema, roots: z.array(ModelRootSchema).max(10), expectedUpdated: z.string().nullable().optional() }),
  z.object({ method: z.literal('model.roots.bind'), target: TargetSchema, rootId: id, path: z.string().trim().min(1).max(1000) }),
  /** 只扫描本地目录生成模块清单预览，不保存；路径来自 dialog.pickFolder。 */
  z.object({ method: z.literal('model.roots.scan'), path: z.string().trim().min(1).max(1000) }),
  z.object({ method: z.literal('model.note.read'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('model.note.write'), target: TargetSchema, workItemId: z.string().min(1).max(100), note: ModelNoteSchema }),
  /** 平台模块目录：全局固定模块清单，需求先于模型的项目用它做 AI 初关联与手标注。 */
  z.object({ method: z.literal('model.platform.get') }),
  z.object({ method: z.literal('model.platform.save'), modules: z.array(ModelModuleSchema).max(500) }),
  /** 标注视图根目录：配置根为空时返回平台模块目录兜底根（ModuleNotePanel 用）。 */
  z.object({ method: z.literal('model.roots.forNote'), target: TargetSchema }),
  /** 批量同步：查询项目工作项的模块备注附件，构建本机追溯索引。query 缺省查全部非 PSB 项。 */
  z.object({ method: z.literal('model.index.sync'), target: TargetSchema, query: z.string().trim().max(300).default('') }),
  /** 追溯视图：roots + 索引 → 模块分组、未标注清单、零需求模块（读缓存，不触发同步）。 */
  z.object({ method: z.literal('model.trace.view'), target: TargetSchema }),
  /** 一致性巡检：把当前模型文件内容指纹 + 需求修订时间拍成基准；之后的巡检对比两侧变化。 */
  z.object({ method: z.literal('model.baseline.set'), target: TargetSchema, rootId: id }),
  z.object({ method: z.literal('model.check'), target: TargetSchema, rootId: id }),
  z.object({ method: z.literal('model.baseline.list'), projectId: z.string().min(1).max(160) }),
  /** AI 初关联：把未标注工作项与模块清单交给当前会话，Agent 逐条读正文并写第一版实现模块备注，供人工修正。 */
  z.object({ method: z.literal('model.autolink'), sessionId: id, target: TargetSchema, contexts: z.array(ContextSchema).max(12), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE) }),
  /* v0.14 语义索引与关联视图。 */
  /** 构建覆盖索引：当前文档逐条正文摘要 + 双向链接 + 模块备注（增量：修订未变的条目复用上次链接）。 */
  z.object({ method: z.literal('coverage.sync'), target: TargetSchema }),
  z.object({ method: z.literal('coverage.view'), target: TargetSchema }),
  /** 写前查重：与覆盖索引正文比对，找相似条目与共享术语。exclude 传当前工作项编号。 */
  z.object({ method: z.literal('dedup.search'), target: TargetSchema, text: z.string().trim().min(1).max(20000), limit: z.number().int().min(1).max(10).default(5), exclude: z.string().min(1).max(100).optional() }),
  /** 影响前置卡：一条需求的模块（含疑似过期）、上下游与验证链接。 */
  z.object({ method: z.literal('impact.view'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  /* v0.15 事件与主动化：事件总线、守望警报、晨报。 */
  z.object({ method: z.literal('events.list'), projectId: z.string().min(1).max(160), limit: z.number().int().min(1).max(PROJECT_EVENT_LIMIT).default(60) }),
  z.object({ method: z.literal('watch.view'), target: TargetSchema }),
  /** 晨报：预览卡片 / 立即发送到项目飞书群（发送是显式外发动作）。 */
  z.object({ method: z.literal('brief.preview'), target: TargetSchema }),
  z.object({ method: z.literal('brief.send'), target: TargetSchema }),
  /** 晨报定时开关（按项目保存：到点自动体检+巡检+发卡）。 */
  z.object({ method: z.literal('brief.toggle'), target: TargetSchema, enabled: z.boolean() }),
  /* v0.16 门禁与评审。 */
  z.object({ method: z.literal('gates.view'), target: TargetSchema }),
  z.object({ method: z.literal('gates.policy.get'), projectId: z.string().min(1).max(160) }),
  z.object({ method: z.literal('gates.policy.save'), projectId: z.string().min(1).max(160), policy: GatePolicySchema }),
  /** AI 预审：当前会话对整册需求产出结构化问题卡（blocker/major/minor），人工逐条处置。 */
  z.object({ method: z.literal('review.start'), sessionId: id, target: TargetSchema, contexts: z.array(ContextSchema).max(12), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE) }),
  /** 基线快照：保存/列出/与上一次对比。 */
  z.object({ method: z.literal('snapshots.save'), target: TargetSchema, label: z.string().trim().max(80).default('') }),
  z.object({ method: z.literal('snapshots.list'), projectId: z.string().min(1).max(160), limit: z.number().int().min(1).max(50).default(20) }),
  z.object({ method: z.literal('snapshots.diff'), target: TargetSchema }),
  z.object({ method: z.literal('review.list'), target: TargetSchema }),
  z.object({ method: z.literal('review.decide'), id: z.string().uuid(), issueId: z.string().uuid(), decision: z.enum(['resolved', 'ignored']) }),
  z.object({ method: z.literal('review.share'), id: z.string().uuid(), target: TargetSchema }),
  /* v0.17 工作集/仪表盘/宏。 */
  z.object({ method: z.literal('worksets.list'), projectId: z.string().min(1).max(160) }),
  z.object({ method: z.literal('worksets.save'), target: TargetSchema, id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), kind: z.enum(['gaps', 'orphans', 'quality', 'search']), query: z.string().trim().max(200).default('') }),
  z.object({ method: z.literal('worksets.delete'), id: z.string().uuid() }),
  z.object({ method: z.literal('worksets.items'), target: TargetSchema, id: z.string().uuid() }),
  z.object({ method: z.literal('dashboard.view'), target: TargetSchema }),
  z.object({ method: z.literal('macros.list'), projectId: z.string().min(1).max(160) }),
  /** 把当前会话最近 count 条用户指令存为宏。 */
  z.object({ method: z.literal('macros.capture'), sessionId: id, name: z.string().trim().min(1).max(60), count: z.number().int().min(1).max(10) }),
  z.object({ method: z.literal('macros.delete'), id: z.string().uuid() }),
  /** 重放：对当前会话按序发出宏指令；scheduleAt 传入则设置每日定时（清空取消）。 */
  z.object({ method: z.literal('macros.run'), sessionId: id, id: z.string().uuid(), target: TargetSchema, contexts: z.array(ContextSchema).max(12), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE) }),
  z.object({ method: z.literal('macros.schedule'), id: z.string().uuid(), scheduleAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^.?$/).max(5), target: TargetSchema.optional() }),
  /* v0.18 时间线/证据链/会议分诊。 */
  z.object({ method: z.literal('timeline.view'), target: TargetSchema, workItemId: z.string().min(1).max(100).optional() }),
  /** 一条需求的证据链 Markdown：正文摘要、模块（含疑似过期）、链接、事件与巡检结论。 */
  z.object({ method: z.literal('evidence.markdown'), target: TargetSchema, workItemId: z.string().min(1).max(100) }),
  /** 会议纪要分诊：会话把纪要拆成结构化动作卡，逐条发 AI 执行或忽略。 */
  z.object({ method: z.literal('meeting.triage'), sessionId: id, target: TargetSchema, contexts: z.array(ContextSchema).max(12), permissionMode: PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), text: z.string().trim().min(1).max(20000) }),
  z.object({ method: z.literal('meeting.list'), target: TargetSchema }),
  z.object({ method: z.literal('meeting.decide'), id: z.string().uuid(), actionId: z.string().uuid(), decision: z.enum(['done', 'open']) }),
  /* S6 规则中心 / S3 提案管线（v0.14）：规则包存 PSB-RULES 项目工作项；一切写皆提案。 */
  z.object({ method: z.literal('rules.get'), target: TargetSchema, refresh: z.boolean().default(false) }),
  z.object({ method: z.literal('rules.save'), target: TargetSchema, pack: RulePackSchema, expectedUpdated: z.string().nullable().optional() }),
  z.object({ method: z.literal('proposals.list'), target: TargetSchema.optional() }),
  z.object({ method: z.literal('proposals.create'), source: ProposalSourceSchema, target: TargetSchema, workItemId: z.string().min(1).max(100).optional(), summary: z.string().trim().min(1).max(300), op: ProposalOpSchema }),
  z.object({ method: z.literal('proposals.approve'), id: z.string().uuid(), nativeState: z.enum(['clean','dirty','unknown']).optional() }),
  z.object({ method: z.literal('proposals.reject'), id: z.string().uuid() }),
  /** 驾驶舱统计的最近一份项目报告。读取缓存，不触发扫描。 */
  z.object({ method: z.literal('quality.document.last'), target: TargetSchema }),
  /** 整册体检：按文档 outline 逐条 peek + lint，聚合每条发现问题与规则分布。 */
  z.object({ method: z.literal('quality.document.check'), target: TargetSchema, limit: z.number().int().min(1).max(500).default(200) }),
]);
export type Command = z.infer<typeof CommandSchema>;
/** 总览用的轻量条目：只要编号、标题、状态与 outline 序号。 */
export type DocumentOutlineItem = { id: string; title: string; status: string; type: string; outline: string };
export type DocumentOutline = { documentId: string; title: string; items: DocumentOutlineItem[] };
export function isHeadingType(type?: string): boolean {
  return type?.trim().toLowerCase() === 'heading';
}
/** 整册体检：逐条 lint 的聚合结果（LintIssue 的协议投影）。 */
export type QualityIssue = { ruleId: string; severity: 'warn' | 'info'; message: string; matchedText: string; suggestion?: string };
export type DocumentQualityItem = { workItemId: string; title: string; outline: string; issues: QualityIssue[]; unreadable?: boolean; readOnlyReference?: boolean };
/** 旧版本的项目级缓存没有记录来源文档。 */
export type DocumentQualityReport = { document?: string; at: number; total: number; checked: number; clean: number; items: DocumentQualityItem[]; byRule: { ruleId: string; count: number }[]; ruleSource: 'polarion' | 'cache' | 'default' };

/* ------------------------------------------------------------------ */
/* 变更管理：基准会话、变更记录、分享。                                */
/* ------------------------------------------------------------------ */

export type ChangeSessionState = 'starting' | 'active' | 'finishing' | 'failed';
export type ChangeSession = {
  id: string;
  target: Target;
  state: ChangeSessionState;
  documentTitle: string;
  startedAt: number;
  baselineAt: number;
  itemCount: number;
  /** 设定基准时填写的本次修改目的；结束时作为记录的人工说明。 */
  note?: string;
  snapshotId?: string;
  jobId?: string;
  error?: string;
  /** Polarion 中承载本次变更的工作项（记录本体与基线附件都挂在它上面）。 */
  workItemId?: string;
  attachmentName?: string;
  author?: string;
  source?: 'polarion' | 'cache';
};

export type ChangeJobView = {
  id: string;
  kind: 'start' | 'finish' | 'compare';
  state: 'running' | 'done' | 'failed';
  phase: string;
  done: number;
  total: number;
  error?: string;
  /** 仅用于诊断未识别错误；不包含凭据，最长 800 字。 */
  detail?: string;
  recordId?: string;
};

export type ChangeSessionView = ChangeSession & {job?: ChangeJobView};

export type ChangeAiSummary = {
  status: 'pending' | 'ready' | 'failed';
  text: string;
  model?: string;
  at?: number;
  error?: string;
};

export type ChangeRecordSummary = {
  source?: ProposalSource;
  id: string;
  target: Target;
  documentTitle: string;
  baselineAt: number;
  endedAt: number;
  itemCount: number;
  changedItems: number;
  added: number;
  removed: number;
  modified: number;
  moved: number;
  aiStatus: ChangeAiSummary['status'];
  /** AI 总结首句，列表里用来快速识别这次改了什么。 */
  headline: string;
  /** Polarion 工作项与附件；跨电脑/跨用户时靠它们定位同一条记录。 */
  workItemId?: string;
  attachmentName?: string;
};

export type ChangeChapterSummary = {
  num: string;
  title: string;
  items: number;
  added: number;
  removed: number;
  modified: number;
  moved: number;
};

export type ChangeField = {name: string; before: string; after: string};

/** 与 packages/core/change-diff.ts 的 ChangeBlock 结构一致（仅类型，避免协议层依赖比对实现）。 */
export type ChangeBlock = {
  kind: 'same' | 'added' | 'removed' | 'modified';
  tag: string;
  /** 未变更块的完整 HTML，用于左右完整对照。 */
  html?: string;
  text?: string;
  before?: string;
  after?: string;
};

export type ChangeItem = {
  workItemId: string;
  title: string;
  outlineBefore: string;
  outlineAfter: string;
  chapterBefore: string;
  chapterAfter: string;
  /** 所属功能单元的完整路径，如「第3章 功能需求 · 3.7 执行及辅助状态输出选择」。 */
  sectionAfter?: string;
  sectionBefore?: string;
  kind: 'modified' | 'added' | 'removed' | 'moved';
  fields: ChangeField[];
  blocks: ChangeBlock[];
  counts: {added: number; removed: number; modified: number};
};

/** 悬停预览：只含展示所需字段，不含正文 HTML 与图片。 */
export type ChangeRecordPreview = {
  id: string;
  documentTitle: string;
  headline: string;
  baselineAt: number;
  endedAt: number;
  changedItems: number;
  modified: number;
  added: number;
  removed: number;
  items: {workItemId: string; title: string; kind: ChangeItem['kind']}[];
  summaryLines: string[];
};

export type ChangeRecord = ChangeRecordSummary & {
  chapters: ChangeChapterSummary[];
  changes: ChangeItem[];
  /** 记录生成时已解析的图片：src → data URL。 */
  images: Record<string, string>;
  heuristicSummary: string;
  aiSummary: ChangeAiSummary;
  note?: string;
  /** 期间观察到的保存次数（来自 Host 的保存审计）。 */
  saveCount?: number;
  share?: {token: string; publishedAt: number; port: number};
  /** Polarion 工作项的最近更新时间；用于乐观并发写入。 */
  updated?: string;
};

export type ChangeShareStatus = {
  running: boolean;
  port?: number;
  urls?: string[];
  historyUrl?: string;
};
/** 一个飞书群的发送结果。 */
export type FeishuSendResult = {label: string; ok: boolean; error?: string};
/** changes.share.feishu 的返回：发布状态 + 逐群发送结果。 */
export type ChangeShareFeishuResult = {recordUrl: string; historyUrl: string; port: number; results: FeishuSendResult[]};
/** 项目共享的飞书推送群视图：source 标明来自 Polarion 还是离线缓存。 */
export type FeishuGroupsView = {groups: FeishuGroup[]; source: 'polarion' | 'cache' | 'empty'; workItemId?: string; updated?: string};

export type ChangePoint = {at: number; label: string; hint?: string; kind: 'before' | 'after' | 'now' | 'start' | 'record'};
export type ChangeCompareEvent = {at: number; beforeAt: number; label: string; count: number};
export type ChangeCompareOptions = {documentTitle: string; itemCount: number; points: ChangePoint[]; events: ChangeCompareEvent[]};

export type ChangeWorkspace = {
  proposalActivity?: Pick<Proposal,'id' | 'target' | 'source' | 'summary' | 'appliedAt' | 'workItemId' | 'recordError' | 'savedToPolarion'>[];
  session: ChangeSessionView | null;
  /** 当前文档的变更记录。 */
  records: ChangeRecordSummary[];
  /** 当前项目的全部变更记录（跨文档），按项目隔离。 */
  projectRecords: ChangeRecordSummary[];
  share: ChangeShareStatus;
  /** Polarion 查询是否成功；离线时列表来自本机缓存。 */
  online: boolean;
  warning?: string;
};
export const RequestSchema = z.object({ protocol: z.literal(PROTOCOL), id, command: CommandSchema });
export type Request = z.infer<typeof RequestSchema>;
export type Reply = { protocol: 1; id: string; ok: true; value: unknown } | { protocol: 1; id: string; ok: false; error: string };
export type Session = { id: string; target: Target; title: string; engine: 'claude' | 'codex'; model: string; nativeId?: string; createdAt: number; updatedAt: number; archived?: boolean; group?: string };
export type SessionGroup = { name: string; createdAt: number };
export type ContextUsage = { usedTokens: number; windowTokens: number; percentage: number; model: string; updatedAt: number; categories: { name: string; tokens: number; kind: string }[] };
export type EngineContext = { usage: ContextUsage | null; connected: boolean; compacting: boolean };
export type Run = {
  /** Only the isolated, tool-free inspection runtime may execute this snapshot. */
  qualityInspection?: true;
  qualityRewrite?: QualityRewrite;
  /** false 表示本轮草稿留待审阅，省略时遵循全局设置。 */
  autoSave?: false;
  permissionMode?:PermissionMode; delivery?:TurnDelivery; guidelineId?:string; /** 用户开启「参考模板」：本轮提示词注入需求模板库。 */ useRequirementTemplates?: boolean; id: string; sessionId: string; requestId: string; target: Target; prompt: string; contexts: Context[]; attachments?: string[]; status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; startedAt: number; endedAt?: number; error?: string; /** 工作流步骤轮的标识：徽标与队列展示用；planGoal 表示这轮是动态工作流的目标拆解。 */ workflow?: { workflowRunId: string; defName: string; stepIndex: number; stepTotal: number; stepTitle: string; planGoal?: string; reviewId?: string; meetingId?: string } };
/** 本地经验沉淀文件视图：text 为空表示尚未沉淀。 */
export type ExperienceView = { text: string; path: string; updatedAt: number };
/** 经验共编消息：用户修改意图 / AI 一句话说明；完整对话由扩展端持有，Host 不落状态。 */
export type ExperienceRefineMessage = { role: 'user' | 'assistant'; text: string };
/** 经验共编结果：note 为本次修改说明，text 为完整下一稿（未落盘）。 */
export type ExperienceRefineView = { note: string; text: string };
export type RunEvent = { seq: number; sessionId: string; runId: string; kind: string; data: unknown; at: number };
export type Draft = { id: string; target: Target; workItemId: string; title: string; baseHtml: string; html: string; baseUpdated: string; revision: number; savedAt?: number; state: 'clean' | 'dirty' | 'conflict' | 'uncertain'; /** 该草稿属于某个变体时，记录其主工作项。 */ variantOf?: string };
export type EngineCapabilities = { at: number; engine: 'claude'; connected?: boolean; commands: { name: string; description: string; argumentHint: string; aliases: string[]; builtin: boolean }[]; servers: { name: string; status: string; scope?: string; tools: { name: string; description?: string }[] }[]; agents: { name: string; description: string }[]; models: { value: string; displayName: string }[] };
export type Asset = { id: string; target: Target; name: string; mime: string; size: number; received: number; state: 'uploading' | 'ready'; extraction: 'text' | 'image' | 'native-file' | 'failed'; text?: string; textLength?: number; truncated?: boolean; sha256?: string; createdAt: number };
export type InteractionValues = Record<string,string|number|boolean|string[]>;
export type NativeInteraction = { id:string; kind:'question'|'mcp-form'|'mcp-url'; title:string; message:string; url?:string; fields:{key:string;label:string;description?:string;type:'string'|'number'|'integer'|'boolean'|'array';required:boolean;choices?:{value:string;label:string;description?:string}[];allowOther?:boolean;secret?:boolean;minimum?:number;maximum?:number;minLength?:number;maxLength?:number}[] };

/* ------------------------------------------------------------------ */
/* Simulink 模型关联视图类型。                                          */
/* ------------------------------------------------------------------ */
/** model.roots 返回：source 标明配置来自 Polarion 还是离线缓存。 */
export type ModelRootsView = { roots: ModelRoot[]; source: 'polarion' | 'cache' | 'empty'; workItemId?: string; updated?: string };
/** 索引里一条工作项的备注摘要。 */
export type ModelIndexedItem = { workItemId: string; title: string; type: string; updated: string; marks: ModelNoteMark[]; links: { workItemId: string; role: string }[] };
export type ModelIndexView = { items: ModelIndexedItem[]; total: number; annotated: number; syncedAt: number; query: string; partial?: boolean };
/** 扫描预览：modules 已按目录去重、标注 kind，excluded=false 由用户再筛选。 */
export type ModelScanView = Omit<ModelRoot, 'id' | 'note'> & { rootName: string; fileCount: number };
/** 追溯矩阵：按模块分组 + 覆盖缺口。 */
export type ModelTraceGroup = { rootId: string; rootLabel: string; moduleKey: string; moduleName: string; kind: ModelModule['kind']; items: ModelIndexedItem[]; markedHeadings?: ModelIndexedItem[]; missing: boolean };
export type ModelTraceView = {
  roots: ModelRoot[]; groups: ModelTraceGroup[]; unannotated: ModelIndexedItem[];
  total: number; annotated: number; syncedAt: number; stale: boolean;
};
/* ------------------------------------------------------------------ */
/* 模型一致性巡检：内容指纹基准 + 双侧变更检测。                        */
/* ------------------------------------------------------------------ */
export type ModelFileChange = { path: string; change: 'modified' | 'added' | 'removed' };
export type ModelCheckFinding = {
  rootId: string; rootLabel: string; moduleKey: string; moduleName: string;
  /** model：模型侧文件变了；requirement：需求侧更新了；both：两侧都动过，需人工裁决以哪侧为准。 */
  side: 'model' | 'requirement' | 'both';
  files: ModelFileChange[];
  workItems: { workItemId: string; title: string; requirementChanged: boolean }[];
};
export type ModelCheckView = {
  at: number; baselineAt: number | null; ok: boolean; message?: string;
  checkedFiles: number; changedFiles: number; findings: ModelCheckFinding[];
};
export type ModelBaselineInfo = { rootId: string; rootLabel: string; at: number; files: number; items: number };
/* ------------------------------------------------------------------ */
/* v0.14 语义索引与关联视图：覆盖矩阵、写前查重、影响前置卡。          */
/* ------------------------------------------------------------------ */
/** 覆盖索引一条：正文摘要 + 双向链接 + 模块备注，三层覆盖计数为派生字段。 */
export type CoverageItem = {
  workItemId: string; title: string; type: string; outline: string; updated: string;
  marks: ModelNoteMark[]; text: string;
  forwardLinks: { workItemId: string; role: string }[];
  backLinks: { workItemId: string; role: string }[];
  upstream: number; moduleCount: number; verification: number;
};
export type CoverageView = {
  at: number; total: number; partial?: boolean; items: CoverageItem[];
  summary: { withUpstream: number; withModule: number; withVerification: number; orphans: number };
};
/** 写前查重命中：重叠系数 + 共享术语，供复用/合并判断。 */
export type DedupMatch = { workItemId: string; title: string; score: number; sharedTerms: string[] };
/** 影响前置卡：改动一条需求前先看它牵动哪些模块、上下游与验证。 */
export type ImpactView = {
  workItemId: string; title: string;
  modules: { rootId: string; rootLabel: string; moduleKey: string; moduleName: string; stale: boolean }[];
  upstream: { workItemId: string; role: string }[];
  downstream: { workItemId: string; role: string }[];
  verification: { workItemId: string; role: string }[];
  staleCount: number; coverageAt: number | null;
};
/* ------------------------------------------------------------------ */
/* v0.15 事件与主动化：事件总线、守望警报、晨报。                      */
/* ------------------------------------------------------------------ */
export type WorkEventKind = 'save' | 'note' | 'check' | 'proposal' | 'lint' | 'watcher' | 'brief';
export type WorkEvent = { id: string; projectId: string; at: number; kind: WorkEventKind; subject: string; detail?: string; workItemId?: string };
export type WatchAlert = { level: 'warn' | 'info'; title: string; detail: string; at?: number; action: 'baseline' | 'model-check' | 'coverage-sync' };
export type WatchView = { alerts: WatchAlert[]; generatedAt: number; brief: BriefConfig };
export type BriefConfig = { enabled: boolean; at: string };
export type BriefView = { card: unknown; digest: string; sent?: boolean; results?: FeishuSendResult[]; reason?: string };
/* ------------------------------------------------------------------ */
/* v0.16 生命周期门禁与 AI 预审评审。                                   */
/* ------------------------------------------------------------------ */
export type GateId = 'quality' | 'criterion' | 'upstream' | 'module';
export type GateResult = { gate: GateId; label: string; pass: boolean; detail: string };
export type GatesItemView = { workItemId: string; title: string; outline: string; gates: GateResult[]; passed: boolean };
export type GatesView = { items: GatesItemView[]; summary: { total: number; passed: number; byGate: Record<GateId, number>; qualityScore: number }; policy: GatePolicy; coverageAt: number | null };
export type SnapshotDiff = { latest: SnapshotView; previous: SnapshotView | null; delta: { coverageOrphans: number | null; qualityScore: number | null; gatesPassed: number | null; openIssues: number | null } };
export type ReviewSeverity = 'blocker' | 'major' | 'minor';
export type ReviewIssueCard = { id: string; workItemId?: string; location?: string; severity: ReviewSeverity; summary: string; suggestion?: string; status: 'open' | 'resolved' | 'ignored' };
export type ReviewRecordView = { id: string; document?: string; at: number; status: 'running' | 'open' | 'done' | 'failed'; error?: string; issues: ReviewIssueCard[] };
export function openReviewIssues(record: ReviewRecordView) {
  return record.status === 'open' ? record.issues.filter(issue => issue.status === 'open') : [];
}
export function isInboxPendingProposal(proposal: Proposal) {
  return proposal.status === 'pending' && proposal.op.kind !== 'tool' && proposal.op.kind !== 'gate';
}
export const VERIFICATION_ROLE = /test|verif|valid|检验|验证/i;
export function isCoverageOrphan(item: Pick<CoverageItem, 'upstream' | 'moduleCount' | 'verification'>) {
  return !item.upstream && !item.moduleCount && !item.verification;
}
/* ------------------------------------------------------------------ */
/* v0.17 智能工作集、仪表盘、宏。                                       */
/* ------------------------------------------------------------------ */
export type WorksetKind = 'gaps' | 'orphans' | 'quality' | 'search';
export type Workset = { id: string; projectId: string; name: string; kind: WorksetKind; query: string; createdAt: number };
export type WorksetView = Workset & { items: { workItemId: string; title: string; reason: string }[] };
export type DashboardView = {
  pendingProposals: number; alerts: number;
  quality: { checked: number; findings: number; byRule: { ruleId: string; count: number }[] } | null;
  coverage: { total: number; withModule: number; withUpstream: number; withVerification: number; orphans: number } | null;
  workflows: number; events: number; worksets: number; briefEnabled: boolean; reviewOpen: number;
};
export type Macro = { id: string; projectId: string; name: string; steps: string[]; createdAt: number; scheduleAt?: string; document?: string };
/* ------------------------------------------------------------------ */
/* v0.18 时间线、证据链、会议分诊。                                     */
/* ------------------------------------------------------------------ */
export type TimelineEntry = { at: number; kind: string; subject: string; workItemId?: string; detail?: string };
export type TimelineView = { scope: 'project' | 'item'; workItemId?: string; entries: TimelineEntry[] };
export type MeetingAction = { id: string; title: string; owner?: string; priority: 'high' | 'normal' | 'low'; workItemId?: string; status: 'open' | 'done' };
export type MeetingRecordView = { id: string; document?: string; at: number; status: 'running' | 'open' | 'done' | 'failed'; error?: string; digest?: string; actions: MeetingAction[] };

export function routeFromUrl(url: string): Target | null {
  try {
    const u = new URL(url);
    if (u.origin !== 'https://polarion.pufafen.com') return null;
    const m = u.hash.match(/^#\/project\/([^/]+)\/wiki\/(.+?)(?:\?|$)/);
    return m ? TargetSchema.parse({ origin: u.origin, projectId: decodeURIComponent(m[1]!), document: decodeURIComponent(m[2]!) }) : null;
  } catch { return null; }
}

export function sameTarget(a: Target, b: Target) { return a.origin === b.origin && a.projectId === b.projectId && a.document === b.document; }
