// The developer API facade's per-client rate limit (owner decision 2026-10-24, option B): a fixed
// window counter that one Durable Object per client owns, so the remaining quota and the window end
// it reports are exact and global, not per-location estimates. The object runs in its own Worker
// (workers/rate-limiter/), bound here through `script_name`; the window arithmetic both Workers run
// is ./rate-limit-window.ts.
//
// The header syntax follows draft-ietf-httpapi-ratelimit-headers-11 (2026-05-23):
// - section 3.1: `RateLimit-Policy` is a List of quota policy Items; the Item is a String, `q` the
//   REQUIRED quota (a non-negative Integer) and `w` the window in seconds;
// - section 4.1: `RateLimit` is a List of service limit Items naming the policy, with `r` the
//   REQUIRED available quota and `t` the OPTIONAL effective window in seconds;
// - section 6: a `Retry-After` beside the RateLimit fields SHOULD NOT point earlier than the end of
//   the effective window, so a 429 sends `Retry-After` equal to `t`.

import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {errorClass, withDeadline} from '../data-plane/admission'
import {API_V1_RATE_LIMIT} from './agent-catalog.mjs'
import type {RateLimitDecision, RateLimitPolicy} from './rate-limit-window'

export { consumeWindow, isWindowState } from './rate-limit-window'
export type { RateLimitDecision, RateLimitPolicy, WindowState } from './rate-limit-window'

export const RATE_LIMIT_POLICY: RateLimitPolicy = API_V1_RATE_LIMIT

/** The `RateLimit-Policy` field value (draft section 3.1), for example `"default";q=60;w=60`. */
export function rateLimitPolicyHeader(policy: RateLimitPolicy = RATE_LIMIT_POLICY): string {
  return `"${policy.policy}";q=${policy.limit};w=${policy.windowSeconds}`
}

/** The `RateLimit` field value (draft section 4.1), for example `"default";r=59;t=42`. */
export function rateLimitHeader(decision: RateLimitDecision, policy: RateLimitPolicy = RATE_LIMIT_POLICY): string {
  return `"${policy.policy}";r=${decision.remaining};t=${decision.resetSeconds}`
}

/** The response header names the facade exposes to a cross-origin script (CORS Access-Control-Expose-Headers). */
export const RATE_LIMIT_HEADER_NAMES = Object.freeze(['RateLimit-Policy', 'RateLimit', 'Retry-After'])

/** The counter's RPC surface, as the Worker calls it through a Durable Object stub. */
export interface RateLimiterStub {
  consume(limit: number, windowSeconds: number): Promise<RateLimitDecision>
}

/** The Durable Object namespace binding (wrangler.jsonc `durable_objects`, binding API_RATE_LIMITER). */
export interface RateLimiterNamespace {
  getByName(name: string): RateLimiterStub
}

/** The binding name the Worker reads. */
export const RATE_LIMITER_BINDING = 'API_RATE_LIMITER'

/**
 * How long the Worker waits for the counter. A Durable Object call answers in a few ms (the 61-request
 * burst on the #395 preview, through the real cross-Worker binding, never came near it). Past 250 ms
 * the counter is unhealthy, and fail-open (owner decision 2026-10-24) must not hold every API request
 * for longer than that before the gated read starts (review of #395, I3).
 */
export const RATE_LIMIT_TIMEOUT_MS = 250

const logger = createEdgeLogger({service: 'api-v1-rate-limit'})

/**
 * The counter key for one client: the SHA-256 of its address partition (`clientPartition`), hex. The
 * object name is derived from the address and never is the address, and no log line carries either.
 */
export async function clientKey(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientPartition(ip)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The IPv6 groups a client controls as one: a /64, the smallest prefix an ISP assigns to one subscriber. */
const IPV6_PARTITION_GROUPS = 4

/**
 * The address partition one client controls. An IPv4 address is its own partition. An IPv6 address
 * is partitioned at its /64: one subscriber holds a whole /64, so a per-address counter would give it
 * 2^64 budgets. An IPv4-mapped IPv6 address is its IPv4 address. Anything else is its own partition.
 */
export function clientPartition(ip: string): string {
  const address = ip.trim().toLowerCase()
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
  if (mapped) {
    return mapped[1]!
  }
  if (!address.includes(':')) {
    return address
  }
  const groups = expandIpv6(address)
  return groups === null ? address : `${groups.slice(0, IPV6_PARTITION_GROUPS).join(':')}::/64`
}

/** The eight 16-bit groups of an IPv6 address, without leading zeros, or null when it is not one. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split('::')
  if (halves.length > 2) {
    return null
  }
  const head = halves[0] === '' ? [] : halves[0]!.split(':')
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : []
  const missing = 8 - head.length - tail.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null
  }
  const groups = [...head, ...Array.from({length: halves.length === 2 ? missing : 0}, () => '0'), ...tail]
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return null
  }
  return groups.map((group) => group.replace(/^0+(?=.)/, ''))
}

/** The address the counter keys on. Cloudflare sets `CF-Connecting-IP` on every request it proxies. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

/**
 * How often one isolate logs the same fail-open reason. A flood that exhausts the Durable Object
 * allowance would otherwise write one warning per request.
 */
export const UNAVAILABLE_LOG_INTERVAL_MS = 60_000
const lastUnavailableLog = new Map<string, number>()

/** One structured warning per reason per interval per isolate. */
function warnUnavailable(reason: string, fields: Record<string, unknown> = {}): void {
  const now = Date.now()
  const last = lastUnavailableLog.get(reason)
  if (last !== undefined && now - last < UNAVAILABLE_LOG_INTERVAL_MS) {
    return
  }
  lastUnavailableLog.set(reason, now)
  logger.warn('api_v1_rate_limit_unavailable', {reason, ...fields})
}

/**
 * Counts one request for its client. Null when the counter is unbound, unreachable, slow or wrong:
 * the request then goes ahead (fail-open), and one structured warning records why.
 */
export async function checkRateLimit(
  request: Request,
  namespace: RateLimiterNamespace | undefined,
  policy: RateLimitPolicy = RATE_LIMIT_POLICY
): Promise<RateLimitDecision | null> {
  if (namespace === undefined) {
    warnUnavailable('unbound')
    return null
  }
  try {
    const stub = namespace.getByName(await clientKey(clientIp(request)))
    const decision = await withDeadline(() => stub.consume(policy.limit, policy.windowSeconds), RATE_LIMIT_TIMEOUT_MS, 'rate limiter')
    if (!isDecision(decision)) {
      warnUnavailable('malformed')
      return null
    }
    return decision
  } catch (error) {
    warnUnavailable('error', {error_class: errorClass(error)})
    return null
  }
}

function isDecision(value: unknown): value is RateLimitDecision {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const decision = value as Record<string, unknown>
  return typeof decision.allowed === 'boolean' && Number.isInteger(decision.remaining) && Number.isInteger(decision.resetSeconds) &&
    (decision.remaining as number) >= 0 && (decision.resetSeconds as number) >= 1
}
