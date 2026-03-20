# Widget Specification

> The definitive guide for building, testing, and managing widgets in the Human Datastream dashboard.

## 1. Introduction

### 1.1 Purpose

This specification defines the requirements, conventions, and quality gates for every widget in the Human Datastream project. It serves as both a documentation of current state and an aspirational standard for consistency. Every new widget must satisfy the requirements in this document before being considered complete.

### 1.2 What is a Widget?

A **widget** is an Astro component rendered inside a `.tri-card` wrapper that displays a discrete unit of data on the dashboard. Widgets are self-contained visual units with a header (label, optional live dot, optional timestamp) and a body.

Components that are **not** widgets:
- **Overlays** — full-screen takeovers (FocusOverlay, DndOverlay) that obscure the dashboard
- **Modals** — interactive dialogs triggered by user action (BookModal)
- **Utility components** — non-data components (OGImage, ComingSoon)
- **Layout components** — page structure (Dashboard.astro, Showcase.astro)

### 1.3 Widget Classification

Widgets are classified into two tiers based on deployment status:

| Tier | Definition | Examples |
|------|-----------|----------|
| **Production** | Renders on the dashboard (`src/pages/index.astro`). Ships to `jonathanlloyd.me`. Full compliance required. | HeartRate, Bookshelf, DevActivityLog |
| **Sandbox** | Experimental/exploratory widget variations that exist only in the showcase. Used for design iteration and prototyping. Not deployed. | ContributionGrid, LanguageBars, StreakFlame |

Production widgets may have a **status tag**:

| Status | Meaning |
|--------|---------|
| `shipped` | Renders in production builds |
| `dev-only` | Imported in `index.astro` but gated behind `import.meta.env.DEV` |

Non-widget components (overlays, modals, utility) are tracked separately in [Section 7.3](#73-non-widget-components).

---

## 2. Widget Anatomy

### 2.1 HTML Structure

Every widget follows the `.tri-card` pattern:

```html
<div class="tri-card tri-card-accent-{color}" id="{widgetId}">
  <div class="widget-header">
    <span class="widget-label">{LABEL}</span>
    <span class="widget-header-right">
      <span class="live-dot"></span>
      <span class="widget-timestamp" data-live="{endpoint}"></span>
    </span>
  </div>
  <div class="widget-body">
    <!-- Widget content -->
  </div>
</div>
```

**Requirements:**
- Every widget MUST have a unique `id` attribute on the root `.tri-card` element
- Every widget MUST use the `.widget-header` + `.widget-body` structure
- The `id` is used for screenshot test targeting via `WIDGET_SELECTORS` in `tests/visual/helpers.ts`

### 2.2 Accent Classes

Each widget uses one accent class that applies a colored top border and subtle glow. Available accents:

| Class | Token | Usage |
|-------|-------|-------|
| `.tri-card-accent-pink` | `--neon-pink` | Body column health widgets (DailyActivity, Workouts, Hydration) |
| `.tri-card-accent-blue` | `--neon-blue` | Location widgets |
| `.tri-card-accent-green` | `--neon-green` | Mind column GitHub widgets (DevActivityLog, StarredRepoList) |
| `.tri-card-accent-amber` | `--neon-amber` | Reading widgets (ReadingFeed, Bookshelf) |
| `.tri-card-accent-purple` | `--neon-purple` | Sleep (NightSummary) |
| `.tri-card-accent-red` | `--neon-red` | Alert states |
| `.tri-card-accent-cyan` | `--neon-cyan` | Data streams |
| `.tri-card-accent-orange` | `--neon-orange` | Urgency, degraded state |
| `.tri-card-accent-indigo` | `--neon-indigo` | BioTerminal |
| `.tri-card-accent-yellow` | `--neon-yellow` | TheatreReviews |

Some widgets use **dynamic accents** that change based on data (e.g., HeartRate changes accent class based on BPM zone via `classifyHeartRate()`).

### 2.3 CSS Token Usage

**Required:** All widget styling MUST use custom properties from `public/css/tokens.css`:
- Colors: `var(--neon-pink)`, `var(--text-muted)`, etc.
- Typography: `var(--font-size-base)`, `var(--font-size-sm)`, etc.
- Spacing: `var(--space-8)`, `var(--space-12)`, etc.
- Glass-morphism: `var(--glass-bg)`, `var(--glass-border)`, `var(--blur-md)`

**Prohibited:** Hardcoded color values, font sizes, or spacing in widget CSS.

### 2.4 Responsive Behavior

Widgets use a hybrid responsive approach:
- **Fluid `clamp()` tokens** — Typography and spacing scale continuously between 600px–1400px
- **Container queries** — `.tri-card` has `container-type: inline-size`, enabling `@container` queries for widget-internal adaptation (e.g., BPM font size, book cover layout)
- **Structural breakpoints** — `@media` queries in `layout.css` handle panel stacking and grid columns

---

## 3. Widget States

Every widget MUST support three mandatory states and MAY support additional states.

### 3.1 Skeleton State (Required)

The loading state shown before data arrives. Uses the `.is-loading` class on the `.tri-card` element.

**Requirements:**
- MUST visually approximate the active state layout (same general shape and proportions)
- MUST use `.skeleton-bar` and `.skeleton-circle` placeholder elements
- MUST be the default state in the HTML (what renders before JavaScript runs)
- The `.is-loading` class is removed by updater functions when data arrives

```html
<div class="tri-card tri-card-accent-pink is-loading" id="cardSteps">
  <div class="widget-header">
    <span class="widget-label">DAILY ACTIVITY</span>
  </div>
  <div class="widget-body">
    <div class="skeleton-bar" style="width: 60%"></div>
    <div class="skeleton-bar" style="width: 40%"></div>
  </div>
</div>
```

### 3.2 Empty State (Required)

Rendered when the data source returns valid data but with zero items or missing values.

**Requirements:**
- MUST render the full widget chrome (header, accent, borders)
- MUST show meaningful placeholder content (e.g., `"--"`, `"No workouts today"`, empty list)
- MUST NOT show broken layouts, NaN values, or JavaScript errors

### 3.3 Active State (Required)

The normal data-populated state.

**Requirements:**
- MUST render correctly with the baseline fixture data
- MUST handle all expected data shapes from the adapter/updater chain

### 3.4 Variation States (Conditional)

Widgets with data-driven visual differences MUST document and test all meaningful variations. A variation is **meaningful** when it produces a visually distinguishable change in layout, colors, or content structure.

**Current production widget variations:**

| Widget | Variations | What changes visually |
|--------|-----------|----------------------|
| HeartRate | bradycardia, resting, peak | BPM value, zone badge color/text, accent class, ECG animation speed |
| Hydration | zero, max | Water/coffee vessel fill levels, numeric values |
| NightSummary | deep-dominant, rem-dominant, short-sleep | Phase pill proportions, sleep score, duration, insight text |
| Bookshelf | all-reading, all-completed, no-covers | Status badges, star ratings, cover images vs placeholders |
| DevActivityLog | commits-only, prs-only | Event type icons, colors, metadata shown |
| Workouts | multi-workout, barrys-bootcamp | Number of workout sub-cards, activity types, metrics shown |
| TheatreReviews | all-grades, no-images | Grade badge colors (A+ through F), poster images vs placeholders |

### 3.5 Error / Fallback State

Widgets that display images MUST implement the `onerror` fallback pattern:

```html
<img
  src="/images/books/{asin}.webp"
  onerror="this.onerror=null;this.srcset='';this.src='{cloudfront-url}';"
  alt="Book cover"
/>
```

This is generated by `imgFallbackAttrs()` in `src/lib/image-utils.ts`. The pattern:
1. Clears `onerror` to prevent infinite loops
2. Clears `srcset` to prevent browser re-selecting the broken source
3. Falls back to the CloudFront URL

---

## 4. Data Architecture

### 4.1 Data Flow Overview

Data flows through two parallel pipelines:

```
BUILD TIME:
  data/*.json → fs.readFileSync (index.astro frontmatter) → Astro component props → HTML

RUNTIME:
  CloudFront endpoints → fetch (api.ts) → adapter functions (adapters.ts) → updater functions (updaters.ts) → DOM
```

### 4.2 CloudFront Endpoints

10 endpoints defined in `src/lib/constants.ts` (`ENDPOINTS` object):

| Endpoint | Path | Widgets Fed |
|----------|------|-------------|
| `health` | `/health.json` | HeartRate, DailyActivity, Hydration |
| `sleep` | `/sleep.json` | NightSummary, HeartRate (sleep-influenced fields) |
| `workouts` | `/workouts.json` | Workouts |
| `books` | `/books.json` | Bookshelf |
| `githubEvents` | `/github-events.json` | DevActivityLog |
| `starredRepos` | `/github-starred-repos.json` | StarredRepoList (build-time fetch only) |
| `articles` | `/articles.json` | ReadingFeed |
| `location` | `/location.json` | PlaceLeaderboardV3, ExplorationOdometerV3 |
| `focus` | `/focus.json` | FocusOverlay, DndOverlay |
| `theatreReviews` | `/theatre-reviews.json` | TheatreReviews |

**Endpoint coupling:** The `health` endpoint feeds three widgets simultaneously (HeartRate, DailyActivity, Hydration). The `sleep` endpoint feeds NightSummary and also influences HeartRate (sleep phase data is merged into `AdaptedHealth` by `adaptHealth()`). When swapping fixture data for one widget's variation test, the change affects all widgets that share the same endpoint. This coupling is documented in `tests/visual/fixtures.ts:66-69`.

### 4.3 Adapter Layer

Adapter functions in `src/lib/adapters.ts` transform raw CloudFront exports into typed, display-ready objects:

| Adapter | Input Type | Output Type | Consumers |
|---------|-----------|-------------|-----------|
| `adaptHealth(healthData, sleepData)` | `HealthExport`, `SleepExport` | `AdaptedHealth` | HeartRate, DailyActivity, Hydration |
| `adaptSleep(sleepData, healthData)` | `SleepExport`, `HealthExport` | `AdaptedSleep` | NightSummary |
| `adaptWorkouts(workoutsData)` | `WorkoutsExport` | `WorkoutEntry[]` | Workouts |
| `adaptGithubEvents(data)` | `GithubEventsExport` | `AdaptedGithubEvent[]` | DevActivityLog |
| `adaptBooks(booksData)` | `BooksExport` | `AdaptedBooks` | Bookshelf |
| `adaptArticles(data)` | `ArticlesExport` | `AdaptedArticle[]` | ReadingFeed |

Raw export types are defined in `src/types/exports.ts`. Adapted types are defined inline in `src/lib/adapters.ts`.

Widgets without adapters receive raw data directly:
- **SystemStatus** — receives `Record<string, string | null>` of timestamps
- **TheatreReviews** — receives `TheatreReviewsExport` directly
- **Location widgets** — receive `LocationExport` directly
- **Focus/DnD overlays** — receive `FocusExport` directly

### 4.4 Updater Layer

Updater functions in `src/lib/updaters.ts` (and sibling files) apply adapted data to the DOM:

| Updater | File | Widget |
|---------|------|--------|
| `updateHeartRate(data)` | `updaters.ts` | HeartRate |
| `updateDailyActivity(data)` | `updaters.ts` | DailyActivity |
| `updateWorkouts(data)` | `updaters.ts` | Workouts |
| `updateNightSummary(data)` | `updaters.ts` | NightSummary |
| `updateHydration(data)` | `updaters.ts` | Hydration |
| `updateDevActivityLog(events)` | `updaters.ts` | DevActivityLog |
| `updateReadingFeed(articles)` | `updaters.ts` | ReadingFeed |
| `updateSystemStatus(timestamps)` | `updaters.ts` | SystemStatus |
| `updateBookshelf(data)` | `updaters.ts` | Bookshelf |
| `updateTheatreReviews(data)` | `updaters-theatre.ts` | TheatreReviews |
| `updateFocusOverlay(data)` | `updaters-focus.ts` | FocusOverlay, DndOverlay |
| `updatePlaceLeaderboardV3(data)` | `updaters-leaderboard-variations.ts` | PlaceLeaderboardV3 |
| `updateExplorationOdometerV3(data)` | `updaters-odometer-variations.ts` | ExplorationOdometerV3 |

### 4.5 Query Files (.query.ts Pattern)

Sandbox widgets in `src/components/github/` use co-located `.query.ts` files instead of the adapter/updater chain:

```typescript
// src/components/github/ContributionGrid.query.ts
export const sampleData = { /* realistic sample data */ };
export const emptyData = { /* zero/empty state data */ };
```

These files are imported by showcase pages to render skeleton/empty/active states without requiring CloudFront endpoints or adapters.

---

## 5. Showcase Requirements

The component showcase (`/showcase/` during `npm run dev`) is the visual storyboard for all widgets.

### 5.1 Production Widget Showcase

Every production widget MUST appear in a showcase category page with all required states.

**Showcase categories for production widgets:**

| Category | Showcase Page | Production Widgets |
|----------|--------------|-------------------|
| Identity & System | `identity-system.astro` | IdentityCard, BioTerminal, SystemStatus |
| Health & Wellness | `health-wellness.astro` | HeartRate, DailyActivity, Workouts, Hydration, NightSummary |
| Location | `location-widgets.astro` | PlaceLeaderboardV3, ExplorationOdometerV3 |
| Activity Feeds | `activity-feeds.astro` | DevActivityLog |
| Reading & Books | `reading-books.astro` | ReadingFeed, Bookshelf, BookModal |
| Theatre Reviews | `theatre-reviews.astro` | TheatreReviews |
| Full-Screen Overlays | `fullscreen-overlays.astro` | FocusOverlay, DndOverlay |

**Requirements per production widget:**
1. MUST appear in its category page
2. MUST show **skeleton**, **empty**, and **active** states in a 3-column `.state-grid`
3. MUST document the data source (which JSON file / CloudFront endpoint)
4. MUST document how data translates into the visual output
5. Widgets with variation states MUST show ALL variations (see [Section 3.4](#34-variation-states-conditional))

### 5.2 Sandbox / Playground

Sandbox widgets (experimental/prototype variations) are displayed in showcase pages but are clearly separated from production widgets.

**Sandbox showcase categories:**

| Category | Showcase Page | Sandbox Widgets | Related Production Widget |
|----------|--------------|----------------|--------------------------|
| Contributions & Commits | `contributions-commits.astro` | ContributionGrid, ContributionCalendar, ContributionBreakdown, ContributionRings, CommitLog, CommitTimeline, StreakCounter, CodingHours, WeeklyPulse, CodeVelocity, GitHubHeatmap | — (exploration for future GitHub widgets) |
| Repositories & Languages | `repositories-languages.astro` | PinnedRepos, TopRepos, RepoShowcase, StarredRepoCards, StarredTimeline, StarredByLanguage, LanguageBars, LanguageStack, LanguageGrid, ProfileCard, YearInReview, TopicCloud | StarredRepoList (production) |
| Activity Feeds | `activity-feeds.astro` | DevActivityTimeline, DevActivityCards, DevActivityByRepo, DevActivityPulse, ActivityFeed | DevActivityLog (production) |
| Location | `location-widgets.astro` | CategoryTerrain, CityConstellation, DurationDonut, ExplorationRings, RhythmBars, StreakCalendar, StreakFlame, WaffleGrid | PlaceLeaderboardV3, ExplorationOdometerV3 (production) |

**Requirements per sandbox widget:**
1. MUST appear in its category page with skeleton, empty, and active states
2. MUST have a co-located `.query.ts` file exporting `sampleData` and `emptyData`
3. SHOULD reference which production widget it explores alternatives for (if applicable)
4. Does NOT require screenshot tests, unit tests, or generated fixtures

### 5.3 Showcase Page Structure

Each showcase page follows this structure:

```html
<Showcase title="Category Name" activeNav="category-slug">
  <div class="lib-container">
    <section class="component-section">
      <h2 class="component-name">Widget Name</h2>
      <p class="component-description">What this widget displays and where data comes from.</p>
      <p class="component-classes"><code>.tri-card-accent-{color}</code> · <code>#widgetId</code></p>
      <div class="state-grid">
        <div><h3>Skeleton</h3><!-- skeleton HTML --></div>
        <div><h3>Empty</h3><!-- empty state --></div>
        <div><h3>Active</h3><!-- active state --></div>
      </div>
    </section>
  </div>
</Showcase>
```

### 5.4 SVG/DOM ID Conflict Handling

8 components contain SVG elements or DOM IDs that would conflict when rendered multiple times on the same page (skeleton + empty + active). For these components, the empty state MUST use hand-written HTML rather than rendering the component with empty props.

---

## 6. Testing Requirements

### 6.1 Visual Screenshot Tests

#### 6.1.1 Baseline Screenshots

Every production widget MUST have a baseline screenshot test in `tests/visual/widgets.spec.ts`.

**Requirements:**
- Screenshots are captured at all 4 viewport sizes (desktop-1400, tablet-1100, tablet-768, mobile-600)
- The widget MUST have an `id` attribute registered in `WIDGET_SELECTORS` (`tests/visual/helpers.ts`)
- Tests use the `populated` scenario (baseline fixtures for all endpoints)
- Dynamic content is hidden by `tests/visual/screenshot.css`

**Screenshot test categories:**

| Category | Scope | File | Example |
|----------|-------|------|---------|
| Widget baseline | Single widget element | `widgets.spec.ts` | `widget-heart-rate.png` |
| Widget variation | Single widget with swapped fixture | `widgets.spec.ts` | `hr-bradycardia.png` |
| Dashboard full-page | Entire page | `dashboard.spec.ts` | `dashboard-populated.png` |
| Overlay full-page | Full page with overlay visible | `widgets.spec.ts` | `focus-overlay.png` |

#### 6.1.2 Variation Screenshots

Widgets with meaningful visual variations (see [Section 3.4](#34-variation-states-conditional)) MUST have screenshot tests for each variation.

**Adding a new variation screenshot test:**

1. Create a fixture variation in `test/fixtures/variations/{data-type}.ts`
2. Generate the fixture: `npm run fixtures:generate`
3. Add a scenario in `tests/visual/fixtures.ts` that overrides the relevant endpoint
4. Add the test in `tests/visual/widgets.spec.ts`:

```typescript
test('variation name', async ({ page }) => {
  await setupPage(page, 'scenario-name');
  const widget = page.locator(WIDGET_SELECTORS.widgetKey);
  await expect(widget).toHaveScreenshot('variation-name.png', { stylePath });
});
```

5. Generate baselines: `npm run test:visual:update`

#### 6.1.3 Fixture Scenarios

Visual tests use fixture compositions defined in `tests/visual/fixtures.ts`. Each scenario starts with the `BASELINE` set (10 endpoints) and selectively overrides specific endpoints:

```typescript
// Example: heart rate bradycardia scenario
'hr-bradycardia': { ...BASELINE, '/health.json': 'health/bradycardia' }
```

The `setupPage(page, scenario)` function in `tests/visual/helpers.ts` intercepts CloudFront routes and serves the corresponding fixture JSON files.

### 6.2 Unit Tests

#### 6.2.1 Scope

Unit tests are required for widgets with **runtime logic** — adapter functions, updater functions, and widget-specific computation modules.

| What to test | Where | Framework |
|-------------|-------|-----------|
| Adapter functions | `tests/lib/adapters.test.ts` | Vitest |
| Updater functions | `tests/lib/updaters.test.ts` | Vitest + jsdom |
| Widget-specific logic | `tests/lib/{module}.test.ts` | Vitest |
| Specialized updaters | `tests/lib/updaters-{name}.test.ts` | Vitest + jsdom |

**Required coverage per adapter:**
- Null/undefined input handling
- Empty data (zero items, missing fields)
- Baseline data transformation (field mapping, unit conversion, computed fields)
- Edge cases (boundary values, type coercion)

**Required coverage per updater:**
- DOM element selection and text content updates
- Class toggling (accent classes, `.is-loading` removal)
- Empty state rendering
- innerHTML rebuilds (for list-type widgets like Workouts, DevActivityLog)

#### 6.2.2 Current Unit Test Coverage

| Test File | Modules Covered | Related Widgets |
|-----------|----------------|----------------|
| `heart-rate.test.ts` | `classifyHeartRate`, `classifyHRV`, `generateECGSamples`, `buildECGPath` | HeartRate |
| `sleep.test.ts` | `computeTotalSleepSeconds`, `formatDuration`, `formatPhase`, `computeSleepPercentages` | NightSummary |
| `adapters.test.ts` | `adaptHealth`, `adaptSleep`, `adaptWorkouts`, `adaptGithubEvents`, `adaptBooks`, `adaptArticles` | All adapted widgets |
| `updaters.test.ts` | All primary updater functions + location updaters | All widgets with updaters |
| `updaters-theatre.test.ts` | `updateTheatreReviews` | TheatreReviews |
| `updaters-focus.test.ts` | `updateFocusOverlay` | FocusOverlay, DndOverlay |
| `updaters-status.test.ts` | `updatePollStatus` | Top Bar |
| `image-utils.test.ts` | `localizeImageUrl`, `imgFallbackAttrs` | Bookshelf, TheatreReviews |
| `updater-helpers.test.ts` | `esc`, `getCategoryColor`, `formatRelativeTime` | Cross-cutting |
| `poll-engine.test.ts` | `PollEngine` class | Infrastructure |
| `ws-client.test.ts` | `WSClient` class | Infrastructure |
| `api.test.ts` | `fetchWithTimeout`, `fetchAllEndpoints` | Infrastructure |

### 6.3 Build Tests

Build output validation tests in `tests/build/` verify the built site:

| Test File | What it validates |
|-----------|------------------|
| `seo-meta.test.ts` | Title, meta description, OG tags, Twitter card, canonical URL, sitemap link |
| `json-ld.test.ts` | JSON-LD `@graph` with WebSite and Person nodes |
| `data-integrity.test.ts` | `data/*.json` file structure and required fields |
| `image-pipeline.test.ts` | Book cover images exist for all ASINs, build artifacts (sw.js, manifest) |

### 6.4 Generated Fixture Data

#### 6.4.1 Factory Pattern

Every CloudFront endpoint MUST have a corresponding factory in `test/fixtures/factories/`:

```typescript
// test/fixtures/factories/health.ts
export function createHealthFixture(overrides?, omitKeys?): HealthExport {
  return { ...defaults, ...overrides };
}
```

Factories produce valid, typed objects that match the CloudFront export schemas in `src/types/exports.ts`.

#### 6.4.2 Variation Definitions

Each data type MUST have a variation file in `test/fixtures/variations/` defining named overrides:

```typescript
// test/fixtures/variations/health.ts
export const healthVariations = {
  bradycardia: { quantities: { heartRate: { value: 42 } } },
  peak: { quantities: { heartRate: { value: 165 } } },
  // ...
};
```

#### 6.4.3 Minimum Fixture Requirements

Every data type MUST have at minimum:
- A `baseline` fixture (representative real-world data)
- An `empty` fixture (zero items or missing data)
- One fixture per visual variation (if the widget has variation screenshot tests)

#### 6.4.4 Current Fixture Coverage

| Data Type | Factory | Fixtures | Variations |
|-----------|---------|----------|-----------|
| health | `health.ts` | 12 | baseline, bradycardia, resting, normal, fat-burn, peak, hrv-green, hrv-amber, hrv-red, missing-optional, zero-hydration, max-hydration |
| sleep | `sleep.ts` | 6 | baseline, empty, deep-dominant, rem-dominant, short-sleep, long-sleep |
| workouts | `workouts.ts` | 5 | baseline, empty, barrys-bootcamp, multi-workout, no-distance |
| books | `books.ts` | 10 | baseline, empty, no-covers, all-reading, all-completed, mixed-status, with-progress, series-books, six-books, all-fields |
| github-events | `github-events.ts` | 5 | baseline, empty, commits-only, prs-only, over-ten |
| github-starred-repos | `starred-repos.ts` | 2 | baseline, old-timestamp |
| articles | `articles.ts` | 5 | baseline, empty, with-notes, over-thirty, pagination |
| focus | `focus.ts` | 4 | baseline, dnd, no-focus, personal |
| location | `location.ts` | 9 | baseline, empty-top-places, single-city, many-cities, high-streak, zero-streak, sparse-90-days, full-90-days, all-categories |
| theatre-reviews | `theatre-reviews.ts` | 5 | baseline, empty, all-grades, no-images, max-reviews |

**Total: 63 generated fixture files across 10 data types.**

#### 6.4.5 Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `test/fixtures/generate.ts` | `npm run fixtures:generate` | Generates JSON files from factories + variations |
| `test/fixtures/validate.ts` | `npm run fixtures:validate` | Validates generated files against export type schemas |

---

## 7. Widget Registry

### 7.1 Production Widgets

| # | Widget | Component | ID | Accent | Status | Build Data | Runtime Endpoint | Adapter | Updater | Showcase | Screenshot | Variations | Unit Tests | Fixtures |
|---|--------|-----------|-----|--------|--------|-----------|-----------------|---------|---------|----------|------------|-----------|------------|----------|
| 1 | Identity Card | `IdentityCard.astro` | `identityCard` | none | shipped | `profile.json` | — | — | — | YES | YES | — | NO | — |
| 2 | Bio Terminal | `BioTerminal.astro` | `cardBio` | indigo | shipped | `profile.json` | — | — | — | YES | YES | — | NO | — |
| 3 | System Status | `SystemStatus.astro` | `cardSystem` | none | shipped | `system.json` | all (timestamps) | — | `updateSystemStatus` | YES | YES | — | YES | — |
| 4 | Heart Rate | `HeartRate.astro` | `cardHR` | dynamic | shipped | `health.json` | health, sleep | `adaptHealth` | `updateHeartRate` | YES | YES | 3 (bradycardia, peak, resting) | YES | 12 |
| 5 | Daily Activity | `DailyActivity.astro` | `cardSteps` | pink | shipped | `health.json` | health | `adaptHealth` | `updateDailyActivity` | YES | YES | — | YES | 12 |
| 6 | Workouts | `Workouts.astro` | `cardWorkouts` | pink | shipped | `health.json` | workouts | `adaptWorkouts` | `updateWorkouts` | YES | YES | 2 (multi, barrys) | YES | 5 |
| 7 | Hydration | `Hydration.astro` | `cardHydration` | pink | shipped | `health.json` | health | `adaptHealth` | `updateHydration` | YES | YES | 2 (zero, max) | YES | 12 |
| 8 | Night Summary | `NightSummary.astro` | `cardSleep` | purple | shipped | `health.json` | sleep | `adaptSleep` | `updateNightSummary` | YES | YES | 3 (deep, rem, short) | YES | 6 |
| 9 | Dev Activity Log | `github/DevActivityLog.astro` | `cardDevLog` | green | shipped | `github.json` | githubEvents | `adaptGithubEvents` | `updateDevActivityLog` | YES | YES | 2 (commits, prs) | YES | 5 |
| 10 | Reading Feed | `ReadingFeed.astro` | `cardReading` | amber | shipped | `reading.json` | articles | `adaptArticles` | `updateReadingFeed` | YES | YES | — | YES | 5 |
| 11 | Starred Repos | `github/StarredRepoList.astro` | **MISSING** | green | shipped | CloudFront (build) | — (timestamp only) | inline | — | YES | **NO** | — | NO | 2 |
| 12 | Bookshelf | `Bookshelf.astro` | `cardBooks` | amber | shipped | `books.json` | books | `adaptBooks` | `updateBookshelf` | YES | YES | 3 (reading, completed, no-covers) | YES | 10 |
| 13 | Theatre Reviews | `TheatreReviews.astro` | `cardTheatreReviews` | yellow | shipped | — | theatreReviews | — | `updateTheatreReviews` | YES | YES | 2 (all-grades, no-images) | YES | 5 |
| 14 | Place Leaderboard | `location/PlaceLeaderboardV3.astro` | `cardPlaceLeaderboardV3` | blue | dev-only | — | location | — | `updatePlaceLeaderboardV3` | YES | NO | — | YES | 9 |
| 15 | Exploration Odometer | `location/ExplorationOdometerV3.astro` | `cardExplorationOdometerV3` | blue | dev-only | — | location | — | `updateExplorationOdometerV3` | YES | NO | — | YES | 9 |

**Compliance gaps (production widgets):**
- **StarredRepoList**: Missing `id` attribute — cannot be targeted for screenshot tests. Needs `id="cardStarred"` (or similar) added to the root element.
- **PlaceLeaderboardV3 / ExplorationOdometerV3**: No screenshot tests — blocked by dev-only status. Add screenshot tests once promoted to `shipped`.

### 7.2 Sandbox Widgets

| Category | Count | Widgets | Have `.query.ts` | Related Production Widget |
|----------|-------|---------|-----------------|--------------------------|
| Contributions & Commits | 11 | ContributionGrid, ContributionCalendar, ContributionBreakdown, ContributionRings, CommitLog, CommitTimeline, StreakCounter, CodingHours, WeeklyPulse, CodeVelocity, GitHubHeatmap | YES (10) | — |
| Repositories & Languages | 12 | PinnedRepos, TopRepos, RepoShowcase, StarredRepoCards, StarredTimeline, StarredByLanguage, LanguageBars, LanguageStack, LanguageGrid, ProfileCard, YearInReview, TopicCloud | YES | StarredRepoList |
| Activity Feeds | 5 | DevActivityTimeline, DevActivityCards, DevActivityByRepo, DevActivityPulse, ActivityFeed | YES | DevActivityLog |
| Location | 8 | CategoryTerrain, CityConstellation, DurationDonut, ExplorationRings, RhythmBars, StreakCalendar, StreakFlame, WaffleGrid | YES | PlaceLeaderboardV3, ExplorationOdometerV3 |

**Total: 36 sandbox widgets** across 4 categories.

### 7.3 Non-Widget Components

| Component | Type | Showcase | Screenshot Test | Unit Test |
|-----------|------|----------|----------------|-----------|
| FocusOverlay | Overlay | YES (fullscreen-overlays) | YES (full-page) | YES (`updaters-focus.test.ts`) |
| DndOverlay | Overlay | YES (fullscreen-overlays) | YES (full-page) | YES (shared with FocusOverlay) |
| BookModal | Modal | YES (reading-books) | NO | NO |
| ComingSoon | Utility | YES (identity-system) | NO | NO |
| OGImage | Utility | YES (og-images) | NO | NO (validated in `seo-meta.test.ts` indirectly) |

---

## 8. Adding a New Widget

### 8.1 Checklist

Use this checklist when adding a new production widget:

- [ ] **Component**: Create `src/components/{WidgetName}.astro`
  - [ ] Use `.tri-card` wrapper with unique `id` attribute
  - [ ] Use `.widget-header` + `.widget-body` structure
  - [ ] Choose an accent class from [Section 2.2](#22-accent-classes)
  - [ ] Default state is skeleton (`.is-loading` class on root)
  - [ ] All styling uses CSS tokens from `tokens.css`

- [ ] **Data contract**: Define the props interface / data shape
  - [ ] Add raw export type to `src/types/exports.ts` (if new endpoint)
  - [ ] Add adapter function to `src/lib/adapters.ts` (if data transformation needed)
  - [ ] Add updater function to `src/lib/updaters.ts` (if client-side updates needed)
  - [ ] Wire into `src/scripts/live-data.ts` for runtime updates

- [ ] **Dashboard integration**: Add to `src/pages/index.astro`
  - [ ] Import the component
  - [ ] Load build-time data in frontmatter (if applicable)
  - [ ] Render the component with props in the appropriate column

- [ ] **Showcase**: Add to the appropriate showcase category page
  - [ ] Show skeleton, empty, and active states in `.state-grid`
  - [ ] Document data source and data-to-UI transformation
  - [ ] Show all variation states (if applicable)
  - [ ] Handle SVG/DOM ID conflicts if component has unique IDs

- [ ] **Fixtures**: Create test fixture data
  - [ ] Add factory in `test/fixtures/factories/{data-type}.ts` (if new endpoint)
  - [ ] Add variations in `test/fixtures/variations/{data-type}.ts`
  - [ ] Run `npm run fixtures:generate` and `npm run fixtures:validate`

- [ ] **Screenshot tests**: Add visual regression tests
  - [ ] Register widget ID in `WIDGET_SELECTORS` (`tests/visual/helpers.ts`)
  - [ ] Add baseline test in `tests/visual/widgets.spec.ts`
  - [ ] Add variation tests for each visual variation
  - [ ] Add any dynamic selectors to `tests/visual/screenshot.css`
  - [ ] Run `npm run test:visual:update` to generate baselines

- [ ] **Unit tests**: Add test coverage
  - [ ] Test adapter function (if created)
  - [ ] Test updater function (if created)
  - [ ] Test widget-specific logic modules

- [ ] **Documentation**: Update references
  - [ ] Update the compliance matrix: `npm run compliance`
  - [ ] Test all 4 responsive breakpoints (1400px, 1100px, 900px, 600px)

### 8.2 Adding a Sandbox Widget

Sandbox widgets have a lighter checklist:

- [ ] Create `src/components/{category}/{WidgetName}.astro`
- [ ] Create co-located `{WidgetName}.query.ts` with `sampleData` and `emptyData`
- [ ] Add to the appropriate showcase category page with 3-state grid
- [ ] Note which production widget this explores alternatives for (if any)

---

## 9. Compliance Matrix

The compliance matrix is generated automatically by running:

```bash
npm run compliance
```

This script (`scripts/widget-compliance.mjs`) scans the codebase to produce an up-to-date compliance report. It checks:

1. **Component exists** — `.astro` file in `src/components/`
2. **Has widget ID** — `id` attribute on root element
3. **In showcase** — component name appears in a `src/showcase/*.astro` file
4. **Has screenshot test** — widget key in `WIDGET_SELECTORS` AND test case in `widgets.spec.ts`
5. **Has variation tests** — variation scenario in `fixtures.ts` targeting this widget's endpoint
6. **Has unit tests** — adapter/updater function name appears in `tests/lib/*.test.ts`
7. **Has fixtures** — generated fixture directory exists for the widget's data type

### Canonical Sources of Truth

The compliance matrix is derived from these canonical source files. If the matrix conflicts with these sources, the sources are authoritative:

| Requirement | Canonical Source |
|-------------|-----------------|
| Dashboard widgets | `src/pages/index.astro` (component imports) |
| Widget IDs | `tests/visual/helpers.ts` (`WIDGET_SELECTORS`) |
| Screenshot tests | `tests/visual/widgets.spec.ts` |
| Fixture scenarios | `tests/visual/fixtures.ts` |
| Generated fixtures | `test/fixtures/generated/` directory listing |
| Unit tests | `tests/lib/*.test.ts` file contents |
| Showcase presence | `src/showcase/*.astro` file contents |

---

## Appendix A: Endpoint-to-Widget Map

Visual reference showing which widgets are affected when a specific endpoint's data changes:

```
/health.json ────────┬── HeartRate (accent, BPM, zone, HRV, ECG)
                     ├── DailyActivity (steps, distance, exercise, calories)
                     └── Hydration (water level, caffeine level)

/sleep.json ─────────┬── NightSummary (duration, score, phases, insight)
                     └── HeartRate (sleep phase data merged into AdaptedHealth)

/workouts.json ──────── Workouts (activity cards, duration, calories)

/books.json ─────────── Bookshelf (covers, status, progress, stars)

/github-events.json ─── DevActivityLog (event list, icons, timestamps)

/github-starred-repos.json ── StarredRepoList (repo list, languages, stars)

/articles.json ──────── ReadingFeed (article list, sources, notes)

/location.json ──────┬── PlaceLeaderboardV3 (podium, ranked list)
                     └── ExplorationOdometerV3 (visit counts, city, days)

/focus.json ─────────┬── FocusOverlay (full-screen work mode)
                     └── DndOverlay (full-screen DND mode)

/theatre-reviews.json ── TheatreReviews (review cards, grades, posters)
```

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Adapter** | Function that transforms raw CloudFront export data into typed, display-ready objects |
| **Updater** | Function that applies adapted data to the DOM via element selection and mutation |
| **Fixture** | Generated JSON file containing test data that matches a CloudFront export schema |
| **Factory** | TypeScript function that creates valid fixture objects with optional overrides |
| **Variation** | A named set of fixture overrides that produces a visually distinct widget state |
| **Scenario** | A fixture composition (BASELINE + endpoint overrides) used in visual tests |
| **Sandbox** | Experimental widget variations that exist only in the dev-mode showcase |
| **Skeleton** | The loading state with `.is-loading` class and placeholder elements |
| **Baseline** | The default fixture set representing typical real-world data |
