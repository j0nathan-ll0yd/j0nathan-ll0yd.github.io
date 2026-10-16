// The Worker's answer to `GET /` and `HEAD /` (atlas decision 0160, PR B; plan Steps 4.3 to 4.6;
// owner decision 2026-10-16, option B: edge injection).
//
// `GET /` reads the focus signal and the eight exports (./loader.ts), maps them through the shared
// view models (./render-model.ts), and writes the result into the prerendered data-free page with
// HTMLRewriter (src/lib/edge-render/). Astro does not run per request. The Worker:
//
// 1. Bounds the whole render by SSR_CEILING_MS (D2: 2.5 s of I/O plus a 0.5 s render reserve). A
//    render that misses it is answered with the data-free page itself and `X-SSR-Data: fallback`.
// 2. Awaits every read before the first byte, then buffers the rewritten document before it answers.
//    A failure anywhere, a rewrite handler included, therefore becomes a clean 500 page (D13), never
//    a 200 whose document stops half-way or mixes two states.
// 3. Answers every data state 200 (D13), with no edge or browser cache (D3), the summary in
//    `X-SSR-Data`, and one value-free `ssr_render` log line (Step 4.6).
//
// `HEAD /` answers from the data-free page's headers and reads no data: a HEAD carries no body, so a
// render would spend the data plane and the CPU budget for nothing. It omits `X-SSR-Data`, whose
// value exists only once a body is rendered (RFC 9110 section 9.3.2 allows that).
import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {injectDashboard} from '../edge-render/inject'
import {DATA_FREE_PAGE_PATH} from '../edge-render/paths'
import {loadTemplates} from '../edge-render/templates'
import type {DashboardLoad} from './loader'
import {type SsrRenderRecord, toDashboardRender} from './render-model'

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

declare const __SSR_BUILD_ID__: string | undefined
const BUILD_ID = typeof __SSR_BUILD_ID__ === 'undefined' ? 'unknown' : __SSR_BUILD_ID__

const logger = createEdgeLogger({service: 'ssr-dashboard'})

export interface DashboardRenderDeps {
  /** Reads the data plane for this request (./loader.ts, with the request's test seams). */
  load(request: Request): Promise<DashboardLoad>
  /** The render time for this request: Date.now(), or the X-SSR-Clock test seam. */
  now(request: Request): number
  /** Reads a built file from the static-asset plane (the ASSETS binding). */
  asset(path: string, method: 'GET' | 'HEAD'): Promise<Response>
  /** Overrides the ceiling, for tests only. */
  ceilingMs?: number
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
  | {kind: 'rendered'; response: Response; body: ArrayBuffer; record: SsrRenderRecord}
  | {kind: 'failed'; status: number; errorClass: string}
  | {kind: 'ceiling'}

async function attempt(request: Request, deps: DashboardRenderDeps): Promise<Outcome> {
  try {
    const load = await deps.load(request)
    const nowMs = deps.now(request)
    const render = toDashboardRender(load, nowMs)
    const read = (path: string) => deps.asset(path, 'GET')
    const [page, templates] = await Promise.all([read(DATA_FREE_PAGE_PATH), loadTemplates(read)])
    if (!page.ok) {
      page.body?.cancel().catch(() => {})
      return {kind: 'failed', status: 500, errorClass: 'DataFreePageMissing'}
    }
    const injected = await injectDashboard(page, {render, templates, nowMs})
    // Buffer the document: a failure inside a rewrite handler rejects here.
    const body = await injected.arrayBuffer()
    return {kind: 'rendered', response: injected, body, record: render.record}
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

/** Answers `GET /`: the server render, or the data-free page past the ceiling, or the 500 page. */
export async function renderDashboard(request: Request, deps: DashboardRenderDeps): Promise<Response> {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const ceiling = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({kind: 'ceiling'}), deps.ceilingMs ?? SSR_CEILING_MS)
  })
  const outcome = await Promise.race([attempt(request, deps), ceiling])
  clearTimeout(timer)
  const totalMs = Date.now() - startedAt
  const base = {event: 'ssr_render' as const, total_ms: totalMs, build: BUILD_ID}

  if (outcome.kind === 'rendered') {
    const {record} = outcome
    logRender({...base, ...record, status: 200, render_ms: Math.max(0, totalMs - record.io_ms)})
    return new Response(outcome.body, {status: 200, headers: withDashboardHeaders(outcome.response.headers, record.summary)})
  }
  if (outcome.kind === 'ceiling') {
    logRender({...base, summary: 'fallback', status: 200, render_ms: totalMs})
    return dataFreePage('GET', 'fallback', deps)
  }
  logRender({...base, summary: 'error', status: 500, render_ms: totalMs, error_class: outcome.errorClass})
  return errorPage(deps)
}

/** Answers `HEAD /` from the data-free page's headers. Reads no data. */
export function headDashboard(deps: DashboardRenderDeps): Promise<Response> {
  return dataFreePage('HEAD', null, deps)
}
