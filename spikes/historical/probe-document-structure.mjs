import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {LosslessHtml} from '../packages/core/lossless-html.ts';
const root='C:/Users/Lenovo/Documents/Codex/2026-08-26/https-polarion-pufafen-com-polarion-project/outputs/polarion-mcp-server';
const {PolarionSoapClient,escapeXml}=await import(pathToFileURL(path.join(root,'dist/soap.js')));
const {loadConfig}=await import(pathToFileURL(path.join(root,'dist/config.js')));
const {XMLParser}=await import(pathToFileURL(path.join(root,'node_modules/fast-xml-parser/src/fxp.js')));
const config=JSON.parse(await fs.readFile('C:/Users/Lenovo/.claude.json','utf8')).mcpServers['polarion-mcp-server'];
process.env.POLARION_BASE_URL=config.env.POLARION_BASE_URL;
process.env.POLARION_PROJECT_ID='test01';
const writeMode=['write','extend','unicode'].includes(process.argv[2]);
process.env.POLARION_WRITES_ENABLED=writeMode?'true':'false';
process.env.POLARION_WRITE_PROJECT_IDS='test01';
const client=new PolarionSoapClient(loadConfig());
const out=path.resolve(import.meta.dirname,'../.research/s1');
const parse=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:false});
const unwrap=(xml,method)=>parse.parse(xml).Envelope.Body[method+'Response'][method+'Return'];
const read=async(operation,body)=>{if(!operation.startsWith('get'))throw Error('Read operations only');await client.authenticate();return unwrap(await client.request('TrackerWebService','http://ws.polarion.com/TrackerWebService-impl',operation,body),operation);};
const project=await client.getProject('test01');
if(!project.location?.startsWith('default:/Sandbox/test01/'))throw Error('Expected isolated Sandbox project location not confirmed');
const roles=await client.listLinkRoles('test01');
const types=await read('getAllEnumOptionsForId','<svc:projectId>test01</svc:projectId><svc:enumId>workitem-type</svc:enumId>');
const result={at:new Date().toISOString(),project:{id:project.id,name:project.name,location:project.location},roles,types,mode:'inspect',write_calls:0};
await fs.writeFile(path.join(out,'document-sandbox-inspection.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({project:result.project,role_count:roles.length,type_ids:types.map(t=>t.id),mode:writeMode?'isolated_write':'inspect'}));
if(!writeMode) {
  for(const file of (await fs.readdir(out)).filter(f=>/^document-write-[a-f0-9]{8}\.json$/.test(f))) {
    const ledger=JSON.parse(await fs.readFile(path.join(out,file),'utf8'));
    if(ledger.project_id!=='test01'||!/^Requirements\/Sidebar_S1_20261103_[a-f0-9]{8}$/.test(ledger.location))continue;
    const doc=await client.getDocument('test01',ledger.location);
    console.log(JSON.stringify({recovery_read:{ledger:file,id:doc.id,uri:doc.uri,title:doc.title,location:doc.location}}));
    ledger.recovered_document=doc;await fs.writeFile(path.join(out,file),JSON.stringify(ledger,null,2));
    const extensionPath=path.join(out,'document-extended-'+file.match(/[a-f0-9]{8}/)[0]+'.json');
    try{
      const extension=JSON.parse(await fs.readFile(extensionPath,'utf8'));
      if(extension.heading_id){
        const heading=await client.getWorkItem('test01',extension.heading_id);
        const children=await read('getModuleWorkItemUris','<svc:moduleURI>'+escapeXml(doc.uri)+'</svc:moduleURI><svc:parentWorkItemURI>'+escapeXml(heading.uri)+'</svc:parentWorkItemURI><svc:deep>false</svc:deep>');
        extension.heading_children=children;extension.checks.parent_child_query_verified=JSON.stringify(children).includes(ledger.created_items.find(i=>i.label==='A').result.item.uri);await fs.writeFile(extensionPath,JSON.stringify(extension,null,2));
        console.log(JSON.stringify({parent_child_query_verified:extension.checks.parent_child_query_verified}));
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
if(process.argv[2]==='write') {
  if(!types.some(t=>t.id==='softwarerequirement')||!roles.some(r=>r.id==='parent'))throw Error('Required project types not confirmed');
  const resume=process.argv[3];
  if(resume&&!/^[a-f0-9]{8}$/.test(resume))throw Error('Invalid isolated ledger id');
  const nonce=resume??randomUUID().slice(0,8);
  const name='Sidebar_S1_20261103_'+nonce;
  const location='Requirements/'+name;
  const title='[Sidebar S1 isolated test] '+nonce;
  const source='<h1>'+title+'</h1><p id="s1-prose">S1 isolated fixture. Not an engineering requirement.</p>';
  const file=path.join(out,'document-write-'+nonce+'.json');
  const ledger=resume?JSON.parse(await fs.readFile(file,'utf8')):{at:new Date().toISOString(),project_id:'test01',location,title,purpose:'approved S1 validation only',operations:[],created_items:[]};
  if(ledger.project_id!=='test01'||ledger.location!==location||ledger.title!==title)throw Error('Isolated ledger scope mismatch');
  if(ledger.created_items.length)throw Error('Probe has created items already; readback and an explicit continuation are required');
  const persist=()=>fs.writeFile(file,JSON.stringify(ledger,null,2));
  const action=async(operation,fn)=>{
    const entry={operation,started:new Date().toISOString(),status:'pending'};ledger.operations.push(entry);await persist();
    try{const response=await fn();entry.status='returned';await persist();return response;}catch(error){entry.status='failed_or_unknown';entry.error=error.message;await persist();throw error;}
  };
  const ownedUri=uri=>typeof uri==='string'&&uri.startsWith('subterra:data-service:objects:/default/test01${');
  const invoke=(operation,body)=>client.request('TrackerWebService','http://ws.polarion.com/TrackerWebService-impl',operation,body);
  const createBody='<svc:projectId>test01</svc:projectId><svc:location>Requirements</svc:location><svc:documentName>'+name+'</svc:documentName><svc:documentTitle>'+escapeXml(title)+'</svc:documentTitle><svc:allowedWITypes><trk:id>softwarerequirement</trk:id></svc:allowedWITypes><svc:structureLinkRole><trk:id>parent</trk:id></svc:structureLinkRole><svc:homePageContent>'+escapeXml(source)+'</svc:homePageContent>';
  const uri=resume?(await client.getDocument('test01',location)).uri:unwrap(await action('createDocument',()=>invoke('createDocument',createBody)),'createDocument');
  ledger.create_response=uri;await persist();
  if(uri!=='subterra:data-service:objects:/default/test01${Module}{moduleFolder}Requirements#'+name)throw Error('Created document URI outside isolated scope');
  ledger.document_uri=uri;await persist();
  const getDoc=()=>read('getModuleByUri','<svc:uri>'+escapeXml(uri)+'</svc:uri>');
  const initial=await getDoc();
  ledger.initial={id:initial.id,uri:initial['@_uri'],content:initial.homePageContent?.content};await persist();
  if(!initial.homePageContent?.content?.includes('S1 isolated fixture.'))throw Error('Created document content readback failed');
  for(const label of ['A','B']) {
    const item=await action('createWorkItemInModule '+label,()=>client.createWorkItem({projectId:'test01',documentLocation:location,type:'softwarerequirement',title:'[Sidebar S1 '+nonce+'] fixture '+label,description:'<p>S1 temporary sample '+label+'</p>'}));
    const itemUri=item.work_item?.uri??item.item?.uri??item.uri;
    ledger.created_items.push({label,result:item});await persist();
  }
  const withItems=await getDoc();ledger.after_create=withItems.homePageContent?.content;await persist();
  const ids=[...ledger.after_create.matchAll(/params=id=([A-Za-z0-9_.-]+)/g)].map(m=>m[1]);
  if(ids.length<2)throw Error('Created work-item macros not found');
  const items=[];
  for(const id of ids){const item=await client.getWorkItem('test01',id);if(item.title?.startsWith('[Sidebar S1 '+nonce+']'))items.push(item);}
  if(items.length!==2||items.some(i=>!ownedUri(i.uri)))throw Error('Owned sample item identification failed');
  const b=items.find(i=>i.title.endsWith('fixture B'));
  const moveBody='<svc:workItemURI>'+escapeXml(b.uri)+'</svc:workItemURI><svc:documentURI>'+escapeXml(uri)+'</svc:documentURI><svc:parentWorkItemURI xsi:nil="true"/><svc:position>0</svc:position><svc:retainDocumentFlow>false</svc:retainDocumentFlow>';
  await action('moveWorkItemToDocument B first',()=>invoke('moveWorkItemToDocument',moveBody));
  const reordered=await getDoc();ledger.after_reorder=reordered.homePageContent?.content;
  ledger.reorder_verified=ledger.after_reorder.indexOf('params=id='+b.id)<ledger.after_reorder.indexOf('params=id='+items.find(i=>i.id!==b.id).id);await persist();
  if(!ledger.reorder_verified)throw Error('Reorder not reflected in document flow');
  const updated=ledger.after_reorder.replace('S1 isolated fixture.','S1 interstitial prose updated.');
  if(updated===ledger.after_reorder)throw Error('Interstitial source marker missing');
  const updateBody='<svc:module uri="'+escapeXml(uri)+'"><trk:homePageContent><typ:type>text/html</typ:type><typ:content>'+escapeXml(updated)+'</typ:content><typ:contentLossy>false</typ:contentLossy></trk:homePageContent></svc:module>';
  await action('updateModule interstitial prose',()=>invoke('updateModule',updateBody));
  const final=await getDoc();ledger.after_update=final.homePageContent?.content;
  ledger.prose_verified=ledger.after_update.includes('S1 interstitial prose updated.');
  ledger.item_ids_preserved=items.every(i=>ledger.after_update.includes('params=id='+i.id));
  ledger.status=ledger.prose_verified&&ledger.item_ids_preserved?'basic_structure_roundtrip_pass':'readback_mismatch';await persist();
  console.log(JSON.stringify({status:ledger.status,location,document_uri:uri,items:items.map(i=>i.id),reorder_verified:ledger.reorder_verified,prose_verified:ledger.prose_verified,item_ids_preserved:ledger.item_ids_preserved,ledger:file}));
}
if(process.argv[2]==='extend') {
  const nonce=process.argv[3];if(!/^[a-f0-9]{8}$/.test(nonce??''))throw Error('Isolated ledger id required');
  const ledger=JSON.parse(await fs.readFile(path.join(out,'document-write-'+nonce+'.json'),'utf8'));
  const location='Requirements/Sidebar_S1_20261103_'+nonce;
  if(ledger.status!=='basic_structure_roundtrip_pass'||ledger.project_id!=='test01'||ledger.location!==location)throw Error('Validated isolated document required');
  const uri=ledger.document_uri;
  const itemA=ledger.created_items.find(x=>x.label==='A').result.item;
  const itemB=ledger.created_items.find(x=>x.label==='B').result.item;
  for(const target of [itemA,itemB]){const current=await client.getWorkItem('test01',target.id);if(current.title!=='[Sidebar S1 '+nonce+'] fixture '+(target===itemA?'A':'B')||current.uri!==target.uri)throw Error('Owned test item changed');}
  const file=path.join(out,'document-extended-'+nonce+'.json');
  try{await fs.access(file);throw Error('Extension probe already attempted; inspect its journal before repeating');}catch(error){if(error.code!=='ENOENT')throw error;}
  const evidence={at:new Date().toISOString(),project_id:'test01',document_uri:uri,operations:[],checks:{}};
  const persist=()=>fs.writeFile(file,JSON.stringify(evidence,null,2));
  const action=async(name,fn)=>{const entry={name,status:'pending',at:new Date().toISOString()};evidence.operations.push(entry);await persist();try{const result=await fn();entry.status='returned';entry.result=result;await persist();return result;}catch(error){entry.status='failed_or_unknown';entry.error=error.message;await persist();throw error;}};
  const invoke=(operation,body)=>client.request('TrackerWebService','http://ws.polarion.com/TrackerWebService-impl',operation,body);
  const getDoc=()=>read('getModuleByUri','<svc:uri>'+escapeXml(uri)+'</svc:uri>');
  const saveDoc=async(html)=>{const result=await invoke('updateModule','<svc:module uri="'+escapeXml(uri)+'"><trk:homePageContent><typ:type>text/html</typ:type><typ:content>'+escapeXml(html)+'</typ:content><typ:contentLossy>false</typ:contentLossy></trk:homePageContent></svc:module>');return {returned:true};};
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBXsAAAAASUVORK5CYII=','base64');
  const filename='sidebar-s1-'+nonce+'.png';
  const attachment=await action('attach owned fixture image',()=>client.manageAttachment({projectId:'test01',workItemId:itemA.id,operation:'create',fileName:filename,title:'Sidebar S1 pixel fixture',dataBase64:bytes.toString('base64')}));
  if(!attachment.verified)throw Error('Attachment metadata readback failed');
  const downloaded=await client.getAttachmentContent(itemA.uri,attachment.attachment_id);
  evidence.checks.attachment_bytes_equal=downloaded.equals(bytes);
  evidence.attachment_sha256=createHash('sha256').update(downloaded).digest('hex');await persist();
  const fixture='<table id="polarion_wiki macro name=table;params=width=100%|uid=731" class="polarion-Document-table" style="border-collapse:collapse;width:100%"><tbody><tr><td rowspan="2" style="width:50%;color:#173a40">S1 中文 &amp; entity&nbsp;🚙</td><td><strong>25 °C</strong><table><tbody><tr><td>nested fixture</td></tr></tbody></table></td></tr><tr><td colspan="1">second row</td></tr></tbody></table><img src="attachment:'+filename+'" style="max-width:650px"/><div id="polarion_wiki macro name=s1-preserve;params=key=value">opaque fixture</div>';
  const before=await client.getWorkItem('test01',itemA.id);
  const update=await action('rich content save',()=>client.updateWorkItem({projectId:'test01',workItemId:itemA.id,description:fixture,expectedUpdated:before.updated}));
  const returned=update.item.description;evidence.fixture_input=fixture;evidence.fixture_returned=returned;
  evidence.checks.rich_content_exact=returned===fixture;
  const indexed=new LosslessHtml(returned);
  evidence.checks.table_count=indexed.nodes.filter(n=>n.tag==='table').length;
  evidence.checks.macro_identity_preserved=returned.includes('uid=731')&&returned.includes('name=s1-preserve');
  evidence.checks.attachment_reference_preserved=returned.includes('attachment:'+filename);
  evidence.checks.merged_cell_preserved=/rowspan="2"/.test(returned);await persist();
  const actions=await client.listWorkItemWorkflowActions('test01',itemA.id);
  const review=actions.available.find(a=>a.native_action_id==='review');
  if(review){const transition=await action('explicit test Review workflow action',()=>client.performWorkItemWorkflowAction({projectId:'test01',workItemId:itemA.id,actionId:review.action_id,expectedUpdated:actions.updated}));evidence.checks.workflow_action_verified=transition.verified;await persist();}
  else{evidence.checks.workflow_action_verified=false;evidence.workflow_available=actions.available;await persist();}
  const heading=await action('create isolated heading',()=>client.createWorkItem({projectId:'test01',documentLocation:location,type:'heading',title:'[Sidebar S1 '+nonce+'] chapter'}));
  if(!heading.item?.uri||heading.item.title!=='[Sidebar S1 '+nonce+'] chapter')throw Error('Heading identity not verified');
  evidence.heading_id=heading.item.id;await persist();
  await action('place A under heading',async()=>{await invoke('moveWorkItemToDocument','<svc:workItemURI>'+escapeXml(itemA.uri)+'</svc:workItemURI><svc:documentURI>'+escapeXml(uri)+'</svc:documentURI><svc:parentWorkItemURI>'+escapeXml(heading.item.uri)+'</svc:parentWorkItemURI><svc:position>0</svc:position><svc:retainDocumentFlow>false</svc:retainDocumentFlow>');return{target:itemA.id,parent:heading.item.id};});
  const afterHierarchy=await getDoc();evidence.after_hierarchy=afterHierarchy.homePageContent.content;
  const parented=await client.getWorkItem('test01',itemA.id);
  evidence.checks.heading_present=evidence.after_hierarchy.includes('params=id='+heading.item.id);
  evidence.parent_links=parented.linked_work_items;
  const docDraft=new LosslessHtml(evidence.after_hierarchy);
  const node=docDraft.nodes.find(n=>n.polarionId?.includes('params=id='+itemB.id));
  if(!node)throw Error('Owned B document macro missing');
  const withoutB=docDraft.source.slice(0,node.start)+docDraft.source.slice(node.end);
  await action('remove B macro from document (keep work item)',()=>saveDoc(withoutB));
  const afterRemoval=await getDoc();const retained=await client.getWorkItem('test01',itemB.id);
  evidence.checks.removed_from_document_flow=!afterRemoval.homePageContent.content.includes('params=id='+itemB.id);
  evidence.checks.removed_item_still_exists=retained.id===itemB.id&&!retained.unresolvable;
  evidence.after_remove=afterRemoval.homePageContent.content;
  await action('restore B macro in isolated document',()=>saveDoc(evidence.after_hierarchy));
  const restored=await getDoc();evidence.checks.restore_document_flow=restored.homePageContent.content.includes('params=id='+itemB.id);
  evidence.status='completed';await persist();console.log(JSON.stringify({status:evidence.status,checks:evidence.checks,ledger:file}));
}
if(process.argv[2]==='unicode') {
  const nonce=process.argv[3];if(!/^[a-f0-9]{8}$/.test(nonce??''))throw Error('Isolated ledger id required');
  const ledger=JSON.parse(await fs.readFile(path.join(out,'document-write-'+nonce+'.json'),'utf8'));
  if(ledger.project_id!=='test01')throw Error('Sandbox scope required');
  const id=ledger.created_items.find(x=>x.label==='B').result.item.id;
  const current=await client.getWorkItem('test01',id);
  if(current.title!=='[Sidebar S1 '+nonce+'] fixture B')throw Error('Owned fixture required');
  const file=path.join(out,'unicode-roundtrip.json');
  const evidence={at:new Date().toISOString(),project_id:'test01',work_item_id:id,before:current.description,status:'pending'};
  await fs.writeFile(file,JSON.stringify(evidence,null,2));
  const input='<p>Emoji entity: &#x1F699; | Math entity: &#x1D6FC; | 中文</p>';
  const updated=await client.updateWorkItem({projectId:'test01',workItemId:id,description:input,expectedUpdated:current.updated});
  evidence.input=input;evidence.returned=updated.item.description;evidence.exact=updated.item.description===input;
  await fs.writeFile(file,JSON.stringify(evidence,null,2));
  const restored=await client.updateWorkItem({projectId:'test01',workItemId:id,description:current.description,expectedUpdated:updated.item.updated});
  evidence.restored=restored.item.description===current.description;evidence.status='completed';await fs.writeFile(file,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
