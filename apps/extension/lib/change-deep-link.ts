/**
 * 飞书变更卡片的深链：
 * 按钮先落到记录工作项页（未安装插件的人在这里看到安装提示），已安装插件的浏览器在
 * document_start 读到 psbChange/psbDoc 后直接换到文档页，侧栏据此展开该条变更详情。
 */
export type ChangeDeepLink = {recordId: string; docUrl: string};

const PROJECT_ROUTE = /^#\/project\/([^/]+)\//;
const DOCUMENT_ROUTE = /^#\/project\/[^/]+\/wiki\//;

function hashParams(hash: string) {
  return new URLSearchParams(hash.split('?')[1] ?? '');
}

/** 深链想展开的变更记录 id；无论落在工作项页还是文档页都认。 */
export function pendingChangeRecordId(hash: string) {
  return (hashParams(hash).get('psbChange') ?? '').trim() || undefined;
}

/** psbChange + psbDoc → 文档深链；缺参数或不是项目路由时返回 undefined。 */
export function parseChangeDeepLink(hash: string, origin: string): ChangeDeepLink | undefined {
  const params = hashParams(hash);
  const recordId = (params.get('psbChange') ?? '').trim();
  const document = (params.get('psbDoc') ?? '').trim();
  const rawProject = PROJECT_ROUTE.exec(hash)?.[1];
  if (!recordId || !document || !rawProject) return undefined;
  let projectId = rawProject;
  try { projectId = decodeURIComponent(rawProject); } catch { /* 保留原始段 */ }
  const docPath = document.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return {recordId, docUrl: `${origin}/polarion/#/project/${encodeURIComponent(projectId)}/wiki/${docPath}?psb=changes`};
}

/** 已经在文档页时不再跳转，只把记录 id 交给侧栏展开。 */
export function isDocumentRoute(hash: string) {
  return DOCUMENT_ROUTE.test(hash);
}
