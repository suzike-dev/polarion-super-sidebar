import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interactionInputValue,setInteractionAnswer} from './interaction-values.ts';
import {mcpForm} from '../../host/interactions.ts';
import type {InteractionValues} from '../../../packages/protocol/index.ts';

test('clearing native numeric and boolean controls makes required fields absent while preserving valid zero and false',()=>{
  const {validate}=mcpForm({serverName:'controlled-test',message:'Values',requestedSchema:{type:'object',properties:{count:{type:'integer',minimum:0},enabled:{type:'boolean'}},required:['count','enabled'],additionalProperties:false}});
  let values:InteractionValues={};
  values=setInteractionAnswer(values,'count',interactionInputValue('integer','0'));
  values=setInteractionAnswer(values,'enabled',interactionInputValue('boolean','false'));
  assert.deepEqual(values,{count:0,enabled:false});validate(values);
  const clearedCount=setInteractionAnswer(values,'count',interactionInputValue('integer',''));
  assert.equal(Object.hasOwn(clearedCount,'count'),false);assert.throws(()=>validate(clearedCount),/校验失败/);
  const clearedBoolean=setInteractionAnswer(values,'enabled',interactionInputValue('boolean',''));
  assert.equal(Object.hasOwn(clearedBoolean,'enabled'),false);assert.throws(()=>validate(clearedBoolean),/校验失败/);
  assert.deepEqual(values,{count:0,enabled:false});
});

test('native input conversion retains decimal numbers and text without inventing values for empty controls',()=>{
  assert.equal(interactionInputValue('number','1.25'),1.25);
  assert.equal(interactionInputValue('number',''),undefined);
  assert.equal(interactionInputValue('string','0'),'0');
  assert.equal(interactionInputValue('string',''),undefined);
  assert.equal(interactionInputValue('boolean','true'),true);
  assert.equal(interactionInputValue('boolean','not-an-option'),undefined);
});
