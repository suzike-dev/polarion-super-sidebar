import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.ts';
import { Events } from './events.ts';
import type { Target, WatchAlert } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'ev-test', document: 'Requirements/Ev' };

function openStore(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-db-'));
  const store = new Store(path.join(dir, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('事件总线：record/list 按项目过滤并倒序', t => {
  const store = openStore(t);
  const events = new Events(store);
  events.record('other', 'save', '别的项目');
  events.record(target.projectId, 'save', 'SPE-1 保存到 Polarion', { workItemId: 'SPE-1', detail: '修订 3' });
  events.record(target.projectId, 'watcher', '巡检发现 2 项差异', { detail: '5 个文件变化' });
  const rows = events.list(target.projectId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.kind, 'watcher'); // 最新在前
  assert.ok(rows[0]!.subject.includes('5 个文件变化'));
  assert.equal(rows[1]!.workItemId, 'SPE-1');
  assert.equal(events.list('other').length, 1);
});

test('守望警报：缺基准提示、模型侧变化置顶、索引过期提示、一切正常兜底', t => {
  const store = openStore(t);
  const events = new Events(store);
  // 未绑定任何根：没有警报 → 一切正常。
  let view = events.watch(target);
  assert.equal(view.alerts.length, 1);
  assert.equal(view.alerts[0]!.title, '一切正常');
  assert.equal(view.brief.enabled, false);

  // 绑定根但未设基准 → info 引导。
  store.put('model-roots', target.projectId, { roots: [{ id: 'r1', label: 'TMS', path: 'D:\\x' }] });
  view = events.watch(target);
  assert.equal(view.alerts[0]!.action, 'baseline');

  // 有基准 + 模型侧 findings → warn 置顶并汇总疑似过期需求数。
  store.put('model-check', `${target.projectId}:r1`, {
    id: `${target.projectId}:r1`, at: Date.now(), baselineAt: 1, ok: false, checkedFiles: 3, changedFiles: 2,
    findings: [
      { rootId: 'r1', rootLabel: 'TMS', moduleKey: 'A', moduleName: '模块A', side: 'model', files: [], workItems: [{ workItemId: 'SPE-1', title: '', requirementChanged: false }, { workItemId: 'SPE-2', title: '', requirementChanged: false }] },
      { rootId: 'r1', rootLabel: 'TMS', moduleKey: 'B', moduleName: '模块B', side: 'requirement', files: [], workItems: [] },
    ],
  });
  view = events.watch(target);
  const warns = view.alerts.filter((alert: WatchAlert) => alert.level === 'warn');
  assert.equal(warns.length, 1);
  assert.ok(warns[0]!.title.includes('1 个模块、2 条关联需求疑似过期'));
  assert.ok(warns[0]!.detail.includes('模块A'));

  // 覆盖索引过期 → info 提示重建。
  store.put('coverage-index', target.projectId, { id: target.projectId, projectId: target.projectId, at: Date.now() - 25 * 3600_000, total: 5, items: [] });
  view = events.watch(target);
  assert.ok(view.alerts.some(alert => alert.action === 'coverage-sync'));
});
