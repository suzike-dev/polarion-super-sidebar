// This process alone receives the existing DPAPI credentials. Never forward its environment to an AI engine.
import { PolarionSoapClient } from '../../packages/polarion-soap/soap.js';
import { loadConfig } from '../../packages/polarion-soap/config.js';
import { TargetSchema } from '../../packages/protocol/index.ts';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import {BoardManifestSchema,boardFileNames} from '../../packages/core/board-contract.ts';
import {authorizeWorkItemScope,workItemIdFromUri} from './variant-access.ts';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
process.env.POLARION_BASE_URL = 'https://polarion.pufafen.com/polarion';
const client = new PolarionSoapClient(loadConfig());
const reply = (id: unknown, value: unknown) => console.log(JSON.stringify({id,ok:true,value}));
for await (const line of readline.createInterface({ input: process.stdin })) {
  let request: any;
  try {
    request = JSON.parse(line);
    if (request.method === 'authenticate') {
      try { await client.authenticate(); reply(request.id,{connected:true}); }
      catch (error) { console.log(JSON.stringify({id:request.id,ok:false,error:error instanceof Error && /AuthenticationFailed/i.test(error.message)?'POLARION_AUTHENTICATION_FAILED':'POLARION_CONNECTION_FAILED'})); }
      continue;
    }
    if (request.method === 'roles') {
      const roles = await client.listLinkRoles(String(request.projectId));
      reply(request.id, roles.map(({id,name,hidden})=>({id,name,hidden:!!hidden})));
      continue;
    }
    if (request.method === 'search') {
      try {
        const rows = await client.queryWorkItems(String(request.projectId), String(request.query), String(request.sort ?? 'updated DESC'), ['id', 'title'], Math.min(20, Math.max(1, Number(request.limit) || 8)));
        reply(request.id, rows.map(row => ({ workItemId: String(row.id ?? ''), title: String(row.title ?? '') })).filter(row => row.workItemId));
      } catch { reply(request.id, []); }
      continue;
    }
    if (request.method === 'create') {
      const target = TargetSchema.parse(request.target);
      try {
        const result = await client.createWorkItem({ projectId: target.projectId, title: String(request.title), type: String(request.type) });
        if (!result.item?.id) throw Error('WORK_ITEM_CREATE_UNVERIFIED');
        reply(request.id,{item:result.item,verified:result.verified,verificationErrors:result.verification_errors??[]});
      } catch (error) {
        if (error instanceof Error && error.message === 'WORK_ITEM_CREATE_UNVERIFIED') throw error;
        throw Error('WORK_ITEM_CREATE_FAILED');
      }
      continue;
    }
    if (request.method === 'link' || request.method === 'unlink') {
      const target = TargetSchema.parse(request.target);
      try {
        const input = { projectId: target.projectId, sourceWorkItemId: String(request.sourceWorkItemId), targetWorkItemId: String(request.targetWorkItemId), role: String(request.role) };
        const result = request.method === 'link' ? await client.addWorkItemLink(input) : await client.removeWorkItemLink(input);
        reply(request.id,{verified:result.verified,serverReturned:result.server_returned});
      } catch { throw Error('VARIANT_LINK_FAILED'); }
      continue;
    }
    const target = TargetSchema.parse(request.target);
    if (request.method === 'outline') {
      try {
        // 字段集按需降级：个别 Polarion 版本不接受某些字段名，缺失字段不应让整份总览失败。
        // 顺序上先保 type（区分章节标题与需求）；outlineNumber 是分组和层级所必需，不能丢。
        const attempts = [['id', 'title', 'type', 'outlineNumber'], ['id', 'title', 'outlineNumber']];
        let result: Awaited<ReturnType<typeof client.getDocumentWorkItems>> | undefined;
        for (const fields of attempts) {
          try { result = await client.getDocumentWorkItems(target.projectId, target.document, fields); break; }
          catch { /* try next field set */ }
        }
        if (!result) throw Error('DOCUMENT_OUTLINE_FAILED');
        reply(request.id, {
          documentId: result.document.id ?? '',
          title: result.document.title ?? '',
          items: result.items.map(item => ({ id: item.id, title: item.title, status: item.status, type: item.type, outline: item.outline_number })).filter(item => item.id),
        });
      } catch { throw Error('DOCUMENT_OUTLINE_FAILED'); }
      continue;
    }
    if (request.method === 'backlinks') {
      const main = await client.getWorkItem(target.projectId, String(request.workItemId));
      const document = await client.getDocument(target.projectId, target.document);
      if (!document.uri || main.module_uri !== document.uri || !main.uri) throw Error('WORK_ITEM_DOCUMENT_MISMATCH');
      const links = await client.getBackLinkedWorkItems(main.uri);
      reply(request.id, links.slice(0,100).flatMap(link=>{const workItemId=workItemIdFromUri(link.work_item_uri);return workItemId?[{workItemId,role:link.role??''}]:[];}));
      continue;
    }
    const item = await client.getWorkItem(target.projectId, request.workItemId);
    const document = await client.getDocument(target.projectId, target.document);
    const scope = request.variant && typeof request.variant === 'object'
      ? { mainWorkItemId: String(request.variant.mainWorkItemId), role: String(request.variant.role) }
      : undefined;
    if (scope) {
      const main = await client.getWorkItem(target.projectId, scope.mainWorkItemId);
      const links = main.uri ? await client.getBackLinkedWorkItems(main.uri) : [];
      authorizeWorkItemScope({itemUri:item.uri,itemModuleUri:item.module_uri,documentUri:document.uri,mainModuleUri:main.module_uri,links,scope});
    } else if (!document.uri || item.module_uri !== document.uri) {
      throw Error('WORK_ITEM_DOCUMENT_MISMATCH');
    }
    if (request.method === 'read') {
      reply(request.id,item);
    } else if(request.method==='image'){
      const src=String(request.src);let attachment;
      if(src.startsWith('attachment:')){
        // LiveDoc 的附件图片写作 attachment:<文件名>；它可能在本工作项附件里，而不是模块附件。
        const raw=src.slice('attachment:'.length).split('?')[0];let name=raw;try{name=decodeURIComponent(raw);}catch{}
        if(!item.uri||!(item.description??'').includes(src))throw Error('INVALID_ASSET');
        attachment=item.attachments.find(a=>a.file_name===name);
      }else{
        const match=src.match(/^workitemimg:([^/?#]+)$/);if(!match||!item.uri||!(item.description??'').includes(src))throw Error('INVALID_ASSET');
        attachment=item.attachments.find(a=>a.id===match[1]);
      }
      if(!attachment?.id||!item.uri)throw Error('INVALID_ASSET');
      const bytes=await client.getAttachmentContent(item.uri,attachment.id);
      reply(request.id,{name:attachment.file_name??'image',data:bytes.toString('base64')});
    } else if(request.method==='board'){
      const match=String(request.src).match(/^workitemimg:([^/?#]+)$/);if(!match||!item.uri||!(item.description??'').includes(request.src))throw Error('INVALID_ASSET');
      const preview=item.attachments.find(a=>a.id===match[1]),snapshot=preview?.file_name?.match(/^sidebar-board-([0-9a-f-]{36})\.png$/)?.[1];if(!snapshot)throw Error('BOARD_SOURCE_MISSING');
      const names=boardFileNames(snapshot),manifestAttachment=item.attachments.find(a=>a.file_name===names.manifest),sourceAttachment=item.attachments.find(a=>a.file_name===names.source);if(!manifestAttachment?.id||!sourceAttachment?.id||!preview?.id)throw Error('BOARD_SOURCE_MISSING');
      const manifest=BoardManifestSchema.parse(JSON.parse((await client.getAttachmentContent(item.uri,manifestAttachment.id)).toString('utf8')));if(manifest.snapshotId!==snapshot||manifest.source.name!==names.source||manifest.preview.name!==names.preview)throw Error('BOARD_MANIFEST_MISMATCH');
      const source=await client.getAttachmentContent(item.uri,sourceAttachment.id),image=await client.getAttachmentContent(item.uri,preview.id);
      reply(request.id,{manifest,source:source.toString('base64'),preview:image.toString('base64')});
    } else if (request.method === 'metadata.read') {
      const name=String(request.name??'sidebar-variant.json');
      if(!/^sidebar-variant(-active)?\.json$/.test(name))throw Error('INVALID_METADATA_NAME');
      const attachment=item.attachments.find(a=>a.file_name===name);
      if(!attachment?.id||!item.uri){reply(request.id,{details:null});}
      else reply(request.id,{details:JSON.parse((await client.getAttachmentContent(item.uri,attachment.id)).toString('utf8'))});
    } else if (request.method === 'metadata.write') {
      const name=String(request.name??'sidebar-variant.json');
      if(!/^sidebar-variant(-active)?\.json$/.test(name))throw Error('INVALID_METADATA_NAME');
      const attachment=item.attachments.find(a=>a.file_name===name);
      const data=Buffer.from(JSON.stringify(request.details));
      const result=await client.manageAttachment({projectId:target.projectId,workItemId:request.workItemId,operation:attachment?.id?'update':'create',...(attachment?.id?{attachmentId:attachment.id}:{}),fileName:name,title:name==='sidebar-variant-active.json'?'Sidebar variant active state':'Sidebar variant details',dataBase64:data.toString('base64')});
      if(!result.verified||!result.attachment?.id)throw Error('ATTACHMENT_READBACK_MISMATCH');
      const uri=result.item?.uri??item.uri;if(!uri)throw Error('ATTACHMENT_READBACK_MISMATCH');
      const readback=await client.getAttachmentContent(uri,result.attachment.id);
      if(digest(readback.toString('utf8'))!==digest(data.toString('utf8')))throw Error('ATTACHMENT_READBACK_MISMATCH');
      reply(request.id,{verified:true,attachmentId:result.attachment.id,updated:result.item?.updated??''});
    } else if (request.method === 'rename') {
      const value = await client.updateWorkItem({ projectId: target.projectId, workItemId: request.workItemId, title: String(request.title), expectedUpdated: String(request.expectedUpdated ?? '') || undefined });
      reply(request.id,{item:value.item,verified:value.verified});
    } else if (request.method === 'save') {
      // Explicit saves use the verified document membership and optimistic revision
      // checks below for every project. AI tools can only modify the shared draft.
      if (!item.updated || item.updated !== request.expectedUpdated || digest(item.description ?? '') !== request.baseHash) throw Error('REMOTE_CONFLICT');
      let html=String(request.html);let current=item;const uploadedAssets=[];
      for(const asset of request.assets??[]){
        if(!/^[0-9a-f-]{36}$/i.test(asset.id))throw Error('INVALID_ASSET');
        const ext=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'} as Record<string,string>)[asset.mime];
        if(asset.fileName?!/^sidebar-board-[0-9a-f-]{36}\.(png|excalidraw\.json|manifest\.json)$/.test(asset.fileName):!ext)throw Error('INVALID_ASSET');
        const fileName=asset.fileName??`sidebar-${asset.id}.${ext}`;let attachment=current.attachments.find(a=>a.file_name===fileName);
        if(!attachment){const added=await client.manageAttachment({projectId:target.projectId,workItemId:request.workItemId,operation:'create',fileName,title:asset.name,dataBase64:asset.data});if(!added.verified||!added.attachment)throw Error('ATTACHMENT_READBACK_MISMATCH');attachment=added.attachment;current=added.item;}
        if(!current.uri||!attachment.id)throw Error('ATTACHMENT_READBACK_MISMATCH');
        const bytes=await client.getAttachmentContent(current.uri,attachment.id);if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('ATTACHMENT_READBACK_MISMATCH');
        if(asset.mime.startsWith('image/'))html=html.replaceAll('polarion-asset:'+asset.id,'workitemimg:'+attachment.id);const receipt={localId:asset.id,attachmentId:attachment.id,sha256:asset.sha256};uploadedAssets.push(receipt);console.log(JSON.stringify({id:request.id,progress:receipt}));
      }
      current=await client.getWorkItem(target.projectId,request.workItemId);
      if(digest(current.description??'')!==request.baseHash)throw Error('REMOTE_CONFLICT');
      const result = await client.updateWorkItem({ projectId: target.projectId, workItemId: request.workItemId, description: html, expectedUpdated: current.updated });
      reply(request.id,{...result.item,submittedHtml:html,uploadedAssets});
    } else throw Error('UNKNOWN_OPERATION');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(WORK_ITEM_DOCUMENT_MISMATCH|VARIANT_LINK_REQUIRED|VARIANT_LINK_FAILED|WORK_ITEM_CREATE_FAILED|WORK_ITEM_CREATE_UNVERIFIED|REMOTE_CONFLICT|UNKNOWN_OPERATION|INVALID_ASSET|INVALID_METADATA_NAME|ATTACHMENT_READBACK_MISMATCH|BOARD_SOURCE_MISSING|BOARD_MANIFEST_MISMATCH)$/.test(message) ? message : 'POLARION_OPERATION_FAILED';
    console.log(JSON.stringify({ id: request?.id, ok: false, error: code }));
  }
}
