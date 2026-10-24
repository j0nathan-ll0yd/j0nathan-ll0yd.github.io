// The developer API facade (src/lib/edge/api-v1.ts), its problem builder and its rate limiter, in
// Node. tests/behavioral/api-v1.spec.ts runs the same routes through the built Worker with the
// Durable Object.
import {llm} from '@j0nathan-ll0yd/copy'
import {ENDPOINTS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ApiRateLimiter} from '../../src/durable/ApiRateLimiter'
import {isSuppressionValue} from '../../src/lib/data-plane/admission'
import {AGENT_PATHS, API_PROBLEMS, API_V1_BASE, API_V1_RATE_LIMIT, DATA_SOURCES} from '../../src/lib/edge/agent-catalog.mjs'
import {API_V1_VALID_PATHS, apiNotFound, type GatedReader, handleApiV1, resolveApiV1Path, UPSTREAM_RETRY_AFTER_SECONDS} from '../../src/lib/edge/api-v1'
import {onRequest as siteMiddleware} from '../../src/lib/edge/middleware'
import {PROBLEM_MEDIA_TYPE, problemBody} from '../../src/lib/edge/problem'
import {SUPPRESSION_REASON, SUPPRESSION_SOURCE} from '../../src/lib/edge/proxy'
import {
  checkRateLimit,
  clientKey,
  clientPartition,
  consumeWindow,
  type RateLimitDecision,
  type RateLimiterNamespace,
  rateLimitHeader,
  rateLimitPolicyHeader,
  type WindowState
} from '../../src/lib/edge/rate-limit'
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
      expect(Object.values(llm.developers)).toContain(problem.detail)
    }
  })

  it('states the enforced numbers in the developer copy', () => {
    expect(llm.developers.rateLimitBody).toMatch(new RegExp(`\\b${API_V1_RATE_LIMIT.limit}\\b`))
    expect(llm.developers.rateLimitBody).toMatch(new RegExp(`\\b${API_V1_RATE_LIMIT.windowSeconds}\\b`))
    expect(llm.developers.versioningBody).toMatch(/\b90\b/)
  })
})

describe('problemBody', () => {
  it('carries the RFC 9457 members and the extensions, never overwriting a standard member', () => {
    expect(problemBody('not-found', '/api/x', {validPaths: ['/a']})).toEqual({
      type: `${SITE_URL}/developers#problem-not-found`,
      title: llm.developers.problemNotFoundTitle,
      status: 404,
      detail: llm.developers.problemNotFoundDetail,
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

describe('clientPartition (the counter key input)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3:8d3::/64'],
    ['2001:0db8:85a3:08d3:ffff:ffff:ffff:ffff', '2001:db8:85a3:8d3::/64'],
    ['2001:DB8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['unknown', 'unknown'],
    ['1:2:3', '1:2:3']
  ])('%s is partition %s', (ip, partition) => {
    expect(clientPartition(ip)).toBe(partition)
  })

  it('gives every address in one IPv6 /64 the same counter, and another /64 its own', async () => {
    const key = await clientKey('2001:db8:1:2::a')
    expect(await clientKey('2001:db8:1:2:ffff::b')).toBe(key)
    expect(await clientKey('2001:db8:1:3::a')).not.toBe(key)
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

describe('consumeWindow (the fixed window)', () => {
  it('counts down r from limit - 1 to 0, then refuses until the window ends', () => {
    const policy = {policy: 'default', limit: 3, windowSeconds: 60}
    let state: WindowState | undefined
    const seen: Array<[boolean, number, number]> = []
    for (let i = 0; i < 4; i++) {
      const result = consumeWindow(state, 1_000 + i * 1_000, policy)
      state = result.state
      seen.push([result.decision.allowed, result.decision.remaining, result.decision.resetSeconds])
    }
    expect(seen).toEqual([[true, 2, 60], [true, 1, 59], [true, 0, 58], [false, 0, 57]])
    expect(state!.count).toBe(3)
    const next = consumeWindow(state, 61_000, policy)
    expect(next.decision).toEqual({allowed: true, remaining: 2, resetSeconds: 60})
  })

  it('never reports t below 1 inside a window', () => {
    const {decision} = consumeWindow({count: 1, windowEndMs: 10_000}, 9_999, API_V1_RATE_LIMIT)
    expect(decision.resetSeconds).toBe(1)
  })
})

describe('the RateLimit field serializers (draft-ietf-httpapi-ratelimit-headers-11)', () => {
  it('writes the policy item with q and w, and the service limit item with r and t', () => {
    expect(rateLimitPolicyHeader()).toBe(POLICY)
    expect(rateLimitHeader({allowed: true, remaining: 7, resetSeconds: 9})).toBe('"default";r=7;t=9')
  })
})

describe('checkRateLimit', () => {
  it('treats a malformed or slow counter answer as no decision', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const request = new Request(`${ORIGIN}/api/v1/books.json`)
    expect(await checkRateLimit(request, limiter(() => ({allowed: true, remaining: -1, resetSeconds: 0})))).toBeNull()
    // RATE_LIMIT_TIMEOUT_MS bounds a counter that never answers.
    expect(await checkRateLimit(request, limiter(() => new Promise<RateLimitDecision>(() => {})))).toBeNull()
    warn.mockRestore()
  })

  it('logs one warning per reason per interval, however many requests fail open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const request = new Request(`${ORIGIN}/api/v1/books.json`)
    const before = warn.mock.calls.length
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(request, limiter(() => Promise.reject(new Error('quota'))))
    }
    expect(warn.mock.calls.length - before).toBeLessThanOrEqual(1)
    warn.mockRestore()
  })
})

describe('ApiRateLimiter (the Durable Object)', () => {
  function objectWithStorage() {
    const kv = new Map<string, unknown>()
    const alarms: number[] = []
    let deleted = 0
    const ctx = {
      storage: {
        kv: {
          get: (key: string) => kv.get(key),
          put: (key: string, value: unknown) => void kv.set(key, value),
          delete: (key: string) => kv.delete(key)
        },
        setAlarm: async (time: number) => void alarms.push(time),
        deleteAll: async () => {
          kv.clear()
          deleted++
        }
      }
    }
    const object = new (ApiRateLimiter as unknown as new(ctx: unknown, env: unknown) => ApiRateLimiter)(ctx, {})
    return {object, kv, alarms, deleted: () => deleted}
  }

  it('counts per object, sets one alarm per window, and forgets the client when it fires', async () => {
    vi.useFakeTimers({now: 1_000_000})
    const {object, kv, alarms, deleted} = objectWithStorage()
    const decisions: RateLimitDecision[] = []
    for (let i = 0; i < 3; i++) {
      decisions.push(await object.consume(2, 60))
    }
    expect(decisions.map((d) => [d.allowed, d.remaining])).toEqual([[true, 1], [true, 0], [false, 0]])
    expect(alarms).toEqual([1_060_000])
    vi.setSystemTime(1_060_000)
    await object.alarm()
    expect(kv.size).toBe(0)
    expect(deleted()).toBe(1)
    expect((await object.consume(2, 60)).remaining).toBe(1)
    vi.useRealTimers()
  })

  it("keeps a newer window when the old window's alarm runs late", async () => {
    vi.useFakeTimers({now: 2_000_000})
    const {object, kv, alarms} = objectWithStorage()
    await object.consume(2, 60)
    vi.setSystemTime(2_060_001)
    await object.consume(2, 60)
    await object.alarm()
    expect(kv.size).toBe(1)
    expect(alarms).toEqual([2_060_000, 2_120_001, 2_120_001])
    expect((await object.consume(2, 60)).remaining).toBe(0)
    vi.useRealTimers()
  })

  it('writes nothing for a refused request, and starts fresh over malformed state', async () => {
    vi.useFakeTimers({now: 3_000_000})
    const {object, kv} = objectWithStorage()
    kv.set('window', {count: 'x'})
    expect((await object.consume(1, 60)).allowed).toBe(true)
    const stored = kv.get('window')
    expect((await object.consume(1, 60)).allowed).toBe(false)
    expect(kv.get('window')).toBe(stored)
    vi.useRealTimers()
  })
})
