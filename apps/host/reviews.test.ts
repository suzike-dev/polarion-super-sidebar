import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.ts';
import { Reviews } from './reviews.ts';
import { Meetings } from './meeting.ts';
import type { Engines } from './engine.ts';
import type { Run, Target } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'review-test', document: 'Requirements/R' };

function openStore(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-db-'));
  const store = new Store(path.join(dir, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('缺引擎时拒绝启动（避免 startRun 直接置 running 造成僵尸），有引擎时 execute 被真实调用', async (t) => {
  const store = openStore(t);
  const session = store.createSession(target, '评审会话');
  const reviews = new Reviews(store);
  await assert.rejects(async () => reviews.start(session.id, target, [], 'auto'), /ENGINE_UNAVAILABLE/);
  assert.equal(store.list('run').length, 0, '拒绝时不得留下 run 记录');
  assert.equal(store.list('review-record').length, 0);

  const executed: Run[] = [];
  const fake = {
    execute: async (run: Run) => { executed.push(run); },
    pump: () => {},
    isActiveRun: () => false,
  } as unknown as Engines;
  reviews.engines = fake;
  const { reviewId, runId } = reviews.start(session.id, target, [], 'auto');
  assert.equal(executed.length, 1); // 关键回归：以前 engines 未注入时这里是 0，run 永远卡 running
  assert.equal(executed[0]!.id, runId);
  assert.equal(store.get<{ runId?: string }>('review-record', reviewId)!.runId, runId);

  const meetings = new Meetings(store);
  await assert.rejects(async () => meetings.start(session.id, target, [], 'auto', '纪要'), /ENGINE_UNAVAILABLE/);
  meetings.engines = fake;
  const meeting = meetings.start(session.id, target, [], 'auto', '纪要');
  // 会话里已有在跑 run：第二条会排队由 pump 领取（假 pump 不执行），记录仍须持有 runId。
  const meetingRun = store.get<Run>('run', meeting.runId)!;
  assert.ok(['running', 'queued'].includes(meetingRun.status));
  assert.equal(store.get<{ runId?: string }>('meeting-record', meeting.meetingId)!.runId, meeting.runId);
});

test('meeting decisions preserve the source document and reopen a cleared record with its action', t => {
  const store = openStore(t), meetings = new Meetings(store);
  const id = crypto.randomUUID(), actionId = crypto.randomUUID();
  store.put('meeting-record', id, { id, projectId: target.projectId, document: target.document, at: 1, status: 'open', digest: '纪要', actions: [{ id: actionId, title: '口头说明', priority: 'normal', status: 'open' }] });
  const [record] = meetings.list({ ...target, document: 'Requirements/Other' });
  assert.equal(record?.document, target.document);
  assert.equal(meetings.decide(id, actionId, 'done').status, 'done');
  const reopened = meetings.decide(id, actionId, 'open');
  assert.equal(reopened.status, 'open'); assert.equal(reopened.actions[0]?.status, 'open');
  assert.deepEqual(reopened, meetings.list(target)[0]);
});
