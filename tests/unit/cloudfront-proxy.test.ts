import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE, LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {makeCloudfrontProxy} from '../../functions/_lib/proxy'
import {onRequest as feedJsonRoute} from '../../functions/feed.json.ts'
import {onRequest as feedXmlRoute} from '../../functions/feed.xml.ts'
import {onRequest as indexMdRoute} from '../../functions/index.md.ts'
import {onRequest as llmsFullRoute} from '../../functions/llms-full.txt.ts'
import {onRequest as llmsTxtRoute} from '../../functions/llms.txt.ts'

// Unit tests for the shared CloudFront proxy factory and the five routes built
// from it. The regression class under guard: an artifact advertised by the
// llms.txt discovery index (llms-full.txt, index.md) having NO route on the
// prod domain — /llms-full.txt 404'd on jonathanlloyd.me until 2026-07-17.

const stubFetch = (response: Response) => {
  const mock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeCloudfrontProxy', () => {
  it('fetches the CloudFront artifact with the edge-cache options', async () => {
    const mock = stubFetch(new Response('body'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/plain; charset=utf-8'})
    await proxy()
    expect(mock).toHaveBeenCalledWith(`${CLOUDFRONT_BASE}/thing.txt`, {cf: {cacheTtl: 3600, cacheEverything: true}})
  })

  it('passes the upstream body through with proxy headers on success', async () => {
    stubFetch(new Response('# content'))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/markdown; charset=utf-8'})
    const res = await proxy()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
    expect(res.headers.get('X-Source')).toBe('cloudfront-proxy')
    expect(await res.text()).toBe('# content')
  })

  it('returns a 502 with a plain-text notice when upstream fails', async () => {
    stubFetch(new Response('nope', {status: 500}))
    const proxy = makeCloudfrontProxy({path: '/thing.txt', contentType: 'text/markdown; charset=utf-8'})
    const res = await proxy()
    expect(res.status).toBe(502)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('thing.txt unavailable')
  })
})

describe('proxy routes', () => {
  // Every artifact the site serves from its own domain: upstream CloudFront
  // path + the public Content-Type the route owns.
  const routes: Array<[string, () => Promise<Response>, string, string]> = [
    ['/llms.txt', llmsTxtRoute, '/llms.txt', 'text/plain; charset=utf-8'],
    ['/llms-full.txt', llmsFullRoute, LLM_CONTENT_PATHS.llmsFull, 'text/markdown; charset=utf-8'],
    ['/index.md', indexMdRoute, LLM_CONTENT_PATHS.indexMarkdown, 'text/markdown; charset=utf-8'],
    ['/feed.xml', feedXmlRoute, '/feed.xml', 'application/rss+xml; charset=utf-8'],
    ['/feed.json', feedJsonRoute, '/feed.json', 'application/feed+json; charset=utf-8']
  ]

  it.each(routes)('%s proxies its CloudFront artifact', async (_route, onRequest, upstreamPath, contentType) => {
    const mock = stubFetch(new Response('payload'))
    const res = await onRequest()
    expect(mock).toHaveBeenCalledWith(`${CLOUDFRONT_BASE}${upstreamPath}`, {cf: {cacheTtl: 3600, cacheEverything: true}})
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(contentType)
  })
})
