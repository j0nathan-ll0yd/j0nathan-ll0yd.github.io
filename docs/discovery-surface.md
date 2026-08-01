# Discovery & Well-Known Surface

How `jonathanlloyd.me` makes itself discoverable to humans, search engines, and AI
agents. Every file below is **generated or route-emitted** (never hand-maintained as a
static blob), and every agent-facing file is **pinned to a named spec version** with the
date it was last verified — so drift from a moving spec is detectable rather than silent.

## At a glance

| File                                               | Purpose                                                     | Produced by                                                             | Spec / version (verified)              |
| -------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `/robots.txt`                                      | Crawl policy incl. per-AI-bot rules + Content-Signal        | `src/pages/robots.txt.ts`                                               | robots.txt + Content-Signal            |
| `/sitemap-index.xml`                               | URL discovery for search engines                            | `@astrojs/sitemap` (`astro.config.mjs`)                                 | Sitemaps 0.9                           |
| `/humans.txt`                                      | Human authorship credits                                    | `src/pages/humans.txt.ts`                                               | humanstxt.org                          |
| `/feed.xml`, `/feed.json`                          | Content feeds                                               | `functions/feed.xml.ts`, `functions/feed.json.ts`                       | RSS 2.0 / JSON Feed 1.1                |
| `/llms.txt`, `/llms-full.txt`, per-page `index.md` | LLM-ingestible corpus + `Accept: text/markdown` negotiation | `functions/llms.txt.ts`, CloudFront compose, `functions/_middleware.ts` | llms.txt convention                    |
| `/.well-known/security.txt`                        | Security contact                                            | static                                                                  | RFC 9116                               |
| `/.well-known/api-catalog`                         | API linkset                                                 | `functions/_middleware.ts` (content-type)                               | RFC 9727                               |
| `/.well-known/webfinger`                           | Fediverse alias (JRD)                                       | static + `_middleware.ts`                                               | RFC 7033                               |
| `/.well-known/mcp/server-card.json`                | MCP server descriptor                                       | `scripts/generate-webmcp.mjs`                                           | MCP server card                        |
| `/.well-known/agent-skills/index.json`             | Agent Skills discovery index                                | `scripts/generate-webmcp.mjs`                                           | agentskills.io discovery 0.2.0         |
| `/.well-known/agent-card.json`                     | A2A agent card                                              | `scripts/generate-webmcp.mjs`                                           | **A2A v1.0** (2026-07-07)              |
| `/.well-known/ai-catalog.json`                     | ARD capability catalog                                      | `scripts/generate-webmcp.mjs`                                           | **ARD `specVersion` 1.0** (2026-07-07) |

## Source of truth

The agent-discovery JSON files (`mcp/server-card.json`, `agent-skills/index.json`,
`agent-card.json`, `ai-catalog.json`) and `public/js/webmcp.js` are all emitted by
**`scripts/generate-webmcp.mjs`**, wired into `prebuild`. Do **not** hand-edit the static
files — they are overwritten on the next build. Change the generator instead.

- **Prose** (names, descriptions, representative queries) comes from `@j0nathan-ll0yd/copy`
  (`identity` + `llm` namespaces) — zero wording is duplicated in the repo.
- **URLs / identifiers** come from `@j0nathan-ll0yd/portal-contract` (`SITE_URL`,
  `CLOUDFRONT_BASE`, `ENDPOINTS`) so the CDN host never drifts.

Regenerate + verify:

```bash
npm run generate:webmcp
# then validate agent-card.json against a2aproject/A2A specification/a2a.proto
# and ai-catalog.json against agenticresourcediscovery/ard-spec spec/schemas/ai-catalog.schema.json
```

## Agent-discovery conformance notes

### `agent-card.json` — A2A v1.0

Conforms to the A2A `AgentCard` message in `a2aproject/A2A` `specification/a2a.proto`.
Required fields present: `name`, `description`, `supportedInterfaces`, `version`,
`capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills`. There is **no
top-level `url`** in v1.0 — the endpoint lives inside `supportedInterfaces[]`
(`url` + `protocolBinding` + `protocolVersion`).

> **Caveat — discovery-only card.** This site is a **read-only data source**, not a live
> A2A JSON-RPC/gRPC agent. To satisfy the required `supportedInterfaces`, the single
> interface points at the machine-readable **MCP server-card** (`HTTP+JSON`). Integrators
> should consume data via the MCP server-card, not by sending A2A tasks. If A2A ever grows
> a real endpoint, replace this interface entry.

### `ai-catalog.json` — ARD `specVersion` 1.0

Conforms to `agenticresourcediscovery/ard-spec` `spec/schemas/ai-catalog.schema.json`.
Required: top-level `specVersion` + `entries`; each entry has `identifier` (RFC 8141
`urn:air:<publisher>:<namespace>:<name>`), `displayName`, `type` (IANA media type), and
exactly one of `url`/`data`. `host` and each entry are `additionalProperties: false` — no
stray fields (e.g. the pre-2026-07 files used `name` instead of `displayName`).

> **Caveat — agent-skills entry type.** ARD defines no dedicated media type for an
> agent-skills index, so that entry is typed `application/json`. The MCP and A2A entries use
> `application/mcp-server-card+json` and `application/a2a-agent-card+json` respectively.

## Spec-drift watch

These agent-discovery specs are young and moving. Conformance above is **point-in-time
(2026-07-07)**, not permanent:

- **A2A** cut v1.0 in 2026 (restructured the card into `supportedInterfaces`). Re-check the
  proto for further field changes.
- **ARD** is a v0.9 draft whose manifest `specVersion` is `1.0`; field names "may still
  change," and adoption is near-zero (a 2026-06-18 census found 0/39 major sites serving a
  discoverable `ai-catalog.json`). This is a first-mover bet.
- **DNS-AID** and **NLWeb** remain on the _watch_ list — not adopted (individual IETF draft;
  requires a live LLM endpoint on a paid, non-GA Cloudflare product, respectively).

A recurring issue tracks re-verification of all of the above on a monthly cadence.
