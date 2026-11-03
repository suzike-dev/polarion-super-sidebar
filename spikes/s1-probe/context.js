chrome.runtime.sendMessage({type:'frame-ready',top:window===top}).catch(()=>{});
document.addEventListener('selectionchange',()=>{
  const selected=window.getSelection();
  if(!selected||selected.isCollapsed)return;
  const element=selected.anchorNode?.nodeType===1?selected.anchorNode:selected.anchorNode?.parentElement;
  const macro=element?.closest('[id*="macro name=module-workitem"]');
  const workItemId=macro?.id.includes('|new=1')?null:macro?.id.match(/params=id=([^|;]+)/)?.[1]??null;
  chrome.runtime.sendMessage({type:'selection',length:selected.toString().length,workItemId}).catch(()=>{});
},{passive:true});
