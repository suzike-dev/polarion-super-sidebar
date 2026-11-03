import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { DATA, PIPE } from './paths.ts';
import { Store } from './store.ts';
import { Service } from './service.ts';
await fs.mkdir(DATA, { recursive: true });
const secretPath = path.join(DATA, 'ipc-key');
try { await fs.writeFile(secretPath, crypto.randomUUID(), { flag: 'wx', mode: 0o600 }); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
const secret = await fs.readFile(secretPath, 'utf8');
const store = new Store(path.join(DATA, 'state.sqlite'));
const service = new Service(store);
const server = net.createServer(socket => {
  let buffer = ''; let authenticated = false;
  socket.setEncoding('utf8'); socket.on('error', () => {});
  socket.on('data', data => {
    buffer += data;
    if (Buffer.byteLength(buffer) > 2_000_000) { socket.destroy(); return; }
    for (;;) {
      const nl = buffer.indexOf('\n'); if (nl < 0) break;
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      try {
        const message = JSON.parse(line);
        if (!authenticated) {
          const key = Buffer.from(String(message.key ?? '')); const expected = Buffer.from(secret);
          if (key.length !== expected.length || !timingSafeEqual(key, expected)) { socket.destroy(); return; }
          authenticated = true; socket.write('{"ready":true}\n'); continue;
        }
        void service.request(message).then(reply => {
          if (!socket.destroyed) socket.write(JSON.stringify(reply) + '\n');
        });
      } catch { socket.destroy(); return; }
    }
  });
});
server.once('error', error => { store.close(); if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') process.exit(0); throw error; });
server.listen(PIPE, () => { store.recoverInterruptedRuns(); });
