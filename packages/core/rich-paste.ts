import type {EditorState,Selection} from '@tiptap/pm/state';
import type {Slice} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {handlePaste as pasteTable} from '@tiptap/pm/tables';
/** Async image import must use the same matrix rules as ordinary table paste. */
export function pasteRichContent(view:EditorView,event:ClipboardEvent,slice:Slice,selection:Selection=view.state.selection){
  if(!selection.eq(view.state.selection))view.dispatch(view.state.tr.setSelection(selection));
  if(!pasteTable(view,event,slice))view.dispatch(pasteRichSlice(view.state,slice));
}
/** At a block start, preserve both clipboard block types and the existing block. */
export function pasteRichSlice(state:EditorState,slice:Slice,selection:Selection=state.selection){
  const tr=state.tr.setSelection(selection);
  if(selection.empty&&selection.$from.depth>0&&selection.$from.parentOffset===0&&slice.content.childCount>1)tr.insert(selection.$from.before(),slice.content);
  else tr.replaceSelection(slice);
  return tr.scrollIntoView();
}
