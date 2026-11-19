import { Extension, Node as TiptapNode, type Extensions, type NodeViewRenderer } from '@tiptap/core';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { DOMParser as PMParser, type Node as PMNode } from '@tiptap/pm/model';
import { looksLikeMarkdown, markdownToHtml } from '../../../packages/core/markdown-io.ts';
import { parseTsv } from '../../../packages/core/editor-text.ts';
import { pasteRichContent } from '../../../packages/core/rich-paste.ts';
import katex from 'katex';
import { highlightToHtml } from '../../../packages/core/code-highlight.ts';

/** 公式节点视图：KaTeX 排版渲染，双击弹出迷你编辑框改 TeX 源码；序列化仍是 data-tex 元素。 */
const formulaNodeView: NodeViewRenderer = ({ node, view, getPos }) => {
  const inline = node.type.name === 'formulaInline';
  const dom = document.createElement(inline ? 'span' : 'div');
  dom.className = 'rich-formula' + (inline ? ' rich-formula-inline' : ' rich-formula-block');
  dom.contentEditable = 'false';
  let editor: HTMLTextAreaElement | null = null;
  const render = () => {
    try { dom.innerHTML = katex.renderToString(String(node.attrs.tex ?? ''), { throwOnError: false, displayMode: !inline, output: 'html' }); }
    catch { dom.textContent = String(node.attrs.tex ?? ''); }
  };
  render();
  const close = (commit: boolean) => {
    if (!editor) return;
    const field = editor;
    const value = field.value.trim().slice(0, 4000);
    editor = null;
    dom.classList.remove('editing');
    if (commit && value && value !== node.attrs.tex) {
      const pos = getPos();
      if (typeof pos === 'number' && view.state.doc.nodeAt(pos)?.type === node.type) {
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'tex', value));
      }
    }
    field.remove();
    render();
  };
  dom.addEventListener('dblclick', () => {
    if (editor) return;
    editor = document.createElement('textarea');
    editor.value = String(node.attrs.tex ?? '');
    editor.className = 'rich-formula-editor';
    editor.rows = 2; editor.setAttribute('aria-label', '公式 TeX 源码');
    editor.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); close(true); }
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
    });
    editor.addEventListener('blur', () => close(false));
    dom.classList.add('editing'); dom.append(editor); editor.focus();
  });
  return { dom, update(updated: PMNode) { if (updated.type.name !== node.type.name) return false; node = updated; if (!editor) render(); return true; }, ignoreMutation() { return true; }, stopEvent(event) { return !!editor && dom.contains(event.target as Node); } };
};

type PasteCallbacks = {
  importRichClipboard(html: string, files: File[], event: ClipboardEvent): void;
  importImages(files: File[]): void;
  reportIssue(message: string): void;
};

export function handleRichPaste(view: EditorView, event: ClipboardEvent, callbacks: PasteCallbacks): boolean {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const html = clipboard.getData('text/html');
  const text = clipboard.getData('text/plain');
  const files = Array.from(clipboard.files);
  const inCode = !!view.state.selection.$from.parent.type.spec.code;
  const markdown = !html && !inCode && looksLikeMarkdown(text) ? markdownToHtml(text) : '';
  if (/<img\b/i.test(html || markdown)) {
    event.preventDefault();
    callbacks.importRichClipboard(html || markdown, files, event);
    return true;
  }
  if (files.length) {
    event.preventDefault();
    callbacks.importImages(files);
    return true;
  }
  if (html || inCode) return false;
  const dom = view.dom.ownerDocument.createElement('div');
  if (markdown) {
    dom.innerHTML = markdown;
  } else if (text.includes('\t')) {
    let cells: string[][];
    try { cells = parseTsv(text); } catch (error) { callbacks.reportIssue((error as Error).message); return true; }
    const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>');
    dom.innerHTML = '<table><tbody>' + cells.map(row => '<tr>' + row.map(c => '<td><p>' + escape(c) + '</p></td>').join('') + '</tr>').join('') + '</tbody></table>';
  } else {
    return false;
  }
  pasteRichContent(view, event, PMParser.fromSchema(view.state.schema).parseSlice(dom));
  return true;
}

/** 代码块语法高亮：以行内装饰实现（官方 CodeBlockLowlight 同款思路），存储仍是纯文本。 */
type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };
function collectDecorations(node: HastNode, offset: number, from: number, classes: string[], decorations: Decoration[]): number {
  if (node.type === 'text') { const value = node.value ?? ''; if (value && classes.length) decorations.push(Decoration.inline(from + offset, from + offset + value.length, { class: classes.join(' ') })); return offset + value.length; }
  const next = node.type === 'element' && Array.isArray(node.properties?.className) ? [...classes, ...(node.properties!.className as unknown[]).map(String)] : classes;
  let cursor = offset;
  for (const child of node.children ?? []) cursor = collectDecorations(child, cursor, from, next, decorations);
  return cursor;
}
function codeHighlightPlugin() {
  return new Plugin({
    props: {
      decorations(state: EditorState) {
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'codeBlock') return;
          const highlighted = highlightToHtml(node.textContent, String(node.attrs.language ?? ''));
          if (highlighted === null) return;
          try { collectDecorations(parseHighlighted(highlighted), 1, pos, [], decorations); } catch { /* 高亮失败按纯文本 */ }
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
// highlightToHtml 返回 HTML 字符串；装饰需要结构。这里用浏览器 DOM 还原成类树结构再计算偏移。
function parseHighlighted(html: string): HastNode {
  const dom = document.createElement('div');
  dom.innerHTML = html;
  const convert = (element: Element): HastNode => {
    const children: HastNode[] = [];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) children.push({ type: 'text', value: child.textContent ?? '' });
      else if (child.nodeType === Node.ELEMENT_NODE) children.push(convert(child as Element));
    }
    const className = element.getAttribute('class');
    return { type: 'element', tagName: element.tagName.toLowerCase(), ...(className ? { properties: { className: className.split(/\s+/) } } : {}), children };
  };
  return convert(dom);
}
export function richEditorExtras() {
  return Extension.create({ name: 'richEditorExtras', addProseMirrorPlugins() { return [codeHighlightPlugin()]; } });
}
/** 给公式节点装上 KaTeX 视图（nodeView 必须来自节点扩展本身，放进 editorProps 不生效）。 */
export function withFormulaViews(extensions: Extensions): Extensions {
  return extensions.map(extension => {
    const formula = extension.name === 'formula' || extension.name === 'formulaInline';
    if (!(extension instanceof TiptapNode) || !(formula || extension.name === 'taskList' || extension.name === 'taskItem')) return extension;
    return extension.extend({
      // Match sidebar markup before the generic span, ul and li rules during paste.
      parseHTML() { return (this.parent?.() ?? []).map(rule => ({ ...rule, priority: 60 })); },
      ...(formula ? { addNodeView: () => formulaNodeView } : {}),
    });
  });
}

