import type { Target, ProposalOp } from '../../packages/protocol/index.ts';
import { sameTarget } from '../../packages/protocol/index.ts';
import type { Store } from './store.ts';
import type { Drafts } from './polarion.ts';

import type { Changes } from './changes.ts';
import type { Proposal, RuntimeProposalOp } from '../../packages/protocol/index.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';
import { richSchema } from '../../packages/core/rich-schema.ts';
import { replaceAllText } from '../../packages/core/replace-all.ts';
import { diffText } from '../../packages/core/text-diff.ts';
export type { Proposal } from '../../packages/protocol/index.ts';
type DraftView = ReturnType<Drafts['read']>;
type NativeState = 'clean' | 'dirty' | 'unknown';
type Details = Pick<Proposal,'target' | 'source' | 'summary' | 'workItemId'>;

export class Proposals {
  private store: Store;
  private drafts: Drafts;
  private changes?: Changes;
  constructor(store: Store, drafts: Drafts, changes?: Changes) { this.store = store; this.drafts = drafts; this.changes = changes; }

  private put(proposal: Proposal) { this.store.put('proposal', proposal.id, proposal); return proposal; }

  create(input: Details & {op: ProposalOp}): Proposal {
    const {op} = input;
    const draft = this.drafts.read(op.draftId);
    if (!sameTarget(draft.target,input.target) || (input.workItemId && draft.workItemId !== input.workItemId)) throw Error('PROPOSAL_TARGET_MISMATCH');
    if (op.expectedRevision !== draft.revision) throw Error('STALE_DRAFT');
    let preview, matchCount = 1;
    if (op.kind === 'replace-all-text') {
      const current = new RichDocument(draft.html).document;
      const replacement = replaceAllText(current, op.from, op.to, op.caseSensitive);
      const text = (doc: typeof current) => { const node = richSchema.nodeFromJSON(doc); return node.textBetween(0,node.content.size,'\n','\uFFFC'); };
      const before = input.source === 'lint' && draft.state === 'dirty' ? new RichDocument(draft.baseHtml).document : current;
      preview = diffText(text(before), text(replacement.document), true);
      matchCount = replacement.replacements;
    } else {
      preview = diffText(op.expectedText, op.text, true);
    }
    return this.put({...input, workItemId: draft.workItemId, id: crypto.randomUUID(), status:'pending', createdAt:Date.now(),
      includesDraftEdits: draft.state === 'dirty', diffPreview: preview, matchCount});
  }

  runtime(input: Details & {op: RuntimeProposalOp}) {
    return this.put({...input, id:crypto.randomUUID(), createdAt:Date.now(), status:'pending'});
  }

  decideRuntime(id: string, allow: boolean) {
    const proposal = this.pending(id);
    if (proposal.op.kind !== 'gate' && proposal.op.kind !== 'tool') throw Error('PROPOSAL_OWNER_MISMATCH');
    return this.put({...proposal, decidedAt:Date.now(), status:allow ? 'approved' : 'rejected'});
  }

  finishRuntime(id: string, error?: string) {
    const p = this.get(id);
    if ((p.op.kind !== 'gate' && p.op.kind !== 'tool') || p.status !== 'approved') throw Error('PROPOSAL_NOT_APPROVED');
    return this.put({...p, ...(error ? {status:'failed', error} : {status:'applied', appliedAt:Date.now()})});
  }

  private async recordVerifiedSave(proposal: Proposal, before: DraftView, saved: DraftView) {
    proposal.savedToPolarion = true;
    this.put(proposal);
    try {
      if (!this.changes) throw Error('CHANGE_BACKEND_UNAVAILABLE');
      proposal.recordId = await this.changes.recordSave(proposal, before, saved);
    } catch (error) { proposal.recordError = (error as Error).message; }
    return this.put(proposal);
  }

  async autoSave(run: import('../../packages/protocol/index.ts').Run, before: DraftView, toolUseId: string) {
    if (!sameTarget(run.target, before.target)) throw Error('PROPOSAL_TARGET_MISMATCH');
    const proposal = this.runtime({target:before.target, workItemId:before.workItemId,
      source:run.workflow ? 'workflow' : 'agent', summary:`自动保存 ${before.workItemId}`,
      op:{kind:'tool', tool:'save_draft', toolUseId, runId:run.id, draftId:before.id, workflowRunId:run.workflow?.workflowRunId}});
    this.decideRuntime(proposal.id,true);
    let saved: DraftView;
    try { saved = await this.drafts.save(before.id,before.revision,'clean'); }
    catch (error) { this.finishRuntime(proposal.id,(error as Error).message); throw error; }
    const applied = this.finishRuntime(proposal.id);
    return {saved, proposal:await this.recordVerifiedSave(applied,before,saved)};
  }

  list(target?: Target): Proposal[] {
    const all = this.store.list<Proposal>('proposal').reverse().sort((a, b) => b.createdAt - a.createdAt);
    return target ? all.filter(proposal => sameTarget(proposal.target, target)) : all;
  }

  get(id: string): Proposal { return this.store.require<Proposal>('proposal', id); }

  async approve(id: string, nativeState?: NativeState): Promise<{proposal: Proposal; draft?: DraftView; replacements?: number}> {
    const proposal = this.pending(id), op = proposal.op;
    if (op.kind === 'tool' || op.kind === 'gate') throw Error('PROPOSAL_OWNER_MISMATCH');
    this.put(Object.assign(proposal, {status:'approved' as const, decidedAt:Date.now()}));
    let draft: DraftView | undefined;
    try {
      const before = this.drafts.read(op.draftId);
      if (!sameTarget(before.target,proposal.target) || (proposal.workItemId && before.workItemId !== proposal.workItemId)) throw Error('PROPOSAL_TARGET_MISMATCH');
      const save = proposal.source === 'lint';
      if (save && nativeState !== 'clean') throw Error('NATIVE_EDITOR_' + (nativeState ?? 'unknown').toUpperCase());
      if (save && before.state === 'conflict') throw Error('REMOTE_CONFLICT');
      if (op.kind === 'replace-text') {
        draft = this.drafts.replace(op.draftId, op.expectedRevision, op.nodeId, op.expectedText, op.text);
        proposal.matchCount = 1;
      } else {
        proposal.matchCount = this.drafts.replaceAll(op.draftId,op.expectedRevision,op.from,op.to,op.caseSensitive).replacements;
        draft = this.drafts.read(op.draftId);
      }
      if (save) {
        draft = await this.drafts.save(draft.id,draft.revision,nativeState!);
        proposal.savedToPolarion = true;
      }
      this.put(Object.assign(proposal, {status:'applied' as const, appliedAt:Date.now()}));
      if (save) await this.recordVerifiedSave(proposal, before, draft);
      return {proposal, draft, replacements:proposal.matchCount};
    } catch (error) {
      proposal.status = 'failed'; proposal.error = (error as Error).message;
      return {proposal:this.put(proposal), ...(draft ? {draft:this.drafts.read(op.draftId)} : {})};
    }
  }

  reject(id: string): Proposal {
    const proposal = this.pending(id);
    if (proposal.op.kind === 'tool' || proposal.op.kind === 'gate') throw Error('PROPOSAL_OWNER_MISMATCH');
    proposal.status = 'rejected'; proposal.decidedAt = Date.now();
    this.store.put('proposal', id, proposal);
    return proposal;
  }

  private pending(id: string): Proposal {
    const proposal = this.get(id);
    if (proposal.status !== 'pending') throw Error('PROPOSAL_NOT_PENDING');
    return proposal;
  }
}
