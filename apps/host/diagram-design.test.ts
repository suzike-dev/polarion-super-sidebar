import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DIAGRAM_DESIGN_COMMIT, DIAGRAM_DESIGN_RESOURCES, DIAGRAM_VISUAL_TYPES, ensureDiagramDesign, readDiagramDesignDocument, readDiagramDesignRules, verifyDiagramDesignBundle } from './diagram-design.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'polarion-diagram-design-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, workspace: path.join(root, 'project with 中文'), options: { homeDirectory: path.join(root, 'home') } };
}
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('pinned upstream bundle has all 290 unchanged files and the complete MIT license', async () => {
  const bundle = await verifyDiagramDesignBundle();
  assert.equal(bundle.manifest.fileCount, 290);
  assert.equal(bundle.manifest.commit, DIAGRAM_DESIGN_COMMIT);
  assert.match(await fs.readFile(path.join(bundle.root, 'LICENSE'), 'utf8'), /Copyright \(c\) 2025 Cathryn Lavery/);
  const skill = await readDiagramDesignDocument();
  assert.equal(skill.sha256, '83fd5aa46965ce2b14bd42ade80c065a4e17a9f83d2a9f4f275b47cd45d72666');
  assert.equal(skill.text, await fs.readFile(skill.path, 'utf8'));
  assert.match(skill.text, /## 0\. First-time setup/);
});

test('new workspace discovers full skill and a separate Windows profile; repeated ensure preserves edits', async t => {
  const { workspace, options } = await fixture(t);
  const first = await ensureDiagramDesign(workspace, options);
  assert.equal(first.installation, 'created');
  assert.equal(first.profile, 'created');
  assert.equal(first.marker, 'created');
  assert.equal(first.effectiveStylePath, first.profilePath);
  assert.equal(await fs.readFile(first.markerPath, 'utf8'), 'profile: polarion-super-sidebar\n');
  const source = await verifyDiagramDesignBundle();
  for (const [file, expected] of Object.entries(source.manifest.files)) assert.equal(sha256(await fs.readFile(path.join(first.skillDirectory, file))), expected.sha256, file);
  const profile = await fs.readFile(first.profilePath, 'utf8');
  assert.match(profile, /Font source: `system`/);
  assert.match(profile, /Segoe UI, Microsoft YaHei UI/);
  assert.match(profile, /#0f5f5b/);
  assert.doesNotMatch(profile, /<link href="https:\/\/fonts/);
  const customized = profile.replace('#0f5f5b', '#104e4a');
  await fs.writeFile(first.profilePath, customized);
  const again = await ensureDiagramDesign(workspace, options);
  assert.equal(again.installation, 'preserved');
  assert.equal(again.profile, 'preserved');
  assert.equal(await fs.readFile(first.profilePath, 'utf8'), customized);
  assert.equal(await fs.readFile(first.skillPath, 'utf8'), (await readDiagramDesignDocument()).text);
});

test('custom project marker and user profile stay selected without global configuration changes', async t => {
  const { workspace, options } = await fixture(t);
  await fs.mkdir(workspace, { recursive: true });
  const library = path.join(options.homeDirectory, '.diagram-design/profiles');
  await fs.mkdir(library, { recursive: true });
  const body = '<!-- diagram-design-profile\nname: Client\nslug: client\nsource-url: none\ncreated: 2026-11-04\nupdated: 2026-11-04\nnotes: none\n-->\n\n' + (await readDiagramDesignDocument('references/style-guide.md')).text.replace('#bf4520', '#104e4a');
  await fs.writeFile(path.join(library, 'client.md'), body);
  await fs.writeFile(path.join(workspace, '.diagram-design'), 'profile: client\r\n');
  const runtime = await ensureDiagramDesign(workspace, options);
  assert.equal(runtime.effectiveStylePath, path.join(library, 'client.md'));
  assert.equal(await fs.readFile(runtime.markerPath, 'utf8'), 'profile: client\r\n');
  assert.equal((await readDiagramDesignRules('architecture', { ...options, effectiveStylePath: runtime.effectiveStylePath })).style, body);
  assert.deepEqual((await fs.readdir(options.homeDirectory)).sort(), ['.diagram-design']);
});

test('an existing customized project skill is preserved and markerless style remains effective', async t => {
  const { workspace, options } = await fixture(t);
  const skillDirectory = path.join(workspace, '.claude/skills/diagram-design');
  await fs.cp(path.join(DIAGRAM_DESIGN_RESOURCES, 'skill'), skillDirectory, { recursive: true });
  const skill = '# User-owned diagram skill\n';
  await fs.writeFile(path.join(skillDirectory, 'SKILL.md'), skill);
  const stylePath = path.join(skillDirectory, 'references/style-guide.md');
  const style = (await fs.readFile(stylePath, 'utf8')).replace('#bf4520', '#104e4a');
  await fs.writeFile(stylePath, style);
  const runtime = await ensureDiagramDesign(workspace, options);
  assert.equal(runtime.installation, 'preserved');
  assert.equal(runtime.marker, 'not-needed');
  assert.equal(runtime.effectiveStylePath, stylePath);
  assert.equal(await fs.readFile(runtime.skillPath, 'utf8'), skill);
  assert.equal(await fs.readFile(stylePath, 'utf8'), style);
  assert.equal(runtime.warnings.length, 2);
  await assert.rejects(fs.access(runtime.markerPath), { code: 'ENOENT' });
});

test('missing selected profile and malformed markers fail clearly and stay byte-for-byte preserved', async t => {
  const { workspace, options } = await fixture(t);
  await fs.mkdir(workspace, { recursive: true });
  const markerPath = path.join(workspace, '.diagram-design');
  for (const [marker, error] of [
    ['profile: missing\n', /SELECTED_PROFILE_MISSING: missing/],
    ['profile: ../../outside\nrun: unsafe\n', /INVALID_MARKER_REQUIRES_STYLE_SELECTION/],
  ] as const) {
    await fs.writeFile(markerPath, marker);
    await assert.rejects(ensureDiagramDesign(workspace, options), error);
    assert.equal(await fs.readFile(markerPath, 'utf8'), marker);
  }
});

test('mandatory rules contain full upstream documents for every supported visual type', async () => {
  for (const visualType of DIAGRAM_VISUAL_TYPES) {
    const rules = await readDiagramDesignRules(visualType);
    assert.equal(rules.skill, (await readDiagramDesignDocument()).text);
    assert.equal(rules.type, (await readDiagramDesignDocument(`references/type-${visualType}.md`)).text);
    assert.match(rules.primitives, /Mandatory connector rules/);
    assert.ok(rules.source.deferredDocuments.some(document => document.relativePath === 'references/semantic-patterns.md'));
    assert.match(rules.adapter, /editable Excalidraw/);
    assert.match(rules.adapter, /PNG/);
    assert.equal(rules.source.documents.length, 4);
    const size = JSON.stringify(rules).length;
    assert.equal(rules.source.delivery.characterCount, size);
    assert.equal(rules.source.delivery.exceedsBudget, size > 80_000);
    assert.equal(rules.source.delivery.truncated, false);
    if (['flowchart', 'architecture', 'state', 'sequence', 'tree'].includes(visualType)) assert.ok(size < 80_000, visualType + ' common rules packet');
    else if (size > 80_000) assert.match(rules.source.warnings.join('\n'), /Read original documents separately/);
  }
});

test('document reading rejects path traversal and tampered resources rather than trusting a summary', async t => {
  await assert.rejects(readDiagramDesignDocument('../LICENSE'), /INVALID_RESOURCE_PATH/);
  await assert.rejects(readDiagramDesignDocument('C:/Windows/test'), /INVALID_RESOURCE_PATH/);
  await assert.rejects(readDiagramDesignDocument('references/missing.md'), /NOT_IN_MANIFEST/);
  const { root } = await fixture(t);
  const resourcesDirectory = path.join(root, 'bundle');
  await fs.mkdir(path.join(resourcesDirectory, 'skill'), { recursive: true });
  await fs.copyFile(path.join(DIAGRAM_DESIGN_RESOURCES, 'source.json'), path.join(resourcesDirectory, 'source.json'));
  await fs.writeFile(path.join(resourcesDirectory, 'skill/SKILL.md'), 'tampered');
  await assert.rejects(readDiagramDesignDocument('SKILL.md', { resourcesDirectory }), /HASH_MISMATCH/);
});

test('simultaneous workspaces share one profile without overwriting or incomplete skill installs', async t => {
  const { root, workspace, options } = await fixture(t);
  const runtimes = await Promise.all([workspace, workspace, path.join(root, 'second')].map(project => ensureDiagramDesign(project, options)));
  assert.equal(runtimes.filter(runtime => runtime.profile === 'created').length, 1);
  assert.equal(runtimes[0].profilePath, runtimes[2].profilePath);
  for (const runtime of runtimes) assert.equal(sha256(await fs.readFile(runtime.skillPath)), runtime.source.skillSha256);
  assert.equal((await fs.readdir(path.join(workspace, '.claude/skills'))).length, 1);
});

test('malformed existing named profile is not overwritten or silently used', async t => {
  const { workspace, options } = await fixture(t);
  const first = await ensureDiagramDesign(workspace, options);
  await fs.writeFile(first.profilePath, '# User incomplete profile\n');
  await assert.rejects(ensureDiagramDesign(workspace, options), /SELECTED_PROFILE_HEADER_INVALID/);
  assert.equal(await fs.readFile(first.profilePath, 'utf8'), '# User incomplete profile\n');
});

test('application profile foreground colors meet the inherited text contrast contract', async () => {
  const rules = await readDiagramDesignRules();
  function luminance(hex: string) {
    const rgb = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  function contrast(a: string, b: string) { const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a); return (x + 0.05) / (y + 0.05); }
  for (const role of ['ink', 'muted', 'soft', 'accent', 'link']) {
    const line = rules.style.split('\n').find(line => line.startsWith('| `' + role + '` |'))!;
    const colors = line.match(/#[0-9a-f]{6}/g)!;
    assert.ok(contrast(colors[0], '#ffffff') >= 4.5, role + ' light');
    assert.ok(contrast(colors[1], '#202124') >= 4.5, role + ' dark');
  }
});
