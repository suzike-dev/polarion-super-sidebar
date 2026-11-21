import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { Drafts } from './polarion.ts';
import { ReqTemplates, LIBRARY_PROJECT, LIBRARY_DOC } from './templates.ts';
import { builtinRequirementTemplates } from '../../packages/core/requirement-templates.ts';
import { RequestSchema } from '../../packages/protocol/index.ts';
import type { Remote, RemoteItem } from './polarion.ts';
import type { Target } from '../../packages/protocol/index.ts';

const origin = 'https://polarion.pufafen.com' as const;
const target: Target = { origin, projectId: '45_SPE25_BQ1_TM_002', document: 'Design/Software Requirement Specification SWR' };

/** 测试用 remote：library 项目的模板文档 + 业务项目工作项都在内存字典里模拟。 */
function fixtureRemote(): Remote & { created: { title: string; type: string; project: string }[] } {
  const created: { title: string; type: string; project: string }[] = [];
  const server = new Map<string, { title: string; description: string; updated: string; type: string; project: string }>();
  let next = 1;
  const self = {
    created,
    async search(targetOrProject: any, query: string, limit: number) {
      const projectId = typeof targetOrProject === 'string' ? targetOrProject : targetOrProject.projectId;
      const q = query.toLowerCase().split('title:').join('').split('\\').join('').split('*').join('');
      return [...server.values()].filter(item => item.project === projectId && item.title.toLowerCase().includes(q.replace('title:', ''))).slice(0, limit).map(item => {
        const id = [...server.entries()].find(([, v]) => v === item)![0];
        return { workItemId: id, title: item.title };
      });
    },
    async create(t: Target, title: string, type?: string) {
      const id = `T-${next++}`;
      created.push({ title, type: type ?? '', project: t.projectId });
      server.set(id, { title, description: '', updated: '2026-01-01T00:00:00.000Z', type: type ?? '', project: t.projectId });
      return { id, title, description: '', updated: '2026-01-01T00:00:00.000Z', type: type ?? '' };
    },
    async read(_t: Target, workItemId: string): Promise<RemoteItem> {
      const item = server.get(workItemId);
      if (!item) throw Error('NOT_FOUND');
      return { id: workItemId, ...item };
    },
    async save(draft: { workItemId: string; html: string }) {
      const item = server.get(draft.workItemId);
      if (!item) throw Error('NOT_FOUND');
      item.description = draft.html;
      return { id: draft.workItemId, title: item.title, submittedHtml: draft.html, uploadedAssets: [] };
    },
  };
  // Drafts 通过 remote.read/create/save/search 工作；searchItems 调 remote.search
  (self as any).projectOf = (id: string) => server.get(id)?.project;
  return self as unknown as Remote & { created: { title: string; type: string; project: string }[] };
}

function freshTemplates(remote?: ReturnType<typeof fixtureRemote>) {
  const store = new Store(':memory:');
  const remoteInstance = remote ?? fixtureRemote();
  const drafts = new Drafts(store, remoteInstance as unknown as Remote);
  const templates = new ReqTemplates(store);
  templates.drafts = drafts;
  return { store, drafts, templates, remote: remoteInstance };
}

test('协议校验：templates.* 新命令可解析', () => {
  for (const request of [
    { protocol: 1, id: crypto.randomUUID(), command: { method: 'templates.list', target } },
    { protocol: 1, id: crypto.randomUUID(), command: { method: 'templates.read', target, templateId: 'T-1' } },
    { protocol: 1, id: crypto.randomUUID(), command: { method: 'templates.reset', target, templateId: 'T-1' } },
    { protocol: 1, id: crypto.randomUUID(), command: { method: 'templates.createCustom', target, title: '诊断模板', category: '诊断类', html: '<p>x</p>' } },
    { protocol: 1, id: crypto.randomUUID(), command: { method: 'templates.instantiate', target, templateId: 'T-1', title: '一键除雾' } },
    { protocol: 1, id: crypto.randomUUID(), command: { method: 'templates.apply', target, workItemId: 'SPE-1', templateId: 'T-1' } },
  ]) assert.equal(RequestSchema.safeParse(request).success, true);
});

test('ensureLibrary：首次访问幂等创建 5 个内置模板工作项（library 项目）', async () => {
  const remote = fixtureRemote();
  const { templates } = freshTemplates(remote);
  const result = await templates.ensureLibrary(origin);
  assert.equal(result.created.length, 5);
  // 再次调用：不再创建（幂等）
  const again = await templates.ensureLibrary(origin);
  assert.equal(again.created.length, 0);
  assert.equal(remote.created.length, 5);
  for (const item of remote.created) assert.equal(item.project, LIBRARY_PROJECT);
});

test('list/instantiate：模板清单（含正文）+ 建项写入业务项目副本', async () => {
  const remote = fixtureRemote();
  const { templates } = freshTemplates(remote);
  await templates.ensureLibrary(origin);
  const views = await templates.list(origin);
  assert.equal(views.length, 5);
  for (const view of views) {
    assert.equal(view.origin, 'builtin');
    assert.ok(view.html.includes('1. 功能描述'), view.title + ' 缺少正文');
    assert.ok(view.html.includes('4. 标定量表'), view.title + ' 缺少标定量表');
  }
  // 建项：编号按目标项目生成（mock 里 T-N），标题自定义，内容为模板副本
  const result = await templates.instantiate(target, views[0]!.id, '一键除雾功能');
  const item = await remote.read(target, result.workItemId);
  assert.equal(item.title, '一键除雾功能');
  assert.ok((item.description ?? '').includes('REQ-QC-01'));
  // 模板原件未被改动
  const original = await remote.read(target, views[0]!.id);
  assert.ok((original.description ?? '').includes('1. 功能描述'));
});

test('reset：内置模板正文重置回内置基线', async () => {
  const { templates } = freshTemplates();
  await templates.ensureLibrary(origin);
  const views = await templates.list(origin);
  const result = await templates.reset(origin, views[0]!.id);
  assert.equal(result.state, 'clean');
  const view = await templates.read(origin, views[0]!.id);
  const base = builtinRequirementTemplates[0]!;
  assert.ok(view.html.length > 1000);
});
