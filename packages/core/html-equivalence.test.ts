import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalStyle,equivalentHtml} from './html-equivalence.ts';
test('accept only serialization-equivalent HTML and retain content/format/object boundaries',()=>{
 assert(equivalentHtml('<p style="color:red; text-align:center;"><img src="workitemimg:a.png" width="20"></p>','<p style="color: red;text-align: center"><img width="20" src="workitemimg:a.png"/></p>'));
 for(const html of ['<p>same</p>','<h2 style="color:blue">same</h2>','<h2 style="color:red">changed</h2>','same<br>'])assert(!equivalentHtml('<h2 style="color:red">same</h2>',html));
 assert(!equivalentHtml('<img src="workitemimg:a.png">','<img src="workitemimg:b.png">'));
 assert(!equivalentHtml('<p style="margin:0;margin-left:8px">x</p>','<p style="margin-left:8px;margin:0">x</p>'));
 assert(!equivalentHtml('<p>A  B</p>','<p>A B</p>'));
});
test('CSS normalization preserves quoted semicolons, custom values and declaration order',()=>{
 assert.equal(canonicalStyle(' content: "a; b:c"; background:url("data:image/png;a:b"); --X: 1;'),'content:"a; b:c";background:url("data:image/png;a:b");--X:1');
 assert.notEqual(canonicalStyle('unknown: one'),canonicalStyle('unknown: two'));
});
