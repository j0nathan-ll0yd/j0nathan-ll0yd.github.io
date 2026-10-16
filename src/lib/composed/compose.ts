// The composer (atlas decision 0160, PR B; owner decisions 2026-10-16: the page is precomposed as the
// data changes, and the live site supplies the composer). It renders the live cards, the focus
// overlays and System Status with the design system's own Astro components (Astro's Container API,
// in Node), and returns the artifact the Worker serves (./artifact.ts). It never runs in the Worker.
//
// Each website build ships this module as a public static asset (`/_ssr/composer-<build>.mjs`,
// named in version.json with its sha256). A backend runner fetches it, checks the hash, imports it
// and calls `composeDashboard`, which reads the focus signal and the eight exports through the
// PUBLIC gated CloudFront URLs with the website's own admission rules (../data-plane/loader.ts):
// the runner needs no read credential. The artifact names this build; the Worker serves only an
// artifact of its own build. The website's test data plane calls `compose` with raw exports.
//
// It is compiled by the website's own build settings (scripts/build-composer.mjs), so its markup and
// its scoped-style hashes equal the website's: Astro hashes a component by its path relative to the
// build root.
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
import {CLOUDFRONT_BASE, HIDING_FOCUS_MODES, type ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import {decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import {
  type DashboardLoad,
  type DomainOutcome,
  GATED_KEYS,
  type GatedKey,
  loadDashboard,
  type LoaderTimeouts,
  loadFocus,
  valueFreeLoad,
  type ValueFreeState
} from '../data-plane/loader'
import {type DashboardRender, toDashboardRender} from '../data-plane/render-model'
import {
  COMPOSED_SCHEMA_VERSION,
  type ComposedArtifact,
  type ComposedFragmentId,
  GATE_VARIANT,
  opensWithRoot,
  UNREADABLE_VARIANT,
  type ValueFreePage,
  type ValueFreeSet
} from './artifact'
import {COMPOSER_CONTRACT} from './paths'

declare const __SSR_BUILD_ID__: string | undefined
declare const __MIRRORED_BOOK_COVERS__: readonly string[] | undefined

export { COMPOSER_CONTRACT }
/** This build's id (scripts/lib/build-id.mjs). Every artifact this module composes names it. */
export const COMPOSER_BUILD: string = typeof __SSR_BUILD_ID__ === 'string' ? __SSR_BUILD_ID__ : 'unknown'
/** The website's mirrored cover paths (Bookshelf `localCovers`), fixed at build time. */
const LOCAL_COVERS: readonly string[] = typeof __MIRRORED_BOOK_COVERS__ === 'undefined' ? [] : __MIRRORED_BOOK_COVERS__

/**
 * The runner's read bounds. A Lambda run has 60 s, not the request path's 2.5 s, so a slow export
 * still composes; the whole read stays well inside the run.
 */
// 5 s + 20 s of reads, then a 5 s focus re-read, leave the runner's 60 s timeout room for its own two
// 8 s downloads and the render (review L7).
const RUNNER_TIMEOUTS: Readonly<LoaderTimeouts> = Object.freeze({focusMs: 5_000, artifactMs: 10_000, ioBudgetMs: 20_000})

export interface ComposeInput {
  /** Each export's parsed JSON, or null when it could not be read. */
  exports: Partial<Record<GatedKey, unknown>>
  /** The focus export's parsed JSON. */
  focus: unknown
  nowMs: number
  /** Overrides the mirrored cover paths, for tests outside the build. */
  localCovers?: readonly string[]
}

/**
 * Why the composer publishes nothing: a hiding or unreadable focus value, the gate shut over a
 * visible one, or a focus value that turned hiding or unreadable while the page was rendering.
 */
export type ComposeRefusal = 'hiding' | 'focus-unreadable' | 'suppressed' | 'focus-changed'

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

/** A module script element, as the container emits it after a component. */
const MODULE_SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/gi

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
  return {ok: true, artifact: await composeLoad(load, currentFocus, input.nowMs, input.localCovers ?? LOCAL_COVERS)}
}

/** The artifact for one visible load, stamped with this build. */
async function composeLoad(load: DashboardLoad, currentFocus: string, nowMs: number, localCovers: readonly string[]): Promise<ComposedArtifact> {
  const render = toDashboardRender(load, nowMs)
  return {
    schemaVersion: COMPOSED_SCHEMA_VERSION,
    composedAt: new Date(nowMs).toISOString(),
    composer: {build: COMPOSER_BUILD},
    currentFocus,
    summary: render.summary,
    record: render.record,
    fragments: await renderFragments(render.vm, localCovers)
  }
}

export interface ComposeDashboardOptions {
  /** The fetch to read with. Tests pass a stub; the runner passes nothing. */
  fetch?: typeof fetch
  /** The composition clock. Absent: Date.now(), read when the exports have been read. */
  nowMs?: number
  /** The data-plane origin. Absent: the public CloudFront data plane. */
  base?: string
}

export type ComposeDashboardResult = {ok: true; artifact: ComposedArtifact; body: string} | {ok: false; refusal: ComposeRefusal}

/**
 * The runner's entry: reads the focus signal and the eight exports through the public gated URLs,
 * composes, then reads the focus signal again. It publishes nothing when focus hides or cannot be
 * read, when the gate is shut, or when the focus value changed at all during the render (privacy
 * race (a), openspec/specs/dashboard-ssr). `body` is the JSON the runner stores, byte for byte.
 */
export async function composeDashboard(options: ComposeDashboardOptions = {}): Promise<ComposeDashboardResult> {
  if (COMPOSER_BUILD === 'unknown') {
    // A composer built without a build id would name no build the Worker can check (review L9).
    throw new Error('the composer was built without a build id')
  }
  const io = {base: options.base ?? CLOUDFRONT_BASE, timeouts: RUNNER_TIMEOUTS, ...(options.fetch ? {fetch: options.fetch} : {})}
  const load = await loadDashboard(io)
  if (load.focus.state === 'hiding') {
    return {ok: false, refusal: 'hiding'}
  }
  if (load.focus.state === 'unreadable') {
    return {ok: false, refusal: 'focus-unreadable'}
  }
  if (load.suppressed) {
    return {ok: false, refusal: 'suppressed'}
  }
  const artifact = await composeLoad(load, load.focus.currentFocus, options.nowMs ?? Date.now(), LOCAL_COVERS)
  const after = await loadFocus(io)
  // The same visible value, not only a visible one: the artifact names the focus value it read.
  if (after.state !== 'visible' || after.currentFocus !== load.focus.currentFocus) {
    return {ok: false, refusal: 'focus-changed'}
  }
  return {ok: true, artifact, body: JSON.stringify(artifact)}
}

/** The thirteen fragments for one set of view models, rendered by the design system's components. */
async function renderFragments(vm: DashboardRender['vm'], localCovers: readonly string[]): Promise<Record<ComposedFragmentId, string>> {
  container ??= await AstroContainer.create()
  const parts: [ComposedFragmentId, unknown, object][] = [
    ['focusOverlay', FocusOverlay, vm.focusOverlay],
    ['dndOverlay', DndOverlay, vm.dndOverlay],
    ['cardSystem', SystemStatus, vm.systemStatus],
    ['cardHR', HeartRate, vm.heartRate],
    ['cardMovement', MovementRings, vm.movementRings],
    ['cardHydration', Hydration, vm.hydration],
    ['cardSleep', NightSummary, vm.nightSummary],
    ['cardWorkouts', Workouts, vm.workouts],
    ['cardDevLog', DevActivityLog, vm.devActivityLog],
    ['cardReading', ReadingFeed, vm.readingFeed],
    ['cardStarredRepos', StarredRepoList, vm.starredRepoList],
    ['cardBooks', Bookshelf, {...vm.bookshelf, localCovers}],
    ['cardTheatreReviews', TheatreReviews, vm.theatreReviews]
  ]
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  for (const [id, Component, props] of parts) {
    // The production components are Astro components; the container renders each with its props.
    const rendered = await container.renderToString(Component as Parameters<typeof container.renderToString>[0], {props: props as Record<string, unknown>})
    fragments[id] = rootOnly(id, rendered)
  }
  // Every id was rendered in the loop above.
  return fragments as Record<ComposedFragmentId, string>
}

/**
 * The component's markup without its module scripts: the root element, and in a data state the
 * hidden data carrier a component emits beside it (Hydration's `#cardHydrationData`). The container
 * appends each module script as a sibling, with a `src` that names this machine's source path; the
 * website page already loads the built, hashed scripts, so a fragment carries none (atlas decision
 * 0160, PR B review H1). The parity oracle proves nothing else sits beside the root.
 */
function rootOnly(id: ComposedFragmentId, rendered: string): string {
  const fragment = rendered.replace(MODULE_SCRIPT, '').trim()
  if (!opensWithRoot(fragment, id) || /<(?:script|style|link)\b/i.test(fragment)) {
    throw new Error(`the ${id} component rendered markup a fragment may not carry`)
  }
  return fragment
}

/** The states a page can show with no export value, by variant key (./artifact.ts ValueFreeSet). */
function valueFreeStates(): Record<string, ValueFreeState> {
  return {
    ...Object.fromEntries(HIDING_FOCUS_MODES.map((mode) => [mode, {kind: 'hiding', currentFocus: mode}])),
    // Any visible value: the overlays read only whether the value hides.
    [GATE_VARIANT]: {kind: 'gate', currentFocus: 'None'},
    [UNREADABLE_VARIANT]: {kind: 'unreadable', reason: 'focus-unreadable'}
  }
}

/** One value-free page at `nowMs`. The overlay clock is left to the browser (`--:--:--` until clock.js runs). */
async function valueFreePage(state: ValueFreeState, nowMs: number, localCovers: readonly string[]): Promise<ValueFreePage> {
  const render = toDashboardRender(valueFreeLoad(state), nowMs)
  const vm = {...render.vm, focusOverlay: {...render.vm.focusOverlay, now: ''}, dndOverlay: {...render.vm.dndOverlay, now: ''}}
  if (render.summary !== 'suppressed' && render.summary !== 'unavailable') {
    throw new Error(`value-free state ${state.kind} rendered the summary ${render.summary}`)
  }
  return {summary: render.summary, fragments: await renderFragments(vm, localCovers)}
}

/**
 * The value-free pages the website build ships (scripts/build-composer.mjs). Each is composed at two
 * clocks a year apart and must be identical: a page that depends on the clock would freeze the build
 * time into every hiding or unreadable answer.
 */
export async function composeValueFree(input: {localCovers?: readonly string[]} = {}): Promise<ValueFreeSet> {
  const localCovers = input.localCovers ?? LOCAL_COVERS
  const variants: Record<string, ValueFreePage> = {}
  for (const [key, state] of Object.entries(valueFreeStates())) {
    const page = await valueFreePage(state, Date.UTC(2026, 0, 1), localCovers)
    const later = await valueFreePage(state, Date.UTC(2027, 0, 1, 13, 37), localCovers)
    if (JSON.stringify(page) !== JSON.stringify(later)) {
      throw new Error(`value-free variant ${key} depends on the clock`)
    }
    variants[key] = page
  }
  return {build: COMPOSER_BUILD, variants}
}
