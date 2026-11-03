import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DATA, PIPE, ROOT } from './paths.ts';
function connect() { return new Promise<net.Socket>((resolve, reject) => { const s = net.createConnection(PIPE); s.once('connect', () => { s.off('error', reject); resolve(s); }); s.once('error', reject); }); }
let socket: net.Socket | undefined;
try { socket = await connect(); } catch {
  const child = spawn(process.execPath, [path.join(ROOT, 'dist/host/server.mjs')], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' }); child.unref();
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 100)); try { socket = await connect(); break; } catch {} }
}
if (!socket) process.exit(1);
const channel = socket;
channel.write(JSON.stringify({ key: await fs.readFile(path.join(DATA, 'ipc-key'), 'utf8') }) + '\n');
function send(value: unknown) {
  let payload = Buffer.from(JSON.stringify(value));
  if (payload.length > 1_000_000) payload = Buffer.from(JSON.stringify({ protocol: 1, id: (value as any).id, ok: false, error: 'RESPONSE_TOO_LARGE' }));
  const header = Buffer.alloc(4); header.writeUInt32LE(payload.length); process.stdout.write(Buffer.concat([header, payload]));
}
let output = ''; channel.setEncoding('utf8');
channel.on('data', chunk => { output += chunk; for (;;) { const n = output.indexOf('\n'); if (n < 0) break; const line = output.slice(0, n); output = output.slice(n + 1); const message = JSON.parse(line); if (!message.ready) send(message); } });
channel.on('error', () => process.exit(1)); channel.on('close', () => process.exit(0));
let input = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0); if (length > 1_000_000 || length < 1) process.exit(1);
    if (input.length < length + 4) break;
    try { const message = JSON.parse(input.subarray(4, length + 4).toString('utf8')); channel.write(JSON.stringify(message) + '\n'); } catch { process.exit(1); }
    input = input.subarray(length + 4);
  }
});
process.stdin.on('end', () => { channel.end(); process.exit(0); });
