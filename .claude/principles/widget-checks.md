# Widget Checks — Human Datastream Dashboard

16 structured checks extracted from `docs/wiki/Widget-Specification.md` in `j0nathan-ll0yd.github.io`.
For full context, read the spec. For the new-widget workflow, use `/new-widget`.

The widgets live in `design-system-Lifegames`: components in `packages/web/src/widgets/<group>/`,
runtime in `packages/web/src/runtime/`, registry in `Sources/LifegamesWidgets/Resources/production-widgets.json`.
The site `j0nathan-ll0yd.github.io` consumes them through `@j0nathan-ll0yd/web` and owns the live-data
dispatcher (`src/lib/runtime/live-data.ts`) and the visual and behavioral tests (`tests/`).

IDs run W1–W15 and W17. **W16 is not a gap here** — it belongs to `rules/web/comment-discipline.md`,
which shares the `W` namespace with this file by design (ADR 0001; CONTRIBUTING §"How to add a new
web rule"). Rule IDs are append-only, so the next widget check is W18.

The `## Accessibility` section carries no `---` divider above it, deliberately: `scripts/rules.ts`
hashes each rule body up to the next heading, so a divider there lands inside W15's body and trips
the rule-shape allowlist ratchet.

---

## Structure & Styling

### W1: tri-card Wrapper with Unique ID

**Rule:** Every production widget MUST render a `.tri-card` root that carries the widget's registry `id`. A production widget is a `platform: "web"` entry in `Sources/LifegamesWidgets/Resources/production-widgets.json` (`design-system-Lifegames`). Structure: `.tri-card` > `.widget-header` + `.widget-body`. The same `id` keys the widget in `WIDGET_SELECTORS` (`tests/visual/helpers.ts` in `j0nathan-ll0yd.github.io`) and in its updater's `getElementById` calls.

**Enforcement tier:** `audits/checks/d3-widget-compliance.mjs` runs in the required `governance-gates` step and fails a registry entry with no file at `packages/web/src/widgets/<fileRelativeToWidgets>`. It does not read markup, so the root `id` is a review check.

**Detect:** a `packages/web/src/widgets/<group>/*.astro` root element with the `tri-card` class and no `id` attribute; a root `id` that differs from the registry `id`; a registry `id` with no `WIDGET_SELECTORS` value.

**Fix:** Put the registry `id` on the `.tri-card` root. Add `.widget-header` with `.widget-label` and `.widget-header-right`. Register the widget in `production-widgets.json` and in `WIDGET_SELECTORS`.

### W2: CSS Token Usage — No Hardcoded Values

**Rule:** Widget CSS (`<style>` blocks in `packages/web/src/widgets/**/*.astro`, `design-system-Lifegames`) MUST use `--lg-*` custom properties. Style Dictionary builds them from the DTCG sources under `tokens/` into `packages/tokens/dist/tokens.css`. No raw hex colors, no `px` font sizes, and no raw spacing outside `var()`. The bare aliases in `packages/tokens/src/compat.css` (`--neon-pink`, `--space-12`) are deprecated: new code does not add them.

**Enforcement tier:** `lifegames-local/no-raw-hex-in-widgets` (`eslint-local-rules/no-raw-hex-in-widgets.js`) fails raw hex in widget `.astro`, `.css`, and script source. It runs in `pnpm -F @j0nathan-ll0yd/web lint` inside the required `governance-gates` step. Its only exemption is a hex fallback inside `var(--lg-*, #hex)`, so SVG paint values need a token too. `px` font sizes and raw spacing have no gate.

**Detect:** `grep -rnE '#[0-9a-fA-F]{3,8}\b|[0-9]+px' packages/web/src/widgets --include='*.astro'` on lines inside `<style>` and outside `var()`; a new `var(--neon-*)` or `var(--space-*)` reference.

**Fix:** Reference `var(--lg-color-accent-pink)`, `var(--lg-font-size-body)`, or `var(--lg-space-300)`. For a color with no token, add it to `tokens/semantic/color.tokens.json`, run `pnpm build:tokens`, then reference the generated `--lg-*` name.

### W3: Container Queries for Widget Responsiveness

**Rule:** Typography and spacing use the fluid `clamp()` `--lg-*` tokens. Widget internals adapt through `@container` queries on `.tri-card`. Structural viewport-width layout belongs in `packages/web/src/styles/layout.css` (`design-system-Lifegames`), not in a widget `<style>` block.

**Exempt media features (allowed inside widget styles):**
- `(prefers-reduced-motion: ...)` — motion preference
- `(hover: hover)` / `(pointer: ...)` — input capability
- `(prefers-color-scheme: ...)` — color scheme preference
- `(prefers-contrast: ...)` — contrast preference

**Violating media features (move to `@container` or `layout.css`):**
- `(min-width: ...)`, `(max-width: ...)` — viewport size
- `(orientation: ...)` — viewport orientation

**Enforcement tier:** none. This is a review check.

**Detect:** in the `<style>` block of a production widget (a `platform: "web"` entry in `production-widgets.json`), `grep -nE '@media[^{]*\((min-width|max-width|orientation)'`; a `font-size` that does not reference a `--lg-font-size-*` token.

**Fix:** Replace the viewport `@media` with `@container (max-width: ...)` on the `.tri-card`. Move structural breakpoints to `packages/web/src/styles/layout.css`. Reference `--lg-font-size-*` and `--lg-space-*` tokens.

---

## Widget States

### W4: Honest Widget States

**Rule:** Every production widget that renders export data MUST render an honest state for each condition its data can be in, and its default server HTML MUST be one of those states. The states follow atlas decision 0160:
- **Live:** measured data. The server renders it in the first response; the matching updater in `packages/web/src/runtime/updaters*.ts` (`design-system-Lifegames`) replaces it on each poll.
- **Stale:** measured data older than its source's `audit.warn` age in atlas `surfaces.yaml`, shown with an absolute "as of" time.
- **Empty:** the source returned zero items. MUST render meaningful placeholder content (not NaN, broken layouts, or empty `<div>` shells).
- **Unavailable:** the source could not be read in time. The widget says so and shows no number.
- **Suppressed:** a privacy signal hides the domain. The widget clears the gated DOM and shows no value.
- **Loading (skeleton):** a client transition state, and the server state of a data-free page only. A `.skeleton-state` wrapper holds `.skeleton-bar` / `.skeleton-circle` placeholders; the widget root MAY carry an `is-loading` class that the updater removes when data arrives.

A missing measurement renders as missing, never as `0`. A fixture value never reaches production HTML, including in a rollback.

**Enforcement tier:** `packages/web/tests/server-render/states.test.ts` in `design-system-Lifegames` renders every component that takes `WidgetStateProps` in each state, and fails when such a component is missing from its matrix. It runs in the required `contract-ts` check on every PR. This prose routes reviewers; that test is what blocks.

**Detect:** server HTML that shows a skeleton for a widget whose data the server read; a fixture value in server HTML; an adapter that defaults a missing export field to `0` or `''`; a `null` rendered as `0`; a production widget with no rendering for one of the states above.

**Fix:** render the honest state on the server from the loader's per-domain state. Make the adapter emit `null` for a missing field, and make the widget and its updater render `null` as missing. Keep the skeleton for the client transition and the data-free page.

### W5: Data-Driven Variation Coverage

**Rule:** A widget with data-driven visual differences (color zones, threshold states, a different layout per data value) MUST cover each meaningful variation with these artifacts:
1. **Widget fixture:** `Sources/LifegamesWidgets/Resources/widgets/<group>/<widget>.<variation>.json` (`design-system-Lifegames`), shown in the docs page `<VariationGrid>` (W10).
2. **Raw export variation:** a named export in `packages/fixtures/src/variations/<domain>.ts`, generated to `packages/fixtures/src/generated/<domain>/<variation>.json` (W14).
3. **Scenario:** an entry in `WIDGET_VARIATION_SCENARIOS` in `tests/visual/fixtures.ts` (`j0nathan-ll0yd.github.io`).
4. **Screenshot test:** a case in `tests/visual/widgets.spec.ts` that calls `toHaveScreenshot()` on the widget locator.
5. **Variation updater, if client-side:** `packages/web/src/runtime/updaters-<widget>-variations.ts` (precedents: `updaters-leaderboard-variations.ts`, `updaters-odometer-variations.ts`).

**Enforcement tier:** `pnpm check:widget-matrix` (`audits/checks/d1-widget-matrix.mjs`) reports a manifest widget that lacks its base, `empty`, or `populated-max` fixture. It runs weekly and report-only in `audit-ds.yml`. No gate pairs a named variation with its screenshot test.

**Detect:** a widget whose markup or updater branches on a data threshold (a zone class, a variant attribute) with no `<widget>.<variation>.json` fixture, no `WIDGET_VARIATION_SCENARIOS` entry, or no `toHaveScreenshot()` case for that variation.

**Fix:** Add the widget fixture and the raw variation, then run `pnpm -F @j0nathan-ll0yd/fixtures generate` in `design-system-Lifegames`. Once the site consumes that `@j0nathan-ll0yd/fixtures` release, add the scenario and the test case, then run `pnpm test:visual:update` in `j0nathan-ll0yd.github.io`.

### W6: Image Fallback Pattern

**Rule:** A widget image whose source is a CloudFront, S3, or runtime-templated URL MUST carry the CSP-safe fallback from `packages/web/src/runtime/image-utils.ts` (`design-system-Lifegames`). The image carries an inert `data-fallback` attribute that names the same-origin placeholder `PLACEHOLDER_IMAGE_SRC` (`/images/no-cover.svg`), and bundled code binds the error handler. Local static assets ship with the build and are exempt. An inline `onerror="..."` attribute is forbidden: the site CSP `script-src 'self'` blocks it.

**Enforcement tier:** `audits/__tests__/d3-ssr-image-fallback.test.mjs` runs in the required `governance-gates` step and fails a `.astro` that server-renders `data-fallback` without bundling `initImageFallbacks()`. `packages/web/tests/browser/ssr-image-fallback.browser.test.ts` (`web-browser-runtime` job) proves the placeholder paints. `audit:inline-scripts` fails an inline `on*=` attribute.

**Detect:** a remote-source `<img` in `packages/web/src/widgets/**/*.astro` with no `data-fallback`; an updater HTML string whose remote `<img` omits `imgFallbackAttrs(...)`; a `data-fallback` component with no `initImageFallbacks()` call; any `onerror=` attribute.

**Fix:** In `.astro` markup, set `data-fallback` and add a bundled `<script>` that imports and calls `initImageFallbacks()`. In an updater HTML string, interpolate `imgFallbackAttrs(src)`, then call `installImageFallbacks(root)` after the markup is inserted.

---

## Data Pipeline

### W7: Adapter for Transformed Data

**Rule:** A widget whose data needs transformation MUST get it from a named adapter in `packages/web/src/runtime/adapters.ts` (`design-system-Lifegames`). Raw export types come from `@j0nathan-ll0yd/portal-contract/schemas`: import them, never redeclare them. Adapted (UI-shaped) types stay in `adapters.ts` beside their adapter. A missing export field adapts to `null`, not to `0` (W4).

**Enforcement tier:** `packages/web/tests/runtime/adapters.test.ts` runs in the required `contract-ts` job (`pnpm --filter @j0nathan-ll0yd/web test`). Each adapter carries cases for null input, empty data, and a baseline transformation.

**Detect:** a widget that shows derived data (heart-rate zone, sleep score, hydration ounces) with no exported `adapt*` function in `adapters.ts`; an `adapt*` function with no `describe` block in `adapters.test.ts`; a local interface that duplicates a `portal-contract` export type.

**Fix:** Import the raw type from `@j0nathan-ll0yd/portal-contract/schemas`. Add the `adapt*` function and its adapted type to `adapters.ts`, and add its cases to `adapters.test.ts`. Call it from the resource's entry in `RESOURCE_UPDATERS` in `src/lib/runtime/live-data.ts` (`j0nathan-ll0yd.github.io`).

### W8: Updater for Runtime DOM Updates

**Rule:** A widget with client-side data updates MUST have an exported updater in `packages/web/src/runtime/updaters.ts` or in a topic sibling (`updaters-focus.ts`, `updaters-movement.ts`, `updaters-theatre.ts`, `updaters-<widget>-variations.ts`) in `design-system-Lifegames`. The updater MUST:
1. Select DOM elements by the widget's registry `id` (W1).
2. Replace the skeleton or prior content with the honest state for the data (W4).
3. Remove the `is-loading` class once data renders.
4. Be called from the resource's entry in `RESOURCE_UPDATERS` in `src/lib/runtime/live-data.ts` (`j0nathan-ll0yd.github.io`). The `PollEngine` in `src/lib/runtime/poll-engine.ts` drives that record through `handleResourceUpdate`.

**Enforcement tier:** `RESOURCE_UPDATERS` is typed over every `ResourceKey`, so a resource with no entry fails `pnpm typecheck` in the site `static-checks.yml`. A widget left out of an existing entry has no gate.

**Detect:** a widget fed by a polled endpoint with no exported `update*` function in `packages/web/src/runtime/updaters*.ts`, or with no call to that function in `RESOURCE_UPDATERS`.

**Fix:** Export the updater from the matching `updaters*.ts` file. Import it in `live-data.ts` through `@j0nathan-ll0yd/web/runtime/<file>` and call it from the resource's entry.

### W9: Inline Scripts — Bundled Only

**Rule:** Widget markup in `packages/web/src/` (`design-system-Lifegames`) MUST NOT carry an inline script body. The site serves CSP `script-src 'self'` with no `'unsafe-inline'`, so the browser blocks a `<script is:inline>` body, a `define:vars` directive, and an inline `on*=` handler attribute. This replaces the earlier ES5-only rule: Astro emits an `is:inline` body verbatim and untranspiled, and no such body may now ship at all. A bundled `<script>` (no `is:inline`) is transpiled and served from `'self'`, so it MAY use modern syntax. Exempt: `<script is:inline src="...">` and `application/ld+json` or `application/json` data scripts.

**Enforcement tier:** `pnpm -F @j0nathan-ll0yd/web audit:inline-scripts` (`packages/web/scripts/audit-inline-scripts.mjs`, `lint-web` job) fails on all three patterns. The site runs its own `scripts/audit-inline-scripts.mjs` in `prebuild`.

**Detect:** `pnpm -F @j0nathan-ll0yd/web audit:inline-scripts` exits non-zero; by hand, a `<script is:inline>` with a body, a `define:vars=` directive, or an `on*="..."` attribute in `packages/web/src/**/*.astro`.

**Fix:** Move the body into a bundled `<script>` (drop `is:inline`) or a module under `packages/web/src/runtime/`. Pass server values through `data-*` attributes, and attach handlers with `addEventListener`.

---

## Showcase

### W10: Production Widget in the Docs Showcase

**Rule:** Every shipped production widget (`platform: "web"`, `buildStatus: "shipped"` in `production-widgets.json`, `design-system-Lifegames`) MUST have a page at `apps/docs/src/pages/widgets/<kebab-name>.astro`. The page renders a `<StateMatrix>` with the `skeleton`, `empty`, `populated-min`, and `populated-max` states, and a `<VariationGrid>` with one captioned cell per W5 variation. The page text states the data source and the data-to-UI transformation, and points at the widget's `*.types.ts` for props. A story in `packages/web/stories/production/<Name>.stories.ts` covers the same states in Storybook.

**Enforcement tier:** `pnpm check:widget-matrix` (`audits/checks/d1-widget-matrix.mjs`) reports a production web widget with no `apps/docs` page. It runs weekly and report-only in `audit-ds.yml`.

**Detect:** a shipped registry entry whose kebab name has no file in `apps/docs/src/pages/widgets/`; a page with no `<StateMatrix>`, or one that omits any of the four states.

**Fix:** Copy an existing page such as `apps/docs/src/pages/widgets/heart-rate.astro`. Import the widget's fixtures from `@fixtures/<group>/`, then fill the `StateMatrix` states and the `VariationGrid` variations.

### W11: SVG/DOM ID Conflicts

**Rule:** A widget with a hardcoded `id=` on an SVG `<clipPath>`, `<linearGradient>`, `<radialGradient>`, `<filter>`, `<mask>`, or `<symbol>` MUST NOT render more than once on a page. The docs page (W10) renders each widget many times: `StateMatrix` and `VariationGrid` in `apps/docs/src/components/` (`design-system-Lifegames`) mount the component once per cell. A duplicate `id` makes every `url(#id)` reference resolve to the first instance.

**Enforcement tier:** none. This is a review check.

**Detect:** `grep -rnE '<(clipPath|linearGradient|radialGradient|filter|mask|symbol)[^>]*\bid="' packages/web/src/widgets --include='*.astro'`.

**Fix:** (a) Derive each SVG id from a per-instance prop and build every `url(#...)` reference from the same value, OR (b) render the duplicate docs-page cells as hand-written placeholder HTML instead of re-rendering the component.

---

## Testing

### W12: Screenshot Test with Widget Selector

**Rule:** Every shipped production widget (`platform: "web"`, `buildStatus: "shipped"` in `production-widgets.json`, `design-system-Lifegames`) MUST have, in `j0nathan-ll0yd.github.io`:
1. A `WIDGET_SELECTORS` entry in `tests/visual/helpers.ts` whose value is `#<registry id>`.
2. A case in the `Widgets - populated` block of `tests/visual/widgets.spec.ts` that calls `toHaveScreenshot()` on `page.locator(WIDGET_SELECTORS.<key>)`.
3. A committed baseline for each of the five `playwright.config.ts` projects (`desktop-1400`, `tablet-1100`, `tablet-768`, `mobile-600`, `mobile-390`) under `tests/visual/__screenshots__/<project>/widgets.spec.ts/`.

**Enforcement tier:** the `visual-tests` job in `visual-tests.yml` runs on every pull request and fails on a pixel diff against the committed baseline. No gate cross-checks the registry against `WIDGET_SELECTORS`.

**Detect:** a shipped registry `id` with no `WIDGET_SELECTORS` value of `#<id>`; a selector key with no `toHaveScreenshot()` case in `widgets.spec.ts`; a case with fewer than five committed baselines.

**Fix:** Add the selector and the test case. Run `pnpm test:visual:update` (Docker, through `scripts/run-in-docker.sh`) to write the five baselines, and commit them.

### W13: Unit Tests for Runtime Functions

**Rule:** Every exported adapter in `packages/web/src/runtime/adapters.ts` and every exported updater in `packages/web/src/runtime/updaters*.ts` (`design-system-Lifegames`) MUST have a test file in `packages/web/tests/runtime/` named after its source file (`updaters-movement.ts` → `updaters-movement.test.ts`). Each function's tests cover at minimum:
1. `null` or `undefined` input, which renders or returns missing, not `0` (W4)
2. Empty data (zero items, empty arrays)
3. A baseline (typical happy-path) transformation
4. One domain edge case (a color-zone boundary, a threshold crossing)
5. **Updaters only:** the `is-loading` class is removed and the skeleton is replaced after the update runs (jsdom, the default environment in `packages/web/vitest.config.ts`)

Site-owned runtime (`src/lib/runtime/*.ts` in `j0nathan-ll0yd.github.io`) follows the same shape in `tests/unit/` (precedent: `tests/unit/updaters-status.test.ts`).

**Enforcement tier:** the required `contract-ts` job runs `pnpm --filter @j0nathan-ll0yd/web test`, and the site `spec-cases` job runs `pnpm run test:unit`. Neither fails on a missing test file.

**Detect:** a `packages/web/src/runtime/adapters.ts` or `updaters*.ts` file with no matching `packages/web/tests/runtime/*.test.ts`; an exported function with no `describe` block in that test file.

**Fix:** Add the test file or the missing cases under `packages/web/tests/runtime/`, then run `pnpm --filter @j0nathan-ll0yd/web test`.

### W14: Generated Fixtures

**Rule:** Every endpoint in `ENDPOINTS` (`@j0nathan-ll0yd/portal-contract/constants`, which the site `PollEngine` polls through `src/lib/runtime/api.ts`) MUST have, in `packages/fixtures/` (`design-system-Lifegames`):
1. A factory module in `src/factories/<domain>.ts` that builds the default shape.
2. Variations in `src/variations/<domain>.ts`: at least `baseline`, `empty`, and `full`, plus one per documented visual variation (W5).
3. Generated JSON in `src/generated/<domain>/<variation>.json`, written by `pnpm -F @j0nathan-ll0yd/fixtures generate` and committed.
4. A `raw` entry in `fixture-map.json` that maps the directory to its `portal-contract` export schema.

**Enforcement tier:** the `fixtures` job in `ci.yml` runs `pnpm -F @j0nathan-ll0yd/fixtures build`: typecheck, `generate`, `validate` against the export schema, and `check:full-coverage` on each `full` variation. The `schemas-freshness` job (`pnpm check:schemas-freshness`) fails when regeneration changes committed JSON.

**Detect:** an `ENDPOINTS` key with no `src/factories/` module, no `baseline`, `empty`, or `full` variation, or no `raw` entry in `fixture-map.json`.

**Fix:** Add the factory and the variations, run `pnpm -F @j0nathan-ll0yd/fixtures build`, and commit the generated JSON.

---

## Compliance

### W15: Compliance Matrix Pass

**Rule:** `node audits/checks/d3-widget-compliance.mjs` (`pnpm check:compliance`, `design-system-Lifegames`) MUST exit 0 on every PR. It reads `Sources/LifegamesWidgets/Resources/production-widgets.json`, the authoritative widget registry, and checks three derived columns for each `platform: "web"` entry:
- **Astro:** `packages/web/src/widgets/<fileRelativeToWidgets>` exists.
- **Fixture:** the widget's `fixturePath` from `widget-manifest.json` exists under `Sources/LifegamesWidgets/Resources/widgets/`.
- **Manifest:** `widget-manifest.json` has an entry for the widget (`MANIFEST_ALIASES` maps the `V3` names).

A new web widget sets every registry field before merge, `null` where a field does not apply: `name`, `fileRelativeToWidgets`, `id`, `platform`, `status`, `buildStatus` (`shipped` | `dev-only`), `category`, `liveSiteLayoutSlot`, `hydration` (`static` | `hydrated`), `swiftView`, `consumers`, `plannedSurface`.

**Enforcement tier:** the script runs in the required `governance-gates` step of `ci.yml`. Docs-page, screenshot, updater, and adapter presence are not compliance columns: W7, W8, W10, and W12 cover them.

**Detect:** `node audits/checks/d3-widget-compliance.mjs` prints a `NO` cell or exits 1.

**Fix:** Create the missing `.astro` file, fixture, or `widget-manifest.json` entry that the row names, then re-run the script.

## Accessibility

### W17: Per-State Accessibility Scan

**Rule:** Every widget that carries a behavioral test MUST also carry an automated accessibility assertion for each state that test renders. **Web:** every state a behavioral matrix renders (`tests/behavioral/*.test.ts` in `j0nathan-ll0yd.github.io`) runs a card-scoped `@axe-core/playwright` scan reporting zero violations at `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Scope the scan to the widget's own card selector, never to the page — the whole-page verdict belongs to the weekly `pa11y-ci` lane, and a page-scoped scan refiles one finding against every widget sharing the page. **iOS:** the widget view carries the accessibility label S68 already requires; W17 adds no second iOS mechanism.

**Enforcement tier:** the axe assertions in the `behavioral` job of `visual-tests.yml` (web repo) plus the a11y arm of the component-catalog conformance ratchet in `design-system-Lifegames` (`contracts/component-catalog/check.mjs`), which fails a widget whose catalog entry has a null `a11y` field and no grandfathering entry in `conformance-baseline.json`. This prose routes reviewers; those two gates are what block.

**Automation ceiling — restate it whenever W17 is cited.** axe is an automated FLOOR, not a conformance verdict: it catches roughly 57% of accessibility issue volume and maps to about 32% of WCAG success criteria. Focus Order (2.4.3) and Focus Visible (2.4.7) remain 100% manual, and W17 does not reach them. A green scan is evidence that one class of defect is absent. It is never evidence of an accessible widget. W17 mandates the floor, never full WCAG conformance.

**Detect:** a `tests/behavioral/*.test.ts` matrix with no `@axe-core/playwright` import; a rendered state in such a matrix with no scan call; a shipped catalog entry whose `a11y` field is null and absent from `conformance-baseline.json`.

**Fix:** add the card-scoped scan to every state the matrix renders. Repair the reported violations at the component in `design-system-Lifegames` — never by narrowing the tag set, excluding a node, or moving the widget into the baseline.
