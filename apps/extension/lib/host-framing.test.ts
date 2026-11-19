import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FRAME_RAW_BYTES, FrameAssembler, base64ToBytes, bytesToBase64, splitJsonFrames} from './host-framing.ts';

test('分帧往返：中文多字节跨帧边界不丢不坏', () => {
  const json = JSON.stringify({ id: 'r1', text: '需求应尽快退出高压状态，VCU_BATT_PWRON 由 0x0 跳变为 0x1。'.repeat(40) });
  const frames = splitJsonFrames('request', 'r1', json, 37); // 37 字节小帧：必然切断多字节字符
  assert.ok(frames.length > 5);
  assert.ok(frames.every(frame => frame.__chunk.id === 'r1' && frame.__chunk.total === frames.length));
  // 乱序送入也能聚合
  const assembler = new FrameAssembler();
  let restored: string | null = null;
  for (const frame of [...frames].reverse()) restored = assembler.accept(frame.__chunk) ?? restored;
  assert.equal(restored, json);
  assert.deepEqual(JSON.parse(restored!), { id: 'r1', text: JSON.parse(json).text });
});

test('未超限不分帧；空帧与越界帧不破坏聚合', () => {
  assert.deepEqual(splitJsonFrames('reply', 'x', '{"ok":true}'), []);
  const assembler = new FrameAssembler();
  assert.equal(assembler.accept({ kind: 'reply', id: 'y', seq: 5, total: 2, data: '' }), null); // 越界 seq 忽略
  assert.equal(assembler.accept({ kind: 'reply', id: 'y', seq: 0, total: 2, data: bytesToBase64(new TextEncoder().encode('{"a":')) }), null);
  assert.equal(assembler.accept({ kind: 'reply', id: 'y', seq: 1, total: 2, data: bytesToBase64(new TextEncoder().encode('1}')) }), '{"a":1}');
  assert.deepEqual([...base64ToBytes(bytesToBase64(new Uint8Array([0, 127, 255])))], [0, 127, 255]);
});

test('单帧 JSON 消息必须小于 Chrome 1MB 上限（防回归：帧内 base64 膨胀会顶爆）', () => {
  const raw = 'x'.repeat(FRAME_RAW_BYTES);
  const [frame] = splitJsonFrames('reply', 'big', JSON.stringify({ data: raw }));
  const message = JSON.stringify(frame);
  assert.ok(message.length < 1_000_000, `帧消息 ${message.length} 字节超限`);
  assert.ok(message.length > 800_000); // 也确认帧确实装满了（640KB → ≈853KB）
});
