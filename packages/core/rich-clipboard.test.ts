import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {richSchema} from './rich-schema.ts';
import {imageClipboardSerializer,internalClipboardImage,type ClipboardOwner} from './rich-clipboard.ts';
const owner:ClipboardOwner={target:{origin:'https://polarion.pufafen.com',projectId:'project',document:'Space/Doc'},workItemId:'REQ-1'};
test('clipboard image carries item ownership and preserves local/native image references',()=>{
  const document=new JSDOM('').window.document,serializer=imageClipboardSerializer(richSchema,owner);
  for(const src of ['workitemimg:image.png','attachment:diagram.png','polarion-asset:00000000-0000-0000-0000-000000000000']){
    const image=serializer.serializeNode(richSchema.node('image',{src,width:409,height:268,alt:'图示'}),{document}) as Element;
    assert.equal(internalClipboardImage(image,owner),src);assert.equal(image.getAttribute('width'),'409');assert.equal(image.getAttribute('alt'),'图示');
    assert.throws(()=>internalClipboardImage(image,{...owner,workItemId:'REQ-2'}),/其他工作项/);
    assert.throws(()=>internalClipboardImage(image,{...owner,target:{...owner.target,projectId:'other'}}),/其他工作项/);
    image.removeAttribute('data-sidebar-image-owner');assert.throws(()=>internalClipboardImage(image,owner),/来源无法确认/);
  }
  const external=document.createElement('img');external.src='https://example.test/picture.png';assert.equal(internalClipboardImage(external,owner),null);
});
