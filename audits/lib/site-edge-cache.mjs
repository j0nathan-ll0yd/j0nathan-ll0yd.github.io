// audits/lib/site-edge-cache.mjs -- the ONE edge-cache rule for a served gated path. Two checks
// judge with it: audits/checks/b2-llms.mjs for /llms.txt, /llms-full.txt and /index.md, and
// audits/checks/b2-check-feeds.mjs for /feed.xml and /feed.json. It lives here, not in either
// check, so a load-time defect in one check cannot darken the other.

import {SITE_RUNTIME, SITE_RUNTIME_HEADER} from '../../src/lib/edge/security-headers.ts'

/** True when a Cache-Control style header names the `no-store` directive. */
export function hasNoStore(value) {
  return value?.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store') ?? false
}

/** `CF-Cache-Status` values that say Cloudflare's edge cache did not answer from a stored copy. */
const EDGE_UNCACHED_STATUSES = new Set(['BYPASS', 'DYNAMIC'])

/**
 * The edge-cache arm of the site plane: no edge cache served a stored, possibly stale, copy of
 * a gated document (the llms trio in b2-llms.mjs, the two feeds in b2-check-feeds.mjs). Returns the finding message, or null when the response proves it.
 *
 * TWO PLANES, ONE PROPERTY (atlas decision 0160). On Cloudflare Pages the zone cache sat in
 * front of the Function, so the observable was `CF-Cache-Status: BYPASS|DYNAMIC`. On Workers
 * the Worker runs AHEAD of the zone cache (wrangler.jsonc enables no Workers Cache, pinned by
 * tests/unit/worker-routing.test.ts), and it builds each response itself from a `no-store`
 * CloudFront fetch with no `cf` cache options (src/lib/edge/proxy.ts GATED_FETCH_INIT), refusing
 * any upstream 200 that Cloudflare answered from cache. Its response therefore carries no
 * `CF-Cache-Status` at all. An absent status is accepted ONLY with three corroborating facts:
 *
 * 1. `X-Site-Runtime: workers`, the middleware's platform marker. Without it the Worker did not
 *    answer (the request skipped it, as a fail-open route once could), so the absence proves nothing.
 * 2. No `Age`. Cloudflare sets `Age` on a response its cache served (HIT, STALE, UPDATING).
 * 3. `CDN-Cache-Control: no-store`, so no shared cache downstream of the Worker stores it either.
 *    `llms-site-cdn-cache-policy` also reds on that header. The overlap is deliberate: this arm
 *    proves its own pass rather than leaning on another arm, so one defect yields two findings.
 *
 * A present status is still judged on Workers. A Worker response can carry one: a response the
 * Worker takes from the ASSETS binding keeps its headers (src/worker.ts `fromAssets`), and
 * /version.json answered `cf-cache-status: HIT` with `x-site-runtime: workers` on 2026-10-16 UTC.
 *
 * Any `Age` reds, on either plane. A present status other than BYPASS or DYNAMIC reds too: HIT,
 * STALE, UPDATING and REVALIDATED served a stored copy, and MISS or EXPIRED mean the response
 * was eligible for storage and the next request can be a HIT.
 *
 * @param {{age?: string | null, cfCacheStatus?: string | null, cdnCacheControl?: string | null, siteRuntime?: string | null}} snapshot
 *   the served response headers (b2-llms.mjs `LlmsResponseSnapshot` carries them)
 * @returns {string | null}
 */
export function siteEdgeCacheFailure(snapshot) {
  const age = snapshot.age?.trim() || null
  if (age !== null) {
    return `site carries Age: ${JSON.stringify(snapshot.age)}; an edge cache served a stored copy`
  }
  const edgeStatus = snapshot.cfCacheStatus?.trim().toUpperCase() || null
  if (edgeStatus !== null) {
    return EDGE_UNCACHED_STATUSES.has(edgeStatus)
      ? null
      : `site CF-Cache-Status is ${JSON.stringify(snapshot.cfCacheStatus)}; expected BYPASS or DYNAMIC, or none on a Worker response`
  }
  const runtime = snapshot.siteRuntime?.trim().toLowerCase() || null
  if (runtime !== SITE_RUNTIME) {
    return `site has no CF-Cache-Status and ${SITE_RUNTIME_HEADER} is ${JSON.stringify(snapshot.siteRuntime ?? null)}; ` +
      `an absent status is accepted only on a Worker response (${SITE_RUNTIME_HEADER}: ${SITE_RUNTIME})`
  }
  if (!hasNoStore(snapshot.cdnCacheControl)) {
    return `site Worker response has no CF-Cache-Status and CDN-Cache-Control is ${JSON.stringify(snapshot.cdnCacheControl)}; ` +
      'an absent status is accepted only with CDN-Cache-Control: no-store'
  }
  return null
}
