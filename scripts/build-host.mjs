import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
// Both apps/host and dist/host locate resources two levels up. Fail before
// emitting an apparently complete Host if its shipped skill is missing.
await fs.access(path.join(root, 'resources/diagram-design/source.json'));
await fs.access(path.join(root, 'resources/diagram-design/skill/SKILL.md'));
await build({ absWorkingDir: root, entryPoints: ['apps/host/server.ts', 'apps/host/native-bridge.ts', 'apps/host/polarion-worker.ts'], outdir: 'dist/host', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true });
