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
  it('is added to normal site responses', async () => {
    const response = await onRequest({request: new Request('https://jonathanlloyd.me/privacy/'), next: async () => new Response('privacy')})

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(CONTENT_USAGE).toBe('train-ai=n, search=y')
  })

  it('is retained on the markdown-negotiation early return', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# full profile')))
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next})

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(response.headers.get('Content-Type')).toBe('text/markdown')
    expect(next).not.toHaveBeenCalled()
  })
})
