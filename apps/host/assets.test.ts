import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { Assets, extractDocument } from './assets.ts';
import { Store } from './store.ts';
const target={origin:'https://polarion.pufafen.com' as const,projectId:'test01',document:'Requirements/fixture'};
test('chunked attachments are immutable after completion, preserve bytes, and enforce project scope',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'polarion-assets-test-'));const store=new Store(':memory:');const assets=new Assets(store,folder);
  try{const bytes=Buffer.from('阈值 001.50 °C');const a=assets.begin(target,'matrix.txt','text/plain',bytes.length);
    assert.throws(()=>assets.finish(a.id),/ASSET_INCOMPLETE/);const part=bytes.subarray(0,5).toString('base64');assets.chunk(a.id,0,part);assert.equal(assets.chunk(a.id,0,part).received,5);
    assert.throws(()=>assets.chunk(a.id,1,'YWJj'),/ASSET_OFFSET_MISMATCH/);assets.chunk(a.id,5,bytes.subarray(5).toString('base64'));const done=assets.finish(a.id);assert.equal(done.extraction,'text');assert.equal(assets.require(a.id).text,'阈值 001.50 °C');assert.deepEqual(assets.bytes(a.id),bytes);
    assert.throws(()=>assets.chunk(a.id,0,part),/ASSET_ALREADY_COMPLETE/);assert.throws(()=>assets.require(a.id,{...target,projectId:'another'}),/ASSET_PROJECT_MISMATCH/);
    const s=store.createSession(target,'attachments');const result=store.startRun(s.id,crypto.randomUUID(),'read',[],target,[a.id]);assert.deepEqual(result.run.attachments,[a.id]);assert.equal((store.events(s.id,0)[0]!.data as any).attachments[0].sha256,done.sha256);
  }finally{store.close();for(const file of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,file));fs.rmdirSync(folder);}
});
test('Office extraction retains engineering text and table order without rewriting source files',()=>{
  const docx=Buffer.from(zipSync({'word/document.xml':strToU8('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>阈值 001.50</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>25 °C</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>末段</w:t></w:r></w:p></w:body></w:document>')}));
  const text=extractDocument(docx,'test.docx').text!;assert.ok(text.indexOf('阈值 001.50')<text.indexOf('25 °C'));assert.ok(text.indexOf('25 °C')<text.indexOf('末段'));
  const xlsx=Buffer.from(zipSync({'xl/sharedStrings.xml':strToU8('<sst><si><t>001.50</t></si></sst>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>25.00</v></c></row></sheetData></worksheet>')}));
  const cells=extractDocument(xlsx,'test.xlsx').text!;assert.match(cells,/A1: 001\.50\tB1: 25\.00/);
});
