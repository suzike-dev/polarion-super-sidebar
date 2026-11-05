import fs from 'node:fs';
import path from 'node:path';
import type { Guideline } from '../../packages/protocol/index.ts';
import { normalizeGuideline } from '../../packages/protocol/index.ts';

const MAX_GUIDELINE_FILE = 200 * 1024;

export type ResolvedGuideline = { name: string; description: string; text: string; source: 'inline' | 'file'; files: { label: string; path: string }[] };

function readFile(file: string): string {
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { throw Error('GUIDELINE_FILE_UNREADABLE'); }
  if (!stat.isFile()) throw Error('GUIDELINE_FILE_INVALID');
  // 先看字节数再读，避免大文件把 Host 事件循环卡住。
  if (stat.size > MAX_GUIDELINE_FILE) throw Error('GUIDELINE_FILE_TOO_LARGE');
  let buffer: Buffer;
  try { buffer = fs.readFileSync(file); } catch { throw Error('GUIDELINE_FILE_UNREADABLE'); }
  let text: string;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le');
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) { const swapped = Buffer.from(buffer.subarray(2)); swapped.swap16(); text = swapped.toString('utf16le'); }
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) text = buffer.subarray(3).toString('utf8');
  else if (buffer.length > 3 && buffer.subarray(0, 200).filter(byte => byte === 0).length > 10) text = buffer.toString('utf16le');
  else {
    text = buffer.toString('utf8');
    // 中文 Windows 的记事本文件常见 GBK；UTF-8 解不开时回退到 GBK，避免把指令读成乱码。
    if (text.includes('\uFFFD')) { try { const gbk = new TextDecoder('gbk').decode(buffer); if (!gbk.includes('\uFFFD')) text = gbk; } catch { /* 运行时无 GBK 解码器时保留 UTF-8 结果 */ } }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_GUIDELINE_FILE) throw Error('GUIDELINE_FILE_TOO_LARGE');
  return text;
}

/** 指令正文 = 内联内容 + 每个本地文件（每次使用时重新读取，带备注作为小节标题）。 */
export function guidelineContent(raw: Guideline): ResolvedGuideline {
  const guideline = normalizeGuideline(raw);
  const parts: string[] = [];
  if (guideline.content.trim()) parts.push(guideline.content.trim());
  const files = guideline.files.map(file => {
    const label = file.label.trim() || path.basename(file.path);
    parts.push(`【文件：${label}】\n${readFile(file.path)}`); return { label, path: file.path };
  });
  return { name: guideline.name, description: guideline.description, text: parts.join('\n\n'), source: files.length ? 'file' : 'inline', files };
}

/** 保存前校验：内容与文件不能同时为空；每个文件必须存在、可读且不太大。 */
export function validateGuideline(raw: Guideline) {
  const guideline = normalizeGuideline(raw);
  for (const file of guideline.files) {
    if (!fs.existsSync(file.path)) throw Error('GUIDELINE_FILE_INVALID');
    readFile(file.path);
  }
  if (!guideline.content.trim() && !guideline.files.length) throw Error('GUIDELINE_EMPTY');
}
