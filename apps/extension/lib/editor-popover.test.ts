import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorPopoverPlacement} from './editor-popover.ts';

test('short editor above the mobile assistant retains reachable form actions',()=>{
  const p=editorPopoverPlacement({left:8,right:382,top:8,bottom:236},182,{width:390,height:480},540);
  assert.ok(p.top>=16);assert.ok(p.top+p.maxHeight<=228);
  assert.ok(p.maxHeight>=180);assert.ok(p.left+p.width<=374);
});
test('desktop panels stay below their toolbar when space is available',()=>{
  const p=editorPopoverPlacement({left:18,right:1004,top:18,bottom:882},220,{width:1440,height:900},380);
  assert.equal(p.top,226);assert.equal(p.width,414);assert.ok(p.top+p.maxHeight<=874);
});
test('viewport clipping and resizing cannot put a panel beyond the visible editor',()=>{
  for(const width of [320,390,768,1440])for(const height of [320,400,480,900]){
    const p=editorPopoverPlacement({left:8,right:width+200,top:8,bottom:height+200},height-50,{width,height},620);
    assert.ok(p.top>=8&&p.left>=8);assert.ok(p.width>0&&p.maxHeight>0);
    assert.ok(p.left+p.width<=width-8);assert.ok(p.top+p.maxHeight<=height-8);
  }
});
