// audits/__tests__/feed-edge-cache.test.ts -- the edge-cache arm of the B2 feed check
// (audits/checks/b2-check-feeds.mjs `feedEdgeCacheFindings`). It took the feed half of the
// credit from the retired zone cache-rule audit (atlas decision 0160 D7), so a stored replay of
// /feed.xml or /feed.json on the served path must red here.

import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {collectFeedFindings, feedEdgeCacheFindings} from '../checks/b2-check-feeds.mjs'

/** The headers /feed.xml and /feed.json served on 2026-11-02 (curl, both feeds alike). */
const WORKER_HEADERS = {'cache-control': 'no-store', 'cdn-cache-control': 'no-store', 'x-site-runtime': 'workers'}

const served = (overrides: Record<string, string | null> = {}) => {
  const values: Record<string, string | null> = {...WORKER_HEADERS, ...overrides}
  return {get: (name: string) => values[name.toLowerCase()] ?? null}
}

// covers: llms-txt#Canonical llms responses always pass through the privacy gate
describe('feedEdgeCacheFindings (the served feed path, atlas decision 0160 D7)', () => {
  it.each(['feed.xml', 'feed.json'])('accepts the Worker response %s served: no CF-Cache-Status, no Age, CDN no-store', (artifact) => {
    expect(feedEdgeCacheFindings(artifact, served())).toEqual([])
  })

  // The Pages-era receipt: on 2026-10-08 both feeds answered HIT with Age up to 796 s.
  it.each(['feed.xml', 'feed.json'])('fails %s answered by a Cloudflare cache: CF-Cache-Status HIT', (artifact) => {
    expect(feedEdgeCacheFindings(artifact, served({'cf-cache-status': 'HIT'}))).toEqual([
      {
        severity: 'fail',
        id: 'feed-site-edge-cache-status',
        message: expect.stringMatching(new RegExp(`^${artifact.replace('.', '\\.')}: .*expected BYPASS or DYNAMIC`))
      }
    ])
  })

  it.each(['feed.xml', 'feed.json'])('fails %s carrying a positive Age, with or without a status', (artifact) => {
    for (const status of [null, 'HIT', 'BYPASS']) {
      const findings = feedEdgeCacheFindings(artifact, served({'cf-cache-status': status, age: '796'}))
      expect(findings, String(status)).toHaveLength(1)
      expect(findings[0]?.message, String(status)).toContain('Age: "796"')
    }
  })

  it('fails an absent status that the Worker did not answer: no platform marker', () => {
    expect(feedEdgeCacheFindings('feed.xml', served({'x-site-runtime': null}))[0]?.message).toContain('only on a Worker response')
  })

  it('fails an absent status without CDN-Cache-Control: no-store', () => {
    expect(feedEdgeCacheFindings('feed.json', served({'cdn-cache-control': 'public, max-age=60'}))[0]?.message).toContain('CDN-Cache-Control: no-store')
  })

  it.each(['MISS', 'EXPIRED', 'STALE', 'UPDATING', 'REVALIDATED'])('fails CF-Cache-Status %s: the response was eligible for storage', (status) => {
    expect(feedEdgeCacheFindings('feed.xml', served({'cf-cache-status': status}))).toHaveLength(1)
  })
})

// The wiring: main() judges what collectFeedFindings returns, and this drives it with an injected
// fetch. Deleting either feed's edge-cache call reds a case below.
describe('collectFeedFindings (the check run, both feeds wired)', () => {
  const BODIES: Record<string, string> = {
    'feed.xml': readFileSync('audits/specs/feed-xml/cases/valid.xml', 'utf8'),
    'feed.json': readFileSync('audits/specs/feed-json/cases/valid.json', 'utf8')
  }
  const fetchWith = (cached: string[], status = 200) => async (url: string) => {
    const artifact = new URL(url).pathname.slice(1)
    const headers = {...WORKER_HEADERS, ...(cached.includes(artifact) ? {'cf-cache-status': 'HIT', age: '796'} : {})}
    return new Response(BODIES[artifact], {status, headers})
  }
  const edgeFindings = (findings: Array<{id: string; message: string}>) =>
    findings.filter(({id}) => id === 'feed-site-edge-cache-status').map(({message}) => message.split(':', 1)[0])

  it('judges both feeds and finds no edge-cache defect on the Worker answers', async () => {
    const {findings, measured} = await collectFeedFindings(fetchWith([]))
    expect(measured).toBe(2)
    expect(edgeFindings(findings)).toEqual([])
  })

  it.each([
    [['feed.xml'], ['feed.xml']],
    [['feed.json'], ['feed.json']],
    [['feed.xml', 'feed.json'], ['feed.xml', 'feed.json']]
  ])('fails each feed a Cloudflare cache answered: %j', async (cached, expected) => {
    const {findings, measured} = await collectFeedFindings(fetchWith(cached))
    expect(measured).toBe(2)
    expect(edgeFindings(findings)).toEqual(expected)
    expect(findings.filter(({id}) => id === 'feed-site-edge-cache-status').every(({severity}) => severity === 'fail')).toBe(true)
  })

  it('judges the feed.json headers even when its body does not parse', async () => {
    const fetchImpl = async (url: string) =>
      new Response(url.endsWith('.json') ? '{not json' : BODIES['feed.xml'], {headers: {...WORKER_HEADERS, 'cf-cache-status': 'HIT'}})
    const {findings, measured} = await collectFeedFindings(fetchImpl)
    expect(measured).toBe(1)
    expect(findings.map(({id}) => id)).toEqual(expect.arrayContaining(['feed-json-parse', 'feed-site-edge-cache-status']))
    expect(edgeFindings(findings)).toEqual(['feed.xml', 'feed.json'])
  })

  it('judges no headers on a non-200 answer and counts nothing', async () => {
    const {findings, measured} = await collectFeedFindings(fetchWith(['feed.xml', 'feed.json'], 503))
    expect(measured).toBe(0)
    expect(edgeFindings(findings)).toEqual([])
    expect(findings.map(({id}) => id).sort()).toEqual(['feed-json-fetch', 'feed-xml-fetch'])
  })
})
