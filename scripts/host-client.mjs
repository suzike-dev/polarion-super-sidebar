// 正确的 Host 客户端：逐行解析所有响应（ready 行 + 后续 reply）
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createHash} from 'node:crypto';

export const PIPE = '\\\\.\\pipe\\polarion-sidebar-' + createHash('sha256').update(path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Nanju', 'PolarionSidebar')).digest('hex').slice(0, 16);

export function call(command, timeoutMs = 180000) {
  const key = fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Nanju', 'PolarionSidebar', 'ipc-key'), 'utf8').trim();
  return new Promise((resolve) => {
    const socket = net.connect(PIPE);
    const id = crypto.randomUUID();
    const t0 = Date.now();
    let buffer = '';
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); try { socket.destroy(); } catch {} resolve(value); };
    const timer = setTimeout(() => finish({ok: false, error: 'CLIENT_TIMEOUT', ms: Date.now() - t0}), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({key}) + '\n');
      socket.write(JSON.stringify({protocol: 1, id, command}) + '\n');
    });
    socket.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const nl = buffer.indexOf('\n');
        if (nl < 0) break;
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.ready) continue;
        if (message.id === id) finish({...message, ms: Date.now() - t0});
      }
    });
    socket.on('error', error => finish({ok: false, error: error.message, ms: Date.now() - t0}));
    socket.on('close', () => finish({ok: false, error: 'CLOSED_NO_REPLY', ms: Date.now() - t0}));
  });
}
