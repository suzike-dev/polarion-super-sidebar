import {NodeSelection, type EditorState} from '@tiptap/pm/state';
import type {Attrs} from '@tiptap/pm/model';

export function replaceBoardPreview(state: EditorState, pos: number, expectedSrc: string, previewId: string) {
  const node = state.doc.nodeAt(pos);
  if (!expectedSrc || node?.type !== state.schema.nodes.image || node?.attrs.src !== expectedSrc) {
    throw Error('原画板的位置或版本已变化，请重新打开这张图。');
  }
  const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: 'polarion-asset:' + previewId, assetId: previewId });
  return tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView();
}

export function placeBoardImage(state: EditorState, pos: number, attrs: Attrs) {
  const $pos=state.doc.resolve(pos);
  const image=state.schema.nodes.image!.create(attrs);
  const inline=$pos.parent.inlineContent;
  const node=inline?image:state.schema.nodes.paragraph!.create(null,image);
  if(!$pos.parent.canReplaceWith($pos.index(),$pos.index(),node.type)) throw Error('请点击正文段落或选择开头、末尾。');
  const tr=state.tr.insert(pos,node);
  return tr.setSelection(NodeSelection.create(tr.doc,inline?pos:pos+1)).scrollIntoView();
}
