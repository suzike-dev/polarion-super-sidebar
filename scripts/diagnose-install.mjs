import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveRuntimePaths } from '../apps/host/paths.ts';
import { verifyDiagramDesignBundle } from '../apps/host/diagram-design.ts';

export async function diagnoseInstall({ root = path.resolve(import.meta.dirname, '..'), env = process.env, checkCli = false } = {}) {
  const configuration = path.join(root, 'dist/native/launcher.json');
  let launcher;
  try { launcher = JSON.parse(await fs.readFile(configuration, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const configuredEnv = { ...env };
  if (launcher?.data) configuredEnv.POLARION_SIDEBAR_DATA = launcher.data;
  if (launcher?.claude) configuredEnv.POLARION_SIDEBAR_CLAUDE = launcher.claude;
  if (launcher?.credentials) configuredEnv.POLARION_SIDEBAR_CREDENTIALS = launcher.credentials;
  const resolved = resolveRuntimePaths({ root, env: configuredEnv, home: configuredEnv.USERPROFILE ?? configuredEnv.HOME });
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add('platform', process.platform === 'win32' && process.arch === 'x64', process.platform + '/' + process.arch);
  for (const relative of ['.runtime/node-v24.22.2-win-x64/node.exe','dist/host/server.mjs','dist/host/native-bridge.mjs','dist/host/polarion-worker.mjs','scripts/start-polarion-worker.ps1','apps/extension/identity.json','apps/extension/.output/chrome-mv3/manifest.json']) {
    try { add(relative, (await fs.stat(path.join(root, relative))).isFile(), 'present'); } catch { add(relative, false, 'missing'); }
  }
  try {
    const version = execFileSync(resolved.node, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
    add('private-node-version', version === 'v24.22.2', version);
    const record = JSON.parse(await fs.readFile(path.join(root, '.runtime/runtime.json'), 'utf8'));
    add('private-node-integrity', createHash('sha256').update(await fs.readFile(resolved.node)).digest('hex') === record.sha256 && record.verified === true, 'compared with setup-runtime record');
  } catch { add('private-node-integrity', false, 'run node scripts/setup-runtime.mjs to create a verified runtime record'); }
  try {
    const packages = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(packages.dependencies)) {
      // @types and ESM-only packages need not expose a CommonJS entry point.
      // Check this installation's own package, never ancestor/global resolution.
      const metadata = JSON.parse(await fs.readFile(path.join(root, 'node_modules', dependency, 'package.json'), 'utf8'));
      if (metadata.name !== dependency) throw Error('Unexpected dependency identity');
    }
    add('runtime-dependencies', true, 'all declared dependency package manifests are present inside this installation');
  } catch { add('runtime-dependencies', false, 'run npm ci --ignore-scripts in this installation'); }
  try {
    const bundle = await verifyDiagramDesignBundle({ resourcesDirectory: path.join(root, 'resources/diagram-design') });
    add('diagram-design-resources', true, { files: bundle.manifest.fileCount, commit: bundle.manifest.commit });
  } catch { add('diagram-design-resources', false, 'bundled resources are missing or changed'); }
  add('claude-installed', resolved.claude.found, { path: resolved.claude.path ?? null, source: resolved.claude.source, error: resolved.claude.error ?? null });
  if (checkCli && resolved.claude.found) {
    try {
      const js = /\.[cm]?js$/i.test(resolved.claude.path);
      const version = execFileSync(js ? resolved.node : resolved.claude.path, js ? [resolved.claude.path, '--version'] : ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 20000, env: configuredEnv, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      add('claude-version', /^\d+\.\d+\.\d+/.test(version), version.match(/^\d+\.\d+\.\d+/)?.[0] ?? 'unexpected version output');
    } catch { add('claude-version', false, 'version command failed; no CLI output or credentials included'); }
  }
  const privateCredentials = path.join(resolved.data, 'credentials.json');
  let privateExists = false; try { privateExists = (await fs.stat(privateCredentials)).isFile(); } catch {}
  const credentials = configuredEnv.POLARION_SIDEBAR_CREDENTIALS ?? (privateExists ? privateCredentials : path.join(configuredEnv.LOCALAPPDATA ?? path.dirname(resolved.data), 'PolarionMcp/credentials.json'));
  try { add('polarion-credential-file', path.isAbsolute(credentials) && (await fs.stat(credentials)).isFile(), { path: credentials, contentsRead: false, authenticationVerified: false }); }
  catch { add('polarion-credential-file', false, { path: credentials, contentsRead: false, fix: 'Run scripts/configure-polarion-credentials.ps1 for this Windows user, or install with -CredentialPath. MCP is optional. DPAPI files cannot be migrated from another computer.' }); }
  if (launcher) add('launcher-location', path.resolve(launcher.root) === path.resolve(root) && launcher.node === resolved.node && launcher.bridge === path.join(root, 'dist/host/native-bridge.mjs'), 're-run install-dev-host.ps1 after moving the installation');
  return { ok: checks.every(check => check.ok), root: resolved.root, data: resolved.data, registeredByThisCommand: false, credentialsDisclosed: false, checks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), rootIndex = args.indexOf('--root');
  const result = await diagnoseInstall({ root: rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : undefined, checkCli: args.includes('--check-cli') });
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--strict') && !result.ok) process.exitCode = 1;
}
