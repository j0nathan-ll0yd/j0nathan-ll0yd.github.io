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
  checkFragments,
  COMPOSED_MAX_FUTURE_SKEW_MS,
  COMPOSED_SCHEMA_VERSION,
  type ComposedArtifactBody,
  type ComposedFragmentId,
  type ComposedValueFreePage,
  GATE_VARIANT,
  toWireFacts,
  UNREADABLE_VARIANT,
  VALUE_FREE_FRAGMENT_OPTIONS,
  type ValueFreeSet,
  type WireFacts
} from './artifact'
import type {FragmentOptions} from './fragment-policy'
import {COMPOSER_CONTRACT} from './paths'
import {type PublishedEntry, publishedEntry as entryFor, type PublishedFragments} from './published'
import {composableReading} from './reading-links'

declare const __SSR_BUILD_ID__: string | undefined
declare const __MIRRORED_BOOK_COVERS__: readonly string[] | undefined

export { COMPOSER_CONTRACT }
/** The KV contract (./published.ts), for the runner and the focus writer: one encoder per value. */
export { PUBLISHED_FOCUS_KEY, PUBLISHED_TTL_S, publishedFocusValue, publishedFragmentsKey } from './published'
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

/**
 * A refusal as the composer returns it. `hiding` names the hiding value it read, so the runner
 * publishes that value's value-free page (`composeValueFree().variants[currentFocus]`, atlas
 * decision 0164 D1); every other refusal carries its word alone.
 */
export type ComposeRefused = {ok: false; refusal: 'hiding'; currentFocus: string} | {ok: false; refusal: Exclude<ComposeRefusal, 'hiding'>}

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

/**
 * The artifact for these inputs, or why none may be published. The artifact carries `facts`, what
 * the Worker's fragment check reads from its fragments (atlas decision 0164).
 */
export async function compose(input: ComposeInput): Promise<{ok: true; artifact: ComposedArtifactBody} | ComposeRefused> {
  let currentFocus: string
  try {
    currentFocus = decodeArtifact('focus', input.focus).currentFocus
  } catch {
    return {ok: false, refusal: 'focus-unreadable'}
  }
  if ((HIDING_FOCUS_MODES as readonly string[]).includes(currentFocus)) {
    // A hiding page holds no value, and the Worker never fetches the artifact while hiding.
    return {ok: false, refusal: 'hiding', currentFocus}
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
async function composeLoad(load: DashboardLoad, currentFocus: string, nowMs: number, localCovers: readonly string[]): Promise<ComposedArtifactBody> {
  const render = toDashboardRender(load, nowMs)
  const {fragments, facts} = await renderFragments(render.vm, localCovers, {maxGeneratedAtMs: nowMs + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false})
  return {
    schemaVersion: COMPOSED_SCHEMA_VERSION,
    composedAt: new Date(nowMs).toISOString(),
    composer: {build: COMPOSER_BUILD},
    currentFocus,
    summary: render.summary,
    record: render.record,
    fragments,
    facts
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

export type ComposeDashboardResult = {ok: true; artifact: ComposedArtifactBody; body: string} | ComposeRefused

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
    return {ok: false, refusal: 'hiding', currentFocus: load.focus.currentFocus}
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

/**
 * The thirteen fragments for one set of view models, rendered by the design system's components,
 * and the facts the Worker's own fragment check reads from them.
 */
async function renderFragments(
  vm: DashboardRender['vm'],
  localCovers: readonly string[],
  options: FragmentOptions
): Promise<{fragments: Record<ComposedFragmentId, string>; facts: WireFacts}> {
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
    // A link or note title the Worker would refuse is degraded, never published (./reading-links.ts).
    ['cardReading', ReadingFeed, composableReading(vm.readingFeed)],
    ['cardStarredRepos', StarredRepoList, vm.starredRepoList],
    ['cardBooks', Bookshelf, {...vm.bookshelf, localCovers}],
    ['cardTheatreReviews', TheatreReviews, vm.theatreReviews]
  ]
  const fragments: Partial<Record<ComposedFragmentId, string>> = {}
  for (const [id, Component, props] of parts) {
    // The production components are Astro components; the container renders each with its props.
    const rendered = await container.renderToString(Component as Parameters<typeof container.renderToString>[0], {props: props as Record<string, unknown>})
    fragments[id] = rootOnly(rendered)
  }
  return checked(fragments, options)
}

/**
 * The component's markup without its module scripts: the root element, and in a data state the
 * hidden data carrier a component emits beside it (Hydration's `#cardHydrationData`). The container
 * appends each module script as a sibling, with a `src` that names this machine's source path; the
 * website page already loads the built, hashed scripts, so a fragment carries none (atlas decision
 * 0160, PR B review H1).
 */
function rootOnly(rendered: string): string {
  return rendered.replace(MODULE_SCRIPT, '').trim()
}

/**
 * The fragments with their facts, when the Worker's own check admits them all (./artifact.ts
 * `checkFragments`: each fragment against the allowlist, and no id shared across fragments), so the
 * composer never publishes fragments the Worker would refuse. Throws otherwise.
 */
function checked(
  fragments: Partial<Record<ComposedFragmentId, string>>,
  options: FragmentOptions
): {fragments: Record<ComposedFragmentId, string>; facts: WireFacts} {
  const result = checkFragments(fragments, options)
  if (!result.ok) {
    const at = result.detail.indexOf(':')
    const [id, reason] = [result.detail.slice(0, at), result.detail.slice(at + 1)]
    throw new Error(`the ${id} component rendered markup the Worker's allowlist refuses (${reason})`)
  }
  return {fragments: result.fragments, facts: toWireFacts(result.facts)}
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
async function valueFreePage(state: ValueFreeState, nowMs: number, localCovers: readonly string[]): Promise<ComposedValueFreePage> {
  const render = toDashboardRender(valueFreeLoad(state), nowMs)
  const vm = {...render.vm, focusOverlay: {...render.vm.focusOverlay, now: ''}, dndOverlay: {...render.vm.dndOverlay, now: ''}}
  if (render.summary !== 'suppressed' && render.summary !== 'unavailable') {
    throw new Error(`value-free state ${state.kind} rendered the summary ${render.summary}`)
  }
  return {summary: render.summary, ...await renderFragments(vm, localCovers, VALUE_FREE_FRAGMENT_OPTIONS)}
}

/**
 * The value-free pages the website build ships (scripts/build-composer.mjs). Each is composed at two
 * clocks a year apart and must be identical: a page that depends on the clock would freeze the build
 * time into every hiding or unreadable answer.
 */
export async function composeValueFree(input: {localCovers?: readonly string[]} = {}): Promise<ValueFreeSet> {
  const localCovers = input.localCovers ?? LOCAL_COVERS
  const variants: Record<string, ComposedValueFreePage> = {}
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

/**
 * The KV entry the runner publishes for one composition of this build (atlas decision 0164): the
 * `fragments:<build>` key, the value text and its metadata (./published.ts). `source` is a composed
 * artifact, or a value-free page of `composeValueFree` while the focus value hides, the gate is shut
 * or the signal is unreadable. `composedAt` is the artifact's own stamp, or the run's time for a
 * value-free page.
 */
export function publishedEntry(source: PublishedFragments, composedAt: string): PublishedEntry {
  return entryFor(source, COMPOSER_BUILD, composedAt)
}
