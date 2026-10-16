// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CSP, LINK_HEADER, NOT_FOUND_MARKDOWN} from '../../src/lib/edge/middleware'
import {SITE_RUNTIME, SITE_RUNTIME_HEADER} from '../../src/lib/edge/security-headers'

// src/worker.ts routes each request the way Pages routed it (atlas decision 0160, PR A). Astro's
// handler serves only the route endpoints, so it is replaced by a stub that records each request.
// The ASSETS binding is a fake that answers like the static-asset plane: the file for a known path,
// 404 otherwise, and the 404 page with the `_headers` CSP of its own path.

const handled: Request[] = []
const assetRequests: Request[] = []
const KNOWN_FILES = new Set(['/', '/privacy', '/sw.js'])

vi.mock('@astrojs/cloudflare/handler', () => ({
  handle: vi.fn(async (request: Request) => {
    handled.push(request)
    return new Response(`route ${new URL(request.url).pathname}`, {status: 200, headers: {'Content-Type': 'text/plain; charset=utf-8'}})
  })
}))

const {default: worker} = await import('../../src/worker')

const ASSETS = {
  async fetch(input: Request | URL | string): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input)
    assetRequests.push(request)
    const {pathname} = new URL(request.url)
    if (pathname === '/404') {
      return new Response('not found page', {
        status: 200,
        headers: {'Content-Type': 'text/html; charset=utf-8', ETag: '"page"', 'Content-Security-Policy': CSP}
      })
    }
    if (!KNOWN_FILES.has(pathname)) {
      return new Response(null, {status: 404})
    }
    if (request.headers.get('If-None-Match') === '"v1"') {
      return new Response(null, {status: 304, headers: {ETag: '"v1"'}})
    }
    const body = request.method === 'HEAD' ? null : `file ${pathname}`
    return new Response(body, {
      status: 200,
      headers: {'Content-Type': 'text/html; charset=utf-8', ETag: '"v1"', 'Cache-Control': 'public, max-age=0, must-revalidate'}
    })
  }
}

const context = {waitUntil: () => {}, passThroughOnException: () => {}, props: {}}
// The Worker reads only the ASSETS binding from its environment.
const env = {ASSETS} as unknown as Parameters<typeof worker.fetch>[1]

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://jonathanlloyd.me${path}`, init), env, context as Parameters<typeof worker.fetch>[2])
}

beforeEach(() => {
  handled.length = 0
  assetRequests.length = 0
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

  it('answers an unknown path with the 404 page body, status 404, no-store, no ETag', async () => {
    const response = await request('/no-such-page')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('not found page')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('ETag')).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(handled).toHaveLength(0)
  })

  it('answers an unknown path with a trailing slash with the 404 page, never a redirect', async () => {
    const response = await request('/no-such-page/')
    expect(response.status).toBe(404)
    expect(response.headers.get('Location')).toBeNull()
    expect(handled).toHaveLength(0)
  })

  it('answers HEAD on an unknown path with a bodiless 404', async () => {
    const response = await request('/no-such-page', {method: 'HEAD'})
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('passes the request itself to the ASSETS binding, so a conditional request can answer 304', async () => {
    const response = await request('/privacy', {headers: {'If-None-Match': '"v1"'}})
    expect(response.status).toBe(304)
    expect(assetRequests[0].headers.get('If-None-Match')).toBe('"v1"')
  })

  it('passes HEAD to the ASSETS binding as HEAD', async () => {
    const response = await request('/privacy', {method: 'HEAD'})
    expect(response.status).toBe(200)
    expect(assetRequests.map((r) => r.method)).toEqual(['HEAD'])
    expect(await response.text()).toBe('')
  })

  it('serves sw.js as application/javascript, no-store, as Pages did', async () => {
    const response = await request('/sw.js')
    expect(response.headers.get('Content-Type')).toBe('application/javascript')
    expect(response.headers.get('Cache-Control')).toBe('max-age=0, no-store')
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

// Atlas decision 0158: an unknown path under a markdown Accept answers the markdown 404. It needs no
// wrangler.jsonc run_worker_first entry: a path with no file runs the Worker (not_found_handling
// "none"), which renders the 404 inside the site middleware, and the middleware swaps the body.
// covers: llms-txt#Markdown negotiation applies only to the homepage and honors Accept q-values
describe('markdown 404, through the Worker', () => {
  const MARKDOWN = {Accept: 'text/markdown'}

  it('answers an unknown path under Accept: text/markdown with the markdown 404, never Astro', async () => {
    const response = await request('/no-such-page', {headers: MARKDOWN})
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(await response.text()).toBe(NOT_FOUND_MARKDOWN)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
    expect(response.headers.get('Vary')).toBe('Accept')
    expect(response.headers.get('Content-Security-Policy')).toBe(CSP)
    // The HTML 404 carries the asset plane's CORS header; the markdown body keeps it.
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(handled).toHaveLength(0)
  })

  it('answers HEAD with the markdown 404 headers and no body', async () => {
    const response = await request('/no-such-page', {method: 'HEAD', headers: MARKDOWN})
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.body).toBeNull()
  })

  it('serves a known page unchanged under the same Accept', async () => {
    const response = await request('/privacy', {headers: MARKDOWN})
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('file /privacy')
  })

  it('keeps the HTML 404 on a code-free path, which skips the middleware', async () => {
    const response = await request('/_astro/missing.js', {headers: MARKDOWN})
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('not found page')
  })
})

describe('route paths, under the Pages matching rules', () => {
  it('hands a route request to Astro without the asset-plane CORS header', async () => {
    const response = await request('/llms.txt')
    expect(assetRequests).toHaveLength(0)
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
    expect(handled).toHaveLength(0)
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
  // The MCP server (atlas decision 0158) answers every method itself: POST serves JSON-RPC, and GET,
  // DELETE and OPTIONS answer 405 with `Allow: POST` from the handler, never the asset plane's empty 405.
  it.each(['/mcp', '/mcp/'])('hands a POST on %s to Astro with its body intact', async (path) => {
    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
    await request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body})
    expect(handled.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['POST /mcp'])
    expect(await handled[0]!.text()).toBe(body)
  })

  it.each(['GET', 'DELETE', 'OPTIONS', 'PUT'])('hands %s on /mcp to Astro, never to the asset plane', async (method) => {
    await request('/mcp', {method})
    expect(handled.map((r) => r.method)).toEqual([method])
    expect(assetRequests).toHaveLength(0)
  })

  it.each(['GET', 'HEAD', 'OPTIONS', 'POST'])('hands %s on the server card to Astro, with or without a trailing slash', async (method) => {
    await request('/mcp/server-card', {method})
    await request('/mcp/server-card/', {method})
    expect(handled.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`${method} /mcp/server-card`, `${method} /mcp/server-card`])
    expect(assetRequests).toHaveLength(0)
  })
})

describe('analytics routes on a local run', () => {
  function local(path: string, init: RequestInit = {}): Promise<Response> {
    return worker.fetch(new Request(`http://localhost:4321${path}`, init), env, context as Parameters<typeof worker.fetch>[2])
  }

  it.each(['/sa', '/cf-insights.js', '/cf-rum', '/simple', '/simple/simple.gif', '/simple/append'])(
    'answers %s with a 404 on localhost and never reaches Astro',
    async (path) => {
      const response = await local(path, {method: path === '/simple/append' ? 'POST' : 'GET'})
      expect(response.status).toBe(404)
      expect(handled).toHaveLength(0)
    }
  )

  it('still serves the other routes and every analytics route on a deployed hostname', async () => {
    await local('/llms.txt')
    await request('/sa')
    await request('/simple/simple.gif')
    expect(handled.map((r) => new URL(r.url).pathname)).toEqual(['/llms.txt', '/sa', '/simple/simple.gif'])
  })
})

describe('the dashboard at / (atlas decision 0160, PR B)', () => {
  it('answers GET / without Astro: it reads through the proxy and serves from the static plane', async () => {
    // The data plane is down: this exercises the routing only.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', {status: 503})))
    const response = await request('/')
    expect(handled).toHaveLength(0)
    // The focus signal cannot be read: the Worker serves the data-free page, honestly labelled.
    expect(response.status).toBe(200)
    expect(response.headers.get('X-SSR-Data')).toBe('unavailable')
    // The middleware still wraps it.
    expect(response.headers.get('Link')).toBe(LINK_HEADER)
    expect(response.headers.get(SITE_RUNTIME_HEADER)).toBe(SITE_RUNTIME)
  })

  it('answers HEAD / from the data-free file, and renders nothing', async () => {
    const response = await request('/', {method: 'HEAD'})
    expect(handled).toHaveLength(0)
    expect(assetRequests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(['HEAD /'])
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('X-SSR-Data')).toBeNull()
  })

  it('still negotiates Markdown at / before any render', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('focus unavailable', {status: 503})))
    await request('/', {headers: {Accept: 'text/markdown'}})
    expect(handled).toHaveLength(0)
  })
})
