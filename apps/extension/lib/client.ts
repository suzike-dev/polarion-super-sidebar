import { browser } from 'wxt/browser';
import type { Command, Reply } from '../../../packages/protocol/index';
export async function rpc<T = any>(command: Command): Promise<T> {
  const reply = await browser.runtime.sendMessage({ type: 'rpc', request: { protocol: 1, id: crypto.randomUUID(), command } }) as Reply;
  if (!reply?.ok) throw Error(reply?.error ?? 'HOST_UNAVAILABLE'); return reply.value as T;
}
