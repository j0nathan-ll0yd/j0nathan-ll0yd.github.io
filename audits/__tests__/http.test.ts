// @vitest-environment node
//
// fetchStable's budget used to be read only by the retry-loop condition; each
// fetch attempt itself was unbounded, so one hung origin hung the audit
// forever (301 s / 392 s measured; atlas decision 0106). Pinned to the node
// environment because the audits run under plain node and these tests exercise
// AbortSignal.timeout()/AbortSignal.any() semantics, not DOM behavior.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {DEFAULT_BUDGET_MS, fetchStable} from '../lib/http.mjs'

/** Mimics undici on a hung origin: never resolves, rejects with the signal reason on abort. */
function hangUntilAborted(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal
    if (!signal) {
      reject(new Error('expected fetchStable to bound the attempt with an abort signal'))
      return
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchStable attempt bounding', () => {
  it('aborts a never-resolving attempt within the budget instead of hanging', async () => {
    const fetchMock = vi.fn(hangUntilAborted)
    vi.stubGlobal('fetch', fetchMock)
    const startedAt = Date.now()
    await expect(fetchStable('https://example.test/hang', {}, 200)).rejects.toHaveProperty('name', 'TimeoutError')
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('counts a timed-out attempt as failed and retries it while budget remains', async () => {
    let calls = 0
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      calls += 1
      return calls === 1 ? hangUntilAborted(url, init) : Promise.resolve(new Response('recovered', {status: 200}))
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchStable('https://example.test/hang-then-ok', {}, 2_000, 50)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('composes a caller-provided signal in and propagates its abort without retrying', async () => {
    const fetchMock = vi.fn(hangUntilAborted)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const startedAt = Date.now()
    const pending = fetchStable('https://example.test/hang', {signal: controller.signal})
    setTimeout(() => controller.abort(), 25)
    await expect(pending).rejects.toHaveProperty('name', 'AbortError')
    // The default budget is 20 s and the per-attempt cap 10 s; settling this
    // fast proves the caller's abort cut through the composed signal.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('fetchStable retry semantics (preserved)', () => {
  it('retries a transient 5xx with backoff and returns the recovered response', async () => {
    vi.useFakeTimers()
    const statuses = [503, 200]
    const fetchMock = vi.fn(async () => new Response('body', {status: statuses.shift() ?? 200}))
    vi.stubGlobal('fetch', fetchMock)
    const pending = fetchStable('https://example.test/flaky')
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toHaveProperty('status', 200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns the last 5xx once the remaining budget cannot fund another backoff', async () => {
    const fetchMock = vi.fn(async () => new Response('down', {status: 503}))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchStable('https://example.test/steady-503', {}, 50)
    expect(res.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry reachability errors (DNS, TLS)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchStable('https://example.test/unreachable', {}, 2_000)).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('exports the budget the other bounded audit fetches share', () => {
    expect(DEFAULT_BUDGET_MS).toBe(20_000)
  })
})
