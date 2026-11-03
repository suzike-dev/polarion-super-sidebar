import fs from 'node:fs';
import path from 'node:path';
import {Store} from '../apps/host/store.ts';
import {DATA,ROOT} from '../apps/host/paths.ts';
import {Polarion} from '../apps/host/polarion.ts';
import {hashBytes,type BoardRecord} from '../apps/host/boards.ts';
import type {Draft} from '../packages/protocol/index.ts';
const store=new Store(path.join(DATA,'state.sqlite')),remote=new Polarion();
try{const d=store.list<Draft>('draft').find(d=>d.workItemId==='TEST-729'&&d.target.projectId==='test01')!;if(!d||d.target.document!=='Requirements/Sidebar_S1_20261103_0a72944c')throw Error('TEST_SCOPE');const src=d.html.match(/src="(workitemimg:[^"]*sidebar-board-[^"]+)"/)?.[1];if(!src)throw Error('BOARD_NOT_IN_SAVED_BODY');
 const packet=await remote.call<any>({method:'board',target:d.target,workItemId:d.workItemId,src});const manifest=packet.manifest,source=Buffer.from(packet.source,'base64'),preview=Buffer.from(packet.preview,'base64'),scene=JSON.parse(source.toString('utf8'));
 const report={at:new Date().toISOString(),draftRevision:d.revision,draftState:d.state,snapshotId:manifest.snapshotId,objectId:manifest.objectId,sourceBytes:source.length,previewBytes:preview.length,sourceHashMatches:hashBytes(source)===manifest.source.sha256,previewHashMatches:hashBytes(preview)===manifest.preview.sha256,elements:scene.elements.map((e:any)=>({id:e.id,type:e.type,text:e.text,x:e.x,y:e.y,startBinding:e.startBinding,endBinding:e.endBinding,containerId:e.containerId})),receiptCount:store.list<any>('attachment-receipt').filter(r=>r.draftId===d.id).length};
 fs.writeFileSync(path.join(ROOT,'.research/s3/board-remote-'+manifest.snapshotId+'.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(ROOT,'.research/s3/board-remote-roundtrip.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{remote.child?.kill();store.close();}
