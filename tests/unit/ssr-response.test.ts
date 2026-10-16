// @vitest-environment node
//
// The Worker's answer to `/` (atlas decision 0160, PR B; owner decision 2026-10-16: the page is
// precomposed as the data changes, like llms.txt): the composed page when the proxy admits a fresh,
// matching artifact; otherwise the data-free page with an honest summary; the D2 ceiling; the clean
// 500 (D13); the response headers (D3); and the value-free `ssr_render` log line. Node has no
// HTMLRewriter, so the shell is a precut stub here.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {COMPOSED_FRAGMENT_IDS, type ComposedArtifact, type ComposedFragmentId} from '../../src/lib/composed/artifact'
import type {ComposedRead} from '../../src/lib/composed/read'
import type {Shell} from '../../src/lib/composed/shell'
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

const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const SCOPE = 'data-astro-cid-abc12345'

function artifact(summary: ComposedArtifact['summary'] = 'live', scope = SCOPE): ComposedArtifact {
  const fragments = Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, `<div id="${id}" ${scope}>${id}-value</div>`])) as Record<
    ComposedFragmentId,
    string
  >
  return {
    schemaVersion: 1,
    composedAt: new Date(NOW - 60_000).toISOString(),
    renderer: {web: '4.2.1'},
    currentFocus: 'None',
    summary,
    // A value-free record, as the composer writes it.
    record: {summary, focus: 'visible', domains: {}, cards: {}, degraded: [], io_ms: 0} as unknown as ComposedArtifact['record'],
    fragments
  }
}

/** A shell cut into one piece per fragment plus the summary slot, as cutShell produces. */
const SHELL: Shell = {
  pieces: ['<html><head><meta name="robots" content="index">', ...COMPOSED_FRAGMENT_IDS.map(() => '|'), '</body></html>'],
  slots: ['summary', ...COMPOSED_FRAGMENT_IDS],
  scopes: new Set([SCOPE]),
  headers: new Headers({'Content-Type': 'text/html', ETag: '"page"'})
}

interface Calls {
  reads: number
  assets: string[]
}

function deps(read: () => Promise<ComposedRead>, ceilingMs?: number): {calls: Calls; deps: DashboardRenderDeps} {
  const calls: Calls = {reads: 0, assets: []}
  return {
    calls,
    deps: {
      read: () => {
        calls.reads++
        return read()
      },
      now: () => NOW,
      asset: async (path, method) => {
        calls.assets.push(`${method} ${path}`)
        const body = method === 'HEAD' ? null : path === DATA_FREE_PAGE_PATH ? 'data-free page' : 'error page'
        return new Response(body, {status: 200, headers: {'Content-Type': 'text/html', ETag: '"asset"', 'Last-Modified': 'Thu, 01 Jan 2026 00:00:00 GMT'}})
      },
      shell: async () => SHELL,
      ...(ceilingMs === undefined ? {} : {ceilingMs})
    }
  }
}

const REQUEST = new Request('https://jonathanlloyd.me/')

function logLines(spy: {mock: {calls: unknown[][]}}): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => {
    const line: unknown = JSON.parse(String(call[0]))
    return typeof line === 'object' && line !== null ? {...line} : {}
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /: the composed page', () => {
  it('splices the admitted artifact into the shell and names its summary', async () => {
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact()})).deps)
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('live')
    expect(body).toContain('<meta name="ssr-data" content="live">')
    for (const id of COMPOSED_FRAGMENT_IDS) {
      expect(body).toContain(`${id}-value`)
    }
  })

  // covers: dashboard-ssr#Every data state answers 200 and no shared cache stores the document
  it.each(['stale', 'partial', 'unavailable'] as const)('answers 200 for the %s summary too (D13)', async (summary) => {
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact(summary)})).deps)
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
  })

  it('never stores the document at the edge (D3), keeps the charset and drops asset validators', async () => {
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact()})).deps)
    for (const [name, value] of DASHBOARD_CACHE_HEADERS) {
      expect(response.headers.get(name), name).toBe(value)
    }
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('ETag')).toBeNull()
  })

  it('refuses a fragment whose scoped-style hash the website does not carry', async () => {
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact('live', 'data-astro-cid-zzzzzzzz')})).deps)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(await response.text()).toBe('data-free page')
  })

  // covers: dashboard-ssr#Each render logs one value-free line
  it('logs one value-free ssr_render line', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact()})).deps)
    const [line] = logLines(info)
    expect(line).toMatchObject({
      message: 'ssr_render',
      event: 'ssr_render',
      summary: 'live',
      served: 'composed',
      status: 200,
      build: 'test',
      composed_age_ms: 60_000
    })
    expect(JSON.stringify(line)).not.toMatch(/-value/)
  })
})

describe('GET /: the data-free page, with an honest summary', () => {
  it.each([
    [{kind: 'suppressed'}, 'suppressed'],
    [{kind: 'focus-unreadable'}, 'unavailable'],
    [{kind: 'unavailable', status: 502}, 'fallback'],
    [{kind: 'refused', refusal: 'stale'}, 'fallback']
  ] as [ComposedRead, string][])('%o serves the data-free page as %s', async (read, summary) => {
    const response = await renderDashboard(REQUEST, deps(async () => read).deps)
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
    expect(await response.text()).toBe('data-free page')
  })
})

describe('GET /: the D2 ceiling', () => {
  // covers: dashboard-ssr#A render that misses its budget falls back to the data-free page
  it('serves the data-free page with X-SSR-Data: fallback when the read misses the ceiling', async () => {
    const {deps: d} = deps(() => new Promise<ComposedRead>(() => {}), 50)
    const started = Date.now()
    const response = await renderDashboard(REQUEST, d)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(await response.text()).toBe('data-free page')
  })

  it('is 3 s', () => {
    expect(SSR_CEILING_MS).toBe(3_000)
  })
})

describe('GET /: a failure (D13)', () => {
  // covers: dashboard-ssr#A render exception answers a clean 500
  it('a throw answers the 500 page, no-store', async () => {
    const {deps: d, calls} = deps(async () => {
      throw new TypeError('boom')
    })
    const response = await renderDashboard(REQUEST, d)
    expect(response.status).toBe(500)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('error')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(calls.assets.at(-1)).toBe(`GET ${ERROR_PAGE_PATH}`)
  })
})

describe('HEAD /', () => {
  // covers: dashboard-ssr#HEAD reads no data
  it('answers from the data-free page headers and reads nothing', async () => {
    const {deps: d, calls} = deps(async () => ({kind: 'ok', artifact: artifact()}))
    const response = await headDashboard(d)
    expect(calls.reads).toBe(0)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get(SSR_DATA_HEADER)).toBeNull()
  })
})
