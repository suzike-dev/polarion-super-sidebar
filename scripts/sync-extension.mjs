// 把 WXT 构建产物（apps/extension/.output/chrome-mv3）镜像到浏览器加载目录 spikes/extension，
// 并把字面 U+FFFF（非字符，Chrome 扩展脚本会拒绝解析，KaTeX 的 Unicode 正则自带）替换为等价转义。
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'apps/extension/.output/chrome-mv3');
const dest = path.join(root, 'spikes/extension');
async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const f = path.join(from, entry.name), t = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(f, t);
    else await fs.copyFile(f, t);
  }
}
async function walkText(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkText(p));
    else if (/\.(js|mjs|html|json|css|txt)$/.test(entry.name)) files.push(p);
  }
  return files;
}
await copyDir(src, dest);
let fixed = 0;
for (const file of await walkText(dest)) {
  const text = await fs.readFile(file, 'utf8');
  if (text.includes('\uFFFF')) {
    await fs.writeFile(file, text.replaceAll('\uFFFF', '\uFFFF'));
    fixed++;
  }
}
console.log(JSON.stringify({ synced: true, uFFFFFilesFixed: fixed }));
