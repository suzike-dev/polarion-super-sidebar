# Diagram Design runtime resources

Upstream: https://github.com/cathrynlavery/diagram-design/tree/f24d98b05e2d7a5e68c2dedfe46e5b7173f50118/skills/diagram-design

Version 2.6, commit `f24d98b05e2d7a5e68c2dedfe46e5b7173f50118`. `skill/` contains all 290 upstream skill files unchanged. `LICENSE` is the complete MIT license from the same commit. `source.json` records each file's SHA-256, length and Git blob SHA-1. During preparation, every file and the license were checked against the pinned GitHub tree. The installed global skill was read only.

`profiles/polarion-super-sidebar.md` is the separate, full application profile. `POLARION-ADAPTER.md` records the user-authorized Windows system font / neutral white-gray / deep-teal style and editable Excalidraw + corresponding PNG delivery. Upstream `SKILL.md`, references, examples and scripts remain unchanged; generated HTML is not substituted for the requested native editable board.

## Host integration

`apps/host/diagram-design.ts` exports asynchronous functions:

- `ensureDiagramDesign(absoluteWorkspace, options?)` verifies the resource bundle, installs a full copy under `.claude/skills/diagram-design`, adds the upstream license, creates only an absent `~/.diagram-design/profiles/polarion-super-sidebar.md`, and creates a project `.diagram-design` marker only when no existing customized working style or marker controls the project. It returns discovery paths, the actual effective style path, source hashes, creation/preservation status and warnings.
- `readDiagramDesignDocument(relativePath = 'SKILL.md', options?)` reads a full upstream file and checks its SHA-256. Returns `{text, path, sha256, relativePath, commit, version}`. Traversal and unmanifested paths are rejected.
- `readDiagramDesignRules(visualType = 'flowchart', options?)` returns `{source, skill, style, primitives, type, adapter}`. Text fields contain actual complete documents. The `primitives` field includes core primitives/connectors and layout budget. Profiles, semantic patterns and output specification are provided as explicit deferred paths and hashes; the agent must read their complete original when applicable. All 45 upstream visual types are supported. The common flowchart/architecture/state/sequence/tree packets are tested below 80,000 characters. Some long upstream types exceed that target; `source.delivery` reports the exact complete JSON size and warns that a size-limited transport must read the original documents separately. No body is silently truncated. Pass `effectiveStylePath` from `ensureDiagramDesign` to honor a user's existing style; otherwise the application profile template is read. `source` contains each input path and hash. Older profile schemas are reported for upstream's in-memory backfill procedure; no stored user style is silently rewritten.
- `verifyDiagramDesignBundle(options?)` verifies the full file inventory, all original bytes and the license. Symbolic links and unexpected files inside the bundle are rejected.

`options.resourcesDirectory` and `options.homeDirectory` support isolated tests and explicit packaging paths. Production defaults use the actual OS home and repository `resources/diagram-design`. Both source `apps/host` and bundled `dist/host` resolve the same repository root, so the current launcher needs no build-script changes. A relocated deployment must include `resources/diagram-design` at that root or explicitly set its path; absence fails clearly.

The engine must call `ensureDiagramDesign` before discovery/session startup. The diagram context tools must return the actual rules packet before proposals, record that read, and enforce read-before-propose. These integrations are owned separately; resource provisioning alone does not prove the agent followed the skill or produced an accepted diagram.

The current product context tools select only `flowchart`, `architecture`, `state`, and `tree`, whose default packets fit below 80,000 characters. Availability of 45 upstream reference documents in the reader is **not** a claim that the product can generate or has accepted all 45 diagram types. Callers of the 12 larger reference packets must use complete per-file reads if their transport has a lower limit; the helper preserves all source text and reports the excess explicitly.

## Preservation and failures

Existing project skills, profiles, marker contents and global configuration are not overwritten. A different project skill is reported, and mandatory pinned guidance remains available from `bundledSkillPath`. A markerless customized working guide remains effective. A selected missing/invalid profile fails explicitly; a malformed marker is preserved and ignored under upstream markerless resolution, with selection required if only pristine defaults remain. Linked `.claude`, skill-parent or profile directories are preserved and rejected for provisioning rather than followed for writes.

Concurrent calls publish complete new files without replacing existing entries. A copied skill is staged and renamed; temporary staging is removed after success/failure. No runtime download or remote font request is performed by this helper. Upstream scripts are supplied as source material and are not automatically executed.

## Reproduction and verification

1. Obtain the upstream skill directory at the exact commit; copy its contents into `skill/` without editing files.
2. Obtain `/repos/cathrynlavery/diagram-design/git/trees/<commit>?recursive=1` as `upstream-tree.json`, and obtain/decode the root `LICENSE` at that commit.
3. Run `node resources/diagram-design/prepare-bundle.mjs`. It checks upstream Git blob identities, writes `source.json` and generates the separate profile template.
4. Run `.runtime/node-v24.22.2-win-x64/node.exe --test apps/host/diagram-design.test.ts` and `npm run check:host`.

Rollback: remove only a new application's skill copy/marker/profile whose creation was reported, after checking that it has not since been edited. Existing entries never need a rollback because they were not replaced. No runtime provisioning has been applied to the real user's home by the isolated tests; application startup is a separate integration/deployment step.
