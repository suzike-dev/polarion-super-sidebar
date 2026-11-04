// Development probes use separately installed CLIs, never another repository's cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudeExecutable } from '../apps/host/paths.ts';
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
export function probeCli(name) {
  let executable;
  if (name === 'claude') {
    const found = resolveClaudeExecutable();
    if (!found.found) throw Error(found.error + ': install/configure Claude Code before the optional development probe.');
    executable = found.path;
  } else if (name === 'codex') {
    const override = process.env.POLARION_PROBE_CODEX;
    if (override) {
      if (!path.isAbsolute(override) || !/\.(exe|[cm]?js)$/i.test(override) || !isFile(override)) throw Error('POLARION_PROBE_CODEX must be an existing absolute executable or JavaScript CLI path.');
      executable = override;
    } else {
      const directories = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).map(item => item.trim().replace(/^"|"$/g, '')).filter(item => item && path.isAbsolute(item));
      directories.push(path.join(os.homedir(), '.local/bin'));
      if (process.env.APPDATA) directories.push(path.join(process.env.APPDATA, 'npm'));
      const candidates = directories.flatMap(directory => [path.join(directory, 'codex.exe'), path.join(directory, 'node_modules/@openai/codex/bin/codex.js')]);
      executable = candidates.find(isFile);
      if (!executable) throw Error('Codex CLI not found on PATH. Install it separately or set POLARION_PROBE_CODEX; Codex is not a product runtime dependency.');
    }
  } else throw Error('Unknown development CLI');
  return /\.[cm]?js$/i.test(executable) ? { command: process.execPath, prefix: [executable] } : { command: executable, prefix: [] };
}
export function requireDevelopmentProbe() {
  if (process.argv.includes('--help')) {
    console.log('Optional development inference probe, not an installation check. Uses your configured CLI account and may incur model usage. Set POLARION_RUN_DEVELOPMENT_PROBES=1 explicitly to run; no business tools/actions are requested.');
    process.exit(0);
  }
  if (process.env.POLARION_RUN_DEVELOPMENT_PROBES !== '1') throw Error('Development inference is disabled by default. Read --help and explicitly set POLARION_RUN_DEVELOPMENT_PROBES=1 to run.');
}
