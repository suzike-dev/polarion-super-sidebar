import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DATA = process.env.POLARION_SIDEBAR_DATA ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Nanju', 'PolarionSidebar');
export const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\polarion-sidebar-' + createHash('sha256').update(DATA).digest('hex').slice(0, 16) : path.join(DATA, 'host.sock');
export const NODE = path.join(ROOT, '.runtime/node-v24.22.2-win-x64/node.exe');
export const CLAUDE = path.join(process.env.APPDATA ?? '', 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
