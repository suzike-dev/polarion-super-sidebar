import {generateKeyPairSync,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');const folder=path.join(root,'spikes/extension');
let key;try{key=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8')).key;}catch{key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64');}
const id=[...createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
const manifest={manifest_version:3,name:'Polarion Sidebar S1 Probe',version:'0.1.0',description:'Isolated capability probe for the approved Polarion sidebar project',key,permissions:['storage','contextMenus','nativeMessaging'],host_permissions:['https://polarion.pufafen.com/*'],background:{service_worker:'background.js'},action:{default_popup:'probe.html'},content_scripts:[{matches:['https://polarion.pufafen.com/polarion/*'],js:['context.js'],all_frames:true,match_about_blank:true,run_at:'document_idle'}]};
await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2));
await fs.writeFile(path.join(root,'.research/s1/extension-identity.json'),JSON.stringify({id,path:folder,manifest_version:3,public_key_pinned:true},null,2));
console.log(JSON.stringify({id,path:folder}));
