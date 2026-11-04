import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { RequestSchema, routeFromUrl, ContextSchema, type Reply } from '../../../packages/protocol/index';
import {nativeWorkItemRefresh} from '../lib/native-refresh';
export default defineBackground(() => {
  let port: ReturnType<typeof browser.runtime.connectNative> | undefined;
  const pending = new Map<string, { resolve: (v: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  function host() {
    if (port) return port;
    port = browser.runtime.connectNative('com.nanju.polarion.sidebar');
    port.onMessage.addListener((reply: Reply) => { const p = pending.get(reply.id); if (p) { clearTimeout(p.timer); pending.delete(reply.id); p.resolve(reply); } });
    port.onDisconnect.addListener(() => {
      const reason = browser.runtime.lastError?.message ?? 'HOST_DISCONNECTED'; port = undefined;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(reason)); } pending.clear();
    }); return port;
  }
  const sendTop = (tabId: number, value: unknown) => browser.tabs.sendMessage(tabId, value, { frameId: 0 }).catch(() => {});
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll().then(() => browser.contextMenus.create({ id: 'polarion-context', title: '交给 Polarion 助手', contexts: ['selection'], documentUrlPatterns: ['https://polarion.pufafen.com/*'] }));
  });
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'polarion-context' || !tab?.id) return;
    const target = routeFromUrl(tab.url ?? ''); if (!target) return;
    const key = 'selection:' + tab.id; const prior = (await browser.storage.session.get(key))[key] as { workItemId?: string } | undefined;
    const context = ContextSchema.parse({ id: crypto.randomUUID(), target, workItemId: prior?.workItemId, text: (info.selectionText ?? '').slice(0, 60000), source: 'context-menu', capturedAt: Date.now() });
    await sendTop(tab.id, { type: 'context', context, open: true });
  });
  browser.action.onClicked.addListener(tab => { if (tab.id) void sendTop(tab.id, { type: 'toggle' }); });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return;
    const target = routeFromUrl(sender.tab?.url ?? '');
    if(message?.type==='native-workitem-refresh'&&target&&sender.frameId===0&&sender.tab?.id){
      if(!/^[\w-]+$/.test(message.workItemId)||!['check','refresh'].includes(message.phase)||(message.expectedHtml!==undefined&&(typeof message.expectedHtml!=='string'||message.expectedHtml.length>2_000_000)))return Promise.resolve({ok:false,error:'INVALID_NATIVE_REFRESH'});
      return browser.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},world:'MAIN',func:nativeWorkItemRefresh,args:[{href:sender.tab.url!,workItemId:message.workItemId,phase:message.phase,expectedHtml:message.expectedHtml}]}).then(results=>results[0]?.result??{ok:false,error:'NATIVE_REFRESH_FAILED'});
    }
    if (message?.type === 'selection' && target && sender.tab?.id) {
      const result = ContextSchema.safeParse({ ...message.context, target }); if (!result.success) return;
      const context = result.data; void browser.storage.session.set({ ['selection:' + sender.tab.id]: context });
      return sendTop(sender.tab.id, { type: 'context', context });
    }
    if (message?.type === 'hover' && target && sender.tab?.id) return sendTop(sender.tab.id, { type: 'hover', workItemId: String(message.workItemId).slice(0, 100), text: String(message.text).slice(0, 700) });
    if (message?.type === 'rpc' && ((target && sender.frameId === 0) || sender.url?.startsWith(browser.runtime.getURL('/')))) {
      const request = RequestSchema.parse(message.request);
      // The extension is the only NM client; document scripts cannot directly send runtime messages.
      return new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(request.id); reject(Error('HOST_REQUEST_TIMEOUT')); }, 100000);
        pending.set(request.id, { resolve, reject, timer }); host().postMessage(request);
      });
    }
  });
});
