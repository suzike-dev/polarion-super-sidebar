import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=['package.json','package-lock.json','apps/extension/wxt.config.ts','apps/host/service.ts'];
const sources=await Promise.all(files.map(f=>fs.readFile(path.join(root,f),'utf8')));
const pkg=JSON.parse(sources[0]),lock=JSON.parse(sources[1]);
const versions=[pkg.version,lock.version,lock.packages[''].version,sources[2].match(/version: '([^']+)'/)?.[1],sources[3].match(/version: '([^']+)'/)?.[1]];
if(versions.some(v=>v!==pkg.version))throw Error('VERSION_MISMATCH: '+JSON.stringify(versions));
const [action='check',next]=process.argv.slice(2);
if(action==='check'){
 const tag=process.env.GITHUB_REF_TYPE==='tag'?process.env.GITHUB_REF_NAME:undefined;
 if(tag&&tag!=='v'+pkg.version)throw Error('TAG_VERSION_MISMATCH');
 const changelog=await fs.readFile(path.join(root,'CHANGELOG.md'),'utf8');
 if(!changelog.includes('## ['+pkg.version+']'))throw Error('CHANGELOG_VERSION_MISSING');
 console.log('Version consistent: '+pkg.version);
}else if(action==='set'){
 if(!next||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(next)||next.split('.').some(n=>Number(n)>65535))throw Error('Expected numeric major.minor.patch compatible with the extension manifest');
 pkg.version=next;lock.version=next;lock.packages[''].version=next;
 const outputs=[JSON.stringify(pkg,null,2)+'\n',JSON.stringify(lock,null,2)+'\n',sources[2].replace(/version: '[^']+'/,`version: '${next}'`),sources[3].replace(/version: '[^']+'/,`version: '${next}'`)];
 for(let i=0;i<files.length;i++)await fs.writeFile(path.join(root,files[i]),outputs[i]);
 console.log('Updated version to '+next+'. Add CHANGELOG entry, run checks, then commit and tag.');
}else throw Error('Usage: node scripts/version.mjs check | set X.Y.Z');
