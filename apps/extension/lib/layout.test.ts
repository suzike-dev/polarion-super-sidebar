import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { contentFingerprint, Layout } from './layout.ts';
test('image helper attribute reordering and CSS serialization are clean; real formatting changes remain dirty',()=>{
 const doc=new JSDOM('<body><img title="diagram" src="/a.png" style="width:760px;max-width:100%;margin-left:auto;"></body>').window.document,before=contentFingerprint(doc.body),img=doc.querySelector('img')!;
 img.removeAttribute('title');img.setAttribute('style','width: 760px; max-width: 100%; margin-left: auto;');img.setAttribute('class','');img.setAttribute('title','diagram');
 assert.equal(contentFingerprint(doc.body),before);img.style.width='800px';assert.notEqual(contentFingerprint(doc.body),before);
});
test('unchanged layout polling performs no DOM writes and closing restores native panes',()=>{
 const dom=new JSDOM('<div class="polarion-dle-SplitPanel"><div style="right:240px"><iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe></div><div class="polarion-dle-SidebarContainer" style="visibility:visible"></div></div>');
 const previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const split=document.querySelector<HTMLElement>('.polarion-dle-SplitPanel')!;split.getBoundingClientRect=()=>({width:1600,top:46} as DOMRect);
  const observer=new dom.window.MutationObserver(()=>{});observer.observe(split,{attributes:true,subtree:true});const layout=new Layout();
  layout.apply(true,410);assert(observer.takeRecords().length>0);layout.apply(true,410);assert.equal(observer.takeRecords().length,0);
  layout.apply(false,410);assert.equal(split.firstElementChild!.getAttribute('style'),'right:240px');assert.equal(split.lastElementChild!.getAttribute('style'),'visibility:visible');observer.disconnect();
 }finally{globalThis.document=previous;dom.window.close();}
});
test('native hover decorations do not masquerade as edits; content and formatting still do', () => {
  const doc = new JSDOM('<body><div id="polarion_wiki macro name=module-workitem;params=id=T-1" class="polarion-dle-workitem-basic-0" last_known_index="1"><span class="polarion-dle-workitem-icon-container-decorations">icon</span><p style="color:red">25 °C</p></div></body>').window.document;
  const before = contentFingerprint(doc.body);
  const item = doc.body.firstElementChild as HTMLElement; item.style.borderColor = 'red'; item.classList.add('polarion-dle-workitem-hover'); item.setAttribute('last_known_index', '2');
  assert.equal(contentFingerprint(doc.body), before);
  doc.querySelector('p')!.style.color = 'blue'; assert.notEqual(contentFingerprint(doc.body), before);
  doc.querySelector('p')!.style.color = 'red'; doc.querySelector('p')!.textContent = '26 °C'; assert.notEqual(contentFingerprint(doc.body), before);
});
test('native focus tint and its end-field caret spacer are decorations, paragraph highlights remain content', () => {
  const doc = new JSDOM('<body><div id="polarion_wiki macro name=module-workitem;params=id=T-1"><p>x</p>tail<span id="polarion_editor_fields_container_end">Draft</span></div></body>').window.document;
  const before = contentFingerprint(doc.body); const item = doc.body.firstElementChild as HTMLElement;
  item.style.backgroundColor = 'rgb(205,230,235)'; const marker = item.lastElementChild!.previousSibling!; marker.textContent += '\u200b';
  assert.equal(contentFingerprint(doc.body), before);
  doc.querySelector('p')!.style.backgroundColor = 'yellow'; assert.notEqual(contentFingerprint(doc.body), before);
});
