# AGENTS.md -- Human Datastream Portfolio

Personal portfolio at `jonathanlloyd.me`, styled as a sci-fi "Human Datastream" dashboard. Astro 7 static site (Vite 8 / Rust compiler) deployed to Cloudflare Pages. Read-only display surface for personal data (health, activity, GitHub, reading, location). All widgets are imported from `@j0nathan-ll0yd/web/production` (the Design System package, consumed from GitHub Packages) -- this repo contains no widget source code.

## Commands

```bash
pnpm install                      # exact pnpm version comes from packageManager (corepack)
pnpm dev                          # localhost:4321
pnpm build                        # production build (reads data/*.json)
pnpm preview                      # preview the production output
pnpm run test:build               # Vitest build-output tests (SEO, JSON-LD, images)
pnpm run test:visual              # Playwright visual regression in Docker (arm64-native, CI-parity)
pnpm run test:visual:update       # regenerate baselines in Docker (the only sanctioned path)
pnpm run validate:build-fixtures  # Ajv validation of data/*.json against DS schemas
pnpm run generate:fixtures        # regenerate test/fixtures/build-data/*.json
pnpm run fetch:images             # download images from CloudFront to public/images/
```

Deploy: push to `main` -> GitHub Actions (`deploy.yml`) -> `pnpm build` -> `cloudflare/wrangler-action@v4` -> Cloudflare Pages.

## Repository Structure

```text
.
├── astro.config.mjs              # Astro 7, PWA, sitemap (enriched)
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

`src/` holds only page/layout/route logic. Widgets, tokens, and runtime scripts all live in the Design System and are consumed via the `@j0nathan-ll0yd/*` packages.

## Data Flow

| Context         | Source                                                         | Mechanism                                                             |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| Build-time      | `@j0nathan-ll0yd/fixtures` (`getDashboardFixture()`)           | `loadDashboardData()` in `index.astro` frontmatter                    |
| Visual fixtures | `@j0nathan-ll0yd/fixtures/generated/<domain>/<variation>.json` | Playwright CloudFront route interception (`tests/visual/fixtures.ts`) |
| Client-side     | CloudFront                                                     | `@j0nathan-ll0yd/web/runtime/live-data.ts` after page load            |
| Polling         | CloudFront JSON                                                | PollEngine (30s fast, 120s slow), `?_poll=1` bypass                   |
| WebSocket       | API Gateway                                                    | Adaptive fallback when WS unavailable                                 |

Fixtures are DS-owned (Plan #04): the SSR shell comes from `@j0nathan-ll0yd/fixtures` (post-adapter `baseline` by default; `import.meta.env.FIXTURE_VARIATION` selects a named variation, wired in `astro.config.mjs`). This repo hand-bakes no fixtures -- consumer-side fixtures are forbidden by Invariant I2 (`pnpm run audit:fixtures`, a prebuild gate). Visual tests serve raw fixtures from `@j0nathan-ll0yd/fixtures/generated/` via CloudFront route interception.

## Design System Integration

Production widgets, CSS, and runtime scripts come from `@j0nathan-ll0yd/web/production` (published from `design-system-Lifegames` to GitHub Packages).

- Import runtime modules from `@j0nathan-ll0yd/web/runtime/*` -- never relative paths like `../lib/` or `../scripts/`.
- CSS flows from `@j0nathan-ll0yd/tokens` via `@import`; there are no `public/css/*.css` files. Mark `<style>` blocks that import DS CSS with `is:global`.
- `data/*.json` is Ajv-validated against `@j0nathan-ll0yd/schemas` in the prebuild hook (`additionalProperties: false` -- any unmapped field fails the build).
- **Customer-facing identity strings** come from `@j0nathan-ll0yd/copy` (single source of truth; zero duplication). The Astro Content Collection `copy` (`src/content.config.ts`) loads `@j0nathan-ll0yd/copy/identity.flat.json`, validated by the generated flat Zod (`@j0nathan-ll0yd/copy/identity.zod`); `Dashboard.astro` reads `getEntry('copy','identity').data`; `astro.config.mjs` imports the flat JSON for the PWA manifest. Never hardcode bios, names, titles, expertise, or skip/OG-image text -- add or edit them in `design-system-Lifegames/packages/copy/src/identity.en-US.json` (ICU MF1), then publish a new `@j0nathan-ll0yd/copy` version from the DS. Spec: `docs/wiki/Copy-Package-Spec.md`.

## Conventions

- **No hardcoded values**: all colors, spacing, and typography come from `@j0nathan-ll0yd/tokens` `var()` custom properties.
- **No new widgets here**: never create `src/components/*.astro`; widgets belong in the Design System.
- **Raw scripts are ES2017 (SYNTAX rule)**: `<script is:inline>` bodies and any `public/js/*.js` are served raw (never transpiled by Vite), so their syntax floor is **ES2017** -- `const`/`let`, arrow functions, template literals, and `async`/`await` are all allowed. The site's real browser floor (service workers, PWA, canvas islands) is well above ES5, and async/await has had universal browser support since 2017. Avoid post-ES2017 syntax that lacks universal support. Bundled module scripts (processed by Vite) may use any modern syntax. This rule governs SYNTAX only and is independent of the CSP externalization rule below (CSP dictates _where_ scripts load, not what syntax they use).
- **Externalize inline scripts (CSP rule)**: all inline scripts live in `public/js/` for CSP compliance (10 total: `card-reveal`, `clock`, `leaflet-lazy`, `sa-loader`, `sa-stub`, `scroll-depth`, `sw-register`, `webmcp`, `book-modal`, `social-click-track`). CSP is `script-src 'self'` -- no `'unsafe-inline'`. This is a _where-scripts-load_ rule; it does not constrain syntax.
- **No inline `on*=` handlers**: markup event attributes are CSP-rejected without `'unsafe-hashes'`; attach listeners in `public/js/*.js` instead.
- **Inline-script gate**: `pnpm run audit:inline-scripts` runs as a prebuild gate. Any unavoidable inline JS requires a documented exception.
- **SW precache gate (Astro 7)**: `scripts/check-sw-precache.mjs` runs in `postbuild` and asserts the Workbox precache manifest in `dist/sw.js` is populated (entry count >= 80% of built assets, app shell present). Catches the silent failure where the PWA build succeeds but ships an empty precache (offline broken) -- the specific risk from `@vite-pwa/astro` (peer-capped at astro ^5) driving Workbox under Vite 8 / Rolldown. The wrapper is kept working via `strictPeerDependencies: false` + a `vite-plugin-pwa ^1.3.0` `overrides` pin, both in `pnpm-workspace.yaml`; see that file for the standing-workaround rationale.
- **Simple Analytics is served first-party (Issue #83, 2026-06-24):** SA is no longer loaded from `scripts.simpleanalyticscdn.com`. Two Cloudflare Pages Functions handle it entirely within our origin:
  - `/sa` → `functions/sa.ts` (Cloudflare strips the `.ts` extension → route `/sa`, NOT `/sa.js`): fetches `https://simpleanalyticsexternal.com/proxy.js?hostname=jonathanlloyd.me&path=/simple` (a v11 SA script baked with our hostname + collection path), caches aggressively at the edge. On upstream failure returns a harmless JS no-op.
  - `/simple/*` → `functions/simple/[[path]].ts`: catch-all reverse proxy forwarding to `https://queue.simpleanalyticscdn.com/<rest>` with the `/simple` prefix stripped. Preserves method/body/content-type; sets `X-Forwarded-For`+`X-Real-IP` from `CF-Connecting-IP` for geo accuracy. On upstream failure returns a silent 204 (or 1×1 transparent GIF for `.gif` paths) — never a 5xx.
  - CSP no longer lists any `simpleanalyticscdn.com` host; all SA traffic is covered by `'self'`.
  - `auto-events.js` was dropped (no dependents — only manual `sa_event` callers exist in `scroll-depth.js` and `social-click-track.js`; `window.sa_event` is still defined by the proxied main script).
  - **Invariant (enforced by `audit:sa-path` in prebuild):** the `path=` query value in `functions/sa.ts`'s proxy URL MUST equal the route directory name (`/simple`). Mismatch = silent total data loss. The blocking assertion runs in `prebuild` and exits non-zero on mismatch.
  - **Privacy note:** collection now appears first-party (`/simple/*`), but SA remains cookieless and data still terminates at Simple Analytics — no new tracking is introduced.
  - **Rollback:** revert the commit. CSP, loader, and markup return to the CDN hosts; analytics resumes on next deploy.
- **Contract-lock is generated, never hand-edited**: `.contract-lock.json` freshness is enforced by a Husky pre-commit hook + a `contract-check` CI job (both run `pnpm run check:contract-lock`). Regenerate with `node scripts/generate-contract-lock.mjs && git add .contract-lock.json`. (Scope: the schema-file subset of `schemas` + `portal-contract` only, for the Ajv build contract -- narrower than the full dependency set pinned in `pnpm-lock.yaml`.)
- **Design System packages come from the registry (GitHub Packages), pinned in `pnpm-lock.yaml`** -- atlas decision 0015 (yalc retirement). The six `@j0nathan-ll0yd/*` packages (`copy`, `fixtures`, `portal-contract`, `schemas`, `tokens`, `web`) are consumed as published `^1.0.0` deps; `pnpm install --frozen-lockfile` resolves them via `@j0nathan-ll0yd:registry=https://npm.pkg.github.com` in `.npmrc`. Auth is NOT committed (atlas decision 0032): locally the token comes from the machine-global `~/.npmrc`, and in CI each installing job runs `pnpm config set '//npm.pkg.github.com/:_authToken'` with the built-in Actions `GITHUB_TOKEN` before installing -- all six are public but GitHub Packages requires a token even to read. The resolved version + integrity hash in `pnpm-lock.yaml` is the committed provenance record decision 0013 asked for: the artifact reviewed in git, the artifact CI builds, and the artifact that deploys are now one and the same, so the yalc-freshness gate (and its `.yalc-lock.json`, `ci-setup.sh`, and `.yalc/` tree) is retired. Merging to `main` IS a production deploy (Cloudflare Pages), so a producer change must be published as a new version and the caret range / lockfile bumped here before it can ship -- a web bump needing an unpublished DS change simply cannot resolve that version.
- **Estate contracts are consumed, never vendored** -- atlas decisions 0079 item 4 wave 2b, 0080. The `openspec-covers` rule (`scripts/openspec-covers.mjs`, the blocking `covers-conformance` CI gate) and the `llms-structure` rule (`scripts/audit/validate-llms-txt.mjs`) both import `@j0nathan-ll0yd/estate-contracts`. Never re-vendor either one, and never hand-write a `.sha256` sidecar for them. Three consequences:
  - **The dependency is EXACT-pinned (`0.7.0`), not a caret.** A `SPEC_VERSION` is a rule version, and while the package is `0.x` the minor field is the breaking bump, so a caret would silently admit a different rule. Moving the pin is an estate-atomic operation: read the tier README, reconcile `openspec/`, and move `EXPECTED_SPEC_VERSION` in `scripts/openspec-covers.mjs` and in both integrity tests in the same change when a rule version changes. A release that leaves the RULE alone moves the pin alone: `0.5.0` added the decision-0099 llms.txt codec (`parseLlmsTxt`, `encodeLlmsTxt`, `decodeLlmsTxt`), `0.6.0` changed that codec's canonical encode form (a run of consecutive bullet-shaped prose lines now renders contiguous), and `0.7.0` (decision 0103) moved the codec's model and encode guards onto Zod while preserving behavior, but `checkLlmsStructure` is untouched by all three, so `LLMS_STRUCTURE_SPEC_VERSION` stays 3 and `COVERS_SPEC_VERSION` stays 4. What DOES move on any such release is the shipped `reference.mjs` and its `.sha256` sidecar -- the integrity test reads the shipped sidecar so it self-updates, but any digest quoted in `openspec/` is a hand-maintained citation and must be re-read from `node_modules/@j0nathan-ll0yd/estate-contracts/llms-structure/reference.mjs.sha256` in the same change.
  - **`llms-structure` now carries one pinned dependency; `openspec-covers` still carries none.** From `0.7.0` the tier's invariant is "pinned, version-asserted dependencies", not "imports nothing": `llms-structure/reference.mjs` imports `zod` at the exact `VERIFIED_ZOD_VERSION` (`4.4.3`), the same mechanism decision 0030 established for `typescript` in `export-surface/extract.mjs`. `openspec-covers/reference.mjs` MUST stay zero-import -- `ios-LifegamesPortal` vendors it as a file and runs it on bare node with no `node_modules`, so an import there is a broken iOS build, not a style regression. Atlas audit A12 item 7 aligns any DECLARED `zod` specifier to `VERIFIED_ZOD_VERSION`, but it is an alignment rule and not a mandate: this repo declares no `zod` of its own (it resolves `4.4.3` transitively via `@j0nathan-ll0yd/observability`), so it owes A12 nothing and must NOT add one to "comply".
  - **Sidecars ship but are NOT `exports` subpaths.** `.sha256` classifies INDETERMINATE under the export-surface rule and declaring one would poison that package's own surface verdict. Resolve a sidecar relative to the tier's reference module URL (`new URL('reference.mjs.sha256', new URL(import.meta.resolve('@j0nathan-ll0yd/estate-contracts/<tier>')))`), take the FIRST of the two whitespace-separated fields, and assert the two-field format -- an `awk '{print $1}'` one-liner rewrote one to a bare hash once and broke it for every consumer.
  - **The `covers-conformance` CI job now installs.** It used to run on node builtins with no registry dependency; that property was traded deliberately, because a stale local copy of a cross-repo rule passes green while enforcing a rule the estate has moved past, whereas a registry outage fails loudly and is retryable.
- **Install integrity doctor (`pnpm run doctor:install`)**: an install churn can leave a `node_modules/.bin/*` symlink dangling (under pnpm every `.bin` entry links into the content-addressed `node_modules/.pnpm/` store, so a pruned store or a cross-platform clobber from the Docker visual harness produces exactly this), surfacing later as a cryptic `command not found` mid-hook. The doctor runs first in `pre-push` and fails loud with the fix (`pnpm install --frozen-lockfile`, or `rm -rf node_modules && pnpm install --frozen-lockfile` -- a targeted rebuild does not repair it).
- **Formatting**: 2-space indent, UTF-8, LF line endings.

## Testing

- **Visual baselines:** regenerate only in Docker (`pnpm run test:visual:update`); host-rendered PNGs fail CI.
- **Canvas widgets use a deterministic test seam, not hidden pixels:** rAF + RNG defeats Playwright's `animations: 'disabled'`, but never hide a canvas via `visibility: hidden` in `screenshot.css` -- that masks regressions. Each canvas widget exposes a `window.__<widget>` seam (defined in its DS runtime init, e.g. `@j0nathan-ll0yd/web/runtime/heart-rate-init`) with `ready`, `seed(n)`, `freezeAt(ms|null)`, `step(frames)`, and `state()`. The seam is gated by BOTH `import.meta.env.MODE === 'test'` AND a `data-test="1"` ancestor, so it is `undefined` (dead-code-eliminated) in production. Reference: `#hrEcgCanvas` / `window.__hrEcg` (`tests/visual/heart-rate.spec.ts`). Seam-driven screenshots need a `--mode test` visual build.
- **Production smoke check (replaces the retired pixel-drift suite):** `tests/smoke/home.smoke.ts` (config `playwright.smoke.config.ts`, helpers `tests/smoke/fixtures.ts`) asserts the live site at `https://jonathanlloyd.me` actually hydrated -- HTTP 200, all widget containers present, `.is-loading` skeletons cleared, the bio terminal typed its content (the #50 CSP-blocked-hydration regression guard), the service worker registered, and no external-script CSP violation / chunk-load failure / unexpected console error. Runs natively on `ubuntu-latest` (no Docker, no pixel baselines) via `.github/workflows/smoke-check.yml` on `workflow_run` after `deploy.yml`; it is post-deploy and non-blocking (files a `smoke-failure` issue rather than blocking the deploy). Run locally with `pnpm run test:smoke`. The retired drift suite could not stay green against a live data stream and could not catch a blocked-hydration failure (the SSR shell renders at the correct pixels even when hydration is dead).

## Do Not

- Rely on post-ES2017 syntax in raw-served scripts (`public/js/*.js`, `<script is:inline>` bodies). ES2017 -- `const`/`let`, arrow functions, template literals, `async`/`await` -- is allowed; only avoid newer syntax that lacks universal browser support.
- Create new `src/components/*.astro` files or hand-edit CSS (everything comes from the DS).
- Import from relative `../lib/` or `../scripts/` paths instead of the `@j0nathan-ll0yd/*` namespace.
- Hardcode hex colors or pixel values.
- Bypass prebuild schema validation.
- Hand-edit `.contract-lock.json` (Husky + CI enforce it; regenerate via `scripts/generate-contract-lock.mjs`).
- Depend on a `@j0nathan-ll0yd/*` producer change that is not yet published to the registry -- publish a new version from the producer repo first, then bump the caret range / lockfile here (merging to `main` deploys production).
- Regenerate visual baselines outside Docker (`pnpm run test:visual:update` is the only sanctioned path; host PNGs fail CI).
- Use `npm` in this repo. It is a pnpm project (atlas decision 0032): `packageManager` pins `pnpm@11.13.0`, `pnpm-workspace.yaml` holds the overrides/peer/supply-chain settings, and an `npm install` here would write a foreign lockfile and shunt packages aside (`pnpm run doctor:install` reports it).

## Detailed Reference

See `docs/wiki/` for architecture, brand, and LLM-content documentation.
