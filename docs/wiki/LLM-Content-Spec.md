# LLM Content Spec

## Purpose

Define the LLM-optimized content surface of jonathanlloyd.me for discoverability
and consistent consumer expectations. All rich variants are composed by the
backend on data-change events and served from CloudFront; the only file hosted
on `jonathanlloyd.me` is `/llms.txt`, which exists as a discovery pointer.

## File Inventory

| File | Location | Size budget | Purpose |
|---|---|---|---|
| `llms.txt` | https://jonathanlloyd.me/llms.txt | ~2 KB | Discovery index. Hand-maintained in `public/llms.txt`. Points at the rich variants on CloudFront. |
| `llms-small.txt` | https://d1pfm520aduift.cloudfront.net/llms-small.txt | ≤ 8 KB | Current-state snapshot. Backend-composed. Profile + Level-2 body aggregates + Level-1 mind highlights (last 7 days). |
| `llms-full.txt` | https://d1pfm520aduift.cloudfront.net/llms-full.txt | ≤ 30 KB | Complete dump. Backend-composed. Profile + Level-2 body + full Level-1 mind/system/streams. |
| `index.md` | https://d1pfm520aduift.cloudfront.net/index.md | ≤ 30 KB | Byte-identical alias of `llms-full.txt`. Same content, alternate URL for agents expecting `.md` extensions. |

## Content Granularity

### Level 2 (body metrics -- aggregate only)

The composer must emit **only** 7-day aggregates for health data:

- Average, min, max over a rolling 7-day window
- Trend direction (`stable`, `rising`, `falling`, `slight rise`, `slight fall`)
- Interpretive phrasing against `health.ranges` thresholds (e.g., "excellent", "fair", "below target")

The composer **must not** emit:
- Point-in-time values (today's heart rate, today's steps)
- Raw daily counts (calories, exercise minutes, stand minutes, distance)
- Individual workout rows (summarize as "~N workouts per week, avg duration X min, avg burn Y kcal")
- Raw hydration ounces or caffeine mg (aggregate only: "typically hits target range")

### Level 1 (everything else -- full granularity)

- **GitHub**: all stats, all recent commits with hashes and URLs, all repositories, all languages, weekly commit trends, hour-of-day distribution
- **Books**: title, author, ISBN, status, rating, progress, series info, genres, publication year, description
- **Reading feed**: article title, source, date, category, starred flag
- **Theatre reviews**: title, venue, date seen, rating, review text
- **Starred repositories**: name, description, stars, language, topics
- **Profile**: name, title, location, bio, skills, interests, social links, expertise

## Required Sections

### `llms.txt` (discovery index)

Must contain, in order:
1. H1 with site name
2. Blockquote summary (1-2 sentences)
3. `## About` -- profile snippet
4. `## Live LLM-optimized content` -- links to llms-small.txt, llms-full.txt, index.md
5. `## Canonical JSON` -- links to the raw CloudFront JSON endpoints
6. `## Technology` -- stack summary
7. `## Documentation` -- wiki links
8. `## Expertise` -- keyword list

### `llms-small.txt` (backend-composed snapshot)

Must contain, in order:
1. H1 with "Jonathan Lloyd — Current State"
2. Blockquote summary
3. `## Profile` -- identity summary
4. `## Current state — <date>` -- H3 `### Body` (Level 2 table) + `### Hydration` (aggregate)
5. `## Mind activity — last 7 days` -- H3 `### GitHub`, `### Recent commits` (top 5), `### Currently reading`, `### Up next`, `### Recently finished` (top 3), `### Starred articles this week`
6. `## Data freshness` -- table listing `{source, last fetched}` per CloudFront endpoint
7. Footer: `Composed: <ISO 8601>`

### `llms-full.txt` (backend-composed complete)

Must contain, in order:
1. H1 with "Jonathan Lloyd — Human Datastream (Complete)"
2. Blockquote summary
3. `Composed: <ISO 8601>` line
4. `## Profile {#profile}` -- full identity, expertise, links
5. `## Body {#body}` -- Level 2 aggregates: heart/HRV table, sleep 7-day table, activity 7-day table, hydration 7-day summary, workouts 7-day summary
6. `## Mind {#mind}` -- Level 1 full content: GitHub section, bookshelf section (currently reading, up next, recently finished, reading stats), reading feed table, theatre reviews section
7. `## System {#system}` -- status indicators + per-source freshness table + note on how composition works
8. `## Streams {#streams}` -- canonical JSON endpoint URLs for agents preferring raw data

## Freshness Expectations

- **Backend composes on:** EventBridge trigger on any source JSON update, plus 30-minute safety-net schedule
- **CloudFront edge TTL:** 300 seconds (5 minutes) -- set via `Cache-Control: public, s-maxage=300` header written by the compose Lambda
- **Expected staleness:** 0-5 minutes for honest consumers; up to ~35 minutes in the worst case (30-minute schedule + 5-minute edge cache)
- **Freshness debugging:** every composer output includes an `X-Composed-At: <ISO 8601>` response header (set by the compose Lambda) and a `Composed: <ISO 8601>` footer line (rendered inside the markdown)

## Robots.txt Policy

github.io's `robots.txt` lists `Allow: /llms.txt` before `Disallow: /` under each of the 9 currently-blocked AI bots. The rich variants on CloudFront are governed by the backend repo's robots.txt policy (if any). This spec does not mandate a specific CloudFront robots.txt -- that's a backend concern.

## Compliance (backend)

The backend composer must pass these checks (implementation belongs to the backend repo):

1. **Token budgets** -- `bytes/4` estimate within budget per file
2. **Strict monotonic size** -- `size(llms.txt) < size(llms-small.txt) < size(llms-full.txt) = size(index.md)`
3. **Scalar-leaf coverage** -- every scalar leaf in source JSON is covered, transformed, or explicitly ignored
4. **No Level-1 leakage in body section** -- regex assertions that body section contains no point-in-time BPM/step/calorie values
5. **Absolute URLs only** -- regex: no `\](/ ` (relative markdown links)
6. **Spec conformance** -- H1 first, blockquote on line 3, required H2 sections present in order
7. **index.md byte-identity** -- `sha256(dist/index.md) == sha256(dist/llms-full.txt)`

## Agent Readiness (isitagentready.com)

Beyond LLM content, the site publishes machine-readable discovery files for AI agents. These are static files in `public/.well-known/` that Astro copies to `dist/` at build time.

### Static Discovery Files (in this repo)

| File | Spec | Purpose |
|---|---|---|
| `public/.well-known/api-catalog` | RFC 9727 (linkset JSON) | Advertises CloudFront data API to agents |
| `public/.well-known/mcp/server-card.json` | MCP SEP-2127 | Declares read-only data resources for MCP clients |
| `public/.well-known/agent-skills/index.json` | Agent Skills Discovery v0.2.0 | Skills discovery index |
| `public/.well-known/agent-skills/portfolio-expert/SKILL.md` | agentskills.io | Curated portfolio context for agents |

### Content Signals

`robots.txt` includes `Content-Signal: search=yes, ai-train=no, ai-input=yes` under `User-agent: *` per the IETF draft-romm-aipref-contentsignals spec. This declares:
- Search indexing: allowed
- AI model training: blocked
- AI input/RAG/grounding: allowed

### WebMCP

`Dashboard.astro` registers browser-side tools via `navigator.modelContext.provideContext()` (W3C Community Draft). Feature-detected -- no-op in browsers without support. Tools: `get_profile`, `get_data_sources`, `get_current_reading`, `get_tech_stack`.

### Cloudflare Configuration (manual, not in this repo)

These settings must be configured in the Cloudflare dashboard for `jonathanlloyd.me`. They cannot be set from GitHub Pages.

#### 1. Transform Rule: Link Response Headers

- **Path:** Rules > Transform Rules > Modify Response Header
- **Match:** Hostname equals `jonathanlloyd.me` AND URI Path equals `/`
- **Action:** Add static header
- **Header:** `Link`
- **Value:** `</llms.txt>; rel="describedby"; type="text/plain", </.well-known/api-catalog>; rel="api-catalog", </sitemap-index.xml>; rel="sitemap"`

#### 2. Transform Rule: API Catalog Content-Type

- **Path:** Rules > Transform Rules > Modify Response Header
- **Match:** URI Path equals `/.well-known/api-catalog`
- **Action:** Set static header
- **Header:** `Content-Type`
- **Value:** `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`

GitHub Pages serves extensionless files as `application/octet-stream`. This rule overrides it to the RFC 9727-required content type.

#### 3. Markdown for Agents

- **Path:** AI Crawl Control > Quick Actions (or Rules > Configuration Rules)
- **Action:** Enable "Markdown for Agents" toggle
- **Note:** May require Cloudflare Pro plan. When enabled, Cloudflare automatically returns `text/markdown` when agents send `Accept: text/markdown`.

### Score Breakdown

With all static files deployed and Cloudflare configured:

| Check | Status | Notes |
|---|---|---|
| robots.txt | PASS | Already passing |
| Sitemap | PASS | Already passing |
| Link headers | PASS | Requires Cloudflare Transform Rule |
| Markdown Negotiation | PASS | Requires Cloudflare Markdown for Agents |
| AI bot rules | PASS | Already passing |
| Content Signals | PASS | Added to robots.txt |
| API Catalog | PASS | Static file + Cloudflare Content-Type rule |
| OAuth/OIDC | SKIP | No auth surface (static portfolio) |
| OAuth Protected Resource | SKIP | No auth surface (static portfolio) |
| MCP Server Card | PASS | Static JSON file |
| Agent Skills | PASS | Static JSON + SKILL.md |
| WebMCP | PASS | Inline ES5 script with feature detection |

**Projected score:** 83/100 (10/12 checks). OAuth checks are N/A for a static site with no protected APIs.

## Consumers

As of 2026, agents known to actively probe `/llms.txt` at root and follow links to richer variants:

- Cursor (via `@Docs` command)
- Claude Code (via Skills + MCP)
- ChatGPT Search (via GPTBot)
- Perplexity (via PerplexityBot)

This spec does not depend on any specific agent's behavior -- the file inventory and URL conventions match the llmstxt.org spec and the emerging `llms-full.txt` split pattern adopted by Anthropic, Cloudflare, Mintlify, and others.
