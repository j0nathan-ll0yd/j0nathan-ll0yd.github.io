// The composed dashboard artifact (atlas decision 0160, PR B; owner decision 2026-10-16, option 1:
// the PRECOMPOSED PAGE). A backend composer renders the live cards from the exports with the design
// system's own components and stores the result beside the exports, behind the same CloudFront gate.
// The Worker never renders: it checks the artifact and splices its fragments into the prerendered
// data-free page (./shell.ts).
//
// The artifact is JSON, not a whole page: the page around the cards (the head, the hashed /_astro
// asset names, the client runtime) belongs to the website build, and only the website knows it. So a
// website deploy never invalidates an artifact, and an artifact never names a website asset.
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {WIDGET_STATES, type WidgetState} from '@j0nathan-ll0yd/web/runtime/widget-state'
import type {GatedKey} from '../data-plane/loader'
import type {LiveCardId, SsrRenderRecord, SsrSummary} from '../data-plane/render-model'

/** The artifact's path on the data plane, beside the exports. Gated (SUPPRESSIBLE_PATHS in LP). */
export const COMPOSED_ARTIFACT_PATH = '/dashboard.json'

/** The artifact format this Worker reads. A different version is never served. */
export const COMPOSED_SCHEMA_VERSION = 1

/** The composer's backstop schedule: the runner composes at least this often (owner decision 2026-10-16). */
export const COMPOSER_BACKSTOP_MS = 5 * 60 * 1000
/** The runner's Lambda timeout: a composition publishes at most this long after its stamp. */
export const COMPOSER_RUN_TIMEOUT_MS = 60 * 1000
/** CloudFront's TTL for the artifact (LP `EXPORT_CACHE`, s-maxage=30). */
export const COMPOSED_EDGE_TTL_MS = 30 * 1000

/**
 * The oldest artifact the Worker serves: 690,000 ms (11.5 minutes). The runner composes on every
 * export update and on a 5-minute backstop. The bound tolerates one missed backstop run (2 x 5 min),
 * plus the run timeout (a stamp precedes its publish by up to 60 s), plus the CloudFront TTL (30 s).
 * An older artifact means the runner stopped: its card states may no longer be true, and the Worker
 * serves the data-free page instead. With the runner healthy, a label trails the truth by at most
 * 5 minutes plus 1.5 minutes of publish and TTL.
 */
export const COMPOSED_MAX_AGE_MS = 2 * COMPOSER_BACKSTOP_MS + COMPOSER_RUN_TIMEOUT_MS + COMPOSED_EDGE_TTL_MS
/** A composition stamp this far ahead of the Worker's clock is malformed, not skewed. */
export const COMPOSED_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

/** The elements of the data-free page an artifact replaces, by id: each is its component's root element. */
export const COMPOSED_FRAGMENT_IDS = Object.freeze([
  'focusOverlay',
  'dndOverlay',
  'cardSystem',
  'cardHR',
  'cardMovement',
  'cardHydration',
  'cardSleep',
  'cardWorkouts',
  'cardDevLog',
  'cardReading',
  'cardStarredRepos',
  'cardBooks',
  'cardTheatreReviews'
] as const)

export type ComposedFragmentId = (typeof COMPOSED_FRAGMENT_IDS)[number]

export interface ComposedArtifact {
  schemaVersion: typeof COMPOSED_SCHEMA_VERSION
  composedAt: string
  /** The build whose composer made it. The Worker serves only an artifact of its own build. */
  composer: {build: string}
  /** The focus value the composer read. Only a visible value is ever composed. */
  currentFocus: string
  summary: SsrSummary
  record: SsrRenderRecord
  fragments: Record<ComposedFragmentId, string>
}

/**
 * The value-free pages (./paths.ts VALUE_FREE_PATH) hold no export value and depend only on the
 * build, so they are a static asset of the website, read by the Worker through the ASSETS binding. A
 * public request for the path gets the 404 page.
 */
export { VALUE_FREE_PATH } from './paths'
/** The variant for the gate shut over a visible focus value: every card suppressed, no overlay. */
export const GATE_VARIANT = 'gate'
/** The variant for an unreadable focus signal: every card unavailable, no overlay. */
export const UNREADABLE_VARIANT = 'unreadable'

export interface ValueFreePage {
  summary: 'suppressed' | 'unavailable'
  fragments: Record<ComposedFragmentId, string>
}

export interface ValueFreeSet {
  /** The build that composed the set; it must be the Worker's own. */
  build: string
  /** Keyed by hiding focus value, GATE_VARIANT or UNREADABLE_VARIANT. */
  variants: Record<string, ValueFreePage>
}

/** The value-free set, when this website built it; otherwise null (the Worker then serves the data-free page). */
export function checkValueFree(text: string, build: string, required: readonly string[]): ValueFreeSet | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.build !== build || !isRecord(value.variants)) {
    return null
  }
  const variants: Record<string, ValueFreePage> = {}
  for (const key of required) {
    const page = value.variants[key]
    if (!isRecord(page) || (page.summary !== 'suppressed' && page.summary !== 'unavailable') || !isRecord(page.fragments)) {
      return null
    }
    const fragments = checkFragments(page.fragments)
    if (fragments === null) {
      return null
    }
    variants[key] = {summary: page.summary, fragments}
  }
  return {build, variants}
}

/**
 * True when `fragment` opens with the element it replaces (the first tag carries `id`) and closes
 * that tag's kind. The composer's parity oracle proves the stronger property, the root and at most
 * its hidden data carrier (tests/oracle/composer-parity.test.ts); this is the Worker's cheap guard.
 */
export function opensWithRoot(fragment: string, id: string): boolean {
  const open = /^<([a-z][a-z0-9-]*)\b[^>]*>/i.exec(fragment)
  return open !== null && open[0].includes(` id="${id}"`) && fragment.endsWith(`</${open[1]}>`)
}

/**
 * The render record, rebuilt from closed sets, or null. It goes into the Worker's log line, which
 * carries no data value, so nothing the composer adds beyond these fields reaches the log.
 */
function checkRecord(value: Record<string, unknown>): SsrRenderRecord | null {
  const {summary, focus, domains, cards, degraded, io_ms: ioMs} = value
  if (
    typeof summary !== 'string' || !SUMMARIES.has(summary) || typeof focus !== 'string' || !FOCUS_STATES.has(focus) || !isRecord(domains) ||
    !isRecord(cards) || !Array.isArray(degraded) || typeof ioMs !== 'number' || !Number.isFinite(ioMs)
  ) {
    return null
  }
  const checkedDomains: Record<string, string> = {}
  for (const key of GATED_EXPORTS) {
    const outcome = domains[key]
    if (typeof outcome !== 'string' || !DOMAIN_OUTCOME.test(outcome)) {
      return null
    }
    checkedDomains[key] = outcome
  }
  const checkedCards: Record<string, WidgetState> = {}
  for (const id of COMPOSED_FRAGMENT_IDS.filter((fragmentId) => fragmentId.startsWith('card') && fragmentId !== 'cardSystem')) {
    const state = cards[id]
    if (typeof state !== 'string' || !WIDGET_STATE_SET.has(state)) {
      return null
    }
    // Checked against the closed set of widget states above.
    checkedCards[id] = state as WidgetState
  }
  if (!degraded.every((key) => typeof key === 'string' && GATED_EXPORTS.includes(key))) {
    return null
  }
  return {
    // Each checked against its closed set above.
    summary: summary as SsrSummary,
    focus: focus as SsrRenderRecord['focus'],
    domains: checkedDomains as Record<GatedKey, string>,
    cards: checkedCards as Record<LiveCardId, WidgetState>,
    degraded: degraded as GatedKey[],
    io_ms: ioMs
  }
}

/** Markup a fragment never carries: the page loads its own scripts and styles. */
const FOREIGN_MARKUP = /<(?:script|style|link|meta|base)\b/i

/** Every fragment id, each opening with its own root element, with no script, style or link; otherwise null. */
function checkFragments(value: Record<string, unknown>): Record<ComposedFragmentId, string> | null {
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const fragment = value[id]
    if (typeof fragment !== 'string' || !opensWithRoot(fragment, id) || FOREIGN_MARKUP.test(fragment)) {
      return null
    }
    fragments[id] = fragment
  }
  // Every id was checked in the loop above.
  return fragments as Record<ComposedFragmentId, string>
}

/** Why an artifact is not served. Value-free: safe for the log line. */
export type ArtifactRefusal = 'not-json' | 'schema' | 'stale' | 'future' | 'build' | 'hiding' | 'fragments'

const SUMMARIES = new Set(['live', 'stale', 'partial', 'unavailable', 'suppressed'])
const FOCUS_STATES = new Set(['visible', 'hiding', 'unreadable'])
const WIDGET_STATE_SET: ReadonlySet<string> = new Set(WIDGET_STATES)
/** The eight gated exports: every endpoint but the focus signal. */
const GATED_EXPORTS: readonly string[] = Object.keys(ENDPOINTS).filter((key) => key !== 'focus')
/** An export's read outcome, as the composer writes it: a closed word or `unavailable:<reason>`. */
const DOMAIN_OUTCOME = /^(?:ok|suppressed|unavailable:[a-z0-9-]+)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The artifact, when the Worker of build `build` may serve it at `nowMs`; otherwise the
 * reason it may not. Every field the Worker uses is checked; each fragment must be the element it
 * replaces, with no script, style or link (`checkFragments`).
 */
export function checkArtifact(
  text: string,
  nowMs: number,
  build: string,
  hidingModes: ReadonlySet<string>
): {ok: true; artifact: ComposedArtifact} | {ok: false; refusal: ArtifactRefusal} {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {ok: false, refusal: 'not-json'}
  }
  if (
    !isRecord(value) || value.schemaVersion !== COMPOSED_SCHEMA_VERSION || typeof value.composedAt !== 'string' ||
    typeof value.currentFocus !== 'string' || typeof value.summary !== 'string' || !SUMMARIES.has(value.summary) ||
    !isRecord(value.record) || !isRecord(value.composer) || typeof value.composer.build !== 'string' || !isRecord(value.fragments)
  ) {
    return {ok: false, refusal: 'schema'}
  }
  const composedMs = Date.parse(value.composedAt)
  if (!Number.isFinite(composedMs)) {
    return {ok: false, refusal: 'schema'}
  }
  if (composedMs - nowMs > COMPOSED_MAX_FUTURE_SKEW_MS) {
    return {ok: false, refusal: 'future'}
  }
  if (nowMs - composedMs > COMPOSED_MAX_AGE_MS) {
    return {ok: false, refusal: 'stale'}
  }
  // Lockstep: a site deploy changes the build, so an artifact the old composer made (even one
  // composed during the deploy, privacy race (b)) is never spliced into the new page.
  // `unknown` is the id of a build without one; two of them never prove the same build (review L9).
  if (value.composer.build !== build || build === 'unknown') {
    return {ok: false, refusal: 'build'}
  }
  if (hidingModes.has(value.currentFocus) || value.summary === 'suppressed') {
    return {ok: false, refusal: 'hiding'}
  }
  const fragments = checkFragments(value.fragments)
  if (fragments === null) {
    return {ok: false, refusal: 'fragments'}
  }
  const record = checkRecord(value.record)
  if (record === null) {
    return {ok: false, refusal: 'schema'}
  }
  return {
    ok: true,
    artifact: {
      schemaVersion: COMPOSED_SCHEMA_VERSION,
      composedAt: value.composedAt,
      composer: {build: value.composer.build},
      currentFocus: value.currentFocus,
      // Checked against the closed set above.
      summary: value.summary as SsrSummary,
      record,
      fragments
    }
  }
}
