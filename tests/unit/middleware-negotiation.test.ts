import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE, LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {CONTENT_USAGE, CSP, LINK_HEADER, onRequest, prefersMarkdown} from '../../functions/_middleware'

const logger = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()}))
vi.mock('@j0nathan-ll0yd/observability/edge', () => ({createEdgeLogger: () => logger}))

// Unit tests for the homepage markdown negotiation in functions/_middleware.ts.
// The regression class under guard: the pre-P1 middleware negotiated on EVERY
// path and method via `accept.includes('text/markdown')`, hijacking /llms.txt
// (discovery identity lost), matching `text/markdown;q=0`, bypassing the shared
// proxy machinery with an independent fetch, and skipping the header pipeline.

const FETCH_CACHE_INIT = {cf: {cacheEverything: true, cacheTtlByStatus: {'200-299': 60, '300-599': 0}}}
const FOCUS_URL = `${CLOUDFRONT_BASE}/focus.json`
const FOCUS_FETCH_INIT = {cache: 'no-store'}
const LLMS_FULL_UPSTREAM = `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.llmsFull}`
const MARKDOWN = {Accept: 'text/markdown'}

function makeContext(path = '/', init: RequestInit = {}) {
  const background: Promise<unknown>[] = []
  const next = vi.fn(async () => new Response('<html>home</html>', {headers: {'Content-Type': 'text/html; charset=utf-8'}}))
  const context = {request: new Request(`https://jonathanlloyd.me${path}`, init), next, waitUntil: (promise: Promise<unknown>) => background.push(promise)}
  return {context, next, background}
}

function stubFetch(artifactBody = '# full profile', currentFocus = 'Personal') {
  const mock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus})) : new Response(artifactBody))
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

function stubCache(cached?: Response) {
  const cache = {match: vi.fn().mockResolvedValue(cached), put: vi.fn().mockResolvedValue(undefined)}
  vi.stubGlobal('caches', {default: cache})
  return cache
}

function expectPublicNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
  expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// covers: llms-txt#Markdown negotiation applies only to the homepage and honors Accept q-values
describe('prefersMarkdown', () => {
  const table: Array<[string | null, boolean]> = [
    // The agent-readiness case: bare explicit markdown.
    ['text/markdown', true],
    // Explicit rejection is not a request.
    ['text/markdown;q=0', false],
    ['text/markdown; q=0', false],
    ['text/markdown;q=0.0', false],
    // A wildcard never selects markdown; markdown must be named.
    ['*/*', false],
    ['text/*', false],
    ['text/*, */*;q=0.5', false],
    // Browser-typical Accept prefers HTML.
    ['text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', false],
    // Both explicit: higher q wins.
    ['text/markdown, text/html;q=0.9', true],
    ['text/markdown;q=0.9, text/html', false],
    // The tie rule: equal q serves HTML; markdown needs a STRICTLY higher preference.
    ['text/markdown, text/html', false],
    ['text/markdown;q=0.5, text/html;q=0.5', false],
    // Wildcards compete for HTML at their own q, never for markdown.
    ['text/markdown, */*;q=0.8', true],
    ['text/markdown;q=0.5, */*', false],
    ['text/html;q=0.8, text/*;q=0.9, text/markdown;q=0.85', true],
    // Parameters and case are tolerated.
    ['TEXT/MARKDOWN', true],
    ['text/markdown;variant=GFM;q=0.8', true],
    // Absent or empty Accept serves HTML.
    [null, false],
    ['', false]
  ]

  it.each(table)('Accept %j negotiates markdown: %s', (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected)
  })
})

describe('negotiation scope', () => {
  it('never negotiates on explicit artifact, page, API, or feed paths, whatever the Accept', async () => {
    const mock = stubFetch()
    for (const path of ['/llms.txt', '/llms-full.txt', '/index.md', '/feed.xml', '/feed.json', '/api/csp-report', '/privacy/']) {
      const {context, next} = makeContext(path, {headers: MARKDOWN})
      const response = await onRequest(context)

      expect(next, path).toHaveBeenCalledOnce()
      expect(await response.text(), path).toBe('<html>home</html>')
      expect(response.headers.get('Content-Type'), path).toBe('text/html; charset=utf-8')
    }
    expect(mock).not.toHaveBeenCalled()
  })

  it('never negotiates for unsafe methods on the homepage', async () => {
    const mock = stubFetch()
    const {context, next} = makeContext('/', {method: 'POST', headers: MARKDOWN})

    await onRequest(context)

    expect(next).toHaveBeenCalledOnce()
    expect(mock).not.toHaveBeenCalled()
  })

  it('passes a homepage HTML request through untouched, with Vary: Accept', async () => {
    const mock = stubFetch()
    const {context, next} = makeContext('/', {headers: {Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'}})

    const response = await onRequest(context)

    expect(next).toHaveBeenCalledOnce()
    expect(mock).not.toHaveBeenCalled()
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Vary')).toBe('Accept')
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(response.headers.get('Link')).toBe(LINK_HEADER)
  })

  it('merges Accept into an existing Vary without duplicating it', async () => {
    const cases: Array<[string, string]> = [['Origin', 'Origin, Accept'], ['Accept', 'Accept'], ['origin, accept', 'origin, accept']]
    for (const [existing, merged] of cases) {
      const next = vi.fn(async () => new Response('html', {headers: {Vary: existing}}))
      const response = await onRequest({request: new Request('https://jonathanlloyd.me/'), next, waitUntil: () => {}})

      expect(response.headers.get('Vary')).toBe(merged)
    }
  })
})

describe('negotiated homepage markdown', () => {
  it('serves the llms-full representation through the shared proxy machinery and header pipeline', async () => {
    const mock = stubFetch()
    const cache = stubCache()
    const {context, next, background} = makeContext('/', {headers: MARKDOWN})

    const response = await onRequest(context)
    await Promise.all(background)

    expect(next).not.toHaveBeenCalled()
    // The SAME machinery as the explicit /llms-full.txt route: focus gate first,
    // then the retried origin-cached upstream fetch -- not an independent bare fetch.
    expect(mock).toHaveBeenCalledWith(FOCUS_URL, FOCUS_FETCH_INIT)
    expect(mock).toHaveBeenCalledWith(LLMS_FULL_UPSTREAM, FETCH_CACHE_INIT)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('# full profile')
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy')
    expectPublicNoStore(response)
    // The header pipeline is the SAME one every response passes through.
    expect(response.headers.get('Content-Security-Policy')).toBe(CSP)
    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(response.headers.get('Link')).toBe(LINK_HEADER)
    expect(response.headers.get('Vary')).toBe('Accept')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    // The hardcoded token-count header is gone.
    expect(response.headers.get('x-markdown-tokens')).toBeNull()
    // waitUntil reached the REAL execution context: the last-known-good copy landed
    // under the same cache key the explicit route uses.
    expect(cache.put).toHaveBeenCalledOnce()
    const [cacheKey] = cache.put.mock.calls[0] as [Request, Response]
    expect(cacheKey.url).toBe(`https://jonathanlloyd.me${LLM_CONTENT_PATHS.llmsFull}?__cloudfront_proxy_lkg=v1`)
  })

  it('returns no body for a negotiated HEAD while keeping the GET headers', async () => {
    stubFetch()
    const {context, next} = makeContext('/', {method: 'HEAD', headers: MARKDOWN})

    const response = await onRequest(context)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expectPublicNoStore(response)
  })

  it('suppresses under a hiding focus mode with no-store and the pipeline headers', async () => {
    const mock = stubFetch('# full profile', 'Work')
    const {context, next} = makeContext('/', {headers: MARKDOWN})

    const response = await onRequest(context)

    expect(next).not.toHaveBeenCalled()
    expect(mock).toHaveBeenCalledOnce()
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.json()).toEqual({suppressed: true, reason: 'focus mode active'})
    expectPublicNoStore(response)
    expect(response.headers.get('Content-Security-Policy')).toBe(CSP)
  })

  it('fails closed with no-store when the focus state cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('focus unavailable', {status: 503})))
    const {context} = makeContext('/', {headers: MARKDOWN})

    const response = await onRequest(context)

    expect(response.status).toBe(502)
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-focus-error')
    expectPublicNoStore(response)
  })

  it('serves the warm last-known-good copy with no-store when the upstream fails', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus: 'Personal'})) : new Response('upstream down', {status: 503}))
      ))
    stubCache(new Response('known good', {headers: {'Cache-Control': 'public, max-age=10800'}}))
    const {context} = makeContext('/', {headers: MARKDOWN})

    const pending = onRequest(context)
    await vi.runAllTimersAsync()
    const response = await pending

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('known good')
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-stale')
    expectPublicNoStore(response)
  })

  it('fails visibly with no-store when the upstream fails and no safe copy exists', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus: 'Personal'})) : new Response('upstream down', {status: 503}))
      ))
    stubCache()
    const {context} = makeContext('/', {headers: MARKDOWN})

    const pending = onRequest(context)
    await vi.runAllTimersAsync()
    const response = await pending

    expect(response.status).toBe(502)
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-error')
    expectPublicNoStore(response)
  })

  it('keeps a warm cache from leaking across a focus transition, then recovers', async () => {
    let currentFocus = 'Personal'
    let artifactCalls = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url === FOCUS_URL) {
        return Promise.resolve(new Response(JSON.stringify({currentFocus})))
      }
      artifactCalls++
      return Promise.resolve(new Response(`content-${artifactCalls}`))
    }))
    const cache = stubCache(new Response('pre-focus LKG'))

    const warm = makeContext('/', {headers: MARKDOWN})
    expect(await (await onRequest(warm.context)).text()).toBe('content-1')
    await Promise.all(warm.background)
    expect(cache.put).toHaveBeenCalledOnce()

    currentFocus = 'Work'
    const suppressed = await onRequest(makeContext('/', {headers: MARKDOWN}).context)
    expect(suppressed.status).toBe(503)
    expectPublicNoStore(suppressed)
    expect(artifactCalls).toBe(1)
    expect(cache.match).not.toHaveBeenCalled()

    currentFocus = 'Personal'
    const recovered = await onRequest(makeContext('/', {headers: MARKDOWN}).context)
    expect(recovered.status).toBe(200)
    expect(await recovered.text()).toBe('content-2')
    expect(artifactCalls).toBe(2)
  })
})
