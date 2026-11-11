import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { contentFingerprint, Layout, NativeState, outline, navigateHeading } from './layout.ts';
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

test('resizing changes only the content edge and overlay transitions retain the original native styles',()=>{
 const dom=new JSDOM('<div class="polarion-dle-SplitPanel"><div style="right:240px;color:red"><iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe></div><div class="polarion-dle-SidebarContainer" style="visibility:visible"></div></div>');
 const previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const split=document.querySelector<HTMLElement>('.polarion-dle-SplitPanel')!,content=split.firstElementChild as HTMLElement;let available=1600;
  split.getBoundingClientRect=()=>({width:available,top:46} as DOMRect);const layout=new Layout();layout.apply(true,410);
  const observer=new dom.window.MutationObserver(()=>{});observer.observe(split,{attributes:true,subtree:true});
  for(let width=411;width<=430;width++)layout.apply(true,width);
  const mutations=observer.takeRecords();assert.equal(mutations.length,20);assert(mutations.every(m=>m.target===content));
  available=1000;assert.equal(layout.apply(true,430).overlay,true);assert.equal(content.getAttribute('style'),'right:240px;color:red');
  available=1600;assert.equal(layout.apply(true,430).overlay,false);assert.equal(content.style.right,'430px');
  layout.reset();assert.equal(content.getAttribute('style'),'right:240px;color:red');assert.equal(split.lastElementChild!.getAttribute('style'),'visibility:visible');observer.disconnect();
 }finally{globalThis.document=previous;dom.window.close();}
});

test('empty headings retain their DOM navigation indices and each heading text is read once',()=>{
 const dom=new JSDOM('<iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe>');const previous=globalThis.document;globalThis.document=dom.window.document;
 try{
  const doc=document.querySelector('iframe')!.contentDocument!;doc.body.innerHTML='<h1></h1><h2>First</h2><h3> </h3><h2>Second</h2>';let reads=0,navigated=-1;
  doc.querySelectorAll<HTMLElement>('h1,h2,h3').forEach((heading,index)=>{Object.defineProperty(heading,'innerText',{get(){reads++;return heading.textContent}});heading.scrollIntoView=()=>{navigated=index};});
  const headings=outline();assert.deepEqual(headings.map(h=>({index:h.index,text:h.text})),[{index:1,text:'First'},{index:3,text:'Second'}]);assert.equal(reads,4);
  navigateHeading(headings[1]!.index);assert.equal(navigated,3);
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

const nativePlaceholder = '<div id="polarion_wiki macro name=module-workitem;params=id=T-2" name="wi-placeholder" contenteditable="false"><span class="polarion-dle-workitem-icon-container">icon</span>Loading</div>';
const nativeLoaded = '<div id="polarion_wiki macro name=module-workitem;params=id=T-2"><span id="polarion_editor_fields_container_start">T-2</span><p style="color:red">26 °C</p><span id="polarion_editor_fields_container_end">Draft</span></div>';
async function withNativePage(run:(state:NativeState,doc:Document)=>void|Promise<void>) {
 const dom=new JSDOM('<div id="gwt-debug-toolbar-save" title="保存" class="polarion-dle-toolbar-Button-disabled"></div><iframe id="gwt-debug-polarion-DLE-area-debug-id"></iframe>');
 const previous=globalThis.document;const previousObserver=(globalThis as any).MutationObserver;
 // Node 全局没有 MutationObserver：借 JSDOM 的实现，让 NativeState 的静止基线在测试里可用。
 (globalThis as any).MutationObserver=dom.window.MutationObserver;globalThis.document=dom.window.document;
 const doc=document.querySelector('iframe')!.contentDocument!;
 doc.body.innerHTML='<h2 id="polarion_wiki macro name=module-workitem;params=id=H-1"><span class="polarion-dle-workitem-icon-container" style="display:none">icon</span>Heading</h2><p>Unchanged prose</p>'+nativePlaceholder;
 const state=new NativeState();
 try{state.bind();await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(state.state(),'clean');await run(state,doc);}
 finally{state.close();globalThis.document=previous;(globalThis as any).MutationObserver=previousObserver;dom.window.close();}
}
test('scrolling loads a placeholder and removes a native icon without blocking save; later edits remain detected',()=>withNativePage((state,doc)=>{
 doc.querySelector('[name="wi-placeholder"]')!.outerHTML=nativeLoaded;
 doc.querySelector('.polarion-dle-workitem-icon-container')!.remove();
 assert.equal(state.state(),'clean');assert.equal(state.state(),'clean');
 doc.querySelector('[style]')!.setAttribute('style','color:blue');assert.equal(state.state(),'unknown');
}));
test('lazy loading cannot hide a simultaneous edit to existing prose',()=>withNativePage((state,doc)=>{
 doc.querySelector('[name="wi-placeholder"]')!.outerHTML=nativeLoaded;
 doc.querySelector('p')!.textContent='Changed prose';assert.equal(state.state(),'unknown');
}));
test('loading another work item id does not replace a known placeholder',()=>withNativePage((state,doc)=>{
 doc.querySelector('[name="wi-placeholder"]')!.outerHTML=nativeLoaded.replaceAll('T-2','T-3');assert.equal(state.state(),'unknown');
}));
test('native input still blocks save during lazy loading',()=>withNativePage((state,doc)=>{
 doc.querySelector('[name="wi-placeholder"]')!.outerHTML=nativeLoaded;
 doc.body.dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));assert.equal(state.state(),'dirty');
}));
test('lazy loading requires an explicitly disabled native Save button',()=>withNativePage((state,doc)=>{
 doc.querySelector('[name="wi-placeholder"]')!.outerHTML=nativeLoaded;
 document.querySelector('[title="保存"]')!.className='';assert.equal(state.state(),'unknown');
 document.querySelector('[title="保存"]')!.remove();assert.equal(state.state(),'unknown');
}));
test('an incomplete placeholder replacement is not a loaded work item',()=>withNativePage((state,doc)=>{
 doc.querySelector('[name="wi-placeholder"]')!.outerHTML='<div id="polarion_wiki macro name=module-workitem;params=id=T-2"><p>replacement</p></div>';
 assert.equal(state.state(),'unknown');
}));

test('authoritative native clean verification adopts a completed native save without reloading',()=>withNativePage((state,doc)=>{
 doc.querySelector('p')!.textContent='Saved natively';doc.body.dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));
 assert.equal(state.state(),'dirty');const snapshot=state.captureVerification();state.acceptVerifiedClean(snapshot);assert.equal(state.state(),'clean');
 doc.body.dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));assert.equal(state.state(),'dirty');
}));
test('native verification never absorbs input or DOM changes that arrive during the check',()=>withNativePage((state,doc)=>{
 const snapshot=state.captureVerification();doc.body.dispatchEvent(new doc.defaultView!.Event('input',{bubbles:true}));assert.throws(()=>state.acceptVerifiedClean(snapshot),/NATIVE_EDITOR_DIRTY/);
 const next=state.captureVerification();doc.querySelector('p')!.textContent='Concurrent change';assert.throws(()=>state.acceptVerifiedClean(next),/NATIVE_EDITOR_DIRTY/);
 const enabled=state.captureVerification();document.getElementById('gwt-debug-toolbar-save')!.className='enabled';assert.throws(()=>state.acceptVerifiedClean(enabled),/NATIVE_EDITOR_UNKNOWN/);
}));
