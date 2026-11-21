import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Store } from './store.ts';
import { Drafts, Polarion, type ChangeRemoteRow, type ChangeWriteInput } from './polarion.ts';
import { Model, PLATFORM_ROOT_ID, platformRoot, scanModelRoot, modelContextDigest } from './model.ts';
import { ModelModuleSchema, ModelRootSchema, type ModelIndexView, type ModelModule, type ModelRoot, type Target } from '../../packages/protocol/index.ts';

function tempDir(t: TestContext, prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function openStore(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-db-'));
  const store = new Store(path.join(dir, 'test.db'));
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function makeRoot(t: TestContext) {
  const root = tempDir(t, 'ModelandCode-');
  const write = (rel: string, content = 'x') => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
  write('TMS.prj');
  write('03_Data/TMS_DataType.sldd');
  write('TMS_HPMode/TMS_HPMode.slx');
  write('TMS_HPMode/TMS_HPMode_DD.sldd');
  write('TMS_HPMode/TMS_HPMode_DD.xlsx');
  write('TMS_HPMode/TMS_HPMode_harness.slx');
  write('IntegrationTop/topmodel.mdl');
  write('00_TMS_Lib/Com_Lib.slx');
  write('01_UnitTest/Test.slx');
  write('.svn/hidden.slx');
  return root;
}

test('scanModelRoot：目录不存在或没有模型时给出可读错误', t => {
  const root = tempDir(t, 'empty-');
  fs.writeFileSync(path.join(root, 'readme.txt'), 'x');
  assert.throws(() => scanModelRoot(root), /MODEL_ROOT_NO_MODELS/);
  assert.throws(() => scanModelRoot(path.join(root, 'nope')), /MODEL_ROOT_NOT_FOUND/);
});

test('scanModelRoot：模块去重、Harness 合并、字典/接口表、类型与默认排除', t => {
  const scan = scanModelRoot(makeRoot(t));
  assert.equal(scan.rootName.slice(0, 'ModelandCode-'.length), 'ModelandCode-');
  assert.equal(scan.projectFile, 'TMS.prj');
  assert.equal(scan.fileCount, 5); // 主模型 + harness + 集成 + 库 + 测试（.svn 被跳过）
  assert.deepEqual(scan.dictionaries, ['03_Data/TMS_DataType.sldd']);
  const byKey = new Map(scan.modules.map(module => [module.key, module]));
  assert.equal(scan.modules.length, 4);
  const hp = byKey.get('TMS_HPMode')!;
  assert.equal(hp.kind, 'module');
  assert.ok(!hp.excluded);
  assert.equal(hp.model, 'TMS_HPMode/TMS_HPMode.slx');
  assert.equal(hp.dictionary, 'TMS_HPMode/TMS_HPMode_DD.sldd');
  assert.equal(hp.interface, 'TMS_HPMode/TMS_HPMode_DD.xlsx');
  assert.equal(byKey.get('IntegrationTop')!.kind, 'integration');
  assert.equal(byKey.get('00_TMS_Lib')!.name, 'Com_Lib');
  assert.equal(byKey.get('00_TMS_Lib')!.kind, 'library');
  assert.equal(byKey.get('00_TMS_Lib')!.excluded, false);
  assert.equal(byKey.get('01_UnitTest')!.excluded, true);
});

test('modelContextDigest：无配置返回空，有配置输出模块与覆盖计数', t => {
  const store = openStore(t);
  assert.equal(modelContextDigest(store, 'PSB'), '');
  const rootId = '9e5d0d62-63e1-4a3f-9b7f-0b2f6f1a1111';
  const root: ModelRoot = {
    id: rootId, label: 'TMS 模型', path: 'D:\\Work\\SVN\\TMS\\ModelandCode', note: '',
    projectFile: 'TMS.prj', dictionaries: ['03_Data/TMS_DataType.sldd'], scannedAt: 1,
    modules: [
      { key: 'TMS_HPMode', name: 'HPMode', dir: 'TMS_HPMode', model: 'TMS_HPMode/TMS_HPMode.slx', dictionary: 'TMS_HPMode/TMS_HPMode_DD.sldd', interface: null, kind: 'module', excluded: false },
      { key: 'Lib_Utils', name: 'Lib', dir: 'Lib_Utils', model: 'Lib_Utils/utils_lib.slx', dictionary: null, interface: null, kind: 'library', excluded: true },
    ],
  };
  const index: ModelIndexView = {
    total: 2, annotated: 1, syncedAt: Date.now(), query: '',
    items: [
      { workItemId: 'SPE-1', title: '助力模式', type: 'Requirement', updated: 'v', marks: [{ rootId, modules: ['TMS_HPMode'] }], links: [] },
      { workItemId: 'SPE-2', title: '无标注', type: 'Requirement', updated: 'v', marks: [], links: [] },
    ],
  };
  store.put('model-roots', 'PSB', { roots: [root] });
  store.put('model-index', 'PSB', index);
  const digest = modelContextDigest(store, 'PSB');
  assert.match(digest, /TMS 模型：D:\\Work\\SVN\\TMS\\ModelandCode/);
  assert.match(digest, /Simulink 工程 TMS\.prj/);
  assert.match(digest, /- HPMode（TMS_HPMode · 字典 TMS_HPMode\/TMS_HPMode_DD\.sldd）· 已关联需求 1 条/);
  assert.ok(!digest.includes('Lib_Utils')); // 排除的模块不进会话摘要
  assert.match(digest, /需求覆盖：已标注 1\/2/);
});

const target: Target = { origin: 'https://polarion.pufafen.com', projectId: 'model-test', document: 'fixtures/model' };
const rootId = '9e5d0d62-63e1-4a3f-9b7f-0b2f6f1a1111';
const fileName = 'sidebar-model.roots.json';
const workItemId = 'FIXTURE-1';

// 两个客户端只共享附件字节和远端版本。任何未模拟的 worker 操作都会在启动前失败。
class SharedAttachment extends Polarion {
  dataBase64 = '';
  revision = 0;
  writeAttempts = 0;
  offline = false;
  get updated() { return `rev-${this.revision}`; }
  override start(): never { throw Error('TEST_WORKER_DISABLED'); }

  override async changeList(): Promise<ChangeRemoteRow[]> {
    if (this.offline) throw Error('OFFLINE');
    return this.dataBase64 ? [{ workItemId, title: 'PSB-MODEL', description: '', created: '', updated: this.updated, type: 'task', status: 'open', attachments: [{ file_name: fileName }] }] : [];
  }

  override async changeRead(_target: Target, id: string, file: string) {
    if (this.offline) throw Error('OFFLINE');
    assert.equal(id, workItemId);
    assert.equal(file, fileName);
    return { workItemId, attachmentId: fileName, dataBase64: this.dataBase64, updated: this.updated };
  }

  override async changeWrite(input: ChangeWriteInput) {
    if (this.offline) throw Error('OFFLINE');
    ++this.writeAttempts;
    assert.equal(input.fileName, fileName);
    assert.equal(input.workItemId, this.dataBase64 ? workItemId : undefined);
    if (input.expectedUpdated !== undefined && input.expectedUpdated !== this.updated) throw Error('CHANGE_RECORD_CONFLICT');
    this.dataBase64 = input.dataBase64;
    ++this.revision;
    return { workItemId, updated: this.updated, attachmentId: fileName, uri: 'fixture' };
  }
}

function client(t: TestContext, remote: SharedAttachment) {
  const store = openStore(t);
  return new Model(store, new Drafts(store, remote));
}

function scannedRoot(dir: string) {
  return ModelRootSchema.parse({ ...scanModelRoot(dir), id: rootId, label: 'TMS' });
}

test('roots：v1 只恢复 Com_Lib，保留其他库和测试模块的排除，忽略旧机器路径', async t => {
  const dir = makeRoot(t);
  fs.mkdirSync(path.join(dir, 'Other_Lib'));
  fs.writeFileSync(path.join(dir, 'Other_Lib', 'Other.slx'), 'x');
  const expected = scannedRoot(dir);
  expected.modules.find(module => module.key === 'Other_Lib')!.excluded = true;
  const legacy = { ...expected, modules: expected.modules.map(module => ({ ...module, excluded: module.kind === 'library' || module.excluded })) };
  const remote = new SharedAttachment();
  remote.dataBase64 = gzipSync(JSON.stringify({ v: 1, roots: [legacy] })).toString('base64');
  const migrated = await client(t, remote).roots(target);
  assert.deepEqual(migrated, { source: 'polarion', workItemId, updated: remote.updated, roots: [{ ...expected, path: '' }] });
  assert.equal(remote.writeAttempts, 0);
});

test('roots：v2 手动排除跨机保留，附件仅含相对路径，本地绑定及离线缓存各自独立', async t => {
  const remote = new SharedAttachment();
  const a = client(t, remote), b = client(t, remote);
  const root = scannedRoot(makeRoot(t));
  const dirB = makeRoot(t);
  assert.notEqual(root.path, dirB);
  root.modules.find(module => module.key === '00_TMS_Lib')!.excluded = true;
  const saved = await a.rootsSave(target, [root], null);
  const attachment = remote.dataBase64;
  const { path: pathA, ...shared } = root;
  const payload = JSON.parse(gunzipSync(Buffer.from(attachment, 'base64')).toString('utf8'), (_key, value) => {
    if (typeof value === 'string') assert.equal(path.win32.isAbsolute(value), false, `附件含绝对路径 ${value}`);
    return value;
  });
  assert.deepEqual(payload, { v: 2, roots: [shared] });

  remote.offline = true;
  assert.deepEqual(await b.roots(target), { source: 'empty', roots: [] });
  remote.offline = false;
  const unbound = await b.roots(target);
  assert.deepEqual(unbound, { source: 'polarion', workItemId, updated: saved.updated, roots: [{ ...shared, path: '' }] });
  assert.deepEqual(b.bindLocal(target, rootId, dirB), { path: dirB });
  const rebound = { ...unbound, roots: [{ ...shared, path: dirB }] };

  remote.offline = true;
  assert.deepEqual(await a.roots(target), { ...saved, source: 'cache', roots: [{ ...shared, path: pathA }] });
  assert.deepEqual(await b.roots(target), { ...rebound, source: 'cache' });
  remote.offline = false;
  assert.deepEqual(await a.roots(target), saved);
  assert.deepEqual(await b.roots(target), rebound);
  assert.equal(remote.dataBase64, attachment);
  assert.equal(remote.writeAttempts, 1);
});

test('rootsSave：同版本并发保存只成功一次，过期 expectedUpdated 在写附件前拒绝', async t => {
  const remote = new SharedAttachment();
  const a = client(t, remote), b = client(t, remote);
  const created = await a.rootsSave(target, [scannedRoot(makeRoot(t))], null);
  const loaded = await b.roots(target);
  assert.ok(created.updated);
  assert.equal(loaded.updated, created.updated);
  const versions = [created, loaded];
  const clients = [a, b];
  const results = await Promise.allSettled(clients.map((model, i) => {
    const view = versions[i];
    return model.rootsSave(target, [{ ...view.roots[0], note: `edit-${i}` }], view.updated);
  }));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const loser = results.findIndex(result => result.status === 'rejected');
  const rejection = results[loser];
  assert.ok(rejection.status === 'rejected');
  assert.match(rejection.reason.message, /^MODEL_ROOTS_CONFLICT/);
  assert.equal(remote.writeAttempts, 3); // 创建 + 两次携带相同版本的写入
  const attachment = remote.dataBase64;
  await assert.rejects(clients[loser].rootsSave(target, [], created.updated), /MODEL_ROOTS_CONFLICT/);
  assert.equal(remote.writeAttempts, 3);
  assert.equal(remote.dataBase64, attachment);
  assert.equal(remote.revision, 2);
  remote.offline = true;
  assert.deepEqual(await clients[loser].roots(target), { ...versions[loser], source: 'cache' });
  remote.offline = false;
  assert.equal((await clients[loser].roots(target)).roots[0].note, `edit-${1 - loser}`);
});

/** 巡检夹具：已绑定本机目录的项目 + 两条已标注需求（SPE-1→TMS_HPMode，SPE-2→IntegrationTop）。 */
async function patrolFixture(t: TestContext) {
  const remote = new SharedAttachment();
  const model = client(t, remote);
  const dir = makeRoot(t);
  await model.rootsSave(target, [scannedRoot(dir)], null);
  const putIndex = (updatedS1: string, updatedS2: string) => {
    const index: ModelIndexView = {
      total: 2, annotated: 2, syncedAt: Date.now(), query: '',
      items: [
        { workItemId: 'SPE-1', title: '高压模式判定', type: 'Requirement', updated: updatedS1, marks: [{ rootId, modules: ['TMS_HPMode'] }], links: [] },
        { workItemId: 'SPE-2', title: '集成顶层', type: 'Requirement', updated: updatedS2, marks: [{ rootId, modules: ['IntegrationTop'] }], links: [] },
      ],
    };
    model['store'].put('model-index', target.projectId, index);
  };
  putIndex('v1', 'v1');
  return { model, dir, putIndex };
}

test('indexSync：全项目拉取后按当前文档 outline 过滤，不依赖 document: 查询字段', async t => {
  class NotesCapture extends SharedAttachment {
    captured = '';
    outlineItems = [{ id: 'FIXTURE-1' }, { id: 'SPE-2' }];
    override async modelNotes(_t: Target, query: string) {
      this.captured = query;
      return { items: [
        { workItemId: 'FIXTURE-1', title: '文档内条目', type: 'Requirement', updated: 'v1', marks: [], links: [] },
        { workItemId: 'OTHER-9', title: '其他文档英文条目', type: 'Requirement', updated: 'v1', marks: [], links: [] },
        { workItemId: 'SPE-2', title: '文档内已标注', type: 'Requirement', updated: 'v1', marks: [{ rootId, modules: ['TMS_HPMode'] }], links: [] },
      ], total: 3 };
    }
    override async outline(_t: Target) { return { documentId: 'x', title: '', items: this.outlineItems as never }; }
  }
  const remote = new NotesCapture();
  const model = client(t, remote);
  const view = await model.indexSync(target, '');
  assert.equal(remote.captured, 'NOT(title:PSB-*)'); // 全项目拉取（document: 字段真机不可用）
  assert.equal(view.total, 2); // 其他文档条目被 outline 过滤
  assert.ok(!view.items.some(item => item.workItemId === 'OTHER-9'));
  assert.equal(view.annotated, 1);
  // outline 不可用时退化为全量并标记 partial。
  remote.outlineItems = [];
  const fallbackView = await model.indexSync(target, '');
  assert.equal(fallbackView.total, 3);
  await model.indexSync(target, 'id:SPE-1');
  assert.equal(remote.captured, 'id:SPE-1'); // 自定义查询透传
});

test('旧模型索引和重新同步使用同一需求范围，并保留章节上已有的模块备注', async t => {
  const marks = [{ rootId, modules: ['TMS_HPMode'] }];
  const row = (workItemId: string, type: string, marked = false) => ({ workItemId, type, title: '相同标题', updated: 'v1', links: [], marks: marked ? marks : [] });
  const rows = [row('FIX-1', 'heading'), row('FIX-2', 'softwarerequirement'), row('FIX-3', 'customHeadingPolicy'), row('FIX-4', ' Heading ', true), row('FIX-5', 'softwarerequirement', true), row('FIX-6', '')];
  const remote = new SharedAttachment();
  const model = client(t, remote), store = model['store'];
  const root = scannedRoot(makeRoot(t));
  remote.offline = true;
  store.put('model-roots', target.projectId, { roots: [root] });
  store.put('model-index', target.projectId, { items: rows, total: 6, annotated: 2, syncedAt: 7, query: '' });
  const pending = ['FIX-2', 'FIX-3', 'FIX-6'];
  const check = async () => {
    const trace = await model.traceView(target);
    assert.deepEqual(trace.unannotated.map(item => item.workItemId), pending);
    assert.deepEqual([trace.total, trace.annotated], [4, 1]);
    const group = trace.groups.find(group => group.moduleKey === 'TMS_HPMode')!;
    assert.deepEqual(group.items.map(item => item.workItemId), ['FIX-5']);
    assert.deepEqual(group.markedHeadings?.map(item => [item.workItemId, item.marks]), [['FIX-4', marks]]);
    const { count, prompt } = model.autolinkPrompt(target);
    assert.equal(count, pending.length);
    assert.deepEqual([...prompt.matchAll(/- (FIX-\d+)｜/g)].map(match => match[1]), pending);
    const digest = modelContextDigest(store, target.projectId);
    assert.match(digest, /已标注 1\/4/);
    assert.match(digest, /已关联需求 1 条/);
  };
  await check(); // The first open must work with the unmodified legacy row and no sync.
  t.mock.method(remote, 'modelNotes', async () => ({ items: rows.map(item => item.workItemId === 'FIX-1' ? { ...item, type: '' } : item), total: rows.length }));
  t.mock.method(remote, 'outline', async () => ({ items: rows.map(item => ({ id: item.workItemId, type: item.type })) }));
  const synced = await model.indexSync(target, '');
  assert.deepEqual([synced.total, synced.annotated], [4, 1]);
  await check();
  assert.equal(remote.writeAttempts, 0);
});

test('autolinkPrompt：未标注清单 + 模块清单 + 写入规则；全已标注时引导', async t => {
  const { model, putIndex } = await patrolFixture(t);
  // 全部已标注 → 引导语而不是任务。
  assert.throws(() => model.autolinkPrompt(target), /MODEL_AUTOLINK_ALL_ANNOTATED/);
  // 放开一条未标注需求：SPE-3 无备注。
  putIndex('v1', 'v1');
  model['store'].put('model-index', target.projectId, {
    total: 3, annotated: 2, syncedAt: Date.now(), query: '',
    items: [
      { workItemId: 'SPE-1', title: '高压模式判定', type: 'Requirement', updated: 'v1', marks: [{ rootId, modules: ['TMS_HPMode'] }], links: [] },
      { workItemId: 'SPE-2', title: '集成顶层', type: 'Requirement', updated: 'v1', marks: [{ rootId, modules: ['IntegrationTop'] }], links: [] },
      { workItemId: 'SPE-3', title: 'CAN 信号诊断', type: 'Requirement', updated: 'v1', marks: [], links: [] },
    ],
  } satisfies ModelIndexView);
  const { prompt, count } = model.autolinkPrompt(target);
  assert.equal(count, 1);
  assert.ok(prompt.includes('SPE-3｜CAN 信号诊断'));
  assert.ok(prompt.includes(`rootId=${rootId}`));
  assert.ok(prompt.includes('key=TMS_HPMode'));
  assert.ok(prompt.includes('action=note_write'));
  assert.ok(prompt.includes('peek_work_item'));
  assert.ok(!prompt.includes('SPE-1｜')); // 已标注项不进待关联清单
});

test('baseline/check：未设基准与未绑定目录的引导', async t => {
  const remote = new SharedAttachment();
  const model = client(t, remote);
  await model.rootsSave(target, [scannedRoot(makeRoot(t))], null);
  // 已绑定但未拍基准：给出引导语，而不是报错。
  const view = await model.check(target, rootId);
  assert.equal(view.ok, false);
  assert.equal(view.baselineAt, null);
  assert.match(view.message!, /尚未设定基准/);
  // 新机器：配置读得到，本机路径未绑定 → 专用错误引导去绑定。
  const stranger = client(t, remote);
  await stranger.roots(target);
  await assert.rejects(stranger.check(target, rootId), /MODEL_ROOT_PATH_UNBOUND/);
});

test('baseline/check：模型侧变化 → 关联需求疑似过期；需求侧更新、两侧冲突、覆盖缺口', async t => {
  const { model, dir, putIndex } = await patrolFixture(t);
  // 拍基准：所有跟踪文件（4 模块模型 + 字典 + 接口表 + 公共字典）一致。
  const baselineView = await model.baselineSet(target, rootId);
  assert.equal(baselineView.ok, true);
  assert.equal(baselineView.findings.length, 0);
  assert.equal(baselineView.checkedFiles, 7);
  assert.equal(model.baselines(target.projectId).length, 1);
  assert.equal(model.baselines(target.projectId)[0]!.items, 2);

  // 模型侧：改 TMS_HPMode.slx → SPE-1 疑似过期。
  fs.writeFileSync(path.join(dir, 'TMS_HPMode', 'TMS_HPMode.slx'), 'tuned');
  let view = await model.check(target, rootId);
  assert.equal(view.ok, false);
  assert.equal(view.changedFiles, 1);
  const modelSide = view.findings[0]!;
  assert.equal(modelSide.side, 'model');
  assert.equal(modelSide.moduleKey, 'TMS_HPMode');
  assert.deepEqual(modelSide.files, [{ path: 'TMS_HPMode/TMS_HPMode.slx', change: 'modified' }]);
  assert.deepEqual(modelSide.workItems, [{ workItemId: 'SPE-1', title: '高压模式判定', requirementChanged: false }]);

  // 需求侧：SPE-2 修订时间变化 → IntegrationTop 需求侧 finding。
  putIndex('v1', 'v2');
  view = await model.check(target, rootId);
  const byModule = new Map(view.findings.map(finding => [finding.moduleKey, finding]));
  assert.equal(byModule.get('IntegrationTop')!.side, 'requirement');
  assert.deepEqual(byModule.get('IntegrationTop')!.workItems.map(item => item.workItemId), ['SPE-2']);

  // 两侧都变：SPE-1 也更新 → TMS_HPMode side=both，需人工裁决。
  putIndex('v2', 'v2');
  view = await model.check(target, rootId);
  assert.equal(view.findings.find(finding => finding.moduleKey === 'TMS_HPMode')!.side, 'both');

  // 新增文件 + 覆盖缺口：Com_Lib 换内容但没有任何需求标注它。
  fs.writeFileSync(path.join(dir, '00_TMS_Lib', 'Com_Lib.slx'), 'lib-v2');
  view = await model.check(target, rootId);
  const libFinding = view.findings.find(finding => finding.moduleKey === '00_TMS_Lib')!;
  assert.equal(libFinding.side, 'model');
  assert.deepEqual(libFinding.workItems, []);

  // 重设基准后归零。
  const reset = await model.baselineSet(target, rootId);
  assert.equal(reset.ok, true);
  assert.equal(reset.findings.length, 0);
});

test('平台模块目录：无根目录项目把需求关联到平台固定模块，追溯与摘要一致', async t => {
  const remote = new SharedAttachment();
  const model = client(t, remote);
  const mod = (key: string, name: string, kind: ModelModule['kind'] = 'module') => ModelModuleSchema.parse({ key, name, kind });
  // 未配置根目录也未维护目录 → 可读引导；维护后按平台模式出提示词。
  assert.throws(() => model.autolinkPrompt(target), /MODEL_AUTOLINK_NEEDS_ROOT/);
  assert.throws(() => model.autolinkPrompt(target), /平台模块目录/);
  model.savePlatformCatalog([mod('助力模式', '助力模式'), mod('HighVolt', '高压采集'), mod('Top', '顶层集成', 'integration')]);
  assert.equal(platformRoot(model['store'])!.id, PLATFORM_ROOT_ID);
  assert.throws(() => model.autolinkPrompt(target), /MODEL_AUTOLINK_NEEDS_INDEX/);
  const index: ModelIndexView = {
    total: 3, annotated: 2, syncedAt: Date.now(), query: '',
    items: [
      { workItemId: 'SPE-1', title: '助力模式判定', type: 'Requirement', updated: 'v1', marks: [{ rootId: PLATFORM_ROOT_ID, modules: ['助力模式'] }], links: [] },
      { workItemId: 'SPE-2', title: '高压采集需求', type: 'Requirement', updated: 'v1', marks: [{ rootId: PLATFORM_ROOT_ID, modules: ['HighVolt'] }], links: [] },
      { workItemId: 'SPE-3', title: 'CAN 信号诊断', type: 'Requirement', updated: 'v1', marks: [], links: [] },
    ],
  };
  model['store'].put('model-index', target.projectId, index);
  const { prompt, count, mode } = model.autolinkPrompt(target);
  assert.equal(count, 1);
  assert.equal(mode, 'platform');
  assert.ok(prompt.includes('rootId=' + PLATFORM_ROOT_ID));
  assert.ok(prompt.includes('key=助力模式'));
  assert.ok(prompt.includes('阶段一 · 了解模型侧'));
  assert.ok(prompt.includes('peek_work_item'));
  assert.ok(prompt.includes('action=note_write'));
  assert.ok(!prompt.includes('SPE-1｜')); // 已标注项不进待关联清单
  // 追溯分组按平台根输出；会话摘要与标注视图都落到平台目录。
  const trace = await model.traceView(target);
  assert.deepEqual(trace.roots.map(root => root.id), [PLATFORM_ROOT_ID]);
  const group = trace.groups.find(group => group.moduleKey === '助力模式')!;
  assert.deepEqual(group.items.map(item => item.workItemId), ['SPE-1']);
  assert.match(modelContextDigest(model['store'], target.projectId), /平台固定模块目录/);
  const noteView = await model.viewRoots(target);
  assert.equal(noteView.roots[0]!.label, '平台模块');
  // 已有配置根且索引无平台标注时不叠加平台分组；索引里真有平台标注时仍显示。
  await model.rootsSave(target, [scannedRoot(makeRoot(t))], null);
  const scannedId = (await model.roots(target)).roots[0]!.id;
  model['store'].put('model-index', target.projectId, { ...index, items: [index.items[2]!] });
  const withRoots = await model.traceView(target);
  assert.ok(withRoots.groups.every(group => group.rootId !== PLATFORM_ROOT_ID));
  model['store'].put('model-index', target.projectId, { ...index, items: [index.items[2]!, { workItemId: 'SPE-9', title: '平台遗留标注', type: 'Requirement', updated: 'v1', marks: [{ rootId: PLATFORM_ROOT_ID, modules: ['HighVolt'] }], links: [] }] });
  const mixed = await model.traceView(target);
  assert.ok(mixed.groups.some(group => group.rootId === PLATFORM_ROOT_ID));
  assert.ok(scannedId !== PLATFORM_ROOT_ID);
});
