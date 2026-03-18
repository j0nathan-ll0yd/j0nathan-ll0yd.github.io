# CLAUDE.md -- Human Datastream Portfolio

## Project Overview

Personal portfolio site for Jonathan Lloyd, styled as a "Human Datastream" dashboard. Built with Astro (static site generation) and hosted on GitHub Pages. The site ships 0 KB JavaScript by default, with selective `is:inline` scripts for particles, map, and animations.

## Site Identity & SEO

The site positions Jonathan Lloyd as a backend engineer whose portfolio **is** the technical showcase -- a living data dashboard tracking body and mind in an AI-centric world. All metadata copy derives from the core statement below.

### Core Statement

> Personal portfolio of Jonathan Lloyd, an engineering director and backend engineer, built as a living data dashboard. Real biometrics and constant updates of his whole body (health, activity, hydration, location) and mind (coding, reading, learning). Jack into his human datastream as the world becomes more AI-centric.

### Metadata by Surface

| Surface | Copy | Location |
|---------|------|----------|
| **Page Title** | Jonathan Lloyd — Human Datastream | `Dashboard.astro` frontmatter default |
| **Meta Description** | A living data dashboard by engineer, Jonathan Lloyd — tracking body (health, activity, hydration) and mind (coding, reading). Jack into his human datastream. | `Dashboard.astro` `description` prop |
| **OG / Twitter Description** | Personal portfolio of Jonathan Lloyd, an engineering director and backend engineer, built as a living data dashboard. Real biometrics tracking body (health, activity, hydration, location) and mind (coding, reading, learning). Jack into his human datastream. | `Dashboard.astro` `ogDescription` prop |
| **JSON-LD WebSite** | *(Core statement, verbatim)* | `Dashboard.astro` JSON-LD block |
| **JSON-LD Person** | Engineering director and backend engineer with 24+ years of experience. Built this portfolio as a living data dashboard -- real biometrics and constant updates of body (health, activity, hydration, location) and mind (coding, reading, learning). Jack into his human datastream as the world becomes more AI-centric. | `Dashboard.astro` JSON-LD block |
| **PWA Manifest** | Living data dashboard -- tracking body and mind. Jack into his human datastream. | `astro.config.mjs` + `public/manifest.webmanifest` |
| **OG Image Title** | ENGINEERING DIRECTOR | `src/components/OGImage.astro` |
| **OG Image Quote** | Jack into his human datastream | `src/components/OGImage.astro` |
| **Keywords** | backend engineer portfolio, software engineer portfolio, data visualization dashboard, living data dashboard, human datastream, engineering director, personal dashboard, biometrics dashboard, GitHub activity visualization, Astro static site | `Dashboard.astro` keywords meta tag |

### JSON-LD knowsAbout

Backend Engineering, Software Engineering, Engineering Leadership, Cloud Infrastructure, Data Visualization, Serverless Architecture, TypeScript, Go, AWS

### Key SEO Architecture Decisions

- `og:type` is `"profile"` (not `"website"`) -- enables `profile:first_name`/`profile:last_name` tags
- `ogDescription` is a separate prop from `description` -- allows longer copy for social cards vs. Google snippet
- JSON-LD `Person.description` is hardcoded (not the meta description prop) -- richer, personality-forward copy for structured data
- Keywords meta tag targets Bing/DuckDuckGo (Google ignores it)
- `robots.txt` blocks AI scraping bots (GPTBot, ClaudeBot, CCBot, etc.) but allows search engines and AI search (PerplexityBot, OAI-SearchBot)
- `llms.txt` provides structured site context for LLMs per the llmstxt.org spec at https://jonathanlloyd.me/llms.txt

## Repository Structure

```
.
├── astro.config.mjs          # Astro + PWA configuration
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript (extends astro/tsconfigs/strict)
├── src/
│   ├── components/           # 14 .astro components (one per widget)
│   ├── layouts/              # Dashboard.astro, Showcase.astro
│   ├── pages/                # index.astro (data loading, page composition)
│   └── showcase/             # Dev-only component showcase pages (not in src/pages/)
├── public/
│   ├── css/
│   │   ├── tokens.css        # Design tokens (colors, typography, spacing, radii, blur, glows)
│   │   ├── base.css          # Reset, body, scrollbar, global styles
│   │   ├── layout.css        # .command-layout, .left-panel, .top-bar, .right-panel, responsive
│   │   ├── components.css    # Widget cards, identity card, terminal, map, charts, modals
│   │   ├── effects.css       # Animations, transitions, glows, particle canvas
│   │   └── showcase.css      # Styles for dev-only component showcase
│   ├── assets/               # avatar.svg, favicon.svg, logo.svg, PWA icons
│   ├── js/
│   │   ├── particles.js      # Three.js particle background (legacy, now inlined in index.astro)
│   │   └── clock.js          # Live clock (legacy, now inlined in index.astro)
│   ├── llms.txt              # LLM site context (llmstxt.org spec)
│   ├── robots.txt            # Crawl policy (blocks AI scrapers, allows search)
│   └── manifest.webmanifest  # PWA manifest
├── data/
│   ├── profile.json          # Name, title, bio, avatar, social links
│   ├── health.json           # Heart rate, steps, sleep, hydration, workouts
│   ├── github.json           # Contribution heatmap, recent commits, stats
│   ├── books.json            # Bookshelf with covers, authors, status
│   ├── reading.json          # RSS/article feed items
│   ├── system.json           # System status indicators
│   └── showcase-empty.json   # Empty state props for showcase pages
├── docs/
│   └── wiki/                 # Documentation (synced to GitHub Wiki)
│       ├── Home.md           # Wiki homepage
│       ├── Astro-Implementation.md  # Architecture and components
│       ├── Brand-Guide.md    # Design system reference
│       └── Why-Astro.md      # Framework evaluation
├── tests/
│   ├── visual/
│   │   ├── dashboard.spec.ts # Visual regression tests (4 viewports × 4 tests)
│   │   ├── screenshot.css    # Stabilization stylesheet (hides dynamic content)
│   │   └── __screenshots__/  # Baseline PNGs organized by viewport project
│   └── fixtures/             # Stable JSON fixtures for API route interception
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml        # Build + deploy + Cloudflare purge + image check
│   │   ├── visual-tests.yml  # Playwright visual regression tests on PRs
│   │   └── sync-wiki.yml     # Sync docs/wiki/ to GitHub Wiki
│   └── scripts/              # sync-wiki.sh, generate-sidebar.sh
├── playwright.config.ts      # Playwright config (4 viewport projects, webServer)
├── .editorconfig             # 2-space indent, UTF-8, LF
├── .gitattributes            # Binary marker for screenshot PNGs
├── .gitignore
├── .nojekyll                 # Bypass Jekyll on GitHub Pages
├── AGENTS.md                 # Cross-tool AI coding context (complements CLAUDE.md)
└── README.md
```

## Conventions

### Editor / Formatting
- 2-space indentation (all files)
- UTF-8 charset, LF line endings
- Trim trailing whitespace (except `.md`)
- Insert final newline

### CSS
- All colors, typography, spacing, and effects use custom properties from `public/css/tokens.css`
- Typography and spacing tokens use fluid `clamp()` values that scale between 600px–1400px viewports (e.g., `--font-size-base: clamp(0.62rem, 0.55rem + 0.20vw, 0.72rem)`)
- Font-size clamp() values use `rem + vw` preferred values for WCAG 1.4.4 zoom compliance; spacing tokens use `px` bounds with `rem + vw` preferred values
- `.tri-card` has `container-type: inline-size` enabling `@container` queries for widget-level responsive adaptation
- Glass-morphism pattern: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--blur-md));`
- Widget card structure: `.tri-card` > `.widget-header` + `.widget-body`
- Widget header: `.widget-label` + `.widget-header-right` > `.live-dot` + `.widget-timestamp`
- Accent classes: `.tri-card-accent-pink`, `-blue`, `-green`, `-amber`, `-purple`, `-red`, `-cyan`, `-orange`, `-indigo`

### JavaScript (Inline Scripts)
- ES5 only: `var`, IIFEs, `function` declarations -- no `let`/`const`/arrow functions
- Each script wrapped in an IIFE: `(function() { ... })();`
- All client JS is embedded in `src/pages/index.astro` as `<script is:inline>` blocks

### Astro Components
- 14 components in `src/components/`, one per widget
- Props receive data objects parsed from JSON files
- No client-side framework -- all rendering is build-time

## Data Flow

| Context | How data is loaded |
|---|---|
| Astro build | `fs.readFileSync` from `data/*.json` in `src/pages/index.astro` frontmatter |
| Client-side | Live data fetched from CloudFront (`d2nfgi9u0n3jr6.cloudfront.net`) via `src/lib/api.ts` |
| Polling | `PollEngine` refreshes fast-tier (30s) and slow-tier (120s) endpoints with `?_poll=1` to bypass SW |

## Image Pipeline

Book covers and theatre posters flow through a multi-stage pipeline ending with same-origin serving via Cloudflare CDN:

```
Amazon/Squarespace → OptimizeImages Lambda → S3 (WebP) → CloudFront
                                                              ↓
                                              npm run fetch:images (run locally)
                                                              ↓
                                              public/images/ → git commit → GitHub Pages → Cloudflare CDN
```

**How it works:**
1. The backend `OptimizeImages` Lambda downloads images from Amazon (book covers) and Squarespace (theatre posters), optimizes to WebP via sharp, and uploads to S3 at `images/books/{asin}.webp` and `images/theatre/{slug}.webp`
2. The Lambda rewrites JSON exports (`books.json`, `theatre-reviews.json`) with CloudFront image URLs
3. **Locally**, run `npm run fetch:images` to download new images from CloudFront to `public/images/`. Commit and push — they are served as same-origin static assets cached by Cloudflare
4. **In CI**, the `check-images` job runs `--check-only` mode: compares CloudFront image URLs against committed files. If new images are detected, it creates a GitHub issue with instructions to fetch and commit them
5. The adapter layer (`src/lib/image-utils.ts`) rewrites CloudFront image URLs to local `/images/` paths via `localizeImageUrl()`
6. If a local image is missing (new book added between deploys), `onerror` fallback swaps the `<img>` src to the original CloudFront URL — the user never sees a broken image

**Key files:**
- `scripts/fetch-images.mjs` — downloads images locally (`npm run fetch:images`) or checks for new ones (`--check-only`)
- `src/lib/image-utils.ts` — `localizeImageUrl()` and `imgFallbackAttrs()` helpers
- `src/lib/adapters.ts` — applies `localizeImageUrl()` to book cover/thumb URLs
- `src/lib/updaters-theatre.ts` — applies `localizeImageUrl()` to theatre poster URLs

**When you add a new book or theatre review:**
1. Backend Lambda optimizes the image and updates JSON on CloudFront
2. Next deploy → CI `check-images` detects the new image → creates a GitHub issue
3. Run `npm run fetch:images` locally → `git add public/images/ && git commit && git push`
4. Image is now served from `jonathanlloyd.me`, cached by Cloudflare

## Caching Architecture

Three independent caching layers operating on separate domains with zero overlap:

| Layer | Domain | What it caches | TTL |
|-------|--------|---------------|-----|
| **Cloudflare** | `jonathanlloyd.me` | HTML (5min), `/_astro/*` JS/CSS (1yr), images/fonts (1mo), SW (5min) | Per cache rule |
| **CloudFront** | `d2nfgi9u0n3jr6.cloudfront.net` | JSON data exports (health, sleep, books, etc.) | 5min (s-maxage) |
| **Workbox SW** | Both (separate rules) | Local images (CacheFirst 30d), CloudFront JSON (StaleWhileRevalidate 5min) | Per strategy |

**JSON freshness guarantee:** JSON data is fetched client-side from CloudFront (`d2nfgi9u0n3jr6.cloudfront.net`), a completely separate origin from `jonathanlloyd.me`. Cloudflare never sees, touches, or caches JSON requests. This is an architectural invariant. Poll requests (`?_poll=1`) also bypass the Workbox service worker entirely.

**Deploy pipeline:** Push to `master` → Build Astro → Deploy to GitHub Pages → Purge entire Cloudflare cache + Check for new images (parallel).

**Cloudflare cache rules** (configured in dashboard, priority order):
1. `/_astro/*` — 1 year edge + browser TTL (content-hashed, immutable)
2. `/sw.js`, `/manifest.webmanifest` — 5 min edge TTL (must stay fresh)
3. Static media (png, jpg, webp, svg, woff2, ico) — 1 month edge, 1 week browser
4. HTML catch-all — 5 min edge TTL

## Component Showcase (Dev Only)

A visual storyboard for iterating on components, available only during `npm run dev` at `/showcase/`. Routes are injected via a local Astro integration (`showcase-dev-only` in `astro.config.mjs`) that only activates when `command === 'dev'`. Showcase files live in `src/showcase/` (not `src/pages/`), so they are excluded from production builds.

| Route | Page | Components |
|---|---|---|
| `/showcase` | `index.astro` | Landing page with cards linking to each domain group |
| `/showcase/brand-guide` | `brand-guide.astro` | Colors, typography, glass-morphism, glows, spacing, animations |
| `/showcase/identity-system` | `identity-system.astro` | IdentityCard, BioTerminal, SystemStatus, Command Bar, ComingSoon |
| `/showcase/health-wellness` | `health-wellness.astro` | HeartRate, DailyActivity, Workouts, NightSummary, Hydration, Location |
| `/showcase/contributions-commits` | `contributions-commits.astro` | ContributionGrid, ContributionCalendar, GitHubHeatmap, CommitLog, CommitTimeline, RecentCommits, + 6 trend widgets |
| `/showcase/repositories-languages` | `repositories-languages.astro` | PinnedRepos, TopRepos, RepoShowcase, StarredRepoList, + 9 language/profile widgets |
| `/showcase/activity-feeds` | `activity-feeds.astro` | DevActivityLog, DevActivityTimeline, DevActivityCards, DevActivityByRepo, DevActivityPulse, ActivityFeed |
| `/showcase/reading-books` | `reading-books.astro` | ReadingFeed, Bookshelf, BookModal |
| `/showcase/responsive-preview` | `responsive-preview.astro` | 4 device iframes + interactive widget scale slider (6 widgets at adjustable container widths) |

Each component page renders all 45 components in 3 states (skeleton, empty, active) using data from `data/showcase-empty.json`, `data/*.json`, and `.query.ts` co-located exports.

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
| `--neon-cyan` | `#00d4ff` | Info, data streams |
| `--neon-orange` | `#ff6b00` | Urgency, degraded state |
| `--neon-indigo` | `#818cf8` | Deep/premium, cognitive |
| `--text` | `#f0f0f0` | Primary text |
| `--text-muted` | `#9ca3af` | Secondary text |

### Glass-morphism
```css
background: var(--glass-bg-inset);     /* rgba(255,255,255,0.03) - recessed */
background: var(--glass-bg);           /* rgba(255,255,255,0.07) - default */
background: var(--glass-bg-raised);    /* rgba(255,255,255,0.11) - elevated */
border: 1px solid var(--glass-border); /* rgba(255,255,255,0.1) */
border: 1px solid var(--glass-border-strong); /* rgba(255,255,255,0.18) - emphasis */
backdrop-filter: blur(var(--blur-md)); /* 16px */
```

### Typography
- Font: `Space Grotesk` (Google Fonts)
- 9 fluid tokens: `--font-size-xs` (0.36–0.42rem) through `--font-size-hero` (1.80–2.20rem)
- All tokens use `clamp(min, preferred, max)` with `rem + vw` preferred values scaling across 600px–1400px viewports

### Responsive Scaling
The site uses a hybrid approach: **fluid `clamp()` tokens** for smooth scaling + **structural breakpoints** for layout changes.

| Layer | Mechanism | What it handles |
|---|---|---|
| Fluid tokens | `clamp()` in `tokens.css` | Typography (9 tokens), spacing (16 tokens), top-bar height |
| Container queries | `@container` on `.tri-card` | Widget internals: BPM size, book covers, hydration vessels, contribution grid |
| Structural breakpoints | `@media` in `layout.css` | Panel stacking (900px), grid columns, identity card layout, safe-area insets |

**Breakpoints** (structural layout changes only — font/spacing scaling is handled by fluid tokens):

| Breakpoint | Behavior |
|---|---|
| `1100px` | Narrows left panel to 30%, adjusts identity card |
| `900px` | Stacks to single column, horizontal identity card, 2-col widget grid |
| `600px` | Single-column widgets, compact identity card, safe-area padding |

**Key rules:**
- Mobile overrides that fall **below** a fluid token's minimum (e.g., `.id-name` at 1.2rem vs `--font-size-hero` min of 1.80rem) are kept as structural overrides in `layout.css`
- Component font sizes reference tokens (`var(--font-size-base)`) rather than hardcoded rem values
- Widget padding uses spacing tokens (`var(--space-12)`, `var(--space-18)`, etc.)
- The book modal uses fluid `clamp()` for width, padding, and border-radius — no breakpoint overrides

## Running Locally

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # Outputs to dist/
npm run preview   # Preview build locally
```

## Visual Regression Testing

Screenshot tests using Playwright's built-in `toHaveScreenshot()` capture the dashboard at 4 viewport sizes to prevent layout regressions.

### Test Architecture

```
playwright.config.ts          # 4 viewport projects, webServer: build && preview
tests/visual/
  dashboard.spec.ts           # 4 tests × 4 viewports = 16 total
  screenshot.css              # Hides dynamic content for stable screenshots
  __screenshots__/            # Baseline PNGs committed to git (~1.3MB)
    desktop-1400/             # 1400×900
    tablet-1100/              # 1100×800
    tablet-768/               # 768×1024
    mobile-600/               # 600×900
tests/fixtures/               # 10 JSON files stubbing all CloudFront endpoints
```

### Key Design Decisions

- **Chromium only** -- single-engine rendering eliminates cross-browser noise
- **4 viewports** map to structural breakpoints in `layout.css` (1100px, 768px, 600px) plus default desktop
- **Baselines in git** -- ~16 PNGs at ~1.3MB total; no Git LFS needed
- **CSS stylePath** hides dynamic content: `#liveClock`, `.widget-timestamp`, `.live-dot`, `#particle-canvas`
- **Route interception** stubs all 10 CloudFront endpoints (`src/lib/constants.ts` ENDPOINTS) with fixture JSON
- **Service worker blocked** via `serviceWorkers: 'block'` to prevent Workbox caching interference
- **Cross-OS rendering** -- font rendering differs macOS↔Linux; for CI, generate baselines inside the Playwright Docker container (`mcr.microsoft.com/playwright:v1.52.0-noble`)

### Commands

```bash
npm run test:visual          # Compare against baselines
npm run test:visual:update   # Regenerate baselines after intentional changes
npm run test:visual:ui       # Interactive Playwright UI mode
```

### When to Update Baselines

After intentional visual changes (new widget, layout shift, design token update):

```bash
npm run test:visual:update
git add tests/visual/__screenshots__/
git commit -m "Update visual baselines for [describe change]"
```

### Adding New Tests

To screenshot a new widget, add a test in `tests/visual/dashboard.spec.ts`:

```typescript
test('widget name', async ({ page }) => {
  const widget = page.locator('.your-selector');
  await expect(widget).toHaveScreenshot('widget-name.png', { stylePath });
});
```

Then run `npm run test:visual:update` to generate the new baseline.

## Rules and Guardrails

### DO NOT
- Use ES6+ syntax (`let`, `const`, arrow functions, template literals) in inline `<script is:inline>` blocks
- Remove `.nojekyll` -- GitHub Pages needs it to serve the site without Jekyll processing
- Modify `public/css/` files without testing all responsive breakpoints

### DO
- Use CSS custom properties from `public/css/tokens.css` for all colors, spacing, and typography
- Follow the widget HTML structure: `.tri-card` > `.widget-header` + `.widget-body`
- Test all four responsive breakpoints (1400px, 1100px, 900px, 600px)
- Run `npm run build` to verify changes compile correctly
- Run `npm run test:visual` after CSS or layout changes to catch visual regressions
- Refer to `docs/wiki/` for detailed documentation on architecture, design system, and decisions
