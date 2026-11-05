import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {richSchema,calloutTones} from '../../packages/core/rich-schema.ts';
import {RichDocument} from '../../packages/core/rich-document.ts';
import {safeStyle} from '../../packages/core/rich-style.ts';
import {boardToolNames} from './board-tools.ts';
import {createEditorCapabilitiesTool,editorCapabilities,EDITOR_AGENT_RULES,EDITOR_TOOL_NAMES} from './editor-capabilities.ts';
import {Store} from './store.ts';
import {Assets} from './assets.ts';
import {Polarion} from './polarion.ts';

test('published rich node, mark and attribute names match the running schema exactly',()=>{
  const {rich}=editorCapabilities('rich') as any;
  assert.deepEqual(Object.keys(rich.nodes).sort(),Object.keys(richSchema.nodes).sort());
  assert.deepEqual(Object.keys(rich.marks).sort(),Object.keys(richSchema.marks).sort());
  for(const [name,type] of Object.entries(richSchema.nodes)){assert.deepEqual(Object.keys(rich.nodes[name].attributes).sort(),Object.keys(type.spec.attrs??{}).sort());assert.equal(rich.nodes[name].content,type.spec.content??null);}
  for(const [name,type] of Object.entries(richSchema.marks))assert.deepEqual(Object.keys(rich.marks[name].attributes).sort(),Object.keys(type.spec.attrs??{}).sort());
  assert.deepEqual(rich.writable.callout.tone,Object.keys(calloutTones));
  assert.deepEqual(rich.writable.heading.level,[1,2,3,4,5,6]);
  assert.match(rich.adapterCaveat,/not a promise/);
});

test('documented rich examples and value choices serialize while protected source content survives',()=>{
  const {rich}=editorCapabilities('rich') as any;
  const model=new RichDocument('<div id="polarion_wiki macro name=unknown;">Protected macro</div><p>25 °C</p>');
  const json=structuredClone(model.document);
  json.content!.push(rich.examples.newParagraph,{type:'paragraph',attrs:{textAlign:'center',lineHeight:'1.75'},content:[{type:'text',text:'Styled',marks:[rich.examples.paintMark]}]});
  for(const level of rich.writable.heading.level)json.content!.push({type:'heading',attrs:{level},content:[{type:'text',text:'Level '+level}]});
  for(const tone of rich.writable.callout.tone)json.content!.push({type:'callout',attrs:{tone},content:[{type:'paragraph',content:[{type:'text',text:'Note'}]}]});
  json.content!.push({type:'taskList',content:[{type:'taskItem',attrs:{checked:true},content:[{type:'paragraph',content:[{type:'text',text:'Checked'}]}]}]});
  json.content!.push({type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{fill:'#eef2ff',valign:'middle',cellHeight:24,colspan:1,rowspan:1,colwidth:[120]},content:[{type:'paragraph',content:[{type:'text',text:'Cell'}]}]}]}]});
  json.content!.push({type:'codeBlock',attrs:{language:'mermaid'},content:[{type:'text',text:'graph TD; A-->B'}]});
  const html=model.serialize(json);
  assert.match(html,/<div id="polarion_wiki macro name=unknown;">Protected macro<\/div>/);assert.match(html,/25 °C/);
  assert.match(html,/font-size:12pt/);assert.match(html,/line-height:1.75/);assert.match(html,/data-checked="true"/);assert.match(html,/height:24px/);
  assert.match(html,/<code class="language-mermaid">graph TD; A--&gt;B<\/code>/);
  assert.throws(()=>model.serialize({...json,content:json.content!.filter(node=>!node.type?.startsWith('protected'))}),/PROTECTED_OBJECT_REMOVED/);
});

test('documented style, image and link limits match adapter behavior without banning literal code',()=>{
  assert.equal(safeStyle('position:fixed;color:#123456;background-color:url(https://example.invalid/a);font-size:12pt'),'color:#123456;font-size:12pt');
  const image=new RichDocument('<p><img src="workitemimg:existing.png" alt="Original"></p>'),json=structuredClone(image.document);
  const node=json.content![0]!.content![0]!;node.attrs!.width=9999;node.attrs!.align='center';
  assert.match(image.serialize(json),/width="9999"/);node.attrs!.width=10000;assert.throws(()=>image.serialize(json),/INVALID_IMAGE_SIZE/);
  node.attrs!.width=100;node.attrs!.src='https://example.invalid/new.png';assert.throws(()=>image.serialize(json),/IMAGE_IMPORT_REQUIRED/);
  const link=new RichDocument('<p>text</p>');
  const linkDocument=(href:string)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'link',marks:[{type:'link',attrs:{href}}]}]}]});
  for(const href of ['https://example.invalid','http://example.invalid','mailto:example@example.invalid','/relative','#fragment'])assert.match(link.serialize(linkDocument(href)),/<a /);
  assert.throws(()=>link.serialize(linkDocument('//example.invalid')),/UNSAFE_LINK/);
});

test('capability tool is read-only, concise by default and routes point to registered tools',async()=>{
  const tool=createEditorCapabilitiesTool();assert.equal(tool.name,'get_editor_capabilities');
  const response=await (tool.handler as any)({topic:'summary'},{}),summary=JSON.parse(response.content[0].text);
  assert.deepEqual(summary.remote,{agentSave:false,agentCreateWorkItem:false,saveOwner:'explicit-user-UI-save-and-server-readback'});
  assert.equal(summary.nodes,undefined);assert.equal(summary.marks,undefined);assert(JSON.stringify(summary).length<1500);assert(EDITOR_AGENT_RULES.length<2000);
  const engine=readFileSync(new URL('./engine.ts',import.meta.url),'utf8');
  const registered=[...engine.matchAll(/\btool\('([^']+)'/g)].map(match=>match[1]!);registered.push(tool.name);
  assert.deepEqual([...registered].sort(),[...EDITOR_TOOL_NAMES,'list_guidelines','read_guideline'].sort());
  const names=new Set([...registered,...boardToolNames.map(name=>name.replace('mcp__polarion_drafts__',''))]);
  const boards=(editorCapabilities('boards') as any).boards;
  for(const route of [...Object.values(summary.routes),...Object.values(boards.routes)] as string[][])for(const name of route)assert(names.has(name),'unregistered route: '+name);
  assert(!names.has('save'));assert(!names.has('create_work_item'));
  assert.match(engine,/append: EDITOR_AGENT_RULES/);assert.match(engine,/editorCapabilities:editorCapabilities\(\)/);
  assert.match(engine,/所有画图和需求配图任务必须使用 diagram-design skill/);
  assert.match(EDITOR_AGENT_RULES,/原生命令、Skills和MCP只读能力仍可使用/);
  assert.match(EDITOR_AGENT_RULES,/本地草稿/);assert.match(EDITOR_AGENT_RULES,/服务端回读一致/);
});

test('colwidth null is documented as preserving existing source widths rather than clearing them',()=>{
  const model=new RichDocument('<table><tr><td data-colwidth="120" style="width:120px"><p>Cell</p></td></tr></table>'),json=structuredClone(model.document);
  json.content![0]!.content![0]!.content![0]!.attrs!.colwidth=null;
  const html=model.serialize(json);assert.match(html,/data-colwidth="120"/);assert.match(html,/width:120px/);
  assert.match((editorCapabilities('rich') as any).rich.writable.tableCellAndHeader.colwidth,/does not clear/);
});

test('an imported dialogue image can be used in another document of the same project without invented draft ownership',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'editor-capability-image-')),store=new Store(':memory:'),assets=new Assets(store,folder);
  const target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/AttachmentSource'};
  try{
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b8AAAAASUVORK5CYII=','base64');
    const upload=assets.begin(target,'dialogue.png','image/png',bytes.length);assets.chunk(upload.id,0,bytes.toString('base64'));const image=assets.finish(upload.id);
    const otherTarget={...target,document:'Requirements/Destination'};assert.equal(assets.require(image.id,otherTarget).extraction,'image');assert.throws(()=>assets.require(image.id,{...otherTarget,projectId:'other'}),/ASSET_PROJECT_MISMATCH/);
    let submitted:any;const remote=new Polarion(assets);
    remote.call=async<T>(value:unknown)=>{submitted=value;return {id:'T-1',title:'Fixture'} as T;}; // local transport fixture; never starts a worker
    await remote.save({id:crypto.randomUUID(),target:otherTarget,workItemId:'T-1',title:'Fixture',baseHtml:'',html:`<p><img src="polarion-asset:${image.id}"></p>`,baseUpdated:'1',revision:1,state:'dirty'});
    assert.equal(submitted.assets[0].id,image.id);assert.equal(submitted.target.document,otherTarget.document);
    assert.match((editorCapabilities('images') as any).images.new,/dialogue image attachment can qualify/);
  }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});
