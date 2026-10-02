// audits/__tests__/progress.test.ts -- the heartbeat and aggregate-deadline seam
// (audits/lib/progress.mjs).
//
// WHAT IS BEING PINNED, AND WHY IT NEEDS PINNING. GitHub kills a self-hosted job at a
// ~600s INACTIVITY deadline, so these helpers exist to guarantee a long await still
// produces output. That guarantee is invisible when it works -- a silent check and an
// audible one look identical on a fast run -- so the only way the mechanism stays real is
// to assert it directly: that a heartbeat SPEAKS while an operation is in flight, that it
// STOPS when the operation settles (including when it throws), and that the interval stays
// an order of magnitude inside the deadline it is sized against.
//
// Injected clock and injected timers throughout: a suite that actually waited 30s to watch
// one heartbeat would be the slowest file in the repo for no added signal.

import {describe, expect, it, vi} from 'vitest'
import {createDeadline, HEARTBEAT_INTERVAL_MS, progress, startHeartbeat, withHeartbeat} from '../lib/progress.mjs'

/** A fake interval pair whose scheduled callback can be fired on demand. */
function fakeTimers() {
  const scheduled: {fn: () => void; ms: number}[] = []
  let cleared = 0
  return {
    scheduled,
    clearedCount: () => cleared,
    timers: {
      setInterval: ((fn: () => void, ms: number) => {
        scheduled.push({fn, ms})
        return {unref: () => undefined}
      }) as unknown as typeof setInterval,
      clearInterval: (() => {
        cleared++
      }) as unknown as typeof clearInterval
    }
  }
}

describe('HEARTBEAT_INTERVAL_MS', () => {
  // The whole mechanism is sized against the ~600s deadline. A future edit that raises
  // this to, say, 600s would leave the module present, the tests green and the protection
  // gone -- so the relationship is asserted rather than left to the comment.
  it('stays an order of magnitude inside the ~600s inactivity deadline', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(60_000)
    expect(600_000 / HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(10)
  })

  // Green run 33099282274 ran 620s and PASSED with a largest silent gap of 110.4s, so a
  // healthy slow lane was never near this bound. Asserting it keeps the interval from being
  // "tightened" into noise on the belief that the deadline is tighter than it is.
  it('is comfortably below the largest gap a green 620s run already survived', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(110_400)
  })
})

describe('progress', () => {
  it('indents under the check header so one check reads as one block', () => {
    const log = vi.fn()
    progress('held 2 of 2 blobs', {log})
    expect(log).toHaveBeenCalledWith('  held 2 of 2 blobs')
  })
})

describe('startHeartbeat', () => {
  it('schedules at the shared interval and says what it is waiting on, with elapsed seconds', () => {
    const {scheduled, timers} = fakeTimers()
    const log = vi.fn()
    let clock = 1_000
    startHeartbeat('the SA Stats API', {log, now: () => clock, timers})

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].ms).toBe(HEARTBEAT_INTERVAL_MS)
    expect(log).not.toHaveBeenCalled() // nothing is announced before the first interval

    clock = 1_000 + 95_000
    scheduled[0].fn()
    expect(log).toHaveBeenCalledWith('  ... still waiting on the SA Stats API after 95s')
  })

  it('keeps speaking on every interval, so a long stall produces many lines rather than one', () => {
    const {scheduled, timers} = fakeTimers()
    const log = vi.fn()
    let clock = 0
    startHeartbeat('chromium.launch()', {log, now: () => clock, timers})
    for (const t of [30_000, 60_000, 90_000]) {
      clock = t
      scheduled[0].fn()
    }
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '  ... still waiting on chromium.launch() after 30s',
      '  ... still waiting on chromium.launch() after 60s',
      '  ... still waiting on chromium.launch() after 90s'
    ])
  })

  it('stops only once, so a double stop cannot clear an unrelated later timer', () => {
    const fake = fakeTimers()
    const stop = startHeartbeat('x', {log: vi.fn(), now: () => 0, timers: fake.timers})
    stop()
    stop()
    expect(fake.clearedCount()).toBe(1)
  })
})

describe('withHeartbeat', () => {
  it('returns the operation value and stops the heartbeat', async () => {
    const fake = fakeTimers()
    const value = await withHeartbeat('fetch', async () => 'body', {log: vi.fn(), now: () => 0, timers: fake.timers})
    expect(value).toBe('body')
    expect(fake.clearedCount()).toBe(1)
  })

  // A heartbeat that outlived a rejected await would report progress on work that had
  // already failed -- announcing liveness for nothing is worse than silence.
  it('stops the heartbeat when the operation throws, and propagates the error', async () => {
    const fake = fakeTimers()
    await expect(withHeartbeat('fetch', async () => {
      throw new Error('HTTP 500')
    }, {log: vi.fn(), now: () => 0, timers: fake.timers})).rejects.toThrow('HTTP 500')
    expect(fake.clearedCount()).toBe(1)
  })

  it('announces the in-flight operation while it is still pending', async () => {
    const {scheduled, timers} = fakeTimers()
    const log = vi.fn()
    let clock = 0
    let release: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = withHeartbeat('the pinned blob', () => pending, {log, now: () => clock, timers})

    clock = 45_000
    scheduled[0].fn()
    expect(log).toHaveBeenCalledWith('  ... still waiting on the pinned blob after 45s')

    release()
    await running
  })
})

describe('createDeadline', () => {
  it('tracks elapsed and remaining against an injected clock', () => {
    let clock = 10_000
    const deadline = createDeadline(120_000, {now: () => clock})
    expect(deadline.budgetMs).toBe(120_000)
    expect(deadline.expired()).toBe(false)
    expect(deadline.remainingMs()).toBe(120_000)

    clock = 10_000 + 90_000
    expect(deadline.elapsedMs()).toBe(90_000)
    expect(deadline.remainingMs()).toBe(30_000)
    expect(deadline.expired()).toBe(false)
  })

  it('reports expired once the budget is spent', () => {
    let clock = 0
    const deadline = createDeadline(1_000, {now: () => clock})
    clock = 1_000
    expect(deadline.expired()).toBe(true)
  })

  // A zero-length AbortSignal.timeout aborts before the request is attempted, which would
  // report a perfectly reachable source as unreachable. The floor keeps an exhausted
  // budget honest: it stops new work (via expired()) instead of faking a failed fetch.
  it('floors remaining at 1ms so an exhausted budget never mints a zero-length timeout', () => {
    let clock = 0
    const deadline = createDeadline(1_000, {now: () => clock})
    clock = 500_000
    expect(deadline.remainingMs()).toBe(1)
  })
})
