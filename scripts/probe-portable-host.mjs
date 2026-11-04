// Runs only against a prepared launcher pointing at an explicitly isolated data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolveRuntimePaths } from '../apps/host/paths.ts';
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2), dataIndex = args.indexOf('--data');
if (dataIndex < 0 || !path.isAbsolute(args[dataIndex + 1] ?? '')) throw Error('Pass --data with the isolated empty data directory used by install -PrepareOnly -DataDirectory.');
const data = path.resolve(args[dataIndex + 1]);
const config = JSON.parse(await fs.readFile(path.join(root, 'dist/native/launcher.json'), 'utf8'));
if (path.resolve(config.data ?? '') !== data) throw Error('Prepared launcher data does not match the explicitly isolated probe directory');
try { if ((await fs.readdir(data)).length) throw Error('Probe requires an empty data directory; never run it on application data.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = { ...process.env, POLARION_SIDEBAR_DATA: data };
const runtime = resolveRuntimePaths({ root, env });
const server = spawn(runtime.node, [path.join(root, 'dist/host/server.mjs')], { cwd: path.dirname(root), env, windowsHide: true, stdio: 'ignore' });
let launcher;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('ISOLATED_HOST_START_TIMEOUT')), 15000);
    const attempt = () => {
      const socket = net.createConnection(runtime.pipe);
      socket.once('connect', () => { clearTimeout(timeout); socket.end(); resolve(); });
      socket.once('error', () => { if (server.exitCode !== null) { clearTimeout(timeout); reject(Error('ISOLATED_HOST_EXITED')); } else setTimeout(attempt, 100); });
    }; attempt();
  });
  const reply = await new Promise((resolve, reject) => {
    launcher = spawn(path.join(root, 'dist/native/PolarionSidebarHost.exe'), [config.origin], { cwd: path.dirname(root), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => reject(Error('ISOLATED_NATIVE_TRANSPORT_TIMEOUT')), 10000);
    let data = Buffer.alloc(0);
    launcher.once('error', reject);
    launcher.stderr.resume();
    launcher.stdout.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 4 && data.length >= 4 + data.readUInt32LE(0)) {
        clearTimeout(timeout); launcher.stdin.end();
        try { resolve(JSON.parse(data.subarray(4, 4 + data.readUInt32LE(0)).toString('utf8'))); } catch (error) { reject(error); }
      }
    });
    const request = Buffer.from(JSON.stringify({ protocol: 1, id: crypto.randomUUID(), command: { method: 'health' } }));
    const header = Buffer.alloc(4); header.writeUInt32LE(request.length); launcher.stdin.write(Buffer.concat([header, request]));
  });
  if (!reply.ok || reply.value?.pid !== server.pid) throw Error('ISOLATED_HEALTH_FAILED_OR_WRONG_PROCESS');
  const wrongOrigin = await new Promise((resolve, reject) => {
    const child = spawn(path.join(root, 'dist/native/PolarionSidebarHost.exe'), ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject); child.once('exit', resolve);
  });
  if (wrongOrigin !== 2) throw Error('NATIVE_ORIGIN_GUARD_FAILED');
  console.log(JSON.stringify({ ok: true, root, isolatedData: data, nativeTransport: true, health: reply, originGuardExit: wrongOrigin, registrationChanged: false, serverPid: server.pid, businessRequests: 0 }));
} finally {
  launcher?.kill();
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
}
