import { browser } from 'wxt/browser';
import type { Command, Reply } from '../../../packages/protocol/index';
export async function rpc<T = any>(command: Command): Promise<T> {
  // 30 秒超时：native 连接断开时 sendMessage 会永久挂起，把 UI 拖死；超时给出可行动的错误。
  const reply = await Promise.race([
    browser.runtime.sendMessage({ type: 'rpc', request: { protocol: 1, id: crypto.randomUUID(), command } }) as Promise<Reply>,
    new Promise<null>(resolve => setTimeout(() => resolve(null), 30000)),
  ]) as Reply | null;
  if (!reply) throw Error('HOST_CONNECTION_LOST：与本地服务的连接已断开。请刷新页面（必要时重启浏览器）重连。');
  if (!reply?.ok) throw Error(reply?.error ?? 'HOST_UNAVAILABLE'); return reply.value as T;
}
