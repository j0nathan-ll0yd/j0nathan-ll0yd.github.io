// The developer API's rate limiter (src/lib/edge/rate-limit.ts) and its Durable Object
// (src/durable/ApiRateLimiter.ts), in Node, with an in-memory stand-in for the object's storage.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ApiRateLimiter} from '../../src/durable/ApiRateLimiter'
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

describe('consumeWindow (the fixed window)', () => {
  it('counts down r from limit - 1 to 0, then refuses until the window ends', () => {
    const policy = {policy: 'default', limit: 3, windowSeconds: 60}
    let state: WindowState | undefined
    const seen: Array<[boolean, number, number]> = []
    for (let i = 0; i < 4; i++) {
      const result = consumeWindow(state, 1_000 + i * 1_000, policy)
      state = result.state
      seen.push([result.decision.allowed, result.decision.remaining, result.decision.resetSeconds])
    }
    expect(seen).toEqual([[true, 2, 60], [true, 1, 59], [true, 0, 58], [false, 0, 57]])
    expect(state!.count).toBe(3)
    const next = consumeWindow(state, 61_000, policy)
    expect(next.decision).toEqual({allowed: true, remaining: 2, resetSeconds: 60})
  })

  it('never reports t below 1 inside a window', () => {
    const {decision} = consumeWindow({count: 1, windowEndMs: 10_000}, 9_999, API_V1_RATE_LIMIT)
    expect(decision.resetSeconds).toBe(1)
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

  it('logs one warning per reason per interval, however many requests fail open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const request = new Request(`${ORIGIN}/api/v1/books.json`)
    const before = warn.mock.calls.length
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(request, limiter(() => Promise.reject(new Error('quota'))))
    }
    expect(warn.mock.calls.length - before).toBeLessThanOrEqual(1)
    warn.mockRestore()
  })
})

describe('ApiRateLimiter (the Durable Object)', () => {
  function objectWithStorage() {
    const kv = new Map<string, unknown>()
    const alarms: number[] = []
    let deleted = 0
    const ctx = {
      storage: {
        kv: {
          get: (key: string) => kv.get(key),
          put: (key: string, value: unknown) => void kv.set(key, value),
          delete: (key: string) => kv.delete(key)
        },
        setAlarm: async (time: number) => void alarms.push(time),
        deleteAll: async () => {
          kv.clear()
          deleted++
        }
      }
    }
    const object = new (ApiRateLimiter as unknown as new(ctx: unknown, env: unknown) => ApiRateLimiter)(ctx, {})
    return {object, kv, alarms, deleted: () => deleted}
  }

  it('counts per object, sets one alarm per window, and forgets the client when it fires', async () => {
    vi.useFakeTimers({now: 1_000_000})
    const {object, kv, alarms, deleted} = objectWithStorage()
    const decisions: RateLimitDecision[] = []
    for (let i = 0; i < 3; i++) {
      decisions.push(await object.consume(2, 60))
    }
    expect(decisions.map((d) => [d.allowed, d.remaining])).toEqual([[true, 1], [true, 0], [false, 0]])
    expect(alarms).toEqual([1_060_000])
    vi.setSystemTime(1_060_000)
    await object.alarm()
    expect(kv.size).toBe(0)
    expect(deleted()).toBe(1)
    expect((await object.consume(2, 60)).remaining).toBe(1)
    vi.useRealTimers()
  })

  it("keeps a newer window when the old window's alarm runs late", async () => {
    vi.useFakeTimers({now: 2_000_000})
    const {object, kv, alarms} = objectWithStorage()
    await object.consume(2, 60)
    vi.setSystemTime(2_060_001)
    await object.consume(2, 60)
    await object.alarm()
    expect(kv.size).toBe(1)
    expect(alarms).toEqual([2_060_000, 2_120_001, 2_120_001])
    expect((await object.consume(2, 60)).remaining).toBe(0)
    vi.useRealTimers()
  })

  it('writes nothing for a refused request, and starts fresh over malformed state', async () => {
    vi.useFakeTimers({now: 3_000_000})
    const {object, kv} = objectWithStorage()
    kv.set('window', {count: 'x'})
    expect((await object.consume(1, 60)).allowed).toBe(true)
    const stored = kv.get('window')
    expect((await object.consume(1, 60)).allowed).toBe(false)
    expect(kv.get('window')).toBe(stored)
    vi.useRealTimers()
  })
})
