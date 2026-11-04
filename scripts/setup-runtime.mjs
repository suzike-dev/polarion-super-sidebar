import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export async function setupRuntime({ root = path.resolve(import.meta.dirname, '..'), fetcher = fetch, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'win32' || arch !== 'x64') throw Error('This release requires Windows x64. No runtime was downloaded.');
  const version = 'v24.22.2', base = `https://nodejs.org/dist/${version}/`;
  const destination = path.join(root, `.runtime/node-${version}-win-x64`), file = path.join(destination, 'node.exe');
  async function download(url) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`Official runtime download failed: HTTP ${response.status}`);
    return response;
  }
  const checks = await (await download(base + 'SHASUMS256.txt')).text();
  const expected = checks.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === 'win-x64/node.exe')?.[0];
  if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) throw Error('Official checksum missing');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  let prior;
  try { prior = await fs.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let reused = !!prior && digest(prior) === expected;
  if (!reused) {
    const bytes = Buffer.from(await (await download(base + 'win-x64/node.exe')).arrayBuffer());
    if (digest(bytes) !== expected) throw Error('Node checksum mismatch; existing runtime preserved');
    await fs.mkdir(destination, { recursive: true });
    const temporary = path.join(destination, 'node-' + crypto.randomUUID() + '.tmp');
    try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  const record = { version, architecture: 'win-x64', source: base, sha256: expected, verified: true, reused, global_path_changed: false };
  await fs.writeFile(path.join(root, '.runtime/runtime.json'), JSON.stringify(record, null, 2) + '\n');
  return { ...record, path: destination };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await setupRuntime())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
