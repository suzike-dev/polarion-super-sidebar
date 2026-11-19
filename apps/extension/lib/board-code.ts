export type BoardCode = { format: 'mermaid' | 'diagram'; text: string };

/** Cheap recognition in the preview. Parsing and layout run only inside the board. */
export function detectBoardCode(language: string, text: string): BoardCode | null {
  const lang = language.toLowerCase();
  if (!text.trim() || text.length > 20_000) return null;
  if (lang === 'mermaid' || ((!lang || lang === 'text') && /^(?:\s*%%[^\n]*\n)*\s*(?:(?:flowchart|graph)\s+(?:LR|RL|TB|BT|TD)\b|(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram)\b)/i.test(text))) return {format:'mermaid',text};
  if (['json','board','diagram',''].includes(lang) && text.trimStart().startsWith('{')) {
    try {
      const spec = JSON.parse(text);
      if (typeof spec.title === 'string' && typeof spec.summary === 'string' && ['nodes','participants','classes','entities','states'].some(key => Array.isArray(spec[key]))) return {format:'diagram',text};
    } catch { /* Ordinary or still-streaming JSON. */ }
  }
  return null;
}

// Private to this extension workbench, never dispatched on the host page's DOM.
let draftReceiver: ((code: BoardCode) => boolean) | undefined;
export function registerBoardReceiver(receiver: (code: BoardCode) => boolean) {
  draftReceiver = receiver;
  return () => { if (draftReceiver === receiver) draftReceiver = undefined; };
}
export const openCodeInDraft = (code: BoardCode) => draftReceiver?.(code) ?? false;

export async function codeRecoverySuffix(code: BoardCode) {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.format + '\n' + code.text));
  return 'code:' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join('');
}
