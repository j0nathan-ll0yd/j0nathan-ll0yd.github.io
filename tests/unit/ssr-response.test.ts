// @vitest-environment node
//
// The Worker's answer to `/` (atlas decision 0160, PR B; plan Steps 4.3 to 4.6; owner decision
// 2026-10-16, option B): the D2 ceiling and its data-free fallback, the buffered body that turns any
// failure into a clean 500 (D13), the response headers (D3), and the value-free `ssr_render` log line.
// Node has no HTMLRewriter, so the injector is a stub here; tests/oracle runs the real one in workerd.
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import type {ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import type {DashboardLoad, DomainOutcome, GatedKey} from '../../src/lib/data-plane/loader'
import {
  DASHBOARD_CACHE_HEADERS,
  type DashboardRenderDeps,
  DATA_FREE_PAGE_PATH,
  ERROR_PAGE_PATH,
  headDashboard,
  renderDashboard,
  SSR_CEILING_MS,
  SSR_DATA_HEADER
} from '../../src/lib/data-plane/ssr-response'
import {TEMPLATES_PAGE_PATH} from '../../src/lib/edge-render/paths'
import {resetTemplatesForTest} from '../../src/lib/edge-render/templates'
import type {injectDashboard} from '../../src/lib/edge-render/inject'

const require = createRequire(import.meta.url)
const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const FRESH = new Date(NOW - 60_000).toISOString()
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()
const KEYS: GatedKey[] = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews']
const DIRS: Record<GatedKey, string> = {
  health: 'health',
  sleep: 'sleep',
  workouts: 'workouts',
  books: 'books',
  githubEvents: 'github-events',
  starredRepos: 'github-starred-repos',
  articles: 'articles',
  theatreReviews: 'theatre-reviews'
}

function ok(key: GatedKey, generatedAt: string): DomainOutcome {
  const raw: Record<string, unknown> = JSON.parse(readFileSync(require.resolve(`@j0nathan-ll0yd/fixtures/generated/${DIRS[key]}/baseline.json`), 'utf8'))
  raw.generatedAt = generatedAt
  // Test data: the decoded value of the key it was decoded under.
  return {kind: 'ok', data: decodeArtifact(key as ResourceKey, raw)} as DomainOutcome
}

function domains(outcome: (key: GatedKey) => DomainOutcome): DashboardLoad['domains'] {
  // Test data: one outcome per gated key, keyed as the loader keys them.
  return Object.fromEntries(KEYS.map((key) => [key, outcome(key)])) as DashboardLoad['domains']
}

/** A load for each summary the render can produce. */
const LOADS: Record<'live' | 'stale' | 'partial' | 'unavailable' | 'suppressed', () => DashboardLoad> = {
  live: () => ({focus: {state: 'visible', currentFocus: 'None'}, domains: domains((k) => ok(k, FRESH)), suppressed: false, ioMs: 120}),
  stale: () => ({focus: {state: 'visible', currentFocus: 'None'}, domains: domains((k) => ok(k, OLD)), suppressed: false, ioMs: 120}),
  partial: () => ({
    focus: {state: 'visible', currentFocus: 'None'},
    domains: domains((k) => (k === 'books' ? {kind: 'unavailable', reason: 'http-503'} : ok(k, FRESH))),
    suppressed: false,
    ioMs: 120
  }),
  unavailable: () => ({
    focus: {state: 'unreadable', reason: 'timeout'},
    domains: domains(() => ({kind: 'unavailable', reason: 'focus-unreadable'})),
    suppressed: false,
    ioMs: 1000
  }),
  suppressed: () => ({focus: {state: 'hiding', currentFocus: 'Work'}, domains: domains(() => ({kind: 'suppressed'})), suppressed: true, ioMs: 80})
}

const TEMPLATES = '<template data-ssr-template="cardHR:unavailable"><div id="cardHR"></div></template>'

interface Calls {
  loads: Request[]
  assets: string[]
}

/** The injector stub: it names the summary it received, so a test can see which render answered. */
const echoInject: typeof injectDashboard = async (page, {render}) => new Response(`${await page.text()}|injected:${render.summary}`, {headers: page.headers})

interface DepsOptions {
  load?: () => Promise<DashboardLoad>
  inject?: typeof injectDashboard
  ceilingMs?: number
  /** A path's answer: a response, or null for a 404. */
  assets?: Record<string, Response | null>
}

function deps(options: DepsOptions = {}): {calls: Calls; deps: DashboardRenderDeps} {
  const calls: Calls = {loads: [], assets: []}
  return {
    calls,
    deps: {
      load: (request) => {
        calls.loads.push(request)
        return options.load ? options.load() : Promise.resolve(LOADS.live())
      },
      now: () => NOW,
      asset: async (path, method) => {
        calls.assets.push(`${method} ${path}`)
        const override = options.assets?.[path]
        if (override !== undefined) {
          return override ?? new Response('missing', {status: 404})
        }
        const body = method === 'HEAD' ? null : path === DATA_FREE_PAGE_PATH ? 'data-free page' : path === TEMPLATES_PAGE_PATH ? TEMPLATES : 'error page'
        return new Response(body, {status: 200, headers: {'Content-Type': 'text/html', ETag: '"asset"', 'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT'}})
      },
      inject: options.inject ?? echoInject,
      ...(options.ceilingMs === undefined ? {} : {ceilingMs: options.ceilingMs})
    }
  }
}

const REQUEST = new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/html'}})

/** The JSON log lines the edge logger wrote. */
function logLines(spy: {mock: {calls: unknown[][]}}): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => {
    const line: unknown = JSON.parse(String(call[0]))
    return typeof line === 'object' && line !== null ? {...line} : {}
  })
}

beforeEach(() => {
  resetTemplatesForTest()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /: a completed render', () => {
  it('reads the data plane for the request, injects into the data-free page and answers 200 with the summary', async () => {
    const {deps: d, calls} = deps()
    const response = await renderDashboard(REQUEST, d)
    expect(calls.loads).toEqual([REQUEST])
    expect(calls.assets).toEqual(expect.arrayContaining([`GET ${DATA_FREE_PAGE_PATH}`, `GET ${TEMPLATES_PAGE_PATH}`]))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('data-free page|injected:live')
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('live')
  })

  // covers: dashboard-ssr#Every data state answers 200 and no shared cache stores the document
  it.each(['stale', 'partial', 'unavailable', 'suppressed'] as const)('answers 200 for the %s summary too (D13)', async (summary) => {
    const response = await renderDashboard(REQUEST, deps({load: async () => LOADS[summary]()}).deps)
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
  })

  it('never stores the document at the edge or reuses it unrevalidated (D3), keeps the charset and drops asset validators', async () => {
    const response = await renderDashboard(REQUEST, deps().deps)
    for (const [name, value] of DASHBOARD_CACHE_HEADERS) {
      expect(response.headers.get(name), name).toBe(value)
    }
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Last-Modified')).toBeNull()
  })

  // covers: dashboard-ssr#Each render logs one value-free line
  it('logs one value-free ssr_render line with the record, the timings and the build', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await renderDashboard(REQUEST, deps().deps)
    const lines = logLines(info)
    expect(lines).toHaveLength(1)
    const line = lines[0] ?? {}
    expect(line).toMatchObject({
      service: 'ssr-dashboard',
      message: 'ssr_render',
      event: 'ssr_render',
      summary: 'live',
      focus: 'visible',
      status: 200,
      io_ms: 120,
      build: 'test'
    })
    expect(Object.keys(line.domains ?? {}).sort()).toEqual([...KEYS].sort())
    expect(typeof line.render_ms).toBe('number')
    expect(typeof line.total_ms).toBe('number')
    // States and timings only: no export value reaches the log.
    expect(JSON.stringify(line)).not.toMatch(/Tainted Cup|Shorefall|bpm/i)
  })
})

describe('GET /: the D2 ceiling', () => {
  // covers: dashboard-ssr#A render that misses its budget falls back to the data-free page
  it('serves the prerendered data-free page with X-SSR-Data: fallback when the render misses the ceiling', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const {deps: d, calls} = deps({load: () => new Promise<DashboardLoad>(() => {}), ceilingMs: 50})
    const started = Date.now()
    const response = await renderDashboard(REQUEST, d)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('data-free page')
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(calls.assets).toEqual([`GET ${DATA_FREE_PAGE_PATH}`])
    expect(logLines(info)[0]).toMatchObject({summary: 'fallback', status: 200})
  })

  it('applies the fallback to a rewritten body that stalls', async () => {
    const stalled: typeof injectDashboard = async () => new Response(new ReadableStream({pull: () => new Promise(() => {})}))
    const response = await renderDashboard(REQUEST, deps({inject: stalled, ceilingMs: 50}).deps)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
  })

  it('is 3 s: 2.5 s of I/O plus a 0.5 s render reserve', () => {
    expect(SSR_CEILING_MS).toBe(3_000)
  })
})

describe('GET /: a render failure (D13, Step 4.5)', () => {
  function expectErrorPage(response: Response, calls: Calls): void {
    expect(response.status).toBe(500)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('error')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(calls.assets.at(-1)).toBe(`GET ${ERROR_PAGE_PATH}`)
  }

  it('an injector that throws answers the 500 page', async () => {
    const {deps: d, calls} = deps({
      inject: async () => {
        throw new TypeError('rewrite failed')
      }
    })
    const response = await renderDashboard(REQUEST, d)
    expectErrorPage(response, calls)
    expect(await response.text()).toBe('error page')
  })

  // covers: dashboard-ssr#A render exception answers a clean 500
  it('a stream that fails while the page is rewritten answers the 500 page, never a half document with status 200', async () => {
    const broken: typeof injectDashboard = async () =>
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('<!DOCTYPE html><html><body><section>live data'))
        },
        pull(controller) {
          controller.error(new Error('handler threw'))
        }
      }))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const {deps: d, calls} = deps({inject: broken})
    const response = await renderDashboard(REQUEST, d)
    expectErrorPage(response, calls)
    expect(await response.text()).not.toContain('live data')
    expect(logLines(info)[0]).toMatchObject({summary: 'error', status: 500, error_class: 'Error'})
  })

  it('a missing data-free page or templates page is a render failure, not a page without values', async () => {
    for (const path of [DATA_FREE_PAGE_PATH, TEMPLATES_PAGE_PATH]) {
      resetTemplatesForTest()
      const {deps: d, calls} = deps({assets: {[path]: null}})
      expectErrorPage(await renderDashboard(REQUEST, d), calls)
    }
  })
})

describe('HEAD /', () => {
  // covers: dashboard-ssr#HEAD reads no data
  it('answers from the data-free page headers, reads no data and renders nothing', async () => {
    const {deps: d, calls} = deps()
    const response = await headDashboard(d)
    expect(calls.loads).toHaveLength(0)
    expect(calls.assets).toEqual([`HEAD ${DATA_FREE_PAGE_PATH}`])
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get(SSR_DATA_HEADER)).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('ETag')).toBeNull()
  })
})
