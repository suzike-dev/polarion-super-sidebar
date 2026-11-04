// No registration, existing account data, authenticated Agent request or Polarion request.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
const argument = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const source = path.resolve(import.meta.dirname, '..');
const destination = argument('--destination');
const npmCli = argument('--npm-cli');
if (!destination || !path.isAbsolute(destination) || !npmCli || !path.isAbsolute(npmCli)) throw Error('Pass absolute --destination (new empty directory, preferably another drive and including spaces/Chinese) and --npm-cli from the installed Node/npm prerequisite.');
if (path.resolve(destination).toLowerCase().startsWith(source.toLowerCase() + path.sep) || path.resolve(destination) === source) throw Error('Clean room must be independent from this working tree.');
try { await fs.access(destination); throw Error('Clean-room destination already exists; choose a new directory.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const evidence = path.join(source, '.research/release-20261104/portability');
await fs.mkdir(evidence, { recursive: true });
const record = { startedAt: new Date().toISOString(), source, destination, bootstrapNode: process.version, npmCli, isolation: { copiedDependencyCache: false, copiedCredentials: false, copiedGlobalConfig: false, registryWrites: false, realBusinessRequests: false }, steps: [] };
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const registryCommand = '$r=@{};foreach($k in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nanju.polarion.sidebar","HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nanju.polarion.sidebar")){if(Test-Path -LiteralPath $k){$r[$k]=(Get-Item -LiteralPath $k).GetValue("")}else{$r[$k]=$null}};$r|ConvertTo-Json -Compress';
const registryBefore = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', registryCommand], { encoding: 'utf8', windowsHide: true }).trim();
await fs.mkdir(destination, { recursive: true });
for (const name of ['apps', 'packages', 'resources', 'scripts']) {
  await fs.cp(path.join(source, name), path.join(destination, name), { recursive: true, filter: file => !['node_modules','.output','.wxt'].includes(path.basename(file)) });
}
for (const name of ['package.json','package-lock.json','tsconfig.json']) await fs.copyFile(path.join(source, name), path.join(destination, name));
record.snapshot = Object.fromEntries(await Promise.all(['package-lock.json','apps/host/paths.ts','scripts/install-dev-host.ps1','scripts/start-polarion-worker.ps1','scripts/build-host.mjs'].map(async name => [name, createHash('sha256').update(await fs.readFile(path.join(destination, name))).digest('hex')])));
const isolatedHome = path.join(destination, 'isolated home 用户'), data = path.join(destination, 'isolated app data');
await fs.mkdir(path.join(isolatedHome, 'AppData/Roaming'), { recursive: true });
await fs.mkdir(path.join(isolatedHome, 'AppData/Local'), { recursive: true });
const emptyNpmConfig = path.join(isolatedHome, 'empty.npmrc');
await fs.writeFile(emptyNpmConfig, '');
const emptyGlobalNpmConfig = path.join(isolatedHome, 'empty-global.npmrc');
await fs.writeFile(emptyGlobalNpmConfig, '');
const env = {};
for (const name of ['SystemRoot','WINDIR','COMSPEC','TEMP','TMP','ProgramFiles','ProgramFiles(x86)','ProgramData','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PATHEXT']) if (process.env[name]) env[name] = process.env[name];
Object.assign(env, { USERPROFILE: isolatedHome, HOME: isolatedHome, APPDATA: path.join(isolatedHome, 'AppData/Roaming'), LOCALAPPDATA: path.join(isolatedHome, 'AppData/Local'), npm_config_cache: path.join(destination, '.cache/npm'), npm_config_userconfig: emptyNpmConfig, npm_config_globalconfig: emptyGlobalNpmConfig, npm_config_registry: 'https://registry.npmjs.org', PATH: [path.dirname(process.execPath), path.join(process.env.SystemRoot, 'System32'), path.dirname(powershell)].join(path.delimiter) });
async function run(name, executable, commandArgs, extra = {}) {
  const started = Date.now(), log = path.join(evidence, name + '.log');
  console.log('START ' + name);
  const child = spawn(executable, commandArgs, { cwd: destination, env, windowsHide: true, stdio: ['ignore','pipe','pipe'], ...extra });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await fs.writeFile(log, output);
  record.steps.push({ name, exit, durationMs: Date.now() - started, log, command: [executable, ...commandArgs] });
  console.log('END ' + name + ' exit=' + exit);
  if (exit !== 0) throw Error('Clean-room step failed: ' + name + '; inspect ' + log);
  return output;
}
try {
  await run('01-runtime-download', process.execPath, [path.join(destination, 'scripts/setup-runtime.mjs')], { cwd: path.dirname(destination) });
  const node = path.join(destination, '.runtime/node-v24.22.2-win-x64/node.exe');
  env.PATH = [path.dirname(node), path.join(process.env.SystemRoot, 'System32'), path.dirname(powershell)].join(path.delimiter);
  await run('02-npm-clean-install', node, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  await run('03-check-and-build', powershell, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(destination, 'scripts/check.ps1')]);
  await run('04-build-from-other-cwd', node, [path.join(destination, 'scripts/build-host.mjs')], { cwd: path.dirname(destination) });
  await run('05-prepare-native-launcher', powershell, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(destination, 'scripts/install-dev-host.ps1'),'-PrepareOnly','-DataDirectory',data]);
  await run('06-diagnose-missing-prerequisites', node, [path.join(destination, 'scripts/diagnose-install.mjs')]);
  await run('07-native-transport', node, [path.join(destination, 'scripts/probe-portable-host.mjs'),'--data',data]);
  await run('08-first-legacy-extension-copy', powershell, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(destination, 'scripts/deploy-dev-extension.ps1')]);
  record.complete = true;
} catch (error) { record.complete = false; record.error = error.message; process.exitCode = 1; }
finally {
  const registryAfter = execFileSync(powershell, ['-NoProfile','-NonInteractive','-Command',registryCommand], { encoding: 'utf8', windowsHide: true }).trim();
  record.registryUnchanged = registryBefore === registryAfter;
  record.endedAt = new Date().toISOString();
  await fs.writeFile(path.join(evidence, 'cleanroom.json'), JSON.stringify(record, null, 2) + '\n');
  if (!record.registryUnchanged) { console.error('Unexpected registry change during read-only probe'); process.exitCode = 1; }
  console.log(JSON.stringify({ complete: record.complete, registryUnchanged: record.registryUnchanged, destination, evidence }));
}
