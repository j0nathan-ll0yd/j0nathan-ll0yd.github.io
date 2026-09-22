import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts'
import {CONTENT_USAGE, LINK_HEADER, onRequest} from '../../functions/_middleware'

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
  // SITE-RELATIVE on purpose: it resolves through the Pages Function that carries the privacy
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

describe('Content-Usage response header', () => {
  it('is declared for static asset responses and cache hits', () => {
    const staticHeaders = readFileSync('public/_headers', 'utf-8')
    const nextBlock = staticHeaders.indexOf('\n/robots.txt')
    expect(nextBlock).toBeGreaterThan(0)

    const wildcardBlock = staticHeaders.slice(0, nextBlock)
    expect(wildcardBlock).toMatch(/^  Content-Usage: train-ai=n, search=y$/m)
    expect(staticHeaders).not.toMatch(/Content-Signal/i)
  })

  it('is added to normal site responses', async () => {
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/privacy/'),
      next: async () => new Response('privacy'),
      waitUntil: () => {}
    })

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(CONTENT_USAGE).toBe('train-ai=n, search=y')
  })

  it('is retained on the negotiated homepage markdown representation', async () => {
    vi.stubGlobal('fetch',
      vi.fn(async (url: string) => url.endsWith('/focus.json') ? new Response(JSON.stringify({currentFocus: 'Personal'})) : new Response('# full profile')))
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
