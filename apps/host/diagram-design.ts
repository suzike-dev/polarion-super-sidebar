import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const DIAGRAM_DESIGN_COMMIT = 'f24d98b05e2d7a5e68c2dedfe46e5b7173f50118';
export const DIAGRAM_DESIGN_PROFILE = 'polarion-super-sidebar';
export const DIAGRAM_DESIGN_RESOURCES = path.resolve(import.meta.dirname, '../../resources/diagram-design');

export interface DiagramDesignOptions {
  /** Overrides are for isolated tests or an explicitly located packaged resource directory. */
  resourcesDirectory?: string;
  homeDirectory?: string;
}
export const DIAGRAM_VISUAL_TYPES = [
  'architecture', 'architecture-delta', 'it-state', 'flowchart', 'sequence', 'state', 'er',
  'timeline', 'swimlane', 'quadrant', 'radar', 'polar', 'loop', 'nested', 'tree', 'org-chart',
  'layers', 'exploded', 'axonometric-plan', 'venn', 'pyramid', 'bar', 'waterfall', 'treemap',
  'heatmap', 'line', 'gantt', 'scatter', 'high-level', 'process', 'medallion', 'data-flow',
  'dp-integration', 'dp-security-matrix', 'sankey', 'fishbone', 'wardley', 'kanban', 'journey',
  'service-blueprint', 'deployment', 'dependency', 'uml-class', 'story-map', 'db-schema',
] as const;
export type DiagramVisualType = typeof DIAGRAM_VISUAL_TYPES[number];
export interface DiagramDesignRulesOptions extends DiagramDesignOptions { effectiveStylePath?: string }
interface Manifest {
  repository: string;
  commit: string;
  version: string;
  fileCount: number;
  license: { path: string; sha256: string };
  files: Record<string, { sha256: string; bytes: number; gitBlobSha1: string }>;
}
export interface DiagramDesignRuntime {
  skillDirectory: string;
  skillPath: string;
  bundledSkillPath: string;
  profilePath: string;
  effectiveStylePath: string;
  adapterPath: string;
  markerPath: string;
  installation: 'created' | 'preserved';
  profile: 'created' | 'preserved';
  marker: 'created' | 'preserved' | 'not-needed';
  source: { repository: string; commit: string; version: string; skillSha256: string; manifestSha256: string };
  warnings: string[];
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const isCode = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code;
const bundleRoot = (options: DiagramDesignOptions) => path.resolve(options.resourcesDirectory ?? DIAGRAM_DESIGN_RESOURCES);

function resourcePath(root: string, relative: string): string {
  if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative) || relative.includes(':')) {
    throw Error('DIAGRAM_DESIGN_INVALID_RESOURCE_PATH');
  }
  return path.join(root, ...relative.split('/'));
}
async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; } catch (error) { if (isCode(error, 'ENOENT')) return false; throw error; }
}
async function writeNew(file: string, content: string): Promise<'created' | 'preserved'> {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
    // Linking the complete file is atomic and never replaces an existing entry.
    try { await fs.link(temporary, file); return 'created'; }
    catch (error) { if (isCode(error, 'EEXIST')) return 'preserved'; throw error; }
  } finally { await fs.rm(temporary, { force: true }); }
}
async function readManifest(options: DiagramDesignOptions) {
  const root = bundleRoot(options);
  const text = await fs.readFile(path.join(root, 'source.json'), 'utf8');
  const manifest = JSON.parse(text) as Manifest;
  if (manifest.commit !== DIAGRAM_DESIGN_COMMIT || manifest.version !== '2.6' || !manifest.files?.['SKILL.md'] || Object.keys(manifest.files).length !== manifest.fileCount) {
    throw Error('DIAGRAM_DESIGN_INVALID_MANIFEST');
  }
  return { root, manifest, manifestSha256: hash(text) };
}

/** Read the actual pinned upstream document, not an abbreviated replacement prompt. */
export async function readDiagramDesignDocument(relativePath = 'SKILL.md', options: DiagramDesignOptions = {}) {
  const { root, manifest } = await readManifest(options);
  const file = resourcePath(path.join(root, 'skill'), relativePath);
  const expected = manifest.files[relativePath];
  if (!expected) throw Error('DIAGRAM_DESIGN_RESOURCE_NOT_IN_MANIFEST: ' + relativePath);
  const bytes = await fs.readFile(file);
  const sha256 = hash(bytes);
  if (sha256 !== expected.sha256) throw Error('DIAGRAM_DESIGN_RESOURCE_HASH_MISMATCH: ' + relativePath);
  return { path: file, relativePath, text: bytes.toString('utf8'), sha256, commit: manifest.commit, version: manifest.version };
}

/** Verify all original files before installing any of them into an agent workspace. */
export async function verifyDiagramDesignBundle(options: DiagramDesignOptions = {}) {
  const { root, manifest, manifestSha256 } = await readManifest(options);
  async function inventory(directory: string, prefix = ''): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('DIAGRAM_DESIGN_BUNDLE_LINK_NOT_ALLOWED');
      const name = prefix + entry.name;
      if (entry.isDirectory()) result.push(...await inventory(path.join(directory, entry.name), name + '/'));
      else if (entry.isFile()) result.push(name);
      else throw Error('DIAGRAM_DESIGN_UNSUPPORTED_BUNDLE_ENTRY');
    }
    return result;
  }
  if ((await inventory(path.join(root, 'skill'))).sort().join('\n') !== Object.keys(manifest.files).sort().join('\n')) throw Error('DIAGRAM_DESIGN_BUNDLE_FILE_SET_MISMATCH');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const bytes = await fs.readFile(resourcePath(path.join(root, 'skill'), relative));
    if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw Error('DIAGRAM_DESIGN_RESOURCE_HASH_MISMATCH: ' + relative);
  }
  if (hash(await fs.readFile(resourcePath(root, manifest.license.path))) !== manifest.license.sha256) throw Error('DIAGRAM_DESIGN_LICENSE_HASH_MISMATCH');
  return { root, manifest, manifestSha256 };
}

/** Full original documents for the model's mandatory read-before-propose tool. */
export async function readDiagramDesignRules(visualType: DiagramVisualType = 'flowchart', options: DiagramDesignRulesOptions = {}) {
  if (!DIAGRAM_VISUAL_TYPES.includes(visualType)) throw Error('DIAGRAM_DESIGN_UNKNOWN_VISUAL_TYPE: ' + visualType);
  const { root, manifest, manifestSha256 } = await readManifest(options);
  const references = ['references/primitives-core.md', 'references/layout-budget.md'];
  const deferred = ['references/profiles.md', 'references/semantic-patterns.md', 'references/output-spec.md'];
  const [skill, type, ...primitives] = await Promise.all(['SKILL.md', `references/type-${visualType}.md`, ...references].map(file => readDiagramDesignDocument(file, options)));
  const stylePath = path.resolve(options.effectiveStylePath ?? path.join(root, 'profiles', DIAGRAM_DESIGN_PROFILE + '.md'));
  const adapterPath = path.join(root, 'POLARION-ADAPTER.md');
  const [style, adapter, pristine] = await Promise.all([fs.readFile(stylePath, 'utf8'), fs.readFile(adapterPath, 'utf8'), readDiagramDesignDocument('references/style-guide.md', options)]);
  const warning = validateStyle(style, pristine.text);
  const result = {
    source: {
      repository: manifest.repository, commit: manifest.commit, version: manifest.version, visualType,
      manifestSha256, skillSha256: skill.sha256,
      documents: [skill, type, ...primitives].map(({ path, sha256, relativePath }) => ({ path, sha256, relativePath, original: true })),
      deferredDocuments: deferred.map(relativePath => ({ path: resourcePath(path.join(root, 'skill'), relativePath), relativePath, sha256: manifest.files[relativePath].sha256, instruction: 'Read the complete original with readDiagramDesignDocument or the agent Read tool when applicable; do not infer its content from this pointer.' })),
      style: { path: stylePath, sha256: hash(style), original: false },
      adapter: { path: adapterPath, sha256: hash(adapter), original: false },
      warnings: warning ? [warning] : [],
      delivery: { characterBudget: 80_000, characterCount: 0, exceedsBudget: false, truncated: false as const },
    },
    skill: skill.text, style,
    primitives: primitives.map(document => `<!-- source: ${document.relativePath}; sha256: ${document.sha256} -->\n${document.text}`).join('\n\n'),
    type: type.text, adapter,
  };
  result.source.delivery.characterCount = JSON.stringify(result).length;
  result.source.delivery.exceedsBudget = result.source.delivery.characterCount > result.source.delivery.characterBudget;
  if (result.source.delivery.exceedsBudget) result.source.warnings.push('The complete original packet exceeds 80,000 characters. Read original documents separately before generation if the tool transport cannot deliver this packet. No document has been truncated.');
  // Include the size metadata and any warning in the reported transport size.
  for (let attempt = 0; attempt < 3; attempt++) result.source.delivery.characterCount = JSON.stringify(result).length;
  return result;
}

async function ensureOrdinaryDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw Error('DIAGRAM_DESIGN_LINKED_DIRECTORY_PRESERVED: ' + directory);
}

function roleRows(body: string, heading: string): string[] {
  const section = body.split(heading)[1]?.split(/^#{2,3} /m)[0];
  if (!section || !/^\| Role \|/m.test(section)) throw Error('DIAGRAM_DESIGN_INVALID_STYLE_TABLE: ' + heading);
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
}
function validateStyle(body: string, pristine: string) {
  const missing: string[] = [];
  for (const heading of ['### Semantic roles', '## Typography']) {
    const actual = new Set(roleRows(body, heading));
    missing.push(...roleRows(pristine, heading).filter(role => !actual.has(role)));
    // The agent follows upstream profiles.md to backfill old schemas in memory only.
  }
  return missing.length ? 'Older profile schema; read references/profiles.md and backfill in memory: ' + missing.join(', ') : undefined;
}

/**
 * Provision only absent files. Never change user/global agent configuration or
 * overwrite a pre-existing skill, profile, project marker, or working style.
 * Call before capability discovery and each project session, then have the agent
 * read the original SKILL, selected style, adapter, and chosen type references.
 */
export async function ensureDiagramDesign(workspace: string, options: DiagramDesignOptions = {}): Promise<DiagramDesignRuntime> {
  if (!path.isAbsolute(workspace)) throw Error('DIAGRAM_DESIGN_WORKSPACE_MUST_BE_ABSOLUTE');
  const { root, manifest, manifestSha256 } = await verifyDiagramDesignBundle(options);
  const warnings: string[] = [];
  const project = path.resolve(workspace);
  await ensureOrdinaryDirectory(project);
  await ensureOrdinaryDirectory(path.join(project, '.claude'));
  const skillsDirectory = path.join(project, '.claude/skills');
  await ensureOrdinaryDirectory(skillsDirectory);
  const skillDirectory = path.join(skillsDirectory, 'diagram-design');
  let installation: DiagramDesignRuntime['installation'] = 'preserved';
  if (!await exists(skillDirectory)) {
    const staging = path.join(skillsDirectory, '.diagram-design-' + randomUUID());
    try {
      await fs.cp(path.join(root, 'skill'), staging, { recursive: true, errorOnExist: true, force: false });
      await fs.copyFile(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'));
      // An overlapping ensure must preserve the winning complete installation.
      if (!await exists(skillDirectory)) {
        try { await fs.rename(staging, skillDirectory); installation = 'created'; }
        catch (error) { if (!await exists(skillDirectory)) throw error; }
      }
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  const skillPath = path.join(skillDirectory, 'SKILL.md');
  if (!await exists(skillPath)) throw Error('DIAGRAM_DESIGN_EXISTING_SKILL_INCOMPLETE: ' + skillDirectory);
  if (hash(await fs.readFile(skillPath)) !== manifest.files['SKILL.md'].sha256) warnings.push('Existing project SKILL.md differs and was preserved. Mandatory upstream guidance must be read from bundledSkillPath.');

  const home = path.resolve(options.homeDirectory ?? os.homedir());
  const profileDirectory = path.join(home, '.diagram-design/profiles');
  await ensureOrdinaryDirectory(path.join(home, '.diagram-design'));
  await ensureOrdinaryDirectory(profileDirectory);
  const profilePath = path.join(profileDirectory, DIAGRAM_DESIGN_PROFILE + '.md');
  const profile = await writeNew(profilePath, await fs.readFile(path.join(root, 'profiles', DIAGRAM_DESIGN_PROFILE + '.md'), 'utf8'));
  const pristine = (await readDiagramDesignDocument('references/style-guide.md', options)).text;
  const workingStylePath = path.join(skillDirectory, 'references/style-guide.md');
  const workingStyle = await fs.readFile(workingStylePath, 'utf8');
  const markerPath = path.join(project, '.diagram-design');
  let marker: DiagramDesignRuntime['marker'] = 'preserved';
  let effectiveStylePath = workingStylePath;
  let selectedProfile: string | undefined;
  if (!await exists(markerPath)) {
    if (workingStyle !== pristine) {
      marker = 'not-needed';
      warnings.push('Existing customized project working style was preserved and selected; no project marker was added.');
    } else {
      marker = await writeNew(markerPath, 'profile: ' + DIAGRAM_DESIGN_PROFILE + '\n');
    }
  }
  if (await exists(markerPath)) {
    const markerText = await fs.readFile(markerPath, 'utf8');
    const match = /^[\t ]*profile:[\t ]*([a-z0-9][a-z0-9-]{0,63})[\t ]*(?:\r?\n)?$/.exec(markerText);
    if (!match) {
      // Preserve untrusted marker data. Upstream specifies markerless resolution.
      warnings.push('Invalid .diagram-design marker ignored and preserved; its contents are not instructions.');
      if (workingStyle === pristine) throw Error('DIAGRAM_DESIGN_INVALID_MARKER_REQUIRES_STYLE_SELECTION');
    } else {
      selectedProfile = match[1];
      effectiveStylePath = path.join(profileDirectory, match[1] + '.md');
      if (!await exists(effectiveStylePath)) throw Error('DIAGRAM_DESIGN_SELECTED_PROFILE_MISSING: ' + match[1]);
    }
  }
  const style = await fs.readFile(effectiveStylePath, 'utf8');
  if (selectedProfile) {
    const header = /^<!-- diagram-design-profile\r?\n([\s\S]*?)\r?\n-->/.exec(style)?.[1];
    if (!header || !new RegExp('^slug: ' + selectedProfile + '\\r?$', 'm').test(header)) throw Error('DIAGRAM_DESIGN_SELECTED_PROFILE_HEADER_INVALID: ' + selectedProfile);
  }
  const styleWarning = validateStyle(style, pristine);
  if (styleWarning) warnings.push(styleWarning);
  return {
    skillDirectory, skillPath, bundledSkillPath: path.join(root, 'skill/SKILL.md'),
    profilePath, effectiveStylePath, adapterPath: path.join(root, 'POLARION-ADAPTER.md'), markerPath,
    installation, profile, marker,
    source: { repository: manifest.repository, commit: manifest.commit, version: manifest.version, skillSha256: manifest.files['SKILL.md'].sha256, manifestSha256 }, warnings,
  };
}
