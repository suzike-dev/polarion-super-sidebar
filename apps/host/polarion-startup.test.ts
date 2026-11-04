import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Polarion} from './polarion.ts';

test('worker reports credential startup failures and retries after configuration changes', {skip: process.platform !== 'win32'}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polarion-startup-test-'));
  const file = path.join(dir, 'credentials.json');
  const previous = process.env.POLARION_SIDEBAR_CREDENTIALS;
  process.env.POLARION_SIDEBAR_CREDENTIALS = file;
  const remote = new Polarion();
  try {
    await assert.rejects(remote.call({method:'read'}), {message:'POLARION_CREDENTIAL_FILE_MISSING'});
    await fs.writeFile(file, JSON.stringify({version:2,auth_mode:'password'}));
    await assert.rejects(remote.call({method:'read'}), {message:'POLARION_CREDENTIAL_FILE_INCOMPLETE'});
    await fs.writeFile(file, JSON.stringify({version:999}));
    await assert.rejects(remote.call({method:'read'}), {message:'POLARION_CREDENTIAL_VERSION_UNSUPPORTED'});
    await fs.writeFile(file, JSON.stringify({version:2,auth_mode:'password',username:'fixture',secret_dpapi:'invalid'}));
    await assert.rejects(remote.call({method:'read'}), {message:'POLARION_CREDENTIAL_DECRYPT_FAILED'});
  } finally {
    if (previous === undefined) delete process.env.POLARION_SIDEBAR_CREDENTIALS; else process.env.POLARION_SIDEBAR_CREDENTIALS = previous;
    await fs.rm(dir, {recursive:true, force:true});
  }
});
