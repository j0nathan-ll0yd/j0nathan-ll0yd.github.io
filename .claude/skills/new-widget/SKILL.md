---
name: new-widget
description: Use when building a new widget for the Human Datastream dashboard. Triggers on phrases like "add a widget", "build a new widget", "create a widget", "new widget for". Generates the full task plan from the Widget Specification and walks through each step.
---

# New Widget Workflow

You are building a new widget for the Human Datastream dashboard. This skill ensures every requirement from the Widget Specification is met.

## Step 1: Gather Requirements

Before writing any code, determine:

1. **Widget name** — PascalCase component name (e.g., `TheatreReviews`)
2. **Widget ID** — camelCase id attribute (e.g., `cardTheatreReviews`)
3. **Tier** — Production (ships to jonathanlloyd.me) or Sandbox (showcase only)?
4. **Accent class** — which color from `.tri-card-accent-{color}`? Check `docs/wiki/Widget-Specification.md` Section 2.2 for the color-to-domain mapping.
5. **Data source** — new CloudFront endpoint, existing endpoint, or build-time JSON only?
6. **Variation states** — does the data produce visually distinct states beyond skeleton/empty/active?

If any of these are unclear, ask the user before proceeding.

## Step 2: Production Widget Checklist

For production widgets, complete ALL of the following. Check off each item as you go:

### Component (`src/components/`)

- [ ] Create `src/components/{WidgetName}.astro`
- [ ] `.tri-card` root with unique `id="{widgetId}"` attribute
- [ ] `.widget-header` with `.widget-label`, `.widget-header-right` > `.live-dot` + `.widget-timestamp`
- [ ] `.widget-body` with widget content
- [ ] Accent class: `.tri-card-accent-{color}`
- [ ] Default state is skeleton: `.is-loading` class on root, `.skeleton-bar` / `.skeleton-circle` placeholders
- [ ] All styling uses CSS tokens from `public/css/tokens.css` — no hardcoded values
- [ ] Empty state renders meaningful placeholders (not broken layouts)
- [ ] Active state renders correctly with fixture data

### Data Pipeline

- [ ] Raw export type in `src/types/exports.ts` (if new endpoint)
- [ ] Adapter function in `src/lib/adapters.ts` (if data transformation needed)
- [ ] Updater function in `src/lib/updaters.ts` (or `updaters-{name}.ts` for complex widgets)
- [ ] Updater removes `.is-loading` class when data arrives
- [ ] Wire into `src/scripts/live-data.ts` for runtime polling (if live data)
- [ ] Add endpoint to `src/lib/constants.ts` ENDPOINTS (if new endpoint)

### Dashboard Integration

- [ ] Import component in `src/pages/index.astro`
- [ ] Load build-time data in frontmatter via `fs.readFileSync` (if applicable)
- [ ] Render component with props in the appropriate dashboard column
- [ ] Inline script uses ES5 only: `var`, `function`, IIFEs — no `let`/`const`/arrows

### Showcase

- [ ] Add to the correct `src/showcase/{category}.astro` page
- [ ] Show skeleton, empty, and active states in `.state-grid`
- [ ] Document data source and data-to-UI mapping in description
- [ ] Show ALL variation states (if applicable)
- [ ] Handle SVG/DOM ID conflicts (hand-write empty state HTML if component has hardcoded IDs)

### Fixtures

- [ ] Factory in `test/fixtures/factories/{data-type}.ts` (if new endpoint)
- [ ] Variations in `test/fixtures/variations/{data-type}.ts`
- [ ] Run `npm run fixtures:generate`
- [ ] Run `npm run fixtures:validate`
- [ ] Minimum: baseline + empty + one per visual variation

### Screenshot Tests

- [ ] Register widget ID in `WIDGET_SELECTORS` (`tests/visual/helpers.ts`)
- [ ] Add baseline test in `tests/visual/widgets.spec.ts`
- [ ] Add variation tests for each visual variation
- [ ] Add any dynamic content selectors to `tests/visual/screenshot.css`
- [ ] Run `npm run test:visual:update` to generate baselines
- [ ] Verify at 4 viewports: desktop-1400, tablet-1100, tablet-768, mobile-600

### Unit Tests

- [ ] Test adapter function: null input, empty data, baseline transformation, edge cases
- [ ] Test updater function: DOM selection, text updates, class toggling, `.is-loading` removal, innerHTML rebuilds
- [ ] Test widget-specific logic modules (if any)
- [ ] Tests in `tests/lib/{module}.test.ts` — updater tests use jsdom environment

### Finalize

- [ ] Run `npm run compliance` — verify no new gaps
- [ ] Run `npm run build` — verify clean build
- [ ] Run `npm run test:visual` — verify screenshots pass
- [ ] Test all 4 responsive breakpoints manually (1400px, 1100px, 900px, 600px)

## Step 3: Sandbox Widget Checklist

For sandbox widgets, complete this lighter checklist:

- [ ] Create `src/components/{category}/{WidgetName}.astro`
- [ ] Create co-located `{WidgetName}.query.ts` with `sampleData` and `emptyData` exports
- [ ] `.tri-card` root with unique `id`, `.widget-header` + `.widget-body` structure
- [ ] All styling uses CSS tokens
- [ ] Add to the correct `src/showcase/{category}.astro` page
- [ ] Show skeleton, empty, and active states in `.state-grid`
- [ ] Note which production widget this explores alternatives for (if any)

## Reference

- **Full spec**: `docs/wiki/Widget-Specification.md`
- **Checks**: `.claude/principles/widget-checks.md` (15 checks, W1–W15)
- **Existing widgets**: Section 7.1 of the spec has the complete registry
- **Endpoint map**: Appendix A of the spec shows which endpoints feed which widgets
- **Compliance**: `npm run compliance` for automated verification

## Important Conventions

- ES5 only in `<script is:inline>` blocks — this is a hard rule, violations break the build
- Glass-morphism: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--blur-md));`
- Widget header right section: `.live-dot` + `.widget-timestamp[data-live="{endpoint}"]`
- Image widgets: use `imgFallbackAttrs()` from `src/lib/image-utils.ts` for onerror fallback
- Showcase pages import from `src/showcase/` not `src/pages/` — routes injected only during dev
