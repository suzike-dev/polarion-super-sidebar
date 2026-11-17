import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RichDocument } from './rich-document.ts';
import { applyBlockOperations } from './block-ops.ts';

const html = '<p>开头段</p><p>规则一：温度 25 °C，压力 101 kPa</p><h2>既有标题</h2><p>结尾段</p>';

const model = () => new RichDocument(html);
const types = (document: ReturnType<RichDocument['serialize']> extends never ? never : any) => document.content!.map((node: any) => node.type);

test('set_type converts paragraph to heading and back, keeping text and marks', () => {
  const base = model();
  const promoted = applyBlockOperations(base.document, [{ op: 'set_type', target: '规则一', block: { heading: 3 } }]);
  assert.equal(promoted.changes.typed, 1);
  const saved = base.serialize(promoted.document);
  assert.ok(saved.includes('<h3') && saved.includes('规则一'));
  const back = applyBlockOperations(promoted.document, [{ op: 'set_type', target: '规则一', block: 'paragraph' }]);
  assert.ok(base.serialize(back.document).includes('规则一：温度'));
});

test('insert places new blocks at start, after an anchor and at the end', () => {
  const base = model();
  const { document } = applyBlockOperations(base.document, [
    { op: 'insert', at: 'start', block: { type: 'heading', level: 1, text: '新增总标题' } },
    { op: 'insert', after: '规则一', block: { type: 'paragraph', text: '新增补充段' } },
    { op: 'insert', block: { type: 'bulletList', items: ['条目A', '条目B'] } },
  ]);
  const reopened = new RichDocument(base.serialize(document));
  const kinds = reopened.document.content!.map(node => node.type);
  assert.deepEqual(kinds, ['heading', 'paragraph', 'paragraph', 'paragraph', 'heading', 'paragraph', 'bulletList']);
  assert.match(JSON.stringify(reopened.document.content!.at(-1)), /条目A/);
});

test('move, split and merge reorganize blocks with text intact', () => {
  const base = model();
  const moved = applyBlockOperations(base.document, [{ op: 'move', target: '结尾段', after: 'start' }]);
  const movedAfter = applyBlockOperations(base.document, [{ op: 'move', target: '开头段', after: '规则一' }]);
  assert.match(String(movedAfter.document.content![1]!.content![0]!.text ?? ''), /开头段/);
  const mergedPrevious = applyBlockOperations(base.document, [{ op: 'merge', target: '规则一', direction: 'previous' }]);
  assert.match(String(mergedPrevious.document.content![0]!.content!.map((c: any) => c.text ?? '').join('')), /开头段规则一/);
  assert.equal(moved.changes.moved, 1);
  assert.equal(types(moved.document)[0], 'paragraph');
  assert.match(String(moved.document.content![0]!.content![0]!.text ?? ''), /结尾段/);
  const split = applyBlockOperations(base.document, [{ op: 'split', target: '规则一', afterText: '温度 25 °C' }]);
  assert.equal(split.changes.split, 1);
  assert.equal(split.document.content!.length, base.document.content!.length + 1);
  assert.match(String(split.document.content![1]!.content![0]!.text ?? ''), /温度 25 °C/);
  assert.match(String(split.document.content![2]!.content![0]!.text ?? ''), /压力/);
  // 真实序列化：拆分不得复制 sourceText 锚点（否则 DUPLICATE_RICH_ANCHOR），且往返一致。
  const splitSaved = base.serialize(split.document);
  const splitReopened = new RichDocument(splitSaved);
  assert.equal(splitReopened.serialize(splitReopened.document), splitSaved);
  assert.match(splitSaved, /温度 25 °C/);
  const merged = applyBlockOperations(base.document, [{ op: 'merge', target: '开头段', direction: 'next' }]);
  assert.equal(merged.changes.merged, 1);
  assert.match(String(merged.document.content![0]!.content!.map((c: any) => c.text ?? '').join('')), /开头段规则一/);
});

test('delete removes a block while protected blocks are refused', () => {
  const base = model();
  const removed = applyBlockOperations(base.document, [{ op: 'delete', target: '规则一' }]);
  assert.equal(removed.changes.deleted, 1);
  assert.ok(!base.serialize(removed.document).includes('压力 101'));
  // 受保护块本身不可按文字定位（文本不外露）；含受保护内联对象的段落可定位但拒绝删除。
  const guarded = new RichDocument('<p>前置</p><div id="polarion_wiki macro name=custom;params=x">opaque</div>');
  assert.throws(() => applyBlockOperations(guarded.document, [{ op: 'delete', target: 'opaque' }]), /BLOCK_NOT_FOUND/);
  const inlineGuarded = new RichDocument('<p>说明文字<span id="polarion_wiki macro name=custom;params=x">keep</span>结尾</p>');
  assert.throws(() => applyBlockOperations(inlineGuarded.document, [{ op: 'delete', target: '说明文字' }]), /BLOCK_PROTECTED/);
  assert.throws(() => applyBlockOperations(base.document, [{ op: 'delete', target: '不存在的段落' }]), /BLOCK_NOT_FOUND/);
  assert.throws(() => applyBlockOperations(base.document, [{ op: 'delete', target: '段' }]), /BLOCK_AMBIGUOUS/);
});


test('lift turns a numbered list item into a heading and splits the list around it', () => {
  const base = new RichDocument('<ol><li>1 概述</li><li>1.1 子项</li><li>2 结尾</li></ol><p>正文</p>');
  const lifted = applyBlockOperations(base.document, [{ op: 'lift', target: '1.1 子项', block: { heading: 2 } }]);
  assert.equal(lifted.changes.lifted, 1);
  const saved = base.serialize(lifted.document);
  const reopened = new RichDocument(saved);
  const kinds = reopened.document.content!.map(node => node.type);
  assert.deepEqual(kinds, ['orderedList', 'heading', 'orderedList', 'paragraph']);
  assert.match(saved, /1 概述/);
  assert.match(saved, /1\.1 子项/);
  assert.match(saved, /2 结尾/);
  assert.equal(reopened.serialize(reopened.document), saved);
  const complex = new RichDocument('<ol><li>外层<ul><li>嵌套</li></ul></li></ol>');
  assert.throws(() => applyBlockOperations(complex.document, [{ op: 'lift', target: '外层', block: 'paragraph' }]), /LIST_ITEM_COMPLEX/);
});
