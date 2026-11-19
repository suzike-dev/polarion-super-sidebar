import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectBoardCode} from './board-code.ts';

test('preview recognizes Mermaid and board diagram JSON, and leaves other code alone',()=>{
  assert.equal(detectBoardCode('mermaid','flowchart LR\n A-->B')?.format,'mermaid');
  assert.equal(detectBoardCode('', '%% 边界\nsequenceDiagram\nA->>B: hello')?.format,'mermaid');
  assert.equal(detectBoardCode('json','{"title":"流程","summary":"说明","nodes":[{"id":"a","text":"输入"}]}')?.format,'diagram');
  assert.equal(detectBoardCode('json','{"message":"hello"}'),null);
  assert.equal(detectBoardCode('javascript','graph = new Map()'),null);
});
