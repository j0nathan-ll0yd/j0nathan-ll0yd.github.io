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
credential. The artifact also carries `facts`: what the Worker's own fragment check
(src/lib/composed/artifact.ts `checkFragments`) reads from its fragments, as plain arrays (atlas
decision 0164). The Worker's read of `/dashboard.json` ignores the field. Each build also cuts the
data-free page at build time into a generated module (scripts/build-shell.mjs) that the Worker
compiles in. With the `PAGE` KV binding (wrangler.jsonc) the Worker serves `GET /` from the
published page data instead of the artifact: the `focus` key and the `fragments:<build>` entry the
backend publishes, spliced into that compiled shell (src/lib/composed/published.ts; the two
requirements below that name the published read).

The Worker reads the artifact with the edge proxy's rules (src/lib/composed/read.ts and
src/lib/edge/proxy.ts `readGatedConcurrently`: the focus probe and the artifact fetch in flight
together, the focus value deciding first, the admission rules, no-store, no last-known-good copy, a
2.5 s budget), checks it
(src/lib/composed/artifact.ts: schema, age, future skew, composer build, hiding focus, record, and
each fragment against the markup allowlist in src/lib/composed/fragment-policy.ts) and splices its fragments into the prerendered data-free page (src/lib/composed/shell.ts,
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
browser by `tests/behavioral/ssr-no-js.test.ts:321` (one 403 suppresses the page) and
`tests/behavioral/ssr-no-js.test.ts:379` (each hiding mode: the overlay shows, no export is read, no
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
`tests/behavioral/ssr-no-js.test.ts:293` (5xx, malformed, old and empty answers, with `data-ssr-state`,
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

Verified by `tests/behavioral/ssr-no-js.test.ts:95` (the `ssrKnownAnswer` fixture variation, whose
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

Verified by `tests/behavioral/ssr-no-js.test.ts:243` (legacy markers and retired overlay rows) and
`tests/behavioral/ssr-no-js.test.ts:272` (D14).

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
authored identity content and honest per-card states. Every answer SHALL carry
`CDN-Cache-Control: no-store` and `Cloudflare-CDN-Cache-Control: no-store` (D3: no edge HTML cache)
and `Content-Type: text/html; charset=utf-8`, plus the site middleware's headers (security headers,
`Link`, `Vary: Accept`, `No-Vary-Search`). The composed page carries gated values, so it SHALL carry
`Cache-Control: no-store` (`COMPOSED_CACHE_HEADERS`, the policy of every gated proxy route,
`LLM_OUTPUT_CACHE_POLICY`): a browser SHALL NOT write it to disk or replay it from history or session
restore after the focus value turns hiding. The data-free page and the value-free pages carry no
export value and SHALL carry `Cache-Control: no-cache` (`DASHBOARD_CACHE_HEADERS`).

Verified by `tests/unit/ssr-response.test.ts:146` (every summary answers 200),
`tests/unit/ssr-response.test.ts:153` (the composed page is no-store at all three layers), and
`tests/unit/ssr-response.test.ts:192` (the data-free page keeps no-cache).

#### Scenario: Every export is unavailable

- **GIVEN** the data plane is down
- **WHEN** a client requests `/`
- **THEN** the Worker SHALL answer 200 with `X-SSR-Data: unavailable`, and no shared cache SHALL
  store it

#### Scenario: A browser restores a session after the focus value turns hiding

- **GIVEN** a browser loaded the composed page while the focus value was visible
- **WHEN** the focus value turns `Work` and the browser restores the session
- **THEN** the browser SHALL hold no stored copy of the composed page to replay, because the
  composed page was `Cache-Control: no-store`

### Requirement: Card labels and ages are as of composition, at most 11.5 minutes old

A composed card's state (`live`, `stale`) and every relative age the artifact renders (System Status
`<time>` text) are judged when the composer runs, not when the Worker serves. The runner composes on
every export update and on a 5-minute backstop (owner decision 2026-10-16). With the runner healthy,
a label trails the truth by at most 5 minutes plus up to 1.5 minutes of publish and TTL: the run
timeout of 60 s and the CloudFront TTL of 30 s. The Worker SHALL refuse an artifact older than
690,000 ms (`COMPOSED_MAX_AGE_MS`, 11.5 minutes: one missed backstop run tolerated, 2 x 5 minutes,
plus the 60 s run timeout, plus the 30 s TTL) and SHALL serve the data-free page as `fallback`. A
browser with JavaScript re-judges each card and age on load.

Verified by `tests/unit/composed-read.test.ts:132`.

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

Verified by `tests/unit/composed-read.test.ts:138` (another build's artifact is refused) and
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

Verified by `tests/oracle/composer-parity.test.ts:457` (race a) and
`tests/unit/composed-read.test.ts:139` (race b).

#### Scenario: Focus turns hiding while the page renders

- **GIVEN** the composer read a visible focus value and is rendering
- **WHEN** the focus value turns `Work` before it returns
- **THEN** it SHALL return the refusal `focus-changed`, and the runner SHALL store nothing

### Requirement: The Worker splices only allowlisted markup

The artifact is not authenticated: any writer of the data-plane bucket can replace it. So the Worker
SHALL splice a fragment into the page only when a strict tokenizer (src/lib/composed/fragment-policy.ts
`checkFragment`) reads it as markup the design system's components could have rendered. This is the
Worker-side guarantee. It SHALL admit only:

- elements on the allowlist: HTML `a`, `button`, `canvas`, `div`, `h2`, `h3`, `img`, `li`, `p`,
  `picture`, `source`, `span`, `time`, `ul`; inside `svg` only `svg`, `circle`, `line`, `path`,
  `rect`, `defs`, `filter`, `feGaussianBlur`, `feMerge`, `feMergeNode`;
- per element, attributes on the allowlist: `class`, `id`, `hidden`, `role`, `tabindex`, the
  `aria-*` names the components emit (`aria-details`, `aria-hidden`, `aria-label`, `aria-live`), one
  `data-astro-cid-*` (no value), the `data-*` names the components emit, and the element's own
  (`href`, `rel`, `target` on `a`; `src`, `srcset`, `alt`, `width`, `height`, `loading`, `decoding`,
  `referrerpolicy` on `img`; `datetime` on `time`; the SVG geometry and paint attributes), each
  value double-quoted, no attribute twice, at most 24 per element, `width` and `height` at most
  480 px or 100 percent;
- class tokens from the allowlist of the fragment's own component (src/lib/composed/fragment-classes.ts,
  keyed by fragment id), because the page CSS styles some classes as fixed full-viewport layers or
  fixed badges, and one card SHALL NOT draw another component's indicator;
- scoped-style hashes that the fragment's own slot carries in the data-free page (the shell records
  them per slot), so a fragment cannot borrow another component's scoped styles;
- each `data-*` value in the grammar of what the client runtime parses from it: `data-book` in the
  closed shape Bookshelf.astro writes (the Book modal writes several of its fields into `innerHTML`
  unescaped, so those are numbers or closed words; the link names `www.amazon.com`; the covers are
  first-party images), `data-generated-at` an ISO instant no later than the composition stamp plus
  5 minutes, `data-local-covers` and `data-fallback` first-party images, `data-hydration-fixture`
  plain numbers and words, `data-stroke` a paint, the rest closed words;
- an `href` that is a same-origin path or `https` to an allowlisted host (`github.com`,
  `coasttocoastreviews.com` with or without `www.`, the Workouts share link host `share.barrys.com`,
  and the System Status hosts `www.apple.com`, `www.livelarq.com`, `acaia.co`, `feedly.com`,
  `www.squarespace.com`), with no credentials, port, or percent-encoded dot, slash or backslash;
  `target="_blank"` only with `rel` naming `noopener`; `rel` tokens only `noopener`, `noreferrer`
  and, on the Bookshelf tile link alone, `sponsored`, split on ASCII whitespace as HTML splits them,
  with no character reference and no other whitespace character (U+00A0 and the Unicode spaces) in
  the value;
- one exception, the Bookshelf tile link (web 4.6.0, atlas decision 0160 D5): an `a` in `cardBooks`
  whose raw `class` is exactly `shelf-book-link`, `target` exactly `_blank` and `rel` exactly
  `sponsored noopener noreferrer` may name the href the design system's `amazonBookUrl` builds:
  `https://www.amazon.com/dp/` and exactly ten upper-case letters or digits, then exactly the
  affiliate query `?tag=lifegames04-20&linkCode=ll2&language=en_US&ref_=as_li_ss_tl`
  (`BOOK_LINK`, `BOOK_LINK_QUERY`); `www.amazon.com` is not an allowlisted host, so the same href
  outside this shape and the article link's is refused (`url`), and `sponsored` on any other link is
  refused (`attribute`, or `url` where an any-host href then misses the article shape);
- one exception, the Reading card's article link (OWNER DECISION PENDING, option A): an `a` in
  `cardReading` whose raw `class` is exactly `article-list-title`, `target` exactly `_blank` and `rel`
  exactly `noopener noreferrer` may name any `https` URL the design system emits for an article: it
  starts `https://` in any case, holds no control character or backslash, parses as https with no
  credentials and the default port, names a DNS host (two or more labels, an alphabetic or punycode
  last label, so no IP literal) that is not the site, the data plane or `*.workers.dev`, and is at
  most 2,048 characters (`ARTICLE_LINK`, `MAX_ARTICLE_HREF`); the same href anywhere else is refused
  (`url`, or `attribute` where the element carries no `href`);
- a `title` attribute on a `span` only (the Reading card's note icon), escaped (no raw `<` or `>`),
  at most 16,384 characters (`MAX_TITLE`);
- a `src` or `srcset` URL that is a same-origin `/images/` path or the data plane's `/images/`, with
  no dot segment, encoded or not, and a `srcset` with no whitespace character but ASCII whitespace;
- a `style` attribute whose every declaration names an allowlisted property with a value in that
  property's grammar (sizes up to 480 px or 100 percent, `position: relative` only, no `url()`, no
  escape, no `!important`), because the components emit `style` for bar widths, delays and
  skeletons;
- `popover` only on System Status's tooltip (`div.sys-tooltip` in `cardSystem`) with no `style`,
  because the UA styles `[popover]` as a fixed full-viewport layer that any author `display` shows;
- exactly one `div` root whose `id` is the fragment's id, with no `style` or `popover` (a
  value-free page alone may show its hiding value's overlay root, `display: flex`), plus, for
  Hydration only, its empty hidden data carrier `#cardHydrationData` with no other attribute;
- a root that keeps its slot root's shape in the data-free page: the first class token (`tri-card`
  for a card, the containing block of the card's own absolute layers; `left-panel-status` for System
  Status) and the slot root's scoped-style hash (an overlay's hash is what keeps it `display: none`);
  the root's class tokens SHALL be only its kind, its state (`is-paused`) and its data accents
  (`FRAGMENT_ROOT_CLASS_TOKENS`), never one of its component's absolute layers; and the built page
  SHALL keep `.tri-card` a containing block (`container-type`, `overflow: hidden`);
- at most 32 levels of nesting, and an artifact of at most 128 KiB (`COMPOSED_MAX_BYTES`; measured
  2026-10-16: the largest oracle scenario 79,245 bytes, the live artifact 78,092), refused as
  `oversize` before it is decoded or parsed.

It SHALL refuse a comment, a doctype, a processing instruction, a raw-text or form element
(`script`, `style`, `textarea`, `plaintext`, `noscript`, `iframe`, `template`, `form`, `object`,
`embed`, `link`, `meta`, `base`), an `on*` or unknown attribute, a `javascript:` or `data:` URL (also
when entity-encoded), an element the HTML parser would reparent (a block inside `p`, a link inside a
link, an `li` outside `ul`), an unclosed or mismatched element, an id that two fragments carry, a
card root id inside another fragment, and an id the page keeps outside the cards. On any refusal the
Worker SHALL serve the data-free page as `fallback`, with no partial render, and SHALL log the
fragment and a closed-set reason (`artifact: refused:fragments:<id>:<reason>`), never the offending
text. The composer SHALL apply the same check and SHALL refuse to publish a fragment it fails. Before
that check, the composer SHALL degrade what the Reading card would otherwise fail on, because the
design system links any https article URL and joins notes into one uncapped `title`: a link the
Worker would refuse SHALL render as the title text (`span.article-list-title`, the row kept), and a
note title above 16,384 characters SHALL be cut, ending in an ellipsis
(`src/lib/composed/reading-links.ts`). One named value, `READING_LINKS` in
`src/lib/composed/reading-option.ts`, carries the owner's choice: `allow` (option A) links titles as
above; `strip` (option B) renders every title as text in the composer and turns the Worker's any-host
exception off. The
Worker checks one artifact text once per isolate, and a value-free variant when it is first served.

The allowlist bounds the markup, not the values: a bucket writer can still write any text in a
card, any link to an allowlisted host, and, on the Reading card's article titles only, a link to any
https host, the same power it holds over the exports the client
runtime renders. The allowlist SHALL name only what the components emit: the parity oracle SHALL
fail when an allowlisted element, class token, `aria-*` name, `data-*` name or link host appears in no
render of its fragment, or when a render uses a class token or scoped-style hash its fragment's
allowlist or slot lacks. The oracle SHALL also compose every fixture variation the fixtures package
ships, one export at a time, and fail when any is refused, so a data-driven class or link that no
named scenario reaches cannot turn the composed page off in production.

Verified by `tests/unit/composed-read.test.ts:286` (the first review's seven probes, the reproducers
of the two later review rounds, and the other refusal cases), `tests/unit/ssr-response.test.ts:327`
(the data-free page and the logged reason), `tests/unit/composed-shell.test.ts:82` (a borrowed
scoped-style hash and a page id are refused per slot), `tests/unit/composed-book-link.test.ts:42`
(the Bookshelf tile link's shape, href and `sponsored` bounds), `tests/build/composed-containment.test.ts:16`
(`.tri-card` keeps `container-type` and `overflow: hidden` in the built page), and
`tests/oracle/composer-parity.test.ts:529` (every scenario's artifact, every fixture variation's artifact, the shipped value-free set and
the committed fixture pass; the allowlist names nothing unused; no fragment id is one the built page
keeps outside the cards).

#### Scenario: A bucket writer replaces a card with a full-screen overlay link

- **GIVEN** a visible focus signal and an artifact whose `cardHR` fragment holds
  `<a href="https://evil.example/" style="position:fixed;inset:0">`
- **WHEN** a client requests `/`
- **THEN** the Worker SHALL answer the data-free page with `X-SSR-Data: fallback`, and the log line
  SHALL name `refused:fragments:cardHR:url`

### Requirement: The Worker splices only fragments its own build's composer published, checked by that composer

On the published read (atlas decision 0164, Variant D), the backend runner publishes to
`fragments:<build>` the fragments this build's composer rendered, with the facts the composer's own
fragment check produced (src/lib/composed/compose.ts `checked`: the allowlist above, run by the
composer through src/lib/composed/artifact.ts `checkFragments`) and the summary, and metadata
`{build, composedAt, summary}`. The Worker does not run the allowlist on this path; it trusts the KV
writer. `fitsShell` checks the facts the writer reports about its own fragments, so it catches a
composer and shell of different builds, not a wrong or hostile writer: the guarantee is that only
the backend runner writes the namespace. Fragments the runner published as a value-free page (the
gate, or a hiding value that has since turned visible) are served as they are, under `no-store`,
until the runner's next run replaces them. Under a visible `focus` value it SHALL splice the fragments into the shell compiled into its
own bundle (src/lib/composed/compiled-shell.ts, cut at build time from this build's data-free page)
only when: the value exists; the metadata names the Worker's own build (never `unknown`); its
`composedAt` is at most 690 s old and at most 300 s ahead; the value is at most 512 KiB in UTF-8
bytes; the value is `{fragments, facts, summary}` with every fragment id and a closed-set summary
equal to the metadata's; and the facts fit the compiled shell (src/lib/composed/shell.ts
`fitsShell`). Otherwise it SHALL serve the data-free page with `X-SSR-Data: fallback` and log one
closed-set reason: `fragments-missing`, `fragments-build`, `fragments-stale`, `fragments-future`,
`fragments-oversize`, `fragments-shape`, `fragments-error` or `shell-misfit`. Until atlas decision
0164 Phase 4, a Worker without the binding serves `/` from the artifact under the requirement above.

Verified by `tests/unit/published-read.test.ts:305` (each reason),
`tests/unit/published-read.test.ts:340` (the 512 KiB cap in bytes),
`tests/unit/published-read.test.ts:105` (the fixture entry is admitted) and
`tests/build/shell-cut.test.ts:128` (the compiled shell equals the Worker's own cut of the page).

#### Scenario: Fragments from another build

- **GIVEN** a visible `focus` value
- **WHEN** the `fragments:<build>` metadata names another build
- **THEN** the Worker SHALL serve the data-free page as `fallback` and log `fragments-build`

### Requirement: Gated page data rests only in KV, for at most 690 s

The published read keeps the bound decision 0160 D3 set, as amended by decision 0164 D1 and D4: the
only gated content at rest is the `fragments:<build>` value, in Workers KV with a 690 s TTL. The
`focus` state holds no data value and takes no TTL (atlas decision 0170): the backend writes it on
each change and repairs it within 5 minutes. While the focus value hides, the gate is shut or the signal is unreadable,
each runner run SHALL overwrite `fragments:<build>` with that state's value-free fragments; the last
visible composition stays in KV until that run or the TTL, and the Worker never reads it under a
hiding or unreadable `focus` value (the requirement above on the focus value). The Worker SHALL keep
no copy between requests, open no Cache API, cache no HTML at the edge and schedule no work
(`waitUntil`) after its answer. The published page SHALL carry `Cache-Control: no-store`
(`COMPOSED_CACHE_HEADERS`).

Verified by `tests/unit/published-read.test.ts:276` (no Cache API on any outcome, no `waitUntil`)
and `tests/unit/ssr-response.test.ts:388` (the published page is no-store and its log line holds no
value).

#### Scenario: The owner turns on Work focus

- **GIVEN** `fragments:<build>` holds a visible composition
- **WHEN** the runner next runs under the `Work` value
- **THEN** it SHALL overwrite the key with the Work value-free fragments, and no visible composition
  SHALL rest in KV after that run

### Requirement: The Worker's read spends its whole budget on the focus probe and the artifact

The Worker's read of the artifact keeps no last-known-good copy, so it SHALL NOT reserve the
last-known-good window (`PROXY_TIMEOUTS.lkgReadReserveMs`, 1,000 ms) from its budget. The read SHALL
issue the focus probe and the artifact fetch together, both inside ONE 2.5 s budget
(`COMPOSED_READ_BUDGET_MS`), so it takes about the slower of the two, not their sum (soak,
2026-10-17: the serial probe-then-fetch timed out from colos far from CloudFront). A route that keeps
a copy SHALL still reserve the window and SHALL still probe focus before it fetches. The `ssr_render`
line SHALL carry `focus_ms` and, when the read waited for the artifact, `artifact_ms`.

Verified by `tests/unit/composed-read.test.ts:555` (the reserve),
`tests/unit/composed-read-concurrent.test.ts:138` (both legs at 1,400 ms fit the budget) and
`tests/unit/ssr-response.test.ts:360` (the leg timings in the log line).

#### Scenario: CloudFront answers the artifact slowly

- **GIVEN** the focus probe answers at once
- **WHEN** the artifact answers after 2 s
- **THEN** the Worker SHALL serve the composed page, not the data-free page

#### Scenario: Both legs are slow

- **GIVEN** a visible focus value that answers after 1.4 s
- **WHEN** the artifact also answers after 1.4 s
- **THEN** the Worker SHALL serve the composed page within the 2.5 s budget

### Requirement: The focus value decides before any artifact byte is read

The read SHALL answer exactly as a probe-then-fetch read answers, whatever order the two legs finish
in. The Worker SHALL serve composed data only when the same request read a VISIBLE focus value AND
the artifact answer passed the admission rules (a CloudFront 200, not a suppression body, not served
from the Cloudflare cache, `x-amz-cf-id` present). A suppression body under a visible value SHALL
answer `suppressed` (the gate wins). A hiding value SHALL answer `suppressed` even over an artifact
200 (the signal wins, for the KeyValueStore propagation window): the read SHALL abort a fetch still in
flight, start no further attempt, and cancel a body that arrived without reading, parsing or logging
it. An unreadable value SHALL answer `focus-unreadable` even when the artifact arrived. The read SHALL
open no cache, keep no last-known-good copy and schedule no work (`waitUntil`) after its answer.

On the published read (atlas decision 0164, Variant D; src/lib/composed/published.ts
`readPublished`, used when the Worker has the `PAGE` KV binding and a compiled shell), the focus
value is the `focus` KV key, read with `cacheTtl: 30` beside `fragments:<build>`. The Worker SHALL
judge `focus` first, by four rules (atlas decision 0170):

1. A `focus` value that is missing, malformed, more than 300 s ahead, or a failed read SHALL answer
   the unreadable value-free page.
2. A hiding value SHALL answer that value's value-free page at any age.
3. A visible value with a `publishedAt` within 690 s SHALL admit the fragments by the published
   checks below, whatever their summary.
4. A visible value with a `publishedAt` older than 690 s SHALL admit the fragments by the same
   checks (build, a `composedAt` within 690 s and at most 300 s ahead, the size cap, the shape, the
   summary match, the facts against the shell) and SHALL serve them only when their summary is
   data-bearing (`live`, `stale` or `partial`). Otherwise it SHALL answer the unreadable value-free
   page, never a value-free fragments variant and never the data-free page.

Rule 4 holds the privacy bound of a fresh `focus` value: the composer emits a data-bearing
composition only when its focus read was visible and no gated export answered the suppression body,
so fresh data-bearing fragments prove the owner was visible and the gate open at most 690 s ago. The
backend writes `focus` on every change and repairs it within 5 minutes; it does not refresh it only to
keep it young, and the key does not expire. The Worker requests both keys together, so the fragments
value can arrive in the isolate; under a hiding or unreadable value the Worker SHALL NOT parse,
inspect, splice or log it. The reads have no budget of their own: a read that stalls ends at the 3 s
ceiling, which answers the data-free page as `fallback`, also value-free. A hiding value written by
the focus writer SHALL reach a colo within the 30 s read cache plus KV's own propagation to other
locations (Cloudflare documents up to 60 s or more).

Verified by `tests/unit/published-read.test.ts:142` (a hiding value never reads the fragments),
`tests/unit/published-read.test.ts:154` (each unreadable form fails closed),
`tests/unit/published-read.test.ts:123` (the 30 s read cache),
`tests/unit/published-read.test.ts:185` (rule 1 before rule 2),
`tests/unit/published-read.test.ts:195` (rule 2: an old hiding value never reads or parses the
fragments), `tests/unit/published-read.test.ts:210` (rule 3),
`tests/unit/published-read.test.ts:223` (rule 4 for every summary: only `live`, `stale` and
`partial` serve) and `tests/unit/published-read.test.ts:236` (rule 4: stale, missing or refused
fragments fail closed). Before that, on the artifact read:
`tests/unit/composed-read-concurrent.test.ts:194` (a hiding value cancels the body
unread), `tests/unit/composed-read-concurrent.test.ts:180` (the gate wins),
`tests/unit/composed-read-concurrent.test.ts:241` (an unreadable value fails closed) and
`tests/unit/composed-read-concurrent.test.ts:269` (no cache, no copy).

#### Scenario: The signal turns hiding before the gate closes

- **GIVEN** the focus value reads `Work`
- **WHEN** the artifact fetch answers a CloudFront 200
- **THEN** the Worker SHALL answer the Work value-free page and SHALL cancel the artifact body unread

#### Scenario: The focus key turns hiding while visible fragments are still in KV

- **GIVEN** `fragments:<build>` holds a visible composition
- **WHEN** the `focus` key reads `Work`
- **THEN** the Worker SHALL answer the Work value-free page and SHALL NOT parse, inspect, splice or
  log the fragments value

#### Scenario: An old visible focus value and fresh live fragments

- **GIVEN** the `focus` key reads visible with a `publishedAt` older than 690 s
- **AND** `fragments:<build>` holds a `live` composition with a `composedAt` within 690 s
- **WHEN** a visitor requests `/`
- **THEN** the Worker SHALL serve the fragments, with `visibility_proof: "fragments"`

#### Scenario: An old visible focus value and fresh value-free fragments

- **GIVEN** the `focus` key reads visible with a `publishedAt` older than 690 s
- **AND** `fragments:<build>` holds a `suppressed` or `unavailable` variant within 690 s
- **WHEN** a visitor requests `/`
- **THEN** the Worker SHALL answer the unreadable value-free page

#### Scenario: An old visible focus value and stale or missing fragments

- **GIVEN** the `focus` key reads visible with a `publishedAt` older than 690 s
- **AND** `fragments:<build>` is missing, or its `composedAt` is older than 690 s
- **WHEN** a visitor requests `/`
- **THEN** the Worker SHALL answer the unreadable value-free page, not the data-free page

#### Scenario: An old hiding focus value

- **GIVEN** the `focus` key reads `Work` with a `publishedAt` a day old
- **WHEN** a visitor requests `/`
- **THEN** the Worker SHALL answer the Work value-free page and SHALL NOT read or parse the fragments
  value

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

Verified by `tests/unit/ssr-response.test.ts:215` (each variant, its summary and its fragments), and by
`tests/oracle/composer-parity.test.ts:310` (each variant equals the Astro render, holds no
`data-generated-at`, and is the asset the build shipped).

#### Scenario: The owner turns on Do Not Disturb

- **GIVEN** the focus value reads `Do Not Disturb`
- **WHEN** a client without JavaScript requests `/`
- **THEN** the Worker SHALL answer 200 with `X-SSR-Data: suppressed`, the Do Not Disturb overlay
  shown, every card `suppressed`, and no export value, and SHALL read no byte of the composed
  artifact (a fetch in flight is aborted, a body that arrived is cancelled unread)

### Requirement: A render that misses its budget falls back to the data-free page

The Worker SHALL bound the whole render by 3 s: 2.5 s of I/O plus a 0.5 s render reserve (D2). A
render that misses it, a stalled document stream included, SHALL be answered with the prerendered
data-free page, status 200, `X-SSR-Data: fallback`, and no asset validators.

Verified by `tests/unit/ssr-response.test.ts:261`.

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

Verified by `tests/unit/ssr-response.test.ts:277`.

#### Scenario: A widget throws while the stream renders

- **GIVEN** the document stream fails after its first bytes
- **WHEN** the Worker reads it
- **THEN** the client SHALL receive status 500 and the 500 page, and none of the partial document

### Requirement: HEAD reads no data

`HEAD /` SHALL answer from the data-free page's headers with the dashboard cache policy. It SHALL
read no export and render nothing, and it SHALL omit `X-SSR-Data`, whose value exists only once a
body is rendered (RFC 9110 section 9.3.2).

Verified by `tests/unit/ssr-response.test.ts:291`.

#### Scenario: A link checker sends HEAD

- **GIVEN** the Worker serves `/`
- **WHEN** a client sends `HEAD /`
- **THEN** the Worker SHALL answer 200 with no body and no `X-SSR-Data`, and SHALL request no
  export

### Requirement: Each render logs one value-free line

Each `GET /` SHALL emit one JSON log line with `event: "ssr_render"`: the summary, the focus state
(`visible`, `hiding`, `unreadable`), each export's read outcome, each card's state, the degraded
exports, `io_ms`, `render_ms`, `total_ms`, the status and the build id. The line SHALL carry no
data value. Every line SHALL carry `isolate_first`: true on the first `GET /` answer of the isolate,
false after (atlas decision 0164: the soak's cold marker, on both read paths; `HEAD /` does not
count). Every line SHALL carry `read_path`: `published` (the KV values) or `artifact` (the composed
artifact, the rollback). A published answer (`served: "published"`) SHALL carry `focus_read:
"visible"`, `focus_kv_ms` and, when the fragments were read, `fragments_kv_ms`, plus `focus_age_ms`
and `fragments_age_ms` when known, and `visibility_proof`: `focus-key` when a `focus` value within
690 s admitted it, `fragments` when data-bearing fragments within 690 s admitted it under an older
visible value (atlas decision 0170). A visible value older than 690 s whose fragments do not prove
visibility SHALL log `artifact: "published:focus-stale:<why>"`, where `<why>` is the fragments
reason or `summary-<summary>`. The KV value carries no render record, so the published line names no
per-export outcome, no card state and no degraded exports.

Verified by `tests/unit/ssr-response.test.ts:173` (one value-free line),
`tests/unit/ssr-response.test.ts:427` (`visibility_proof: "fragments"`) and
`tests/unit/ssr-response.test.ts:508` (`isolate_first` under a fresh module: true, then false on
both paths).

#### Scenario: A healthy render

- **GIVEN** a visible focus signal and readable exports
- **WHEN** a render completes
- **THEN** exactly one `ssr_render` line SHALL be written, naming states and timings only

### Requirement: One document serves every client

The render SHALL NOT branch on the client: no code on the render path reads `User-Agent`, Client
Hints or any browser state. A crawler and a browser receive the same document for the same data.

Verified by `tests/unit/data-plane-config.test.ts:107` (no client identity on the render path) and
`tests/behavioral/ssr-no-js.test.ts:442` (the head of the render equals the data-free page's).

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
