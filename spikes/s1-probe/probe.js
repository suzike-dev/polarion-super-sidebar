async function refresh(){const {probeState}=await chrome.storage.local.get('probeState');document.querySelector('#status').textContent=JSON.stringify({extensionId:chrome.runtime.id,manifestVersion:chrome.runtime.getManifest().manifest_version,...probeState},null,2);}
document.querySelector('#refresh').onclick=refresh;
document.querySelector('#native').onclick=async()=>{await chrome.runtime.sendMessage({type:'native-probe',nonce:crypto.randomUUID()});await refresh();};
chrome.storage.onChanged.addListener(refresh);refresh();
