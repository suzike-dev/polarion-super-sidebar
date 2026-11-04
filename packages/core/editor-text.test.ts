import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,TextSelection} from '@tiptap/pm/state';
import {richSchema} from './rich-schema.ts';
import {findTextMatches,parseTsv,replaceSelectedMatch,replaceAllMatches} from './editor-text.ts';
test('quoted TSV preserves multiline cells, tabs, escaped quotes and engineering values',()=>{
  assert.deepEqual(parseTsv('001\t"第一行\r\n第二行"\t25 °C\r\n002\t"a\tb ""quoted"""\t1.0E-3\r\n'),[['001','第一行\n第二行','25 °C'],['002','a\tb "quoted"','1.0E-3']]);
  assert.deepEqual(parseTsv('A\t\nB\tC\t'),[['A','',''],['B','C','']]);
  assert.throws(()=>parseTsv('A\t"unfinished'),/未闭合/);assert.throws(()=>parseTsv('A\t"B"tail'),/格式不完整/);
  assert.throws(()=>parseTsv('a\tb',500,1),/最多/);assert.throws(()=>parseTsv('a\tb\nc\td',1),/最多/);
});
test('replace all preserves structural boundaries and changes every match in one transaction',()=>{
 const p=richSchema.node('paragraph',null,[richSchema.text('Alpha '),richSchema.text('ALPHA',[richSchema.mark('bold')]),richSchema.node('image',{src:'workitemimg:x'}),richSchema.text('alpha')]);
 const state=EditorState.create({doc:richSchema.node('doc',null,p)});
 assert.equal(findTextMatches(state.doc,'alpha',false).length,3);assert.equal(findTextMatches(state.doc,'alpha',true).length,1);
 const result=replaceAllMatches(state,'alpha','β',false);assert.equal(result.count,3);assert.equal(result.tr.doc.textContent,'β ββ');assert.equal(result.tr.doc.firstChild!.child(2).type.name,'image');assert.equal(result.tr.doc.firstChild!.child(1).marks[0]!.type.name,'bold');
});
test('search spans formatting marks but never crosses blocks or inline objects',()=>{
  const p=richSchema.node('paragraph',null,[richSchema.text('温度'),richSchema.text('阈值',[richSchema.mark('bold')]),richSchema.text('条件')]);
  const barrier=richSchema.node('paragraph',null,[richSchema.text('温度'),richSchema.node('image',{src:'workitemimg:x'}),richSchema.text('阈值')]);
  const doc=richSchema.node('doc',null,[p,barrier,richSchema.node('paragraph',null,richSchema.text('温度')),richSchema.node('paragraph',null,richSchema.text('阈值'))]);
  assert.deepEqual(findTextMatches(doc,'温度阈值'),[{from:1,to:5}]);assert.deepEqual(findTextMatches(doc,''),[]);
  const state=EditorState.create({doc,selection:TextSelection.create(doc,1,5)}),tr=replaceSelectedMatch(state,'温度阈值','');assert.ok(tr);assert.equal(tr.doc.firstChild!.textContent,'条件');assert.ok(tr.doc.child(1).eq(barrier));
  const replaced=replaceSelectedMatch(state,'温度阈值','目标');assert.equal(replaced!.doc.firstChild!.textContent,'目标条件');
  assert.equal(replaceSelectedMatch(state,'错误选区',''),null);
});
