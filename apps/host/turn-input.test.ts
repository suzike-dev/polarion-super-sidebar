import {test} from 'node:test';import assert from 'node:assert/strict';import {TurnInput} from './turn-input.ts';
test('one SDK input stays open across sequential turns, closes waiting consumers and rejects late messages',async()=>{
 const queue=new TurnInput<string>(),iterator=queue[Symbol.asyncIterator]();queue.push('first');assert.deepEqual(await iterator.next(),{value:'first',done:false});let received=false;const second=iterator.next().then(r=>{received=true;return r;});await Promise.resolve();assert.equal(received,false);queue.push('second');assert.deepEqual(await second,{value:'second',done:false});const pending=iterator.next();queue.close();assert.equal((await pending).done,true);assert.throws(()=>queue.push('late'),/ENGINE_INPUT_CLOSED/);
});
