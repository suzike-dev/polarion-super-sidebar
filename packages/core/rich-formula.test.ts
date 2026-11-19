import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RichDocument } from './rich-document.ts';

import {Editor} from '@tiptap/core';
import {JSDOM} from 'jsdom';
import {richExtensions} from './rich-schema.ts';

test('Enter turns only the current Markdown paragraph into a formula or a table', () => {
  const {window}=new JSDOM('');
  Object.assign(globalThis,{window,document:window.document,requestAnimationFrame:()=>0});
  try {
    for(const syntax of ['$$x^2$$','|Signal|Unit|'])for(const prefix of ['', '<p>Before</p>']) {
      const editor=new Editor({element:window.document.createElement('div'),extensions:richExtensions(),content:`${prefix}<p>${syntax}</p><p>After</p>`});
      try {
        const at=prefix?editor.state.doc.child(0).nodeSize:0;
        editor.commands.setTextSelection(at+1+syntax.length);
        const event=new window.KeyboardEvent('keydown',{key:'Enter',keyCode:13});
        editor.view.someProp('handleKeyDown', handler=>handler(editor.view,event));
        const doc=editor.state.doc;doc.check();
        assert.equal(doc.childCount,prefix?3:2);
        assert.equal(doc.lastChild?.textContent,'After');
        if(prefix)assert.equal(doc.firstChild?.textContent,'Before');
        const block=doc.child(prefix?1:0);
        assert.equal(block.type.name,syntax.startsWith('|')?'table':'formula');
        if(block.type.name==='table')assert.equal(block.firstChild!.child(1).textContent,'Unit');
        else assert.equal(block.attrs.tex,'x^2');
      } finally {editor.destroy();}
    }
  } finally {window.close();}
});

/** 公式与折叠块：解析成节点、未改动时字节级无损、改动后重新生成标准 HTML。 */
const source = [
  '<p>环境温度 <span data-sidebar-formula="inline" data-tex="T_{amb} &gt; 38.5">T_{amb} &gt; 38.5</span> 时进入降额。</p>',
  '<div data-sidebar-formula="block" data-tex="P = f(T)">P = f(T)</div>',
  '<details data-sidebar-details="true"><summary>降额策略</summary><p>压缩机功率上限按上表执行。</p></details>',
].join('');

test('formula inline/block and details parse into typed nodes', () => {
  const model = new RichDocument(source);
  const types: string[] = [];
  model.document.content!.forEach(paragraph => {
    if (paragraph.type === 'formula') types.push('formula');
    if (paragraph.type === 'details') types.push('details');
    paragraph.content?.forEach(child => { if (child.type === 'formulaInline') types.push('formulaInline'); });
  });
  assert.deepEqual(types, ['formulaInline', 'formula', 'details']);
  const details = model.document.content!.find(node => node.type === 'details')!;
  assert.equal(details.content![0]!.type, 'detailsSummary');
  assert.equal(details.attrs!.open, false);
});

test('unchanged document serializes back to the exact source', () => {
  const model = new RichDocument(source);
  assert.equal(model.serialize(model.document), source);
});

test('inserting a new formula and details block serializes to standard markup', () => {
  const model = new RichDocument('<p>开头</p>');
  const next = { type: 'doc', content: [
    model.document.content![0]!,
    { type: 'formula', attrs: { tex: 'Q = m c \\Delta T' } },
    { type: 'details', attrs: { open: false }, content: [
      { type: 'detailsSummary', content: [{ type: 'text', text: '热量计算' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '见正文' }] },
    ] },
  ] };
  const saved = model.serialize(next);
  assert.ok(saved.includes('<p>开头</p>'));
  assert.ok(saved.includes('<div data-sidebar-formula="block" data-tex="Q = m c \\Delta T">Q = m c \\Delta T</div>'));
  // 新节点带便携默认样式（原生视图可读）；结构与语义必须正确。
  assert.ok(/<details[^>]*>/.test(saved) && saved.includes('<summary') && saved.includes('热量计算</summary>'));
  assert.ok(saved.includes('见正文'));
  // 重新解析可以无损往返。
  const reopened = new RichDocument(saved);
  assert.equal(reopened.serialize(reopened.document), saved);
});

test('editing formula tex updates data-tex and visible source together', () => {
  const model = new RichDocument('<p><span data-sidebar-formula="inline" data-tex="x">x</span></p>');
  const paragraph = model.document.content![0]!;
  const formula = { ...paragraph.content![0]!, attrs: { tex: 'x^2' } };
  const saved = model.serialize({ ...model.document, content: [{ ...paragraph, content: [formula] }] });
  assert.ok(saved.includes('data-tex="x^2"') && saved.includes('>x^2</span>'));
});

test('empty or oversized formula is rejected on serialize', () => {
  const model = new RichDocument('<p>x</p>');
  assert.throws(() => model.serialize({ type: 'doc', content: [{ type: 'formula', attrs: { tex: '' } }] }), /INVALID_FORMULA/);
  assert.throws(() => model.serialize({ type: 'doc', content: [{ type: 'formula', attrs: { tex: 'x'.repeat(4001) } }] }), /INVALID_FORMULA/);
});

test('danger callout tone round-trips', () => {
  const danger = '<table data-sidebar-callout="danger" cellpadding="12" cellspacing="0" style="width:100%;border-collapse:collapse;border:0"><tbody><tr><td style="background-color:#fef2f2;border:0;border-left:3px solid #b91c1c;padding:12px 16px"><p>风险项</p></td></tr></tbody></table>';
  const model = new RichDocument(danger);
  assert.equal(model.document.content![0]!.type, 'callout');
  assert.equal(model.document.content![0]!.attrs!.tone, 'danger');
  assert.equal(model.serialize(model.document), danger);
});
