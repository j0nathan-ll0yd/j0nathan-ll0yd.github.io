// The rate-limiter Worker's ClientRateLimitWindow Durable Object and the fixed-window arithmetic it runs
// (src/lib/edge/rate-limit-window.ts), in Node, with an in-memory stand-in for the object's storage.
// vitest.unit.config.ts includes this directory, and aliases `cloudflare:workers` to a stand-in.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {API_V1_RATE_LIMIT} from '../../../src/lib/edge/agent-catalog.mjs'
import {consumeWindow, type RateLimitDecision, type WindowState} from '../../../src/lib/edge/rate-limit-window'
import {ClientRateLimitWindow} from '../src/ClientRateLimitWindow'

afterEach(() => {
  vi.useRealTimers()
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

describe('ClientRateLimitWindow (the Durable Object)', () => {
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
    const object = new (ClientRateLimitWindow as unknown as new(ctx: unknown, env: unknown) => ClientRateLimitWindow)(ctx, {})
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
