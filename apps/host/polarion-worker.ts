// This process alone receives the existing DPAPI credentials. Never forward its environment to an AI engine.
import { PolarionSoapClient } from '../../packages/polarion-soap/soap.js';
import { loadConfig } from '../../packages/polarion-soap/config.js';
import { TargetSchema } from '../../packages/protocol/index.ts';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import {BoardManifestSchema,boardFileNames} from '../../packages/core/board-contract.ts';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
process.env.POLARION_BASE_URL = 'https://polarion.pufafen.com/polarion';
const client = new PolarionSoapClient(loadConfig());
for await (const line of readline.createInterface({ input: process.stdin })) {
  let request: any;
  try {
    request = JSON.parse(line);
    const target = TargetSchema.parse(request.target);
    const item = await client.getWorkItem(target.projectId, request.workItemId);
    const document = await client.getDocument(target.projectId, target.document);
    if (!document.uri || item.module_uri !== document.uri) throw Error('WORK_ITEM_DOCUMENT_MISMATCH');
    if (request.method === 'read') {
      console.log(JSON.stringify({ id: request.id, ok: true, value: item }));
    } else if(request.method==='image'){
      const match=String(request.src).match(/^workitemimg:([^/?#]+)$/);if(!match||!item.uri||!(item.description??'').includes(request.src))throw Error('INVALID_ASSET');
      const attachment=item.attachments.find(a=>a.id===match[1]);if(!attachment)throw Error('INVALID_ASSET');const bytes=await client.getAttachmentContent(item.uri,attachment.id!);
      console.log(JSON.stringify({id:request.id,ok:true,value:{name:attachment.file_name??'image',data:bytes.toString('base64')}}));
    } else if(request.method==='board'){
      const match=String(request.src).match(/^workitemimg:([^/?#]+)$/);if(!match||!item.uri||!(item.description??'').includes(request.src))throw Error('INVALID_ASSET');
      const preview=item.attachments.find(a=>a.id===match[1]),snapshot=preview?.file_name?.match(/^sidebar-board-([0-9a-f-]{36})\.png$/)?.[1];if(!snapshot)throw Error('BOARD_SOURCE_MISSING');
      const names=boardFileNames(snapshot),manifestAttachment=item.attachments.find(a=>a.file_name===names.manifest),sourceAttachment=item.attachments.find(a=>a.file_name===names.source);if(!manifestAttachment?.id||!sourceAttachment?.id||!preview?.id)throw Error('BOARD_SOURCE_MISSING');
      const manifest=BoardManifestSchema.parse(JSON.parse((await client.getAttachmentContent(item.uri,manifestAttachment.id)).toString('utf8')));if(manifest.snapshotId!==snapshot||manifest.source.name!==names.source||manifest.preview.name!==names.preview)throw Error('BOARD_MANIFEST_MISMATCH');
      const source=await client.getAttachmentContent(item.uri,sourceAttachment.id),image=await client.getAttachmentContent(item.uri,preview.id);
      console.log(JSON.stringify({id:request.id,ok:true,value:{manifest,source:source.toString('base64'),preview:image.toString('base64')}}));
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
      console.log(JSON.stringify({ id: request.id, ok: true, value: {...result.item,submittedHtml:html,uploadedAssets} }));
    } else throw Error('UNKNOWN_OPERATION');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(WORK_ITEM_DOCUMENT_MISMATCH|DEVELOPMENT_WRITE_SCOPE|REMOTE_CONFLICT|UNKNOWN_OPERATION|INVALID_ASSET|ATTACHMENT_READBACK_MISMATCH|BOARD_SOURCE_MISSING|BOARD_MANIFEST_MISMATCH)$/.test(message) ? message : 'POLARION_OPERATION_FAILED';
    console.log(JSON.stringify({ id: request?.id, ok: false, error: code }));
  }
}
