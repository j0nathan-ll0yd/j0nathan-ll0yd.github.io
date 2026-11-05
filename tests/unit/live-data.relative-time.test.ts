// @vitest-environment jsdom
//
// Relative time labels (design-system-Lifegames #317, @j0nathan-ll0yd/web 4.4.0). The server prints
// each <time data-relative> as absolute UTC text, so a composed page is byte-stable across the
// composition clock (atlas decision 0164). On a normal load no newer generation arrives, so no
// updater writes those labels: the runtime fills them once at load, and again on each freshness
// re-judgement so they keep ageing.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const fill = vi.hoisted(() => ({calls: [] as unknown[][]}))
vi.mock('@j0nathan-ll0yd/web/runtime/relative-time-fill', async (importActual) => {
  const actual = await importActual<typeof import('@j0nathan-ll0yd/web/runtime/relative-time-fill')>()
  return {
    fillRelativeTimes: (...args: Parameters<typeof actual.fillRelativeTimes>) => {
      fill.calls.push(args)
      actual.fillRelativeTimes(...args)
    }
  }
})
vi.mock('../../src/lib/runtime/ws-client', () => ({
  WSClient: class {
    connect(): void {}
    disconnect(): void {}
  }
}))
vi.mock('../../src/lib/runtime/api',
  async (importActual) => ({
    ...await importActual<typeof import('../../src/lib/runtime/api')>(),
    fetchArtifact: vi.fn(() => Promise.resolve({status: 'failed', reason: 'unit test'})),
    fetchAllEndpoints: vi.fn(() => {
      const keys = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'focus', 'theatreReviews']
      return Promise.resolve({
        ...Object.fromEntries(
          keys.map((
            key
          ) => [key, key === 'focus' ? {status: 'ok', data: {generatedAt: T0_ISO, currentFocus: 'None'}} : {status: 'failed', reason: 'unit test'}])
        ),
        timestamps: Object.fromEntries(keys.map((key) => [key, key === 'focus' ? T0_ISO : null]))
      })
    })
  }))

const T0 = Date.parse('2026-10-10T07:00:00Z')
const T0_ISO = new Date(T0).toISOString()
const ABSOLUTE = '2026-10-10 06:55 UTC'

beforeEach(() => {
  vi.useFakeTimers({now: T0})
  vi.resetModules()
  fill.calls = []
  document.body.innerHTML =
    `<div id="cardDevLog" class="tri-card"><time id="t" datetime="2026-10-10T06:55:00Z" data-relative="compact">${ABSOLUTE}</time></div>`
})

afterEach(() => {
  vi.useRealTimers()
})

describe('relative time labels (web 4.4.0)', () => {
  it('fills the server labels once at load, before any timer runs', async () => {
    await import('../../src/lib/runtime/live-data')
    expect(fill.calls[0]).toEqual([document])
    expect(document.getElementById('t')?.textContent).not.toBe(ABSOLUTE)
  })

  it('fills them again on each freshness re-judgement, at that moment', async () => {
    await import('../../src/lib/runtime/live-data')
    await vi.advanceTimersByTimeAsync(1000)
    const later = fill.calls.slice(1)
    expect(later.length).toBeGreaterThan(0)
    expect(later.every(([root, now]) => root === document && typeof now === 'number')).toBe(true)
  })
})
