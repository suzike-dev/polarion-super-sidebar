import test from 'node:test';
import assert from 'node:assert/strict';
import {diffText, diffTextParts} from './text-diff.ts';

test('Chinese whole-word replacement keeps surrounding text as same', () => {
  const diff = diffText('温度上限为 45°C。', '温度上限为 50°C。');
  assert.equal(diff.before.map(part => part.text).join(''), '温度上限为 45°C。');
  assert.equal(diff.after.map(part => part.text).join(''), '温度上限为 50°C。');
  assert.ok(diff.before.some(part => part.kind === 'del' && part.text.includes('45')));
  assert.ok(diff.after.some(part => part.kind === 'ins' && part.text.includes('50')));
  assert.deepEqual(diff.before.filter(part => part.kind === 'same').map(part => part.text).join(''), '温度上限为 °C。');
});

test('English word changes do not delete unchanged words', () => {
  const diff = diffText('Set the temperature limit to 45 degrees.', 'Set the temperature limit to 50 degrees.');
  assert.ok(diff.before.some(part => part.kind === 'del' && part.text.includes('45')));
  assert.ok(diff.after.some(part => part.kind === 'ins' && part.text.includes('50')));
  assert.equal(diff.before.filter(part => part.kind === 'same').map(part => part.text).join(''), 'Set the temperature limit to  degrees.');
});

test('identical text produces only a same segment', () => {
  const diff = diffText('保持不变', '保持不变');
  assert.deepEqual(diff.before, [{kind: 'same', text: '保持不变'}]);
  assert.deepEqual(diff.after, [{kind: 'same', text: '保持不变'}]);
});

test('large blocks fall back to prefix/suffix without losing text', () => {
  const before = '甲'.repeat(7000) + '旧' + '乙'.repeat(100);
  const after = '甲'.repeat(7000) + '新' + '乙'.repeat(100);
  const diff = diffText(before, after);
  assert.equal(diff.before.map(part => part.text).join(''), before);
  assert.equal(diff.after.map(part => part.text).join(''), after);
  assert.ok(diff.before.some(part => part.kind === 'del' && part.text === '旧'));
  assert.ok(diff.after.some(part => part.kind === 'ins' && part.text === '新'));
});


test('change groups pair the deleted and inserted text for hover linking', () => {
  const parts = diffTextParts('温度上限为 45°C。', '温度上限为 50°C。');
  const change = parts.find(part => part.kind === 'change');
  assert.ok(change && change.kind === 'change');
  assert.equal(change.before, '45');
  assert.equal(change.after, '50');
});

test('pure insertion and deletion produce one-sided change groups', () => {
  const inserted = diffTextParts('温度上限', '温度上限高').find(part => part.kind === 'change');
  assert.ok(inserted && inserted.kind === 'change');
  assert.equal(inserted.before, undefined);
  assert.equal(inserted.after, '高');
  const deleted = diffTextParts('温度上限高', '温度上限').find(part => part.kind === 'change');
  assert.ok(deleted && deleted.kind === 'change');
  assert.equal(deleted.before, '高');
  assert.equal(deleted.after, undefined);
});
