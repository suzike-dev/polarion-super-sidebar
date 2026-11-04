import {DOMSerializer,type Schema,type DOMOutputSpec} from '@tiptap/pm/model';
import {sameTarget,type Target} from '../protocol/index.ts';
export type ClipboardOwner={target:Target;workItemId:string};
const ownerAttribute='data-sidebar-image-owner';
/** Keep item-relative references scoped to the editor that put them on the clipboard. */
export function imageClipboardSerializer(schema:Schema,owner:ClipboardOwner){
  const nodes=DOMSerializer.nodesFromSchema(schema),image=nodes.image!;
  return new DOMSerializer({...nodes,image(node){const spec=image(node) as [string,Record<string,unknown>];return [spec[0],{...spec[1],[ownerAttribute]:JSON.stringify(owner)}] as DOMOutputSpec;}},DOMSerializer.marksFromSchema(schema));
}
export function internalClipboardImage(element:Element,owner:ClipboardOwner){
  const src=element.getAttribute('src')??'';
  if(!/^(polarion-asset:|workitemimg:|attachment:)/.test(src))return null;
  let source:ClipboardOwner|undefined;try{source=JSON.parse(element.getAttribute(ownerAttribute)??'null');}catch{/* Missing/invalid ownership is never inferred from a filename. */}
  if(!source?.target||source.workItemId!==owner.workItemId||!sameTarget(source.target,owner.target))throw Error('图片来自其他工作项或来源无法确认，请先将原图保存为文件再插入；本次内容尚未插入。');
  if(src.startsWith('polarion-asset:')&&!/^polarion-asset:[0-9a-f-]{36}$/i.test(src))throw Error('剪贴板图片引用无效；本次内容尚未插入。');
  return src;
}
