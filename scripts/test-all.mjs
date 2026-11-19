import {readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const roots = ['packages/core', 'apps/host', 'apps/extension/lib'];
const files = roots.flatMap(dir => readdirSync(path.join(root, dir))
  .filter(name => name.endsWith('.test.ts'))
  .map(name => path.join(dir, name).replaceAll('\\', '/')));
const heavy = 'apps/extension/lib/app-runtime.test.ts';

// The App runtime suite mounts the whole application many times in JSDOM. Running
// every case in one process accumulates enough detached DOM to exhaust V8's
// external buffers on Windows. Each case runs in its own process so the suite is
// deterministic on both local machines and CI; all other files run serially for
// the same reason.
const regular = files.filter(file => file !== heavy);
const run = (args, options = {}) => spawnSync(process.execPath, args, {
  cwd: root, encoding: 'utf8', timeout: 300000, ...options,
});
const regularRun = run(['--test', '--test-concurrency=1', ...regular], {stdio: 'inherit'});
if (regularRun.status !== 0) process.exit(regularRun.status ?? 1);

const source = readFileSync(path.join(root, heavy), 'utf8');
const names = [...source.matchAll(/await run\('([^']+)'/g)].map(match => match[1]);
if (!names.length) {
  console.error('app-runtime.test.ts: no cases discovered');
  process.exit(1);
}
let failed = 0;
for (const [index, name] of names.entries()) {
  const pattern = '^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const result = run(['--test', '--test-name-pattern', pattern, heavy]);
  const passed = result.status === 0 && /ℹ pass 1/.test(result.stdout) && /ℹ fail 0/.test(result.stdout);
  console.log(`${passed ? '✔' : '✖'} app-runtime [${index + 1}/${names.length}] ${name}`);
  if (!passed) {
    failed++;
    console.error((result.stdout || '').slice(-1200));
    console.error((result.stderr || '').slice(-600));
  }
}
if (failed) {
  console.error(`app-runtime: ${failed}/${names.length} cases failed`);
  process.exit(1);
}
console.log(`app-runtime: ${names.length}/${names.length} cases passed in isolated processes`);
