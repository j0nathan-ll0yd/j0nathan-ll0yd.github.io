---
name: update-claude-design
description: Regenerate the Claude Design system package at docs/claude-design/. Use when design tokens, components, screenshots, or visual baselines change. Triggers on "update claude design", "regenerate design system", "refresh claude design".
---

# Update Claude Design Package

Regenerate `docs/claude-design/` -- the design system package for Claude Design (claude.ai/design).

## When to Run

- Design tokens changed in `public/css/tokens.css`
- Component CSS changed in `public/css/components.css`
- Visual test baselines were re-recorded (`npm run test:visual:update`)
- New widgets were added or existing widgets significantly restyled
- Layout breakpoints changed in `src/styles/layout.css`
- Animation/interaction patterns changed in `public/css/effects.css` or `public/css/base.css`
- Font files changed in `public/fonts/`

## Source Files

| Source | Used By |
|--------|---------|
| `public/css/tokens.css` | `DESIGN.md`, `tokens.json`, `tokens.css` (direct copy) |
| `public/css/components.css` | `components.md` |
| `public/css/effects.css` | `interactions.md` |
| `public/css/base.css` | `interactions.md` (accessibility patterns) |
| `src/styles/layout.css` | `layout.md` |
| `docs/wiki/Brand-Guide.md` | `DESIGN.md` (narrative framing, usage descriptions) |
| `tests/visual/__screenshots__/desktop-1400/` | `screenshots/` (widget + variation shots) |
| `tests/visual/__screenshots__/*/dashboard.spec.ts/` | `screenshots/` (full-page at 4 viewports) |
| `public/fonts/*.woff2` | `fonts/` (latin + latin-ext only) |

## Step 1: Diff What Changed

Before regenerating, identify what changed to scope the update:

```bash
git diff --name-only HEAD -- public/css/ src/styles/layout.css public/fonts/ tests/visual/__screenshots__/
```

If only screenshots changed, skip to Step 6. If only tokens changed, focus on Steps 2-3. If component CSS changed, focus on Step 4.

## Step 2: Update DESIGN.md

Read the current `public/css/tokens.css` and `docs/wiki/Brand-Guide.md`. Update `docs/claude-design/DESIGN.md` to reflect any changes to:

- Color palette (new accents, changed hex values, new HC variants)
- Typography (font family, size token clamp values)
- Glass-morphism (elevation levels, border values, blur scale)
- Spacing scale (new or changed tokens)
- Border radius or glow shadow tokens
- Design rules

**Target:** ~200 lines. Keep the companion-file manifest at the top current.

## Step 3: Update tokens.json

Regenerate `docs/claude-design/tokens.json` in W3C Design Tokens Community Group format. For every custom property in `tokens.css`:

- `$value`: The exact CSS value
- `$type`: One of `color`, `dimension`, `fontFamily`, `shadow`
- `$description`: Semantic intent explaining when/where to use the token

Cross-reference `docs/wiki/Brand-Guide.md` for usage descriptions. Check scoped component styles for any accent colors not in `tokens.css` (e.g., `#ffd600` yellow in `TheatreReviews.astro`).

## Step 4: Update components.md

Read `public/css/components.css` and update `docs/claude-design/components.md`. The 10 core patterns:

1. Widget Card (`.tri-card`) -- base + 9 accent classes + hover states
2. Widget Header -- `.widget-header` + `.widget-label` + `.live-dot` + `.widget-timestamp`
3. Widget Body -- `.widget-body` with container query padding
4. Identity Card -- avatar glow, hero text, tagline, pill links
5. Neon Pill -- pill-shaped button with indigo hover glow
6. Bio Terminal -- macOS title bar, colored dots, blue prompt, cursor
7. System Status Lines -- `.sys-line` with colored dots and key-value pairs
8. Skeleton Loading -- `.skeleton-bar` shimmer + `.is-loading` overlay
9. Book Modal -- overlay + blurred backdrop + amber accent modal
10. Metric Display -- `.split-cols` two-column layout

Each pattern needs: HTML structure snippet + complete CSS from components.css.

If a new production widget was added, evaluate whether it introduces a new reusable pattern worth documenting.

## Step 5: Update interactions.md and layout.md

**interactions.md** -- Read `public/css/effects.css` and `public/css/base.css`. Update:
- Keyframe animations (card reveal, dot pulse, shimmer, ECG, terminal blink, hydration, etc.)
- Hover gating (`@media (hover: hover)` pattern)
- Touch target sizing
- Widget update feedback
- Focus indicators, high contrast, forced colors
- Reduced motion override

**layout.md** -- Read `src/styles/layout.css`. Update:
- Split panel structure (left 35% / right 65%)
- Triptych grid columns and gutter lines
- Container queries from `components.css`
- All responsive breakpoints (1920px, 1100px, 767px, 600px, 374px)
- Backdrop-filter fallback

## Step 6: Copy tokens.css

```bash
cp public/css/tokens.css docs/claude-design/tokens.css
```

## Step 7: Update Screenshots

Copy full-page dashboard screenshots (populated state) from each viewport:

```bash
BASE="tests/visual/__screenshots__"
DST="docs/claude-design/screenshots"

# Full-page (4 viewports)
cp "$BASE/desktop-1400/dashboard.spec.ts/dashboard-populated.png" "$DST/dashboard-desktop-1400.png"
cp "$BASE/tablet-1100/dashboard.spec.ts/dashboard-populated.png" "$DST/dashboard-tablet-1100.png"
cp "$BASE/tablet-768/dashboard.spec.ts/dashboard-populated.png" "$DST/dashboard-tablet-768.png"
cp "$BASE/mobile-600/dashboard.spec.ts/dashboard-populated.png" "$DST/dashboard-mobile-600.png"
```

Copy per-widget screenshots from `desktop-1400/widgets.spec.ts/`:

```bash
SRC="$BASE/desktop-1400/widgets.spec.ts"
for f in widget-heart-rate widget-hydration widget-bookshelf widget-night-summary \
         widget-identity-card widget-bio-terminal widget-dev-activity-log \
         widget-system-status widget-daily-activity widget-reading-feed \
         widget-workouts widget-theatre-reviews; do
  cp "$SRC/$f.png" "$DST/$f.png"
done
```

Copy variation state screenshots:

```bash
for f in hr-resting hr-peak hydration-zero hydration-max sleep-deep-dominant; do
  cp "$SRC/$f.png" "$DST/$f.png"
done
```

If new widgets or variations were added, include their screenshots too. Check `ls $SRC/` for available baselines.

## Step 8: Update Fonts

```bash
cp public/fonts/space-grotesk-latin.woff2 docs/claude-design/fonts/
cp public/fonts/space-grotesk-latin-ext.woff2 docs/claude-design/fonts/
```

Only copy latin and latin-ext subsets (not vietnamese -- irrelevant to design system documentation).

## Step 9: Verify

Run a final check:

```bash
# Verify all expected files exist
find docs/claude-design -type f | sort

# Validate tokens.json is valid JSON
python3 -c "import json; json.load(open('docs/claude-design/tokens.json')); print('Valid JSON')"

# Check DESIGN.md stays under ~200 lines
wc -l docs/claude-design/DESIGN.md

# Show total package size
du -sh docs/claude-design/
```

## Key Constraints

- **DESIGN.md target: ~200 lines.** Keep it concise -- detailed patterns go in companion files.
- **tokens.css is the source of truth** for token values. tokens.json adds semantic `$description` but values must match.
- **Screenshots come from visual test baselines only.** Never generate from dev server -- baselines are deterministic, fixture-stabilized, and cross-OS consistent.
- **No ZIP files.** Claude Design accepts individual files, not archives.
- **30MB per file limit, 8000x8000px max** for images in Claude Design.
- **W3C DTCG format** for tokens.json: `$value`, `$type`, `$description` fields.
