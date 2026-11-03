/** A live SDK input stream: completing one turn does not close the CLI stdin. */
export class TurnInput<T> implements AsyncIterable<T>{
 private values:T[]=[];private waiting?: (value:IteratorResult<T>)=>void;private closed=false;
 push(value:T){if(this.closed)throw Error('ENGINE_INPUT_CLOSED');if(this.waiting){const resolve=this.waiting;this.waiting=undefined;resolve({value,done:false});}else this.values.push(value);}
 close(){this.closed=true;this.values=[];this.waiting?.({value:undefined,done:true});this.waiting=undefined;}
 [Symbol.asyncIterator]():AsyncIterator<T>{return{next:()=>{if(this.values.length)return Promise.resolve({value:this.values.shift()!,done:false});if(this.closed)return Promise.resolve({value:undefined,done:true});if(this.waiting)return Promise.reject(Error('MULTIPLE_INPUT_READERS'));return new Promise(resolve=>{this.waiting=resolve;});},return:async()=>{this.close();return{value:undefined,done:true};}};}
}
