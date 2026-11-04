import { z } from 'zod';

export const PROTOCOL = 1;
export const PermissionModeSchema=z.enum(['ask','auto','full']);
export type PermissionMode=z.infer<typeof PermissionModeSchema>;
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';
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
  assistantFontSize: z.number().int().min(12).max(18).default(13),
});
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
  z.object({ method: z.literal('sessions.list'), projectId: z.string().max(160) }),
  z.object({ method: z.literal('sessions.create'), target: TargetSchema, title: z.string().min(1).max(100) }),
  z.object({ method: z.literal('sessions.rename'), sessionId: id, title: z.string().min(1).max(100) }),
  z.object({ method: z.literal('sessions.read'), sessionId: id, after: z.number().int().nonnegative().default(0) }),
  z.object({ method: z.literal('runs.start'), permissionMode:PermissionModeSchema.default(DEFAULT_PERMISSION_MODE), sessionId: id, requestId: id, target: TargetSchema, prompt: z.string().min(1).max(40000), contexts: z.array(ContextSchema).max(12), attachments: z.array(id).max(12).default([]) }),
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
  z.object({ method: z.literal('permissions.answer'), runId: id, permissionId: id, allow: z.boolean() }),
  z.object({ method: z.literal('interactions.answer'), runId: id, interactionId: id, action: z.enum(['accept','decline','cancel']), values: z.record(z.string(),z.union([z.string().max(20000),z.number().finite(),z.boolean(),z.array(z.string().max(20000)).max(100)])).default({}) }),
  z.object({ method: z.literal('drafts.list'), target: TargetSchema }),
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
]);
export type Command = z.infer<typeof CommandSchema>;
export const RequestSchema = z.object({ protocol: z.literal(PROTOCOL), id, command: CommandSchema });
export type Request = z.infer<typeof RequestSchema>;
export type Reply = { protocol: 1; id: string; ok: true; value: unknown } | { protocol: 1; id: string; ok: false; error: string };
export type Session = { id: string; target: Target; title: string; engine: 'claude' | 'codex'; model: string; nativeId?: string; createdAt: number; updatedAt: number };
export type ContextUsage = { usedTokens: number; windowTokens: number; percentage: number; model: string; updatedAt: number; categories: { name: string; tokens: number; kind: string }[] };
export type EngineContext = { usage: ContextUsage | null; connected: boolean; compacting: boolean };
export type Run = { permissionMode?:PermissionMode; id: string; sessionId: string; requestId: string; target: Target; prompt: string; contexts: Context[]; attachments?: string[]; status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; startedAt: number; endedAt?: number; error?: string };
export type RunEvent = { seq: number; sessionId: string; runId: string; kind: string; data: unknown; at: number };
export type Draft = { id: string; target: Target; workItemId: string; title: string; baseHtml: string; html: string; baseUpdated: string; revision: number; savedAt?: number; state: 'clean' | 'dirty' | 'conflict' | 'uncertain' };
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
