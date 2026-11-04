import type {Editor} from '@tiptap/core';
import {CellSelection, selectedRect, selectionCell, isInTable, moveTableRow, moveTableColumn} from '@tiptap/pm/tables';
import {patchStyle} from '../../../packages/core/rich-style.ts';
import {Fragment,Slice} from '@tiptap/pm/model';
import type {EditorState} from '@tiptap/pm/state';
import {closeHistory} from '@tiptap/pm/history';
export type FormatScope='paragraph'|'table'|'cell';
export function clearFormattingTransaction(state:EditorState){
  const {from,to}=state.selection,tr=closeHistory(state.tr);
  if(from===to)return tr.setStoredMarks([]);
  const strip=(fragment:Fragment):Fragment=>Fragment.fromArray(Array.from({length:fragment.childCount},(_,i)=>{const node=fragment.child(i);return node.isText?node.mark(node.marks.filter(mark=>mark.type.name==='sourceText')):node.copy(strip(node.content));}));
  const slice=state.doc.slice(from,to);
  // One replacement stores the complete original mark order in history. Multiple
  // remove-mark steps reverse nested source spans when undone (and change CSS precedence).
  return tr.replaceRange(from,to,new Slice(strip(slice.content),slice.openStart,slice.openEnd));
}
export function clearTextFormatting(e:Editor){e.view.dispatch(clearFormattingTransaction(e.state));e.commands.focus();}
export function selectTableScope(e:Editor,scope:'row'|'column'|'table') {
  if(!isInTable(e.state))return false;
  const current=e.state.selection,anchor=current instanceof CellSelection?current.$anchorCell:selectionCell(e.state);
  const head=current instanceof CellSelection?current.$headCell:anchor;
  const rect=selectedRect(e.state);
  const selection=scope==='row'?CellSelection.rowSelection(anchor,head):scope==='column'?CellSelection.colSelection(anchor,head):
    CellSelection.create(e.state.doc,rect.tableStart+rect.map.map[0]!,rect.tableStart+rect.map.map.at(-1)!);
  e.view.dispatch(e.state.tr.setSelection(selection));e.commands.focus();return true;
}
export function formatTargets(e:Editor,scope:FormatScope) {
  const {selection,doc}=e.state; const positions=new Set<number>();
  if(scope==='paragraph') {
    doc.nodesBetween(selection.from,selection.to,(node,pos)=>{if(['paragraph','heading'].includes(node.type.name))positions.add(pos);});
  } else if(scope==='cell' && selection instanceof CellSelection) selection.forEachCell((_node,pos)=>positions.add(pos));
  else for(let d=selection.$from.depth;d>0;d--){const n=selection.$from.node(d);if(scope==='table'?n.type.name==='table':['tableCell','tableHeader'].includes(n.type.name)){positions.add(selection.$from.before(d));break;}}
  return [...positions].map(pos=>({pos,node:doc.nodeAt(pos)!}));
}
export function applyFormat(e:Editor,scope:FormatScope,patch:Record<string,string|null>) {
  const targets=formatTargets(e,scope);if(!targets.length)return false;
  const tr=e.state.tr;
  for(const {pos,node} of targets){const attrs:Record<string,any>={...node.attrs,sourceStyle:patchStyle(node.attrs.sourceStyle,patch)};
    if('background-color' in patch&&scope==='cell')attrs.fill=patch['background-color'];
    if('vertical-align' in patch&&scope==='cell')attrs.valign=patch['vertical-align'];
    tr.setNodeMarkup(pos,undefined,attrs);
  }
  e.view.dispatch(tr);e.commands.focus();return true;
}
export function setParagraphLineHeight(e:Editor,value:string){
  if(!/^(1|1\.2|1\.5|1\.75|2)$/.test(value))return false;
  const targets=formatTargets(e,'paragraph'),tr=e.state.tr;
  for(const {pos,node} of targets){
    tr.setNodeMarkup(pos,undefined,{...node.attrs,lineHeight:value});
    // Inline point-size carriers must not mask an explicitly chosen paragraph rhythm.
    node.descendants((child,offset)=>{if(!child.isText)return;const paint=child.marks.find(mark=>mark.type.name==='paint');tr.addMark(pos+1+offset,pos+1+offset+child.nodeSize,e.schema.marks.paint!.create({...paint?.attrs,line:value}));});
  }
  if(!targets.length)return false;e.view.dispatch(tr);e.commands.focus();return true;
}
export function moveAxis(e:Editor,axis:'row'|'column',direction:-1|1) {
  if(!e.isActive('table'))return false;const rect=selectedRect(e.state);
  const from=axis==='row'?rect.top:rect.left,to=from+direction,limit=axis==='row'?rect.map.height:rect.map.width;
  if(to<0||to>=limit)return false;
  const ok=(axis==='row'?moveTableRow:moveTableColumn)({from,to})(e.state,e.view.dispatch);e.commands.focus();return ok;
}
