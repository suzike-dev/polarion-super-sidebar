<!-- diagram-design-profile
name: Polarion Super Sidebar
slug: polarion-super-sidebar
source-url: none
created: 2026-11-04
updated: 2026-11-04
notes: User-approved Windows system typography and neutral white-gray deep-teal application style
-->

# Style Guide

**The single source of truth for colors, typography, and tokens.** Every diagram draws from this — not from hex values inlined in other reference files. If you want to change the visual skin of Diagram Design, change this file.

Polarion uses neutral white/gray surfaces, Windows system fonts and a restrained deep-teal accent. The light palette is the default.

To generate your own from a website URL, see [`onboarding.md`](onboarding.md).

---

## Tokens

### Semantic roles

Every token is referred to by **semantic role**, not by its hex value. Type references (`type-*.md`) and SKILL.md say `accent`, not `#bf4520`.

| Role | Purpose | Default (light) | Default (dark) |
|---|---|---|---|
| `paper` | Page background, default node fill | `#ffffff` | `#202124` |
| `paper-2` | Diagram container bg, secondary fill | `#f5f5f5` | `#2c2d30` |
| `ink` | Primary text, primary stroke | `#202124` | `#f5f5f5` |
| `ink-strong` | High-contrast text on accent fills | `#ffffff` | `#111111` |
| `muted` | Secondary text, default arrow stroke | `#55585c` | `#c8cbce` |
| `soft` | Sublabels, boundary labels | `#62676c` | `#aeb2b6` |
| `rule` | Decorative hairline borders | `rgba(32,33,36,0.12)` | `rgba(245,245,245,0.12)` |
| `rule-solid` | Decorative borders, baselines | `#c8cbce` | `#62676c` |
| `accent` | Focal / 1–2 max per diagram | `#0f5f5b` | `#85ccc4` |
| `accent-tint` | Fill for accent-bordered boxes | `rgba(15,95,91,0.08)` | `rgba(133,204,196,0.10)` |
| `link` | HTTP/API calls, external arrows | `#0f5f5b` | `#85ccc4` |

> **Profile source:** the user-approved Polarion interface direction. Accent is editorial, never an unlabelled status code.

### Contrast contract

Every token must clear the threshold for each role it plays, against the background it actually sits on, in both skins. `scripts/verify-contrast.py` computes the WCAG 2.x ratio for every row above against the `paper` of its skin (`ink-strong` against the 0.85 `accent` fill it labels) and fails CI when one falls short.

| Use | Minimum vs. its actual background |
|---|---|
| Regular text, including any `soft`, `link`, or `accent` used as text | 4.5:1 |
| Large text (24px+, or 18.7px+ at weight 600+) | 3:1 |
| Essential non-text marks: lines, arrows, borders, focus outlines, data points | 3:1 against the adjacent color |
| Decorative rules and translucent tints (`rule`, `rule-solid`, `paper-2`, `accent-tint`, fills at opacity) | No minimum, but never the only carrier of meaning |

- **A token used in several roles must pass each one.** `accent` is a stroke in one place and a label in another, so it is held to 4.5:1, not the 3:1 its strokes alone would need. Don't assume a token is non-text because it usually is.
- **Translucent colors are composited first.** An `rgba()` fill or stroke is blended over `paper` before its ratio is measured. A value that clears the bar at full strength can fail at 0.5 opacity.
- **Surfaces other than `paper` cost contrast.** Inside an `accent-tint` box or on `paper-2` every ratio drops. Measure text placed there against that surface, not against `paper`.
- Measure contrast on each actual surface; the inherited upstream default ratios do not describe this profile.

### Inversion rule (light → dark)

Use the explicit dark column only when requested. The application defaults to the neutral light palette.

### Series palette (multi-series chart types only)

A small set of desaturated, editorial-tone colors for chart types that genuinely need to distinguish multiple overlapping entities (currently: **radar**). The "1-focal" rule still holds — `accent` is reserved for the focal series; the palette below covers the rest.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `series-1` | `#7c8f6f` (sage) | `#9caf8f` | Non-focal series |
| `series-2` | `#5e7a9b` (dusty-blue) | `#82a0c0` | Non-focal series |
| `series-3` | `#b8915a` (mustard) | `#d3ad7a` | Non-focal series |
| `series-4` | `#9c6b50` (rust-brown) | `#b88670` | Non-focal series |
| `series-5` | `#6e6479` (slate) | `#8d8298` | Non-focal series |

Fills sit at `0.18` opacity light, `0.22` dark; strokes use the full color. **Don't backfill these tokens to non-chart types** — architecture, swimlane, etc. continue to use muted-ink variants. The series palette is opt-in for diagrams where overlapping shapes demand distinguishable color, not a license to add color elsewhere.

### Terminal skin (opt-in alternate)

A self-contained palette for the terminal-window primitive (see [primitive-terminal.md](primitive-terminal.md)) — a CLI-chrome register for dev-tool posts and technical social cards. It does not replace the default skin above and isn't affected by onboarding; it's a second, fixed skin you opt into per-diagram.

| Token | Hex | Purpose |
|---|---|---|
| `terminal-page` | `#0a0a0a` | Page background behind the window |
| `terminal-paper` | `#141414` | Window body, node fill |
| `terminal-bar` | `#1b1b1b` | Titlebar strip |
| `terminal-border` | `#2b2b2b` | Window border, hairlines |
| `terminal-ink` | `#f5f5f5` | Primary text, primary stroke (same white-smoke as default `ink`) |
| `terminal-muted` | `#9a9a9a` | Secondary text, sublabels, ring stroke |
| `terminal-soft` | `#5c5c5c` | Tertiary — inactive dots, spokes |
| `terminal-accent` | `#ff5a36` | The one accent — focal station, prompt sign, active dot |
| `terminal-accent-tint` | `rgba(255,90,54,0.12)` | Fill for accent-bordered boxes |

**1-accent rule still holds.** Everything that isn't `terminal-ink` or `terminal-muted`/`terminal-soft` should be `terminal-accent` — never introduce a second hue.

---

## Typography

| Role | Family | Size | Weight | Usage |
|---|---|---|---|---|
| `title` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 1.75rem | 600 | Page title |
| `node-name` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 12px | 600 | Human-readable labels |
| `sublabel` | Consolas, Microsoft YaHei UI, ui-monospace, monospace | 9px | 400 | Technical values only |
| `eyebrow` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 12px | 500 | Type tags and axes |
| `arrow-label` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 12px | 400 | Arrow annotations |
| `callout` | Segoe UI, Microsoft YaHei UI, system-ui, sans-serif | 14px | 400 | Editorial asides |

### Font stack

Use Windows system fonts: `"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif`.
For commands, ports and machine identifiers only, use `Consolas, "Microsoft YaHei UI", ui-monospace, monospace`.
For editable Excalidraw, choose its normal system/sans font, never handwriting; verify its actual preview face on Windows.

### Font source

Font source: `system`

No remote font stylesheet, font download or export @import. Font metrics must be measured in the actual renderer.

### Multilingual labels

Chinese prose uses Microsoft YaHei UI / Microsoft YaHei with the same hierarchy as Latin prose. Do not force prose into monospace.
Every wide or full-width character costs 1em; count digits, punctuation and spaces too. Keep at least 8px label padding.
Chinese labels must remain at least 12px in the final displayed image. If a label does not fit, shorten it or expand the node; never shrink below the legibility floor.
Arrow labels and their opaque masks must have enough width and height for the actual font. Preserve requirement IDs and printed labels exactly.

---

## Stroke, radius, spacing

| Token | Value | Use |
|---|---|---|
| `stroke-thin` | `0.8` | Tag-box outlines, leaf nodes |
| `stroke-default` | `1` | Most strokes |
| `stroke-strong` | `1.2` | Emphasis strokes |
| `radius-sm` | `4` | Small tags |
| `radius-md` | `6` | Node boxes |
| `radius-lg` | `8` | Containers, rings |
| `grid` | `4` | Every coord, size, and gap is divisible by 4 (hard rule) |

---

## Node type → treatment

Semantic role combinations — reference these by name in type specs.

| Type | Fill | Stroke |
|---|---|---|
| `focal` (1–2 max) | `accent-tint` | `accent` |
| `backend` | `#ffffff` (white) | `ink` |
| `store` | `ink @ 0.05` | `muted` |
| `external` | `ink @ 0.03` | `ink @ 0.30` |
| `input` | `muted @ 0.10` | `soft` |
| `optional` | `ink @ 0.02` | `ink @ 0.20` dashed `4,3` |
| `security` | `accent @ 0.05` | `accent @ 0.50` dashed `4,4` |

---

## Customizing the skin

Four options:

1. **Run onboarding** — see [`onboarding.md`](onboarding.md). Drop a URL; the skill extracts the palette + fonts and rewrites this file.
2. **Edit by hand** — change the hex values in the tables above. Run the pre-output taste gate afterward to verify the accent still reads as "focal" against the new paper color.
3. **Brand handoff** — paste your existing design-token JSON into a new section here and map its tokens to the semantic roles above.
4. **Client profiles** — save and switch named skins, or bind one to a project, using [`profiles.md`](profiles.md).

### Constraints (don't break these)

- **Contrast**: every text token (`ink`, `muted`, `soft`, `link`, and `accent`) must clear 4.5:1 on `paper`, in both skins. See the [contrast contract](#contrast-contract); `scripts/verify-contrast.py` checks it.
- **One accent**: pick one color for `accent`. Two accents erases the focal signal.
- **No rainbow palette**: if your brand ships 8 colors, pick 3 (paper, ink, accent). The rest become `muted` variants.
- **Serif + sans + mono**: three families, not more. If brand typography is all sans, keep Instrument Serif for `title` and `callout` anyway — the contrast is load-bearing.
- **Paper is warm-neutral, not pure white**: pure white turns the design sterile. Pick a cream, bone, or light grey with a hint of warmth.
- **Dot pattern is optional, not default**: the 22×22 dot pattern is an opt-in "dotted paper" variant (good for long-form editorial hero diagrams). The default background is a clean `paper` fill, no pattern. When the pattern is enabled, it should sit at ~10% opacity of `ink` on `paper` — visible but quiet.
- **Container is clean by default**: the diagram sits directly on the page paper, no secondary container background or border. A framed variant (`paper-2` bg + `rule` border + 8px radius + padding) is available as an opt-in for card-heavy layouts, but don't reach for it by default — the extra chrome fights the figure.
