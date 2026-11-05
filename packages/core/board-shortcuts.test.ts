import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BOARD_SHORTCUTS} from './board-shortcuts.ts';

test('shortcut catalogue groups are well-formed and cover the product keys',()=>{
  assert.ok(BOARD_SHORTCUTS.length>=4);
  const all=BOARD_SHORTCUTS.flatMap(group=>group.items);
  assert.ok(new Set(all.map(item=>item.keys)).size===all.length,'no duplicate key entries');
  for(const group of BOARD_SHORTCUTS){
    assert.ok(group.title.trim().length>0,'group has a title');
    assert.ok(group.items.length>0,'group is not empty');
    for(const item of group.items){
      assert.ok(item.keys.trim().length>0&&item.label.trim().length>0,'entries are labelled');
    }
  }
  const keys=all.map(item=>item.keys);
  // 产品自定义键必须在册：C 快速连接、N 便签、Shift+G 网格、5 箭头、6 线条。
  for(const required of ['C','N','Shift+G','5','6'])assert.ok(keys.includes(required),`missing ${required}`);
  // 箭头条目必须说明它是唯一可吸附的连线，直线条目必须说明不吸附。
  assert.match(all.find(item=>item.keys==='5')!.label,/吸附/);
  assert.match(all.find(item=>item.keys==='6')!.label,/不参与吸附/);
  // 数字工具键 1-9、0 与 H 齐全。
  for(const digit of ['1','2','3','4','7','8','9','0','H'])assert.ok(keys.includes(digit),`missing ${digit}`);
});
