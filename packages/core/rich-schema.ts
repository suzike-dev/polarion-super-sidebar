import { Extension, Mark, Node, mergeAttributes, getSchema, InputRule, wrappingInputRule, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {safeStyle,safeColor} from './rich-style.ts';
import {documentNodeStyle} from './document-presentation.ts';
import {TaskList,TaskItem} from './task-nodes.ts';
export {safeStyle} from './rich-style.ts';

const blockTypes = ['paragraph', 'heading', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'taskList','taskItem','blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader', 'sourceContainer', 'horizontalRule', 'hardBreak'];
const markTypes = ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'subscript', 'superscript', 'sourceSpan'];
const PortablePresentation = Extension.create({
  name:'portablePresentation',
  addGlobalAttributes(){
    return [...blockTypes,...markTypes].map(type=>({types:[type],attributes:{
      portableStyle:{default:null,rendered:true,renderHTML:(attrs:Record<string,any>)=>
        !attrs.sid&&documentNodeStyle(type,attrs)?{style:documentNodeStyle(type,attrs)}:{}},
    }}));
  },
});
const SourceAttributes = Extension.create({ name: 'sourceAttributes', addGlobalAttributes() { return [{ types: [...blockTypes, ...markTypes], attributes: {
  sid: { default: null, rendered: false, keepOnSplit: false },
  sourceStyle: { default: null, keepOnSplit: false, parseHTML: el => safeStyle(el.getAttribute('style') ?? ''), renderHTML: attrs => attrs.sourceStyle ? { style: safeStyle(attrs.sourceStyle) } : {} },
} }, { types: ['paragraph', 'heading'], attributes: { lineHeight: { default: null, parseHTML: el => el.style.lineHeight || null, renderHTML: a => /^(1|1\.2|1\.5|1\.75|2)$/.test(a.lineHeight) ? { style: `line-height:${a.lineHeight}` } : {} } } }, { types: ['tableCell', 'tableHeader'], attributes: {
  fill: { default: null, parseHTML: el => el.style.backgroundColor || null, renderHTML: a => safeColor(a.fill) ? { style: `background-color:${safeColor(a.fill)}` } : {} },
  valign: { default: null, renderHTML: a => ['top', 'middle', 'bottom'].includes(a.valign) ? { style: `vertical-align:${a.valign}` } : {} },
  cellHeight: { default: null, renderHTML: a => Number(a.cellHeight) >= 24 && Number(a.cellHeight) <= 600 ? { style: `height:${Number(a.cellHeight)}px` } : {} },
} }]; } });
const SourceListItem=Extension.create({name:'sourceListItem',addGlobalAttributes(){return[{types:['listItem'],attributes:{sourceVirtual:{default:false,keepOnSplit:false,renderHTML:a=>a.sourceVirtual?{'data-source-wrapper':'true'}:{}}}}];}});
const SourceText = Mark.create({ name: 'sourceText', inclusive: false, excludes: '', addAttributes() { return { sid: { default: null, rendered: false } }; }, renderHTML() { return ['span', {'data-source-text':'true'}, 0]; } });
const SourceSpan = Mark.create({ name: 'sourceSpan', addAttributes(){return{sourceBlock:{default:false,rendered:false}};}, excludes: '', inclusive: false, parseHTML() { return [{ tag: 'span' }]; }, renderHTML({ mark, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes,mark.attrs.sourceBlock?{'data-source-block':'true'}:{}), 0]; } });
const Paint = Mark.create({ name: 'paint', addAttributes() { return {
  color: { default: null }, background: { default: null }, size: { default: null }, font: { default: null }, line: {default:null},
}; }, renderHTML({ mark }) { const a = mark.attrs; const height=/^(1|1\.2|1\.5|1\.75|2)$/.test(a.line)?a.line:/^\d+(\.\d+)?pt$/.test(a.size??'')?(parseFloat(a.size)>=15?'1.2':'1.5'):null;const style = safeStyle(`color:${a.color ?? ''};background-color:${a.background ?? ''};font-size:${a.size ?? ''};font-family:${a.font ?? ''};line-height:${height??''}`); return ['span', { style }, 0]; } });
const Container = Node.create({ name: 'sourceContainer', group: 'block', content: 'block+', defining: true, parseHTML() { return [{ tag: 'div[data-source-container]' }]; }, renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-source-container': '' }), 0]; } });
export const calloutTones:Record<string,{background:string;border:string}>={info:{background:'#eff6ff',border:'#2563eb'},note:{background:'#ecfdf5',border:'#0f766e'},warning:{background:'#fff7ed',border:'#c2410c'},danger:{background:'#fef2f2',border:'#b91c1c'}};
/** 数学公式（KaTeX）：存储为带 data-tex 的元素，原生视图显示等宽 TeX 源码，侧边栏渲染成排版公式。 */
export const formulaLimit = 4000;
const FormulaAttrs=()=>({sid:{default:null,rendered:false},tex:{default:'',parseHTML:(el:HTMLElement)=>el.getAttribute('data-tex')??el.textContent??''}});
const Formula=Node.create({name:'formula',group:'block',atom:true,draggable:true,selectable:true,addAttributes(){return FormulaAttrs();},parseHTML(){return[{tag:'div[data-sidebar-formula]',getAttrs:(el:HTMLElement)=>({tex:el.getAttribute('data-tex')??el.textContent??''})}];},renderHTML({node}){return['div',{'data-sidebar-formula':'block','data-tex':node.attrs.tex},node.attrs.tex];}});
const FormulaInline=Node.create({name:'formulaInline',group:'inline',inline:true,atom:true,draggable:true,selectable:true,addAttributes(){return FormulaAttrs();},parseHTML(){return[{tag:'span[data-sidebar-formula]',getAttrs:(el:HTMLElement)=>({tex:el.getAttribute('data-tex')??el.textContent??''})}];},renderHTML({node}){return['span',{'data-sidebar-formula':'inline','data-tex':node.attrs.tex},node.attrs.tex];}});
/** 折叠块：原生 <details>/<summary>，Polarion 原生视图不折叠时内容仍完整可读。 */
const Details=Node.create({name:'details',group:'block',content:'detailsSummary block+',defining:true,isolating:true,addAttributes(){return{sid:{default:null,rendered:false},open:{default:false,parseHTML:el=>el.hasAttribute('open'),renderHTML:a=>a.open?{open:''}:{}}};},parseHTML(){return[{tag:'details'}];},renderHTML({HTMLAttributes}){return['details',mergeAttributes(HTMLAttributes,{'data-sidebar-details':'true'}),0];}});
const DetailsSummary=Node.create({name:'detailsSummary',content:'inline*',defining:true,isolating:true,addAttributes(){return{sid:{default:null,rendered:false}};},parseHTML(){return[{tag:'summary'}];},renderHTML(){return['summary',{},0];}});
/** Markdown 快捷输入：任务项 `- [ ]`、高亮 `==文字==`；表格与公式走回车规则（见 MarkdownEnter）。 */
const MarkdownInputs=Extension.create({name:'markdownInputs',addInputRules(){return[
  wrappingInputRule({find:/^\s*([-*+])\s\[([ xX])?\]\s$/,type:this.editor.schema.nodes.taskItem!,getAttributes:match=>({checked:(match[2]??' ').toLowerCase()==='x'})}),
  new InputRule({find:/==([^=\n]+)==$/,handler:({state,range,chain})=>{const text=state.doc.textBetween(range.from,range.to);const inner=text.replace(/^==|==$/g,'');chain().insertContentAt({from:range.from,to:range.to},{type:'text',text:inner,marks:[{type:'paint',attrs:{background:'#fff3c4'}}]}).run();}}),
];}});
/** 回车规则：`|a|b|` 整行成表、`$$..$$` 整行成块公式；行内 `$..$` 以 `$` 键收尾成行内公式。 */
const MarkdownEnter=Extension.create({name:'markdownEnter',addKeyboardShortcuts(){return{Enter:()=>{const{$from}=this.editor.state.selection;const parent=$from.parent;if(this.editor.view.composing||parent.type.name!=='paragraph'||!this.editor.state.selection.empty||$from.parentOffset<parent.content.size)return false;const text=parent.textContent;
  const table=text.match(/^\s*\|(.+)\|\s*$/);
  if(table){const cells=table[1]!.split('|').map(c=>c.trim());if(cells.length>=2&&cells.length<=20&&cells.every(c=>c&&!c.includes('--'))){const header={type:'tableRow',content:cells.map(c=>({type:'tableHeader',content:[{type:'paragraph',content:c?[{type:'text',text:c.slice(0,500)}]:[]}]}))};const body=Array.from({length:2},()=>({type:'tableRow',content:cells.map(()=>({type:'tableCell',content:[{type:'paragraph'}]}))}));return this.editor.commands.insertContentAt({from:$from.before(),to:$from.after()},{type:'table',content:[header,...body]});}}
  const blockFormula=text.match(/^\s*\$\$(.+)\$\$\s*$/);
  if(blockFormula&&blockFormula[1]!.trim())return this.editor.commands.insertContentAt({from:$from.before(),to:$from.after()},{type:'formula',attrs:{tex:blockFormula[1]!.trim().slice(0,formulaLimit)}});
  return false;},'$':()=>{const{$from}=this.editor.state.selection;if(!this.editor.state.selection.empty||$from.parent.type.spec.code||$from.parentOffset<$from.parent.content.size)return false;const text=$from.parent.textContent;// 快捷键先于字符插入触发：当前文本是「$..」缺尾 $ 的形态才转换；美元等货币（数字开头）不触发。
const m=text.match(/(^|[^$\d])\$([^$\n]+)$/);if(!m||!/^[\\A-Za-z(]/.test(m[2]!))return false;const start=$from.pos-m[2]!.length-1;return this.editor.chain().focus().deleteRange({from:start,to:$from.pos}).insertContentAt(start,{type:'formulaInline',attrs:{tex:m[2]!.trim().slice(0,formulaLimit)}}).insertContent(' ').run();}};}});
const Callout=Node.create({name:'callout',group:'block',content:'block+',defining:true,addAttributes(){return{sid:{default:null,rendered:false},tone:{default:'info',parseHTML:el=>el.getAttribute('data-sidebar-callout')??'info'}};},parseHTML(){return[{tag:'table[data-sidebar-callout]',contentElement:'td'}];},renderHTML({node}){const tone=calloutTones[node.attrs.tone]??calloutTones.info!;return['table',{'data-sidebar-callout':node.attrs.tone,class:'document-callout',style:'width:100%;border-collapse:collapse;border:0'},['tbody',{},['tr',{},['td',{style:`background-color:${tone.background};border:0;border-left:3px solid ${tone.border};padding:12px 16px`},0]]]];}});
export const RichImage = Node.create({ name:'image', group:'inline', inline:true, atom:true, draggable:true,
  addAttributes(){return{sid:{default:null,rendered:false},src:{default:''},assetId:{default:null,parseHTML:el=>el.getAttribute('data-polarion-asset'),renderHTML:a=>a.assetId?{'data-polarion-asset':a.assetId}:{}},alt:{default:''},title:{default:null},width:{default:null},height:{default:null},align:{default:'left'},sourceStyle:{default:null,rendered:false}};},
  parseHTML(){return[{tag:'img[src]'}];},renderHTML({node}){const a=node.attrs;return['img',{src:a.src,alt:a.alt,title:a.title,...(a.width?{width:a.width}:{}),...(a.height?{height:a.height}:{}),...(a.assetId?{'data-polarion-asset':a.assetId}:{}),style:safeStyle(a.sourceStyle)}];},
});
/** Polarion 工作项引用：内联原子节点；已有引用按原始 HTML 保真序列化，新插入输出标准引用标记。 */
export const WorkItemRef = Node.create({ name: 'workItemRef', group: 'inline', inline: true, atom: true, draggable: true, selectable: true,
  addAttributes() { return { sid: { default: null, rendered: false }, workItemId: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-type="workItem"]', getAttrs: el => ({ workItemId: el.getAttribute('data-item-id') ?? '' }) }, { tag: 'span[data-type="workitem"][data-item-id]' }]; },
  renderHTML({ node }) { return ['span', { class: 'polarion-rte-link', 'data-type': 'workItem', 'data-item-id': node.attrs.workItemId, 'data-option-id': 'long', contenteditable: 'false', title: `工作项引用 · ${node.attrs.workItemId}` }, node.attrs.workItemId]; },
});
function protectedNode(inline: boolean) { return Node.create({ name: inline ? 'protectedInline' : 'protectedBlock', group: inline ? 'inline' : 'block', inline, atom: true, draggable: false, selectable: true,
  addAttributes() { return { sid: { default: null, rendered: false }, label: { default: '保留对象', rendered: false }, text: { default: '', rendered: false } }; },
  renderHTML({ node }) { const visible = node.attrs.text || (String(node.attrs.label).startsWith('图片') ? node.attrs.label : '受保护内容'); return [inline ? 'span' : 'div', { class: 'protected-object', contenteditable: 'false', title: `原始内容与身份保留 · ${node.attrs.label}` }, visible]; },
}); }
export function richExtensions() { return [StarterKit.configure({ link: { openOnClick: false, autolink: false }, trailingNode: false }), TaskList,TaskItem,PortablePresentation, SourceAttributes, SourceListItem, SourceText, SourceSpan, Paint, Container, Callout, Formula, FormulaInline, Details, DetailsSummary, RichImage, WorkItemRef, MarkdownInputs, MarkdownEnter, protectedNode(false), protectedNode(true), Table.configure({ resizable: true }), TableRow, TableCell, TableHeader, TextAlign.configure({ types: ['paragraph', 'heading'] }), Subscript, Superscript]; }
export const richSchema = getSchema(richExtensions());

/** 内联节点类型：tableCell/tableHeader/listItem 里只允许块级子节点的第一层。 */
const INLINE_JSON_TYPES = new Set(['text', 'image', 'formulaInline', 'hardBreak']);
/**
 * 结构净化（防御底线）：真实文档/AI 写入可能产生空 tableCell 或把内联内容直接挂在 cell 下，
 * ProseMirror nodeFromJSON 会抛 “Invalid content for node tableCell”。这里把非法 cell/listItem
 * 修正为合法形态（内联包进段落、空则补空段落），不改变合法内容。
 */
export function sanitizeRichJSON(doc: JSONContent): JSONContent {
  const walk = (node: JSONContent): JSONContent => {
    if (!node || typeof node !== 'object') return node;
    const children = Array.isArray(node.content) ? node.content.map(walk) : node.content;
    if ((node.type === 'tableCell' || node.type === 'tableHeader' || node.type === 'listItem') && Array.isArray(children)) {
      const hasBlock = children.some(child => child?.type && !INLINE_JSON_TYPES.has(child.type));
      if (!children.length || !hasBlock) {
        const inline = children.filter(child => !!child?.type);
        return { ...node, content: [{ type: 'paragraph', ...(inline.length ? { content: inline } : {}) }] };
      }
    }
    return children === node.content ? node : { ...node, ...(children !== undefined ? { content: children } : {}) };
  };
  return walk(doc);
}
