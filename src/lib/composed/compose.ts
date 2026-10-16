// The composer (atlas decision 0160, PR B; owner decision 2026-10-16, option 1: the PRECOMPOSED
// PAGE). It renders the live cards, the focus overlays and System Status from the decoded exports with
// the design system's own Astro components (Astro's Container API, in Node), and returns the artifact
// the Worker serves (./artifact.ts). It never runs in the Worker.
//
// The same module runs in two places: the backend composer (a Node runtime that reads the exports from
// the data bucket), and the website's test data plane (tests/data-plane/server.ts). It is compiled by
// the website's own build settings (scripts/build-composer.mjs), so its markup and its scoped-style
// hashes equal the website's: Astro hashes a component by its path relative to the build root.
import {experimental_AstroContainer as AstroContainer} from 'astro/container'
import {
  Bookshelf,
  DevActivityLog,
  DndOverlay,
  FocusOverlay,
  HeartRate,
  Hydration,
  MovementRings,
  NightSummary,
  ReadingFeed,
  StarredRepoList,
  SystemStatus,
  TheatreReviews,
  Workouts
} from '@j0nathan-ll0yd/web/production'
import {HIDING_FOCUS_MODES, type ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import {decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import {type DashboardLoad, type DomainOutcome, GATED_KEYS, type GatedKey} from '../data-plane/loader'
import {toDashboardRender} from '../data-plane/render-model'
import {COMPOSED_SCHEMA_VERSION, type ComposedArtifact, type ComposedFragmentId} from './artifact'

export interface ComposeInput {
  /** Each export's parsed JSON, or null when it could not be read. */
  exports: Partial<Record<GatedKey, unknown>>
  /** The focus export's parsed JSON. */
  focus: unknown
  nowMs: number
  /** The website's mirrored cover paths (Bookshelf `localCovers`). */
  localCovers: readonly string[]
  /** The design-system version the composer renders with (its installed @j0nathan-ll0yd/web). */
  web: string
}

/** Why the composer publishes nothing: a hiding or unreadable focus value. */
export type ComposeRefusal = 'hiding' | 'focus-unreadable'

function outcome(key: GatedKey, raw: unknown): DomainOutcome {
  if (raw === null || raw === undefined) {
    return {kind: 'unavailable', reason: 'http-404'}
  }
  try {
    // decodeArtifact returns the value of the key it decodes.
    return {kind: 'ok', data: decodeArtifact(key as ResourceKey, raw)} as DomainOutcome
  } catch {
    return {kind: 'unavailable', reason: 'decode'}
  }
}

let container: Awaited<ReturnType<typeof AstroContainer.create>> | null = null

/** The artifact for these inputs, or why none may be published. */
export async function compose(input: ComposeInput): Promise<{ok: true; artifact: ComposedArtifact} | {ok: false; refusal: ComposeRefusal}> {
  let currentFocus: string
  try {
    currentFocus = decodeArtifact('focus', input.focus).currentFocus
  } catch {
    return {ok: false, refusal: 'focus-unreadable'}
  }
  if ((HIDING_FOCUS_MODES as readonly string[]).includes(currentFocus)) {
    // A hiding page holds no value, and the Worker never fetches the artifact while hiding.
    return {ok: false, refusal: 'hiding'}
  }
  const load: DashboardLoad = {
    focus: {state: 'visible', currentFocus},
    domains: Object.fromEntries(GATED_KEYS.map((key) => [key, outcome(key, input.exports[key])])) as DashboardLoad['domains'],
    suppressed: false,
    ioMs: 0
  }
  const render = toDashboardRender(load, input.nowMs)
  const vm = render.vm
  container ??= await AstroContainer.create()
  const parts: [ComposedFragmentId, unknown, object][] = [
    ['focusOverlay', FocusOverlay, vm.focusOverlay],
    ['dndOverlay', DndOverlay, vm.dndOverlay],
    ['systemStatus', SystemStatus, vm.systemStatus],
    ['cardHR', HeartRate, vm.heartRate],
    ['cardMovement', MovementRings, vm.movementRings],
    ['cardHydration', Hydration, vm.hydration],
    ['cardSleep', NightSummary, vm.nightSummary],
    ['cardWorkouts', Workouts, vm.workouts],
    ['cardDevLog', DevActivityLog, vm.devActivityLog],
    ['cardReading', ReadingFeed, vm.readingFeed],
    ['cardStarredRepos', StarredRepoList, vm.starredRepoList],
    ['cardBooks', Bookshelf, {...vm.bookshelf, localCovers: input.localCovers}],
    ['cardTheatreReviews', TheatreReviews, vm.theatreReviews]
  ]
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  for (const [id, Component, props] of parts) {
    // The production components are Astro components; the container renders each with its props.
    fragments[id] = await container.renderToString(Component as Parameters<typeof container.renderToString>[0], {props: props as Record<string, unknown>})
  }
  return {
    ok: true,
    artifact: {
      schemaVersion: COMPOSED_SCHEMA_VERSION,
      composedAt: new Date(input.nowMs).toISOString(),
      renderer: {web: input.web},
      currentFocus,
      summary: render.summary,
      record: render.record,
      // Every id was rendered in the loop above.
      fragments: fragments as Record<ComposedFragmentId, string>
    }
  }
}
