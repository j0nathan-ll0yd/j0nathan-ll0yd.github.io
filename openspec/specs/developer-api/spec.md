# Developer API Conformance

## Purpose

State what the developer API facade owes its clients (is-agentic api-v1 plan; owner decisions
2026-10-24). The nine public JSON exports live on the CloudFront data plane, which serves the bytes
and nothing else: a missing key answers an S3 XML 403, and there is no versioning statement and no
rate-limit signal. The Worker is the API's HTTP facade. `https://jonathanlloyd.me/api/v1/<export>.json`
reads the same bytes through the same focus gate (`makeCloudfrontProxy`, `llms-txt` capability,
requirement "Gated artifacts are admitted only through the CloudFront gate") and adds the HTTP
semantics the data plane lacks: RFC 9457 problem details on every failure, a path version with a
deprecation contract, the RateLimit fields of draft-ietf-httpapi-ratelimit-headers-11, and CORS.

CloudFront stays the storage and privacy plane. Its URLs stay valid, and the LLM channels keep
them: the MCP resource URIs, WebMCP, SKILL.md and llms.txt are unchanged (atlas decision 0158,
LLM-channel data policy). The facade is the developer channel, so it serves all nine exports, the
raw health, sleep and workouts exports included (owner decision 2026-10-24).

The code: `src/lib/edge/api-v1.ts` (the handler), `src/lib/edge/problem.ts` (the problem builder),
`src/lib/edge/rate-limit.ts`, `src/lib/edge/rate-limit-window.ts` and the rate-limiter Worker
`workers/rate-limiter/` (`ClientRateLimitWindow`, the counter),
`src/pages/api/v1/[...path].ts` and `src/pages/api/[...path].ts` (the routes), and
`src/lib/edge/agent-catalog.mjs` (`API_V1_BASE`, `API_V1_RATE_LIMIT`, `API_DEPRECATION_WINDOW_DAYS`,
`API_PROBLEMS`).

## Requirements

### Requirement: Every path under /api reaches the Worker

`wrangler.jsonc` `run_worker_first` SHALL list `/api` and `/api/*`, so no request under /api meets
the static-asset plane or its HTML 404 page. `src/lib/edge/routes.ts` `EDGE_ROUTES` SHALL route
`/api/v1` and every path below it to the facade, and every other path under /api, except
`/api/csp-report`, to the not-found problem. Both routes SHALL handle every method, so the facade
answers its own 405 problem instead of the Worker's empty 405.

`/api/csp-report`, the browser's CSP report collector, SHALL also handle every method. POST keeps
its collector behavior exactly: 204 for an accepted report type, 415 for any other. Every other
method, GET and HEAD included, SHALL answer the 405 `method-not-allowed` problem with
`Allow: POST`, never the HTML 404 page.

Verified by `tests/unit/worker-routing.test.ts:125` (every method under /api reaches a route).

#### Scenario: A scanner probes an unknown API path

- **GIVEN** a request `GET /api/nope`
- **WHEN** the Worker routes it
- **THEN** the `/api` catch-all SHALL answer the not-found problem, never the HTML 404 page

### Requirement: Every failure under /api is an RFC 9457 problem

Every 4xx and 5xx answer under /api, except the CSP collector's POST 415 (kept byte for byte from
its Pages behavior, requirement above), SHALL carry `Content-Type: application/problem+json;
charset=utf-8` and a JSON object with the RFC 9457 members `type`, `title`, `status`, `detail` and
`instance`. `type` SHALL be the absolute URI `https://jonathanlloyd.me/developers#problem-<slug>`,
built from `SITE_URL` and `AGENT_PATHS.developers`; `status` SHALL equal the HTTP status;
`instance` SHALL be the request path. `title` and `detail` SHALL be static copy from
`@j0nathan-ll0yd/copy` (`llm.developers.problem<Slug>Title` and `...Detail`). Variable data SHALL
travel in extension members, never in `detail`:

| Slug | Status | Extension members |
| --- | --- | --- |
| `not-found` | 404 | `validPaths`: the nine facade paths |
| `method-not-allowed` | 405 | none; the `Allow` header (`GET, HEAD` on /api/v1, `POST` on /api/csp-report) |
| `rate-limited` | 429 | `retryAfterSeconds` |
| `focus-suppressed` | 503 | `suppressed: true`, `reason`, `retryAfterSeconds` |
| `upstream-unavailable` | 502 | `retryAfterSeconds` |

The order of operations SHALL be: the path, then the method, then the rate limit, then the gated
read. An unknown export, a nested path or the bare base answers `not-found`; a method other than
GET, HEAD or OPTIONS answers `method-not-allowed`; neither reaches the counter or the data plane.
The gated proxy's own `text/plain` 405 and 502 answers SHALL never reach a client. A problem 404
SHALL keep its body under `Accept: text/markdown` (the `llms-txt` 404 exception does not apply).
Every problem SHALL be `no-store` at the browser, generic CDN and Cloudflare layers. An unexpected
error inside the facade SHALL still answer the `upstream-unavailable` problem, with one structured
`api_v1_unhandled` line naming the error class.

The audit arm `api-v1-error-shape` in `audits/checks/b2-check-wellknown.mjs` measures the same
property as served: `GET /api/v1/__not_a_resource__.json`, `POST /api/v1/books.json` and
`GET /api/nope` must each answer a problem with `type`, `title`, `status` and `instance`.

Verified by `tests/unit/api-v1.test.ts:147` (path and method first, every problem shape, no
`text/plain` escapes, the markdown 404 exemption) and by
`audits/__tests__/b2-check-wellknown.test.ts:577` (the audit arm's judges).

#### Scenario: An agent asks for an export that does not exist

- **GIVEN** a request `GET /api/v1/nope.json`
- **WHEN** the facade answers
- **THEN** it SHALL answer 404 `application/problem+json` with `type`
  `https://jonathanlloyd.me/developers#problem-not-found`, `instance` `/api/v1/nope.json`, and
  `validPaths` listing the nine export paths
- **AND** it SHALL NOT read the data plane

#### Scenario: An agent sends a write

- **GIVEN** a request `POST /api/v1/books.json`
- **WHEN** the facade answers
- **THEN** it SHALL answer the 405 problem with `Allow: GET, HEAD`, before the rate limit

### Requirement: The facade states and enforces a per-client rate limit

Each client SHALL get `API_V1_RATE_LIMIT` (60 requests per fixed window of 60 seconds) on GET and
HEAD under /api/v1. A client is the address partition of `CF-Connecting-IP` (`clientPartition`): an
IPv4 address, or the /64 of an IPv6 address, because one subscriber holds a whole /64; an
IPv4-mapped IPv6 address is its IPv4 address. One Durable Object per client (`ClientRateLimitWindow`,
SQLite storage) SHALL own the count and the window end, so the remaining quota is exact and global.
The class SHALL run in its own Worker, `human-datastream-rate-limiter` (`workers/rate-limiter/`),
which the site Worker binds as `API_RATE_LIMITER` through `script_name`, because Cloudflare generates
no Version URL for a Worker that implements a Durable Object
(developers.cloudflare.com/workers/configuration/previews/, Limitations). The site Worker SHALL NOT
export a Durable Object class. The object's name SHALL be the SHA-256 of the partition, never the
address; no log line SHALL carry either. An alarm at the window end SHALL delete the object's
storage, unless a later request already opened the next window, which keeps its count and its own
alarm. A refused request writes nothing.

Every facade answer SHALL carry `RateLimit-Policy: "default";q=60;w=60` (draft section 3.1). Every
answer the counter decided SHALL carry `RateLimit: "default";r=<remaining>;t=<seconds to window
end>` (draft section 4.1). A request over the limit SHALL answer the 429 `rate-limited` problem with
`Retry-After` equal to `t` (draft section 6), and SHALL NOT read the data plane. An OPTIONS
preflight costs no quota. When the counter is unbound, fails or takes longer than
`RATE_LIMIT_TIMEOUT_MS`, the request SHALL go ahead (fail-open, owner decision 2026-10-24) with no
`RateLimit` field, because no honest `r` exists. Each isolate SHALL log one structured warning
(`api_v1_rate_limit_unavailable`) per reason per `UNAVAILABLE_LOG_INTERVAL_MS` (60 s), so a flood
that exhausts the Durable Object allowance cannot write one line per request. Fail-open means such a
flood also removes the limit; an outer control in front of the counter is an owner decision. The copy SHALL state the enforced numbers: the generator fails when
`llm.developers.rateLimitBody` omits the limit or the window.

Verified by `tests/unit/api-v1.test.ts:189` (the headers, the 429, fail-open and the digest key).

The fixed window, the IPv6 partition, the throttled warning and the Durable Object's alarm and
writes have their own suites, `api-rate-limiter.test.ts` and the rate-limiter Worker's
`ClientRateLimitWindow.test.ts`.

A behavioral spec, `api-v1.spec.ts`, runs a 61-request burst through the built site Worker under
`wrangler dev`, bound to the rate-limiter Worker under its own `wrangler dev`.

#### Scenario: A client bursts past the limit

- **GIVEN** a client that has sent 60 requests in the current window, each answered with `r`
  counting down from 59 to 0
- **WHEN** it sends the 61st
- **THEN** the facade SHALL answer 429 `application/problem+json` with `RateLimit:
  "default";r=0;t=<n>` and `Retry-After: <n>`
- **AND** another client SHALL still get `r=59`

#### Scenario: The counter is down

- **GIVEN** a Durable Object call that throws
- **WHEN** a client asks for an export
- **THEN** the facade SHALL serve the export with `RateLimit-Policy` and without `RateLimit`

### Requirement: The focus gate stays authoritative behind the facade

The facade SHALL read every export through `makeCloudfrontProxy` with `LLM_OUTPUT_CACHE_POLICY`:
the focus probe first, then the artifact through the gate, `no-store` throughout, and no shared
cache in front. It SHALL never answer data the gate withholds. A 200 SHALL pass the body and the
proxy's diagnostics through, with `Content-Type: application/json; charset=utf-8`,
`Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers` naming the RateLimit and
`X-Proxy-*` fields; a stale last-known-good copy keeps `Warning: 110` and `X-Proxy-Stale: true`.

A suppression (a hiding focus value, or the gate's 403 body under a visible one) SHALL answer the
503 `focus-suppressed` problem with `Retry-After`, `X-Source: cloudfront-proxy-suppressed`,
`suppressed: true` and `reason: "focus mode active"`, so both existing recognizers still accept the
body (`src/lib/data-plane/admission.ts` `isSuppressionValue`, `audits/lib/suppression.mjs`
`suppressionBody`). The focus signal itself is never suppressed. Any other failure SHALL answer the
502 `upstream-unavailable` problem with `Retry-After: 30` and no upstream body. The service worker
SHALL NOT cache any facade path (`client-privacy` capability, requirement "No service-worker path
caches a gated response").

Verified by `tests/unit/api-v1.test.ts:238` (the suppression translation and both recognizers, the
502 translation, HEAD, and reads through the real gated proxy that never fetch the export under a
hiding value).

#### Scenario: A hiding focus mode is active

- **GIVEN** the focus signal reads `Work`, a hiding value
- **WHEN** an agent asks for `/api/v1/sleep.json`
- **THEN** the facade SHALL answer 503 `application/problem+json` with `suppressed: true` and
  `Retry-After: 60`
- **AND** it SHALL NOT fetch `/sleep.json` from the data plane

### Requirement: The OpenAPI document and the API catalog advertise the facade

`/openapi.json` SHALL declare `servers: [{url: "https://jonathanlloyd.me/api/v1"}]`, keep the nine
`paths` and their `operationId`s, and type every 4xx and 5xx response as
`application/problem+json` with a schema that references `#/components/schemas/Problem`, through one
response component per problem type. Each operation SHALL list 405, 429 and 502, and 503 on every
export except the focus signal; no operation SHALL list the CloudFront 403. `info.version` is the
document version (`OPENAPI_DOCUMENT_VERSION`). `/.well-known/api-catalog` SHALL list the nine
facade URLs as items, each with its own `service-desc`. Nothing is advertised before it answers:
these documents moved to the facade in the change that shipped its routes.

The `type: object` sibling beside each export `$ref` is a measured experiment for the scanner's
`function-calling-compat` check, behind `OPENAPI_REF_TYPE_SIBLING` in
`scripts/generate-webmcp.mjs`; turning it off is one line.

Verified by `tests/build/agent-discovery.test.ts:106` (the problem typing, the servers, the catalog
items).

#### Scenario: An agent reads the error model

- **GIVEN** the built `/openapi.json`
- **WHEN** an agent resolves the 429 response of `getBooks`
- **THEN** it SHALL find `application/problem+json` with the `Problem` schema and the `Retry-After`,
  `RateLimit` and `RateLimit-Policy` headers

### Requirement: The versioning promise is published and machine-visible

The path carries the version. Within `v1`, response schemas SHALL only add optional members. A
removal or a type change SHALL ship as `/api/v2`, and `v1` SHALL keep answering for at least
`API_DEPRECATION_WINDOW_DAYS` (90) days with `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) and a
`Link; rel="successor-version"` (RFC 8288). The trigger for `v2` is a portal-contract major that
removes or retypes an export member. The promise SHALL appear in copy (`llm.developers.versioningBody`)
on /developers and in the OpenAPI `info.description`, and every 200 SHALL list the three header
fields as optional response headers. The generator fails when the copy omits the window.

Verified by `tests/build/agent-discovery.test.ts:133` (the RateLimit and deprecation header
components on every 200).

#### Scenario: No deprecation is in progress

- **GIVEN** `v1` is the only version
- **WHEN** an agent reads a 200 from the facade
- **THEN** the response SHALL carry no `Deprecation` or `Sunset` field, and the OpenAPI document
  SHALL still list both as optional headers of that response

### Requirement: The developers page documents errors, versioning and rate limits

`/developers` SHALL link each export at its facade URL, and SHALL carry, after the API section and
in this order, an errors section with one level-3 heading per problem type whose `id` is
`problem-<slug>` (the fragment of its `type` URI), a versioning section and a rate-limits section.
Each problem heading is the label of the text page's label-and-note list item (`li > b` with
`role="heading"` and `aria-level="3"`, then the detail as `small`), so the design system's list
rules style it. All prose comes
from `@j0nathan-ll0yd/copy`. Render proof is behavioral: each `#problem-<slug>` heading is visible
and each API link's path starts with `/api/v1/` (`tests/behavioral/api-v1.spec.ts`), never a
screenshot baseline minted by the same change.

Verified by `tests/build/text-pages.test.ts:154` (one heading per problem type at the fragment of
its type URI, and its detail).

#### Scenario: An agent follows a problem type URI

- **GIVEN** a problem with `type` `https://jonathanlloyd.me/developers#problem-rate-limited`
- **WHEN** an agent opens it
- **THEN** /developers SHALL carry a heading with `id="problem-rate-limited"` and the problem's title
