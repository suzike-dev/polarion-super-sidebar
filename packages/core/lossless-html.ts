import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

type HtmlNode = DefaultTreeAdapterTypes.Node;
export type SourceNode = Readonly<{
  id: string;
  tag: string;
  start: number;
  end: number;
  topLevel: boolean;
  text?: string;
  polarionId?: string;
}>;
export type TextChange = Readonly<{ nodeId: string; expectedText: string; text: string }>;
type Replacement = { start: number; end: number; html: string };

/** Polarion 宏 id 形如 `polarion_wiki macro name=<宏名>[;params…]`；无参宏以宏名直接结尾
 * （如 LiveDoc 导出的 `<table id="polarion_wiki macro name=table">`）。与 rich-document.ts 的
 * macroName 语义一致：按第一个分号截断，空白宽松匹配。 */
export function macroNameOf(id?: string): string | null {
  return id?.match(/^polarion_wiki\s+macro\s+name=([^;]+)/)?.[1] ?? null;
}

/** Source-preserving edit primitive. Parsing locates edits; it never serializes untouched HTML.
 * Node IDs belong to one snapshot. Every successful transaction returns a new snapshot.
 * Rich editor mapping, attachments and remote saving live outside this module.
 */
export class LosslessHtml {
  readonly version = crypto.randomUUID();
  readonly source: string;
  readonly nodes: readonly SourceNode[];
  private readonly index: Map<string, SourceNode>;

  constructor(source: string) {
    this.source = source;
    const fragment = parseFragment(source, { sourceCodeLocationInfo: true });
    const nodes: SourceNode[] = [];
    const walk = (node: HtmlNode, depth: number, protectedContent: boolean) => {
      const tag = node.nodeName;
      // Text inside active/foreign/unknown macro payloads is not an editable leaf.
      let protectedNode = protectedContent || ['script', 'style', 'template', 'svg', 'math'].includes(tag);
      const attrs = 'attrs' in node ? node.attrs : [];
      const polarionId = attrs.find(a => a.name === 'id')?.value;
      const macro = macroNameOf(polarionId);
      if (macro && macro !== 'table') protectedNode = true;
      const loc = node.sourceCodeLocation;
      if (loc && loc.startOffset >= 0 && loc.endOffset > loc.startOffset) {
        nodes.push(Object.freeze({
          id: `${this.version}:${loc.startOffset}:${loc.endOffset}`,
          tag, start: loc.startOffset, end: loc.endOffset, topLevel: depth === 0,
          ...(polarionId ? { polarionId } : {}),
          ...(tag === '#text' && !protectedNode && 'value' in node ? { text: node.value } : {}),
        }));
      }
      if ('childNodes' in node) for (const child of node.childNodes) walk(child, depth + 1, protectedNode);
    };
    for (const node of fragment.childNodes) walk(node, 0, false);
    this.nodes = Object.freeze(nodes);
    this.index = new Map(nodes.map(n => [n.id, n]));
  }

  private checkVersion(expectedVersion: string) {
    if (expectedVersion !== this.version) throw Error('STALE_DRAFT: source snapshot changed');
  }
  private getNode(id: string) {
    const node = this.index.get(id);
    if (!node) throw Error('STALE_ANCHOR: node does not belong to this snapshot');
    return node;
  }
  private apply(replacements: Replacement[]) {
    const ascending = [...replacements].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < ascending.length; i++) {
      if (ascending[i]!.start < ascending[i - 1]!.end || ascending[i]!.start === ascending[i - 1]!.start) throw Error('OVERLAPPING_EDITS');
    }
    let result = this.source;
    for (const edit of ascending.reverse()) result = result.slice(0, edit.start) + edit.html + result.slice(edit.end);
    return new LosslessHtml(result);
  }

  replaceText(expectedVersion: string, changes: readonly TextChange[]) {
    this.checkVersion(expectedVersion);
    if (changes.length === 0) return this;
    const replacements = changes.flatMap(change => {
      const node = this.getNode(change.nodeId);
      if (node.text === undefined) throw Error('OPAQUE_NODE: use an explicit supported editor');
      if (node.text !== change.expectedText) throw Error('TEXT_DRIFT: source text differs');
      if (change.text === node.text) return [];
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(change.text)) throw Error('INVALID_XML_TEXT: unsupported control character');
      // This Polarion 21 R2 instance drops literal non-BMP characters on save.
      // Numeric HTML entities survived the isolated write/readback probe.
      const html = Array.from(change.text, c => {
        if (c === '&') return '&amp;';
        if (c === '<') return '&lt;';
        if (c === '>') return '&gt;';
        const point = c.codePointAt(0)!;
        return point > 0xffff ? `&#x${point.toString(16).toUpperCase()};` : c;
      }).join('');
      return [{ start: node.start, end: node.end, html }];
    });
    if (replacements.length === 0) return this;
    return this.apply(replacements);
  }

  /** Moves an intact top-level block. The caller must validate Polarion hierarchy semantics. */
  moveBefore(expectedVersion: string, nodeId: string, beforeId: string | null) {
    this.checkVersion(expectedVersion);
    const node = this.getNode(nodeId);
    const before = beforeId === null ? undefined : this.getNode(beforeId);
    if (!node.topLevel || (before && !before.topLevel) || node.tag === '#text' || before?.tag === '#text') throw Error('STRUCTURE_REQUIRED: move whole top-level blocks only');
    if (nodeId === beforeId) return this;
    const position = before?.start ?? this.source.length;
    if (position === node.end) return this;
    return this.apply([
      { start: node.start, end: node.end, html: '' },
      { start: position, end: position, html: this.source.slice(node.start, node.end) },
    ]);
  }
}
