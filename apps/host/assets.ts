import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { Store } from './store.ts';
import { DATA } from './paths.ts';
import type { Asset, Target } from '../../packages/protocol/index.ts';
const MAX = 25 * 1024 * 1024;
const array = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];
function xmlText(value: any): string {
  if (value == null) return ''; if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join(' ');
  if (value['#text'] != null) return String(value['#text']);
  return Object.entries(value).filter(([k]) => !k.startsWith('@_')).map(([,v]) => xmlText(v)).join(' ');
}
export function extractDocument(bytes: Buffer, name: string): { text?: string; extraction: Asset['extraction']; truncated?: boolean } {
  const ext = path.extname(name).toLowerCase();
  if (['.txt','.md','.csv','.tsv','.json','.xml','.yaml','.yml','.log','.c','.h','.py','.m'].includes(ext)) {
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '');
    return { text: text.slice(0, 200000), extraction: 'text', truncated: text.length > 200000 };
  }
  if (!['.docx','.xlsx','.pptx'].includes(ext)) return { extraction: 'native-file' };
  let expanded = 0; let skipped = false;
  const entries = unzipSync(bytes, { filter: e => {
    if (!/^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|ppt\/notesSlides\/notesSlide\d+\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(e.name)) return false;
    if (e.originalSize > 8_000_000 || expanded + e.originalSize > 24_000_000) { skipped = true; return false; } expanded += e.originalSize; return true;
  } });
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
  let text = '';
  if (ext === '.xlsx') {
    const strings = entries['xl/sharedStrings.xml'] ? array(parser.parse(strFromU8(entries['xl/sharedStrings.xml']!)).sst?.si).map(xmlText) : [];
    for (const [key, data] of Object.entries(entries).filter(([k]) => k.startsWith('xl/worksheets/')).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))) {
      const sheet = parser.parse(strFromU8(data)); text += `\n[${key}]\n`;
      for (const row of array(sheet.worksheet?.sheetData?.row)) text += array(row.c).map(cell => `${cell['@_r'] ?? ''}: ${cell['@_t'] === 's' ? strings[Number(cell.v)] ?? '' : cell['@_t'] === 'inlineStr' ? xmlText(cell.is) : xmlText(cell.v)}`).join('\t') + '\n';
    }
  } else {
    for (const [key, data] of Object.entries(entries).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))) {
      const parsed = new XMLParser({ ignoreAttributes:false,removeNSPrefix:true,preserveOrder:true,parseTagValue:false }).parse(strFromU8(data)); text += `\n[${key}]\n`;
      const walk = (v: any, key = '') => { if (v == null) return; if (Array.isArray(v)) return v.forEach(x=>walk(x,key)); if (key === 't') { text += xmlText(v); return; } if (typeof v === 'object') for (const [k, child] of Object.entries(v)) if (!k.startsWith('@_')) { walk(child,k); if (['p','tr'].includes(k)) text += '\n'; if (k==='tc') text+='\t'; } };
      walk(parsed);
    }
  }
  return { text: text.slice(0,200000), extraction: text.trim() ? 'text' : 'native-file', truncated: skipped || text.length > 200000 };
}
export class Assets {
  store: Store; root: string;
  constructor(store: Store, root = path.join(DATA, 'assets')) { this.store = store; this.root = root; }
  private file(id: string) { return path.join(this.root, id + '.bin'); }
  begin(target: Target, name: string, mime: string, size: number) {
    if (size < 1 || size > MAX) throw Error('FILE_SIZE_LIMIT_25_MB');
    const asset: Asset = { id: crypto.randomUUID(), target, name: path.basename(name).slice(0,240), mime, size, received: 0, state: 'uploading', extraction: 'native-file', createdAt: Date.now() };
    fs.mkdirSync(this.root,{recursive:true}); fs.writeFileSync(this.file(asset.id),'',{flag:'wx'}); this.store.put('asset',asset.id,asset); return asset;
  }
  chunk(id: string, offset: number, base64: string) {
    const asset = this.store.require<Asset>('asset',id); if (asset.state !== 'uploading') throw Error('ASSET_ALREADY_COMPLETE');
    const bytes = Buffer.from(base64,'base64'); if (bytes.length > 512 * 1024 || bytes.length + offset > asset.size) throw Error('ASSET_CHUNK_LIMIT');
    if (offset < asset.received && offset + bytes.length <= asset.received) { const actual=Buffer.alloc(bytes.length);const fd=fs.openSync(this.file(id),'r');try{fs.readSync(fd,actual,0,bytes.length,offset);}finally{fs.closeSync(fd);}if(actual.equals(bytes))return{received:asset.received}; }
    if (offset !== asset.received) throw Error('ASSET_OFFSET_MISMATCH');
    fs.appendFileSync(this.file(id),bytes);asset.received+=bytes.length;this.store.put('asset',id,asset);return{received:asset.received};
  }
  finish(id: string) {
    const asset = this.store.require<Asset>('asset',id); if (asset.received !== asset.size) throw Error('ASSET_INCOMPLETE');
    const bytes = fs.readFileSync(this.file(id)); asset.sha256 = createHash('sha256').update(bytes).digest('hex');
    const signature = bytes.subarray(0,12).toString('hex');
    asset.mime = signature.startsWith('89504e470d0a1a0a') ? 'image/png' : signature.startsWith('ffd8ff') ? 'image/jpeg' : bytes.subarray(0,6).toString().startsWith('GIF8') ? 'image/gif' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : bytes.subarray(0,5).toString() === '%PDF-' ? 'application/pdf' : asset.mime.startsWith('image/') ? 'application/octet-stream' : asset.mime;
    asset.state = 'ready';
    try { const extracted = asset.mime.startsWith('image/') ? { extraction: 'image' as const } : extractDocument(bytes,asset.name); Object.assign(asset,extracted); } catch { asset.extraction='failed'; }
    this.store.put('asset',id,asset); return this.metadata(asset);
  }
  metadata(asset: Asset) { const { text, ...metadata } = asset; return { ...metadata, textLength:text?.length??0 }; }
  require(id: string, target?: Target) { const a=this.store.require<Asset>('asset',id);if(a.state!=='ready')throw Error('ASSET_NOT_READY');if(target&&(a.target.origin!==target.origin||a.target.projectId!==target.projectId))throw Error('ASSET_PROJECT_MISMATCH');return a; }
  read(id: string, offset: number, length: number) { const a=this.require(id); const size=Math.max(0,Math.min(length,a.size-offset));const bytes=Buffer.alloc(size);const fd=fs.openSync(this.file(id),'r');try{fs.readSync(fd,bytes,0,size,offset);}finally{fs.closeSync(fd);}return{data:bytes.toString('base64'),size:a.size,mime:a.mime}; }
  bytes(id: string) { this.require(id); return fs.readFileSync(this.file(id)); }
  materialize(id: string, workspace: string, target: Target) { const a=this.require(id,target);const folder=path.join(workspace,'attachments');fs.mkdirSync(folder,{recursive:true});const ext=path.extname(a.name).replace(/[^.a-zA-Z0-9]/g,'').slice(0,12);const file=path.join(folder,a.id+ext);if(!fs.existsSync(file))fs.copyFileSync(this.file(id),file);return file; }
}
