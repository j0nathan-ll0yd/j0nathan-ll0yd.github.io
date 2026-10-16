// @vitest-environment node
//
// The Worker's answer to `/` (atlas decision 0160, PR B; owner decision 2026-10-16: the page is
// precomposed as the data changes, like llms.txt): the composed page when the proxy admits a fresh,
// matching artifact; otherwise the data-free page with an honest summary; the D2 ceiling; the clean
// 500 (D13); the response headers (D3); and the value-free `ssr_render` log line. Node has no
// HTMLRewriter, so the shell is a precut stub here.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  type ArtifactFacts,
  type CheckedValueFreeSet,
  COMPOSED_FRAGMENT_IDS,
  type ComposedArtifact,
  type ComposedFragmentId,
  GATE_VARIANT,
  UNREADABLE_VARIANT,
  type ValueFreeEntry
} from '../../src/lib/composed/artifact'
import type {ComposedRead} from '../../src/lib/composed/read'
import type {Shell} from '../../src/lib/composed/shell'
import {
  COMPOSED_CACHE_HEADERS,
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
/** An id the shell's own page keeps outside the replaced elements. */
const SHELL_ID = 'identityName'

/** What the allowlist check reads from fragments built by `fragmentsOf` (src/lib/composed/fragment-policy.ts). */
function factsOf(scope = SCOPE, ids: string[] = [...COMPOSED_FRAGMENT_IDS]): ArtifactFacts {
  return {
    ids: new Set(ids),
    scopes: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set([scope])])) as ArtifactFacts['scopes'],
    roots: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, {classes: new Set<string>(), scopes: new Set([scope])}])) as ArtifactFacts['roots']
  }
}

function artifact(summary: ComposedArtifact['summary'] = 'live', scope = SCOPE): ComposedArtifact {
  const fragments = Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, `<div id="${id}" ${scope}>${id}-value</div>`])) as Record<
    ComposedFragmentId,
    string
  >
  return {
    schemaVersion: 1,
    composedAt: new Date(NOW - 60_000).toISOString(),
    composer: {build: 'test'},
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
  scopes: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set([SCOPE])])) as Shell['scopes'],
  roots: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, {firstClass: null, scopes: new Set([SCOPE])}])) as Shell['roots'],
  ids: new Set([SHELL_ID]),
  headers: new Headers({'Content-Type': 'text/html', ETag: '"page"'})
}

interface Calls {
  reads: number
  assets: string[]
}

function fragmentsOf(label: string, scope = SCOPE): Record<ComposedFragmentId, string> {
  return Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, `<div id="${id}" ${scope}>${label}</div>`])) as Record<ComposedFragmentId, string>
}

/** A value-free variant whose fragments the Worker already checked (src/lib/composed/artifact.ts checkedVariant). */
function checkedEntry(summary: 'suppressed' | 'unavailable', label: string, scope = SCOPE, ids?: string[]): ValueFreeEntry {
  const page = {summary, fragments: fragmentsOf(label, scope)}
  return {page, checked: {...page, facts: factsOf(scope, ids)}}
}

/** The build's value-free set: one page per hiding value, the gate and an unreadable focus. */
const VALUE_FREE: CheckedValueFreeSet = {
  build: 'test',
  variants: {
    Work: checkedEntry('suppressed', 'work-overlay'),
    'Do Not Disturb': checkedEntry('suppressed', 'dnd-overlay'),
    [GATE_VARIANT]: checkedEntry('suppressed', 'gate-no-overlay'),
    [UNREADABLE_VARIANT]: checkedEntry('unavailable', 'all-unavailable')
  }
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
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact(), facts: factsOf()})).deps)
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
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact(summary), facts: factsOf()})).deps)
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
  })

  // covers: dashboard-ssr#Every data state answers 200 and no shared cache stores the document
  it('never stores the composed document anywhere, the browser included (D3; review 2026-10-16, M1)', async () => {
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact(), facts: factsOf()})).deps)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store')
    for (const [name, value] of COMPOSED_CACHE_HEADERS) {
      expect(response.headers.get(name), name).toBe(value)
    }
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('ETag')).toBeNull()
  })

  it('refuses a fragment whose scoped-style hash the website does not carry', async () => {
    const response = await renderDashboard(REQUEST,
      deps(async () => ({kind: 'ok', artifact: artifact('live', 'data-astro-cid-zzzzzzzz'), facts: factsOf('data-astro-cid-zzzzzzzz')})).deps)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(await response.text()).toBe('data-free page')
  })

  // covers: dashboard-ssr#Each render logs one value-free line
  it('logs one value-free ssr_render line', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact(), facts: factsOf()})).deps)
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
  // covers: dashboard-ssr#Every data state answers 200 and no shared cache stores the document
  it.each([
    [{kind: 'suppressed', currentFocus: 'Work'}, 'suppressed'],
    [{kind: 'focus-unreadable'}, 'unavailable'],
    [{kind: 'unavailable', status: 502}, 'fallback'],
    [{kind: 'refused', refusal: 'stale'}, 'fallback']
  ] as [ComposedRead, string][])('%o, with no value-free pages, serves the data-free page as %s', async (read, summary) => {
    const response = await renderDashboard(REQUEST, deps(async () => read).deps)
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
    expect(await response.text()).toBe('data-free page')
    // The data-free page carries no data value: it keeps the no-cache policy.
    for (const [name, value] of DASHBOARD_CACHE_HEADERS) {
      expect(response.headers.get(name), name).toBe(value)
    }
  })
})

describe('GET /: the value-free pages', () => {
  function withValueFree(read: ComposedRead, set: ValueFreeSet | null = VALUE_FREE): DashboardRenderDeps {
    return {...deps(async () => read).deps, valueFree: async () => set}
  }

  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it.each([
    [{kind: 'suppressed', currentFocus: 'Work'}, 'suppressed', 'work-overlay'],
    [{kind: 'suppressed', currentFocus: 'Do Not Disturb'}, 'suppressed', 'dnd-overlay'],
    [{kind: 'suppressed', currentFocus: null}, 'suppressed', 'gate-no-overlay'],
    [{kind: 'focus-unreadable'}, 'unavailable', 'all-unavailable']
  ] as [ComposedRead, string, string][])('%o answers its value-free page as %s', async (read, summary, label) => {
    const response = await renderDashboard(REQUEST, withValueFree(read))
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
    expect(body).toContain(`<meta name="ssr-data" content="${summary}">`)
    for (const id of COMPOSED_FRAGMENT_IDS) {
      expect(body).toContain(`<div id="${id}" ${SCOPE}>${label}</div>`)
    }
    for (const [name, value] of DASHBOARD_CACHE_HEADERS) {
      expect(response.headers.get(name), name).toBe(value)
    }
  })

  it('a hiding value the build does not know answers the data-free page, still suppressed', async () => {
    const response = await renderDashboard(REQUEST, withValueFree({kind: 'suppressed', currentFocus: 'Sleep'}))
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('suppressed')
    expect(await response.text()).toBe('data-free page')
  })

  it('refuses a value-free page whose scoped-style hash the website does not carry', async () => {
    const foreign: ValueFreeSet = {
      ...VALUE_FREE,
      variants: {...VALUE_FREE.variants, Work: checkedEntry('suppressed', 'work-overlay', 'data-astro-cid-zzzzzzzz')}
    }
    const response = await renderDashboard(REQUEST, withValueFree({kind: 'suppressed', currentFocus: 'Work'}, foreign))
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('suppressed')
    expect(await response.text()).toBe('data-free page')
  })

  it('logs the value-free answer without the hiding value', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await renderDashboard(REQUEST, withValueFree({kind: 'suppressed', currentFocus: 'Do Not Disturb'}))
    const [line] = logLines(info)
    expect(line).toMatchObject({event: 'ssr_render', summary: 'suppressed', served: 'value-free', focus_read: 'hiding', status: 200})
    expect(JSON.stringify(line)).not.toContain('Do Not Disturb')
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
    const {deps: d, calls} = deps(async () => ({kind: 'ok', artifact: artifact(), facts: factsOf()}))
    const response = await headDashboard(d)
    expect(calls.reads).toBe(0)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get(SSR_DATA_HEADER)).toBeNull()
  })
})

describe('GET /: a built page that cannot be read (review L3)', () => {
  it('answers a bare 500, no-store, never a platform error', async () => {
    const {deps: d} = deps(async () => ({kind: 'unavailable', status: 502}))
    const response = await renderDashboard(REQUEST, {...d, asset: () => Promise.reject(new TypeError('assets down'))})
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('error')
  })
})

describe("GET /: the log line keeps the Worker's own fields (review M3)", () => {
  it('lets no record field override the event, build or timings', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const spoofed = {
      ...artifact(),
      record: {...artifact().record, event: 'spoofed', build: 'spoofed', total_ms: -1} as unknown as ComposedArtifact['record']
    }
    await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: spoofed, facts: factsOf()})).deps)
    const [line] = logLines(info)
    expect(line).toMatchObject({event: 'ssr_render', build: 'test'})
    expect(line?.total_ms).not.toBe(-1)
  })
})

describe('GET /: the fragment allowlist (review 2026-10-16, H1)', () => {
  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it('serves the data-free page and logs the closed-set reason when the read refuses a fragment', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'refused', refusal: 'fragments', detail: 'cardHR:element'})).deps)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(await response.text()).toBe('data-free page')
    const [line] = logLines(info)
    expect(line).toMatchObject({served: 'data-free', artifact: 'refused:fragments:cardHR:element'})
  })

  it('refuses a fragment that carries an id the page keeps outside the cards', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await renderDashboard(REQUEST, deps(async () => ({kind: 'ok', artifact: artifact(), facts: factsOf(SCOPE, ['cardHR', SHELL_ID])})).deps)
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('fallback')
    expect(await response.text()).toBe('data-free page')
    expect(logLines(info)[0]).toMatchObject({artifact: 'refused:ids'})
  })

  it('refuses a value-free page that carries an id the page keeps', async () => {
    const clobbering: CheckedValueFreeSet = {
      ...VALUE_FREE,
      variants: {...VALUE_FREE.variants, Work: checkedEntry('suppressed', 'work-overlay', SCOPE, [SHELL_ID])}
    }
    const response = await renderDashboard(REQUEST, {
      ...deps(async () => ({kind: 'suppressed', currentFocus: 'Work'})).deps,
      valueFree: async () => clobbering
    })
    expect(response.headers.get(SSR_DATA_HEADER)).toBe('suppressed')
    expect(await response.text()).toBe('data-free page')
  })
})
