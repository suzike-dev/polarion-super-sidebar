import type {LibraryItems} from '@excalidraw/excalidraw/types';
import {elementsBounds} from '../../../packages/core/board-templates.ts';

export const BOARD_LIBRARY_STORAGE_KEY='board-library:v1';
export const BOARD_LIBRARY_LOCK='polarion-board-library';
type LibraryState={schema:1;libraryItems:LibraryItems;installedBuiltinIds:string[]};
type Storage={get:(key:string)=>Promise<Record<string,unknown>>;set:(value:Record<string,unknown>)=>Promise<unknown>};
type Lock=<T>(task:()=>Promise<T>)=>Promise<T>;

function readState(value:unknown):LibraryState {
  if(value===undefined)return {schema:1,libraryItems:[],installedBuiltinIds:[]};
  if(!value||typeof value!=='object')throw Error('素材库数据无法读取，已保留原数据。');
  const state=value as LibraryState;
  if(state.schema!==1||!Array.isArray(state.libraryItems)||!Array.isArray(state.installedBuiltinIds)||state.installedBuiltinIds.some(id=>typeof id!=='string')||state.libraryItems.some(item=>!item||typeof item.id!=='string'||!Array.isArray(item.elements)))throw Error('素材库格式不兼容，已保留原数据。');
  return state;
}

/** Every frame saves a delta against its own last snapshot, inside one cross-tab lock.
 * Unseen items added by another board are preserved; explicit deletions stay deleted.
 * The installation ledger prevents deleted defaults reappearing after a restart.
 */
export class BoardLibraryStorage {
  private previous:LibraryItems=[];
  private loaded=false;
  private tail:Promise<void>=Promise.resolve();
  private storage:Storage;
  private lock:Lock;
  constructor(storage:Storage,lock:Lock){this.storage=storage;this.lock=lock;}
  get isReady(){return this.loaded;}
  async load(builtins:LibraryItems):Promise<LibraryItems> {
    const result=await this.lock(async()=>{
      const state=readState((await this.storage.get(BOARD_LIBRARY_STORAGE_KEY))[BOARD_LIBRARY_STORAGE_KEY]);
      const existing=new Set(state.libraryItems.map(item=>item.id)),installed=new Set(state.installedBuiltinIds);
      const additions=builtins.filter(item=>!installed.has(item.id)&&!existing.has(item.id));
      const merged=[...state.libraryItems,...additions];
      const upgraded=upgradeBuiltinShells(merged,builtins);
      const next={...state,libraryItems:upgraded.items,installedBuiltinIds:[...new Set([...installed,...builtins.map(item=>item.id)])]};
      if(additions.length||upgraded.upgraded||next.installedBuiltinIds.length!==state.installedBuiltinIds.length)await this.storage.set({[BOARD_LIBRARY_STORAGE_KEY]:next});
      return next.libraryItems;
    });
    this.previous=structuredClone(result);this.loaded=true;return result;
  }
  save(items:LibraryItems):Promise<void> {
    // A failed load must never turn an empty editor callback into storage deletion.
    if(!this.loaded)return Promise.resolve();
    const next=structuredClone(items);
    this.tail=this.tail.catch(()=>{}).then(()=>this.lock(async()=>{
      const beforeMap=new Map(this.previous.map(item=>[item.id,item])),nextMap=new Map(next.map(item=>[item.id,item]));
      const deleted=new Set(this.previous.filter(item=>!nextMap.has(item.id)).map(item=>item.id));
      const changed=next.filter(item=>JSON.stringify(item)!==JSON.stringify(beforeMap.get(item.id)));
      if(!deleted.size&&!changed.length)return;
      const state=readState((await this.storage.get(BOARD_LIBRARY_STORAGE_KEY))[BOARD_LIBRARY_STORAGE_KEY]);
      const current=new Map(state.libraryItems.filter(item=>!deleted.has(item.id)).map(item=>[item.id,item]));
      const added:LibraryItems[number][]=[];
      for(const item of changed){
        if(current.has(item.id))current.set(item.id,item);
        // A previous snapshot entry missing from storage was explicitly deleted by
        // another tab; a stale edit must not resurrect it. Only local additions
        // (never seen in this tab's previous snapshot) are new material.
        else if(!beforeMap.has(item.id))added.push(item);
      }
      await this.storage.set({[BOARD_LIBRARY_STORAGE_KEY]:{...state,libraryItems:[...added,...current.values()]}});
      this.previous=next;
    }));
    return this.tail;
  }
  flush(){return this.tail;}
}

/** Restore only missing originals. Never repaint or replace an existing saved item. */
export function supplementBoardLibrary(current:LibraryItems,builtins:LibraryItems):LibraryItems {
  const ids=new Set(current.map(item=>item.id));
  return [...current,...builtins.filter(item=>!ids.has(item.id))];
}

/** Rebuild a shell from the saved (non-deleted) artwork. Older installs may have been
 * moved, scaled or regrouped before shells existed, so copying today's pristine shell
 * would misalign it. Existing shells are corrected in place; names, other elements and
 * explicit deletions are preserved. */
export function upgradeBuiltinShells(current:LibraryItems,builtins:LibraryItems):{items:LibraryItems;upgraded:number} {
  const shells=new Map<string,LibraryItems[number]['elements'][number]>();
  for(const item of builtins){const shell=item.elements.find(element=>element.customData?.role==='bind-shell');if(shell)shells.set(item.id,shell);}
  let upgraded=0;
  const items=current.map(item=>{
    const template=shells.get(item.id);
    if(!template)return item;
    const existing=item.elements.find(element=>element.customData?.role==='bind-shell');
    if(existing?.isDeleted)return item;
    const artwork=item.elements.filter(element=>!element.isDeleted&&element.customData?.role!=='bind-shell');
    if(!artwork.length)return item;
    const bounds=elementsBounds(artwork);
    const groupId=artwork.flatMap(element=>element.groupIds??[])[0]??existing?.groupIds?.[0]??template.groupIds?.[0]??item.id+'-group';
    const x=Math.floor(bounds.left)-4,y=Math.floor(bounds.top)-4;
    const width=Math.ceil(bounds.right)-Math.floor(bounds.left)+8,height=Math.ceil(bounds.bottom)-Math.floor(bounds.top)+8;
    if(existing&&existing.x===x&&existing.y===y&&existing.width===width&&existing.height===height&&existing.groupIds?.length===1&&existing.groupIds[0]===groupId)return item;
    const ids=new Set(item.elements.map(element=>element.id));
    let id=existing?existing.id:template.id;
    if(!existing&&ids.has(id)){let suffix=2;while(ids.has(id+'-'+suffix))suffix++;id=id+'-'+suffix;}
    upgraded++;
    const nextShell={...structuredClone(existing??template),id,x,y,width,height,groupIds:[groupId],isDeleted:false};
    return {...item,elements:existing?item.elements.map(element=>element===existing?nextShell:element):[nextShell,...item.elements]} as LibraryItems[number];
  });
  return {items,upgraded};
}
