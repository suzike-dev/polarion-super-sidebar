import { Extension, Mark, Node, mergeAttributes, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {safeStyle} from './rich-style.ts';
export {safeStyle} from './rich-style.ts';

const blockTypes = ['paragraph', 'heading', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'tableHeader', 'sourceContainer', 'horizontalRule', 'hardBreak'];
const markTypes = ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'subscript', 'superscript', 'sourceSpan'];
const SourceAttributes = Extension.create({ name: 'sourceAttributes', addGlobalAttributes() { return [{ types: [...blockTypes, ...markTypes], attributes: {
  sid: { default: null, rendered: false, keepOnSplit: false },
  sourceStyle: { default: null, keepOnSplit: false, parseHTML: el => safeStyle(el.getAttribute('style') ?? ''), renderHTML: attrs => attrs.sourceStyle ? { style: safeStyle(attrs.sourceStyle) } : {} },
} }, { types: ['paragraph', 'heading'], attributes: { lineHeight: { default: null, parseHTML: el => el.style.lineHeight || null, renderHTML: a => /^(1|1\.5|1\.75|2)$/.test(a.lineHeight) ? { style: `line-height:${a.lineHeight}` } : {} } } }, { types: ['tableCell', 'tableHeader'], attributes: {
  fill: { default: null, parseHTML: el => el.style.backgroundColor || null, renderHTML: a => a.fill && /^#[a-f0-9]{6}$/i.test(a.fill) ? { style: `background-color:${a.fill}` } : {} },
  valign: { default: null, renderHTML: a => ['top', 'middle', 'bottom'].includes(a.valign) ? { style: `vertical-align:${a.valign}` } : {} },
  cellHeight: { default: null, renderHTML: a => Number(a.cellHeight) >= 24 && Number(a.cellHeight) <= 600 ? { style: `height:${Number(a.cellHeight)}px` } : {} },
} }]; } });
const SourceListItem=Extension.create({name:'sourceListItem',addGlobalAttributes(){return[{types:['listItem'],attributes:{sourceVirtual:{default:false,keepOnSplit:false,renderHTML:a=>a.sourceVirtual?{'data-source-wrapper':'true'}:{}}}}];}});
const SourceText = Mark.create({ name: 'sourceText', inclusive: false, excludes: '', addAttributes() { return { sid: { default: null, rendered: false } }; }, renderHTML() { return ['span', {'data-source-text':'true'}, 0]; } });
const SourceSpan = Mark.create({ name: 'sourceSpan', addAttributes(){return{sourceBlock:{default:false,rendered:false}};}, excludes: '', inclusive: false, parseHTML() { return [{ tag: 'span' }]; }, renderHTML({ mark, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes,mark.attrs.sourceBlock?{'data-source-block':'true'}:{}), 0]; } });
const Paint = Mark.create({ name: 'paint', addAttributes() { return {
  color: { default: null }, background: { default: null }, size: { default: null }, font: { default: null },
}; }, renderHTML({ mark }) { const a = mark.attrs; const style = safeStyle(`color:${a.color ?? ''};background-color:${a.background ?? ''};font-size:${a.size ?? ''};font-family:${a.font ?? ''}`); return ['span', { style }, 0]; } });
const Container = Node.create({ name: 'sourceContainer', group: 'block', content: 'block+', defining: true, parseHTML() { return [{ tag: 'div[data-source-container]' }]; }, renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-source-container': '' }), 0]; } });
export const calloutTones:Record<string,{background:string;border:string}>={info:{background:'#eff6ff',border:'#2563eb'},note:{background:'#ecfdf5',border:'#0f766e'},warning:{background:'#fff7ed',border:'#c2410c'}};
const Callout=Node.create({name:'callout',group:'block',content:'block+',defining:true,addAttributes(){return{sid:{default:null,rendered:false},tone:{default:'info',parseHTML:el=>el.getAttribute('data-sidebar-callout')??'info'}};},parseHTML(){return[{tag:'table[data-sidebar-callout]',contentElement:'td'}];},renderHTML({node}){const tone=calloutTones[node.attrs.tone]??calloutTones.info!;return['table',{'data-sidebar-callout':node.attrs.tone,class:'document-callout',style:'width:100%;border-collapse:collapse;border:0'},['tbody',{},['tr',{},['td',{style:`background-color:${tone.background};border:0;border-left:3px solid ${tone.border};padding:12px 16px`},0]]]];}});
export const RichImage = Node.create({ name:'image', group:'inline', inline:true, atom:true, draggable:true,
  addAttributes(){return{sid:{default:null,rendered:false},src:{default:''},assetId:{default:null,parseHTML:el=>el.getAttribute('data-polarion-asset'),renderHTML:a=>a.assetId?{'data-polarion-asset':a.assetId}:{}},alt:{default:''},title:{default:null},width:{default:null},height:{default:null},align:{default:'left'},sourceStyle:{default:null,rendered:false}};},
  parseHTML(){return[{tag:'img[src]'}];},renderHTML({node}){const a=node.attrs;return['img',{src:a.src,alt:a.alt,title:a.title,...(a.width?{width:a.width}:{}),...(a.height?{height:a.height}:{}),...(a.assetId?{'data-polarion-asset':a.assetId}:{}),style:safeStyle(a.sourceStyle)}];},
});
function protectedNode(inline: boolean) { return Node.create({ name: inline ? 'protectedInline' : 'protectedBlock', group: inline ? 'inline' : 'block', inline, atom: true, draggable: false, selectable: true,
  addAttributes() { return { sid: { default: null, rendered: false }, label: { default: '保留对象', rendered: false } }; },
  renderHTML({ node }) { return [inline ? 'span' : 'div', { class: 'protected-object', contenteditable: 'false', title: '原始内容与身份保留，专用编辑器尚未接入' }, node.attrs.label]; },
}); }
export function richExtensions() { return [StarterKit.configure({ link: { openOnClick: false, autolink: false }, trailingNode: false }), SourceAttributes, SourceListItem, SourceText, SourceSpan, Paint, Container, Callout, RichImage, protectedNode(false), protectedNode(true), Table.configure({ resizable: true }), TableRow, TableCell, TableHeader, TextAlign.configure({ types: ['paragraph', 'heading'] }), Subscript, Superscript]; }
export const richSchema = getSchema(richExtensions());
