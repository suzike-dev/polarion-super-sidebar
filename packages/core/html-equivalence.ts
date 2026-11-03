import {parseFragment,type DefaultTreeAdapterTypes} from 'parse5';
/** Normalize declaration separator whitespace only, retaining order and unknown CSS. */
export function canonicalStyle(source:string){
 let part='',quote='',depth=0,comment=false,escaped=false;const declarations:string[]=[];
 const push=()=>{const colon=part.indexOf(':');declarations.push(colon<0?part.trim():part.slice(0,colon).trim()+':'+part.slice(colon+1).trim());part='';};
 for(let i=0;i<source.length;i++){const c=source[i]!,next=source[i+1];
  if(comment){part+=c;if(c==='*'&&next==='/'){part+='/';i++;comment=false;}continue;}
  if(escaped){part+=c;escaped=false;continue;}if(c==='\\'){part+=c;escaped=true;continue;}
  if(quote){part+=c;if(c===quote)quote='';continue;}
  if(c==='/'&&next==='*'){part+='/*';i++;comment=true;continue;}
  if(c==='"'||c==="'"){quote=c;part+=c;continue;}
  if(c==='(')depth++;if(c===')')depth--;
  if(c===';'&&depth===0)push();else part+=c;
 }push();return declarations.filter(Boolean).join(';');
}
type N=DefaultTreeAdapterTypes.Node;
export function htmlSignature(html:string){
 const visit=(node:N):unknown=>{
  if(node.nodeName==='#text')return ['text',(node as DefaultTreeAdapterTypes.TextNode).value];
  if(node.nodeName==='#comment')return ['comment',(node as DefaultTreeAdapterTypes.CommentNode).data];
  const el=node as DefaultTreeAdapterTypes.Element;
  return [node.nodeName,el.namespaceURI??'',(el.attrs??[]).map(a=>[a.namespace??'',a.name,a.name==='style'?canonicalStyle(a.value):a.value]).sort((a,b)=>JSON.stringify(a.slice(0,2)).localeCompare(JSON.stringify(b.slice(0,2)))),('childNodes'in node?node.childNodes:[]).map(visit)];
 };return JSON.stringify(parseFragment(html).childNodes.map(visit));
}
export function equivalentHtml(a:string,b:string){return a===b||htmlSignature(a)===htmlSignature(b);}
