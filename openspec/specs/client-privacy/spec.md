# Client Privacy Conformance

## Purpose

State what the browser side of the portfolio owes the backend focus gate. The authoritative
privacy control is the CloudFront Function gate in mantle-LifegamesPortal (`src/edge/focus-gate.js`,
`openspec/specs/focus-privacy/spec.md`). The browser cannot make that gate stronger, but it can
weaken it: a service-worker cache can replay gated data the gate now denies, a client that treats
an unreadable focus value as permission can apply gated data, and a page that only covers gated
values keeps them in the DOM. Each requirement below closes one of those (atlas decision 0160,
PR 0b; adversarial finding H02).

The server side -- the five proxy routes and their gate admission -- is the `llms-txt` capability,
requirement "Gated artifacts are admitted only through the CloudFront gate".

## Requirements

### Requirement: No service-worker path caches a gated response

The service worker SHALL NOT cache, or answer from a cache, any gated response: the focus signal,
any CloudFront JSON export (with or without the poll query), or any of the five site-origin proxy
routes (/llms.txt, /llms-full.txt, /index.md, /feed.xml, /feed.json). No `registerRoute` matcher may
match one of those URLs, every matcher SHALL be a regex literal the build can test, and every
mention of `registerRoute` SHALL be such a direct call (an alias or a bracket access is a route the
build cannot test). The worker SHALL NOT use `setDefaultHandler`, `setCatchHandler`, `onfetch`, or
any `'fetch'` event listener in any form, each of which can answer a gated request outside a
testable route. These rules apply to the worker AND to every script it loads: each
`importScripts` target and each Workbox `define` dependency except the Workbox runtime chunk, read
recursively. A dynamic `importScripts(<expression>)` is allowed only inside the Workbox loader. The
precache manifest SHALL NOT list a gated URL.

The retired `live-data` cache SHALL be deleted for returning visitors twice over: by
`/js/sw-purge.js`, imported into the generated worker, on `activate`; and by
`public/js/sw-register.js` on every page load. The second line exists because the first depends on
the new worker installing: when the purge import fails, the new worker never activates and the
old worker keeps control. The postbuild gate `scripts/check-sw-precache.mjs` enforces all of it
through `scripts/lib/sw-privacy.mjs`, and runs the purge script in a sandboxed worker scope rather
than matching its text. The real upgrade over a warm `live-data` cache, on both paths, is exercised
in Chromium by `tests/behavioral/sw-upgrade.spec.ts`.

Verified by `tests/unit/sw-privacy.test.ts:15` (synthetic workers: a CloudFront JSON route, a
site-origin feed route, an llms route, a default handler, a catch handler, a raw fetch listener, a
non-regex matcher, an aliased or bracket-called registerRoute, `onfetch`, a bracket fetch listener,
a fetch listener in an imported script, a missing import, a dynamic import outside the Workbox
loader, a precached gated URL, the retired cache name and a missing purge import are each rejected;
the purge is judged by what it does) and `tests/build/sw-update.test.ts:44` (the generated worker and the
shipped purge script pass the same scan).

#### Scenario: A route caches a gated feed

- **GIVEN** a build whose worker registers a NetworkFirst route matching `https://jonathanlloyd.me/feed.xml`
- **WHEN** the postbuild gate runs
- **THEN** the build SHALL fail, naming the route and the gated URL it matches

#### Scenario: The purge import fails on upgrade

- **GIVEN** a returning visitor whose old worker left gated JSON in `live-data`
- **WHEN** the new worker cannot import `/js/sw-purge.js` and never activates
- **THEN** the next page load SHALL still delete `live-data` from the page

### Requirement: Navigations go to the network, and only the data-free /offline page answers offline

Every navigation SHALL be handled by one NetworkOnly route: it always reaches the network and
stores nothing. Only when the network fails SHALL the worker answer, and then only with the
precached `/offline` page (Workbox `precacheFallback`; `navigateFallback` stays `null`). `/offline`
holds no gated value, no fixture value and no live widget: authored identity copy and an offline
notice from `@j0nathan-ll0yd/copy`, the site stylesheet, and `sw-register.js`. It carries no
gated-JSON prefetch, no CloudFront preconnect, no WebMCP script, no analytics and no JSON-LD.

`/offline` SHALL be the only precached HTML document. A precached document answers a navigation
from the precache before any runtime route runs: the previously precached `/` replayed the
dashboard shell, fixture values included, offline and even online until the next worker update.
No default handler, catch handler or `NavigationRoute` is allowed, and a `PrecacheFallbackPlugin`
SHALL appear only as the single plugin of that NetworkOnly route, falling back to `/offline`.

`scripts/check-sw-precache.mjs` enforces this on every build by RUNNING the generated worker
against a recording Workbox stand-in (`inspectWorker` and `verifyInspectedWorker` in
`scripts/lib/sw-privacy.mjs`): each navigation must reach that route, and each route that answers a
gated URL must be NetworkOnly. In Chromium, `tests/behavioral/offline-navigation.spec.ts` proves the
behavior: an online navigation to `/` reaches the server and changes no cache, and with the server
down or the browser offline, `/` and `/privacy` render the data-free page.

Verified by `tests/unit/sw-privacy.test.ts:221` (the shipped shape passes; no navigation route, a
NetworkFirst or fallback-less navigation route, a fallback to another URL, a second fallback route, a
catch handler, a default handler, a NavigationRoute, a function route caching a feed, an unmodelled
Workbox API, a missing `/offline` and any other precached document each fail) and
`tests/build/sw-update.test.ts:66` (the built `/offline` document is data-free and is the only
precached document).

#### Scenario: A returning visitor navigates while offline

- **GIVEN** a visitor whose browser holds the current service worker
- **WHEN** they navigate to `/` with no network
- **THEN** the worker SHALL answer with the precached `/offline` page, which shows no data

#### Scenario: A visitor navigates while online

- **GIVEN** the same visitor with network
- **WHEN** they navigate to `/`
- **THEN** the request SHALL reach the network and no cache SHALL gain an entry

### Requirement: An unreadable focus value applies no gated data

A focus value the client could not read -- a network failure, an HTTP error, a body that is not
JSON, a body without a decodable `currentFocus` -- SHALL NOT be treated as permission. No gated
artifact SHALL be fetched or applied on its strength: not by the startup read
(`fetchAllEndpoints`), not by the poll engine, which reads focus first in each tier and reads
nothing gated until a focus read decodes, and not by the WebMCP reading tool. A suppression body on
the focus path suppresses every gated artifact. The next poll retries.

Verified by `tests/unit/api.test.ts:374` (the startup read, three unreadable forms),
`tests/unit/poll-engine.test.ts:417` (the engine, including focus-first ordering) and
`tests/unit/webmcp-suppression.test.ts:50` (the generated tool, four unreadable forms, executed).

#### Scenario: Focus cannot be read at startup

- **GIVEN** the focus request fails
- **WHEN** the dashboard loads
- **THEN** no gated artifact SHALL be requested, and each SHALL be reported as not applied

### Requirement: Entering suppression removes gated values, and leaving it restores them

When the page learns of a hiding mode -- a hiding focus value, or a 403 suppression body from any
gated path while focus still reads visible -- it SHALL remove every gated value it holds, not only
cover it. It does so by reloading the static page when gated data reached it since load; the
reloaded page reads focus first and applies nothing while suppressed, so it cannot reload again,
and one burst of suppressions reloads once. A gated answer that resolves after suppression began
SHALL NOT be applied or fingerprinted. At startup, any suppressed path withholds every gated value,
including its 200 siblings, from the DOM, from the poll engine's seed and from the system-status
timestamps.

Leaving suppression SHALL re-apply every gated resource, forgetting the poll engine's fingerprints
first. A focus-driven suppression lifts as soon as focus reads visible. A gate-driven suppression
lifts no sooner than 25 s after the last denial, so a focus answer that races a fresh 403 cannot
start a lift-and-refetch loop; a one-shot timer then asks the gate itself on one path, and a 200
lifts it while a suppression body re-arms it.

Verified by `tests/unit/live-data.app-update.test.ts:349` (reload on entering, the loop guard, one
reload per burst, startup withholding asserted on the bookshelf updater, the engine seed and the
system-status timestamps) and `tests/unit/live-data.app-update.test.ts:590` (the one-shot gate
re-check).

#### Scenario: A hiding push arrives after data was shown

- **GIVEN** a page that applied gated data while visible
- **WHEN** a hiding focus value arrives
- **THEN** the page SHALL reload once, and the reloaded page SHALL apply no gated data

#### Scenario: The gate reopens under an unchanged visible signal

- **GIVEN** a page suppressed by a gate 403 while focus read visible
- **WHEN** 25 s pass and the gate answers 200 on one gated path
- **THEN** suppression SHALL lift and every gated resource SHALL be applied again
