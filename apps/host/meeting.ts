import { Store } from './store.ts';
import type { Engines } from './engine.ts';
import type { Context, MeetingAction, MeetingRecordView, PermissionMode, Run, Session, Target } from '../../packages/protocol/index.ts';
import { parseJsonBlock } from './reviews.ts';

/**
 * v0.18 会议纪要分诊：把纪要交给会话拆成结构化动作卡（标题/负责人/优先级/关联条目），
 * 逐条「发 AI 执行」或标记完成；与评审共用 run 完成回填机制。
 */
export type MeetingRecord = { id: string; projectId: string; document: string; at: number; status: 'running' | 'open' | 'done' | 'failed'; error?: string; runId?: string; digest?: string; actions: MeetingAction[] };

export class Meetings {
  store: Store;
  engines?: Engines;
  constructor(store: Store) { this.store = store; }

  static prompt(text: string): string {
    return [
      '【会议纪要分诊】把下面的会议纪要拆成可执行的动作卡，供逐条派发。',
      '规则：',
      '1. 只提取真正的行动项（谁、做什么、对应哪条需求/模块，能识别就填 workItemId）；讨论结论性内容并入 digest。',
      '2. priority：high=阻塞发布或当天必办 / normal=常规 / low=可选优化；负责人原文有就填 owner。',
      '3. 先用一两句话总结纪要，然后必须单独输出一个 ```json 代码块，内容是动作数组：',
      '```json',
      '[{"title":"把 SPE-3 的判据改为 300ms 内退出","owner":"张三","priority":"high","workItemId":"SPE-3"}]',
      '```',
      '纪要如下：',
      text,
    ].join('\n');
  }

  start(sessionId: string, target: Target, contexts: Context[], permissionMode: PermissionMode, text: string): { meetingId: string; runId: string } {
    if (!this.engines) throw Error('ENGINE_UNAVAILABLE');
    const session = this.store.require<Session>('session', sessionId);
    if (session.target.projectId !== target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
    const meeting: MeetingRecord = { id: crypto.randomUUID(), projectId: target.projectId, document: target.document, at: Date.now(), status: 'running', actions: [] };
    this.store.put('meeting-record', meeting.id, meeting);
    const result = this.store.startRun(sessionId, crypto.randomUUID(), Meetings.prompt(text), structuredClone(contexts), target, [], permissionMode, 'queue', undefined, { workflowRunId: '', defName: '会议分诊', stepIndex: 0, stepTotal: 1, stepTitle: '纪要分诊', meetingId: meeting.id });
    meeting.runId = result.run.id; this.store.put('meeting-record', meeting.id, meeting);
    if (result.created) { if (result.run.status === 'queued') this.engines?.pump(sessionId); else void this.engines?.execute(result.run); }
    return { meetingId: meeting.id, runId: result.run.id };
  }

  complete(run: Run) {
    const meetingId = run.workflow?.meetingId;
    if (!meetingId || run.status !== 'completed') return;
    const meeting = this.store.get<MeetingRecord>('meeting-record', meetingId);
    if (!meeting || meeting.status !== 'running') return;
    const row = this.store.db.prepare("SELECT data FROM events WHERE run_id=? AND kind='result' ORDER BY seq DESC LIMIT 1").get(run.id) as { data: string } | undefined;
    let text = '';
    try { text = String((JSON.parse(row!.data) as { text?: unknown }).text ?? ''); } catch { /* 无结果文本 */ }
    try {
      const parsed = parseJsonBlock(text);
      if (!Array.isArray(parsed)) throw Error('NOT_ARRAY');
      const actions: MeetingAction[] = parsed.slice(0, 30).flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const title = typeof (item as Record<string, unknown>).title === 'string' ? String((item as Record<string, unknown>).title).trim().slice(0, 300) : '';
        if (!title) return [];
        const record = item as Record<string, unknown>;
        const priority = record.priority === 'high' || record.priority === 'low' ? record.priority : 'normal';
        return [{ id: crypto.randomUUID(), title, ...(typeof record.owner === 'string' && record.owner ? { owner: record.owner.slice(0, 60) } : {}), priority, ...(typeof record.workItemId === 'string' && record.workItemId ? { workItemId: record.workItemId.slice(0, 100) } : {}), status: 'open' as const }];
      });
      meeting.digest = text.split(/```/)[0]!.trim().slice(0, 400) || undefined;
      meeting.actions = actions;
      meeting.status = actions.length ? 'open' : 'done';
    } catch (error) {
      meeting.status = 'failed';
      meeting.error = error instanceof Error ? error.message : String(error);
      this.store.event(run, 'result', { text: `会议分诊未能解析出动作卡（${meeting.error}）。可重试，或把纪要分段粘贴。` });
    }
    this.store.put('meeting-record', meeting.id, meeting);
  }

  list(target: Target): MeetingRecordView[] {
    return this.store.list<MeetingRecord>('meeting-record')
      .filter(meeting => meeting.projectId === target.projectId)
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map(meeting => ({ id: meeting.id, at: meeting.at, status: meeting.status, ...(meeting.error ? { error: meeting.error } : {}), ...(meeting.digest ? { digest: meeting.digest } : {}), actions: meeting.actions }));
  }

  decide(id: string, actionId: string, decision: 'done' | 'open'): MeetingRecordView {
    const meeting = this.store.require<MeetingRecord>('meeting-record', id);
    const action = meeting.actions.find(row => row.id === actionId);
    if (!action) throw Error('MEETING_ACTION_NOT_FOUND');
    action.status = decision;
    if (meeting.status === 'open' && meeting.actions.every(row => row.status === 'done')) meeting.status = 'done';
    this.store.put('meeting-record', meeting.id, meeting);
    return { id: meeting.id, at: meeting.at, status: meeting.status, actions: meeting.actions };
  }
}
