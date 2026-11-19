import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureExperienceSelection, formatExperienceIntent, experienceLimitError, experienceHistory, selectedRangeWithin } from './experience-selection.ts';

function fixture(html: string) {
  const dom = new JSDOM('<main></main>');
  const doc = dom.window.document;
  const shadow = doc.querySelector('main')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<article>${html}</article><aside>右栏</aside>`;
  const article = shadow.querySelector('article')!;
  const range = doc.createRange();
  return { dom, doc, shadow, article, range };
}

test('ShadowRoot 内从第二处重复句起选，保留跨行文字及所选位置的上下文', () => {
  const { dom, shadow, article, range } = fixture('<h2>甲</h2><p>重复句。</p><h2>乙</h2><ul><li>重复<strong>句。</strong></li><li>继续检查，完成。</li></ul>');
  range.setStart(article.querySelector('li')!.firstChild!, 0);
  range.setEnd(article.querySelectorAll('li')[1]!.firstChild!, 4);
  Object.defineProperty(shadow, 'getSelection', { value: () => ({ rangeCount: 1, getRangeAt: () => range }) });
  const quote = captureExperienceSelection(article, 'saved');
  assert.ok(quote);
  assert.equal(quote.text, '重复句。\n继续检查');
  assert.equal(quote.before, '甲\n重复句。\n乙\n');
  assert.equal(quote.after, '，完成。');
  assert.match(quote.location, /已保存.*4 行.*5 行/);
  dom.window.close();
});

test('区分回答、侧栏其他区和原生正文的选区', () => {
  const { dom, doc, shadow, article, range } = fixture('<p>只引用这个片段</p>');
  Object.defineProperty(doc, 'getSelection', { value: () => ({ getComposedRanges: () => [range] }) });
  range.selectNodeContents(article.querySelector('p')!);
  assert.equal(selectedRangeWithin(article)?.toString(), '只引用这个片段');
  assert.equal(selectedRangeWithin(shadow)?.toString(), '只引用这个片段');
  range.selectNodeContents(shadow.querySelector('aside')!);
  assert.equal(selectedRangeWithin(article), null);
  const native = doc.body.appendChild(doc.createTextNode('原生正文'));
  range.selectNodeContents(native);
  assert.equal(selectedRangeWithin(shadow), null);
  dom.window.close();
});

test('序列化引用后检查完整请求长度，支持精确边界并保留最后 24 条消息', () => {
  const quote = { text: '第二处', before: '乙\n', after: '后文', location: '新版预览 · 第 4 行' };
  const intent = formatExperienceIntent('改短一些', quote);
  for (const part of ['改短一些', quote.text, quote.before, quote.after, quote.location]) assert.ok(intent.includes(part));
  assert.equal(formatExperienceIntent(' 改短一些 ', null), '改短一些');
  assert.equal(experienceLimitError('文'.repeat(20000), '😀'.repeat(2000)), '');
  assert.match(experienceLimitError('', formatExperienceIntent('文'.repeat(4000), quote)), /4000/);
  assert.match(experienceLimitError('文'.repeat(20001), intent), /20000/);
  const chat = Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: String(i) }));
  chat.push({ role: 'user', text: '最后的提问', quote } as typeof chat[number]);
  const messages = experienceHistory(chat, intent);
  assert.equal(messages.length, 24);
  assert.equal(messages[0]?.text, '8');
  assert.ok(messages.at(-2)?.text.includes('第二处'));
  assert.deepEqual(messages.at(-1), { role: 'user', text: intent });
});
