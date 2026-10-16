// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {initHydration} from '@j0nathan-ll0yd/web/runtime/hydration-init'

// Server hand-off (atlas decision 0160, PR B). The server renders every live card from the same
// exports the browser fetches. Each card root carries `data-ssr-state` and, in live and stale only,
// `data-generated-at`. The runtime must treat that output as the page's current generation:
// only a strictly newer export repaints a card, and an unchanged page sees no value mutation.
//
// The real PollEngine and the real design-system updaters run on fake timers. Only the network
// (`fetchArtifact`, `fetchAllEndpoints`) and the WebSocket are doubles.

interface CapturedWsOpts {
  onFocusChange?: (currentFocus: string) => void
}
let wsOpts: CapturedWsOpts | null = null

vi.mock('../../src/lib/runtime/ws-client', () => ({
  WSClient: class {
    constructor(opts: CapturedWsOpts) {
      wsOpts = opts
    }
    connect(): void {}
    disconnect(): void {}
  }
}))

// Real updaters, spied: a call count proves whether a card was written.
const spies = vi.hoisted(() => ({
  updateHeartRate: vi.fn(),
  updateHydration: vi.fn(),
  updateNightSummary: vi.fn(),
  updateWorkouts: vi.fn(),
  updateHeartRateFooter: vi.fn()
}))
vi.mock('@j0nathan-ll0yd/web/runtime/updaters', async (importActual) => {
  const actual = await importActual<typeof import('@j0nathan-ll0yd/web/runtime/updaters')>()
  spies.updateHeartRate.mockImplementation(actual.updateHeartRate)
  spies.updateHydration.mockImplementation(actual.updateHydration)
  spies.updateNightSummary.mockImplementation(actual.updateNightSummary)
  spies.updateWorkouts.mockImplementation(actual.updateWorkouts)
  return {
    ...actual,
    updateHeartRate: spies.updateHeartRate,
    updateHydration: spies.updateHydration,
    updateNightSummary: spies.updateNightSummary,
    updateWorkouts: spies.updateWorkouts
  }
})
vi.mock('@j0nathan-ll0yd/web/runtime/updaters-movement', async (importActual) => {
  const actual = await importActual<typeof import('@j0nathan-ll0yd/web/runtime/updaters-movement')>()
  spies.updateHeartRateFooter.mockImplementation(actual.updateHeartRateFooter)
  return {...actual, updateHeartRateFooter: spies.updateHeartRateFooter}
})

type Result = {status: 'ok'; data: unknown} | {status: 'failed'; reason: string} | {status: 'suppressed'; reason: string; currentFocus?: string}
const network = vi.hoisted(() => ({poll: {} as Record<string, Result>, boot: {} as Record<string, Result>}))
vi.mock('../../src/lib/runtime/api',
  async (importActual) => ({
    ...await importActual<typeof import('../../src/lib/runtime/api')>(),
    fetchArtifact: vi.fn((key: string) => Promise.resolve(network.poll[key] ?? {status: 'failed', reason: 'unit test'})),
    fetchAllEndpoints: vi.fn(() => {
      const keys = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'focus', 'theatreReviews']
      const results = Object.fromEntries(keys.map((key) => [key, network.boot[key] ?? {status: 'failed', reason: 'unit test'}]))
      const timestamps = Object.fromEntries(
        Object.entries(results).map(([key, r]) => [key, r.status === 'ok' ? (r.data as {generatedAt: string}).generatedAt : null])
      )
      return Promise.resolve({...results, timestamps})
    })
  }))

const MINUTE = 60_000
const T0 = Date.parse('2026-10-10T07:00:00Z')
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()
// Server generations: health 5 min old (live, warn age 45 min), sleep 1 h old (live, warn age 12 h).
const HEALTH_GEN = at(-5 * MINUTE)
const SLEEP_GEN = at(-60 * MINUTE)
const WORKOUTS_GEN = at(-60 * MINUTE)

const ok = (data: unknown): Result => ({status: 'ok', data})
const focus = (currentFocus: string): Result => ok({generatedAt: '2026-10-10T06:00:00Z', currentFocus})
const healthExport = (generatedAt: string, restingHeartRate = 55) => ({
  date: '2026-10-10',
  generatedAt,
  quantities: {
    heartRate: {value: 63, unit: 'count/min'},
    restingHeartRate: {value: restingHeartRate, unit: 'count/min'},
    sleepScore: {value: 83, unit: 'score'}
  }
})
const sleepExport = (generatedAt: string, coreSeconds = 14400) => ({
  date: '2026-10-09',
  generatedAt,
  core: {seconds: coreSeconds},
  deep: {seconds: 3600},
  rem: {seconds: 5400},
  awake: {seconds: 900}
})
const workoutsExport = (generatedAt: string) => ({date: '2026-10-10', generatedAt, workouts: []})

/** The server-rendered markup, the way the design-system widgets render a live or stale card. */
function serverPage(opts: {health?: string; healthState?: string; sleep?: string; workouts?: string} = {}): string {
  const healthState = opts.healthState ?? 'live'
  const healthAttrs = opts.health ? ` data-ssr-state="${healthState}" data-generated-at="${opts.health}"` : ' data-ssr-state="unavailable"'
  const sleepAttrs = opts.sleep ? ` data-ssr-state="live" data-generated-at="${opts.sleep}"` : ' data-ssr-state="unavailable"'
  const workoutsAttrs = opts.workouts ? ` data-ssr-state="live" data-generated-at="${opts.workouts}"` : ' data-ssr-state="unavailable"'
  return '<div id="focusOverlay" style="display:none"></div><div id="dndOverlay" style="display:none"></div>' +
    `<div id="cardHR" class="tri-card"${healthAttrs}><div class="widget-header"><div class="widget-header-right"><span class="widget-timestamp" data-live-label="live">live</span></div></div>` +
    '<div class="widget-body"><div data-state-scaffold><span id="pulseBpm">SSR-BPM</span><span id="hrFooterRhr">SSR-RHR</span></div></div></div>' +
    `<div id="cardMovement" class="tri-card"${healthAttrs}><div class="widget-body"><div data-state-scaffold>SSR-RINGS</div></div></div>` +
    `<div id="cardHydration" class="tri-card"${healthAttrs}><div class="widget-body"><div data-state-scaffold><span id="hydraWaterVal">SSR-WATER</span><span id="hydraCoffeeVal">SSR-COFFEE</span></div></div></div>` +
    `<div id="cardSleep" class="tri-card"${sleepAttrs}><div class="widget-header"><div class="widget-header-right"><span class="widget-timestamp" data-live-label="live">live</span></div></div>` +
    '<div class="widget-body"><div data-state-scaffold><span id="sleepScoreVal">SSR-SCORE</span><span id="sleepDuration">SSR-DURATION</span></div></div></div>' +
    `<div id="cardWorkouts" class="tri-card"${workoutsAttrs}><div class="widget-body"><span id="ssrWorkout">SSR-WORKOUT</span></div></div>` +
    '<div id="systemStatus"><div class="sys-line" data-source="health"><div class="sys-dot"></div><span class="sys-key">Health:</span><span class="sys-val">SSR-AGE</span></div></div>'
}

const text = (id: string) => document.getElementById(id)?.textContent
const root = (id: string) => document.getElementById(id) as HTMLElement

// Each test imports a fresh live-data module, and the module adds window and document listeners.
// Remove them after each test, so an earlier module cannot react to a later test's events.
const added: [EventTarget, string, EventListenerOrEventListenerObject][] = []
for (const target of [window, document]) {
  const add = target.addEventListener.bind(target)
  target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
    if (listener) {
      added.push([target, type, listener])
    }
    add(type, listener, options)
  }
}

/** Load the runtime and let its first read land (startFetch runs on a 200 ms timer in jsdom). */
async function boot(): Promise<void> {
  await import('../../src/lib/runtime/live-data')
  await vi.advanceTimersByTimeAsync(1000)
}

const originalLocation = window.location
const reload = vi.fn()

beforeEach(() => {
  wsOpts = null
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  Object.values(spies).forEach((spy) => spy.mockClear())
  reload.mockClear()
  window.sessionStorage.clear()
  Object.defineProperty(window, 'location', {configurable: true, value: {...originalLocation, reload}})
  network.boot = {focus: focus('Personal')}
  network.poll = {focus: focus('Personal')}
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'location', {configurable: true, value: originalLocation})
  added.splice(0).forEach(([target, type, listener]) => target.removeEventListener(type, listener))
  document.body.innerHTML = ''
  document.body.removeAttribute('data-live-ready')
})

describe('live-data hand-off → startup compares generations as instants', () => {
  // The same instant in a different notation must read as equal, never as newer.
  const sameInstantOtherNotation = '2026-10-10T07:55:00.000+01:00'

  const cases = [
    {
      resource: 'health',
      server: HEALTH_GEN,
      page: (gen: string) => serverPage({health: gen}),
      exp: healthExport,
      marker: () => text('pulseBpm') !== 'SSR-BPM'
    },
    {
      resource: 'sleep',
      server: SLEEP_GEN,
      page: (gen: string) => serverPage({sleep: gen}),
      exp: (gen: string) => sleepExport(gen),
      marker: () => text('sleepDuration') !== 'SSR-DURATION'
    },
    {
      resource: 'workouts',
      server: WORKOUTS_GEN,
      page: (gen: string) => serverPage({workouts: gen}),
      exp: workoutsExport,
      marker: () => document.getElementById('ssrWorkout') === null
    }
  ]

  for (const c of cases) {
    it(`${c.resource}: an older export does not repaint`, async () => {
      document.body.innerHTML = c.page(c.server)
      network.boot[c.resource] = ok(c.exp(new Date(Date.parse(c.server) - MINUTE).toISOString()))
      await boot()
      expect(c.marker()).toBe(false)
    })

    it(`${c.resource}: an equal export does not repaint`, async () => {
      document.body.innerHTML = c.page(c.server)
      network.boot[c.resource] = ok(c.exp(c.server))
      await boot()
      expect(c.marker()).toBe(false)
    })

    it(`${c.resource}: a newer export repaints`, async () => {
      document.body.innerHTML = c.page(c.server)
      network.boot[c.resource] = ok(c.exp(new Date(Date.parse(c.server) + MINUTE).toISOString()))
      await boot()
      expect(c.marker()).toBe(true)
    })
  }

  it('reads an equal instant in another notation as equal', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    expect(Date.parse(sameInstantOtherNotation)).toBe(Date.parse(HEALTH_GEN))
    network.boot.health = ok(healthExport(sameInstantOtherNotation))
    await boot()
    expect(spies.updateHeartRate).not.toHaveBeenCalled()
    expect(text('pulseBpm')).toBe('SSR-BPM')
  })

  it('applies whatever arrives when the card carries no valid server generation', async () => {
    document.body.innerHTML = serverPage()
    network.boot.health = ok(healthExport(HEALTH_GEN))
    await boot()
    expect(spies.updateHeartRate).toHaveBeenCalledOnce()
    expect(text('pulseBpm')).not.toBe('SSR-BPM')
  })

  it('takes the newest valid generation among the three health cards', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    root('cardHR').dataset.generatedAt = 'not a date'
    root('cardMovement').dataset.generatedAt = at(-30 * MINUTE)
    // cardHydration keeps HEALTH_GEN (the newest). An export at the newest generation is equal.
    network.boot.health = ok(healthExport(HEALTH_GEN))
    await boot()
    expect(spies.updateHeartRate).not.toHaveBeenCalled()
  })

  it('stores a non-repainting export for cross-resource use and still records its timestamp', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN, sleep: SLEEP_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    network.boot.sleep = ok(sleepExport(SLEEP_GEN))
    await boot()
    expect(spies.updateHeartRate).not.toHaveBeenCalled()
    expect(spies.updateNightSummary).not.toHaveBeenCalled()
    // The stored pair drives the next single-resource update (see the shared-dependency test).
    network.poll.sleep = ok(sleepExport(at(-30 * MINUTE)))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spies.updateNightSummary.mock.calls[0]?.[0]).toMatchObject({sleepScore: 83})
  })
})

describe('live-data hand-off → polls never overwrite newer output', () => {
  beforeEach(() => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN, sleep: SLEEP_GEN, workouts: WORKOUTS_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    network.boot.sleep = ok(sleepExport(SLEEP_GEN))
    network.boot.workouts = ok(workoutsExport(WORKOUTS_GEN))
  })

  it('drops an older poll from a lagging edge, then applies a newer one', async () => {
    await boot()
    network.poll.health = ok(healthExport(at(-20 * MINUTE), 70))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spies.updateHeartRate).not.toHaveBeenCalled()
    expect(text('pulseBpm')).toBe('SSR-BPM')

    network.poll.health = ok(healthExport(at(-1 * MINUTE), 71))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spies.updateHeartRate).toHaveBeenCalledOnce()
    expect(text('hrFooterRhr')).toContain('71')
  })

  it('does not let an older poll replace a newer applied export', async () => {
    await boot()
    network.poll.health = ok(healthExport(at(-1 * MINUTE), 71))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(text('hrFooterRhr')).toContain('71')
    spies.updateHeartRate.mockClear()

    network.poll.health = ok(healthExport(at(-3 * MINUTE), 60))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spies.updateHeartRate).not.toHaveBeenCalled()
    expect(text('hrFooterRhr')).toContain('71')
  })

  it('applies the same rule to an older workouts poll', async () => {
    await boot()
    network.poll.workouts = ok(workoutsExport(at(-90 * MINUTE)))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(spies.updateWorkouts).not.toHaveBeenCalled()
    expect(document.getElementById('ssrWorkout')).not.toBeNull()
  })

  it('applies focus always', async () => {
    await boot()
    network.poll.focus = ok({generatedAt: '2026-10-10T05:00:00Z', currentFocus: 'Work'})
    await vi.advanceTimersByTimeAsync(30_000)
    expect(document.getElementById('focusOverlay')?.style.display).not.toBe('none')
  })
})

describe('live-data hand-off → shared dependencies', () => {
  it('repaints NightSummary and the HeartRate footer from the newest health and sleep pair after a sleep-only update', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN, sleep: SLEEP_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN, 55))
    network.boot.sleep = ok(sleepExport(SLEEP_GEN))
    await boot()
    expect(text('hrFooterRhr')).toBe('SSR-RHR')
    expect(text('sleepScoreVal')).toBe('SSR-SCORE')

    network.poll.sleep = ok(sleepExport(at(-10 * MINUTE), 18000))
    await vi.advanceTimersByTimeAsync(30_000)

    // Sleep is new; health is the stored server-generation export. Both cards read the pair.
    expect(spies.updateNightSummary).toHaveBeenCalledOnce()
    expect(spies.updateNightSummary.mock.calls[0]?.[0]).toMatchObject({sleepScore: 83, sleepDurationFormatted: '7h 30m'})
    expect(text('sleepScoreVal')).toContain('83')
    expect(spies.updateHeartRateFooter).toHaveBeenCalledOnce()
    expect(text('hrFooterRhr')).toContain('55')
  })

  it('repaints the score when only health is newer', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN, sleep: SLEEP_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    network.boot.sleep = ok(sleepExport(SLEEP_GEN))
    await boot()

    network.poll.health = ok(healthExport(at(-1 * MINUTE)))
    await vi.advanceTimersByTimeAsync(30_000)

    expect(spies.updateNightSummary).toHaveBeenCalledOnce()
    expect(text('sleepScoreVal')).toContain('83')
  })
})

describe('live-data hand-off → Hydration keeps the server value', () => {
  const hydrationProps = {health: {hydration: {waterOz: 40, waterMax: 100, caffeineMg: 80, caffeineMax: 400, waterRangeLo: 50, waterRangeHi: 80}}}

  it('runs no count-up over a live server render', () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    const raf = vi.spyOn(window, 'requestAnimationFrame')

    initHydration(root('cardHydration'), hydrationProps as unknown as Parameters<typeof initHydration>[1])

    expect(raf).not.toHaveBeenCalled()
    expect(text('hydraWaterVal')).toBe('SSR-WATER')
    expect(root('hydraWaterVal').dataset.liveUpdated).toBe('1')
    raf.mockRestore()
  })

  it('writes no Hydration value at startup when the export equals the server generation', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    await boot()
    expect(spies.updateHydration).not.toHaveBeenCalled()
    expect(text('hydraWaterVal')).toBe('SSR-WATER')
  })

  it('does not add a skeleton to a server-rendered live card', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    await boot()
    expect(root('cardHydration').classList.contains('is-loading')).toBe(false)
  })
})

describe('live-data hand-off → unchanged data causes no value mutation', () => {
  /** Mutations split into value mutations (data-bearing nodes) and label-only refreshes (System Status ages). */
  async function observe(run: () => Promise<void>): Promise<{value: string[]; label: string[]}> {
    const observer = new MutationObserver(() => {})
    observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true})
    await run()
    const records = observer.takeRecords()
    observer.disconnect()
    const value: string[] = []
    const label: string[] = []
    for (const r of records) {
      const target = r.target instanceof Element ? r.target : r.target.parentElement
      const entry = `${r.type}:${target?.id || target?.className || target?.nodeName}`
      ;(target?.closest('#systemStatus') ? label : value).push(entry)
    }
    return {value, label}
  }

  it('counts zero value mutations over startup and several poll cycles', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN, sleep: SLEEP_GEN, workouts: WORKOUTS_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    network.boot.sleep = ok(sleepExport(SLEEP_GEN))
    network.boot.workouts = ok(workoutsExport(WORKOUTS_GEN))
    network.poll.health = ok(healthExport(HEALTH_GEN))
    network.poll.sleep = ok(sleepExport(SLEEP_GEN))
    network.poll.workouts = ok(workoutsExport(WORKOUTS_GEN))

    const {value, label} = await observe(async () => {
      await boot()
      await vi.advanceTimersByTimeAsync(5 * MINUTE)
    })

    // Label-only refreshes (relative ages in System Status) are reported on their own and may happen.
    expect(label.every((entry) => entry.length > 0)).toBe(true)
    expect(value).toEqual([])
    expect(Object.values(spies).every((spy) => spy.mock.calls.length === 0)).toBe(true)
  })

  it('does not repaint a server-rendered stale card whose judgement is still stale', async () => {
    const staleGen = at(-2 * 60 * MINUTE)
    document.body.innerHTML = serverPage({health: staleGen, healthState: 'stale'})
    network.boot.health = ok(healthExport(staleGen))
    network.poll.health = ok(healthExport(staleGen))

    await boot()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)

    expect(spies.updateHeartRate).not.toHaveBeenCalled()
    expect(root('cardHR').dataset.ssrState).toBe('stale')
  })

  it('still repaints when the judgement truly changes (live to stale at the warn age)', async () => {
    const gen = at(-40 * MINUTE)
    document.body.innerHTML = serverPage({health: gen})
    network.boot.health = ok(healthExport(gen))
    network.poll.health = ok(healthExport(gen))

    await boot()
    expect(spies.updateHeartRate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6 * MINUTE)

    expect(root('cardHR').dataset.ssrState).toBe('stale')
    expect(spies.updateHeartRate).toHaveBeenCalled()
  })
})

describe('live-data hand-off → data-live-ready', () => {
  const ready = () => document.body.getAttribute('data-live-ready')

  it('is unset until the first read finishes, then set after success', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    network.boot.health = ok(healthExport(HEALTH_GEN))
    await import('../../src/lib/runtime/live-data')
    expect(ready()).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ready()).toBe('1')
  })

  it('is set after a failed first read', async () => {
    document.body.innerHTML = serverPage()
    network.boot = {}
    network.poll = {}
    await boot()
    expect(ready()).toBe('1')
  })

  it('is set when the page starts suppressed', async () => {
    document.body.innerHTML =
      '<div id="focusOverlay" style="display:none"></div><div id="dndOverlay" style="display:none"></div><div id="cardHR" data-ssr-state="suppressed"></div>'
    network.poll.focus = focus('Do Not Disturb')
    network.boot = {focus: focus('Do Not Disturb')}
    await boot()
    expect(ready()).toBe('1')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('live-data hand-off → privacy reload', () => {
  const RELOAD_KEY = 'privacyReloadAtMs'

  it('reloads at startup when focus is hiding and the server rendered gated values', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    network.poll.focus = focus('Do Not Disturb')
    await boot()
    expect(reload).toHaveBeenCalledOnce()
    expect(Number(window.sessionStorage.getItem(RELOAD_KEY))).toBeGreaterThanOrEqual(T0)
  })

  it('treats server-rendered stale values as gated values too', async () => {
    document.body.innerHTML = serverPage({health: at(-2 * 60 * MINUTE), healthState: 'stale'})
    network.poll.focus = focus('Do Not Disturb')
    await boot()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('holds a blocked reload until the end of the 15 s window, then runs it once', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    window.sessionStorage.setItem(RELOAD_KEY, String(T0 - 5000))
    network.poll.focus = focus('Do Not Disturb')

    await boot()
    expect(reload).not.toHaveBeenCalled()

    // 1 s of boot is spent; the window ends 15 s after the stored reload, 10 s after T0.
    await vi.advanceTimersByTimeAsync(8_000)
    expect(reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('queues one reload however many suppressions arrive while one is held', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    window.sessionStorage.setItem(RELOAD_KEY, String(T0 - 1000))
    network.poll.focus = focus('Do Not Disturb')
    await boot()
    wsOpts?.onFocusChange?.('Work')
    wsOpts?.onFocusChange?.('Do Not Disturb')

    await vi.advanceTimersByTimeAsync(20_000)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads at once when the last reload is older than the window', async () => {
    document.body.innerHTML = serverPage({health: HEALTH_GEN})
    window.sessionStorage.setItem(RELOAD_KEY, String(T0 - 16_000))
    network.poll.focus = focus('Do Not Disturb')
    await boot()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload a page the server rendered without gated values', async () => {
    document.body.innerHTML = '<div id="focusOverlay" style="display:none"></div><div id="dndOverlay" style="display:none"></div>' +
      '<div id="cardHR" data-ssr-state="unavailable"></div><div id="cardSleep" data-ssr-state="loading"></div>'
    network.poll.focus = focus('Do Not Disturb')
    await boot()
    expect(reload).not.toHaveBeenCalled()
  })
})
