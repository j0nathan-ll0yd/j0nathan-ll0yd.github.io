import {fetchAllEndpoints, fetchArtifact, isResourceKey} from './api'
import type {EndpointResult, EndpointSuppressed} from './api'
import {updateFocusOverlay} from '@j0nathan-ll0yd/web/runtime/updaters-focus'
import {updateTheatreReviews} from '@j0nathan-ll0yd/web/runtime/updaters-theatre'
import {updatePollStatus} from './updaters-status'
import {updateHeartRateFooter, updateMovementRings} from '@j0nathan-ll0yd/web/runtime/updaters-movement'
// Only the two exports this module holds across resources still need naming here. The other seven
// arrive already typed through `ArtifactValues[K]`, so listing them again would be a second copy of
// the contract's own key-to-type mapping.
import type {HealthExport, SleepExport} from '@j0nathan-ll0yd/portal-contract/schemas'
import type {ArtifactValues} from '@j0nathan-ll0yd/portal-contract/decoders'
import {HIDING_FOCUS_MODES, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {adaptArticles, adaptBooks, adaptGithubEvents, adaptHealth, adaptSleep, adaptStarredRepos, adaptWorkouts} from '@j0nathan-ll0yd/web/runtime/adapters'
import {EXPORT_FRESHNESS, exportDomainState, exportFreshness} from '@j0nathan-ll0yd/web/runtime/freshness'
import type {Freshness} from '@j0nathan-ll0yd/web/runtime/freshness'
import {releaseSuppression, renderWidgetUnavailable} from '@j0nathan-ll0yd/web/runtime/updater-empty'
import {sleepScoreSource} from '@j0nathan-ll0yd/web/runtime/widget-rules'
import {WSClient} from './ws-client'
import {
  updateBookshelf,
  updateDevActivityLog,
  updateHeartRate,
  updateHydration,
  updateNightSummary,
  updateReadingFeed,
  updateStarredRepos,
  updateSystemStatus,
  updateWorkouts
} from '@j0nathan-ll0yd/web/runtime/updaters'
import {PollEngine} from './poll-engine'
import type {ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'

const LIVE_CARDS = [
  'cardHR',
  'cardMovement',
  'cardSleep',
  'cardHydration',
  'cardWorkouts',
  'cardBooks',
  'cardDevLog',
  'cardReading',
  'cardStarredRepos',
  'cardTheatreReviews'
]

// ── Module-scoped state for cross-resource dependencies ──────────────
// The last export applied for each gated resource. Health and Sleep read each other's export, and
// the freshness re-judgement (`rejudgeFreshness`) re-renders a card from its cached export when the
// export ages past its warning age.
type GatedKey = Exclude<ResourceKey, 'focus'>
let lastExports: { [K in GatedKey]?: ArtifactValues[K] } = {}
const timestamps: Record<string, string | null> = {}
let engine: PollEngine | null = null
// ws is hoisted to module scope so pagehide/pageshow lifecycle handlers can
// reach it. It is null until startFetch() completes (null-guard before use).
let ws: WSClient | null = null

// ── Focus-mode suppression (companion to the backend CloudFront edge gate) ──
// While focus is a hiding mode the gate denies every suppressible artifact (403). The
// client mirrors that: overlay immediately, pause suppressible polling, and clear the skeletons
// over the value-free cards instead of leaving them behind permanent loading overlays.
// HIDING_FOCUS_MODES is the cross-platform single source of truth (@j0nathan-ll0yd/portal-contract),
// shared with the backend gate + the DS overlay so the three layers can never drift. The edge
// gate is the real privacy boundary. This layer must still never SHOW what the gate now denies:
// it withholds gated values while suppressed and clears the ones it already applied.
const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)

// The WS push is the authoritative focus source. A focus poll (the fallback for when the WS is
// down) refetches the ~30s edge-cached focus.json, which lags a just-changed state. For a short
// window after each push we ignore focus polls (they're reading the lagging cached value); after
// the window the poll is trusted again, so a genuinely-dropped push self-heals (bounded lag)
// rather than leaving the overlay permanently stuck on a stale value.
const STALE_FOCUS_POLL_WINDOW_MS = 45_000
let wsConnected = false
let lastFocusPushAtMs = 0

// ── Clearing gated values on suppression (atlas decision 0160, PR 0b) ──
// The overlay only COVERS the cards; the values stay in the DOM, in canvas buffers, in the book
// modal, in the system-status timestamps, and in this module's own `lastExports`. A
// hiding mode must remove them, not hide them. A reload is the one mechanism that clears every one
// of those places at once: the page is static, so the reloaded document holds no gated value, and
// its startup reads focus first and applies nothing while hiding. Restoring each card's captured
// markup was rejected: it leaves the canvas loop, the modal and the module state holding data, and
// it detaches the nodes the design-system runtimes hold references to.
//
// Loop guard: the reload fires only when gated data reached the DOM since this document loaded.
// A reloaded page during hiding never applies gated data, so it can never reload again; the next
// reload needs a visible period in which data was applied, followed by a new hiding transition.
let gatedDataApplied = false
// One poll burst can deliver several suppressions (up to one per gated resource). The first one
// reloads; the rest must not queue more reloads behind it.
let reloading = false

// The page's suppression state, in ONE value. `focus`: a hiding focus value; it lifts
// the moment focus reads visible. `gate`: a gate denial under a visible signal; it lifts only after
// GATE_RECHECK_INTERVAL_MS from `sinceMs`, because a focus answer that races a fresh 403 in the
// same poll would otherwise lift and re-suppress in a loop, each round refetching every resource.
// 25 s sits below the 30 s fast poll interval, so each fast tick can re-ask the gate once.
type Suppression = {kind: 'none'} | {kind: 'focus'} | {kind: 'gate'; sinceMs: number}
let suppression: Suppression = {kind: 'none'}
const GATE_RECHECK_INTERVAL_MS = 25_000

// One-shot re-check of a gate denial. Without it, recovery waits for a focus poll that
// lands at least 25 s after the last 403 -- up to about 165 s with the 120 s passive interval. The
// timer asks the gate itself, on one gated path, as soon as the interval allows.
const GATE_PROBE_KEY: ResourceKey = 'health'
let gateRecheckTimer: ReturnType<typeof setTimeout> | null = null
let recheckOnReturn = false
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && recheckOnReturn) {
    recheckOnReturn = false
    void recheckGate()
  }
})

function isSuppressed(): boolean {
  return suppression.kind !== 'none'
}

function reloadForPrivacy(): void {
  if (reloading) {
    return
  }
  reloading = true
  window.location.reload()
}

/** Removes every gated value this document holds, if it holds any. */
function clearGatedData(): void {
  if (gatedDataApplied) {
    reloadForPrivacy()
  }
}

function isHiding(currentFocus: string | null): boolean {
  return currentFocus !== null && HIDING_FOCUS_MODE_SET.has(currentFocus)
}

/**
 * Single entry point for a focus-state change (WebSocket push, focus poll, or startup).
 * Drives the overlay from the value directly — no refetch of the edge-cached focus signal —
 * and transitions client-side suppression on the visible↔hiding boundary.
 */
function applyFocus(currentFocus: string | null): void {
  // The overlay reflects the exact value every time (Work and Do Not Disturb are distinct
  // overlays), so this runs even when the hiding class is unchanged.
  updateFocusOverlay(currentFocus ? {generatedAt: new Date().toISOString(), currentFocus} : null)

  if (isHiding(currentFocus)) {
    const entering = suppression.kind === 'none'
    // A gate suppression that the hiding signal now explains becomes a focus suppression, so the
    // gate re-check interval no longer delays the restore when focus turns visible.
    suppression = {kind: 'focus'}
    cancelGateRecheck()
    if (entering) {
      enterSuppression()
    }
    return
  }
  if (suppression.kind === 'none') {
    return
  }
  if (suppression.kind === 'gate' && Date.now() - suppression.sinceMs < GATE_RECHECK_INTERVAL_MS) {
    return
  }
  liftSuppression()
}

function enterSuppression(): void {
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
  engine?.setSuppressed(true)
  // The freshness re-judgement re-renders cards from these caches. Drop them, so no timer tick can
  // bring a value back after this transition: only a read made after suppression lifts fills a
  // card again.
  forgetGatedExports()
  cancelRejudge()
  // Covering is not clearing: remove the values themselves (see clearGatedData).
  clearGatedData()
}

/**
 * The focus gate's own word that the page is visible. A card or System Status row a server
 * rendered `suppressed` refuses every data update until it is released (`@j0nathan-ll0yd/web` 4).
 * Two moments carry that word: leaving a hiding mode this tab observed (`liftSuppression`, before
 * its refetch), and a startup whose focus read decoded visible with no gated path suppressed
 * (`startFetch`, before its first writes), which covers a page rendered during hiding and opened
 * after it ended. The data-free page renders none suppressed today; a server-rendered page (atlas
 * decision 0160, PR B) does.
 */
function releaseSuppressedCards(): void {
  LIVE_CARDS.forEach((id) => releaseSuppression(document.getElementById(id)))
  document.querySelectorAll('#systemStatus .sys-line').forEach((row) => releaseSuppression(row))
}

function liftSuppression(): void {
  suppression = {kind: 'none'}
  releaseSuppressedCards()
  cancelGateRecheck()
  engine?.setSuppressed(false)
  // Leaving suppression: the DOM holds no gated value (it was cleared, or none was ever applied),
  // so EVERY gated resource must be applied again, even one whose `generatedAt` the engine already
  // fingerprinted. Forgetting the fingerprints first is what makes pollNow restore them.
  engine?.forgetFingerprints()
  void engine?.pollNow()
}

function cancelGateRecheck(): void {
  recheckOnReturn = false
  if (gateRecheckTimer !== null) {
    clearTimeout(gateRecheckTimer)
    gateRecheckTimer = null
  }
}

function armGateRecheck(): void {
  cancelGateRecheck()
  gateRecheckTimer = setTimeout(() => {
    gateRecheckTimer = null
    void recheckGate()
  }, GATE_RECHECK_INTERVAL_MS)
}

/**
 * Asks the gate on one path. A 200 lifts gate suppression; a suppression body re-arms it. A hidden
 * tab asks nothing: the poll engine pauses on `visibilitychange`, and this probe follows it, so a
 * gate that stays shut costs a hidden tab no request every 25 s. The re-check runs on return.
 */
async function recheckGate(): Promise<void> {
  if (suppression.kind !== 'gate') {
    return
  }
  if (document.hidden) {
    recheckOnReturn = true
    return
  }
  const result = await fetchArtifact(GATE_PROBE_KEY, {query: '?_poll=1'})
  // The state may have moved while the probe was in flight: a hiding signal must not be lifted.
  if (suppression.kind !== 'gate') {
    return
  }
  if (result.status === 'ok') {
    liftSuppression()
  } else if (result.status === 'suppressed') {
    applySuppression(result)
  }
  // A failed probe proves nothing; the next focus poll after the interval still lifts it.
}

function endpointData<T>(result: EndpointResult<T>): T | null {
  return result.status === 'ok' ? result.data : null
}

function applySuppression(result: EndpointSuppressed): void {
  if (result.currentFocus) {
    applyFocus(result.currentFocus)
    return
  }
  // The gate denied a gated read while the focus signal still reads visible: the backend closes the
  // gate before it publishes a hiding signal, and a failed publication leaves it so. The gate wins.
  // Recovery: a one-shot timer re-asks the gate after GATE_RECHECK_INTERVAL_MS, and the engine
  // keeps dispatching focus answers while suppressed, so the first visible one after the interval
  // also lifts it. A gate still shut answers 403 again. That retry never reloads, because a
  // suppressed document applies no gated data.
  if (suppression.kind === 'focus') {
    return
  }
  const entering = suppression.kind === 'none'
  suppression = {kind: 'gate', sinceMs: Date.now()}
  armGateRecheck()
  if (entering) {
    enterSuppression()
  }
}

// ── Per-resource incremental update dispatch ─────────────────────────
//
// One entry per resource key, each receiving exactly that key's decoded export type. This
// replaced a hand-kept `ResourceTypeMap` (a duplicate of the contract's `ArtifactValues`), a
// `RESOURCE_DISCRIMINANTS` table, and a `validateResource` structural check. That layer was a
// second, weaker browser schema -- it tested `typeof generatedAt === 'string'` plus the presence
// of one field name -- and `fetchArtifact` now decodes against the real published contract before
// anything reaches here, so nothing that layer could reject can still arrive.
//
// The record shape is also what removes the nine `as ResourceTypeMap[...]` casts the old `switch`
// needed. Indexing it with the generic key yields `(data: ArtifactValues[K]) => void`, which
// accepts exactly the value that came back under that same key, so key and value stay correlated
// across the decoded boundary and the consumer asserts nothing. A resource added to ENDPOINTS
// without an entry here is still a compile error.
const RESOURCE_UPDATERS: { [K in ResourceKey]: (data: ArtifactValues[K]) => void } = {
  health: (data) => {
    lastExports.health = data
    renderCard('health')
    // The health export lends NightSummary its sleep score: a new one refreshes the score.
    renderCard('nightSummary')
  },
  sleep: (data) => {
    lastExports.sleep = data
    renderCard('nightSummary')
    // adaptHealth reads the sleep export too.
    renderCard('health')
  },
  workouts: (data) => {
    lastExports.workouts = data
    renderCard('workouts')
  },
  books: (data) => {
    lastExports.books = data
    renderCard('books')
  },
  githubEvents: (data) => {
    lastExports.githubEvents = data
    renderCard('githubEvents')
  },
  articles: (data) => {
    lastExports.articles = data
    renderCard('articles')
  },
  focus: (data) => {
    // Route through applyFocus so a focus change detected by polling (e.g. the WS is down)
    // also transitions client-side suppression, not just the overlay. But within the
    // edge-cache propagation window after a WS push, the poll is reading a lagging cached
    // focus.json — ignore it so a stale value can't re-apply over the fresh push (the
    // restore-linger bug). After the window the poll is trusted again, so a dropped push
    // self-heals (bounded lag) instead of leaving the overlay permanently stuck.
    if (wsConnected && lastFocusPushAtMs > 0 && Date.now() - lastFocusPushAtMs < STALE_FOCUS_POLL_WINDOW_MS) {
      return
    }
    applyFocus(data.currentFocus)
  },
  theatreReviews: (data) => {
    lastExports.theatreReviews = data
    renderCard('theatreReviews')
  },
  starredRepos: (data) => {
    lastExports.starredRepos = data
    renderCard('starredRepos')
  }
}

/**
 * The four health cards from one health export. Its freshness (`live` up to the registry
 * `audit.warn` age, `stale` beyond it, `@j0nathan-ll0yd/web` 4.1 `exportFreshness`) is computed once,
 * so the four cards can never disagree about it.
 */
function applyHealth(health: HealthExport, sleep: SleepExport | null, now: number): void {
  const freshness = exportFreshness('health', health, now)
  const adapted = adaptHealth(health, sleep)
  updateHeartRate(adapted, freshness)
  updateHeartRateFooter(adapted, freshness)
  updateMovementRings(adapted, freshness)
  updateHydration(adapted, freshness)
}

/**
 * NightSummary follows the sleep export alone (owner decision Q3): its state and "as of" time are
 * the sleep export's. The health export lends only its sleep score, and only while it is `live`
 * (`sleepScoreSource`); a stale or missing health export renders the score as the no-reading mark.
 */
function applyNightSummary(sleep: SleepExport, health: HealthExport | null, now: number): void {
  const healthState = exportDomainState('health', health, now).state
  updateNightSummary(adaptSleep(sleep, sleepScoreSource(health, healthState)), exportFreshness('sleep', sleep, now))
}

// ── Freshness re-judgement for an open tab (atlas decision 0160) ──────
//
// An update renders an export with its freshness at that moment. An export that stops changing,
// or polls that keep failing, would otherwise leave a card `live` for as long as the tab stays
// open. So each card's freshness is judged again on a timer and after every poll outcome, from the
// export the card shows. When the judgement differs from the one the card was rendered with, the
// card is rendered again through its updater with the new freshness: the values stay, and the
// state and "as of" time become true. A failed poll never blanks a card; only the first read
// renders `unavailable`.
//
// The updaters are the only way to write a card's state: `@j0nathan-ll0yd/web` 4.1 keeps the state
// writers internal, and some cards add header markup of their own for `stale` (Theatre's "as of"
// slot), so writing the state attributes by hand would diverge from the server's markup.

/** One unit of rendering: the export(s) a group of cards reads, and how to render it. */
interface CardRender {
  /** The freshness judgement the card is rendered with at `now`, or null with no export to show. */
  judge(now: number): string | null
  render(now: number): void
}

function exportCard<K extends Exclude<GatedKey, 'health' | 'sleep'>>(key: K, update: (data: ArtifactValues[K], freshness: Freshness) => void): CardRender {
  return {
    judge: (now) => {
      const data = lastExports[key]
      return data ? exportFreshness(key, data, now).state : null
    },
    render: (now) => {
      const data = lastExports[key]
      if (data) {
        update(data, exportFreshness(key, data, now))
      }
    }
  }
}

const CARD_RENDERS = {
  health: {
    judge: (now: number) => lastExports.health ? exportFreshness('health', lastExports.health, now).state : null,
    render: (now: number) => {
      if (lastExports.health) {
        applyHealth(lastExports.health, lastExports.sleep ?? null, now)
      }
    }
  },
  // Night Summary turns on two judgements: its own sleep export's, and whether the health export
  // that lends its score is still live.
  nightSummary: {
    judge: (now: number) =>
      lastExports.sleep
        ? `${exportFreshness('sleep', lastExports.sleep, now).state}/${exportDomainState('health', lastExports.health ?? null, now).state}`
        : null,
    render: (now: number) => {
      if (lastExports.sleep) {
        applyNightSummary(lastExports.sleep, lastExports.health ?? null, now)
      }
    }
  },
  workouts: exportCard('workouts', (data, freshness) => updateWorkouts(adaptWorkouts(data), freshness)),
  books: exportCard('books', (data, freshness) => updateBookshelf(adaptBooks(data), freshness)),
  githubEvents: exportCard('githubEvents', (data, freshness) => updateDevActivityLog(adaptGithubEvents(data), freshness)),
  articles: exportCard('articles', (data, freshness) => updateReadingFeed(adaptArticles(data), freshness)),
  starredRepos: exportCard('starredRepos', (data, freshness) => updateStarredRepos(adaptStarredRepos(data), freshness)),
  theatreReviews: exportCard('theatreReviews', (data, freshness) => updateTheatreReviews(data, freshness))
} satisfies Record<string, CardRender>

type CardKey = keyof typeof CARD_RENDERS
// Object.keys widens to string[]; CARD_RENDERS is a literal object, so its keys are exactly CardKey.
const CARD_KEYS = Object.keys(CARD_RENDERS) as CardKey[]

/** The judgement each card was last rendered with. */
const renderedJudgement = new Map<CardKey, string>()

/** Render one card from its cached export, with its freshness now. No export: nothing to render. */
function renderCard(key: CardKey, now: number = Date.now()): void {
  const judgement = CARD_RENDERS[key].judge(now)
  if (judgement === null) {
    return
  }
  // Recorded before rendering, so an updater that throws is not retried on every tick.
  renderedJudgement.set(key, judgement)
  CARD_RENDERS[key].render(now)
}

/** Drops every cached gated export, its System Status timestamp, and every judgement made from one. */
function forgetGatedExports(): void {
  lastExports = {}
  renderedJudgement.clear()
  for (const key of Object.keys(timestamps)) {
    if (key !== 'focus') {
      delete timestamps[key]
    }
  }
}

/** setTimeout holds a signed 32-bit delay; a longer one fires at once. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1
let rejudgeTimer: ReturnType<typeof setTimeout> | null = null
// Set while a page restored from the back/forward cache has not yet read focus. A hiding mode may
// have begun while the page was frozen, so nothing is re-judged until the restore's focus-first
// poll answers, exactly as the startup read writes nothing before its focus read.
let awaitingFocusAfterRestore = false

function cancelRejudge(): void {
  if (rejudgeTimer !== null) {
    clearTimeout(rejudgeTimer)
    rejudgeTimer = null
  }
}

/**
 * The first instant after `now` at which a cached export now `live` turns `stale`: one
 * millisecond past its `audit.warn` age. Null when no cached export is live.
 */
function nextFreshnessChange(now: number): number | null {
  let next: number | null = null
  // Object.keys widens to string[]; lastExports holds only GatedKey keys by its type.
  for (const key of Object.keys(lastExports) as GatedKey[]) {
    const data = lastExports[key]
    if (!data || exportFreshness(key, data, now).state !== 'live') {
      continue
    }
    const at = Date.parse(data.generatedAt) + EXPORT_FRESHNESS[key].warnMs + 1
    next = next === null ? at : Math.min(next, at)
  }
  return next
}

/**
 * Judges every card's freshness again, now, and re-renders each card whose judgement changed;
 * then arms one timer for the next change. A poll outcome calls it too, so a tab whose timers a
 * browser delayed (a hidden tab, a sleeping laptop) catches up on its next poll.
 * A suppressed page writes nothing and arms nothing: no gated value reaches the DOM while
 * suppressed, and the poll that follows a lift re-judges again. An unreadable focus value does not
 * stop it: it reads nothing, and re-renders only an export read while focus decoded, so a card
 * still turns `stale` while the focus signal is down.
 */
function rejudgeFreshness(): void {
  cancelRejudge()
  if (isSuppressed() || awaitingFocusAfterRestore) {
    return
  }
  const now = Date.now()
  for (const key of CARD_KEYS) {
    const judgement = CARD_RENDERS[key].judge(now)
    if (judgement === null || judgement === renderedJudgement.get(key)) {
      continue
    }
    try {
      renderCard(key, now)
    } catch (e) {
      // One card's failure must not stop the others. reportError surfaces it as an uncaught error.
      reportError(e)
    }
  }
  // System Status shows each export's age, which moves with the clock too.
  updateSystemStatus(timestamps, now)
  const next = nextFreshnessChange(now)
  if (next !== null) {
    rejudgeTimer = setTimeout(rejudgeFreshness, Math.min(Math.max(next - now, 0), MAX_TIMER_DELAY_MS))
  }
}

/** The live cards each export feeds, for a failed first read (`renderWidgetUnavailable`). */
const CARDS_BY_EXPORT: readonly {key: Exclude<ResourceKey, 'focus'>; cards: readonly string[]}[] = [
  // NightSummary follows the sleep export alone, so a failed health read leaves it to sleep.
  {key: 'health', cards: ['cardHR', 'cardMovement', 'cardHydration']},
  {key: 'sleep', cards: ['cardSleep']},
  {key: 'workouts', cards: ['cardWorkouts']},
  {key: 'books', cards: ['cardBooks']},
  {key: 'githubEvents', cards: ['cardDevLog']},
  {key: 'articles', cards: ['cardReading']},
  {key: 'starredRepos', cards: ['cardStarredRepos']},
  {key: 'theatreReviews', cards: ['cardTheatreReviews']}
]

function handleResourceUpdate<K extends ResourceKey>(key: K, data: ArtifactValues[K]): void {
  // A gated read that was in flight when suppression began can still resolve `ok`. Drop it: no
  // gated value reaches the DOM while suppressed. Focus is the signal itself and always applies.
  if (isSuppressed() && key !== 'focus') {
    return
  }
  timestamps[key] = data.generatedAt
  if (key !== 'focus') {
    gatedDataApplied = true
  }

  // Still required after decoding: this guards adapter and updater throws, which are a different
  // failure from an invalid payload. A payload that fails its contract never reaches this
  // function at all -- it is reported one layer up, through the engine's onError.
  try {
    RESOURCE_UPDATERS[key](data)
    updateSystemStatus(timestamps)
  } catch (e) {
    console.warn(`[live-data] ${key} incremental update failed, preserving stale data:`, e)
  }
}

// ── Skeleton loading ─────────────────────────────────────────────────
LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.add('is-loading'))

// Fallback: remove skeletons after 8s if data never arrives
const fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
}, 8000)

// ── Initial fetch + start continuous polling ─────────────────────────
const startFetch = async () => {
  // Focus overlay (page-level concern). applyFocus drives the overlay immediately and, if
  // focus is already a hiding mode at load, sets suppression intent (engine is still null;
  // it is propagated via engine.setSuppressed(isSuppressed()) below once created).
  const focusResult = await fetchArtifact('focus')
  applyFocus(focusResult.status === 'ok' ? focusResult.data.currentFocus : null)

  const data = await fetchAllEndpoints()

  const initialSuppression = [
    data.health,
    data.sleep,
    data.workouts,
    data.books,
    data.githubEvents,
    data.starredRepos,
    data.articles,
    data.theatreReviews
  ].find((result): result is EndpointSuppressed => result.status === 'suppressed')
  if (initialSuppression) {
    applySuppression(initialSuppression)
  }
  // A decoded visible focus value with no gated path suppressed is the gate's word that the page
  // is visible: release what a server rendered suppressed, before the first writes below.
  if (!isSuppressed() && data.focus.status === 'ok' && !isHiding(data.focus.data.currentFocus)) {
    releaseSuppressedCards()
  }
  // A failed first read: each card that export feeds shows the server's `unavailable` state
  // instead of a `loading` card that will never load. An unreadable focus value fails every gated
  // read (fail-closed), so it lands here too. A suppressed page renders nothing new: the gate wins,
  // and `renderWidgetUnavailable` refuses a suppressed card in any case. A later successful read
  // fills the card through its updater.
  if (!isSuppressed()) {
    for (const {key, cards} of CARDS_BY_EXPORT) {
      if (data[key].status === 'failed') {
        cards.forEach((id) => renderWidgetUnavailable(document.getElementById(id)))
      }
    }
  }

  // Any suppression -- from the focus read above or from ANY gated path -- withholds EVERY gated
  // value. During a gate transition one path can answer 403 while a sibling still answers 200;
  // the gate wins that disagreement for the whole page.
  const gated = <T>(result: EndpointResult<T>): T | null => isSuppressed() ? null : endpointData(result)
  const health = gated(data.health)
  const sleep = gated(data.sleep)
  const workouts = gated(data.workouts)
  const books = gated(data.books)
  const githubEvents = gated(data.githubEvents)
  const starredRepos = gated(data.starredRepos)
  const articles = gated(data.articles)
  const theatreReviews = gated(data.theatreReviews)
  gatedDataApplied = [health, sleep, workouts, books, githubEvents, starredRepos, articles, theatreReviews].some((value) => value !== null)

  // Cache each export: Health and Sleep read each other's, and the freshness re-judgement renders
  // a card again from its cached export.
  lastExports = {
    ...(health && {health}),
    ...(sleep && {sleep}),
    ...(workouts && {workouts}),
    ...(books && {books}),
    ...(githubEvents && {githubEvents}),
    ...(starredRepos && {starredRepos}),
    ...(articles && {articles}),
    ...(theatreReviews && {theatreReviews})
  }
  Object.assign(timestamps, isSuppressed() ? {focus: data.timestamps.focus} : data.timestamps)

  // ── Initial DOM updates: each export with its freshness (`live` or `stale`) ──
  if (health) {
    try {
      renderCard('health')
    } catch (e) {
      console.warn('[live-data] Health update failed:', e)
    }
  }

  // NightSummary renders from the sleep export, also when the health read failed (the score alone
  // then shows the no-reading mark).
  try {
    renderCard('nightSummary')
  } catch (e) {
    console.warn('[live-data] Sleep update failed:', e)
  }

  if (workouts) {
    try {
      renderCard('workouts')
    } catch (e) {
      console.warn('[live-data] Workouts update failed:', e)
    }
  }

  if (books) {
    try {
      renderCard('books')
    } catch (e) {
      console.warn('[live-data] Books update failed:', e)
    }
  }

  if (githubEvents) {
    try {
      renderCard('githubEvents')
    } catch (e) {
      console.warn('[live-data] GitHub events update failed:', e)
    }
  }

  if (articles) {
    try {
      renderCard('articles')
    } catch (e) {
      console.warn('[live-data] Articles update failed:', e)
    }
  }

  if (starredRepos) {
    try {
      renderCard('starredRepos')
    } catch (e) {
      console.warn('[live-data] Starred repos update failed:', e)
    }
  }

  if (theatreReviews) {
    try {
      renderCard('theatreReviews')
    } catch (e) {
      console.warn('[live-data] Theatre reviews update failed:', e)
    }
  }

  updateSystemStatus(timestamps)

  // Clean up every loading overlay, including during suppression: the value-free cards are the
  // honest fallback presentation and must not remain hidden behind permanent skeletons.
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
  }

  // ── Start continuous polling ───────────────────────────────────────
  engine = new PollEngine({
    onUpdate: handleResourceUpdate,
    onSuppressed: applySuppression,
    onError: (key, err) => console.warn(`[poll] ${key} error:`, err.message),
    // Every poll outcome re-judges freshness: a failed poll and an unchanged export both leave the
    // cards as they were, and each emits its status here, where no update reaches the cards.
    onStatusChange: (status) => {
      updatePollStatus(status)
      rejudgeFreshness()
    }
  })
  engine.seed(timestamps)
  // Propagate the load-time suppression intent set by applyFocus() (engine was null then).
  engine.setSuppressed(isSuppressed())
  engine.setFocusReadable(data.focus.status === 'ok')
  engine.start()
  // Arm the first freshness timer here, rather than rely on engine.start emitting a status.
  rejudgeFreshness()

  // Nudge the service worker to check for a new build now. The graceful,
  // state-preserving reload is owned entirely by the web app's sw-register.js
  // (window.__checkForSwUpdate); this runtime never reloads the page itself.
  // No-op if the global is absent (e.g. SW unsupported or registration failed).
  const nudgeServiceWorkerUpdate = (): void => {
    const w = window as Window & {__checkForSwUpdate?: () => void}
    if (typeof w.__checkForSwUpdate === 'function') {
      w.__checkForSwUpdate()
    }
  }

  // ── WebSocket push notifications (additive — polling continues if WS fails) ──
  ws = new WSClient({
    url: WEBSOCKET_URL,
    // `resource` is an untrusted string off the socket. The admission test is own-property only:
    // `resource in ENDPOINTS` was prototype-inclusive, so a frame naming `constructor` or
    // `toString` passed the check and refetched a key that has no endpoint path at all.
    onUpdate: (resource) => {
      if (isResourceKey(resource)) {
        engine!.pollResource(resource).catch(() => {})
      }
    },
    // Focus push carries the new value → drive the overlay + suppression immediately,
    // without waiting on a refetch of the ~30s-edge-cached focus signal.
    onFocusChange: (currentFocus) => {
      lastFocusPushAtMs = Date.now()
      applyFocus(currentFocus)
    },
    // A new web build is live (deploy push): nudge the SW to fetch the new sw.js.
    onAppUpdate: () => nudgeServiceWorkerUpdate(),
    onStateChange: (connected) => {
      wsConnected = connected
      engine!.setMode(connected ? 'passive' : 'active')
      // On (re)connect — e.g. tab refocus after the WS dropped while hidden —
      // also re-check, in case an app-update push was missed while disconnected.
      if (connected) {
        nudgeServiceWorkerUpdate()
      }
    }
  })
  ws.connect()
}

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => void startFetch(), {timeout: 500})
} else {
  setTimeout(() => void startFetch(), 200)
}

// ── BFCache lifecycle handlers ────────────────────────────────────────
// pagehide(persisted=true): browser is freezing the page into BFCache.
// Close the WebSocket and stop polling so the page is BFCache-eligible
// (an open WebSocket is a hard Chromium BFCache blocker).
window.addEventListener('pagehide', (event) => {
  if ((event as PageTransitionEvent).persisted) {
    cancelRejudge()
    if (engine) {
      awaitingFocusAfterRestore = true
      engine.stop()
    }
    if (ws) {
      ws.disconnect()
    }
  }
})

// pageshow(persisted=true): browser is restoring the page from BFCache.
// Restart poll timers + reconnect the WebSocket, then trigger an immediate
// refresh. engine.start() is idempotent (no-op if already running); after a
// pagehide teardown it restarts the interval timers and visibilitychange
// listener. engine.pollNow() fetches fresh data without waiting for the next
// tick. The WS was silently lost on restore before this fix.
window.addEventListener('pageshow', (event) => {
  if ((event as PageTransitionEvent).persisted) {
    if (engine) {
      engine.start()
      // pollNow reads focus first. Re-judge only after it answers (awaitingFocusAfterRestore).
      void engine.pollNow().finally(() => {
        awaitingFocusAfterRestore = false
        rejudgeFreshness()
      })
    }
    if (ws) {
      ws.connect()
    }
  }
})
