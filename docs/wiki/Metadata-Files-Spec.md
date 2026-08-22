# Metadata Files Spec

## Purpose

`jonathanlloyd.me` maintains a family of root-level metadata files — each
addressing a distinct audience and machine-readability level. Taken together
they make the site legible to search crawlers, AI agents, developer tools,
and human visitors without duplicating the information in each file.

The guiding framing: **every metadata file has an intended audience**. Writing
for the wrong audience (e.g., plain-text email in a publicly scraped file,
crawl-unfriendly redirect chains in a sitemap) is a failure mode, not a
configuration choice. Each file below targets one audience and is generated
by the mechanism best suited to that audience's freshness requirements.

## Inventory

| Path                        | Audience                  | Generation                                                           | Spec / reference |
| --------------------------- | ------------------------- | -------------------------------------------------------------------- | ---------------- |
| `/robots.txt`               | Machines (crawlers)       | Build-time endpoint (`src/pages/robots.txt.ts`)                      | robotstxt.org    |
| `/sitemap-index.xml`        | Machines (search engines) | `@astrojs/sitemap` integration                                       | sitemaps.org     |
| `/llms.txt`                 | AI agents                 | Backend-composed live (CloudFront proxy via `functions/llms.txt.ts`) | llmstxt.org      |
| `/humans.txt`               | Humans                    | Build-time endpoint (`src/pages/humans.txt.ts`)                      | humanstxt.org    |
| `/feed.xml`                 | RSS readers, aggregators  | Backend-composed live (CloudFront proxy via `functions/feed.xml.ts`) | RSS 2.0          |
| `/feed.json`                | Feed readers, AI agents   | Backend-composed live (CloudFront proxy via `functions/feed.json.ts`)| JSON Feed 1.1    |
| `/.well-known/api-catalog`  | Machines (API clients)    | Static file (`public/.well-known/api-catalog`)                       | RFC 9727         |
| `/.well-known/security.txt` | Machines + humans         | (Future) Static file at `/.well-known/security.txt`                  | RFC 9116         |

`/llms.txt` is the only backend-composed file because its value proposition is
**live data** — it reflects the current health, reading, and activity state and
is recomposed by the `ComposeLlmContent` Lambda on every EventBridge trigger.
Every other file is build-time: their contents are stable across deploys.

## Design Principles

### Build-time where possible

Backend composition is expensive operationally (Lambda + CloudFront TTL
management, cache invalidation, event-trigger timing). It is warranted only
when the file's audience needs **live** data — as AI agents querying `llms.txt`
do. Static metadata (who made the site, which crawlers are allowed, what
standards the site uses) is known at build time and must not depend on runtime
infrastructure.

### Strings from `@j0nathan-ll0yd/copy` for customer-facing content

Any string a human or agent reads as prose — name, location, job title, bio,
social links — is sourced from `@j0nathan-ll0yd/copy/identity.flat.json`. Endpoints
import this flat JSON at build time; the copy package is the single source of
truth. Presentational scaffolding (section delimiters like `/* TEAM */`,
protocol field labels like `Name:`, `Hosting:`) lives in the endpoint itself
because it is format-specific layout, not content. See [Copy Package
Spec](Copy-Package-Spec.md) for authoring conventions.

### Privacy-first

No plain-text email appears in any metadata file. The site is a read-only,
public surface with no authentication; a plain-text email in a file accessible
to every scraper is a harvesting invitation. Existing public profile URLs
(LinkedIn, GitHub — from `identity.person.sameAs`) provide contact channels
without the exposure risk.

Location is coarse: city-level only (`identity.person.location`), consistent
with the 6-layer location privacy framework on the backend export pipeline.

### Discovery via `<link>` and `Link` header

Machine consumers need a reliable way to discover metadata files without
guessing paths. This site uses two complementary signals:

- **HTML `<link>` in `<head>`** (`Dashboard.astro`) — declarative, parsed by
  browsers and crawlers that fetch the HTML document.
- **HTTP `Link` response header** (`functions/_middleware.ts`) — injected on
  the homepage (`/`) only, for agents that inspect headers without parsing HTML.

The middleware is the **single authority for response headers**. The `_headers`
file at repo root is inert — Cloudflare Pages disables `_headers` processing
when a root Pages Function middleware is present. Any header change must go in
`functions/_middleware.ts`.

Discovery `<link>` relations in use:

| Relation                                          | File                 | Standard             |
| ------------------------------------------------- | -------------------- | -------------------- |
| `rel="describedby" type="text/plain"`          | `/llms.txt`          | RFC 8288             |
| `rel="api-catalog"`                              | `/.well-known/api-catalog` | RFC 9727       |
| `rel="ai-catalog"`                               | `/.well-known/ai-catalog.json` | ARD        |
| `rel="sitemap"`                                   | `/sitemap-index.xml` | HTML Living Standard |
| `rel="author"`                                    | `/humans.txt`        | HTML Living Standard |
| `rel="alternate" type="application/rss+xml"`      | `/feed.xml`          | RSS 2.0 / HTML5      |
| `rel="alternate" type="application/feed+json"`    | `/feed.json`         | JSON Feed 1.1        |

### Honest metadata

Metadata that lies is worse than absent metadata. Two specific anti-patterns
this site avoids:

- **`lastmod` stamped to the deploy date.** A deploy-time `lastmod` on an
  unchanged page teaches search engines the signal is fake. The sitemap either
  derives `lastmod` from real content history or omits it.
- **Rotting hardcoded dates.** `humans.txt` derives `Last update:` from
  `new Date().toISOString().slice(0, 10)` at build time. This is honest: the
  file IS regenerated on every deploy (because it is a prerendered endpoint),
  so the build date accurately reflects the file's state.

## Privacy Stance

### No email

RFC 9116 (`security.txt`) and the humanstxt.org convention both suggest an
email contact. This site deliberately omits email from all plain-text metadata
files. The reasoning:

1. Plain-text email in a publicly indexed file is trivially harvestable.
2. The site's public profile links (LinkedIn, GitHub) are adequate contact
   channels for any legitimate inquiry.
3. The site operator's email is not a secret, but it is not the site's job to
   make harvesting it easy.

When `/security.txt` is eventually added (RFC 9116), it will use
`Contact: https://...` (URL form) rather than `Contact: mailto:...`.

### Coarse location

`humans.txt` includes a `From:` field using city-level location only
(`identity.person.location`). This matches the granularity already public on
professional profiles and is consistent with the backend's location privacy
framework, which delays, suppresses, and broadens precise location data before
it reaches the web surface.

## File Notes

### `/robots.txt` — build-time endpoint

Managed in `src/pages/robots.txt.ts`. Contains allow/disallow directives for
search engines and 9 named AI bots, a `Sitemap:` pointer, and a
`Content-Signal:` line per the IETF `draft-romm-aipref-contentsignals` spec
(`search=yes, ai-train=no, ai-input=yes`). Source of truth for which bots are
allowed to crawl and under what conditions.

### `/sitemap-index.xml` — `@astrojs/sitemap` integration

Auto-generated at build time by `@astrojs/sitemap`. Lists the single canonical
URL `https://jonathanlloyd.me/`. `lastmod` is omitted (config: no `lastmod`
option set) to avoid the deploy-timestamp anti-pattern. The index/child split
is `@astrojs/sitemap`'s default output shape; it is protocol-valid and harmless
at this scale.

### `/llms.txt` — backend-composed live

The only runtime-composed metadata file. The `ComposeLlmContent` Lambda writes
it to CloudFront on each EventBridge data-change trigger (30-minute safety-net
schedule). `functions/llms.txt.ts` is a Cloudflare Pages Function that proxies
the CloudFront-hosted canonical with edge caching (`s-maxage=3600,
stale-while-revalidate=86400`). See [LLM-Content-Spec.md](LLM-Content-Spec.md)
for the full inventory, content-granularity rules, and freshness expectations.

### `/feed.xml` and `/feed.json` — backend-composed live

The syndication feed in two formats: RSS 2.0 (`/feed.xml`) and JSON Feed
1.1 (`/feed.json`). Both express the same thesis — what Jonathan produces
and completes — and carry identical items with the same guids and pubDates.
Backend-composed by the `ComposeFeed` Lambda on EventBridge triggers (plus
a 30-minute safety-net schedule); the Cloudflare Pages Functions
`functions/feed.xml.ts` and `functions/feed.json.ts` proxy the
CloudFront-hosted canonicals with edge caching (`s-maxage=3600,
stale-while-revalidate=86400`).

Five included domains: theatre reviews (first-party, cap 10), meaningful
GitHub activity (merged PRs + issues, cap 12), starred repositories (cap
10), finished books (cap 10, pubDate = `updatedAt` disclosed as approximate),
and saved articles (cap 12). Health, sleep, workouts, focus, and location
are structurally excluded. See [Feed-Spec.md](Feed-Spec.md) for the full
content philosophy, domain rationales, privacy stance, and composition model.

### `/humans.txt` — build-time endpoint

Managed in `src/pages/humans.txt.ts`. Follows the humanstxt.org three-section
convention (`/* TEAM */`, `/* SITE */`, `/* THANKS */`). All data values
(`Name:`, `From:`, `Contact:`, `Software:`, `Hosting:`, `Standards:`,
`/* THANKS */` credits) are sourced from `@j0nathan-ll0yd/copy`; section delimiters
and field labels are endpoint scaffolding. `Contact:` points to the LinkedIn
URL (`identity.person.sameAs[0]`), not an email address. `Last update:` is
derived from the build timestamp (honest, because the endpoint is prerendered
on every deploy).

### `/.well-known/api-catalog` — static RFC 9727

Static JSON file at `public/.well-known/api-catalog`, copied to `dist/` by
Astro at build time. RFC 9727 linkset format — advertises the CloudFront data
API to agent clients. `Content-Type: application/linkset+json` is set by the
middleware override (not by `_headers`).

### `/.well-known/security.txt` — future (RFC 9116)

Not yet implemented. When added, it will be a static file at
`public/.well-known/security.txt` using `Contact: https://...` (URL, not
`mailto:`). The `Link` header and HTML `<link>` discovery wiring should be
added at the same time as the file. Do not pre-wire the Link header with no
backing file (dangling 404).

## Cross-References

- [LLM-Content-Spec.md](LLM-Content-Spec.md) — `/llms.txt` content rules,
  freshness model, agent-readiness inventory, and middleware header spec.
- [Feed-Spec.md](Feed-Spec.md) — `/feed.xml` and `/feed.json` content
  philosophy, domain inclusion/exclusion rationales, privacy stance, honest
  timestamps, and composition model.
- [Copy-Package-Spec.md](Copy-Package-Spec.md) — `@j0nathan-ll0yd/copy` authoring
  model, build pipeline, and zero-duplication invariant.
