import test from 'node:test';
import assert from 'node:assert/strict';
import { LosslessHtml } from './lossless-html.ts';

const html = `<p id='lead' style="margin:0">中文 &amp; emoji 🚙</p><!--keep--><table id="polarion_wiki macro name=table;params=width=100%|uid=3"><tbody><tr><td rowspan="2" style='width:50%;'>A&nbsp;B</td><td><em>阈值 20</em></td></tr></tbody></table><div id="polarion_wiki macro name=unknown;params=x=y">opaque</div><img src="attachment:figure.png?revision=42"/><svg><text>formula</text></svg>`;

test('no-op preserves source byte-for-byte including entities, macros and markup spelling', () => {
  const draft = new LosslessHtml(html);
  assert.equal(draft.source, html);
  assert.equal(draft.replaceText(draft.version, []).source, html);
});
test('editing one table cell preserves every unrelated byte', () => {
  const draft = new LosslessHtml(html); const node = draft.nodes.find(n => n.text === '阈值 20')!;
  const result = draft.replaceText(draft.version, [{ nodeId: node.id, expectedText: '阈值 20', text: '阈值 25' }]);
  assert.equal(result.source, html.replace('阈值 20', '阈值 25'));
  assert.notEqual(result.version, draft.version);
  assert.equal(draft.source, html);
});
test('new text is escaped and cannot create executable HTML', () => {
  const draft = new LosslessHtml('<p>old</p>'); const node = draft.nodes.find(n => n.text === 'old')!;
  assert.equal(draft.replaceText(draft.version, [{nodeId:node.id,expectedText:'old',text:'<script>&中文'}]).source, '<p>&lt;script&gt;&amp;中文</p>');
});
test('decoded entity text and UTF16 offsets map to exact original bytes', () => {
  const draft = new LosslessHtml(html); const node = draft.nodes.find(n => n.text === 'A\u00a0B')!;
  assert.equal(draft.replaceText(draft.version,[{nodeId:node.id,expectedText:'A\u00a0B',text:'A & B'}]).source,html.replace('A&nbsp;B','A &amp; B'));
});
test('same-value editor updates preserve original entity spelling and draft version', () => {
  const draft=new LosslessHtml('<p>&#65;&nbsp;&#x1F699;</p>');const node=draft.nodes.find(n=>n.text)!;
  const result=draft.replaceText(draft.version,[{nodeId:node.id,expectedText:node.text!,text:node.text!}]);
  assert.equal(result,draft);
  assert.equal(result.source,'<p>&#65;&nbsp;&#x1F699;</p>');
});
test('new non-BMP text uses the verified Polarion-compatible entity representation', () => {
  const draft=new LosslessHtml('<p>old</p>');const node=draft.nodes.find(n=>n.text==='old')!;
  const updated=draft.replaceText(draft.version,[{nodeId:node.id,expectedText:'old',text:'中文🚙𝛼'}]);
  assert.equal(updated.source,'<p>中文&#x1F699;&#x1D6FC;</p>');
  assert.equal(updated.nodes.find(n=>n.text)?.text,'中文🚙𝛼');
});
test('XML control characters are rejected before a draft patch is applied', () => {
  const draft=new LosslessHtml('<p>old</p>');const node=draft.nodes.find(n=>n.text==='old')!;
  assert.throws(()=>draft.replaceText(draft.version,[{nodeId:node.id,expectedText:'old',text:'bad\u0000text'}]),/INVALID_XML_TEXT/);
});
test('stale version, anchor and text are rejected', () => {
  const draft = new LosslessHtml('<p>old</p>'); const node = draft.nodes.find(n=>n.text==='old')!;
  const change={nodeId:node.id,expectedText:'old',text:'new'};
  assert.throws(()=>draft.replaceText('stale',[change]),/STALE_DRAFT/);
  assert.throws(()=>new LosslessHtml('<p>old</p>').replaceText(draft.version,[change]),/STALE_DRAFT/);
  assert.throws(()=>draft.replaceText(draft.version,[{...change,nodeId:'unknown'}]),/STALE_ANCHOR/);
  assert.throws(()=>draft.replaceText(draft.version,[{...change,expectedText:'different'}]),/TEXT_DRIFT/);
});
test('overlapping edits fail atomically', () => {
  const draft=new LosslessHtml('<p>old</p>');const node=draft.nodes.find(n=>n.text==='old')!;
  const change={nodeId:node.id,expectedText:'old',text:'new'};
  assert.throws(()=>draft.replaceText(draft.version,[change,change]),/OVERLAPPING_EDITS/);
  assert.equal(draft.source,'<p>old</p>');
});
test('unknown macros and active content remain opaque', () => {
  const draft=new LosslessHtml(html+'<script>payload</script>');
  for(const text of ['opaque','formula','payload'])assert.equal(draft.nodes.some(n=>n.text===text),false);
  const node=draft.nodes.find(n=>n.polarionId?.includes('name=unknown'))!;
  assert.throws(()=>draft.replaceText(draft.version,[{nodeId:node.id,expectedText:'opaque',text:'new'}]),/OPAQUE_NODE/);
});
test('parameterless table macros keep cell text editable (LiveDoc export spelling)', () => {
  // LiveDoc 导出的表格宏 id 以宏名直接结尾，不带 `;params`（SPE-908 实测形态）。
  const source='<table id="polarion_wiki macro name=table" class="polarion-Document-table"><tbody><tr><td>吹面</td><td>＜[21,24]</td></tr></tbody></table>';
  const draft=new LosslessHtml(source);const cell=draft.nodes.find(n=>n.text==='吹面');
  assert.ok(cell,'table cell text must be an editable leaf');
  assert.equal(draft.replaceText(draft.version,[{nodeId:cell.id,expectedText:'吹面',text:'吹脚'}]).source,source.replace('吹面','吹脚'));
});
test('moving a whole block retains identities and all internal markup', () => {
  const draft=new LosslessHtml('<p id="a">A</p><div id="b">B</div><p id="c">C</p>');
  const [a,b,c]=draft.nodes.filter(n=>n.topLevel);
  assert.equal(draft.moveBefore(draft.version,c.id,a.id).source,'<p id="c">C</p><p id="a">A</p><div id="b">B</div>');
  assert.equal(draft.moveBefore(draft.version,a.id,null).source,'<div id="b">B</div><p id="c">C</p><p id="a">A</p>');
  assert.equal(draft.moveBefore(draft.version,a.id,b.id).source,draft.source);
});
test('nested table moves require structural validation', () => {
  const draft=new LosslessHtml(html);const cell=draft.nodes.find(n=>n.tag==='td')!;
  assert.throws(()=>draft.moveBefore(draft.version,cell.id,null),/STRUCTURE_REQUIRED/);
});
