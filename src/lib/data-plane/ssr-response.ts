// The Worker's answer to `GET /` and `HEAD /` (atlas decision 0160, PR B; plan Steps 4.3 to 4.6;
// owner decision 2026-10-16, option 1: the PRECOMPOSED PAGE).
//
// The Worker renders nothing. A backend composer renders the live cards whenever the data changes and
// stores them beside the exports, behind the same CloudFront gate (src/lib/composed/artifact.ts). For
// `GET /` the Worker reads the focus signal and, when it reads visible, the composed artifact, as the
// proxy routes read their documents (src/lib/composed/read.ts). Then:
//
// - visible, and the artifact is admitted, fresh and built for this website: the data-free page with
//   the artifact's fragments spliced in (src/lib/composed/shell.ts), `X-SSR-Data` = its summary;
// - hiding, or a gate suppression body: the value-free suppressed page for that hiding value (its
//   overlay shown) or for the gate (no overlay), `X-SSR-Data: suppressed`;
// - an unreadable focus signal: the value-free page with every card unavailable, `X-SSR-Data: unavailable`;
// - an artifact that is missing, failed, refused or stale: the data-free page, `X-SSR-Data: fallback`.
//
// The value-free pages come from the website build (src/lib/composed/value-free.ts). When they cannot
// be used, the data-free page answers with the same summary.
//
// The whole answer is bounded by SSR_CEILING_MS (D2) and buffered, so a failure becomes a clean 500
// page (D13) and every data state answers 200, with no edge cache (D3); the composed page is no-store
// in the browser too (COMPOSED_CACHE_HEADERS). One value-free
// `ssr_render` log line per request (Step 4.6).
//
// With the `PAGE` KV binding and a compiled shell (atlas decision 0164, Variant D), `GET /` reads the
// published page data instead (`attemptPublished`, src/lib/composed/published.ts): the same answers,
// from the `focus` key and the `fragments:<build>` entry, spliced into the shell compiled into the
// Worker. The artifact read above stays as the rollback until Phase 4.
//
// `HEAD /` answers from the data-free page's headers and reads no data. It omits `X-SSR-Data`, whose
// value exists only once a body is chosen (RFC 9110 section 9.3.2 allows that).
import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import type {CheckedValueFreeSet} from '../composed/artifact'
import type {PublishedRead, VisibilityProof} from '../composed/published'
import type {ComposedRead} from '../composed/read'
import {assemble, fitsShell, type Shell, shellFor} from '../composed/shell'
import {valueFreeVariant} from '../composed/value-free'
import {DATA_FREE_PAGE_PATH} from '../composed/paths'
import {LLM_OUTPUT_CACHE_POLICY} from '../edge/proxy'
import {BUILD_ID} from './build'
import type {SsrRenderRecord} from './render-model'

export { DATA_FREE_PAGE_PATH }
/** The prerendered 500 page (src/pages/500.astro). */
export const ERROR_PAGE_PATH = '/500'

/** The summary header. Values: SsrSummary, plus `fallback` and `error`. */
export const SSR_DATA_HEADER = 'X-SSR-Data'

/** D2's hard ceiling: 2.5 s of I/O (LOADER_TIMEOUTS.ioBudgetMs) plus a 0.5 s render reserve. */
export const SSR_CEILING_MS = 3_000

/**
 * The cache policy of an answer to `/` that carries no data value: the data-free page and the
 * value-free pages (D3: no edge HTML cache). `no-cache` lets a browser keep the document for
 * back/forward navigation but never reuse it unrevalidated; the two CDN headers keep every shared
 * cache from storing it.
 */
export const DASHBOARD_CACHE_HEADERS: readonly (readonly [string, string])[] = Object.freeze([
  ['Cache-Control', 'no-cache'],
  ['CDN-Cache-Control', 'no-store'],
  ['Cloudflare-CDN-Cache-Control', 'no-store']
])

/**
 * The cache policy of the composed page, which carries gated values: no-store at the browser, the
 * generic CDN and Cloudflare, the policy of every gated proxy route (src/lib/edge/proxy.ts
 * LLM_OUTPUT_CACHE_POLICY). `no-cache` let a browser write the values to disk and replay them from
 * history or session restore after the focus value turned hiding (review 2026-10-16, M1).
 */
export const COMPOSED_CACHE_HEADERS: readonly (readonly [string, string])[] = Object.freeze([
  ['Cache-Control', LLM_OUTPUT_CACHE_POLICY.cacheControl],
  ['CDN-Cache-Control', LLM_OUTPUT_CACHE_POLICY.cdnCacheControl ?? LLM_OUTPUT_CACHE_POLICY.cacheControl],
  ['Cloudflare-CDN-Cache-Control', LLM_OUTPUT_CACHE_POLICY.cdnCacheControl ?? LLM_OUTPUT_CACHE_POLICY.cacheControl]
])

/** Headers of a static file that must not describe a per-request document. */
const ASSET_VALIDATORS = ['ETag', 'Last-Modified', 'Age', 'CF-Cache-Status']

const logger = createEdgeLogger({service: 'ssr-dashboard'})

export interface DashboardRenderDeps {
  /** Reads the focus signal and the composed artifact for this request (src/lib/composed/read.ts). */
  read(request: Request, nowMs: number): Promise<ComposedRead>
  /** The serving time for this request: Date.now(), or the X-SSR-Clock test seam. */
  now(request: Request): number
  /** Reads a built file from the static-asset plane (the ASSETS binding). */
  asset(path: string, method: 'GET' | 'HEAD'): Promise<Response>
  /** Overrides the ceiling, for tests only. */
  ceilingMs?: number
  /** Overrides the shell, for tests that run outside workerd (Node has no HTMLRewriter). */
  shell?: () => Promise<Shell>
  /** The build's value-free pages (src/lib/composed/value-free.ts), or null when they cannot be used. */
  valueFree?: () => Promise<CheckedValueFreeSet | null>
  /**
   * The published page data (atlas decision 0164, Variant D): present when the Worker has the `PAGE`
   * KV binding and a compiled shell (src/lib/composed/compiled-shell.ts). Then `read` and the
   * run-time shell cut are not used; without it the Worker serves `/` from the composed artifact.
   */
  published?: {read(request: Request, nowMs: number): Promise<PublishedRead>; shell: Shell}
}

/** The fields of one `ssr_render` log line. No field carries a data value. */
export type SsrLogLine = Omit<Partial<SsrRenderRecord>, 'summary'> & {
  event: 'ssr_render'
  summary: string
  status: number
  render_ms: number
  total_ms: number
  build: string
  error_class?: string
  /**
   * True on the first `GET /` answer this isolate gives, false after: the soak's cold marker (atlas
   * decision 0164). The run-time shell cut, the old marker, is gone on the published path.
   */
  isolate_first: boolean
  /** Which read served `/`: the published KV values (atlas decision 0164) or the composed artifact (the rollback). */
  read_path: 'published' | 'artifact'
  /** What the Worker served: the composed page, the published page, a value-free page, or the data-free page and why. */
  served?: 'composed' | 'published' | 'value-free' | 'data-free'
  focus_read?: string
  artifact?: string
  /** Wall-clock ms until the focus probe answered (the read runs it beside the artifact fetch). */
  focus_ms?: number
  /** Wall-clock ms until the artifact leg answered; absent when focus did not read visible. */
  artifact_ms?: number
  composed_age_ms?: number
  /** Wall-clock ms of the `focus` KV read (atlas decision 0164). */
  focus_kv_ms?: number
  /** Wall-clock ms of the `fragments:<build>` KV read; absent when focus did not read visible. */
  fragments_kv_ms?: number
  /** Age of the `focus` value (its `publishedAt`), when it was readable. */
  focus_age_ms?: number
  /** Age of the fragments (their `composedAt`), when they were served. */
  fragments_age_ms?: number
  /**
   * Which evidence admitted a published answer (atlas decision 0170): `focus-key`, a visible `focus`
   * value within 690 s, or `fragments`, data-bearing fragments within 690 s under an older visible one.
   */
  visibility_proof?: VisibilityProof
}

function logRender(line: SsrLogLine): void {
  logger.info('ssr_render', line)
}

/** Whether this isolate has answered `GET /` yet. Module state: one value per isolate. */
let answeredOnIsolate = false

/** True for the first `GET /` on this isolate, false for every later one. `HEAD /` renders nothing and does not count. */
function takeIsolateFirst(): boolean {
  const first = !answeredOnIsolate
  answeredOnIsolate = true
  return first
}

function withDashboardHeaders(source: Headers, summary: string | null, policy = DASHBOARD_CACHE_HEADERS): Headers {
  const headers = new Headers(source)
  for (const name of ASSET_VALIDATORS) {
    headers.delete(name)
  }
  for (const [name, value] of policy) {
    headers.set(name, value)
  }
  // Pages served the document with its charset; Astro's on-demand response and the asset plane omit it.
  headers.set('Content-Type', 'text/html; charset=utf-8')
  if (summary === null) {
    headers.delete(SSR_DATA_HEADER)
  } else {
    headers.set(SSR_DATA_HEADER, summary)
  }
  return headers
}

/** The read's two legs as log fields. */
type LegFields = Pick<SsrLogLine, 'focus_ms' | 'artifact_ms' | 'focus_kv_ms' | 'fragments_kv_ms' | 'focus_age_ms' | 'fragments_age_ms'>

function legFields(read: ComposedRead): LegFields {
  if (read.timing === undefined) {
    return {}
  }
  return read.timing.artifactMs === null ? {focus_ms: read.timing.focusMs} : {focus_ms: read.timing.focusMs, artifact_ms: read.timing.artifactMs}
}

type Outcome =
  | {kind: 'composed'; body: string; headers: Headers; summary: string; record: SsrRenderRecord; ioMs: number; ageMs: number; legs: LegFields}
  | {kind: 'published'; body: string; headers: Headers; summary: string; proof: VisibilityProof; ioMs: number; legs: LegFields}
  | {
    kind: 'value-free'
    body: string
    headers: Headers
    summary: 'suppressed' | 'unavailable'
    focus: string
    artifact: string
    ioMs: number
    legs: LegFields
  }
  | {kind: 'data-free'; summary: 'suppressed' | 'unavailable' | 'fallback'; focus: string; artifact: string; ioMs: number; legs: LegFields}
  | {kind: 'failed'; status: number; errorClass: string}
  | {kind: 'ceiling'}

function shellOf(deps: DashboardRenderDeps): Promise<Shell> {
  return (deps.shell ?? (() => shellFor(BUILD_ID, () => deps.asset(DATA_FREE_PAGE_PATH, 'GET'))))()
}

/** The published read's legs and ages as log fields. */
function publishedLegs(read: PublishedRead): LegFields {
  const legs: LegFields = {focus_kv_ms: read.timing.focusMs}
  if (read.timing.fragmentsMs !== null) {
    legs.fragments_kv_ms = read.timing.fragmentsMs
  }
  if (read.kind !== 'focus-unreadable') {
    legs.focus_age_ms = read.focusAgeMs
  }
  if (read.kind === 'ok') {
    legs.fragments_age_ms = read.fragmentsAgeMs
  }
  return legs
}

/**
 * `GET /` from the published page data (atlas decision 0164, Variant D). The focus value decides
 * first (src/lib/composed/published.ts `readPublished`): a hiding or unreadable value answers its
 * value-free page, built into this website, and the fragments are never read. A visible value with
 * admitted fragments answers them spliced into the compiled shell, and the log line names the proof
 * that admitted them (`visibility_proof`). A visible value older than 690 s whose fragments do not
 * prove visibility reads unreadable (atlas decision 0170). Anything else answers the data-free
 * page, `fallback`.
 */
async function attemptPublished(request: Request, deps: DashboardRenderDeps, published: NonNullable<DashboardRenderDeps['published']>): Promise<Outcome> {
  const started = Date.now()
  try {
    const read = await published.read(request, deps.now(request))
    const ioMs = Date.now() - started
    const legs = publishedLegs(read)
    const {shell} = published
    if (read.kind === 'hiding' || read.kind === 'focus-unreadable') {
      const summary = read.kind === 'hiding' ? 'suppressed' : 'unavailable'
      const focus = read.kind === 'hiding' ? 'hiding' : 'unreadable'
      const artifact = read.kind === 'hiding'
        ? 'published:not-used'
        : `published:${read.reason}${read.detail === undefined ? '' : `:${read.detail}`}`
      const set = await deps.valueFree?.() ?? null
      const page = set === null
        ? null
        : valueFreeVariant(set, read.kind === 'hiding' ? {kind: 'suppressed', currentFocus: read.currentFocus} : {kind: 'focus-unreadable'})
      if (page === null || page.summary !== summary) {
        return {kind: 'data-free', summary, focus, artifact: `${artifact}:value-free-missing`, ioMs, legs}
      }
      const misfit = fitsShell(shell, page.facts)
      if (misfit !== null) {
        return {kind: 'data-free', summary, focus, artifact: `${artifact}:value-free-${misfit}`, ioMs, legs}
      }
      return {kind: 'value-free', body: assemble(shell, page.fragments, summary), headers: shell.headers, summary, focus, artifact, ioMs, legs}
    }
    if (read.kind === 'refused') {
      const artifact = `published:${read.reason}${read.detail === undefined ? '' : `:${read.detail}`}`
      return {kind: 'data-free', summary: 'fallback', focus: 'visible', artifact, ioMs, legs}
    }
    return {
      kind: 'published',
      body: assemble(shell, read.fragments, read.summary),
      headers: shell.headers,
      summary: read.summary,
      proof: read.proof,
      ioMs,
      legs
    }
  } catch (error) {
    return {kind: 'failed', status: 500, errorClass: error instanceof Error ? error.name : 'UnknownError'}
  }
}

async function attempt(request: Request, deps: DashboardRenderDeps): Promise<Outcome> {
  if (deps.published !== undefined) {
    return attemptPublished(request, deps, deps.published)
  }
  const started = Date.now()
  try {
    const nowMs = deps.now(request)
    const read = await deps.read(request, nowMs)
    const ioMs = Date.now() - started
    const legs = legFields(read)
    if (read.kind === 'suppressed' || read.kind === 'focus-unreadable') {
      const summary = read.kind === 'suppressed' ? 'suppressed' : 'unavailable'
      const focus = read.kind === 'focus-unreadable' ? 'unreadable' : read.currentFocus === null ? 'gate' : 'hiding'
      const artifact = read.kind === 'suppressed' ? 'suppressed' : 'not-read'
      const set = await deps.valueFree?.() ?? null
      const page = set === null ? null : valueFreeVariant(set, read)
      if (page === null || page.summary !== summary) {
        return {kind: 'data-free', summary, focus, artifact: `${artifact}:value-free-missing`, ioMs, legs}
      }
      const shell = await shellOf(deps)
      const misfit = fitsShell(shell, page.facts)
      if (misfit !== null) {
        return {kind: 'data-free', summary, focus, artifact: `${artifact}:value-free-${misfit}`, ioMs, legs}
      }
      return {kind: 'value-free', body: assemble(shell, page.fragments, summary), headers: shell.headers, summary, focus, artifact, ioMs, legs}
    }
    if (read.kind !== 'ok') {
      const reason = read.kind === 'unavailable'
        ? `unavailable:http-${read.status}`
        : `refused:${read.refusal}${read.detail === undefined ? '' : `:${read.detail}`}`
      return {kind: 'data-free', summary: 'fallback', focus: 'visible', artifact: reason, ioMs, legs}
    }
    const shell = await shellOf(deps)
    const value = read.artifact
    const misfit = fitsShell(shell, read.facts)
    if (misfit !== null) {
      return {kind: 'data-free', summary: 'fallback', focus: 'visible', artifact: `refused:${misfit}`, ioMs, legs}
    }
    return {
      kind: 'composed',
      body: assemble(shell, value.fragments, value.summary),
      headers: shell.headers,
      summary: value.summary,
      record: value.record,
      ioMs,
      ageMs: nowMs - Date.parse(value.composedAt),
      legs
    }
  } catch (error) {
    return {kind: 'failed', status: 500, errorClass: error instanceof Error ? error.name : 'UnknownError'}
  }
}

/** The data-free page (dist/client/index.html) as the answer to `/`, with the dashboard's headers. */
async function dataFreePage(method: 'GET' | 'HEAD', summary: string | null, deps: DashboardRenderDeps): Promise<Response> {
  const page = await deps.asset(DATA_FREE_PAGE_PATH, method)
  return new Response(method === 'HEAD' ? null : page.body, {status: 200, headers: withDashboardHeaders(page.headers, summary)})
}

async function errorPage(deps: DashboardRenderDeps): Promise<Response> {
  const page = await deps.asset(ERROR_PAGE_PATH, 'GET')
  const headers = withDashboardHeaders(page.headers, 'error')
  // A failure answer is never stored anywhere, the browser included.
  headers.set('Cache-Control', 'no-store')
  return new Response(page.status === 200 ? page.body : 'Internal Server Error', {status: 500, headers})
}

/** The last answer when even a built page cannot be read: a bare 500, never a platform error. */
function bareError(): Response {
  return new Response('Internal Server Error', {
    status: 500,
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', [SSR_DATA_HEADER]: 'error'}
  })
}

/** Answers `GET /`: the composed page, or the data-free page, or the 500 page. */
export async function renderDashboard(request: Request, deps: DashboardRenderDeps): Promise<Response> {
  const isolateFirst = takeIsolateFirst()
  try {
    return await answerDashboard(request, deps, isolateFirst)
  } catch (error) {
    // Only a failed read of a built page reaches here (the data-free page or the 500 page).
    logRender({
      event: 'ssr_render',
      summary: 'error',
      status: 500,
      render_ms: 0,
      total_ms: 0,
      build: BUILD_ID,
      isolate_first: isolateFirst,
      read_path: deps.published === undefined ? 'artifact' : 'published',
      error_class: error instanceof Error ? error.name : 'UnknownError'
    })
    return bareError()
  }
}

async function answerDashboard(request: Request, deps: DashboardRenderDeps, isolateFirst: boolean): Promise<Response> {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const ceiling = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({kind: 'ceiling'}), deps.ceilingMs ?? SSR_CEILING_MS)
  })
  const outcome = await Promise.race([attempt(request, deps), ceiling])
  clearTimeout(timer)
  const totalMs = Date.now() - startedAt
  const base = {
    event: 'ssr_render' as const,
    total_ms: totalMs,
    build: BUILD_ID,
    isolate_first: isolateFirst,
    read_path: deps.published === undefined ? 'artifact' as const : 'published' as const
  }

  if (outcome.kind === 'composed') {
    logRender({
      ...outcome.record,
      ...base,
      summary: outcome.summary,
      served: 'composed',
      status: 200,
      io_ms: outcome.ioMs,
      ...outcome.legs,
      render_ms: Math.max(0, totalMs - outcome.ioMs),
      composed_age_ms: outcome.ageMs
    })
    return new Response(outcome.body, {status: 200, headers: withDashboardHeaders(outcome.headers, outcome.summary, COMPOSED_CACHE_HEADERS)})
  }
  if (outcome.kind === 'published') {
    logRender({
      ...base,
      summary: outcome.summary,
      served: 'published',
      focus_read: 'visible',
      visibility_proof: outcome.proof,
      status: 200,
      io_ms: outcome.ioMs,
      ...outcome.legs,
      render_ms: Math.max(0, totalMs - outcome.ioMs)
    })
    return new Response(outcome.body, {status: 200, headers: withDashboardHeaders(outcome.headers, outcome.summary, COMPOSED_CACHE_HEADERS)})
  }
  if (outcome.kind === 'value-free') {
    logRender({
      ...base,
      summary: outcome.summary,
      served: 'value-free',
      focus_read: outcome.focus,
      artifact: outcome.artifact,
      status: 200,
      io_ms: outcome.ioMs,
      ...outcome.legs,
      render_ms: Math.max(0, totalMs - outcome.ioMs)
    })
    return new Response(outcome.body, {status: 200, headers: withDashboardHeaders(outcome.headers, outcome.summary)})
  }
  if (outcome.kind === 'data-free') {
    logRender({
      ...base,
      summary: outcome.summary,
      served: 'data-free',
      focus_read: outcome.focus,
      artifact: outcome.artifact,
      status: 200,
      io_ms: outcome.ioMs,
      ...outcome.legs,
      render_ms: Math.max(0, totalMs - outcome.ioMs)
    })
    return dataFreePage('GET', outcome.summary, deps)
  }
  if (outcome.kind === 'ceiling') {
    logRender({...base, summary: 'fallback', served: 'data-free', artifact: 'ceiling', status: 200, render_ms: totalMs})
    return dataFreePage('GET', 'fallback', deps)
  }
  logRender({...base, summary: 'error', status: 500, render_ms: totalMs, error_class: outcome.errorClass})
  return errorPage(deps)
}

/** Answers `HEAD /` from the data-free page's headers. Reads no data. */
export function headDashboard(deps: DashboardRenderDeps): Promise<Response> {
  return dataFreePage('HEAD', null, deps)
}
