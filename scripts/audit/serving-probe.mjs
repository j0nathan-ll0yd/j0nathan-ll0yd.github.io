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
import {CLOUDFRONT_BASE, ENDPOINTS, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain} from './lib/http.mjs'
import {probeSuppression, suppressionDisposition} from './lib/suppression.mjs'
import {validateFeedXml} from './check-feeds.mjs'
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

// The composed llm-outputs family, served on the PROD DOMAIN via the
// Pages Functions proxy (functions/llms.txt.ts, llms-full.txt.ts, index.md.ts).
export const TRIO = Object.freeze([
  {key: 'llms-txt', url: `${SITE_URL}/llms.txt`},
  {key: 'llms-full-txt', url: `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`},
  {key: 'index-md', url: `${SITE_URL}${LLM_CONTENT_PATHS.indexMarkdown}`}
])

// feed.xml serves from the prod domain (functions/feed.xml.ts proxies it).
export const FEED_XML_URL = `${SITE_URL}/feed.xml`

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
 * Pure: (artifact body) -> ISO composition timestamp string, or null.
 *
 * Two markers are in live use and both are supported (observed 2026-08-30):
 *   llms.txt                  ->  <!-- composed-at: 2026-08-30T17:46:28.050Z -->
 *   llms-full.txt / index.md  ->  **Generated:** 2026-08-30T17:46:28.232Z
 *
 * Last-Modified is deliberately NOT a fallback on these routes: the Pages
 * Functions proxy builds a fresh Response, so Last-Modified equals the moment
 * of the proxy hit and would report every stale serve as perfectly fresh --
 * the exact failure this probe exists to catch.
 */
export function extractCompositionTimestamp(body) {
  if (typeof body !== 'string') {
    return null
  }
  const patterns = [/<!--\s*composed-at:\s*([^\s>]+)\s*-->/i, /\*\*Generated:\*\*\s*([0-9T:.Z+-]+)/i]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match && Number.isFinite(Date.parse(match[1]))) {
      return match[1]
    }
  }
  return null
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

  for (const {key, url} of TRIO) {
    const observation = await observe(url)
    results.push(transportResult(`trio-${key}-http`, url, observation))
    if (!observation.ok) {
      // No body to reason about. Everything downstream is unverified, not passing.
      results.push(result(`trio-${key}-structure`, UNKNOWN, `${key}: not served, so structure could not be determined`))
      results.push(result(`trio-${key}-cache`, UNKNOWN, `${key}: not served, so the cache policy could not be determined`))
      results.push(result(`trio-${key}-cache-state`, UNKNOWN, `${key}: not served, so the cache state could not be determined`))
      results.push(result(`trio-${key}-composition-age`, UNKNOWN, `${key}: not served, so freshness could not be determined`))
      composed.push({key, timestamp: null, body: null})
      continue
    }

    const structure = evaluateTrioStructure(key, observation.body)
    results.push(result(`trio-${key}-structure`, structure.status, structure.message))

    const cache = evaluateCachePolicy(readCachePolicy(observation.headers))
    results.push(result(`trio-${key}-cache`, cache.status, `${key}: ${cache.message}`))

    const cacheState = evaluateCacheState(observation.headers?.get?.('cf-cache-status') ?? null)
    results.push(result(`trio-${key}-cache-state`, cacheState.status, `${key}: ${cacheState.message}`))

    const timestamp = extractCompositionTimestamp(observation.body)
    const age = evaluateCompositionAge(timestamp, now)
    results.push(result(`trio-${key}-composition-age`, age.status, `${key}: ${age.message}`))

    composed.push({key, timestamp, body: observation.body})
  }

  // The contract's same-side pair. (Its other pair, origin-site per artifact,
  // needs a second fetch of every artifact from the CloudFront origin; that
  // stays with the weekly B2 coherence audit rather than doubling this probe's
  // request volume every 15 minutes.)
  const full = composed.find(({key}) => key === 'llms-full-txt')
  const indexMd = composed.find(({key}) => key === 'index-md')
  const coherence = evaluateCoherence(full, indexMd)
  results.push(result('trio-coherence-llms-full-index', coherence.status, coherence.message))

  return results
}

async function probeFeedXml() {
  const observation = await observe(FEED_XML_URL)
  const results = [transportResult('feed-xml-http', FEED_XML_URL, observation)]
  if (!observation.ok) {
    results.push(result('feed-xml-structure', UNKNOWN, 'feed.xml: not served, so structure could not be determined'))
    return results
  }

  // Reuses check-feeds.mjs's pure RSS validator (and its own freshness window)
  // rather than restating either.
  let findings
  try {
    findings = validateFeedXml(observation.body)
  } catch (err) {
    results.push(result('feed-xml-structure', UNKNOWN, `feed.xml: validator could not evaluate the served body: ${err.message}`))
    return results
  }

  const fails = findings.filter((finding) => finding.severity === 'fail')
  results.push(fails.length > 0
    ? result('feed-xml-structure', FAILED, `feed.xml: ${fails.map((finding) => `${finding.id}: ${finding.message}`).join('; ')}`)
    : result('feed-xml-structure', PASSED, 'feed.xml: parses as RSS 2.0 and satisfies check-feeds.mjs structural rules'))
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
  const results = [...(await probeTrio(now)), ...(await probeFeedXml()), ...(await probeJsonExports(now))]
  process.exit(report(results))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
