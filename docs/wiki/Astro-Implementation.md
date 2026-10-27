# Astro Implementation

Technical overview of the Human Datastream portfolio built with Astro.

## Architecture Overview

A Cloudflare Worker serves the site (atlas decision 0160). Every page except `/` is prerendered as a static file. For `GET /`, the Worker renders nothing: it reads page data the backend composed ahead of time and splices it into the prerendered data-free page (`dist/client/index.html`). With the `PAGE` Workers KV binding, it reads the published `focus` and `fragments:<build>` values (`readPublished()`, `src/lib/composed/published.ts`; atlas decision 0164). Without the binding, it reads the `/dashboard.json` artifact from CloudFront (`readComposed()`, `src/lib/composed/read.ts`). The answer carries an `X-SSR-Data` summary (`live`, `stale`, `partial`, `unavailable`, `suppressed` or `fallback`). A miss or a read past the 3-second ceiling answers the data-free page as `fallback`. An exception answers the prerendered 500 page (`src/pages/500.astro`) with status 500 and `X-SSR-Data: error`.

Every live card carries `data-ssr-state` (`live`, `stale`, `empty`, `unavailable` or `suppressed` in a composed page; `loading` on the data-free page) and, in a data state, `data-generated-at`. The client runtime (`src/lib/runtime/live-data.ts`) starts after page load, polls CloudFront, and repaints a card only from a strictly newer `generatedAt`.

## Build System

### Configuration

- **`astro.config.mjs`** -- Defines the `site` URL, `output: 'static'` with the `@astrojs/cloudflare` adapter (on-demand routes set `prerender = false`), `build.format: 'file'`, the sitemap and `@vite-pwa/astro` integrations, and the `forbid-fixtures` Vite plugin
- **`tsconfig.json`** -- Extends `astro/tsconfigs/strict` and `@j0nathan-ll0yd/config/tsconfig-base.json`
- **`package.json`** -- `pnpm build` runs `scripts/build-site.mjs` (two `astro build` runs around the build-time shell cut), with `prebuild` and `postbuild` gates. Static assets go to `dist/client/`, the Worker to `dist/server/`. `docs/wiki/Scripts-Reference.md` lists every script

### GitHub Actions Deployment

`.github/workflows/deploy.yml` builds with `pnpm run build` and deploys the `human-datastream` Cloudflare Worker with `pnpm exec wrangler deploy` on every push to `main`.

## Data Flow

### Precomposed Dashboard (GET `/`)

`/` is precomposed as the data changes, like llms.txt, and the live site supplies the composer (atlas decision 0160, PR B; owner decisions 2026-10-16; spec `openspec/specs/dashboard-ssr`). Each build ships `src/lib/composed/compose.ts`, built by `scripts/build-composer.mjs` with this site's compile settings so its scoped-style hashes equal the site's, as a public static asset at `/_ssr/composer-<build>.mjs`; `/version.json` names it with its sha256. A backend runner (mantle-LifegamesPortal) fetches the composer, checks the hash and calls `composeDashboard`, which reads the focus signal and the eight exports through the public gated CloudFront URLs (`src/lib/data-plane/loader.ts`), maps them through the Design System's view models (`src/lib/data-plane/render-model.ts`), renders the ten live cards, the two focus overlays and System Status with the Astro Container API, and returns the `/dashboard.json` artifact. It publishes nothing while the focus value hides, cannot be read, or changes during the render, or while the gate is shut.

The Worker renders nothing. With the `PAGE` binding, `readPublished()` (`src/lib/composed/published.ts`) reads the backend's published `focus` and `fragments:<build>` Workers KV values and judges `focus` first (atlas decision 0164). Without the binding, `readComposed()` (`src/lib/composed/read.ts`) reads the `/dashboard.json` artifact with `readGatedConcurrently` (`src/lib/edge/proxy.ts`): the focus probe and the artifact fetch run together inside one budget, the focus value decides first, and no last-known-good copy is kept. `checkArtifact()` (`src/lib/composed/artifact.ts`) refuses a stale (older than `COMPOSED_MAX_AGE_MS`), future, wrong-schema or hiding artifact, and any artifact another build's composer made. The Worker splices the fragments into the prerendered data-free page, cut once per isolate (`src/lib/composed/shell.ts`), and refuses a fragment whose scoped-style hash the page does not carry.

Each card carries `data-ssr-state` (live, stale, unavailable, suppressed, or empty) and, in a data state, `data-generated-at`. The artifact's summary becomes the `X-SSR-Data` header and a `<meta name="ssr-data">` tag. A hiding focus value, the gate shut over a visible one, or an unreadable focus answers a value-free page the website build composes (`dist/client/_ssr/value-free.json`, `src/lib/composed/value-free.ts`): the matching overlay, every card `suppressed` or `unavailable`, and no export value. Any other miss answers the data-free page as `fallback`, as does a request past the 3-second ceiling. An exception answers the prerendered 500 page with `X-SSR-Data: error`. The composed page carries `Cache-Control: no-store`; the data-free and value-free pages carry `no-cache`. No answer is stored at the CDN (D3). `HEAD /` reads no data and answers from the data-free page.

### Prerendered Fallback (`dist/client/index.html`)

`src/pages/index.astro` (build-time prerendered, atlas decision 0160, PR 0a; spec `openspec/specs/dashboard-shell`) reads no data, network or fixture. `loadDashboardData()` in `src/lib/load-dashboard-data.ts` returns:

| Field         | Source                                                                                                                    | Consumers                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `profile`     | `@j0nathan-ll0yd/copy`: `identity.person` (name, job title, bio, `sameAs` links) and `profile` (tagline, terminal blocks) | IdentityCard, BioTerminal |
| `system`      | One row per source with the no-reading mark and no status, age or timestamp                                               | SystemStatus              |
| `localCovers` | The committed cover mirror under `public/images/books/`                                                                   | Bookshelf                 |

Every live widget renders `state="loading"`: its skeleton, `data-ssr-state="loading"` and a `<noscript>` note that live data needs JavaScript. With JavaScript off, a visitor sees the identity content and honest loading cards, never a fabricated value. This page is the D2 budget fallback, the `HEAD /` answer and the D9 rollback target for every later 0160 change.

### Client Hydration

The client runtime (`src/lib/runtime/live-data.ts`) hydrates after page load, polling the CloudFront exports. The client runtime fills each card through the design-system updaters (`@j0nathan-ll0yd/web` 4.1), with the export's freshness: `live` up to its registry `audit.warn` age, `stale` beyond it with an absolute "as of" time (`exportFreshness`). A failed first read renders each card that export feeds `unavailable` (`renderWidgetUnavailable`); Night Summary follows the sleep export alone. The client repaints a card only from a strictly newer `generatedAt`, never repainting server-rendered content. Hydration draws Hydration card target bands in the browser, and a cover mirrored under `public/images/books/` (listed by its versioned contract path) loads from the same origin.

`@j0nathan-ll0yd/fixtures` is a devDependency for tests only. The `forbid-fixtures` Vite plugin (`scripts/vite-forbid-fixtures.mjs`, registered in `astro.config.mjs`) fails the build when any module resolves to it, directly or through another module or package.

## Component Catalog

Every widget comes from `@j0nathan-ll0yd/web/production`; this repo has no `src/components/`. Live widgets take an optional `state` and `generatedAt` (`@j0nathan-ll0yd/web` 4); every browser updater takes an optional trailing freshness (4.1).

The "Props on `/`" columns below name the data-free page (`src/pages/index.astro`). In the composed artifact (`src/lib/composed/compose.ts`) each live widget takes its view model from `toDashboardViewModels` instead: its data props plus `state` and `generatedAt`, and System Status takes rows from `composeSystemLines`.

### Left Panel

| Component      | Props on `/`               | Description                                     |
| -------------- | -------------------------- | ----------------------------------------------- |
| `IdentityCard` | `profile` (from copy)      | Avatar, name, title, bio, tagline, social links |
| `BioTerminal`  | `profile` (from copy)      | Faux terminal with typing animation             |
| `SystemStatus` | `system` (no-reading rows) | Per-source status, filled by the client         |

### Body Column

| Component       | Props on `/`      | Description                                  |
| --------------- | ----------------- | -------------------------------------------- |
| `HeartRate`     | `state="loading"` | ECG animation, BPM display, heart-rate zones |
| `Workouts`      | `state="loading"` | Workout sessions, or the recovery-day state  |
| `MovementRings` | `state="loading"` | Move, exercise, stand and daylight rings     |
| `Hydration`     | `state="loading"` | Water and caffeine vessels                   |
| `NightSummary`  | `state="loading"` | Sleep duration, phases and score             |

### Mind Column

| Component         | Props on `/`                     | Description                                    |
| ----------------- | -------------------------------- | ---------------------------------------------- |
| `DevActivityLog`  | `state="loading"`                | GitHub activity log                            |
| `ReadingFeed`     | `state="loading"`                | Saved articles with source and date            |
| `StarredRepoList` | `state="loading"`                | Recently starred repositories                  |
| `Bookshelf`       | `state="loading"`, `localCovers` | Book covers; a click opens BookModal           |
| `TheatreReviews`  | `state="loading"`                | Theatre review cards                           |
| `BookModal`       | (none)                           | Native dialog with the selected book's details |

## Layout

### Dashboard Layout

`src/layouts/Dashboard.astro` provides the HTML shell for every page. `src/layouts/DashboardHome.astro` adds the dashboard body that both renders of `/` share.

- **Head**: charset, viewport, theme-color, description, canonical URL, favicon, PWA manifest, `rel` discovery links (LLM content, sitemap, feeds, humans.txt, privacy policy)
- **SEO**: OpenGraph tags, Twitter Card tags, one JSON-LD graph
- **Fonts**: Space Grotesk, self-hosted under `/fonts/` (`@j0nathan-ll0yd/tokens/fonts`), with a preload for the Latin subset
- **CSS**: no stylesheet files. A processed `<style is:global>` block imports `@j0nathan-ll0yd/tokens` and `@j0nathan-ll0yd/web` styles, and Astro inlines them at build time
- **Body**: skip link, `<slot />` for page content, the external scripts under `public/js/` (see Client-Side JavaScript), service worker registration, first-party analytics
- **Accessibility**: `<a href="#main-content" class="lg-skip-link">`, its text from `@j0nathan-ll0yd/copy` (`identity.a11y.skipToMain`)

`src/layouts/InfoPage.astro` wraps the text pages (`/about`, `/contact`, `/developers`, `/privacy`).

## SEO & Metadata

- **OpenGraph**: title, description, type, URL, image, site_name
- **Twitter Cards**: `summary_large_image` card with title, description, image and image alt text
- **JSON-LD**: one `@graph` on `/` with `Organization`, `WebSite`, `ProfilePage`, `Person` and `Dataset` nodes
- **Canonical URL**: Derived from `Astro.site` and `Astro.url.pathname`, with the build-time `.html` / `/index.html` suffix stripped. Pages build as files (`build.format: 'file'`, `trailingSlash: 'never'`), so every canonical, sitemap and internal URL answers 200 at its extensionless path with no redirect. `tests/build/canonical-urls.test.ts` enforces this.

## Progressive Web App

Configured via `@vite-pwa/astro` in `astro.config.mjs`:

- **Register type**: `autoUpdate` (service worker updates automatically)
- **Manifest**: App name, description, theme/background colors, display standalone
- **Icons**: 192x192 and 512x512 PNG icons in `/assets/`
- **Precache**: static assets `*.{css,js,svg,png,ico,txt,webmanifest,woff2}` plus ONE HTML document, the data-free `/offline` page (`src/pages/offline.astro`, built as `dist/client/offline.html`; `@vite-pwa/astro` rewrites the entry to the URL `offline`, which the host answers with a 200). No other HTML document is precached (atlas decision 0160, PR 0b).
- **Navigations**: NetworkOnly. A navigation always reaches the network and is never stored. When the network fails, the worker answers with the precached `/offline` page (Workbox `precacheFallback`), which holds no gated value, no fixture value and no live widget. `navigateFallback` stays `null`.
- **Gated data**: no runtime route caches the focus signal, a CloudFront JSON export or a site-origin proxy route. `scripts/check-sw-precache.mjs` enforces every rule above on each build; the behavior is specified in `openspec/specs/client-privacy/spec.md`.
- **Service worker**: Registered by `public/js/sw-register.js`, which Dashboard.astro loads

## Accessibility (WCAG 2.2 AA)

- **Skip link**: "Skip to main content" hidden link, visible on focus
- **ARIA labels**: `aria-label` on landmark regions (Profile aside, Body/Mind sections)
- **Semantic HTML**: `<aside>`, `<header>`, `<main>`, `<section>` for landmarks
- **Keyboard navigation**: Book modal is a native `<dialog>` opened as a modal (`@j0nathan-ll0yd/web` `BookModal`); the browser keeps focus inside it, and Escape closes it
- **Reduced motion**: under `prefers-reduced-motion: reduce`, the particle background does not start
- **Live regions**: Clock uses `aria-live="off"` (decorative, not announced)

## Analytics

[Simple Analytics](https://simpleanalytics.com) -- privacy-focused, no cookies, no personal data collection. It is served first-party: `public/js/sa-loader.js` loads `/sa` (`src/pages/sa.ts`), and events go to `/simple/*` (`src/pages/simple/[...path].ts`). A `<noscript>` pixel (`/simple/noscript.gif`) covers visitors without JavaScript. Cloudflare Web Analytics is also first-party: `/cf-insights.js` and `/cf-rum`. All of them load only in production builds and never on the data-free page.

## Client-Side JavaScript

Two kinds of client script run on the dashboard:

- **External page scripts** in `public/js/`, loaded with `<script is:inline src=...>`. The CSP (`script-src 'self'`) forbids inline script bodies. Vite does not process these files, so their syntax floor is ES2017, enforced by `pnpm run lint` (`eslint.config.mjs`).
- **Bundled module scripts** that Vite processes: the client runtime (`src/lib/runtime/live-data.ts`), the input-modality and particle background (`@j0nathan-ll0yd/web/runtime/*`), and the widget init scripts that the design-system islands and production components carry.

### Scripts

| Script                | Source                                                          | Purpose                                                                                                                                       |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Particle background   | `@j0nathan-ll0yd/web/runtime/particles`; `src/lib/mobile-bg.ts` | 2D canvas network: 180 particles on desktop, 60 on mobile. Touch devices get an SVG variant (`?bg=off`, `?bg=canvas`, `?bg=lite` override it). |
| Live clock            | `public/js/clock.js`                                            | Updates `#liveClock` every second.                                                                                                            |
| Staggered card reveal | `public/js/card-reveal.js`                                      | Adds `.visible` to the identity card, bio, system status, then the triptych cards with column/row-based delays.                               |
| Terminal typing       | `@j0nathan-ll0yd/web` `BioTerminal`                             | Types the terminal commands and reveals the output lines.                                                                                     |
| Hydration             | `@j0nathan-ll0yd/web` `Hydration`                               | Draws the water and caffeine vessels and their target bands.                                                                                  |
| Book modal            | `@j0nathan-ll0yd/web` `BookModal`                               | Opens the native `<dialog>` on a book click; Escape closes it.                                                                                |
| Live data             | `src/lib/runtime/live-data.ts`                                  | Polls CloudFront and fills each card through the design-system updaters.                                                                      |

## Responsive Design

The breakpoints live in the design system, in `@j0nathan-ll0yd/web/styles/layout.css`, which `Dashboard.astro` imports. `@j0nathan-ll0yd/web` 4.5.3 defines `max-width: 374px`, `max-width: 600px`, `600px` to `767px`, `max-width: 767px`, `768px` to `1100px`, `min-width: 1920px` and `min-width: 2560px`. At `1100px` and below, the tablet block stacks the layout vertically, and the page scrolls (`Dashboard.astro` locks viewport scroll only above `1100px`).
