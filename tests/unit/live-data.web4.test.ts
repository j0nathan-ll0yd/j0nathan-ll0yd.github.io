// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// The client runtime's @j0nathan-ll0yd/web 4 obligations (atlas decision 0160, PR 0a):
//
//   - A card or System Status row a server rendered `suppressed` refuses every data update until
//     the focus gate releases it (`releaseSuppression`). Leaving a hiding mode must release each
//     one BEFORE the refetch that refills it, and must release nothing while hiding continues.
//   - NightSummary follows the sleep export; the health export lends only its sleep score
//     (`sleepScoreSource`), so a new health export refreshes the score.
//
// A separate file from live-data.app-update.test.ts on purpose: that file's covers annotations are
// cited line-exact from openspec/specs/client-privacy, and new mocks at its top would move them.

interface CapturedWsOpts {
  onStateChange?: (connected: boolean) => void
  onFocusChange?: (currentFocus: string) => void
}
let wsOpts: CapturedWsOpts | null = null

const updaterSpies = vi.hoisted(() => ({updateNightSummary: vi.fn()}))
vi.mock('@j0nathan-ll0yd/web/runtime/updaters',
  async (importActual) => ({
    ...await importActual<typeof import('@j0nathan-ll0yd/web/runtime/updaters')>(),
    updateNightSummary: updaterSpies.updateNightSummary
  }))

vi.mock('../../src/lib/runtime/ws-client', () => ({
  WSClient: class {
    constructor(opts: CapturedWsOpts) {
      wsOpts = opts
    }
    connect(): void {}
    disconnect(): void {}
  }
}))

// Records the DOM state each card and row had at the moment the engine was asked to refetch.
const stateAtPollNow = vi.hoisted(() => ({value: null as null | Record<string, string | undefined>}))
const engineCapture = vi.hoisted(() => ({onUpdate: null as null | ((key: string, data: unknown) => void)}))

vi.mock('../../src/lib/runtime/poll-engine', () => ({
  PollEngine: class {
    constructor(opts: {onUpdate: (key: string, data: unknown) => void}) {
      engineCapture.onUpdate = opts.onUpdate
    }
    seed(): void {}
    setFocusReadable(): void {}
    start(): void {}
    setMode(): void {}
    setSuppressed(): void {}
    forgetFingerprints(): void {}
    pollResource(): Promise<void> {
      return Promise.resolve()
    }
    pollNow(): Promise<void> {
      stateAtPollNow.value = Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('[data-ssr-state], .sys-line')].map((el) => [el.id || el.dataset.source || '?', el.dataset.ssrState])
      )
      return Promise.resolve()
    }
  }
}))

const failed = {status: 'failed', reason: 'unit test'}
// The focus result the startup read (`fetchAllEndpoints`) reports; a test may set a decoded value.
const bootFocus = vi.hoisted(() => ({value: null as unknown}))
vi.mock('../../src/lib/runtime/api',
  async (importActual) => ({
    ...await importActual<typeof import('../../src/lib/runtime/api')>(),
    fetchArtifact: vi.fn(() => Promise.resolve(failed)),
    fetchAllEndpoints: vi.fn(() =>
      Promise.resolve({
        health: failed,
        sleep: failed,
        workouts: failed,
        books: failed,
        githubEvents: failed,
        starredRepos: failed,
        articles: failed,
        focus: bootFocus.value ?? failed,
        theatreReviews: failed,
        timestamps: {}
      })
    )
  }))

async function bootLiveData(): Promise<void> {
  await import('../../src/lib/runtime/live-data')
  await vi.runAllTimersAsync()
}

const SUPPRESSED_PAGE = '<div id="focusOverlay" style="display:none"></div><div id="dndOverlay" style="display:none"></div>' +
  '<div id="cardHR" data-ssr-state="suppressed"></div>' +
  '<div id="cardWorkouts" data-ssr-state="suppressed"></div>' +
  '<div id="cardBooks" data-ssr-state="suppressed"></div>' +
  '<div id="cardReading" data-ssr-state="loading"></div>' +
  '<div id="systemStatus">' +
  '<div class="sys-line" data-source="health" data-ssr-state="suppressed"><div class="sys-dot"></div><span class="sys-key">Health:</span><span class="sys-val">—</span></div>' +
  '<div class="sys-line" data-source="books" data-ssr-state="suppressed"><div class="sys-dot"></div><span class="sys-key">Books:</span><span class="sys-val">—</span></div>' +
  '</div>'

describe('live-data → the focus gate releases suppressed cards and System Status rows', () => {
  beforeEach(() => {
    wsOpts = null
    stateAtPollNow.value = null
    bootFocus.value = null
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = SUPPRESSED_PAGE
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // covers: client-privacy#Leaving a hiding mode releases every suppressed card and System Status row
  it('releases every suppressed card and row before the refetch when hiding ends', async () => {
    await bootLiveData()
    wsOpts?.onFocusChange?.('Do Not Disturb')
    expect(document.getElementById('cardHR')?.dataset.ssrState).toBe('suppressed')

    wsOpts?.onFocusChange?.('Personal')

    // Released to `unavailable` (no data yet), so the refetch's updaters may write again.
    expect(stateAtPollNow.value).toMatchObject({
      cardHR: 'unavailable',
      cardWorkouts: 'unavailable',
      cardBooks: 'unavailable',
      health: 'unavailable',
      books: 'unavailable'
    })
    // A card that was never suppressed keeps its own state.
    expect(stateAtPollNow.value?.cardReading).toBe('loading')
  })

  it('releases nothing while a hiding mode continues', async () => {
    await bootLiveData()
    wsOpts?.onFocusChange?.('Work')
    wsOpts?.onFocusChange?.('Do Not Disturb')

    expect(document.getElementById('cardHR')?.dataset.ssrState).toBe('suppressed')
    expect(document.querySelector<HTMLElement>('.sys-line[data-source="health"]')?.dataset.ssrState).toBe('suppressed')
    expect(stateAtPollNow.value).toBeNull()
  })

  it('releases a server-suppressed page at startup when the first focus read is visible', async () => {
    // A page rendered during hiding and opened after it ended: this tab never saw a hiding value.
    bootFocus.value = {status: 'ok', data: {generatedAt: '2026-10-10T07:00:00Z', currentFocus: 'Personal'}}
    await bootLiveData()

    expect(document.getElementById('cardHR')?.dataset.ssrState).toBe('unavailable')
    expect(document.getElementById('cardBooks')?.dataset.ssrState).toBe('unavailable')
    // Released, then filled by the startup System Status write, which drops the attribute.
    const row = document.querySelector<HTMLElement>('.sys-line[data-source="health"]')
    expect(row?.dataset.ssrState).toBeUndefined()
    expect(row?.textContent).toContain('OFFLINE')
    expect(document.getElementById('cardReading')?.dataset.ssrState).toBe('loading')
  })

  it.each([
    ['unreadable', null],
    ['hiding', {status: 'ok', data: {generatedAt: '2026-10-10T07:00:00Z', currentFocus: 'Do Not Disturb'}}]
  ])('keeps a server-suppressed page suppressed at startup when the first focus read is %s', async (_label, focus) => {
    bootFocus.value = focus
    await bootLiveData()

    expect(document.getElementById('cardHR')?.dataset.ssrState).toBe('suppressed')
    expect(document.querySelector<HTMLElement>('.sys-line[data-source="health"]')?.dataset.ssrState).toBe('suppressed')
  })

  it('lets a released System Status row take live status again', async () => {
    const {updateSystemStatus} = await import('@j0nathan-ll0yd/web/runtime/updaters')
    await bootLiveData()
    wsOpts?.onFocusChange?.('Do Not Disturb')
    wsOpts?.onFocusChange?.('Personal')

    updateSystemStatus({health: new Date().toISOString()})

    const row = document.querySelector<HTMLElement>('.sys-line[data-source="health"]')
    expect(row?.dataset.ssrState).toBeUndefined()
    expect(row?.textContent).toContain('ACTIVE')
  })
})

describe('live-data → NightSummary takes its score from a live health export only', () => {
  const sleep = {
    date: '2026-10-09',
    generatedAt: '2026-10-10T07:00:00Z',
    core: {seconds: 14400},
    deep: {seconds: 3600},
    rem: {seconds: 5400},
    awake: {seconds: 900}
  }
  const health = {date: '2026-10-09', generatedAt: '2026-10-10T07:05:00Z', quantities: {sleepScore: {value: 83, unit: 'score'}}}

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    updaterSpies.updateNightSummary.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the score as missing before any health export is read', async () => {
    await bootLiveData()
    engineCapture.onUpdate?.('sleep', sleep)

    expect(updaterSpies.updateNightSummary).toHaveBeenCalledTimes(1)
    expect(updaterSpies.updateNightSummary.mock.calls[0]?.[0]).toMatchObject({sleepScore: null, sleepDurationFormatted: '6h 30m'})
  })

  it('refreshes the score from a health export that arrives after the sleep export', async () => {
    await bootLiveData()
    engineCapture.onUpdate?.('sleep', sleep)
    engineCapture.onUpdate?.('health', health)

    expect(updaterSpies.updateNightSummary).toHaveBeenCalledTimes(2)
    expect(updaterSpies.updateNightSummary.mock.calls[1]?.[0]).toMatchObject({sleepScore: 83, sleepDurationFormatted: '6h 30m'})
  })
})
