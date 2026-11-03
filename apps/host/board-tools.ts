import {tool} from '@anthropic-ai/claude-agent-sdk';
import {z} from 'zod';
import {Boards} from './boards.ts';
import {BoardPatchesSchema} from '../../packages/core/board-changes.ts';
import type {Run} from '../../packages/protocol/index.ts';
import type {Store} from './store.ts';
import type {Drafts} from './polarion.ts';
import type {Assets} from './assets.ts';
export type BoardToolTurn={run:Run;controller:AbortController;store:Store;drafts:Drafts;assets:Assets};
export const boardToolNames=['read_board','propose_board_changes'].map(n=>'mcp__polarion_drafts__'+n);
export function createBoardTools(getCurrentTurn:()=>BoardToolTurn){
 const current=()=>{const t=getCurrentTurn();if(t.controller.signal.aborted)throw Error('RUN_CANCELLED');return {...t,boards:new Boards(t.store,t.assets)};};
 const text=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
 return [
  tool('read_board','读取当前选区已插入草稿的画板对象和绑定连线。必须使用上下文中的 draftId/objectId/snapshotId/selectedIds；新画板须先插入草稿。本工具不编辑、不保存远程。',{draftId:z.string().uuid(),objectId:z.string().uuid(),snapshotId:z.string().uuid(),selectedIds:z.array(z.string().min(1).max(200)).min(1).max(100)},async a=>{const t=current();return text(t.boards.readForRun(t.run,t.drafts.read(a.draftId),a.objectId,a.snapshotId,a.selectedIds));}),
  tool('propose_board_changes','基于 read_board 的 readId 提交画板对象变更供用户审阅。仅文字、位置、尺寸、颜色；不能增删对象、绑定、源文件或 PNG。用户在画板应用后仍须插入正文草稿与明确保存。',{draftId:z.string().uuid(),readId:z.string().uuid(),title:z.string().min(1).max(160),patches:BoardPatchesSchema},async a=>{const t=current();return text(t.boards.propose(t.run,t.drafts.read(a.draftId),a.readId,a.title,a.patches));}),
 ];
}
