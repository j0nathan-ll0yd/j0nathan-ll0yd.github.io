# Human Datastream

A personal portfolio dashboard for Jonathan Lloyd, styled as a sci-fi "Human Datastream" -- a read-only display surface for live personal data. Built with [Astro 7](https://astro.build) and deployed to Cloudflare Pages at [jonathanlloyd.me](https://jonathanlloyd.me).

[![Deploy to Cloudflare Pages](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/actions/workflows/deploy.yml)

![Human Datastream dashboard](docs/claude-design/screenshots/dashboard-desktop-1400.png)

## Quick Start

```bash
pnpm install           # packageManager pins the exact pnpm version
pnpm dev               # dev server at http://localhost:4321
pnpm build             # production build into dist/
pnpm preview           # preview the static build artifact
```

All UI widgets are imported from the Design System package (`@j0nathan-ll0yd/web/production`), published to GitHub Packages; this repo contains no widget source. `pnpm install --frozen-lockfile` resolves the `@j0nathan-ll0yd/*` packages from the registry (`@j0nathan-ll0yd:registry=https://npm.pkg.github.com` in `.npmrc`, authenticated by `GITHUB_TOKEN` in CI or a PAT in `~/.npmrc` locally).

## Architecture

Astro creates a deterministic Design System shell from package-owned fixtures. A Cloudflare Pages Function replaces the complete fixture-backed dashboard region with a schema-validated live snapshot before serving the public HTML. JavaScript browsers privately load the canonical Design System fragment and then continue with the existing CloudFront polling and WebSocket runtime.

```
@j0nathan-ll0yd/fixtures ──► Astro static build ──► Pages Function ──► truthful public HTML
                                                        ▲
                                    validated raw JSON  │
                                                        │
                                                  CloudFront
                                                        │
                                      browser polling + WebSocket
```

- **Astro 7 static output** -- deterministic, network-free build input and selective client runtime.
- **Design System** (`@j0nathan-ll0yd/web`, `@j0nathan-ll0yd/tokens`, `@j0nathan-ll0yd/schemas`) -- published from `design-system-Lifegames` to GitHub Packages; source of all widgets, CSS tokens, and fixture schemas.
- **Pages edge composition** -- seven raw exports are independently Ajv-validated against `@j0nathan-ll0yd/portal-contract`; each failed domain renders its DS-owned baseline with explicit `fixture` provenance while valid siblings stay live.
- **CloudFront data layer** -- live data is also fetched after page load; polled (30s fast / 120s slow) with WebSocket fallback.

## Testing

```bash
pnpm test                        # unit + build-output tests
pnpm run test:visual             # Playwright visual regression in Docker (arm64-native, CI-parity)
pnpm run test:visual:update      # regenerate baselines in Docker (only sanctioned path)
```

- **Build tests** ([Vitest](https://vitest.dev)) assert SEO metadata, JSON-LD, and image integrity against `dist/`.
- **Visual regression** ([Playwright](https://playwright.dev)) screenshots the dashboard at 4 viewports. Baselines are byte-stable only when generated inside the CI-matching Linux/AMD64 Docker container -- a runtime guard refuses host-side `--update-snapshots`. Add the `update-snapshots` PR label to regenerate baselines in CI.
- **Production smoke check** runs `pnpm run test:smoke` on a native `ubuntu-latest` runner against the live `jonathanlloyd.me` after each deploy (`.github/workflows/smoke-check.yml`). It asserts the site actually hydrated -- widget containers present, `.is-loading` skeletons cleared, bio terminal typed, service worker registered, no CSP or console errors -- and files a `smoke-failure` issue on regression.

## Data Pipeline

Three data paths feed the dashboard:

- **Build-time** -- `src/lib/load-dashboard-data.ts` returns the DS-owned deterministic shell from `@j0nathan-ll0yd/fixtures` (`getDashboardFixture()`). `import.meta.env.FIXTURE_VARIATION` selects a named test variation; default is `baseline`.
- **Public HTML** -- `functions/index.ts` fetches and validates the approved raw exports at the edge, removes the entire build-time fixture region, and composes semantic HTML with per-domain `live|fixture` source, freshness, and exact live generation time. A source hiccup falls back only that domain to the DS baseline and labels it as a fixture sample. Location is explicitly excluded.
- **Runtime** -- the client polls CloudFront JSON endpoints via `@j0nathan-ll0yd/web/runtime/live-data` for live values once the page loads.

Consumer-side fixtures are forbidden (Invariant I2, enforced by `pnpm run audit:fixtures` in the prebuild gate). Visual tests render reproducible snapshots by intercepting the CloudFront endpoints and serving raw fixtures from `@j0nathan-ll0yd/fixtures/generated/<domain>/<variation>.json`. See [Live HTML Composition](docs/wiki/Live-HTML-Composition.md) for provenance and failure semantics.

## Deploy

Push to `main` triggers GitHub Actions (`.github/workflows/deploy.yml`): `pnpm build` then `cloudflare/wrangler-action@v4` deploys `dist/` and `functions/` to the `human-datastream` Cloudflare Pages project. `wrangler.jsonc` pins the Pages runtime compatibility used locally and in production, including the Node.js compatibility required by the published raw-fixture factories. No manual deploy step.

## Documentation

- [`AGENTS.md`](AGENTS.md) -- canonical agent contract: commands, conventions, and do/don't rules (read this before editing).
- [`CLAUDE.md`](CLAUDE.md) -- Claude Code-specific extras (imports `AGENTS.md`).
- [`docs/wiki/`](docs/wiki/Home.md) -- deeper reference: [Astro Implementation](docs/wiki/Astro-Implementation.md), [Brand Guide](docs/wiki/Brand-Guide.md), [Why Astro](docs/wiki/Why-Astro.md), [LLM Content Spec](docs/wiki/LLM-Content-Spec.md), [Scripts Reference](docs/wiki/Scripts-Reference.md).
- [`docs/visual-regression-testing.md`](docs/visual-regression-testing.md) -- visual-baseline guard rationale.
- `docs/onboarding-review/` -- active architectural plans and roadmap (local working set; see the team thoughts repo).

## Tech Stack

Astro 7, Vitest, Playwright, Ajv, wrangler (Cloudflare Pages), `@vite-pwa/astro`, and `@astrojs/sitemap`. Visual styling, fonts, and interactive widgets are provided by the Design System (`@j0nathan-ll0yd/*`).
