# Discovery & Well-Known Surface

How `jonathanlloyd.me` makes itself discoverable to humans, search engines, and AI
agents. Every file below is generated or route-emitted, and moving agent-discovery
specifications carry a point-in-time verification date.

## At a glance

| File                                                | Purpose                                                                   | Produced by                                                                                                                      | Spec / version (verified)             |
| --------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `/robots.txt`                                       | Per-agent crawl policy                                                    | `src/pages/robots.txt.ts`                                                                                                        | RFC 9309 directives + Sitemap         |
| `Content-Usage` response header                     | Machine-readable content-use preference                                   | `src/lib/edge/security-headers.ts` (Worker middleware + generated `_headers`)                                                    | IETF WG drafts attach-05 / vocab-08   |
| `/sitemap-index.xml`                                | URL discovery for search engines                                          | `@astrojs/sitemap` (`astro.config.mjs`)                                                                                          | Sitemaps 0.9                          |
| `/humans.txt`                                       | Human authorship credits                                                  | `src/pages/humans.txt.ts`                                                                                                        | humanstxt.org                         |
| `/feed.xml`, `/feed.json`                           | Content feeds                                                             | `src/pages/feed.xml.ts`, `src/pages/feed.json.ts`                                                                                | RSS 2.0 / JSON Feed 1.1               |
| `/llms.txt`, `/llms-full.txt`, site-root `index.md` | LLM-ingestible corpus + homepage-only `Accept: text/markdown` negotiation | `src/pages/llms.txt.ts`, `src/pages/llms-full.txt.ts`, `src/pages/index.md.ts`, CloudFront compose, `src/lib/edge/middleware.ts` | llms.txt convention                   |
| `/.well-known/security.txt`                         | Security contact                                                          | static                                                                                                                           | RFC 9116                              |
| `/.well-known/api-catalog`                          | API linkset (`item` + `service-desc` to `/openapi.json`)                  | `scripts/generate-webmcp.mjs` + `src/lib/edge/middleware.ts` (content-type)                                                      | RFC 9727                              |
| `/openapi.json`                                     | OpenAPI document for the nine JSON exports                                | `scripts/generate-webmcp.mjs` + `src/lib/edge/middleware.ts` (content-type)                                                      | OpenAPI 3.1.0                         |
| `/api/v1/<export>.json`                             | Developer API facade: RFC 9457 problems, RateLimit fields, CORS           | `src/pages/api/v1/[...path].ts`, `src/lib/edge/api-v1.ts`, `src/durable/ApiRateLimiter.ts`                                       | RFC 9457, ratelimit-headers-11        |
| `/.well-known/webfinger`                            | Fediverse alias (JRD)                                                     | static + `src/lib/edge/middleware.ts`                                                                                            | RFC 7033                              |
| `/mcp`                                              | Read-only MCP server                                                      | `src/pages/mcp/index.ts`, `src/lib/edge/mcp-server.ts`                                                                           | MCP 2026-07-28, also 2025-11-25       |
| `/mcp/server-card`                                  | MCP server card (canonical)                                               | `src/pages/mcp/server-card.ts`                                                                                                   | SEP-2127 (ext-server-card `526201bb`) |
| `/.well-known/mcp/server-card.json`                 | MCP server card (compatibility copy, same bytes)                          | `scripts/generate-webmcp.mjs`                                                                                                    | SEP-2127                              |
| `/js/webmcp.js`                                     | WebMCP browser tools                                                      | `scripts/generate-webmcp.mjs`                                                                                                    | WebMCP Draft CG Report 2026-10-02     |
| `/.well-known/agent-skills/index.json`              | Agent Skills discovery index                                              | `scripts/generate-webmcp.mjs`                                                                                                    | agentskills.io discovery 0.2.0        |
| `/.well-known/ai-catalog.json`                      | AI catalog (ARD predecessor path)                                         | `scripts/generate-webmcp.mjs`                                                                                                    | ai-catalog `specVersion` 1.0          |
| `/.well-known/ard.json`                             | The same catalog at the ARD path, `rel="ard"` in `Link`                   | `scripts/generate-webmcp.mjs`                                                                                                    | ARD v0.91 (`9d33ea17`, 2026-10-16)    |

## Source of truth

ONE module holds the agent catalog: `src/lib/edge/agent-catalog.mjs`. It defines the
agent paths, the MCP tools and resources, and the server card. The MCP server
(`src/pages/mcp/`), the WebMCP script, and every discovery JSON file read it, so the surfaces cannot disagree.
`scripts/generate-webmcp.mjs` emits the static outputs during `prebuild`:
`public/js/webmcp.js`, `mcp/server-card.json`, `agent-skills/index.json`,
`ai-catalog.json`, `ard.json`, `api-catalog` and `public/openapi.json`. Do not hand-edit
those outputs. `agent-skills/portfolio-expert/SKILL.md` is hand-written except two
generated blocks, the Live Data Sources table and the Developer Documentation links; the
generator renders both, then computes the digest.

- Prose comes from `@j0nathan-ll0yd/copy` (`identity` + `llm` namespaces).
- URLs and identifiers come from `@j0nathan-ll0yd/portal-contract` (`SITE_URL`,
  `CLOUDFRONT_BASE`, `ENDPOINTS`, `LLM_CONTENT_PATHS`).
- The OpenAPI response schemas are the contract's published
  `@j0nathan-ll0yd/portal-contract/raw-schemas`, matched to `ENDPOINTS` by file name and
  checked as a set in both directions. No schema is copied by hand.

Regenerate and verify:

```bash
pnpm run generate:webmcp
pnpm run test:unit    # MCP handler, WebMCP script, vendored-schema provenance
pnpm run test:build   # OpenAPI 3.1 validity, catalog and card byte identity, script order
```

## Agent-discovery conformance notes

### MCP server — `/mcp`

A real, read-only MCP server (atlas decision 0158, owner decision O2), served by the
official SDK `@modelcontextprotocol/server` (`createMcpHandler`) from the site's Cloudflare Worker:
on-demand Astro endpoints `src/pages/mcp/index.ts` and `src/pages/mcp/server-card.ts`, both
listed in `wrangler.jsonc` `run_worker_first` and `src/lib/edge/routes.ts` `EDGE_ROUTES` (atlas
decision 0160).

- **Protocol:** revision 2026-07-28, stateless Streamable HTTP. POST carries JSON-RPC.
  `server/discover` answers with the supported versions, capabilities and the same
  `serverInfo` name and version as the card. The SDK's stateless legacy leg answers
  2025-era clients (`initialize`, then any request). GET and DELETE answer 405 with
  `Allow: POST`. No session id is minted, and a sent `Mcp-Session-Id` is ignored.
- **Validation:** Host and Origin are checked against `jonathanlloyd.me` and the Worker's
  preview hosts, pinned to this account: a Version URL
  (`<8 hex>-human-datastream.webmaster-872.workers.dev`) or a pull request alias
  (`pr-<number>-human-datastream.webmaster-872.workers.dev`). The account subdomain is one
  constant, `WORKERS_DEV_SUBDOMAIN` in `src/lib/edge/mcp-server.ts`; a Worker of the same name on
  another account, or any other prefix, is rejected. A preview Origin passes only from the same preview
  host. `localhost`, `127.0.0.1`, and `[::1]` are allowed as an Origin only when the Host is one of
  them, which is a local run (`wrangler dev`, `astro preview`): Cloudflare never routes a
  localhost Host to a deploy. An invalid Host or Origin answers 403
  with a fixed message that never echoes the header.
- **Bounds:** a POST body over 8 KiB answers 413 before anything is parsed, and an unreadable
  body answers 400 `-32700`. A JSON-RPC batch array answers 400 `-32600`. 2026-07-28 says "The
  body of the HTTP POST **MUST** be a single JSON-RPC _request_ or _notification_", 2025-11-25
  "The body of the POST request **MUST** be a single JSON-RPC _request_, _notification_, or
  _response_", and 2025-06-18 removed batching. This is a deliberate deviation for one older
  revision: the SDK's legacy leg still negotiates 2025-03-26, which says implementations "MUST
  support receiving JSON-RPC batches", so a 2025-03-26 client that batches gets 400. Each
  inbound request carries one read memo, defense in depth: with batches rejected, no request
  reaches a second read today. A tool that cannot parse or summarize
  its artifact answers `{"failed": true, "reason": "artifact unreadable"}`, never engine
  error text.
- **No authorization.** The server is public and read-only, which the revision allows.
- **Resources:** the six policy-exposed JSON exports (books, articles, GitHub events,
  starred repositories, theatre reviews, focus) and `llms-full.txt`. **Tools:**
  `get_profile`, `get_data_sources`, `get_current_reading`, `get_tech_stack`, each annotated
  `readOnlyHint: true`. No tool exposes anything beyond the public JSON exports and the copy
  package.
- **LLM-channel data policy (applied, not new):** the LLM channels (the MCP server,
  WebMCP, the portfolio-expert `SKILL.md`, and the llms trio) carry the coarsened health band
  only, so the owner's recorded policy governs them: `SKILL.md` decision 4 ("LLM content
  uses 7-day aggregates only. No point-in-time BPM, steps, or calories exposed.") and atlas
  decision 0096 (LLM channels carry only a coarsened health band, "no raw point-in-time
  values in output"). No MCP resource or tool lists or reads `health.json`, `sleep.json`, or
  `workouts.json`, and no answer the server composes names them. `llms-full.txt` is backend
  text the server republishes verbatim, so its resource read FAILS CLOSED. A copy is refused with
  an error, and logged as `mcp_withheld_link_refused`, when it contains `/health.json`,
  `/sleep.json`, or `/workouts.json` anywhere, or a link target (markdown link, autolink,
  reference definition, or bare URL) that resolves, percent-decoded, to one of those file names.
  The check runs on `llms-full.txt` only: the JSON exports carry third-party text such as commit
  titles and are served as data. The live document links all three until
  mantle-LifegamesPortal PR #379 deploys, so until then `resources/read` of `llms-full.txt`
  answers an error, never the links. Deploy order: the website first, then backend #379 right
  after it. The freshness table's bare file names (`| health.json |`) are a disclosure, not a
  link, and pass. `get_data_sources` and the `SKILL.md` Live Data Sources
  table both name `llms-full.txt` for those three domains, because its Body section carries
  the coarsened band. Both render from one list, `LLM_DATA_SOURCE_DIRECTORY`; the generator
  writes the `SKILL.md` table between its `BEGIN GENERATED` and `END GENERATED` markers, then
  recomputes the digest. `LLM_CHANNEL_POLICY` in
  `src/lib/edge/agent-catalog.mjs` classifies every portal-contract endpoint as `exposed` or
  `coarsenedOnly` and stops the build on an unclassified one, so a new export is withheld
  until someone classifies it. `tests/unit/mcp-server.test.ts` ("LLM-channel data policy") and
  `tests/unit/webmcp-script.test.ts` red if a raw export, its URL, or its values reach any
  `resources/list`, `resources/read`, or `tools/call` answer. `tests/unit/skill-md.test.ts`
  and `tests/build/agent-discovery.test.ts` red if the source or served `SKILL.md` names one. The owner applied this on
  2026-10-07 and can reverse it.
- **Developer documentation stays linkable (owner answer, 2026-10-12):** an LLM-facing file
  may link the developer documentation, `/openapi.json` and `/developers`, but never the raw
  `health.json`, `sleep.json`, or `workouts.json`. `SKILL.md` carries a generated Developer
  Documentation block from the `llm.txt.whenToUseApi` and `llm.txt.whenToUseDevelopers` copy
  keys. It names `/developers` only once `src/pages/developers.astro` exists, the same rule as
  the api-catalog `service-doc`. `tests/unit/skill-md.test.ts` holds the block to that rule, and
  its raw-URL test still covers the whole file.
- **Focus gate:** every artifact read goes through `src/lib/edge/proxy.ts`, the same
  fail-closed gate as the llms routes. During a hiding focus mode a suppressible artifact
  returns the suppression document `{"suppressed":true,"reason":"focus mode active"}`,
  never data. `focus.json` is never gated, as at the edge, and is read the way the gate
  reads it: no edge cache, no last-known-good copy. An unreadable focus state fails closed.
  When the origin fails and the proxy answers from its last-known-good copy, the result
  carries `_meta["me.jonathanlloyd/lastKnownGoodSince"]` with the time the copy was stored.
  Since #351 the proxy admits that copy only with gate-open evidence from the same request and a
  composition stamp (`x-amz-meta-composed-at`) at most 3 hours old. An export the backend
  republishes only on change, such as `books.json`, is often older than that, so an origin
  failure then ends in an error, not stale data.
- **Caching:** `server/discover`, `tools/list` and `resources/list` carry a one-hour public
  cache hint; `resources/read` keeps the default (ttl 0, private).
- **No list-change notifications:** the tools and resources change only on deploy, so the
  server declares `listChanged: false`. A `subscriptions/listen` request is acknowledged and
  closed at once.

### MCP server card — SEP-2127

`/mcp/server-card` is canonical: the location the extension reserves
(`<streamable-http-url>/server-card`). It is served with
`Content-Type: application/mcp-server-card+json`, open CORS,
`Cache-Control: public, max-age=3600`, and a strong `ETag` that honors `If-None-Match`.
`/.well-known/mcp/server-card.json` carries the same bytes for older consumers. Fields:
`$schema`, `name` (`me.jonathanlloyd/human-datastream`), `title`, `description` (at most
100 characters), `version`, and one `streamable-http` remote at `https://jonathanlloyd.me/mcp`.
The card validates against the extension's `schema.json`, vendored at
`audits/vendor/agent-discovery/` with its commit and digest in `SOURCES.json`.

The previous card used the superseded SEP-1649 shape and named the CloudFront distribution
as `transport.url`; an MCP `initialize` there returned a CloudFront HTML 403.

### WebMCP — `document.modelContext.registerTool`

`public/js/webmcp.js` registers each catalog tool with
`document.modelContext.registerTool(tool)`, per the WebMCP Draft Community Group Report
of 2026-10-02 (re-read 2026-10-16 at `webmachinelearning/webmcp` `32797985`; the IDL is
unchanged). Each tool declares `readOnlyHint: true`; `get_current_reading` also
declares `untrustedContentHint: true` (book titles are third-party text). Each tool runs as
a `tools/call` against `/mcp`, so the browser holds no tool logic and no data host.
`navigator.modelContext.registerTool` is a trailing fallback for older origin-trial
builds. The previous script called `navigator.modelContext.provideContext()`, which the
draft does not define. `Dashboard.astro` loads the script first in `<head>`, deferred:
the 2026-10-07 is-agentic scan read 8 of 17 scripts and missed it at position 15.

### AI catalog and ARD — `ai-catalog.json` and `ard.json`

Verified 2026-10-07 against `ards-project/ard-spec` `b76f235a`, re-verified 2026-10-16 at
`9d33ea17` (the spec and `ard-entry.schema.json` moved; every clause below still holds).
ARD v0.91 makes
`/.well-known/ard.json` and `rel="ard"` the normative publisher path and relation, and
keeps `/.well-known/ai-catalog.json` and `rel="ai-catalog"` as the predecessor names a
consumer MAY consult. The site serves one document at both paths and sends both `Link`
relations. The document satisfies both schemas: `spec/schemas/ai-catalog.schema.json`
requires `specVersion: "1.0"` and `entries`, and the ARD `ArdManifest` requires `entries`
and ignores other top-level members. Both schemas are vendored and checked.

The catalog carries two resources, each with a domain-anchored `urn:air:` identifier,
`displayName`, media type, and exactly one locator:

- the MCP server card at `/mcp/server-card` (`application/mcp-server-card+json`), with the
  tool names as `capabilities`;
- the Agent Skills index at `/.well-known/agent-skills/index.json`. ARD defines no
  dedicated media type for it, so that entry remains `application/json`.

`host.identifier` is omitted. It was `did:web:jonathanlloyd.me`, which does not resolve
(`/.well-known/did.json` is 404), and ARD makes the field optional.

### API catalog and OpenAPI — RFC 9727

`/.well-known/api-catalog` anchors on its own URL and lists one `item` per public JSON
export: all nine, at the developer API facade (`API_V1_BASE`, `https://jonathanlloyd.me/api/v1`,
plus portal-contract `ENDPOINTS`), typed `application/json`. The catalog is developer documentation, so the raw health, sleep and
workouts exports are listed too. Each item has its own linkset entry (RFC 9727 Appendix A.1)
with `service-desc` (`/openapi.json`, `application/vnd.oai.openapi+json;version=3.1`) and
`service-doc` (`/developers` once that page exists in the tree, the wiki before, so no deploy
links a 404). Until 2026-10-12 the one item was the CloudFront root, which answers an S3 XML
`AccessDenied` 403. The monthly `b2-check-wellknown` fetches every item without following
redirects: each must answer a 2xx `application/json` object, or, while a hiding mode is active,
the facade's 503 `application/problem+json` focus-suppressed problem with `suppressed: true` and
a `reason` (never for `focus.json`, which the gate never suppresses). S3 XML and the HTML 404 fail.
Its `api-v1-error-shape` arm probes the facade's failures as served: an unknown export, a POST and
`/api/nope` must each answer an RFC 9457 problem, and `/api/v1/focus.json` must carry
`RateLimit-Policy` and `RateLimit`. `/openapi.json` describes the nine GET endpoints on the
facade, their response schemas, one `Problem` schema with a response component per problem type
(405, 429 and 502 on every export, the 503 focus-suppressed problem on every export except
`focus.json`), the RateLimit fields, and the `Deprecation`, `Sunset` and `Link` fields of the
versioning promise. The facade is the `developer-api` OpenSpec capability.

The public data documentation still describes all nine exports, health, sleep and workouts
included: `/openapi.json`, `/.well-known/api-catalog` (one `item` per export), and the homepage
JSON-LD `Dataset` (its `distribution` list). The
LLM-channel data policy above does not govern them: they document the public API, the same
JSON a browser already fetches from the CloudFront host. They are not LLM content. The
boundary is the channel. The LLM channels (MCP, WebMCP, `SKILL.md`, and the llms trio) carry
only the coarsened band; the public data documentation describes the exports that exist. An
LLM channel may link that documentation (owner answer, 2026-10-12) but never a raw export
URL. The owner can reverse this choice.

The CloudFront/S3 origin still answers a key that does not exist with an XML or HTML 403, not
JSON. No discovery document names that origin any more: `/openapi.json` and the api-catalog
point at the facade, which answers every failure under `/api` with a problem
(`json-error-responses`). The CloudFront URLs stay valid for the LLM channels and the MCP
resource URIs.

### A2A — not advertised

The site does not deploy an A2A server, so it does not publish an A2A Agent Card. The
previous card only resembled the v1 `AgentCard` structure: its required `HTTP+JSON`
interface URL was the static MCP server-card document, not an endpoint implementing A2A
operations. That conflicted with the current A2A requirement that every declared
interface accurately identify its transport and operational URL.

Evidence verified 2026-08-22:

- the repository has no A2A route or operation handler;
- a `message/send` POST to the card's advertised MCP document returned HTTP 405;
- the current A2A
  [`a2a.proto`](https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto)
  maps HTTP+JSON send operations to `POST /message:send`, and its
  [protocol specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
  defines an Agent Card as metadata published by an A2A server.

Accordingly, `/.well-known/agent-card.json`, its ARD catalog entry, its HTTP `Link`
advertisement, and its dedicated audit assertions were removed. Do not restore them
unless a real conforming A2A endpoint is deployed.

### AI content-use preference

Every site response carries a `Content-Usage` preference header. The Worker middleware
(`src/lib/edge/middleware.ts`) sets it on Worker responses, including negotiated Markdown;
the generated `_headers` wildcard (`dist/client/_headers`) sets it on static asset responses
and cache hits. Both take it from `src/lib/edge/security-headers.ts`, WHICH OWNS THE EMITTED
VALUE -- this page deliberately does not restate it, the discipline
`docs/wiki/LLM-Content-Spec.md` already applies (a restated clause is prose nothing
measures, and this page restated it verbatim until atlas decision 0142 phase 7). The two
planes are held byte-identical by `tests/unit/discovery-link-header.test.ts`.
Cloudflare
[does not apply `_headers` rules to Worker responses](https://developers.cloudflare.com/workers/static-assets/headers/),
so both paths are required. This is the HTTP response-header form defined by the IETF
AI Preferences Working Group drafts
[`draft-ietf-aipref-attach-05`](https://www.ietf.org/archive/id/draft-ietf-aipref-attach-05.html)
and
[`draft-ietf-aipref-vocab-08`](https://www.ietf.org/archive/id/draft-ietf-aipref-vocab-08.html)
(14 September 2026), both re-verified 2026-10-29. vocab-08 defines three categories:
`train-ai`, `ai-use` and `search`. It also states that "Its contents DO NOT REFLECT
CONSENSUS of the Working Group". The header deliberately states `train-ai` and `search`
only: atlas decision 0174 E2 deferred `ai-use=y`, so `ai-use` stays unstated.

The attachment draft also describes a robots extension, but `/robots.txt`
intentionally omits it. Lighthouse treats directives it does not recognize as an SEO
failure, so the generated file is limited to the site's approved `User-agent`, `Allow`,
`Disallow`, and `Sitemap` fields. Named training crawlers remain blocked from the
dashboard except `/llms.txt`, while named search/answer agents remain allowed.

## Deferred discovery surfaces

- **DNS-AID / DNS publication:** deferred. The current document is
  [`draft-mozley-aidiscovery-01`](https://datatracker.ietf.org/doc/draft-mozley-aidiscovery/),
  last updated 2026-04-16. The IETF Datatracker classifies it as an active individual
  Internet-Draft, explicitly unendorsed by the IETF and with no formal standing. The
  2026-08-22 verification found no `_agents.jonathanlloyd.me` SVCB or TXT record. Revisit
  publication only after a relevant working group adopts a stable mechanism.
- **Cloudflare NLWeb:** deferred. Cloudflare's
  [NLWeb integration](https://developers.cloudflare.com/ai-search/how-to/nlweb/) remains a
  public preview intended for experimentation, while
  [AI Search pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/)
  remains open-beta pricing with future billing still unspecified. Revisit an NLWeb `/ask`
  endpoint only after NLWeb leaves preview and AI Search leaves open beta with production
  terms. (The site's own `/mcp` server above does not depend on NLWeb.)

## Spec-drift watch

ARD, the MCP server-card extension, WebMCP, DNS-AID, NLWeb, A2A, and Agent Skills discovery
are moving surfaces. The statuses above are point-in-time.

What re-verifies them automatically:

- `audits/checks/b2-check-spec-currency.mjs` (weekly, report-only) watches the rule
  catalog's pinned sources (llms.txt, RSS, JSON Feed, RFC 9116) and, since atlas decision
  0158, the agent-discovery `WATCHED_SOURCES`: the WebMCP draft (`index.bs`), SEP-2127, the
  server-card extension's `docs/discovery.md`, the ARD v0.91 specification, and the three
  vendored schemas. A revision is reported as
  `spec-source-moved` and escalates to `fail` after the re-pin grace window.
- `audits/checks/b2-check-wellknown.mjs` (monthly tier of `audit-web.yml`) validates the served card, `ai-catalog.json`
  and `ard.json` against the vendored schemas, and walks catalog, then card, then each
  `remotes[].url` in both protocol eras: `initialize` and `tools/list` (2025-11-25), then
  `server/discover` and a `tools/call` per tool (2026-07-28). `--base <url>` audits a
  preview deploy. A Worker preview Version URL sits behind Cloudflare Access, so set
  `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`; the check sends them to the audited
  origin only, never to production or CloudFront.
- `audits/checks/b2-check-not-found.mjs` (weekly) requests a missing path under
  `Accept: text/markdown` and `Accept: text/html` and expects a 404 of each media type.

DNS-AID, NLWeb, A2A and Agent Skills discovery have no automatic watch. Their dates above
are as stale as they look, and re-verifying them is a manual task.
