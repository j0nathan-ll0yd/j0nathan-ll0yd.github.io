# CLAUDE.md — Command Center Portfolio

## Project Overview

Personal portfolio site for Jonathan Lloyd, styled as a "Command Center" dashboard. Hosted on GitHub Pages as a static HTML/CSS/JS site. The root site (`index.html`) has no build step or package manager. Four framework re-implementations live in `/implementations/`.

## Repository Structure

```
.
├── index.html              # Main dashboard (13 widgets, no build step)
├── brand-guide.html        # Design system reference page
├── .nojekyll               # Disables Jekyll on GitHub Pages
├── .editorconfig           # 2-space indent, UTF-8, LF
├── css/
│   ├── tokens.css          # Design tokens (colors, typography, spacing, radii, blur, glows)
│   ├── base.css            # Reset, body, scrollbar, global styles
│   ├── layout.css          # .command-layout, .left-panel, .top-bar, .right-panel, responsive
│   ├── components.css      # Widget cards, identity card, terminal, map, charts, modals
│   ├── effects.css         # Animations, transitions, glows, particle canvas
│   └── component-library.css  # Styles for /components/ design system pages
├── data/
│   ├── profile.json        # Name, title, bio, avatar, social links
│   ├── health.json         # Heart rate, steps, sleep, hydration, workouts
│   ├── github.json         # Contribution heatmap, recent commits, stats
│   ├── books.json          # Bookshelf with covers, authors, status
│   ├── reading.json        # RSS/article feed items
│   ├── system.json         # System status indicators
│   ├── mock-data.js        # Legacy: inline JS global (MOCK_DATA) used by root index.html
│   ├── health-data.js      # Legacy: inline JS global (HEALTH_DATA) used by root index.html
│   └── generate-json.js    # Script to generate JSON files from legacy JS data
├── assets/
│   ├── avatar.svg          # Profile avatar
│   ├── favicon.svg         # Browser favicon
│   └── logo.svg            # Site logo
├── js/
│   ├── particles.js        # Three.js particle background (shared by implementations)
│   ├── clock.js            # Live clock in top bar
│   ├── data-renderer.js    # Populates all widgets from MOCK_DATA/HEALTH_DATA globals
│   └── component-library.js  # JS for /components/ design system pages
├── components/             # Design system component library pages
│   ├── index.html          # Component library index
│   ├── left-panel.html     # Left panel components
│   ├── top-bar.html        # Top bar components
│   ├── body-column.html    # Body column widgets
│   └── mind-column.html    # Mind column widgets
└── implementations/
    ├── VERIFY_PROMPT.md     # Prompt for verifying implementations against framework best practices
    ├── astro/               # Astro SSG (reference implementation)
    ├── htmx/                # Handlebars + fetch (no build step)
    ├── marko/               # Marko 5 SSR (node build.js)
    └── webawesome/          # Shoelace 2.x web components (no build step)
```

## Conventions

### Editor / Formatting
- 2-space indentation (all files)
- UTF-8 charset, LF line endings
- Trim trailing whitespace (except `.md`)
- Insert final newline

### CSS
- All colors, typography, spacing, and effects use custom properties from `css/tokens.css`
- Glass-morphism pattern: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--blur-md));`
- Widget card structure: `.tri-card` > `.widget-header` + `.widget-body`
- Widget header: `.widget-label` + `.widget-header-right` > `.live-dot` + `.widget-timestamp`
- Accent classes: `.tri-card-accent-pink`, `-blue`, `-green`, `-amber`, `-purple`

### JavaScript (Root)
- ES5 only: `var`, IIFEs, `function` declarations — no `let`/`const`/arrow functions
- Each file wrapped in an IIFE: `(function() { ... })();`
- Root site loads data via `<script>` tags that set `window.MOCK_DATA` and `window.HEALTH_DATA`

### Layout
- `.command-layout` > `.left-panel` + `.top-bar` + `.right-panel`
- Left panel: fixed, 35% width, contains identity card + bio terminal + system status
- Right panel: 65% width, scrollable, contains `.triptych-grid` with Body and Mind columns
- Top bar: fixed, spans right panel width, contains title + live clock

## Data Flow

| Context | How data is loaded |
|---|---|
| Root `index.html` | `<script src="data/mock-data.js">` sets `window.MOCK_DATA`; `data-renderer.js` reads it |
| Astro | Imports JSON files at build time via `fs.readFileSync` in frontmatter |
| HTMX/Handlebars | `fetch()` calls to `../../data/*.json` at runtime |
| Marko | `build.js` reads JSON files with `fs.readFileSync`, passes as template input |
| Web Awesome | `fetch()` calls to `../../data/*.json` at runtime |
| Future | CloudFront-backed API serving real data |

## Design System Quick Reference

### Colors
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#06060f` | Page background |
| `--neon-pink` | `#ff006e` | Primary accent, left panel border |
| `--neon-blue` | `#3a86ff` | Secondary accent, hydration |
| `--neon-green` | `#06d6a0` | Success, mind column |
| `--neon-amber` | `#f59e0b` | Warning, heart rate |
| `--neon-purple` | `#a855f7` | Sleep, night summary |
| `--neon-red` | `#ef4444` | Alert states |
| `--text` | `#f0f0f0` | Primary text |
| `--text-muted` | `#6b7280` | Secondary text |

### Glass-morphism
```css
background: var(--glass-bg);        /* rgba(255,255,255,0.07) */
border: 1px solid var(--glass-border); /* rgba(255,255,255,0.1) */
backdrop-filter: blur(var(--blur-md)); /* 16px */
```

### Typography
- Font: `Space Grotesk` (Google Fonts)
- Scale: `--font-size-xs` (0.42rem) through `--font-size-hero` (2.2rem)

### Responsive Breakpoints
| Breakpoint | Behavior |
|---|---|
| `1400px` | Adjusts panel proportions |
| `1100px` | Further layout adjustments |
| `900px` | Stacks to single column |
| `600px` | Mobile optimizations |

## Working with Implementations

### Astro (Reference Implementation)
```bash
cd implementations/astro
npm install
npm run dev     # Dev server with hot reload
npm run build   # Outputs to dist/
```
- 14 `.astro` components in `src/components/`
- Reads JSON data at build time
- `scripts/copy-assets.js` copies shared CSS/assets to `public/`

### HTMX / Handlebars
```bash
# No build step — serve from repository root
python3 -m http.server 8000
# Open http://localhost:8000/implementations/htmx/
```
- `index.html` with `<script type="text/x-handlebars-template">` templates
- `js/app.js` fetches JSON, compiles templates, renders widgets
- `js/helpers.js` registers Handlebars helpers
- `js/init.js` initializes particles, clock, map after `dataReady` event

### Marko
```bash
cd implementations/marko
npm install
npm run build   # Runs node build.js → outputs dist/index.html
```
- `build.js` reads JSON, renders `src/index.marko` to static HTML
- 14 `.marko` components in `src/components/`
- Output: `dist/index.html` (self-contained, references shared CSS/assets)

### Web Awesome / Shoelace
```bash
# No build step — serve from repository root
python3 -m http.server 8000
# Open http://localhost:8000/implementations/webawesome/
```
- Uses Shoelace 2.x (`sl-` prefix) web components via CDN
- `js/app.js` loaded as `type="module"`, fetches JSON at runtime
- `css/wa-overrides.css` maps Shoelace CSS custom properties to design tokens

## Serving Locally

```bash
cd /Users/jlloyd/Repositories/j0nathan-ll0yd.github.io
python3 -m http.server 8000
```

| URL | Page |
|---|---|
| `http://localhost:8000` | Main dashboard |
| `http://localhost:8000/brand-guide.html` | Design system reference |
| `http://localhost:8000/components/` | Component library |
| `http://localhost:8000/implementations/htmx/` | HTMX implementation |
| `http://localhost:8000/implementations/webawesome/` | Web Awesome implementation |
| `http://localhost:8000/implementations/astro/dist/` | Astro built output |
| `http://localhost:8000/implementations/marko/dist/` | Marko built output |

## Verification

Use `implementations/VERIFY_PROMPT.md` to audit all four implementations against their framework best practices. It provides a structured prompt with 20 research topics per implementation and cross-implementation HTML comparison against the Astro reference.

## Rules and Guardrails

### DO NOT
- Modify shared `css/`, `data/`, or `assets/` files without checking all consumers (root + 4 implementations)
- Add a root-level `package.json` — the root site is intentionally build-free
- Use ES6+ syntax (`let`, `const`, arrow functions, template literals) in root-level JS files
- Remove `.nojekyll` — GitHub Pages needs it to serve the site without Jekyll processing

### DO
- Use CSS custom properties from `css/tokens.css` for all colors, spacing, and typography
- Follow the widget HTML structure: `.tri-card` > `.widget-header` + `.widget-body`
- Test all four responsive breakpoints (1400px, 1100px, 900px, 600px)
- Treat the Astro implementation as the reference when building or fixing other implementations
- Run `python3 -m http.server` from the repo root to test — implementations reference `../../data/` and `../../css/` via relative paths
