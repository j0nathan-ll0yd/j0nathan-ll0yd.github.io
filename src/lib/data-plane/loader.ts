// The dashboard loader (atlas decision 0160, plan Step 4.2): one bounded read of the focus signal and
// the eight gated exports, for one server render of `/`.
//
// Order and rules:
// 1. Read focus.json at the data-plane origin, no-store, within FOCUS_TIMEOUT_MS.
// 2. A hiding value suppresses every gated domain; an unreadable value makes every gated domain
//    unavailable. Neither path fetches a gated export.
// 3. A visible value starts the eight export reads together, no-store. Workers allows six open
//    connections per request, so two wait in the runtime's queue. Each read has ARTIFACT_TIMEOUT_MS
//    and all I/O ends by IO_BUDGET_MS; a late export is unavailable.
// 4. A 403 suppression body from ANY export suppresses the whole page: the gate wins. A 200 that
//    Cloudflare served from its own cache, or that carries no `x-amz-cf-id`, is refused (that
//    export is unavailable).
// 5. Each export is decoded against the published contract; a failure marks that export only.
//    There is no retry and no last-known-good copy (decision 0160, D3).
//
// The loader returns decoded exports and value-free outcomes. It renders nothing and judges no
// freshness: `./render-model.ts` maps the result through the design system's view models.
import {ENDPOINTS, HIDING_FOCUS_MODES, type ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import {type ArtifactValues, decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import {
  DeadlineError,
  discardBody,
  errorClass,
  GATED_FETCH_INIT,
  isSuppressionBody,
  type RequestBudget,
  startBudget,
  successRefusal,
  withDeadline
} from './admission'

/** The eight gated exports, in the order the log line lists them. */
export const GATED_KEYS = Object.freeze([
  'health',
  'sleep',
  'workouts',
  'books',
  'githubEvents',
  'starredRepos',
  'articles',
  'theatreReviews'
] as const satisfies readonly Exclude<ResourceKey, 'focus'>[])

export type GatedKey = (typeof GATED_KEYS)[number]

/** The wall-clock bounds of one load. Exported so tests assert against the real numbers. */
export const LOADER_TIMEOUTS = Object.freeze({
  /** The focus read, body included. */
  focusMs: 1_000,
  /** One export read, body included. */
  artifactMs: 2_000,
  /** Every read of one load, the focus read included. */
  ioBudgetMs: 2_500
})

const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)

/** Why an export or the focus signal could not be admitted. Value-free: safe for the log line. */
export type ReadFailure =
  | 'timeout'
  | 'network'
  | 'cloudflare-cache'
  | 'no-cloudfront-id'
  | 'non-200-success'
  | 'decode'
  | 'focus-unreadable'
  | `http-${number}`

export type DomainOutcome<K extends GatedKey = GatedKey> =
  | {kind: 'ok'; data: ArtifactValues[K]}
  | {kind: 'suppressed'}
  | {kind: 'unavailable'; reason: ReadFailure}

export type FocusOutcome =
  | {state: 'visible'; data: ArtifactValues['focus']}
  | {state: 'hiding'; data: ArtifactValues['focus']}
  | {state: 'unreadable'; reason: ReadFailure}

export interface DashboardLoad {
  focus: FocusOutcome
  domains: { [K in GatedKey]: DomainOutcome<K> }
  /** True when any suppression signal arrived: a hiding focus value or a gate suppression body. */
  suppressed: boolean
  /** Wall-clock time the reads took, in milliseconds. */
  ioMs: number
}

export interface LoadOptions {
  /** The data-plane origin (`dataPlaneBase`), without a trailing slash. */
  base: string
  /** The fetch to use. Tests pass a stub; the Worker passes nothing. */
  fetch?: typeof fetch
  /** Overrides the bounds, for tests only. */
  timeouts?: Partial<typeof LOADER_TIMEOUTS>
}

type ReadResult<T> = {kind: 'ok'; data: T} | {kind: 'suppressed'} | {kind: 'unavailable'; reason: ReadFailure}

function failureOf(error: unknown): ReadFailure {
  return error instanceof DeadlineError || errorClass(error) === 'AbortError' ? 'timeout' : 'network'
}

/**
 * One bounded, admitted, decoded read. `gated` is false only for the focus signal, which the gate
 * never gates; it is read with the same no-store options and the same admission rules, so a copy
 * Cloudflare served from its own cache is refused there too.
 */
async function readArtifact<K extends ResourceKey>(
  key: K,
  {base, fetchImpl, capMs, budget}: {base: string; fetchImpl: typeof fetch; capMs: number; budget: RequestBudget}
): Promise<ReadResult<ArtifactValues[K]>> {
  const url = `${base}${ENDPOINTS[key]}`
  const deadline = () => Math.min(capMs, budget.remainingMs())
  let response: Response
  try {
    response = await withDeadline((signal) => fetchImpl(url, {...GATED_FETCH_INIT, signal}), deadline(), `${key} fetch`)
  } catch (error) {
    return {kind: 'unavailable', reason: failureOf(error)}
  }
  if (response.status === 403 && key !== 'focus' && await isSuppressionBody(response, deadline(), `${key} 403 body`)) {
    return {kind: 'suppressed'}
  }
  if (!response.ok) {
    discardBody(response)
    return {kind: 'unavailable', reason: `http-${response.status}`}
  }
  const refusal = successRefusal(response)
  if (refusal) {
    discardBody(response)
    return {kind: 'unavailable', reason: refusal}
  }
  let body: unknown
  try {
    body = await withDeadline(() => response.json() as Promise<unknown>, deadline(), `${key} body`)
  } catch (error) {
    return {kind: 'unavailable', reason: error instanceof DeadlineError ? 'timeout' : 'decode'}
  }
  try {
    return {kind: 'ok', data: decodeArtifact(key, body)}
  } catch {
    return {kind: 'unavailable', reason: 'decode'}
  }
}

function allDomains<T>(value: (key: GatedKey) => T): Record<GatedKey, T> {
  return Object.fromEntries(GATED_KEYS.map((key) => [key, value(key)])) as Record<GatedKey, T>
}

/** Reads the focus signal and, when it reads visible, the eight gated exports. Never throws. */
export async function loadDashboard(options: LoadOptions): Promise<DashboardLoad> {
  const startedAt = Date.now()
  const timeouts = {...LOADER_TIMEOUTS, ...options.timeouts}
  const fetchImpl = options.fetch ?? fetch
  const budget = startBudget(timeouts.ioBudgetMs)
  const io = {base: options.base, fetchImpl, budget}

  const focusRead = await readArtifact('focus', {...io, capMs: timeouts.focusMs})
  if (focusRead.kind !== 'ok') {
    // The focus signal is never gated, so a suppression body cannot arrive here; any failure is
    // unreadable. The gate fails closed: an unreadable signal is never permission to read.
    const reason = focusRead.kind === 'unavailable' ? focusRead.reason : 'focus-unreadable'
    return {
      focus: {state: 'unreadable', reason},
      domains: allDomains(() => ({kind: 'unavailable', reason: 'focus-unreadable'})) as DashboardLoad['domains'],
      suppressed: false,
      ioMs: Date.now() - startedAt
    }
  }
  if (HIDING_FOCUS_MODE_SET.has(focusRead.data.currentFocus)) {
    return {
      focus: {state: 'hiding', data: focusRead.data},
      domains: allDomains(() => ({kind: 'suppressed'})) as DashboardLoad['domains'],
      suppressed: true,
      ioMs: Date.now() - startedAt
    }
  }

  const reads = await Promise.all(GATED_KEYS.map((key) => readArtifact(key, {...io, capMs: timeouts.artifactMs})))
  const domains = Object.fromEntries(GATED_KEYS.map((key, index) => [key, reads[index]])) as DashboardLoad['domains']
  const suppressed = reads.some((read) => read.kind === 'suppressed')
  return {
    focus: {state: 'visible', data: focusRead.data},
    // The gate wins every disagreement: one suppression body suppresses every domain, so no value
    // that a sibling read admitted reaches the page.
    domains: suppressed ? (allDomains(() => ({kind: 'suppressed'})) as DashboardLoad['domains']) : domains,
    suppressed,
    ioMs: Date.now() - startedAt
  }
}
