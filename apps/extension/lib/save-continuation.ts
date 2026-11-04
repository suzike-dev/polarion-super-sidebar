import {sameTarget,type Target} from '../../../packages/protocol/index.ts';

export type SaveContinuation = {target:Target;draftId:string;workItemId:string;at:number;scrollTop:number;editorScrollTop:number};
const key = 'polarion-sidebar-save-continuation';
/** Tab-local, one-shot UI state only; never persist document contents here. */
export function rememberSave(storage:Storage, value:SaveContinuation) { storage.setItem(key,JSON.stringify(value)); }
export function consumeSave(storage:Storage,target:Target,now=Date.now()):SaveContinuation|null {
  const value=storage.getItem(key); if(!value)return null;
  storage.removeItem(key);
  try { const saved=JSON.parse(value) as SaveContinuation;
    return sameTarget(saved.target,target)&&typeof saved.draftId==='string'&&typeof saved.workItemId==='string'&&
      Number.isFinite(saved.at)&&now>=saved.at&&now-saved.at<120000&&Number.isFinite(saved.scrollTop)&&saved.scrollTop>=0&&
      Number.isFinite(saved.editorScrollTop)&&saved.editorScrollTop>=0?saved:null;
  } catch { return null; }
}
