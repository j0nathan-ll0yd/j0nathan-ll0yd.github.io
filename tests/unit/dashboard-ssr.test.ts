import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchDashboardSnapshot, renderDashboardSnapshot, snapshotProvenance, SSR_ENDPOINTS} from '../../functions/_lib/dashboard-snapshot'
import {CLIENT_SHELL_HEADER, injectSnapshot, onRequest} from '../../functions/index'

const require = createRequire(import.meta.url)
const START = '<template id="dashboard-live-start"></template>'
const END = '<template id="dashboard-live-end"></template>'
const SHELL =
  `<!doctype html><html><head><title>test</title></head><body><main>${START}<p>Unify handler pattern</p><p>Why SQLite Is So Great for the Edge</p>${END}</main></body></html>`

const fixturePaths = {
  health: 'health',
  sleep: 'sleep',
  workouts: 'workouts',
  githubEvents: 'github-events',
  articles: 'articles',
  books: 'books',
  starredRepos: 'github-starred-repos'
} as const

function loadPayloads(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(fixturePaths).map(([key, directory]) => {
    const file = require.resolve(`@j0nathan-ll0yd/fixtures/generated/${directory}/baseline.json`)
    const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    value.generatedAt = '2026-08-22T12:00:00.000Z'
    return [SSR_ENDPOINTS[key as keyof typeof SSR_ENDPOINTS], value]
  }))
}

function mockPayloadFetch(payloads = loadPayloads()): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const payload = payloads[url.pathname]
    return payload
      ? new Response(JSON.stringify(payload), {headers: {'Content-Type': 'application/json'}})
      : new Response(null, {status: 404})
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dashboard SSR snapshot', () => {
  it('fetches only the seven approved, location-free export contracts', async () => {
    const mock = mockPayloadFetch()
    const snapshot = await fetchDashboardSnapshot({now: Date.parse('2026-08-22T12:01:00.000Z')})

    expect(Object.values(snapshot).every((domain) => domain.source === 'live')).toBe(true)
    const urls = mock.mock.calls.map(([input]) => String(input)).sort()
    expect(urls).toEqual(Object.values(SSR_ENDPOINTS).map((path) => `${CLOUDFRONT_BASE}${path}`).sort())
    expect(urls.join(' ')).not.toContain('location.json')
    expect(urls.join(' ')).not.toContain('focus.json')
    expect(urls.join(' ')).not.toContain('theatre-reviews.json')
  })

  it('rejects a schema-invalid domain without discarding valid siblings', async () => {
    const payloads = loadPayloads()
    delete payloads[SSR_ENDPOINTS.githubEvents]?.generatedAt
    mockPayloadFetch(payloads)

    const snapshot = await fetchDashboardSnapshot({now: Date.parse('2026-08-22T12:01:00.000Z')})
    expect(snapshot.githubEvents).toMatchObject({source: 'unavailable', freshness: 'unknown', generatedAt: null, data: null})
    expect(snapshot.health.source).toBe('live')
    expect(snapshot.books.source).toBe('live')
  })

  it('marks valid old data stale while preserving its exact timestamp', async () => {
    const payloads = loadPayloads()
    payloads[SSR_ENDPOINTS.health]!.generatedAt = '2026-08-01T00:00:00.000Z'
    mockPayloadFetch(payloads)

    const snapshot = await fetchDashboardSnapshot({now: Date.parse('2026-08-22T12:01:00.000Z')})
    expect(snapshot.health).toMatchObject({source: 'live', freshness: 'stale', generatedAt: '2026-08-01T00:00:00.000Z'})
  })

  it('renders absolute source timestamps and machine-readable provenance', async () => {
    mockPayloadFetch()
    const snapshot = await fetchDashboardSnapshot({now: Date.parse('2026-08-22T12:01:00.000Z')})
    const html = renderDashboardSnapshot(snapshot)
    const provenance = snapshotProvenance(snapshot)

    expect(html).toContain('data-location-export="excluded"')
    expect(html).toContain('datetime="2026-08-22T12:00:00.000Z"')
    expect(html).not.toMatch(/\b\d+[mhdw] ago\b/)
    expect(provenance.profile.source).toBe('static')
    expect(provenance.system.source).toBe('static')
  })
})

describe('homepage edge composition', () => {
  it('removes the complete fixture region from a normal no-JS response', async () => {
    mockPayloadFetch()
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/'),
      next: async () => new Response(SHELL, {headers: {'Content-Type': 'text/html'}})
    })
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('X-SSR-Data')).toBe('live')
    expect(html).toContain('id="ssrDashboardSnapshot"')
    expect(html).toContain('<meta name="ssr-data"')
    expect(html).not.toContain('Unify handler pattern')
    expect(html).not.toContain('Why SQLite Is So Great for the Edge')
  })

  it('serves unavailable states, never fixtures, when every upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const response = await onRequest({request: new Request('https://jonathanlloyd.me/'), next: async () => new Response(SHELL)})
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('X-SSR-Data')).toBe('unavailable')
    expect(html.match(/data-ssr-source="unavailable"/g)).toHaveLength(7)
    expect(html).not.toContain('Unify handler pattern')
  })

  it('answers HEAD without exposing or evaluating the fixture-backed body', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/', {method: 'HEAD'}),
      next: async () => new Response(null, {headers: {Vary: 'Accept-Encoding'}})
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-SSR-Data')).toBe('not-evaluated')
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, X-Dashboard-Client-Shell')
    expect(await response.text()).toBe('')
    expect(mock).not.toHaveBeenCalled()
  })

  it('fails closed when build markers are missing', async () => {
    mockPayloadFetch()
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/'),
      next: async () => new Response('<html><head></head><body>Unify handler pattern</body></html>')
    })
    expect(response.status).toBe(503)
    expect(response.headers.get('X-SSR-Data')).toBe('unavailable')
    expect(await response.text()).not.toContain('Unify handler pattern')
  })

  it('returns the private, non-indexable DS shell only for the client bootstrap header', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/?_dashboard_shell=1', {headers: {[CLIENT_SHELL_HEADER]: '1'}}),
      next: async () => new Response(SHELL)
    })

    expect(response.headers.get('X-Dashboard-Shell')).toBe('fixture')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, noarchive')
    expect(response.headers.get('Content-Type')).toBe('application/vnd.jonathanlloyd.dashboard-shell+html; charset=utf-8')
    const fragment = await response.text()
    expect(fragment).toContain('Unify handler pattern')
    expect(fragment).not.toContain('<!doctype html>')
    expect(mock).not.toHaveBeenCalled()
  })

  it('escapes provenance before injecting it into a meta attribute', () => {
    const html = injectSnapshot(SHELL, '<p>safe</p>', {githubEvents: {source: 'live', generatedAt: '"><script>'}})
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
    expect(html).not.toContain('"><script>')
  })
})
