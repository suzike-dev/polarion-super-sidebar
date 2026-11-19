import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,NodeSelection} from '@tiptap/pm/state';
import {richSchema} from '../../../packages/core/rich-schema.ts';
import {RichDocument} from '../../../packages/core/rich-document.ts';
import {placeBoardImage,replaceBoardPreview} from './board-placement.ts';

test('editing a board in a requirement table updates only its snapshot and keeps the original layout', () => {
  const original = 'workitemimg:sidebar-board-original.png';
  const updated = '00000000-0000-4000-8000-000000000002';
  const model = new RichDocument(`<table><tbody><tr><td colspan="2"><p>输入<img src="${original}" alt="自定义图注" title="实现图" width="318" height="126" style="float:right">输出</p></td></tr></tbody></table><div id="polarion_wiki macro name=include;params=x">保留宏</div>`);
  const state = EditorState.create({doc:richSchema.nodeFromJSON(model.document)});
  let pos = -1;
  state.doc.descendants((node, offset) => { if (node.type.name === 'image') pos = offset; });
  const before = state.doc.nodeAt(pos)!;
  const tr = replaceBoardPreview(state, pos, original, updated);
  assert.deepEqual({...tr.doc.nodeAt(pos)!.attrs}, {...before.attrs, src:'polarion-asset:' + updated, assetId:updated});
  assert.equal(tr.doc.textContent, state.doc.textContent);
  const html = model.serialize(tr.doc.toJSON());
  assert.ok(html.includes(`<img src="polarion-asset:${updated}" alt="自定义图注" title="实现图" width="318" height="126" style="float:right">`));
  assert.match(html, /<div id="polarion_wiki macro name=include;params=x">保留宏<\/div>/);
  assert.throws(() => replaceBoardPreview(state, pos, 'another.png', updated), /版本已变化/);
});

test('place a board at the clicked position or either document boundary without replacing text',()=>{
  const model=new RichDocument('<table><tr><td>first</td></tr></table><p>AB</p>');
  const state=EditorState.create({doc:richSchema.nodeFromJSON(model.document)});
  const attrs={assetId:'00000000-0000-4000-8000-000000000001',alt:'示例'};
  for(const pos of [0,state.doc.content.size-2,state.doc.content.size]){
    const tr=placeBoardImage(state,pos,attrs);
    tr.doc.check();assert.equal(tr.doc.textContent,'firstAB');
    assert.ok(tr.selection instanceof NodeSelection && tr.selection.node.attrs.assetId===attrs.assetId);
    const html=model.serialize(tr.doc.toJSON());
    if(pos===0)assert.ok(html.indexOf('<img')<html.indexOf('<table'));
    else if(pos===state.doc.content.size)assert.ok(html.indexOf('<img')>html.indexOf('AB'));
    else assert.match(html,/A<img[^>]+>B/);
  }
});
