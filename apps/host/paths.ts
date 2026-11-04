import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

interface PathOptions { env?: NodeJS.ProcessEnv; home?: string; root?: string; platform?: NodeJS.Platform; isFile?: (file: string) => boolean }
const fileExists = (file: string) => { try { return statSync(file).isFile(); } catch { return false; } };
const envValue = (env: NodeJS.ProcessEnv, name: string) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]?.trim();

/** Resolve a user-installed CLI; never install it or silently use the SDK's copy. */
export function resolveClaudeExecutable(options: PathOptions = {}) {
  const env = options.env ?? process.env, home = options.home ?? os.homedir();
  const isFile = options.isFile ?? fileExists;
  const candidates: { path: string; source: string }[] = [];
  const override = envValue(env, 'POLARION_SIDEBAR_CLAUDE');
  if (override) {
    if (!path.isAbsolute(override)) return { path: override, source: 'override', found: false, error: 'CLAUDE_OVERRIDE_MUST_BE_ABSOLUTE' };
    if (!/\.(exe|[cm]?js)$/i.test(override)) return { path: override, source: 'override', found: false, error: 'CLAUDE_OVERRIDE_REQUIRES_EXECUTABLE_OR_JS' };
    return { path: override, source: 'override', found: isFile(override), error: isFile(override) ? undefined : 'CLAUDE_OVERRIDE_NOT_FOUND' };
  }
  const add = (file: string, source: string) => candidates.push({ path: file, source });
  for (const directory of (envValue(env, 'PATH') ?? '').split(path.delimiter).map(value => value.trim().replace(/^"|"$/g, '')).filter(value => value && path.isAbsolute(value))) {
    add(path.join(directory, 'claude.exe'), 'PATH');
    // npm's .cmd/.ps1 shims cannot be spawned directly by the Agent SDK.
    add(path.join(directory, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'), 'PATH-npm');
    add(path.join(directory, 'node_modules/@anthropic-ai/claude-code/cli.js'), 'PATH-npm');
  }
  add(path.join(home, '.local/bin/claude.exe'), 'native-user');
  const prefix = envValue(env, 'npm_config_prefix');
  const roaming = envValue(env, 'APPDATA');
  for (const directory of [prefix, roaming ? path.join(roaming, 'npm') : undefined].filter((entry): entry is string => !!entry && path.isAbsolute(entry))) {
    add(path.join(directory, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'), 'npm-prefix');
    add(path.join(directory, 'node_modules/@anthropic-ai/claude-code/cli.js'), 'npm-prefix');
  }
  const selected = candidates.find(candidate => isFile(candidate.path));
  return selected ? { ...selected, found: true, error: undefined } : { path: undefined, source: 'missing', found: false, error: 'CLAUDE_NOT_FOUND' };
}

export function resolveRuntimePaths(options: PathOptions = {}) {
  const env = options.env ?? process.env, home = options.home ?? os.homedir();
  const root = path.resolve(options.root ?? path.resolve(import.meta.dirname, '../..'));
  const configured = envValue(env, 'POLARION_SIDEBAR_DATA');
  if (configured && !path.isAbsolute(configured)) throw Error('POLARION_SIDEBAR_DATA_MUST_BE_ABSOLUTE');
  const data = path.resolve(configured ?? path.join(envValue(env, 'LOCALAPPDATA') ?? home, 'Nanju', 'PolarionSidebar'));
  return {
    root, data,
    pipe: (options.platform ?? process.platform) === 'win32' ? '\\\\.\\pipe\\polarion-sidebar-' + createHash('sha256').update(data).digest('hex').slice(0, 16) : path.join(data, 'host.sock'),
    node: path.join(root, '.runtime/node-v24.22.2-win-x64/node.exe'),
    claude: resolveClaudeExecutable(options),
  };
}
const runtime = resolveRuntimePaths();
export const ROOT = runtime.root;
export const DATA = runtime.data;
export const PIPE = runtime.pipe;
export const NODE = runtime.node;
// Keep Host diagnostics/drafts available when the separately installed CLI is missing.
// The explicit path prevents falling back to the SDK's private CLI installation.
export const CLAUDE = runtime.claude.path ?? path.join(os.homedir(), '.local/bin/claude.exe');
