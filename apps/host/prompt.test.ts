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
