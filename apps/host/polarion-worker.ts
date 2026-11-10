// This process alone receives the existing DPAPI credentials. Never forward its environment to an AI engine.
import { PolarionSoapClient, escapeXml } from '../../packages/polarion-soap/soap.js';
import { loadConfig } from '../../packages/polarion-soap/config.js';
import { TargetSchema } from '../../packages/protocol/index.ts';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import {BoardManifestSchema,boardFileNames} from '../../packages/core/board-contract.ts';
import {authorizeWorkItemScope,workItemIdFromUri} from './variant-access.ts';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
process.env.POLARION_BASE_URL = 'https://polarion.pufafen.com/polarion';
// 变更记录附件可能较大；SOAP HTTP 超时默认 30s 容易在写入时被截断。
process.env.POLARION_TIMEOUT_MS ??= '120000';
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
    if (request.method === 'bulkRead') {
      try {
        // 一次取回整篇文档的正文与元数据，作为「设定基准 / 结束比对」的快照。
        // 个别 Polarion 版本不接受 created/updated 字段，按可用字段集逐级降级。
        const attempts = [
          ['id', 'title', 'type', 'status', 'outlineNumber', 'description', 'created', 'updated'],
          ['id', 'title', 'type', 'status', 'outlineNumber', 'description', 'updated'],
          ['id', 'title', 'type', 'status', 'outlineNumber', 'description'],
        ];
        let result: Awaited<ReturnType<typeof client.getDocumentWorkItems>> | undefined;
        for (const fields of attempts) {
          try { result = await client.getDocumentWorkItems(target.projectId, target.document, fields); break; }
          catch { /* 尝试下一组字段 */ }
        }
        if (!result) throw Error('CHANGE_SNAPSHOT_FAILED');
        reply(request.id, {
          documentTitle: result.document.title ?? '',
          items: result.items.flatMap(item => item.id ? [{
            id: item.id, title: item.title ?? '', type: item.type ?? '', status: item.status ?? '',
            outline: item.outline_number ?? '', created: item.created ?? '', updated: item.updated ?? '', html: item.description ?? '',
          }] : []),
        });
      } catch { throw Error('CHANGE_SNAPSHOT_FAILED'); }
      continue;
    }
    if (request.method === 'history') {
      try {
        const changes = await client.getWorkItemHistory(target.projectId, String(request.workItemId));
        reply(request.id, changes.map(change => ({
          revision: change.revision ?? '', date: change.date ?? '', user: change.user,
          diffs: change.diffs.map(diff => ({field: diff.field_name ?? '', before: diff.before, after: diff.after})),
        })));
      } catch { throw Error('CHANGE_HISTORY_FAILED'); }
      continue;
    }
    if (request.method === 'historyRaw') {
      // 诊断用：确认 Polarion 21 R2 的 generateHistory XML 结构后，再修正字段级解析。
      try {
        const current = await client.getWorkItem(target.projectId, String(request.workItemId));
        if (!current.uri) throw Error('CHANGE_RECORD_NOT_FOUND');
        const rawRequest = (client as unknown as {request: (service: string, namespace: string, operation: string, body: string) => Promise<string>}).request.bind(client);
        const xml = await rawRequest('TrackerWebService', 'http://ws.polarion.com/TrackerWebService-impl', 'generateHistory',
          `<svc:workitemURI>${escapeXml(current.uri)}</svc:workitemURI>`);
        reply(request.id, {xml: xml.slice(0, 400000)});
      } catch { throw Error('CHANGE_HISTORY_FAILED'); }
      continue;
    }
    if (request.method === 'change.list') {
      try {
        // 变更记录是项目级工作项，标题带固定英文标记；查询结果天然按项目隔离。
        // attachments 不是所有版本都支持；失败时降级，列表仍可显示（记录详情再按需读取）。
        const attempts = [
          ['id', 'title', 'description', 'created', 'updated', 'author', 'type', 'status', 'attachments'],
          ['id', 'title', 'description', 'created', 'updated', 'author', 'type', 'status'],
          ['id', 'title', 'description', 'created', 'updated'],
        ];
        let rows: Awaited<ReturnType<typeof client.queryWorkItems>> | undefined;
        for (const fields of attempts) {
          try { rows = await client.queryWorkItems(target.projectId, 'title:PSB-CHANGE*', 'created DESC', fields, Math.min(200, Math.max(1, Number(request.limit) || 100))); break; }
          catch { /* 尝试下一组字段 */ }
        }
        if (!rows) throw Error('CHANGE_RECORD_LIST_FAILED');
        reply(request.id, rows.map(item => ({
          workItemId: item.id, title: item.title ?? '', description: item.description ?? '',
          created: item.created ?? '', updated: item.updated ?? '', author: item.author, type: item.type ?? '', status: item.status ?? '',
          attachments: (item.attachments ?? []).map(attachment => ({id: attachment.id, file_name: attachment.file_name, title: attachment.title})),
        })));
      } catch { throw Error('CHANGE_RECORD_LIST_FAILED'); }
      continue;
    }
    if (request.method === 'change.listRaw') {
      // 诊断用：逐组验证 query/字段集，定位 Polarion 版本差异。
      try {
        const attempts = [
          {query: 'title:PSB-CHANGE*', fields: ['id', 'title']},
          {query: 'title:PSB-CHANGE*', fields: ['id', 'title']},
          {query: 'id:*', fields: ['id', 'title'], limit: 3},
          {query: 'title:PSB-CHANGE*', fields: ['id', 'title', 'description']},
          {query: 'title:PSB-CHANGE*', fields: ['id', 'title', 'description', 'created', 'updated']},
          {query: 'title:PSB-CHANGE*', fields: ['id', 'title', 'description', 'created', 'updated', 'author', 'type', 'status']},
        ];
        const results = [];
        for (const attempt of attempts) {
          try {
            const rows = await client.queryWorkItems(target.projectId, attempt.query, 'created DESC', attempt.fields, attempt.limit ?? 20);
            results.push({...attempt, ok: true, count: rows.length});
          } catch (error) {
            results.push({...attempt, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 400)});
          }
        }
        reply(request.id, results);
      } catch (error) {
        reply(request.id, {fatal: (error instanceof Error ? error.message : String(error)).slice(0, 1200)});
      }
      continue;
    }
    if (request.method === 'change.read') {
      try {
        const current = await client.getWorkItem(target.projectId, String(request.workItemId));
        if (!current.uri) throw Error('CHANGE_RECORD_NOT_FOUND');
        const fileName = String(request.fileName);
        const attachment = current.attachments.find(a => a.file_name === fileName);
        if (!attachment?.id) throw Error('CHANGE_RECORD_NOT_FOUND');
        const bytes = await client.getAttachmentContent(current.uri, attachment.id);
        reply(request.id, {workItemId: current.id, attachmentId: attachment.id, dataBase64: bytes.toString('base64'), updated: current.updated ?? ''});
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        throw Error(message === 'CHANGE_RECORD_NOT_FOUND' ? message : 'CHANGE_RECORD_READ_FAILED');
      }
      continue;
    }
    if (request.method === 'change.write') {
      try {
        const projectId = target.projectId;
        const description = String(request.description ?? '');
        const title = String(request.title ?? '');
        const fileName = String(request.fileName ?? '');
        if (!/^sidebar-change-[0-9a-f-]{36}\.(record|session)\.json$/.test(fileName)) throw Error('INVALID_CHANGE_ATTACHMENT');
        const dataBase64 = String(request.dataBase64 ?? '');
        let workItemId = typeof request.workItemId === 'string' ? request.workItemId : '';
        let currentUri = '', currentUpdated = '';
        let createdHere = false;
        if (workItemId) {
          const current = await client.getWorkItem(projectId, workItemId);
          if (!current.uri) throw Error('CHANGE_RECORD_NOT_FOUND');
          if (request.expectedUpdated && current.updated !== request.expectedUpdated) throw Error('CHANGE_RECORD_CONFLICT');
          currentUri = current.uri; currentUpdated = current.updated ?? '';
          try { await client.updateWorkItem({projectId, workItemId, title, description, expectedUpdated: current.updated}); }
          catch { throw Error('CHANGE_RECORD_WRITE_FAILED'); }
        } else {
          // 项目级工作项：不写入任何需求文档，避免污染被跟踪的需求结构。
          let created: Awaited<ReturnType<typeof client.createWorkItem>>;
          try { created = await client.createWorkItem({projectId, type: String(request.type ?? 'task'), title, description}); }
          catch { throw Error('CHANGE_RECORD_CREATE_FAILED'); }
          // readback 失败时仍可从 URI 解析出工作项 ID，避免重试创建出重复记录。
          workItemId = created.item?.id ?? workItemIdFromUri(created.work_item_uri ?? '') ?? '';
          if (!workItemId) throw Error('CHANGE_RECORD_CREATE_FAILED');
          currentUri = created.item?.uri ?? created.work_item_uri ?? '';
          createdHere = true;
        }
        let attachmentId = '';
        if (dataBase64) {
          try {
            const existing = (await client.getWorkItem(projectId, workItemId)).attachments.find(a => a.file_name === fileName);
            const attachment = await client.manageAttachment({
              projectId, workItemId, operation: existing?.id ? 'update' : 'create',
              ...(existing?.id ? {attachmentId: existing.id} : {}),
              fileName, title: String(request.attachmentTitle ?? 'Polarion Sidebar 变更记录'), dataBase64,
            });
            if (!attachment.attachment?.id) throw Error('CHANGE_RECORD_ATTACHMENT_FAILED');
            const uri = attachment.item?.uri ?? currentUri;
            if (!uri) throw Error('CHANGE_RECORD_ATTACHMENT_FAILED');
            const readback = await client.getAttachmentContent(uri, attachment.attachment.id);
            if (digest(readback.toString('base64')) !== digest(dataBase64)) throw Error('CHANGE_RECORD_READBACK_MISMATCH');
            attachmentId = attachment.attachment.id;
          } catch (error) {
            // 新建工作项后附件写入失败会留下空记录；回滚这次新建，避免项目里出现无法打开的变更记录。
            if (createdHere) {
              try { await client.deleteWorkItem(projectId, workItemId); } catch { /* 保留原错误 */ }
            }
            throw error;
          }
        }
        // 记录写成功后再清理会话基准附件，避免中途失败丢掉唯一基线。
        for (const name of (request.removeAttachments ?? []) as string[]) {
          const stale = (await client.getWorkItem(projectId, workItemId)).attachments.find(a => a.file_name === name);
          if (stale?.id) await client.manageAttachment({projectId, workItemId, operation: 'delete', attachmentId: stale.id});
        }
        const readbackItem = await client.getWorkItem(projectId, workItemId);
        reply(request.id, {workItemId, updated: readbackItem.updated ?? currentUpdated, attachmentId, uri: currentUri});
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const known = /^(CHANGE_RECORD_CONFLICT|CHANGE_RECORD_NOT_FOUND|CHANGE_RECORD_CREATE_FAILED|CHANGE_RECORD_ATTACHMENT_FAILED|CHANGE_RECORD_READBACK_MISMATCH|INVALID_CHANGE_ATTACHMENT)$/.test(message);
        throw Error(known ? message : `CHANGE_RECORD_WRITE_FAILED: ${message.slice(0, 600)}`);
      }
      continue;
    }
    if (request.method === 'change.testWrite') {
      // 诊断用：隔离“工作项创建”和“附件写入”，验证文件名/标题/类型哪个触发 Polarion 事务回滚。
      const projectId = target.projectId;
      const type = String(request.type ?? 'softwarerequirement');
      const results: any[] = [];
      const run = async (label: string, fileName: string, title: string, dataBase64: string) => {
        let workItemId = '';
        try {
          const created = await client.createWorkItem({projectId, type, title: `PSB-TEST ${label} ${Date.now()}`, description: '<p>test</p>'});
          workItemId = created.item?.id ?? workItemIdFromUri(created.work_item_uri ?? '') ?? '';
          if (!workItemId) throw Error('NO_ID');
          const attachment = await client.manageAttachment({projectId, workItemId, operation: 'create', fileName, title, dataBase64});
          results.push({label, workItemId, ok: Boolean(attachment.attachment?.id), type: created.item?.type, fileName, title});
        } catch (error) {
          results.push({label, workItemId, ok: false, type, fileName, title, error: (error instanceof Error ? error.message : String(error)).slice(0, 500)});
        } finally {
          if (workItemId) { try { await client.deleteWorkItem(projectId, workItemId); } catch { /* 清理失败不影响诊断 */ } }
        }
      };
      await run('cn-gz', `sidebar-change-${crypto.randomUUID()}.record.json`, 'Polarion Sidebar 变更记录', Buffer.from('hello').toString('base64'));
      await run('ascii-json', 'sidebar-variant.json', 'Sidebar variant details', Buffer.from('{"a":1}').toString('base64'));
      await run('cn-json', `sidebar-change-${crypto.randomUUID()}.record.json`, 'Polarion Sidebar 变更记录', Buffer.from('{"a":1}').toString('base64'));
      await run('ascii-gz', `sidebar-change-${crypto.randomUUID()}.record.json`, 'Polarion Sidebar change record', Buffer.from('hello').toString('base64'));
      reply(request.id, results);
      continue;
    }
    if (request.method === 'change.delete') {
      try {
        const result = await client.deleteWorkItem(target.projectId, String(request.workItemId), request.expectedUpdated ? String(request.expectedUpdated) : undefined);
        reply(request.id, {deleted: result.verified !== false});
      } catch { throw Error('CHANGE_RECORD_DELETE_FAILED'); }
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
    const codeName = message.split(':', 1)[0];
    const known = /^(WORK_ITEM_DOCUMENT_MISMATCH|VARIANT_LINK_REQUIRED|VARIANT_LINK_FAILED|WORK_ITEM_CREATE_FAILED|WORK_ITEM_CREATE_UNVERIFIED|REMOTE_CONFLICT|UNKNOWN_OPERATION|INVALID_ASSET|INVALID_METADATA_NAME|ATTACHMENT_READBACK_MISMATCH|BOARD_SOURCE_MISSING|BOARD_MANIFEST_MISMATCH|CHANGE_SNAPSHOT_FAILED|CHANGE_HISTORY_FAILED|CHANGE_RECORD_LIST_FAILED|CHANGE_RECORD_READ_FAILED|CHANGE_RECORD_NOT_FOUND|CHANGE_RECORD_CONFLICT|CHANGE_RECORD_CREATE_FAILED|CHANGE_RECORD_ATTACHMENT_FAILED|CHANGE_RECORD_READBACK_MISMATCH|CHANGE_RECORD_WRITE_FAILED|CHANGE_RECORD_DELETE_FAILED|INVALID_CHANGE_ATTACHMENT)$/.test(codeName);
    // 未识别错误保留原始信息（截断）供 Host 诊断；已知错误只回稳定错误码或“码: 细节”。
    const code = known ? message : `POLARION_OPERATION_FAILED: ${message.slice(0, 600)}`;
    console.log(JSON.stringify({ id: request?.id, ok: false, error: code }));
  }
}
