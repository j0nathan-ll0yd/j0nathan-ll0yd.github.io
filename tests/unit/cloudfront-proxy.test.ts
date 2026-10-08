import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE, LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {LKG_ADMISSION, LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy, PROXY_TIMEOUTS} from '../../functions/_lib/proxy'
import type {CloudfrontProxyContext} from '../../functions/_lib/proxy'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts'
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

// Every network call the proxy makes carries an AbortSignal now: the per-operation deadline asks
// the platform to cancel, and the race in withDeadline guarantees the bound even when it cannot.
// Every GATED fetch is also `cache: 'no-store'` with NO `cf` cache options (atlas decision 0160,
// PR 0b): a Cloudflare cache in front of the CloudFront gate served gated content without asking
// it. `expectGatedFetchesUncached` asserts the absence of `cf` on every call, which
// `objectContaining` alone cannot.
const GATED_FETCH_INIT = expect.objectContaining({cache: 'no-store', redirect: 'manual', signal: expect.any(AbortSignal)})
const FOCUS_URL = `${CLOUDFRONT_BASE}/focus.json`
const FOCUS_FETCH_INIT = expect.objectContaining({cache: 'no-store', signal: expect.any(AbortSignal)})
const COMPOSED_AT = 'x-amz-meta-composed-at'

/** Every non-focus fetch the proxy made was no-store and carried no `cf` cache options. */
function expectGatedFetchesUncached(mock: ReturnType<typeof vi.fn>) {
  const gated = mock.mock.calls.filter(([url]) => url !== FOCUS_URL)
  expect(gated.length).toBeGreaterThan(0)
  for (const [, init] of gated) {
    expect(init).toEqual(GATED_FETCH_INIT)
    expect(init).not.toHaveProperty('cf')
  }
}

/**
 * A response CloudFront served in this request: it carries `x-amz-cf-id` and a fresh composition
 * stamp, and no Cloudflare cache status. Only such a 200 is admitted.
 */
function fromCloudfront(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('x-amz-cf-id')) {
    headers.set('x-amz-cf-id', 'cloudfront-request')
  }
  if (!headers.has(COMPOSED_AT)) {
    headers.set(COMPOSED_AT, new Date().toISOString())
  }
  return new Response(body, {...init, headers})
}

/** A stored last-known-good copy, stamped with its upstream composition time (fresh by default). */
function lkgCopy(body: string, headers: Record<string, string> = {}, composedAt: string | null = new Date().toISOString()): Response {
  const stamped = new Headers({'Cache-Control': 'public, max-age=10800', ...headers})
  if (composedAt !== null) {
    stamped.set('X-Proxy-Lkg-Composed-At', composedAt)
  }
  return new Response(body, {headers: stamped})
}

const SUPPRESSION_BODY = JSON.stringify({suppressed: true, reason: 'focus mode active'})

/** A fetch or body read that never settles -- the hang every bound in proxy.ts exists to cut off. */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

/**
 * Drive the fake clock forward and assert the request SETTLED inside `ms`.
 *
 * Reading the fake clock is the measurement: `vi.useFakeTimers()` mocks Date, so the elapsed
 * value is the wall-clock the request would have spent in production, not test overhead.
 */
async function settleWithin(pending: Promise<Response>, ms: number) {
  const startedAt = Date.now()
  let settled = false
  const tracked = pending.then((value) => {
    settled = true
    return value
  })
  await vi.advanceTimersByTimeAsync(ms)
  expect(settled, `request did not settle within ${ms}ms`).toBe(true)
  return {response: await tracked, elapsedMs: Date.now() - startedAt}
}

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

function expectPublicNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
  expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store')
}

/**
 * A CloudFront outage of the artifact (every attempt answers `status` with `x-amz-cf-id`) followed
 * by a gate probe that answers 200. No error status is gate evidence, so the probe is what admits
 * the last-known-good copy.
 */
function stubOutageWithOpenProbe(status = 502) {
  let artifactCalls = 0
  const mock = vi.fn().mockImplementation((url: string) => {
    if (url === FOCUS_URL) {
      return Promise.resolve(new Response(JSON.stringify({currentFocus: 'Personal'})))
    }
    artifactCalls++
    return Promise.resolve(artifactCalls <= 3
      ? new Response('upstream down', {status, headers: {'x-amz-cf-id': 'terminal-request'}})
      : fromCloudfront('probe body is never served'))
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('makeCloudfrontProxy', () => {
  // covers: llms-txt#Canonical llms responses always pass through the privacy gate
  it('serves success, caches only 2xx upstream statuses, and records last-known-good', async () => {
    const composedAt = new Date(Date.now() - 60_000).toISOString()
    const mock = stubFetch(fromCloudfront('# content', {headers: {'x-amz-cf-id': 'cloudfront-request-1', [COMPOSED_AT]: composedAt}}))
    const cache = stubCache()
    const {context, background} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/markdown; charset=utf-8'})

    const res = await proxy(context)
    await Promise.all(background)

    expect(mock).toHaveBeenCalledWith(`${CLOUDFRONT_BASE}/thing.txt`, GATED_FETCH_INIT)
    expectGatedFetchesUncached(mock)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(mock).toHaveBeenCalledWith(FOCUS_URL, FOCUS_FETCH_INIT)
    // No cachePolicy passed, so this exercises the DEFAULT policy, which is no-store.
    expectPublicNoStore(res)
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy')
    expect(res.headers.get('X-Proxy-Attempts')).toBe('1')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('200')
    expect(res.headers.get('X-Proxy-Upstream-Request-Id')).toBe('cloudfront-request-1')
    expect(await res.text()).toBe('# content')

    expect(cache.put).toHaveBeenCalledOnce()
    const [cacheKey, cachedResponse] = cache.put.mock.calls[0] as [Request, Response]
    expect(cacheKey.url).toBe('https://jonathanlloyd.me/thing.txt?__cloudfront_proxy_lkg=v1')
    expect(cachedResponse.headers.get('Cache-Control')).toBe('public, max-age=10800')
    expect(cachedResponse.headers.get('CDN-Cache-Control')).toBeNull()
    expect(cachedResponse.headers.get('Cloudflare-CDN-Cache-Control')).toBeNull()
    expect(cachedResponse.headers.get('X-Proxy-Lkg-Stored-At')).toBeTruthy()
    // The copy carries its SOURCE age, the upstream composition stamp, not only its storage time.
    expect(cachedResponse.headers.get('X-Proxy-Lkg-Composed-At')).toBe(composedAt)
    expect(await cachedResponse.text()).toBe('# content')
  })

  it('retries a bounded transient failure and returns the recovered response', async () => {
    vi.useFakeTimers()
    const artifacts = [new Response('temporary', {status: 503, headers: {'x-amz-cf-id': 'failed-request'}}), fromCloudfront('recovered')]
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
    const mock = stubOutageWithOpenProbe()
    const cache = stubCache(lkgCopy('known good', {'Content-Type': 'text/plain; charset=utf-8', 'X-Proxy-Lkg-Stored-At': '2026-08-22T20:00:00.000Z'}))
    const {context} = makeContext()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const pending = proxy(context)
    await vi.runAllTimersAsync()
    const res = await pending

    expect(mock).toHaveBeenCalledTimes(5) // focus, three attempts, one gate probe
    expect(cache.match).toHaveBeenCalledOnce()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    // No cachePolicy passed, so the stale path also carries the DEFAULT policy, which is no-store.
    expectPublicNoStore(res)
    expect(res.headers.get('Warning')).toBe('110 - "Response is stale"')
    expect(res.headers.get('X-Proxy-Stale')).toBe('true')
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-stale')
    expect(res.headers.get('X-Proxy-Attempts')).toBe('3')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('502')
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
    expectPublicNoStore(res)
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
    expectPublicNoStore(res)
  })

  it('fails closed when the ungated focus state returns a non-retryable status, without retrying it', async () => {
    // 403 is a definite answer from the focus origin, not a blip: one probe, then deny. The
    // retryable-status path (503) is covered in "bounded network attempts" below.
    const mock = vi.fn().mockResolvedValue(new Response('focus unavailable', {status: 403}))
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
    expectPublicNoStore(res)
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
      return Promise.resolve(fromCloudfront(`content-${artifactCalls}`))
    })
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(lkgCopy('pre-focus LKG'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const warm = makeContext()
    expect(await (await proxy(warm.context)).text()).toBe('content-1')
    await Promise.all(warm.background)
    expect(cache.put).toHaveBeenCalledOnce()

    currentFocus = 'Work'
    const firstSuppressed = await proxy(makeContext().context)
    expect(firstSuppressed.status).toBe(503)
    expect(firstSuppressed.headers.get('Retry-After')).toBe('60')
    expectPublicNoStore(firstSuppressed)
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

// covers: llms-txt#Every proxy network attempt is bounded in time
// Retry COUNT bounded nothing about DURATION. A single never-resolving fetch, or a response whose
// body stalls mid-stream, held the request open indefinitely -- preventing BOTH a prompt failure
// and the last-known-good fallback. These pin the bound itself, not the mechanism that enforces it.
describe('bounded network attempts', () => {
  it('finishes within the total budget when the artifact fetch never resolves', async () => {
    const mock = vi.fn().mockImplementation((url: string) =>
      url === FOCUS_URL ? Promise.resolve(new Response(JSON.stringify({currentFocus: 'Personal'}))) : neverSettles<Response>()
    )
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mock)
    stubCache()
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const {response, elapsedMs} = await settleWithin(proxy(makeContext().context), PROXY_TIMEOUTS.totalMs)

    expect(elapsedMs).toBeLessThanOrEqual(PROXY_TIMEOUTS.totalMs)
    expect(response.status).toBe(502)
    expectPublicNoStore(response)
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-error')
    expect(response.headers.get('X-Proxy-Attempts')).toBe('3')
    expect(response.headers.get('X-Proxy-Upstream-Status')).toBe('unreachable')
    expect(logger.error).toHaveBeenCalledWith('cloudfront_proxy_terminal_failure',
      expect.objectContaining({artifact: '/thing.txt', error_class: 'TimeoutError'}))
  })

  it('finishes within the total budget when the artifact body stalls, and still serves last-known-good', async () => {
    // A stalled body is invisible to any deadline placed on the fetch alone: headers arrive, the
    // status is 200, and the bytes never do. The eligible failure must still reach the stale path.
    const stalledBody = {
      ok: true,
      status: 200,
      // A real CloudFront 200: its headers passed the gate in this request, so the gate is open.
      headers: new Headers({'x-amz-cf-id': 'stalled-request'}),
      arrayBuffer: () => neverSettles<ArrayBuffer>()
    } as unknown as Response
    const mock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus: 'Personal'})) : stalledBody)
    )
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(lkgCopy('known good'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const {response, elapsedMs} = await settleWithin(proxy(makeContext().context), PROXY_TIMEOUTS.totalMs)

    expect(elapsedMs).toBeLessThanOrEqual(PROXY_TIMEOUTS.totalMs)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('known good')
    expect(cache.match).toHaveBeenCalledOnce()
    expect(cache.put).not.toHaveBeenCalled()
    expect(response.headers.get('X-Proxy-Stale')).toBe('true')
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-stale')
    expect(response.headers.get('Warning')).toBe('110 - "Response is stale"')
    expect(response.headers.get('X-Proxy-Attempts')).toBe('3')
    // A run that never held complete bytes reads as unreachable, not as the 200 whose body stalled.
    // A retained 2xx would read as a definite non-retryable answer and withhold this fallback.
    expect(response.headers.get('X-Proxy-Upstream-Status')).toBe('unreachable')
  })

  it('fails closed within the budget when the focus probe never resolves, without touching the artifact', async () => {
    const mock = vi.fn().mockImplementation((url: string) => url === FOCUS_URL ? neverSettles<Response>() : Promise.resolve(new Response('leak')))
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(new Response('old content'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const {response, elapsedMs} = await settleWithin(proxy(makeContext().context), PROXY_TIMEOUTS.totalMs)

    expect(elapsedMs).toBeLessThanOrEqual(PROXY_TIMEOUTS.totalMs)
    expect(response.status).toBe(502)
    expectPublicNoStore(response)
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-focus-error')
    expect(mock).toHaveBeenCalledTimes(2) // one focus probe, one bounded retry -- and no artifact fetch
    expect(mock).not.toHaveBeenCalledWith(`${CLOUDFRONT_BASE}/thing.txt`, expect.anything())
    expect(cache.match).not.toHaveBeenCalled()
  })

  it('retries a transient focus failure once and serves the artifact when the retry succeeds', async () => {
    const focusResponses = [new Response('focus blip', {status: 503}), new Response(JSON.stringify({currentFocus: 'Personal'}))]
    const mock = vi.fn().mockImplementation((url: string) => Promise.resolve(url === FOCUS_URL ? focusResponses.shift()! : fromCloudfront('payload')))
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mock)
    vi.stubGlobal('caches', undefined)
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const {response} = await settleWithin(proxy(makeContext().context), PROXY_TIMEOUTS.totalMs)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('payload')
    expect(mock).toHaveBeenCalledTimes(3) // failed probe, retried probe, artifact
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_focus_retry', expect.objectContaining({attempts: 1, upstream_status: 503}))
  })
})

// covers: llms-txt#Every proxy network attempt is bounded in time
// Four ways the gate can fail to reach a definite answer; every one of them must deny. Only the
// non-retryable-status branch was covered before -- the other three shipped untested.
describe('focus gate fails closed on every uncertain answer', () => {
  const uncertainProbes: Array<[string, Response | Error, string, number]> = [
    ['a transport error', new Error('connection reset'), 'Error', 2],
    ['a response body that is not JSON', new Response('<html>not json</html>'), 'InvalidFocusJson', 1],
    ['a body whose currentFocus is not a string', new Response(JSON.stringify({currentFocus: 42})), 'InvalidFocusState', 1]
  ]

  it.each(uncertainProbes)('denies on %s', async (_label, focusAnswer, errorClass, expectedProbes) => {
    const mock = vi.fn().mockImplementation((url: string) => {
      if (url !== FOCUS_URL) {
        return Promise.resolve(new Response('leak'))
      }
      return focusAnswer instanceof Error ? Promise.reject(focusAnswer) : Promise.resolve(focusAnswer.clone())
    })
    vi.useFakeTimers()
    vi.stubGlobal('fetch', mock)
    const cache = stubCache(new Response('old content'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const {response} = await settleWithin(proxy(makeContext().context), PROXY_TIMEOUTS.totalMs)

    expect(response.status).toBe(502)
    expect(await response.text()).toBe('focus state unavailable')
    expectPublicNoStore(response)
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-focus-error')
    expect(mock).toHaveBeenCalledTimes(expectedProbes) // a malformed ANSWER is not retried; transport is
    expect(mock).not.toHaveBeenCalledWith(`${CLOUDFRONT_BASE}/thing.txt`, expect.anything())
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('cloudfront_proxy_focus_probe_failed',
      expect.objectContaining({artifact: '/thing.txt', error_class: errorClass}))
  })
})

describe('proxy routes', () => {
  // covers: llms-txt#Discovery index and full dump are served at the contract paths
  // Every artifact the site serves from its own domain: upstream CloudFront
  // path + the public Content-Type the route owns.
  const routes: Array<[string, (context: CloudfrontProxyContext) => Promise<Response>, string, string]> = [
    ['/llms.txt', llmsTxtRoute, LLMS_TXT_PATH, 'text/plain; charset=utf-8'],
    ['/llms-full.txt', llmsFullRoute, LLM_CONTENT_PATHS.llmsFull, 'text/markdown; charset=utf-8'],
    ['/index.md', indexMdRoute, LLM_CONTENT_PATHS.indexMarkdown, 'text/markdown; charset=utf-8'],
    ['/feed.xml', feedXmlRoute, '/feed.xml', 'application/rss+xml; charset=utf-8'],
    ['/feed.json', feedJsonRoute, '/feed.json', 'application/feed+json; charset=utf-8']
  ]

  it.each(routes)('%s proxies its CloudFront artifact', async (route, onRequest, upstreamPath, contentType) => {
    const mock = stubFetch(fromCloudfront('payload'))
    vi.stubGlobal('caches', undefined)
    const {context} = makeContext(route)
    const res = await onRequest(context)

    expect(mock).toHaveBeenCalledWith(FOCUS_URL, FOCUS_FETCH_INIT)
    expect(mock).toHaveBeenCalledWith(`${CLOUDFRONT_BASE}${upstreamPath}`, GATED_FETCH_INIT)
    expectGatedFetchesUncached(mock)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(contentType)
  })
})

describe('per-route cache policy', () => {
  // covers: llms-txt#Every proxy route is no-store, the feed routes included
  // All five routes are gated (atlas decision 0160, plan D3: no Cloudflare artifact cache on a
  // gated path). The regression class under guard: any route's success or stale path reverting to
  // a shared-cacheable policy. The feeds once carried `s-maxage=60`, and Cloudflare's zone edge
  // cache replayed them for up to 796 s with no focus probe. proxy.ts builds all five, so a
  // per-route regression is invisible from the factory tests alone -- they must be asserted per route.
  const routes: Array<[string, (context: CloudfrontProxyContext) => Promise<Response>]> = [
    ['/llms.txt', llmsTxtRoute],
    ['/llms-full.txt', llmsFullRoute],
    ['/index.md', indexMdRoute],
    ['/feed.xml', feedXmlRoute],
    ['/feed.json', feedJsonRoute]
  ]

  it.each(routes)('%s serves no-store on the success path', async (route, onRequest) => {
    stubFetch(fromCloudfront('payload'))
    vi.stubGlobal('caches', undefined)
    const {context} = makeContext(route)

    const res = await onRequest(context)

    expect(res.status).toBe(200)
    expectPublicNoStore(res)
  })

  it.each(routes)('%s serves no-store on the stale last-known-good path, whatever the stored copy says', async (route, onRequest) => {
    vi.useFakeTimers()
    stubOutageWithOpenProbe()
    // The stored copy carries a shared-cacheable policy on purpose: the stale path must overwrite
    // whatever it reads from the cache with the ROUTE's policy, not inherit the entry's headers.
    stubCache(lkgCopy('known good', {'Cache-Control': 'public, max-age=600, s-maxage=60'}))
    const {context} = makeContext(route)

    const pending = onRequest(context)
    await vi.runAllTimersAsync()
    const res = await pending

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-stale')
    expectPublicNoStore(res)
  })

  it.each(routes)('%s stores a cacheable last-known-good copy despite the no-store public policy', async (route, onRequest) => {
    stubFetch(fromCloudfront('payload'))
    const cache = stubCache()
    const {context, background} = makeContext(route)

    await onRequest(context)
    await Promise.all(background)

    const [, stored] = cache.put.mock.calls[0] as [Request, Response]
    expect(stored.headers.get('Cache-Control')).toBe('public, max-age=10800')
    expect(stored.headers.get('CDN-Cache-Control')).toBeNull()
    expect(stored.headers.get('Cloudflare-CDN-Cache-Control')).toBeNull()
  })

  it('exports the llm-outputs policy as no-store on every cache header', () => {
    expect(LLM_OUTPUT_CACHE_POLICY).toEqual({cacheControl: 'no-store', cdnCacheControl: 'no-store'})
  })
})

describe('routes ignore Accept', () => {
  // covers: llms-txt#Markdown negotiation applies only to the homepage and honors Accept q-values
  // Negotiation is the middleware's homepage-only decision. The explicit artifact
  // and feed routes read nothing off Accept: each keeps its own bytes and content
  // type for every Accept value, including an explicit text/markdown.
  const routes: Array<[string, (context: CloudfrontProxyContext) => Promise<Response>, string]> = [
    ['/llms.txt', llmsTxtRoute, 'text/plain; charset=utf-8'],
    ['/llms-full.txt', llmsFullRoute, 'text/markdown; charset=utf-8'],
    ['/index.md', indexMdRoute, 'text/markdown; charset=utf-8'],
    ['/feed.xml', feedXmlRoute, 'application/rss+xml; charset=utf-8'],
    ['/feed.json', feedJsonRoute, 'application/feed+json; charset=utf-8']
  ]

  it.each(routes)('%s serves its own artifact under Accept: text/markdown', async (route, onRequest, contentType) => {
    stubFetch(fromCloudfront('own artifact'))
    vi.stubGlobal('caches', undefined)
    const context: CloudfrontProxyContext = {
      request: new Request(`https://jonathanlloyd.me${route}`, {headers: {Accept: 'text/markdown'}}),
      waitUntil: () => {}
    }

    const res = await onRequest(context)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(contentType)
    expect(await res.text()).toBe('own artifact')
  })
})

describe('non-retryable upstream privacy responses', () => {
  it('never retries or serves last-known-good content for an upstream 403 that is not a suppression body', async () => {
    const mock = stubFetch(fromCloudfront('<Error><Code>AccessDenied</Code></Error>', {status: 403}))
    const cache = stubCache(lkgCopy('pre-focus LKG'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})

    const res = await proxy(makeContext().context)

    expect(mock).toHaveBeenCalledTimes(2)
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    expectPublicNoStore(res)
    expect(res.headers.get('X-Proxy-Attempts')).toBe('1')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('403')
  })
})

// covers: llms-txt#Gated artifacts are admitted only through the CloudFront gate
// Atlas decision 0160, PR 0b (adversarial finding H01). The backend gate runs on viewer-request,
// BEFORE CloudFront's cache, and the backend closes it before publishing a hiding signal; a failed
// publication leaves it shut over a VISIBLE signal. A visible focus probe is therefore never
// permission on its own. Every case below starts from a visible focus value.
describe('gate admission', () => {
  const ARTIFACT_URL = `${CLOUDFRONT_BASE}/thing.txt`
  const proxy = () => makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})
  const visibleFocus = () => new Response(JSON.stringify({currentFocus: 'Personal'}))

  /** Answers focus visibly and every artifact request from `answers`, in order (the last repeats). */
  function stubArtifactAnswers(answers: Array<() => Promise<Response>>) {
    let call = 0
    const mock = vi.fn().mockImplementation((url: string) => {
      if (url === FOCUS_URL) {
        return Promise.resolve(visibleFocus())
      }
      const answer = answers[Math.min(call, answers.length - 1)]
      call++
      return answer()
    })
    vi.stubGlobal('fetch', mock)
    return mock
  }

  async function run(): Promise<Response> {
    vi.useFakeTimers()
    const pending = proxy()(makeContext().context)
    await vi.runAllTimersAsync()
    return pending
  }

  const suppression = () => Promise.resolve(new Response(SUPPRESSION_BODY, {status: 403, headers: {'x-amz-cf-id': 'gate-denied'}}))
  const cloudfront502 = () => Promise.resolve(fromCloudfront('origin unreachable', {status: 502}))
  const cloudfront503 = () => Promise.resolve(fromCloudfront('service unavailable', {status: 503}))
  const transport = () => Promise.reject(new TypeError('network connection lost'))
  const cloudflare52x = () => Promise.resolve(new Response('origin unreachable', {status: 522}))
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

  it('serves the suppression response when the gate is shut over a visible focus signal, even with a warm copy', async () => {
    const mock = stubArtifactAnswers([suppression])
    const cache = stubCache(lkgCopy('pre-hiding content'))

    const res = await run()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-suppressed')
    expectPublicNoStore(res)
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(1) // a definite answer: no retry
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('cloudfront_proxy_gate_suppressed', expect.objectContaining({artifact: '/thing.txt'}))
    expectGatedFetchesUncached(mock)
  })

  it.each(['HIT', 'STALE', 'UPDATING', 'REVALIDATED', 'hit'])('refuses a 200 that Cloudflare served from its cache (cf-cache-status %s)', async (status) => {
    const mock = stubArtifactAnswers([() => Promise.resolve(fromCloudfront('cached gated content', {headers: {'cf-cache-status': status}}))])
    const cache = stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(await res.text()).toBe('thing.txt unavailable')
    expect(res.headers.get('X-Proxy-Refused')).toBe('cloudflare-cache')
    expectPublicNoStore(res)
    // A refusal is a privacy decision: no retry, no copy read, no copy written.
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(1)
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('cloudfront_proxy_unproven_response',
      expect.objectContaining({artifact: '/thing.txt', reason: 'cloudflare-cache', cf_cache_status: status}))
  })

  it('refuses a 200 that carries no x-amz-cf-id, because nothing proves it passed the gate', async () => {
    stubArtifactAnswers([() => Promise.resolve(new Response('unattributed', {headers: {[COMPOSED_AT]: new Date().toISOString()}}))])
    const cache = stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(res.headers.get('X-Proxy-Refused')).toBe('no-cloudfront-id')
    expect(cache.match).not.toHaveBeenCalled()
  })

  it.each(['MISS', 'BYPASS', 'DYNAMIC', 'EXPIRED'])('admits a CloudFront 200 whose cf-cache-status is %s', async (status) => {
    stubArtifactAnswers([() => Promise.resolve(fromCloudfront('fresh', {headers: {'cf-cache-status': status}}))])
    stubCache()

    const res = await run()

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('fresh')
  })

  // No CloudFront error status proves the gate function let the request through. AWS documents
  // that with CloudFront Functions a 503 "can indicate that your function returned an execution
  // error" (http-503-service-unavailable.html) and a 502 "can indicate that the CloudFront function
  // is trying to add, delete, or change a read-only header" (http-502-bad-gateway.html).
  it.each([500, 502, 503, 504])('treats a CloudFront %s as no gate evidence: the copy needs a gate probe that returns 200', async (status) => {
    const originError = () => Promise.resolve(fromCloudfront('origin error', {status}))
    const mock = stubArtifactAnswers([originError, originError, originError, () => Promise.resolve(fromCloudfront('probe body is never served'))])
    const composedAt = minutesAgo(30)
    stubCache(lkgCopy('known good', {}, composedAt))

    const res = await run()

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('known good')
    expect(res.headers.get('X-Proxy-Stale')).toBe('true')
    expect(res.headers.get('X-Proxy-Lkg-Composed-At')).toBe(composedAt)
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(4) // three attempts, one probe
    expectGatedFetchesUncached(mock)
  })

  it.each([500, 502, 503, 504])('refuses the copy when the gate probe also answers a CloudFront %s', async (status) => {
    const originError = () => Promise.resolve(fromCloudfront('origin error', {status}))
    const mock = stubArtifactAnswers([originError])
    stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(4)
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_lkg_refused', expect.objectContaining({reason: 'no-gate-evidence'}))
  })

  // Atlas 0160 PR 0b: only a 200 is a complete artifact, and a redirect must never carry
  // a gated request somewhere the gate does not guard.
  it.each([203, 204, 206])('refuses a CloudFront %s instead of serving it as the artifact', async (status) => {
    const mock = stubArtifactAnswers([() => Promise.resolve(fromCloudfront(status === 204 ? null : 'partial', {status}))])
    const cache = stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(res.headers.get('X-Proxy-Refused')).toBe('non-200-success')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe(String(status))
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(1)
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('does not follow a redirect from a gated path', async () => {
    const mock = stubArtifactAnswers([
      () => Promise.resolve(fromCloudfront(null, {status: 301, headers: {Location: 'https://elsewhere.example/thing.txt'}}))
    ])
    const cache = stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('301')
    expect(mock.mock.calls.map(([url]) => url)).toEqual([FOCUS_URL, ARTIFACT_URL])
    for (const [, init] of mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)) {
      expect(init).toHaveProperty('redirect', 'manual')
    }
    expect(cache.match).not.toHaveBeenCalled()
  })

  it('refuses a copy whose upstream composition is older than the source-age bound', async () => {
    stubArtifactAnswers([cloudfront502])
    const tooOld = new Date(Date.now() - LKG_ADMISSION.maxSourceAgeMs - 60_000).toISOString()
    const cache = stubCache(lkgCopy('stale content', {'X-Proxy-Lkg-Stored-At': new Date().toISOString()}, tooOld))

    const res = await run()

    expect(LKG_ADMISSION.maxSourceAgeMs).toBe(3 * 60 * 60 * 1000)
    expect(cache.match).toHaveBeenCalledOnce()
    expect(res.status).toBe(502)
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-error')
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_lkg_refused', expect.objectContaining({reason: 'source-too-old'}))
  })

  it.each<[string, string | null]>([
    ['no composition stamp', null],
    ['an unparseable stamp', 'yesterday'],
    ['a stamp far in the future', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()],
    // Loose forms Date.parse accepts but that are not ISO-8601 date-times.
    ['a bare number', '1'],
    ['a bare year', '2026'],
    ['an RFC 1123 date', new Date().toUTCString()],
    ['a date without a time', new Date().toISOString().slice(0, 10)]
  ])('refuses a copy with %s', async (_label, composedAt) => {
    stubArtifactAnswers([cloudfront502])
    stubCache(lkgCopy('unprovable age', {}, composedAt))

    const res = await run()

    expect(res.status).toBe(502)
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_lkg_refused',
      expect.objectContaining({reason: _label === 'a stamp far in the future' ? 'composed-at-in-future' : 'no-composed-at'}))
  })

  it.each(['1', '2026', new Date().toUTCString()])('writes no copy for a 200 whose composition stamp is the loose form %s', async (stamp) => {
    stubArtifactAnswers([() => Promise.resolve(fromCloudfront('loosely stamped', {headers: {[COMPOSED_AT]: stamp}}))])
    const cache = stubCache()
    const {context, background} = makeContext()

    const res = await proxy()(context)
    await Promise.all(background)

    expect(res.status).toBe(200)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('after a transport failure, admits the copy only once a gate probe reaches CloudFront', async () => {
    const mock = stubArtifactAnswers([transport, transport, transport, () => Promise.resolve(fromCloudfront('probe body is never served'))])
    stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('known good')
    expect(res.headers.get('X-Proxy-Upstream-Status')).toBe('unreachable')
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(4) // three attempts, one probe
    expectGatedFetchesUncached(mock)
  })

  it('after a transport failure, serves the suppression response when the gate probe meets the gate', async () => {
    stubArtifactAnswers([transport, transport, transport, suppression])
    const cache = stubCache(lkgCopy('pre-hiding content'))

    const res = await run()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(cache.put).not.toHaveBeenCalled()
  })

  it.each<[string, () => Promise<Response>]>([
    ['fails in transport', transport],
    ['times out', () => neverSettles<Response>()],
    ['answers a Cloudflare 52x without x-amz-cf-id', cloudflare52x],
    ['answers a 403 that is not a suppression body', () => Promise.resolve(new Response('denied', {status: 403}))],
    ['answers a CloudFront 503', cloudfront503],
    // A probe 200 proves the gate open only when it passed the gate in THIS request: a 200 replayed
    // from a Cloudflare cache, or one without x-amz-cf-id, proves nothing.
    ...['HIT', 'STALE', 'UPDATING', 'REVALIDATED'].map((status): [string, () => Promise<Response>] => [
      `answers a 200 from the Cloudflare cache (cf-cache-status ${status})`,
      () => Promise.resolve(fromCloudfront('cached', {headers: {'cf-cache-status': status}}))
    ]),
    ['answers a 200 without x-amz-cf-id', () => Promise.resolve(new Response('unattributed'))],
    // Only a 200 is proof: another success status, or a redirect, is not.
    ...[203, 204, 206].map((status): [string, () => Promise<Response>] => [
      `answers a CloudFront ${status}`,
      () => Promise.resolve(fromCloudfront(status === 204 ? null : 'partial', {status}))
    ]),
    ...[301, 302, 307, 308].map((status): [string, () => Promise<Response>] => [
      `answers a CloudFront ${status} redirect`,
      () => Promise.resolve(fromCloudfront(null, {status, headers: {Location: 'https://elsewhere.example/thing.txt'}}))
    ])
  ])('after a transport failure, refuses the copy when the gate probe %s', async (_label, probe) => {
    stubArtifactAnswers([transport, transport, transport, probe])
    stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy-error')
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_lkg_refused', expect.objectContaining({reason: 'no-gate-evidence'}))
  })

  it('treats Cloudflare-generated 52x answers as transport, not as gate evidence', async () => {
    const mock = stubArtifactAnswers([cloudflare52x, cloudflare52x, cloudflare52x, cloudflare52x])
    stubCache(lkgCopy('known good'))

    const res = await run()

    expect(res.status).toBe(502)
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(4) // the probe ran, and found no evidence
  })

  it('does not probe when no admissible copy exists', async () => {
    const mock = stubArtifactAnswers([transport])
    stubCache(lkgCopy('too old', {}, minutesAgo(LKG_ADMISSION.maxSourceAgeMs / 60_000 + 1)))

    const res = await run()

    expect(res.status).toBe(502)
    expect(mock.mock.calls.filter(([url]) => url === ARTIFACT_URL)).toHaveLength(3)
  })

  it('writes no copy for a 200 without a composition stamp, since its source age is unknowable', async () => {
    stubArtifactAnswers([() => Promise.resolve(new Response('unstamped', {headers: {'x-amz-cf-id': 'cf'}}))])
    const cache = stubCache()
    const {context, background} = makeContext()

    const res = await proxy()(context)
    await Promise.all(background)

    expect(res.status).toBe(200)
    expect(cache.put).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('cloudfront_proxy_lkg_unstamped', expect.objectContaining({artifact: '/thing.txt'}))
  })
})
