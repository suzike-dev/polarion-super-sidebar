import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCommands, slashQuery } from './commands.ts';

test('complete catalog remains available beyond ten rows, including namespaces', () => {
  const commands = Array.from({ length: 386 }, (_, i) => ({ name: `plugin:skill-${i}`, description: `本地能力 ${i}`, aliases: [`alias-${i}`], builtin: i < 40 }));
  assert.equal(filterCommands(commands, '').length, 386);
  assert.equal(filterCommands(commands, '/PLUGIN:skill-385')[0]?.name, 'plugin:skill-385');
  assert.equal(filterCommands(commands, 'ALIAS-385')[0]?.name, 'plugin:skill-385');
  assert.equal(filterCommands(commands, '本地能力 385')[0]?.name, 'plugin:skill-385');
  assert.deepEqual(filterCommands(commands, 'nonexistent'), []);
});

test('slash search accepts namespaces and descriptions, but not ordinary multiline prompts', () => {
  assert.equal(slashQuery('/'), '');
  assert.equal(slashQuery('/plugin:skill'), 'plugin:skill');
  assert.equal(slashQuery('/本地 能力'), '本地 能力');
  assert.equal(slashQuery('/skill\nextra'), null);
  assert.equal(slashQuery('normal text'), null);
});
