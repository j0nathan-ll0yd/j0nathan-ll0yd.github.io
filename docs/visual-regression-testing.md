# Visual Regression Testing — System Overview

> Comprehensive reference for the Playwright-based visual regression and production smoke check systems. Captures the architecture as of 2026-06-09 (post smoke-check migration replacing the retired drift-detection suite) plus the journey of bugs and fixes that produced the current state.

---

## 1. What it is

Two Playwright projects guard the quality of `jonathanlloyd.me`:

| Project | Config | What it tests | Trigger | Assertion style | Outcome on failure |
|---|---|---|---|---|---|
| **Visual regression** | `playwright.config.ts` | Locally-built static dashboard with fixture data | PR + push to `main` | Pixel diff `maxDiffPixelRatio: 0.025` (2.5%) | Blocks PR; runs across 4 viewports × 4 shards |
| **Production smoke check** | `playwright.smoke.config.ts` | Live `https://jonathanlloyd.me` | After every successful Cloudflare Pages deploy (`workflow_run`) | DOM/hydration assertions (no pixel diff) | Files a GitHub issue (`smoke-failure` label), non-blocking |

The two suites serve different purposes: regression is a **gate** (pixel-exact correctness of fixture-driven builds), smoke is a **sensor** (real hydration, runtime health, and CSP integrity of the live site).

**~176 baseline PNGs** live in `tests/visual/__screenshots__/{projectName}/{spec}/{name}.png`. The smoke check has no baselines — it asserts DOM state against live production.

Four viewports are exercised by the regression suite: `desktop-1400`, `tablet-1100`, `tablet-768`, `mobile-600`. The smoke check runs a single `smoke-chromium` project at 1400x900.

---

## 2. Original intent

The dashboard at `jonathanlloyd.me` has dozens of visual states — populated, empty, complex; heart-rate bradycardia/peak/resting; multiple sleep-stage distributions; book-completion variations; focus and DnD overlays; etc. Regressions are easy to introduce because:

- The widgets come from `@lifegames/web/production` (a sibling repo linked via yalc) — a DS-upgrade can change a widget's hex value or padding silently.
- The build-time HTML uses `data/*.json` while runtime swaps in CloudFront JSON via `@lifegames/web/runtime/live-data`. These two paths render different content.
- Skeleton-loading, font-load timing, and animation lifecycles all influence what a screenshot captures.

The intent of the regression suite is to lock the rendered output for every (scenario × viewport) combination. The intent of the smoke check is to assert that the live production site is functionally healthy after each deploy — specifically that Astro island hydration ran, service workers registered, and CSP policy is not silently blocking scripts.

---

## 3. Architecture (current state)

### 3.1 File map

```
tests/
├── shared/
│   └── chromium-launch-args.ts         # Shared Chromium determinism flags (regression only)
├── visual/
│   ├── dashboard.spec.ts               # 3 fullPage dashboard tests
│   ├── widgets.spec.ts                 # ~40 widget + overlay tests
│   ├── fixtures.ts                     # Scenario → fixture-file map
│   ├── helpers.ts                      # interceptRoutes, navigateAndWait,
│   │                                   #   captureFullPage, stabilizeForLocatorScreenshot
│   ├── pw-fixtures.ts                  # Worker-scoped PNG.sync.read patch
│   ├── png-iend-truncate.ts            # Pure-function IEND truncation utility
│   ├── predicates.ts                   # allImagesComplete, scrollHeightStable
│   ├── screenshot.css                  # Stabilization stylesheet
│   ├── global-setup.ts                 # Port-guard (unrelated to pngjs work)
│   └── __screenshots__/                # Baseline PNGs (CI-owned)
├── smoke/
│   ├── home.smoke.ts                   # 5 live-prod assertions (hydration, CSP, SW)
│   └── fixtures.ts                     # Page fixture: CSP violation + error capture
└── build/
    ├── predicates.test.ts              # Vitest unit tests for predicates
    └── png-iend-truncate.test.ts       # Vitest unit tests for truncateAtIEND

scripts/
├── playwright-version.sh               # Extracts Playwright version from package-lock
└── run-in-docker.sh                    # Local Docker baseline regen wrapper

.github/workflows/
├── visual-tests.yml                    # PR regression gate -- dispatches to self-hosted arm64 reusable workflow
└── smoke-check.yml                     # Post-deploy production smoke sensor (native runner)

# Reusable workflow (lives in ci-runners-private/.github/workflows/):
# web-visual-tests.yml                  # 4-shard matrix on self-hosted arm64 runner-playwright image
```

### 3.2 Determinism stack (regression suite — defense in depth)

The captured pixels must be byte-stable across runs and across the macOS-developer / Linux-CI boundary. The current stack applies to the visual regression suite only; the smoke check deliberately omits these constraints because it asserts DOM state, not pixels.

| Layer | Mechanism | Purpose |
|---|---|---|
| **Docker image** | `mcr.microsoft.com/playwright:v${VERSION}-noble` resolved dynamically from `package-lock.json` via `scripts/playwright-version.sh` + `docker manifest inspect` guard | Same rendering environment locally and in CI |
| **Container options** | `--ipc=host --shm-size=2g` on regression workflows | Avoid 64MB `/dev/shm` crash on tall fullPage screenshots |
| **Chromium flags (shared)** | `tests/shared/chromium-launch-args.ts` — `--force-device-scale-factor=1`, `--font-render-hinting=none`, `--disable-lcd-text`, `--disable-font-subpixel-positioning`, `--disable-skia-runtime-opts`, `--disable-dev-shm-usage` | Kill subpixel/font-hinting/skia raster variance |
| **Software raster** | `--use-gl=swiftshader --disable-gpu --in-process-gpu` | Eliminate Chromium MSAA atlas-path SVG raster non-determinism (Chromium 40827297) |
| **CSS** | `screenshot.css` injected via `expect.toHaveScreenshot({ stylePath })`. Hides `.widget-timestamp`, `[data-live]`, `#liveClock`, `#hrEcgCanvas`, etc. Freezes animations to 0s. Adds `svg, svg * { shape-rendering: crispEdges }`. Sets `html, body { height: auto; overflow: visible }` to allow fullPage capture | Eliminate dynamic content + SVG octicon variance + dvh height-cap bug |
| **Stabilization waits** | `helpers.ts:navigateAndWait` — fonts.ready, skeleton removal, images complete, scrollHeight stable for 3 consecutive reads at 150ms intervals | Wait for layout to settle before capture |
| **Capture strategy** | `helpers.ts:captureFullPage` grows viewport to `document.documentElement.scrollHeight` and captures via `clip{x:0, y:0, width, height}` instead of `fullPage:true` | Bypass Chromium's stitched-capture pipeline that produces truncated PNGs on tall pages (Playwright #35674) |
| **PNG decoder bypass** | `pw-fixtures.ts` monkey-patches `playwright-core/lib/utilsBundle` `PNG.sync.read` to truncate buffers at the first IEND chunk before pngjs sees them | Bypass `pngjs sync-reader.js:43` strict rejection of bytes after IEND |
| **Same image local + CI** | `scripts/run-in-docker.sh` pulls `mcr.microsoft.com/playwright:v${VERSION}-noble`; the self-hosted CI runner `runner-playwright` is `FROM` the same upstream tag. Both run arm64-native (Apple Virtualization Framework locally, Apple Container micro-VMs in CI). PNG bytes are identical. | Single source of byte truth; local pre-push run is proof of CI bytes |

### 3.3 Worker-scoped pngjs patch (the load-bearing fix)

Playwright bundles its own pngjs inside `playwright-core/lib/utilsBundleImpl/index.js`. Patching `node_modules/pngjs/` does nothing for Playwright. Workers fork via `child_process.fork` (`node_modules/playwright/lib/runner/processHost.js:54`) with separate module caches; `globalSetup` runs only in the main process and cannot reach them.

The fix lives in `tests/visual/pw-fixtures.ts`:

```ts
import { test as base, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { truncateAtIEND } from './png-iend-truncate';

const require = createRequire(import.meta.url);  // package.json has "type": "module"

function applyPngTruncationPatch(): boolean {
  if (process.env.SKIP_PNG_TRUNCATION) return false;
  const ub = require('playwright-core/lib/utilsBundle');
  const origRead = ub.PNG.sync.read;
  if (origRead.name !== 'truncatedRead') {
    ub.PNG.sync.read = function truncatedRead(buf, opts) {
      return origRead(truncateAtIEND(buf), opts);
    };
  }
  return ub.PNG.sync.read.name === 'truncatedRead';
}

// MODULE-LOAD: runs in each worker the first time it imports a spec that
// re-exports `test`. The patch is in place before any test code runs.
applyPngTruncationPatch();

// Belt-and-suspenders worker-scoped auto fixture (idempotent).
export const test = base.extend<{}, { pngTruncation: void }>({
  pngTruncation: [
    async ({}, use) => { applyPngTruncationPatch(); await use(); },
    { scope: 'worker', auto: true },
  ],
});

export { expect, type Page };
```

Specs import `{ test, expect }` from `'./pw-fixtures'` (NOT `'@playwright/test'`). Each worker that imports the spec executes pw-fixtures.ts at module-load time and patches `PNG.sync.read` in its module cache. The comparator at `playwright-core/lib/server/utils/comparators.js:64-65` then routes through the patched function on every screenshot comparison.

The truncation logic (`png-iend-truncate.ts`):

```ts
const IEND_SIGNATURE = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

export function truncateAtIEND(buf: Buffer): Buffer {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return buf;
  const idx = buf.indexOf(IEND_SIGNATURE);  // FIRST occurrence — matches where pngjs stops
  if (idx === -1) return buf;
  const end = idx + IEND_SIGNATURE.length;
  return end === buf.length ? buf : buf.subarray(0, end);
}
```

`indexOf` (not `lastIndexOf`) is load-bearing: Chromium emits buffers with the IEND signature at the very end AND an earlier IEND in trailing garbage. pngjs's parser stops at the first IEND it sees, so truncation must cut there.

### 3.4 Production smoke check

The smoke check (`playwright.smoke.config.ts`) runs on bare `ubuntu-latest` (no Docker, no SwiftShader, no determinism flags — none are needed for DOM assertions). Key config:

- `baseURL: https://jonathanlloyd.me`
- `serviceWorkers: 'allow'`
- `workers: 1`, `retries: 2` on CI
- `timeout: 45s`
- Single project: `smoke-chromium` at 1400x900

`tests/smoke/home.smoke.ts` — 5 assertions against live production:

1. **HTTP 200 + shell present** — page returns 200 and `#triptychGrid` is visible.
2. **All 13 widget containers present** — SSR shell is intact; no widget was accidentally dropped from the build.
3. **Live-data runtime hydrated** — `.is-loading` skeleton count polls to 0, using the same readiness predicate `tests/visual/helpers.ts` uses.
4. **Bio terminal typed its content** — last `#terminalBody .terminal-line` gains `.visible` and non-empty text. This is the **#50 CSP-blocked-hydration regression guard**: a widget whose hydration script is CSP-blocked still renders its SSR shell at the correct coordinates (so a pixel diff passes), but the bio terminal's typing animation does not complete — catching the failure in DOM state.
5. **Service worker registered** — `/sw.js` is registered successfully.

`tests/smoke/fixtures.ts` extends the `page` fixture to capture across each test: CSP violations (`securitypolicyviolation`), unhandled promise rejections / dynamic-import chunk failures, `pageerror`, and allowlisted `console.error`. Teardown asserts:

- No EXTERNAL (URL) script is blocked by CSP.
- Blocked inline `<script>` count stays ≤ `KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS = 3` (three legacy `is:inline` scripts in design-system components: IdentityCard social-click handler, BookModal click handler, and an SSR fixture block — a standing condition tracked separately for the DS to externalise; reduce to 0 when those scripts are externalised in DS).
- No JS chunk-load failures.
- No uncaught page errors.
- No unexpected console errors (third-party subresource load failures and CSP console noise are allowlisted).

---

## 4. The journey — bugs and fixes (2026-06-01 → 2026-06-09)

The current architecture is the survivor of a cascading sequence of bug classes. Each PR fixed one class and exposed the next. The drift detection suite was central to this journey and was subsequently retired — documented here as essential historical context.

### Round 1 — Cross-OS rendering variance (PR #44, merged 2026-06-08)

**Symptom.** Drift detection filed `visual-drift` issues on every production deploy (#25, #28, #30, #32, #38). Locally-regenerated baselines failed CI immediately.

**Root cause.** Baselines were generated on macOS (Quartz font rendering). CI ran on `ubuntu-latest` with `npx playwright install` (Linux FreeType font rendering). The drift workflow ran on bare `ubuntu-latest` with a different rendering environment from the regression suite.

**Fix.**
- Migrated both regression and drift workflows to `mcr.microsoft.com/playwright:v${VERSION}-noble` Docker image.
- Dynamic version resolution via `scripts/playwright-version.sh` + `docker manifest inspect` guard so the Docker image tag tracks `@playwright/test` automatically.
- Added shared `tests/shared/chromium-launch-args.ts` with determinism flags (`--font-render-hinting=none`, etc.).
- Injected `screenshot.css` into drift tests to hide the same dynamic content the regression suite hides.
- Wired `--ipc=host --shm-size=2g` container options to all 3 workflows.
- Extended `update-snapshots.yml` to regenerate both visual AND drift baselines on the `update-snapshots` PR label.

**Outcome.** Cross-OS variance eliminated. But CI surfaced 14 stubborn `test.fixme` annotations (PNG encoder corruption on tablet-1100 fullPage + locator screenshots; SVG octicon raster variance on desktop-1400). PR #44 deferred them rather than block.

### Round 2 — SVG octicon raster variance (PR #48, lifted 9 of 14)

**Symptom.** 5 widgets containing GitHub octicon SVGs (dev-activity-log, reading-feed, starred-repos, github-prs-only, workouts-multi) produced 3-5% pixel diffs run-to-run on `desktop-1400`, exceeding the 2.5% threshold.

**Root cause (research-backed).** Chromium issue 40827297: Skia's atlas-path renderer with MSAA = 4 samples produces 5 possible edge values per sample. Skia falls back unpredictably between AA-triangulating, MSAA atlas, and software paths depending on path size, GPU capability, and memory pressure. The same SVG can hit different code paths run-to-run.

**Fix.** Force software raster:
- `--use-gl=swiftshader` — software OpenGL
- `--disable-gpu` — no GPU code paths
- `--in-process-gpu` — single-process determinism
- Adjunct: `shape-rendering: crispEdges` in `screenshot.css` to snap edges to device pixels.

Trade-off: ~20-40% slower CI test execution. Acceptable.

**Outcome.** 5 octicon-variance fixmes lifted. Plus 4 more class-1 PNG-encoder fixmes were attempted via `captureFullPage` (viewport-grow + clip{} per Playwright #35674) + `stabilizeForLocatorScreenshot` (fonts.ready + 2× rAF). They DID NOT work — same `unrecognised content at end of stream` error. Re-applied targeted fixmes to those 5 cases. Also discovered + fixed multiple pre-existing CI bugs along the way:
  - `update-snapshots.yml` missing `bash scripts/ci-setup.sh` (yalc DS setup) — workflow could never have regenerated baselines.
  - Same workflow missing `--ipc=host --shm-size=2g` parity.
  - `git-auto-commit-action` needed `safe.directory` + space-separated `file_pattern` (brace expansion not supported by git pathspec).
  - `github-actions[bot]` commits can't trigger `pull_request` event chains → documented `workflow_dispatch` as break-glass manual trigger.

### Round 3 — PNG encoder corruption (PR #49, lifted final 5)

**Symptom.** 5 tests on tablet-1100 fullPage + tablet-768/desktop-1400 locator screenshots threw `Failed to re-generate expected. unrecognised content at end of stream` deterministically across 6+ regen attempts. Even with swiftshader + viewport-grow + crispEdges + stabilize, the bug persisted.

**Root cause investigation.** Four parallel research agents produced 50+ citations:

1. The error originates at `node_modules/pngjs/lib/sync-reader.js:43` — `throw new Error("unrecognised content at end of stream")` when `this._buffer.length > 0` after the parser stops queueing reads. The parser stops after IEND.
2. Playwright wraps it at `matchers/toMatchSnapshot.js:298-303` as `"Failed to re-generate expected.\n"` during `--update-snapshots`.
3. The byte path: Chromium CDP → Buffer → `comparators.js:64-65` `import_utilsBundle3.PNG.sync.read(actualBuffer)` → bundled pngjs in `utilsBundleImpl/index.js`.
4. pngjs has no `forgive()`/`strict()` toggle. The behavior is unconditional.
5. Playwright bundles its own pngjs; patching `node_modules/pngjs/` has no effect.
6. Workers fork via `child_process.fork`; globalSetup runs only in the main process. The patch MUST run in worker scope.
7. `package.json` has `"type": "module"`; bare `require()` is illegal in test files. Need `createRequire(import.meta.url)`.

**Fix attempts (chronological):**

1. **Worker-scoped fixture only** → patch never reached the comparator in time. No smoke-check warning either.
2. **+ Module-load-time patch** at the top of `pw-fixtures.ts` → patch confirmed applied (`PNG.sync.read.name === 'truncatedRead'`, descriptor writable) but tests still failed.
3. **+ Diagnostic logging inside `truncatedRead`** → empirically confirmed comparator IS calling our patched function, but truncation was a no-op (`delta=0` for all invocations).
4. **`lastIndexOf` → `indexOf`** → THIS WAS IT. Chromium's bytes have IEND signature at the very END plus an earlier IEND that pngjs's parser stops at. `lastIndexOf` found the trailing IEND and did nothing; `indexOf` cuts at the FIRST IEND where pngjs actually stops. All 5 baselines regenerated, all 4 visual-tests shards green.

**Outcome.** Zero `test.fixme` annotations in `tests/visual/`. All 14 original fixmes lifted.

### Why drift was retired (post-PR #49)

With the pixel-determinism problems fully solved, the structural limitations of the drift approach became the dominant concern:

**The live-data problem.** Drift pixel-diffed a frozen 3-4 PNG baseline against the live production site. The dashboard displays real data (GitHub activity, reading feed, movement rings, health metrics) with only timestamps masked via `screenshot.css`. Any change to that data — a new commit, a book completed, a workout logged — would shift pixel coordinates enough to produce a diff even when nothing was wrong. The baseline vs live-prod divergence was permanent and growing; the suite could never stay green, and it filed false-positive issues on every deploy that changed real data.

**The hydration-blindness problem.** Drift's pixel approach structurally could not catch the failure it existed for: an Astro island whose hydration script is blocked by CSP (issue #50) still renders its SSR shell at the correct pixel coordinates. The pixel diff passes. The widget is silently dead. Pixel comparison has no signal on this failure class.

**The Docker/QEMU constraint (resolved 2026-06-12).** Originally, the regression suite required SwiftShader + a `linux/amd64` Docker image, which forced QEMU on Apple Silicon — and the QEMU + SwiftShader combination intermittently SIGSEGVed at browser launch. The migration to self-hosted arm64 (RUNNERS.md) eliminated this entirely: CI now runs the Playwright noble image arm64-native on `runner-playwright`, local Docker pulls the same image tag and runs it arm64-native under Apple Virtualization Framework, and the SwiftShader determinism flags execute natively in both environments. The smoke check still has no baselines and runs on bare `ubuntu-latest`, by choice.

**The replacement.** The production smoke check asserts that hydration RAN (DOM signals: skeletons resolved, terminal animation completed, service worker registered) rather than that pixels matched a stale snapshot. It is green on healthy production and high-signal on real failures. It runs natively on `ubuntu-latest` with no Docker/QEMU, immune to the constraints that plagued drift.

---

## 5. Workflows in detail

### 5.1 `visual-tests.yml` — PR gate (dispatcher)

Lives in this repo. Triggers: `pull_request` to `main`, `workflow_dispatch` with `update_snapshots` boolean input.

Two jobs:
- `contract-check` (bare `ubuntu-latest`) — schema contract verification, skippable via `skip-contract-check` label.
- `visual` — `uses: j0nathan-ll0yd/ci-runners-private/.github/workflows/web-visual-tests.yml@main` and forwards `update_snapshots` plus `LP_REPO_TOKEN`.

This repo is PUBLIC; self-hosted runners cannot register against a public repo without exposing them to fork-PR code execution. The dispatch into the PRIVATE companion repo is the security boundary -- see `ci-runners-private/RUNNERS.md` "Companion Repo Pattern". The previous standalone `update-snapshots.yml` was retired in the same migration; its role is now fulfilled by dispatching `visual-tests.yml` with `update_snapshots=true`.

### 5.2 `web-visual-tests.yml` (companion) — the actual runner

Lives in `ci-runners-private/.github/workflows/`. Triggered only by `workflow_call` from `visual-tests.yml`. Runs on `[self-hosted, linux, arm64, playwright]` — the `runner-playwright` micro-VM image, which is `FROM mcr.microsoft.com/playwright:v${VERSION}-noble` (browsers preinstalled in `/ms-playwright`).

Jobs:
- `setup` — checks out this repo at `ref`, picks a matching DS branch if one exists, runs `bash scripts/ci-setup.sh` (yalc-publish + npm ci), builds the Astro site with `USE_FIXTURES=true`, uploads `.yalc` + `dist` artifact.
- `visual-tests` — 4-shard matrix (`fail-fast: false`). Each shard downloads the setup artifact, runs `npx playwright test --shard=N/4` with `SKIP_BUILD=true`. In `update_snapshots` mode forces `workers=1` to eliminate the intra-shard write race (microsoft/playwright#9760).
- `commit-baselines` — only runs in `update_snapshots` mode; downloads regen artifacts, auto-commits via `stefanzweifel/git-auto-commit-action` with `file_pattern: 'tests/visual/__screenshots__/**'`.
- `merge-reports` — merges blob reports from each shard into a single HTML report.

There is no `resolve-version` job because the runner image's `FROM` tag is the version source of truth; pulling a separately-tagged Playwright image would defeat byte-for-byte parity.

### 5.3 `smoke-check.yml` — production smoke sensor

Triggers: `workflow_run` after a successful `Deploy to Cloudflare Pages` run; `workflow_dispatch` for manual probes.

Jobs:
- `smoke-check` (bare `ubuntu-latest` — no Docker) — checkout → setup-node 22 → `bash scripts/ci-setup.sh` → `npx playwright install --with-deps chromium` → `npm run test:smoke` (`continue-on-error: true`) → upload `smoke-playwright-report` → on failure files a GitHub issue titled "Production smoke check failed after deploy" with labels `smoke-failure`, `automated` (deduped by title).

The smoke check is non-blocking (informational tier) during initial bake-in. Unlike the retired drift suite, it runs natively without Docker — no QEMU, no SwiftShader, no `--shm-size` workaround needed, and no baseline PNGs to maintain.

---

## 6. How to use it

### 6.1 Run regression locally (Docker, arm64-native, CI-parity bytes)

```bash
npm run test:visual          # 4 viewports × ~44 tests = ~176 tests (Docker, CI-parity)
```

### 6.2 Run smoke check locally

```bash
npm run test:smoke           # Hits live https://jonathanlloyd.me natively; no Docker needed
```

The smoke check requires network access to live production and has no baselines to update.

### 6.3 Regenerate regression baselines in Docker locally (canonical)

```bash
npm run test:visual:update   # arm64-native, CI-parity bytes
git add tests/visual/__screenshots__/
git commit -m "chore: regenerate visual baselines"
```

The self-hosted CI runner is `FROM` the same Playwright noble base image as this Docker command, both run linux/arm64 natively (no QEMU, no Rosetta), so PNG bytes match CI exactly. Commit the locally-regenerated baselines with confidence -- the pre-push hook re-runs `test:visual` as a double check.

### 6.4 Regenerate regression baselines in CI (manual dispatch)

For pull requests where you'd rather not run Docker locally:

```bash
gh workflow run visual-tests.yml --ref <branch> -f update_snapshots=true
```

The dispatcher forwards `update_snapshots=true` to the companion `web-visual-tests.yml`, which runs the suite on the self-hosted arm64 fleet and auto-commits the regenerated baselines back to `<branch>` via `stefanzweifel/git-auto-commit-action`. Same image, same bytes as the local Docker path.

### 6.5 Debug failing baselines

| Failure | First step |
|---|---|
| Pixel diff > 0.025 on octicon widget | Confirm flags include `--use-gl=swiftshader --disable-gpu --in-process-gpu`. Check `screenshot.css` has `svg, svg * { shape-rendering: crispEdges }`. |
| `Failed to re-generate expected. unrecognised content at end of stream` | Confirm spec imports from `./pw-fixtures` (not `@playwright/test`). Grep CI log for `[pw-fixtures] module-load patch` (warn-only). |
| Smoke check filed an issue | Open the artifact's `smoke-playwright-report`. Likely a hydration failure, CSP-blocked script, or new console error not in the allowlist. Check test 3 (skeleton count) and test 4 (terminal typing) first — these are the hydration-health canaries. |
| Smoke check: inline CSP violation count exceeds baseline | A new `is:inline` script was introduced in DS. Update `KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS` in `tests/smoke/fixtures.ts` and track the script for externalisation. |
| Local pixel diff but CI green | Should not happen post arm64 migration -- both paths run the same image arm64-native. Confirm `scripts/playwright-version.sh` matches the `FROM` tag in `ci-runners-private/images/runner-playwright/Dockerfile`. If they drift, the image must be rebuilt and re-pushed before bytes will agree. |

### 6.6 Add a new visual test

```ts
// tests/visual/my-spec.ts
import { test, expect } from './pw-fixtures';   // NOT '@playwright/test'
import { setupPage, stylePath, WIDGET_SELECTORS, captureFullPage } from './helpers';

test('my widget renders', async ({ page }) => {
  await setupPage(page, 'populated');
  const widget = page.locator(WIDGET_SELECTORS.something);
  await expect(widget).toHaveScreenshot('my-widget.png', { stylePath });
});

// For fullPage captures, use captureFullPage helper (NOT { fullPage: true }):
test('my full page', async ({ page }) => {
  await setupPage(page, 'populated', { waitForScrollHeight: true });
  await captureFullPage(page, 'my-full-page.png', { stylePath });
});
```

The `./pw-fixtures` import is load-bearing — it's what triggers the worker-scoped `PNG.sync.read` patch. Without it, your test will fail with the upstream pngjs error.

---

## 7. Known limitations / future work

| # | Item | Severity | Notes |
|---|---|---|---|
| 1 | Worker-scoped patch couples to Playwright's `utilsBundle.PNG.sync.read` internal symbol | LOW-MED | A future Playwright major bump could rename or restructure. Mitigation: smoke-check `console.warn` surfaces in CI logs if patch fails. Kill switch via `SKIP_PNG_TRUNCATION=1`. |
| 2 | swiftshader software raster slows CI by ~20-40% | LOW | Currently within shard time budget. If `visual-tests` matrix exceeds 15 min, reconsider per-test tolerance bumps as fallback. |
| 3 | All baselines may contain trailing garbage bytes after IEND | LOW | The patch makes them decode cleanly. If the patch is ever removed, ALL baselines must be regenerated. Documented in `pw-fixtures.ts` JSDoc. |
| 4 | `indexOf` truncation has theoretical 1/2^64-per-offset collision risk if IDAT data contains the literal 8-byte IEND signature | NEGLIGIBLE | Deflate-compressed IDAT bytes are effectively random. Acceptable. |
| 5 | Playwright 1.61 may fix the pngjs bug upstream | INFORMATIONAL | When 1.61 stable ships, retest with `SKIP_PNG_TRUNCATION=1` to see if pngjs gained a tolerance flag. If yes, delete `pw-fixtures.ts` patch + truncation utility, regenerate all baselines. |
| 6 | Local + CI byte parity depends on `scripts/playwright-version.sh` matching the `FROM` tag in `ci-runners-private/images/runner-playwright/Dockerfile` | LOW | Bumping `@playwright/test` in this repo without rebuilding+publishing the `runner-playwright` image will produce CI-vs-local pixel drift the next time CI runs. The image-rebuild step is in RUNNERS.md; a future enhancement could fail-fast on tag mismatch. |
| 7 | `chore/upgrade-dependencies` worktree at `/Users/jlloyd/wt/web-Lifegames-Portal-upgrade` holds historical PR #44 work | LOW | Can be removed once the team is confident the new architecture is stable. |
| 8 | Three legacy `is:inline` DS scripts are blocked by CSP and tracked in `KNOWN_INLINE_SCRIPT_CSP_VIOLATIONS = 3` | MED | IdentityCard social-click handler, BookModal click handler, SSR fixture block. Reduce to 0 when DS externalises these scripts. Smoke check will enforce the lower threshold automatically. |

---

## 8. Reference reading

### Upstream issues that shaped the architecture
- pngjs strict trailing-bytes rejection: https://github.com/pngjs/pngjs/issues/235
- Playwright "Failed to re-generate" error report: https://github.com/microsoft/playwright/issues/23012
- Playwright "unrecognised content" bug: https://github.com/microsoft/playwright/issues/18341
- Playwright fullPage CDP resize bug: https://issues.chromium.org/issues/331796402
- Playwright fullPage stitched-capture corruption: https://github.com/microsoft/playwright/issues/30149
- Playwright viewport-grow + clip workaround: https://github.com/microsoft/playwright/issues/35674
- Chromium MSAA atlas-path non-determinism: https://issues.chromium.org/issues/40827297
- Chromium GPU-rasterization MSAA timing: https://bugs.chromium.org/p/chromium/issues/detail?id=460486
- Playwright arm64/amd64 byte difference: https://github.com/microsoft/playwright/issues/13873
- Playwright Rosetta diff: https://github.com/microsoft/playwright/issues/29073
- pluggable image comparator feature request: https://github.com/microsoft/playwright/issues/28578

### Standards
- W3C PNG specification (IEND chunk format §11.2.5): https://www.w3.org/TR/png/
- MDN `shape-rendering` attribute: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/shape-rendering

### Internal plans
- `.omc/plans/visual-regression-cross-os.md` — PR #44 plan (Round 1)
- `.omc/plans/pr44-followup.md` — PR #46/#48 plan (Round 2)
- `.omc/plans/pngjs-bypass.md` — PR #49 plan (Round 3)

### Commit trail (visual-regression series, 2026-06-08 → 2026-06-09)
- `407e86d` — PR #44: cross-OS deterministic visual regression + dependency upgrade
- `2b51d2f` — PR #46: docs + predicate extraction
- `5dc4d2a` — PR #48: lift 9 fixmes via swiftshader + viewport-grow
- `04582ab` — PR #49: lift 5 remaining fixmes via worker-scoped pngjs IEND truncation

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Baseline** | Committed PNG that screenshots are compared against. Lives in `tests/visual/__screenshots__/{projectName}/{spec}/{name}.png`. |
| **Comparator** | Playwright's internal pixel-comparison code at `playwright-core/lib/server/utils/comparators.js`. Calls `PNG.sync.read` on actual and expected buffers, then pixelmatch. |
| **pngjs** | The pure-JS PNG decoder Playwright bundles inside `playwright-core/lib/utilsBundleImpl/index.js`. Strict-rejects buffers with trailing bytes after IEND. |
| **IEND chunk** | PNG end-of-stream marker. Format: `00 00 00 00 49 45 4E 44 AE 42 60 82` (12 bytes; the last 8 are unique per PNG spec). |
| **Worker** | A Playwright child process (spawned via `child_process.fork`) that runs a subset of tests. Has its own module cache. Pattern: `workers: '50%'` in CI. |
| **Shard** | A 1-of-N split of tests for parallel CI execution. The visual-tests workflow uses a 4-shard matrix. |
| **swiftshader** | Software OpenGL implementation. Used via `--use-gl=swiftshader` to eliminate GPU-driver-dependent SVG raster variance. Only used by the regression suite. |
| **crispEdges** | SVG `shape-rendering` value that snaps edges to device pixels, avoiding subpixel antialiasing variance. |
| **Smoke check** | The production smoke sensor (`playwright.smoke.config.ts` + `tests/smoke/`). Asserts DOM hydration state and CSP integrity against live production after each deploy. No baselines; no Docker. Replaced the retired drift detection suite. |
| **Drift detection** (retired) | The former pixel-diff-against-live-prod workflow (`playwright.drift.config.ts`, `tests/drift/`). Retired because live data caused permanent baseline divergence (false positives on every data change), and the pixel-diff approach could not detect CSP-blocked hydration (issue #50). Replaced by the smoke check. |
