# Human Datastream

A personal portfolio dashboard for Jonathan Lloyd, styled as a sci-fi "Human Datastream" -- a read-only display surface that renders real personal data (health, activity, GitHub, reading, location) as a live, glass-morphism dashboard. Built with [Astro 6](https://astro.build) and deployed to Cloudflare Pages at [jonathanlloyd.me](https://jonathanlloyd.me).

[![Deploy to Cloudflare Pages](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/actions/workflows/deploy.yml)

![Human Datastream dashboard](docs/claude-design/screenshots/dashboard-desktop-1400.png)

## Quick Start

```bash
npm install            # add --legacy-peer-deps if the peer-dep gate fails
npm run dev            # dev server at http://localhost:4321
npm run build          # production build into dist/
npm run preview        # preview the production build
```

All UI widgets are imported from the yalc-linked Design System package (`@lifegames/web/production`); this repo contains no widget source. If `npm install` cannot resolve the `@lifegames/*` packages, link them from `design-system-Lifegames` first (`pnpm yalc:publish` in that repo).

## Architecture

Astro renders static HTML at build time from local JSON fixtures, then hydrates client-side from CloudFront. The Design System owns all widgets, tokens, and runtime scripts; this repo owns only page composition, layout, and the data-loading shell.

```
data/*.json ──► index.astro (build time) ──► static HTML ──► Cloudflare Pages
                                                  │
                                  client hydration │ runtime polling
                                                  ▼
                          CloudFront JSON ──► @lifegames/web/runtime/live-data
```

- **Astro 6 static output** -- 0 KB JS by default; interactivity via selective islands.
- **Design System** (`@lifegames/web`, `@lifegames/tokens`, `@lifegames/schemas`) -- yalc-linked from `design-system-Lifegames`; source of all widgets, CSS tokens, and fixture schemas.
- **CloudFront data layer** -- live data fetched after page load; polled (30s fast / 120s slow) with WebSocket fallback.

## Testing

```bash
npm run test:build               # Vitest build-output tests (SEO, JSON-LD, images)
npm run test:visual              # Playwright visual regression (4 viewports)
npm run test:visual:docker       # run visual regression in Docker (matches CI)
npm run test:visual:update:docker # regenerate baselines in Docker (only sanctioned path)
```

- **Build tests** ([Vitest](https://vitest.dev)) assert SEO metadata, JSON-LD, and image integrity against `dist/`.
- **Visual regression** ([Playwright](https://playwright.dev)) screenshots the dashboard at 4 viewports. Baselines are byte-stable only when generated inside the CI-matching Linux/AMD64 Docker container -- a runtime guard refuses host-side `--update-snapshots`. Add the `update-snapshots` PR label to regenerate baselines in CI.
- **Production smoke check** runs `npm run test:smoke` on a native `ubuntu-latest` runner against the live `jonathanlloyd.me` after each deploy (`.github/workflows/smoke-check.yml`). It asserts the site actually hydrated -- widget containers present, `.is-loading` skeletons cleared, bio terminal typed, service worker registered, no CSP or console errors -- and files a `smoke-failure` issue on regression. No baselines, nothing to regenerate. It replaced the retired pixel-drift suite, which could not stay green against a live data stream and could not catch a blocked-hydration failure.

## Data Pipeline

Two data paths feed the dashboard:

- **Build-time** -- 7 JSON fixtures in `data/` (`profile`, `health`, `github`, `books`, `reading`, `system`, `theatre-reviews-sample`) are loaded by `src/lib/load-dashboard-data.ts`. A prebuild hook runs Ajv validation against `@lifegames/schemas` (`additionalProperties: false` -- any unmapped field fails the build).
- **Runtime** -- the client polls CloudFront JSON endpoints via `@lifegames/web/runtime/live-data` for live values once the page loads.

`USE_FIXTURES=true` swaps `data/*.json` for `test/fixtures/build-data/*.json` so visual tests render reproducible snapshots.

## Deploy

Push to `main` triggers GitHub Actions (`.github/workflows/deploy.yml`): `npm run build` then `cloudflare/wrangler-action@v4` deploys `dist/` to the `human-datastream` Cloudflare Pages project. No manual deploy step.

## Documentation

- [`AGENTS.md`](AGENTS.md) -- canonical agent contract: commands, conventions, and do/don't rules (read this before editing).
- [`CLAUDE.md`](CLAUDE.md) -- Claude Code-specific extras (imports `AGENTS.md`).
- [`docs/wiki/`](docs/wiki/Home.md) -- deeper reference: [Astro Implementation](docs/wiki/Astro-Implementation.md), [Brand Guide](docs/wiki/Brand-Guide.md), [Why Astro](docs/wiki/Why-Astro.md), [LLM Content Spec](docs/wiki/LLM-Content-Spec.md).
- [`docs/visual-regression-testing.md`](docs/visual-regression-testing.md) -- visual-baseline guard rationale.
- `docs/onboarding-review/` -- active architectural plans and roadmap (local working set; see the team thoughts repo).

## Tech Stack

Astro 6, Vitest, Playwright, Ajv, wrangler (Cloudflare Pages), `@vite-pwa/astro`, `@astrojs/sitemap`, and pngjs/pixelmatch for screenshot diffing. Visual styling, fonts, and interactive widgets are provided by the Design System (`@lifegames/*`).
