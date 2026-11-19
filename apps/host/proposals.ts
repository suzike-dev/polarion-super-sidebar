import type { Target, ProposalOp } from '../../packages/protocol/index.ts';
import { sameTarget } from '../../packages/protocol/index.ts';
import type { Store } from './store.ts';
import type { Drafts } from './polarion.ts';

import type { Changes } from './changes.ts';
import type { Proposal, RuntimeProposalOp } from '../../packages/protocol/index.ts';
import { RichDocument } from '../../packages/core/rich-document.ts';
import { richSchema } from '../../packages/core/rich-schema.ts';
import { replaceAllText, replaceGlossaryMatches } from '../../packages/core/replace-all.ts';
import { glossaryFixMatches, type RulePack } from '../../packages/core/requirement-lint.ts';
import { diffText } from '../../packages/core/text-diff.ts';
export type { Proposal } from '../../packages/protocol/index.ts';
type DraftView = ReturnType<Drafts['read']>;
type NativeState = 'clean' | 'dirty' | 'unknown';
type Details = Pick<Proposal,'target' | 'source' | 'summary' | 'workItemId'>;
type ReplaceAllOp = Extract<ProposalOp, { kind: 'replace-all-text' }>;

export class Proposals {
  private store: Store;
  private drafts: Drafts;
  private changes?: Changes;
  constructor(store: Store, drafts: Drafts, changes?: Changes) { this.store = store; this.drafts = drafts; this.changes = changes; }

  private put(proposal: Proposal) { this.store.put('proposal', proposal.id, proposal); return proposal; }

  private glossaryRanges(model: RichDocument, target: Target, op: ReplaceAllOp) {
    if (!op.from || !op.to) throw Error('REPLACE_TEXT_NOT_FOUND');
    // Older callers supplied just the alias and standard when no project pack was configured.
    const pack = this.store.get<{ pack: RulePack }>('rule-pack', target.projectId)?.pack
      ?? { version: 1, lintRules: [], glossary: [{ term: op.to, aliases: [op.from], forbidden: false }] };
    const matches = glossaryFixMatches(richSchema.nodeFromJSON(model.document), pack, op.from, op.to, op.caseSensitive);
    if (op.lintMatches && (matches.length !== op.lintMatches.length || op.lintMatches.some((m, i) => m.from !== matches[i]!.from || m.to !== matches[i]!.to))) {
      throw Error('术语命中已变化，请重新运行体检并预览。');
    }
    return matches;
  }

  private legacyGlossaryRanges(proposal: Proposal, op: ReplaceAllOp, before: DraftView) {
    if (before.revision !== op.expectedRevision) throw Error('STALE_DRAFT');
    const model = new RichDocument(before.html), matches = this.glossaryRanges(model, before.target, op);
    const changed = '旧版术语替换范围已变化，请重新预览。';
    if (!matches.length || matches.length !== proposal.matchCount) throw Error(changed);
    const effective = replaceGlossaryMatches(model.document, matches, op.from, op.to, op.caseSensitive);
    const literal = replaceAllText(model.document, op.from, op.to, op.caseSensitive);
    const shown = proposal.diffPreview?.after.map(part => part.text).join('');
    if (shown !== effective.diffPreview.after.map(part => part.text).join('') || model.serialize(literal.document) !== model.serialize(effective.document)) throw Error(changed);
    return matches;
  }

  create(input: Details & {op: ProposalOp}): Proposal {
    let {op} = input;
    const draft = this.drafts.read(op.draftId);
    if (!sameTarget(draft.target,input.target) || (input.workItemId && draft.workItemId !== input.workItemId)) throw Error('PROPOSAL_TARGET_MISMATCH');
    if (op.expectedRevision !== draft.revision) throw Error('STALE_DRAFT');
    let preview, matchCount = 1;
    if (op.kind === 'replace-all-text') {
      const model = new RichDocument(draft.html), current = model.document;
      const text = (doc: typeof current) => { const node = richSchema.nodeFromJSON(doc); return node.textBetween(0,node.content.size,'\n','\uFFFC'); };
      if (input.source === 'lint') {
        const matches = this.glossaryRanges(model, draft.target, op);
        op = { ...op, lintMatches: matches };
        const base = draft.state === 'dirty' ? text(new RichDocument(draft.baseHtml).document) : undefined;
        const applied = replaceGlossaryMatches(current, matches, op.from, op.to, op.caseSensitive, base);
        model.serialize(applied.document);
        matchCount = applied.replacements; preview = applied.diffPreview;
      } else {
        const applied = replaceAllText(current, op.from, op.to, op.caseSensitive);
        matchCount = applied.replacements; preview = diffText(text(current), text(applied.document), true);
      }
    } else {
      preview = diffText(op.expectedText, op.text, true);
    }
    return this.put({...input, op, workItemId: draft.workItemId, id: crypto.randomUUID(), status:'pending', createdAt:Date.now(),
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
        const matches = save ? op.lintMatches ?? this.legacyGlossaryRanges(proposal, op, before) : undefined;
        proposal.matchCount = this.drafts.replaceAll(op.draftId,op.expectedRevision,op.from,op.to,op.caseSensitive,matches).replacements;
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
