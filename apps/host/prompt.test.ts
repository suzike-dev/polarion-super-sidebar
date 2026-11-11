import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enginePrompt } from './prompt.ts';
import type { Run } from '../../packages/protocol/index.ts';
test('native slash command reaches the runtime without a chat prefix or appended arguments', () => {
  const run = { prompt: '/context', target: { projectId: 'p', document: 'd' }, contexts: [] } as unknown as Run;
  assert.equal(enginePrompt(run, []), '/context');
  run.prompt = '/my-skill --scope item'; assert.equal(enginePrompt(run, []), run.prompt);
  run.prompt = '/superpowers:brainstorming 需求变更'; assert.equal(enginePrompt(run, []), run.prompt);
  run.prompt = '分析选区'; assert.match(enginePrompt(run, []), /当前任务目标/);
});
test('prompt pins the current work item from the latest context and embeds the attached guideline', () => {
  const run = { prompt: '继续处理', target: { projectId: 'p', document: 'd' }, contexts: [{ workItemId: 'A' }, { workItemId: 'B' }] } as unknown as Run;
  const prompt = enginePrompt(run, []);
  assert.match(prompt, /当前工作项（用户此刻正在处理的目标）：B/);
  assert.match(prompt, /历史轮次中出现的其他工作项仅作参考/);
  const withoutItem = { ...run, contexts: [{ text: 'plain selection' }] } as unknown as Run;
  assert.match(enginePrompt(withoutItem, []), /当前工作项：未指定/);
  const withGuideline = enginePrompt(run, [], { name: '写标准需求', description: '', text: '按标准模板输出', source: 'file', files: [{label:'模板',path:'C:/x.md'}] });
  assert.match(withGuideline, /附加指令（写标准需求 · 加载自本地文件/);
  assert.match(withGuideline, /按标准模板输出/);
});
test('every turn lists the general guideline library and requires reading relevant entries', () => {
  const run = { prompt: '写一条需求', target: { projectId: 'p', document: 'd' }, contexts: [] } as unknown as Run;
  const library = [{ id: '11111111-1111-4111-8111-111111111111', name: '标准变量定义', description: '变量命名与单位基准' }];
  const prompt = enginePrompt(run, [], undefined, library);
  assert.match(prompt, /通用指令库/);
  assert.match(prompt, /必须先调用 read_guideline/);
  assert.match(prompt, /标准变量定义/);
  assert.match(prompt, /11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(enginePrompt(run, [], undefined, []), /通用指令库/);
});
test('distilled experience is embedded as a mandatory follow-up block', () => {
  const run = { prompt: '写一条需求', target: { projectId: 'p', document: 'd' }, contexts: [] } as unknown as Run;
  const prompt = enginePrompt(run, [], undefined, undefined, '## 工具与流程\n- 必须先走本地草稿，用户明确保存后才写服务端。');
  assert.match(prompt, /历史经验沉淀（用户在此前会话中明确纠正或确认的做法，必须遵循，避免重犯）/);
  assert.match(prompt, /必须先走本地草稿/);
  assert.doesNotMatch(enginePrompt(run, [], undefined, undefined, '   '), /历史经验沉淀/);
  assert.doesNotMatch(enginePrompt(run, []), /历史经验沉淀/);
});
