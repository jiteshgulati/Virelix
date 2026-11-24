# Virelix design system

**Direction:** a reading room. Warm paper, iron-gall ink, bookcloth accents, and a lamp at night.
The product is about *where words appear*, so the interface leans on typography and the
concordance rather than decoration.

## Identity

- **Wordmark:** "Virelix" set in Newsreader at display optical size, weight 560, tracking −0.025 to −0.035 em. The closing **x** is italic and set in the accent colour: the cross-reference mark. It's text, not an image, so it adapts to every theme and accent.
- **Signature elements:**
  1. *Concordance marks.* Matched terms appear as mono chips with a brass underline (`.vx-term`), and missing terms are struck through, so every result shows how it matched.
  2. *Ordinal gutter.* Results carry their position (`01`, `02`, …) in mono: a position, never a score.
  3. *Keyword-in-context aside* on auth screens, quoting the real corpus.
  4. *Proofreader stamps* (`.vx-stamp`) for availability: "Not available", "Not connected", "No data".
  5. Collections drawn as stacks of index cards; entry points with an index-tab hover.

## Type

| Role | Face | Notes |
|---|---|---|
| Display, page titles, reading text, figures | Newsreader (variable, opsz) | Titles 30 px / 520; document body 18 px / 1.68; drop cap in accent |
| Interface | Geist (variable) | Base 14 px (13 / 15.5 with text-size preference) |
| Terms, IDs, counts | Geist Mono | Tabular numerals throughout |

The scale is a 1.25 ratio from the base: caption 11.2 · small 13 · body 14 · h4 16 · h3 18 · h2 22 · h1 30 · display 56.

## Colour tokens (`frontend/assets/css/tokens.css`)

- Surfaces: `--paper` (canvas), `--paper-raised` (panels), `--paper-overlay` (menus, dialogs), `--paper-sunk` (inputs, inset).
- Ink: `--ink` primary, `--ink-2` secondary, `--ink-3` metadata (≥4.5:1 on every surface), `--ink-4` disabled and decorative only.
- Rules: `--rule`, `--rule-soft`, `--rule-strong`, all low-opacity ink.
- Semantic: `--danger` (vermilion), `--warning` (ochre), `--success`, `--info`, each with a `-soft` tint.
- Accent: one at a time. Viridian (default), Lapis, Oxblood, Ochre, Plum or Graphite; lightened automatically in dark themes.
- Themes: light (paper), dark (warm charcoal `#151513`), OLED (true black), system.

## Depth, space, motion

- Depth: hairline rules and a 1 px ring with soft layered shadow for raised panels (`--shadow-lift`). Overlays alone get `--shadow-overlay`. Dark themes rely on rings.
- Spacing: 4 px base (`--s-1` … `--s-16`). Comfortable density pads panels 20 px; compact pads 16 px and uses 32 px controls.
- Radius: 6 px controls, 10 px panels, 14 px overlays and search bar.
- Motion: 120–240 ms with `cubic-bezier(0.23, 1, 0.32, 1)`. Page transitions animate opacity only, because a transform would capture fixed overlays. Press feedback is `scale(0.97)`. Reduced-motion preference (system, reduce or full) is honoured.

## Components (CSS classes)

`vx-btn` (primary · quiet · danger · danger-solid · sm · icon) · `vx-input` / `vx-select` / `vx-textarea` · `vx-check` · `vx-switch` · `vx-segment` · `vx-panel` · `vx-ledger` (label/value rows) · `vx-figures` (metric strip) · `vx-stamp` · `vx-badge` · `vx-notice` · `vx-empty` · `vx-unavailable` · `vx-table` (`.stack` collapses to cards below 768 px) · `vx-tabs` · `vx-searchbar` · `vx-result` · `vx-term` · `vx-overview` · `vx-filter-panel` (becomes a bottom sheet on phones) · `vx-list` · `vx-cards`.

Bootstrap 5.3 supplies dropdowns, modals, offcanvas, toasts, tooltips and popovers. They're themed through Bootstrap's CSS variables so they follow every theme and accent.
