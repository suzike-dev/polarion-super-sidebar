import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DATA, ROOT} from './paths.ts';
import {Polarion} from './polarion.ts';

export class Credentials {
  remote: Polarion; destination: string; busy = false;
  constructor(remote: Polarion, destination = process.env.POLARION_SIDEBAR_CREDENTIALS || path.join(DATA,'credentials.json')) {
    this.remote=remote; this.destination=destination;
  }
  async status() {
    const legacy=path.join(process.env.LOCALAPPDATA || DATA,'PolarionMcp/credentials.json');
    let file=this.destination;
    try { await fs.access(file); } catch { if (!process.env.POLARION_SIDEBAR_CREDENTIALS && file===path.join(DATA,'credentials.json')) file=legacy; }
    try { const value=JSON.parse(await fs.readFile(file,'utf8'));return {configured:true,username:typeof value.username==='string'?value.username:'',authMode:value.auth_mode || 'password'}; }
    catch { return {configured:false,username:'',authMode:'password'}; }
  }
  async check() {
    if (this.busy) throw Error('POLARION_CONNECTION_BUSY');
    return this.remote.call<{connected:true}>({method:'authenticate'});
  }
  async save(username:string,password:string, verify = async (candidate:Polarion) => { await candidate.call({method:'authenticate'}); }) {
    if (this.busy || this.remote.pending.size) throw Error('POLARION_CONNECTION_BUSY');
    if (!path.isAbsolute(this.destination)) throw Error('POLARION_CREDENTIAL_PATH_MUST_BE_ABSOLUTE');
    this.busy=true; this.remote.reconfiguring=true;
    const staging=path.join(path.dirname(this.destination),'.credentials-'+crypto.randomUUID()+'.json');
    const candidate=new Polarion(undefined,staging);
    try {
      await new Promise<void>((resolve,reject)=>{
        const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
        const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts/configure-polarion-credentials.ps1'),'-FromStdin','-CredentialPath',staging],{cwd:ROOT,env,windowsHide:true,stdio:'pipe'});
        child.stdout.resume();child.stderr.resume();child.stdin.on('error',()=>{});
        const timer=setTimeout(()=>{child.kill();reject(Error('POLARION_CREDENTIAL_SAVE_FAILED'));},15000);
        child.once('error',()=>{clearTimeout(timer);reject(Error('POLARION_CREDENTIAL_SAVE_FAILED'));});
        child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('POLARION_CREDENTIAL_SAVE_FAILED'));});
        // Secret travels only over the local pipe, never argv, logs or settings DB.
        child.stdin.end(JSON.stringify({username,password}));
      });
      password='';
      await verify(candidate);
      await candidate.stop();
      await this.remote.stop();
      // Candidate has a CurrentUser/System-only ACL from the configuration helper.
      // rename atomically replaces the encrypted file; failure preserves the old file.
      await fs.rename(staging,this.destination);
      this.remote.credentialPath=this.destination;
      return {configured:true,connected:true,username,authMode:'password'};
    } catch (error) {
      const code=error instanceof Error?error.message:'';
      if (/^POLARION_[A-Z_]+$/.test(code)) throw Error(code);
      throw Error('POLARION_CREDENTIAL_SAVE_FAILED');
    } finally {
      password='';
      try { await candidate.stop();await fs.rm(staging,{force:true}); }
      finally { this.remote.reconfiguring=false;this.busy=false; }
    }
  }
}
