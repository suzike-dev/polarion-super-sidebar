/**
 * Native Messaging 分帧（Chrome 单条消息硬上限 1MB）。
 * 关键约束：帧内的 data 是 base64 字符串，base64 膨胀 4/3，JSON 还有外壳开销。
 * 因此原始字节帧必须 ≤ 640_000（base64 ≈ 853KB + 外壳 < 1MB），否则帧本身仍超限。
 * 请求与响应共用同一常量；bridge（Node 侧）与 background（扩展侧）各自实现同一协议：
 *   {__chunk:{kind:'request'|'reply', id, seq, total, data}}  —— each data is base64 of one byte-slice
 * 收齐后按 seq 顺序逐帧 base64 解码、按字节拼接、再 UTF-8 解码。
 */
export const FRAME_RAW_BYTES = 640_000;

export type FrameChunk = { __chunk: { kind: 'request' | 'reply'; id: string; seq: number; total: number; data: string } };

/** 字节 → base64（分块转换，避免 fromCharCode 参数过多爆栈）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 把一段 JSON 文本切成请求帧；未超限时返回空数组（调用方直接发原文）。 */
export function splitJsonFrames(kind: 'request' | 'reply', id: string, json: string, limit = FRAME_RAW_BYTES): FrameChunk[] {
  const bytes = new TextEncoder().encode(json);
  if (bytes.length <= limit) return [];
  const total = Math.ceil(bytes.length / limit);
  const frames: FrameChunk[] = [];
  for (let seq = 0; seq < total; seq++) {
    frames.push({ __chunk: { kind, id, seq, total, data: bytesToBase64(bytes.subarray(seq * limit, (seq + 1) * limit)) } });
  }
  return frames;
}

/** 聚合端：按 seq 存放，集齐后按字节拼接还原 JSON 文本。缺帧返回 null。 */
export class FrameAssembler {
  private pending = new Map<string, { parts: (string | undefined)[]; got: number; total: number }>();
  accept(chunk: FrameChunk['__chunk']): string | null {
    const entry = this.pending.get(chunk.id) ?? { parts: new Array<string | undefined>(chunk.total), got: 0, total: chunk.total };
    if (chunk.seq >= entry.total) return null;
    if (entry.parts[chunk.seq] === undefined) { entry.parts[chunk.seq] = chunk.data; entry.got++; }
    this.pending.set(chunk.id, entry);
    if (entry.got < entry.total) return null;
    this.pending.delete(chunk.id);
    // 逐帧解码后按字节拼接：不能直接拼 base64 字符串（会破坏编码边界）。
    const parts = entry.parts.map(part => base64ToBytes(part ?? ''));
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) { merged.set(part, offset); offset += part.length; }
    return new TextDecoder().decode(merged);
  }
}
