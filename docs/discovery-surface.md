# Discovery & Well-Known Surface

How `jonathanlloyd.me` makes itself discoverable to humans, search engines, and AI
agents. Every file below is generated or route-emitted, and moving agent-discovery
specifications carry a point-in-time verification date.

## At a glance

| File                                               | Purpose                                                     | Produced by                                                             | Spec / version (verified)              |
| -------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `/robots.txt`                                      | Per-agent crawl policy                                      | `src/pages/robots.txt.ts`                                               | RFC 9309 directives + Sitemap           |
| `Content-Usage` response header                    | Machine-readable content-use preference                     | `functions/_middleware.ts` + `public/_headers`                         | IETF WG drafts attach-05 / vocab-07     |
| `/sitemap-index.xml`                               | URL discovery for search engines                            | `@astrojs/sitemap` (`astro.config.mjs`)                                 | Sitemaps 0.9                           |
| `/humans.txt`                                      | Human authorship credits                                    | `src/pages/humans.txt.ts`                                               | humanstxt.org                          |
| `/feed.xml`, `/feed.json`                          | Content feeds                                               | `functions/feed.xml.ts`, `functions/feed.json.ts`                       | RSS 2.0 / JSON Feed 1.1                |
| `/llms.txt`, `/llms-full.txt`, site-root `index.md` | LLM-ingestible corpus + homepage-only `Accept: text/markdown` negotiation | `functions/llms.txt.ts`, `functions/llms-full.txt.ts`, `functions/index.md.ts`, CloudFront compose, `functions/_middleware.ts` | llms.txt convention |
| `/.well-known/security.txt`                        | Security contact                                            | static                                                                  | RFC 9116                               |
| `/.well-known/api-catalog`                         | API linkset (`item` + `service-desc` to `/openapi.json`)    | `scripts/generate-webmcp.mjs` + `_middleware.ts` (content-type)         | RFC 9727                               |
| `/openapi.json`                                    | OpenAPI document for the nine JSON exports                  | `scripts/generate-webmcp.mjs`                                           | OpenAPI 3.1.0                          |
| `/.well-known/webfinger`                           | Fediverse alias (JRD)                                       | static + `_middleware.ts`                                               | RFC 7033                               |
| `/mcp`                                             | Read-only MCP server                                        | `functions/mcp/index.ts`, `functions/_lib/mcp-server.ts`                | MCP 2026-07-28, also 2025-11-25        |
| `/mcp/server-card`                                 | MCP server card (canonical)                                 | `functions/mcp/server-card.ts`                                          | SEP-2127 (ext-server-card `526201bb`)  |
| `/.well-known/mcp/server-card.json`                | MCP server card (compatibility copy, same bytes)            | `scripts/generate-webmcp.mjs`                                           | SEP-2127                               |
| `/js/webmcp.js`                                    | WebMCP browser tools                                        | `scripts/generate-webmcp.mjs`                                           | WebMCP Draft CG Report 2026-10-02      |
| `/.well-known/agent-skills/index.json`             | Agent Skills discovery index                                | `scripts/generate-webmcp.mjs`                                           | agentskills.io discovery 0.2.0         |
| `/.well-known/ai-catalog.json`                     | AI catalog (ARD predecessor path)                           | `scripts/generate-webmcp.mjs`                                           | ai-catalog `specVersion` 1.0           |
| `/.well-known/ard.json`                            | The same catalog at the ARD path, `rel="ard"` in `Link`     | `scripts/generate-webmcp.mjs`                                           | ARD v0.91 (`b76f235a`, 2026-10-07)     |

## Source of truth

ONE module holds the agent catalog: `functions/_lib/agent-catalog.mjs`. It defines the
agent paths, the MCP tools and resources, and the server card. The MCP Function, the
WebMCP script, and every discovery JSON file read it, so the surfaces cannot disagree.
`scripts/generate-webmcp.mjs` emits the static outputs during `prebuild`:
`public/js/webmcp.js`, `mcp/server-card.json`, `agent-skills/index.json`,
`ai-catalog.json`, `ard.json`, `api-catalog` and `public/openapi.json`. Do not hand-edit
those outputs. `agent-skills/portfolio-expert/SKILL.md` is hand-written; the generator
only reads it to compute its digest.

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
official SDK `@modelcontextprotocol/server` (`createMcpHandler`) from a Pages Function.

- **Protocol:** revision 2026-07-28, stateless Streamable HTTP. POST carries JSON-RPC.
  `server/discover` answers with the supported versions, capabilities and the same
  `serverInfo` name and version as the card. The SDK's stateless legacy leg answers
  2025-era clients (`initialize`, then any request). GET and DELETE answer 405. No session
  id is minted, and a sent `Mcp-Session-Id` is ignored.
- **Validation:** Host and Origin are checked against `jonathanlloyd.me`,
  `human-datastream.pages.dev`, its preview subdomains, and localhost (for
  `wrangler pages dev`). An invalid Origin answers 403.
- **No authorization.** The server is public and read-only, which the revision allows.
- **Resources:** the nine JSON exports (`CLOUDFRONT_BASE` + `ENDPOINTS`) and
  `llms-full.txt`. **Tools:** `get_profile`, `get_data_sources`, `get_current_reading`,
  `get_tech_stack`, each annotated `readOnlyHint: true`. No tool exposes anything beyond the
  public JSON exports and the copy package.
- **Focus gate:** every artifact read goes through `functions/_lib/proxy.ts`, the same
  fail-closed gate as the llms routes. During a hiding focus mode a suppressible artifact
  returns the suppression document `{"suppressed":true,"reason":"focus mode active"}`,
  never data. `focus.json` is never gated, as at the edge, and is read the way the gate
  reads it: no edge cache, no last-known-good copy. An unreadable focus state fails closed.
  When the origin fails and the proxy answers from its last-known-good copy, the result
  carries `_meta["me.jonathanlloyd/lastKnownGoodSince"]` with the time the copy was stored.
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
of 2026-10-02. Each tool declares `readOnlyHint: true`; `get_current_reading` also
declares `untrustedContentHint: true` (book titles are third-party text). Each tool runs as
a `tools/call` against `/mcp`, so the browser holds no tool logic and no data host.
`navigator.modelContext.registerTool` is a trailing fallback for older origin-trial
builds. The previous script called `navigator.modelContext.provideContext()`, which the
draft does not define. `Dashboard.astro` loads the script first in `<head>`, deferred:
the 2026-10-07 is-agentic scan read 8 of 17 scripts and missed it at position 15.

### AI catalog and ARD — `ai-catalog.json` and `ard.json`

Verified 2026-10-07 against `ards-project/ard-spec` `b76f235a`. ARD v0.91 makes
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

`/.well-known/api-catalog` anchors on its own URL and lists the CloudFront data API as its
one `item`. The API's entry carries `service-desc` (`/openapi.json`,
`application/vnd.oai.openapi+json;version=3.1`) and `service-doc` (`/developers` once
that page exists in the tree, the wiki before, so no deploy links a 404). `/openapi.json`
describes the nine GET endpoints on `CLOUDFRONT_BASE`, their response schemas, and the
focus-suppression 403 on every export except `focus.json`.

Known risk: the CloudFront/S3 origin answers a key that does not exist with an XML or HTML
403, not JSON. If an agent-readiness scorer starts treating the site as an API, its
`openapi-spec` and `json-error-responses` checks join the essential pool and that answer
would count against it.

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

Every site response carries a `Content-Usage` preference header. The root Pages Function
middleware sets it on Function responses, including negotiated Markdown; the
`public/_headers` wildcard sets it on static asset responses and cache hits. THOSE TWO
FILES OWN THE EMITTED VALUE -- this page deliberately does not restate it, the discipline
`docs/wiki/LLM-Content-Spec.md` already applies (a restated clause is prose nothing
measures, and this page restated it verbatim until atlas decision 0142 phase 7). The two
planes are held byte-identical by `tests/unit/discovery-link-header.test.ts`.
Cloudflare
[does not apply `_headers` rules to Pages Functions](https://developers.cloudflare.com/pages/configuration/headers/),
so both paths are required. This is the HTTP response-header form defined by the IETF
AI Preferences Working Group drafts
[`draft-ietf-aipref-attach-05`](https://www.ietf.org/archive/id/draft-ietf-aipref-attach-05.html)
and
[`draft-ietf-aipref-vocab-07`](https://www.ietf.org/archive/id/draft-ietf-aipref-vocab-07.html),
both verified 2026-08-19. The current vocabulary defines `train-ai` and `search`;
it does not define an AI-input category.

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
- `audits/checks/b2-check-wellknown.mjs` (weekly) validates the served card, `ai-catalog.json`
  and `ard.json` against the vendored schemas, and walks catalog, then card, then each
  `remotes[].url` in both protocol eras: `initialize` and `tools/list` (2025-11-25), then
  `server/discover` and a `tools/call` per tool (2026-07-28). `--base <url>` audits a
  preview deploy.

DNS-AID, NLWeb, A2A and Agent Skills discovery have no automatic watch. Their dates above
are as stale as they look, and re-verifying them is a manual task.
