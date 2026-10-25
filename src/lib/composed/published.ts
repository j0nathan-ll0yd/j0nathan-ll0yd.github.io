// The page data the backend publishes to Workers KV for `/` (atlas decision 0164, Variant D): the
// data contract between the LP runner and this Worker.
//
// - `focus`: the focus state, written by LP `focus.post.ts` on every change before it returns, and
//   repaired by `ReconcileFocusGate` within 5 minutes when it differs from the S3 signal. It is not
//   refreshed only to stay young (atlas decision 0170), so a visible value may be old: the Worker
//   then admits only fragments that prove visibility themselves (`readPublished`).
// - `fragments:<build>`: the fragments this build's composer rendered and checked, with the facts its
//   check produced (./artifact.ts `WireFacts`) and the summary, written by the ComposeDashboard runner
//   after its composer run. While the focus value hides, the gate is shut or the signal is
//   unreadable, each run writes that state's value-free fragments to the same key (decision D1). The
//   last visible composition stays in KV from the moment the focus value turns hiding until the
//   runner's next run overwrites it (at most its 5-minute backstop) or the key expires.
//
// The fragments keys expire after PUBLISHED_TTL_S; the `focus` key does not expire (atlas decision
// 0170). The Worker requests both keys together (one KV round trip, not two) and judges `focus`
// first: under a hiding or unreadable value the fragments value arrives in the isolate but is never
// parsed, inspected, spliced or logged, so the Worker never serves that composition while hiding.
// The composer exports the encoders, so the runner writes exactly the shapes this module defines.
import type {SsrSummary} from '../data-plane/render-model'
import {COMPOSED_FRAGMENT_IDS, COMPOSED_MAX_AGE_MS, COMPOSED_MAX_FUTURE_SKEW_MS, type ComposedFragmentId, fromWireFacts, type WireFacts} from './artifact'
import {fitsShell, type Shell} from './shell'

/** The KV key of the focus state. */
export const PUBLISHED_FOCUS_KEY = 'focus'

/** The KV key of build `build`'s fragments. A preview never finds its build's key. */
export function publishedFragmentsKey(build: string): string {
  return `fragments:${build}`
}

/**
 * The fragments keys' TTL, in seconds: the composed artifact's age bound (690 s). The `focus` key
 * takes no TTL (atlas decision 0170): the backend writes it on each change and on repair only.
 */
export const PUBLISHED_TTL_S = COMPOSED_MAX_AGE_MS / 1000

/** The largest fragments value the Worker reads: 512 KiB, in UTF-8 bytes. */
export const PUBLISHED_MAX_BYTES = 512 * 1024

/** KV's limit on a key's metadata, serialized, in bytes. */
export const PUBLISHED_METADATA_MAX_BYTES = 1024

/** A string's UTF-8 length: KV counts bytes, and a fragment's text may hold any character. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** The `focus` value. */
export interface PublishedFocus {
  currentFocus: string
  publishedAt: string
}

/** The `fragments:<build>` value. */
export interface PublishedFragments {
  fragments: Record<ComposedFragmentId, string>
  facts: WireFacts
  summary: SsrSummary
}

/** The `fragments:<build>` metadata: what the Worker checks before it parses the value. */
export interface PublishedMetadata {
  build: string
  composedAt: string
  summary: SsrSummary
}

/** One `fragments:<build>` entry, as the runner writes it. */
export interface PublishedEntry {
  key: string
  value: string
  metadata: PublishedMetadata
}

/**
 * The `fragments:<build>` entry for one composition (a composed artifact, or a value-free page) of
 * build `build`, composed at `composedAt` (ISO 8601). Only the three published fields are kept.
 * Throws when the value is over PUBLISHED_MAX_BYTES or the metadata over the KV limit, so the runner
 * never publishes an entry the Worker refuses.
 */
export function publishedEntry(source: PublishedFragments, build: string, composedAt: string): PublishedEntry {
  const value = JSON.stringify({fragments: source.fragments, facts: source.facts, summary: source.summary} satisfies PublishedFragments)
  const metadata: PublishedMetadata = {build, composedAt, summary: source.summary}
  if (utf8Bytes(JSON.stringify(metadata)) > PUBLISHED_METADATA_MAX_BYTES) {
    throw new Error('the fragments metadata is over the KV metadata limit')
  }
  if (utf8Bytes(value) > PUBLISHED_MAX_BYTES) {
    throw new Error('the fragments value is over PUBLISHED_MAX_BYTES')
  }
  return {key: publishedFragmentsKey(build), value, metadata}
}

/** The `focus` value. */
export function publishedFocusValue(focus: PublishedFocus): string {
  return JSON.stringify({currentFocus: focus.currentFocus, publishedAt: focus.publishedAt})
}

// ── The Worker's read (atlas decision 0164, Phase 3) ─────────────────

/** The members of a Workers KV namespace the read uses (the `PAGE` binding, wrangler.jsonc). */
export interface PageStore {
  get(key: string, options: {type: 'text'; cacheTtl?: number}): Promise<string | null>
  getWithMetadata(key: string, options: {type: 'text'}): Promise<{value: string | null; metadata: unknown}>
}

/**
 * How long a colo may serve the `focus` value from its KV read cache, in seconds. A hiding value
 * written by the focus writer reaches a colo that has read `focus` within this bound plus KV's own
 * propagation.
 */
export const FOCUS_CACHE_TTL_S = 30

/**
 * Why the focus state reads unreadable. Value-free: safe for the log line. `focus-stale`: a visible
 * value older than 690 s, and fragments that do not prove visibility (atlas decision 0170).
 */
export type FocusRefusal = 'focus-missing' | 'focus-shape' | 'focus-stale' | 'focus-future' | 'focus-error'

/** Why the fragments are not served. Value-free: safe for the log line. */
export type FragmentsRefusal =
  | 'fragments-missing'
  | 'fragments-build'
  | 'fragments-stale'
  | 'fragments-future'
  | 'fragments-oversize'
  | 'fragments-shape'
  | 'fragments-error'
  | 'shell-misfit'

/** The wall-clock time each KV read took. `fragmentsMs` is null when the fragments were not used. */
export interface PublishedTiming {
  focusMs: number
  fragmentsMs: number | null
}

export type PublishedRead =
  & (
    | {
      kind: 'ok'
      fragments: Record<ComposedFragmentId, string>
      summary: SsrSummary
      focusAgeMs: number
      fragmentsAgeMs: number
      /** The evidence that admitted the visible answer: a `focus` value within 690 s, or data-bearing fragments. */
      proof: VisibilityProof
    }
    /** A hiding focus value, at any age: the Worker answers its value-free page and never reads the fragments. */
    | {kind: 'hiding'; currentFocus: string; focusAgeMs: number}
    /** `detail`: for `focus-stale`, why the fragments did not prove visibility (a fragments reason, or `summary-<summary>`). */
    | {kind: 'focus-unreadable'; reason: FocusRefusal; detail?: string}
    /** `detail`: for `shell-misfit`, which check failed (shell.ts `fitsShell`). */
    | {kind: 'refused'; reason: FragmentsRefusal; detail?: string; focusAgeMs: number}
  )
  & {timing: PublishedTiming}

/** Which evidence admitted a visible answer (atlas decision 0170). Value-free: safe for the log line. */
export type VisibilityProof = 'focus-key' | 'fragments'

export interface PublishedReadOptions {
  store: PageStore
  nowMs: number
  /** The build whose fragments the Worker reads: its own (or the fixture seam's). */
  build: string
  /** The compiled shell the fragments must fit (./compiled-shell.ts). */
  shell: Shell
  /** The hiding focus values (portal-contract HIDING_FOCUS_MODES). */
  hidingModes: ReadonlySet<string>
}

/**
 * Whether a composition with each summary carries data values. Keyed by every SsrSummary, so a new
 * summary must take a side. The composer emits a data-bearing composition only when its focus read
 * was visible and no gated export answered the gate's suppression body; every other run publishes a
 * value-free variant (`unavailable` or `suppressed`). Defined here, not in render-model.ts, so the
 * Worker graph gains no view-model module.
 */
const SUMMARY_BEARS_DATA = {live: true, stale: true, partial: true, unavailable: false, suppressed: false} as const satisfies Record<SsrSummary, boolean>

const SUMMARIES: ReadonlySet<string> = new Set(Object.keys(SUMMARY_BEARS_DATA))

/** The data-bearing summaries: fragments with one prove a visible focus and an open gate at `composedAt`. */
export const DATA_BEARING_SUMMARIES: ReadonlySet<SsrSummary> = new Set(
  // The `satisfies` above makes the keys exactly SsrSummary; Object.keys widens them to string.
  (Object.keys(SUMMARY_BEARS_DATA) as SsrSummary[]).filter((summary) => SUMMARY_BEARS_DATA[summary])
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * The `focus` value as the Worker judges it at `nowMs`: readable, or why not. Its age is not judged
 * here: a hiding value answers at any age, and a visible one older than 690 s needs the fragments'
 * proof (`readPublished`).
 */
function judgeFocus(
  text: string | null,
  nowMs: number
): {ok: true; currentFocus: string; ageMs: number} | {ok: false; reason: Exclude<FocusRefusal, 'focus-stale'>} {
  if (text === null) {
    return {ok: false, reason: 'focus-missing'}
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {ok: false, reason: 'focus-shape'}
  }
  if (!isRecord(value) || typeof value.currentFocus !== 'string' || typeof value.publishedAt !== 'string') {
    return {ok: false, reason: 'focus-shape'}
  }
  const publishedMs = Date.parse(value.publishedAt)
  if (!Number.isFinite(publishedMs)) {
    return {ok: false, reason: 'focus-shape'}
  }
  if (publishedMs - nowMs > COMPOSED_MAX_FUTURE_SKEW_MS) {
    return {ok: false, reason: 'focus-future'}
  }
  return {ok: true, currentFocus: value.currentFocus, ageMs: nowMs - publishedMs}
}

/** The wire facts, when every fragment id is a key of `scopes` and `roots` with string arrays. */
function isWireFacts(value: unknown): value is WireFacts {
  if (!isRecord(value) || !isStrings(value.ids) || !isRecord(value.scopes) || !isRecord(value.roots)) {
    return false
  }
  const {scopes, roots} = value
  return COMPOSED_FRAGMENT_IDS.every((id) => {
    const root = roots[id]
    return isStrings(scopes[id]) && isRecord(root) && isStrings(root.classes) && isStrings(root.scopes)
  })
}

type FragmentsJudgement =
  | {ok: true; fragments: Record<ComposedFragmentId, string>; summary: SsrSummary; ageMs: number}
  | {ok: false; reason: FragmentsRefusal; detail?: string}

/**
 * The `fragments:<build>` entry as the Worker judges it: the metadata first (build, age), then the
 * size, then the value's shape, then the facts against the compiled shell. The fragments themselves
 * are not checked against the allowlist here: this build's composer checked them before it
 * published them (atlas decision 0164; compose.ts `checked`).
 */
function judgeFragments(entry: {value: string | null; metadata: unknown}, options: PublishedReadOptions): FragmentsJudgement {
  const {value, metadata} = entry
  if (value === null) {
    return {ok: false, reason: 'fragments-missing'}
  }
  if (!isRecord(metadata) || typeof metadata.build !== 'string' || typeof metadata.composedAt !== 'string' || typeof metadata.summary !== 'string') {
    return {ok: false, reason: 'fragments-shape'}
  }
  // `unknown` is the id of a build without one; two of them never prove the same build (review L9).
  if (metadata.build !== options.build || options.build === 'unknown') {
    return {ok: false, reason: 'fragments-build'}
  }
  const composedMs = Date.parse(metadata.composedAt)
  if (!Number.isFinite(composedMs)) {
    return {ok: false, reason: 'fragments-shape'}
  }
  if (composedMs - options.nowMs > COMPOSED_MAX_FUTURE_SKEW_MS) {
    return {ok: false, reason: 'fragments-future'}
  }
  if (options.nowMs - composedMs > COMPOSED_MAX_AGE_MS) {
    return {ok: false, reason: 'fragments-stale'}
  }
  // A UTF-16 length above the cap is above it in bytes too; one under a third of it is under it.
  if (value.length > PUBLISHED_MAX_BYTES || (value.length * 3 > PUBLISHED_MAX_BYTES && utf8Bytes(value) > PUBLISHED_MAX_BYTES)) {
    return {ok: false, reason: 'fragments-oversize'}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return {ok: false, reason: 'fragments-shape'}
  }
  if (!isRecord(parsed) || !isRecord(parsed.fragments) || typeof parsed.summary !== 'string' || !SUMMARIES.has(parsed.summary)) {
    return {ok: false, reason: 'fragments-shape'}
  }
  const fragments = parsed.fragments
  if (parsed.summary !== metadata.summary || !COMPOSED_FRAGMENT_IDS.every((id) => typeof fragments[id] === 'string') || !isWireFacts(parsed.facts)) {
    return {ok: false, reason: 'fragments-shape'}
  }
  const misfit = fitsShell(options.shell, fromWireFacts(parsed.facts))
  if (misfit !== null) {
    return {ok: false, reason: 'shell-misfit', detail: misfit}
  }
  return {
    ok: true,
    // Every id was checked to be a string, and the summary against the closed set, above.
    fragments: fragments as Record<ComposedFragmentId, string>,
    summary: parsed.summary as SsrSummary,
    ageMs: options.nowMs - composedMs
  }
}

/** A KV read with the time it took; a throw becomes `failed`. */
async function timed<T>(read: () => Promise<T>): Promise<{ok: true; value: T; ms: number} | {ok: false; ms: number}> {
  const started = Date.now()
  try {
    const value = await read()
    return {ok: true, value, ms: Date.now() - started}
  } catch {
    return {ok: false, ms: Date.now() - started}
  }
}

/**
 * One request's read of the published page data (atlas decision 0164, Variant D; atlas decision
 * 0170). Both keys are requested together. The `focus` value is judged first:
 *
 * 1. Missing, malformed, more than 300 s ahead, or a failed read: `focus-unreadable`.
 * 2. A hiding value, at any age: `hiding`.
 *
 * In both, the fragments value is never parsed, inspected, spliced or logged.
 *
 * 3. A visible value within 690 s: the fragments are judged (`judgeFragments`) and served whatever
 *    their summary, proof `focus-key`.
 * 4. A visible value older than 690 s: the fragments are judged the same way and served only with a
 *    data-bearing summary, proof `fragments`. The composer publishes one only under a visible focus
 *    and an open gate, and `judgeFragments` holds `composedAt` within 690 s, so the bound is the one
 *    a fresh `focus` value gives. Anything else fails closed: `focus-unreadable`, `focus-stale`.
 *
 * Rules 1 to 3 add no work to the read; rule 4 reuses `judgeFragments`. The reads have no
 * budget of their own: a read that stalls ends at the Worker's 3 s ceiling (SSR_CEILING_MS), which
 * answers the data-free page. No Cache API, no `waitUntil`, no copy kept between requests.
 *
 * Trust: the Worker does not run the allowlist on these fragments. `fitsShell` checks the facts the
 * writer reports, which catches a composer and shell of different builds, not a wrong or hostile
 * writer: the guarantee is that only the backend runner can write the namespace (atlas decision 0164).
 */
export async function readPublished(options: PublishedReadOptions): Promise<PublishedRead> {
  const {store, nowMs, build} = options
  const focusRead = timed(() => store.get(PUBLISHED_FOCUS_KEY, {type: 'text', cacheTtl: FOCUS_CACHE_TTL_S}))
  const fragmentsRead = timed(() => store.getWithMetadata(publishedFragmentsKey(build), {type: 'text'}))
  const focusLeg = await focusRead
  const focus = focusLeg.ok ? judgeFocus(focusLeg.value, nowMs) : {ok: false as const, reason: 'focus-error' as const}
  if (!focus.ok) {
    return {kind: 'focus-unreadable', reason: focus.reason, timing: {focusMs: focusLeg.ms, fragmentsMs: null}}
  }
  if (options.hidingModes.has(focus.currentFocus)) {
    return {kind: 'hiding', currentFocus: focus.currentFocus, focusAgeMs: focus.ageMs, timing: {focusMs: focusLeg.ms, fragmentsMs: null}}
  }
  const fragmentsLeg = await fragmentsRead
  const timing = {focusMs: focusLeg.ms, fragmentsMs: fragmentsLeg.ms}
  if (focus.ageMs > COMPOSED_MAX_AGE_MS) {
    const judged = fragmentsLeg.ok ? judgeFragments(fragmentsLeg.value, options) : {ok: false as const, reason: 'fragments-error' as const}
    if (!judged.ok) {
      return {
        kind: 'focus-unreadable',
        reason: 'focus-stale',
        detail: judged.detail === undefined ? judged.reason : `${judged.reason}:${judged.detail}`,
        timing
      }
    }
    if (!DATA_BEARING_SUMMARIES.has(judged.summary)) {
      return {kind: 'focus-unreadable', reason: 'focus-stale', detail: `summary-${judged.summary}`, timing}
    }
    return {
      kind: 'ok',
      fragments: judged.fragments,
      summary: judged.summary,
      focusAgeMs: focus.ageMs,
      fragmentsAgeMs: judged.ageMs,
      proof: 'fragments',
      timing
    }
  }
  if (!fragmentsLeg.ok) {
    return {kind: 'refused', reason: 'fragments-error', focusAgeMs: focus.ageMs, timing}
  }
  const judged = judgeFragments(fragmentsLeg.value, options)
  if (!judged.ok) {
    return judged.detail === undefined
      ? {kind: 'refused', reason: judged.reason, focusAgeMs: focus.ageMs, timing}
      : {kind: 'refused', reason: judged.reason, detail: judged.detail, focusAgeMs: focus.ageMs, timing}
  }
  return {
    kind: 'ok',
    fragments: judged.fragments,
    summary: judged.summary,
    focusAgeMs: focus.ageMs,
    fragmentsAgeMs: judged.ageMs,
    proof: 'focus-key',
    timing
  }
}
