import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setupRuntime } from './setup-runtime.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const nodeBytes = Buffer.from('synthetic runtime fixture; never executed');
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime path 中文 '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('runtime downloader handles CRLF checksums and Unicode/space paths, then reuses verified bytes', async t => {
  const root = await directory(t); let binaries = 0;
  const fetcher = async url => url.endsWith('SHASUMS256.txt') ? new Response(digest(nodeBytes) + '  win-x64/node.exe\r\n') : (binaries++, new Response(nodeBytes));
  const first = await setupRuntime({ root, fetcher, platform: 'win32', arch: 'x64' });
  assert.equal(first.reused, false); assert.equal(first.verified, true);
  const again = await setupRuntime({ root, fetcher, platform: 'win32', arch: 'x64' });
  assert.equal(again.reused, true); assert.equal(binaries, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.runtime/runtime.json'))).global_path_changed, false);
});
test('checksum and HTTP failures never replace an existing runtime', async t => {
  const root = await directory(t), folder = path.join(root, '.runtime/node-v24.22.2-win-x64');
  await fs.mkdir(folder, { recursive: true }); const file = path.join(folder, 'node.exe');
  await fs.writeFile(file, 'previous runtime');
  await assert.rejects(setupRuntime({ root, platform: 'win32', arch: 'x64', fetcher: async url => url.endsWith('SHASUMS256.txt') ? new Response(digest(nodeBytes) + '  win-x64/node.exe\n') : new Response('corrupted') }), /checksum mismatch/);
  assert.equal(await fs.readFile(file, 'utf8'), 'previous runtime');
  await assert.rejects(setupRuntime({ root, platform: 'win32', arch: 'x64', fetcher: async () => new Response('unavailable', { status: 503 }) }), /HTTP 503/);
  assert.equal(await fs.readFile(file, 'utf8'), 'previous runtime');
  assert.deepEqual(await fs.readdir(folder), ['node.exe']);
});
test('unsupported systems fail before any network access', async t => {
  const root = await directory(t);
  await assert.rejects(setupRuntime({ root, platform: 'linux', arch: 'x64', fetcher: async () => { throw Error('network should not be used'); } }), /Windows x64/);
  assert.deepEqual(await fs.readdir(root), []);
});
