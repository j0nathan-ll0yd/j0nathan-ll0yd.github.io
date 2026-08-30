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
  evaluateJsonExportFreshness,
  evaluateOriginSiteCoherence,
  evaluateTrioStructure,
  extractCompositionTimestamp,
  JSON_EXPORT_MAX_AGE_DAYS,
  MAX_COMPOSITION_AGE_MS,
  MAX_COMPOSITION_SKEW_MS,
  readCachePolicy,
  report,
  REQUIRED_CACHE_HEADERS,
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

  it('returns null for a body with no marker, and for an unparseable one', () => {
    expect(extractCompositionTimestamp('# just a heading')).toBeNull()
    expect(extractCompositionTimestamp('<!-- composed-at: not-a-date -->')).toBeNull()
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
      evaluateJsonExportFreshness('books', null, now) // body did not parse as JSON
    ]
    for (const verdict of verdicts) {
      expect(verdict.status).toBe('unknown')
    }
    expect(aggregate(verdicts)).toBe('unknown')
  })
})
