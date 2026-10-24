// The developer API facade (is-agentic api-v1 plan; owner decisions 2026-10-24). The Worker answers
// `/api/v1/<export>.json` with the same bytes as the CloudFront export, read through the same focus
// gate (makeCloudfrontProxy), and adds the HTTP semantics the data plane lacks: RFC 9457 problem
// details on every failure, the RateLimit fields, and CORS. CloudFront stays the storage and privacy
// plane. Every other path under /api, except /api/csp-report, answers the not-found problem.
//
// Order of operations (review protocol pass 2): the path, then the method, then the rate limit, and
// only then the gated read. A request the facade refuses never reaches the data plane, and the
// factory's own 405 and 502 text answers never reach a client: the facade translates each one.

import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {errorClass} from '../data-plane/admission'
import {type RenderVars, upstreamForRequest} from '../data-plane/request'
import {AGENT_PATHS} from './agent-paths.mjs'
import {problemResponse} from './problem'
import {
  type CloudfrontProxyContext,
  LLM_OUTPUT_CACHE_POLICY,
  makeCloudfrontProxy,
  SUPPRESSION_REASON,
  SUPPRESSION_RETRY_AFTER_SECONDS,
  SUPPRESSION_SOURCE
} from './proxy'
import {
  checkRateLimit,
  RATE_LIMIT_HEADER_NAMES,
  RATE_LIMITER_BINDING,
  type RateLimitDecision,
  type RateLimiterNamespace,
  rateLimitHeader,
  rateLimitPolicyHeader
} from './rate-limit'

/** The export paths the facade serves: the nine contract paths (all nine: owner decision 2026-10-24). */
export const API_V1_PATHS: readonly string[] = Object.freeze(Object.values(ENDPOINTS))

/** The facade paths a not-found problem lists in `validPaths`. */
export const API_V1_VALID_PATHS: readonly string[] = Object.freeze(API_V1_PATHS.map((path) => `${AGENT_PATHS.apiV1}${path}`))

/** The methods the facade serves. OPTIONS answers a CORS preflight. */
export const API_V1_ALLOW = 'GET, HEAD'

/** The JSON media type of a 200, the same bytes as the CloudFront export. */
export const API_V1_CONTENT_TYPE = 'application/json; charset=utf-8'

/** `Retry-After`, in seconds, on the upstream-unavailable problem. */
export const UPSTREAM_RETRY_AFTER_SECONDS = 30

const logger = createEdgeLogger({service: 'api-v1'})

/** How long a browser may reuse a preflight answer. */
const PREFLIGHT_MAX_AGE_SECONDS = 86_400

/** The diagnostics the gated proxy sets, which a cross-origin script may read beside the RateLimit fields. */
const PROXY_DIAGNOSTIC_HEADERS = Object.freeze([
  'X-Proxy-Attempts',
  'X-Proxy-Upstream-Status',
  'X-Proxy-Upstream-Request-Id',
  'X-Proxy-Stale',
  'X-Source',
  'Warning'
])

/** Wildcard CORS: the data is public and no request carries credentials, so no `Vary: Origin`. */
const CORS_HEADERS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Expose-Headers', [...RATE_LIMIT_HEADER_NAMES, ...PROXY_DIAGNOSTIC_HEADERS].join(', ')]
])

/** What one request needs beyond itself: the Worker variables (test seams) and the counter binding. */
export interface ApiV1Env {
  vars: RenderVars
  rateLimiter?: RateLimiterNamespace
}

/** The Worker environment, as the route reads it (`cloudflare:workers` `env`). */
export function apiV1Env(env: Readonly<Record<string, unknown>>): ApiV1Env {
  const binding = env[RATE_LIMITER_BINDING] as RateLimiterNamespace | undefined
  return binding === undefined ? {vars: env} : {vars: env, rateLimiter: binding}
}

export interface ApiV1Context {
  request: Request
  waitUntil(promise: Promise<unknown>): void
}

/** One gated reader per export, built once per isolate (the MCP server's pattern). */
const readers = new Map<string, (context: CloudfrontProxyContext) => Promise<Response>>(API_V1_PATHS.map((path) => [
  path,
  makeCloudfrontProxy({path, contentType: API_V1_CONTENT_TYPE, cachePolicy: LLM_OUTPUT_CACHE_POLICY})
]))

/** The headers every facade response carries: CORS and the policy, which never changes between requests. */
function baseHeaders(): Headers {
  const headers = new Headers(CORS_HEADERS as Array<[string, string]>)
  headers.set('RateLimit-Policy', rateLimitPolicyHeader())
  return headers
}

function withDecision(headers: Headers, decision: RateLimitDecision | null): Headers {
  // Fail-open: with no decision the facade states the policy and no available quota it cannot know.
  if (decision !== null) {
    headers.set('RateLimit', rateLimitHeader(decision))
  }
  return headers
}

/** The not-found problem for any path under /api the facade does not serve. */
export function apiNotFound(request: Request): Response {
  const instance = new URL(request.url).pathname
  return problemResponse('not-found', {instance, method: request.method, extensions: {validPaths: API_V1_VALID_PATHS}, headers: baseHeaders()})
}

/** The export path a facade request names, or null. Only `/api/v1/<export>` resolves. */
export function resolveApiV1Path(pathname: string): string | null {
  const prefix = `${AGENT_PATHS.apiV1}/`
  if (!pathname.startsWith(prefix)) {
    return null
  }
  const path = `/${pathname.slice(prefix.length)}`
  return API_V1_PATHS.includes(path) ? path : null
}

/** A HEAD answer keeps the headers and drops the body. */
function bodyless(response: Response): Response {
  if (response.body !== null) {
    response.body.cancel().catch(() => {})
  }
  return new Response(null, {status: response.status, statusText: response.statusText, headers: response.headers})
}

/** Translates the gated proxy's answer: a 200 passes through, a suppression and any failure become problems. */
async function translate(upstream: Response, request: Request, instance: string, decision: RateLimitDecision | null): Promise<Response> {
  if (upstream.status === 200) {
    const headers = new Headers(upstream.headers)
    baseHeaders().forEach((value, name) => headers.set(name, value))
    withDecision(headers, decision)
    headers.set('Content-Type', API_V1_CONTENT_TYPE)
    const response = new Response(upstream.body, {status: 200, headers})
    return request.method === 'HEAD' ? bodyless(response) : response
  }

  // No upstream body is echoed: a problem states its type, never the data plane's words.
  upstream.body?.cancel().catch(() => {})
  const headers = withDecision(baseHeaders(), decision)
  for (const name of PROXY_DIAGNOSTIC_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) {
      headers.set(name, value)
    }
  }

  if (upstream.status === 503 && upstream.headers.get('X-Source') === SUPPRESSION_SOURCE) {
    const retryAfter = Number(upstream.headers.get('Retry-After') ?? SUPPRESSION_RETRY_AFTER_SECONDS)
    headers.set('Retry-After', String(retryAfter))
    // `suppressed` and `reason` keep every existing recognizer working on this body
    // (src/lib/data-plane/admission.ts isSuppressionValue, audits/lib/suppression.mjs suppressionBody).
    return problemResponse('focus-suppressed', {
      instance,
      method: request.method,
      extensions: {suppressed: true, reason: SUPPRESSION_REASON, retryAfterSeconds: retryAfter},
      headers
    })
  }

  headers.set('Retry-After', String(UPSTREAM_RETRY_AFTER_SECONDS))
  return problemResponse('upstream-unavailable', {instance, method: request.method, extensions: {retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS}, headers})
}

/** Test hook: replaces the gated reader. Production never passes one. */
export type GatedReader = (path: string, context: CloudfrontProxyContext) => Promise<Response>

const defaultReader: GatedReader = (path, context) => readers.get(path)!(context)

/**
 * Answers one request under /api/v1. An unexpected error still answers a problem, never the 500 page:
 * one structured line names the error class, and the client gets upstream-unavailable.
 */
export async function handleApiV1(context: ApiV1Context, env: ApiV1Env, read: GatedReader = defaultReader): Promise<Response> {
  try {
    return await answerApiV1(context, env, read)
  } catch (error) {
    logger.error('api_v1_unhandled', {error_class: errorClass(error)})
    const headers = baseHeaders()
    headers.set('Retry-After', String(UPSTREAM_RETRY_AFTER_SECONDS))
    return problemResponse('upstream-unavailable', {
      instance: new URL(context.request.url).pathname,
      method: context.request.method,
      extensions: {retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS},
      headers
    })
  }
}

async function answerApiV1(context: ApiV1Context, env: ApiV1Env, read: GatedReader): Promise<Response> {
  const {request} = context
  const instance = new URL(request.url).pathname

  // 1. Path. An unknown file, a nested path or the bare base is not found; never the HTML 404.
  const path = resolveApiV1Path(instance)
  if (path === null) {
    return apiNotFound(request)
  }

  // 2. Method. A preflight answers before the counter: it reads nothing and costs no quota.
  if (request.method === 'OPTIONS') {
    const headers = baseHeaders()
    headers.set('Access-Control-Allow-Methods', `${API_V1_ALLOW}, OPTIONS`)
    headers.set('Access-Control-Allow-Headers', '*')
    headers.set('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SECONDS))
    headers.set('Cache-Control', 'no-store')
    return new Response(null, {status: 204, headers})
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const headers = baseHeaders()
    headers.set('Allow', API_V1_ALLOW)
    return problemResponse('method-not-allowed', {instance, method: request.method, headers})
  }

  // 3. Rate limit, before any upstream read.
  const decision = await checkRateLimit(request, env.rateLimiter)
  if (decision !== null && !decision.allowed) {
    const headers = withDecision(baseHeaders(), decision)
    headers.set('Retry-After', String(decision.resetSeconds))
    return problemResponse('rate-limited', {instance, method: request.method, extensions: {retryAfterSeconds: decision.resetSeconds}, headers})
  }

  // 4. The gated read: the focus probe, then the artifact through the gate, no-store throughout.
  const upstream = upstreamForRequest(request, env.vars)
  const proxied = await read(path, {request, waitUntil: (promise) => context.waitUntil(promise), ...(upstream ? {upstream} : {})})
  return translate(proxied, request, instance, decision)
}
