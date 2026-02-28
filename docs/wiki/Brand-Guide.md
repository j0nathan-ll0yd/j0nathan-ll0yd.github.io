# Brand Guide

Design system documentation for the Command Center portfolio. All tokens are defined in `public/css/tokens.css`.

## Overview

The visual language is a dark sci-fi aesthetic with glass-morphism cards, neon accent colors, and a particle background. The system is designed for a single-page dashboard with 13 widgets organized in a split-panel layout.

A legacy interactive reference page is preserved at `legacy/brand-guide.html`.

## Color Palette

### Neon Accents

| Token | Hex | Usage |
|---|---|---|
| `--neon-pink` | `#ff006e` | Primary accent, left panel border, Body column |
| `--neon-blue` | `#3a86ff` | Secondary accent, hydration, bio terminal |
| `--neon-green` | `#06d6a0` | Success states, Mind column |
| `--neon-amber` | `#f59e0b` | Warning states, heart rate |
| `--neon-purple` | `#a855f7` | Sleep, night summary |
| `--neon-red` | `#ef4444` | Alert states |
| `--neon-cyan` | `#00d4ff` | Info, data streams, system output |
| `--neon-orange` | `#ff6b00` | Urgency, degraded state |
| `--neon-indigo` | `#818cf8` | Deep/premium, cognitive |

### High-Contrast Variants

For small text or `prefers-contrast: more` contexts, use these AAA-compliant alternatives:

| Token | Hex | Base Color | Contrast vs #06060f |
|---|---|---|---|
| `--neon-pink-hc` | `#ff69b4` | `--neon-pink` | 7.62:1 |
| `--neon-purple-hc` | `#c084fc` | `--neon-purple` | 7.64:1 |
| `--neon-red-hc` | `#f87171` | `--neon-red` | 7.29:1 |

### Background & Text

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#06060f` | Page background (near-black) |
| `--text` | `#f0f0f0` | Primary text |
| `--text-muted` | `#9ca3af` | Secondary text, timestamps, labels |

## Glass-Morphism

The signature card effect uses three properties:

```css
background: var(--glass-bg);           /* rgba(255,255,255,0.07) */
border: 1px solid var(--glass-border); /* rgba(255,255,255,0.1)  */
backdrop-filter: blur(var(--blur-md)); /* 16px                   */
```

### Blur Scale

| Token | Value |
|---|---|
| `--blur-sm` | `8px` |
| `--blur-md` | `16px` |
| `--blur-lg` | `24px` |
| `--blur-xl` | `32px` |

### Surface Elevation

| Token | Value | Usage |
|---|---|---|
| `--glass-bg-inset` | `rgba(255,255,255,0.03)` | Recessed panels, nested backgrounds |
| `--glass-bg` | `rgba(255,255,255,0.07)` | Default card surface |
| `--glass-bg-raised` | `rgba(255,255,255,0.11)` | Elevated elements, hover states |
| `--glass-border` | `rgba(255,255,255,0.1)` | Default borders |
| `--glass-border-strong` | `rgba(255,255,255,0.18)` | High-emphasis borders |

### Glow Shadows

Each accent color has a matching glow token for hover/focus states:

```css
--glow-pink: 0 0 20px rgba(255,0,110,0.3), 0 0 40px rgba(255,0,110,0.15);
--glow-blue: 0 0 20px rgba(58,134,255,0.3), 0 0 40px rgba(58,134,255,0.15);
/* ... green, amber, purple, red, cyan, orange, indigo */
```

All glow tokens: `--glow-pink`, `--glow-blue`, `--glow-green`, `--glow-amber`, `--glow-purple`, `--glow-red`, `--glow-cyan`, `--glow-orange`, `--glow-indigo`

## Typography

**Font**: [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) (weights 300--700)

### Font Scale

| Token | Size | Usage |
|---|---|---|
| `--font-size-xs` | `0.42rem` | Heatmap labels, fine print |
| `--font-size-sm` | `0.55rem` | Timestamps, secondary labels |
| `--font-size-base` | `0.72rem` | Body text, widget content |
| `--font-size-md` | `0.82rem` | Widget labels, emphasis |
| `--font-size-lg` | `1.05rem` | Section headers |
| `--font-size-xl` | `1.5rem` | Large numbers (BPM, counts) |
| `--font-size-2xl` | `2rem` | Hero numbers |
| `--font-size-3xl` | `2.4rem` | Unused (reserved) |
| `--font-size-hero` | `2.2rem` | Identity name |

## Widget Structure

Every dashboard widget follows the `.tri-card` pattern:

```html
<div class="tri-card tri-card-accent-pink">
  <div class="widget-header">
    <span class="widget-label">Widget Name</span>
    <div class="widget-header-right">
      <div class="live-dot"></div>
      <span class="widget-timestamp">timestamp</span>
    </div>
  </div>
  <div class="widget-body">
    <!-- Widget content -->
  </div>
</div>
```

### Accent Classes

| Class | Color | Usage |
|---|---|---|
| `.tri-card-accent-pink` | `--neon-pink` | Body column widgets |
| `.tri-card-accent-blue` | `--neon-blue` | Bio terminal, hydration |
| `.tri-card-accent-green` | `--neon-green` | Mind column widgets |
| `.tri-card-accent-amber` | `--neon-amber` | Heart rate |
| `.tri-card-accent-purple` | `--neon-purple` | Night summary |
| `.tri-card-accent-red` | `--neon-red` | Alert states |
| `.tri-card-accent-cyan` | `--neon-cyan` | (available) |
| `.tri-card-accent-orange` | `--neon-orange` | (available) |
| `.tri-card-accent-indigo` | `--neon-indigo` | (available) |

### Live Dots

Status indicators in widget headers. Matching color classes:
- `.live-dot-pink`, `.live-dot-blue`, `.live-dot-green`, `.live-dot-amber`, `.live-dot-purple`, `.live-dot-red`, `.live-dot-cyan`, `.live-dot-orange`, `.live-dot-indigo`

## Layout System

### Structure

```
.command-layout
├── .left-panel      (35% width, fixed)
│   ├── .identity-card
│   ├── .tri-card (bio terminal)
│   └── .tri-card (system status)
├── .top-bar         (spans right panel)
│   ├── .top-bar-title
│   └── .top-bar-clock
└── .right-panel     (65% width, scrollable)
    └── .triptych-grid
        ├── .triptych-column-body
        └── .triptych-column-mind
```

### Spacing Scale

Tokens from `--space-2` (2px) through `--space-48` (48px) in increments of 2--4px.

### Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `2px` | Heatmap cells |
| `--radius-md` | `8px` | Widget cards |
| `--radius-lg` | `16px` | Large cards |
| `--radius-xl` | `20px` | Identity card |
| `--radius-pill` | `50px` | Pills, buttons |
| `--radius-circle` | `50%` | Avatars |

## Responsive Breakpoints

| Breakpoint | Behavior |
|---|---|
| `> 1400px` | Full layout: 35/65 panel split |
| `1100--1400px` | Adjusted panel proportions |
| `900--1100px` | Further layout adjustments |
| `< 900px` | Single column: left panel stacks above right panel |
| `< 600px` | Mobile: smaller fonts, reduced spacing, compact widgets |

## Animation Catalog

| Animation | Location | Behavior |
|---|---|---|
| **Particles** | Full-page canvas | Three.js shader points with connecting lines. 180 on desktop, 60 on mobile. Responds to mouse. Respects `prefers-reduced-motion`. |
| **Card reveal** | All cards | Staggered opacity/transform transition. Left panel cards first, then triptych cards by column and row. |
| **Terminal typing** | Bio terminal | Types commands character-by-character, reveals output with delays. |
| **Hydration wave** | Hydration widget | CSS wave animation with fill level. Count-up from 0 to target value. |
| **ECG heartbeat** | Heart rate widget | CSS keyframe pulse animation on the BPM number. |
| **Live dots** | Widget headers | Subtle pulse animation indicating active status. |
| **Count-up** | Numeric displays | Animates from 0 to target number over ~1 second. |
