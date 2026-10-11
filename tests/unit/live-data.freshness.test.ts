// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// An open tab re-judges freshness (atlas decision 0160, "Found during implementation"). A card whose
// export ages past its registry `audit.warn` age while the tab stays open turns `stale` with its
// "as of" time, whether the polls fail or keep returning the same old export, and keeps its values.
//
// The real PollEngine and the real design-system updaters run here, on fake timers: only the
// network (`fetchArtifact`, `fetchAllEndpoints`) and the WebSocket are doubles. A poll that returns
// an unchanged export never reaches an updater (the engine's fingerprint skips it), so these tests
// prove the re-judgement itself, not an update that happens to carry a new freshness.

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

// The Heart Rate updater, spied but real: a test proves a card was NOT written by its call count.
const updaterSpies = vi.hoisted(() => ({updateHeartRate: vi.fn()}))
vi.mock('@j0nathan-ll0yd/web/runtime/updaters', async (importActual) => {
  const actual = await importActual<typeof import('@j0nathan-ll0yd/web/runtime/updaters')>()
  updaterSpies.updateHeartRate.mockImplementation(actual.updateHeartRate)
  return {...actual, updateHeartRate: updaterSpies.updateHeartRate}
})

type Result = {status: 'ok'; data: unknown} | {status: 'failed'; reason: string} | {status: 'suppressed'; reason: string; currentFocus?: string}
const network = vi.hoisted(() => ({
  // What a poll of each resource answers; a resource not named here fails.
  poll: {} as Record<string, Result>,
  boot: {} as Record<string, Result>
}))
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
/** health `audit.warn` is 45 min (EXPORT_FRESHNESS, atlas surfaces.yaml export-health-json). */
const HEALTH_WARN_MS = 45 * MINUTE
const T0 = Date.parse('2026-10-10T07:00:00Z')

const ok = (data: unknown): Result => ({status: 'ok', data})
// A focus export is stamped when its value changes, so each value carries its own generatedAt:
// the poll engine skips an answer whose generatedAt it has already seen.
const FOCUS_STAMPS: Record<string, string> = {Personal: '2026-10-10T06:00:00Z', 'Do Not Disturb': '2026-10-10T06:30:00Z'}
const focus = (currentFocus: string): Result => ok({generatedAt: FOCUS_STAMPS[currentFocus], currentFocus})
/** A health export with a heart rate, generated at `ms`. */
const healthAt = (ms: number) => ({
  date: '2026-10-10',
  generatedAt: new Date(ms).toISOString(),
  quantities: {heartRate: {value: 63, unit: 'count/min'}, heartRateVariabilitySDNN: {value: 45, unit: 'ms'}}
})

const HR_CARD = '<div id="focusOverlay" style="display:none"></div><div id="dndOverlay" style="display:none"></div>' +
  '<div id="cardHR" class="tri-card is-loading" data-ssr-state="loading">' +
  '<div class="widget-header"><h3 class="widget-label">Heart Rate</h3>' +
  '<div class="widget-header-right"><span class="widget-timestamp" data-live-label="live"></span></div></div>' +
  '<div class="widget-body"><div class="skeleton-state"></div><div data-state-scaffold><span id="pulseBpm"></span></div></div></div>'

const SLEEP_CARD = '<div id="cardSleep" class="tri-card is-loading" data-ssr-state="loading">' +
  '<div class="widget-header"><h3 class="widget-label">Night Summary</h3>' +
  '<div class="widget-header-right"><span class="widget-timestamp" data-live-label="live"></span></div></div>' +
  '<div class="widget-body"><div class="skeleton-state"></div><div data-state-scaffold><span id="sleepScoreVal"></span></div></div></div>'

const card = () => document.getElementById('cardHR') as HTMLElement
const bpm = () => document.getElementById('pulseBpm')?.textContent

/** A page lifecycle event (`pagehide`, `pageshow`) for a page entering or leaving the back/forward cache. */
function persistedEvent(type: 'pagehide' | 'pageshow'): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', {value: true})
  return event
}

// Each test imports a fresh live-data module, and the module adds window and document listeners.
// Those are removed after each test, so an earlier test's module cannot react to a later test's
// lifecycle or visibility event and write into its page.
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

describe('live-data → an open tab re-judges freshness', () => {
  const originalLocation = window.location
  const reload = vi.fn()
  // 5 min inside the warning age at T0: live, and turns stale 5 min later.
  const old = healthAt(T0 - HEALTH_WARN_MS + 5 * MINUTE)

  beforeEach(() => {
    wsOpts = null
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    reload.mockClear()
    Object.defineProperty(window, 'location', {configurable: true, value: {...originalLocation, reload}})
    document.body.innerHTML = HR_CARD
    network.boot = {focus: focus('Personal'), health: ok(old)}
    network.poll = {focus: focus('Personal')}
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(window, 'location', {configurable: true, value: originalLocation})
    // Drop the own `hidden` a test defined, so the prototype getter answers again.
    Reflect.deleteProperty(document, 'hidden')
    added.splice(0).forEach(([target, type, listener]) => target.removeEventListener(type, listener))
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('turns a card stale, with its values and "as of" time, when its export ages while polls fail', async () => {
    await boot()
    expect(card().dataset.ssrState).toBe('live')
    expect(bpm()).toBe('63')

    // Every health poll fails from here on. 6 min later the export is 46 min old.
    await vi.advanceTimersByTimeAsync(6 * MINUTE)

    expect(card().dataset.ssrState).toBe('stale')
    expect(card().dataset.generatedAt).toBe(old.generatedAt)
    expect(card().querySelector('.widget-header')?.textContent).toMatch(/as of /)
    // Stale data with an honest "as of" is truthful: a failed poll never blanks the card.
    expect(bpm()).toBe('63')
    expect(card().querySelector('[data-state-notice="unavailable"]')).toBeNull()
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('turns a card stale when polls keep returning the same old export', async () => {
    network.poll.health = ok(old)
    await boot()
    expect(card().dataset.ssrState).toBe('live')

    await vi.advanceTimersByTimeAsync(6 * MINUTE)

    expect(card().dataset.ssrState).toBe('stale')
    expect(card().dataset.generatedAt).toBe(old.generatedAt)
    expect(bpm()).toBe('63')
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('re-judges on a poll outcome when the timer has not fired (a delayed timer)', async () => {
    network.poll.health = ok(old)
    await boot()
    // The wall clock moves past the warning age, as across a sleeping laptop, but no timer runs.
    vi.setSystemTime(T0 + 6 * MINUTE)
    expect(card().dataset.ssrState).toBe('live')

    // The next 30 s fast poll answers the same export; its outcome alone re-judges the card.
    await vi.advanceTimersByTimeAsync(30_000)

    expect(card().dataset.ssrState).toBe('stale')
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('re-judges on its timer when no poll runs (a hidden tab pauses polling)', async () => {
    network.poll.health = ok(old)
    await boot()
    Object.defineProperty(document, 'hidden', {configurable: true, value: true})
    document.dispatchEvent(new Event('visibilitychange'))
    const polls = vi.mocked((await import('../../src/lib/runtime/api')).fetchArtifact).mock.calls.length

    await vi.advanceTimersByTimeAsync(6 * MINUTE)

    // No poll ran, so the timer alone turned the card.
    expect(vi.mocked((await import('../../src/lib/runtime/api')).fetchArtifact).mock.calls.length).toBe(polls)
    expect(card().dataset.ssrState).toBe('stale')
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('brings a stale card back to live when a fresh export arrives, and keeps it live', async () => {
    await boot()
    await vi.advanceTimersByTimeAsync(6 * MINUTE)
    expect(card().dataset.ssrState).toBe('stale')

    const fresh = healthAt(Date.now())
    network.poll.health = ok({...fresh, quantities: {heartRate: {value: 71, unit: 'count/min'}}})
    await vi.advanceTimersByTimeAsync(30_000)

    expect(card().dataset.ssrState).toBe('live')
    expect(card().dataset.generatedAt).toBe(fresh.generatedAt)
    expect(card().querySelector('.widget-header')?.textContent).not.toMatch(/as of /)
    expect(bpm()).toBe('71')

    // The old export's re-judgement must not render it back: 10 min on, the fresh export is live.
    network.poll.health = {status: 'failed', reason: 'unit test'}
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(card().dataset.ssrState).toBe('live')
    expect(bpm()).toBe('71')
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('writes nothing while hiding, and brings no value back after it, as the export ages', async () => {
    await boot()
    expect(card().dataset.ssrState).toBe('live')
    const writes = updaterSpies.updateHeartRate.mock.calls.length

    // A hiding push while the export is still live. The reload that clears the page is stubbed, so
    // this document lives on: it must still write nothing.
    wsOpts?.onFocusChange?.('Do Not Disturb')
    network.poll.focus = focus('Do Not Disturb')
    expect(reload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * MINUTE)
    expect(updaterSpies.updateHeartRate.mock.calls.length).toBe(writes)
    expect(card().dataset.ssrState).toBe('live')

    // Hiding ends, and every gated read fails: the export cached before hiding is never rendered
    // again, so no value it carried comes back to the page.
    network.poll.focus = focus('Personal')
    wsOpts?.onFocusChange?.('Personal')
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(updaterSpies.updateHeartRate.mock.calls.length).toBe(writes)
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('drops the Night Summary score when the health export that lends it turns stale', async () => {
    document.body.insertAdjacentHTML('beforeend', SLEEP_CARD)
    const sleep = {
      date: '2026-10-09',
      generatedAt: new Date(T0).toISOString(),
      core: {seconds: 14400},
      deep: {seconds: 3600},
      rem: {seconds: 5400},
      awake: {seconds: 900}
    }
    network.boot = {...network.boot, health: ok({...old, quantities: {...old.quantities, sleepScore: {value: 83, unit: 'score'}}}), sleep: ok(sleep)}
    await boot()
    const night = document.getElementById('cardSleep') as HTMLElement
    expect(night.dataset.ssrState).toBe('live')
    expect(document.getElementById('sleepScoreVal')?.textContent).toBe('83')

    // Health turns stale 5 min on; the sleep export (12 h warning age) stays live.
    await vi.advanceTimersByTimeAsync(6 * MINUTE)

    expect(card().dataset.ssrState).toBe('stale')
    expect(night.dataset.ssrState).toBe('live')
    expect(document.getElementById('sleepScoreVal')?.textContent).not.toBe('83')
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('writes nothing while the gate denies reads, and brings no value back after it reopens', async () => {
    await boot()
    const writes = updaterSpies.updateHeartRate.mock.calls.length

    // The gate denies the next health read under a still-visible focus signal.
    network.poll.health = {status: 'suppressed', reason: 'focus mode active'}
    await vi.advanceTimersByTimeAsync(30_000)
    expect(reload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * MINUTE)
    expect(updaterSpies.updateHeartRate.mock.calls.length).toBe(writes)

    // The gate reopens, and every gated read fails: nothing cached before the denial comes back.
    network.poll.health = {status: 'failed', reason: 'unit test'}
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(updaterSpies.updateHeartRate.mock.calls.length).toBe(writes)
  })

  // covers: dashboard-shell#An open tab re-judges freshness as an export ages
  it('re-judges a page restored from the back/forward cache only after its focus read', async () => {
    await boot()
    const writes = updaterSpies.updateHeartRate.mock.calls.length
    window.dispatchEvent(persistedEvent('pagehide'))

    // The page was frozen past the warning age, and a hiding mode began meanwhile.
    vi.setSystemTime(T0 + 6 * MINUTE)
    network.poll.focus = focus('Do Not Disturb')
    window.dispatchEvent(persistedEvent('pageshow'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(updaterSpies.updateHeartRate.mock.calls.length).toBe(writes)
    expect(card().dataset.ssrState).toBe('live')
  })

  it('turns a restored page stale once its focus read is visible (control)', async () => {
    await boot()
    window.dispatchEvent(persistedEvent('pagehide'))
    vi.setSystemTime(T0 + 6 * MINUTE)
    window.dispatchEvent(persistedEvent('pageshow'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(card().dataset.ssrState).toBe('stale')
    expect(bpm()).toBe('63')
  })
})
