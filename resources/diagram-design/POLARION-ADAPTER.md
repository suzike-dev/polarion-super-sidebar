# Polarion diagram delivery adapter

This is the Polarion application's delivery contract, separate from the unchanged upstream Diagram Design skill. The user has explicitly requested editable boards and diagram figures in Polarion, Windows system typography, neutral white/gray surfaces, and a restrained deep-teal accent. That authorization selects the application profile for new workspaces; it does not authorize overwriting an existing user's project marker, profile or skill.

Before every board or requirements diagram generation:

1. Read the complete pinned `skill/SKILL.md`, `skill/references/profiles.md`, and the effective style guide returned by `ensureDiagramDesign`. Do not substitute a summary for the original skill. Resolve style again for each project.
2. Select a semantic pattern when applicable and one visual type; actually read that pattern/type reference before drawing. Preserve engineering facts, IDs, uncertainty and source boundaries. Do not invent requirements or interfaces for a prettier graph.
3. Follow the original complexity budget, hierarchy, four-pixel layout grid, text padding, orthogonal connections, connector masks, non-overlap checks and final review. Split an overly dense diagram into overview and detail. An arrow must denote a real relationship.
4. Apply the effective profile. For the application default, use white/neutral gray, deep teal for only one or two focal elements, Windows system sans typography for readable labels, and monospace only for machine identifiers. Keep Chinese labels readable at their actual displayed size; measure them in the renderer. No web-font requests, decorative glow, forced handwriting, gratuitous icons or shadows.
5. Produce an actual editable Excalidraw source using the application's board tools and native editable text, shapes, connectors and groups. The preview must be a PNG rendered from that same source. The user's required delivery medium takes precedence over the upstream default HTML/SVG delivery. Do not replace an editable board with an HTML page, flattened SVG, Mermaid screenshot, single raster image or textual mockup.
6. Inspect source and preview for clipping, unreadable Chinese, crossed/overlapping paths, missing nodes or misleading relationships. Preserve the editable source plus matching PNG preview as one board artifact. Reopen it through the application's normal board path when validating an edit.
7. Inserting into the local shared draft is distinct from writing Polarion. Original work item content is written only through the user's explicit save flow. Do not claim a successful save from a local preview or tool call alone.

When editing an existing board, preserve the user's manual colors, fonts and shape treatments unless the requested edit explicitly includes restyling. Applying a new application skin is not authorization to repaint existing content. Preserve IDs and editable relationships for unchanged elements.

The native Excalidraw canvas uses editable orthogonal elbows with a 16px radius where supported. Upstream HTML/SVG examples use 8px elbows. This is a renderer-specific delivery adaptation: retain orthogonal routing, distinct attachment points, clear masked labels and non-overlap; do not flatten the native elbow into an imported SVG or raster just to imitate an HTML radius.

HTML-oriented upstream scripts and examples remain available as source guidance; their existence does not prove that a native Excalidraw board has passed runtime checks. The skill is guidance, not a guarantee of correctness. If a required input, renderer or tool is unavailable, report the specific limitation instead of manufacturing an accepted diagram.
