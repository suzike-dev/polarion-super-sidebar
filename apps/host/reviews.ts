import { Store } from './store.ts';
import type { Engines } from './engine.ts';
import type { Context, PermissionMode, ReviewIssueCard, ReviewRecordView, ReviewSeverity, Run, Session, Target } from '../../packages/protocol/index.ts';

/**
 * v0.16 AI 预审评审：会话对整册需求产出结构化问题卡（blocker/major/minor + 位置 + 建议），
 * 人工逐条处置（解决/忽略/打开条目改），可发飞书评审汇总。与动态工作流共用「run 完成回填」机制。
 */
export type ReviewRecord = { id: string; projectId: string; document: string; at: number; status: 'running' | 'open' | 'done' | 'failed'; error?: string; runId?: string; issues: ReviewIssueCard[] };

/** 取文本里最后一个 ```json 围栏并 JSON.parse；没有围栏时尝试整段解析。 */
export function parseJsonBlock(raw: string): unknown {
  const blocks = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(match => match[1]!.trim());
  for (const candidate of [blocks.at(-1), raw.trim()]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* 尝试下一个候选 */ }
  }
  throw Error('JSON_BLOCK_UNPARSEABLE');
}

export class Reviews {
  store: Store;
  engines?: Engines;
  constructor(store: Store) { this.store = store; }

  static prompt(): string {
    return [
      '【AI 预审】对当前文档的软件需求做一轮评审预审，产出结构化问题卡，供人工逐条处置。',
      '规则：',
      '1. 用可用的读取工具逐条查看需求（peek_work_item / read_draft），重点看：判据缺失或不可验证、多条职责揉在一条、与上下游矛盾、术语不一致、明显缺失的场景或异常处理。',
      '2. 只报有依据的问题：每条给出 workItemId（定位）、location（章/段/表格，能定位就写）、severity（blocker=阻断发布 / major=必须改 / minor=建议）、summary（一句话问题）、suggestion（具体改法建议）。',
      '3. 没有把握的不报；总数控制在 20 条以内，按严重程度排序。',
      '4. 先用两三句话给整体结论，然后必须单独输出一个 ```json 代码块，内容是问题数组：',
      '```json',
      '[{"workItemId":"SPE-1","location":"3.2 表格","severity":"major","summary":"判据不可验证","suggestion":"把“尽快退出”改为“300ms 内退出”"}]',
      '```',
    ].join('\n');
  }

  start(sessionId: string, target: Target, contexts: Context[], permissionMode: PermissionMode): { reviewId: string; runId: string } {
    // 没有引擎就不落 run：否则记录会永远停在“预审中”（startRun 对新会话直接置 running）。
    if (!this.engines) throw Error('ENGINE_UNAVAILABLE');
    const session = this.store.require<Session>('session', sessionId);
    if (session.target.projectId !== target.projectId) throw Error('SESSION_PROJECT_MISMATCH');
    const review: ReviewRecord = { id: crypto.randomUUID(), projectId: target.projectId, document: target.document, at: Date.now(), status: 'running', issues: [] };
    this.store.put('review-record', review.id, review);
    const result = this.store.startRun(sessionId, crypto.randomUUID(), Reviews.prompt(), structuredClone(contexts), target, [], permissionMode, 'queue', undefined, { workflowRunId: '', defName: 'AI 预审', stepIndex: 0, stepTotal: 1, stepTitle: '评审预审', reviewId: review.id });
    review.runId = result.run.id; this.store.put('review-record', review.id, review);
    if (result.created) { if (result.run.status === 'queued') this.engines?.pump(sessionId); else void this.engines?.execute(result.run); }
    return { reviewId: review.id, runId: result.run.id };
  }

  /** 预审轮完成后回填：解析问题卡；解析失败置 failed 并在会话里说明。 */
  complete(run: Run) {
    const reviewId = run.workflow?.reviewId;
    if (!reviewId || run.status !== 'completed') return;
    const review = this.store.get<ReviewRecord>('review-record', reviewId);
    if (!review || review.status !== 'running') return;
    const text = this.resultText(run.id) ?? '';
    try {
      const parsed = parseJsonBlock(text);
      if (!Array.isArray(parsed)) throw Error('NOT_ARRAY');
      const issues: ReviewIssueCard[] = parsed.slice(0, 20).flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const summary = typeof row.summary === 'string' ? row.summary.trim().slice(0, 300) : '';
        if (!summary) return [];
        const severity: ReviewSeverity = row.severity === 'blocker' || row.severity === 'major' ? row.severity : 'minor';
        return [{ id: crypto.randomUUID(), ...(typeof row.workItemId === 'string' && row.workItemId ? { workItemId: row.workItemId.slice(0, 100) } : {}), ...(typeof row.location === 'string' && row.location ? { location: row.location.slice(0, 120) } : {}), severity, summary, ...(typeof row.suggestion === 'string' && row.suggestion ? { suggestion: row.suggestion.slice(0, 500) } : {}), status: 'open' as const }];
      });
      review.issues = issues;
      review.status = issues.length ? 'open' : 'done';
    } catch (error) {
      review.status = 'failed';
      review.error = error instanceof Error ? error.message : String(error);
      this.store.event(run, 'result', { text: `AI 预审未能解析出问题卡（${review.error}）。可重试，或直接在对话里让它逐条列出问题。` });
    }
    this.store.put('review-record', review.id, review);
  }

  list(target: Target): ReviewRecordView[] {
    return this.store.list<ReviewRecord>('review-record')
      .filter(review => review.projectId === target.projectId)
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map(review => ({ id: review.id, document: review.document, at: review.at, status: review.status, ...(review.error ? { error: review.error } : {}), issues: review.issues }));
  }

  decide(id: string, issueId: string, decision: 'resolved' | 'ignored'): ReviewRecordView {
    const review = this.store.require<ReviewRecord>('review-record', id);
    const issue = review.issues.find(card => card.id === issueId);
    if (!issue) throw Error('REVIEW_ISSUE_NOT_FOUND');
    issue.status = decision;
    if (review.status === 'open' && review.issues.every(card => card.status !== 'open')) review.status = 'done';
    this.store.put('review-record', review.id, review);
    return { id: review.id, document: review.document, at: review.at, status: review.status, issues: review.issues };
  }

  require(id: string): ReviewRecord { return this.store.require<ReviewRecord>('review-record', id); }

  private resultText(runId: string): string | undefined {
    const row = this.store.db.prepare("SELECT data FROM events WHERE run_id=? AND kind='result' ORDER BY seq DESC LIMIT 1").get(runId) as { data: string } | undefined;
    if (!row) return undefined;
    try { const text = String((JSON.parse(row.data) as { text?: unknown }).text ?? ''); return text || undefined; } catch { return undefined; }
  }
}
