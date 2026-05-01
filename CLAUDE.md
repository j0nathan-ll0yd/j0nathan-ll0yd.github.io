# CLAUDE.md -- Human Datastream Portfolio

## Project Overview

Personal portfolio for Jonathan Lloyd at `jonathanlloyd.me`, styled as a sci-fi "Human Datastream" dashboard. Built with Astro 6 (static output, 0 KB JS by default), deployed to Cloudflare Pages via Wrangler. Selective `is:inline` scripts for particles, map, and animations.

## Commands

```bash
npm install                  # use --legacy-peer-deps if @vite-pwa/astro peer dep gate fails
npm run dev                  # localhost:4321 (includes /showcase/ routes)
npm run build                # outputs to dist/
npm run preview              # preview production build

npm run test                 # Vitest unit tests (tests/lib/)
npm run test:build           # Vitest build-output tests (tests/build/)
npm run test:visual          # Playwright screenshot regression (4 viewports)
npm run test:visual:update   # regenerate baselines after intentional visual changes
npm run test:visual:ui       # interactive Playwright UI

npm run fetch:images         # download new images from CloudFront to public/images/
npm run generate:types       # regenerate TS types from JSON schemas
npm run generate:fixtures    # regenerate test fixtures
npm run validate:fixtures    # validate generated fixtures against schemas
npm run compliance           # widget specification compliance check
```

Deploy: push to `main` -> GitHub Actions (`deploy.yml`) -> `npm run build` -> `cloudflare/wrangler-action@v3` -> Cloudflare Pages. Parallel `check-images` job detects uncommitted CloudFront images and creates a GitHub issue.

## Repository Structure

```
.
├── astro.config.mjs          # Astro + PWA + sitemap + dev-only showcase integration
├── package.json              # Astro 6, Vitest, Playwright, @vite-pwa/astro
├── tsconfig.json             # extends astro/tsconfigs/strict
├── vitest.config.ts          # unit tests (tests/lib/), coverage on src/lib/
├── vitest.build.config.ts    # build-output tests (tests/build/)
├── playwright.config.ts      # 4 viewport projects, Chromium only
├── src/
│   ├── pages/
│   │   ├── index.astro       # Single page: loads data/*.json, composes all widgets
│   │   └── 404.astro         # Custom 404 page
│   ├── layouts/
│   │   ├── Dashboard.astro   # HTML head, SEO meta, JSON-LD, OG tags, analytics
│   │   └── Showcase.astro    # Layout for dev-only showcase pages
│   ├── components/           # 56 Astro components total
│   │   ├── *.astro           # 17 top-level (IdentityCard, HeartRate, Bookshelf, etc.)
│   │   ├── github/           # 29 GitHub widgets + co-located .query.ts files
│   │   └── location/         # 10 location widgets (CityConstellation, WaffleGrid, etc.)
│   ├── lib/                  # TypeScript modules
│   │   ├── constants.ts      # ENDPOINTS, CLOUDFRONT_BASE, WEBSOCKET_URL, color maps
│   │   ├── api.ts            # CloudFront data fetching
│   │   ├── adapters.ts       # JSON -> component props (applies localizeImageUrl)
│   │   ├── poll-engine.ts    # PollEngine: fast-tier (30s) and slow-tier (120s) refresh
│   │   ├── ws-client.ts      # WebSocket client with adaptive polling fallback
│   │   ├── image-utils.ts    # localizeImageUrl(), imgFallbackAttrs()
│   │   ├── heart-rate.ts     # Heart rate data transforms
│   │   ├── sleep.ts          # Sleep data transforms
│   │   └── updaters*.ts      # DOM updaters (status, theatre, focus, odometer, leaderboard)
│   ├── styles/
│   │   └── layout.css        # Panel layout, responsive breakpoints
│   └── showcase/             # Dev-only component showcase pages (14 routes)
├── public/
│   ├── css/
│   │   ├── tokens.css        # Design tokens (colors, typography, spacing, radii, blur, glows)
│   │   ├── base.css          # Reset, body, scrollbar, global styles
│   │   ├── components.css    # Widget cards, identity card, terminal, map, charts, modals
│   │   └── effects.css       # Animations, transitions, glows, particle canvas
│   ├── assets/               # avatar (svg/jpg/webp), favicon.svg, logo.svg, PWA icons, og-image
│   ├── images/               # Locally cached book covers and theatre posters (AVIF)
│   ├── .well-known/
│   │   ├── api-catalog       # RFC 9727 API catalog (linkset JSON, extensionless)
│   │   ├── mcp/server-card.json  # MCP Server Card (read-only data resources)
│   │   └── agent-skills/     # Agent Skills Discovery v0.2.0 (index.json + SKILL.md)
│   ├── llms.txt              # LLM discovery index (points to CloudFront-hosted rich variants)
│   ├── robots.txt            # Blocks AI scrapers, allows search engines, Content-Signal header
│   └── manifest.webmanifest  # PWA manifest
├── data/                     # Build-time JSON data
│   ├── profile.json          # Name, title, bio, avatar, social links
│   ├── health.json           # Heart rate, steps, sleep, hydration, workouts
│   ├── github.json           # Contribution heatmap, recent commits, stats
│   ├── books.json            # Bookshelf with covers, authors, status
│   ├── reading.json          # RSS/article feed items
│   ├── system.json           # System status indicators
│   ├── theatre-reviews-sample.json
│   └── showcase-empty.json   # Empty state props for showcase pages
├── tests/
│   ├── lib/                  # 12 unit test files covering all src/lib/ modules
│   ├── build/                # 4 build-output tests (SEO, JSON-LD, data integrity, images)
│   ├── visual/
│   │   ├── dashboard.spec.ts # Screenshot tests (4 viewports)
│   │   ├── screenshot.css    # Stabilization: hides clock, timestamps, particles
│   │   └── __screenshots__/  # Baseline PNGs by viewport project
│   └── fixtures/             # Stable JSON fixtures for API route interception
├── test/fixtures/            # Fixture factory system (generate, validate, variations)
├── scripts/                  # fetch-images, generate-types, widget-compliance, agent-readiness
├── cloudflare/               # Cloudflare Worker for API catalog Content-Type
├── docs/wiki/                # Architecture docs (synced to GitHub Wiki via sync-wiki.yml)
├── .github/workflows/
│   ├── deploy.yml            # Build + deploy + Cloudflare purge + image check
│   ├── visual-tests.yml      # Playwright visual regression on PRs
│   └── sync-wiki.yml         # Sync docs/wiki/ to GitHub Wiki
└── AGENTS.md                 # Cross-tool AI coding context (complements this file)
```

## Data Flow

| Context | Mechanism |
|---|---|
| Build-time | `fs.readFileSync` from `data/*.json` in `index.astro` frontmatter |
| Client-side | Live data fetched from CloudFront (`d1pfm520aduift.cloudfront.net`) via `src/lib/api.ts` |
| Polling | `PollEngine` refreshes fast-tier (30s) and slow-tier (120s); `?_poll=1` bypasses SW |
| WebSocket | `ws-client.ts` connects to API Gateway WebSocket with adaptive polling fallback |

**10 live endpoints** (defined in `src/lib/constants.ts`): health, sleep, workouts, books, starredRepos, githubEvents, articles, location, focus, theatreReviews.

## Image Pipeline

Book covers and theatre posters: Amazon/Squarespace -> OptimizeImages Lambda -> S3 (AVIF) -> CloudFront -> `npm run fetch:images` -> `public/images/` -> git commit -> Cloudflare Pages.

- `scripts/fetch-images.mjs` downloads images locally or checks for new ones (`--check-only`)
- `src/lib/image-utils.ts` rewrites CloudFront URLs to local `/images/` paths via `localizeImageUrl()`
- `onerror` fallback swaps `<img>` src to CloudFront URL if local image missing
- CI `check-images` job detects new images and creates a GitHub issue

## Caching Architecture

| Layer | Domain | TTL |
|---|---|---|
| Cloudflare | `jonathanlloyd.me` | HTML 5min, `/_astro/*` 1yr, images/fonts 1mo, SW 5min |
| CloudFront | `d1pfm520aduift.cloudfront.net` | JSON 5min (s-maxage) |
| Workbox SW | Both | Local images CacheFirst 30d, CloudFront JSON NetworkFirst 3s timeout |

**Invariant:** JSON data is fetched client-side from CloudFront (separate origin). Cloudflare never caches JSON. All JSON fetches use `cache: 'no-store'`. Poll requests (`?_poll=1`) bypass the SW entirely. `pageshow` listener triggers `pollNow()` on bfcache restoration.

## Conventions

### Editor / Formatting
- 2-space indentation, UTF-8, LF line endings, trim trailing whitespace (except `.md`), final newline

### CSS
- All values from `public/css/tokens.css` custom properties (colors, spacing, typography)
- Fluid `clamp()` tokens scale 600px-1400px; `rem + vw` preferred values for WCAG 1.4.4
- `.tri-card` has `container-type: inline-size` for `@container` queries
- Glass-morphism: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--blur-md));`
- Widget card: `.tri-card` > `.widget-header` + `.widget-body`
- Widget header: `.widget-label` + `.widget-header-right` > `.live-dot` + `.widget-timestamp`
- Accent classes: `.tri-card-accent-{pink,blue,green,amber,purple,red,cyan,orange,indigo}`
- Layout CSS in `src/styles/layout.css`; all other CSS in `public/css/`

### JavaScript (Inline Scripts)
- ES5 only in `<script is:inline>` blocks: `var`, IIFEs, `function` declarations -- no `let`/`const`/arrow functions
- Each script wrapped in IIFE: `(function() { ... })();`
- All client JS embedded in `src/pages/index.astro` as `<script is:inline>` blocks

### Astro Components
- 56 components across `src/components/` (17 top-level, 29 github/, 10 location/)
- GitHub and location widgets use co-located `.query.ts` files for data transforms
- Props receive data objects parsed from JSON files
- No client-side framework -- all rendering is build-time

### Responsive Breakpoints
- Fluid tokens in `tokens.css` handle typography/spacing scaling
- Container queries on `.tri-card` handle widget internals
- Structural breakpoints in `src/styles/layout.css`: 1100px (narrow left panel), 900px (single column), 600px (compact)

## SEO & Metadata

Core statement: "Personal portfolio of Jonathan Lloyd, an engineering director and backend engineer, built as a living data dashboard. Real biometrics and constant updates of his whole body (health, activity, hydration, location) and mind (coding, reading, learning). Jack into his human datastream as the world becomes more AI-centric."

Key decisions:
- `og:type` is `"profile"` (not `"website"`)
- `ogDescription` is a separate prop from `description` (longer copy for social cards)
- JSON-LD `Person.description` is hardcoded (personality-forward copy for structured data)
- Keywords meta targets Bing/DuckDuckGo (Google ignores it)
- `robots.txt` blocks AI scraping bots but allows search engines; each blocked bot has `Allow: /llms.txt`
- `robots.txt` includes `Content-Signal: search=yes, ai-train=no, ai-input=yes` per IETF draft
- WebMCP tools registered via `navigator.modelContext.provideContext()` with ES5 syntax

### LLM Content
- `public/llms.txt` is a discovery index pointing to CloudFront-hosted rich variants (`llms-small.txt`, `llms-full.txt`, `index.md`)
- Rich LLM content composed by backend Lambda -- do not hand-edit; see `docs/wiki/LLM-Content-Spec.md`
- Agent readiness files in `public/.well-known/` -- see `docs/wiki/LLM-Content-Spec.md`
- If updating `SKILL.md`, recompute SHA-256 digest and update `agent-skills/index.json`

## Testing

### Unit Tests (Vitest)
- `tests/lib/` -- 12 test files covering all `src/lib/` modules
- `tests/build/` -- 4 build-output tests (SEO meta, JSON-LD, data integrity, image pipeline)
- `test/fixtures/` -- factory-based fixture generation and validation system
- Config: `vitest.config.ts` (unit), `vitest.build.config.ts` (build output)

### Visual Regression (Playwright)
- Chromium only, 4 viewports: desktop-1400, tablet-1100, tablet-768, mobile-600
- Baselines in `tests/visual/__screenshots__/` (~1.3MB, committed to git)
- CSS stylePath hides dynamic content; CloudFront endpoints stubbed with fixtures
- Service worker blocked via `serviceWorkers: 'block'`
- Cross-OS: generate baselines in Playwright Docker container for CI consistency

After intentional visual changes:
```bash
npm run test:visual:update
git add tests/visual/__screenshots__/
```

## Component Showcase (Dev Only)

14 showcase routes injected only during `npm run dev` via `showcase-dev-only` integration in `astro.config.mjs`. Pages live in `src/showcase/` (excluded from production). Each page renders components in skeleton, empty, and active states.

Routes: `/showcase`, `/showcase/brand-guide`, `/showcase/identity-system`, `/showcase/health-wellness`, `/showcase/contributions-commits`, `/showcase/repositories-languages`, `/showcase/activity-feeds`, `/showcase/reading-books`, `/showcase/responsive-preview`, `/showcase/og-images`, `/showcase/location-widgets`, `/showcase/fullscreen-overlays`, `/showcase/404-pages`, `/showcase/theatre-reviews`

## Rules and Guardrails

### DO NOT
- Use ES6+ syntax in `<script is:inline>` blocks
- Modify `public/css/` files without testing all responsive breakpoints (1400, 1100, 900, 600)
- Hand-edit CloudFront-composed LLM content files

### DO
- Use CSS custom properties from `tokens.css` for all values
- Follow widget HTML structure: `.tri-card` > `.widget-header` + `.widget-body`
- Test all four responsive breakpoints after CSS/layout changes
- Run `npm run build` to verify changes compile
- Run `npm run test:visual` after CSS or layout changes
- Run `npm run test` after modifying `src/lib/` modules
- Refer to `docs/wiki/` for detailed architecture documentation
