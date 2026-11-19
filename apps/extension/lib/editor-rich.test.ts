import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import { richExtensions } from '../../../packages/core/rich-schema.ts';
import { RichDocument } from '../../../packages/core/rich-document.ts';
import * as rich from './editor-rich.ts';

function withEditor(content: string, run: (editor: Editor, window: JSDOM['window']) => void) {
  const { window } = new JSDOM('');
  Object.assign(globalThis, { window, document: window.document, Node: window.Node, requestAnimationFrame: () => 0 });
  const editor = new Editor({ element: document.createElement('div'), extensions: rich.withFormulaViews(richExtensions()), content });
  try { run(editor, window); } finally { editor.destroy(); window.close(); }
}

for (const [kind, tag] of [['inline', 'span'], ['block', 'div']] as const) {
  test(`${kind} formula renders, commits TeX on Enter and cancels on Escape`, () => {
    const formula = `<${tag} data-sidebar-formula="${kind}" data-tex="x">x</${tag}>`;
    withEditor(kind === 'inline' ? `<p>${formula}</p>` : formula, (editor, window) => {
      const view = editor.view.dom.querySelector<HTMLElement>(`.rich-formula-${kind}`)!;
      assert.ok(view.querySelector('.katex'));
      for (const [value, key] of [['x^2', 'Enter'], ['y', 'Escape']] as const) {
        view.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
        const input = view.querySelector('textarea')!;
        input.value = value;
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
        assert.equal(view.querySelector('textarea'), null);
        assert.ok(view.querySelector('.katex'));
        assert.match(editor.getHTML(), /data-tex="x\^2"/);
      }
    });
  });
}

function clipboard(text: string, files: File[] = [], html = ''): ClipboardEvent {
  const event = new window.Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: (type: string) => type === 'text/html' ? html : text } });
  return event as ClipboardEvent;
}

const unexpected = () => assert.fail('unexpected image or error callback');
const callbacks = { importRichClipboard: unexpected, importImages: unexpected, reportIssue: unexpected };

test('tab-indented fenced Markdown pastes as literal code, and ordinary TSV as a table', () => {
  for (const fence of ['```', '~~~']) withEditor('', editor => {
    const code = '\tif (a == b) print("$x$ $$y$$ ==z==")';
    assert.ok(rich.handleRichPaste(editor.view, clipboard(`${fence}js\n${code}\n${fence}`), callbacks));
    const block = editor.state.doc.firstChild!;
    assert.equal(block.type.name, 'codeBlock');
    assert.equal(block.attrs.language, 'js');
    assert.equal(block.textContent, code + '\n');
  });
  withEditor('', editor => {
    assert.ok(rich.handleRichPaste(editor.view, clipboard('A\tB\n1\t2'), callbacks));
    const table = editor.state.doc.content.content.find(node => node.type.name === 'table');
    assert.ok(table);
    assert.equal(table.childCount, 2);
    assert.equal(table.firstChild!.childCount, 2);
    assert.equal(table.lastChild!.lastChild!.textContent, '2');
  });
});

test('Markdown with an image and caption goes to the image importer in one piece', () => {
  withEditor('<p>existing</p>', editor => {
    const before = editor.state.doc;
    for (const files of [[], [new File([], 'diagram.png', { type: 'image/png' })]]) {
      const event = clipboard('说明\n\n![配图](https://example.com/diagram.png)', files);
      let imported = 0;
      assert.ok(rich.handleRichPaste(editor.view, event, { ...callbacks, importRichClipboard(html, received, original) {
        const dom = new window.DOMParser().parseFromString(html, 'text/html');
        assert.equal(dom.querySelector('p')?.textContent, '说明');
        assert.equal(dom.querySelector('img')?.getAttribute('alt'), '配图');
        assert.equal(dom.querySelector('img')?.getAttribute('src'), 'https://example.com/diagram.png');
        assert.deepEqual(received, files);
        assert.equal(original, event);
        imported++;
      } }));
      assert.equal(imported, 1);
      assert.equal(event.defaultPrevented, true);
      assert.equal(editor.state.doc, before);
    }
  });
});

test('pasted Markdown tasks have working checkboxes and persist their toggled state', () => {
  withEditor('', editor => {
    assert.ok(rich.handleRichPaste(editor.view, clipboard('- [ ] 待办\n- [X] **已办**'), callbacks));
    const list = () => editor.state.doc.firstChild!;
    assert.equal(list().type.name, 'taskList');
    assert.deepEqual([0, 1].map(i => list().child(i).attrs.checked), [false, true]);
    const buttons = editor.view.dom.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]');
    buttons[0]!.click(); buttons[1]!.click();
    assert.deepEqual([0, 1].map(i => list().child(i).attrs.checked), [true, false]);
    const saved = new RichDocument('').serialize(editor.getJSON());
    const reopened = new RichDocument(saved).document.content![0]!;
    assert.deepEqual(reopened.content!.map(item => item.attrs!.checked), [true, false]);
    assert.equal(list().lastChild!.textContent, '已办');
    assert.equal(list().lastChild!.firstChild!.firstChild!.marks[0]?.type.name, 'bold');
  });
});
