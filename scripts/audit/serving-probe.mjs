#!/usr/bin/env node
// scripts/audit/serving-probe.mjs -- tight-cadence serving probe.
//
// WHAT GAP THIS CLOSES. audit-web.yml already validates these same live
// artifacts, but on daily/weekly/monthly tiers. A TRANSIENT stale serve -- a
// CDN handing back stale composed-at metadata behind an unchanged ETag, or a
// cache-header regression that makes a composed artifact browser-cacheable --
// can be live for days before the weekly tier notices. This probe is the
// tight-cadence (target 15-minute) SUBSET of those checks. It reuses the same
// assertion logic and the same oracle; it invents no new thresholds.
//
// Each trio artifact is fetched from BOTH planes -- the site (via the Pages
// Functions proxy) and the CloudFront origin behind it -- and the contract's
// origin-site coherence pair is evaluated per artifact. That is the only way to
// see a proxy serving a composed-at that LAGS its origin: a transient sub-4h
// lag is internally consistent and well inside the 4h composition-age window,
// so no site-only check can detect it. The cost is 3 extra GETs per tick.
//
// The SAME two-plane treatment covers /feed.xml and /feed.json, under a
// DIFFERENT budget. The trio is no-store end to end, so its two planes must
// converge inside the contract's 10m composition skew. The feeds are
// deliberately edge-cacheable (proxy.ts EDGE_CACHED_POLICY), so a site copy
// legitimately trails the origin by the cache layers stacked between them.
// evaluateFeedOriginSiteCoherence below derives that allowance instead of
// asserting the trio's window; see its comment for the derivation.
//
// READ-ONLY. Issues HTTP GETs and inspects responses. Touches no site source,
// no CSP, no build behavior, no served artifact -- the same guarantee
// audit-web.yml makes.
//
// TRI-STATE, FAIL-CLOSED. Every check yields passed / failed / unknown
// (reported as pass / fail / indeterminate). An unreachable endpoint, a
// non-parseable body, or a missing expected header is UNKNOWN, never a silent
// pass. The aggregate uses the contract's own precedence rule
// (aggregateSpokeEvidenceStatus: any failed -> failed; else any unknown ->
// unknown; else passed) and this process exits non-zero for BOTH failed and
// unknown, so the managed issue for the bucket opens or stays open. Only an
// all-green run exits 0 and lets the reconciler close it.

import freshnessConfig from '@j0nathan-ll0yd/estate-contracts/llms-assurance/freshness-config.json' with {type: 'json'}
import {aggregateSpokeEvidenceStatus, assertFreshnessConfig, durationToMilliseconds} from '@j0nathan-ll0yd/estate-contracts/llms-assurance'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {COMPOSED_AT_METADATA_HEADER, FEED_ARTIFACTS} from '../../functions/_lib/feed-artifacts.ts'
import {LLMS_ARTIFACTS} from '../../functions/_lib/llms-artifacts.ts'
import {fetchStable, isMain} from './lib/http.mjs'
import {probeSuppression, suppressionDisposition} from './lib/suppression.mjs'
import {validateFeedJson, validateFeedXml} from './check-feeds.mjs'
import {validateLlmsTxt} from './validate-llms-txt.mjs'

// THE ORACLE. Thresholds are read from the shared contract, never restated as
// literals here -- the same package the offline/CI checks consume. Validating
// it up front means a malformed or re-versioned config fails loudly at start
// rather than silently degrading a threshold to undefined.
const CONFIG = assertFreshnessConfig(freshnessConfig)
const SERVING = CONFIG.layers.portfolioServing
const COHERENCE = SERVING.coherencePolicy

export const MAX_COMPOSITION_AGE_MS = durationToMilliseconds(COHERENCE.maxCompositionAge) // 4h
export const MAX_COMPOSITION_SKEW_MS = durationToMilliseconds(COHERENCE.maxCompositionSkew) // 10m
// "inclusive" means a skew of exactly maxCompositionSkew is still convergence.
const SKEW_INCLUSIVE = COHERENCE.skewBoundary === 'inclusive'

// THE TWO CACHE LAYERS BETWEEN THE COMPOSER AND THE PAGES FUNCTION, both read
// from the same contract rather than restated. They bound how far a site-plane
// FEED copy may legitimately trail its origin; see
// evaluateFeedOriginSiteCoherence for the full derivation.
export const ORIGIN_CACHE_FRESHNESS_MS = durationToMilliseconds(CONFIG.layers.originComposition.cacheFreshness) // 300s
export const SITE_FETCH_FRESHNESS_MS = durationToMilliseconds(SERVING.internalCaches.cloudFrontFetchFreshness) // 60s

// HEADERS THE CONTRACT REQUIRES BUT A CLIENT CAN NEVER SEE.
//
// Cloudflare ALWAYS strips `Cloudflare-CDN-Cache-Control` before the response
// reaches the client -- it is a Cloudflare-only control directive, consumed and
// removed at the edge by design. An external probe therefore cannot observe it,
// and its absence is evidence of nothing at all. Asserting it would manufacture
// a permanent, uninformative failure on every run.
//
// `Cache-Control` and `CDN-Cache-Control` DO pass through and are observable, so
// those are the two the probe asserts. This is a restriction of the OBSERVATION
// SURFACE, not of the oracle: the required directive is still read from the
// contract below, and a new observable header added to the contract is picked
// up here automatically.
const UNOBSERVABLE_CACHE_HEADERS = new Set(['cloudflare-cdn-cache-control'])

// {Cache-Control: 'no-store', CDN-Cache-Control: 'no-store'}
export const REQUIRED_CACHE_HEADERS = Object.freeze(
  Object.fromEntries(Object.entries(SERVING.publicResponseCachePolicy.headers).filter(([name]) => !UNOBSERVABLE_CACHE_HEADERS.has(name.toLowerCase())))
)

// `cf-cache-status` values proving the response was NOT served from edge cache.
export const ACCEPTABLE_CACHE_STATES = Object.freeze(['dynamic', 'bypass'])
// Values proving it WAS served from edge cache -- incompatible with no-store.
export const CACHED_STATES = Object.freeze(['hit', 'revalidated', 'stale', 'updating'])

// Result-id fragment for each artifact. Explicit rather than derived from the
// id so the emitted result ids stay greppable, and so an artifact added to the
// shared registry fails loudly below instead of silently going unprobed.
const TRIO_KEY_BY_ID = Object.freeze({'llms.txt': 'llms-txt', 'llms-full.txt': 'llms-full-txt', 'index.md': 'index-md'})

// The composed llm-outputs family. Each artifact is served on TWO planes and
// this probe observes BOTH:
//   site   -- jonathanlloyd.me, via the Pages Functions proxy
//             (functions/llms.txt.ts, llms-full.txt.ts, index.md.ts)
//   origin -- the CloudFront data plane that proxy fetches from
//
// Both URLs come from functions/_lib/llms-artifacts.ts -- the same module the
// proxy routes read for their `path` and the weekly B2 coherence audit
// (check-llms-coherence.mjs) reads for its own pair. The proxy builds
// `upstreamUrl = ${CLOUDFRONT_BASE}${path}` (functions/_lib/proxy.ts), and
// llms-artifacts.ts derives `originUrl` by that identical rule, so the origin
// URL probed here cannot drift from the one the proxy actually fetches. The
// llms.txt path itself is not a literal anywhere: it is read off the portal
// contract's generated distribution registry.
export const TRIO = Object.freeze(LLMS_ARTIFACTS.map(({id, siteUrl, originUrl}) => {
  const key = TRIO_KEY_BY_ID[id]
  if (!key) {
    throw new Error(`LLMS_ARTIFACTS carries "${id}", which serving-probe has no result-id fragment for -- add one to TRIO_KEY_BY_ID`)
  }
  return {key, url: siteUrl, originUrl}
}))

// Result-id fragment per feed artifact, explicit for the same reason as
// TRIO_KEY_BY_ID: the emitted ids stay greppable, and a feed added to the
// shared registry fails loudly instead of silently going unprobed.
const FEED_KEY_BY_ID = Object.freeze({'feed.xml': 'feed-xml', 'feed.json': 'feed-json'})

// The syndication feeds, on the SAME two planes the trio is observed on:
//   site   -- jonathanlloyd.me, via the Pages Functions proxy
//             (functions/feed.xml.ts, functions/feed.json.ts)
//   origin -- the CloudFront data plane that proxy fetches from
//
// Both URLs come from functions/_lib/feed-artifacts.ts -- the same module the
// two route files read their `path` from -- and `originUrl` is derived there by
// the proxy's own `${CLOUDFRONT_BASE}${path}` rule, so the origin URL probed
// here cannot drift from the one the proxy actually fetches.
//
// `format` selects the structural validator and the composition marker:
//   rss  -- check-feeds.mjs validateFeedXml; composed-at in <lastBuildDate>
//   json -- check-feeds.mjs validateFeedJson; NO in-body composition marker
export const FEEDS = Object.freeze(FEED_ARTIFACTS.map(({id, siteUrl, originUrl}) => {
  const key = FEED_KEY_BY_ID[id]
  if (!key) {
    throw new Error(`FEED_ARTIFACTS carries "${id}", which serving-probe has no result-id fragment for -- add one to FEED_KEY_BY_ID`)
  }
  return {key, id, url: siteUrl, originUrl, format: id.endsWith('.json') ? 'json' : 'rss'}
}))

// The public JSON exports are served from the CloudFront data plane, NOT from
// jonathanlloyd.me -- the site origin 404s every one of them, because the
// dashboard runtime fetches them from CloudFront directly (AGENTS.md "Data
// Flow": Client-side -> CloudFront). atlas/surfaces.yaml records the same
// serving plane (`staging-is-live`). Both the base and the paths come from
// @j0nathan-ll0yd/portal-contract/constants -- the constant the client itself
// uses -- so this list cannot drift from what the browser actually requests.
//
// DELIBERATELY EXCLUDED: ENDPOINTS.health / .sleep / .workouts / .focus. Those
// are focus/privacy-gated and return the suppression path to an external
// caller; treating a suppression response as a failure would red this probe
// every time focus mode is on, which is correct behavior, not a regression.
export const JSON_EXPORTS = Object.freeze([
  {key: 'books', url: `${CLOUDFRONT_BASE}${ENDPOINTS.books}`},
  {key: 'articles', url: `${CLOUDFRONT_BASE}${ENDPOINTS.articles}`},
  {key: 'theatre-reviews', url: `${CLOUDFRONT_BASE}${ENDPOINTS.theatreReviews}`},
  {key: 'github-events', url: `${CLOUDFRONT_BASE}${ENDPOINTS.githubEvents}`},
  {key: 'github-starred-repos', url: `${CLOUDFRONT_BASE}${ENDPOINTS.starredRepos}`}
])

// LOCAL OPERATIONAL THRESHOLD, not a contract one. llms-assurance declares
// freshness windows for the composed outputs (originComposition) but none for
// the individual sourceExports, so there is no contract value to read here.
// 7 days mirrors the soft window check-feeds.mjs already applies to the same
// class of slow-moving content surfaces (feed-json-stale / feed-xml-stale
// params.maxAgeDays). Measured 2026-08-30: the five exports ranged 0.10 to
// 4.02 days old, so this window has real headroom and still catches a stuck
// producer.
export const JSON_EXPORT_MAX_AGE_DAYS = 7

const PASSED = 'passed'
const FAILED = 'failed'
const UNKNOWN = 'unknown'

const VERDICT_LABEL = Object.freeze({passed: 'pass', failed: 'fail', unknown: 'indeterminate'})

const result = (id, status, message) => ({id, status, message})

/** Normalizes a header value for comparison: absent stays null, present is trimmed and lowercased. */
function normalizeHeaderValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

/**
 * Reads the required cache headers off a response into a plain, comparable
 * object keyed by lowercase header name. Accepts anything with a `.get()`
 * (a real Headers, or a plain map in tests).
 */
export function readCachePolicy(headers) {
  const observed = {}
  for (const name of Object.keys(REQUIRED_CACHE_HEADERS)) {
    observed[name.toLowerCase()] = normalizeHeaderValue(headers?.get?.(name.toLowerCase()) ?? headers?.get?.(name) ?? null)
  }
  return observed
}

/**
 * Pure: (observed cache policy) -> tri-state verdict, asserted STRICTLY against
 * the contract.
 *
 * There is deliberately no known-deviation escape hatch. One existed while an
 * account-level Cloudflare Edge Cache TTL rule was rewriting `max-age` on the
 * way out (forcing `max-age=600` regardless of what the worker set). That rule
 * has since been corrected out-of-band -- a Cache Rule now bypasses cache and
 * respects the origin for the trio -- so the condition it excused is gone and
 * the exemption with it. The contract is now asserted as written.
 *
 * passed -- every observable required header carries its required directive.
 * failed -- any observable required header is absent or carries anything else.
 */
export function evaluateCachePolicy(observed) {
  const required = Object.entries(REQUIRED_CACHE_HEADERS).map(([name, directive]) => [name.toLowerCase(), normalizeHeaderValue(directive)])

  const missing = required.filter(([key, directive]) => observed[key] !== directive)
  if (missing.length === 0) {
    return {status: PASSED, message: `every required cache header carries its required directive (${required.map(([key]) => key).join(', ')})`}
  }

  const rendered = missing.map(([key, directive]) => `${key}: expected "${directive}", got ${observed[key] === null ? '(absent)' : `"${observed[key]}"`}`)
    .join('; ')

  return {status: FAILED, message: `served cache policy does not satisfy the contract: ${rendered}`}
}

/**
 * Pure: (cf-cache-status header) -> tri-state verdict.
 *
 * A `no-store` artifact must not be served out of the edge cache. Cloudflare
 * reports what it actually did in `cf-cache-status`, which is the only direct
 * evidence of cache STATE -- the cache headers above state intent, this states
 * outcome. The two together are what catch a stale serve: correct headers with
 * a HIT means something upstream is still caching.
 *
 * passed  -- DYNAMIC or BYPASS: the response came from the origin, not the cache.
 * failed  -- HIT / REVALIDATED / STALE / UPDATING: served from the edge cache.
 * unknown -- absent, or any other value (MISS, EXPIRED, NONE, ...). Fail-closed:
 *            a state this probe cannot classify is not a pass. These states mean
 *            the response went to the origin but Cloudflare still ran it through
 *            cache logic, which is worth a look; they are reported unverified
 *            rather than assigned a verdict this probe has no basis to assign.
 */
export function evaluateCacheState(cacheStatus) {
  const observed = normalizeHeaderValue(cacheStatus)
  if (observed === null) {
    return {status: UNKNOWN, message: 'no cf-cache-status header on the response -- cache state could not be determined'}
  }
  if (ACCEPTABLE_CACHE_STATES.includes(observed)) {
    return {status: PASSED, message: `cf-cache-status is "${observed}" -- served from the origin, not the edge cache`}
  }
  if (CACHED_STATES.includes(observed)) {
    return {status: FAILED, message: `cf-cache-status is "${observed}" -- served from the edge cache, which no-store forbids`}
  }
  return {
    status: UNKNOWN,
    message: `cf-cache-status is "${observed}", which is neither a known uncached state (${ACCEPTABLE_CACHE_STATES.join(', ')}) ` +
      `nor a known cached state (${CACHED_STATES.join(', ')}) -- not verified`
  }
}

/**
 * Pure: (artifact body) -> composition timestamp string, or null. The returned
 * string is whatever the artifact advertises; every consumer runs it through
 * Date.parse, so an ISO 8601 and an RFC 822 marker are interchangeable here.
 *
 * Three markers are in live use and all are supported (observed 2026-08-30):
 *   llms.txt                  ->  <!-- composed-at: 2026-08-30T17:46:28.050Z -->
 *   llms-full.txt / index.md  ->  **Generated:** 2026-08-30T17:46:28.232Z
 *   feed.xml                  ->  <lastBuildDate>Sun, 30 Aug 2026 23:38:43 GMT</lastBuildDate>
 *
 * feed.json is DELIBERATELY absent from that list and returns null: JSON Feed
 * 1.1 defines no build-date field, so its served body carries no composition
 * marker at all. Its origin plane advertises one out-of-band in the
 * x-amz-meta-composed-at object metadata, which the Pages Functions proxy does
 * not forward -- evaluateFeedOriginSiteCoherence handles that asymmetry rather
 * than this function inventing a marker feed.json does not have.
 *
 * `lastBuildDate` is the RSS channel's compose timestamp, not an item date:
 * docs/wiki/Feed-Spec.md "Honest Timestamps" records that the compose
 * timestamp lands there and in the S3 object metadata, and is never imputed to
 * an item.
 *
 * Last-Modified is deliberately NOT a fallback on these routes: the Pages
 * Functions proxy builds a fresh Response, so Last-Modified reflects the edge
 * cache entry rather than the composition and would report a stale serve as
 * perfectly fresh -- the exact failure this probe exists to catch.
 */
export function extractCompositionTimestamp(body) {
  if (typeof body !== 'string') {
    return null
  }
  const patterns = [
    /<!--\s*composed-at:\s*([^\s>]+)\s*-->/i,
    /\*\*Generated:\*\*\s*([0-9T:.Z+-]+)/i,
    /<lastBuildDate>\s*([^<]+?)\s*<\/lastBuildDate>/i
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match && Number.isFinite(Date.parse(match[1]))) {
      return match[1]
    }
  }
  return null
}

/**
 * Pure: (Age header value) -> seconds the edge has held this copy, floored at 0.
 *
 * Absent, negative, or unparseable collapses to 0, which is the STRICTEST
 * reading: it credits the response with no edge dwell at all and therefore
 * grants the smallest coherence allowance below. Fail-closed by construction --
 * a missing Age can only tighten a verdict, never loosen one.
 */
export function parseAgeSeconds(value) {
  const seconds = Number.parseInt(typeof value === 'string' ? value.trim() : '', 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

/**
 * Pure: (site-plane Age in seconds) -> how far a site FEED copy may trail its
 * origin before that lag stops being explainable by caching.
 *
 * Every term is read from the shared contract or observed on the response; no
 * threshold is invented here.
 *
 *   Age                       the Cloudflare edge has held THIS copy for this
 *                             long, so it was fetched from the worker Age
 *                             seconds ago (observed; 0 when absent)
 * + cloudFrontFetchFreshness  the worker's own origin fetch cache may have been
 *                             this stale at that moment (contract, 60s)
 * + cacheFreshness            CloudFront may have been this stale when the
 *                             worker fetched it (contract, 300s)
 *
 * The sum is the oldest composition a correctly behaving stack can still be
 * serving. Anything older is not explained by any cache layer in the path.
 */
export function feedLagBudgetMs(ageSeconds = 0) {
  const dwellMs = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds * 1000 : 0
  return dwellMs + SITE_FETCH_FRESHNESS_MS + ORIGIN_CACHE_FRESHNESS_MS
}

/** Pure: (timestamp, now) -> tri-state verdict against the contract's 4h maximum composition age. */
export function evaluateCompositionAge(timestamp, now = new Date(), maxAgeMs = MAX_COMPOSITION_AGE_MS) {
  if (timestamp === null || !Number.isFinite(Date.parse(timestamp))) {
    return {status: UNKNOWN, message: 'no parseable composition timestamp in the served body -- freshness could not be determined'}
  }
  const ageMs = now.getTime() - Date.parse(timestamp)
  const ageHours = (ageMs / 3_600_000).toFixed(2)
  if (ageMs > maxAgeMs) {
    return {status: FAILED, message: `composed at ${timestamp}, ${ageHours}h old, exceeds the ${(maxAgeMs / 3_600_000).toFixed(0)}h maximum composition age`}
  }
  return {status: PASSED, message: `composed at ${timestamp}, ${ageHours}h old, within the ${(maxAgeMs / 3_600_000).toFixed(0)}h maximum composition age`}
}

/**
 * Pure: coherence between two served artifacts, per the contract's
 * coherencePolicy.
 *
 * byteEqualityRequiredWhen is "same-composition-timestamp": exact bytes are
 * required ONLY when both sides advertise the SAME composition timestamp.
 * Different-but-adjacent generations inside the skew window are
 * "convergence-not-corruption", not a failure. Beyond the window is a failure.
 * A missing timestamp on either side is UNKNOWN -- it cannot be a pass.
 */
export function evaluateCoherence(left, right, maxSkewMs = MAX_COMPOSITION_SKEW_MS, inclusive = SKEW_INCLUSIVE) {
  const pair = `${left.key} vs ${right.key}`
  if (left.timestamp === null || right.timestamp === null) {
    const which = [left.timestamp === null ? left.key : null, right.timestamp === null ? right.key : null].filter(Boolean).join(' and ')
    return {status: UNKNOWN, message: `${pair}: no composition timestamp on ${which} -- coherence could not be determined`}
  }

  const leftMs = Date.parse(left.timestamp)
  const rightMs = Date.parse(right.timestamp)
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return {status: UNKNOWN, message: `${pair}: an advertised composition timestamp is not parseable -- coherence could not be determined`}
  }

  if (leftMs === rightMs) {
    if (left.body === right.body) {
      return {status: PASSED, message: `${pair}: same composition timestamp (${left.timestamp}) and identical bytes`}
    }
    return {
      status: FAILED,
      message: `${pair}: both advertise composition timestamp ${left.timestamp} but the served bytes differ ` +
        `(${left.body?.length ?? 0} vs ${right.body?.length ?? 0}) -- byte equality is required at the same composition timestamp`
    }
  }

  const skewMs = Math.abs(leftMs - rightMs)
  const withinSkew = inclusive ? skewMs <= maxSkewMs : skewMs < maxSkewMs
  const skewMinutes = (skewMs / 60_000).toFixed(2)
  if (withinSkew) {
    return {
      status: PASSED,
      message: `${pair}: adjacent fresh generations ${skewMinutes}m apart (${left.timestamp} / ${right.timestamp}), ` +
        `within the ${(maxSkewMs / 60_000).toFixed(0)}m ${inclusive ? 'inclusive ' : ''}skew window -- convergence, not corruption`
    }
  }
  return {
    status: FAILED,
    message: `${pair}: composition skew ${skewMinutes}m (${left.timestamp} / ${right.timestamp}) exceeds the ${(maxSkewMs / 60_000).toFixed(0)}m maximum`
  }
}

/**
 * Pure: (artifact key, site body, origin body) -> the contract's ORIGIN-SITE
 * coherence verdict for ONE trio artifact.
 *
 * This is the pair that catches the PRIMARY bug class this probe exists for:
 * the Pages Functions proxy serving a composed-at that LAGS the CloudFront
 * origin it proxies. A site-only observation cannot see it, because a lagging
 * copy is still internally consistent and still well inside the 4h composition
 * age -- a transient sub-4h origin lag is invisible to every other check here.
 *
 * The rule is evaluateCoherence's, unchanged: same composition timestamp
 * demands byte equality, a difference inside the 10m skew window is
 * convergence, beyond it is a failure, and a body that never arrived (null on
 * either side) is UNKNOWN. Fail-closed: an unreachable origin is never a pass.
 */
export function evaluateOriginSiteCoherence(key, siteBody, originBody) {
  const side = (plane, body) => ({
    key: `${key}@${plane}`,
    timestamp: typeof body === 'string' ? extractCompositionTimestamp(body) : null,
    body: typeof body === 'string' ? body : null
  })
  return evaluateCoherence(side('site', siteBody), side('origin', originBody))
}

/**
 * Pure: (feed key, site observation, origin observation, now) -> the ORIGIN-SITE
 * coherence verdict for ONE feed artifact.
 *
 * WHY THIS IS NOT evaluateOriginSiteCoherence. The trio is `no-store` on every
 * cache header of every response class, so its two planes are expected to hold
 * the SAME composition and the contract's 10m skew window is the right
 * assertion. The feeds are the opposite by design: EDGE_CACHED_POLICY
 * (functions/_lib/proxy.ts) makes them `s-maxage=60`, deliberately
 * edge-cacheable, so a site copy that trails the origin is CORRECT behavior,
 * not a regression. Asserting the trio's window here would red the lane for a
 * feed doing exactly what it is configured to do.
 *
 * What replaces it is not a looser guess. It is the sum of the cache layers
 * physically between the composer and the client, every term read from the
 * contract or observed on the response -- see feedLagBudgetMs. A lag inside
 * that sum is explained by caching; a lag beyond it is explained by nothing,
 * which is the bug class worth catching.
 *
 * Both planes are handled by one rule, with the JSON asymmetry made explicit:
 *
 *   site.body / origin.body        served bytes, or null when the plane did not
 *                                  answer OK
 *   site.timestamp                 feed.xml: <lastBuildDate>. feed.json: null,
 *                                  because JSON Feed 1.1 has no such field and
 *                                  the proxy forwards no object metadata
 *   origin.timestamp               feed.xml: <lastBuildDate>. feed.json: the
 *                                  x-amz-meta-composed-at object metadata
 *                                  CloudFront mirrors to the client
 *   site.ageSeconds                the site response's own Age header
 *
 * passed  -- bytes match; or the lag is inside the budget.
 * failed  -- both planes advertise the SAME composition but serve different
 *            bytes; or the site advertises a composition NEWER than its own
 *            origin (impossible under a proxy, so it means mixed origins); or
 *            the lag exceeds the budget.
 * unknown -- a plane never answered, or no composition marker exists on the
 *            side needed to classify a byte difference. Fail-closed.
 */
export function evaluateFeedOriginSiteCoherence(key, site, origin, now = new Date()) {
  const pair = `${key}@site vs ${key}@origin`
  const siteBody = typeof site?.body === 'string' ? site.body : null
  const originBody = typeof origin?.body === 'string' ? origin.body : null

  if (siteBody === null || originBody === null) {
    const which = [siteBody === null ? 'site' : null, originBody === null ? 'origin' : null].filter(Boolean).join(' and ')
    return {status: UNKNOWN, message: `${pair}: the ${which} plane served no body -- coherence could not be determined`}
  }

  // Every failing message below shows its own arithmetic, so a red result names
  // which term was too small rather than only that some budget was exceeded.
  const ageSeconds = Number.isFinite(site?.ageSeconds) && site.ageSeconds > 0 ? site.ageSeconds : 0
  const budgetMs = feedLagBudgetMs(ageSeconds)
  const budgetMinutes = (budgetMs / 60_000).toFixed(2)
  const dwell = `Age ${ageSeconds}s + ${SITE_FETCH_FRESHNESS_MS / 1000}s worker fetch cache ` + `+ ${ORIGIN_CACHE_FRESHNESS_MS / 1000}s CloudFront TTL`

  // The strongest evidence there is: the site is serving the origin's current
  // object verbatim. No timestamp is needed to conclude coherence from it, which
  // is what makes feed.json checkable at all on its usual path.
  if (siteBody === originBody) {
    return {status: PASSED, message: `${pair}: byte-identical (${siteBody.length} bytes) -- the site serves the origin's current composition`}
  }

  const originMs = Date.parse(origin?.timestamp ?? '')
  if (!Number.isFinite(originMs)) {
    return {
      status: UNKNOWN,
      message: `${pair}: the served bytes differ and the origin advertises no parseable composition timestamp ` +
        `(${COMPOSED_AT_METADATA_HEADER} / <lastBuildDate>) -- the difference could not be classified`
    }
  }

  const siteMs = Date.parse(site?.timestamp ?? '')
  if (!Number.isFinite(siteMs)) {
    // feed.json's normal path once its content moves. The site plane advertises
    // no composition at all, so the only answerable question is whether the
    // origin recomposed recently enough for the caches to still be holding the
    // previous object. A site copy older than that is stuck, not merely cached.
    const originAgeMs = now.getTime() - originMs
    const originAgeMinutes = (originAgeMs / 60_000).toFixed(2)
    if (originAgeMs <= budgetMs) {
      return {
        status: PASSED,
        message: `${pair}: bytes differ and the site plane advertises no composition marker, but the origin recomposed ` +
          `${originAgeMinutes}m ago (${origin.timestamp}), inside the ${budgetMinutes}m cache budget (${dwell}) -- ` +
          'the site is still serving the previous object, which the cache layers explain'
      }
    }
    return {
      status: FAILED,
      message: `${pair}: bytes differ, yet the origin composition is ${originAgeMinutes}m old (${origin.timestamp}) -- ` +
        `beyond the ${budgetMinutes}m cache budget (${dwell}), so no cache layer explains the site serving something else`
    }
  }

  if (siteMs === originMs) {
    return {
      status: FAILED,
      message: `${pair}: both advertise composition timestamp ${origin.timestamp} but the served bytes differ ` +
        `(${siteBody.length} vs ${originBody.length}) -- byte equality is required at the same composition timestamp`
    }
  }

  if (siteMs > originMs) {
    return {
      status: FAILED,
      message: `${pair}: the site advertises composition ${site.timestamp}, NEWER than its own origin's ${origin.timestamp} -- ` +
        'a proxy cannot serve a composition its origin has not published, so the two planes are reading different origins'
    }
  }

  const lagMs = originMs - siteMs
  const lagMinutes = (lagMs / 60_000).toFixed(2)
  if (lagMs <= budgetMs) {
    return {
      status: PASSED,
      message: `${pair}: the site trails the origin by ${lagMinutes}m (${site.timestamp} / ${origin.timestamp}), ` +
        `inside the ${budgetMinutes}m cache budget (${dwell}) -- explained by caching, not a stale serve`
    }
  }
  return {
    status: FAILED,
    message: `${pair}: the site trails the origin by ${lagMinutes}m (${site.timestamp} / ${origin.timestamp}), ` +
      `beyond the ${budgetMinutes}m cache budget (${dwell}) -- no cache layer in the path explains a lag that large`
  }
}

/**
 * Pure: structural verdict for one feed artifact, delegating to check-feeds.mjs
 * rather than restating either format's rules or their freshness windows.
 *
 * feed.json gets the same treatment feed.xml already had. Before this it was
 * not probed at all on the tight cadence, so a feed.json that started serving
 * an error page, an empty item list, or unparseable JSON was invisible until
 * the weekly tier ran.
 */
export function evaluateFeedStructure(key, format, body, now = new Date()) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return {status: UNKNOWN, message: `${key}: served an empty body -- structure could not be determined`}
  }

  let findings
  try {
    if (format === 'json') {
      findings = validateFeedJson(JSON.parse(body), now)
    } else {
      findings = validateFeedXml(body, now)
    }
  } catch (err) {
    return {status: UNKNOWN, message: `${key}: validator could not evaluate the served body: ${err.message}`}
  }

  const fails = findings.filter((finding) => finding.severity === 'fail')
  if (fails.length > 0) {
    return {status: FAILED, message: `${key}: ${fails.map((finding) => `${finding.id}: ${finding.message}`).join('; ')}`}
  }
  const shape = format === 'json' ? 'JSON Feed 1.1' : 'RSS 2.0'
  return {status: PASSED, message: `${key}: parses as ${shape} and satisfies check-feeds.mjs structural rules`}
}

/**
 * Pure: structural verdict for one trio artifact.
 *
 * llms.txt runs the SHARED structural rule
 * (@j0nathan-ll0yd/estate-contracts/llms-structure, via validate-llms-txt.mjs's
 * catalog wrapper) -- the same oracle the weekly B2 check and the backend
 * producer use.
 *
 * llms-full.txt and index.md deliberately do NOT run that rule. They are not
 * llmstxt.org documents: both open with a <SYSTEM> preamble before their H1 and
 * carry prose lists and multiple headings, so the llms.txt structural rule
 * would report conformance failures on a perfectly healthy artifact.
 * validate-llms-txt.mjs draws the same line -- structural validation for
 * llms.txt, presence/non-emptiness/freshness for the other two. What this adds
 * over "non-empty" is an H1 assertion, which is what catches a truncated or
 * error-page body being served in their place.
 */
export function evaluateTrioStructure(key, body) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return {status: UNKNOWN, message: `${key}: served an empty body -- structure could not be determined`}
  }

  if (key === 'llms-txt') {
    const findings = validateLlmsTxt(body).filter((finding) => finding.severity === 'fail')
    if (findings.length > 0) {
      return {status: FAILED, message: `${key}: ${findings.map((finding) => `${finding.id}: ${finding.message}`).join('; ')}`}
    }
    return {status: PASSED, message: `${key}: conforms to the shared llms-structure rule`}
  }

  const hasH1 = body.split('\n').some((line) => /^#\s+\S/.test(line))
  if (!hasH1) {
    return {status: FAILED, message: `${key}: no "# <title>" H1 heading anywhere in the served body -- likely a truncated or substituted artifact`}
  }
  return {status: PASSED, message: `${key}: non-empty and carries an H1 heading`}
}

/** Pure: freshness verdict for one public JSON export, from its own generatedAt stamp. */
export function evaluateJsonExportFreshness(key, payload, now = new Date(), maxAgeDays = JSON_EXPORT_MAX_AGE_DAYS) {
  const stamp = payload && typeof payload === 'object' ? payload.generatedAt : undefined
  if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) {
    return {status: UNKNOWN, message: `${key}: no parseable "generatedAt" stamp in the payload -- freshness could not be determined`}
  }
  const ageDays = (now.getTime() - Date.parse(stamp)) / 86_400_000
  if (ageDays > maxAgeDays) {
    return {status: FAILED, message: `${key}: generated ${stamp}, ${ageDays.toFixed(2)} days old, exceeds the ${maxAgeDays}-day window`}
  }
  return {status: PASSED, message: `${key}: generated ${stamp}, ${ageDays.toFixed(2)} days old, within the ${maxAgeDays}-day window`}
}

/**
 * Aggregate a result list to a single status using the CONTRACT's precedence
 * rule rather than a reimplementation: any failed -> failed; else any unknown
 * -> unknown; else passed.
 */
export function aggregate(results) {
  return aggregateSpokeEvidenceStatus(results.map(({status}) => ({status})))
}

/** Print the tri-state report and return the process exit code. Fail-closed: only an all-green run exits 0. */
export function report(results) {
  const counts = {passed: 0, failed: 0, unknown: 0}
  console.log('\n=== serving-probe ===')
  for (const {id, status, message} of results) {
    counts[status] += 1
    console.log(`  [${VERDICT_LABEL[status]}] ${id}: ${message}`)
  }
  const overall = results.length === 0 ? UNKNOWN : aggregate(results)
  console.log(`  ${counts.failed} fail, ${counts.unknown} indeterminate, ${counts.passed} pass, ${results.length} total`)
  console.log(`  overall: ${VERDICT_LABEL[overall]}`)
  // Fail-closed: an indeterminate bucket must keep the managed issue open, and
  // the reconciler only treats a FAILING step outcome that way -- an
  // "indeterminate" step outcome would leave the issue untouched instead.
  return overall === PASSED ? 0 : 1
}

// Stryker disable all -- everything below is network-path plumbing with no test
// coverage; the pure evaluators above are what the unit tests exercise.

/** Fetches one URL and returns a normalized observation. A transport failure is UNKNOWN, never a pass. */
async function observe(url) {
  try {
    const response = await fetchStable(url)
    return {ok: response.ok, status: response.status, headers: response.headers, body: await response.text(), error: null}
  } catch (err) {
    return {ok: false, status: null, headers: null, body: null, error: err.message}
  }
}

function transportResult(id, url, observation) {
  if (observation.error !== null) {
    return result(id, UNKNOWN, `fetch of ${url} failed: ${observation.error} -- endpoint unreachable, not verified`)
  }
  if (!observation.ok) {
    return result(id, FAILED, `HTTP ${observation.status} fetching ${url}`)
  }
  return result(id, PASSED, `HTTP ${observation.status} fetching ${url}`)
}

async function probeTrio(now) {
  const results = []
  const composed = []

  for (const {key, url, originUrl} of TRIO) {
    const observation = await observe(url)
    // The contract's origin-site pair for this artifact. This second GET is the
    // ONLY way to see the PRIMARY bug class this probe exists for: the Pages
    // Functions proxy serving a composed-at that LAGS the CloudFront origin. A
    // transient sub-4h lag never trips the 4h composition-age check, so a
    // site-only observation cannot distinguish "fresh" from "fresh but behind".
    const originObservation = await observe(originUrl)

    results.push(transportResult(`trio-${key}-http`, url, observation))
    results.push(transportResult(`trio-${key}-origin-http`, originUrl, originObservation))

    // A body only counts as observed when the response was OK. A non-OK or
    // unreachable side stays null, which every evaluator below reports as
    // UNKNOWN rather than a silent pass.
    const siteBody = observation.ok ? observation.body : null
    const originBody = originObservation.ok ? originObservation.body : null

    if (siteBody === null) {
      // No body to reason about. Everything downstream is unverified, not passing.
      results.push(result(`trio-${key}-structure`, UNKNOWN, `${key}: not served, so structure could not be determined`))
      results.push(result(`trio-${key}-cache`, UNKNOWN, `${key}: not served, so the cache policy could not be determined`))
      results.push(result(`trio-${key}-cache-state`, UNKNOWN, `${key}: not served, so the cache state could not be determined`))
      results.push(result(`trio-${key}-composition-age`, UNKNOWN, `${key}: not served, so freshness could not be determined`))
    } else {
      const structure = evaluateTrioStructure(key, siteBody)
      results.push(result(`trio-${key}-structure`, structure.status, structure.message))

      const cache = evaluateCachePolicy(readCachePolicy(observation.headers))
      results.push(result(`trio-${key}-cache`, cache.status, `${key}: ${cache.message}`))

      const cacheState = evaluateCacheState(observation.headers?.get?.('cf-cache-status') ?? null)
      results.push(result(`trio-${key}-cache-state`, cacheState.status, `${key}: ${cacheState.message}`))

      const age = evaluateCompositionAge(extractCompositionTimestamp(siteBody), now)
      results.push(result(`trio-${key}-composition-age`, age.status, `${key}: ${age.message}`))
    }

    const originSite = evaluateOriginSiteCoherence(key, siteBody, originBody)
    results.push(result(`trio-${key}-origin-site-coherence`, originSite.status, originSite.message))

    composed.push({key, timestamp: extractCompositionTimestamp(siteBody), body: siteBody})
  }

  // The contract's same-side pair: llms-full.txt and index.md are the same
  // composition served under two names, so they are compared to each other on
  // the site plane. The origin-site pair is checked per artifact above.
  const full = composed.find(({key}) => key === 'llms-full-txt')
  const indexMd = composed.find(({key}) => key === 'index-md')
  const coherence = evaluateCoherence(full, indexMd)
  results.push(result('trio-coherence-llms-full-index', coherence.status, coherence.message))

  return results
}

async function probeFeeds(now) {
  const results = []

  for (const {key, url, originUrl, format} of FEEDS) {
    const observation = await observe(url)
    // The second GET, for the same reason probeTrio makes one: a site-only
    // observation cannot see a proxy serving a composition that lags its
    // CloudFront origin. It is the gap web PR #240 closed for the trio.
    const originObservation = await observe(originUrl)

    results.push(transportResult(`${key}-http`, url, observation))
    results.push(transportResult(`${key}-origin-http`, originUrl, originObservation))

    const siteBody = observation.ok ? observation.body : null
    const originBody = originObservation.ok ? originObservation.body : null

    if (siteBody === null) {
      results.push(result(`${key}-structure`, UNKNOWN, `${key}: not served, so structure could not be determined`))
    } else {
      const structure = evaluateFeedStructure(key, format, siteBody, now)
      results.push(result(`${key}-structure`, structure.status, structure.message))
    }

    // The site plane's composition marker is in-body for RSS and absent for
    // JSON Feed. The origin plane always has the x-amz-meta-composed-at object
    // metadata CloudFront mirrors through, so it is read there first and the
    // in-body marker only backs it up.
    const site = {body: siteBody, timestamp: extractCompositionTimestamp(siteBody), ageSeconds: parseAgeSeconds(observation.headers?.get?.('age') ?? null)}
    const origin = {body: originBody, timestamp: originObservation.headers?.get?.(COMPOSED_AT_METADATA_HEADER) ?? extractCompositionTimestamp(originBody)}

    const coherence = evaluateFeedOriginSiteCoherence(key, site, origin, now)
    results.push(result(`${key}-origin-site-coherence`, coherence.status, coherence.message))
  }

  return results
}

async function probeJsonExports(now) {
  const results = []
  for (const {key, url} of JSON_EXPORTS) {
    const observation = await observe(url)
    results.push(transportResult(`export-${key}-http`, url, observation))
    if (!observation.ok) {
      results.push(result(`export-${key}-freshness`, UNKNOWN, `${key}: not served, so freshness could not be determined`))
      continue
    }

    let payload
    try {
      payload = JSON.parse(observation.body)
    } catch (err) {
      results.push(result(`export-${key}-freshness`, UNKNOWN, `${key}: served body is not parseable JSON (${err.message}) -- not verified`))
      continue
    }

    const freshness = evaluateJsonExportFreshness(key, payload, now)
    results.push(result(`export-${key}-freshness`, freshness.status, freshness.message))
  }
  return results
}

async function main() {
  // Same focus/privacy gate validate-llms-txt.mjs applies. The trio is
  // focus-gated at the edge (functions/_lib/proxy.ts returns the suppression
  // path when a hiding focus mode is active), so probing through a suppression
  // window would red the lane for correct behavior. The workflow ALSO gates the
  // step on the shared probe-suppression step; this is the in-script half of
  // the same convention.
  const suppression = suppressionDisposition(await probeSuppression(), 'serving probe')
  if (suppression === 'skip') {
    process.exit(0)
  }
  if (suppression === 'fail') {
    process.exit(1)
  }

  const now = new Date()
  const results = [...(await probeTrio(now)), ...(await probeFeeds(now)), ...(await probeJsonExports(now))]
  process.exit(report(results))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
