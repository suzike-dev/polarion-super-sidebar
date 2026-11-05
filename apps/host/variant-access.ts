import type { VariantScope } from '../../packages/protocol/index.ts';

type LinkLike = { work_item_uri?: string | undefined; role?: string | undefined };

/**
 * 工作项访问边界：
 * - 普通工作项必须属于当前文档；
 * - 变体工作项可以不属于文档，但必须通过指定角色链接到当前文档内的主工作项；
 * - 其余情况一律拒绝，避免侧边栏借变体口子写入任意项目工作项。
 */
export function authorizeWorkItemScope(input: {
  itemUri?: string | undefined;
  itemModuleUri?: string | undefined;
  documentUri?: string | undefined;
  mainModuleUri?: string | undefined;
  links: LinkLike[];
  scope?: VariantScope | undefined;
}): 'document' | 'variant' {
  if (input.documentUri && input.itemModuleUri === input.documentUri) return 'document';
  if (!input.scope) throw Error('WORK_ITEM_DOCUMENT_MISMATCH');
  if (!input.documentUri || input.mainModuleUri !== input.documentUri) throw Error('WORK_ITEM_DOCUMENT_MISMATCH');
  if (!input.scope.role) throw Error('VARIANT_LINK_REQUIRED');
  if (!input.itemUri) throw Error('VARIANT_LINK_REQUIRED');
  const linked = input.links.some(link => link.work_item_uri === input.itemUri && link.role === input.scope!.role);
  if (!linked) throw Error('VARIANT_LINK_REQUIRED');
  return 'variant';
}

const PREFERRED_ROLES = ['parent', 'relates_to', 'depends_on'];

/** 未显式配置链接角色时，优先使用 Polarion 常见的内置角色。 */
export function chooseLinkRole(roles: { id?: string | undefined; hidden?: boolean | undefined }[]): string {
  const available = roles.filter(role => role.id && !role.hidden);
  for (const preferred of PREFERRED_ROLES) {
    const match = available.find(role => role.id === preferred);
    if (match?.id) return match.id;
  }
  const first = available[0]?.id;
  if (!first) throw Error('VARIANT_LINK_ROLE_REQUIRED');
  return first;
}

export function variantTitle(mainTitle: string, label: string) {
  const suffix = ` · 变体：${label.trim().slice(0, 120)}`;
  return mainTitle.trim().slice(0, Math.max(0, 500 - suffix.length)) + suffix;
}

export function labelFromTitle(title: string | undefined, fallback: string) {
  const match = /(?: · 变体：| - 变体：)(.+)$/.exec(title ?? '');
  const label = (match?.[1] ?? title ?? '').trim().slice(0, 120);
  return label || fallback;
}

/** Polarion 工作项 URI 形如 .../PROJ${WorkItem}SPE-123，取最后一段作为 ID。 */
export function workItemIdFromUri(uri: string | undefined) {
  if (!uri) return '';
  const index = uri.lastIndexOf('}');
  return index >= 0 ? uri.slice(index + 1) : '';
}
