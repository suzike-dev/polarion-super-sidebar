import {TableView} from '@tiptap/extension-table';
import type {Node} from '@tiptap/pm/model';
import type {EditorView} from '@tiptap/pm/view';
import {styleValues} from '../../../packages/core/rich-style';
/** Column resizing must not erase the document author's table width. */
export class DocumentTableView extends TableView {
  constructor(node:Node,minWidth:number,view?:EditorView,attrs:Record<string,any>={}){super(node,minWidth,view,attrs);this.restoreWidth();}
  private restoreWidth(){const width=styleValues(this.node.attrs.sourceStyle).width;if(width)this.table.style.width=width;}
  override update(node:Node){const accepted=super.update(node);if(accepted)this.restoreWidth();return accepted;}
}
