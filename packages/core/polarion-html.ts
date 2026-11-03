import {parseFragment,type DefaultTreeAdapterTypes} from 'parse5';
/** LiveDoc's image processing flattens loose top-level paragraphs/headings.
 * A native block container retains them without rewriting any source inside it.
 */
export function polarionWriteHtml(html:string){
 const fragment=parseFragment(html);
 const hasImage=(n:DefaultTreeAdapterTypes.Node):boolean=>n.nodeName==='img'||('childNodes'in n&&n.childNodes.some(hasImage));
 if(!fragment.childNodes.some(hasImage))return html;
 const meaningful=fragment.childNodes.filter(n=>n.nodeName!=='#text'||('value'in n&&n.value.trim()));
 if(meaningful.length===1&&meaningful[0]!.nodeName==='div')return html;
 return '<div data-polarion-sidebar-document="1">'+html+'</div>';
}
