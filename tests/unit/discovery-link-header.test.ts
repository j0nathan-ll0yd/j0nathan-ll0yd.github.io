import {afterEach, describe, expect, it, vi} from 'vitest'
import {LLMS_TXT_PATH} from '../../src/lib/edge/llms-artifacts'
import {CONTENT_USAGE, LINK_HEADER, onRequest} from '../../src/lib/edge/middleware'
import {ASSET_PLANE_HEADERS, renderHeadersFile} from '../../src/lib/edge/security-headers'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discovery Link header', () => {
  it('advertises ARD without advertising an unavailable A2A interface', () => {
    expect(LINK_HEADER).toContain('</.well-known/ai-catalog.json>; rel="ai-catalog"')
    expect(LINK_HEADER).not.toContain('agent-card.json')
    expect(LINK_HEADER).not.toContain('agentcard.org')
  })

  // Nothing pinned rel="describedby" before atlas decision 0142, which is how the markdown
  // alternate in Dashboard.astro drifted to the raw CloudFront origin unnoticed. The address is
  // SITE-RELATIVE on purpose: it resolves through the Worker route that carries the privacy
  // gate, and the path is derived from the contract's distribution registry rather than spelled.
  it('advertises the llms.txt discovery index at its contract path, site-relative', () => {
    expect(LINK_HEADER).toContain(`<${LLMS_TXT_PATH}>; rel="describedby"; type="text/plain"`)
    expect(LLMS_TXT_PATH).toBe('/llms.txt')
    expect(LINK_HEADER).not.toContain('cloudfront.net')
  })

  it('sets the Link header on the homepage response', async () => {
    const response = await onRequest({request: new Request('https://jonathanlloyd.me/'), next: async () => new Response('html'), waitUntil: () => {}})

    expect(response.headers.get('Link')).toBe(LINK_HEADER)
  })
})

/**
 * THE TWO RESPONSE PLANES (atlas decision 0142 phase 7; Workers since decision 0160 PR A).
 *
 * Cloudflare applies `_headers` ONLY to responses the static-asset plane serves without the
 * Worker; `src/lib/edge/middleware.ts` carries the same cross-cutting policy on Worker responses.
 * Both now come from `src/lib/edge/security-headers.ts`: scripts/generate-headers.mjs writes
 * `_headers` from `renderHeadersFile()` at build time, and the middleware sets the same entries.
 * Per B10 this unit test still binds the two planes, so a refactor that splits them reds here.
 *
 * The table is DERIVED from the rendered `/*` block rather than restated, so a header added to
 * either plane and not the other reds here by construction.
 */
function wildcardBlock(): Record<string, string> {
  const staticHeaders = renderHeadersFile()
  const nextBlock = staticHeaders.indexOf('\n\n')
  expect(nextBlock, 'the rendered _headers no longer starts with a /* block').toBeGreaterThan(0)
  expect(staticHeaders.startsWith('/*\n'), 'the rendered _headers no longer starts with a /* block').toBe(true)

  const declared: Record<string, string> = {}
  for (const line of staticHeaders.slice(0, nextBlock).split('\n').slice(1)) {
    const at = line.indexOf(':')
    if (at > 0) {
      declared[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
  }
  return declared
}

/** The `/*` headers the static-asset plane alone carries: Pages added them to asset responses only. */
const ASSET_PLANE_ONLY = new Set(ASSET_PLANE_HEADERS.map(([name]) => name))

async function functionResponse(): Promise<Response> {
  return onRequest({request: new Request('https://jonathanlloyd.me/privacy'), next: async () => new Response('privacy'), waitUntil: () => {}})
}

describe('two-plane response-header parity', () => {
  it('declares exactly the cross-cutting headers the middleware also sets, plus the asset-plane CORS header', () => {
    // Pinned so ADDING a header to the static plane without the Worker plane is a visible diff
    // rather than a silent one-sided edit.
    expect(Object.keys(wildcardBlock()).sort()).toEqual([
      'Access-Control-Allow-Origin',
      'Content-Security-Policy',
      'Content-Security-Policy-Report-Only',
      'Content-Usage',
      'Cross-Origin-Opener-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Reporting-Endpoints',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options'
    ])
  })

  it('serves every one of them byte-identically on a Worker response', async () => {
    const response = await functionResponse()
    const drifted = Object.entries(wildcardBlock()).filter(([name]) => !ASSET_PLANE_ONLY.has(name)).filter(([name, value]) =>
      response.headers.get(name) !== value
    ).map(([name, value]) => `${name}: static ${JSON.stringify(value)} vs worker ${JSON.stringify(response.headers.get(name))}`)

    expect(drifted, 'the rendered _headers and src/lib/edge/middleware.ts have drifted apart').toEqual([])
  })

  it('keeps the asset-plane CORS header off Worker responses, as Pages kept it off Function responses', async () => {
    const response = await functionResponse()
    for (const name of ASSET_PLANE_ONLY) {
      expect(response.headers.get(name)).toBeNull()
    }
  })
})

describe('Content-Usage response header', () => {
  it('is declared for static asset responses and cache hits', () => {
    expect(wildcardBlock()['Content-Usage']).toBe('train-ai=n, search=y')
    expect(renderHeadersFile()).not.toMatch(/Content-Signal/i)
  })

  it('is added to normal site responses', async () => {
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/privacy'),
      next: async () => new Response('privacy'),
      waitUntil: () => {}
    })

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(CONTENT_USAGE).toBe('train-ai=n, search=y')
  })

  it('is retained on the negotiated homepage markdown representation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/focus.json')
        ? new Response(JSON.stringify({currentFocus: 'Personal'}))
        : new Response('# full profile', {headers: {'x-amz-cf-id': 'cf'}})
    ))
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next, waitUntil: () => {}})

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(next).not.toHaveBeenCalled()
  })

  it('suppresses markdown negotiation before fetching the focus-gated artifact', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({currentFocus: 'Work'})))
    vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next, waitUntil: () => {}})

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
  })
})
