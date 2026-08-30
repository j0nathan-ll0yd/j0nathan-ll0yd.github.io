// Unit tests for the pure evaluators in scripts/audit/serving-probe.mjs.
// No network: every case feeds the evaluators the shape a live observation
// would produce. The tri-state contract is the thing under test -- in
// particular that an unverifiable observation lands on `unknown`, never on a
// silent `passed`.

import {describe, expect, it} from 'vitest'
import {
  aggregate,
  evaluateCachePolicy,
  evaluateCoherence,
  evaluateCompositionAge,
  evaluateJsonExportFreshness,
  evaluateTrioStructure,
  extractCompositionTimestamp,
  JSON_EXPORT_MAX_AGE_DAYS,
  KNOWN_CACHE_DEVIATIONS,
  MAX_COMPOSITION_AGE_MS,
  MAX_COMPOSITION_SKEW_MS,
  readCachePolicy,
  report,
  REQUIRED_CACHE_HEADERS
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

  it('requires no-store on all three cache headers the contract names', () => {
    expect(REQUIRED_CACHE_HEADERS).toEqual({'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store'})
  })
})

describe('evaluateCachePolicy', () => {
  it('passes when every required header carries no-store', () => {
    const observed = readCachePolicy(headers({'cache-control': 'no-store', 'cdn-cache-control': 'no-store', 'cloudflare-cdn-cache-control': 'no-store'}))
    expect(evaluateCachePolicy(observed).status).toBe('passed')
  })

  it('is case- and whitespace-insensitive on the directive', () => {
    const observed = readCachePolicy(headers({'cache-control': '  No-Store ', 'cdn-cache-control': 'NO-STORE', 'cloudflare-cdn-cache-control': 'no-store'}))
    expect(evaluateCachePolicy(observed).status).toBe('passed')
  })

  // The live condition observed 2026-08-30 on all three trio artifacts.
  it('reports the named Cloudflare edge-TTL override as indeterminate, not a pass and not a fail', () => {
    const observed = readCachePolicy(headers({'cache-control': 'public, max-age=600, s-maxage=60'}))
    const verdict = evaluateCachePolicy(observed)
    expect(verdict.status).toBe('unknown')
    expect(verdict.message).toContain('cloudflare-edge-cache-ttl-override')
    expect(verdict.message).toContain('required-unverified')
  })

  it('flipping the named deviation to strict reds the same condition -- a one-line promotion', () => {
    const observed = readCachePolicy(headers({'cache-control': 'public, max-age=600, s-maxage=60'}))
    const strict = KNOWN_CACHE_DEVIATIONS.map((deviation) => ({...deviation, strict: true}))
    expect(evaluateCachePolicy(observed, strict).status).toBe('failed')
  })

  // The whole point of matching the deviation EXACTLY: any drift away from the
  // known condition is a new regression and must red rather than inherit the
  // known-deviation exemption.
  it('fails when the override drifts to a different max-age', () => {
    const observed = readCachePolicy(headers({'cache-control': 'public, max-age=3600, s-maxage=60'}))
    const verdict = evaluateCachePolicy(observed)
    expect(verdict.status).toBe('failed')
    expect(verdict.message).toContain('matches no known deviation')
  })

  it('fails when no-store is present on only some of the required headers', () => {
    const observed = readCachePolicy(headers({'cache-control': 'no-store', 'cdn-cache-control': 'no-store'}))
    expect(evaluateCachePolicy(observed).status).toBe('failed')
  })

  it('fails when the cache headers are absent entirely', () => {
    expect(evaluateCachePolicy(readCachePolicy(headers({}))).status).toBe('failed')
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
      evaluateJsonExportFreshness('books', null, now) // body did not parse as JSON
    ]
    for (const verdict of verdicts) {
      expect(verdict.status).toBe('unknown')
    }
    expect(aggregate(verdicts)).toBe('unknown')
  })
})
