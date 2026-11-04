import type {LibraryItems} from '@excalidraw/excalidraw/types';

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
      const next={...state,libraryItems:[...state.libraryItems,...additions],installedBuiltinIds:[...new Set([...installed,...builtins.map(item=>item.id)])]};
      if(additions.length||next.installedBuiltinIds.length!==state.installedBuiltinIds.length)await this.storage.set({[BOARD_LIBRARY_STORAGE_KEY]:next});
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
      for(const item of changed){if(current.has(item.id))current.set(item.id,item);else added.push(item);}
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
