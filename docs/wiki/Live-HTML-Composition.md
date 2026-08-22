# Live HTML Composition

The deployed homepage must never present Design System fixture activity as factual personal data. Astro therefore keeps its deterministic, hermetic fixture build for tests, while the Cloudflare Pages root Function replaces the complete fixture-backed dashboard region before any normal HTML response leaves the edge.

## Request path

`functions/index.ts` obtains the static asset through `context.next()`. It then fetches seven approved CloudFront raw exports in parallel: health, sleep, workouts, GitHub events, articles, books, and starred repositories. `functions/_lib/dashboard-snapshot.ts` validates each payload independently with Ajv against the corresponding published `@j0nathan-ll0yd/portal-contract/raw-schemas` contract.

Location, focus state, and theatre reviews are deliberately absent from the public HTML snapshot. Location is a privacy exclusion. Focus is a privacy control rather than dashboard content. Theatre reviews have no server-rendered live presentation in this stage. Their fixture-rendered widgets are removed with the rest of the fixture region.

Profile identity and system presentation are outside that replaceable region. They are the documented static-content exception and are labelled `source: static` in the page provenance.

## Provenance and freshness

Each live card carries `data-ssr-domain`, `data-ssr-source`, `data-ssr-freshness`, and, when known, `data-generated-at`. The HTML also contains a `meta[name="ssr-data"]` JSON provenance map and an `X-SSR-Data` response summary. Visible source times are absolute source timestamps; the edge does not invent relative times.

Freshness thresholds are domain-specific:

| Domain | Stale after |
| --- | ---: |
| Health, sleep | 48 hours |
| Workouts, GitHub activity | 7 days |
| Articles, books, starred repositories | 30 days |

A valid older export remains visible but is marked stale. Fetch errors, timeouts, non-2xx responses, malformed JSON, schema failures, and invalid generation timestamps produce an explicit per-domain unavailable state. A failed domain never borrows fixture content and does not discard valid sibling domains. The seven fetches have a 2.5-second bound and a 60-second Cloudflare fetch cache hint.

If the static shell cannot be read or its replacement markers are missing, the Function fails closed with a minimal non-indexable 503 page. It never passes through the fixture-backed document.

## JavaScript enhancement

The Design System remains the canonical rich browser renderer. `public/js/dashboard-shell.js` requests a private fragment with `X-Dashboard-Client-Shell: 1`, swaps that fragment between the same boundary markers, and resolves `window.__dashboardShellReady`. The existing bundled live-data runtime waits for that promise before locating widgets and applying the published adapters and updaters.

The fragment response contains only the marker-bounded dashboard fragment, uses a vendor media type rather than `text/html`, is `no-store`, and is marked `X-Robots-Tag: noindex, noarchive`. If it cannot load, the truthful semantic snapshot stays in place and live-data mutation does not start.

## Verification

`tests/unit/dashboard-ssr.test.ts` covers endpoint allowlisting, privacy exclusion, schema isolation, stale timestamps, provenance, all-upstream failure, fixture removal, closed failure, and the private fragment boundary. The normal build remains network-free. For local Pages integration after `pnpm build`, run:

```bash
pnpm exec wrangler pages dev dist --compatibility-date=2026-06-10
```
