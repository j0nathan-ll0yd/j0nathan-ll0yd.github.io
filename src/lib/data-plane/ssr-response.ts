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
// page (D13) and every data state answers 200, with no edge or browser cache (D3). One value-free
// `ssr_render` log line per request (Step 4.6).
//
// `HEAD /` answers from the data-free page's headers and reads no data. It omits `X-SSR-Data`, whose
// value exists only once a body is chosen (RFC 9110 section 9.3.2 allows that).
import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import type {ValueFreeSet} from '../composed/artifact'
import type {ComposedRead} from '../composed/read'
import {assemble, scopesMatch, type Shell, shellFor} from '../composed/shell'
import {valueFreeVariant} from '../composed/value-free'
import {DATA_FREE_PAGE_PATH} from '../composed/paths'
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
 * The cache policy of every answer to `/`, data-bearing or not (D3: no edge HTML cache). `no-cache`
 * lets a browser keep the document for back/forward navigation but never reuse it unrevalidated;
 * the two CDN headers keep every shared cache from storing it.
 */
export const DASHBOARD_CACHE_HEADERS: readonly (readonly [string, string])[] = Object.freeze([
  ['Cache-Control', 'no-cache'],
  ['CDN-Cache-Control', 'no-store'],
  ['Cloudflare-CDN-Cache-Control', 'no-store']
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
  valueFree?: () => Promise<ValueFreeSet | null>
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
  /** What the Worker served: the composed page, a value-free page, or the data-free page and why. */
  served?: 'composed' | 'value-free' | 'data-free'
  focus_read?: string
  artifact?: string
  composed_age_ms?: number
}

function logRender(line: SsrLogLine): void {
  logger.info('ssr_render', line)
}

function withDashboardHeaders(source: Headers, summary: string | null): Headers {
  const headers = new Headers(source)
  for (const name of ASSET_VALIDATORS) {
    headers.delete(name)
  }
  for (const [name, value] of DASHBOARD_CACHE_HEADERS) {
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

type Outcome =
  | {kind: 'composed'; body: string; headers: Headers; summary: string; record: SsrRenderRecord; ioMs: number; ageMs: number}
  | {kind: 'value-free'; body: string; headers: Headers; summary: 'suppressed' | 'unavailable'; focus: string; artifact: string; ioMs: number}
  | {kind: 'data-free'; summary: 'suppressed' | 'unavailable' | 'fallback'; focus: string; artifact: string; ioMs: number}
  | {kind: 'failed'; status: number; errorClass: string}
  | {kind: 'ceiling'}

function shellOf(deps: DashboardRenderDeps): Promise<Shell> {
  return (deps.shell ?? (() => shellFor(BUILD_ID, () => deps.asset(DATA_FREE_PAGE_PATH, 'GET'))))()
}

async function attempt(request: Request, deps: DashboardRenderDeps): Promise<Outcome> {
  const started = Date.now()
  try {
    const nowMs = deps.now(request)
    const read = await deps.read(request, nowMs)
    const ioMs = Date.now() - started
    if (read.kind === 'suppressed' || read.kind === 'focus-unreadable') {
      const summary = read.kind === 'suppressed' ? 'suppressed' : 'unavailable'
      const focus = read.kind === 'focus-unreadable' ? 'unreadable' : read.currentFocus === null ? 'gate' : 'hiding'
      const artifact = read.kind === 'suppressed' ? 'suppressed' : 'not-read'
      const set = await deps.valueFree?.() ?? null
      const page = set === null ? null : valueFreeVariant(set, read)
      if (page === null || page.summary !== summary) {
        return {kind: 'data-free', summary, focus, artifact: `${artifact}:value-free-missing`, ioMs}
      }
      const shell = await shellOf(deps)
      if (!scopesMatch(shell, page.fragments)) {
        return {kind: 'data-free', summary, focus, artifact: `${artifact}:value-free-scopes`, ioMs}
      }
      return {kind: 'value-free', body: assemble(shell, page.fragments, summary), headers: shell.headers, summary, focus, artifact, ioMs}
    }
    if (read.kind !== 'ok') {
      const reason = read.kind === 'refused' ? `refused:${read.refusal}` : `unavailable:http-${read.status}`
      return {kind: 'data-free', summary: 'fallback', focus: 'visible', artifact: reason, ioMs}
    }
    const shell = await shellOf(deps)
    const value = read.artifact
    if (!scopesMatch(shell, value.fragments)) {
      return {kind: 'data-free', summary: 'fallback', focus: 'visible', artifact: 'refused:scopes', ioMs}
    }
    return {
      kind: 'composed',
      body: assemble(shell, value.fragments, value.summary),
      headers: shell.headers,
      summary: value.summary,
      record: value.record,
      ioMs,
      ageMs: nowMs - Date.parse(value.composedAt)
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
  try {
    return await answerDashboard(request, deps)
  } catch (error) {
    // Only a failed read of a built page reaches here (the data-free page or the 500 page).
    logRender({
      event: 'ssr_render',
      summary: 'error',
      status: 500,
      render_ms: 0,
      total_ms: 0,
      build: BUILD_ID,
      error_class: error instanceof Error ? error.name : 'UnknownError'
    })
    return bareError()
  }
}

async function answerDashboard(request: Request, deps: DashboardRenderDeps): Promise<Response> {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const ceiling = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({kind: 'ceiling'}), deps.ceilingMs ?? SSR_CEILING_MS)
  })
  const outcome = await Promise.race([attempt(request, deps), ceiling])
  clearTimeout(timer)
  const totalMs = Date.now() - startedAt
  const base = {event: 'ssr_render' as const, total_ms: totalMs, build: BUILD_ID}

  if (outcome.kind === 'composed') {
    logRender({
      ...outcome.record,
      ...base,
      summary: outcome.summary,
      served: 'composed',
      status: 200,
      io_ms: outcome.ioMs,
      render_ms: Math.max(0, totalMs - outcome.ioMs),
      composed_age_ms: outcome.ageMs
    })
    return new Response(outcome.body, {status: 200, headers: withDashboardHeaders(outcome.headers, outcome.summary)})
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
