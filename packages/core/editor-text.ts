import type {Node} from '@tiptap/pm/model';
import type {EditorState} from '@tiptap/pm/state';
export type TextMatch={from:number;to:number};
/** Formatting marks do not break a match; blocks and inline objects do. */
export function findTextMatches(doc:Node,query:string,caseSensitive=true):TextMatch[]{
  const matches:TextMatch[]=[];if(!query)return matches;
  doc.descendants((block,pos)=>{
    if(!block.isTextblock)return;
    let text='',start=pos+1;
    const flush=()=>{const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),caseSensitive?'gu':'giu');for(const match of text.matchAll(pattern))matches.push({from:start+match.index,to:start+match.index+match[0].length});text='';};
    block.forEach((node,offset)=>{if(node.isText){if(!text)start=pos+1+offset;text+=node.text;}else flush();});flush();return false;
  });return matches;
}
export function replaceSelectedMatch(state:EditorState,query:string,replacement:string,caseSensitive=true){
  const {from,to}=state.selection;
  if(!findTextMatches(state.doc,query,caseSensitive).some(match=>match.from===from&&match.to===to))return null;
  return state.tr.insertText(replacement,from,to);
}
export function replaceAllMatches(state:EditorState,query:string,replacement:string,caseSensitive=true){
  const matches=findTextMatches(state.doc,query,caseSensitive),tr=state.tr;
  // Reverse positions keep replacements independent; one transaction is one undo.
  for(const match of matches.toReversed())tr.insertText(replacement,match.from,match.to);
  return{tr,count:matches.length};
}
/** TSV clipboard dialect: quoted fields, doubled quotes and embedded newlines. */
export function parseTsv(text:string,maxRows=500,maxColumns=100):string[][]{
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const pushCell=()=>{row.push(cell);cell='';closed=false;if(row.length>maxColumns)throw Error('单次批量粘贴最多 500 行、100 列。');};
  const pushRow=()=>{pushCell();rows.push(row);row=[];if(rows.length>maxRows)throw Error('单次批量粘贴最多 500 行、100 列。');};
  const input=text.replace(/\r\n?/g,'\n');
  for(let i=0;i<input.length;i++){
    const c=input[i]!;
    if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='\t'){pushCell();continue;}if(c==='\n'){pushRow();continue;}
    if(closed)throw Error('TSV 引号格式不完整，请检查单元格内容；本次内容尚未插入。');
    if(c==='"'&&!cell){quoted=true;continue;}cell+=c;
  }
  if(quoted)throw Error('TSV 引号未闭合；本次内容尚未插入。');
  if(cell||closed||row.length||!input.endsWith('\n'))pushRow();
  const width=Math.max(0,...rows.map(r=>r.length));for(const r of rows)while(r.length<width)r.push('');return rows;
}
