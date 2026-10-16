// From one dashboard load to the props the page renders (atlas decision 0160, plan Steps 4.2 and
// 4.6, owner decision D11 = M1): the design system's shared view models, one summary for the
// `X-SSR-Data` header and the `ssr-data` meta, and the value-free render record the Worker logs.
//
// Freshness (D8) is the design system's rule (`@j0nathan-ll0yd/web/runtime/freshness`): `live` up to
// the registry `audit.warn` age, `stale` beyond it with an absolute "as of" time. Its one table
// restates `atlas/surfaces.yaml`, and atlas check A25 compares the two.
import {composeSystemLines, type DashboardExports, type DashboardViewModels, toDashboardViewModels} from '@j0nathan-ll0yd/web/runtime/view-models'
import {isFreshnessDegraded} from '@j0nathan-ll0yd/web/runtime/freshness'
import type {WidgetState} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {type DashboardLoad, type DomainOutcome, GATED_KEYS, type GatedKey} from './loader'

/** The live cards, by element id, and the view model each one renders. */
export const LIVE_CARD_MODELS = Object.freeze(
  {
    cardHR: 'heartRate',
    cardMovement: 'movementRings',
    cardHydration: 'hydration',
    cardSleep: 'nightSummary',
    cardWorkouts: 'workouts',
    cardDevLog: 'devActivityLog',
    cardReading: 'readingFeed',
    cardStarredRepos: 'starredRepoList',
    cardBooks: 'bookshelf',
    cardTheatreReviews: 'theatreReviews'
  } as const satisfies Record<string, keyof DashboardViewModels>
)

export type LiveCardId = keyof typeof LIVE_CARD_MODELS

/**
 * The page summary, in the `X-SSR-Data` header and the `ssr-data` meta. First match wins:
 * `suppressed` (any suppression signal), `unavailable` (every live card unavailable), `live` (every
 * card live or empty), `stale` (every card live, empty or stale, at least one stale), else `partial`.
 * The Worker adds two values of its own: `fallback` (the data-free page, served when a render missed
 * its budget) and `error` (the 500 page).
 */
export type SsrSummary = 'live' | 'stale' | 'partial' | 'unavailable' | 'suppressed'

export interface DashboardRender {
  vm: DashboardViewModels
  /** Each live card's final state, as its `data-ssr-state` renders it. */
  cards: Record<LiveCardId, WidgetState>
  summary: SsrSummary
  /** The value-free fields of the `ssr_render` log line that the loader and the mapping decide. */
  record: SsrRenderRecord
}

/** The value-free part of the `ssr_render` log line. No field carries a data value. */
export interface SsrRenderRecord {
  summary: SsrSummary
  focus: 'visible' | 'hiding' | 'unreadable'
  /** Each export's read outcome: `ok`, `suppressed`, or `unavailable:<reason>`. */
  domains: Record<GatedKey, string>
  cards: Record<LiveCardId, WidgetState>
  /** Exports older than their registry `audit.error` age (or with no provable age). */
  degraded: GatedKey[]
  io_ms: number
}

function domainInput<K extends GatedKey>(outcome: DomainOutcome<K>): {data: Extract<DomainOutcome<K>, {kind: 'ok'}>['data'] | null; state?: WidgetState} {
  if (outcome.kind === 'ok') {
    // No explicit state: the view model applies the shared freshness rule at `now`.
    return {data: outcome.data}
  }
  return {data: null, state: outcome.kind === 'suppressed' ? 'suppressed' : 'unavailable'}
}

/** The summary of the ten live cards' states (see SsrSummary). */
export function summarize(cards: readonly WidgetState[], suppressed: boolean): SsrSummary {
  if (suppressed || cards.includes('suppressed')) {
    return 'suppressed'
  }
  if (cards.every((state) => state === 'unavailable')) {
    return 'unavailable'
  }
  if (cards.every((state) => state === 'live' || state === 'empty')) {
    return 'live'
  }
  if (cards.every((state) => state === 'live' || state === 'empty' || state === 'stale')) {
    return 'stale'
  }
  return 'partial'
}

function outcomeLabel(outcome: DomainOutcome): string {
  return outcome.kind === 'unavailable' ? `unavailable:${outcome.reason}` : outcome.kind
}

/** Maps one load to the page's props at `now`. Pure: no I/O, no clock read. */
export function toDashboardRender(load: DashboardLoad, now: number): DashboardRender {
  const exports: DashboardExports = {
    // An unreadable focus signal passes no focus export: the overlays stay hidden and every gated
    // domain arrives `unavailable` from the loader.
    // The view models read only `currentFocus` from the focus export. A hiding signal whose body
    // failed its contract still names its mode, so it carries no `generatedAt` of its own here.
    ...(load.focus.state === 'unreadable' ? {} : {focus: {data: {generatedAt: '', currentFocus: load.focus.currentFocus}}}),
    health: domainInput(load.domains.health),
    sleep: domainInput(load.domains.sleep),
    workouts: domainInput(load.domains.workouts),
    books: domainInput(load.domains.books),
    githubEvents: domainInput(load.domains.githubEvents),
    starredRepos: domainInput(load.domains.starredRepos),
    articles: domainInput(load.domains.articles),
    theatreReviews: domainInput(load.domains.theatreReviews)
  }
  let vm = toDashboardViewModels(exports, now)
  if (load.suppressed && !vm.suppressed) {
    // The gate shut over a visible signal (a suppression body under a visible focus value). Every
    // card is already `suppressed`; System Status must name no source age either.
    vm = {...vm, suppressed: true, systemStatus: {system: {lines: composeSystemLines({}, now, {suppressed: true})}}}
  }

  const cards = Object.fromEntries(
    Object.entries(LIVE_CARD_MODELS).map(([id, model]) => [id, (vm[model] as {state?: WidgetState}).state ?? 'unavailable'])
  ) as Record<LiveCardId, WidgetState>
  const summary = summarize(Object.values(cards), load.suppressed)

  const degraded = GATED_KEYS.filter((key) => {
    const outcome = load.domains[key]
    return outcome.kind === 'ok' && isFreshnessDegraded(key, outcome.data.generatedAt, now)
  })

  return {
    vm,
    cards,
    summary,
    record: {
      summary,
      focus: load.focus.state,
      domains: Object.fromEntries(GATED_KEYS.map((key) => [key, outcomeLabel(load.domains[key])])) as Record<GatedKey, string>,
      cards,
      degraded,
      io_ms: load.ioMs
    }
  }
}
