# LLM Content Spec

## Purpose

Map the LLM-optimized content surface of jonathanlloyd.me: which artifacts exist,
where they are served, and which document owns each normative fact.

This page is a reader's map, not an authority. It links normative clauses instead
of restating them. The reason is recorded: this page asserted
`s-maxage=3600, stale-while-revalidate=86400` for `/llms.txt` long after the
public serving policy became `no-store` on all three cache headers, and no gate
caught it because a restated clause is prose that nothing measures (atlas
decision 0128 P0a). Descriptive prose -- what a thing is, what it is for, what it
looked like on a dated observation -- stays here.

## Authority map

| Fact                                                              | Owning authority                                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which llm outputs exist                                           | `LLM_FRESHNESS_CONFIG.outputs` -- `@j0nathan-ll0yd/estate-contracts/llms-assurance`                                                                                     |
| Served and canonical paths                                        | `LLM_CONTENT_PATHS`, `DATASET_DISTRIBUTIONS`, `CLOUDFRONT_BASE` -- `@j0nathan-ll0yd/portal-contract/constants`                                                          |
| Registry record for the surface                                   | atlas `surfaces.yaml`, surface `llm-outputs`                                                                                                                            |
| Serving behavior: status, content type, privacy gate, negotiation | `openspec/specs/llms-txt/spec.md` (this repo)                                                                                                                           |
| Public response cache policy                                      | `LLM_FRESHNESS_CONFIG.layers.portfolioServing.publicResponseCachePolicy`, with the openspec requirement "Canonical llms responses always pass through the privacy gate" |
| Freshness thresholds, skew window, audit cadences                 | `LLM_FRESHNESS_CONFIG.layers.originComposition` and `.layers.portfolioServing.coherencePolicy`                                                                          |
| `llms.txt` structural profile                                     | `checkLlmsStructure` -- `@j0nathan-ll0yd/estate-contracts/llms-structure`; severity from `audits/specs/llms-txt/*.rule.json`                                            |
| Document set, section order, content floors, granularity          | mantle-LifegamesPortal `openspec/specs/llm-content/spec.md`                                                                                                             |
| Robots policy for AI crawlers                                     | `src/pages/robots.txt.ts`, which generates `/robots.txt`                                                                                                                |
| AI usage preference header                                        | `functions/_middleware.ts` and `public/_headers`                                                                                                                        |

Implementation files are evidence for these facts, not owners of them. Where this
page cites a file, read it as "the behavior is visible here", not "the rule lives
here".

## File Inventory

| File            | Served at                                | Purpose                                                                        |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `llms.txt`      | <https://jonathanlloyd.me/llms.txt>      | Discovery index. Points at the rich variants on CloudFront.                    |
| `llms-full.txt` | <https://jonathanlloyd.me/llms-full.txt> | Complete dump: profile, body aggregates, and full mind/system/streams content. |
| `index.md`      | <https://jonathanlloyd.me/index.md>      | Alias of `llms-full.txt` for agents that expect an `.md` extension.            |

All three are composed by the backend (mantle-LifegamesPortal, the `llm-content`
capability) on data-change events, written to CloudFront, and served on
jonathanlloyd.me by three Cloudflare Pages Functions -- `functions/llms.txt.ts`,
`functions/llms-full.txt.ts`, `functions/index.md.ts` -- all built by one factory,
`functions/_lib/proxy.ts`. The raw CloudFront representations remain fetchable at
`CLOUDFRONT_BASE`; the canonical public URLs are the three above.

The byte-identity of `index.md` and `llms-full.txt`, the document set, the section
order, and the per-document content floors are producer facts: see
mantle-LifegamesPortal `openspec/specs/llm-content/spec.md`, requirements
"Canonical document set", "Full documents carry a content floor", and "index.md
mirrors the full document".

## Serving Policy

The three canonical paths are served no-store at every public cache layer, and
every request passes the focus/privacy gate before any cached representation can
be returned. Both facts are normative and owned elsewhere:

- `LLM_FRESHNESS_CONFIG.layers.portfolioServing.publicResponseCachePolicy` states
  the headers and the response classes they apply to.
- `openspec/specs/llms-txt/spec.md`, requirement "Canonical llms responses always
  pass through the privacy gate", states the behavior and its verification.
- `openspec/specs/llms-txt/spec.md`, requirement "Cache policy is per route, and
  the feed routes stay edge-cached", states why `/feed.xml` and `/feed.json` carry
  a different policy. They are a different surface (`rss-feed`); see
  [Feed-Spec.md](Feed-Spec.md).

The internal caches the proxy does keep -- a short CloudFront fetch cache and a
last-known-good copy in the edge Cache API -- sit behind the privacy gate and are
declared in `LLM_FRESHNESS_CONFIG.layers.portfolioServing.internalCaches`.

## Content Granularity

Health data is emitted as rolling aggregates only; everything else is emitted at
full granularity. The composer owns both rules, and the normative statement lives
in mantle-LifegamesPortal `openspec/specs/llm-content/spec.md`, requirement
"Aggregated-only privacy". That requirement, not this page, is what a reader
should cite for which fields are forbidden in the body section.

The aggregation promise itself has a standing open question about what the
composer computes today -- atlas decision 0120 D1, carried forward as 0128 P0b. It
is an owner decision and is not settled here.

## Structure of the Discovery Index

`llms.txt` follows the llmstxt.org convention as narrowed by the Lifegames profile
(atlas decision 0040). The rules are machine-readable and shared by both sides of
the seam:

- `checkLlmsStructure(rawText)` from `@j0nathan-ll0yd/estate-contracts/llms-structure`
  decides what is structurally wrong. The producer consumes it in its contract
  test; this repo consumes it in `audits/checks/b2-llms.mjs`.
- `audits/specs/llms-txt/*.rule.json` decides how bad each finding is, and carries
  the pinned external citation for every conformance rule.
- `openspec/specs/llms-txt/spec.md`, requirement "Served llms.txt conforms to the
  Lifegames llms.txt profile", states the serving-side obligation.

Which `##` sections a given composition actually contains is a producer output, not
a fact this page fixes. Read the live file, or the producer spec's "Canonical
document set" requirement.

## Freshness and Detection

Every published representation carries a composition timestamp: the discovery index
uses an `<!-- composed-at: ... -->` marker, the full artifacts use a
`**Generated:** ...` line. Responses also carry an `X-Composed-At` header from the
compose Lambda.

All thresholds and cadences are stated once, in the packaged contract:
`LLM_FRESHNESS_CONFIG.layers.originComposition` (composition cadence, origin cache
freshness, warning and error ages, daily producer audit) and
`.layers.portfolioServing` (weekly serving audit, plus the `coherencePolicy`
maximum composition age, skew, and future-clock allowance). Nothing in this repo
restates a number from it; `audits/checks/b2-llms.mjs` derives every threshold it
applies through the contract's own `durationToMilliseconds`.

Worst-case detection latency for the public path is the serving threshold plus the
serving audit cadence. The weekly B2 check derives and prints that figure from the
contract fields on every run (atlas decision 0128 P4), so the interval the check
actually provides is stated where the check is read rather than restated here.

The normative freshness obligation is `openspec/specs/llms-txt/spec.md`, requirement
"Full-content artifacts stay fresh".

## Robots Policy

`/robots.txt` is generated by `src/pages/robots.txt.ts`, which is the authority for
which AI crawlers are blocked, which search and answer agents are allowed, and which
path is carved out of each block. Read that file for the current lists rather than a
count restated here. The rich variants on CloudFront are governed by the backend's
own robots policy, if any; this surface does not mandate one.

## Compliance

The producer's composition checks -- token budgets, strict monotonic size, scalar-leaf
coverage, no Level-1 leakage in the body section, absolute URLs only, spec conformance,
and `index.md` byte-identity -- belong to mantle-LifegamesPortal and are specified in
its `openspec/specs/llm-content/spec.md`.

This repo's serving-side checks are the weekly B2 lane, `audits/checks/b2-llms.mjs`:
a structure arm over the served `llms.txt`, a presence arm over the two full artifacts,
and a coherence arm over all six origin/site responses. Its validation matrix lives in
`openspec/specs/llms-txt/spec.md`.

## Agent Readiness (isitagentready.com)

Beyond LLM content, the site publishes machine-readable discovery files for AI agents.
These are static files in `public/.well-known/` that Astro copies to `dist/` at build
time.

### Static Discovery Files (in this repo)

| File                                                        | Spec                          | Purpose                                           |
| ----------------------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `public/.well-known/api-catalog`                            | RFC 9727 (linkset JSON)       | Advertises CloudFront data API to agents          |
| `public/.well-known/mcp/server-card.json`                   | MCP SEP-2127                  | Declares read-only data resources for MCP clients |
| `public/.well-known/agent-skills/index.json`                | Agent Skills Discovery v0.2.0 | Skills discovery index                            |
| `public/.well-known/agent-skills/portfolio-expert/SKILL.md` | agentskills.io                | Curated portfolio context for agents              |
| `public/.well-known/ai-catalog.json`                        | ARD `specVersion` 1.0         | Catalogs the MCP and Agent Skills resources       |

Each file is its own authority. See [Metadata-Files-Spec.md](Metadata-Files-Spec.md)
for the rest of the metadata surface.

### AI Usage Preferences

Site responses carry an HTTP `Content-Usage` preference header. `functions/_middleware.ts`
sets it on Function responses and the `public/_headers` wildcard sets it on static
responses and cache hits; Cloudflare does not apply `_headers` rules to Pages Function
responses, which is why both exist. Those two files own the emitted value.

The IETF AI Preferences Working Group drafts attach-05 and vocab-07 (verified 2026-08-19)
define the header and its two current vocabulary categories, search indexing and AI model
training. The vocabulary defines no AI-input category. The attachment draft also describes
a robots extension, which the site does not emit because Lighthouse treats it as an unknown
directive.

### WebMCP

`Dashboard.astro` registers browser-side tools via
`navigator.modelContext.provideContext()` (W3C Community Draft). Feature-detected, so it
is a no-op in browsers without support. The tool list is generated by
`scripts/generate-webmcp.mjs`.

### Cloudflare Configuration (version-controlled)

HTTP header manipulation and content negotiation are handled by the Pages Function
middleware at `functions/_middleware.ts`. This replaced an earlier Transform Rule plus
standalone Worker approach.

The middleware handles security headers, the LLM discovery `Link` header on the homepage,
the RFC 9727 content-type override for `/.well-known/api-catalog`, markdown negotiation on
the homepage, a homepage cache bypass signal, and the content-use preference. The normative
statement of the negotiation behavior is `openspec/specs/llms-txt/spec.md`, requirement
"Markdown negotiation applies only to the homepage and honors Accept q-values".

#### Cache Rule (dashboard-only, not version-controlled)

A Cache Rule named **"Homepage bypass for content negotiation"** is configured in the
Cloudflare dashboard:

- **Match:** `http.request.uri.path eq "/"`
- **Action:** Bypass cache

This is required because Cloudflare Pages caches HTML at the edge and bypasses Pages
Functions on cache hits. Without the rule, `Accept: text/markdown` requests receive cached
HTML instead of reaching the middleware. The middleware's `CDN-Cache-Control: no-store` on
`/` is a secondary signal; Cloudflare Pages' built-in caching overrides it, so the Cache
Rule is the authoritative bypass.

A second, account-level Edge Cache TTL rule is an external dependency this repo cannot
assert: it can rewrite response cache headers on the way out. The contract records it as
`required-unverified` in `LLM_FRESHNESS_CONFIG.layers.portfolioServing.externalDependencies`.

### Score Breakdown

A dated observation, not a standing claim. Re-run the checker rather than trusting the
table.

#### Observed 2026-08-23: 100/100

| Check                    | Status | Notes                                                                                 |
| ------------------------ | ------ | ------------------------------------------------------------------------------------- |
| robots.txt               | PASS   | Training crawlers blocked except the discovery path; search and answer agents allowed |
| Sitemap                  | PASS   | sitemap-index.xml                                                                     |
| Link headers             | PASS   | Pages Function middleware sets on `/`                                                 |
| Markdown Negotiation     | PASS   | Pages Function + Cache Rule bypass                                                    |
| AI bot rules             | PASS   | Training and search/answer agents configured                                          |
| Content-Usage            | PASS   | HTTP header set by middleware and `_headers`                                          |
| API Catalog              | PASS   | RFC 9727 `application/linkset+json` via middleware                                    |
| OAuth/OIDC               | SKIP   | No auth surface (static portfolio)                                                    |
| OAuth Protected Resource | SKIP   | No auth surface (static portfolio)                                                    |
| MCP Server Card          | PASS   | Static JSON file                                                                      |
| Agent Skills             | PASS   | Static JSON + SKILL.md                                                                |
| WebMCP                   | PASS   | External ES2017 async script with feature detection                                   |

## Consumers

Public readers are an open consumer class. These artifacts are unauthenticated files on
the public web, so anything that fetches a URL can read them, and this surface cannot
enumerate its consumers. A list of agent names would describe what someone once observed,
not who consumes the files, and naming an agent does not establish that it consumes them.

The design target is therefore the convention, not a vendor: the file inventory and URL
shape follow the llmstxt.org spec and the `llms-full.txt` split pattern. No behavior here
depends on any named agent. The one place consumption is actually measured is the
serving-side audit lane, which observes the artifacts rather than their readers.
