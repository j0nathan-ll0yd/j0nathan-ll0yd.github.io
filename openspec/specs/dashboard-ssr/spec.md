# Dashboard Server Render

## Purpose

State what `GET /` reads, composes and answers (atlas decision 0160, PR B; site issue #132). Since
PR B, `GET /` carries the owner's real data, or an honest state per card, for every client: AI
answer agents, link previews and browsers with scripting off read the same document as a browser
that runs the client runtime.

The page is precomposed as the data changes, like llms.txt, and the live site supplies the composer
(owner decisions 2026-10-16). Each website build ships its composer as a public static asset
(`/_ssr/composer-<build>.mjs`, built by scripts/build-composer.mjs from src/lib/composed/compose.ts)
and names it, with its sha256 and the contract version, in `/version.json`. One helper,
scripts/lib/build-id.mjs, gives the build id to version.json, the composer and the Worker. A backend
runner fetches version.json, then the composer, checks the hash, imports it and calls
`composeDashboard`. The composer reads the focus signal and the eight exports through the PUBLIC
gated CloudFront URLs with the loader below (src/lib/data-plane/loader.ts), renders the live cards,
the focus overlays and System Status with the design system's components, and returns the
`/dashboard.json` artifact, which the runner stores behind the gate. The runner holds no read
credential.

The Worker reads the artifact through the edge proxy (src/lib/composed/read.ts: focus probe first,
the admission rules, no-store, no last-known-good copy, a 2.5 s budget), checks it
(src/lib/composed/artifact.ts: schema, age, future skew, composer build, hiding focus, fragments,
record) and splices its fragments into the prerendered data-free page (src/lib/composed/shell.ts,
src/lib/data-plane/ssr-response.ts). The Worker renders nothing. The data-free page
(`dashboard-shell` capability) stays the fallback, the `HEAD /` answer and the rollback target (D9).

The loader requirements below (gate, focus, failed read, I/O budget) describe the composer's reads.

Render proof is behavioral DOM assertion, never screenshot comparison. A baseline minted by the
change it verifies is not evidence (D10).

## Requirements

### Requirement: The server render reads every export through the gate

The loader SHALL read the focus signal first, then the eight gated exports, each with
`cache: 'no-store'`, no Cloudflare cache option and no redirect. It SHALL admit a gated value only
from a 200 that CloudFront served for that path in this request: a 200 that Cloudflare served from
its own cache (`cf-cache-status` HIT, STALE, UPDATING or REVALIDATED), a 200 with no `x-amz-cf-id`,
a 2xx other than 200 and a redirect SHALL make that export `unavailable`. The proxy routes and the
loader share these rules (src/lib/data-plane/admission.ts).

Verified by `tests/unit/data-plane-loader.test.ts:102` (no-store reads, focus first) and
`tests/unit/data-plane-loader.test.ts:210` (every Cloudflare cache status refused).

#### Scenario: Cloudflare serves a gated export from its own cache

- **GIVEN** the focus signal reads visible
- **WHEN** the health export answers 200 with `cf-cache-status: HIT`
- **THEN** the health export SHALL be `unavailable` with reason `cloudflare-cache`, and the other
  exports SHALL be admitted

### Requirement: The gate wins every disagreement

A hiding focus value (`Work`, `Do Not Disturb`) SHALL suppress every gated domain, and the loader
SHALL fetch no gated export. A focus body that fails its contract but still names a hiding mode
SHALL suppress too. Under a visible focus value, a 403 with the gate's suppression body from ANY
export SHALL suppress every domain: no value a sibling read admitted reaches the page. A 403 that
CloudFront served (`x-amz-cf-id`) but whose body cannot be read in time SHALL suppress too (fail
closed). System Status
SHALL then name no source age. This covers the three disagreements the backend's focus-privacy
spec allows: the gate shut before the signal is published, a failed publication that leaves the
gate shut over a visible signal, and KeyValueStore propagation.

Verified by `tests/unit/data-plane-loader.test.ts:127` (gate shut over a visible signal),
`tests/unit/data-plane-loader.test.ts:143` (one 403 during propagation) and
`tests/unit/data-plane-loader.test.ts:156` (a hiding focus value fetches nothing), and in a scripts-off
browser by `tests/behavioral/ssr-no-js.test.ts:263` (one 403 suppresses the page) and
`tests/behavioral/ssr-no-js.test.ts:320` (each hiding mode: the overlay shows, nothing is read, no
gated value is in the DOM).

#### Scenario: A failed focus publication

- **GIVEN** the focus signal reads visible and every gated export answers the suppression body
- **WHEN** the page renders, on this and every later request
- **THEN** every live card SHALL render `suppressed`, the summary SHALL be `suppressed`, and the
  view models SHALL hold no export value

### Requirement: An unreadable focus signal fails closed

A focus read that times out, fails, answers an error status, carries malformed JSON or a body that
fails its contract (and names no hiding mode), or arrives from a Cloudflare cache SHALL make every
gated domain `unavailable`. The loader SHALL fetch no gated export, and the overlays SHALL stay
hidden.

Verified by `tests/unit/data-plane-loader.test.ts:196`.

#### Scenario: The focus signal times out

- **GIVEN** the focus read does not answer within its 1 s bound
- **WHEN** the page renders
- **THEN** every live card SHALL render `unavailable`, the summary SHALL be `unavailable`, and no
  gated export SHALL be requested

### Requirement: A failed read marks one export, with no retry and no stored copy

A failed export read (408, 429, any 5xx, a timeout, a stalled body, malformed JSON, a contract
violation, a non-suppression 403) SHALL make that export `unavailable` and leave every other export
as read. The loader SHALL make one attempt per export and SHALL read no last-known-good copy (D3).

Verified by `tests/unit/data-plane-loader.test.ts:234`.

#### Scenario: One export answers 503

- **GIVEN** the GitHub events export answers 503
- **WHEN** the page renders
- **THEN** the Dev Log card SHALL render `unavailable`, the other cards SHALL render from their
  exports, and the events export SHALL have been requested once

### Requirement: Every read ends within the I/O budget

Every read SHALL end within its bound, and an export still unread at the budget SHALL be
`unavailable`. The loader's default bounds are 1 s for the focus read, 2 s per export and 2.5 s for
every read of one load (D2); a runtime may hold six open connections, so two of the eight reads may
wait in its queue. The composer runs in a backend runner with a 60 s run, so it reads with 5 s, 10 s
and 20 s (src/lib/composed/compose.ts `RUNNER_TIMEOUTS`).

Verified by `tests/unit/data-plane-loader.test.ts:301`.

#### Scenario: Every export is slow

- **GIVEN** every export takes longer than the budget, six at a time
- **WHEN** the page renders
- **THEN** the loader SHALL answer by the budget with every export `unavailable`

### Requirement: Each card renders one honest state

Each live card SHALL render exactly one state, `live`, `stale`, `empty`, `unavailable` or
`suppressed`, decided by the design system's shared rules. A readable export is `live` up to its
registry `audit.warn` age and `stale` beyond it, with an absolute "as of" time (D8). A valid export
with an empty list is `empty`, not a failure. An export older than its `audit.error` age stays
`stale` and the render record names it as degraded.

Verified by `tests/unit/data-plane-loader.test.ts:283` (an empty list) and
`tests/unit/data-plane-loader.test.ts:290` (an old source), and per export in a scripts-off browser by
`tests/behavioral/ssr-no-js.test.ts:235` (5xx, malformed, old and empty answers, with `data-ssr-state`,
the meta and `X-SSR-Data` in agreement).

#### Scenario: An old export

- **GIVEN** the articles export is 30 days old
- **WHEN** the page renders
- **THEN** the Reading Feed card SHALL render `stale` with the export's `generatedAt`, and the
  render record SHALL list `articles` as degraded

### Requirement: Rendered values equal the decoded exports

For each live card, named DOM fields SHALL equal the projection of its export: the heart rate
rounded, the newest dev-log title, the first starred repository, the first shelf title in the
documented sort, the newest article title, the workout count, and the other fields the widgets
document. Production is checked daily by web audit B11, through an oracle that imports none of the
shared adapters.

Verified by `tests/behavioral/ssr-no-js.test.ts:90` (the `ssrKnownAnswer` fixture variation, whose
distinctive values occur in no other variation, `tests/build/ssr-known-answer.test.ts`).

#### Scenario: A client without JavaScript reads the dashboard

- **GIVEN** the data plane serves the known-answer exports
- **WHEN** a browser with JavaScript disabled loads `/`
- **THEN** every live card SHALL show the exact projection of its export

### Requirement: The server render carries no fixture and no location value

The server render SHALL carry no value from the legacy fixture baselines (computed as that set minus
every known-answer value, so a correct render cannot trip it), none of the five rows the focus
overlay used to hard-code, and no coordinates, place or visit data (D14). Authored identity copy,
such as the Person address, is allowed. Production builds cannot reach `@j0nathan-ll0yd/fixtures`
(the `forbid-fixtures` build plugin).

Verified by `tests/behavioral/ssr-no-js.test.ts:185` (legacy markers and retired overlay rows) and
`tests/behavioral/ssr-no-js.test.ts:214` (D14).

#### Scenario: A crawler reads the dashboard

- **GIVEN** the data plane serves real exports
- **WHEN** a client without JavaScript loads `/`
- **THEN** the HTML SHALL contain no legacy fixture value and no location data

### Requirement: A missing measurement renders as no reading

A measurement the export did not carry SHALL reach the view models as `null`, which the widgets
render as the no-reading mark, never as `0`.

Verified by `tests/unit/data-plane-loader.test.ts:269`.

#### Scenario: A sparse health export

- **GIVEN** a schema-valid health export without water and caffeine
- **WHEN** the page renders
- **THEN** the Hydration view model SHALL hold `null` for both, not `0`

### Requirement: One summary names the page state

The render SHALL compute one summary from the ten live cards' final states, first match wins:
`suppressed` (any suppression signal), `unavailable` (every card unavailable), `live` (every card
live or empty), `stale` (every card live, empty or stale, at least one stale), else `partial`. The
`X-SSR-Data` header and `<meta name="ssr-data">` SHALL carry the same value. The Worker adds two
values of its own: `fallback` and `error`.

Verified by `tests/unit/data-plane-loader.test.ts:336`.

#### Scenario: One card unavailable among live cards

- **GIVEN** nine live cards and one unavailable card
- **WHEN** the summary is computed
- **THEN** it SHALL be `partial`

### Requirement: Every data state answers 200 and no shared cache stores the document

`GET /` SHALL answer 200 for every summary (D13): an all-unavailable dashboard still carries the
authored identity content and honest per-card states. The answer SHALL carry
`Cache-Control: no-cache`, `CDN-Cache-Control: no-store`, `Cloudflare-CDN-Cache-Control: no-store`
(D3: no edge HTML cache) and `Content-Type: text/html; charset=utf-8`, plus the site middleware's
headers (security headers, `Link`, `Vary: Accept`, `No-Vary-Search`).

Verified by `tests/unit/ssr-response.test.ts:124`.

#### Scenario: Every export is unavailable

- **GIVEN** the data plane is down
- **WHEN** a client requests `/`
- **THEN** the Worker SHALL answer 200 with `X-SSR-Data: unavailable`, and no shared cache SHALL
  store it

### Requirement: Card labels and ages are as of composition, at most 11.5 minutes old

A composed card's state (`live`, `stale`) and every relative age the artifact renders (System Status
`<time>` text) are judged when the composer runs, not when the Worker serves. The runner composes on
every export update and on a 5-minute backstop (owner decision 2026-10-16). With the runner healthy,
a label trails the truth by at most 5 minutes plus up to 1.5 minutes of publish and TTL: the run
timeout of 60 s and the CloudFront TTL of 30 s. The Worker SHALL refuse an artifact older than
690,000 ms (`COMPOSED_MAX_AGE_MS`, 11.5 minutes: one missed backstop run tolerated, 2 x 5 minutes,
plus the 60 s run timeout, plus the 30 s TTL) and SHALL serve the data-free page as `fallback`. A
browser with JavaScript re-judges each card and age on load.

Verified by `tests/unit/composed-read.test.ts:150`.

#### Scenario: The runner stops

- **GIVEN** the newest artifact was composed 12 minutes ago
- **WHEN** a client requests `/`
- **THEN** the Worker SHALL answer the data-free page with `X-SSR-Data: fallback`

### Requirement: The Worker serves only an artifact its own build composed

The Worker SHALL splice an artifact only when the artifact's `composer.build` equals the Worker's
own build id, and SHALL serve the data-free page as `fallback` otherwise. version.json, the shipped
composer and the Worker SHALL take the build id from one helper (scripts/lib/build-id.mjs), and
version.json SHALL name the shipped composer's path, its sha256 and the contract version. So a site
deploy never shows a page another build's composer made; `/` stays data-free until the runner
composes with the new build's composer (at most one backstop run, 5 minutes).

Verified by `tests/unit/composed-read.test.ts:156` (another build's artifact is refused) and
`tests/build/worker-output.test.ts:83` (version.json names the shipped composer, its hash and the build).

#### Scenario: The site deploys

- **GIVEN** the newest artifact names build N
- **WHEN** the Worker of build N+1 serves `/`
- **THEN** it SHALL answer the data-free page with `X-SSR-Data: fallback` until an artifact of build
  N+1 exists

### Requirement: A composition never outlives a focus change or a site deploy

Two privacy races SHALL publish or serve nothing stale. (a) Focus turns hiding during a composition:
the composer SHALL read the focus signal again after rendering and SHALL refuse (`focus-changed`)
unless it reads the same visible value; an artifact published before the change holds pre-hiding values, and
the gate blocks it while focus hides. (b) The site deploys during a composition: the artifact names
the old build, and the Worker of the new build SHALL refuse it (the lockstep requirement above).

Verified by `tests/oracle/composer-parity.test.ts:350` (race a) and
`tests/unit/composed-read.test.ts:157` (race b).

#### Scenario: Focus turns hiding while the page renders

- **GIVEN** the composer read a visible focus value and is rendering
- **WHEN** the focus value turns `Work` before it returns
- **THEN** it SHALL return the refusal `focus-changed`, and the runner SHALL store nothing

### Requirement: A hiding or unreadable focus value answers the build's value-free page

While the focus value hides, the gate is shut over a visible value, or the focus signal cannot be
read, `GET /` SHALL answer a value-free page: the data-free page with the website build's value-free
fragments spliced in (src/lib/composed/value-free.ts, built by `scripts/build-composer.mjs
--value-free`). A hiding value SHALL show its own overlay and every card `suppressed`; the gate SHALL
show every card `suppressed` and no overlay; an unreadable focus SHALL show every card `unavailable`
and no overlay. The page SHALL hold no export value and no source age, and SHALL NOT depend on the
build's clock (the overlay clock stays `--:--:--` until the browser fills it). When the value-free
pages cannot be used, the data-free page SHALL answer with the same summary. A public request for the
value-free asset (`/_ssr/value-free.json`) SHALL get the 404 page.

Verified by `tests/unit/ssr-response.test.ts:183` (each variant, its summary and its fragments), and by
`tests/oracle/composer-parity.test.ts:241` (each variant equals the Astro render, holds no
`data-generated-at`, and is the asset the build shipped).

#### Scenario: The owner turns on Do Not Disturb

- **GIVEN** the focus value reads `Do Not Disturb`
- **WHEN** a client without JavaScript requests `/`
- **THEN** the Worker SHALL answer 200 with `X-SSR-Data: suppressed`, the Do Not Disturb overlay
  shown, every card `suppressed`, and no export value, and SHALL fetch no composed artifact

### Requirement: A render that misses its budget falls back to the data-free page

The Worker SHALL bound the whole render by 3 s: 2.5 s of I/O plus a 0.5 s render reserve (D2). A
render that misses it, a stalled document stream included, SHALL be answered with the prerendered
data-free page, status 200, `X-SSR-Data: fallback`, and no asset validators.

Verified by `tests/unit/ssr-response.test.ts:229`.

#### Scenario: The render never completes

- **GIVEN** the render has not produced a document within 3 s
- **WHEN** the ceiling passes
- **THEN** the client SHALL receive the data-free page with `X-SSR-Data: fallback`

### Requirement: A render exception answers a clean 500

The Worker SHALL buffer the rendered document before it answers. A render exception, before the
first byte or in the middle of the stream, SHALL answer the prerendered 500 page (src/pages/500.astro)
with status 500, `Cache-Control: no-store` and `X-SSR-Data: error`. A client SHALL never receive a
200 whose document stops half-way. The 500 page carries no live widget, no gated value and no
fixture value.

Verified by `tests/unit/ssr-response.test.ts:245`.

#### Scenario: A widget throws while the stream renders

- **GIVEN** the document stream fails after its first bytes
- **WHEN** the Worker reads it
- **THEN** the client SHALL receive status 500 and the 500 page, and none of the partial document

### Requirement: HEAD reads no data

`HEAD /` SHALL answer from the data-free page's headers with the dashboard cache policy. It SHALL
read no export and render nothing, and it SHALL omit `X-SSR-Data`, whose value exists only once a
body is rendered (RFC 9110 section 9.3.2).

Verified by `tests/unit/ssr-response.test.ts:259`.

#### Scenario: A link checker sends HEAD

- **GIVEN** the Worker serves `/`
- **WHEN** a client sends `HEAD /`
- **THEN** the Worker SHALL answer 200 with no body and no `X-SSR-Data`, and SHALL request no
  export

### Requirement: Each render logs one value-free line

Each `GET /` SHALL emit one JSON log line with `event: "ssr_render"`: the summary, the focus state
(`visible`, `hiding`, `unreadable`), each export's read outcome, each card's state, the degraded
exports, `io_ms`, `render_ms`, `total_ms`, the status and the build id. The line SHALL carry no
data value.

Verified by `tests/unit/ssr-response.test.ts:146`.

#### Scenario: A healthy render

- **GIVEN** a visible focus signal and readable exports
- **WHEN** a render completes
- **THEN** exactly one `ssr_render` line SHALL be written, naming states and timings only

### Requirement: One document serves every client

The render SHALL NOT branch on the client: no code on the render path reads `User-Agent`, Client
Hints or any browser state. A crawler and a browser receive the same document for the same data.

Verified by `tests/unit/data-plane-config.test.ts:107` (no client identity on the render path) and
`tests/behavioral/ssr-no-js.test.ts:382` (the head of the render equals the data-free page's).

#### Scenario: A crawler and a browser request `/`

- **GIVEN** the same exports
- **WHEN** a crawler and a browser request `/`
- **THEN** both SHALL receive the same card states and values

### Requirement: Test seams never reach production

The fixture data plane (`DATA_PLANE_BASE`) and the Step 6.10 fault and clock headers
(`SSR_FAULT_INJECTION`, `X-SSR-Fault`, `X-SSR-Clock`) are for tests and the access-guarded preview
only. A fault or clock header SHALL take effect only when the Worker variable is `1` AND the host is
a `*.workers.dev` Version URL or a loopback host. `DATA_PLANE_BASE` SHALL take effect only on those
hosts too: the admission rules trust `x-amz-cf-id`, which any server can send, so production SHALL
read CloudFront whatever the variable says (a Worker secret escapes the deploy guard). The production deploy job SHALL fail when the
built Worker config or its environment sets either variable (scripts/check-deploy-vars.mjs).

Verified by `tests/unit/data-plane-config.test.ts:43` (both locks) and
`tests/unit/data-plane-config.test.ts:97` (the deploy guard).

#### Scenario: A request to production carries a fault header

- **GIVEN** a request to jonathanlloyd.me with `X-SSR-Fault: stall`
- **WHEN** the page renders
- **THEN** the fault SHALL have no effect, whatever the Worker variable says

### Requirement: Live updates never repaint equal or older data over server output

The client runtime SHALL compare generations as instants. It SHALL repaint a card only from an
export whose `generatedAt` is strictly newer than the card's server-rendered `data-generated-at`,
or than the last export it applied. An equal or older export, at startup or from a later poll,
SHALL change no data-bearing node. Hydration SHALL keep a server value with no count-up.

Verified by `tests/unit/live-data.handoff.test.ts:193` (older, equal, newer per export),
`tests/unit/live-data.handoff.test.ts:265` (an older poll from a lagging edge),
`tests/unit/live-data.handoff.test.ts:346` (Hydration) and
`tests/unit/live-data.handoff.test.ts:393` (zero value mutations with unchanged data).

#### Scenario: A poll returns the generation the server rendered

- **GIVEN** a card the server rendered `live` from generation G
- **WHEN** the client reads generation G again
- **THEN** no data-bearing node of that card SHALL change

### Requirement: Cards that read two exports repaint from the newest pair

A sleep-only update SHALL repaint Night Summary and the Heart Rate footer from the newest health
and sleep exports the client holds.

Verified by `tests/unit/live-data.handoff.test.ts:309`.

#### Scenario: Only the sleep export changes

- **GIVEN** the client holds a health export and a newer sleep export arrives
- **WHEN** the update applies
- **THEN** Night Summary and the Heart Rate footer SHALL reflect the newest pair

### Requirement: Hiding clears server-rendered values

Server-rendered `live` and `stale` values and System Status ages are gated values in the DOM. When
an open tab learns of a hiding mode or a gate suppression, it SHALL remove them, by reloading to a
fresh render. The tab SHALL reload at most once per 15 s, so a gate disagreement across edges
cannot loop renders. While a reload is held, the tab SHALL clear every gated value in place at once
(each live card to its suppressed state, System Status ages, canvas data attributes, the book
modal), then reload at the end of the window; a held reload is never dropped (D12b: gated DOM
values clear on suppression).

The browser suite for the service worker (`sw-ssr-privacy`, under tests/behavioral) runs the real
worker against the server render and finds no gated value replayed.

Verified by `tests/unit/live-data.handoff.test.ts:476` (a startup that reads a hiding focus) and
`tests/unit/live-data.handoff.test.ts:492` (the reload window).

#### Scenario: Focus turns hiding in an open tab

- **GIVEN** a page the server rendered with live values
- **WHEN** the tab reads a hiding focus value
- **THEN** the tab SHALL reload, and the new render SHALL carry no gated value
