import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { LosslessHtml } from '../packages/core/lossless-html.ts';
import { JSDOM } from 'jsdom';
const out=path.resolve(import.meta.dirname,'../.research/s1');
const source=JSON.parse(await fs.readFile(path.join(out,'polarion-samples-private.json'),'utf8'));
const samples={document:source.doc.home_page_content,tableWorkItem:source.item.description,imageWorkItem:source.imageItem.description};
const digest=html=>createHash('sha256').update(html).digest('hex');
const result={at:new Date().toISOString(),scope:'source-preserving primitives and plain-editor baseline, not full rich-editor or Polarion-save acceptance',samples:[]};
for(const [name,html] of Object.entries(samples)) {
  const timings=[];let draft;
  for(let i=0;i<50;i++){const start=performance.now();draft=new LosslessHtml(html);timings.push(performance.now()-start);}
  const editable=draft.nodes.find(n=>n.text?.trim());
  const updated=editable?draft.replaceText(draft.version,[{nodeId:editable.id,expectedText:editable.text,text:'S1 probe < & 中文'}]):null;
  const expected=editable?html.slice(0,editable.start)+'S1 probe &lt; &amp; 中文'+html.slice(editable.end):null;
  result.samples.push({name,bytes:Buffer.byteLength(html),sha256:digest(html),unchanged_sha256_equal:digest(draft.source)===digest(html),targeted_edit_preserves_other_bytes:updated?updated.source===expected:null,editable_text_leaves:draft.nodes.filter(n=>n.text!==undefined).length,macro_nodes:draft.nodes.filter(n=>n.polarionId?.startsWith('polarion_wiki')).length,parse_p95_ms:timings.sort((a,b)=>a-b)[47]});
}
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://fixture.invalid'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
for(const key of ['navigator','Node','HTMLElement','Element','DOMParser','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,key,{value:typeof dom.window[key]==='function'&&key==='getComputedStyle'?dom.window[key].bind(dom.window):dom.window[key],configurable:true});
const {Editor}=await import('@tiptap/core');const {StarterKit}=await import('@tiptap/starter-kit');
const fixture='<p style="color:red" data-polarion="keep">Before</p><div id="polarion_wiki macro name=unknown;params=x=y">Preserve me</div><p>After</p>';
const editor=new Editor({element:document.createElement('div'),extensions:[StarterKit],content:fixture});
const serialized=editor.getHTML();
result.plain_tiptap_baseline={equal:serialized===fixture,macro_identity_preserved:serialized.includes('polarion_wiki'),style_preserved:serialized.includes('color:red'),note:'Default editor is intentionally a baseline; custom mapping and schema still required.'};
editor.destroy();dom.window.close();
await fs.writeFile(path.join(out,'richtext-probe.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
