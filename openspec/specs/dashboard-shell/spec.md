# Dashboard Shell Conformance

## Purpose

State what the HTML of `/` may carry before the client reads any data (atlas decision 0160, PR 0a;
site issue #132). A client that runs no JavaScript reads only this HTML, and a client that does run
it reads this HTML until its first fetch lands.

Before PR 0a the build rendered `/` from the design-system fixtures (`getDashboardFixture`), so
those clients read fabricated vitals, books and repositories under "live" labels. The page now
carries no fixture data. Every live widget renders its honest `loading` state, and only authored
identity content is real. The client runtime (`src/lib/runtime/live-data.ts`) fills live data
after load, under the `client-privacy` capability. This version of `/` is the rollback target for
every later 0160 change (decision 0160 D9); no fixture rollback exists.

Render proof is behavioral DOM assertion, never screenshot comparison. A baseline minted by the
change it verifies is not evidence.

## Requirements

### Requirement: The built page carries no fixture value

The production HTML of `/` SHALL NOT contain any value from `@j0nathan-ll0yd/fixtures`: no
measurement, no book, repository, event, article or workout from any fixture baseline, and none of
the five sample rows the focus overlay used to hard-code. A heart-rate readout SHALL be empty, and
no card SHALL carry a `data-generated-at` time. The same holds in a browser with scripts on, while
the first data request is outstanding and after it fails.

Each sentinel the tests check is a real value of the post-adapter fixture baseline the old page
rendered (`tests/shared/fixture-sentinels.ts`), and a test proves it still occurs in the installed
fixtures package, so a renamed fixture value fails the check rather than emptying it.

Verified by `tests/build/data-free-index.test.ts:39` (the built HTML, fixed sentinels and every
derived baseline collection) and `tests/behavioral/data-free-shell.test.ts:57` (scripts off,
scripts on with the data plane held open, scripts on with the data plane down).

#### Scenario: A client without JavaScript reads the page

- **GIVEN** the production build of `/`
- **WHEN** a browser with JavaScript disabled loads it
- **THEN** the page SHALL contain no fixture sentinel and no retired overlay row, and the BPM
  readout SHALL be empty

#### Scenario: A slow first fetch

- **GIVEN** every CloudFront request is held open
- **WHEN** the page reaches DOMContentLoaded with scripts on
- **THEN** the page SHALL contain no fixture sentinel, and every live card SHALL still read
  `loading`

### Requirement: Every live card renders its honest loading state

Each of the ten live widget cards (Heart Rate, Workouts, Movement, Hydration, Night Summary, Dev
Log, Reading Feed, Starred Repos, Bookshelf, Theatre Reviews) SHALL render with
`data-ssr-state="loading"`, its skeleton, and a `<noscript>` note that reads the
`widgets.widgetState.needsJavaScript` copy. With scripts off the note SHALL be visible. No other
element SHALL carry `data-ssr-state`.

System Status SHALL render one row per source with the no-reading mark and no status, age or
timestamp: an OFFLINE or ACTIVE label would be a claim the page has not measured. Neither focus
overlay SHALL show.

Verified by `tests/build/data-free-index.test.ts:87` (every card, its state, skeleton and note
text; the System Status rows) and `tests/behavioral/data-free-shell.test.ts:63` (scripts off: each
card visible, its note visible; the overlays hidden).

#### Scenario: Every card announces that live data needs JavaScript

- **GIVEN** a browser with JavaScript disabled
- **WHEN** it loads `/`
- **THEN** each live card SHALL read `data-ssr-state="loading"`, and its "Live data needs
  JavaScript." note SHALL be visible

### Requirement: The identity content is authored copy and renders without JavaScript

The identity card and the bio terminal SHALL render, with scripts off, the name, job title and bio
from `identity.person`, the tagline and every bio-terminal line from the `profile` namespace of
`@j0nathan-ll0yd/copy`, and a link to each URL in `identity.person.sameAs`. `src/lib/identity-profile.ts`
SHALL read them from the copy package and nowhere else. It SHALL read no location field (decision
0160 D14).

Verified by `tests/build/data-free-index.test.ts:112` (the built HTML) and
`tests/behavioral/data-free-shell.test.ts:82` (scripts off, every string visible).

#### Scenario: The identity card reads the copy package

- **GIVEN** a browser with JavaScript disabled
- **WHEN** it loads `/`
- **THEN** the name, job title, bio, tagline and every terminal line from the copy package SHALL
  be visible, and each profile link SHALL be a visible anchor

### Requirement: The production build cannot reach the fixtures package

`@j0nathan-ll0yd/fixtures` SHALL be a devDependency. The production build SHALL fail when any
module in its graph resolves to that package, directly or through another module or package, in
the client build and in the prerender server build. The `forbid-fixtures` Vite plugin
(`scripts/vite-forbid-fixtures.mjs`, registered in `astro.config.mjs`) watches the module graph; it
bundles every first-party `@j0nathan-ll0yd/*` package in the server build, so a first-party package
that imports fixtures is read rather than left external. Separately, `scripts/audit-fixtures.mjs`
(prebuild) SHALL fail on a direct import under `src/` or `functions/`.

Tests serve fixtures by Playwright route interception only, a path no production module reaches.

Verified by `tests/unit/forbid-fixtures.test.ts:84` (temporary entries that import fixtures
through an intermediate module, an intermediate first-party package, a relative path into the
package and a generated JSON subpath each fail a client build and a server build; a clean entry
builds; without the guard the same graphs build silently; the guard is registered in the Astro
config; the source check fails on each direct import form).

#### Scenario: A fixture import arrives through an intermediate module

- **GIVEN** a module under `src/` that imports a second module, which imports
  `@j0nathan-ll0yd/fixtures`
- **WHEN** the production build runs
- **THEN** the build SHALL fail with a `forbid-fixtures` error that names the importer
