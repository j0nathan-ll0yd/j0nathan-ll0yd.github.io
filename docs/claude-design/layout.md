# Layout System

The dashboard uses a fixed left panel + scrollable right panel split, with a command bar and triptych grid. Layout adapts across 5 structural breakpoints.

---

## 1. Split Panel Layout

The page is a horizontal flex container. The left panel is fixed (identity card + bio + system status). The right panel scrolls vertically and contains all widget cards.

```
.command-layout (flex row, 100dvh)
├── .left-panel      (35% width, fixed position, centered content)
│   ├── .identity-card
│   ├── .left-panel-bio (terminal)
│   └── .left-panel-status (system status)
├── .top-bar         (fixed at top of right area, blurred)
│   ├── .top-bar-title
│   └── .top-bar-clock
└── .right-panel     (65% width, overflow-y: auto)
    └── .triptych-grid
```

### CSS

```css
.command-layout {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
}

.left-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--left-width);      /* 35% */
  height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding: var(--space-48) var(--space-36);
  gap: 0;
  overflow-y: auto;
  scrollbar-width: none;
  z-index: 10;
}

/* Neon pink divider line on right edge */
.left-panel::after {
  content: '';
  position: absolute;
  top: 5%;
  right: 0;
  width: 1px;
  height: 90%;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(255,0,110,0.4) 20%,
    rgba(255,0,110,0.6) 50%,
    rgba(255,0,110,0.4) 80%,
    transparent 100%
  );
  box-shadow: 0 0 8px rgba(255,0,110,0.3), 0 0 20px rgba(255,0,110,0.1);
}

.top-bar {
  position: fixed;
  top: 0;
  left: var(--left-width);
  right: 0;
  height: var(--top-bar-height);  /* clamp(40-48px) */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-24);
  background: rgba(6,6,15,0.7);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  z-index: 20;
}

.top-bar-title {
  font-size: var(--font-size-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 4px;
  color: var(--text-muted);
}

.top-bar-clock {
  font-family: 'Space Grotesk', monospace;
  font-size: var(--font-size-base);
  color: var(--neon-blue);
  text-shadow: 0 0 8px rgba(58,134,255,0.4);
  letter-spacing: 1px;
  margin-left: auto;
}

.right-panel {
  margin-left: var(--left-width);
  width: var(--right-width);      /* 65% */
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: calc(var(--top-bar-height) + var(--space-4)) var(--space-20) var(--space-24);
  scrollbar-width: thin;
  scrollbar-color: rgba(255,0,110,0.3) transparent;
  scroll-behavior: smooth;
}
```

---

## 2. Triptych Grid

The right panel content area uses a 2-column grid: a "Body" column (health/physical widgets) and a "Mind" column (coding/reading widgets). Columns have neon-colored gutter lines.

```css
.triptych-grid {
  display: grid;
  grid-template-columns: minmax(min(100%, 300px), 2fr) 3fr;
  gap: var(--space-12);
}

.triptych-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  position: relative;
  min-width: 0;
  overflow: hidden;
}

/* Vertical neon gutter line between columns */
.triptych-column::before {
  content: '';
  position: absolute;
  top: 0;
  left: calc(-6px - 0.5px);
  width: 1px;
  height: 100%;
  opacity: 0.15;
  pointer-events: none;
}

.triptych-column:first-child::before { display: none; }
.triptych-column-body::before { background: var(--neon-pink); box-shadow: 0 0 6px rgba(255,0,110,0.3); }
.triptych-column-mind::before { background: var(--neon-green); box-shadow: 0 0 6px rgba(6,214,160,0.3); }

/* Column headers */
.column-header {
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 6px;
  padding: var(--space-8) 0 var(--space-10);
}

.column-header-pink {
  color: var(--neon-pink);
  border-bottom: 1px solid rgba(255,0,110,0.3);
  text-shadow: 0 0 8px rgba(255,0,110,0.3);
}

.column-header-green {
  color: var(--neon-green);
  border-bottom: 1px solid rgba(6,214,160,0.3);
  text-shadow: 0 0 8px rgba(6,214,160,0.3);
}
```

---

## 3. Container Queries

Widget cards have `container-type: inline-size`, enabling `@container` queries for internal layout adaptation. This is how widgets respond to their own width rather than the viewport.

```css
.tri-card {
  container-type: inline-size;
}

/* Narrow widgets: compact typography and padding */
@container (max-width: 200px) {
  .pulse-bpm { font-size: var(--font-size-xl); }
  .split-metric-value { font-size: var(--font-size-lg); }
  .widget-label { letter-spacing: 1.5px; }
  .widget-body { padding: var(--space-8) var(--space-10) var(--space-10); }
}

/* Narrow bookshelf: smaller covers */
@container (max-width: 280px) {
  .shelf-book { width: 85px; }
  .shelf-cover-wrapper { width: 76px; height: 114px; }
}

/* Wide bookshelf: larger covers */
@container (min-width: 400px) {
  .shelf-book { width: 115px; }
  .shelf-cover-wrapper { width: 105px; height: 158px; }
}

/* Narrow hydration: compact vessels */
@container (max-width: 250px) {
  .hydra-layout { gap: 12px; }
  .hydra-bottle-body { width: 44px; height: 88px; }
  .hydra-mug-body { width: 48px; height: 64px; }
}

/* Narrow GitHub: hide contribution grid */
@container (max-width: 300px) {
  .contrib-grid { display: none; }
}

/* Medium GitHub: condensed grid */
@container (min-width: 301px) and (max-width: 450px) {
  .contrib-grid { justify-content: flex-end; }
  .contrib-cell { width: 6px; height: 6px; }
}

/* Wide widgets: more generous padding */
@container (min-width: 500px) {
  .widget-body { padding: var(--space-14) var(--space-24) var(--space-20); }
}
```

---

## 4. Responsive Breakpoints

5 structural breakpoints handle the transition from ultra-wide desktop to micro mobile. Font and spacing scaling is handled by fluid `clamp()` tokens -- breakpoints only change structure.

### Ultra-Wide (min-width: 1920px)

Layout caps at 2400px and centers. HUD frame corner decorations appear.

```css
@media (min-width: 1920px) {
  .command-layout {
    max-width: var(--max-site-width);  /* 2400px */
    margin: 0 auto;
  }

  .left-panel {
    left: max(0px, calc((100vw - var(--max-site-width)) / 2));
    width: calc(var(--max-site-width) * 0.35);
  }
}
```

### Tablet Bento (768px -- 1100px)

Left panel collapses via `display: contents`. Identity card becomes a horizontal row. Body column gets a 2-column bento sub-grid. Top bar becomes sticky.

```css
@media (min-width: 768px) and (max-width: 1100px) {
  html, body { overflow: auto; }
  .command-layout { flex-direction: column; height: auto; }

  .left-panel { display: contents; }
  .left-panel::after { display: none; }

  /* Identity card: compact horizontal row */
  .identity-card {
    display: flex;
    align-items: center;
    gap: var(--space-16);
    text-align: left !important;
    padding: var(--space-16) var(--space-24) !important;
  }

  .id-avatar { width: 56px; height: 56px; margin: 0 !important; }

  .top-bar { position: sticky; top: 0; left: 0; width: 100%; }

  .right-panel { margin-left: 0; width: 100%; height: auto; overflow: visible; }

  /* Body column: 2-col bento grid */
  .triptych-grid { grid-template-columns: 1fr; }
  .triptych-column-body { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-12); }
  .triptych-column-body .column-header { grid-column: 1 / -1; }
}
```

### Mobile (max-width: 767px)

Single column layout. Identity card centered with wrapped flex. All cards visible immediately (no stagger animation). Safe-area insets for notched devices.

```css
@media (max-width: 767px) {
  html, body { overflow: auto; }
  .command-layout { flex-direction: column; height: auto; }
  .left-panel { display: contents; }

  .identity-card {
    display: flex;
    align-items: center;
    gap: var(--space-16);
    justify-content: center;
    text-align: center;
    flex-wrap: wrap;
  }

  .id-avatar { width: 68px; height: 68px; }
  .id-name { font-size: 1.8rem; }

  .triptych-grid { grid-template-columns: 1fr; }
  .triptych-column-body { display: flex; flex-direction: column; }

  .right-panel {
    margin-left: 0;
    width: 100%;
    padding: var(--space-12) var(--space-12) var(--space-24);
  }
}
```

### Small Mobile (max-width: 600px)

Tighter padding, smaller avatars, condensed contribution grid. Safe-area bottom padding.

```css
@media (max-width: 600px) {
  .right-panel {
    padding: var(--space-8) var(--space-10) var(--space-24);
    padding-bottom: calc(var(--space-24) + env(safe-area-inset-bottom, 0px));
  }

  .identity-card {
    padding: 24px 16px;
    margin-top: calc(var(--space-16) + env(safe-area-inset-top, 0px));
  }

  .id-avatar { width: 60px; height: 60px; }
  .id-name { font-size: 1.7rem; }
  .contrib-grid { display: none; }
}
```

### Micro Mobile (max-width: 374px)

WCAG 1.4.10 reflow at 320px. Maximum compression of all elements.

```css
@media (max-width: 374px) {
  .identity-card {
    padding: 12px;
    gap: 10px;
    margin-top: calc(12px + env(safe-area-inset-top, 0px));
  }

  .id-avatar { width: 40px; height: 40px; }
  .id-name { font-size: 1rem; }
  .id-title { font-size: var(--font-size-xs); letter-spacing: 1.5px; }

  .neon-pill {
    padding: 5px 10px;
    font-size: var(--font-size-xs);
    letter-spacing: 1px;
  }

  .right-panel { padding: 6px 6px 20px; }
  .triptych-grid { gap: 10px; }
  .column-header { letter-spacing: 3px; }
}
```

---

## 5. Backdrop-Filter Fallback

For browsers without `backdrop-filter` support, glass surfaces fall back to a near-opaque dark background.

```css
@supports not (backdrop-filter: blur(1px)) {
  .top-bar,
  .identity-card,
  .left-panel-status,
  .tri-card,
  .book-overlay,
  .book-modal {
    background: rgba(6, 6, 15, 0.95);
  }
}
```

---

## 6. Print Styles

Print media strips the dashboard to a readable single-column layout.

```css
@media print {
  #particle-canvas, .top-bar, .book-overlay { display: none !important; }
  .command-layout { display: block; height: auto; }
  .left-panel { position: static; width: 100%; }
  .right-panel { margin-left: 0; width: 100%; height: auto; overflow: visible; }
  .tri-card {
    opacity: 1 !important;
    transform: none !important;
    break-inside: avoid;
    border: 1px solid #ccc;
    background: white;
    color: black;
    backdrop-filter: none;
  }
}
```
