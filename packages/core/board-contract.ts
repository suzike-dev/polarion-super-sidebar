import {z} from 'zod';
import {TargetSchema} from '../protocol/index.ts';
const file=z.object({name:z.string().regex(/^sidebar-board-[0-9a-f-]{36}\.(?:png|excalidraw\.json)$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(25*1024*1024)});
export const BoardManifestSchema=z.object({format:z.literal('polarion-sidebar-object'),version:z.literal(1),kind:z.literal('whiteboard'),editor:z.literal('excalidraw'),objectId:z.string().uuid(),snapshotId:z.string().uuid(),parentSnapshotId:z.string().uuid().optional(),title:z.string().min(1).max(160),target:TargetSchema,workItemId:z.string().min(1).max(100),createdAt:z.number(),source:file,preview:file});
export type BoardManifest=z.infer<typeof BoardManifestSchema>;
export function validateBoardSource(text:string){
  const source=JSON.parse(text);
  if(source?.type!=='excalidraw'||source.version!==2||!Array.isArray(source.elements)||source.elements.length>10000)throw Error('INVALID_BOARD_SOURCE');
  const ids=new Set<string>();for(const el of source.elements){if(!el||typeof el.id!=='string'||ids.has(el.id)||typeof el.type!=='string'||!Number.isFinite(el.x)||!Number.isFinite(el.y))throw Error('INVALID_BOARD_SOURCE');ids.add(el.id);}
  if(source.files&&(!source.files||typeof source.files!=='object'||Array.isArray(source.files)))throw Error('INVALID_BOARD_SOURCE');
  for(const f of Object.values(source.files??{}) as any[])if(typeof f?.dataURL!=='string'||!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(f.dataURL))throw Error('BOARD_IMAGE_IMPORT_REQUIRED');
  return source;
}
export function boardFileNames(snapshotId:string){z.string().uuid().parse(snapshotId);const base='sidebar-board-'+snapshotId;return{source:base+'.excalidraw.json',preview:base+'.png',manifest:base+'.manifest.json'};}
