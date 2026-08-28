import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
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
    const response = await onRequest({request: new Request('https://jonathanlloyd.me/privacy/'), next: async () => new Response('privacy')})

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(CONTENT_USAGE).toBe('train-ai=n, search=y')
  })

  it('is retained on the markdown-negotiation early return', async () => {
    vi.stubGlobal('fetch',
      vi.fn(async (url: string) => url.endsWith('/focus.json') ? new Response(JSON.stringify({currentFocus: 'Personal'})) : new Response('# full profile')))
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next})

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(response.headers.get('Content-Type')).toBe('text/markdown')
    expect(next).not.toHaveBeenCalled()
  })

  it('suppresses markdown negotiation before fetching the focus-gated artifact', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({currentFocus: 'Work'})))
    vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next})

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
  })
})
