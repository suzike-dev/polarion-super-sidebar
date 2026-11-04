import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {DOMSerializer} from '@tiptap/pm/model';
import {richSchema} from './rich-schema.ts';
import {RichDocument} from './rich-document.ts';
import {safeColor} from './rich-style.ts';

test('new heading, paragraph and table defaults are portable, and editor HTML agrees with saved HTML',()=>{
  const doc=new JSDOM('').window.document;
  const paragraph={type:'paragraph',content:[{type:'text',text:'Exact engineering text 001 ±2°C'}]};
  const json={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Heading'}]},paragraph,
    {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',content:[paragraph]},{type:'tableCell',attrs:{fill:'#fff7ed'},content:[paragraph]}]}]}]};
  const saved=doc.createElement('div');saved.innerHTML=new RichDocument('').serialize(json);
  const editor=doc.createElement('div');editor.append(DOMSerializer.fromSchema(richSchema).serializeFragment(richSchema.nodeFromJSON(json).content,{document:doc}));
  for(const [selector,properties] of Object.entries({'h2':['font-size','line-height','font-weight'],p:['margin','font-size'],table:['border-collapse','width'],th:['background-color','padding','vertical-align'],td:['background-color','padding']})) {
    for(const property of properties)assert.equal((saved.querySelector(selector) as HTMLElement).style.getPropertyValue(property),(editor.querySelector(selector) as HTMLElement).style.getPropertyValue(property),selector+':'+property);
  }
  assert.equal(saved.querySelector('th')!.getAttribute('style')!.includes('background-color:#edf3fb'),true);
  const again=new RichDocument(saved.innerHTML);assert.equal(again.serialize(again.document),saved.innerHTML);
});

test('source neighbours remain byte-identical and explicit formatting overrides new defaults',()=>{
  const source='<p style="font-size:10pt;color:red;margin:3pt" id="original">Original</p><span id="polarion_wiki macro name=link;id=X">Macro</span>';
  const model=new RichDocument(source);const changed=structuredClone(model.document);
  changed.content!.push({type:'heading',attrs:{level:3,sourceStyle:'font-size:30px;color:#ff0000'},content:[{type:'text',text:'Custom'}]});
  const saved=model.serialize(changed);assert(saved.startsWith(source));
  const doc=new JSDOM(saved).window.document;
  assert.equal((doc.querySelector('h3') as HTMLElement).style.fontSize,'30px');
  assert.equal((doc.querySelector('h3 span[data-polarion-sidebar-heading]') as HTMLElement).style.fontSize,'30px');
  assert.equal(model.serialize(model.document),source);
});

test('RGB, short hex and transparent cell fills survive editor serialization and reopening',()=>{
  const document=new JSDOM('').window.document;
  for(const fill of ['rgb(237, 243, 251)','#fec','transparent']) {
    const model=new RichDocument('<table><tr><th style="background-color:#123456;padding:9px;color:red">Header</th></tr></table>');
    const json=structuredClone(model.document);const cell=json.content![0]!.content![0]!.content![0]!;
    cell.attrs!.fill=fill;
    const saved=document.createElement('div');saved.innerHTML=model.serialize(json);
    const live=document.createElement('div');live.append(DOMSerializer.fromSchema(richSchema).serializeFragment(richSchema.nodeFromJSON(json).content,{document}));
    assert.equal(saved.querySelector('th')!.style.backgroundColor,live.querySelector('th')!.style.backgroundColor,fill);
    assert.equal(saved.querySelector('th')!.style.color,'red');assert.equal(saved.querySelector('th')!.style.padding,'9px');
    const reopened=new RichDocument(saved.innerHTML);assert.equal(reopened.serialize(reopened.document),saved.innerHTML);
  }
  for(const value of ['red;position:fixed','url(https://example.com)','expression(alert(1))'])assert.equal(safeColor(value),null);
});

test('point sizes use native line metrics while an explicit paragraph line choice survives round trips',()=>{
  const document=new JSDOM('').window.document;
  for(const [size,line,expected] of [['14pt',null,'1.5'],['18pt',null,'1.2'],['18pt','2','2']]){
    const json={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Typography',marks:[{type:'paint',attrs:{size,line,font:'Arial, sans-serif'}}]}]}]};
    const saved=document.createElement('div');saved.innerHTML=new RichDocument('').serialize(json);
    const live=document.createElement('div');live.append(DOMSerializer.fromSchema(richSchema).serializeFragment(richSchema.nodeFromJSON(json).content,{document}));
    for(const surface of [saved,live]){assert.equal(surface.querySelector('span')!.style.fontSize,size);assert.equal(surface.querySelector('span')!.style.lineHeight,expected);}
    const reopened=new RichDocument(saved.innerHTML);assert.equal(reopened.serialize(reopened.document),saved.innerHTML);
  }
});
