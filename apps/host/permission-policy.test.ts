import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {permissionDecision} from './permission-policy.ts';
import {formatIntent} from './format-intent.ts';
import {toolPresentation} from './tool-presentation.ts';
import {Store} from './store.ts';
test('three permission modes preserve explicit external save and ask-user boundaries',()=>{
 const workspace=path.resolve('test-workspace'),owned=new Set(['mcp__polarion_drafts__format_text']);
 for(const mode of ['ask','auto','full'] as const){assert.equal(permissionDecision(mode,'mcp__polarion__update_work_item',{},workspace,owned),'deny');assert.equal(permissionDecision(mode,'AskUserQuestion',{},workspace,owned),'ask');assert.equal(permissionDecision(mode,'mcp__polarion_drafts__format_text',{},workspace,owned),'allow');}
 assert.equal(permissionDecision('ask','Write',{file_path:path.join(workspace,'a.txt')},workspace,owned),'ask');
 assert.equal(permissionDecision('auto','Write',{file_path:path.join(workspace,'a.txt')},workspace,owned),'allow');
 assert.equal(permissionDecision('auto','Write',{file_path:path.resolve(workspace,'../outside.txt')},workspace,owned),'ask');
 assert.equal(permissionDecision('auto','Bash',{},workspace,owned),'allow');assert.equal(permissionDecision('auto','Task',{},workspace,owned),'allow');assert.equal(permissionDecision('full','Bash',{},workspace,owned),'allow');
});
test('permission choice freezes in run and is part of idempotent request identity',()=>{
 const s=new Store(':memory:'),target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/Test'},session=s.createSession(target,'test'),id=crypto.randomUUID();
 const r=s.startRun(session.id,id,'test',[],target,[],'full');assert.equal(r.run.permissionMode,'full');assert.equal(s.startRun(session.id,id,'test',[],target,[],'full').created,false);assert.throws(()=>s.startRun(session.id,id,'test',[],target,[],'ask'),/REQUEST_ID_REUSED/);s.close();
});
test('only explicit bounded formatting shortcuts bypass the agent, and tool summaries redact secrets',()=>{
 assert.deepEqual(formatIntent('字体颜色改成黑色'),{color:'#000000'});assert.deepEqual(formatIntent('请把选中的文字改为红色'),{color:'#dc2626'});assert.equal(formatIntent('分析代码为什么把字体颜色改成黑色'),null);assert.equal(formatIntent('把所有工作项字体颜色改成黑色'),null);
 assert.ok(!toolPresentation('Bash',{command:'curl --token=secret-value'}).detail.includes('secret-value'));
});
