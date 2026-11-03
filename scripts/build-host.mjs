import { build } from 'esbuild';
await build({ entryPoints: ['apps/host/server.ts', 'apps/host/native-bridge.ts', 'apps/host/polarion-worker.ts'], outdir: 'dist/host', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true });
