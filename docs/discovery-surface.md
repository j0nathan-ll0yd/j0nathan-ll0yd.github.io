# Discovery & Well-Known Surface

How `jonathanlloyd.me` makes itself discoverable to humans, search engines, and AI
agents. Every file below is generated or route-emitted, and moving agent-discovery
specifications carry a point-in-time verification date.

## At a glance

| File                                               | Purpose                                                     | Produced by                                                             | Spec / version (verified)              |
| -------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `/robots.txt`                                      | Per-agent crawl policy                                      | `src/pages/robots.txt.ts`                                               | RFC 9309 directives + Sitemap           |
| `Content-Usage` response header                    | Machine-readable content-use preference                     | `functions/_middleware.ts`                                             | IETF WG drafts attach-05 / vocab-07     |
| `/sitemap-index.xml`                               | URL discovery for search engines                            | `@astrojs/sitemap` (`astro.config.mjs`)                                 | Sitemaps 0.9                           |
| `/humans.txt`                                      | Human authorship credits                                    | `src/pages/humans.txt.ts`                                               | humanstxt.org                          |
| `/feed.xml`, `/feed.json`                          | Content feeds                                               | `functions/feed.xml.ts`, `functions/feed.json.ts`                       | RSS 2.0 / JSON Feed 1.1                |
| `/llms.txt`, `/llms-full.txt`, per-page `index.md` | LLM-ingestible corpus + `Accept: text/markdown` negotiation | `functions/llms.txt.ts`, CloudFront compose, `functions/_middleware.ts` | llms.txt convention                    |
| `/.well-known/security.txt`                        | Security contact                                            | static                                                                  | RFC 9116                               |
| `/.well-known/api-catalog`                         | API linkset                                                 | `functions/_middleware.ts` (content-type)                               | RFC 9727                               |
| `/.well-known/webfinger`                           | Fediverse alias (JRD)                                       | static + `_middleware.ts`                                               | RFC 7033                               |
| `/.well-known/mcp/server-card.json`                | MCP server descriptor                                       | `scripts/generate-webmcp.mjs`                                           | MCP server card                        |
| `/.well-known/agent-skills/index.json`             | Agent Skills discovery index                                | `scripts/generate-webmcp.mjs`                                           | agentskills.io discovery 0.2.0         |
| `/.well-known/ai-catalog.json`                     | ARD capability catalog                                      | `scripts/generate-webmcp.mjs`                                           | **ARD `specVersion` 1.0** (2026-08-22) |

## Source of truth

The agent-discovery JSON files (`mcp/server-card.json`, `agent-skills/index.json`,
`ai-catalog.json`) and `public/js/webmcp.js` are emitted by
`scripts/generate-webmcp.mjs`, which runs during `prebuild`. Do not hand-edit these
outputs.

- Prose comes from `@j0nathan-ll0yd/copy` (`identity` + `llm` namespaces).
- URLs and identifiers come from `@j0nathan-ll0yd/portal-contract` (`SITE_URL`,
  `CLOUDFRONT_BASE`, `ENDPOINTS`).

Regenerate and verify:

```bash
pnpm run generate:webmcp
# Validate ai-catalog.json against ards-project/ard-spec
# spec/schemas/ai-catalog.schema.json.
```

## Agent-discovery conformance notes

### ARD `ai-catalog.json` — `specVersion` 1.0

Verified 2026-08-22 against the canonical
[`ards-project/ard-spec`](https://github.com/ards-project/ard-spec) repository and its
authoritative
[`ai-catalog.schema.json`](https://github.com/ards-project/ard-spec/blob/main/spec/schemas/ai-catalog.schema.json).
The published specification remains v0.9 draft and the schema still requires
`specVersion: "1.0"`. A v0.91 editorial draft exists in the repository, but it is
explicitly marked for review and retains `/.well-known/ai-catalog.json` as a normative
consumer fallback; this site is not adopting its draft-only `ard.json` publisher shape.

The catalog contains two honest resources:

- the read-only MCP server descriptor at `/.well-known/mcp/server-card.json`;
- the Agent Skills index at `/.well-known/agent-skills/index.json`.

Each entry has the required domain-anchored `urn:air:` identifier, `displayName`, media
type, and exactly one locator. ARD defines no dedicated media type for the Agent Skills
index, so that entry remains `application/json`.

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

Every site response carries `Content-Usage: train-ai=n, search=y`, set by the root
Pages Function middleware. This is the HTTP response-header form defined by the IETF AI
Preferences Working Group drafts
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
  remains open-beta pricing with future billing still unspecified. Revisit `/ask` and
  `/mcp` only after NLWeb leaves preview and AI Search leaves open beta with production
  terms.

## Spec-drift watch

ARD, DNS-AID, NLWeb, A2A, and Agent Skills discovery are moving surfaces. The status
above is point-in-time as of 2026-08-22, not permanent. A recurring issue tracks monthly
re-verification.
