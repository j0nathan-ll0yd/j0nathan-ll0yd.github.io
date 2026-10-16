# Astro Implementation

Technical overview of the Human Datastream portfolio built with Astro.

## Architecture Overview

The Cloudflare Worker renders `/` on demand per request from the live data plane (atlas decision 0160, PR B). Every other page is prerendered as a static site. The Worker reads the focus signal and the eight CloudFront exports (health, sleep, workouts, books, GitHub events, starred repositories, articles, theatre reviews) through a shared gate, maps them through the Design System's `toDashboardViewModels`, and buffers the HTML under a 3-second ceiling. A completed render answers 200 with an `X-SSR-Data` summary (`live`, `stale`, `partial`, `unavailable` or `suppressed`). A render past the ceiling answers the prerendered data-free page (`dist/client/index.html`) with `X-SSR-Data: fallback`. A render exception answers the prerendered 500 page (`src/pages/500.astro`) with status 500 and `X-SSR-Data: error`.

Every live card carries `data-ssr-state` (`live`, `stale`, `empty`, `unavailable` or `suppressed` on the server render; `loading` on the data-free page) and, in a data state, `data-generated-at`. The client runtime (`src/lib/runtime/live-data.ts`) hydrates after page load, polling CloudFront and repainting only cards with strictly newer `generatedAt` (no repaint for server-rendered content). The data-free fallback ensures every page is accessible and degraded gracefully under the D2 budget.

## Build System

### Configuration

- **`astro.config.mjs`** -- Defines `site` URL, `static` output mode, `@vite-pwa/astro` integration, and `showcase-dev-only` integration for dev-only component showcase routes
- **`tsconfig.json`** -- Extends `astro/tsconfigs/strict`
- **`package.json`** -- Two scripts: `dev` (Astro dev server) and `build` (static assets to `dist/client/`, the Worker to `dist/server/`)

### GitHub Actions Deployment

`.github/workflows/deploy.yml` builds with `pnpm run build` and deploys the `human-datastream` Cloudflare Worker with `pnpm exec wrangler deploy` on every push to `main`.

## Data Flow

### Request-Time Render (GET `/`)

The Worker renders `/` per request from the live data plane (atlas decision 0160, PR B; spec `openspec/specs/dashboard-ssr`). `src/pages/ssr-dashboard.astro` (private, on-demand, prerender disabled) awaits the eight CloudFront exports through the shared gate (`src/lib/data-plane/loader.ts`, `admission.ts`): a focus signal (1 s timeout), then eight no-store reads (2 s each, 2.5 s total I/O budget, no retry, any 403 suppression body suppresses all). It maps the loads through the Design System's `toDashboardViewModels` and renders `src/layouts/DashboardHome.astro`, which both renders share with the prerendered fallback.

Each card renders with `data-ssr-state` (live, stale, unavailable, suppressed, or empty) and, in a data state, `data-generated-at` from the export's `generatedAt`. The summary of the ten card states becomes the `X-SSR-Data` response header (`X-SSR-Data: live|stale|partial|suppressed|unavailable`) and a `<meta name="ssr-data">` tag. The Worker buffers the document, so a render exception always answers the prerendered 500 page with status 500 and `X-SSR-Data: error`; a render past 3 seconds answers the data-free page with `X-SSR-Data: fallback`. The response carries `Cache-Control: no-cache` and no CDN storage (D3). `HEAD /` reads no data and answers from the prerendered fallback.

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

The "Props on `/`" columns below name the data-free page (`src/pages/index.astro`). On the server render (`src/pages/ssr-dashboard.astro`) each live widget takes its view model from `toDashboardViewModels` instead: its data props plus `state` and `generatedAt` (`src/layouts/DashboardHome.astro`), and System Status takes rows from `composeSystemLines`.

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

## Component Showcase (Dev Only)

A visual storyboard at `/showcase/` for iterating on components during development. Only available via `pnpm run dev` -- excluded from production builds via a local Astro integration that conditionally injects routes when `command === 'dev'`.

Showcase pages live in `src/showcase/` (not `src/pages/`) and import the real `.astro` components, rendering them with both empty and active state data side-by-side. Empty state data comes from `data/showcase-empty.json`.

| Route                   | Content                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `/showcase`             | Landing page linking to each panel                                    |
| `/showcase/brand-guide` | Design tokens, typography, glass-morphism, animations                 |
| `/showcase/left-panel`  | IdentityCard, BioTerminal, SystemStatus                               |
| `/showcase/top-bar`     | Command bar                                                           |
| `/showcase/body-column` | HeartRate, DailyActivity, Workouts, NightSummary, Hydration, Location |
| `/showcase/mind-column` | GitHubHeatmap, RecentCommits, ReadingFeed, Bookshelf                  |

## Layout

### Dashboard Layout

`src/layouts/Dashboard.astro` provides the HTML shell:

- **Head**: charset, viewport, theme-color, description, canonical URL, favicon, PWA manifest
- **SEO**: OpenGraph tags, Twitter Card tags, JSON-LD Person schema
- **Fonts**: Space Grotesk via Google Fonts (preconnect + stylesheet)
- **CSS**: 5 stylesheets loaded from `/css/` (tokens, base, layout, components, effects)
- **Body**: Skip link, `<slot />` for page content, CDN scripts (Three.js, Leaflet), service worker registration, Simple Analytics
- **Accessibility**: `<a href="#main-content" class="skip-link">Skip to main content</a>`

### Showcase Layout

`src/layouts/Showcase.astro` provides a minimal shell for component showcase pages:

- **Head**: charset, viewport, favicon, Space Grotesk font, CSS (tokens, base, components, effects, showcase), named `head` slot for page-specific resources
- **Nav**: Sticky navigation bar with links to Brand Guide, Component Library, and Dashboard; active link highlighting via `Astro.url.pathname`
- **Body**: `library-page` class enables scrolling (overrides dashboard's fixed layout)

## SEO & Metadata

- **OpenGraph**: title, description, type, URL, image, site_name
- **Twitter Cards**: summary card with title, description, image
- **JSON-LD**: `@type: Person` with name, jobTitle, URL, sameAs (LinkedIn, GitHub), description
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
- **Keyboard navigation**: Book modal traps focus, cycles Tab through interactive elements, Escape to close
- **Reduced motion**: Particles check `prefers-reduced-motion: reduce` and render a single static frame
- **Live regions**: Clock uses `aria-live="off"` (decorative, not announced)

## Analytics

[Simple Analytics](https://simpleanalytics.com) -- privacy-focused, no cookies, no personal data collection. Loaded as an async script in Dashboard.astro with a `<noscript>` fallback pixel.

## Client-Side JavaScript

All client JS uses **ES5 conventions** (IIFE wrappers, `var`, `function` declarations) and is embedded in `index.astro` as `<script is:inline>` blocks. These scripts are not processed by Vite -- they run directly in the browser.

### Scripts

| Script                | Purpose                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Three.js particles    | 180 particles on desktop, 60 on mobile. Shader-based points with connecting lines. Respects `prefers-reduced-motion`.      |
| Live clock            | Updates `#liveClock` element every second with `HH:MM:SS` format.                                                          |
| Staggered card reveal | Sequentially adds `.visible` class to identity card, bio, system status, then triptych cards with column/row-based delays. |
| Terminal typing       | Types commands character-by-character, reveals output lines with delays. Triggered after card reveal.                      |
| Hydration wave        | CSS wave animation with count-up from 0 to target value.                                                                   |
| Leaflet map           | CartoDB Dark Matter tiles, pulse marker at configured coordinates, no pan/zoom interactions.                               |
| Workout toggle        | Switches between live and sample workout data sets.                                                                        |
| Book modal            | Opens on book click, traps focus within modal, Tab cycles through interactive elements, Escape closes.                     |

## Responsive Design

Four breakpoints defined in `public/css/layout.css`:

| Breakpoint | Behavior                                                       |
| ---------- | -------------------------------------------------------------- |
| `1400px`   | Adjusts panel proportions                                      |
| `1100px`   | Further layout adjustments                                     |
| `900px`    | Stacks to single column (left panel on top, right panel below) |
| `600px`    | Mobile optimizations (smaller fonts, reduced spacing)          |
