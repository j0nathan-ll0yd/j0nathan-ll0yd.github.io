// The composed dashboard artifact (atlas decision 0160, PR B; owner decision 2026-10-16, option 1:
// the PRECOMPOSED PAGE). A backend composer renders the live cards from the exports with the design
// system's own components and stores the result beside the exports, behind the same CloudFront gate.
// The Worker never renders: it checks the artifact and splices its fragments into the prerendered
// data-free page (./shell.ts).
//
// The artifact is JSON, not a whole page: the page around the cards (the head, the hashed /_astro
// asset names, the client runtime) belongs to the website build, and only the website knows it. So a
// website deploy never invalidates an artifact, and an artifact never names a website asset.
import type {SsrRenderRecord, SsrSummary} from '../data-plane/render-model'

/** The artifact's path on the data plane, beside the exports. Gated (SUPPRESSIBLE_PATHS in LP). */
export const COMPOSED_ARTIFACT_PATH = '/dashboard.json'

/** The artifact format this Worker reads. A different version is never served. */
export const COMPOSED_SCHEMA_VERSION = 1

/**
 * The oldest artifact the Worker serves. The composer runs on every export update and on the same
 * 30-minute backstop schedule as ComposeLlmContent (owner decision 2026-10-16); the health export
 * alone updates every 15 minutes. So an artifact older than the backstop plus 5 minutes (a slow cold
 * start, a retried invocation, the 30 s CloudFront TTL) means the composer stopped: its card states
 * may no longer be true, and the Worker serves the data-free page instead.
 */
export const COMPOSED_MAX_AGE_MS = 35 * 60 * 1000
/** A composition stamp this far ahead of the Worker's clock is malformed, not skewed. */
export const COMPOSED_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

/** The elements of the data-free page an artifact replaces, by id. */
export const COMPOSED_FRAGMENT_IDS = Object.freeze([
  'focusOverlay',
  'dndOverlay',
  'systemStatus',
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
  /** The design-system version the fragments came from. It must equal the website's own (./shell.ts). */
  renderer: {web: string}
  /** The focus value the composer read. Only a visible value is ever composed. */
  currentFocus: string
  summary: SsrSummary
  record: SsrRenderRecord
  fragments: Record<ComposedFragmentId, string>
}

/**
 * The value-free pages, as the website build composes them (scripts/build-composer.mjs): one per
 * hiding focus value, one for the gate shut over a visible value, one for an unreadable focus signal.
 * They hold no export value and depend only on the build, so they are a static asset of the website,
 * read by the Worker through the ASSETS binding. A public request for the path gets the 404 page.
 */
export const VALUE_FREE_PATH = '/_ssr/value-free.json'
/** The variant for the gate shut over a visible focus value: every card suppressed, no overlay. */
export const GATE_VARIANT = 'gate'
/** The variant for an unreadable focus signal: every card unavailable, no overlay. */
export const UNREADABLE_VARIANT = 'unreadable'

export interface ValueFreePage {
  summary: 'suppressed' | 'unavailable'
  fragments: Record<ComposedFragmentId, string>
}

export interface ValueFreeSet {
  renderer: {web: string}
  /** Keyed by hiding focus value, GATE_VARIANT or UNREADABLE_VARIANT. */
  variants: Record<string, ValueFreePage>
}

/** The value-free set, when this website built it; otherwise null (the Worker then serves the data-free page). */
export function checkValueFree(text: string, renderer: {web: string}, required: readonly string[]): ValueFreeSet | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value) || !isRecord(value.renderer) || value.renderer.web !== renderer.web || !isRecord(value.variants)) {
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
  return {renderer: {web: renderer.web}, variants}
}

/** Every fragment id, each a string that holds the element it replaces; otherwise null. */
function checkFragments(value: Record<string, unknown>): Record<ComposedFragmentId, string> | null {
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const fragment = value[id]
    if (typeof fragment !== 'string' || !fragment.includes(`id="${id}"`)) {
      return null
    }
    fragments[id] = fragment
  }
  // Every id was checked in the loop above.
  return fragments as Record<ComposedFragmentId, string>
}

/** Why an artifact is not served. Value-free: safe for the log line. */
export type ArtifactRefusal = 'not-json' | 'schema' | 'stale' | 'future' | 'renderer' | 'hiding' | 'fragments'

const SUMMARIES = new Set(['live', 'stale', 'partial', 'unavailable', 'suppressed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The artifact, when it may be served at `nowMs` by a website built with `renderer`; otherwise the
 * reason it may not. Every field the Worker uses is checked; a fragment must be a non-empty string
 * that opens with the element it replaces.
 */
export function checkArtifact(
  text: string,
  nowMs: number,
  renderer: {web: string},
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
    !isRecord(value.record) || !isRecord(value.renderer) || !isRecord(value.fragments)
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
  if (value.renderer.web !== renderer.web) {
    return {ok: false, refusal: 'renderer'}
  }
  if (hidingModes.has(value.currentFocus) || value.summary === 'suppressed') {
    return {ok: false, refusal: 'hiding'}
  }
  const fragments = checkFragments(value.fragments)
  if (fragments === null) {
    return {ok: false, refusal: 'fragments'}
  }
  return {
    ok: true,
    artifact: {
      schemaVersion: COMPOSED_SCHEMA_VERSION,
      composedAt: value.composedAt,
      renderer: {web: value.renderer.web},
      currentFocus: value.currentFocus,
      // Checked against the closed set above.
      summary: value.summary as SsrSummary,
      // Logged only; the Worker reads no value from it.
      record: value.record as unknown as SsrRenderRecord,
      fragments
    }
  }
}
