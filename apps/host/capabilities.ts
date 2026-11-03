import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';
import { CLAUDE, DATA } from './paths.ts';
import { Store } from './store.ts';
import type { Target, EngineCapabilities } from '../../packages/protocol/index.ts';
export async function inspectRuntime(runtime: Query): Promise<EngineCapabilities> {
  const [commands, servers, agents, models] = await Promise.all([runtime.supportedCommands(), runtime.mcpServerStatus(), runtime.supportedAgents(), runtime.supportedModels()]);
  return { at: Date.now(), engine: 'claude', commands: commands.map(c => ({ name: c.name, description: c.description, argumentHint: c.argumentHint, aliases: c.aliases ?? [], builtin: !!c.builtin })),
    servers: servers.map(s => ({ name: s.name, status: s.status, scope: s.scope, tools: s.tools?.map(t => ({ name: t.name, description: t.description?.slice(0, 500) })) ?? [] })),
    agents: agents.map(a => ({ name: a.name, description: a.description ?? '' })), models: models.map(m => ({ value: m.value, displayName: m.displayName })),
  };
}
export class Capabilities {
  private store: Store;
  constructor(store: Store) { this.store = store; }
  pending = new Map<string, Promise<EngineCapabilities>>();
  read(target: Target, refresh: boolean) {
    const key = target.projectId; const saved = this.store.get<EngineCapabilities>('capabilities', key);
    if (saved && !refresh) return Promise.resolve(saved);
    if (this.pending.has(key)) return this.pending.get(key)!;
    const task = this.discover(target).finally(() => this.pending.delete(key)); this.pending.set(key, task); return task;
  }
  private async discover(target: Target) {
    const cwd = path.join(DATA, 'workspaces', target.projectId); await fs.mkdir(cwd, { recursive: true });
    const abort = new AbortController(); let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; }); async function* input() { await hold; }
    const timer = setTimeout(() => { release(); abort.abort(); }, 35000);
    const runtime = query({ prompt: input(), options: { cwd, pathToClaudeCodeExecutable: CLAUDE, executable: 'node', settingSources: ['user','project','local'], permissionMode: 'default', abortController: abort, canUseTool: async () => ({ behavior: 'deny', message: 'Capability discovery does not execute agent tools.' }), stderr: () => {} } });
    try { const result = await inspectRuntime(runtime); this.store.put('capabilities', target.projectId, result); return result; }
    finally { clearTimeout(timer); release(); runtime.close(); }
  }
}
