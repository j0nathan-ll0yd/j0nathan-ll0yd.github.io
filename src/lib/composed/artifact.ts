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
import {checkFragment, type FragmentOptions, type FragmentRejection} from './fragment-policy'

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
 * The oldest artifact the Worker serves: 690,000 ms (11.5 minutes). The runner composes on a
 * 5-minute backstop and on each export update, except that an update of `githubEvents`,
 * `starredRepos`, `books`, `articles` or `theatreReviews` waits for the backstop (atlas decision
 * 0170). The bound tolerates one missed backstop run (2 x 5 min), plus the run timeout (a stamp precedes its publish by up to 60 s), plus the CloudFront TTL (30 s).
 * An older artifact means the runner stopped: its card states may no longer be true, and the Worker
 * serves the data-free page instead. With the runner healthy, a label trails the truth by at most
 * 5 minutes plus 1.5 minutes of publish and TTL.
 */
export const COMPOSED_MAX_AGE_MS = 2 * COMPOSER_BACKSTOP_MS + COMPOSER_RUN_TIMEOUT_MS + COMPOSED_EDGE_TTL_MS
/** A composition stamp this far ahead of the Worker's clock is malformed, not skewed. */
export const COMPOSED_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

/**
 * The largest artifact the Worker reads: 128 KiB. Measured 2026-10-16: the committed fixture is
 * 53,757 bytes, the largest oracle scenario 79,245 and the live artifact 78,092. The cap bounds the
 * fragment check's CPU on Workers Free: a hostile artifact at the cap costs about 4 ms cold, where
 * 1 MB cost seconds before the check was linear (review 2026-10-16).
 */
export const COMPOSED_MAX_BYTES = 128 * 1024

/** A value-free page names no source age, and shows its hiding value's overlay. */
export const VALUE_FREE_FRAGMENT_OPTIONS: FragmentOptions = Object.freeze({maxGeneratedAtMs: null, overlayMayShow: true})

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
 * What the allowlist read from an artifact's fragments, as plain arrays (atlas decision 0164): the
 * wire form of ArtifactFacts. Every fragment id is a key of `scopes` and of `roots`. The composer
 * publishes it beside the fragments, and the Worker that reads them turns it back into sets
 * (`fromWireFacts`) for the shell check (./shell.ts `fitsShell`).
 */
export interface WireFacts {
  ids: string[]
  scopes: Record<ComposedFragmentId, string[]>
  roots: Record<ComposedFragmentId, {classes: string[]; scopes: string[]}>
}

/**
 * The artifact as the composer returns it: the artifact the Worker checks, plus the facts the
 * composer's own fragment check produced (atlas decision 0164). An added field: `checkArtifact`
 * ignores it, so a Worker that reads `/dashboard.json` serves the body as before.
 */
export type ComposedArtifactBody = ComposedArtifact & {facts: WireFacts}

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

/** A value-free page the Worker checked, with what the allowlist read from its fragments (./fragment-policy.ts). */
export interface CheckedValueFreePage extends ValueFreePage {
  facts: ArtifactFacts
}

/** One variant of a checked set: its fragments are checked on first use (`checkedVariant`). */
export interface ValueFreeEntry {
  page: ValueFreePage
  checked?: CheckedValueFreePage | null
}

/** Every id an artifact's fragments carry, and each fragment's scoped-style hashes, for the shell check (./shell.ts `fitsShell`). */
export interface ArtifactFacts {
  ids: ReadonlySet<string>
  scopes: Readonly<Record<ComposedFragmentId, ReadonlySet<string>>>
  /** Each fragment root's class tokens and scoped-style hash: its shape against its slot's. */
  roots: Readonly<Record<ComposedFragmentId, {classes: ReadonlySet<string>; scopes: ReadonlySet<string>}>>
}

/** A value-free page as the composer returns it, with the facts its fragment check produced (atlas decision 0164). */
export type ComposedValueFreePage = ValueFreePage & {facts: WireFacts}

export interface ValueFreeSet {
  /** The build that composed the set; it must be the Worker's own. */
  build: string
  /** Keyed by hiding focus value, GATE_VARIANT or UNREADABLE_VARIANT. */
  variants: Record<string, ComposedValueFreePage>
}

/** One value per fragment id, in fragment-id order. */
export function perFragment<T>(value: (id: ComposedFragmentId) => T): Record<ComposedFragmentId, T> {
  const out: Partial<Record<ComposedFragmentId, T>> = {}
  for (const id of COMPOSED_FRAGMENT_IDS) {
    out[id] = value(id)
  }
  // Every fragment id was set in the loop above.
  return out as Record<ComposedFragmentId, T>
}

/** The facts as plain arrays, in fragment-id order. */
export function toWireFacts(facts: ArtifactFacts): WireFacts {
  return {
    ids: [...facts.ids],
    scopes: perFragment((id) => [...facts.scopes[id]]),
    roots: perFragment((id) => ({classes: [...facts.roots[id].classes], scopes: [...facts.roots[id].scopes]}))
  }
}

/** The facts as sets. The caller checks the wire shape first. */
export function fromWireFacts(wire: WireFacts): ArtifactFacts {
  return {
    ids: new Set(wire.ids),
    scopes: perFragment((id) => new Set(wire.scopes[id])),
    roots: perFragment((id) => ({classes: new Set(wire.roots[id].classes), scopes: new Set(wire.roots[id].scopes)}))
  }
}

/**
 * The value-free set as the Worker read it: its build and every variant's shape are checked at
 * once; each variant's fragments when it is first served (`checkedVariant`), so a cold isolate
 * pays for one variant, not four.
 */
export interface CheckedValueFreeSet {
  build: string
  variants: Record<string, ValueFreeEntry>
}

/** The variant's checked page, or null when its fragments fail the allowlist. Checked once per set. */
export function checkedVariant(entry: ValueFreeEntry): CheckedValueFreePage | null {
  if (entry.checked === undefined) {
    const checked = checkFragments(entry.page.fragments, VALUE_FREE_FRAGMENT_OPTIONS)
    entry.checked = checked.ok ? {summary: entry.page.summary, fragments: checked.fragments, facts: checked.facts} : null
  }
  return entry.checked
}

/** The value-free set, when this website built it; otherwise null (the Worker then serves the data-free page). */
export function checkValueFree(text: string, build: string, required: readonly string[]): CheckedValueFreeSet | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || value.build !== build || !isRecord(value.variants)) {
    return null
  }
  const variants: Record<string, ValueFreeEntry> = {}
  for (const key of required) {
    const page = value.variants[key]
    if (!isRecord(page) || (page.summary !== 'suppressed' && page.summary !== 'unavailable') || !isRecord(page.fragments)) {
      return null
    }
    const fragments = page.fragments
    if (!COMPOSED_FRAGMENT_IDS.every((id) => typeof fragments[id] === 'string')) {
      return null
    }
    // Every id was checked to be a string above.
    variants[key] = {page: {summary: page.summary, fragments: fragments as Record<ComposedFragmentId, string>}}
  }
  return {build, variants}
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

export type FragmentsCheck =
  | {ok: true; fragments: Record<ComposedFragmentId, string>; facts: ArtifactFacts}
  | {ok: false; detail: `${ComposedFragmentId}:${FragmentRejection | 'missing'}`}

/**
 * Every fragment id, each admitted by the allowlist (./fragment-policy.ts), with no id carried
 * twice across the artifact. Otherwise the first fragment refused and why: a closed set, safe for
 * the log line. The Worker runs it on an artifact it reads; the composer runs it on what it renders,
 * so it never publishes fragments the Worker would refuse, and its facts are the Worker's.
 */
export function checkFragments(value: Record<string, unknown>, options: FragmentOptions): FragmentsCheck {
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  const ids = new Set<string>()
  const scopes: Partial<Record<ComposedFragmentId, ReadonlySet<string>>> = {}
  const roots: Partial<Record<ComposedFragmentId, ArtifactFacts['roots'][ComposedFragmentId]>> = {}
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const fragment = value[id]
    if (typeof fragment !== 'string') {
      return {ok: false, detail: `${id}:missing`}
    }
    const checked = checkFragment(fragment, id, options)
    if (!checked.ok) {
      return {ok: false, detail: `${id}:${checked.reason}`}
    }
    for (const elementId of checked.facts.ids) {
      // A card root id inside another fragment, or an id two fragments share, would let one
      // fragment answer another card's getElementById.
      if (ids.has(elementId) || (elementId !== id && (COMPOSED_FRAGMENT_IDS as readonly string[]).includes(elementId))) {
        return {ok: false, detail: `${id}:id`}
      }
      ids.add(elementId)
    }
    scopes[id] = new Set(checked.facts.scopes)
    roots[id] = {classes: new Set(checked.facts.root.classes), scopes: new Set(checked.facts.root.scopes)}
    fragments[id] = fragment
  }
  // Every id was checked in the loop above.
  return {
    ok: true,
    fragments: fragments as Record<ComposedFragmentId, string>,
    facts: {ids, scopes: scopes as Record<ComposedFragmentId, ReadonlySet<string>>, roots: roots as ArtifactFacts['roots']}
  }
}

/**
 * The fragment check of the last artifact text this isolate read. The artifact changes once per
 * composition (minutes apart) and the check costs about 1 ms warm and 4 to 5 ms in a cold isolate
 * (Node, the 54 KB fixture), so every later request for the same bytes reuses the answer. Keyed on
 * the whole text: a byte that differs is checked again.
 */
let lastFragments: {text: string; check: FragmentsCheck} | null = null

function memoizedFragments(text: string, value: Record<string, unknown>, options: FragmentOptions): FragmentsCheck {
  if (lastFragments?.text !== text) {
    lastFragments = {text, check: checkFragments(value, options)}
  }
  return lastFragments.check
}

/** Why an artifact is not served. Value-free: safe for the log line. */
export type ArtifactRefusal = 'oversize' | 'not-json' | 'schema' | 'stale' | 'future' | 'build' | 'hiding' | 'fragments'

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
 * replaces, built only from the allowlist (`checkFragments`). A `fragments` refusal names the
 * fragment and the closed-set reason in `detail`.
 */
export function checkArtifact(
  text: string,
  nowMs: number,
  build: string,
  hidingModes: ReadonlySet<string>
): {ok: true; artifact: ComposedArtifact; facts: ArtifactFacts} | {ok: false; refusal: ArtifactRefusal; detail?: string} {
  if (text.length > COMPOSED_MAX_BYTES) {
    return {ok: false, refusal: 'oversize'}
  }
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
  // The composer stamps every card's source age before its own composition stamp; a later one would
  // freeze the card, because the client repaints only from a strictly newer stamp.
  const fragments = memoizedFragments(text, value.fragments, {maxGeneratedAtMs: composedMs + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false})
  if (!fragments.ok) {
    return {ok: false, refusal: 'fragments', detail: fragments.detail}
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
      fragments: fragments.fragments
    },
    facts: fragments.facts
  }
}
