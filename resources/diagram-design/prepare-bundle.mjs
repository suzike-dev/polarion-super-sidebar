// Rebuild the manifest/profile after copying a pristine pinned upstream skill.
// upstream-tree.json must be obtained from the commit's GitHub recursive tree API.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = import.meta.dirname;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const upstream = JSON.parse(await fs.readFile(path.join(root, 'upstream-tree.json'), 'utf8'));
const commit = 'f24d98b05e2d7a5e68c2dedfe46e5b7173f50118';
if (upstream.sha !== commit || upstream.truncated) throw Error('Unexpected upstream tree');
const entries = upstream.tree.filter(e => e.type === 'blob' && e.path.startsWith('skills/diagram-design/'));
const files = {};
for (const entry of entries) {
  const name = entry.path.slice('skills/diagram-design/'.length);
  const bytes = await fs.readFile(path.join(root, 'skill', name));
  const gitBlobSha1 = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (gitBlobSha1 !== entry.sha) throw Error(`Upstream differs: ${name}`);
  files[name] = { sha256: sha256(bytes), bytes: bytes.length, gitBlobSha1 };
}
const license = await fs.readFile(path.join(root, 'LICENSE'));
const licenseEntry = upstream.tree.find(e => e.path === 'LICENSE');
if (createHash('sha1').update(`blob ${license.length}\0`).update(license).digest('hex') !== licenseEntry.sha) throw Error('License differs');
await fs.writeFile(path.join(root, 'source.json'), JSON.stringify({
  repository: 'https://github.com/cathrynlavery/diagram-design', commit, version: '2.6',
  upstreamPath: 'skills/diagram-design', fileCount: entries.length,
  license: { path: 'LICENSE', sha256: sha256(license), gitBlobSha1: licenseEntry.sha }, files,
}, null, 2) + '\n');

// The app profile is a separate complete guide. The upstream tree is untouched.
let style = await fs.readFile(path.join(root, 'skill/references/style-guide.md'), 'utf8');
style = style.replace(/^Default skin is.*$/m, 'Polarion uses neutral white/gray surfaces, Windows system fonts and a restrained deep-teal accent. The light palette is the default.');
const roles = [
  ['paper', 'Page background, default node fill', '#ffffff', '#202124'],
  ['paper-2', 'Diagram container bg, secondary fill', '#f5f5f5', '#2c2d30'],
  ['ink', 'Primary text, primary stroke', '#202124', '#f5f5f5'],
  ['ink-strong', 'High-contrast text on accent fills', '#ffffff', '#111111'],
  ['muted', 'Secondary text, default arrow stroke', '#55585c', '#c8cbce'],
  ['soft', 'Sublabels, boundary labels', '#62676c', '#aeb2b6'],
  ['rule', 'Decorative hairline borders', 'rgba(32,33,36,0.12)', 'rgba(245,245,245,0.12)'],
  ['rule-solid', 'Decorative borders, baselines', '#c8cbce', '#62676c'],
  ['accent', 'Focal / 1–2 max per diagram', '#0f5f5b', '#85ccc4'],
  ['accent-tint', 'Fill for accent-bordered boxes', 'rgba(15,95,91,0.08)', 'rgba(133,204,196,0.10)'],
  ['link', 'HTTP/API calls, external arrows', '#0f5f5b', '#85ccc4'],
];
for (const [role, purpose, light, dark] of roles) {
  style = style.replace(new RegExp('^\\| `' + role + '` \\|.*$', 'm'), `| \`${role}\` | ${purpose} | \`${light}\` | \`${dark}\` |`);
}
style = style.replace(/^> \*\*Brand palette source:.*$/m, '> **Profile source:** the user-approved Polarion interface direction. Accent is editorial, never an unlabelled status code.');
style = style.replace(/^- \*\*Current defaults:.*$/m, '- Measure contrast on each actual surface; the inherited upstream default ratios do not describe this profile.');
style = style.replace(/Any `rgba\(45,49,66, X\)`.*dark paper\./, 'Use the explicit dark column only when requested. The application defaults to the neutral light palette.');
const typography = `## Typography

| Role | Family | Size | Weight | Usage |
|---|---|---|---|---|
| \`title\` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 1.75rem | 600 | Page title |
| \`node-name\` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 12px | 600 | Human-readable labels |
| \`sublabel\` | Consolas, Microsoft YaHei UI, ui-monospace, monospace | 9px | 400 | Technical values only |
| \`eyebrow\` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 12px | 500 | Type tags and axes |
| \`arrow-label\` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 12px | 400 | Arrow annotations |
| \`callout\` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 14px | 400 | Editorial asides |

### Font stack

Use Windows system fonts: \`"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif\`.
For commands, ports and machine identifiers only, use \`Consolas, "Microsoft YaHei UI", ui-monospace, monospace\`.
For editable Excalidraw, choose its normal system/sans font, never handwriting; verify its actual preview face on Windows.

### Font source

Font source: \`system\`

No remote font stylesheet, font download or export @import. Font metrics must be measured in the actual renderer.

### Multilingual labels

Chinese prose uses Microsoft YaHei UI / Microsoft YaHei with the same hierarchy as Latin prose. Do not force prose into monospace.
Every wide or full-width character costs 1em; count digits, punctuation and spaces too. Keep at least 8px label padding.
Chinese labels must remain at least 12px in the final displayed image. If a label does not fit, shorten it or expand the node; never shrink below the legibility floor.
Arrow labels and their opaque masks must have enough width and height for the actual font. Preserve requirement IDs and printed labels exactly.

---

`;
style = style.replace(/## Typography[\s\S]*?(?=## Stroke, radius, spacing)/, typography);
const header = `<!-- diagram-design-profile
name: Polarion Super Sidebar
slug: polarion-super-sidebar
source-url: none
created: 2026-11-04
updated: 2026-11-04
notes: User-approved Windows system typography and neutral white-gray deep-teal application style
-->

`;
await fs.mkdir(path.join(root, 'profiles'), { recursive: true });
await fs.writeFile(path.join(root, 'profiles/polarion-super-sidebar.md'), header + style);
console.log(JSON.stringify({ version: '2.6', commit, verifiedFiles: entries.length, skillSha256: files['SKILL.md'].sha256 }));
