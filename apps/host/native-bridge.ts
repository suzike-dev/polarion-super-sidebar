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

// Chrome Native Messaging 单条消息硬上限 1MB：超限消息按 base64 分帧（原始字节 ≤640KB/帧）。
// 关键：帧里装的是 base64，膨胀 4/3；640KB 原始 → 约 853KB base64 + 外壳 < 1MB，帧本身才不会超限。
const FRAME_RAW_BYTES = 640_000;
function writeFrame(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
  process.stdout.write(Buffer.concat([header, payload]));
}
function send(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const id = (value as { id?: string }).id ?? '';
  if (payload.length <= FRAME_RAW_BYTES) { writeFrame(value); return; }
  const total = Math.ceil(payload.length / FRAME_RAW_BYTES);
  for (let seq = 0; seq < total; seq++) writeFrame({ __chunk: { kind: 'reply', id, seq, total, data: payload.subarray(seq * FRAME_RAW_BYTES, (seq + 1) * FRAME_RAW_BYTES).toString('base64') } });
}
let output = ''; channel.setEncoding('utf8');
channel.on('data', chunk => { output += chunk; for (;;) { const n = output.indexOf('\n'); if (n < 0) break; const line = output.slice(0, n); output = output.slice(n + 1); const message = JSON.parse(line); if (!message.ready) send(message); } });
channel.on('error', () => process.exit(1)); channel.on('close', () => process.exit(0));

// 请求方向分片聚合：{__chunk:{kind:'request',id,seq,total,data}} 齐后拼回原始 JSON 写管道。
const requestChunks = new Map<string, { parts: string[]; got: number; total: number }>();
function forwardRequest(message: unknown) { channel.write(JSON.stringify(message) + '\n'); }
function acceptRequestChunk(chunk: { id: string; seq: number; total: number; data: string }) {
  const entry = requestChunks.get(chunk.id) ?? { parts: new Array<string>(chunk.total), got: 0, total: chunk.total };
  if (!entry.parts[chunk.seq]) { entry.parts[chunk.seq] = chunk.data; entry.got++; }
  requestChunks.set(chunk.id, entry);
  if (entry.got < entry.total) return;
  requestChunks.delete(chunk.id);
  try { forwardRequest(JSON.parse(Buffer.concat(entry.parts.map(part => Buffer.from(part, 'base64'))).toString('utf8'))); }
  catch { writeFrame({ protocol: 1, id: chunk.id, ok: false, error: 'REQUEST_CHUNK_INVALID' }); }
}
let input = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (length > 1_000_000 || length < 1) { input = input.subarray(input.length); continue; } // 非法长度：丢弃缓冲而不是让桥退出
    if (input.length < length + 4) break;
    try {
      const message = JSON.parse(input.subarray(4, length + 4).toString('utf8'));
      if (message?.__chunk?.kind === 'request') acceptRequestChunk(message.__chunk);
      else forwardRequest(message);
    } catch { /* 单条解析失败跳过，桥保持存活 */ }
    input = input.subarray(length + 4);
  }
});
process.stdin.on('end', () => { channel.end(); process.exit(0); });
