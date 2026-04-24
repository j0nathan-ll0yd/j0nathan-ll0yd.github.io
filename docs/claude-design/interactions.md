# Interaction Patterns

Animation, motion, and state-transition patterns for the Human Datastream dashboard. All animations respect `prefers-reduced-motion`.

---

## 1. Card Reveal (Stagger System)

Cards enter the viewport with a staggered fade + slide. Left-panel cards slide from the left; right-panel widget cards slide up. JavaScript adds the `.visible` class after a staggered delay.

```css
/* Left-panel cards: slide from left */
.identity-card {
  opacity: 0;
  transform: translateX(-30px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}
.identity-card.visible {
  opacity: 1;
  transform: translateX(0);
}

/* Widget cards: slide up */
.tri-card {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.tri-card.visible {
  opacity: 1;
  transform: translateY(0);
}
```

On mobile (max-width: 767px), reveal animations are disabled for performance and LCP optimization:

```css
@media (max-width: 767px) {
  .identity-card,
  .left-panel-bio,
  .left-panel-status,
  .tri-card {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
}
```

---

## 2. Hover Gating

All hover effects are wrapped in `@media (hover: hover)` to prevent sticky hover on touch devices. This is a system-wide architectural pattern, not per-component.

```css
@media (hover: hover) {
  .tri-card.visible:hover {
    transform: translateY(-2px);
    border-color: rgba(255,255,255,0.18);
  }

  .neon-pill:hover {
    border-color: var(--neon-indigo);
    box-shadow: 0 0 15px rgba(129,140,248,0.25), 0 0 30px rgba(129,140,248,0.1);
    color: var(--neon-indigo);
    transform: translateY(-2px);
    background: linear-gradient(135deg, rgba(129,140,248,0.08), rgba(99,102,241,0.08));
  }

  .shelf-book:hover { transform: translateY(-4px); }

  .article-list-item:hover {
    transform: translateX(6px);
    background: rgba(245,158,11,0.04);
  }
}
```

Elements that need hover but not the gating (because they also serve as `:active` states) use unconditional styles:

```css
.neon-pill:active {
  border-color: var(--neon-indigo);
  color: var(--neon-indigo);
}
```

---

## 3. Skeleton Shimmer

Loading placeholders use a sliding gradient animation. The shimmer travels left-to-right across the placeholder bar.

```css
@keyframes shimmerSlide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.skeleton-bar {
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}

.skeleton-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.06) 50%, transparent 75%);
  animation: shimmerSlide 2s ease-in-out infinite;
  will-change: transform;
}

.skeleton-circle {
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
}
```

---

## 4. Live Dot Pulse

The 6px status dots in widget headers pulse with a scale + opacity animation.

```css
@keyframes dotPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--neon-green);
  box-shadow: 0 0 8px var(--neon-green);
  animation: dotPulse 2s ease-in-out infinite;
}
```

---

## 5. Touch Target Sizing (WCAG 2.5.8)

Interactive elements get enlarged touch targets on mobile for accessibility compliance.

```css
@media (max-width: 900px) {
  .neon-pill {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .gh-dal-line {
    padding: 6px 4px;
    align-items: center;
  }
}
```

---

## 6. Widget Update Feedback

When live data refreshes a widget, a brief opacity dip provides visual feedback.

```css
.widget-updating {
  opacity: 0.7;
  transition: opacity 150ms ease;
}
```

---

## 7. Avatar Glow Pulse

The identity card avatar has a slow-breathing indigo glow.

```css
@keyframes avatarGlowPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

@keyframes glowPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}
```

On mobile, the avatar glow is simplified for GPU performance:

```css
@media (max-width: 767px) {
  .id-avatar {
    box-shadow: var(--glow-indigo-sm);
    animation: none;
  }
  .id-name {
    text-shadow: 0 0 10px rgba(129,140,248,0.6), 0 0 30px rgba(129,140,248,0.3);
    animation: none;
  }
}
```

---

## 8. ECG Heartbeat Scroll

The heart rate widget has a scrolling ECG line behind the BPM number.

```css
@keyframes ecgScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.ecg-svg {
  width: 200%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  animation: ecgScroll 4s linear infinite;
}
```

---

## 9. Terminal Cursor Blink

The bio terminal has a blinking block cursor.

```css
@keyframes termBlink {
  50% { opacity: 0; }
}

.terminal-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--neon-blue);
  vertical-align: text-bottom;
  animation: termBlink 1s step-end infinite;
}
```

---

## 10. Content Entry Animations

Various content-specific entrance animations for list items and shelf books.

```css
/* Reading feed articles slide in from left */
@keyframes fadeSlideRight {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* Bookshelf books fade in sequentially */
@keyframes shelfFadeIn {
  0% { opacity: 0; transform: translateX(-6px); }
  100% { opacity: 1; transform: translateX(0); }
}

/* Active book scan line */
@keyframes shelfScan {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(calc(var(--scan-h, 143px) - 3px)); }
}

/* Modal entrance */
@keyframes bookOverlayIn {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes bookModalIn {
  0% { opacity: 0; transform: scale(0.95) translateY(10px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* Map marker ring expansion */
@keyframes mapRingPulse {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(2.5); opacity: 0; }
}

/* Sleep score bar fill */
@keyframes sleepMoonScoreFill {
  from { transform: scaleX(0); }
}

/* Sleep pill fade-in */
@keyframes sleepMoonPillFade {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## 11. Hydration Animations

Water and coffee vessels have wave motion, steam, and bubble effects.

```css
/* Wave surface */
@keyframes hydraWave {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(-10px); }
}

/* Coffee steam */
@keyframes hydraSteam {
  0%, 100% { opacity: 0.2; transform: translateY(0) scaleY(1); }
  50% { opacity: 0.5; transform: translateY(-4px) scaleY(1.3); }
}

/* Bubble rise (V3) */
@keyframes hydraV3Rise {
  0% { transform: translateY(0) scale(1); opacity: 0.5; }
  50% { opacity: 0.3; }
  100% { transform: translateY(-100px) scale(0.5); opacity: 0; }
}

/* Gloss shift (V3) */
@keyframes hydraV3GlossShift {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(15px); }
}
```

---

## 12. Reduced Motion

A blanket override disables all animations and transitions when the user prefers reduced motion.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 13. Focus Indicators (WCAG 2.4.7)

All focusable elements get a neon-pink outline. Specific components override with their accent color.

```css
:focus-visible {
  outline: 2px solid var(--neon-pink);
  outline-offset: 2px;
}

.neon-pill:focus-visible {
  outline: 2px solid var(--neon-pink);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255, 0, 110, 0.25);
}

.shelf-book:focus-visible {
  outline: 2px solid var(--neon-green);
  outline-offset: 2px;
}

.book-modal-close:focus-visible {
  outline: 2px solid var(--neon-blue);
  outline-offset: 2px;
}
```

---

## 14. High Contrast and Forced Colors

Accessibility overrides for users who need enhanced contrast or Windows High Contrast mode.

```css
/* High contrast: increase glass opacity and brighten muted text */
@media (prefers-contrast: more) {
  :root {
    --glass-bg: rgba(0, 0, 0, 0.85);
    --glass-border: rgba(255, 255, 255, 0.3);
    --glass-border-strong: rgba(255, 255, 255, 0.5);
    --text-muted: #d1d5db;
  }
}

/* Windows High Contrast: use system color keywords */
@media (forced-colors: active) {
  .tri-card,
  .identity-card,
  .left-panel-status,
  .book-modal {
    border: 2px solid CanvasText;
    background: Canvas;
    color: CanvasText;
    forced-color-adjust: none;
  }

  .live-dot, .sys-dot {
    background: Highlight;
    box-shadow: none;
  }

  .neon-pill {
    border: 1px solid LinkText;
    color: LinkText;
  }

  .skip-link {
    background: Highlight;
    color: HighlightText;
  }
}
```
