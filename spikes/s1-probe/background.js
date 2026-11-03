let state={started:new Date().toISOString(),frames:[],selection:null,contextMenu:null,native:null};
let queue=chrome.storage.local.get('probeState').then(saved=>{if(saved.probeState)state={...state,...saved.probeState};});
chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:'polarion-s1-context',title:'Polarion S1：验证选区上下文',contexts:['selection'],documentUrlPatterns:['https://polarion.pufafen.com/polarion/*']}));
});
chrome.contextMenus.onClicked.addListener((info,tab)=>{
  if(info.menuItemId==='polarion-s1-context')queue=queue.then(async()=>{state.contextMenu={at:Date.now(),frameId:info.frameId,selectionLength:info.selectionText?.length,tabId:tab?.id};await chrome.storage.local.set({probeState:state});});
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 queue=queue.then(async()=>{
  if(message?.type==='frame-ready'){
    state.frames=state.frames.filter(f=>!(f.tabId===sender.tab?.id&&f.frameId===sender.frameId));
    state.frames.push({tabId:sender.tab?.id,frameId:sender.frameId,url:sender.url,top:message.top});
    await chrome.storage.local.set({probeState:state});reply({ok:true});
  } else if(message?.type==='selection'){
    state.selection={at:Date.now(),frameId:sender.frameId,tabId:sender.tab?.id,workItemId:message.workItemId,length:message.length};
    await chrome.storage.local.set({probeState:state});reply({ok:true});
  } else if(message?.type==='native-probe'){
    await new Promise(resolve=>chrome.runtime.sendNativeMessage('com.nanju.polarion.s1',{kind:'ping',nonce:message.nonce},response=>{
      const error=chrome.runtime.lastError?.message;
      state.native={at:Date.now(),ok:!error&&response?.nonce===message.nonce,error:error??null,response:response??null};
      chrome.storage.local.set({probeState:state}).then(()=>{reply(state.native);resolve();});
    }));
  }
 }).catch(error=>reply({ok:false,error:error.message}));
 return true;
});
