// The developer API facade (src/lib/edge/api-v1.ts) and its problem builder, in Node. The rate
// limiter and its Durable Object have their own suite (tests/unit/api-rate-limiter.test.ts).
// tests/behavioral/api-v1.spec.ts runs the same routes through the built Worker with the object.
import {llm} from '@j0nathan-ll0yd/copy'
import {ENDPOINTS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {isSuppressionValue} from '../../src/lib/data-plane/admission'
import {AGENT_PATHS, API_PROBLEMS, API_V1_BASE, API_V1_RATE_LIMIT, DATA_SOURCES} from '../../src/lib/edge/agent-catalog.mjs'
import {
  API_V1_EXPOSED_HEADERS,
  API_V1_PATHS,
  API_V1_VALID_PATHS,
  apiNotFound,
  type GatedReader,
  handleApiV1,
  resolveApiV1Path,
  UPSTREAM_RETRY_AFTER_SECONDS
} from '../../src/lib/edge/api-v1'
import {onRequest as siteMiddleware} from '../../src/lib/edge/middleware'
import {PROBLEM_MEDIA_TYPE, problemBody} from '../../src/lib/edge/problem'
import {PROXY_TIMEOUTS, SUPPRESSION_REASON, SUPPRESSION_SOURCE} from '../../src/lib/edge/proxy'
import {COMPOSED_AT_METADATA_HEADER} from '../../src/lib/edge/feed-artifacts'
import {onRequest as cspReport} from '../../src/pages/api/csp-report'
import {clientKey, type RateLimitDecision, type RateLimiterNamespace} from '../../src/lib/edge/rate-limit'
import {suppressionBody} from '../../audits/lib/suppression.mjs'

const ORIGIN = 'https://jonathanlloyd.me'
const POLICY = `"default";q=${API_V1_RATE_LIMIT.limit};w=${API_V1_RATE_LIMIT.windowSeconds}`

function context(path: string, init: RequestInit = {}) {
  return {request: new Request(`${ORIGIN}${path}`, init), waitUntil: () => {}}
}

/** A namespace whose every client gets the next decision from `decisions`. */
function limiter(decide: () => RateLimitDecision | Promise<RateLimitDecision>): RateLimiterNamespace & {names: string[]} {
  const names: string[] = []
  return {
    names,
    getByName(name: string) {
      names.push(name)
      return {consume: async () => decide()}
    }
  }
}

const allowed = (remaining = 59, resetSeconds = 42): RateLimitDecision => ({allowed: true, remaining, resetSeconds})

/** The gated proxy's answer shapes (src/lib/edge/proxy.ts). */
const proxied = {
  ok: () =>
    new Response('{"books":[]}', {
      headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Source': 'cloudfront-proxy', 'X-Proxy-Attempts': '1'}
    }),
  suppressed: (method = 'GET') =>
    new Response(method === 'HEAD' ? null : JSON.stringify({suppressed: true, reason: SUPPRESSION_REASON}), {
      status: 503,
      headers: {'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60', 'X-Source': SUPPRESSION_SOURCE, 'Cache-Control': 'no-store'}
    }),
  focusError: () =>
    new Response('focus state unavailable', {
      status: 502,
      headers: {'Content-Type': 'text/plain; charset=utf-8', 'X-Source': 'cloudfront-proxy-focus-error'}
    }),
  terminal: () =>
    new Response('books.json unavailable', {
      status: 502,
      headers: {'Content-Type': 'text/plain; charset=utf-8', 'X-Source': 'cloudfront-proxy-error', 'X-Proxy-Upstream-Status': '500'}
    }),
  notAllowed: () => new Response('Method not allowed', {status: 405, headers: {'Content-Type': 'text/plain', Allow: 'GET, HEAD'}})
}

function reader(answer: () => Response): GatedReader & {calls: string[]} {
  const calls: string[] = []
  return Object.assign(async (path: string) => {
    calls.push(path)
    return answer()
  }, {calls})
}

async function problemOf(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get('Content-Type')).toBe(PROBLEM_MEDIA_TYPE)
  return await response.json() as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the facade constants', () => {
  it('serves every export at API_V1_BASE plus its contract path, beside the unchanged CloudFront URL', () => {
    expect(API_V1_BASE).toBe(`${SITE_URL}${AGENT_PATHS.apiV1}`)
    expect(DATA_SOURCES).toHaveLength(9)
    for (const source of DATA_SOURCES) {
      expect(source.apiUrl).toBe(`${API_V1_BASE}${source.path}`)
      expect(source.url.endsWith(source.path)).toBe(true)
      expect(source.url.startsWith(SITE_URL)).toBe(false)
    }
    expect(API_V1_VALID_PATHS).toEqual(Object.values(ENDPOINTS).map((path) => `/api/v1${path}`))
  })

  it('types five problems, each a /developers fragment, with copy for title and detail', () => {
    expect(API_PROBLEMS.map((p: {slug: string; status: number}) => [p.slug, p.status])).toEqual([
      ['not-found', 404],
      ['method-not-allowed', 405],
      ['rate-limited', 429],
      ['focus-suppressed', 503],
      ['upstream-unavailable', 502]
    ])
    for (const problem of API_PROBLEMS as ReadonlyArray<{slug: string; type: string; title: string; detail: string}>) {
      expect(problem.type).toBe(`${SITE_URL}${AGENT_PATHS.developers}#problem-${problem.slug}`)
      expect(Object.values(llm.developers)).toContain(problem.title)
      expect(Object.values(llm.developers).map((text) => text.split('{siteUrl}').join(SITE_URL))).toContain(problem.detail)
      expect(problem.detail).not.toContain('{siteUrl}')
    }
  })

  it('states the enforced numbers in the developer copy', () => {
    expect(llm.developers.rateLimitBody).toMatch(new RegExp(`\\b${API_V1_RATE_LIMIT.limit} requests\\b`))
    expect(API_V1_RATE_LIMIT.windowSeconds).toBe(60)
    expect(llm.developers.rateLimitBody).toMatch(/\bminute\b|\b60 seconds\b/)
    expect(llm.developers.versioningBody).toMatch(/\b90 days\b/)
    // The published method-neutral wording: one key serves /api/v1 (Allow: GET, HEAD) and the CSP collector (Allow: POST).
    expect(llm.developers.problemMethodNotAllowedDetail).toBe('This path accepts only the methods listed in the Allow header of the response.')
  })
})

describe('problemBody', () => {
  it('carries the RFC 9457 members and the extensions, never overwriting a standard member', () => {
    expect(problemBody('not-found', '/api/x', {validPaths: ['/a']})).toEqual({
      type: `${SITE_URL}/developers#problem-not-found`,
      title: llm.developers.problemNotFoundTitle,
      status: 404,
      detail: llm.developers.problemNotFoundDetail.split('{siteUrl}').join(SITE_URL),
      instance: '/api/x',
      validPaths: ['/a']
    })
    expect(() => problemBody('not-found', '/x', {status: 200})).toThrow(/standard member/)
  })
})

describe('resolveApiV1Path', () => {
  it.each([
    ['/api/v1/books.json', '/books.json'],
    ['/api/v1/focus.json', '/focus.json'],
    ['/api/v1', null],
    ['/api/v1/', null],
    ['/api/v1/nope.json', null],
    ['/api/v1/v1/books.json', null],
    ['/api/v1/books.json/x', null],
    ['/api/v1/books.JSON', null],
    ['/api/v2/books.json', null]
  ])('%s resolves to %s', (pathname, expected) => {
    expect(resolveApiV1Path(pathname)).toBe(expected)
  })
})

// covers: developer-api#Every failure under /api is an RFC 9457 problem
describe('handleApiV1: path and method come first', () => {
  it.each(['/api/v1', '/api/v1/nope.json', '/api/v1/nested/books.json'])('%s answers the not-found problem and reads nothing', async (path) => {
    const read = reader(proxied.ok)
    const rate = limiter(() => allowed())
    const response = await handleApiV1(context(path), {vars: {}, rateLimiter: rate}, read)
    expect(response.status).toBe(404)
    const body = await problemOf(response)
    expect(body).toMatchObject({status: 404, instance: path, validPaths: API_V1_VALID_PATHS, type: `${SITE_URL}/developers#problem-not-found`})
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(read.calls).toEqual([])
    expect(rate.names).toEqual([])
  })

  it('answers an unsafe method with the 405 problem and Allow, before the counter or a read', async () => {
    const read = reader(proxied.ok)
    const rate = limiter(() => allowed())
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const response = await handleApiV1(context('/api/v1/books.json', {method}), {vars: {}, rateLimiter: rate}, read)
      expect(response.status, method).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, HEAD')
      expect(await problemOf(response)).toMatchObject({status: 405, instance: '/api/v1/books.json'})
    }
    expect(read.calls).toEqual([])
    expect(rate.names).toEqual([])
  })

  it('answers a CORS preflight with 204, free of quota', async () => {
    const rate = limiter(() => allowed())
    const response = await handleApiV1(
      context('/api/v1/books.json', {method: 'OPTIONS', headers: {Origin: 'https://agent.example', 'Access-Control-Request-Method': 'GET'}}),
      {vars: {}, rateLimiter: rate},
      reader(proxied.ok)
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('Vary')).toBeNull()
    expect(rate.names).toEqual([])
  })
})

// covers: developer-api#The facade states and enforces a per-client rate limit
describe('handleApiV1: the rate limit', () => {
  it('sends RateLimit-Policy and RateLimit on a 200, and exposes them to scripts', async () => {
    const response = await handleApiV1(context('/api/v1/books.json'), {vars: {}, rateLimiter: limiter(() => allowed(59, 42))}, reader(proxied.ok))
    expect(response.status).toBe(200)
    expect(response.headers.get('RateLimit-Policy')).toBe(POLICY)
    expect(response.headers.get('RateLimit')).toBe('"default";r=59;t=42')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('RateLimit')
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('{"books":[]}')
  })

  it('answers over the limit with the 429 problem, Retry-After equal to t, and reads nothing', async () => {
    const read = reader(proxied.ok)
    const response = await handleApiV1(context('/api/v1/books.json'), {
      vars: {},
      rateLimiter: limiter(() => ({allowed: false, remaining: 0, resetSeconds: 17}))
    }, read)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    expect(response.headers.get('RateLimit')).toBe('"default";r=0;t=17')
    expect(await problemOf(response)).toMatchObject({status: 429, retryAfterSeconds: 17, type: `${SITE_URL}/developers#problem-rate-limited`})
    expect(read.calls).toEqual([])
  })

  it('fails open when the counter is unbound or throws: the read goes ahead with the policy and no RateLimit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const rateLimiter of [undefined, limiter(() => Promise.reject(new Error('DO down')))]) {
      const read = reader(proxied.ok)
      const response = await handleApiV1(context('/api/v1/books.json'), rateLimiter ? {vars: {}, rateLimiter} : {vars: {}}, read)
      expect(response.status).toBe(200)
      expect(response.headers.get('RateLimit-Policy')).toBe(POLICY)
      expect(response.headers.get('RateLimit')).toBeNull()
      expect(read.calls).toEqual(['/books.json'])
    }
    warn.mockRestore()
  })

  it('keys the counter on a digest of CF-Connecting-IP, never the address itself', async () => {
    const rate = limiter(() => allowed())
    await handleApiV1(context('/api/v1/books.json', {headers: {'CF-Connecting-IP': '203.0.113.7'}}), {vars: {}, rateLimiter: rate}, reader(proxied.ok))
    expect(rate.names).toEqual([await clientKey('203.0.113.7')])
    expect(rate.names[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(rate.names[0]).not.toContain('203.0.113.7')
  })
})

// covers: developer-api#The focus gate stays authoritative behind the facade
describe('handleApiV1: translating the gated proxy', () => {
  it('re-shapes the suppression as the 503 focus-suppressed problem that every recognizer still accepts', async () => {
    const response = await handleApiV1(context('/api/v1/books.json'), {vars: {}, rateLimiter: limiter(() => allowed())}, reader(() => proxied.suppressed()))
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.get('X-Source')).toBe(SUPPRESSION_SOURCE)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await problemOf(response)
    expect(body).toMatchObject({
      status: 503,
      suppressed: true,
      reason: SUPPRESSION_REASON,
      retryAfterSeconds: 60,
      detail: llm.developers.problemFocusSuppressedDetail
    })
    expect(isSuppressionValue(body)).toBe(true)
    expect(suppressionBody(body)).toBe(true)
  })

  it.each([['focus unavailable', proxied.focusError], ['terminal failure', proxied.terminal], ['an unexpected 405', proxied.notAllowed]])(
    'answers %s with the 502 upstream-unavailable problem, never the upstream body',
    async (_label, answer) => {
      const response = await handleApiV1(context('/api/v1/books.json'), {vars: {}, rateLimiter: limiter(() => allowed())}, reader(answer))
      expect(response.status).toBe(502)
      expect(response.headers.get('Retry-After')).toBe(String(UPSTREAM_RETRY_AFTER_SECONDS))
      const text = await response.clone().text()
      for (const upstreamText of ['focus state unavailable', 'books.json unavailable', 'Method not allowed']) {
        expect(text).not.toContain(upstreamText)
      }
      expect(await problemOf(response)).toMatchObject({status: 502, retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS})
    }
  )

  it('answers HEAD with the headers and no body, on a 200 and on a problem', async () => {
    for (const answer of [proxied.ok, () => proxied.suppressed('HEAD')]) {
      const response = await handleApiV1(context('/api/v1/books.json', {method: 'HEAD'}), {vars: {}, rateLimiter: limiter(() => allowed())}, reader(answer))
      expect(response.body).toBeNull()
      expect(response.headers.get('RateLimit-Policy')).toBe(POLICY)
    }
  })

  it('never lets text/plain escape: every failure path answers application/problem+json', async () => {
    const answers = [proxied.focusError, proxied.terminal, proxied.notAllowed, () => proxied.suppressed()]
    const cases: Array<[string, RequestInit, () => Response, RateLimitDecision]> = [
      ...answers.map((answer): [string, RequestInit, () => Response, RateLimitDecision] => ['/api/v1/books.json', {}, answer, allowed()]),
      ['/api/v1/nope.json', {}, proxied.ok, allowed()],
      ['/api/v1/books.json', {method: 'POST'}, proxied.ok, allowed()],
      ['/api/v1/books.json', {}, proxied.ok, {allowed: false, remaining: 0, resetSeconds: 3}]
    ]
    for (const [path, init, answer, decision] of cases) {
      const response = await handleApiV1(context(path, init), {vars: {}, rateLimiter: limiter(() => decision)}, reader(answer))
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.headers.get('Content-Type'), `${init.method ?? 'GET'} ${path}`).toBe(PROBLEM_MEDIA_TYPE)
    }
  })

  it('reads through the real gated proxy: a hiding focus value answers the problem and never fetches the export', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      fetched.push(new URL(url).pathname)
      const body = url.endsWith('/focus.json') ? {generatedAt: new Date().toISOString(), currentFocus: 'Work'} : {books: []}
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json', 'x-amz-cf-id': 'test'}})
    })
    const response = await handleApiV1({request: new Request('http://localhost/api/v1/books.json'), waitUntil: () => {}}, {
      vars: {DATA_PLANE_BASE: 'http://127.0.0.1:4399'},
      rateLimiter: limiter(() => allowed())
    })
    expect(response.status).toBe(503)
    expect(await problemOf(response)).toMatchObject({suppressed: true, reason: SUPPRESSION_REASON})
    expect(fetched).toEqual(['/focus.json'])
  })

  it('reads through the real gated proxy: a visible focus value serves the export bytes', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/focus.json') ? {generatedAt: new Date().toISOString(), currentFocus: 'None'} : {books: [{title: 'T'}]}
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json', 'x-amz-cf-id': 'test'}})
    })
    const response = await handleApiV1({request: new Request('http://localhost/api/v1/books.json'), waitUntil: () => {}}, {
      vars: {DATA_PLANE_BASE: 'http://127.0.0.1:4399'},
      rateLimiter: limiter(() => allowed(10, 5))
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({books: [{title: 'T'}]})
    expect(response.headers.get('RateLimit')).toBe('"default";r=10;t=5')
  })
})

describe('handleApiV1: an unexpected error', () => {
  it('still answers a problem, never the 500 page', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await handleApiV1(context('/api/v1/books.json'), {vars: {}, rateLimiter: limiter(() => allowed())}, async () => {
      throw new TypeError('boom')
    })
    expect(response.status).toBe(502)
    expect(await problemOf(response)).toMatchObject({status: 502, instance: '/api/v1/books.json'})
    error.mockRestore()
  })
})

describe('handleApiV1: no reader keeps a last-known-good copy (atlas decision 0166)', () => {
  const COPY = '{"stored":"last-known-good copy"}'
  const NON_RAW_PATHS = API_V1_PATHS.filter((path) => ![ENDPOINTS.health, ENDPOINTS.sleep, ENDPOINTS.workouts].includes(path))

  /** A Cache API stand-in that records every call and holds a copy the factory default would admit. */
  function warmCache() {
    const puts: string[] = []
    const matches: string[] = []
    vi.stubGlobal('caches', {
      default: {
        put: async (request: Request) => void puts.push(new URL(request.url).pathname),
        match: async (request: Request) => {
          matches.push(new URL(request.url).pathname)
          return new Response(COPY, {headers: {'X-Proxy-Lkg-Composed-At': new Date().toISOString(), 'X-Proxy-Lkg-Stored-At': new Date().toISOString()}})
        }
      }
    })
    return {puts, matches}
  }

  /**
   * CloudFront through the fixture seam. The focus signal reads `focus`; each artifact read goes to
   * `artifact`, with its attempt number. A read of the focus signal as the export under test
   * (`target`) is an artifact read: its reader runs no focus probe.
   */
  function upstream(focus: string, artifact: (attempt: number) => Response | Promise<Response>, target?: string) {
    let attempts = 0
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      fetched.push(url.pathname)
      if (url.pathname === ENDPOINTS.focus && target !== ENDPOINTS.focus && focus !== 'unreadable') {
        return new Response(JSON.stringify({generatedAt: new Date().toISOString(), currentFocus: focus}), {
          headers: {'content-type': 'application/json', 'x-amz-cf-id': 'test'}
        })
      }
      attempts += 1
      return artifact(attempts)
    })
    return fetched
  }

  /** Every answer carries the composition stamp a last-known-good write requires. */
  const fromCloudfront = (status: number, body: string) =>
    new Response(body, {
      status,
      headers: {'content-type': 'application/json', 'x-amz-cf-id': 'test', [COMPOSED_AT_METADATA_HEADER]: new Date().toISOString()}
    })

  /** Three 503s, then 200s: the exact failure the factory default answers with its copy (the gate probe sees the gate open). */
  const failsThenOpen = (attempt: number) => attempt <= 3 ? fromCloudfront(503, 'boom') : fromCloudfront(200, '{"gate":"probe"}')

  const local = (path: string) => ({
    request: new Request(`http://localhost/api/v1${path}`),
    waitUntil: (promise: Promise<unknown>) => void promise.catch(() => {})
  })
  const env = {vars: {DATA_PLANE_BASE: 'http://127.0.0.1:4399'}, rateLimiter: limiter(() => allowed(12, 30))}

  /** Settles the writes a reader handed to `waitUntil`, so a copy it stored is visible to the test. */
  async function answer(path: string): Promise<{response: Response; waited: number}> {
    const pending: Array<Promise<unknown>> = []
    const response = await handleApiV1({...local(path), waitUntil: (promise) => void pending.push(promise)}, env)
    await Promise.allSettled(pending)
    return {response, waited: pending.length}
  }

  it.each(API_V1_PATHS)('%s stores no copy on a 200, and schedules no write', async (path) => {
    const {puts, matches} = warmCache()
    upstream('None', () => fromCloudfront(200, '{"x":1}'), path)
    const {response, waited} = await answer(path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({x: 1})
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy')
    expect(waited).toBe(0)
    expect(puts).toEqual([])
    expect(matches).toEqual([])
  })

  it.each(API_V1_PATHS)('%s answers the 502 problem, never the copy, when the artifact fails and the gate reads open', async (path) => {
    const {puts, matches} = warmCache()
    const fetched = upstream('None', failsThenOpen, path)
    const {response} = await answer(path)
    expect(response.status).toBe(502)
    expect(response.headers.get('Content-Type')).toBe(PROBLEM_MEDIA_TYPE)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Retry-After')).toBe(String(UPSTREAM_RETRY_AFTER_SECONDS))
    expect(response.headers.get('X-Source')).toBe('cloudfront-proxy-error')
    expect(response.headers.get('X-Proxy-Attempts')).toBe('3')
    expect(response.headers.get('X-Proxy-Upstream-Status')).toBe('503')
    expect(response.headers.get('RateLimit')).toBe('"default";r=12;t=30')
    expect(response.headers.get('RateLimit-Policy')).toBe(POLICY)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Warning')).toBeNull()
    expect(response.headers.get('X-Proxy-Stale')).toBeNull()
    const text = await response.clone().text()
    expect(text).not.toContain('last-known-good copy')
    expect(text).not.toContain('boom')
    expect(await problemOf(response)).toMatchObject({
      type: `${SITE_URL}/developers#problem-upstream-unavailable`,
      status: 502,
      instance: `/api/v1${path}`,
      retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS
    })
    // Three artifact attempts and no gate probe: with no copy to admit, there is nothing to ask the gate.
    expect(fetched.filter((name) => name === path)).toHaveLength(3)
    expect(puts).toEqual([])
    expect(matches).toEqual([])
  })

  it('states an unreachable upstream on the problem, with no body from the copy', async () => {
    const {matches} = warmCache()
    upstream('None', () => Promise.reject(new TypeError('connection refused')))
    const {response} = await answer(ENDPOINTS.books)
    expect(response.status).toBe(502)
    expect(response.headers.get('X-Proxy-Upstream-Status')).toBe('unreachable')
    expect(await response.clone().text()).not.toContain('last-known-good copy')
    expect(matches).toEqual([])
  })

  it('answers the 502 problem, never the copy, when the artifact body stalls after a gate-open 200', async () => {
    // The stalled 200 is gate-open evidence, so the factory default would answer from the copy with no gate probe.
    const {matches} = warmCache()
    const stalled = {
      ok: true,
      status: 200,
      headers: new Headers({'x-amz-cf-id': 'stalled-request'}),
      arrayBuffer: () => new Promise<ArrayBuffer>(() => {})
    } as unknown as Response
    upstream('None', () => stalled)
    vi.useFakeTimers()
    try {
      const answered = handleApiV1(local(ENDPOINTS.books), env)
      await vi.advanceTimersByTimeAsync(PROXY_TIMEOUTS.totalMs)
      const response = await answered
      expect(response.status).toBe(502)
      expect(response.headers.get('X-Proxy-Upstream-Status')).toBe('unreachable')
      expect(response.headers.get('X-Proxy-Stale')).toBeNull()
      expect(await response.clone().text()).not.toContain('last-known-good copy')
      expect(matches).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers HEAD on an upstream failure with the problem headers and no body', async () => {
    const {matches} = warmCache()
    upstream('None', failsThenOpen)
    const response = await handleApiV1({...local(ENDPOINTS.books), request: new Request(`http://localhost/api/v1${ENDPOINTS.books}`, {method: 'HEAD'})}, env)
    expect(response.status).toBe(502)
    expect(response.headers.get('Retry-After')).toBe(String(UPSTREAM_RETRY_AFTER_SECONDS))
    expect(matches).toEqual([])
  })

  describe('the focus and privacy gate does not change', () => {
    const SUPPRESSIBLE = NON_RAW_PATHS.filter((path) => path !== ENDPOINTS.focus)

    it.each(SUPPRESSIBLE)('%s under a hiding focus value answers the 503 problem and never fetches the export', async (path) => {
      const {matches} = warmCache()
      const fetched = upstream('Work', () => fromCloudfront(200, '{"x":1}'))
      const {response} = await answer(path)
      expect(response.status).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(response.headers.get('X-Source')).toBe(SUPPRESSION_SOURCE)
      expect(await problemOf(response)).toMatchObject({suppressed: true, reason: SUPPRESSION_REASON})
      expect(fetched).toEqual([ENDPOINTS.focus])
      expect(matches).toEqual([])
    })

    it.each(SUPPRESSIBLE)('%s with the gate shut over a visible focus value answers the 503 problem', async (path) => {
      const {matches} = warmCache()
      upstream('None', () => new Response(JSON.stringify({suppressed: true, reason: SUPPRESSION_REASON}), {status: 403, headers: {'x-amz-cf-id': 'test'}}))
      const {response} = await answer(path)
      expect(response.status).toBe(503)
      expect(await problemOf(response)).toMatchObject({suppressed: true, reason: SUPPRESSION_REASON})
      expect(matches).toEqual([])
    })

    it.each(SUPPRESSIBLE)('%s with an unreadable focus signal answers the 502 problem and never fetches the export', async (path) => {
      const {matches} = warmCache()
      const fetched = upstream('unreadable', () => fromCloudfront(503, 'boom'))
      const {response} = await answer(path)
      expect(response.status).toBe(502)
      expect(fetched.every((name) => name === ENDPOINTS.focus)).toBe(true)
      expect(matches).toEqual([])
    })

    it('still serves the focus signal itself under a hiding value: it is never suppressed', async () => {
      warmCache()
      upstream('Work', () => fromCloudfront(200, '{"x":1}'))
      const {response} = await answer(ENDPOINTS.focus)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({currentFocus: 'Work'})
    })
  })

  it('exposes the RateLimit, Retry-After, versioning and Allow fields to cross-origin scripts', async () => {
    const response = await handleApiV1(context('/api/v1/books.json', {method: 'POST'}), {vars: {}}, reader(proxied.ok))
    const exposed = (response.headers.get('Access-Control-Expose-Headers') ?? '').split(', ')
    for (const name of ['RateLimit-Policy', 'RateLimit', 'Retry-After', 'Deprecation', 'Sunset', 'Link', 'Allow']) {
      expect(exposed, name).toContain(name)
    }
    // The facade keeps no copy, so nothing it answers carries these two.
    for (const name of ['Warning', 'X-Proxy-Stale']) {
      expect(exposed, name).not.toContain(name)
    }
    expect(exposed).toEqual([...API_V1_EXPOSED_HEADERS])
  })
})

describe('the CSP report collector under /api', () => {
  it('answers every method but POST with the 405 problem and Allow: POST', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
      const response = await cspReport({request: new Request(`${ORIGIN}/api/csp-report`, {method})})
      expect(response.status, method).toBe(405)
      expect(response.headers.get('Allow')).toBe('POST')
      expect(response.headers.get('Content-Type')).toBe(PROBLEM_MEDIA_TYPE)
      if (method !== 'HEAD') {
        expect(await response.json()).toMatchObject({status: 405, instance: '/api/csp-report', detail: llm.developers.problemMethodNotAllowedDetail})
      }
    }
  })

  it('keeps the POST collector: 204 for a report, 415 for another type', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const report = (type: string) =>
      cspReport({request: new Request(`${ORIGIN}/api/csp-report`, {method: 'POST', headers: {'Content-Type': type}, body: '{}'})})
    expect((await report('application/csp-report')).status).toBe(204)
    expect((await report('text/plain')).status).toBe(415)
    log.mockRestore()
  })
})

describe('apiNotFound (every other path under /api)', () => {
  it('answers the not-found problem for any method', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = apiNotFound(new Request(`${ORIGIN}/api/nope`, {method}))
      expect(response.status).toBe(404)
      expect(await problemOf(response)).toMatchObject({instance: '/api/nope', validPaths: API_V1_VALID_PATHS})
    }
  })

  it('keeps its problem body through the site middleware under Accept: text/markdown', async () => {
    const request = new Request(`${ORIGIN}/api/nope`, {headers: {Accept: 'text/markdown'}})
    const response = await siteMiddleware({request, next: async () => apiNotFound(request), waitUntil: () => {}})
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe(PROBLEM_MEDIA_TYPE)
    expect((await response.json() as {status: number}).status).toBe(404)
  })
})
