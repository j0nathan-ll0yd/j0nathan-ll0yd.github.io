# AGENTS.md -- Human Datastream Portfolio

Personal portfolio at `jonathanlloyd.me`, styled as a sci-fi "Human Datastream" dashboard. Astro 6 static site deployed to Cloudflare Pages. Read-only display surface for personal data (health, activity, GitHub, reading, location). All widgets are imported from `@lifegames/web/production` (the yalc-linked Design System package) -- this repo contains no widget source code.

## Commands

```bash
npm install                       # use --legacy-peer-deps if the peer-dep gate fails
npm run dev                       # localhost:4321
npm run build                     # production build (reads data/*.json)
npm run preview                   # preview the production output
npm run test:build                # Vitest build-output tests (SEO, JSON-LD, images)
npm run test:visual               # Playwright visual regression (4 viewports)
npm run test:visual:docker        # run visual regression in Docker (matches CI)
npm run test:visual:update:docker # regenerate baselines in Docker (the only sanctioned path)
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
├── tests/                        # build (Vitest), visual + drift (Playwright)
├── scripts/                      # fixture validation, image fetch, type gen, CI setup
├── public/                       # assets, images, .well-known, llms.txt, manifest
├── functions/                    # _middleware.ts (Pages Function: security headers)
└── .github/workflows/            # deploy, visual-tests, drift-detection
```

`src/` holds only page/layout/route logic. Widgets, tokens, and runtime scripts all live in the Design System and are consumed via the `@lifegames/*` packages.

## Data Flow

| Context | Source | Mechanism |
|---------|--------|-----------|
| Build-time | `data/*.json` | `loadDashboardData()` in `index.astro` frontmatter |
| Test fixtures | `test/fixtures/build-data/*.json` | Generated + validated against DS schemas |
| Client-side | CloudFront | `@lifegames/web/runtime/live-data.ts` after page load |
| Polling | CloudFront JSON | PollEngine (30s fast, 120s slow), `?_poll=1` bypass |
| WebSocket | API Gateway | Adaptive fallback when WS unavailable |

7 build-time fixtures: profile, health, github, books, reading, system, theatre-reviews-sample. `USE_FIXTURES=true` switches Playwright to `test/fixtures/build-data/*.json` for reproducible snapshots.

## Design System Integration

Production widgets, CSS, and runtime scripts come from `@lifegames/web/production` (yalc-linked from `design-system-Lifegames`).

- Import runtime modules from `@lifegames/web/runtime/*` -- never relative paths like `../lib/` or `../scripts/`.
- CSS flows from `@lifegames/tokens` via `@import`; there are no `public/css/*.css` files. Mark `<style>` blocks that import DS CSS with `is:global`.
- `data/*.json` is Ajv-validated against `@lifegames/schemas` in the prebuild hook (`additionalProperties: false` -- any unmapped field fails the build).

## Conventions

- **No hardcoded values**: all colors, spacing, and typography come from `@lifegames/tokens` `var()` custom properties.
- **No new widgets here**: never create `src/components/*.astro`; widgets belong in the Design System.
- **Inline JS is ES5 only**: in `<script is:inline>` blocks and any `public/js/*.js`, use `var`, `function` declarations, and IIFEs -- no `let`/`const`/arrow functions/template literals. Bundled module scripts may use modern syntax.
- **Formatting**: 2-space indent, UTF-8, LF line endings.

## Do Not

- Use ES6+ syntax in inline scripts.
- Create new `src/components/*.astro` files or hand-edit CSS (everything comes from the DS).
- Import from relative `../lib/` or `../scripts/` paths instead of the `@lifegames/*` namespace.
- Hardcode hex colors or pixel values.
- Bypass prebuild schema validation.
- Regenerate visual baselines outside Docker (host PNGs fail CI).

## Detailed Reference

See `docs/wiki/` for architecture, brand, and LLM-content documentation.
