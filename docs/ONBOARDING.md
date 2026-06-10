# Onboarding — Human Datastream (`jonathanlloyd.me`)

A walkthrough of this repository for someone who knows HTML/CSS/JS/npm but has never seen Astro, this project's data pipeline, the Design System integration, or the visual regression setup. Read top to bottom on day one; come back to Section 3 (file-by-file map) as a reference.

---

## 1. The 60-Second Pitch

This repo builds **`jonathanlloyd.me`** — a single-page sci-fi "Human Datastream" dashboard that displays Jonathan Lloyd's biometrics, GitHub activity, reading list, theatre reviews, and location data. It is static HTML at the edge (Cloudflare Pages), hydrated by client-side polling of CloudFront-hosted JSON.

**What it looks like:** dark `#06060f` background, glass-morphism cards in a triptych grid (`Body` + `Mind` columns), a fixed identity panel on the left, a live clock in the top bar, particle background. See `docs/claude-design/screenshots/dashboard-desktop-1400.png`.

**What makes it unusual** (and why generic Astro/web knowledge isn't enough):

1. **It owns almost no widget code.** Every production widget — heart rate, hydration, bookshelf, dev activity log, etc. — is imported from `@lifegames/web/production`, a sibling repository linked in via `yalc` (see Section 2). This repo is the *consumer*; widget source lives in `~/Repositories/design-system-Lifegames`.
2. **Two-stage data flow.** Build time uses local `data/*.json` files (Section 4.1). Runtime fetches the same shapes from CloudFront (`d1pfm520aduift.cloudfront.net`) and swaps the DOM in place via `@lifegames/web/runtime/live-data`. The static HTML is essentially a hydration skeleton.
3. **Three test layers.** Vitest validates the build output. Playwright runs ~176 screenshot comparisons against committed PNG baselines at four viewports. A separate "drift" Playwright config screenshots the *deployed* production site against its own baselines to catch live regressions.
4. **Baselines must be generated in Docker.** macOS Quartz font rendering produces different pixels than Linux FreeType in CI. Host-generated baselines fail CI immediately. There is a Docker wrapper script (`scripts/run-in-docker.sh`) for this.
5. **Heavy machine-readability surface.** RFC 9727 API catalog, MCP Server Card, Agent Skills Discovery v0.2.0, WebMCP `navigator.modelContext` tools, an `llms.txt` discovery file, and a `text/markdown` content-negotiation path served by a Cloudflare Pages Function. Treat the `.well-known/` directory as production.

You should expect to spend your first day reading CLAUDE.md, this document, and `docs/wiki/Widget-Specification.md`. Avoid touching `data/*.json` or `tests/visual/__screenshots__/` until you've shipped something small.

---

## 2. Tech Stack & Mental Model

### Astro 6.x (`astro.config.mjs:32`)
Astro is a server-side renderer that emits **static HTML** at build time (`output: 'static'`, `astro.config.mjs:7`). Components are `.astro` files: a YAML-ish frontmatter block of TypeScript between `---` delimiters, then JSX-flavored HTML. There is **no runtime framework** — by default 0 KB of JavaScript ships to the browser. You opt into client JS three ways:

| Form | Syntax | Transpilation? |
|---|---|---|
| Inline ES5 script | `<script is:inline src="/js/clock.js">` | **No.** Emitted verbatim. Must be ES5. |
| Bundled module | `<script>import('@lifegames/web/runtime/particles').then(...)` | Yes. Modern JS allowed. |
| External vendor | `<script src="/vendor/leaflet/leaflet.js">` | No. |

Mental model: **Astro is a Markdown-style HTML generator with a sane TypeScript frontmatter, not React**. `src/pages/index.astro` is the only real page; everything else composes into it.

### Cloudflare Pages (hosting + Pages Functions + Workers)
The built `dist/` directory is deployed to Cloudflare Pages by `wrangler-action@v4` (see `.github/workflows/deploy.yml:36`). Three Cloudflare-specific things to know:

- **`public/_routes.json`** declares which paths bypass the routing layer (everything in `/_astro/*`, `/fonts/*`, `/assets/*`, etc. is served as a pure static asset with aggressive cache headers).
- **`functions/_middleware.ts`** is a Pages Function — a Cloudflare Worker that runs on every request. It sets the CSP header, injects `Link:` rel headers, and does `Accept: text/markdown` content negotiation (proxying to a CloudFront-hosted markdown variant). When this file exists, Cloudflare ignores any `_headers` file.
- **Cache strategy** is layered: Cloudflare edge caches HTML for 5 min, `_astro/*` for 1 year (immutable), JSON is *never* cached at Cloudflare because it's served from a separate origin (CloudFront), and Workbox handles its own offline layer.

### `@lifegames/web` Design System via yalc
**Yalc** is "npm but for monorepo local development." It does what `npm link` was supposed to do but doesn't break peer dependencies. When you run `bash scripts/ci-setup.sh`, it:

1. Clones `design-system-Lifegames` from GitHub
2. Builds its three packages (`@lifegames/tokens`, `@lifegames/web`, `@lifegames/schemas`)
3. Runs `pnpm yalc:publish` which copies them into `.yalc/` in *this* repo
4. Runs `npm ci --legacy-peer-deps` so `package.json`'s `"file:.yalc/@lifegames/web"` resolves

Locally, the workflow is similar but uses `~/Repositories/design-system-Lifegames` as the source instead of a clone. **Important consequence:** if a widget renders wrong, the bug may be upstream. The widget source code is *not* in this repo.

### Playwright (visual + drift)
Two configs:

| Config | What it screenshots | Tolerance | When it runs |
|---|---|---|---|
| `playwright.config.ts` | `localhost:4321` (Astro preview after build) using fixture data | 2.5% pixel drift | PRs, via Docker |
| `playwright.drift.config.ts` | `https://jonathanlloyd.me` (live production) | 5% pixel drift | After deploy, via `workflow_run` |

Both use the same Chromium determinism flags (`--font-render-hinting=none`, `--disable-lcd-text`, `--disable-font-subpixel-positioning`, `--force-device-scale-factor=1`; see `playwright.config.ts:30-39`). Both run inside the Microsoft Playwright Docker image — see Section 5.

### Vitest (build-output assertions)
`vitest.build.config.ts:5` runs everything under `tests/build/**/*.test.ts`. The `globalSetup` (`tests/build/setup.ts`) executes `npm run build` once before any test, then specs read `dist/` and `data/` and assert correctness (SEO meta, JSON-LD shape, image presence, data shape).

### Ajv (schema validation)
`scripts/validate-build-fixtures.ts` runs Ajv against `data/*.json` using schemas from `@lifegames/schemas/fixture-map.json`. Strict mode: `additionalProperties: false` — any new field flowing from the backend without a corresponding schema update *fails the build*. This is intentional, not a bug.

### Workbox service worker + PWA manifest
`@vite-pwa/astro` generates `dist/sw.js` from the `workbox` block in `astro.config.mjs:41-81`. Three runtime caches:

- Local images (`/images/books/`, `/images/theatre/`): `CacheFirst`, 30 days, 200 entries max
- CloudFront images fallback: `CacheFirst`, 7 days, safety net for `onerror` swaps
- CloudFront JSON: `NetworkFirst`, 3-second timeout, 5-minute expiry. Crucially excludes `?_poll=1` query (negative lookahead at `astro.config.mjs:71`) so the live poller bypasses the SW.

`skipWaiting: true` + `clientsClaim: true` mean a new SW activates on next page load instead of after all tabs close. PWA manifest is at `public/manifest.webmanifest`.

### How these relate

```
[ npm push to main ]
        │
        ▼
[ deploy.yml ] ── runs ci-setup.sh ── yalc-links @lifegames/* ── runs npm run build
        │                                                              │
        │                                       Astro reads data/*.json + uses @lifegames/web widgets
        │                                                              │
        ▼                                                              ▼
[ wrangler deploy ] ─── dist/ ──→ [ Cloudflare Pages ] ── functions/_middleware.ts wraps responses
        │                                                              │
        │                                                              ▼
        │                                                    [ Browser request ]
        │                                                              │
        │                                       index.html + Workbox SW + ES5 inline scripts
        │                                                              │
        │                                  @lifegames/web/runtime/live-data starts PollEngine
        │                                                              │
        │                            Polls https://d1pfm520aduift.cloudfront.net/*.json?_poll=1
        │                                                              │
        ▼                                       Updater functions in @lifegames/web mutate DOM
[ drift-detection.yml ] ─ Playwright screenshots live site against baselines on every deploy
```

---

## 3. Repository Map (file-by-file)

### 3.1 Root configuration

| File | Purpose | Who reads it | Trip hazard |
|---|---|---|---|
| `package.json` | Scripts + dep manifest. Note: dependencies use `file:.yalc/...` not version numbers. | npm, CI, humans | `npm install` may fail without `--legacy-peer-deps`; yalc deps must be linked first (`scripts/ci-setup.sh`). |
| `package-lock.json` | npm lockfile. | npm, CI | Commit changes after `npm install`. |
| `astro.config.mjs` | Astro + PWA + sitemap configuration; dev proxy for `/api/live`. | build | The PWA `runtimeCaching` block (`:49-80`) is the *only* place SW caching is configured. |
| `tsconfig.json` | One line: `"extends": "astro/tsconfigs/strict"`. | TypeScript, IDEs | Stricter than common; expect `noUncheckedIndexedAccess`. |
| `playwright.config.ts` | Visual regression test config (4 viewports, fixture mode, build-and-preview server). | Playwright | `webServer.command` runs `npm run build && npm run preview` unless `SKIP_BUILD=true`. `webServer.env.USE_FIXTURES='true'` switches the build to fixture data. |
| `playwright.drift.config.ts` | Live-site drift detection config (same 4 viewports, no webServer, 5% tolerance). | Playwright (CI only) | No `webServer` block — `drift.spec.ts` hits `https://jonathanlloyd.me` directly. |
| `vitest.build.config.ts` | Vitest config: include `tests/build/**/*.test.ts`, global setup `tests/build/setup.ts`. | Vitest | The globalSetup runs `npm run build` — slow first run. |
| `CLAUDE.md` | Top-level conventions, do/don't lists, Design System integration rules, troubleshooting. | Humans + AI agents | Authoritative. Read this before AGENTS.md. |
| `AGENTS.md` | Cross-tool AI context (Astro/PWA basics, key files, conventions). | AI agents | **Stale.** References `src/components/`, `public/css/tokens.css`, `src/styles/layout.css` — none of which exist post-yalc migration. See Section 9 (Documentation drift). |
| `README.md` | Human-facing project overview, SEO copy table, baseline regen instructions. | Humans | Also stale: mentions `src/components/` and `public/css/` directories that have moved into the Design System. |
| `.editorconfig` | 2-space indent, UTF-8, LF endings. | IDEs | Honor this; CI doesn't enforce. |
| `.gitattributes` | Marks PNG/JPG/WebP/AVIF as binary; specifically tags `tests/visual/__screenshots__/**/*.png` as `binary -text -diff`. | git, git-auto-commit-action | Critical — without this, baseline auto-commits via `stefan-zweifel/git-auto-commit-action` can corrupt via libvips re-encode. |
| `.gitignore` | Ignores `.omc/` (agent state), `.yalc/`, `yalc.lock`, `.claude/rules/`, Playwright artifacts (`test-results/`, `playwright-report/`, `blob-report/`). | git | Do not check `.yalc/` in. |
| `.contract-lock.json` | SHA-256 checksums of every schema file in `@lifegames/schemas`, plus the upstream design-system-Lifegames git SHA the lock was generated from. | `npm run check:contract-lock` (Husky pre-commit, Tier 1) + `contract-check` CI job (Tier 2); `scripts/verify-contract.mjs` also checks lock-vs-yalc drift. | Auto-generated. Never hand-edit. Enforced by `npm run check:contract-lock`. To regenerate after an upstream schema change: `node scripts/generate-contract-lock.mjs && git add .contract-lock.json`. |

### 3.2 `src/` — the entire Astro surface area is six files

```
src/
├── env.d.ts                       # Astro + Vite PWA type references
├── layouts/Dashboard.astro        # <head>, SEO meta, JSON-LD, OG tags, manifest link
├── lib/load-dashboard-data.ts     # Build-time loader: data/*.json or test/fixtures/build-data/*.json
├── pages/404.astro                # Glitch-themed 404, full-page takeover via .glitch-page
├── pages/index.astro              # The dashboard. Imports DS widgets, composes layout, wires runtime scripts
└── types/exports.ts               # Generated TS types from JSON Schemas (do not hand-edit)
```

- **`src/env.d.ts`** — Just three triple-slash references: Astro client types, vite-plugin-pwa info, vite-plugin-pwa client. No content of your own goes here.
- **`src/layouts/Dashboard.astro`** — The single layout wrapper. Sets `<html lang="en">`, all `<meta>` tags, OpenGraph (`og:type=profile`, not `website`), Twitter card, JSON-LD `@graph` with `WebSite`, `ProfilePage`, and `Person` nodes (`:57-80`). Three `<link rel="alternate" type="text/markdown">` links advertise LLM-friendly variants on CloudFront (`:27-29`). Contains a `<style is:global>` block for Design System CSS (CLAUDE.md notes this is *required* for DS scope to work — do not remove `is:global`).
- **`src/lib/load-dashboard-data.ts`** — The single data entrypoint. Reads `process.env.USE_FIXTURES === 'true'` to decide between `data/` (production) and `test/fixtures/build-data/` (tests). Reads six JSON files synchronously, plus one async `fetch()` to CloudFront for starred repos (which doesn't have a build-time fixture; uses `test/fixtures/generated/github-starred-repos/baseline.json` in fixture mode). The lone `console.log` at `:29` is intentional ("build logs surface in CI/terminal output"; see the doc comment).
- **`src/pages/404.astro`** — Self-contained 404 page using `<Dashboard>` layout with `robots="noindex"`. The `.glitch-page` styles are inline `<style is:global>` — a full-screen takeover (`position: fixed; inset: 0; z-index: 9999`) with scanline overlay (`:30-40`).
- **`src/pages/index.astro`** — **The entire portfolio.** Reads dashboard data at `:15`, imports 15+ widgets from `@lifegames/web/production` (`:4-10`), one from `@lifegames/web/widgets/health` (`:12`, not yet promoted). Composes the `.command-layout` grid: left panel (IdentityCard, BioTerminal, SystemStatus), top bar (clock + poll status), right panel (Body column + Mind column triptych). Bottom of file wires up: particles (`:79-82`, lazy-loaded only if user hasn't asked for reduced motion), live clock (`/js/clock.js`), card-reveal animation (`/js/card-reveal.js`), heart-rate ECG canvas init (`:92-94`), scroll-depth tracking, and the polling engine (`:101-103` — note this is a bare `import` for its side-effect; if Rollup tree-shakes it, `scripts/check-live-data-bundle.mjs` will fail the build).
- **`src/types/exports.ts`** — Generated by `scripts/generate-types.mjs` from JSON Schemas in `@lifegames/schemas`. Defines `ArticlesExport`, `BooksExport`, `HealthExport`, etc. Don't hand-edit; regenerate.

### 3.3 `data/` — seven JSON files baked into the build

| File | Shape (top-level keys) | Consumed by |
|---|---|---|
| `data/profile.json` | `name, title, location, coordinates, linkedin, github, bio, tagline, avatar, terminalLines[]` | `IdentityCard`, `BioTerminal` |
| `data/health.json` | `date, generatedAt, quantities{...}, sleep{stages, efficiency}` | `HeartRate`, `MovementRings`, `Workouts`, `Hydration`, `NightSummary` |
| `data/github.json` | `devActivity[]` (commits + PRs feed) | `DevActivityLog` |
| `data/books.json` | `generatedAt, books[]` (asin, title, author, status, images) | `Bookshelf`, `BookModal` |
| `data/reading.json` | `articles[]` (RSS / saved article items) | `ReadingFeed` |
| `data/system.json` | `status, indicators` | `SystemStatus` |
| `data/theatre-reviews-sample.json` | Theatre show metadata for local dev (production fetches live) | `TheatreReviews` in dev only |

All loaded synchronously in `src/lib/load-dashboard-data.ts:38-43`. **Schemas are strict.** Adding a new field that backend schemas don't know about will fail `npm run validate:build-fixtures` and block the build.

### 3.4 `test/fixtures/` — the generator system

This directory is a separate world from `tests/`. It's a *fixture authoring* system that produces stable JSON inputs for visual tests and dev experimentation.

- **`test/fixtures/generate.ts`** (≈61 lines) — Reads all variation objects from `variations/index.ts`, kebab-cases their names, writes `test/fixtures/generated/{dataType}/{name}.json`. Run via `npm run generate:fixtures`.
- **`test/fixtures/validate.ts`** (≈176 lines) — Re-reads everything in `generated/` and validates against `VALIDATION_RULES` (required fields + types per data type). Run via `npm run validate:fixtures`.
- **`test/fixtures/VALIDATION.md`** — Human-readable table: for each data source, lists every variation and the expected UI state. Use this as a cheat sheet when adding a new variation.
- **`test/fixtures/factories/`** — Twelve factory modules (`articles.ts`, `books.ts`, `focus.ts`, `github-events.ts`, `health.ts`, `helpers.ts`, `location.ts`, `sleep.ts`, `starred-repos.ts`, `theatre-reviews.ts`, `workouts.ts`, `index.ts`). Each exports `create{Type}` (single-record builder with overrides) and `create{Type}Fixture` (full export object). `helpers.ts` provides `isoDate(daysAgo)`, `isoTimestamp(daysAgo)`, `placeholderText(words)`, and `last90DaysEntries(density)`.
- **`test/fixtures/variations/`** — Eleven variation modules, one per data type plus `index.ts`. Each defines named variations (e.g. `health.ts` exports `baseline`, `bradycardia`, `peak`, `hrvAmber`, `missingOptional`, `maxHydration`). These are the *inputs* to `generate.ts`.
- **`test/fixtures/generated/`** — ~90 JSON files in subdirs keyed by data type. Output of `generate.ts`. **Committed to git** so CI doesn't need to regenerate. After changing a factory or variation, run `npm run generate:fixtures && npm run validate:fixtures && git add test/fixtures/generated/`.
- **`test/fixtures/build-data/`** — Six JSON files (`books.json`, `github.json`, `health.json`, `profile.json`, `reading.json`, `system.json`) used by visual tests at *build time* (not runtime). Selected by `src/lib/load-dashboard-data.ts:31-33` when `USE_FIXTURES=true`. Stable; rarely change.

### 3.5 `tests/` — three test suites

#### `tests/build/`
- **`setup.ts`** — Vitest `globalSetup`. Runs `npm run build` once.
- **`data-integrity.test.ts`** — Asserts the six `data/*.json` files parse and contain required fields per data type. No mocking; uses real production files.
- **`image-pipeline.test.ts`** — For each book in `data/books.json`, verifies a `public/images/books/{asin}.webp` exists and is non-empty. Also validates `dist/sw.js`, `dist/manifest.webmanifest`, `dist/index.html` were produced.
- **`json-ld.test.ts`** — Parses `<script type="application/ld+json">` from `dist/index.html`, validates `@graph` contains `WebSite` + `Person` nodes, all URLs use the `jonathanlloyd.me` domain.
- **`predicates.test.ts`** — Unit tests for the pure functions in `tests/visual/predicates.ts` (`allImagesComplete()`, `scrollHeightStable()`). Those functions exist twice (here as importable, and inlined in `helpers.ts`) because Playwright's `page.waitForFunction()` serializes its callback to a string — you can't `import` inside.
- **`seo-meta.test.ts`** — Cheerio-parses `dist/index.html` and asserts the meta tags match the SEO contract in CLAUDE.md.

#### `tests/visual/`
- **`global-setup.ts`** (≈37 lines) — Hits the configured base URL once and refuses to run if the response doesn't contain `id="cardHR"` or "Human Datastream" — guards against running tests against a stale dev server on the same port.
- **`helpers.ts`** (≈226 lines) — The shared test harness.
  - `interceptRoutes()` (`:45-94`) routes all `https://d1pfm520aduift.cloudfront.net/**` requests to local fixture JSON, blocks WebSocket entirely, and serves a transparent 1×1 PNG for any external image.
  - `navigateAndWait()` (`:111-212`) is the load-stabilization function: navigate to `/`, wait for `document.fonts.ready`, wait for all `.is-loading` skeletons to disappear, wait for all `<img>.complete`, wait for bio-terminal typewriter to finish, then assert `scrollHeight` is stable across three 150ms-spaced samples (`:190-210`).
  - `setupPage()` is `interceptRoutes()` + `navigateAndWait()` for one-liner test setup.
  - Exports `WIDGET_SELECTORS` — the registry of widget DOM IDs that screenshot tests target.
- **`fixtures.ts`** (≈129 lines) — Maps fixture *scenarios* (`populated`, `empty`, `complex`, `hr-peak`, `hydration-zero`, etc.) to per-endpoint JSON file paths under `test/fixtures/generated/`. Three "dashboard-level" scenarios override all 10 endpoints; ~20 "widget-level" scenarios start from `BASELINE` and override one endpoint.
- **`predicates.ts`** (20 lines) — Pure functions imported by `predicates.test.ts`; same logic is inlined into `helpers.ts` (see above).
- **`screenshot.css`** (≈77 lines) — Stabilization stylesheet applied via Playwright's `stylePath`. Hides dynamic content (live clock, poll dot, ECG canvas, particle canvas, focus/DND clocks), freezes all CSS animations to `0s`, overrides `height: 100dvh` to `height: auto` so `fullPage` screenshots actually capture everything (`:69-76`).
- **`dashboard.spec.ts`** — Three full-page tests (populated / empty / complex) × 4 viewports = 12 captures. The `tablet-1100` variant is `.fixme()`'d due to a PNG-encoder corruption on tall fullPage screenshots (see PR #44).
- **`widgets.spec.ts`** (≈255 lines) — Three parts:
  - **4a** (`:20-111`): 14 baseline widget screenshots in serial mode (shares one browser page to avoid 56 sequential page loads).
  - **4b** (`:117-237`): ~25 widget *variation* tests (HR-peak, hydration-zero, sleep-rem-dominant, books-no-covers, etc.).
  - **4c** (`:243-255`): Focus and DND overlay full-page captures.
- **`__screenshots__/{viewport}/{spec}.ts/*.png`** — Committed PNG baselines, organized by viewport-project name → spec file → test name. Regenerated by `--update-snapshots`. ~144 files. Marked `binary -text -diff` in `.gitattributes`.

#### `tests/drift/`
- **`drift.spec.ts`** — Single test that navigates to `https://jonathanlloyd.me`, applies the same `screenshot.css` stabilization, masks volatile regions (`#liveClock`, `#pollStatus`, `#hrEcgCanvas`, and per-widget volatile zones), captures full page, compares to baseline at 5% tolerance. Skips with a friendly log if the baseline file doesn't exist (`:15-18`) — this avoids noisy issue filing on first run.
- **`__screenshots__/{viewport}/drift.spec.ts/drift-full.png`** — Four baselines (one per viewport). Regenerated by `npm run test:drift:update:docker`.

#### `test/visual/manual-baselines/`
- `before-cleanup/` and `after-D1/` — Manual screenshot captures from `scripts/screenshot-baseline.mjs` (not part of Playwright). Used as visual evidence in PRs that changed layout. Reference-only.

### 3.6 `scripts/` — build, validation, and CI orchestration

| Script | Runs when | What it does |
|---|---|---|
| `ci-setup.sh` | CI (deploy.yml, visual-tests.yml) | Clones `design-system-Lifegames`, builds it, yalc-publishes the three packages, runs `npm ci --legacy-peer-deps`. Configurable via `DS_REPO` / `DS_REF` env. |
| `fetch-schemas.sh` | CI prebuild (when local DS sibling is absent) | Pulls 8 `.schema.json` files from `mantle-Lifegames-Portal@main/schemas` via raw GitHub. Local dev reads `../mantle-Lifegames-Portal/schemas/` directly. |
| `generate-types.mjs` | Manual / prebuild | Compiles JSON Schemas to `src/types/exports.ts` using `json-schema-to-typescript`. Prefers local sibling repo, falls back to `./schemas/`. |
| `validate-build-fixtures.ts` | `prebuild` npm hook | Ajv-validates `data/*.json` against `@lifegames/schemas/fixture-map.json`. Blocking. |
| `generate-contract-lock.mjs` | Manual / `/sync-types` skill | Walks `.yalc/@lifegames/schemas/{vendored,authored,generated}/`, SHA-256s every schema file, writes `.contract-lock.json` with upstream git SHA and aggregate checksum. |
| `verify-contract.mjs` | `visual-tests.yml` `contract-check` job | Recomputes the same checksums, diffs against `.contract-lock.json`. `CONTRACT_CHECK_MODE=blocking` exits non-zero on drift; `warning` (default) just logs. |
| `check-live-data-bundle.mjs` | `postbuild` npm hook | Scans `dist/_astro/` for the bundled `index.astro` script chunks and verifies they contain string literals like `'cardTheatreReviews'` — proves Rollup didn't tree-shake the side-effect-only `import '@lifegames/web/runtime/live-data'`. |
| `fetch-images.mjs` | Manual (`npm run fetch:images`) + CI check job | Downloads book covers / theatre posters from CloudFront to `public/images/`. CI runs with `--check-only`: if anything's missing, writes `missing-images.txt` and the workflow files a GitHub issue. |
| `screenshot-baseline.mjs` | Manual | Standalone Playwright script for capturing fullPage screenshots at 4 viewport widths. Output goes to `test/visual/manual-baselines/` (reference-only, not used by Playwright tests). |
| `playwright-version.sh` | Called by `run-in-docker.sh` and several workflows | One-line jq-style parse of `package-lock.json` to get the Playwright version string for Docker image tagging. |
| `run-in-docker.sh` | `npm run test:visual:docker` (and update variants) | Runs `mcr.microsoft.com/playwright:v${VERSION}-noble` with `--platform linux/amd64`, mounts the repo to `/work`, sets `USE_FIXTURES=true`, runs `npm ci && npx playwright test`. |
| `agent-readiness-check.sh` | Manual / `verify-production` skill | 12 checks for `isitagentready.com` compliance (robots, sitemap, Link headers, markdown negotiation, AI bot rules, Content-Signal, RFC 9727 API catalog, MCP card, agent-skills index, WebMCP). Supports `BUILD_DIR=dist` mode for pre-deploy verification. |
| `.css-checksums.json` | Reference data | SHA-256 hashes of three CSS file paths (`public/css/components.css`, `public/css/effects.css`, `src/styles/layout.css`). **Those files no longer exist post-yalc migration.** Stale; safe to ignore or delete. |

### 3.7 `public/` — what gets copied verbatim to the site root

#### `public/_routes.json`
Cloudflare Pages v1 routing config. `include: ["/*"]`, `exclude: ["/_astro/*", "/fonts/*", "/css/*", "/vendor/*", "/assets/*"]`. The excluded paths bypass the routing layer entirely (no `_middleware.ts`, no Pages Functions), serving as edge-cached static assets.

#### `public/llms.txt`
54 lines. Discovery index for LLM agents: prose intro, links to richer variants on CloudFront (`llms-small.txt`, `llms-full.txt`, `index.md`), canonical list of the 10 JSON data sources, tech stack, wiki links. AI training bots are `Disallow:`'d everywhere except this file (see `robots.txt`).

#### `public/robots.txt`
56 lines. Three layers: generic `Allow: /`, **Content-Signal** directive `search=yes, ai-train=no, ai-input=yes` (IETF draft — RAG and search allowed, training blocked), and explicit `User-agent` blocks for known training crawlers (GPTBot, ClaudeBot, CCBot, Google-Extended, anthropic-ai, Bytespider, Meta-ExternalAgent, Applebot-Extended, Amazonbot) that allow `/llms.txt` only.

#### `public/manifest.webmanifest`
PWA manifest. `display: standalone`, theme + background `#06060f`, 192 and 512 px icons (the 512 is `purpose: "any maskable"` for adaptive Android icons).

#### `public/.well-known/api-catalog`
RFC 9727 JSON LinkSet. Declares the CloudFront origin as the API base and points to `llms.txt` and the wiki for service description. Served with `Content-Type: application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"` — that override is set explicitly in `functions/_middleware.ts:69-74`.

#### `public/.well-known/agent-skills/index.json`
Agent Skills Discovery v0.2.0 manifest. One entry: `portfolio-expert`, with a SHA-256 digest of the SKILL.md for integrity. **If you edit the SKILL.md, the digest will mismatch and `agent-readiness-check.sh` will flag it.**

#### `public/.well-known/agent-skills/portfolio-expert/SKILL.md`
74 lines. Hand-authored manifest for agents: Jonathan's identity, expertise areas, site tech, the 10 live JSON endpoints, LLM-optimized content URLs, key architectural decisions, usage guide.

#### `public/.well-known/mcp/server-card.json`
95 lines. MCP Server Card declaring this site as a read-only resource server (`resources.list = true, resources.read = true, tools = false, prompts = false`). Lists 10 resources by URI (each a CloudFront JSON endpoint) with name/description/mimeType.

#### `public/js/` — ES5-only inline scripts (8 files)
All loaded with `<script is:inline src="/js/...">`. **No transpilation.** ES5 syntax mandatory.

| File | Purpose |
|---|---|
| `clock.js` | Live clock. `setInterval(updateClock, 1000)` writes to `#liveClock`. |
| `card-reveal.js` | Staggered reveal animation. Adds `visible` class to identity card +100ms, bio +250ms, system +550ms, triptych cards +400ms + col×150ms + row×100ms. |
| `scroll-depth.js` | Fires `sa_event('scroll_depth_25/50/75/100')` once per threshold for Simple Analytics. |
| `sa-stub.js` | Pre-load stub. Defines `window.sa_event` as a no-op queue so events fire before SA loads. |
| `sa-loader.js` | Lazy-loads `latest.js` + `auto-events.js` from `scripts.simpleanalyticscdn.com` via `requestIdleCallback` (3s timeout) or `setTimeout(2s)` fallback. |
| `sw-register.js` | Registers `/sw.js` on `load`, skipping `localhost`. |
| `leaflet-lazy.js` | `IntersectionObserver` on `[data-widget="map"]`. On first visibility, loads `/vendor/leaflet/leaflet.js`, dispatches `leaflet:ready`. Exposes `window.__loadLeaflet()` for manual trigger. |
| `webmcp.js` | Registers 4 tools (`get_profile`, `get_data_sources`, `get_current_reading`, `get_tech_stack`) with `navigator.modelContext` (WebMCP). |

#### `public/vendor/leaflet/`
Self-hosted Leaflet map library (`leaflet.js`, `leaflet.js.map`, `leaflet.css`). Loaded lazily by `leaflet-lazy.js` only when a map widget enters the viewport.

#### `public/fonts/`
Three Space Grotesk woff2 subsets: `space-grotesk-latin.woff2`, `space-grotesk-latin-ext.woff2`, `space-grotesk-vietnamese.woff2`. Self-hosted.

#### `public/assets/` — branding and PWA icons
`favicon.svg`, `icon-192.png`, `icon-512.png`, `avatar.{svg,jpg,webp}`, `logo.svg`, `og-image.png` (1200×630 for social shares).

#### `public/images/books/` and `public/images/theatre/`
Cached CloudFront-optimized images. Naming pattern: `{asin-or-slug}.{webp|avif}`, `{slug}-card.{webp|avif}`, `{slug}-thumb.{webp|avif}`. Pulled by `scripts/fetch-images.mjs` from CloudFront → Lambda-optimized variants. **Workbox excludes these dirs from precaching** (`astro.config.mjs:43`) — they're handled by the runtime `CacheFirst` rule instead.

### 3.8 `functions/_middleware.ts`
The only Cloudflare Pages Function. Two responsibilities:

1. **Markdown content negotiation** (`:38-50`) — if `Accept: text/markdown`, proxy to CloudFront's `llms-full.txt` and return it as `Content-Type: text/markdown`. This is what makes `isitagentready.com` pass.
2. **Security + Link headers on every response** (`:52-74`):
   - CSP (`:5-16`) — note `script-src 'self' https://scripts.simpleanalyticscdn.com https://static.cloudflareinsights.com` and `style-src 'self' 'unsafe-inline'`. Scripts are tight; styles allow inline.
   - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
   - Homepage only: `Link:` header advertising `llms.txt`, the api-catalog, and the sitemap; `CDN-Cache-Control: no-store` to disable Cloudflare edge cache so content negotiation always runs
   - `/.well-known/api-catalog` only: the RFC 9727 `Content-Type` override

### 3.9 `.github/`
- **`.github/dependabot.yml`** — Weekly Monday updates. npm packages grouped (Astro family, Vite PWA, Playwright) to reduce PR noise. Ignores major bumps for Astro and `@vite-pwa/*` (peer-dep coupling).
- **`.github/scripts/sync-wiki.sh`** — Used by `sync-wiki.yml`. Flattens `docs/wiki/*.md` into the wiki repo, rewrites internal links (strips `docs/wiki/` prefix and `.md` extensions), renames `README.md` → `Home.md`, validates no broken links.
- **`.github/scripts/generate-sidebar.sh`** — Used by `sync-wiki.yml`. Generates `_Sidebar.md` for the wiki navigation, assigns emojis per filename.
- **`.github/workflows/deploy.yml`** — Push to main → checkout → setup Node 22 → `bash scripts/ci-setup.sh` → `npm run build` → `cloudflare/wrangler-action@v4` deploy to project `human-datastream`. Second job (`check-images`) runs `fetch-images.mjs --check-only` and files an issue if CloudFront has new images. Runs on `[self-hosted, linux, arm64, node]`.
- **`.github/workflows/drift-detection.yml`** — Trigger: `workflow_run` after `deploy.yml` succeeds on main. Checks out the deploy commit SHA, runs `playwright.drift.config.ts` inside the Playwright Docker image, uploads the report, files a deduplicated GitHub issue (label: `drift-detected`) on failure.
- **`.github/workflows/sync-wiki.yml`** — Trigger: pushes to main touching `docs/wiki/**` or either of the `.github/scripts/sync-wiki*` files. Clones the `.wiki` repo using `secrets.WIKI_TOKEN`, runs the sync script + sidebar generator + footer, commits and pushes if changed.
- **`.github/workflows/update-snapshots.yml`** — Trigger: PR labeled `update-snapshots`, or manual `workflow_dispatch`. Checks out PR branch, runs `--update-snapshots` in Docker, auto-commits regenerated baselines via `stefan-zweifel/git-auto-commit-action@v6`, removes the label.
- **`.github/workflows/visual-tests.yml`** — Trigger: PRs to main. Five jobs (in order): `resolve-version` → `contract-check` (skippable via `skip-contract-check` label) → `setup` (clones DS, optionally on a matching branch from `design-system-Lifegames`, caches `ds-dist` artifact) → `visual-tests` (4-way matrix shard) → optional `commit-baselines` job for `update_snapshots=true` runs → `merge-reports`. Uses `--ipc=host --shm-size=2g` to avoid `/dev/shm` exhaustion on fullPage screenshots.

### 3.10 `docs/` and `docs/wiki/`
- **`docs/wiki/Home.md`** — Wiki landing page after sync.
- **`docs/wiki/Astro-Implementation.md`** — Architecture and data flow narrative.
- **`docs/wiki/Brand-Guide.md`** — Color palette, glass-morphism rules, typography.
- **`docs/wiki/Why-Astro.md`** — Framework selection rationale.
- **`docs/wiki/LLM-Content-Spec.md`** — Format and inventory of LLM-friendly content surfaces (`llms.txt`, `llms-small.txt`, `llms-full.txt`).
- **`docs/wiki/Widget-Specification.md`** — Source of W1–W15 widget rules. Read this before building or modifying widgets. *Caveat:* the rules assume widgets live in `src/components/` — in this consumer repo, they live in `@lifegames/web`, so W-checks practically run upstream.

- **`docs/claude-design/DESIGN.md`** — ~200-line design system overview pitched at `claude.ai/design`.
- **`docs/claude-design/tokens.json`** — W3C DTCG-format token export.
- **`docs/claude-design/tokens.css`** — Direct copy of the CSS custom property declarations from the DS tokens package.
- **`docs/claude-design/components.md`** — Ten core reusable patterns (tri-card, widget-header, skeleton-state, etc.).
- **`docs/claude-design/interactions.md`** — Animation, hover, reduced-motion rules.
- **`docs/claude-design/layout.md`** — Breakpoints, split-panel, container queries.
- **`docs/claude-design/fonts/space-grotesk-latin*.woff2`** — Latin + latin-ext subsets only (Vietnamese omitted; it's only needed by `public/fonts/`).
- **`docs/claude-design/screenshots/*.png`** — Dashboard captures at 4 viewports + per-widget reference shots. Regenerated by the `update-claude-design` skill from Playwright baselines.

### 3.11 `.claude/`
- **`.claude/principles/widget-checks.md`** — The 15 W-checks for widget structure / styling / data / showcase / testing / compliance.
- **`.claude/skills/new-widget/SKILL.md`** — Guided workflow for adding a new widget.
- **`.claude/skills/update-claude-design/SKILL.md`** — 9-step process for regenerating `docs/claude-design/`.
- **`.claude/skills/verify-production/SKILL.md`** — Six-surface production verification (well-known endpoints, CloudFront JSON, security headers, PageSpeed, drift, live UX).

### 3.12 `previews/` — 20 standalone status-screen HTML files
Three groups: **`cs-1`..`cs-10`** (sci-fi briefing states: signal-acquiring, boot-sequence, classified-briefing, coordinates-locked, transmission-pending, station-offline, launch-window, encrypted-dispatch, dark-horizon, mission-pending). **`dnd-1`..`dnd-5`** (do-not-disturb overlays). **`work-1`..`work-5`** (work-mode overlays: shift-active, deep-focus, access-suspended, stealth-mode, in-the-zone). These are *not* shipped — they're self-contained HTML files for demos, screenshots, or embedding in external tools (e.g. Slack status).

---

## 4. Data Flow (end-to-end)

```
[git push → main]
   │
   ▼
[deploy.yml: build-and-deploy job]                              .github/workflows/deploy.yml:17
   │ • actions/checkout@v6
   │ • actions/setup-node@v6 (node-22, cache: npm)
   │ • bash scripts/ci-setup.sh
   │     – git clone design-system-Lifegames
   │     – pnpm install && pnpm build in DS
   │     – pnpm yalc:publish @lifegames/{tokens,web,schemas}
   │     – yalc add in this repo
   │     – npm ci --legacy-peer-deps
   │ • npm run build
   │     – prebuild: validate fixtures (Ajv + @lifegames/schemas)
   │     – astro build (reads data/*.json via src/lib/load-dashboard-data.ts:38-43)
   │     – postbuild: scripts/check-live-data-bundle.mjs verifies poll bundle survived tree-shaking
   │ • cloudflare/wrangler-action@v4 → pages deploy dist --project-name=human-datastream
   ▼
[Cloudflare Pages edge]
   │ • dist/index.html, dist/_astro/*.{js,css}, dist/sw.js, dist/manifest.webmanifest
   │ • functions/_middleware.ts wraps every response with CSP + Link headers
   │ • _routes.json excludes /_astro/*, /fonts/*, /assets/*, /css/*, /vendor/* from middleware
   ▼
[Browser GET https://jonathanlloyd.me/]
   │ • Pages Function runs functions/_middleware.ts:onRequest
   │     – Accept: text/markdown?  → proxy to CloudFront llms-full.txt
   │     – else → context.next() → static index.html
   │     – Set CSP, X-Content-Type-Options, Referrer-Policy
   │     – Homepage: Set Link header + CDN-Cache-Control: no-store
   ▼
[HTML loads]
   │ • <head>: Dashboard.astro sets all <meta>, JSON-LD, OG, Twitter, alternates
   │ • <body>: pre-rendered tri-cards in skeleton state (.is-loading)
   │ • <script is:inline src="/js/sa-stub.js"> defines window.sa_event queue
   │ • <script is:inline src="/js/clock.js"> starts setInterval(updateClock, 1000)
   │ • <script is:inline src="/js/card-reveal.js"> staggered .visible class adds
   │ • <script is:inline src="/js/scroll-depth.js"> wires scroll listener
   │ • <script is:inline src="/js/sw-register.js"> registers /sw.js (skips localhost)
   │ • <script is:inline src="/js/webmcp.js"> registers 4 navigator.modelContext tools
   ▼
[Service Worker activates]                                       astro.config.mjs:47-48
   │ • skipWaiting + clientsClaim → immediate control
   │ • /images/books|theatre/* → CacheFirst (30 days, 200 entries)
   │ • CloudFront *.json (without ?_poll=1) → NetworkFirst (3s timeout, 5 min expiry)
   ▼
[Bundled module scripts hydrate]                                src/pages/index.astro:78-103
   │ • particles.startParticles() (skipped if prefers-reduced-motion)
   │ • initHeartRateInline('hrEcgCanvas') → starts Canvas ECG animation
   │ • import '@lifegames/web/runtime/live-data' (side-effect: starts PollEngine)
   ▼
[PollEngine begins polling]
   │ • Fast endpoints (health, focus): 30s
   │ • Slow endpoints (books, articles, location, theatre): 120s
   │ • All requests append ?_poll=1 → Workbox SW bypasses (negative lookahead in astro.config.mjs:71)
   │ • Network: GET https://d1pfm520aduift.cloudfront.net/{endpoint}.json?_poll=1&t={timestamp}
   ▼
[CloudFront returns JSON]
   │ • Cache-Control: s-maxage=30 (CDN caches, browser doesn't)
   ▼
[Updater function mutates DOM]
   │ • Updaters live in @lifegames/web (NOT in this repo)
   │ • Each updater: finds elements by ID → removes .is-loading → writes new content
   │ • Skeleton placeholders swap for active state with count-up / fade animations
```

### When `USE_FIXTURES=true` (Playwright runs)

The deploy chain above is replaced by:
1. `npm run build && npm run preview` in `playwright.config.ts:17`
2. `src/lib/load-dashboard-data.ts:31-33` reads from `test/fixtures/build-data/` instead of `data/`
3. `tests/visual/helpers.ts:45-94` intercepts all CloudFront requests and returns fixture JSON instead
4. WebSocket blocked entirely; external images served as a transparent 1×1 PNG
5. `screenshot.css` injected to hide non-deterministic content

This gives you a fully deterministic snapshot of the dashboard for pixel comparison.

---

## 5. Build, Test, Deploy Lifecycle

### Every npm script (`package.json:6-26`)

| Script | Plain English | When to run |
|---|---|---|
| `dev` | `astro dev` — start dev server on `localhost:4321` with HMR. | While coding. |
| `prebuild` | Two steps: validate the `@lifegames/schemas` package against this repo's data, then validate `data/*.json` against those schemas. Runs automatically before `build`. | Never directly. Fix failures here before retrying `build`. |
| `validate:build-fixtures` | Just the second prebuild step. | After editing `data/*.json`. |
| `build` | `astro build` — produces `dist/`. | Before deploy or before Playwright. |
| `postbuild` | `scripts/check-live-data-bundle.mjs` — verifies poll bundle wasn't tree-shaken. | Never directly. |
| `preview` | `astro preview` — serve `dist/` locally for inspection. | After `build`, for sanity-checking before commit. |
| `generate:fixtures` | Run `test/fixtures/generate.ts` → write `test/fixtures/generated/`. | After editing a factory or variation. |
| `validate:fixtures` | Run `test/fixtures/validate.ts` against everything in `generated/`. | After `generate:fixtures`. |
| `generate:types` | Compile JSON Schemas → `src/types/exports.ts`. | After a backend schema bump. |
| `fetch:images` | Download new book/theatre images from CloudFront to `public/images/`. | When CI files an issue saying CloudFront has new images. |
| `test` | Alias for `test:build`. | Sanity check before push. |
| `test:build` | Run Vitest build-output tests. Slow on first run (rebuilds). | After modifying `src/lib/`, `src/layouts/`, or any SEO/JSON-LD code. |
| `test:visual` | Run Playwright visual regression on host (validation only — `--update-snapshots` is structurally blocked). | Local debugging. |
| `test:visual:ui` | Playwright UI mode. | Debugging individual test failures. |
| `test:visual:fast` | `SKIP_BUILD=true` — skips the build step, reuses existing `dist/`. | When iterating on a stable build. |
| `test:visual:docker` | `scripts/run-in-docker.sh` against `playwright.config.ts`. **This is the canonical local run.** | Before pushing CSS changes; matches CI exactly. |
| `test:visual:update:docker` | Same, with `--update-snapshots`. The only local path that can regen baselines. **Commit these baselines.** | After intentional visual changes. |
| `test:drift:update:docker` | Regenerate drift baselines (live-site screenshots). | When deployed production has changed intentionally and the drift workflow keeps flagging it. |

### The prebuild validation chain
1. `LIFEGAMES_VALIDATE_CWD=$PWD npx tsx node_modules/@lifegames/schemas/scripts/validate.ts` — the DS-side validator runs against the consumer's working directory; ensures the schemas package is internally consistent and that this consumer is compatible.
2. `tsx scripts/validate-build-fixtures.ts` — Ajv-validates each `data/*.json` against its bound schema from `@lifegames/schemas/fixture-map.json`. Strict mode rejects unknown fields.

If either fails, the build halts. **The most common cause: backend added a field; you need to bump `@lifegames/schemas` upstream, `yalc:publish`, and re-yalc-add here.**

### Why two Playwright configs
- **`playwright.config.ts`** runs at PR time. Tight tolerance (2.5%) because the input (Astro build + fixture JSON) is fully deterministic. Catches *code-introduced* regressions.
- **`playwright.drift.config.ts`** runs after each deploy. Looser tolerance (5%) because the input is the *live site* with real data, dynamic timestamps, masked counters. Catches *production-environment* regressions: bad CloudFront data, broken CDN cache, real-world layout issues that fixture mode masks.

### Why Docker is required for baselines
macOS uses Quartz for font rendering; Linux CI uses FreeType. The sub-pixel positioning differs. A baseline generated on macOS will show as a 0.5–2% diff against a CI run — sometimes under the 2.5% tolerance, sometimes over. The only way to get consistency is to generate baselines in the same Docker image CI uses: `mcr.microsoft.com/playwright:v${VERSION}-noble`. On Apple Silicon, `--platform linux/amd64` runs the image under Rosetta (2–4× slower). Acceptable tradeoff for determinism.

### deploy.yml step by step (`.github/workflows/deploy.yml`)
1. **Trigger:** push to main (or manual dispatch). Concurrency group `deploy`, no in-progress cancellation.
2. **`build-and-deploy` job** on `self-hosted, linux, arm64, node` runner:
   - `actions/checkout@v6`
   - `actions/setup-node@v6` with `node-version: 22, cache: npm`
   - `bash scripts/ci-setup.sh` — clones DS, builds, yalc-publishes, `npm ci --legacy-peer-deps`
   - `npm run build` — runs prebuild (Ajv) → `astro build` → postbuild (live-data bundle check)
   - `cloudflare/wrangler-action@v4` with `command: pages deploy dist --project-name=human-datastream`
3. **`check-images` job** in parallel:
   - Checkout + Node setup
   - `node scripts/fetch-images.mjs --check-only` — flags missing images, writes `missing-images.txt`
   - On failure, files a GitHub issue with the missing-images list and a fix command (`npm run fetch:images && git add public/images/ && git commit && git push`).

After deploy succeeds, `drift-detection.yml` fires via `workflow_run`.

---

## 6. Conventions & Guardrails

### ES5-only inline scripts (`<script is:inline>`)
`is:inline` tells Astro to emit the script tag verbatim — **no bundler, no transpilation, no minifier**. Older browsers and WebView contexts parse-fail on `let`, `const`, arrow functions, template literals, classes, optional chaining, nullish coalescing. All eight files in `public/js/` follow this rule. **Bundled `<script>` modules (no `is:inline`)** — like the `import('@lifegames/web/runtime/particles')` block in `index.astro:79-82` — DO get Vite-bundled, so modern syntax is fine there.

### CSS tokens / no hardcoded values
Every color, font size, and spacing value should come from `var(--token-name)`. The token definitions live in `@lifegames/tokens` and are re-exported from `@lifegames/web` via `@import`. This repo no longer holds CSS source files. **You will see references in CLAUDE.md and AGENTS.md to `public/css/tokens.css`** — that file doesn't exist anymore; it moved into the Design System package after the yalc migration. The `.css-checksums.json` references three files that also don't exist.

### Schema strictness (`additionalProperties: false`)
The DS schemas enforce closed objects. If backend adds a new field, the build will fail until: (1) DS schema is updated, (2) DS is yalc-republished, (3) consumer rebuilds. The error message will point at the unknown property by name.

### Design System Placement Principles (P1–P8)
From `design-system-Lifegames/GOVERNANCE.md`, summarized:

| ID | Rule |
|---|---|
| **P1** | If iOS *or* web *or* both use it → put it in DS. |
| **P2** | Design tokens (color, spacing, type) live in DS. |
| **P3** | Schema definitions live in DS. |
| **P4** | Runtime utilities (live-data, particles, adapters) live in DS. |
| **P5** | Application logic specific to a consumer (page layout, routes) stays in the consumer. |
| **P6** | Platform-specific overrides may live in the consumer. |
| **P7** | Showcase/Storybook can live in DS if it serves multiple platforms. |
| **P8** | Authoring a new token/component/utility requires DS review *and* `pnpm yalc:publish` before the consumer can use it. |

### Widget structure rules (W1–W15) — summary
From `.claude/principles/widget-checks.md`. **Practical impact in this repo:** the rules apply to widget *source*, which lives in `@lifegames/web`. When you're working in this consumer repo, you'll mostly only encounter W1 (root `.tri-card` with unique ID), W4 (skeleton/empty/active states render correctly), and W12 (each widget has a baseline screenshot test).

- **W1–W3:** Structure (tri-card wrapper, CSS tokens, fluid + container queries).
- **W4–W6:** States (mandatory skeleton/empty/active; variations documented; image `onerror` fallback).
- **W7–W9:** Data pipeline (adapters in `src/lib/adapters.ts`, updaters in `src/lib/updaters.ts`, ES5 in inline scripts).
- **W10–W11:** Showcase (each widget appears in showcase with all 3 states; SVG ID conflicts handled).
- **W12–W14:** Testing (baseline screenshot test, adapter/updater unit tests, generated fixtures).
- **W15:** `npm run compliance` passes — *however,* the `compliance` script is not in `package.json` of this consumer (it lives upstream). See Section 9.

---

## 7. "If you had to change X, where would you look?"

### Tweak a color
1. Identify the token name (e.g. `--neon-pink`). Search `docs/claude-design/tokens.css` for the current value.
2. Change it in the upstream DS repo (`design-system-Lifegames/packages/tokens/`).
3. `pnpm yalc:publish` in DS, then `npx yalc update @lifegames/tokens` here.
4. `npm run test:visual:docker` to confirm intended drift; `npm run test:visual:update:docker` to commit new baselines.

### Add a new widget
1. Read `docs/wiki/Widget-Specification.md` (W1–W15) and `.claude/skills/new-widget/SKILL.md`.
2. Build the component in the DS repo (`design-system-Lifegames/packages/web/src/widgets/...`).
3. Add fixture/factory/variation in DS *and* a build-data fixture here if needed.
4. Bump DS, `pnpm yalc:publish`, update here.
5. Import the widget in `src/pages/index.astro` (`:4-12`) and place it in the layout.
6. Add fixture entries to `tests/visual/fixtures.ts` and a test case to `tests/visual/widgets.spec.ts`.
7. `npm run test:visual:update:docker` to commit baselines.

### Add a new data source
1. Define the JSON Schema in `mantle-Lifegames-Portal` (backend) and DS `@lifegames/schemas`.
2. `npm run generate:types` here → regenerates `src/types/exports.ts`.
3. Add a `data/{name}.json` file.
4. Update `src/lib/load-dashboard-data.ts` to read it.
5. Add an adapter/updater in DS, wire to `@lifegames/web/runtime/live-data`.
6. Update `tests/visual/helpers.ts` to intercept the new endpoint in fixture mode.

### Fix a failing visual test
1. Look at the Playwright report (`playwright-report/index.html`) — it shows expected vs. actual vs. diff PNGs side by side.
2. If the diff is genuine drift you caused → run `npm run test:visual:update:docker`, inspect the regenerated baseline PNG, commit.
3. If the diff is rendering noise → check `tests/visual/screenshot.css` for missing stabilization (new animated element?). Check `tests/visual/helpers.ts` `navigateAndWait()` for missing wait conditions.
4. If failure is `Page not stable: scrollHeight kept changing` → an async element is mutating after navigation. Hide it in `screenshot.css` or add a wait.

### Update SEO metadata
1. `src/layouts/Dashboard.astro` — all `<meta>` tags, OG, Twitter, JSON-LD `@graph`.
2. `README.md` (SEO copy table) and `CLAUDE.md` (Section "SEO & Metadata") — keep in sync.
3. `tests/build/seo-meta.test.ts` and `tests/build/json-ld.test.ts` — update assertions.
4. `tests/build/data-integrity.test.ts` — may need updates if you added fields.

### Change a cache TTL
- **Cloudflare HTML/asset TTLs** — managed by Cloudflare project config (not in this repo).
- **Workbox runtime cache** — `astro.config.mjs:49-80` (`maxAgeSeconds` per cache).
- **Service worker TTL between deploys** — controlled by `skipWaiting: true` at `astro.config.mjs:47`.
- **CloudFront JSON TTL** — set at the origin (`s-maxage=30`). Not in this repo; managed in the data pipeline.
- **`Link` header / `CDN-Cache-Control` for the homepage** — `functions/_middleware.ts:62-65`.

---

## 8. Gotchas, Footguns, and Tribal Knowledge

1. **`npm install` fails on a clean clone.** You need `--legacy-peer-deps` *and* yalc-linked DS packages. Run `bash scripts/ci-setup.sh` first, or symlink `~/Repositories/design-system-Lifegames` and yalc-publish manually.

2. **Host-generated visual baselines fail CI.** Even on the same OS family. The host scripts have been deleted (`test:visual:update`, `test:visual:update:fast`). The only documented regen paths are `npm run test:visual:update:docker`, `npm run test:drift:update:docker`, and the two CI workflows (`update-snapshots.yml` via the `update-snapshots` label, or `visual-tests.yml` with `update_snapshots: true`). Bare `npx playwright test --update-snapshots` on the host still technically runs but produces non-CI bytes — CI's baseline mismatch on the next run will catch it.

3. **Apple Silicon Docker is slow.** `--platform linux/amd64` runs under Rosetta. A full 4-viewport `--update-snapshots` run takes 5–10 minutes. Plan for it.

4. **Adding a backend field breaks the build immediately.** `additionalProperties: false` is intentional. You must bump DS schemas upstream first.

5. **The poll engine is a side-effect import.** `src/pages/index.astro:101-103` is `import '@lifegames/web/runtime/live-data';` — no symbol. Rollup will happily tree-shake it. `scripts/check-live-data-bundle.mjs` guards against this in the postbuild hook. If you see "Live data not bundled" CI failures, the fix is usually upstream: add to `sideEffects` in `@lifegames/web/package.json`.

6. **`functions/_middleware.ts` *overrides* any `public/_headers` file.** Cloudflare disables `_headers` processing when a root middleware exists. So all security headers must be set in the middleware.

7. **Workbox negative lookahead is fragile.** The poll-bypass regex at `astro.config.mjs:71` is `/^https:\/\/d1pfm520aduift\.cloudfront\.net\/(?!.*[?&]_poll=).*\.json$/`. If you change the poll bypass query string, change the regex too — otherwise the SW will start caching poll responses.

8. **`docs/wiki/` synced to GitHub Wiki is one-way.** Edits made directly on the wiki are overwritten on next sync.

9. **`.contract-lock.json` should never be hand-edited.** Drift between the lock and actual DS schemas silently disables the contract check (mode is `warning` by default). If you do edit it, the next CI run with `CONTRACT_CHECK_MODE=blocking` will fail.

10. **Inline scripts under `public/js/` cannot use ES6.** Browsers will silently break the page on parse error. There's no transpilation step. CSP doesn't catch this — it's a syntax issue, not a security one.

11. **CSP forbids inline scripts** (`script-src 'self' ...`). All scripts must be external (in `public/js/`) or bundled modules with hashed filenames. **Inline `<style>` is allowed** (`style-src 'self' 'unsafe-inline'`) — that's how the `<style is:global>` in `Dashboard.astro` works.

12. **Service worker activates aggressively.** `skipWaiting + clientsClaim`. If you're debugging a SW issue locally, unregister via DevTools and hard-reload — otherwise the old SW may serve cached `dist/sw.js`.

13. **Dev server has no service worker.** `sw-register.js` skips registration when `hostname === 'localhost'`. SW behavior can only be tested with `npm run preview` (which serves on `localhost:4321` too — that script-side check uses hostname, so test via a tunneled URL or 127.0.0.1).

14. **The `tablet-1100` full-page dashboard tests are `.fixme()`'d.** A PNG-encoder edge case on tall fullPage captures. See PR #44. Don't be alarmed; widget tests at that viewport still run.

15. **`.gitattributes` marks PNG baselines `binary -text -diff`.** Critical for `stefan-zweifel/git-auto-commit-action@v6` to not corrupt them via libvips re-encode.

16. **`previews/*.html` are not shipped.** They're standalone demos.

17. **The `test:visual` directory naming is confusing.** `test/` (singular) holds *fixtures*. `tests/` (plural) holds *test specs*. Don't mix them up.

18. **`MovementRings` is imported from `@lifegames/web/widgets/health`, not `production/`** (`src/pages/index.astro:12`). It's not yet promoted to the production namespace. When upstream promotes it, change the import.

---

## 9. Glossary

| Term | Definition |
|---|---|
| **Astro** | Static-output web framework. Renders `.astro` components to HTML at build time; ships 0 KB JS by default. |
| **yalc** | Local-package linker. Better than `npm link` because it preserves the dependency tree. Used to consume `@lifegames/web` without publishing to npm. |
| **tri-card** | The base CSS class for every widget panel. Provides glass-morphism (semi-transparent background, blurred backdrop, 1px border). Required structure: `.tri-card > .widget-header + .widget-body`. |
| **Human Datastream** | The product name. Refers to the dashboard's framing as a live data feed of one human (body + mind). |
| **PollEngine** | Client-side polling system in `@lifegames/web/runtime/live-data`. Polls fast endpoints (health, focus) every 30s, slow ones (books, articles, location, theatre) every 120s. Appends `?_poll=1` to bypass the SW. |
| **Drift detection** | Playwright suite that screenshots the *deployed* live site after every deploy, compares to a baseline at 5% tolerance, files a GitHub issue if it drifts. Distinct from regression tests (which run against `localhost:4321`). |
| **Fixture mode** | Build with `USE_FIXTURES=true`. Switches `loadDashboardData()` to read from `test/fixtures/build-data/` and Playwright intercepts CloudFront requests to return generated fixtures. Used for deterministic visual tests. |
| **MCP Server Card** | A JSON manifest at `/.well-known/mcp/server-card.json` declaring this site as a Model Context Protocol resource server (read-only). Lets MCP clients (like Claude Desktop) discover the data endpoints. |
| **Agent Skills Discovery** | A v0.2.0 protocol where agents fetch `/.well-known/agent-skills/index.json` to find SKILL.md files describing what the site can do. Integrity-checked via SHA-256 digest in the index. |
| **WebMCP** | Browser-side MCP — `navigator.modelContext` tools registered by `public/js/webmcp.js`. Lets in-browser agents call into the page. |
| **Cloudflare Pages Function** | A Cloudflare Worker scoped to a Pages project. Runs on every request as middleware. `functions/_middleware.ts` is one — sets CSP, does content negotiation, overrides Content-Type for the api-catalog. |
| **Workbox** | Google's service worker toolkit. Used here (via `@vite-pwa/astro`) to precache CSS/JS/HTML/images and runtime-cache CloudFront JSON. |
| **PWA manifest** | `public/manifest.webmanifest`. Declares this site as an installable progressive web app. |
| **Triptych grid** | The two-column right-panel layout (Body + Mind). |
| **Glass-morphism** | Visual style: semi-transparent background, 1px translucent border, backdrop blur. Defined by the `--glass-bg`, `--glass-border`, `--blur-md` tokens. |
| **Content-Signal** | IETF-draft header in `robots.txt` declaring AI usage preferences: `search=yes, ai-train=no, ai-input=yes`. |
| **RFC 9727 API catalog** | Standard JSON LinkSet format at `/.well-known/api-catalog` describing available APIs. |
| **`is:inline`** | Astro directive emitting a `<script>` tag verbatim. No transpilation. Must be ES5. |
| **`is:global`** | Astro directive marking a `<style>` block as global (not component-scoped). Required for Design System CSS to cascade correctly. |
| **Skeleton / Empty / Active states** | The three mandatory rendering states for every widget. Skeleton = loading placeholder (default SSR HTML). Empty = data returned zero items. Active = populated. |
| **`.contract-lock.json`** | SHA-256 checksums of all `@lifegames/schemas` files, pinning the schema contract between this consumer and the upstream DS. |
| **`--update-snapshots`** | Playwright flag that regenerates baseline PNGs instead of comparing. Must be run in Docker for CI parity. |

---

## Documentation drift

Catalogued so a junior knows when a doc lies to them:

1. **`AGENTS.md:30-47`** lists `src/components/`, `public/css/tokens.css`, `public/css/base.css`, `src/styles/layout.css`, `public/css/components.css` as key files. **None of these exist** in the working tree (verified against `git ls-files`). They moved to `@lifegames/web` / `@lifegames/tokens` during the yalc migration. The "Key Files" table needs a rewrite.

2. **`README.md:63-79`** "Directory Structure" diagram shows `src/components/`, `public/css/`, `legacy/`, `tests/fixtures/`. None of those are in the current tree. The right tree is in CLAUDE.md.

3. **`scripts/.css-checksums.json`** holds checksums for three paths (`public/css/components.css`, `public/css/effects.css`, `src/styles/layout.css`) that don't exist. The file is orphaned and safe to delete.

4. **`.claude/principles/widget-checks.md`** W1 references `scripts/widget-compliance.mjs` and `PRODUCTION_WIDGETS` registration. That script is **not in this consumer repo** (only `scripts/agent-readiness-check.sh`, etc.). It presumably lives in `@lifegames/web`. The W-checks practically apply upstream; downstream consumers just verify the widgets render.

5. **`CLAUDE.md` "Commands" section** mentions `tests/fixtures/*.json` for CloudFront stubbing. The actual fixture location is `test/fixtures/generated/*/*.json` (singular `test`, generated subdir). The `tests/visual/helpers.ts` route map points there.

7. **`AGENTS.md:21`** says "16 tests across 4 viewports". The actual count is ~176 captures (3 dashboard scenarios + 14 baseline widgets + ~25 variations + 2 overlays, × 4 viewports). Tests are reorganized in `widgets.spec.ts` parts 4a/4b/4c.

When you update one of these, please also update CLAUDE.md to match.

---

## Coverage check (every tracked file accounted for)

Diffed against `git ls-files`. Files explicitly named above OR explicitly grouped:

- All root config files — Section 3.1.
- All `src/` files (6 source files) — Section 3.2.
- All `data/*.json` (7 files) — Section 3.3.
- All `test/fixtures/` files (factories, variations, generate.ts, validate.ts, VALIDATION.md, build-data/, generated/) — Section 3.4. The ~90 individual `test/fixtures/generated/*/*.json` files are intentionally grouped by data type (health, books, sleep, location, github-events, github-starred-repos, articles, focus, theatre-reviews, workouts).
- All `tests/build/` specs (5 `.test.ts` + `setup.ts`) — Section 3.5.
- All `tests/visual/` specs and helpers (`dashboard.spec.ts`, `widgets.spec.ts`, `fixtures.ts`, `global-setup.ts`, `helpers.ts`, `predicates.ts`, `screenshot.css`) — Section 3.5.
- `tests/drift/drift.spec.ts` — Section 3.5.
- `tests/visual/__screenshots__/{viewport}/{spec}/*.png` (~144 baselines across desktop-1400/tablet-1100/tablet-768/mobile-600) — intentionally grouped under "committed PNG baselines" in Section 3.5.
- `tests/drift/__screenshots__/{viewport}/drift.spec.ts/drift-full.png` (4 baselines) — intentionally grouped under "drift baselines" in Section 3.5.
- `test/visual/manual-baselines/{before-cleanup,after-D1}/*.png` (8 files) — Section 3.5 last bullet.
- All `scripts/` (12 entries including `.css-checksums.json`) — Section 3.6.
- All `public/` files: `_routes.json`, `llms.txt`, `robots.txt`, `manifest.webmanifest`, all `.well-known/*` (4 files), all `public/js/*.js` (8 files), all `public/vendor/leaflet/*` (3 files), all `public/fonts/*.woff2` (3 files), all `public/assets/*` (8 files) — Sections 3.7. Image directories `public/images/books/*` (45 files) and `public/images/theatre/*` (28 files) are intentionally grouped under "Cached CloudFront-optimized images".
- `functions/_middleware.ts` — Section 3.8.
- All `.github/` files: `dependabot.yml`, two scripts in `.github/scripts/`, four workflow files in `.github/workflows/` — Section 3.9.
- All `docs/wiki/*.md` (6 files) — Section 3.10.
- All `docs/claude-design/*.md` (4 files: DESIGN, components, interactions, layout), `tokens.json`, `tokens.css` — Section 3.10. Screenshots in `docs/claude-design/screenshots/*.png` (16 PNGs) and fonts in `docs/claude-design/fonts/*.woff2` (2 woff2) are intentionally grouped under "screenshots" and "fonts".
- All `.claude/principles/*.md` and `.claude/skills/*/SKILL.md` — Section 3.11.
- All 20 `previews/*.html` files — Section 3.12, named by group (cs-*, dnd-*, work-*).
- `package-lock.json` — Section 3.1.

No tracked file is unaccounted for.
