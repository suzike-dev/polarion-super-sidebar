import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Credentials} from './credentials.ts';
import {Polarion} from './polarion.ts';
import {ROOT} from './paths.ts';

test('credential save encrypts stdin input, preserves old file on auth failure, and switches the worker', {skip:process.platform!=='win32'}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'polarion-account-test-'));
  const file=path.join(dir,'credentials.json'),remote=new Polarion(),credentials=new Credentials(remote,file);
  const username='isolated-fixture',password='synthetic-'+crypto.randomUUID();
  try {
    assert.equal((await credentials.status()).configured,false);
    const validate=async(candidate:Polarion)=>{
      const env={...process.env};delete env.PSModulePath;
      const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts/start-polarion-worker.ps1'),'-ValidateOnly','-CredentialPath',candidate.credentialPath!],{encoding:'utf8',env,windowsHide:true});
      assert.equal(JSON.parse(result).decryptable,true);
    };
    assert.equal((await credentials.save(username,password,validate)).connected,true);
    const encrypted=await fs.readFile(file,'utf8');assert(!encrypted.includes(password));
    assert.equal(remote.credentialPath,file);assert.equal((await credentials.status()).username,username);
    await assert.rejects(credentials.save('replacement','wrong',async()=>{throw Error('POLARION_AUTHENTICATION_FAILED');}),{message:'POLARION_AUTHENTICATION_FAILED'});
    assert.equal(await fs.readFile(file,'utf8'),encrypted);assert.equal(remote.reconfiguring,false);
    assert.deepEqual(await fs.readdir(dir),['credentials.json']);
    await credentials.save('replacement',password,validate);
    assert.equal((await credentials.status()).username,'replacement');
    assert.deepEqual(await fs.readdir(dir),['credentials.json']);
    remote.reconfiguring=true;assert.throws(()=>remote.call({method:'read'}),/POLARION_CONNECTION_BUSY/);remote.reconfiguring=false;
  }finally {await remote.stop();await fs.rm(dir,{recursive:true,force:true});}
});
