import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const file = path.join(process.env.LOCALAPPDATA, 'Nanju/PolarionSidebar/state.sqlite');
const db = new DatabaseSync(file, { readOnly: true });
const records = kind => db.prepare('SELECT json FROM records WHERE kind=?').all(kind).map(row => JSON.parse(row.json));
const fixture = 'Requirements/Sidebar_S1_20261103_0a72944c';
const sessions = records('session').filter(s => s.target.projectId === 'test01' && s.target.document === fixture);
const ids = new Set(sessions.map(s => s.id));
const runs = records('run').filter(r => ids.has(r.sessionId)).map(r => {
  const events = db.prepare('SELECT seq,kind,data,at FROM events WHERE run_id=? ORDER BY seq').all(r.id).map(e => ({ ...e, data: JSON.parse(e.data) }));
  return { id: r.id, sessionId: r.sessionId, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, elapsedMs: (r.endedAt ?? Date.now()) - r.startedAt, contextRefs: r.contexts.map(c => ({ workItemId: c.workItemId, chars: c.text.length, source: c.source })), eventTypes: [...new Set(events.map(e => e.kind))], eventCount: events.length, tools: events.filter(e => e.kind === 'tool').map(e => e.data.name), engine: events.find(e => e.kind === 'engine')?.data, permissionEvents: events.filter(e => ['permission','permission-result'].includes(e.kind)).map(e => ({ kind: e.kind, at: e.at, tool: e.data.tool, allow: e.data.allow })), error: r.error };
});
const drafts = records('draft').filter(d => d.target.projectId === 'test01' && d.target.document === fixture).map(d => ({ id: d.id, workItemId: d.workItemId, revision: d.revision, state: d.state, baseUpdated: d.baseUpdated, savedAt: d.savedAt, sourceHash: createHash('sha256').update(d.html).digest('hex') }));
const evidence = { at: new Date().toISOString(), scope: 'Isolated test01 fixture only; no authentication data or full requirement text', sessions: sessions.map(s => ({ id: s.id, engine: s.engine, nativeId: s.nativeId })), runs, drafts };
await fs.mkdir('.research/s2', { recursive: true }); await fs.writeFile('.research/s2/host-runtime.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ sessions: sessions.length, runs: runs.map(r => ({ status: r.status, elapsedMs: r.elapsedMs, tools: r.tools })), drafts })); db.close();
