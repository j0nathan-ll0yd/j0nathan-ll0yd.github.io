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
any CloudFront JSON export, or any of the five site-origin proxy routes (/llms.txt, /llms-full.txt,
/index.md, /feed.xml, /feed.json), whatever query string or fragment the request carries.

Every runtime route SHALL classify a request by its origin and pathname only, never by its query
string or fragment. A route matcher SHALL be one of three shapes:

- a regex literal anchored on a literal origin and path (`^https://<host>/<path>...$`), tested
  against the whole URL;
- a same-origin pathname test, exactly `({url, sameOrigin}) => sameOrigin &&
  /^\/<path>...$/.test(url.pathname)`;
- the navigation test `({request}) => request.mode === 'navigate'`, whose route SHALL be NetworkOnly
  with the /offline fallback (requirement "Navigations go to the network...").

The literal prefix a regex requires SHALL NOT cover the origin and pathname of any gated URL, in
either direction, and its path part SHALL NOT cover any gated pathname on any host (the gated
routes also answer on hosts the probe set does not name). A regex with the `i` flag is refused:
under `u` or `v`, Unicode case folding defeats any prefix comparison. A regex literal counts only
when it is the whole matcher argument. The gated URLs include the CloudFront origin of each of the
five proxied artifacts. The inspection also checks every precache entry the worker registers,
whatever shape the manifest text takes. Every route SHALL also be probed with each gated URL bare, with a fixed set of
query strings and fragments (`GATED_URL_SUFFIXES` in `scripts/lib/sw-privacy.mjs`, image paths in
query values included), and with query strings and fragments built from every route's own regex
text. A whole-URL regex that a query value can satisfy fails the anchoring rule and the probes
independently.

Both regex shapes SHALL be end-anchored (`$`), and SHALL accept no escape of their own prefix. Every
route is probed with its prefix followed by encoded-slash, dot-segment and backslash escapes aimed
at each gated file name (`TRAVERSAL_SUFFIXES`, for example `/images/books/..%2F..%2Ffeed.json`). A
browser keeps these inside the prefix, but an origin that decodes `%2F` or `%5C` and resolves dot
segments serves the gated file for them. Probes alone cannot prove a tail safe: a tail that only
demands an extension (`.+\.avif$`) passes every probe that ends in a gated file name, yet carries
`..%2F..%2Ffeed.json;.avif` to an origin that strips `;` parameters. So every regex SHALL also have
the structure `^`, a literal path (plain characters, escaped `/ . - :`, and groups of plain
alternatives), then `/` and exactly ONE file-name segment, `[A-Za-z0-9][A-Za-z0-9._-]*`
(`IMAGE_FILE_NAME_SOURCE`), then `$`. Every mirror file name matches it, and the build guard pins
both image routes exactly. The probes also carry `;x.<ext>`, `%3F.<ext>`, `%23.<ext>` and
`%00.<ext>` forms for seven image extensions. Motivating failure (final verification of
#351, LOW-2): `^/images/(books|theatre)/` cached 25 such forms in `local-images-v2` on a decoding
test origin and replayed them with the gate closed. A regex anchored on a bare origin
(`^https://<host>/`) is refused with a message that names the missing path segment.

Motivating failure (adversarial review H01): the image route
`/\/images\/(books|theatre)\//` tested the whole URL, so `/feed.json?preview=/images/books/`
matched it and a gated feed was cached CacheFirst for 30 days and replayed after the gate closed.

Every mention of `registerRoute` SHALL be a direct call (an alias or a bracket access is a route the
build cannot test). The worker SHALL NOT use `setDefaultHandler`, `setCatchHandler`, `onfetch`, or
any `'fetch'` event listener in any form, each of which can answer a gated request outside a
testable route. These rules apply to the worker AND to every script it loads: each
`importScripts` target and each Workbox `define` dependency except the Workbox runtime chunk, read
recursively. A dynamic `importScripts(<expression>)` is allowed only inside the Workbox loader. The
precache manifest, `additionalManifestEntries` included, SHALL NOT list a gated URL, with or
without a query string.

The retired caches SHALL be deleted for returning visitors twice over: by `/js/sw-purge.js`,
imported into the generated worker, on `activate`; and by `public/js/sw-register.js` on every page
load. The retired caches are `live-data` (gated JSON under the retired NetworkFirst route) and
`local-images` (written by the H01 image route, so it can hold a gated feed); the image route now
writes `local-images-v2`, and no route may declare a retired name. The second line exists because
the first depends on the new worker installing: when the purge import fails, the new worker never
activates and the old worker keeps control. The postbuild gate `scripts/check-sw-precache.mjs`
enforces all of it through `scripts/lib/sw-privacy.mjs`, and runs the purge script in a sandboxed
worker scope rather than matching its text.

Verified by `tests/unit/sw-privacy.test.ts:29` (synthetic workers: a CloudFront JSON route, a
site-origin feed route, an llms route, a default handler, a catch handler, a raw fetch listener, a
non-regex matcher, an aliased or bracket-called registerRoute, `onfetch`, a bracket fetch listener,
a fetch listener in an imported script, a missing import, a dynamic import outside the Workbox
loader, a precached gated URL, the retired cache name and a missing purge import are each rejected;
the purge is judged by what it does), `tests/unit/sw-privacy.test.ts:132` (the H01 route, query-steered
regexes, pathname tests that read the query or cover a gated path, unanchored, case-insensitive, trailing-expression
regexes, a purge that keeps `local-images`, and `additionalManifestEntries` gated URLs are each
rejected) and `tests/build/sw-update.test.ts:44` (the generated worker and the shipped purge script
pass the same scan).

In Chromium, the real generated worker is exercised by two Playwright specs.
`tests/behavioral/offline-navigation.spec.ts` fetches every gated URL with every probe query string
and fragment: first while the origin is open, then with the gate closed, then with the origin down.
No answer after the first replays the open-gate marker, every closed-gate fetch reaches the origin,
and no cache holds a gated pathname. `tests/behavioral/sw-upgrade.spec.ts` runs the real upgrade over
warm `live-data` and `local-images` caches, on both purge paths.

#### Scenario: A query string steers an image route onto a gated feed

- **GIVEN** a build whose worker registers a CacheFirst route `/\/images\/(books|theatre)\//`
- **WHEN** the postbuild gate runs
- **THEN** the build SHALL fail: the route is not anchored on an origin and path, and it matches
  `/feed.json?preview=/images/books/`

#### Scenario: A route caches a gated feed

- **GIVEN** a build whose worker registers a NetworkFirst route matching `https://jonathanlloyd.me/feed.xml`
- **WHEN** the postbuild gate runs
- **THEN** the build SHALL fail, naming the route and the gated URL it matches

#### Scenario: The purge import fails on upgrade

- **GIVEN** a returning visitor whose old worker left gated data in `live-data` and `local-images`
- **WHEN** the new worker cannot import `/js/sw-purge.js` and never activates
- **THEN** the next page load SHALL still delete both caches from the page

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
gated URL must be NetworkOnly. Each textual `registerRoute(` call site is instrumented and must run
exactly once while the worker is inspected, and a `registerRoute` reached by a computed name fails.
Two function matchers are allowed, each spelled exactly: the navigation test `({request}) =>
request.mode === 'navigate'`, and the same-origin pathname test of "No service-worker path caches a
gated response". Every other matcher SHALL be an anchored regex literal, because no evaluation can
prove what an arbitrary function matches. A navigation to a gated URL with any query string reaches
this NetworkOnly route, so it is never answered from a cache; offline it gets only `/offline`. In
Chromium, `tests/behavioral/offline-navigation.spec.ts` proves the
behavior: an online navigation to `/` reaches the server and no cache gains a document or a gated
entry, and with the server down or the browser offline, `/` and `/privacy` render the data-free
page.

Verified by `tests/unit/sw-privacy.test.ts:572` (the shipped shape passes; no navigation route, a
NetworkFirst or fallback-less navigation route, a fallback to another URL, a second fallback route, a
catch handler, a default handler, a NavigationRoute, a function route caching a feed, an unmodelled
Workbox API, a NetworkOnly route carrying any option but `plugins`, a missing `/offline` and any
other precached document each fail) and
`tests/build/sw-update.test.ts:66` (the built `/offline` document is data-free and is the only
precached document).

#### Scenario: A returning visitor navigates while offline

- **GIVEN** a visitor whose browser holds the current service worker
- **WHEN** they navigate to `/` with no network
- **THEN** the worker SHALL answer with the precached `/offline` page, which shows no data

#### Scenario: A visitor navigates while online

- **GIVEN** the same visitor with network
- **WHEN** they navigate to `/`
- **THEN** the request SHALL reach the network and no cache SHALL gain a document or a gated entry

### Requirement: No page prefetches gated data

No built page SHALL emit a `<link rel="prefetch">` or `<link rel="preload">` for a CloudFront export.
A prefetch stores the export in the browser HTTP cache (`health.json` is served `max-age=30`), where
it can outlive the moment the owner hides it, and the client never reads that copy: every runtime read is `cache: 'no-store'`. The layout keeps a
`preconnect` to CloudFront, which warms the connection and stores no data. The data-free `/offline`
page has no preconnect either.

Verified by `tests/build/sw-update.test.ts:107` (every built HTML page is checked).

#### Scenario: The dashboard loads

- **GIVEN** the built `/`, `/privacy`, `/404` and `/offline`
- **WHEN** their markup is read
- **THEN** none SHALL prefetch or preload a CloudFront URL

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

### Requirement: Leaving a hiding mode releases every suppressed card and System Status row

A card or System Status row that a server rendered `suppressed` (`data-ssr-state="suppressed"`)
refuses every data update in `@j0nathan-ll0yd/web` 4: only the focus gate may release it, with
`releaseSuppression`. When the page learns that hiding ended, it SHALL release every suppressed
live card and every suppressed System Status row BEFORE it asks the poll engine to refetch, so
the refetch can fill them. At startup, a focus read that decodes to a visible value with no gated
path suppressed SHALL release them the same way, before the first writes: a page rendered during
hiding and opened after it ended never sees a hiding value to leave. An unreadable or hiding first
read SHALL release nothing, and while a hiding mode continues nothing is released. A card that was
never suppressed keeps its own state. The data-free `/` renders nothing suppressed today; a
server-rendered `/` (decision 0160, PR B) does.

Verified by `tests/unit/live-data.web4.test.ts:117` (release before the refetch; nothing released
during a Work-to-Do-Not-Disturb swap; release at a visible startup and none at an unreadable or
hiding one; a released row takes live status again).

#### Scenario: Focus turns visible over a server-suppressed page

- **GIVEN** a page whose cards and System Status rows render `suppressed`
- **WHEN** a visible focus value arrives
- **THEN** each SHALL read `unavailable` when the refetch starts, and the next update SHALL fill
  it

#### Scenario: A page rendered during hiding opens after hiding ended

- **GIVEN** a page whose cards render `suppressed`
- **WHEN** its first focus read decodes a visible value and no gated path answers with a
  suppression body
- **THEN** each suppressed card and row SHALL be released before the first data write
