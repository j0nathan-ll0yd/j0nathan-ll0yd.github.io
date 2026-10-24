/**
 * The developer API facade through the built Worker under `wrangler dev` (is-agentic api-v1 plan):
 * the run_worker_first routing, the Astro `ALL` endpoints, the site middleware, the gated proxy
 * against the fixture data plane, and the API_RATE_LIMITER Durable Object that wrangler simulates
 * as the rate-limiter Worker (workers/rate-limiter/, its own `wrangler dev`) behind the site's
 * `script_name` binding. playwright.behavioral.config.ts starts both beside `astro preview`, which answers
 * an OPTIONS preflight itself and so cannot measure the Worker's CORS answer. /developers, a page,
 * is read from the preview.
 *
 * tests/unit/api-v1.test.ts runs the handler in Node with a stub counter. This suite proves the real
 * object: a 61-request burst gets exactly one 429. Each test sends its own CF-Connecting-IP, so each
 * owns a fresh counter (the object is named by the digest of that address). Cloudflare overwrites the
 * header on every proxied request, so a deployed client cannot choose its own counter this way.
 */
import {type APIResponse, expect, test} from '@playwright/test'
import {ENDPOINTS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {API_PROBLEMS, API_V1_RATE_LIMIT, DATA_SOURCES} from '../../src/lib/edge/agent-catalog.mjs'
import {resetDataPlane, setDataPlane} from '../data-plane/control'

const PROBLEM = 'application/problem+json; charset=utf-8'
const WRANGLER_DEV = `http://127.0.0.1:${process.env.WRANGLER_DEV_PORT ?? '8788'}`
const POLICY = `"default";q=${API_V1_RATE_LIMIT.limit};w=${API_V1_RATE_LIMIT.windowSeconds}`

let clients = 0
/** A client address no other test in this run uses. */
function client(): Record<string, string> {
  clients += 1
  return {'CF-Connecting-IP': `198.51.100.${clients}`, 'X-Run': String(Date.now())}
}

/** The `r` and `t` of a RateLimit field value. */
function rateLimit(response: APIResponse): {r: number; t: number} {
  const match = /^"default";r=(\d+);t=(\d+)$/.exec(response.headers()['ratelimit'] ?? '')
  expect(match, `RateLimit ${response.headers()['ratelimit']}`).not.toBeNull()
  return {r: Number(match![1]), t: Number(match![2])}
}

test.beforeEach(async () => {
  await resetDataPlane()
})

test.afterAll(async () => {
  await resetDataPlane()
})

test.describe('the developer API facade in the Worker', () => {
  test.use({baseURL: WRANGLER_DEV})

  test('a 61-request burst gets exactly one 429, with Retry-After, while r counts down', async ({request}) => {
    const headers = client()
    const remaining: number[] = []
    for (let i = 0; i < API_V1_RATE_LIMIT.limit; i++) {
      const response = await request.get(`/api/v1${ENDPOINTS.focus}`, {headers})
      expect(response.status(), `request ${i + 1}`).toBe(200)
      expect(response.headers()['ratelimit-policy']).toBe(POLICY)
      remaining.push(rateLimit(response).r)
    }
    expect(remaining).toEqual(Array.from({length: API_V1_RATE_LIMIT.limit}, (_, i) => API_V1_RATE_LIMIT.limit - 1 - i))

    const refused = await request.get(`/api/v1${ENDPOINTS.focus}`, {headers})
    expect(refused.status()).toBe(429)
    expect(refused.headers()['content-type']).toBe(PROBLEM)
    const {r, t} = rateLimit(refused)
    expect(r).toBe(0)
    expect(Number(refused.headers()['retry-after'])).toBe(t)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(API_V1_RATE_LIMIT.windowSeconds)
    expect(await refused.json()).toMatchObject({status: 429, retryAfterSeconds: t, instance: `/api/v1${ENDPOINTS.focus}`})

    // Another client keeps its own budget.
    const other = await request.get(`/api/v1${ENDPOINTS.focus}`, {headers: client()})
    expect(other.status()).toBe(200)
    expect(rateLimit(other).r).toBe(API_V1_RATE_LIMIT.limit - 1)
  })

  test('serves an export with the RateLimit fields, CORS and no-store', async ({request}) => {
    const response = await request.get(`/api/v1${ENDPOINTS.books}`, {headers: client()})
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/json; charset=utf-8')
    expect(response.headers()['access-control-allow-origin']).toBe('*')
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(rateLimit(response).r).toBe(API_V1_RATE_LIMIT.limit - 1)
    expect(Array.isArray((await response.json()).books)).toBe(true)
  })

  test('translates a gate suppression and a hiding focus value into the 503 focus-suppressed problem', async ({request}) => {
    await setDataPlane({[ENDPOINTS.books]: {kind: 'suppress'}})
    const gated = await request.get(`/api/v1${ENDPOINTS.books}`, {headers: client()})
    expect(gated.status()).toBe(503)
    expect(gated.headers()['content-type']).toBe(PROBLEM)
    expect(gated.headers()['retry-after']).toBe('60')
    expect(await gated.json()).toMatchObject({suppressed: true, reason: 'focus mode active', status: 503})

    await resetDataPlane()
    await setDataPlane({[ENDPOINTS.focus]: {kind: 'json', body: {currentFocus: 'Work'}}})
    const hidden = await request.get(`/api/v1${ENDPOINTS.sleep}`, {headers: client()})
    expect(hidden.status()).toBe(503)
    expect(await hidden.json()).toMatchObject({suppressed: true, type: `${SITE_URL}/developers#problem-focus-suppressed`})
  })

  test('never lets text/plain or the HTML 404 escape /api', async ({request}) => {
    await setDataPlane({[ENDPOINTS.articles]: {kind: 'status', status: 500}})
    const cases: Array<[string, string, number]> = [
      ['GET', '/api/v1/__not_a_resource__.json', 404],
      ['GET', '/api/v1', 404],
      ['GET', '/api/v1/', 404],
      ['GET', '/api/nope', 404],
      ['DELETE', '/api/nope', 404],
      ['POST', `/api/v1${ENDPOINTS.books}`, 405],
      ['PUT', `/api/v1${ENDPOINTS.books}`, 405],
      ['GET', `/api/v1${ENDPOINTS.articles}`, 502],
      ['GET', '/api/csp-report', 405],
      ['PUT', '/api/csp-report', 405]
    ]
    for (const [method, path, status] of cases) {
      const response = await request.fetch(path, {method, headers: {...client(), Accept: 'text/markdown'}})
      expect(response.status(), `${method} ${path}`).toBe(status)
      expect(response.headers()['content-type'], `${method} ${path}`).toBe(PROBLEM)
      const body = await response.json()
      expect(body.status).toBe(status)
      expect(body.instance).toBe(path.replace(/\/$/, ''))
      if (status === 405) {
        expect(response.headers()['allow']).toBe(path === '/api/csp-report' ? 'POST' : 'GET, HEAD')
      }
    }
  })

  test('answers HEAD with the headers and no body', async ({request}) => {
    const response = await request.head(`/api/v1${ENDPOINTS.focus}`, {headers: client()})
    expect(response.status()).toBe(200)
    expect(response.headers()['ratelimit-policy']).toBe(POLICY)
    expect((await response.body()).length).toBe(0)
  })

  test('answers a CORS preflight with 204 and the facade headers', async ({request}) => {
    const response = await request.fetch(`/api/v1${ENDPOINTS.books}`, {
      method: 'OPTIONS',
      headers: {...client(), Origin: 'https://agent.example', 'Access-Control-Request-Method': 'GET'}
    })
    expect(response.status()).toBe(204)
    expect(response.headers()['access-control-allow-origin']).toBe('*')
    expect(response.headers()['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS')
    expect(response.headers()['access-control-max-age']).toBe('86400')
    expect(response.headers()['ratelimit-policy']).toBe(POLICY)
  })
})

test.describe('/developers documents the facade', () => {
  test('renders a visible heading for every problem type, and links every export at /api/v1/', async ({page}) => {
    await page.goto('/developers')
    for (const problem of API_PROBLEMS as ReadonlyArray<{anchor: string; title: string}>) {
      const heading = page.locator(`#errors #${problem.anchor}`)
      await expect(heading, problem.anchor).toBeVisible()
      await expect(heading).toContainText(problem.title)
      await expect(page.getByRole('heading', {level: 3, name: problem.title})).toHaveAttribute('id', problem.anchor)
    }
    for (const id of ['errors', 'versioning', 'rate-limits']) {
      await expect(page.locator(`section#${id} h2`)).toBeVisible()
    }
    const hrefs = await page.locator('#api li a').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    expect(hrefs).toHaveLength(DATA_SOURCES.length)
    for (const href of hrefs) {
      const url = new URL(href)
      expect(url.origin).toBe(SITE_URL)
      expect(url.pathname.startsWith('/api/v1/'), href).toBe(true)
    }
  })
})
