# Feed Spec

## Purpose

`jonathanlloyd.me` publishes a syndication feed in two formats — RSS 2.0
(`/feed.xml`) and JSON Feed 1.1 (`/feed.json`) — expressing the thesis:
**what Jonathan produces and completes**, not what he consumes or measures.
The live dashboard is the firehose; the feed is the durable record.

The guiding framing mirrors the metadata-files philosophy: every feed item
has a real event behind it. A published theatre review, a shipped PR, a
finished book. No synthetic entries, no aggregated-metric rows, no health
snapshots. Feed consumers (RSS readers, AI agents, archival tools) should
be able to rely on the feed as a faithful record of creative and intellectual
output.

## Format Choice: RSS 2.0 + JSON Feed 1.1

Two formats are published, identical in content:

| Format | Path | Content-Type |
| --- | --- | --- |
| RSS 2.0 | `/feed.xml` | `application/rss+xml; charset=utf-8` |
| JSON Feed 1.1 | `/feed.json` | `application/feed+json; charset=utf-8` |

**RSS 2.0** is the universal baseline — supported by every reader, every
aggregator, every crawler. **JSON Feed 1.1** is the modern complement —
native JSON parsing, richer metadata, favoured by developer-oriented
tooling and AI agents. Publishing both means no consumer is excluded.

Both formats carry identical items with the same guids, pubDates, and
content. The guid is a tag-URI (RFC 4151): `tag:jonathanlloyd.me,YYYY:domain/slug`.

## Composition Model: Backend-Composed (llms.txt Pattern)

The feed is composed by the `ComposeFeed` Lambda on every `BroadcastUpdate`
EventBridge trigger (plus a 30-minute safety-net schedule), writing
`feed.xml` and `feed.json` to CloudFront. The Cloudflare Pages Functions
`functions/feed.xml.ts` and `functions/feed.json.ts` proxy those
CloudFront artifacts with edge caching (`s-maxage=3600,
stale-while-revalidate=86400`), exposing them at the canonical root paths.

This mirrors the `llms.txt` composition pattern exactly. The alternative —
build-time composition — was rejected because the feed's freshness
proposition depends on live source data: a theatre review published two
days after the deploy, a PR merged an hour ago. Static build-time
composition would make the feed stale by definition.

**Freshness model:**

- Backend composes on EventBridge trigger (any source update) + 30-minute schedule
- CloudFront edge TTL: 5 minutes (`max-age=300`)
- Pages Function edge TTL: 1 hour (`s-maxage=3600`) with `stale-while-revalidate=86400`
- Expected staleness for a live event: 0–35 minutes

## Included Domains

Five domains are included. Each has a rationale for inclusion and a
per-domain item cap that prevents any single high-volume source from
flooding the feed and burying lower-volume, higher-signal domains.

### Theatre Reviews (cap: 10)

**Source:** Coast to Coast Reviews (`coasttocoastreviews.com`), first-party.

Theatre reviews are the highest-signal content in the feed: original
editorial work, published under Jonathan's byline, with a star rating and
a written excerpt. The feed surfaces the full review text in
`<content:encoded>` / `content_html` so consumers see the complete review
without following the link.

**pubDate:** `publishedAt` from the review record. Honest: reflects when
the review was published, not when it was exported.

### GitHub Activity (cap: 12)

**Source:** GitHub Events API, filtered to meaningful-only events.

**Included:** `pr_merged`, `issue_opened`, `release`, and other non-commit
event types.

**Excluded:**
- `commit` — too granular; a single feature generates dozens of commits
  that would dominate the feed. The merged PR is the meaningful unit.
- `pr_opened` — a PR that isn't merged yet may never be. Reporting the
  merge is the completion signal.

The guid discriminator includes the event type (`{repo}-{type}-{number}`)
to prevent a merged PR #N and an issue_opened #N from sharing a guid.

**pubDate:** `githubCreatedAt` (the event date). Honest: reflects when the
event occurred on GitHub.

### Starred Repositories (cap: 10)

**Source:** GitHub starred repos, ordered by `starredAt` descending.

Starred repositories signal what Jonathan finds technically interesting —
tools he's evaluated, libraries he intends to use, projects he admires.
Each item links to the repository with its description and primary
language.

**pubDate:** `starredAt`. Honest: reflects when Jonathan starred it.

### Finished Books (cap: 10)

**Source:** Bookshelf, filtered to `status = finished`.

Books Jonathan has finished reading. Each item includes title, author, and
(where available) cover image and description.

**pubDate:** `updatedAt` — an approximation of when the book was finished.
This is **disclosed** in the feed item and in this spec: `updatedAt` is the
last database write for the record, which correlates with finishing the
book but is not a precise finish date. The imprecision is acknowledged
rather than papered over (R1/D4 honest-timestamps principle).

### Saved Articles (cap: 12)

**Source:** Feedly via IFTTT, filtered by `savedAt`.

Articles Jonathan has saved, with source attribution and (where available)
a highlight or note. This reflects his reading breadth — what he found
worth preserving.

**pubDate:** `savedAt`. Honest: reflects when the article was saved.

## Excluded Domains

The following data categories are **structurally excluded** — they are not
parameters to `buildFeedView` and therefore cannot appear in the feed by
accident.

| Domain | Rationale |
| --- | --- |
| Health metrics | Point-in-time biometric data (HR, HRV, steps, calories, sleep stages). Not a completion/production signal; the 7-day aggregate in `llms.txt` is the appropriate surface. |
| Sleep | Same as health: continuous biometric stream, not a completion event. |
| Workouts | Individual workout rows are too granular and too personal. Weekly aggregate in `llms.txt` is appropriate. |
| Focus sessions | Granular time-tracking data; no meaningful completion signal per row. |
| Location | Six-layer privacy framework on the backend; location data requires suppression, delay, and broadening before any public surface. A feed is the wrong surface for this data at any granularity. |

The exclusion is **structural**: `buildFeedView(sources: FeedSources)` is
typed to accept only the five allowed domains. Passing health, sleep,
workout, focus, or location data is a compile-time error, not a runtime
check (C-PRIV-1).

## Privacy Stance

**No email.** RSS's `<managingEditor>` element requires an email address;
this site omits it. Instead, `<atom:author><atom:name>` carries the
author name without an email.

**No location data** in any feed item. See Excluded Domains above.

**Content escaping.** All dynamic values are entity-escaped via `escHtml()`
before assembly into HTML content. The RSS `<description>` field (parsed
as HTML by W3C validators) receives an escaped summary. The JSON Feed
`content_text` carries raw plain text (literal `&` is correct there).

## Discovery

Feed discovery follows the two-signal pattern established for other
metadata files:

- **HTML `<link>` in `<head>`** (`src/layouts/Dashboard.astro`) — two
  `<link rel="alternate">` elements, one per format.
- **HTTP `Link` response header** (`functions/_middleware.ts`) — two
  entries in the `LINK_HEADER` array on the homepage (`/`).

| Signal | RSS 2.0 | JSON Feed 1.1 |
| --- | --- | --- |
| `<link rel="alternate">` | `type="application/rss+xml" href="/feed.xml"` | `type="application/feed+json" href="/feed.json"` |
| `Link` header | `</feed.xml>; rel="alternate"; type="application/rss+xml"` | `</feed.json>; rel="alternate"; type="application/feed+json"` |

## Honest Timestamps

Every `pubDate` / `date_published` reflects the real event date — not the
compose timestamp, not the export timestamp. The compose timestamp is
recorded in the `lastBuildDate` channel field and in the S3 object
metadata, but never imputed to individual items.

The one exception — book `updatedAt` as a proxy for finish date — is
disclosed in the feed item's `content:encoded` commentary and in this
spec. See D4 in the honest-timestamps principle.

## Cross-References

- [Metadata-Files-Spec.md](Metadata-Files-Spec.md) — inventory of all
  root-level metadata files; discovery wiring conventions.
- [LLM-Content-Spec.md](LLM-Content-Spec.md) — `/llms.txt` content rules
  and freshness model (the composition pattern this feed mirrors).
- Backend: `mantle-LifegamesPortal/src/lib/feed-content/` — `view.ts`
  (domain builders, privacy exclusion, per-domain caps), `compose.ts`
  (RSS + JSON Feed serialization), `types.ts` (FeedSources allowlist).
- Backend Lambda: `mantle-LifegamesPortal/src/lambdas/eventbridge/ComposeFeed/index.ts`
