# Dashboard Shell Conformance

## Purpose

State what the prerendered data-free page may carry (atlas decision 0160, PR 0a; site issue #132).
The build writes it as `dist/client/index.html`. Since PR B the Worker answers `GET /` with a
server render (`dashboard-ssr` capability) and serves this page in three cases: as the D2 budget
fallback, when a render misses its 3 s ceiling (`X-SSR-Data: fallback`); as the answer to `HEAD /`;
and as the rollback content for every later 0160 change (decision 0160 D9). A render exception
answers the 500 page, not this page. No fixture rollback exists.

Before PR 0a the build rendered `/` from the design-system fixtures (`getDashboardFixture`), so
clients read fabricated vitals, books and repositories under "live" labels. This page carries no
fixture data. Every live widget renders its honest `loading` state, and only authored identity
content is real. A client that runs no JavaScript reads only this HTML; a client that does run it
reads this HTML until the client runtime (`src/lib/runtime/live-data.ts`, `client-privacy`
capability) fills live data.

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
derived baseline collection) and `tests/behavioral/data-free-shell.test.ts:64` (scripts off,
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
text; the System Status rows) and `tests/behavioral/data-free-shell.test.ts:70` (scripts off: each
card visible, its note visible; the overlays hidden).

#### Scenario: Every card announces that live data needs JavaScript

- **GIVEN** a browser with JavaScript disabled
- **WHEN** it loads `/`
- **THEN** each live card SHALL read `data-ssr-state="loading"`, and its "Live data needs
  JavaScript." note SHALL be visible

### Requirement: A failed first read renders the unavailable state

When the client's first read of an export fails, each live card that export feeds SHALL leave
`loading` and render the server's `unavailable` state (`renderWidgetUnavailable`,
`@j0nathan-ll0yd/web` 4.1): `data-ssr-state="unavailable"`, the "Data unavailable" notice, no
header label and no value. The health export feeds Heart Rate, Movement and Hydration. The sleep
export alone feeds Night Summary: a failed health read leaves it to render from sleep, with only
its score as the no-reading mark (owner decision Q3). An unreadable focus value fails every gated
read (fail-closed), so every card renders `unavailable`. A suppressed page renders nothing new,
and a suppressed card is never written. A later successful read fills the card through its
updater.

Verified by `tests/behavioral/client-states.test.ts:39` (a failed health read and a failed sleep
read, in the browser), `tests/behavioral/data-free-shell.test.ts:124` (the whole data plane down)
and `tests/unit/live-data.web4.test.ts:247` (the card mapping, and nothing new on a suppressed
page).

#### Scenario: The health read fails

- **GIVEN** every export but health is served
- **WHEN** the dashboard finishes its first read
- **THEN** Heart Rate, Movement and Hydration SHALL read `unavailable` with a visible notice, and
  Night Summary SHALL render from the sleep export

### Requirement: An export older than its warning age renders stale with an as-of time

Every client data update SHALL pass the export's freshness (`exportFreshness`): `live` while the
export's age is at most its registry `audit.warn` age (`EXPORT_FRESHNESS`: health 45 min; sleep and
workouts 12 h; books, articles and GitHub events 7 d; starred repositories and theatre reviews
18 h), `stale` beyond it. A stale card SHALL record `data-ssr-state="stale"`, carry the export's
`data-generated-at`, and show an absolute "as of" time in its header. The four health cards share
one freshness value per export. Night Summary takes the sleep export's freshness, and the health
export lends its score only while `live`.

Verified by `tests/behavioral/client-states.test.ts:75` (a health export 75 min old renders
`stale` with "as of"; a 5 min old one renders `live`, the control) and
`tests/unit/live-data.web4.test.ts:234` (Night Summary's freshness and score source).

#### Scenario: A health export older than 45 minutes

- **GIVEN** a health export whose `generatedAt` is 75 minutes before the browser's clock
- **WHEN** the dashboard finishes loading
- **THEN** the Heart Rate card SHALL read `stale`, carry that `data-generated-at`, show "as of" in
  its header, and still render its reading

### Requirement: An open tab re-judges freshness as an export ages

A card's freshness SHALL stay true while the tab stays open, not only at the moment of an update.
The client SHALL judge each card's freshness again (`exportFreshness(domain, lastData, now)`) from
the export the card shows, on a timer armed for the next instant a `live` export passes its
`audit.warn` age, and after every poll outcome: a success, an unchanged export the poll engine
skips, and a failure. A card whose judgement changed SHALL be rendered again through its updater
with the new freshness, so a card whose export ages past its warning age turns `stale` with its
"as of" time whether the polls fail or keep returning the same export. Night Summary turns on two
judgements: its sleep export's, and whether the health export that lends its score is still
`live`. A failed poll SHALL keep the card's values: only the first read renders `unavailable`. A
fresh export SHALL return the card to `live`.

A suppressed page SHALL write nothing, and entering suppression, by a hiding focus value or by a
gate denial, SHALL drop every cached export, so no re-judgement brings a value back after a hiding
transition (`client-privacy`). A page restored from the back/forward cache SHALL re-judge nothing
until its focus-first poll answers, because a hiding mode may have begun while it was frozen. An
unreadable focus value does not stop the re-judgement: it reads nothing, and re-renders only an
export read while focus decoded.

Verified by `tests/unit/live-data.freshness.test.ts:140` (polls fail: `stale`, "as of", values
kept, no `unavailable`), `tests/unit/live-data.freshness.test.ts:157` (polls return the same
export), `tests/unit/live-data.freshness.test.ts:170` (a poll outcome re-judges when the timer is
late), `tests/unit/live-data.freshness.test.ts:184` (the timer re-judges when no poll runs),
`tests/unit/live-data.freshness.test.ts:199` (a fresh export returns the card to `live`, and it
stays `live`), `tests/unit/live-data.freshness.test.ts:221` (a hiding focus push during the ageing
writes nothing and brings nothing back), `tests/unit/live-data.freshness.test.ts:244` (Night
Summary drops the score of a health export that turns stale),
`tests/unit/live-data.freshness.test.ts:269` (a gate denial during the ageing writes nothing and
brings nothing back), `tests/unit/live-data.freshness.test.ts:287` (a restored page re-judges only
after its focus read) and `tests/behavioral/client-states.test.ts:155` (an open tab in the browser
turns `stale` while its polls fail).

#### Scenario: A live health export ages while every poll fails

- **GIVEN** a health export 40 minutes old when the dashboard loads, so Heart Rate reads `live`
- **WHEN** every later health poll fails and the tab stays open for 6 more minutes
- **THEN** the Heart Rate card SHALL read `stale`, carry that export's `data-generated-at`, show
  "as of" in its header, and still render its reading

#### Scenario: A hiding mode begins while the export ages

- **GIVEN** a `live` card and a hiding focus push
- **WHEN** the export passes its warning age, and later the hiding mode ends with every gated read
  failing
- **THEN** no updater SHALL write the card in either period

### Requirement: Hydration draws its target-range bands in the browser

When the client fills the Hydration card, it SHALL draw both target-range bands, water and
caffeine, with the server's markup and the export's scale (`updateHydration`,
`@j0nathan-ll0yd/web` 4.1). Before 4.1 only server markup drew them, so the data-free page showed
no bands.

Verified by `tests/behavioral/client-states.test.ts:104`.

#### Scenario: The health export arrives

- **GIVEN** the health baseline export
- **WHEN** the dashboard finishes loading
- **THEN** the Hydration card SHALL hold two visible range bands, one water and one caffeine

### Requirement: A mirrored cover loads from the same origin

The page SHALL pass Bookshelf `localCovers`: the root-relative path of every file under
`public/images/books/`, exactly as the contract cover URLs name them, version token included. The
card carries the list in every state, `loading` included. A cover whose localized contract path is
on the list SHALL load from the same origin; every other cover SHALL keep its CloudFront URL and the
W6 fallback.

Verified by `tests/behavioral/client-states.test.ts:118`.

#### Scenario: One mirrored and one unmirrored cover

- **GIVEN** a books export with one cover whose versioned path is mirrored and one whose version
  token the mirror does not hold
- **WHEN** the Bookshelf card renders
- **THEN** the mirrored cover's source SHALL be same-origin and the other SHALL be its CloudFront
  URL

### Requirement: The identity content is authored copy and renders without JavaScript

The identity card and the bio terminal SHALL render, with scripts off, the name, job title and bio
from `identity.person`, the tagline and every bio-terminal line from the `profile` namespace of
`@j0nathan-ll0yd/copy`, and a link to each URL in `identity.person.sameAs`. `src/lib/identity-profile.ts`
SHALL read them from the copy package and nowhere else. It SHALL read no location field (decision
0160 D14).

Verified by `tests/build/data-free-index.test.ts:112` (the built HTML) and
`tests/behavioral/data-free-shell.test.ts:89` (scripts off, every string visible).

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
bundles every first-party `@j0nathan-ll0yd/*` package in every build environment, so a first-party
package that imports fixtures is read rather than left external. The Worker (`src/worker.ts`, the
on-demand endpoints under `src/pages/` and `src/lib/edge/`) is bundled inside the Astro build, in
its `ssr` environment; run alone over that edge graph, the same plugin SHALL find no fixtures.
Separately, `scripts/audit-fixtures.mjs` (prebuild) SHALL fail on any quoted specifier that names
the package in the code of `src/`, `functions/` or `astro.config`.

Tests serve fixtures by Playwright route interception only, a path no production module reaches.

Verified by `tests/unit/forbid-fixtures.test.ts:84` (temporary entries that import fixtures
through an intermediate module, an intermediate first-party package, a relative path into the
package and a generated JSON subpath each fail a client build and a server build; a clean entry
builds; without the guard the same graphs build silently; every Astro environment bundles the
first-party scope; the Worker edge graph builds clean through the guard; the guard is
registered in the Astro config; the source check fails on each import form and passes prose).

#### Scenario: A fixture import arrives through an intermediate module

- **GIVEN** a module under `src/` that imports a second module, which imports
  `@j0nathan-ll0yd/fixtures`
- **WHEN** the production build runs
- **THEN** the build SHALL fail with a `forbid-fixtures` error that names the importer
