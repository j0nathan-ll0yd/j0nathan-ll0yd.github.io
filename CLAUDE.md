# CLAUDE.md -- Human Datastream Portfolio

## Project Overview

Personal portfolio at `jonathanlloyd.me`, styled as a sci-fi "Human Datastream" dashboard. Astro 6 static site deployed to Cloudflare Pages. Read-only display surface for personal data (health, activity, GitHub, reading, location). All widgets imported from `@lifegames/web/production` (Design System package, yalc-linked).

## Commands

```bash
npm install                      # use --legacy-peer-deps if peer dep gate fails
npm run dev                      # localhost:4321

npm run build                    # production build (uses data/*.json)
npm run preview                  # preview production output

npm run test:build               # Vitest build-output tests (SEO, JSON-LD, images)
npm run test:visual              # Playwright visual regression (4 viewports, 144 tests)
npm run test:visual:docker       # run visual regression locally in Docker (matches CI)
npm run test:visual:update:docker # regenerate baselines in Docker (the ONLY local path — host regen is blocked)
npm run test:visual:ui           # interactive Playwright UI

npm run test:drift:update:docker # regenerate drift baselines in Docker

npm run validate:build-fixtures  # Ajv schema validation of data/*.json fixtures
npm run generate:fixtures        # regenerate test/fixtures/build-data/*.json
npm run validate:fixtures        # validate generated fixtures against schemas
npm run generate:types           # regenerate TS types from JSON schemas
npm run fetch:images             # download new images from CloudFront to public/images/
```

Deploy: push to `main` -> GitHub Actions (`deploy.yml`) -> `npm run build` -> `cloudflare/wrangler-action@v4` -> Cloudflare Pages.

## Repository Structure

```
.
├── astro.config.mjs              # Astro 6, PWA, sitemap
├── playwright.config.ts          # Visual regression (4 viewports, 144 tests)
├── playwright.drift.config.ts    # Drift detection (deployed dashboard baseline)
├── src/
│   ├── pages/
│   │   ├── index.astro           # Single page: loads data/*.json, composes DS widgets
│   │   └── 404.astro             # Custom 404 page
│   ├── layouts/
│   │   ├── Dashboard.astro       # HTML head, SEO meta, JSON-LD, OG tags, <style is:global> for DS CSS
│   │   └── analytics (embedded)
│   └── lib/
│       └── load-dashboard-data.ts # Loads 7 build-time fixtures; supports USE_FIXTURES mode
│
├── data/                         # Build-time fixtures (7 JSON files)
│   ├── profile.json              # Name, title, bio, avatar, social links
│   ├── health.json               # Heart rate, steps, sleep, hydration, workouts
│   ├── github.json               # Contribution heatmap, recent commits
│   ├── books.json                # Bookshelf with covers
│   ├── reading.json              # RSS/article feed items
│   ├── system.json               # Status indicators
│   └── theatre-reviews-sample.json
│
├── test/                         # Build-time fixture generation system
│   └── fixtures/
│       ├── generate.ts           # Generates test/fixtures/build-data/*.json
│       ├── validate.ts           # Validates generated fixtures
│       └── build-data/           # Generated test fixture outputs
│
├── tests/
│   ├── build/                    # Vitest: SEO, JSON-LD, data integrity, images
│   ├── visual/                   # Playwright: 4 viewport projects, baselines in __screenshots__/
│   │   ├── dashboard.spec.ts
│   │   ├── screenshot.css        # Stabilization: hides clock, timestamps, particles
│   │   └── __screenshots__/
│   └── drift/                    # Playwright: live dashboard drift detection
│       ├── drift.spec.ts         # Screenshots https://jonathanlloyd.me (with masking)
│       └── __screenshots__/
│
├── scripts/
│   ├── validate-build-fixtures.ts # Ajv validation of data/*.json against DS schemas
│   ├── check-live-data-bundle.mjs  # Ensures live-data.ts bundled after build
│   ├── fetch-images.mjs          # Download book covers/posters from CloudFront
│   ├── generate-types.mjs        # TS types from JSON schemas
│   ├── ci-setup.sh               # Install dependencies + cache for CI
│   └── agent-readiness-check.sh  # Agent Skills Discovery validation
│
├── public/
│   ├── assets/                   # Avatar, favicon, logo, PWA icons, OG image
│   ├── images/                   # Locally cached book covers/theatre posters (AVIF)
│   ├── .well-known/
│   │   ├── api-catalog           # RFC 9727 API catalog
│   │   ├── mcp/server-card.json  # MCP Server Card
│   │   └── agent-skills/         # Agent Skills Discovery v0.2.0
│   ├── llms.txt                  # LLM discovery index
│   ├── robots.txt                # Blocks AI scrapers
│   └── manifest.webmanifest      # PWA manifest
│
├── functions/
│   └── _middleware.ts            # Pages Function: security headers, API catalog
│
├── .github/workflows/
│   ├── deploy.yml                # Build + deploy + Cloudflare purge
│   ├── visual-tests.yml          # Playwright regression on PRs (4 viewports)
│   └── drift-detection.yml       # Drift detection on deploy (4 viewports, live dashboard)
│
└── AGENTS.md                     # Cross-tool AI coding context
```

## Data Flow

| Context | Source | Mechanism |
|---------|--------|-----------|
| Build-time | `data/*.json` | `fs.readFileSync` in `index.astro` frontmatter → `loadDashboardData()` helper |
| Test fixtures | `test/fixtures/build-data/*.json` | Generated by `test/fixtures/generate.ts`, validated by `validate-build-fixtures.ts` |
| Client-side | CloudFront | Fetched via `@lifegames/web/runtime/live-data.ts` after page load |
| Polling | CloudFront JSON endpoints | PollEngine (30s fast, 120s slow) with `?_poll=1` bypass |
| WebSocket | API Gateway | Adaptive fallback when WS unavailable |

**7 build-time fixtures** (loaded at build time): profile, health, github, books, reading, system, theatre-reviews-sample.

**Fixture mode** (`USE_FIXTURES=true`): Playwright switches to `test/fixtures/build-data/*.json` instead of `data/*.json`. Used for visual tests to ensure reproducible widget snapshots.

## Visual Testing

### Regression Testing (Playwright)
- **Config:** `playwright.config.ts`
- **Test file:** `tests/visual/dashboard.spec.ts`
- **Viewports:** 4 (desktop-1400, tablet-1100, tablet-768, mobile-600)
- **Tests:** 144 (36 per viewport)
- **Baselines:** Committed to git in `tests/visual/__screenshots__/`
- **Tolerance:** 2.5% pixel drift (`maxDiffPixelRatio: 0.025`), 0.2 YIQ color threshold
- **CI:** Generated in Playwright Docker container for cross-OS consistency

After intentional visual changes, use Docker to regenerate baselines that match CI:
```bash
npm run test:visual:update:docker
git add tests/visual/__screenshots__/
```

**Why Docker is required:** CI runs Playwright in `mcr.microsoft.com/playwright:v${version}-noble` (Linux/FreeType). macOS host uses Quartz rendering — baselines are incompatible and will fail CI.

- **Apple Silicon:** `--platform linux/amd64` runs via Rosetta (2-4x slower). Acceptable tradeoff for determinism.
- **Prerequisite:** Docker Desktop must be running.
- **No host escape hatch:** the local `test:visual:update` / `test:visual:update:fast` scripts were deleted. The only documented baseline-regen path is `npm run test:visual:update:docker` (which calls `scripts/run-in-docker.sh`). CI's baseline mismatch will fail any PR that ships host-rendered PNGs.
- **PR label:** Add the `update-snapshots` label to a PR to trigger CI-side baseline regen + auto-commit; label is auto-removed after commit.

### Drift Detection (Playwright)
- **Config:** `playwright.drift.config.ts`
- **Test file:** `tests/drift/drift.spec.ts`
- **Viewports:** 4 (desktop-1400, tablet-1100, tablet-768, mobile-600)
- **Baseline:** Screenshots of live `https://jonathanlloyd.me` (deployed dashboard)
- **Tolerance:** 5% pixel drift (looser than regression — accommodates real data changes)
- **Masking:** Volatile regions masked inline in `drift.spec.ts` (clock, counters, dates)
- **Trigger:** `.github/workflows/drift-detection.yml` runs on `workflow_run` off `deploy.yml`

Drift detects live dashboard visual regressions that would escape regression tests. Masking prevents false positives from dynamic data (current time, live counts, etc.).

## Design System Integration

All production widgets imported from `@lifegames/web/production` (yalc-linked from `design-system-Lifegames`). Web repo contains no widget source code.

### CSS Architecture
- `src/layouts/Dashboard.astro` has `<style is:global>` block (REQUIRED for DS CSS scoping)
- All CSS imports flow from `@lifegames/tokens` via `@import` (no `public/css/*.css` files)
- Cascade layers: tokens → base → components → effects
- No hardcoded values — all colors, spacing, typography from `var()` custom properties

### Runtime Scripts
- Import from `@lifegames/web/runtime/*` (never `../lib/*` or `../scripts/*`)
- Example: `import('@lifegames/web/runtime/particles').then(m => m.startParticles())`
- Particles, live-data, heart-rate inline logic all from DS runtime namespace

### Schema Validation
- **Prebuild hook:** `npm run validate:build-fixtures` runs before build
- **Validator:** Ajv validates `data/*.json` against `@lifegames/schemas`
- **Strictness:** `additionalProperties: false` — any unmapped field fails build
- **Fixture map:** `@lifegames/schemas/fixture-map.json` defines schema → fixture binding
- **When schema changes:** Extend Design System schema → `pnpm -F @lifegames/schemas codegen` → `pnpm yalc:publish` → consumer rebuild

### Inline Scripts
- All inline scripts externalized to `public/js/` files (10 total) for CSP compliance: `card-reveal`, `clock`, `leaflet-lazy`, `sa-loader`, `sa-stub`, `scroll-depth`, `sw-register`, `webmcp`, `book-modal`, `social-click-track`
- `<script is:inline src="/js/...">` loads external files without bundler processing
- ES5 only in external JS files under `public/js/`: `var`, `function` declarations, IIFEs
- No `let`, `const`, arrow functions, template literals, classes in `public/js/*.js`
- Bundled module scripts (`<script>` without `is:inline`) MAY use modern syntax
- No inline `on*=` event handlers in markup (CSP rejects them without `'unsafe-hashes'`); attach listeners in `public/js/*.js` instead
- CSP: `script-src 'self'` — no `'unsafe-inline'` (style-src retains `'unsafe-inline'`)
- Enforced by `npm run audit:inline-scripts` (prebuild gate). Adding a new inline script requires either externalization to `public/js/*.js` or a documented exception in this file.

## Image Pipeline

Book covers and theatre posters:
1. Amazon/Squarespace → OptimizeImages Lambda → S3 (AVIF) → CloudFront
2. `npm run fetch:images` downloads to `public/images/`
3. `src/lib/image-utils.ts` (from DS runtime) rewrites CloudFront URLs to local paths
4. Fallback: `onerror` swaps to CloudFront if local image missing

CI `check-images` job detects new images and creates a GitHub issue.

## Caching Architecture

| Layer | Domain | TTL | Strategy |
|-------|--------|-----|----------|
| Cloudflare | jonathanlloyd.me | HTML 5min, `/_astro/*` 1yr, assets 1mo, SW 5min | Cache by resource type |
| CloudFront | d1pfm520aduift.cloudfront.net | JSON 30s (s-maxage=30) | Cache queries, never mutation |
| Workbox SW | Both | Local images 30d (CacheFirst), CloudFront JSON 3s timeout (NetworkFirst) | Offline-first |

**Invariant:** JSON never cached by Cloudflare (fetched client-side from CloudFront, separate origin). Poll requests use `?_poll=1` bypass. Service worker blocked in tests for determinism.

## SEO & Metadata

**Core statement:** Personal portfolio of an engineering director, built as a living data dashboard. Real biometrics and constant updates across health, activity, and intellectual pursuits.

Key decisions:
- `og:type` is `"profile"` (not `"website"`)
- `ogDescription` separate from `description` (social card copy vs standard meta)
- JSON-LD `Person.description` is personality-forward copy
- `robots.txt` blocks AI scraping bots; each blocked bot redirected to `llms.txt`
- Content-Signal header: `search=yes, ai-train=no, ai-input=yes` (IETF draft)
- LLM content (`public/llms.txt`) is a discovery index pointing to CloudFront-hosted rich variants

## Rules and Guardrails

### DO
- Run `npm run test:visual` after any CSS or layout changes
- Run `npm run test:build` after modifying `src/lib/` modules
- Validate `data/*.json` with `npm run validate:build-fixtures` before commit
- Use CSS custom properties from `@lifegames/tokens` for all values
- Mark `<style>` blocks that import DS CSS with `is:global`
- Import runtime modules from `@lifegames/web/runtime/*`
- Use ES5 syntax in `<script is:inline>` blocks only

### DO NOT
- Use ES6+ syntax in `<script is:inline>` blocks
- Create new `src/components/*.astro` files (all widgets from DS)
- Hand-edit `public/css/*.css` (all styles from DS via `@import`)
- Import from relative paths like `../lib/` or `../scripts/` (use DS namespace)
- Hardcode hex colors or pixel values in CSS
- Bypass schema validation in prebuild

## Design System Placement Principles (P1–P8)

What belongs in the design system vs the web repo is governed by `design-system-Lifegames/GOVERNANCE.md`:

- **P1:** Reusable components (used by iOS OR web OR both) belong in DS.
- **P2:** Design tokens (colors, spacing, typography) are source-of-truth in DS.
- **P3:** Fixture data shapes (schema definitions) are source-of-truth in DS.
- **P4:** Runtime utilities (live-data, particles, adapters) are exported from DS.
- **P5:** Web-only application logic (route structure, page layout) stays in web repo.
- **P6:** Platform-specific styles (responsive overrides, input styles) may be in consuming repo.
- **P7:** Storybook / showcase components may be in DS if they serve both platforms.
- **P8:** Authoring new tokens, components, or utilities requires DS review + `pnpm yalc:publish` before consumer use.

## Troubleshooting

**Schema validation fails with "additional property X not allowed":**
1. Check if X is a new field from Lifegames Portal backend (likely)
2. In Design System repo: `pnpm sync:schemas` → `pnpm -F @lifegames/schemas codegen` → `pnpm yalc:publish`
3. Consumer rebuild succeeds automatically (yalc propagates)

**Visual tests fail after CSS changes:**
1. Verify changes in `npm run preview` locally
2. Run `npm run test:visual:docker` to check all 4 viewports (matches CI)
3. If intentional: `npm run test:visual:update:docker` → commit baselines

**Drift detection alerts on live deployment:**
1. Check `tests/drift/drift.spec.ts` — ensure all volatile regions (clock, dynamic counters) are masked
2. If new volatile widget added, extend the mask configuration in the spec
3. Redeploy with updated masks; drift detection will re-baseline on next deploy
4. To regenerate drift baselines locally: `npm run test:drift:update:docker`
