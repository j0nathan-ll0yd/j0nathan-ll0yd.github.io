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
 * The oldest artifact the Worker serves: two composition cycles (the composer's backstop schedule is
 * 5 minutes, and every export update composes at once). An older artifact means the composer stopped;
 * its card states may no longer be true, so the Worker serves the data-free page instead.
 */
export const COMPOSED_MAX_AGE_MS = 10 * 60 * 1000
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
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const fragment = value.fragments[id]
    if (typeof fragment !== 'string' || !fragment.includes(`id="${id}"`)) {
      return {ok: false, refusal: 'fragments'}
    }
    fragments[id] = fragment
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
      // Every id was checked in the loop above.
      fragments: fragments as Record<ComposedFragmentId, string>
    }
  }
}
