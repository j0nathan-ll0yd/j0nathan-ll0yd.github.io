// Unit tests for the pure evaluators in scripts/audit/serving-probe.mjs.
// No network: every case feeds the evaluators the shape a live observation
// would produce. The tri-state contract is the thing under test -- in
// particular that an unverifiable observation lands on `unknown`, never on a
// silent `passed`.

import {describe, expect, it} from 'vitest'
import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {
  ACCEPTABLE_CACHE_STATES,
  aggregate,
  CACHED_STATES,
  evaluateCachePolicy,
  evaluateCacheState,
  evaluateCoherence,
  evaluateCompositionAge,
  evaluateFeedOriginSiteCoherence,
  evaluateFeedStructure,
  evaluateJsonExportFreshness,
  evaluateOriginSiteCoherence,
  evaluateTrioStructure,
  extractCompositionTimestamp,
  feedLagBudgetMs,
  FEEDS,
  JSON_EXPORT_MAX_AGE_DAYS,
  MAX_COMPOSITION_AGE_MS,
  MAX_COMPOSITION_SKEW_MS,
  ORIGIN_CACHE_FRESHNESS_MS,
  parseAgeSeconds,
  readCachePolicy,
  report,
  REQUIRED_CACHE_HEADERS,
  SITE_FETCH_FRESHNESS_MS,
  TRIO
} from '../../scripts/audit/serving-probe.mjs'

const headers = (entries: Record<string, string>) => new Headers(entries)

// A minimal llms.txt that satisfies the shared llms-structure rule.
const VALID_LLMS_TXT = [
  '# Jonathan Lloyd',
  '',
  '> A one-line summary blockquote.',
  '',
  '## About',
  '',
  '- [Site](https://jonathanlloyd.me): the dashboard',
  ''
].join('\n')

describe('serving-probe thresholds come from the shared contract', () => {
  it('reads the 4h composition age and 10m skew window from llms-assurance', () => {
    expect(MAX_COMPOSITION_AGE_MS).toBe(4 * 3_600_000)
    expect(MAX_COMPOSITION_SKEW_MS).toBe(10 * 60_000)
  })

  // Cloudflare ALWAYS strips Cloudflare-CDN-Cache-Control before the client, so
  // a probe hitting jonathanlloyd.me can never observe it and its absence proves
  // nothing. Asserting it would manufacture a permanent, uninformative failure.
  it('asserts only the two client-observable cache headers, not the stripped Cloudflare one', () => {
    expect(REQUIRED_CACHE_HEADERS).toEqual({'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store'})
    expect(Object.keys(REQUIRED_CACHE_HEADERS)).not.toContain('Cloudflare-CDN-Cache-Control')
  })
})

describe('evaluateCachePolicy', () => {
  it('passes when both observable headers carry no-store', () => {
    const observed = readCachePolicy(headers({'cache-control': 'no-store', 'cdn-cache-control': 'no-store'}))
    expect(evaluateCachePolicy(observed).status).toBe('passed')
  })

  it('passes without Cloudflare-CDN-Cache-Control present, since it is never observable', () => {
    const observed = readCachePolicy(headers({'cache-control': 'no-store', 'cdn-cache-control': 'no-store'}))
    expect(observed).not.toHaveProperty('cloudflare-cdn-cache-control')
    expect(evaluateCachePolicy(observed).status).toBe('passed')
  })

  it('is case- and whitespace-insensitive on the directive', () => {
    const observed = readCachePolicy(headers({'cache-control': '  No-Store ', 'cdn-cache-control': 'NO-STORE'}))
    expect(evaluateCachePolicy(observed).status).toBe('passed')
  })

  // The retired deviation: this exact policy was classified indeterminate while
  // an account-level Cloudflare Edge TTL rule forced it. That rule is fixed, so
  // the same observation is now a plain failure.
  it('fails the formerly-excused max-age=600 override rather than excusing it', () => {
    const verdict = evaluateCachePolicy(readCachePolicy(headers({'cache-control': 'public, max-age=600, s-maxage=60'})))
    expect(verdict.status).toBe('failed')
    expect(verdict.message).not.toContain('known deviation')
  })

  // The current live state, pending the companion worker PR: the edge override
  // is gone but the worker still emits max-age=0 rather than no-store.
  it('fails the current live max-age=0 policy -- honest until the worker emits no-store', () => {
    expect(evaluateCachePolicy(readCachePolicy(headers({'cache-control': 'public, max-age=0, s-maxage=60'}))).status).toBe('failed')
  })

  it('fails when only one of the two observable headers carries no-store', () => {
    expect(evaluateCachePolicy(readCachePolicy(headers({'cache-control': 'no-store'}))).status).toBe('failed')
    expect(evaluateCachePolicy(readCachePolicy(headers({'cdn-cache-control': 'no-store'}))).status).toBe('failed')
  })

  it('fails when the cache headers are absent entirely', () => {
    expect(evaluateCachePolicy(readCachePolicy(headers({}))).status).toBe('failed')
  })
})

describe('evaluateCacheState', () => {
  it('passes the states proving the response came from the origin', () => {
    for (const state of ACCEPTABLE_CACHE_STATES) {
      expect(evaluateCacheState(state).status).toBe('passed')
      expect(evaluateCacheState(state.toUpperCase()).status).toBe('passed')
    }
  })

  it('fails every state proving the response was served from the edge cache', () => {
    for (const state of CACHED_STATES) {
      expect(evaluateCacheState(state).status).toBe('failed')
      expect(evaluateCacheState(state.toUpperCase()).status).toBe('failed')
    }
  })

  it('covers exactly the states the Cloudflare docs define for each outcome', () => {
    expect([...ACCEPTABLE_CACHE_STATES]).toEqual(['dynamic', 'bypass'])
    expect([...CACHED_STATES]).toEqual(['hit', 'revalidated', 'stale', 'updating'])
  })

  // Fail-closed: a state this probe cannot classify is not a pass.
  it('is indeterminate when the header is absent or carries an unclassified state', () => {
    expect(evaluateCacheState(null).status).toBe('unknown')
    expect(evaluateCacheState('MISS').status).toBe('unknown')
    expect(evaluateCacheState('EXPIRED').status).toBe('unknown')
  })
})

describe('extractCompositionTimestamp', () => {
  it('reads the llms.txt composed-at HTML comment', () => {
    expect(extractCompositionTimestamp('body\n<!-- composed-at: 2026-08-30T17:46:28.050Z -->\n')).toBe('2026-08-30T17:46:28.050Z')
  })

  it('reads the llms-full.txt / index.md Generated marker', () => {
    expect(extractCompositionTimestamp('**Generated:** 2026-08-30T17:46:28.232Z')).toBe('2026-08-30T17:46:28.232Z')
  })

  // feed.xml's compose timestamp lands in the RSS channel's <lastBuildDate>,
  // never on an item (docs/wiki/Feed-Spec.md "Honest Timestamps"). It is RFC 822
  // rather than ISO 8601; every consumer runs it through Date.parse, so the raw
  // advertised string is what comes back.
  it('reads the feed.xml lastBuildDate channel element', () => {
    const rss = '<rss version="2.0"><channel><lastBuildDate>Sun, 30 Aug 2026 23:38:43 GMT</lastBuildDate></channel></rss>'
    expect(extractCompositionTimestamp(rss)).toBe('Sun, 30 Aug 2026 23:38:43 GMT')
    expect(Date.parse(extractCompositionTimestamp(rss) as string)).toBe(Date.parse('2026-08-30T23:38:43.000Z'))
  })

  // JSON Feed 1.1 defines no build-date field, so a feed.json body genuinely
  // carries no composition marker. Inventing one would be worse than returning
  // null: evaluateFeedOriginSiteCoherence branches on exactly this.
  it('returns null for a feed.json body, which has no composition marker at all', () => {
    const feedJson = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Feed',
      items: [{id: 'a', date_published: '2026-08-30T12:00:00.000Z'}]
    })
    expect(extractCompositionTimestamp(feedJson)).toBeNull()
  })

  it('returns null for a body with no marker, and for an unparseable one', () => {
    expect(extractCompositionTimestamp('# just a heading')).toBeNull()
    expect(extractCompositionTimestamp('<!-- composed-at: not-a-date -->')).toBeNull()
    expect(extractCompositionTimestamp('<lastBuildDate>whenever</lastBuildDate>')).toBeNull()
    expect(extractCompositionTimestamp(null)).toBeNull()
  })
})

describe('evaluateCompositionAge', () => {
  const now = new Date('2026-08-30T18:00:00.000Z')

  it('passes a freshly composed artifact', () => {
    expect(evaluateCompositionAge('2026-08-30T17:46:28.050Z', now).status).toBe('passed')
  })

  it('passes exactly at the 4h boundary and fails beyond it', () => {
    expect(evaluateCompositionAge('2026-08-30T14:00:00.000Z', now).status).toBe('passed')
    expect(evaluateCompositionAge('2026-08-30T13:59:59.000Z', now).status).toBe('failed')
  })

  // Fail-closed: an artifact whose freshness cannot be read is NOT fresh.
  it('is indeterminate when the timestamp is missing or unparseable', () => {
    expect(evaluateCompositionAge(null, now).status).toBe('unknown')
    expect(evaluateCompositionAge('not-a-date', now).status).toBe('unknown')
  })
})

describe('evaluateCoherence', () => {
  const at = (iso: string, body: string, key = 'left') => ({key, timestamp: iso, body})

  it('requires identical bytes when both sides advertise the same composition timestamp', () => {
    const stamp = '2026-08-30T17:46:28.050Z'
    expect(evaluateCoherence(at(stamp, 'same', 'a'), at(stamp, 'same', 'b')).status).toBe('passed')
    expect(evaluateCoherence(at(stamp, 'one', 'a'), at(stamp, 'other', 'b')).status).toBe('failed')
  })

  // The live case: llms-full.txt and index.md composed 182ms apart.
  it('treats adjacent fresh generations inside the skew window as convergence, not corruption', () => {
    const verdict = evaluateCoherence(at('2026-08-30T17:46:28.232Z', 'a', 'llms-full-txt'), at('2026-08-30T17:46:28.050Z', 'b', 'index-md'))
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('convergence')
  })

  it('honours the inclusive skew boundary at exactly 10 minutes, and fails past it', () => {
    const left = at('2026-08-30T18:00:00.000Z', 'a', 'a')
    expect(evaluateCoherence(left, at('2026-08-30T17:50:00.000Z', 'b', 'b')).status).toBe('passed')
    expect(evaluateCoherence(left, at('2026-08-30T17:49:59.000Z', 'b', 'b')).status).toBe('failed')
  })

  it('is indeterminate when either side has no composition timestamp', () => {
    expect(evaluateCoherence(at('2026-08-30T18:00:00.000Z', 'a', 'a'), {key: 'b', timestamp: null, body: null}).status).toBe('unknown')
  })
})

// The origin-site pair. The site-only same-side check above cannot see a proxy
// serving a composed-at that LAGS its CloudFront origin: the lagging copy is
// internally consistent and, under 4h, passes the composition-age check too.
describe('evaluateOriginSiteCoherence', () => {
  const composed = (iso: string, tail = '') => `# Jonathan Lloyd\n\n**Generated:** ${iso}\n${tail}`

  it('passes when the site and the origin advertise the same composition and serve identical bytes', () => {
    const body = composed('2026-08-30T17:46:28.232Z')
    const verdict = evaluateOriginSiteCoherence('llms-full-txt', body, body)
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('llms-full-txt@site vs llms-full-txt@origin')
  })

  // Same generation, different bytes: the proxy served something the origin did not.
  it('fails identical composition timestamps with differing bytes', () => {
    const stamp = '2026-08-30T17:46:28.232Z'
    expect(evaluateOriginSiteCoherence('index-md', composed(stamp), composed(stamp, 'truncated')).status).toBe('failed')
  })

  // THE BUG CLASS THIS CHECK EXISTS FOR: a site copy composed 25 minutes behind
  // the origin. Both are well inside the 4h age window, so nothing else catches it.
  it('fails a site copy lagging the origin beyond the 10m skew window', () => {
    const verdict = evaluateOriginSiteCoherence('llms-txt', composed('2026-08-30T17:21:00.000Z'), composed('2026-08-30T17:46:00.000Z'))
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('composition skew 25.00m')
  })

  it('treats a lag inside the skew window as convergence, not corruption', () => {
    const verdict = evaluateOriginSiteCoherence('llms-txt', composed('2026-08-30T17:41:00.000Z'), composed('2026-08-30T17:46:00.000Z'))
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('convergence')
  })

  // Fail-closed: an unreachable origin is UNKNOWN, never a silent pass. probeTrio
  // passes null for a non-OK or unreachable side, which is what this asserts.
  it('is indeterminate when either side never arrived, or carries no composition marker', () => {
    const body = composed('2026-08-30T17:46:28.232Z')
    expect(evaluateOriginSiteCoherence('llms-txt', body, null).status).toBe('unknown')
    expect(evaluateOriginSiteCoherence('llms-txt', null, body).status).toBe('unknown')
    expect(evaluateOriginSiteCoherence('llms-txt', null, null).status).toBe('unknown')
    expect(evaluateOriginSiteCoherence('llms-txt', body, '# no marker at all').status).toBe('unknown')
  })
})

// The origin URL must be the one functions/_lib/proxy.ts actually fetches
// (`${CLOUDFRONT_BASE}${path}`), not a guess. Both sides come from
// functions/_lib/llms-artifacts.ts, so this asserts the mapping survived.
describe('TRIO carries both serving planes for every artifact', () => {
  it('pairs each site URL with the CloudFront origin URL the proxy fetches from', () => {
    expect(TRIO.map(({key}) => key)).toEqual(['llms-txt', 'llms-full-txt', 'index-md'])
    for (const {url, originUrl} of TRIO) {
      const path = new URL(url).pathname
      expect(url).toBe(`${SITE_URL}${path}`)
      expect(originUrl).toBe(`${CLOUDFRONT_BASE}${path}`)
    }
  })
})

// Both feeds are observed on the SAME two planes as the trio. The origin URL
// must be the one functions/_lib/proxy.ts actually fetches
// (`${CLOUDFRONT_BASE}${path}`); both sides come from
// functions/_lib/feed-artifacts.ts, which the two route files also read.
describe('FEEDS carries both serving planes for every feed artifact', () => {
  it('pairs each site URL with the CloudFront origin URL the proxy fetches from', () => {
    expect(FEEDS.map(({key}) => key)).toEqual(['feed-xml', 'feed-json'])
    for (const {url, originUrl} of FEEDS) {
      const path = new URL(url).pathname
      expect(url).toBe(`${SITE_URL}${path}`)
      expect(originUrl).toBe(`${CLOUDFRONT_BASE}${path}`)
    }
  })

  it('routes each artifact to the validator its format needs', () => {
    expect(FEEDS.map(({id, format}) => [id, format])).toEqual([['feed.xml', 'rss'], ['feed.json', 'json']])
  })
})

describe('parseAgeSeconds', () => {
  it('reads a positive Age header', () => {
    expect(parseAgeSeconds('1301')).toBe(1301)
    expect(parseAgeSeconds('  42 ')).toBe(42)
  })

  // Fail-closed: a missing or nonsense Age credits the response with NO edge
  // dwell, which yields the SMALLEST coherence allowance. It can only tighten a
  // verdict, never loosen one.
  it('collapses an absent, negative, or unparseable Age to zero', () => {
    expect(parseAgeSeconds(null)).toBe(0)
    expect(parseAgeSeconds('')).toBe(0)
    expect(parseAgeSeconds('-5')).toBe(0)
    expect(parseAgeSeconds('soon')).toBe(0)
  })
})

// The feed lag allowance is a SUM OF CONTRACT VALUES plus one observed header,
// never a literal. If either contract value moves, the budget moves with it.
describe('feedLagBudgetMs is derived, not hardcoded', () => {
  it('reads both cache layers from the shared llms-assurance contract', () => {
    expect(ORIGIN_CACHE_FRESHNESS_MS).toBe(300_000)
    expect(SITE_FETCH_FRESHNESS_MS).toBe(60_000)
  })

  it('is the two contract layers at Age zero, and grows one-for-one with edge dwell', () => {
    expect(feedLagBudgetMs(0)).toBe(SITE_FETCH_FRESHNESS_MS + ORIGIN_CACHE_FRESHNESS_MS)
    expect(feedLagBudgetMs(600)).toBe(600_000 + SITE_FETCH_FRESHNESS_MS + ORIGIN_CACHE_FRESHNESS_MS)
  })

  it('never credits a negative or absent Age with dwell', () => {
    expect(feedLagBudgetMs(-100)).toBe(feedLagBudgetMs(0))
    expect(feedLagBudgetMs()).toBe(feedLagBudgetMs(0))
  })
})

const rssFeed = (lastBuildDate: string, pubDate: string) =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel>',
    '<title>Jonathan Lloyd</title><link>https://jonathanlloyd.me</link><description>Human Datastream</description>',
    `<lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `<item><title>Review</title><link>https://jonathanlloyd.me/a</link><guid>tag:jonathanlloyd.me,2026:a</guid><pubDate>${pubDate}</pubDate></item>`,
    '</channel></rss>'
  ].join('')

const jsonFeed = (datePublished: string, id = 'tag:jonathanlloyd.me,2026:a') =>
  JSON.stringify({version: 'https://jsonfeed.org/version/1.1', title: 'Jonathan Lloyd', items: [{id, content_text: 'body', date_published: datePublished}]})

describe('evaluateFeedStructure', () => {
  const now = new Date('2026-08-30T18:00:00.000Z')
  const fresh = '2026-08-30T12:00:00.000Z'

  it('runs the check-feeds RSS rules on feed.xml', () => {
    expect(evaluateFeedStructure('feed-xml', 'rss', rssFeed('Sun, 30 Aug 2026 17:46:00 GMT', fresh), now).status).toBe('passed')
    expect(evaluateFeedStructure('feed-xml', 'rss', '<rss version="2.0"><channel></channel></rss>', now).status).toBe('failed')
  })

  // feed.json was not probed AT ALL on the tight cadence before this. A
  // feed.json serving a truncated document or an error page was invisible until
  // the weekly tier ran.
  it('runs the check-feeds JSON Feed rules on feed.json', () => {
    expect(evaluateFeedStructure('feed-json', 'json', jsonFeed(fresh), now).status).toBe('passed')
    const truncated = JSON.stringify({items: [{id: 'tag:a', content_text: 'x', date_published: fresh}]})
    const verdict = evaluateFeedStructure('feed-json', 'json', truncated, now)
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('feed-json-field')
  })

  // The severity boundary check-feeds.mjs already draws, inherited rather than
  // re-decided here: an empty item list is a WARN in the shared rule registry
  // (feed-json-no-items / feed-xml-no-items), so it must not red this probe.
  it('inherits the shared rule severities instead of promoting warnings to failures', () => {
    const emptyJson = JSON.stringify({version: 'https://jsonfeed.org/version/1.1', title: 'x', items: []})
    expect(evaluateFeedStructure('feed-json', 'json', emptyJson, now).status).toBe('passed')
  })

  // Fail-closed: a body the validator cannot even reach is unverified, not broken.
  it('is indeterminate for an empty body or one that is not parseable JSON', () => {
    expect(evaluateFeedStructure('feed-xml', 'rss', '   \n ', now).status).toBe('unknown')
    expect(evaluateFeedStructure('feed-json', 'json', null, now).status).toBe('unknown')
    expect(evaluateFeedStructure('feed-json', 'json', '<html>502 Bad Gateway</html>', now).status).toBe('unknown')
  })
})

// THE F2 CHECK. The feeds are deliberately edge-cacheable, so the trio's 10m
// skew window is the wrong oracle for them; the budget is the sum of the cache
// layers between the composer and the client. Every case below pins one edge of
// that rule, and the failing cases are what prove it is not vacuous.
describe('evaluateFeedOriginSiteCoherence', () => {
  const now = new Date('2026-08-30T18:00:00.000Z')
  const minutesAgo = (minutes: number) => new Date(now.getTime() - (minutes * 60_000))
  const rssAgo = (minutes: number) => rssFeed(minutesAgo(minutes).toUTCString(), '2026-08-30T12:00:00.000Z')
  // Mirrors probeFeeds: the site timestamp is extracted from the served body,
  // the origin timestamp comes off x-amz-meta-composed-at.
  const rssSide = (minutes: number, ageSeconds = 0) => {
    const body = rssAgo(minutes)
    return {body, timestamp: extractCompositionTimestamp(body), ageSeconds}
  }

  it('passes byte-identical planes without needing any timestamp at all', () => {
    const body = rssAgo(30)
    const verdict = evaluateFeedOriginSiteCoherence('feed-xml', {body, timestamp: null, ageSeconds: 900}, {body, timestamp: null}, now)
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('byte-identical')
  })

  it('passes a site copy trailing the origin inside the cache budget', () => {
    const verdict = evaluateFeedOriginSiteCoherence('feed-xml', rssSide(5), rssSide(0), now)
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('inside the 6.00m cache budget')
  })

  // NON-VACUITY, RSS: same shape as the passing case, 2 minutes further behind,
  // and the verdict flips. Nothing in the cache path explains a 7-minute lag on
  // a freshly fetched copy.
  it('fails a site copy trailing the origin beyond the cache budget', () => {
    const verdict = evaluateFeedOriginSiteCoherence('feed-xml', rssSide(7), rssSide(0), now)
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('trails the origin by 7.00m')
    expect(verdict.message).toContain('beyond the 6.00m cache budget')
  })

  // The observed live case: the Cloudflare edge had held the copy for 25
  // minutes, so a 7-minute lag is fully explained. Age is what separates the
  // two verdicts, and it is read off the response, not assumed.
  it('admits the same 7m lag once the edge Age accounts for it', () => {
    const verdict = evaluateFeedOriginSiteCoherence('feed-xml', rssSide(7, 1500), rssSide(0), now)
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('Age 1500s + 60s worker fetch cache + 300s CloudFront TTL')
  })

  // Same composition on both planes but different bytes is corruption, not lag,
  // and no budget excuses it. This is the trio's byte-equality rule, preserved.
  it('fails identical composition timestamps with differing bytes', () => {
    const site = rssSide(0)
    const origin = {body: `${site.body}<!-- extra -->`, timestamp: site.timestamp}
    const verdict = evaluateFeedOriginSiteCoherence('feed-xml', site, origin, now)
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('byte equality is required at the same composition timestamp')
  })

  it('fails a site plane advertising a composition NEWER than its own origin', () => {
    const verdict = evaluateFeedOriginSiteCoherence('feed-xml', rssSide(0), rssSide(5), now)
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('reading different origins')
  })

  // feed.json's normal path once its content moves: the site plane advertises
  // NO composition (JSON Feed 1.1 has no such field, and the proxy forwards no
  // object metadata), so the answerable question is whether the origin
  // recomposed recently enough for the caches to still hold the previous object.
  it('passes differing feed.json bytes when the origin recomposed inside the budget', () => {
    const site = {body: jsonFeed('2026-08-30T12:00:00.000Z'), timestamp: null, ageSeconds: 0}
    const origin = {body: jsonFeed('2026-08-30T17:00:00.000Z', 'tag:b'), timestamp: minutesAgo(3).toISOString()}
    const verdict = evaluateFeedOriginSiteCoherence('feed-json', site, origin, now)
    expect(verdict.status).toBe('passed')
    expect(verdict.message).toContain('the site is still serving the previous object')
  })

  // NON-VACUITY, JSON: the origin has been stable for 20 minutes and the site
  // still serves something else. No cache layer holds a copy that long at Age 0,
  // so the site plane is stuck.
  it('fails differing feed.json bytes when the origin composition is older than the budget', () => {
    const site = {body: jsonFeed('2026-08-30T12:00:00.000Z'), timestamp: null, ageSeconds: 0}
    const origin = {body: jsonFeed('2026-08-30T17:00:00.000Z', 'tag:b'), timestamp: minutesAgo(20).toISOString()}
    const verdict = evaluateFeedOriginSiteCoherence('feed-json', site, origin, now)
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('no cache layer explains the site serving something else')
  })

  it('admits that same 20m-old origin composition once the edge Age accounts for it', () => {
    const site = {body: jsonFeed('2026-08-30T12:00:00.000Z'), timestamp: null, ageSeconds: 1500}
    const origin = {body: jsonFeed('2026-08-30T17:00:00.000Z', 'tag:b'), timestamp: minutesAgo(20).toISOString()}
    expect(evaluateFeedOriginSiteCoherence('feed-json', site, origin, now).status).toBe('passed')
  })

  // Fail-closed: an unreachable plane, or a byte difference with nothing to
  // classify it by, is never a silent pass. probeFeeds passes null for a non-OK
  // or unreachable side, which is what these assert.
  it('is indeterminate when a plane never answered', () => {
    const side = rssSide(0)
    expect(evaluateFeedOriginSiteCoherence('feed-xml', {body: null, timestamp: null, ageSeconds: 0}, side, now).status).toBe('unknown')
    expect(evaluateFeedOriginSiteCoherence('feed-xml', side, {body: null, timestamp: null}, now).status).toBe('unknown')
  })

  it('is indeterminate when the bytes differ and the origin advertises no parseable composition', () => {
    const site = {body: jsonFeed('2026-08-30T12:00:00.000Z'), timestamp: null, ageSeconds: 0}
    for (const timestamp of [null, 'whenever']) {
      const verdict = evaluateFeedOriginSiteCoherence('feed-json', site, {body: jsonFeed('2026-08-30T17:00:00.000Z', 'tag:b'), timestamp}, now)
      expect(verdict.status).toBe('unknown')
      expect(verdict.message).toContain('x-amz-meta-composed-at')
    }
  })
})

describe('evaluateTrioStructure', () => {
  it('runs the shared llms-structure rule on llms.txt', () => {
    expect(evaluateTrioStructure('llms-txt', VALID_LLMS_TXT).status).toBe('passed')
    expect(evaluateTrioStructure('llms-txt', 'no heading at all\n').status).toBe('failed')
  })

  // llms-full.txt and index.md open with a <SYSTEM> preamble before their H1 and
  // carry prose lists, so the llms.txt rule would red a healthy artifact. They
  // get an H1-presence assertion instead, which is what catches a truncated or
  // substituted body.
  it('accepts the <SYSTEM> preamble on llms-full.txt / index.md but demands an H1', () => {
    const body = '<SYSTEM>preamble</SYSTEM>\n\n# Jonathan Lloyd\n\n> summary\n'
    expect(evaluateTrioStructure('llms-full-txt', body).status).toBe('passed')
    expect(evaluateTrioStructure('index-md', 'truncated garbage with no heading').status).toBe('failed')
  })

  it('is indeterminate for an empty body rather than reporting a structural failure', () => {
    expect(evaluateTrioStructure('llms-txt', '   \n  ').status).toBe('unknown')
    expect(evaluateTrioStructure('index-md', null).status).toBe('unknown')
  })
})

describe('evaluateJsonExportFreshness', () => {
  const now = new Date('2026-08-30T18:00:00.000Z')

  it('passes an export inside its window and fails one beyond it', () => {
    expect(evaluateJsonExportFreshness('books', {generatedAt: '2026-08-28T09:28:50.705Z'}, now).status).toBe('passed')
    expect(evaluateJsonExportFreshness('books', {generatedAt: '2026-08-01T00:00:00.000Z'}, now).status).toBe('failed')
  })

  it('is indeterminate when the payload carries no parseable generatedAt', () => {
    expect(evaluateJsonExportFreshness('books', {books: []}, now).status).toBe('unknown')
    expect(evaluateJsonExportFreshness('books', {generatedAt: 'whenever'}, now).status).toBe('unknown')
    expect(evaluateJsonExportFreshness('books', null, now).status).toBe('unknown')
  })

  it('uses the 7-day window it documents', () => {
    expect(JSON_EXPORT_MAX_AGE_DAYS).toBe(7)
  })
})

describe('aggregate uses the contract precedence rule', () => {
  it('lets any failure dominate an unknown, and any unknown dominate a pass', () => {
    expect(aggregate([{status: 'passed'}, {status: 'passed'}])).toBe('passed')
    expect(aggregate([{status: 'passed'}, {status: 'unknown'}])).toBe('unknown')
    expect(aggregate([{status: 'failed'}, {status: 'unknown'}])).toBe('failed')
  })
})

describe('report is fail-closed', () => {
  const silence = () => {
    const original = console.log
    console.log = () => {}
    return () => {
      console.log = original
    }
  }

  it('exits 0 only when every result passed', () => {
    const restore = silence()
    try {
      expect(report([{id: 'a', status: 'passed', message: 'ok'}])).toBe(0)
      // An indeterminate bucket must keep the managed issue OPEN. The reconciler
      // only does that for a FAILING step outcome, so indeterminate exits 1 too.
      expect(report([{id: 'a', status: 'unknown', message: 'unverified'}])).toBe(1)
      expect(report([{id: 'a', status: 'failed', message: 'broken'}])).toBe(1)
      // An empty result set means the probe measured nothing -- not a pass.
      expect(report([])).toBe(1)
    } finally {
      restore()
    }
  })
})

// The end-to-end tri-state promise the brief makes: an unreachable endpoint or
// an unparseable body must never reach a passing verdict by any path.
describe('unreachable and unparseable observations never pass', () => {
  it('lands every unverifiable observation on indeterminate', () => {
    const now = new Date('2026-08-30T18:00:00.000Z')
    const verdicts = [
      evaluateTrioStructure('llms-txt', null), // body never arrived
      evaluateCompositionAge(null, now), // nothing to read a timestamp from
      evaluateCoherence({key: 'a', timestamp: null, body: null}, {key: 'b', timestamp: null, body: null}),
      evaluateCacheState(null), // no cf-cache-status header to classify
      evaluateJsonExportFreshness('books', null, now), // body did not parse as JSON
      evaluateFeedStructure('feed-json', 'json', null, now), // feed body never arrived
      // neither feed plane answered
      evaluateFeedOriginSiteCoherence('feed-xml', {body: null, timestamp: null, ageSeconds: 0}, {body: null, timestamp: null}, now)
    ]
    for (const verdict of verdicts) {
      expect(verdict.status).toBe('unknown')
    }
    expect(aggregate(verdicts)).toBe('unknown')
  })
})
