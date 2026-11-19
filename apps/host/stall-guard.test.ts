import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.ts';
import { sweepStalledRecords, STALL_GRACE_MS } from './stall-guard.ts';
import type { Run, Target } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'stall-test', document: 'Requirements/X' };

function openStore(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-db-'));
  const store = new Store(path.join(dir, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

function seedRun(store: Store, sessionId: string, status: Run['status'], startedAt = Date.now()) {
  const run = store.startRun(sessionId, crypto.randomUUID(), 'x', [], target).run;
  run.status = status; run.startedAt = startedAt;
  store.put('run', run.id, run);
  return run;
}

test('自愈：run 已丢失/终态 → 记录置 failed；completed → 交调用方回填；引擎仍在跑且有宽限 → 不动', (t) => {
  const store = openStore(t);
  const sessionId = store.createSession(target, 'stall').id;
  // 1) run 丢失
  store.put('review-record', 'r-missing', { id: 'r-missing', projectId: target.projectId, document: 'd', at: 1, status: 'running', runId: 'nope', issues: [] });
  // 2) run 失败
  const failedRun = seedRun(store, sessionId, 'failed');
  store.put('meeting-record', 'm-failed', { id: 'm-failed', projectId: target.projectId, document: 'd', at: 1, status: 'running', runId: failedRun.id, actions: [] });
  // 3) run 已完成但回填没走
  const doneRun = seedRun(store, sessionId, 'completed');
  store.put('review-record', 'r-done', { id: 'r-done', projectId: target.projectId, document: 'd', at: 1, status: 'running', runId: doneRun.id, issues: [] });
  // 4) 引擎仍在跑的年轻 run
  const liveRun = seedRun(store, sessionId, 'running');
  store.put('meeting-record', 'm-live', { id: 'm-live', projectId: target.projectId, document: 'd', at: 1, status: 'running', runId: liveRun.id, actions: [] });
  // 5) 僵尸：running 但引擎无此 run 且超宽限
  const zombieRun = seedRun(store, sessionId, 'running', Date.now() - STALL_GRACE_MS - 1000);
  store.put('review-record', 'r-zombie', { id: 'r-zombie', projectId: target.projectId, document: 'd', at: 1, status: 'running', runId: zombieRun.id, issues: [] });

  const sweep = sweepStalledRecords(store, id => id === liveRun.id);
  assert.deepEqual(sweep.completed.map(run => run.id), [doneRun.id]);
  assert.deepEqual(sweep.failed.map(row => [row.id, row.reason]).sort(), [
    ['m-failed', 'FAILED'],
    ['r-missing', 'RUN_MISSING'],
    ['r-zombie', 'RUN_STALLED'],
  ].sort());
  assert.equal(store.get<{ status: string }>('review-record', 'r-missing')!.status, 'failed');
  assert.equal(store.get<{ status: string }>('meeting-record', 'm-failed')!.status, 'failed');
  assert.equal(store.get<{ status: string }>('meeting-record', 'm-live')!.status, 'running'); // 年轻且活跃：不动
  assert.equal(store.get<{ status: string }>('review-record', 'r-done')!.status, 'running'); // 等回填
  const zombie = store.get<Run>('run', zombieRun.id)!;
  assert.equal(zombie.status, 'interrupted');
  assert.equal(zombie.error, 'RUN_STALLED');
  // 幂等：再跑一次不再产生新失败（r-done 仍 running 但 run 已 completed → 仍在 completed 列表）。
  const again = sweepStalledRecords(store, id => id === liveRun.id);
  assert.equal(again.failed.length, 0);
});
