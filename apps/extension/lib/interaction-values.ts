import type { InteractionValues } from '../../../packages/protocol/index';

/** An empty native form control is unanswered, not the numeric/boolean zero value. */
export function interactionInputValue(type: string, raw: string): InteractionValues[string] | undefined {
  if (raw === '') return undefined;
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (type === 'number' || type === 'integer') return Number(raw);
  return raw;
}

export function setInteractionAnswer(answers: InteractionValues, key: string, value: InteractionValues[string] | undefined): InteractionValues {
  const next = { ...answers };
  if (value === undefined) delete next[key]; else next[key] = value;
  return next;
}
