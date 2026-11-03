import type {EditorState,Selection} from '@tiptap/pm/state';
import type {Slice} from '@tiptap/pm/model';
/** At a block start, preserve both clipboard block types and the existing block. */
export function pasteRichSlice(state:EditorState,slice:Slice,selection:Selection=state.selection){
  const tr=state.tr.setSelection(selection);
  if(selection.empty&&selection.$from.depth>0&&selection.$from.parentOffset===0&&slice.content.childCount>1)tr.insert(selection.$from.before(),slice.content);
  else tr.replaceSelection(slice);
  return tr.scrollIntoView();
}
