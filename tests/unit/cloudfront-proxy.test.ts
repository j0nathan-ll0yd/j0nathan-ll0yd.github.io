import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE, LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {makeCloudfrontProxy} from '../../functions/_lib/proxy'
import type {CloudfrontProxyContext} from '../../functions/_lib/proxy'
import {onRequest as feedJsonRoute} from '../../functions/feed.json.ts'
import {onRequest as feedXmlRoute} from '../../functions/feed.xml.ts'
import {onRequest as indexMdRoute} from '../../functions/index.md.ts'
import {onRequest as llmsFullRoute} from '../../functions/llms-full.txt.ts'
import {onRequest as llmsTxtRoute} from '../../functions/llms.txt.ts'

const logger = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()}))
vi.mock('@j0nathan-ll0yd/observability/edge', () => ({createEdgeLogger: () => logger}))

// Unit tests for the shared CloudFront proxy factory and the five routes built
// from it. The regression class under guard: a transient upstream failure being
// cached for an hour, or a multi-route CloudFront outage having no safe fallback.

const FETCH_CACHE_INIT = {cf: {cacheEverything: true, cacheTtlByStatus: {'200-299': 60, '300-599': 0}}}
const FOCUS_URL = `${CLOUDFRONT_BASE}/focus.json`
const FOCUS_FETCH_INIT = {cache: 'no-store'}

function makeContext(path = '/thing.txt', method = 'GET') {
  const background: Promise<unknown>[] = []
  const context: CloudfrontProxyContext = {
    request: new Request(`https://jonathanlloyd.me${path}`, {method}),
    waitUntil: (promise) => background.push(promise)
  }
  return {context, background}
}

function stubFetch(response: Response) {
  const mock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus: 'Personal'})) : response)
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

function stubCache(cached?: Response) {
  const cache = {match: vi.fn().mockResolvedValue(cached), put: vi.fn().mockResolvedValue(undefined)}
  vi.stubGlobal('caches', {default: cache})
  return cache
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('makeCloudfrontProxy', () => {
  it('serves success, caches only 2xx upstream statuses, and records last-known-good', async () => {
    const mock = stubFetch(new Response('# content', {headers: {'x-amz-cf-id': 'cloudfront-request-1'}}))
    const cache = stubCache()
    const {context, background} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/markdown; charset=utf-8'})

    const res = await proxy(context)
    await Promise.all(background)

    expect(mock).toHaveBeenCalledWith(`${CLOUDFRONT_BASE}/thing.txt`, FETCH_CACHE_INIT)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(mock).toHaveBeenCalledWith(FOCUS_URL, FOCUS_FETCH_INIT)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60')
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy')
    expect(res.headers.get('X-Proxy-Attempts')).toBe('1')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('200')
    expect(res.headers.get('X-Proxy-Upstream-Request-Id')).toBe('cloudfront-request-1')
    expect(await res.text()).toBe('# content')

    expect(cache.put).toHaveBeenCalledOnce()
    const [cacheKey, cachedResponse] = cache.put.mock.calls[0] as [Request, Response]
    expect(cacheKey.url).toBe('https://jonathanlloyd.me/thing.txt?__cloudfront_proxy_lkg=v1')
    expect(cachedResponse.headers.get('Cache-Control')).toBe('public, max-age=10800')
    expect(cachedResponse.headers.get('X-Proxy-Lkg-Stored-At')).toBeTruthy()
    expect(await cachedResponse.text()).toBe('# content')
  })

  it('retries a bounded transient failure and returns the recovered response', async () => {
    vi.useFakeTimers()
    const artifacts = [new Response('temporary', {status: 503, headers: {'x-amz-cf-id': 'failed-request'}}), new Response('recovered')]
    const mock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus: 'Personal'})) : artifacts.shift()!)
    )
    vi.stubGlobal('fetch', mock)
    vi.stubGlobal('caches', undefined)
    const {context} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const pending = proxy(context)
    await vi.runAllTimersAsync()
    const res = await pending

    expect(mock).toHaveBeenCalledTimes(3)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Proxy-Attempts')).toBe('2')
    expect(await res.text()).toBe('recovered')
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_retry',
      expect.objectContaining({artifact: '/thing.txt', attempts: 1, upstream_status: 503, upstream_request_id: 'failed-request'}))
  })

  it('serves an explicit stale last-known-good response after retries are exhausted', async () => {
    vi.useFakeTimers()
    const mock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url === FOCUS_URL
        ? new Response(JSON.stringify({currentFocus: 'Personal'}))
        : new Response('upstream down', {status: 503, headers: {'x-amz-cf-id': 'terminal-request'}}))
    )
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(
      new Response('known good', {
        headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=10800', 'X-Proxy-Lkg-Stored-At': '2026-08-22T20:00:00.000Z'}
      })
    )
    const {context} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const pending = proxy(context)
    await vi.runAllTimersAsync()
    const res = await pending

    expect(mock).toHaveBeenCalledTimes(4)
    expect(cache.match).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60')
    expect(res.headers.get('Warning')).toBe('110 - "Response is stale"')
    expect(res.headers.get('X-Proxy-Stale')).toBe('true')
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-stale')
    expect(res.headers.get('X-Proxy-Attempts')).toBe('3')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('503')
    expect(res.headers.get('X-Proxy-Upstream-Request-Id')).toBe('terminal-request')
    expect(await res.text()).toBe('known good')
  })

  it('fails visibly and without caching when no safe representation exists', async () => {
    vi.useFakeTimers()
    const mock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url === FOCUS_URL
        ? new Response(JSON.stringify({currentFocus: 'Personal'}))
        : new Response('upstream down', {status: 503, headers: {'x-amz-cf-id': 'terminal-request'}}))
    )
    vi.stubGlobal('fetch', mock)
    const cache = stubCache()
    const {context} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/markdown; charset=utf-8'})

    const pending = proxy(context)
    await vi.runAllTimersAsync()
    const res = await pending

    expect(mock).toHaveBeenCalledTimes(4)
    expect(cache.match).toHaveBeenCalledOnce()
    expect(res.status).toBe(502)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-error')
    expect(res.headers.get('X-Proxy-Attempts')).toBe('3')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('503')
    expect(res.headers.get('X-Proxy-Upstream-Request-Id')).toBe('terminal-request')
    expect(await res.text()).toBe('thing.txt unavailable')
  })

  it('does not retry or mask a persistent non-transient upstream status', async () => {
    const mock = stubFetch(new Response('missing', {status: 404, headers: {'x-amz-cf-id': 'missing-request'}}))
    const cache = stubCache(new Response('old content'))
    const {context} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const res = await proxy(context)

    expect(mock).toHaveBeenCalledTimes(2)
    expect(cache.match).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    expect(res.headers.get('X-Proxy-Attempts')).toBe('1')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('404')
  })

  it('rejects unsafe client methods without contacting the upstream', async () => {
    const mock = stubFetch(new Response('unexpected'))
    const {context} = makeContext('/thing.txt', 'POST')
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const res = await proxy(context)

    expect(mock).not.toHaveBeenCalled()
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, HEAD')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('fails closed when the ungated focus state cannot be read', async () => {
    const mock = vi.fn().mockResolvedValue(new Response('focus unavailable', {status: 503}))
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(new Response('old content'))
    const {context} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const res = await proxy(context)

    expect(mock).toHaveBeenCalledOnce()
    expect(mock).toHaveBeenCalledWith(FOCUS_URL, FOCUS_FETCH_INIT)
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-focus-error')
  })

  it('prevents a warm response and LKG from leaking across a focus transition, then recovers immediately', async () => {
    let currentFocus = 'Personal'
    let artifactCalls = 0
    const mock = vi.fn().mockImplementation((url: string) => {
      if (url === FOCUS_URL) {
        return Promise.resolve(new Response(JSON.stringify({currentFocus})))
      }
      artifactCalls++
      return Promise.resolve(new Response(`content-${artifactCalls}`))
    })
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(new Response('pre-focus LKG'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const warm = makeContext()
    expect(await (await proxy(warm.context)).text()).toBe('content-1')
    await Promise.all(warm.background)
    expect(cache.put).toHaveBeenCalledOnce()

    currentFocus = 'Work'
    const firstSuppressed = await proxy(makeContext().context)
    expect(firstSuppressed.status).toBe(503)
    expect(firstSuppressed.headers.get('Retry-After')).toBe('60')
    expect(firstSuppressed.headers.get('Cache-Control')).toBe('no-store')
    expect(await firstSuppressed.json()).toEqual({suppressed: true, reason: 'focus mode active'})

    const sustained = await proxy(makeContext().context)
    expect(sustained.status).toBe(503)
    expect(artifactCalls).toBe(1)
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).toHaveBeenCalledOnce()

    currentFocus = 'Personal'
    const recovered = await proxy(makeContext().context)
    expect(recovered.status).toBe(200)
    expect(await recovered.text()).toBe('content-2')
    expect(artifactCalls).toBe(2)
  })
})

describe('proxy routes', () => {
  // covers: llms-txt#Discovery index and full dump are served at the contract paths
  // Every artifact the site serves from its own domain: upstream CloudFront
  // path + the public Content-Type the route owns.
  const routes: Array<[string, (context: CloudfrontProxyContext) => Promise<Response>, string, string]> = [
    ['/llms.txt', llmsTxtRoute, '/llms.txt', 'text/plain; charset=utf-8'],
    ['/llms-full.txt', llmsFullRoute, LLM_CONTENT_PATHS.llmsFull, 'text/markdown; charset=utf-8'],
    ['/index.md', indexMdRoute, LLM_CONTENT_PATHS.indexMarkdown, 'text/markdown; charset=utf-8'],
    ['/feed.xml', feedXmlRoute, '/feed.xml', 'application/rss+xml; charset=utf-8'],
    ['/feed.json', feedJsonRoute, '/feed.json', 'application/feed+json; charset=utf-8']
  ]

  it.each(routes)('%s proxies its CloudFront artifact', async (route, onRequest, upstreamPath, contentType) => {
    const mock = stubFetch(new Response('payload'))
    vi.stubGlobal('caches', undefined)
    const {context} = makeContext(route)
    const res = await onRequest(context)

    expect(mock).toHaveBeenCalledWith(FOCUS_URL, FOCUS_FETCH_INIT)
    expect(mock).toHaveBeenCalledWith(`${CLOUDFRONT_BASE}${upstreamPath}`, FETCH_CACHE_INIT)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(contentType)
  })
})

describe('non-retryable upstream privacy responses', () => {
  it('never retries or serves last-known-good content for an upstream 403', async () => {
    const mock = stubFetch(new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403}))
    const cache = stubCache(new Response('pre-focus LKG'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const res = await proxy(makeContext().context)

    expect(mock).toHaveBeenCalledTimes(2)
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Proxy-Attempts')).toBe('1')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('403')
  })
})
