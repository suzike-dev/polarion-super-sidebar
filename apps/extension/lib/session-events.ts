import type { Run, RunEvent } from '../../../packages/protocol/index';

// Matches Store.events' current page limit. A bounded batch yields between bursts.
export const SESSION_EVENT_PAGE_SIZE = 120;
export type EventHistory = { events: RunEvent[]; byRun: Map<string, RunEvent[]>; cursor: number };
export const emptyEventHistory = (): EventHistory => ({ events: [], byRun: new Map(), cursor: 0 });

export function appendSessionEvents(history: EventHistory, incoming: RunEvent[]): EventHistory {
  const fresh = incoming.filter(event => event.seq > history.cursor);
  if (!fresh.length) return history;
  const byRun = new Map(history.byRun);
  const additions = new Map<string, RunEvent[]>();
  for (const event of fresh) {
    const group = additions.get(event.runId) ?? [];
    group.push(event); additions.set(event.runId, group);
  }
  for (const [id, group] of additions) byRun.set(id, [...(byRun.get(id) ?? []), ...group]);
  return { events: [...history.events, ...fresh], byRun, cursor: fresh.at(-1)!.seq };
}

export type SessionPage = { events: RunEvent[]; runs: Run[] };
export async function readSessionBatch(
  read: (after: number) => Promise<SessionPage>, after: number,
  cancelled: () => boolean = () => false, maxPages = 8,
): Promise<SessionPage & { cursor: number; more: boolean }> {
  const events: RunEvent[] = [];
  let runs: Run[] = [], more = false;
  for (let page = 0; page < maxPages && !cancelled(); page++) {
    const response = await read(after);
    if (cancelled()) break;
    runs = response.runs;
    const fresh = response.events.filter(event => event.seq > after);
    if (response.events.length && !fresh.length) throw new Error('会话事件游标未推进，请重试。');
    events.push(...fresh);
    after = fresh.at(-1)?.seq ?? after;
    more = response.events.length >= SESSION_EVENT_PAGE_SIZE;
    if (!more) break;
  }
  return { events, runs, cursor: after, more };
}

// Reuse unchanged run objects, so adding an event in one turn does not repaint all turns.
export function reconcileRuns(previous: Run[], incoming: Run[]): Run[] {
  const byId = new Map(previous.map(run => [run.id, run]));
  const next = incoming.map(run => {
    const old = byId.get(run.id);
    return old && JSON.stringify(old) === JSON.stringify(run) ? old : run;
  });
  return next.length === previous.length && next.every((run, i) => run === previous[i]) ? previous : next;
}
