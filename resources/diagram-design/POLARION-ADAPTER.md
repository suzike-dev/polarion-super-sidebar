# Polarion diagram delivery adapter

This is the Polarion application's delivery contract, separate from the unchanged upstream Diagram Design skill. The user has explicitly requested editable boards and diagram figures in Polarion, Windows system typography, neutral white/gray surfaces, and a restrained deep-teal accent. That authorization selects the application profile for new workspaces; it does not authorize overwriting an existing user's project marker, profile or skill.

Before every board or requirements diagram generation:

1. Read the complete pinned `skill/SKILL.md`, `skill/references/profiles.md`, and the effective style guide returned by `ensureDiagramDesign`. Do not substitute a summary for the original skill. Resolve style again for each project.
2. Select a semantic pattern when applicable and one visual type; actually read that pattern/type reference before drawing. Preserve engineering facts, IDs, uncertainty and source boundaries. Do not invent requirements or interfaces for a prettier graph.
3. Follow the original complexity budget, hierarchy, four-pixel layout grid, text padding, orthogonal connections, connector masks, non-overlap checks and final review. Split an overly dense diagram into overview and detail. An arrow must denote a real relationship.
4. Apply the effective profile. For the application default, use white/neutral gray, deep teal for only one or two focal elements, Windows system sans typography for readable labels, and monospace only for machine identifiers. Keep Chinese labels readable at their actual displayed size; measure them in the renderer. No web-font requests, decorative glow, forced handwriting, gratuitous icons or shadows.
5. Produce an actual editable Excalidraw source using the application's board tools and native editable text, shapes, connectors and groups. The preview must be a PNG rendered from that same source. The user's required delivery medium takes precedence over the upstream default HTML/SVG delivery. Do not replace an editable board with an HTML page, flattened SVG, Mermaid screenshot, single raster image or textual mockup.

Board tool semantics (Polarion extension of the profile role table). `propose_board_generation` maps the profile's semantic roles onto node `type` values and renders them automatically — never pick raw hex colors yourself:

- `process` (default) = plain step/service, white fill + ink stroke; `data` = data store, light sage fill; `user` = human role, warm sand fill; `external` = external system, dashed grey stroke; `security` = security-relevant component, dashed deep-teal stroke; `focal` = the 1–2 focal elements of the role table (accent-tint fill + accent stroke). `tone: accent` is a legacy alias of `type: focal`.
- Give key nodes a `sub` sublabel (≤60 chars) for machine facts only: protocol, port, system name, role — mirroring the profile's `sublabel` typography role. Never duplicate the node title.
- Mark exactly one main path per flow with `variant: emphasis` edges; async/optional relations use `variant: dashed`. Everything else stays the default solid.
- Architecture or cross-team boundaries use `groups` (2–4 groups, each with ≥2 member nodes, single membership). The renderer clusters members and wraps them in a dashed boundary with a label strip; do not hand-draw boundary boxes.
- A legend is generated automatically when ≥2 semantic types or variants are in play; set `legend: "none"` only on request.
- `kind: state` renders a UML-style state machine: initial states as solid dots, final states as double rings, plain states as capsules; transitions reuse the orthogonal router with masked labels. Self-transitions are not supported — split them into an intermediate state.
- Flow budget: ≤12 nodes, ≤16 edges, ≤2 focal nodes; state machines: ≤8 states, ≤16 transitions.
- Kind routing by request wording: flow = steps/decisions/algorithm principles; architecture = system, logic or principle block diagrams (typed components + `groups` boundaries + emphasis main path); tree = top-down decomposition/org charts (single root, parent→child edges, bus connectors, no edge labels); swimlane/sequence/class/er/state as named.
- Horizontal-first composition: when `direction` is omitted, flow and state diagrams run left-to-right on a wide (~1280×720) canvas so the whole picture fits one screen. Prefer it. Use `direction: "down"` only for vertical reading semantics (swimlanes, sequences) or explicit user preference; never stretch height unnecessarily.
6. Inspect source and preview for clipping, unreadable Chinese, crossed/overlapping paths, missing nodes or misleading relationships. Preserve the editable source plus matching PNG preview as one board artifact. Reopen it through the application's normal board path when validating an edit.
7. Inserting into the local shared draft is distinct from writing Polarion. Original work item content is written only through the user's explicit save flow. Do not claim a successful save from a local preview or tool call alone.

When editing an existing board, preserve the user's manual colors, fonts and shape treatments unless the requested edit explicitly includes restyling. Applying a new application skin is not authorization to repaint existing content. Preserve IDs and editable relationships for unchanged elements.

The native Excalidraw canvas uses editable orthogonal elbows with a 16px radius where supported. Upstream HTML/SVG examples use 8px elbows. This is a renderer-specific delivery adaptation: retain orthogonal routing, distinct attachment points, clear masked labels and non-overlap; do not flatten the native elbow into an imported SVG or raster just to imitate an HTML radius.

HTML-oriented upstream scripts and examples remain available as source guidance; their existence does not prove that a native Excalidraw board has passed runtime checks. The skill is guidance, not a guarantee of correctness. If a required input, renderer or tool is unavailable, report the specific limitation instead of manufacturing an accepted diagram.
