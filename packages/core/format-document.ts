import {richSchema} from './rich-schema.ts';
import {Transform} from '@tiptap/pm/transform';
import type {JSONContent} from '@tiptap/core';
export type TextFormat={color?:string;bold?:true};
export function formatDocument(document:JSONContent,format:TextFormat,selection?:string){
 const doc=richSchema.nodeFromJSON(document);let text='';const positions:number[]=[];
 doc.descendants((node,pos)=>{if(node.isText){if(positions.length&&positions.at(-1)!+1!==pos){text+=' ';positions.push(-1);}for(let i=0;i<node.text!.length;i++){text+=node.text![i];positions.push(pos+i);}}else if(node.isLeaf&&positions.length){text+=' ';positions.push(-1);}});
 const normalize=(s:string)=>s.replace(/\s+/g,'');
 let from=0,to=doc.content.size;
 if(selection!==undefined){
  const needle=normalize(selection);if(!needle)throw Error('EMPTY_SELECTION');
  // HTML source indentation and native selection line breaks differ. Match visible
  // non-whitespace characters uniquely, preserving their exact document positions.
  let flat='';const map:number[]=[];for(let i=0;i<text.length;i++){if(/\s/.test(text[i]!)){continue;}else{flat+=text[i];map.push(positions[i]!);}}
  const start=flat.indexOf(needle);if(start<0)throw Error('SELECTION_NOT_FOUND');if(flat.indexOf(needle,start+1)>=0)throw Error('AMBIGUOUS_SELECTION');
  from=map[start]!;to=map[start+needle.length-1]!+1;if(from<0||to<=from)throw Error('INVALID_SELECTION');
 }
 const tr=new Transform(doc);let count=0;
 doc.nodesBetween(from,to,(node,pos)=>{if(!node.isText)return;const a=Math.max(from,pos),b=Math.min(to,pos+node.nodeSize);if(a>=b)return;count+=b-a;
  if(format.color){if(!/^#[\da-f]{6}$/i.test(format.color))throw Error('INVALID_COLOR');const existing=node.marks.find(m=>m.type.name==='paint');tr.addMark(a,b,richSchema.marks.paint!.create({...existing?.attrs,color:format.color}));}
  if(format.bold)tr.addMark(a,b,richSchema.marks.bold!.create());
 });
 if(!count)throw Error('NO_EDITABLE_TEXT');return{document:tr.doc.toJSON(),characters:count};
}
