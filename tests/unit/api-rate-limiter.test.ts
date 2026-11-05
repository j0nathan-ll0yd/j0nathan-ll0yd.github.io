// The site Worker's side of the developer API's rate limiter (src/lib/edge/rate-limit.ts), in Node:
// the counter key, the RateLimit serializers and the fail-open client. The Durable Object and the
// window arithmetic are tested with the rate-limiter Worker (workers/rate-limiter/test/).
import {afterEach, describe, expect, it, vi} from 'vitest'
import {API_V1_RATE_LIMIT} from '../../src/lib/edge/agent-catalog.mjs'
import {
  checkRateLimit,
  clientKey,
  clientPartition,
  consumeWindow,
  type RateLimitDecision,
  type RateLimiterNamespace,
  rateLimitHeader,
  rateLimitPolicyHeader,
  UNAVAILABLE_LOG_INTERVAL_MS,
  type WindowState
} from '../../src/lib/edge/rate-limit'

const ORIGIN = 'https://jonathanlloyd.me'
const POLICY = `"default";q=${API_V1_RATE_LIMIT.limit};w=${API_V1_RATE_LIMIT.windowSeconds}`

/** A namespace whose every client gets the next decision from `decide`. */
function limiter(decide: () => RateLimitDecision | Promise<RateLimitDecision>): RateLimiterNamespace {
  return {getByName: () => ({consume: async () => decide()})}
}

afterEach(() => {
  vi.useRealTimers()
})

describe('clientPartition (the counter key input)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3:8d3::/64'],
    ['2001:0db8:85a3:08d3:ffff:ffff:ffff:ffff', '2001:db8:85a3:8d3::/64'],
    ['2001:DB8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['unknown', 'unknown'],
    ['1:2:3', '1:2:3']
  ])('%s is partition %s', (ip, partition) => {
    expect(clientPartition(ip)).toBe(partition)
  })

  it('gives every address in one IPv6 /64 the same counter, and another /64 its own', async () => {
    const key = await clientKey('2001:db8:1:2::a')
    expect(await clientKey('2001:db8:1:2:ffff::b')).toBe(key)
    expect(await clientKey('2001:db8:1:3::a')).not.toBe(key)
  })
})

describe('the RateLimit field serializers (draft-ietf-httpapi-ratelimit-headers-11)', () => {
  it('writes the policy item with q and w, and the service limit item with r and t', () => {
    expect(rateLimitPolicyHeader()).toBe(POLICY)
    expect(rateLimitHeader({allowed: true, remaining: 7, resetSeconds: 9})).toBe('"default";r=7;t=9')
  })
})

describe('checkRateLimit', () => {
  it('treats a malformed or slow counter answer as no decision', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const request = new Request(`${ORIGIN}/api/v1/books.json`)
    expect(await checkRateLimit(request, limiter(() => ({allowed: true, remaining: -1, resetSeconds: 0})))).toBeNull()
    // RATE_LIMIT_TIMEOUT_MS bounds a counter that never answers.
    expect(await checkRateLimit(request, limiter(() => new Promise<RateLimitDecision>(() => {})))).toBeNull()
    warn.mockRestore()
  })

  it('logs exactly one warning per reason per interval, and none carries the address or the counter key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ip = '203.0.113.9'
    const request = new Request(`${ORIGIN}/api/v1/books.json`, {headers: {'CF-Connecting-IP': ip}})
    // Start one interval past any earlier test's warning for the same reason (the throttle is per isolate).
    vi.useFakeTimers({now: Date.now() + 10 * UNAVAILABLE_LOG_INTERVAL_MS, toFake: ['Date']})
    const fail = () => checkRateLimit(request, limiter(() => Promise.reject(new Error('quota'))))
    const warnings = () => warn.mock.calls.filter((call) => String(call[0]).includes('api_v1_rate_limit_unavailable'))

    for (let i = 0; i < 20; i++) {
      expect(await fail()).toBeNull()
    }
    expect(warnings()).toHaveLength(1)

    vi.setSystemTime(Date.now() + UNAVAILABLE_LOG_INTERVAL_MS - 1)
    await fail()
    expect(warnings()).toHaveLength(1)

    vi.setSystemTime(Date.now() + 1)
    await fail()
    expect(warnings()).toHaveLength(2)

    const fields = warnings().map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    for (const field of fields) {
      expect(Object.keys(field).sort()).toEqual(['error_class', 'level', 'message', 'reason', 'service', 'timestamp'])
      expect(field).toMatchObject({reason: 'error', error_class: 'Error', message: 'api_v1_rate_limit_unavailable'})
    }
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain(ip)
    expect(logged).not.toContain(await clientKey(ip))
    warn.mockRestore()
  })
})
