export type ReviewChange={id:number;kind:'added'|'removed'|'text'|'format';label:string};
export type Review={unchanged:boolean;before:string;after:string;removed:number;added:number;changes:ReviewChange[]};
/** Read-only display transformation. Its markup must never become save input. */
export function reviewDocument(before:string,after:string,Parser:typeof DOMParser=DOMParser,changesOnly=false):Review{
 if(before===after)return{unchanged:true,before,after,removed:0,added:0,changes:[]};
 const parser=new Parser();
 const blocks=(html:string)=>{const doc=parser.parseFromString(html,'text/html'),out:string[]=[];const emit=(el:Element,parents:Element[])=>{let clone=el.cloneNode(true) as Element;for(const ancestor of [...parents].reverse()){const wrapper=ancestor.cloneNode(false) as Element;wrapper.removeAttribute('id');wrapper.append(clone);clone=wrapper;}out.push(clone.outerHTML);};const collect=(node:Node,parents:Element[])=>{
  if(node.nodeType===3){if(node.textContent?.trim()){const p=doc.createElement('p');p.textContent=node.textContent;emit(p,parents);}return;}
  if(node.nodeType!==1)return;const el=node as Element;
  if(el.tagName==='DIV'&&[...el.children].some(c=>['DIV','P','TABLE','OL','UL'].includes(c.tagName)))for(const c of [...el.childNodes])collect(c,[...parents,el]);else emit(el,parents);
 };for(const n of [...doc.body.childNodes])collect(n,[]);return out;};
 const a=blocks(before),b=blocks(after),pairs:[number,number][]=[];
 if(a.length*b.length<=250000){const rows=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)rows[i]![j]=a[i]===b[j]?rows[i+1]![j+1]!+1:Math.max(rows[i+1]![j]!,rows[i]![j+1]!);let i=0,j=0;while(i<a.length&&j<b.length){if(a[i]===b[j])pairs.push([i++,j++]);else if(rows[i+1]![j]!>=rows[i]![j+1]!)i++;else j++;}}
 else{let i=0;while(i<Math.min(a.length,b.length)&&a[i]===b[i]){pairs.push([i,i]);i++;}const tail:[number,number][]=[];let x=a.length-1,y=b.length-1;while(x>=i&&y>=i&&a[x]===b[y])tail.push([x--,y--]);pairs.push(...tail.reverse());}
 const plain=(s:string)=>parser.parseFromString(s,'text/html').body.textContent??'';
 const markText=(html:string,from:number,to:number,side:'before'|'after')=>{if(from>=to)return html;const doc=parser.parseFromString(html,'text/html'),walker=doc.createTreeWalker(doc.body,4),nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);let offset=0;for(const node of nodes){const text=node.data,start=Math.max(0,from-offset),end=Math.min(text.length,to-offset);offset+=text.length;if(start>=end)continue;const mark=doc.createElement('span');mark.setAttribute('style',`background-color:${side==='before'?'#fecdd3':'#a7f3d0'};${side==='before'?'text-decoration:line-through;':''}font-weight:600`);mark.textContent=text.slice(start,end);node.replaceWith(doc.createTextNode(text.slice(0,start)),mark,doc.createTextNode(text.slice(end)));}return doc.body.innerHTML;};
 const outputA:string[]=[],outputB:string[]=[],changes:ReviewChange[]=[];let ai=0,bi=0,removed=0,added=0;
 for(const [i,j] of [...pairs,[a.length,b.length] as [number,number]]){
  let old=a.slice(ai,i).join(''),next=b.slice(bi,j).join('');
  if(old||next){const x=plain(old),y=plain(next),kind=!old?'added':!next?'removed':x===y?'format':'text',id=changes.length;
   changes.push({id,kind,label:({added:'新增内容',removed:'删除内容',format:'格式或结构变化',text:'文字变化'} as const)[kind]});removed+=i-ai;added+=j-bi;
   if(kind==='text'&&i-ai===1&&j-bi===1){let prefix=0;while(prefix<Math.min(x.length,y.length)&&x[prefix]===y[prefix])prefix++;let xe=x.length,ye=y.length;while(xe>prefix&&ye>prefix&&x[xe-1]===y[ye-1]){xe--;ye--;}if(prefix>0&&/[\uD800-\uDBFF]/.test(x[prefix-1]!))prefix--;while(prefix>0&&/[A-Za-z0-9_.]/.test(x[prefix-1]!))prefix--;while(xe<x.length&&/[A-Za-z0-9_.\uDC00-\uDFFF]/.test(x[xe]!))xe++;while(ye<y.length&&/[A-Za-z0-9_.\uDC00-\uDFFF]/.test(y[ye]!))ye++;old=markText(old,prefix,xe,'before');next=markText(next,prefix,ye,'after');}
   const wrap=(html:string,side:'before'|'after')=>`<div data-review-change="${id}" style="background-color:${side==='before'?'#fff1f2':'#ecfdf5'};border-left:3px solid ${side==='before'?'#e11d48':'#059669'};padding:12px;margin:12px 0">${html||'<p style="color:#64748b">'+(side==='before'?'此处为新增内容':'此处内容已删除')+'</p>'}</div>`;
   outputA.push(wrap(old,'before'));outputB.push(wrap(next,'after'));
  }
  if(i<a.length&&!changesOnly){outputA.push(a[i]!);outputB.push(b[j]!);}ai=i+1;bi=j+1;
 }
 if(!changes.length){changes.push({id:0,kind:'format',label:'源码表示变化，阅读内容一致'});return{unchanged:false,before,after,removed:0,added:0,changes};}
 return{unchanged:false,before:outputA.join(''),after:outputB.join(''),removed,added,changes};
}
