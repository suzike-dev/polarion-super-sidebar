import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { JSONContent } from '@tiptap/core';
import { richSchema, safeStyle,calloutTones } from './rich-schema.ts';
import {mergeSourceStyle} from './rich-style.ts';

type H = DefaultTreeAdapterTypes.Node;
type J = JSONContent;
type M = NonNullable<J['marks']>[number];
type RecordNode = { id: string; tag: string; start: number; end: number; open: string; close: string; raw: string; attrs: Record<string, string>; original: J; children: string[]; synthetic?: boolean; tableSection?: { open: string; close: string } };
const tags: Record<string, string> = { p: 'paragraph', pre:'codeBlock', div: 'sourceContainer', ul: 'bulletList', ol: 'orderedList', li: 'listItem', blockquote: 'blockquote', table: 'table', tr: 'tableRow', td: 'tableCell', th: 'tableHeader', hr: 'horizontalRule', br: 'hardBreak' };
const marks: Record<string, string> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', del: 'strike', strike: 'strike', code: 'code', a: 'link', sub: 'subscript', sup: 'superscript', span: 'sourceSpan' };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const identity = (j: J) => j.attrs?.sid as string | undefined;
export function escapeText(value: string) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error('INVALID_XML_TEXT');
  return Array.from(value, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c.codePointAt(0)! > 0xffff ? `&#x${c.codePointAt(0)!.toString(16).toUpperCase()};` : c).join('');
}
const attr = (v: string) => escapeText(v).replaceAll('"', '&quot;');
export class RichDocument {
  readonly version: string;
  readonly source: string;
  readonly document: J;
  records = new Map<string, RecordNode>();
  protectedIds = new Set<string>();
  private serial = 0;
  private rootRecord: RecordNode;
  constructor(source: string, version: string = crypto.randomUUID()) {
    this.version = version;
    this.source = source;
    const fragment = parseFragment(source, { sourceCodeLocationInfo: true });
    const root = { type: 'doc', content: this.blocks(fragment.childNodes) };
    if (!root.content.length) root.content.push({ type: 'paragraph' });
    this.document = richSchema.nodeFromJSON(root).toJSON();
    this.rootRecord = { id: '', tag: '#doc', start: 0, end: source.length, open: '', close: '', raw: source, attrs: {}, original: this.document, children: root.content.map(identity).filter(Boolean) as string[] };
    const baseline = (j: J) => {
      const id = identity(j); if (id && this.records.has(id)) this.records.get(id)!.original = structuredClone(j);
      for (const m of j.marks ?? []) { const r = this.records.get(identity(m)!); if (r && m.type !== 'sourceText') r.original = structuredClone(m); }
      j.content?.forEach(baseline);
    }; baseline(this.document);
    // Reject unsupported parse results before they can be edited; no lossy recovery.
    richSchema.nodeFromJSON(this.document).check();
  }
  private record(node: H, j: J, synthetic = false) {
    const loc = node.sourceCodeLocation;
    const id = `${this.version}:${++this.serial}`;
    const element = node as DefaultTreeAdapterTypes.Element;
    const attrs = Object.fromEntries((element.attrs ?? []).map(a => [a.name, a.value]));
    const start = loc?.startOffset ?? 0, end = loc?.endOffset ?? start;
    const openEnd = loc && 'startTag' in loc ? loc.startTag?.endOffset ?? start : start;
    const closeStart = loc && 'endTag' in loc ? loc.endTag?.startOffset ?? end : end;
    const record: RecordNode = { id, tag: node.nodeName, start, end, raw: this.source.slice(start, end), open: this.source.slice(start, openEnd), close: this.source.slice(closeStart, end), attrs, original: j, children: [], synthetic };
    this.records.set(id, record); j.attrs = { ...j.attrs, sid: id };
    return record;
  }
  private opaque(node: H, inline: boolean): J {
    const attrs = 'attrs' in node ? Object.fromEntries(node.attrs.map(a => [a.name, a.value])) : {};
    const macro = attrs.id?.match(/macro name=([^;]+)/)?.[1];
    const j: J = { type: inline ? 'protectedInline' : 'protectedBlock', attrs: { label: node.nodeName === 'img' ? '图片 · 保留原始引用' : macro ? `Polarion 宏 · ${macro}` : `保留对象 · ${node.nodeName}` } };
    this.protectedIds.add(this.record(node, j).id); return j;
  }
  private blocks(nodes: H[]): J[] {
    const out: J[] = []; let run: H[] = [];
    const flush = () => {
      if (!run.length) return;
      const meaningful = run.some(n => n.nodeName !== '#text' || ('value' in n && n.value.trim()));
      if (meaningful) {
        const content = run.flatMap(n => this.inline(n, []));
        const j: J = { type: 'paragraph', content };
        const first = run[0]!.sourceCodeLocation, last = run.at(-1)!.sourceCodeLocation;
        const r = this.record({ nodeName: '#synthetic', sourceCodeLocation: first && last ? { ...first, endOffset: last.endOffset } : undefined } as H, j, true);
        r.children = content.map(identity).filter(Boolean) as string[]; out.push(j);
      }
      run = [];
    };
    for (const n of nodes) {
      if (n.nodeName === '#text' || marks[n.nodeName] || ['br', 'img'].includes(n.nodeName)) run.push(n);
      else { flush(); out.push(this.block(n)); }
    }
    flush(); return out;
  }
  private inline(n: H, parentMarks: M[]): J[] {
    if (n.nodeName === '#text' && 'value' in n) {
      if (!n.value) return [];
      const j: J = { type: 'text', text: n.value, marks: [] };
      const r = this.record(n, { type: 'sourceText', text: n.value });
      j.marks = [...parentMarks, { type: 'sourceText', attrs: { sid: r.id } }]; return [j];
    }
    const attrs = 'attrs' in n ? Object.fromEntries(n.attrs.map(a => [a.name, a.value])) : {};
    if(n.nodeName==='img'){
      const local=attrs.src?.match(/^polarion-asset:([0-9a-f-]{36})$/i)?.[1];
      const j:J={type:'image',attrs:{src:attrs.src??'',assetId:local??null,alt:attrs.alt??'',title:attrs.title??null,width:attrs.width?Number(attrs.width):null,height:attrs.height?Number(attrs.height):null,sourceStyle:safeStyle(attrs.style)||null},marks:parentMarks};this.record(n,j);return[j];
    }
    // Native Polarion can nest a div inside a span. Preserve its wrapper as an
    // inline source mark, exposing its text instead of hiding an editable clause.
    if(n.nodeName==='div'&&!attrs.id?.startsWith('polarion_wiki macro name=')&&'childNodes'in n&&n.childNodes.length){
      const mark:M={type:'sourceSpan',attrs:{sourceStyle:safeStyle(attrs.style)||null,sourceBlock:true}};this.record(n,mark);
      return n.childNodes.flatMap(child=>this.inline(child,[...parentMarks,mark]));
    }
    if (attrs.id?.startsWith('polarion_wiki macro name=') || (!marks[n.nodeName] && n.nodeName !== 'br')) return [{ ...this.opaque(n, true), marks: parentMarks }];
    if (n.nodeName === 'br') { const j: J = { type: 'hardBreak', marks: parentMarks }; this.record(n, j); return [j]; }
    if (!('childNodes' in n) || !n.childNodes.length) return [{ ...this.opaque(n, true), marks: parentMarks }];
    const mark: M = { type: marks[n.nodeName]!, attrs: { sourceStyle: safeStyle(attrs.style) || null } };
    if (mark.type === 'link') { if (!this.safeLink(attrs.href ?? '')) return [{ ...this.opaque(n, true), marks: parentMarks }]; mark.attrs = { ...mark.attrs, href: attrs.href, target: attrs.target ?? null, rel: attrs.rel ?? null, class: attrs.class ?? null }; }
    this.record(n, mark);
    return ('childNodes' in n ? n.childNodes : []).flatMap(child => this.inline(child, [...parentMarks, mark]));
  }
  private block(n: H): J {
    const attrs = 'attrs' in n ? Object.fromEntries(n.attrs.map(a => [a.name, a.value])) : {};
    if(n.nodeName==='table'&&attrs['data-sidebar-callout']&&calloutTones[attrs['data-sidebar-callout']]){
      const kids=(node:H)=>'childNodes' in node?node.childNodes.filter(c=>c.nodeName!=='#text'||('value'in c&&c.value.trim())):[];
      const section=kids(n),rows=section.length===1&&['tbody','thead'].includes(section[0]!.nodeName)?kids(section[0]!):section;
      const cells=rows.length===1?kids(rows[0]!):[];
      if(rows[0]?.nodeName==='tr'&&cells.length===1&&cells[0]?.nodeName==='td'){
        const j:J={type:'callout',attrs:{tone:attrs['data-sidebar-callout']},content:this.blocks('childNodes' in cells[0]?cells[0].childNodes:[])};if(!j.content!.length)j.content=[{type:'paragraph'}];const r=this.record(n,j);r.children=j.content!.map(identity).filter(Boolean) as string[];return j;
      }
      return this.opaque(n,false);
    }
    if (attrs.id?.startsWith('polarion_wiki macro name=') && !attrs.id.startsWith('polarion_wiki macro name=table;')) return this.opaque(n, false);
    const type = /^h[1-6]$/.test(n.nodeName) ? 'heading' : tags[n.nodeName];
    if (!type || type === 'hardBreak') return this.opaque(n, false);
    let children = 'childNodes' in n ? n.childNodes : [];
    let section: H | undefined;
    if (type === 'table') {
      const groups = children.filter(c => ['tbody', 'thead', 'tfoot'].includes(c.nodeName));
      // Multiple row groups/colgroups/captions need their own mapping before edits are safe.
      if (groups.length > 1 || children.some(c => !['#text', 'tbody', 'thead', 'tfoot', 'tr'].includes(c.nodeName))) return this.opaque(n, false);
      section = groups[0]; if (section && 'childNodes' in section) children = section.childNodes;
    }
    const j: J = { type, attrs: { sourceStyle: safeStyle(attrs.style) || null } };
    if (type === 'heading') j.attrs!.level = Number(n.nodeName[1]);
    if (type === 'orderedList') j.attrs!.start = Number(attrs.start ?? 1);
    if (type === 'paragraph' || type === 'heading') { j.attrs!.textAlign = attrs.style?.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)/i)?.[1] ?? null; }
    if (type === 'tableCell' || type === 'tableHeader') j.attrs = { ...j.attrs, colspan: Number(attrs.colspan ?? 1), rowspan: Number(attrs.rowspan ?? 1), colwidth: attrs['data-colwidth']?.split(',').map(Number) ?? null };
    const r = this.record(n, j);
    if(type==='codeBlock') {const text=(node:H):string=>'value' in node?node.value:node.nodeName==='br'?'\n':'childNodes' in node?node.childNodes.map(text).join(''):'';const value=children.map(text).join('');j.content=value?[{type:'text',text:value}]:[];const code=children.find(c=>c.nodeName==='code');const cls=code&&'attrs'in code?code.attrs.find(a=>a.name==='class')?.value:'';j.attrs!.language=cls?.match(/\blanguage-([\w+-]+)/)?.[1]??null;}
    else if (type === 'paragraph' || type === 'heading') j.content = children.flatMap(c => this.inline(c, []));
    else if (['bulletList','orderedList'].includes(type)) j.content=children.filter(c=>c.nodeName!=='#text'||('value'in c&&c.value.trim())).map(c=>{
      if(c.nodeName==='li')return this.block(c);
      // Polarion/Word can emit a nested list directly under ol/ul. Give the editor
      // a valid list-item wrapper, but retain its exact original source on save.
      const content=this.blocks([c]);if(content[0]?.type!=='paragraph')content.unshift(this.emptySourceParagraph(c));
      const item:J={type:'listItem',attrs:{sourceVirtual:true},content};const itemRecord=this.record({nodeName:'#synthetic',sourceCodeLocation:c.sourceCodeLocation} as H,item,true);itemRecord.children=content.map(identity).filter(Boolean) as string[];return item;
    });
    else if (['table', 'tableRow'].includes(type)) j.content = children.filter(c => c.nodeName !== '#text').map(c => this.block(c));
    else if (type !== 'horizontalRule') { j.content = this.blocks(children); if (!j.content.length) j.content = [{ type: 'paragraph' }]; }
    if(type==='listItem'&&j.content?.[0]?.type!=='paragraph')j.content?.unshift(this.emptySourceParagraph(n));
    r.children = (j.content ?? []).map(identity).filter(Boolean) as string[];
    if (section?.sourceCodeLocation && 'startTag' in section.sourceCodeLocation) {
      const s = section.sourceCodeLocation;
      const first = this.records.get(r.children[0]!), last = this.records.get(r.children.at(-1)!);
      r.tableSection = { open: this.source.slice(r.start + r.open.length, first?.start ?? s.startTag?.endOffset ?? s.startOffset), close: this.source.slice(last?.end ?? s.endTag?.startOffset ?? s.endOffset, r.end - r.close.length) };
    }
    return j;
  }
  private emptySourceParagraph(n:H):J{const loc=n.sourceCodeLocation;const j:J={type:'paragraph'};this.record({nodeName:'#synthetic',sourceCodeLocation:loc?{...loc,endOffset:loc.startOffset}:undefined} as H,j,true);return j;}
  private safeLink(href: string) { return /^(https?:\/\/|mailto:|\/|#)/i.test(href) && !/^\/\//.test(href); }
  serialize(input: J) {
    if (JSON.stringify(input).length > 2_000_000) throw Error('RICH_DOCUMENT_TOO_LARGE');
    const doc = richSchema.nodeFromJSON(input); doc.check(); const json = doc.toJSON();
    if (equal(json, this.document)) return this.source;
    const seen = new Set<string>(), protectedSeen = new Set<string>();
    const validate = (j: J) => {
      const sid = identity(j);
      if (sid) {
        const r = this.records.get(sid); if (!r) throw Error('STALE_RICH_ANCHOR');
        if (seen.has(sid)) throw Error('DUPLICATE_RICH_ANCHOR'); seen.add(sid);
        if (this.protectedIds.has(sid)) { if (!equal(j, r.original)) throw Error('PROTECTED_OBJECT_CHANGED'); protectedSeen.add(sid); }
      } else if (j.type?.startsWith('protected')) throw Error('UNKNOWN_PROTECTED_OBJECT');
      if (j.type?.startsWith('protected') && !this.protectedIds.has(sid!)) throw Error('UNKNOWN_PROTECTED_OBJECT');
      for (const mark of j.marks ?? []) { if (identity(mark) && !this.records.has(identity(mark)!)) throw Error('STALE_RICH_ANCHOR'); }
      j.content?.forEach(validate);
    }; validate(json);
    if (protectedSeen.size !== this.protectedIds.size) throw Error('PROTECTED_OBJECT_REMOVED');
    const usedWrappers = new Set<string>();
    const wrapper = (j: J, mark = false): [string, string] => {
      const r = this.records.get(identity(j)!); const a = j.attrs ?? {};
      if(j.type==='callout'){const tone=calloutTones[a.tone];if(!tone)throw Error('INVALID_CALLOUT_TONE');return [`<table data-sidebar-callout="${a.tone}" cellpadding="12" cellspacing="0" style="width:100%;border-collapse:collapse;border:0"><tbody><tr><td style="background-color:${tone.background};border:0;border-left:3px solid ${tone.border};padding:12px 16px">`,'</td></tr></tbody></table>'];}
      let tag = r?.tag;
      const freshTags: Record<string, string> = { paragraph: 'p', heading: `h${a.level ?? 1}`, bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote', sourceContainer: 'div', table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th', horizontalRule: 'hr', hardBreak: 'br', bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', link: 'a', subscript: 'sub', superscript: 'sup', sourceSpan: 'span', paint: 'span' };
      if (!r || r.original.type !== j.type || r.synthetic) tag = freshTags[j.type!];
      if (j.type === 'heading') tag = `h${a.level}`;
      if(j.type==='codeBlock')tag='pre';
      if (!tag) throw Error('UNSUPPORTED_RICH_NODE');
      const sameAttrs = r && equal(a, r.original.attrs) && r.original.type === j.type;
      if (r?.synthetic && sameAttrs) return ['', ''];
      if (r && sameAttrs && !usedWrappers.has(r.id)) { usedWrappers.add(r.id); return [r.open, r.close]; }
      const attributes = { ...(r?.attrs ?? {}) };
      if (r && usedWrappers.has(r.id)) delete attributes.id;
      if (r) usedWrappers.add(r.id);
      const set = (key: string, value: any, defaultValue?: any) => { if (value == null || value === defaultValue) delete attributes[key]; else attributes[key] = String(value); };
      let style = r ? mergeSourceStyle(attributes.style ?? '', r.original.attrs?.sourceStyle, a.sourceStyle) : safeStyle(a.sourceStyle);
      const css = (key: string, value: string | null) => { style = style.split(';').filter(s => s.trim() && s.slice(0,s.indexOf(':')).trim().toLowerCase() !== key).join(';'); if (value) style += `;${key}:${value}`; };
      if (a.textAlign !== r?.original.attrs?.textAlign) css('text-align', ['left', 'center', 'right', 'justify'].includes(a.textAlign) ? a.textAlign : null);
      if (a.lineHeight !== r?.original.attrs?.lineHeight) css('line-height', /^(1|1\.5|1\.75|2)$/.test(a.lineHeight) ? a.lineHeight : null);
      if (['tableCell', 'tableHeader'].includes(j.type!)) { set('colspan', a.colspan, 1); set('rowspan', a.rowspan, 1); }
      if (['tableCell', 'tableHeader'].includes(j.type!)) {
        if (a.fill !== r?.original.attrs?.fill) css('background-color', /^#[a-f0-9]{6}$/i.test(a.fill) ? a.fill : null);
        if (a.valign !== r?.original.attrs?.valign) css('vertical-align', ['top', 'middle', 'bottom'].includes(a.valign) ? a.valign : null);
        if (a.cellHeight !== r?.original.attrs?.cellHeight) css('height', Number(a.cellHeight) >= 24 && Number(a.cellHeight) <= 600 ? `${Number(a.cellHeight)}px` : null);
        if (!equal(a.colwidth, r?.original.attrs?.colwidth) && Array.isArray(a.colwidth) && a.colwidth.every((w: any) => Number.isInteger(w) && w > 0 && w < 5000)) { attributes['data-colwidth'] = a.colwidth.join(','); css('width', `${a.colwidth.reduce((sum: number, w: number) => sum + w, 0)}px`); }
        if (!r) style = `border:1px solid #cbd5e1;padding:8px;${style}`;
      }
      if (j.type === 'table' && !r) style = 'border-collapse:collapse;width:100%;' + style;
      if(j.type==='table'&&a.sourceStyle!==r?.original.attrs?.sourceStyle){const spacing=style.match(/(?:^|;)\s*border-spacing\s*:\s*(\d+)px\s*(?:;|$)/)?.[1];if(spacing)attributes.cellspacing=spacing;}
      if (j.type === 'orderedList') set('start', a.start, 1);
      if (j.type === 'link') { if (!this.safeLink(a.href)) throw Error('UNSAFE_LINK'); attributes.href = a.href; }
      if (j.type === 'paint') { for (const [key, value] of [['color', a.color], ['background-color', a.background], ['font-size', a.size], ['font-family', a.font]]) if (value) css(key, safeStyle(`${key}:${value}`) ? value : null); }
      if (style) attributes.style = style; else delete attributes.style;
      // Original attributes survive; newly supplied arbitrary attributes never enter HTML.
      const opening = `<${tag}${Object.entries(attributes).map(([k, v]) => ` ${k}="${attr(v)}"`).join('')}>`;
      return [opening, ['hr', 'br'].includes(tag) ? '' : `</${tag}>`];
    };
    const inline = (children: J[]) => {
      let result = '', stack: J[] = [], closes: string[] = [];
      for (const c of children) {
        const current = (c.marks ?? []).filter(m => m.type !== 'sourceText'); let common = 0;
        while (common < stack.length && common < current.length && equal(stack[common], current[common])) common++;
        while (stack.length > common) { stack.pop(); result += closes.pop(); }
        for (const mark of current.slice(common)) { const [o, e] = wrapper(mark, true); result += o; stack.push(mark); closes.push(e); }
        if (c.type === 'text') { const sourceMark = c.marks?.find(m => m.type === 'sourceText'); const r = this.records.get(identity(sourceMark ?? {})!); result += r && r.original.text === c.text ? r.raw : escapeText(c.text ?? ''); }
        else result += render(c);
      }
      return result + closes.reverse().join('');
    };
    const children = (items: J[], r?: RecordNode) => {
      let result = '';
      for (let i = 0; i < items.length; i++) {
        const prev = this.records.get(identity(items[i - 1] ?? {})!); const curr = this.records.get(identity(items[i]!)!);
        if (prev && curr && prev.end <= curr.start && r?.children.includes(prev.id) && r.children.indexOf(curr.id) === r.children.indexOf(prev.id) + 1) result += this.source.slice(prev.end, curr.start);
        result += render(items[i]!);
      }
      if (r && items.length) {
        const first = this.records.get(identity(items[0]!)!); const last = this.records.get(identity(items.at(-1)!)!);
        const originalFirst = this.records.get(r.children[0]!); const originalLast = this.records.get(r.children.at(-1)!);
        if (first && originalFirst?.id === first.id) { const prefix = this.source.slice(r.start + r.open.length, first.start); if (/^\s*$/.test(prefix)) result = prefix + result; }
        if (last && originalLast?.id === last.id) { const suffix = this.source.slice(last.end, r.end - r.close.length); if (/^\s*$/.test(suffix)) result += suffix; }
      }
      return result;
    };
    const render = (j: J): string => {
      const r = this.records.get(identity(j)!);
      if (r && equal(j, r.original)) return r.raw;
      if (j.type === 'doc') return children(j.content ?? [], this.rootRecord);
      if (j.type?.startsWith('protected')) return r!.raw;
      if(j.type==='image'){
        const a=j.attrs??{};const attrs={...(r?.attrs??{})};
        if(a.assetId){if(!/^[0-9a-f-]{36}$/i.test(a.assetId))throw Error('INVALID_IMAGE_ASSET');attrs.src='polarion-asset:'+a.assetId;}
        else if(r&&a.src===r.original.attrs?.src)attrs.src=a.src;
        else throw Error('IMAGE_IMPORT_REQUIRED');
        attrs.alt=String(a.alt??'');if(a.title)attrs.title=String(a.title);else delete attrs.title;
        let style=attrs.style??'';
        const css=(key:string,value:string)=>{style=style.split(';').filter(s=>s.trim()&&!s.trim().toLowerCase().startsWith(key+':')).join(';');if(value)style+=';'+key+':'+value;};
        for(const dimension of ['width','height'])if(a[dimension]!==r?.original.attrs?.[dimension]){if(a[dimension]==null){delete attrs[dimension];css(dimension,'');}else if(Number.isInteger(Number(a[dimension]))&&Number(a[dimension])>0&&Number(a[dimension])<10000){attrs[dimension]=String(a[dimension]);css(dimension,`${a[dimension]}px`);}else throw Error('INVALID_IMAGE_SIZE');}
        if(a.align!==r?.original.attrs?.align){if(!['left','center','right'].includes(a.align))throw Error('INVALID_IMAGE_ALIGN');css('display','block');css('margin-left',a.align==='left'?'0':'auto');css('margin-right',a.align==='right'?'0':'auto');}
        if(!r)css('max-width','100%');if(style)attrs.style=style;
        return '<img'+Object.entries(attrs).map(([k,v])=>` ${k}="${attr(v)}"`).join('')+'>';
      }
      const [open, close] = wrapper(j);
      let body = j.type==='codeBlock'?'':['paragraph', 'heading'].includes(j.type!) ? inline(j.content ?? []) : children(j.content ?? [], r);
      if(j.type==='codeBlock'){const language=j.attrs?.language;if(language&&!/^[\w+-]{1,40}$/.test(language))throw Error('INVALID_CODE_LANGUAGE');body=`<code${language?` class="language-${language}"`:''}>${escapeText((j.content??[]).map(c=>c.text??'').join(''))}</code>`;}
      // Polarion LiveDoc strips heading tags inside a work-item description. Keep
      // semantics in stored HTML and an inline style carrier for the native view.
      if (j.type === 'heading' && !r?.raw.includes('data-polarion-sidebar-heading=')) {
        const level=Number(j.attrs?.level??2);const size=[28,24,20,17,15,14][level-1]??20;
        body=`<span data-polarion-sidebar-heading="${level}" style="font-size:${size}px;font-weight:bold;color:#263E5C;line-height:1.6">${body}</span>`;
      }
      if (j.type === 'table' && r?.tableSection) body = r.tableSection.open + body + r.tableSection.close;
      return open + body + close;
    };
    return render(json);
  }
}
