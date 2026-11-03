import type { Asset, Target } from '../../../packages/protocol/index';
import { rpc } from './client';
const CHUNK = 384 * 1024;
function base64(bytes: Uint8Array) { let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s); }
export async function uploadAsset(file: File, target: Target, progress?: (percent: number) => void): Promise<Asset> {
  if (!file.size || file.size > 25*1024*1024) throw Error('单个附件需为 1 字节至 25 MB。');
  const a = await rpc<Asset>({method:'assets.begin',target,name:file.name || `clipboard-${Date.now()}.png`,mime:file.type || 'application/octet-stream',size:file.size});
  for(let offset=0;offset<file.size;offset+=CHUNK){const bytes=new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer());await rpc({method:'assets.chunk',assetId:a.id,offset,data:base64(bytes)});progress?.(Math.min(100,Math.round((offset+bytes.length)/file.size*100)));}
  return rpc<Asset>({method:'assets.finish',assetId:a.id});
}
export async function assetBlob(asset: Asset) {
  const chunks: BlobPart[]=[];
  for(let offset=0;offset<asset.size;offset+=CHUNK){const part=await rpc<{data:string}>({method:'assets.read',assetId:asset.id,offset,length:CHUNK});const raw=atob(part.data);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);chunks.push(bytes);}
  return new Blob(chunks,{type:asset.mime});
}
export const readableSize = (bytes: number) => bytes>=1024*1024 ? `${(bytes/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB`;
