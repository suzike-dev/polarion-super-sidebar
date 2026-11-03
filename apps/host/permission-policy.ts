import path from 'node:path';
import fs from 'node:fs';
import type {PermissionMode} from '../../packages/protocol/index.ts';
const reads=new Set(['Read','Glob','Grep','WebSearch','WebFetch','Skill','ToolSearch']);
function realDestination(file:string):string{
 let current=path.resolve(file);const tail:string[]=[];
 while(!fs.existsSync(current)){const parent=path.dirname(current);if(parent===current)throw Error('PATH_UNAVAILABLE');tail.unshift(path.basename(current));current=parent;}
 return path.resolve(fs.realpathSync(current),...tail);
}
export function permissionDecision(mode:PermissionMode,name:string,input:Record<string,unknown>,workspace:string,owned:Set<string>):'allow'|'ask'|'deny'{
 if(/^mcp__.*polarion/i.test(name)&&!owned.has(name)&&!/__\w*(?:get_|list_|search_|read_|check_)/i.test(name))return 'deny';
 if(name==='AskUserQuestion')return 'ask';
 if(owned.has(name)||reads.has(name))return 'allow';
 if(mode==='full')return 'allow';
 if(mode==='auto'&&['Write','Edit','MultiEdit','NotebookEdit'].includes(name)){
  const file=input.file_path??input.notebook_path;
  if(typeof file==='string'&&path.isAbsolute(file)){try{const relative=path.relative(realDestination(workspace),realDestination(file));if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))return 'allow';}catch{return 'ask';}}
 }
 return 'ask';
}
