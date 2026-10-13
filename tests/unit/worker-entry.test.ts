import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CSP, LINK_HEADER} from '../../src/lib/edge/middleware'
import {SITE_RUNTIME, SITE_RUNTIME_HEADER} from '../../src/lib/edge/security-headers'

// src/worker.ts routes each request the way Pages routed it (atlas decision 0160, PR A). The Astro
// handler is the adapter's, so it is replaced here by a stub that records the request it got and
// answers like the ASSETS binding: 200 for a known file, the 404 page for anything else.

const handled: Request[] = []
const KNOWN_FILES = new Set(['/', '/privacy', '/llms.txt'])

vi.mock('@astrojs/cloudflare/handler', () => ({
  handle: vi.fn(async (request: Request) => {
    handled.push(request)
    const {pathname} = new URL(request.url)
    if (KNOWN_FILES.has(pathname)) {
      return new Response(`file ${pathname}`, {
        status: 200,
        headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate'}
      })
    }
    // The 404 page comes back through the ASSETS binding with the `_headers` CSP of its own path.
    return new Response('not found page', {status: 404, headers: {'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP}})
  })
}))

const {default: worker} = await import('../../src/worker')

const context = {waitUntil: () => {}, passThroughOnException: () => {}, props: {}}
// The stub ignores the environment; the Worker passes it through untouched.
const env = {} as Parameters<typeof worker.fetch>[1]

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://jonathanlloyd.me${path}`, init), env, context as Parameters<typeof worker.fetch>[2])
}

beforeEach(() => {
  handled.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('static-asset plane, through the Worker', () => {
  it('serves a file with the asset-plane CORS header and the middleware policy, as Pages did', async () => {
    const response = await request('/privacy')
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Content-Security-Policy')).toBe(CSP)
    expect(response.headers.get(SITE_RUNTIME_HEADER)).toBe(SITE_RUNTIME)
  })

  it('answers an unknown path with the 404 page, no-store', async () => {
    const response = await request('/no-such-page')
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])('answers %s on a page with an empty 405, never the file', async (method) => {
    const response = await request('/', {method})
    expect(response.status).toBe(405)
    expect(await response.text()).toBe('')
    expect(handled).toHaveLength(0)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // The middleware still wraps it, homepage headers included.
    expect(response.headers.get('Link')).toBe(LINK_HEADER)
    expect(response.headers.get('Vary')).toBe('Accept')
  })

  it('serves a code-free path without the middleware or the CSP trio, as Pages did', async () => {
    const response = await request('/_astro/no-such-file.js')
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Security-Policy')).toBeNull()
    expect(response.headers.get('Reporting-Endpoints')).toBeNull()
    expect(response.headers.get(SITE_RUNTIME_HEADER)).toBeNull()
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('answers a non-GET on a code-free path with an empty 405', async () => {
    const response = await request('/_astro/x.js', {method: 'POST'})
    expect(response.status).toBe(405)
    expect(handled).toHaveLength(0)
  })
})

describe('route paths, under the Pages matching rules', () => {
  it('hands a route request to Astro without the asset-plane CORS header', async () => {
    const response = await request('/llms.txt')
    expect(handled.map((r) => new URL(r.url).pathname)).toEqual(['/llms.txt'])
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Content-Security-Policy')).toBe(CSP)
  })

  it('strips a trailing slash before Astro, because Pages matched the route with one', async () => {
    await request('/llms.txt/?q=1')
    expect(handled.map((r) => new URL(r.url).pathname + new URL(r.url).search)).toEqual(['/llms.txt?q=1'])
  })

  it('passes every method to an onRequest route, which answers it itself', async () => {
    await request('/llms.txt', {method: 'PUT'})
    expect(handled.map((r) => r.method)).toEqual(['PUT'])
  })

  it('sends a GET on the POST-only CSP collector to the 404 page, as Pages did', async () => {
    const response = await request('/api/csp-report')
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('sends a PUT on the POST-only CSP collector to an empty 405, never to Astro', async () => {
    const response = await request('/api/csp-report', {method: 'PUT'})
    expect(response.status).toBe(405)
    expect(handled).toHaveLength(0)
  })

  it('hands a POST on the CSP collector to Astro', async () => {
    await request('/api/csp-report', {method: 'POST', headers: {'Content-Type': 'application/csp-report'}, body: '{}'})
    expect(handled.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['POST /api/csp-report'])
  })
})
