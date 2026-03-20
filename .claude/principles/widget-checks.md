# Widget Checks — Human Datastream Dashboard

15 structured checks extracted from `docs/wiki/Widget-Specification.md`.
For full context, read the spec. For the new-widget workflow, use `/new-widget`.

---

## Structure & Styling

### W1: tri-card Wrapper with Unique ID

**Rule:** Every widget MUST use the `.tri-card` wrapper with a unique `id` attribute. Structure: `.tri-card` > `.widget-header` + `.widget-body`.

**Check:** Verify new/modified `.astro` components have `id` on the root `.tri-card`, use `.widget-header` + `.widget-body` structure, and include an accent class.

**Fix:** Add `id="{widgetId}"` to root element. Add `.widget-header` with `.widget-label` and `.widget-header-right`. Widget ID must be registered in `WIDGET_SELECTORS` in `tests/visual/helpers.ts`.

### W2: CSS Token Usage — No Hardcoded Values

**Rule:** All widget styling MUST use custom properties from `public/css/tokens.css`. No hardcoded colors, font sizes, or spacing.

**Check:** Grep new/modified CSS for hex colors (`#`), `px` font sizes, or raw spacing values not wrapped in `var()`. Check `<style>` blocks in `.astro` files.

**Fix:** Replace with token references: `var(--neon-pink)`, `var(--font-size-base)`, `var(--space-12)`, etc.

### W3: Responsive — Fluid Tokens + Container Queries

**Rule:** Typography and spacing use fluid `clamp()` tokens. Widget internals adapt via `@container` queries on `.tri-card`. Structural layout changes use `@media` breakpoints in `layout.css`.

**Check:** Look for `@media` queries inside widget component styles (should be `@container` instead). Verify font sizes reference `--font-size-*` tokens.

**Fix:** Use `@container` for widget-internal adaptation. Reference `--font-size-*` and `--space-*` tokens. Test at 1400px, 1100px, 900px, 600px.

---

## Widget States

### W4: Three Mandatory States

**Rule:** Every production widget MUST support skeleton, empty, and active states. Skeleton is the default HTML state (`.is-loading` class). Empty shows when data returns zero items. Active shows populated data.

**Check:** Verify the component renders all three states. Skeleton must use `.skeleton-bar` / `.skeleton-circle` placeholders. Empty must show meaningful placeholder content (not broken layouts or NaN).

**Fix:** Add `.is-loading` class to root with skeleton markup as default. Handle null/empty data in the component with placeholder content.

### W5: Variation States Documented and Tested

**Rule:** Widgets with data-driven visual differences MUST document all meaningful variations and have screenshot tests for each.

**Check:** If the widget changes appearance based on data values (e.g., color zones, different layouts), verify each variation has: a fixture in `test/fixtures/variations/`, a scenario in `tests/visual/fixtures.ts`, and a test in `tests/visual/widgets.spec.ts`.

**Fix:** Add fixture variation, scenario, and screenshot test. Run `npm run fixtures:generate` then `npm run test:visual:update`.

### W6: Image Fallback Pattern

**Rule:** Widgets displaying images MUST implement the `onerror` fallback via `imgFallbackAttrs()` from `src/lib/image-utils.ts`.

**Check:** Look for `<img>` tags in widgets without `onerror` handlers. Verify they use `imgFallbackAttrs()` or `localizeImageUrl()`.

**Fix:** Use `imgFallbackAttrs(cloudFrontUrl)` which generates `onerror`, `srcset` clearing, and fallback `src`.

---

## Data Pipeline

### W7: Adapter for Transformed Data

**Rule:** Widgets receiving data that needs transformation MUST have an adapter function in `src/lib/adapters.ts`. Raw export types go in `src/types/exports.ts`. Adapted types are defined in adapters.ts.

**Check:** If a widget displays derived/computed data (not raw JSON fields), verify an adapter exists. Check that the raw export type is in `src/types/exports.ts`.

**Fix:** Add export type to `exports.ts`, add adapter function to `adapters.ts`, wire into the data flow.

### W8: Updater for Runtime DOM Updates

**Rule:** Widgets with client-side data updates MUST have an updater function in `src/lib/updaters.ts` (or a sibling `updaters-*.ts` file). Updater removes `.is-loading` class when data arrives.

**Check:** If the widget receives live data via `PollEngine`, verify an updater exists and is wired in `src/scripts/live-data.ts`.

**Fix:** Add updater function that selects DOM elements by ID and updates content. Wire into `live-data.ts` poll callbacks.

### W9: Inline Scripts — ES5 Only

**Rule:** All JavaScript in `<script is:inline>` blocks MUST use ES5 syntax: `var`, `function` declarations, IIFEs. No `let`, `const`, arrow functions, or template literals.

**Check:** Grep `<script is:inline>` blocks for `let `, `const `, `=>`, or backtick template literals.

**Fix:** Replace with `var`, `function` expressions, string concatenation.

---

## Showcase

### W10: Production Widget in Showcase

**Rule:** Every production widget MUST appear in its category showcase page with skeleton, empty, and active states in a `.state-grid`. Must document data source and data-to-UI transformation.

**Check:** Verify the widget appears in the correct `src/showcase/*.astro` page. Check for 3-column state grid with all states rendered. Check that variation states are also shown.

**Fix:** Add a `<section class="component-section">` with `<h2>`, description, classes, and `.state-grid` showing all states.

### W11: SVG/DOM ID Conflicts

**Rule:** Components with SVG elements or DOM IDs that conflict when rendered multiple times MUST use hand-written HTML for the empty state in showcase pages.

**Check:** If the component has hardcoded `id` attributes on SVG elements or internal DOM nodes, rendering it 3 times on the showcase page will cause ID conflicts.

**Fix:** Write the empty state HTML by hand instead of rendering the component with empty props.

---

## Testing

### W12: Screenshot Test with Widget Selector

**Rule:** Every production widget MUST have a baseline screenshot test. Widget `id` must be registered in `WIDGET_SELECTORS` (`tests/visual/helpers.ts`). Tests run at 4 viewports.

**Check:** Verify the widget ID is in `WIDGET_SELECTORS`. Verify a test case exists in `tests/visual/widgets.spec.ts` using `page.locator(WIDGET_SELECTORS.key)`.

**Fix:** Add selector to `WIDGET_SELECTORS`, add test case, run `npm run test:visual:update` to generate baselines.

### W13: Unit Tests for Adapters and Updaters

**Rule:** Every adapter and updater function MUST have unit tests covering: null/undefined input, empty data, baseline transformation, and edge cases. Updater tests use jsdom environment.

**Check:** Verify test files exist in `tests/lib/` for each new adapter/updater. Check coverage of null handling, empty state, and baseline data.

**Fix:** Add test file with cases for null input, empty data, baseline transformation, class toggling, and `.is-loading` removal.

### W14: Generated Fixtures

**Rule:** Every CloudFront endpoint MUST have a factory in `test/fixtures/factories/`, variations in `test/fixtures/variations/`, and generated JSON files. Minimum: baseline + empty + one per visual variation.

**Check:** Verify factory exists, variations are defined, and `npm run fixtures:generate` produces the expected files. Run `npm run fixtures:validate` to check schema compliance.

**Fix:** Create factory with typed defaults. Add variation overrides. Run `npm run fixtures:generate && npm run fixtures:validate`.

---

## Compliance

### W15: Compliance Matrix Pass

**Rule:** After completing a widget, `npm run compliance` must report no new gaps. All columns in the widget registry (Section 7.1) must be filled.

**Check:** Run `npm run compliance` and verify the new widget row has no missing entries.

**Fix:** Address any gaps flagged by the compliance script. Common misses: missing screenshot test, missing fixture, missing showcase entry.
