import type {Editor} from '@tiptap/core';
import {CellSelection, selectedRect, moveTableRow, moveTableColumn} from '@tiptap/pm/tables';
import {patchStyle} from '../../../packages/core/rich-style';
export type FormatScope='paragraph'|'table'|'cell';
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
export function moveAxis(e:Editor,axis:'row'|'column',direction:-1|1) {
  if(!e.isActive('table'))return false;const rect=selectedRect(e.state);
  const from=axis==='row'?rect.top:rect.left,to=from+direction,limit=axis==='row'?rect.map.height:rect.map.width;
  if(to<0||to>=limit)return false;
  const ok=(axis==='row'?moveTableRow:moveTableColumn)({from,to})(e.state,e.view.dispatch);e.commands.focus();return ok;
}
