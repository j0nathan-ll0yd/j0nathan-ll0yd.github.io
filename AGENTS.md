# AGENTS.md -- Human Datastream Portfolio

Personal portfolio at `jonathanlloyd.me`, styled as a sci-fi "Human Datastream" dashboard. Astro 6 static site deployed to Cloudflare Pages. Read-only display surface for personal data (health, activity, GitHub, reading, location). All widgets are imported from `@lifegames/web/production` (the yalc-linked Design System package) -- this repo contains no widget source code.

## Commands

```bash
npm install                       # use --legacy-peer-deps if the peer-dep gate fails
npm run dev                       # localhost:4321
npm run build                     # production build (reads data/*.json)
npm run preview                   # preview the production output
npm run test:build                # Vitest build-output tests (SEO, JSON-LD, images)
npm run test:visual               # Playwright visual regression in Docker (arm64-native, CI-parity)
npm run test:visual:update        # regenerate baselines in Docker (the only sanctioned path)
npm run validate:build-fixtures   # Ajv validation of data/*.json against DS schemas
npm run generate:fixtures         # regenerate test/fixtures/build-data/*.json
npm run fetch:images              # download images from CloudFront to public/images/
```

Deploy: push to `main` -> GitHub Actions (`deploy.yml`) -> `npm run build` -> `cloudflare/wrangler-action@v4` -> Cloudflare Pages.

## Repository Structure

```
.
├── astro.config.mjs              # Astro 6, PWA, sitemap
├── src/
│   ├── pages/                    # index.astro (loads data, composes DS widgets), 404.astro
│   ├── layouts/                  # Dashboard.astro (head, SEO meta, JSON-LD, DS CSS)
│   └── lib/                      # load-dashboard-data.ts (7 build-time fixtures)
├── data/                         # 7 build-time JSON fixtures
├── test/fixtures/                # build-fixture generation + generated build-data/
├── tests/                        # build (Vitest), visual + smoke (Playwright)
├── scripts/                      # fixture validation, image fetch, type gen, CI setup
├── public/                       # assets, images, .well-known, manifest
├── functions/                    # _middleware.ts (security headers) + llms.txt.ts (CloudFront proxy)
└── .github/workflows/            # deploy, visual-tests, smoke-check
```

`src/` holds only page/layout/route logic. Widgets, tokens, and runtime scripts all live in the Design System and are consumed via the `@lifegames/*` packages.

## Data Flow

| Context | Source | Mechanism |
|---------|--------|-----------|
| Build-time | `@lifegames/fixtures` (`getDashboardFixture()`) | `loadDashboardData()` in `index.astro` frontmatter |
| Visual fixtures | `@lifegames/fixtures/generated/<domain>/<variation>.json` | Playwright CloudFront route interception (`tests/visual/fixtures.ts`) |
| Client-side | CloudFront | `@lifegames/web/runtime/live-data.ts` after page load |
| Polling | CloudFront JSON | PollEngine (30s fast, 120s slow), `?_poll=1` bypass |
| WebSocket | API Gateway | Adaptive fallback when WS unavailable |

Fixtures are DS-owned (Plan #04): the SSR shell comes from `@lifegames/fixtures` (post-adapter `baseline` by default; `import.meta.env.FIXTURE_VARIATION` selects a named variation, wired in `astro.config.mjs`). This repo hand-bakes no fixtures -- consumer-side fixtures are forbidden by Invariant I2 (`npm run audit:fixtures`, a prebuild gate). Visual tests serve raw fixtures from `@lifegames/fixtures/generated/` via CloudFront route interception.

## Design System Integration

Production widgets, CSS, and runtime scripts come from `@lifegames/web/production` (yalc-linked from `design-system-Lifegames`).

- Import runtime modules from `@lifegames/web/runtime/*` -- never relative paths like `../lib/` or `../scripts/`.
- CSS flows from `@lifegames/tokens` via `@import`; there are no `public/css/*.css` files. Mark `<style>` blocks that import DS CSS with `is:global`.
- `data/*.json` is Ajv-validated against `@lifegames/schemas` in the prebuild hook (`additionalProperties: false` -- any unmapped field fails the build).
- **Customer-facing identity strings** come from `@lifegames/copy` (single source of truth; zero duplication). The Astro Content Collection `copy` (`src/content.config.ts`) loads `@lifegames/copy/identity.flat.json`, validated by the generated flat Zod (`@lifegames/copy/identity.zod`); `Dashboard.astro` reads `getEntry('copy','identity').data`; `astro.config.mjs` imports the flat JSON for the PWA manifest. Never hardcode bios, names, titles, expertise, or skip/OG-image text -- add or edit them in `design-system-Lifegames/packages/copy/src/identity.en-US.json` (ICU MF1), then `pnpm yalc:publish` from the DS. Spec: `docs/wiki/Copy-Package-Spec.md`.

## Conventions

- **No hardcoded values**: all colors, spacing, and typography come from `@lifegames/tokens` `var()` custom properties.
- **No new widgets here**: never create `src/components/*.astro`; widgets belong in the Design System.
- **Inline JS is ES5 only**: in `<script is:inline>` blocks and any `public/js/*.js`, use `var`, `function` declarations, and IIFEs -- no `let`/`const`/arrow functions/template literals. Bundled module scripts may use modern syntax.
- **Externalize inline scripts**: all inline scripts live in `public/js/` for CSP compliance (10 total: `card-reveal`, `clock`, `leaflet-lazy`, `sa-loader`, `sa-stub`, `scroll-depth`, `sw-register`, `webmcp`, `book-modal`, `social-click-track`). CSP is `script-src 'self'` -- no `'unsafe-inline'`.
- **No inline `on*=` handlers**: markup event attributes are CSP-rejected without `'unsafe-hashes'`; attach listeners in `public/js/*.js` instead.
- **Inline-script gate**: `npm run audit:inline-scripts` runs as a prebuild gate. Any unavoidable inline JS requires a documented exception.
- **Contract-lock is generated, never hand-edited**: `.contract-lock.json` freshness is enforced by a Husky pre-commit hook + a `contract-check` CI job (both run `npm run check:contract-lock`). Regenerate with `node scripts/generate-contract-lock.mjs && git add .contract-lock.json`.
- **Formatting**: 2-space indent, UTF-8, LF line endings.

## Testing

- **Visual baselines:** regenerate only in Docker (`npm run test:visual:update`); host-rendered PNGs fail CI.
- **Canvas widgets use a deterministic test seam, not hidden pixels:** rAF + RNG defeats Playwright's `animations: 'disabled'`, but never hide a canvas via `visibility: hidden` in `screenshot.css` -- that masks regressions. Each canvas widget exposes a `window.__<widget>` seam (defined in its DS runtime init, e.g. `@lifegames/web/runtime/heart-rate-init`) with `ready`, `seed(n)`, `freezeAt(ms|null)`, `step(frames)`, and `state()`. The seam is gated by BOTH `import.meta.env.MODE === 'test'` AND a `data-test="1"` ancestor, so it is `undefined` (dead-code-eliminated) in production. Reference: `#hrEcgCanvas` / `window.__hrEcg` (`tests/visual/heart-rate.spec.ts`). Seam-driven screenshots need a `--mode test` visual build.
- **Production smoke check (replaces the retired pixel-drift suite):** `tests/smoke/home.smoke.ts` (config `playwright.smoke.config.ts`, helpers `tests/smoke/fixtures.ts`) asserts the live site at `https://jonathanlloyd.me` actually hydrated -- HTTP 200, all widget containers present, `.is-loading` skeletons cleared, the bio terminal typed its content (the #50 CSP-blocked-hydration regression guard), the service worker registered, and no external-script CSP violation / chunk-load failure / unexpected console error. Runs natively on `ubuntu-latest` (no Docker, no pixel baselines) via `.github/workflows/smoke-check.yml` on `workflow_run` after `deploy.yml`; it is post-deploy and non-blocking (files a `smoke-failure` issue rather than blocking the deploy). Run locally with `npm run test:smoke`. The retired drift suite could not stay green against a live data stream and could not catch a blocked-hydration failure (the SSR shell renders at the correct pixels even when hydration is dead).

## Do Not

- Use ES6+ syntax in inline scripts.
- Create new `src/components/*.astro` files or hand-edit CSS (everything comes from the DS).
- Import from relative `../lib/` or `../scripts/` paths instead of the `@lifegames/*` namespace.
- Hardcode hex colors or pixel values.
- Bypass prebuild schema validation.
- Hand-edit `.contract-lock.json` (Husky + CI enforce it; regenerate via `scripts/generate-contract-lock.mjs`).
- Regenerate visual baselines outside Docker (`npm run test:visual:update` is the only sanctioned path; host PNGs fail CI).

## Detailed Reference

See `docs/wiki/` for architecture, brand, and LLM-content documentation.
