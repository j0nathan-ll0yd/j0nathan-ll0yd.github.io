// Shared factory for the CloudFront proxy routes (/llms.txt,
// /llms-full.txt, /index.md, /feed.xml, /feed.json). The backend
// (mantle-LifegamesPortal) owns the canonical artifacts; these routes ensure the
// spec-required root paths resolve on jonathanlloyd.me without hand-maintained
// static files. Responses are wrapped by src/lib/edge/middleware.ts, which injects
// the security headers.
//
// The MCP server (src/lib/edge/mcp-server.ts, atlas decision 0158) reads its
// resources through this same factory, so every agent read passes the same focus
// probe and gate. Its focus-signal reader is the one route with no focus probe and
// no last-known-good copy, exactly as the edge gate never gates that signal.
//
// Not itself a route: the routes are the endpoints under src/pages/; this
// module exports a factory.
//
// Disclosure model (atlas decision 0160, PR 0b). All five artifacts are
// SUPPRESSIBLE_PATHS of the backend focus gate, a CloudFront Function that runs
// on viewer-request BEFORE CloudFront's cache. The gate is authoritative; the
// focus signal is not. The backend closes the gate before it publishes a hiding
// signal, and a failed publication leaves the gate shut over a VISIBLE signal
// with no repair. So a visible focus probe is necessary but never sufficient:
//
// 1. Every artifact fetch is `cache: 'no-store'` with no `cf` cache options, so
//    each one reaches CloudFront and passes the gate. No Cloudflare cache sits
//    in front of the gate. A 200 that Cloudflare still served from its own cache
//    (`cf-cache-status` HIT, STALE, UPDATING or REVALIDATED), or that carries no
//    `x-amz-cf-id`, is refused and admits no last-known-good copy.
// 2. A 403 suppression body from the gate wins over a visible focus probe: the
//    route answers with its 503 suppression response.
// 3. The last-known-good copy is admitted only with fresh evidence, in the same
//    request, that the gate is open (a 200 that passed it; no CloudFront error
//    status proves that), and only when its upstream composition stamp is at
//    most 3 hours old.
// 4. Every response this factory builds is no-store at the browser, generic CDN
//    and Cloudflare layers, the two feed routes included.
//
// Residual windows: KeyValueStore propagation (the backend spec records about
// 30 s to first denial and about 75 s to convergence, with no SLA), and a
// response that passed the gate before a flip and is still in flight.
//
// On Cloudflare Pages, one window was NOT this module's to close. The zone edge
// cache sat in front of the Pages Function, and a zone Edge Cache TTL rule could
// store a feed response and replay it with no focus probe and no gate check. On
// 2026-10-08 /feed.xml and /feed.json answered `cf-cache-status: HIT` with `Age`
// up to 796 s while they still sent `s-maxage=60`, so that rule, not the header,
// set the window. On Workers (atlas decision 0160) the Worker runs ahead of the
// zone cache ("Cloudflare Workers run before the cache",
// developers.cloudflare.com/workers/reference/how-the-cache-works/), so a zone
// rule cannot store a response this module builds. What keeps a cache out in
// front of the Worker is that wrangler.jsonc enables no Workers Caching
// (tests/unit/worker-routing.test.ts pins it). The zone rules still matter on one
// path: the production route fails open, so a request the Worker cannot take goes
// past it to the zone, where those rules apply.
// audits/checks/b2-check-cloudflare-llms-cache-rules.mjs measures the rules for
// all five paths, and audits/checks/b2-llms.mjs `siteEdgeCacheFailure` measures
// the served result: it reds on any `Age`, on a cache-served `CF-Cache-Status`, and
// on an absent status without the Worker's platform marker.

import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {COMPOSED_AT_METADATA_HEADER} from './feed-artifacts'
import {
  DeadlineError,
  discardBody,
  errorClass,
  GATED_FETCH_INIT,
  isRetryableStatus,
  isSuppressionBody as isSuppressionBodyWithin,
  passedGate,
  type Refusal,
  type RequestBudget,
  reserving,
  startBudget as startBoundedBudget,
  successRefusal,
  withDeadline
} from '../data-plane/admission'

/**
 * The oldest upstream composition the last-known-good path may serve. It equals the registry's
 * `audit.error` threshold for these artifacts (3 h). Storage time is not source age: a copy stored
 * a minute ago can hold an artifact composed days ago, so the bound reads the composition stamp.
 */
const LKG_MAX_SOURCE_AGE_MS = 3 * 60 * 60 * 1000
/**
 * The Cache API lifetime of a stored copy. A copy stored longer than the source-age bound is
 * necessarily older than it, so keeping it would only hold an entry that can never be served.
 */
const LAST_KNOWN_GOOD_SECONDS = LKG_MAX_SOURCE_AGE_MS / 1000
/** A composition stamp further ahead of this clock than this is malformed, not merely skewed. */
const LKG_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const LKG_COMPOSED_AT_HEADER = 'X-Proxy-Lkg-Composed-At'
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [100, 300]

/**
 * Wall-clock bounds. Retry COUNT alone bounded nothing: a single never-resolving fetch, or a
 * response whose body stalls mid-stream, held the request open past any useful deadline and
 * prevented BOTH a prompt failure and the last-known-good fallback. Every network attempt is
 * now bounded twice -- by its own per-operation deadline, and by ONE total request budget that
 * covers the focus probe, its retry, every artifact attempt, every retry delay, and every
 * response-body read.
 *
 * The per-operation deadlines are deliberately far below the total: the budget is what the
 * whole request may spend, not what one hung socket may hold.
 */
const FOCUS_TIMEOUT_MS = 2_000
const ARTIFACT_TIMEOUT_MS = 4_000
const GATE_PROBE_TIMEOUT_MS = 2_000
const TOTAL_BUDGET_MS = 10_000
/**
 * The share of the total budget the artifact attempts may NOT spend: it is kept for the
 * last-known-good cache read and the copy's body, which are bounded by it too. Without the reserve,
 * a stalled upstream body spent the whole budget and the bounded cache read then had none left, so
 * the stall the fallback exists for could never reach it.
 */
const LKG_READ_RESERVE_MS = 1_000
const FOCUS_MAX_ATTEMPTS = 2
const FOCUS_RETRY_DELAY_MS = 100

/** The bounds, exported so tests assert against the REAL numbers instead of restating them. */
export const PROXY_TIMEOUTS = Object.freeze({
  focusMs: FOCUS_TIMEOUT_MS,
  artifactMs: ARTIFACT_TIMEOUT_MS,
  gateProbeMs: GATE_PROBE_TIMEOUT_MS,
  lkgReadReserveMs: LKG_READ_RESERVE_MS,
  totalMs: TOTAL_BUDGET_MS
})
/** The last-known-good admission bounds, exported for the same reason. */
export const LKG_ADMISSION = Object.freeze({maxSourceAgeMs: LKG_MAX_SOURCE_AGE_MS, maxFutureSkewMs: LKG_MAX_FUTURE_SKEW_MS})
const PUBLIC_NO_STORE = 'no-store'
const SUPPRESSION_RETRY_SECONDS = 60
/** The `X-Source` value of a focus-suppression response. Exported so a caller of a proxy handler can tell suppression from failure. */
export const SUPPRESSION_SOURCE = 'cloudfront-proxy-suppressed'
const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)
const FOCUS_SIGNAL_PATH: string = ENDPOINTS.focus
/**
 * Where a proxy reads: the CloudFront data plane through the platform fetch, unless a caller passes
 * another (the server render's test seams, which apply only on a preview or loopback host).
 */
export interface Upstream {
  base: string
  fetch: typeof fetch
}
const CLOUDFRONT_UPSTREAM: Upstream = Object.freeze({base: CLOUDFRONT_BASE, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)})
const logger = createEdgeLogger({service: 'cloudfront-pages-proxy'})

/**
 * Headers the Cache API adds to a match, which describe the CACHE READ, not the artifact. workerd
 * returns a match only when the cache answered `CF-Cache-Status: HIT`, and passes that answer's
 * headers through unchanged (workerd src/workerd/api/cache.c++, `Cache::match`, commit 40838ae3).
 * Whether the cache also adds `Age` is not documented; it is dropped too, because the B2 llms
 * edge arm reds on any `Age`.
 */
const CACHE_API_STATE_HEADERS = Object.freeze(['CF-Cache-Status', 'Age'])

interface CacheLike {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

interface CloudflareCacheStorage {
  default?: CacheLike
}

export interface CloudfrontProxyContext {
  request: Request
  waitUntil(promise: Promise<unknown>): void
  /** Where to read. Absent: the CloudFront data plane. Only the server render's test seams pass one. */
  upstream?: Upstream
  /**
   * Told the hiding focus value when the probe denies. Internal: the dashboard picks the overlay of
   * that value (src/lib/composed/read.ts). The response itself never names the value.
   */
  onHidingFocus?(currentFocus: string): void
  /** The whole request's budget in ms. Absent: TOTAL_BUDGET_MS. The dashboard passes its D2 I/O share. */
  budgetMs?: number
}

/**
 * Cache directives for the two paths that serve ARTIFACT CONTENT: the success path and the stale
 * last-known-good path. Everything else -- suppression, focus-error, terminal-error, 405 -- is
 * unconditionally no-store via `setPublicNoStore` and is not configurable per route.
 *
 * `cdnCacheControl` is emitted on BOTH `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control`.
 * Cloudflare always strips `Cloudflare-CDN-Cache-Control` before the client, so it is invisible
 * in a curl; it is set anyway because it turns Origin Cache Control on and is what decides
 * Cloudflare's own edge behavior. `CDN-Cache-Control` and `Cache-Control` reach the client.
 * Omit it to leave both CDN headers unset.
 */
export interface CachePolicy {
  cacheControl: string
  cdnCacheControl?: string
}

/**
 * No-store on all three cache headers. The llms-assurance contract requires it for every response
 * class of the llm-outputs trio (/llms.txt, /llms-full.txt, /index.md), and atlas decision 0160
 * (plan D3: no Cloudflare artifact cache on a gated path) requires it for the `rss-feed` routes
 * (/feed.xml, /feed.json) too, because all five are gated. It is therefore the factory DEFAULT:
 * a route that passes no policy is no-store, and none of the five passes another.
 */
export const LLM_OUTPUT_CACHE_POLICY: CachePolicy = {cacheControl: PUBLIC_NO_STORE, cdnCacheControl: PUBLIC_NO_STORE}
const GATED_ARTIFACT_CACHE_POLICY: CachePolicy = LLM_OUTPUT_CACHE_POLICY

/** Last-known-good entries are written to the edge Cache API, so they carry their own TTL. */
const LKG_CACHE_POLICY: CachePolicy = {cacheControl: `public, max-age=${LAST_KNOWN_GOOD_SECONDS}`}

export interface CloudfrontProxyConfig {
  /** Artifact path on the CloudFront data plane, e.g. '/llms-full.txt'. */
  path: string
  /** Content-Type served to the client (CloudFront serves its own; the route owns the public one). */
  contentType: string
  /** Cache directives for the success and stale paths. Defaults to no-store, which every gated route needs. */
  cachePolicy?: CachePolicy
  /**
   * Whether the route may keep and serve a last-known-good copy. Defaults to true. The dashboard
   * passes false: decision 0160 D3 allows no last-known-good copy for it, and its fallback is the
   * data-free page instead.
   */
  lastKnownGood?: boolean
}

interface UpstreamSuccess {
  ok: true
  attempts: number
  response: Response
  /** The artifact bytes, already read under a deadline. The Response body is spent. */
  body: ArrayBuffer
}

interface UpstreamFailure {
  ok: false
  suppressed?: false
  attempts: number
  response?: Response
  errorName?: string
  /**
   * True when an attempt in THIS request returned gate-open evidence (`isGateOpenEvidence`): a 200
   * that carried `x-amz-cf-id` and that Cloudflare did not serve from cache. No error status counts
   * (see `isGateOpenEvidence`), nor does a transport failure or a Cloudflare-generated 52x.
   */
  gateOpen: boolean
  /**
   * Set when a success-class response was refused: a 200 that cannot prove it passed the gate, or
   * a 2xx other than 200, which is not a complete artifact. The refusal is a privacy decision; its
   * status is never retryable, so it admits no last-known-good copy.
   */
  refused?: Refusal
  /**
   * Set when a concurrent read (`readGatedConcurrently`) stopped because the focus probe did not read
   * visible: the artifact's body, if any arrived, was cancelled unread.
   */
  abandoned?: true
}

/** The gate answered an artifact request with its 403 suppression body. The gate wins. */
interface UpstreamSuppressed {
  ok: false
  suppressed: true
  attempts: number
  response: Response
}

type UpstreamResult = UpstreamSuccess | UpstreamFailure | UpstreamSuppressed

type GateObservation = 'open' | 'suppressed' | 'unknown'

interface FocusVisible {
  status: 'visible'
}

interface FocusSuppressed {
  status: 'suppressed'
  currentFocus: string
}

interface FocusUnavailable {
  status: 'unavailable'
  upstreamStatus?: number
  errorName?: string
  /** Transport-shaped failures earn one more probe; a malformed or rejected answer does not. */
  retryable: boolean
}

type FocusResult = FocusVisible | FocusSuppressed | FocusUnavailable

export type { RequestBudget }

/** One request's budget, by default the proxy's total (`PROXY_TIMEOUTS.totalMs`). */
export function startBudget(totalMs: number = TOTAL_BUDGET_MS): RequestBudget {
  return startBoundedBudget(totalMs)
}

function defaultCache(): CacheLike | undefined {
  return (globalThis as typeof globalThis & {caches?: CloudflareCacheStorage}).caches?.default
}

function lkgCacheKey(request: Request, path: string): Request {
  const publicUrl = new URL(path, request.url)
  publicUrl.search = '?__cloudfront_proxy_lkg=v1'
  return new Request(publicUrl.toString(), {method: 'GET'})
}

function upstreamRequestId(response?: Response): string | undefined {
  return response?.headers.get('x-amz-cf-id') || response?.headers.get('x-request-id') || response?.headers.get('cf-ray') || undefined
}

function diagnosticHeaders(failure: UpstreamFailure): Headers {
  const headers = new Headers({
    'X-Proxy-Attempts': String(failure.attempts),
    'X-Proxy-Upstream-Status': failure.response ? String(failure.response.status) : 'unreachable'
  })
  const requestId = upstreamRequestId(failure.response)
  if (requestId) {
    headers.set('X-Proxy-Upstream-Request-Id', requestId)
  }
  return headers
}

function diagnosticFields(path: string, failure: UpstreamFailure, staleHit?: boolean): Record<string, unknown> {
  return {
    artifact: path,
    attempts: failure.attempts,
    upstream_status: failure.response?.status ?? null,
    upstream_request_id: upstreamRequestId(failure.response) ?? null,
    error_class: failure.errorName ?? null,
    gate_open: failure.gateOpen,
    stale_hit: staleHit ?? null
  }
}

/**
 * Keep every public cache layer outside this Function from storing a response.
 * Cloudflare-CDN-Cache-Control is Cloudflare-specific, CDN-Cache-Control covers
 * any other shared intermediary, and Cache-Control reaches the browser. The
 * private LKG cache is configured separately below; there is no origin fetch
 * cache, because every artifact fetch is `cache: 'no-store'`.
 *
 * This is the UNCONDITIONAL form, for responses no route may ever have cached:
 * suppression, focus-error, terminal-error and method-not-allowed. Artifact
 * content goes through the route's own `CachePolicy` instead.
 */
function setPublicNoStore(headers: Headers): void {
  applyCachePolicy(headers, LLM_OUTPUT_CACHE_POLICY)
}

/**
 * One bounded read of the ungated focus signal.
 *
 * Every branch that does not return a DEFINITE answer returns `unavailable`, and the caller
 * turns that into a 502. The gate fails CLOSED: a focus state this Function could not read is
 * never treated as permission to serve.
 */
async function probeFocusOnce(budget: RequestBudget, upstream: Upstream): Promise<FocusResult> {
  let response: Response
  try {
    response = await withDeadline((signal) => upstream.fetch(`${upstream.base}${FOCUS_SIGNAL_PATH}`, {cache: 'no-store', signal}),
      Math.min(FOCUS_TIMEOUT_MS, budget.remainingMs()), 'focus probe')
  } catch (error) {
    return {status: 'unavailable', errorName: errorClass(error), retryable: true}
  }

  if (!response.ok) {
    return {status: 'unavailable', upstreamStatus: response.status, retryable: isRetryableStatus(response.status)}
  }

  let focus: unknown
  try {
    focus = await withDeadline(() => response.json() as Promise<unknown>, Math.min(FOCUS_TIMEOUT_MS, budget.remainingMs()), 'focus body')
  } catch (error) {
    // A stalled body is transport; malformed JSON is an answer, and a second read returns it again.
    return error instanceof DeadlineError
      ? {status: 'unavailable', errorName: errorClass(error), retryable: true}
      : {status: 'unavailable', errorName: 'InvalidFocusJson', retryable: false}
  }

  // Valid JSON is not a focus state: `null`, a primitive or an array has no currentFocus to read,
  // and reading one off `null` throws past every controlled response.
  if (focus === null || typeof focus !== 'object' || Array.isArray(focus) || !('currentFocus' in focus) || typeof focus.currentFocus !== 'string') {
    return {status: 'unavailable', errorName: 'InvalidFocusState', retryable: false}
  }
  if (HIDING_FOCUS_MODE_SET.has(focus.currentFocus)) {
    return {status: 'suppressed', currentFocus: focus.currentFocus}
  }
  return {status: 'visible'}
}

/** Bounded retry over the focus probe: one extra attempt for a transport-shaped failure, never for a definite answer. */
async function probeFocus(budget: RequestBudget, upstream: Upstream): Promise<FocusResult> {
  let failure: FocusUnavailable = {status: 'unavailable', errorName: 'FocusProbeNotAttempted', retryable: false}

  for (let attempt = 1; attempt <= FOCUS_MAX_ATTEMPTS; attempt++) {
    const result = await probeFocusOnce(budget, upstream)
    if (result.status !== 'unavailable') {
      return result
    }
    failure = result
    if (!result.retryable || attempt === FOCUS_MAX_ATTEMPTS || budget.remainingMs() <= FOCUS_RETRY_DELAY_MS) {
      break
    }
    logger.warn('cloudfront_proxy_focus_retry', {attempts: attempt, upstream_status: result.upstreamStatus ?? null, error_class: result.errorName ?? null})
    await delay(FOCUS_RETRY_DELAY_MS)
  }

  return failure
}

function suppressionResponse(method: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(SUPPRESSION_RETRY_SECONDS),
    'X-Source': SUPPRESSION_SOURCE
  })
  setPublicNoStore(headers)
  const body = method === 'HEAD' ? null : JSON.stringify({suppressed: true, reason: 'focus mode active'})
  return new Response(body, {status: 503, headers})
}

function focusUnavailableResponse(path: string, result: FocusUnavailable): Response {
  logger.error('cloudfront_proxy_focus_probe_failed', {
    artifact: path,
    upstream_status: result.upstreamStatus ?? null,
    error_class: result.errorName ?? null
  })
  const headers = new Headers({'Content-Type': 'text/plain; charset=utf-8', 'X-Source': 'cloudfront-proxy-focus-error'})
  setPublicNoStore(headers)
  return new Response('focus state unavailable', {status: 502, headers})
}

export async function focusPrivacyResponse(
  method: string,
  path: string,
  budget: RequestBudget = startBudget(),
  upstream: Upstream = CLOUDFRONT_UPSTREAM,
  onHidingFocus?: (currentFocus: string) => void
): Promise<Response | null> {
  const focus = await probeFocus(budget, upstream)
  if (focus.status === 'suppressed') {
    logger.info?.('cloudfront_proxy_suppressed', {artifact: path, current_focus: focus.currentFocus})
    onHidingFocus?.(focus.currentFocus)
    return suppressionResponse(method)
  }
  if (focus.status === 'unavailable') {
    return focusUnavailableResponse(path, focus)
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * True when this response is evidence, for the last-known-good path, that the gate is open now: a
 * 200 that passed the gate in this request. No CloudFront error status proves that the gate
 * function let the request through. AWS documents that with CloudFront Functions "an HTTP 503
 * status code can indicate that your function returned an execution error"
 * (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-503-service-unavailable.html)
 * and that "an HTTP 502 status code can indicate that the CloudFront function is trying to add,
 * delete, or change a read-only header"
 * (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-502-bad-gateway.html),
 * and no documented header tells a function failure from an origin failure.
 */
function isGateOpenEvidence(response: Response): boolean {
  return response.status === 200 && passedGate(response)
}

/** Reads a 403 body under the artifact deadline and reports whether it is the gate's suppression body. */
function isSuppressionBody(response: Response, budget: RequestBudget, label: string): Promise<boolean> {
  return isSuppressionBodyWithin(response, Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()), label)
}

/**
 * Hooks of a concurrent read (`readGatedConcurrently`). Absent for every proxy route: they read the
 * artifact only after the focus probe answered visible.
 */
interface ConcurrentHooks {
  /** Aborted when the focus probe did not read visible: every attempt stops, none is retried. */
  stop: AbortSignal
  /** Resolves true once the focus probe reads visible; an admitted body is read only then. */
  focusVisible(): Promise<boolean>
}

async function fetchWithRetry(
  upstreamUrl: string,
  path: string,
  budget: RequestBudget,
  fetchImpl: typeof fetch,
  hooks?: ConcurrentHooks
): Promise<UpstreamResult> {
  let lastResponse: Response | undefined
  let errorName: string | undefined
  let gateOpen = false
  const attemptSignal = (signal: AbortSignal): AbortSignal => hooks ? AbortSignal.any([signal, hooks.stop]) : signal

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The focus probe can deny during a retry delay: a stopped read starts no further attempt.
    if (hooks?.stop.aborted) {
      return {ok: false, attempts: attempt - 1, response: lastResponse, errorName, gateOpen, abandoned: true}
    }
    try {
      lastResponse = await withDeadline((signal) => fetchImpl(upstreamUrl, {...GATED_FETCH_INIT, signal: attemptSignal(signal)}),
        Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()), `${path} fetch`)
      errorName = undefined
      if (lastResponse.status === 403 && await isSuppressionBody(lastResponse, budget, `${path} 403 body`)) {
        return {ok: false, suppressed: true, attempts: attempt, response: lastResponse}
      }
      if (lastResponse.ok) {
        // Only a 200 is admitted, and only when it provably passed the gate in this request. With
        // no-store a Cloudflare cache hit should not occur; this is the second line if it ever does.
        const refused = successRefusal(lastResponse)
        if (refused) {
          discardBody(lastResponse)
          return {ok: false, attempts: attempt, response: lastResponse, gateOpen: false, refused}
        }
        gateOpen = true
        // A concurrent read holds an admitted body unread until the focus probe answers. A hiding
        // or unreadable value cancels it: the bytes are never read, parsed or logged.
        if (hooks && !(await hooks.focusVisible())) {
          discardBody(lastResponse)
          return {ok: false, attempts: attempt, response: lastResponse, gateOpen, abandoned: true}
        }
        // Read the artifact HERE, under its own deadline, rather than streaming the upstream body
        // to the client. A stalled body is the second half of the hang this bounds, and it is
        // invisible to any deadline placed on the fetch alone. These artifacts are small text
        // files, so buffering costs little and also removes the tee `response.clone()` needed to
        // write the last-known-good copy.
        const response = lastResponse
        const body = await withDeadline(() => response.arrayBuffer(), Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()), `${path} body`)
        return {ok: true, attempts: attempt, response, body}
      }
      if (!isRetryableStatus(lastResponse.status)) {
        discardBody(lastResponse)
        return {ok: false, attempts: attempt, response: lastResponse, gateOpen}
      }
    } catch (error) {
      // A body-read failure lands here too, with a 2xx `lastResponse` already assigned. Clearing it
      // is deliberate: this run never held a complete representation, so the failure must read as
      // unreachable. A retained 2xx would make `staleResponse` treat it as a definite non-retryable
      // answer and withhold the last-known-good fallback -- the opposite of what a stall warrants.
      // `gateOpen` survives: the headers of that 200 still came through the gate in this request.
      lastResponse = undefined
      errorName = errorClass(error)
    }

    const failure: UpstreamFailure = {ok: false, attempts: attempt, response: lastResponse, errorName, gateOpen}
    if (hooks?.stop.aborted) {
      return {...failure, abandoned: true}
    }
    const retryDelayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0
    if (attempt === MAX_ATTEMPTS || budget.remainingMs() <= retryDelayMs) {
      return failure
    }
    logger.warn('cloudfront_proxy_retry', diagnosticFields(path, failure))
    await delay(retryDelayMs)
  }

  return {ok: false, attempts: MAX_ATTEMPTS, response: lastResponse, errorName, gateOpen}
}

/**
 * One bounded `no-store` GET of the gated path, asked only when no artifact attempt in this
 * request produced gate-open evidence: every failure was transport (a timeout, DNS, a Cloudflare
 * 52x without `x-amz-cf-id`) or a CloudFront error status, which a failed gate function can also
 * return. It answers one question -- is the gate open right now -- and its body is never served.
 * `open` needs gate-open evidence (`isGateOpenEvidence`, a 200); a suppression body is
 * `suppressed`; everything else, a failed probe or another 5xx included, is `unknown`, which
 * admits nothing. During a CloudFront outage of the path itself the probe answers 5xx too, so the
 * copy is withheld: fail-closed by design.
 *
 * A hung origin hangs this probe too, and the artifact attempts may already have spent the budget.
 * Then the answer is `unknown` and no copy is served: without a gate observation there is no
 * permission to serve one.
 */
async function observeGate(upstreamUrl: string, path: string, budget: RequestBudget, fetchImpl: typeof fetch): Promise<GateObservation> {
  let response: Response
  try {
    response = await withDeadline((signal) => fetchImpl(upstreamUrl, {...GATED_FETCH_INIT, signal}), Math.min(GATE_PROBE_TIMEOUT_MS, budget.remainingMs()),
      `${path} gate probe`)
  } catch (error) {
    logger.warn('cloudfront_proxy_gate_probe_failed', {artifact: path, error_class: errorClass(error)})
    return 'unknown'
  }
  if (response.status === 403) {
    return await isSuppressionBody(response, budget, `${path} gate probe body`) ? 'suppressed' : 'unknown'
  }
  discardBody(response)
  return isGateOpenEvidence(response) ? 'open' : 'unknown'
}

/**
 * Writes one cache policy onto a header set, clearing the CDN headers first so a policy without
 * `cdnCacheControl` can never inherit one from a copied response (the stale and last-known-good
 * paths both start from headers they did not author).
 */
function applyCachePolicy(headers: Headers, policy: CachePolicy): void {
  headers.set('Cache-Control', policy.cacheControl)
  headers.delete('CDN-Cache-Control')
  headers.delete('Cloudflare-CDN-Cache-Control')
  if (policy.cdnCacheControl) {
    headers.set('CDN-Cache-Control', policy.cdnCacheControl)
    headers.set('Cloudflare-CDN-Cache-Control', policy.cdnCacheControl)
  }
}

function publicResponse(upstream: UpstreamSuccess, contentType: string, policy: CachePolicy): Response {
  const headers = new Headers({
    'Content-Type': contentType,
    'X-Proxy-Attempts': String(upstream.attempts),
    'X-Proxy-Upstream-Status': String(upstream.response.status),
    'X-Source': 'cloudfront-proxy'
  })
  applyCachePolicy(headers, policy)
  const requestId = upstreamRequestId(upstream.response)
  if (requestId) {
    headers.set('X-Proxy-Upstream-Request-Id', requestId)
  }
  return new Response(upstream.body, {status: 200, headers})
}

interface ComposedAt {
  stamp: string
  ms: number
}

/**
 * Parses an ISO-8601 composition stamp. `Date.parse` alone accepts loose forms such as `'1'`, so
 * the value must also look like an ISO date-time; anything else reads as no stamp at all.
 */
function parseComposedAt(value: string | null): ComposedAt | null {
  const stamp = value?.trim()
  if (!stamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(stamp)) {
    return null
  }
  const ms = Date.parse(stamp)
  return Number.isFinite(ms) ? {stamp, ms} : null
}

async function saveLastKnownGood(
  cache: CacheLike,
  cacheKey: Request,
  response: Response,
  body: ArrayBuffer,
  path: string,
  composedAt: string | null
): Promise<void> {
  // The copy is admitted later only by its SOURCE age, so a copy without a readable composition
  // stamp could never be served. Skip the write and keep any older stamped copy in place.
  const parsed = parseComposedAt(composedAt)
  if (!parsed) {
    logger.warn('cloudfront_proxy_lkg_unstamped', {artifact: path, header: COMPOSED_AT_METADATA_HEADER})
    return
  }
  const headers = new Headers(response.headers)
  // The public policy may be no-store; the Cache API reads these headers to decide the entry's
  // TTL, so the stored copy carries the LKG TTL and no CDN override instead. Storing a no-store
  // copy would silently disable the stale fallback for the trio.
  applyCachePolicy(headers, LKG_CACHE_POLICY)
  headers.set('X-Proxy-Lkg-Stored-At', new Date().toISOString())
  headers.set(LKG_COMPOSED_AT_HEADER, parsed.stamp)
  try {
    await cache.put(cacheKey, new Response(body, {status: 200, headers}))
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_write_failed', {artifact: path, error_class: errorClass(error)})
  }
}

type LkgRefusal = 'no-composed-at' | 'composed-at-in-future' | 'source-too-old' | 'no-gate-evidence'

/** Why a stored copy may not be served on source-age grounds, or null when its age admits it. */
function sourceAgeRefusal(cached: Response): LkgRefusal | null {
  const composedAt = parseComposedAt(cached.headers.get(LKG_COMPOSED_AT_HEADER))
  if (!composedAt) {
    return 'no-composed-at'
  }
  const ageMs = Date.now() - composedAt.ms
  if (ageMs < -LKG_MAX_FUTURE_SKEW_MS) {
    return 'composed-at-in-future'
  }
  return ageMs > LKG_MAX_SOURCE_AGE_MS ? 'source-too-old' : null
}

type StaleOutcome = {kind: 'served'; response: Response} | {kind: 'suppressed'} | {kind: 'none'}

/**
 * The last-known-good path. A stored copy is served only when ALL of these hold:
 *
 * 1. The failure was retryable, which no privacy refusal is.
 * 2. The copy's upstream composition stamp is at most `LKG_MAX_SOURCE_AGE_MS` old.
 * 3. This request holds fresh evidence that the gate is open (`isGateOpenEvidence`, a 200): from
 *    an artifact attempt whose body then stalled, or else from one gate probe (`observeGate`).
 *
 * A suppression body at step 3 returns `suppressed`: the gate wins and the route answers 503.
 * The copy is checked before the probe so an ineligible copy costs no extra request.
 */
interface StaleRequest {
  cache: CacheLike | undefined
  cacheKey: Request
  contentType: string
  path: string
  upstreamUrl: string
  failure: UpstreamFailure
  policy: CachePolicy
  budget: RequestBudget
  fetchImpl: typeof fetch
}

async function staleResponse({cache, cacheKey, contentType, path, upstreamUrl, failure, policy, budget, fetchImpl}: StaleRequest): Promise<StaleOutcome> {
  // A refusal always carries its success-class response, whose status is never retryable, so this
  // one test also withholds the copy from every refusal.
  if (!cache || (failure.response && !isRetryableStatus(failure.response.status))) {
    return {kind: 'none'}
  }

  // The cache read and the copy's body draw on the same request budget as every network call: a
  // stalled Cache API read must end in an answer inside PROXY_TIMEOUTS.totalMs, not outlive it.
  let cached: Response | undefined
  try {
    cached = await withDeadline(() => cache.match(cacheKey), Math.min(LKG_READ_RESERVE_MS, budget.remainingMs()), `${path} last-known-good read`)
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_read_failed', {artifact: path, error_class: errorClass(error)})
    return {kind: 'none'}
  }
  if (!cached) {
    return {kind: 'none'}
  }

  const refusal = sourceAgeRefusal(cached)
  if (refusal) {
    discardBody(cached)
    logger.warn('cloudfront_proxy_lkg_refused', {...diagnosticFields(path, failure, false), reason: refusal})
    return {kind: 'none'}
  }

  const gate: GateObservation = failure.gateOpen ? 'open' : await observeGate(upstreamUrl, path, budget, fetchImpl)
  if (gate === 'suppressed') {
    discardBody(cached)
    return {kind: 'suppressed'}
  }
  if (gate !== 'open') {
    discardBody(cached)
    logger.warn('cloudfront_proxy_lkg_refused', {...diagnosticFields(path, failure, false), reason: 'no-gate-evidence' satisfies LkgRefusal})
    return {kind: 'none'}
  }

  // Read the admitted copy whole, under what remains of the budget. Streaming `cached.body` would
  // return a response whose bytes could still stall after the deadline.
  let body: ArrayBuffer
  try {
    const copy = cached
    body = await withDeadline(() => copy.arrayBuffer(), Math.min(LKG_READ_RESERVE_MS, budget.remainingMs()), `${path} last-known-good body`)
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_read_failed', {artifact: path, error_class: errorClass(error)})
    return {kind: 'none'}
  }

  const headers = new Headers(cached.headers)
  // Served as read, a permitted fallback would look like a zone-cache hit to every downstream
  // observer, the B2 llms edge arm (audits/checks/b2-llms.mjs siteEdgeCacheFailure) included.
  // Warning 110, X-Proxy-Stale and X-Source state what the copy is.
  for (const name of CACHE_API_STATE_HEADERS) {
    headers.delete(name)
  }
  const diagnostics = diagnosticHeaders(failure)
  diagnostics.forEach((value, name) => headers.set(name, value))
  headers.set('Content-Type', contentType)
  applyCachePolicy(headers, policy)
  headers.set('Warning', '110 - "Response is stale"')
  headers.set('X-Proxy-Stale', 'true')
  headers.set('X-Source', 'cloudfront-proxy-stale')
  logger.warn('cloudfront_proxy_stale_fallback', diagnosticFields(path, failure, true))
  return {kind: 'served', response: new Response(body, {status: 200, headers})}
}

function gateSuppressedResponse(method: string, path: string, attempts: number): Response {
  logger.info?.('cloudfront_proxy_gate_suppressed', {artifact: path, attempts})
  return suppressionResponse(method)
}

/**
 * The share of the request budget the artifact attempts may spend. A route with a last-known-good
 * copy keeps LKG_READ_RESERVE_MS back for the cache read; a route without one (the focus signal,
 * the composed dashboard) has nothing to reserve for, so its artifact read gets the whole remainder
 * after the focus probe (review 2026-10-16, I1: the dashboard's 2.5 s budget left the artifact
 * about 1.5 s).
 */
export function artifactBudget(budget: RequestBudget, hasLastKnownGood: boolean): RequestBudget {
  return hasLastKnownGood ? reserving(budget, LKG_READ_RESERVE_MS) : budget
}

/** Builds an onRequest handler that proxies one CloudFront artifact resiliently. */
export function makeCloudfrontProxy(
  {path, contentType, cachePolicy = GATED_ARTIFACT_CACHE_POLICY, lastKnownGood = true}: CloudfrontProxyConfig
): (context: CloudfrontProxyContext) => Promise<Response> {
  const artifactName = path.slice(1)
  const isFocusSignal = path === FOCUS_SIGNAL_PATH

  return async function onRequest(context: CloudfrontProxyContext): Promise<Response> {
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
      const headers = new Headers({Allow: 'GET, HEAD'})
      setPublicNoStore(headers)
      return new Response('Method not allowed', {status: 405, headers})
    }

    // Privacy gate first. The focus signal is never itself gated, and a hiding value denies at
    // once. A VISIBLE value is not permission on its own: the backend gate can be shut over a
    // visible signal, so every artifact fetch below still passes the gate itself (no-store), and a
    // suppression body from it wins. Every route's responses, the feeds included, are no-store at
    // the browser, generic CDN, and Cloudflare-specific layers. A request the Worker takes reaches it
    // ahead of the zone cache; the fail-open path is the zone's: see the zone-edge-cache note at the
    // top of this module. No route can enter SWR.
    // ONE budget for the whole request: the focus probe, its retry, every artifact attempt, every
    // retry delay, every body read and the gate probe draw from it. Started here, before the first
    // network call.
    const budget = startBudget(context.budgetMs)
    const source = context.upstream ?? CLOUDFRONT_UPSTREAM
    const upstreamUrl = `${source.base}${path}`

    // The focus signal itself is never gated, exactly as the edge gate never gates it
    // (focus-privacy spec, "The focus signal stays retrievable while hiding"). Every
    // other artifact is suppressible and goes through the gate.
    const privacyResponse = isFocusSignal ? null : await focusPrivacyResponse(context.request.method, path, budget, source, context.onHidingFocus)
    if (privacyResponse) {
      return privacyResponse
    }

    // The focus signal has no last-known-good copy. Like the gate's own probe, it is read fresh
    // (GATED_FETCH_INIT is no-store), so a stored copy could disagree with the probe that a
    // sibling read just consulted.
    const cache = isFocusSignal || !lastKnownGood ? undefined : defaultCache()
    const cacheKey = lkgCacheKey(context.request, path)
    const upstream = await fetchWithRetry(upstreamUrl, path, artifactBudget(budget, cache !== undefined), source.fetch)

    if (upstream.ok) {
      const response = publicResponse(upstream, contentType, cachePolicy)
      if (cache) {
        context.waitUntil(saveLastKnownGood(cache, cacheKey, response, upstream.body, path, upstream.response.headers.get(COMPOSED_AT_METADATA_HEADER)))
      }
      return response
    }

    if (upstream.suppressed) {
      return gateSuppressedResponse(context.request.method, path, upstream.attempts)
    }

    if (upstream.refused) {
      logger.error('cloudfront_proxy_unproven_response', {
        ...diagnosticFields(path, upstream, false),
        reason: upstream.refused,
        cf_cache_status: upstream.response?.headers.get('cf-cache-status') ?? null
      })
    }

    const stale = await staleResponse({
      cache,
      cacheKey,
      contentType,
      path,
      upstreamUrl,
      failure: upstream,
      policy: cachePolicy,
      budget,
      fetchImpl: source.fetch
    })
    if (stale.kind === 'served') {
      return stale.response
    }
    if (stale.kind === 'suppressed') {
      return gateSuppressedResponse(context.request.method, path, upstream.attempts)
    }

    logger.error('cloudfront_proxy_terminal_failure', diagnosticFields(path, upstream, false))
    const headers = diagnosticHeaders(upstream)
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('X-Source', 'cloudfront-proxy-error')
    if (upstream.refused) {
      headers.set('X-Proxy-Refused', upstream.refused)
    }
    setPublicNoStore(headers)
    return new Response(`${artifactName} unavailable`, {status: 502, headers})
  }
}

/** Wall-clock milliseconds of a concurrent read's two legs, for the value-free render log. */
export interface GatedReadTiming {
  focusMs: number
  /** Null when the read did not wait for the artifact (the focus probe did not read visible). */
  artifactMs: number | null
}

/** The answer of `readGatedConcurrently`. No variant names a data value. */
export type GatedRead =
  | {kind: 'ok'; body: ArrayBuffer; timing: GatedReadTiming}
  /** `currentFocus`: the hiding value the probe read, or null when the gate shut over a visible one. */
  | {kind: 'suppressed'; currentFocus: string | null; timing: GatedReadTiming}
  | {kind: 'focus-unreadable'; timing: GatedReadTiming}
  /** `status`: the status the proxy routes answer for the same failure (502). */
  | {kind: 'unavailable'; status: number; timing: GatedReadTiming}

export interface GatedReadOptions {
  /** Artifact path on the CloudFront data plane. */
  path: string
  /** The whole read's budget in ms, shared by both legs. */
  budgetMs: number
  /** Where to read. Absent: the CloudFront data plane. Only the server render's test seams pass one. */
  upstream?: Upstream
}

/**
 * One gated artifact read with the focus probe and the artifact fetch in FLIGHT TOGETHER, for the
 * composed dashboard (atlas decision 0160, soak fix). It keeps no last-known-good copy (D3), so it
 * has no cache read and no gate probe. Its latency is about the slower leg, not the sum: the serial
 * probe-then-fetch timed out on 2.5 s from colos far from CloudFront (soak, 2026-10-17).
 *
 * The answer is decided exactly as the serial proxy decides it, focus first:
 *
 * 1. A hiding focus value answers `suppressed` with that value; an unreadable one answers
 *    `focus-unreadable`. Either way the artifact leg stops: its fetch is aborted, it retries
 *    nothing, and a body that already arrived is cancelled unread (never read, parsed or logged).
 * 2. Under a visible value, the gate's suppression body answers `suppressed` with no value.
 * 3. Under a visible value, only a 200 that passed the admission rules (`successRefusal`) is read,
 *    and only after the probe answered visible.
 *
 * The probe and every artifact attempt draw on ONE budget. No work outlives the answer that touches
 * artifact bytes: a stopped leg only cancels.
 */
export async function readGatedConcurrently({path, budgetMs, upstream}: GatedReadOptions): Promise<GatedRead> {
  const startedAt = Date.now()
  const budget = startBudget(budgetMs)
  const source = upstream ?? CLOUDFRONT_UPSTREAM
  const stop = new AbortController()
  let focusMs = 0
  const focus = probeFocus(budget, source).then((result) => {
    focusMs = Date.now() - startedAt
    if (result.status !== 'visible') {
      stop.abort()
    }
    return result
  })
  const artifact = fetchWithRetry(`${source.base}${path}`, path, budget, source.fetch, {
    stop: stop.signal,
    focusVisible: () => focus.then((result) => result.status === 'visible')
  })

  const focusResult = await focus
  if (focusResult.status === 'suppressed') {
    logger.info?.('cloudfront_proxy_suppressed', {artifact: path, current_focus: focusResult.currentFocus})
    return {kind: 'suppressed', currentFocus: focusResult.currentFocus, timing: {focusMs, artifactMs: null}}
  }
  if (focusResult.status === 'unavailable') {
    logger.error('cloudfront_proxy_focus_probe_failed', {
      artifact: path,
      upstream_status: focusResult.upstreamStatus ?? null,
      error_class: focusResult.errorName ?? null
    })
    return {kind: 'focus-unreadable', timing: {focusMs, artifactMs: null}}
  }

  const result = await artifact
  const timing = {focusMs, artifactMs: Date.now() - startedAt}
  if (result.ok) {
    return {kind: 'ok', body: result.body, timing}
  }
  if (result.suppressed) {
    logger.info?.('cloudfront_proxy_gate_suppressed', {artifact: path, attempts: result.attempts})
    return {kind: 'suppressed', currentFocus: null, timing}
  }
  if (result.refused) {
    logger.error('cloudfront_proxy_unproven_response', {
      ...diagnosticFields(path, result, false),
      reason: result.refused,
      cf_cache_status: result.response?.headers.get('cf-cache-status') ?? null
    })
  }
  logger.error('cloudfront_proxy_terminal_failure', diagnosticFields(path, result, false))
  return {kind: 'unavailable', status: 502, timing}
}
