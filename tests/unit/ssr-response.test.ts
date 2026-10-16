// @vitest-environment node
//
// The Worker's answer to `/` (atlas decision 0160, PR B; plan Steps 4.3 to 4.6): the D2 ceiling and
// its data-free fallback, the buffered body that turns any render exception into a clean 500 (D13),
// the response headers (D3), and the value-free `ssr_render` log line.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  DASHBOARD_CACHE_HEADERS,
  DATA_FREE_PAGE_PATH,
  ERROR_PAGE_PATH,
  headDashboard,
  renderDashboard,
  SSR_CEILING_MS,
  SSR_DASHBOARD_PATH,
  SSR_DATA_HEADER,
  SSR_RECORD_HEADER
} from '../../src/lib/data-plane/ssr-response'
import type {SsrRenderRecord} from '../../src/lib/data-plane/render-model'

const RECORD: SsrRenderRecord = {
  summary: 'live',
  focus: 'visible',
  domains: {health: 'ok', sleep: 'ok', workouts: 'ok', books: 'ok', githubEvents: 'ok', starredRepos: 'ok', articles: 'ok', theatreReviews: 'ok'},
  cards: {
    cardHR: 'live',
    cardMovement: 'live',
    cardHydration: 'live',
    cardSleep: 'live',
    cardWorkouts: 'live',
    cardDevLog: 'live',
    cardReading: 'live',
    cardStarredRepos: 'live',
    cardBooks: 'live',
    cardTheatreReviews: 'empty'
  },
  degraded: [],
  io_ms: 120
}

const PAGE = '<!DOCTYPE html><html><body>rendered</body></html>'

function rendered(body: BodyInit = PAGE, record: SsrRenderRecord | string = RECORD): Response {
  return new Response(body, {
    status: 200,
    headers: {'Content-Type': 'text/html', [SSR_RECORD_HEADER]: typeof record === 'string' ? record : JSON.stringify(record)}
  })
}

interface Calls {
  rendered: Request[]
  assets: string[]
}

function deps(render: (request: Request) => Promise<Response>, ceilingMs?: number) {
  const calls: Calls = {rendered: [], assets: []}
  return {
    calls,
    deps: {
      render: (request: Request) => {
        calls.rendered.push(request)
        return render(request)
      },
      asset: async (path: string, method: 'GET' | 'HEAD') => {
        calls.assets.push(`${method} ${path}`)
        const body = method === 'HEAD' ? null : path === DATA_FREE_PAGE_PATH ? 'data-free page' : 'error page'
        return new Response(body, {status: 200, headers: {'Content-Type': 'text/html', ETag: '"asset"', 'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT'}})
      },
      ...(ceilingMs === undefined ? {} : {ceilingMs})
    }
  }
}

const REQUEST = new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/html', 'X-SSR-Fault': 'stall'}})

/** The JSON log lines the edge logger wrote, by message. */
function logLines(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /: a completed render', () => {
  it('renders the private page path with the request headers, and answers 200 with the summary', async () => {
    const {deps: d, calls} = deps(async () => rendered())
    const response = await renderDashboard(REQUEST, d)
    expect(calls.rendered).toHaveLength(1)
    expect(new URL(calls.rendered[0].url).pathname).toBe(SSR_DASHBOARD_PATH)
    expect(calls.rendered[0].method).toBe('GET')
    expect(calls.rendered[0].headers.get('X-SSR-Fault')).toBe('stall')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(PAGE)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('live')
  })

  it('never stores the document at the edge or reuses it unrevalidated (D3), and keeps the charset', async () => {
    const response = await renderDashboard(REQUEST, deps(async () => rendered()).deps)
    for (const [name, value] of DASHBOARD_CACHE_HEADERS) {
      expect(response.headers.get(name), name).toBe(value)
    }
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })

  it('strips the internal record header before the answer leaves the Worker', async () => {
    const response = await renderDashboard(REQUEST, deps(async () => rendered()).deps)
    expect(response.headers.get(SSR_RECORD_HEADER)).toBeNull()
  })

  it.each(['stale', 'partial', 'unavailable', 'suppressed'] as const)('answers 200 for the %s summary too (D13)', async (summary) => {
    const response = await renderDashboard(REQUEST, deps(async () => rendered(PAGE, {...RECORD, summary})).deps)
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
  })

  it('logs one value-free ssr_render line with the record, the timings and the build', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await renderDashboard(REQUEST, deps(async () => rendered()).deps)
    const lines = logLines(info)
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line).toMatchObject({
      service: 'ssr-dashboard',
      message: 'ssr_render',
      event: 'ssr_render',
      summary: 'live',
      focus: 'visible',
      status: 200,
      io_ms: 120,
      domains: RECORD.domains,
      cards: RECORD.cards,
      degraded: [],
      build: 'test'
    })
    expect(typeof line.render_ms).toBe('number')
    expect(typeof line.total_ms).toBe('number')
  })
})

describe('GET /: the D2 ceiling', () => {
  it('serves the prerendered data-free page with X-SSR-Data: fallback when the render misses the ceiling', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const {deps: d, calls} = deps(() => new Promise<Response>(() => {}), 50)
    const started = Date.now()
    const response = await renderDashboard(REQUEST, d)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('data-free page')
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Last-Modified')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(calls.assets).toEqual([`GET ${DATA_FREE_PAGE_PATH}`])
    expect(logLines(info)[0]).toMatchObject({summary: 'fallback', status: 200})
  })

  it('applies the fallback to a body that stalls after the headers arrived', async () => {
    const stalled = new ReadableStream({pull: () => new Promise(() => {})})
    const response = await renderDashboard(REQUEST, deps(async () => rendered(stalled), 50).deps)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
  })

  it('is 3 s: 2.5 s of I/O plus a 0.5 s render reserve', () => {
    expect(SSR_CEILING_MS).toBe(3_000)
  })
})

describe('GET /: a render exception (D13, Step 4.5)', () => {
  function expectErrorPage(response: Response, calls: Calls): void {
    expect(response.status).toBe(500)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('error')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(calls.assets).toEqual([`GET ${ERROR_PAGE_PATH}`])
  }

  it('a throw before the first byte answers the 500 page', async () => {
    const {deps: d, calls} = deps(async () => {
      throw new TypeError('render failed')
    })
    const response = await renderDashboard(REQUEST, d)
    expectErrorPage(response, calls)
    expect(await response.text()).toBe('error page')
  })

  it("Astro's own error answer (a frontmatter throw) answers the 500 page", async () => {
    const {deps: d, calls} = deps(async () => new Response('astro error', {status: 500}))
    expectErrorPage(await renderDashboard(REQUEST, d), calls)
  })

  it('a throw while the stream renders answers the 500 page, never a half document with status 200', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<!DOCTYPE html><html><body><section>live data'))
      },
      pull(controller) {
        controller.error(new Error('widget threw'))
      }
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const {deps: d, calls} = deps(async () => rendered(broken))
    const response = await renderDashboard(REQUEST, d)
    expectErrorPage(response, calls)
    expect(await response.text()).not.toContain('live data')
    expect(logLines(info)[0]).toMatchObject({summary: 'error', status: 500, error_class: 'Error'})
  })

  it('a missing or malformed record is a render failure, not a 200 without a summary', async () => {
    for (const record of ['', '{"summary":', '{"summary":"live"}']) {
      const {deps: d, calls} = deps(async () => rendered(PAGE, record))
      expectErrorPage(await renderDashboard(REQUEST, d), calls)
    }
  })
})

describe('HEAD /', () => {
  it('answers from the data-free page headers, reads no data and renders nothing', async () => {
    const {deps: d, calls} = deps(async () => rendered())
    const response = await headDashboard(d)
    expect(calls.rendered).toHaveLength(0)
    expect(calls.assets).toEqual([`HEAD ${DATA_FREE_PAGE_PATH}`])
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get(SSR_DATA_HEADER)).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('ETag')).toBeNull()
  })
})
