import type {EditorState} from '@tiptap/pm/state';
import {TextSelection} from '@tiptap/pm/state';
import type {Node} from '@tiptap/pm/model';
import type {JSONContent} from '@tiptap/core';
export function selectedBlock(state:EditorState){
  const {$from,$to}=state.selection;let depth=$from.depth;
  while(depth>1&&!['sourceContainer','tableCell','tableHeader'].includes($from.node(depth-1).type.name))depth--;
  if(!depth)return null;
  const from=$from.before(depth),node=$from.node(depth),parent=$from.node(depth-1),index=$from.index(depth-1);
  if($to.pos>from+node.nodeSize)return null;
  return{from,node,parent,index};
}
export function containsProtected(node:Node){let found=node.type.name.startsWith('protected');node.descendants(n=>{if(n.type.name.startsWith('protected'))found=true;});return found;}
function copied(node:JSONContent):JSONContent{
  return{...node,attrs:node.attrs?{...node.attrs,sid:null}:undefined,marks:node.marks?.filter(m=>m.type!=='sourceText').map(m=>({...m,attrs:m.attrs?{...m.attrs,sid:null}:undefined})),content:node.content?.map(copied)};
}
export function blockTransaction(state:EditorState,action:'up'|'down'|'duplicate'|'delete'){
  const block=selectedBlock(state);if(!block)return null;const {from,node,parent,index}=block,to=from+node.nodeSize,tr=state.tr;
  if((action==='duplicate'||action==='delete')&&containsProtected(node))return null;
  if(action==='duplicate')tr.insert(to,state.schema.nodeFromJSON(copied(node.toJSON()))).setSelection(TextSelection.near(tr.doc.resolve(to)));
  if(action==='delete'){if(!parent.canReplace(index,index+1))return null;tr.delete(from,to);}
  if(action==='up'||action==='down'){
    const siblingIndex=index+(action==='up'?-1:1);if(siblingIndex<0||siblingIndex>=parent.childCount)return null;
    const sibling=parent.child(siblingIndex),start=action==='up'?from-sibling.nodeSize:from,end=action==='up'?to:to+sibling.nodeSize;
    const content=action==='up'?[node,sibling]:[sibling,node];
    tr.replaceWith(start,end,content);tr.setSelection(TextSelection.near(tr.doc.resolve(action==='up'?start:start+sibling.nodeSize)));
  }
  return tr.scrollIntoView();
}
