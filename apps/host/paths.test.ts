import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveClaudeExecutable, resolveRuntimePaths } from './paths.ts';
const base = path.resolve('portable fixture 中文');
const only = (...files: string[]) => (file: string) => files.includes(file);
test('Claude discovery accepts native PATH and native per-user installs without the development npm prefix', () => {
  const native = path.join(base, '.local/bin/claude.exe');
  assert.equal(resolveClaudeExecutable({ env: {}, home: base, isFile: only(native) }).path, native);
  const installed = path.join(base, 'tools/claude.exe');
  assert.equal(resolveClaudeExecutable({ env: { Path: path.dirname(installed) }, home: base, isFile: only(installed, native) }).path, installed);
});
test('Claude discovery resolves npm shims to real CLI files for custom prefixes and legacy APPDATA', () => {
  for (const env of [{ PATH: path.join(base, 'npm') }, { npm_config_prefix: path.join(base, 'npm') }, { APPDATA: base }]) {
    const executable = path.join(base, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    assert.equal(resolveClaudeExecutable({ env, home: base, isFile: only(executable) }).path, executable);
    const js = path.join(base, 'npm/node_modules/@anthropic-ai/claude-code/cli.js');
    assert.equal(resolveClaudeExecutable({ env, home: base, isFile: only(js) }).path, js);
  }
});
test('an explicit missing or invalid Claude override does not silently pick another account installation', () => {
  const native = path.join(base, '.local/bin/claude.exe');
  assert.equal(resolveClaudeExecutable({ env: { POLARION_SIDEBAR_CLAUDE: path.join(base, 'missing.exe') }, home: base, isFile: only(native) }).found, false);
  assert.equal(resolveClaudeExecutable({ env: { POLARION_SIDEBAR_CLAUDE: './claude.exe' } }).error, 'CLAUDE_OVERRIDE_MUST_BE_ABSOLUTE');
  assert.equal(resolveClaudeExecutable({ env: { POLARION_SIDEBAR_CLAUDE: path.join(base, 'claude.cmd') } }).error, 'CLAUDE_OVERRIDE_REQUIRES_EXECUTABLE_OR_JS');
  assert.equal(resolveClaudeExecutable({ env: {}, home: base, isFile: only() }).error, 'CLAUDE_NOT_FOUND');
});
test('runtime/data paths follow the copied installation and isolate different data stores', () => {
  const root = path.join(base, 'copied app'), data = path.join(base, 'new user data');
  const result = resolveRuntimePaths({ root, home: base, env: { POLARION_SIDEBAR_DATA: data }, isFile: only() });
  assert.equal(result.root, root);
  assert.equal(result.data, data);
  assert.equal(result.node, path.join(root, '.runtime/node-v24.22.2-win-x64/node.exe'));
  assert.notEqual(result.pipe, resolveRuntimePaths({ root, home: base, env: {}, isFile: only() }).pipe);
  assert.throws(() => resolveRuntimePaths({ env: { POLARION_SIDEBAR_DATA: './relative' } }), /MUST_BE_ABSOLUTE/);
});
