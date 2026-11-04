import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { ContextUsageCache, contextUsageSnapshot } from './context-usage.ts';
import { permissionPreview, safeError } from './engine.ts';

const response = (tokens = 42000) => ({ totalTokens: tokens, rawMaxTokens: 200000, maxTokens: 180000,
  percentage: tokens / 2000, model: 'fixture-model', categories: [
    { name: 'Messages', tokens, kind: 'used', color: 'blue' },
    { name: 'Deferred tools', tokens: 2000, kind: 'deferred', color: 'grey' },
  ], memoryFiles: [{ path: 'PRIVATE_PATH_FIXTURE', type: 'User', tokens: 1 }],
} as SDKControlGetContextUsageResponse);

test('snapshot preserves actual compaction window, over-limit percentage and excludes private SDK detail', () => {
  const value = contextUsageSnapshot(response(210000), 123);
  assert.deepEqual(value, { usedTokens: 210000, windowTokens: 200000, percentage: 105, model: 'fixture-model', updatedAt: 123,
    categories: [{ name: 'Messages', tokens: 210000, kind: 'used' }, { name: 'Deferred tools', tokens: 2000, kind: 'deferred' }] });
  assert.ok(!JSON.stringify(value).includes('PRIVATE_PATH_FIXTURE'));
  assert.throws(() => contextUsageSnapshot({ ...response(), totalTokens: NaN }), /INVALID_CONTEXT_USAGE/);
});

test('cold reads remain unknown, warm reads cache and concurrent refreshes share one summary request', async () => {
  let calls = 0, resolve!: (value: SDKControlGetContextUsageResponse) => void;
  const runtime = { getContextUsage: async (options?: { detail?: 'summary' | 'full' }) => {
    calls++; assert.equal(options?.detail, 'summary');
    return new Promise<SDKControlGetContextUsageResponse>(done => { resolve = done; });
  } };
  let current: typeof runtime | undefined;
  const cache = new ContextUsageCache(() => current);
  assert.deepEqual(await cache.read('s', true), { usage: null, connected: false, compacting: false });
  current = runtime;
  assert.equal((await cache.read('s')).usage, null); assert.equal(calls, 0);
  const first = cache.read('s', true), second = cache.read('s', true);
  resolve(response()); await Promise.all([first, second]);
  assert.equal(calls, 1);
  cache.setCompacting('s', true);
  const state = await cache.read('s');
  assert.equal(state.usage?.usedTokens, 42000); assert.equal(state.compacting, true); assert.equal(calls, 1);
  current = undefined;
  assert.deepEqual(await cache.read('s'), { usage: null, connected: false, compacting: false });
});

test('a response arriving after disconnect cannot become a measurement of a new runtime', async () => {
  let resolve!: (value: SDKControlGetContextUsageResponse) => void;
  let current = { getContextUsage: () => new Promise<SDKControlGetContextUsageResponse>(done => { resolve = done; }) };
  const cache = new ContextUsageCache(() => current);
  const pending = cache.read('s', true);
  cache.disconnect('s'); current = { getContextUsage: async () => response(100) };
  resolve(response(99000));
  assert.equal((await pending).usage, null);
  assert.equal((await cache.read('s', true)).usage?.usedTokens, 100);
});

test('failure and timeout preserve prior measured usage without inventing zeros', async () => {
  let mode: 'ok' | 'fail' | 'hang' = 'ok';
  const runtime = { getContextUsage: async () => {
    if (mode === 'fail') throw Error('fixture');
    if (mode === 'hang') return new Promise<SDKControlGetContextUsageResponse>(() => {});
    return response();
  } };
  const cache = new ContextUsageCache(() => runtime, 10);
  const original = (await cache.read('s', true)).usage;
  mode = 'fail'; assert.deepEqual((await cache.read('s', true)).usage, original);
  mode = 'hang'; assert.deepEqual((await cache.read('s', true)).usage, original);
});

test('clear invalidates in-flight measurements on the same runtime, in either completion order', async () => {
  for (const oldFirst of [true, false]) {
    const resolvers: ((value: SDKControlGetContextUsageResponse) => void)[] = [];
    const runtime = { getContextUsage: () => new Promise<SDKControlGetContextUsageResponse>(resolve => resolvers.push(resolve)) };
    const cache = new ContextUsageCache(() => runtime);
    const oldRead = cache.read('same-stream', true);
    cache.disconnect('same-stream');
    const newRead = cache.read('same-stream', true);
    assert.equal(resolvers.length, 2);
    if (oldFirst) {
      resolvers[0]!(response(99000)); await oldRead;
      assert.equal((await cache.read('same-stream')).usage, null);
    }
    resolvers[1]!(response(100)); await newRead;
    if (!oldFirst) { resolvers[0]!(response(99000)); await oldRead; }
    assert.equal((await cache.read('same-stream')).usage?.usedTokens, 100);
  }
});

test('permission preview recursively removes fake secrets while retaining useful operation details', () => {
  const marker = 'DUMMY_NOT_A_CREDENTIAL';
  const preview = permissionPreview({ action: 'inspect', nested: [{ password: marker + ' with spaces', api_key: marker,
    Authorization: 'Bearer ' + marker, other: { refreshToken: marker }, visible: 'safe detail' }] });
  assert.ok(!preview.includes(marker)); assert.ok(preview.includes('safe detail')); assert.ok(preview.includes('inspect'));
  assert.ok(!safeError(JSON.stringify({ password: marker })).includes(marker));
  assert.ok(!permissionPreview({ command: 'fixture --token=' + marker }).includes(marker));
});
