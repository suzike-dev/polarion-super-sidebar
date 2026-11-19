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

// Content confirmation after a write. Polarion may reformat indentation, drop
// empty inline wrappers and add unmarked list wrappers; those do not change what
// the reader sees. Text, formatting, table spans, links, images and objects must
// still match, so a write that silently kept the old body is not called success.
const layoutElements = new Set(['div', 'p', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'ol', 'ul', 'li', 'br']);
const layoutStyle = /^\s*(?:border(?:-[a-z-]+)?|width|height|margin-left|margin-right|padding|background-color|color|empty-cells|text-align|vertical-align|font-weight)\s*:\s*[\w\s.%#(),+!-]+$/i;
function attrsOf(el: DefaultTreeAdapterTypes.Element) {
 return el.attrs.map(a => [a.namespace ?? '', a.name, a.name === 'style' ? canonicalStyle(a.value) : a.value])
   .sort((a, b) => JSON.stringify(a.slice(0, 2)).localeCompare(JSON.stringify(b.slice(0, 2))));
}
function sig(node: N): unknown {
 if ('value' in node) return ['text', node.value];
 if ('data' in node) return ['comment', node.data];
 const el = node as DefaultTreeAdapterTypes.Element;
 return [node.nodeName, el.namespaceURI ?? '', attrsOf(el), ('childNodes' in node ? node.childNodes : []).map(sig)];
}
function layoutSafe(el: DefaultTreeAdapterTypes.Element) {
 if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !layoutElements.has(el.nodeName)) return false;
 for (const { name, value } of el.attrs) {
   if (name === 'style' && value.split(';').every(d => !d.trim() || layoutStyle.test(d))) continue;
   if (el.nodeName === 'table' && (name === 'class' && value === 'polarion-Document-table' || name === 'id' && /^polarion_wiki macro name=table(?:;params=.*)?$/.test(value))) continue;
   if ((el.nodeName === 'td' || el.nodeName === 'th') && (name === 'rowspan' || name === 'colspan') && /^\d+$/.test(value)) continue;
   if (el.nodeName === 'ol' && name === 'start' && /^-?\d+$/.test(value)) continue;
   return false;
 }
 return true;
}
const inlineStyle = /^\s*(?:color|background(?:-color)?|font(?:-[a-z-]+)?|line-height|letter-spacing|text-decoration(?:-line)?|vertical-align|white-space)\s*:/i;
function formattingSpan(el: DefaultTreeAdapterTypes.Element) {
 if (!['span', 'font'].includes(el.nodeName)) return false;
 return el.attrs.every(attr => attr.name === 'style' && attr.value.split(';').every(part => !part.trim() || inlineStyle.test(part)));
}
const blockTags = new Set(['p','div','table','thead','tbody','tfoot','tr','td','th','ol','ul','li','h1','h2','h3','h4','h5','h6','blockquote','pre','section','article','aside','header','footer','figure','figcaption','details','summary','form','fieldset','legend','address','main','nav']);
function paintsNothing(el: DefaultTreeAdapterTypes.Element) {
 if (!['span', 'font'].includes(el.nodeName)) return false;
 if (el.attrs.some(attr => attr.name !== 'style')) return false;
 const scan = (node: N): boolean => {
   if ('value' in node) return /^[ \t\r\n\f\u200b\ufeff]*$/.test(node.value);
   if (!('childNodes' in node)) return true;
   if (['img','br','hr','table','input','button','select','textarea','video','audio','iframe','object','embed','svg','canvas'].includes(node.nodeName)) return false;
   return node.childNodes.every(scan);
 };
 return el.childNodes.every(scan);
}
function neutralListItem(el: DefaultTreeAdapterTypes.Element) {
 if (el.nodeName !== 'li' || el.attrs.length !== 1) return false;
 const style = el.attrs[0];
 if (!style || style.name !== 'style') return false;
 const declarations = style.value.split(';').map(part => part.trim()).filter(Boolean);
 return declarations.length > 0 && declarations.every(part => {
   const [name, value] = part.split(':').map(part => part.trim().toLowerCase());
   return (name === 'list-style' || name === 'list-style-type') && value === 'none';
 });
}
function neutralList(el: DefaultTreeAdapterTypes.Element) {
 if (el.nodeName !== 'ul' && el.nodeName !== 'ol') return false;
 if (!el.attrs.every(attr => attr.name === 'style' && attr.value.split(';').every(part => !part.trim() || layoutStyle.test(part)))) return false;
 const items = el.childNodes.filter(node => !('value' in node) || !/^[ \t\r\n\f]*$/.test(node.value));
 return items.length > 0 && items.every(node => 'childNodes' in node && neutralListItem(node as DefaultTreeAdapterTypes.Element));
}
function whiteSpaceSensitive(el: DefaultTreeAdapterTypes.Element) {
 if (['pre', 'code', 'textarea'].includes(el.nodeName)) return true;
 const style = el.attrs.find(attr => attr.name === 'style')?.value ?? '';
 return /(?:^|;)\s*white-space\s*:\s*(?:pre|pre-wrap|pre-line|break-spaces)/i.test(style);
}
function opaqueElement(el: DefaultTreeAdapterTypes.Element) {
 if (['img', 'br', 'hr', 'a'].includes(el.nodeName)) return false;
 if (formattingSpan(el) && !whiteSpaceSensitive(el)) return false;
 return !layoutSafe(el);
}
type RenderToken =
 | {kind:'text'; text:string}
 | {kind:'raw'; tag:string; attrs:string[][]; text:string}
 | {kind:'element'; tag:string; attrs:string[][]; children:RenderToken[]; neutral?:true};
function mergeNeutralItems(tokens: RenderToken[]) {
 for (let index = 0; index < tokens.length; index++) {
   const token = tokens[index];
   if (!token || token.kind !== 'element' || !token.neutral) continue;
   const first = token.children[0];
   const list = token.children.length === 1 && first?.kind === 'element' && ['ul', 'ol'].includes(first.tag) ? first : undefined;
   if (!list) continue;
   let previous = index - 1;
   while (previous >= 0) {
     const candidate = tokens[previous];
     if (candidate?.kind === 'element' && candidate.tag === 'li' && !candidate.neutral) break;
     previous--;
   }
   if (previous >= 0) { (tokens[previous] as {children:RenderToken[]}).children.push(list); tokens.splice(index, 1); }
   else tokens.splice(index, 1, list);
   index--;
 }
}
function trimLineEdges(tokens: RenderToken[], block: boolean) {
 const isBlock = (token: RenderToken | undefined) => token?.kind === 'element' && blockTags.has(token.tag);
 const isBreak = (token: RenderToken | undefined) => token?.kind === 'element' && token.tag === 'br';
 const trimText = (token: RenderToken | undefined, side: 'start' | 'end') => {
   if (!token || token.kind !== 'text') return;
   token.text = side === 'start' ? token.text.replace(/^ +/, '') : token.text.replace(/ +$/, '');
 };
 tokens.forEach((token, index) => {
   if (token.kind !== 'text') return;
   const previous = tokens[index - 1], next = tokens[index + 1];
   if (!previous || isBreak(previous) || isBlock(previous)) trimText(token, 'start');
   if (!next || isBreak(next) || isBlock(next)) trimText(token, 'end');
 });
 if (block) { trimText(tokens[0], 'start'); trimText(tokens.at(-1), 'end'); }
 for (let index = tokens.length - 1; index >= 0; index--) {
   const token = tokens[index]!;
   if (token.kind === 'text' && (!token.text || /^ +$/.test(token.text) && (isBlock(tokens[index - 1]) || isBlock(tokens[index + 1]) || !tokens[index - 1] || !tokens[index + 1]))) tokens.splice(index, 1);
 }
 for (const token of tokens) if (token.kind === 'element') trimLineEdges(token.children, blockTags.has(token.tag));
}
export function renderedTokens(nodes: N[], sensitive = false): RenderToken[] {
 const out: RenderToken[] = [];
 let text = '';
 const flush = () => { if (!sensitive) text = text.replace(/[ \t\r\n\f]+/g, ' '); if (text) out.push({kind:'text',text}); text = ''; };
 for (const node of nodes) {
   if ('value' in node) { text += node.value; continue; }
   if ('data' in node) continue;
   const element = node as DefaultTreeAdapterTypes.Element, tag = element.nodeName;
   if (tag === 'script' || tag === 'style' || tag === 'template') { flush(); out.push({kind:'raw',tag,attrs:[],text:JSON.stringify(sig(element))}); continue; }
   if (['span', 'font'].includes(tag) && element.attrs.length === 0) continue;
   if (paintsNothing(element)) continue;
   if (neutralList(element)) { flush(); out.push(...renderedTokens(element.childNodes, sensitive)); continue; }
   if (neutralListItem(element)) {
     flush(); const childTokens = renderedTokens(element.childNodes, sensitive); trimLineEdges(childTokens, true);
     out.push({kind:'element',tag:'li',attrs:[],children:childTokens,neutral:true}); continue;
   }
   if (opaqueElement(element)) { flush(); out.push({kind:'raw',tag,attrs:[],text:JSON.stringify(sig(element))}); continue; }
   if (tag === 'br' || tag === 'hr' || tag === 'img') { flush(); out.push({kind:'element',tag,attrs:attrsOf(element),children:[]}); continue; }
   flush();
   const childTokens = renderedTokens(element.childNodes, sensitive || whiteSpaceSensitive(element));
   trimLineEdges(childTokens, blockTags.has(tag));
   if (tag === 'ul' || tag === 'ol') mergeNeutralItems(childTokens);
   out.push({kind:'element',tag,attrs:attrsOf(element),children:childTokens});
 }
 flush();
 if (!sensitive) trimLineEdges(out, true);
 return out;
}
/** Visible content in reading order. List grouping and block wrappers may be
 * rewritten by Polarion, but text, inline formatting, table cells, images,
 * references and macros still have to be present in the same order. */
function contentTokens(html: string) {
 const out: (string | string[])[] = [];
 const visit = (node: N, marks: string[]) => {
   if ('value' in node) {
     const text = node.value.replace(/[\s\u200b\ufeff]+/g, ' ').trim();
     if (text) out.push([text, ...marks].join('\u0001'));
     return;
   }
   if ('data' in node) return;
   const el = node as DefaultTreeAdapterTypes.Element, tag = el.nodeName;
   if (['script', 'style'].includes(tag)) return;
   if (['span', 'font'].includes(tag) && el.attrs.length === 0) { el.childNodes.forEach(child => visit(child, marks)); return; }
   if (paintsNothing(el)) return;
   if (neutralListItem(el)) { el.childNodes.forEach(child => visit(child, marks)); return; }
   if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'p' || tag === 'li') {
     if (tag === 'li') out.push('LI');
     if (tag === 'div' || tag === 'p') {
       const style = el.attrs.find(a => a.name === 'style')?.value ?? '';
       if (style.trim()) out.push(tag.toUpperCase() + ':' + canonicalStyle(style));
     }
     el.childNodes.forEach(child => visit(child, marks));
     return;
   }
   if (/^h[1-6]$/.test(tag)) {
     out.push(tag.toUpperCase());
     el.childNodes.forEach(child => visit(child, marks));
     out.push('/' + tag.toUpperCase());
     return;
   }
   if (tag === 'table' || tag === 'tr' || tag === 'td' || tag === 'th') {
     out.push(tag === 'table' ? 'TABLE' : tag === 'tr' ? 'TR' : `CELL:${el.attrs.filter(a => a.name === 'colspan' || a.name === 'rowspan').map(a => a.name + '=' + a.value).join(',')}`);
     el.childNodes.forEach(child => visit(child, marks));
     out.push('/' + tag.toUpperCase());
     return;
   }
   if (tag === 'br') { out.push('BR'); return; }
   if (tag === 'hr') { out.push('HR'); return; }
   if (tag === 'img') { out.push('IMG:' + el.attrs.filter(a => ['src', 'width', 'height'].includes(a.name)).map(a => a.name + '=' + a.value).join('|')); return; }
   if (el.attrs.some(a => a.name === 'id' && a.value.startsWith('polarion_wiki macro name='))) { out.push('MACRO:' + el.attrs.find(a => a.name === 'id')!.value); return; }
   if (el.attrs.some(a => a.name === 'data-sidebar-formula')) { out.push('FORMULA:' + JSON.stringify(sig(el))); return; }
   const nextMarks = [...marks];
   if (['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'code'].includes(tag)) nextMarks.push(tag);
   if (tag === 'a') nextMarks.push('a:' + (el.attrs.find(a => a.name === 'href')?.value ?? ''));
   if (tag === 'span' || tag === 'font') {
     const style = el.attrs.find(a => a.name === 'style')?.value ?? '';
     const kept = style.split(';').map(part => part.trim()).filter(part => /^(?:font-size|font-family|font-weight|font-style|color|background(?:-color)?|text-decoration(?:-line)?)/i.test(part));
     if (kept.length) nextMarks.push('s:' + kept.join(';'));
   }
   el.childNodes.forEach(child => visit(child, nextMarks));
 };
 parseFragment(html).childNodes.forEach(child => visit(child, []));
 return out;
}
export function matchesPolarionReadback(submitted: string, received: string) {
 if (submitted === received) return true;
 if (/<(?:style|link)\b/i.test(submitted) || /<(?:style|link)\b/i.test(received)) return equivalentHtml(submitted, received);
 if (JSON.stringify(renderedTokens(parseFragment(submitted).childNodes)) === JSON.stringify(renderedTokens(parseFragment(received).childNodes))) return true;
 // Polarion may re-group nested lists and block wrappers. Confirm the visible
 // content and formatting are still there; a missing word or lost format fails.
 return JSON.stringify(contentTokens(submitted)) === JSON.stringify(contentTokens(received));
}
