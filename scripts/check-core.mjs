import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const checks=[['types',['node_modules/typescript/bin/tsc','--noEmit']],['unit',['--test','packages/core/lossless-html.test.ts']],['samples',['scripts/probe-richtext.mjs']]];
const result={at:new Date().toISOString(),runtime:process.version,scope:'S1 core only; not complete application acceptance',checks:[]};
for(const [name,args] of checks){const processResult=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000});result.checks.push({name,passed:processResult.status===0,exit_code:processResult.status,output:processResult.stdout+processResult.stderr});console.log(name,processResult.status===0?'PASS':'FAIL');if(processResult.status!==0)console.log(processResult.stdout+processResult.stderr);}
await fs.writeFile(path.join(root,'.research/s1/core-checks.json'),JSON.stringify(result,null,2));
if(result.checks.some(c=>!c.passed))process.exitCode=1;
