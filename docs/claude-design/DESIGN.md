# Human Datastream -- Design System

A dark sci-fi data dashboard that tracks body and mind. The visual language is built on a near-black background, glass-morphism card surfaces, 10 neon accent colors, and Space Grotesk typography. Everything scales fluidly between 600px and 1400px viewports using CSS `clamp()` tokens.

## Companion Files

- `tokens.css` -- CSS custom properties (source of truth for all token values)
- `tokens.json` -- Machine-readable W3C Design Tokens with semantic descriptions
- `components.md` -- HTML + CSS patterns for 10 core UI components
- `interactions.md` -- Animation, hover, skeleton, and motion patterns
- `layout.md` -- Panel structure, grid system, responsive breakpoints
- `screenshots/` -- Full-page and per-widget visual references at 4 viewports
- `fonts/` -- Space Grotesk variable WOFF2 (latin + latin-ext subsets)

---

## Color Palette

### Neon Accents

| Token | Hex | Usage |
|-------|-----|-------|
| `--neon-pink` | `#ff006e` | Primary accent, Body column, left panel border |
| `--neon-blue` | `#3a86ff` | Secondary accent, hydration water, bio terminal |
| `--neon-green` | `#06d6a0` | Success states, Mind column, live-dot default |
| `--neon-amber` | `#f59e0b` | Warning, heart rate, bookshelf, reading feed |
| `--neon-purple` | `#a855f7` | Sleep, night summary |
| `--neon-red` | `#ef4444` | Alert states, daily activity |
| `--neon-cyan` | `#00d4ff` | Info, data streams |
| `--neon-orange` | `#ff6b00` | Urgency, degraded state |
| `--neon-indigo` | `#818cf8` | Identity card glow, avatar ring, cognitive |
| `--neon-yellow` | `#ffd600` | Theatre reviews (defined in component scope) |

### High-Contrast Variants (AAA >= 7:1 against #06060f)

| Token | Hex | Base |
|-------|-----|------|
| `--neon-pink-hc` | `#ff69b4` | pink |
| `--neon-purple-hc` | `#c084fc` | purple |
| `--neon-red-hc` | `#f87171` | red |

### Background and Text

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#06060f` | Page background (near-black) |
| `--text` | `#f0f0f0` | Primary text |
| `--text-muted` | `#9ca3af` | Secondary text, timestamps, labels |

---

## Typography

**Font family:** Space Grotesk (variable, weights 300--700)
**Font stack:** `'Space Grotesk', 'Space Grotesk Fallback', sans-serif`
**Fallback:** Metric-matched Arial (`size-adjust: 106%; ascent-override: 90%`) to minimize CLS

### Type Scale (fluid clamp, 600px--1400px)

| Token | Min | Max | Usage |
|-------|-----|-----|-------|
| `--font-size-xs` | 0.625rem | 0.72rem | Fine print, heatmap labels |
| `--font-size-sm` | 0.7rem | 0.78rem | Timestamps, secondary labels |
| `--font-size-base` | 0.72rem | 0.82rem | Body text, widget content |
| `--font-size-md` | 0.72rem | 0.82rem | Widget labels, emphasis |
| `--font-size-lg` | 0.88rem | 1.05rem | Section headers |
| `--font-size-xl` | 1.20rem | 1.50rem | Large numbers (BPM, counts) |
| `--font-size-2xl` | 1.60rem | 2.00rem | Hero numbers |
| `--font-size-3xl` | 1.90rem | 2.40rem | Reserved |
| `--font-size-hero` | 1.80rem | 2.20rem | Identity name |

---

## Glass-Morphism

The signature surface effect. Three elevation levels, two border weights, four blur levels.

### The Recipe

```css
/* Default card surface */
background: var(--glass-bg);           /* rgba(255,255,255,0.07) */
border: 1px solid var(--glass-border); /* rgba(255,255,255,0.1)  */
backdrop-filter: blur(var(--blur-lg)); /* 24px */
-webkit-backdrop-filter: blur(var(--blur-lg));
```

### Surface Elevations

| Token | Value | Usage |
|-------|-------|-------|
| `--glass-bg-inset` | `rgba(255,255,255,0.03)` | Recessed panels, nested backgrounds |
| `--glass-bg` | `rgba(255,255,255,0.07)` | Default card surface |
| `--glass-bg-raised` | `rgba(255,255,255,0.11)` | Elevated elements, hover states |

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `--glass-border` | `rgba(255,255,255,0.1)` | Default card borders |
| `--glass-border-strong` | `rgba(255,255,255,0.18)` | High-emphasis borders, hover |

### Blur Scale

| Token | Value |
|-------|-------|
| `--blur-sm` | 8px |
| `--blur-md` | 16px |
| `--blur-lg` | 24px |
| `--blur-xl` | 32px |

---

## Glow Shadows

Each accent color has a two-layer glow for hover/focus states and a reduced single-layer variant for mobile performance.

```css
/* Desktop: two-layer glow */
--glow-pink: 0 0 20px rgba(255,0,110,0.3), 0 0 40px rgba(255,0,110,0.15);

/* Mobile: single-layer, reduced intensity */
--glow-pink-sm: 0 0 12px rgba(255,0,110,0.25);
```

All 9 accent colors have matching `--glow-{color}` and `--glow-{color}-sm` tokens.

---

## Spacing Scale (fluid clamp, 600px--1400px)

16 tokens from `--space-2` (1--2px) through `--space-48` (32--48px). All use `clamp()` with `rem + vw` preferred values.

| Token | Min | Max |
|-------|-----|-----|
| `--space-2` | 1px | 2px |
| `--space-4` | 3px | 4px |
| `--space-6` | 4px | 6px |
| `--space-8` | 6px | 8px |
| `--space-10` | 7px | 10px |
| `--space-12` | 8px | 12px |
| `--space-14` | 10px | 14px |
| `--space-16` | 11px | 16px |
| `--space-18` | 12px | 18px |
| `--space-20` | 14px | 20px |
| `--space-24` | 16px | 24px |
| `--space-28` | 18px | 28px |
| `--space-32` | 22px | 32px |
| `--space-36` | 24px | 36px |
| `--space-40` | 28px | 40px |
| `--space-48` | 32px | 48px |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 2px | Heatmap cells, small elements |
| `--radius-md` | 8px | Inner cards, terminals |
| `--radius-lg` | clamp(12--16px) | Large cards |
| `--radius-xl` | clamp(14--20px) | Identity card, widget cards |
| `--radius-pill` | 50px | Pill buttons, tags |
| `--radius-circle` | 50% | Avatars, dots |

---

## Design Rules

1. **Dark base only.** The background is always `#06060f`. Never use solid white or light backgrounds.
2. **Glass, not opaque.** Cards use semi-transparent glass surfaces with backdrop-blur, never solid fills.
3. **Neon accents on dark.** Each accent color is used sparingly -- a 2px top border, a text-shadow glow, a dot indicator. Never as a large filled area.
4. **Fluid, not fixed.** All typography and spacing use `clamp()` tokens. Hardcoded `px` values are only for borders (1px), dots (6px), and elements too small to scale.
5. **Container queries for widgets.** Widget internals adapt via `@container` queries on `.tri-card`. Structural layout changes use `@media` breakpoints.
6. **Hover gating.** All hover effects are wrapped in `@media (hover: hover)` to prevent sticky hover on touch devices.
7. **ES5 in inline scripts.** Any client-side JavaScript uses `var`, `function`, IIFEs. No `let`/`const`/arrows.
8. **Accessibility first.** Focus indicators use neon-pink outlines. High-contrast and forced-colors modes have dedicated overrides. Reduced motion disables all animations.
