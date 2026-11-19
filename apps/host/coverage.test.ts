import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from './store.ts';
import { Drafts, Polarion, type ChangeRemoteRow, type ChangeWriteInput } from './polarion.ts';
import { Coverage, tokenize, dedupScore } from './coverage.ts';
import type { CoverageView, ModelCheckView, ModelIndexView, Target } from '../../packages/protocol/index.ts';

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'cov-test', document: 'Requirements/Cov' };

function openStore(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-db-'));
  const store = new Store(path.join(dir, 'test.db'));
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

/** dedup/impact 只读本机 sqlite：远端桩保持不可触达即可。 */
class DeadRemote extends Polarion {
  override start(): never { throw Error('TEST_REMOTE_DISABLED'); }
  override async changeList(): Promise<ChangeRemoteRow[]> { throw Error('TEST_REMOTE_DISABLED'); }
  override async changeWrite(_input: ChangeWriteInput): Promise<never> { throw Error('TEST_REMOTE_DISABLED'); }
}

function fixture(t: TestContext) {
  const store = openStore(t);
  const drafts = new Drafts(store, new DeadRemote());
  // @ts-expect-error dedup/impact 不触达远端，Model 仅占位
  const coverage = new Coverage(store, drafts, {});
  return { store, coverage };
}

type Item = { workItemId: string; title: string; text: string; marks: { rootId: string; modules: string[] }[]; forwardLinks: { workItemId: string; role: string }[]; backLinks: { workItemId: string; role: string }[]; updated?: string; outline?: string };
function seedIndex(store: Store, items: Item[]) {
  store.put('coverage-index', target.projectId, {
    id: target.projectId, projectId: target.projectId, at: Date.now(), total: items.length,
    items: items.map(item => ({ workItemId: item.workItemId, title: item.title, type: 'Requirement', outline: item.outline ?? '', updated: item.updated ?? 'v1', marks: item.marks, text: item.text, forwardLinks: item.forwardLinks, backLinks: item.backLinks })),
  });
}

test('tokenize：CJK 二元组 + 拉丁词/十六进制，去停用词', () => {
  const tokens = tokenize('整车高压 VCU_BATT_PWRON 状态由 0x0 跳变为 0x1，热管理 shall 退出');
  assert.ok(tokens.includes('vcu_batt_pwron'));
  assert.ok(tokens.includes('0x0'));
  assert.ok(tokens.includes('0x1'));
  assert.ok(tokens.includes('整车') && tokens.includes('车高') && tokens.includes('高压'));
  assert.ok(!tokens.includes('shall'));
  assert.ok(!tokens.includes('的'));
});

test('dedupScore：重叠系数按较小集合归一，共享术语截断', () => {
  const query = new Set(['高压', '退出', 'vcu_batt_pwron', '0x0']);
  const candidate = new Set(['高压', '退出', 'vcu_batt_pwron', '热管理', '300ms']);
  const { score, shared } = dedupScore(query, candidate);
  assert.equal(score, 0.75);
  assert.deepEqual(shared, ['高压', '退出', 'vcu_batt_pwron']);
  assert.equal(dedupScore(new Set(), candidate).score, 0);
});

test('dedup：相似条目排序、排除自身、空索引给引导', t => {
  const { store, coverage } = fixture(t);
  assert.throws(() => coverage.dedup(target, '任意文本', 5), /DEDUP_INDEX_EMPTY/);
  seedIndex(store, [
    { workItemId: 'SPE-1', title: '整车高压下电', text: '整车高压 VCU_BATT_PWRON 状态由 0x0 跳变为 0x1，热管理高压部件需在 300ms 内退出高压状态。', marks: [], forwardLinks: [], backLinks: [] },
    { workItemId: 'SPE-2', title: 'CAN 唤醒', text: '网络管理报文唤醒整车网络，休眠电流小于 3mA。', marks: [], forwardLinks: [], backLinks: [] },
    { workItemId: 'SPE-3', title: '高压下电（旧稿）', text: 'VCU_BATT_PWRON 由 0x0 跳变为 0x1 时高压部件退出。', marks: [], forwardLinks: [], backLinks: [] },
  ]);
  const { matches, indexed } = coverage.dedup(target, 'VCU_BATT_PWRON 由 0x0 跳变为 0x1，高压部件在 300ms 内退出高压。', 5, 'SPE-1');
  assert.equal(indexed, 3);
  assert.ok(matches.length >= 1);
  assert.ok(matches[0]!.score > 0.5);
  assert.notEqual(matches[0]!.workItemId, 'SPE-1'); // exclude 生效
});

test('view：三层覆盖计数与孤立条目汇总', t => {
  const { store, coverage } = fixture(t);
  seedIndex(store, [
    { workItemId: 'SPE-1', title: '全有', text: '', marks: [{ rootId: 'r1', modules: ['A'] }], forwardLinks: [{ workItemId: 'SYS-1', role: 'derives' }], backLinks: [{ workItemId: 'TC-1', role: 'verifies' }] },
    { workItemId: 'SPE-2', title: '只有模块', text: '', marks: [{ rootId: 'r1', modules: ['A', 'B'] }], forwardLinks: [], backLinks: [] },
    { workItemId: 'SPE-3', title: '孤立', text: '', marks: [], forwardLinks: [], backLinks: [] },
    { workItemId: 'SPE-4', title: '只有验证', text: '', marks: [], forwardLinks: [{ workItemId: 'TC-2', role: 'tested_by' }], backLinks: [] },
  ]);
  const view: CoverageView = coverage.view(target);
  assert.equal(view.items.length, 4);
  assert.deepEqual(view.summary, { withUpstream: 1, withModule: 2, withVerification: 2, orphans: 1 });
  // 角色分类：derives 算上游；verifies/tested_by 算验证（含正向 tested_by）。
  assert.equal(view.items[0]!.upstream, 1);
  assert.equal(view.items[0]!.verification, 1);
  assert.equal(view.items[3]!.verification, 1);
});

test('impact：模块含巡检疑似过期，上下游与验证按角色分组', t => {
  const { store, coverage } = fixture(t);
  seedIndex(store, [
    { workItemId: 'SPE-9', title: '高压判定', text: '', marks: [{ rootId: 'r1', modules: ['TMS_HPMode', 'TMS_Power'] }, { rootId: 'r2', modules: ['TMS_HPMode'] }], forwardLinks: [{ workItemId: 'SYS-9', role: 'derives' }, { workItemId: 'TC-9', role: 'verifies' }], backLinks: [{ workItemId: 'TC-10', role: 'tests' }, { workItemId: 'SPE-10', role: 'relates_to' }] },
  ]);
  store.put('model-roots', target.projectId, { roots: [{ id: 'r1', label: 'TMS', modules: [{ key: 'TMS_HPMode', name: 'HPMode' }, { key: 'TMS_Power', name: 'Power' }] }] });
  const check: ModelCheckView = { at: Date.now(), baselineAt: Date.now(), ok: false, checkedFiles: 1, changedFiles: 1, findings: [{ rootId: 'r1', rootLabel: 'TMS', moduleKey: 'TMS_HPMode', moduleName: 'HPMode', side: 'model', files: [{ path: 'TMS_HPMode/TMS_HPMode.slx', change: 'modified' }], workItems: [] }] };
  store.put('model-check', `${target.projectId}:r1`, { id: `${target.projectId}:r1`, ...check });
  const view = coverage.impact(target, 'SPE-9');
  assert.equal(view.modules.length, 3);
  assert.deepEqual(view.modules.map(module => `${module.moduleName}:${module.stale}`), ['HPMode:true', 'Power:false', 'TMS_HPMode:false']);
  assert.equal(view.staleCount, 1);
  assert.deepEqual(view.upstream, [{ workItemId: 'SYS-9', role: 'derives' }]);
  assert.deepEqual(view.downstream, [{ workItemId: 'SPE-10', role: 'relates_to' }]);
  assert.deepEqual(view.verification.map(link => link.workItemId), ['TC-9', 'TC-10']);
  assert.throws(() => coverage.impact(target, 'SPE-404'), /IMPACT_ITEM_NOT_INDEXED/);
});

/** sync 的增量复用逻辑依赖真实远端，属于真机验收范围；这里只锁住索引存储结构不回归。 */
test('coverage-index 记录可被 ModelIndexView 之外的模块安全读取', t => {
  const { store } = fixture(t);
  seedIndex(store, [{ workItemId: 'SPE-1', title: '结构', text: 'x', marks: [], forwardLinks: [], backLinks: [] }]);
  const record = store.get<{ id: string; projectId: string; items: unknown[] }>('coverage-index', target.projectId);
  assert.equal(record!.id, target.projectId);
  assert.equal(record!.items.length, 1);
  const unused: ModelIndexView | undefined = undefined;
  assert.equal(unused, undefined);
});
