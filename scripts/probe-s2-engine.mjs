import fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../apps/host/store.ts';
import { Service } from '../apps/host/service.ts';
const out = path.resolve('.research/s2'); await fs.mkdir(out, { recursive: true });
const store = new Store(path.join(out, 'engine-probe.sqlite'));
const service = new Service(store);
const target = { origin: 'https://polarion.pufafen.com', projectId: 'test01', document: 'Requirements/Sidebar_S1_20261103_0a72944c' };
const session = store.createSession(target, 'S2 SDK capability');
const context = { id: crypto.randomUUID(), target, text: 'S2 phrase: lapis-cedar-846', source: 'selection', capturedAt: Date.now(), prefix: '', suffix: '', pinned: false };
async function turn(prompt, contexts) {
  const { run } = store.startRun(session.id, crypto.randomUUID(), prompt, contexts);
  const promise = service.engines.execute(run);
  const timer = setTimeout(() => service.engines.cancel(run.id), 180000);
  await promise; clearTimeout(timer);
  const events = store.events(session.id, 0).filter(e => e.runId === run.id);
  return { status: run.status, error: run.error, engine: events.find(e => e.kind === 'engine')?.data, tools: events.filter(e => e.kind === 'tool').map(e => e.data), result: events.find(e => e.kind === 'result')?.data, eventCount: events.length };
}
const first = await turn('Integration test. Call only mcp__polarion_drafts__context once to read the selected text. Remember its exact phrase and reply S2_READY. Do not call any other tools.', [context]);
console.log(JSON.stringify({ phase: 'first', ...first }));
const second = first.status === 'completed' ? await turn('Without calling tools, what was the exact phrase in my earlier selection? Reply with only the phrase.', []) : null;
const receipt = { at: new Date().toISOString(), first, second, nativeSession: store.require('session', session.id).nativeId };
await fs.writeFile(path.join(out, 'engine-sdk.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ phase: 'second', ...second })); store.close();
