# Component Patterns

10 core UI components that make up the Human Datastream dashboard. Each includes the HTML structure and complete CSS. All components use tokens from `tokens.css`.

---

## 1. Widget Card (.tri-card)

The fundamental building block. A glass-morphism panel with an accent-colored top border, container queries for internal responsiveness, and an entrance animation.

### HTML

```html
<div id="cardHeartRate" class="tri-card tri-card-accent-amber">
  <div class="widget-header">
    <span class="widget-label">Heart Rate</span>
    <div class="widget-header-right">
      <div class="live-dot live-dot-amber"></div>
      <span class="widget-timestamp">2 min ago</span>
    </div>
  </div>
  <div class="widget-body">
    <!-- Widget content here -->
  </div>
</div>
```

### CSS

```css
.tri-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-lg));
  -webkit-backdrop-filter: blur(var(--blur-lg));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  container-type: inline-size;
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.tri-card.visible {
  opacity: 1;
  transform: translateY(0);
}
```

### Accent Classes

9 accent colors plus yellow (component-scoped). Each adds a 2px colored top border and a subtle ambient glow.

```css
.tri-card-accent-pink {
  border-top: 2px solid var(--neon-pink);
  box-shadow: 0 0 20px rgba(255,0,110,0.08);
}

.tri-card-accent-green {
  border-top: 2px solid var(--neon-green);
  box-shadow: 0 0 20px rgba(6,214,160,0.08);
}

.tri-card-accent-blue {
  border-top: 2px solid var(--neon-blue);
  box-shadow: 0 0 20px rgba(58,134,255,0.08);
}

.tri-card-accent-amber {
  border-top: 2px solid var(--neon-amber);
  box-shadow: 0 0 20px rgba(245,158,11,0.08);
}

.tri-card-accent-purple {
  border-top: 2px solid var(--neon-purple);
  box-shadow: 0 0 20px rgba(168,85,247,0.08);
}

.tri-card-accent-red {
  border-top: 2px solid var(--neon-red);
  box-shadow: 0 0 20px rgba(239,68,68,0.08);
}

.tri-card-accent-cyan {
  border-top: 2px solid var(--neon-cyan);
  box-shadow: 0 0 20px rgba(0,212,255,0.08);
}

.tri-card-accent-orange {
  border-top: 2px solid var(--neon-orange);
  box-shadow: 0 0 20px rgba(255,107,0,0.08);
}

.tri-card-accent-indigo {
  border-top: 2px solid var(--neon-indigo);
  box-shadow: 0 0 20px rgba(129,140,248,0.08);
}
```

### Hover States (desktop only)

```css
@media (hover: hover) {
  .tri-card {
    transition: opacity 0.6s ease, transform 0.6s ease,
                box-shadow 0.3s ease, border-color 0.3s ease;
  }
  .tri-card.visible:hover {
    transform: translateY(-2px);
    border-color: rgba(255,255,255,0.18);
  }
  .tri-card-accent-pink.visible:hover {
    box-shadow: 0 0 30px rgba(255,0,110,0.15), 0 4px 20px rgba(0,0,0,0.3);
  }
  /* Same pattern for all 9 accent colors */
}
```

---

## 2. Widget Header

Spans the top of every widget card. Contains a label, live-dot status indicator, and timestamp.

### HTML

```html
<div class="widget-header">
  <span class="widget-label">Widget Name</span>
  <div class="widget-header-right">
    <div class="live-dot"></div>
    <span class="widget-timestamp">12:34 PM</span>
  </div>
</div>
```

### CSS

```css
.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-12) var(--space-18) var(--space-10);
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.widget-label {
  font-size: var(--font-size-base);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 3px;
  color: var(--text-muted);
}

.widget-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--neon-green);
  box-shadow: 0 0 8px var(--neon-green);
  animation: dotPulse 2s ease-in-out infinite;
}

/* Color variants: .live-dot-pink, -blue, -amber, -purple, -red, -cyan, -orange, -indigo */
.live-dot-pink { background: var(--neon-pink); box-shadow: 0 0 8px var(--neon-pink); }
.live-dot-amber { background: var(--neon-amber); box-shadow: 0 0 8px var(--neon-amber); }

.widget-timestamp {
  font-size: var(--font-size-sm);
  color: rgba(255,255,255,0.47);
  font-family: 'Space Grotesk', monospace;
  letter-spacing: 0.5px;
}
```

---

## 3. Widget Body

The content area inside every widget card.

```css
.widget-body {
  padding: var(--space-10) var(--space-18) var(--space-16);
}

/* Wider containers get more generous padding */
@container (min-width: 500px) {
  .widget-body {
    padding: var(--space-14) var(--space-24) var(--space-20);
  }
}

/* Narrow containers get compact padding */
@container (max-width: 200px) {
  .widget-body {
    padding: var(--space-8) var(--space-10) var(--space-10);
  }
}
```

---

## 4. Identity Card

The hero component in the left panel. Glass card with an indigo-glowing avatar, hero-sized name, tagline, and pill-shaped social links.

### HTML

```html
<div class="identity-card">
  <img class="id-avatar" src="/assets/avatar.svg" alt="Jonathan Lloyd" />
  <div class="id-info-inline">
    <h1 class="id-name">Jonathan Lloyd</h1>
    <p class="id-title">Engineering Director</p>
  </div>
  <p class="id-bio">Backend engineer building a living data dashboard...</p>
  <p class="id-tagline">Jack into his human datastream</p>
  <nav class="id-links">
    <a class="neon-pill" href="#">GitHub</a>
    <a class="neon-pill" href="#">LinkedIn</a>
  </nav>
</div>
```

### CSS

```css
.identity-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-lg));
  -webkit-backdrop-filter: blur(var(--blur-lg));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: var(--space-40) var(--space-32);
  width: 100%;
  max-width: 380px;
  text-align: center;
  opacity: 0;
  transform: translateX(-30px);
  transition: opacity 0.8s ease, transform 0.8s ease;
}

.identity-card.visible {
  opacity: 1;
  transform: translateX(0);
}

.id-avatar {
  width: 100px;
  height: 100px;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 3px solid rgba(129,140,248,0.5);
  box-shadow:
    0 0 20px rgba(129,140,248,0.3),
    0 0 40px rgba(129,140,248,0.15),
    0 0 60px rgba(129,140,248,0.05);
  margin: 0 auto 24px;
  display: block;
}

.id-name {
  font-size: var(--font-size-hero);
  font-weight: 700;
  letter-spacing: -0.5px;
  text-shadow:
    0 0 10px rgba(129,140,248,0.8),
    0 0 30px rgba(129,140,248,0.5),
    0 0 60px rgba(129,140,248,0.2);
  margin-bottom: 8px;
  animation: glowPulse 4s ease-in-out infinite;
}

.id-title {
  font-size: var(--font-size-md);
  font-weight: 400;
  color: var(--text-muted);
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-bottom: 20px;
}

.id-bio {
  font-size: var(--font-size-lg);
  font-weight: 300;
  color: rgba(255,255,255,0.6);
  line-height: 1.7;
  margin-bottom: 12px;
  text-wrap: balance;
}

.id-tagline {
  font-size: var(--font-size-base);
  font-weight: 700;
  letter-spacing: 4px;
  text-transform: uppercase;
  color: #818cf8;
  text-shadow: 0 0 20px rgba(129,140,248,0.6), 0 0 40px rgba(129,140,248,0.3);
  margin-bottom: 28px;
}

.id-links {
  display: flex;
  gap: var(--space-10);
  justify-content: center;
  flex-wrap: wrap;
}
```

---

## 5. Neon Pill

Pill-shaped link/button used for social links, tags, and CTAs.

### HTML

```html
<a class="neon-pill" href="https://github.com/user">GitHub</a>
```

### CSS

```css
.neon-pill {
  display: inline-block;
  padding: var(--space-10) var(--space-24);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: var(--radius-pill);
  color: var(--text);
  text-decoration: none;
  font-family: 'Space Grotesk', sans-serif;
  font-size: var(--font-size-sm);
  font-weight: 500;
  letter-spacing: 2px;
  text-transform: uppercase;
  background: rgba(255,255,255,0.03);
  transition: transform 0.3s ease, color 0.3s ease,
              background-color 0.3s ease, border-color 0.3s ease,
              box-shadow 0.3s ease;
}

@media (hover: hover) {
  .neon-pill:hover {
    border-color: var(--neon-indigo);
    box-shadow: 0 0 15px rgba(129,140,248,0.25), 0 0 30px rgba(129,140,248,0.1);
    color: var(--neon-indigo);
    transform: translateY(-2px);
    background: linear-gradient(135deg, rgba(129,140,248,0.08), rgba(99,102,241,0.08));
  }
}

/* Mobile touch targets (WCAG 2.5.8) */
@media (max-width: 900px) {
  .neon-pill {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
}
```

---

## 6. Bio Terminal

A macOS-style terminal window with colored title bar dots, blue prompts, green commands, and a blinking cursor.

### HTML

```html
<div class="tri-card tri-card-accent-blue">
  <div class="widget-header">
    <span class="widget-label">Bio</span>
    <div class="widget-header-right">
      <div class="live-dot live-dot-blue"></div>
    </div>
  </div>
  <div class="widget-body" style="padding:0">
    <div class="terminal-container">
      <div class="terminal-titlebar">
        <span class="terminal-btn terminal-btn-red"></span>
        <span class="terminal-btn terminal-btn-yellow"></span>
        <span class="terminal-btn terminal-btn-green"></span>
        <span class="terminal-title">bio.sh</span>
      </div>
      <div class="terminal-body">
        <div class="terminal-line">
          <span class="terminal-prompt">$</span>
          <span class="terminal-command"> cat bio.txt</span>
        </div>
        <div class="terminal-line">
          <span class="terminal-arrow">&gt;</span>
          <span class="terminal-output"> 24+ years of engineering experience</span>
        </div>
        <div class="terminal-line">
          <span class="terminal-prompt">$</span>
          <span class="terminal-cursor"></span>
        </div>
      </div>
    </div>
  </div>
</div>
```

### CSS

```css
.terminal-container {
  background: rgba(0,0,0,0.5);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  overflow: hidden;
  font-family: 'Space Grotesk', monospace;
  font-size: var(--font-size-base);
  line-height: 1.7;
}

.terminal-titlebar {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-12);
  background: rgba(58,134,255,0.06);
  border-bottom: 1px solid rgba(58,134,255,0.08);
}

.terminal-btn { width: 8px; height: 8px; border-radius: 50%; }
.terminal-btn-red { background: #ff5f57; }
.terminal-btn-yellow { background: #ffbd2e; }
.terminal-btn-green { background: #28c840; }

.terminal-title {
  flex: 1;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-muted);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.terminal-body {
  padding: var(--space-14) var(--space-14) var(--space-16);
  min-height: 120px;
}

.terminal-prompt {
  color: var(--neon-blue);
  text-shadow: 0 0 6px rgba(58,134,255,0.3);
}

.terminal-command { color: #28c840; }
.terminal-output { color: rgba(255,255,255,0.75); }
.terminal-arrow { color: var(--neon-blue); opacity: 0.6; }

.terminal-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--neon-blue);
  vertical-align: text-bottom;
  animation: termBlink 1s step-end infinite;
  margin-left: 2px;
}
```

---

## 7. System Status Lines

Key-value status rows with colored dots indicating operational state.

### HTML

```html
<div class="sys-line">
  <span class="sys-dot sys-dot-green"></span>
  <span class="sys-key">API</span>
  <span class="sys-val sys-val-green">Operational</span>
</div>
<div class="sys-line">
  <span class="sys-dot sys-dot-amber"></span>
  <span class="sys-key sys-key-amber">Latency</span>
  <span class="sys-val sys-val-amber">Elevated</span>
</div>
```

### CSS

```css
.sys-line {
  display: flex;
  align-items: center;
  gap: var(--space-10);
  padding: 6px 0;
  font-size: var(--font-size-sm);
  font-family: 'Space Grotesk', monospace;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}

.sys-line:last-child { border-bottom: none; }

.sys-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: dotPulse 2s ease-in-out infinite;
}

.sys-dot-green { background: var(--neon-green); box-shadow: 0 0 8px var(--neon-green); }
.sys-dot-amber { background: var(--neon-amber); box-shadow: 0 0 8px var(--neon-amber); }
.sys-dot-red { background: var(--neon-red); box-shadow: 0 0 8px var(--neon-red); }

.sys-key { color: var(--text-muted); min-width: 110px; }
.sys-val { color: var(--text); font-weight: 500; }
.sys-val-green { color: var(--neon-green); }
.sys-val-amber { color: var(--neon-amber); }
.sys-val-red { color: var(--neon-red-hc); }

/* All 9 accent colors have matching .sys-dot-{color}, .sys-key-{color}, .sys-val-{color} classes */
```

---

## 8. Skeleton Loading

Shimmer-animated placeholders shown while data loads. Cards start with `.is-loading` class.

### HTML

```html
<div class="tri-card tri-card-accent-amber is-loading">
  <div class="widget-header">
    <span class="widget-label">Heart Rate</span>
  </div>
  <div class="widget-body">
    <div class="skeleton-state">
      <div class="skeleton-bar" style="width:60%;height:28px;margin-bottom:8px"></div>
      <div class="skeleton-bar" style="width:40%;height:14px"></div>
    </div>
    <!-- Real content hidden by .is-loading -->
  </div>
</div>
```

### CSS

```css
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

/* Loading state: overlay skeleton, hide real content */
.tri-card.is-loading .skeleton-state {
  display: block;
  position: absolute;
  inset: 0;
  z-index: 1;
  background: var(--glass-bg);
  padding: var(--space-10) var(--space-18) var(--space-16);
}

.tri-card.is-loading .widget-body > *:not(.skeleton-state) {
  opacity: 0;
  pointer-events: none;
}

.tri-card:not(.is-loading) .skeleton-state {
  display: none;
}
```

---

## 9. Book Modal

A full-screen overlay with a blurred backdrop and an amber-accented modal card for book details.

### HTML

```html
<div class="book-overlay visible" role="dialog" aria-modal="true">
  <div class="book-modal">
    <div class="book-modal-header">
      <img class="book-modal-cover" src="/images/books/cover.webp" alt="Book title" />
      <div class="book-modal-info">
        <p class="book-modal-series">Series Name</p>
        <h2 class="book-modal-title">Book Title</h2>
        <p class="book-modal-author">Author Name</p>
        <div class="book-modal-stars">
          <span class="star-on">&#9733;</span>
          <span class="star-on">&#9733;</span>
          <span class="star-on">&#9733;</span>
          <span class="star-on">&#9733;</span>
          <span class="star-off">&#9733;</span>
        </div>
      </div>
      <button class="book-modal-close" aria-label="Close">&times;</button>
    </div>
    <div class="book-modal-body">
      <div class="book-modal-stats">
        <div class="book-modal-stat">
          <div class="book-modal-stat-val">384</div>
          <div class="book-modal-stat-label">Pages</div>
        </div>
      </div>
      <p class="book-modal-desc">Book description text...</p>
      <div class="book-modal-tags">
        <span class="book-modal-tag">Sci-Fi</span>
        <span class="book-modal-tag">Thriller</span>
      </div>
    </div>
  </div>
</div>
```

### CSS

```css
.book-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(6,6,15,0.8);
  backdrop-filter: blur(var(--blur-sm));
  -webkit-backdrop-filter: blur(var(--blur-sm));
  align-items: center;
  justify-content: center;
  animation: bookOverlayIn 0.2s ease-out;
}
.book-overlay.visible { display: flex; }

.book-modal {
  width: clamp(320px, 50vw, 720px);
  max-width: 90vw;
  max-height: 90dvh;
  overflow-y: auto;
  background: rgba(12,12,24,0.96);
  backdrop-filter: blur(var(--blur-xl));
  -webkit-backdrop-filter: blur(var(--blur-xl));
  border: 1px solid rgba(245,158,11,0.2);
  border-radius: clamp(var(--radius-md), 2vw, var(--radius-xl));
  box-shadow: 0 16px 60px rgba(0,0,0,0.6), 0 0 30px rgba(245,158,11,0.1);
  animation: bookModalIn 0.3s ease-out;
}

.book-modal-close {
  position: absolute;
  top: 14px;
  right: 16px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text-muted);
  font-size: var(--font-size-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, color 0.2s;
}

.book-modal-tag {
  display: inline-block;
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.2);
  color: var(--neon-amber);
}

.book-modal-stars .star-on { color: var(--neon-amber); }
.book-modal-stars .star-off { color: rgba(255,255,255,0.1); }
```

---

## 10. Metric Display

Two-column split layout for health/activity metrics. Used by the Daily Activity widget.

### HTML

```html
<div class="split-cols">
  <div class="split-col">
    <div class="split-col-title">Move</div>
    <div class="split-metric">
      <div class="split-metric-label">Calories</div>
      <div class="split-metric-value">486<span class="split-metric-unit">kcal</span></div>
    </div>
    <div class="split-metric">
      <div class="split-metric-label">Steps</div>
      <div class="split-metric-value">8,234</div>
    </div>
  </div>
  <div class="split-col">
    <div class="split-col-title">Exercise</div>
    <div class="split-metric">
      <div class="split-metric-label">Duration</div>
      <div class="split-metric-value">42<span class="split-metric-unit">min</span></div>
    </div>
  </div>
</div>
```

### CSS

```css
.split-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.split-col { padding: 4px 0; }
.split-col:first-child { border-right: 1px solid rgba(255,255,255,0.04); padding-right: 16px; }
.split-col:last-child { padding-left: 16px; }

.split-col-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 3px;
  color: var(--neon-red-hc);
  text-shadow: 0 0 6px rgba(239,68,68,0.3);
  margin-bottom: 12px;
}

.split-metric { margin-bottom: 14px; }
.split-metric:last-child { margin-bottom: 0; }

.split-metric-label {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 2px;
}

.split-metric-value {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text);
  line-height: 1;
  font-family: 'Space Grotesk', monospace;
}

.split-metric-unit {
  font-size: var(--font-size-xs);
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 3px;
}
```
