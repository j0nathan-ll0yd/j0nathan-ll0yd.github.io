// audits/__tests__/b2-llms.test.ts -- the whole merged weekly llms check (atlas
// decision 0119 D2): the pure coherence evaluator, the tri-state managed-issue
// fold, the orchestration around them, and the managed-issue lifecycle they drive.
//
// ONE SUITE, because there is now one module (atlas decision 0122 phase 4,
// executed by 0128). The evaluator cases arrived here from llms-coherence.test.ts
// and the fold cases from the half of llms-spoke-evidence.test.ts that was never
// hub evidence; both source libs folded into audits/checks/b2-llms.mjs and their
// test files folded with them. Every case is preserved, none merged or weakened.
//
// The Atlas spoke-evidence envelope tests died with the envelope (0119 D1).

import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {durationToMilliseconds, LLM_FRESHNESS_CONFIG} from '@j0nathan-ll0yd/estate-contracts/llms-assurance'
import type {LlmsArtifact} from '../../functions/_lib/llms-artifacts'
import {
  compositionTimestamp,
  compositionWireSkew,
  detectionLatencyLine,
  evaluateLlmsCoherence,
  LLMS_COHERENCE_THRESHOLDS,
  LLMS_DETECTION_LATENCY,
  llmsCheckStatus,
  managedIssueOutcome,
  ORIGIN_CACHE_FRESHNESS_SECONDS,
  runB2Llms,
  runB2LlmsCli
} from '../checks/b2-llms.mjs'
import type {LlmsCoherenceInput, LlmsResponseSnapshot} from '../checks/b2-llms.mjs'
import {createDryRunClient, reconcileCheckIssues} from '../lib/file-check-issues.mjs'

const OBSERVED_AT = '2026-08-29T18:00:00.000Z'
const NOW = Date.parse(OBSERVED_AT)
const RECENT = '2026-08-29T17:55:00.000Z'
const encoder = new TextEncoder()

const scratchDirectories: string[] = []
const logger = () => ({log: vi.fn(), warn: vi.fn(), error: vi.fn()})

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

// ---------------------------------------------------------------------------
// Bodies. Shared by both halves of the suite: the orchestration fixtures used
// to restate these two literals, which is the drift the fold removes.
// ---------------------------------------------------------------------------

function discoveryBody(timestamp: string): string {
  return `# Site\n\n> Summary\n\n<!-- composed-at: ${timestamp} -->\n`
}

function fullBody(timestamp: string, payload = 'same payload'): string {
  return `# Complete profile\n\n**Generated:** ${timestamp}\n\n${payload}\n`
}

/**
 * The Cache-Control the origin serves, DERIVED from the same contract field the check reads, so
 * the fixture cannot drift from the expectation it is meant to satisfy. Measured live on
 * 2026-09-21: all three origin responses returned exactly this.
 */
const ORIGIN_CACHE_CONTROL = `public, max-age=${ORIGIN_CACHE_FRESHNESS_SECONDS}, s-maxage=${ORIGIN_CACHE_FRESHNESS_SECONDS}`

/**
 * A snapshot for the PURE evaluator: content-type and cache state are the
 * subjects under test, so they are supplied directly rather than derived from an
 * artifact descriptor.
 */
function pureSnapshot(body: string, contentType: string, status = 200, site = false): LlmsResponseSnapshot {
  return {
    status,
    contentType,
    body: encoder.encode(body),
    cacheControl: site ? 'no-store' : ORIGIN_CACHE_CONTROL,
    cdnCacheControl: site ? 'no-store' : null,
    cfCacheStatus: site ? 'BYPASS' : null,
    // The coherence evaluator never reads this wire -- it compares two different
    // responses, and the wire-skew arm compares two fields of one. Stated as null so
    // the fixture matches the declared LlmsResponseSnapshot rather than leaning on an
    // absent property.
    composedAtHeader: null
  }
}

function coherentInput(timestamp = RECENT): LlmsCoherenceInput {
  const discovery = discoveryBody(timestamp)
  const full = fullBody(timestamp)
  return {
    'llms.txt': {origin: pureSnapshot(discovery, 'text/markdown; charset=utf-8'), site: pureSnapshot(discovery, 'text/plain; charset=utf-8', 200, true)},
    'llms-full.txt': {origin: pureSnapshot(full, 'text/markdown; charset=utf-8'), site: pureSnapshot(full, 'text/markdown; charset=utf-8', 200, true)},
    'index.md': {origin: pureSnapshot(full, 'text/markdown; charset=utf-8'), site: pureSnapshot(full, 'text/markdown; charset=utf-8', 200, true)}
  }
}

describe('compositionTimestamp', () => {
  it('reads both composer timestamp formats', () => {
    expect(compositionTimestamp(encoder.encode(discoveryBody(RECENT)))).toBe(Date.parse(RECENT))
    expect(compositionTimestamp(encoder.encode(fullBody(RECENT)))).toBe(Date.parse(RECENT))
  })

  it('rejects absent, invalid, and non-UTF-8 timestamps', () => {
    expect(compositionTimestamp(encoder.encode('# no timestamp'))).toBeNull()
    expect(compositionTimestamp(encoder.encode('**Generated:** invalid'))).toBeNull()
    expect(compositionTimestamp(Uint8Array.of(0xff))).toBeNull()
  })
})

describe('evaluateLlmsCoherence', () => {
  // covers: llms-txt#Raw and canonical llms artifacts stay coherent
  it('accepts fresh, typed, synchronized, byte-identical artifacts', () => {
    expect(evaluateLlmsCoherence(coherentInput(), NOW)).toEqual([])
    expect(LLMS_COHERENCE_THRESHOLDS).toEqual({
      maxCompositionAgeMs: 4 * 60 * 60 * 1000,
      maxCompositionSkewMs: 10 * 60 * 1000,
      maxFutureSkewMs: 5 * 60 * 1000
    })
  })

  it('reports status, content-type, and composition timestamp failures with artifact evidence', () => {
    const input = coherentInput()
    input['llms.txt'].origin = pureSnapshot('# missing timestamp', 'text/plain', 503)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-origin-status', artifact: 'llms.txt', message: expect.stringContaining('HTTP 503')}),
      expect.objectContaining({id: 'llms-origin-content-type', artifact: 'llms.txt'}),
      expect.objectContaining({id: 'llms-origin-composition-time', artifact: 'llms.txt'})
    ]))
  })

  // covers: llms-txt#Full-content artifacts stay fresh
  it('enforces composition age and bounded origin-to-site skew as pure time comparisons', () => {
    // The threshold authority is the packaged contract (atlas decision 0119 D2):
    // the evaluator's configuration must equal the coherencePolicy the contract
    // owns, so a revert to drifting local literals fails here. The literal
    // 4h/10min/5min values themselves are pinned by the first test above.
    const {coherencePolicy} = LLM_FRESHNESS_CONFIG.layers.portfolioServing
    expect(LLMS_COHERENCE_THRESHOLDS.maxCompositionAgeMs).toBe(durationToMilliseconds(coherencePolicy.maxCompositionAge))
    expect(LLMS_COHERENCE_THRESHOLDS.maxCompositionSkewMs).toBe(durationToMilliseconds(coherencePolicy.maxCompositionSkew))
    // maxFutureSkew joined the contract at estate-contracts 0.10.0 and was the one threshold
    // this tether did not cover (atlas decision 0142 step 5.2), so a local literal could have
    // crept back into it alone while the other two stayed honest.
    expect(LLMS_COHERENCE_THRESHOLDS.maxFutureSkewMs).toBe(durationToMilliseconds(coherencePolicy.maxFutureSkew))
    // ALL THREE, and NOTHING ELSE: a fourth key would be a threshold stated locally.
    expect(Object.keys(LLMS_COHERENCE_THRESHOLDS).sort()).toEqual(['maxCompositionAgeMs', 'maxCompositionSkewMs', 'maxFutureSkewMs'])

    expect(evaluateLlmsCoherence(coherentInput('2026-08-29T14:00:00.000Z'), NOW)).toEqual([])
    expect(evaluateLlmsCoherence(coherentInput('2026-08-29T13:59:59.999Z'), NOW)).toEqual(
      expect.arrayContaining([expect.objectContaining({id: 'llms-origin-stale'})])
    )

    const input = coherentInput()
    input['llms-full.txt'].site = pureSnapshot(fullBody('2026-08-29T13:00:00.000Z'), 'text/markdown; charset=utf-8', 200, true)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-site-stale', artifact: 'llms-full.txt'}),
      expect.objectContaining({id: 'llms-origin-site-skew', artifact: 'llms-full.txt'})
    ]))
  })

  it('reports same-timestamp origin/site and full/index byte mismatches', () => {
    const input = coherentInput()
    input['llms-full.txt'].site = pureSnapshot(fullBody(RECENT, 'site drift'), 'text/markdown; charset=utf-8', 200, true)
    input['index.md'].origin = pureSnapshot(fullBody(RECENT, 'origin alias drift'), 'text/markdown; charset=utf-8')

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toHaveLength(4)
    expect(findings.filter(({id}) => id === 'llms-origin-site-bytes')).toHaveLength(2)
    expect(findings.filter(({id}) => id === 'llms-full-index-bytes')).toHaveLength(2)
  })

  // THE DISCOVERY INDEX IS IN SCOPE (atlas decision 0142 step 5.2, a DELIBERATE widening of the
  // openspec "Same-generation bytes diverge" scenario from full-content responses to all three
  // artifacts). Before it, the byte-equality arm iterated a hard-coded ['llms-full.txt',
  // 'index.md'], so two DIFFERENT valid llms.txt bodies carrying the SAME composition timestamp
  // both passed: the structure arm reads only the site body, the freshness arm reads only the
  // stamp both hops agree on, and nothing compared the two hops' bytes.
  //
  // The mutation below is the acceptance case verbatim -- a discovery link and a title changed on
  // the site only, with the timestamp untouched.
  it('reports a discovery link and title changed on the site alone, under one composition timestamp', () => {
    const input = coherentInput()
    const corrupted = `# Sitte\n\n> Summary\n\n## Docs\n\n- [Doc](https://example.com/WRONG)\n\n<!-- composed-at: ${RECENT} -->\n`
    input['llms.txt'].site = pureSnapshot(corrupted, 'text/plain; charset=utf-8', 200, true)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual([
      expect.objectContaining({
        id: 'llms-origin-site-bytes',
        artifact: 'llms.txt',
        participants: [{artifact: 'llms.txt', side: 'origin'}, {artifact: 'llms.txt', side: 'site'}]
      })
    ])
    expect(findings[0].message).toContain('same composition but bytes differ')
  })

  // The widening does not reach across artifacts. llms.txt and llms-full.txt are different
  // documents that legitimately differ byte-for-byte at the same instant; only the full/index
  // ALIAS pair is held to equality, because that is what an alias means.
  it('does not compare the discovery index against the full document', () => {
    expect(evaluateLlmsCoherence(coherentInput(), NOW)).toEqual([])
  })

  // The convergence window still governs the discovery index, exactly as it governs the other
  // two: adjacent fresh generations are not corruption.
  it('leaves an adjacent fresh llms.txt generation alone, inside the convergence window', () => {
    const input = coherentInput()
    const previous = '2026-08-29T17:50:00.000Z'
    input['llms.txt'].site = pureSnapshot(`# Site\n\n> Earlier summary\n\n<!-- composed-at: ${previous} -->\n`, 'text/plain; charset=utf-8', 200, true)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings.some(({id}) => id.endsWith('-bytes'))).toBe(false)
    expect(findings).toEqual([])
  })

  it('accepts adjacent fresh generations inside the convergence window without claiming byte corruption', () => {
    const input = coherentInput()
    const previous = '2026-08-29T17:45:00.000Z'
    input['llms-full.txt'].site = pureSnapshot(fullBody(previous, 'previous generation'), 'text/markdown; charset=utf-8', 200, true)
    input['index.md'].origin = pureSnapshot(fullBody(previous, 'previous generation'), 'text/markdown; charset=utf-8')
    input['index.md'].site = pureSnapshot(fullBody(previous, 'previous generation'), 'text/markdown; charset=utf-8', 200, true)

    expect(evaluateLlmsCoherence(input, NOW)).toEqual([])
  })

  it('rejects excessive origin/site and full/index composition skew without byte findings across generations', () => {
    const input = coherentInput()
    input['llms-full.txt'].site = pureSnapshot(fullBody('2026-08-29T17:44:00.000Z', 'previous generation'), 'text/markdown; charset=utf-8', 200, true)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-origin-site-skew', artifact: 'llms-full.txt'}),
      expect.objectContaining({id: 'llms-full-index-skew', artifact: 'llms-full.txt/index.md'})
    ]))
    expect(findings).toHaveLength(2)
    expect(findings.some(({id}) => id.endsWith('-bytes'))).toBe(false)
  })

  it('rejects composition times beyond the future clock allowance', () => {
    const input = coherentInput('2026-08-29T18:06:00.000Z')
    expect(evaluateLlmsCoherence(input, NOW)).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-origin-composition-future'}),
      expect.objectContaining({id: 'llms-site-composition-future'})
    ]))
  })

  it('rejects canonical responses retained by an outer cache', () => {
    const input = coherentInput()
    input['llms.txt'].site.cacheControl = 'public, max-age=600'
    input['llms.txt'].site.cdnCacheControl = null
    input['llms.txt'].site.cfCacheStatus = 'HIT'

    expect(evaluateLlmsCoherence(input, NOW)).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-site-browser-cache-policy', artifact: 'llms.txt'}),
      expect.objectContaining({id: 'llms-site-cdn-cache-policy', artifact: 'llms.txt'}),
      expect.objectContaining({id: 'llms-site-edge-cache-status', artifact: 'llms.txt'})
    ]))
  })
})

describe('detection latency', () => {
  // covers: llms-txt#Full-content artifacts stay fresh
  it('derives the worst case from the two contract fields rather than restating it', () => {
    const {coherencePolicy, auditCadence} = LLM_FRESHNESS_CONFIG.layers.portfolioServing
    expect(LLMS_DETECTION_LATENCY.thresholdMs).toBe(durationToMilliseconds(coherencePolicy.maxCompositionAge))
    expect(LLMS_DETECTION_LATENCY.auditCadenceMs).toBe(durationToMilliseconds(auditCadence))
    expect(LLMS_DETECTION_LATENCY.worstCaseMs).toBe(LLMS_DETECTION_LATENCY.thresholdMs + LLMS_DETECTION_LATENCY.auditCadenceMs)
  })

  it('pins the figures the contract currently yields', () => {
    // Threshold 4h, weekly cadence 168h, so a persistent public-path violation
    // can stand 172h while every check reports green. These literals make a
    // contract change to either field visible here instead of silent.
    expect(LLMS_DETECTION_LATENCY).toEqual({thresholdMs: 4 * 60 * 60 * 1000, auditCadenceMs: 7 * 24 * 60 * 60 * 1000, worstCaseMs: 172 * 60 * 60 * 1000})
  })

  it('renders one line naming the worst case and both of its terms', () => {
    expect(detectionLatencyLine()).toBe(
      '  detection: worst-case public-path latency is 172.0h = composition-age threshold 4.0h + audit cadence 168.0h; ' +
        'a persistent violation can stand that long with every check green.'
    )
  })

  it('renders whatever fields it is handed, so the line cannot hold a stale constant', () => {
    expect(detectionLatencyLine({thresholdMs: 90 * 60_000, auditCadenceMs: 30 * 60_000, worstCaseMs: 120 * 60_000})).toContain(
      'is 2.0h = composition-age threshold 1.5h + audit cadence 0.5h'
    )
  })
})

// ---------------------------------------------------------------------------
// compositionWireSkew: two fields of ONE response, not two responses.
// ---------------------------------------------------------------------------

// covers: llms-txt#One composition instant, carried on two wires, agrees on one response
describe('compositionWireSkew: the header wire against the body wire, on one response', () => {
  const withHeader = (body: string, header: string | null): LlmsResponseSnapshot => ({
    ...pureSnapshot(body, 'text/markdown; charset=utf-8'),
    composedAtHeader: header
  })

  it("agrees when the producer's one instant reached both wires intact", () => {
    expect(compositionWireSkew(withHeader(discoveryBody(RECENT), RECENT))).toBeNull()
  })

  it('agrees across equivalent ISO spellings -- the comparison is on the instant, not the string', () => {
    expect(compositionWireSkew(withHeader(discoveryBody('2026-08-29T17:55:00.000Z'), '2026-08-29T17:55:00Z'))).toBeNull()
    expect(compositionWireSkew(withHeader(discoveryBody('2026-08-29T17:55:00.000Z'), '2026-08-29T18:55:00.000+01:00'))).toBeNull()
  })

  it('reports the pair when a cached body is served beside fresher metadata', () => {
    const skew = compositionWireSkew(withHeader(discoveryBody('2026-08-29T17:25:00.000Z'), '2026-08-29T17:55:00.000Z'))
    expect(skew).toEqual({header: '2026-08-29T17:55:00.000Z', body: Date.parse('2026-08-29T17:25:00.000Z')})
  })

  it('reports the reverse direction too -- fresher body, stale metadata', () => {
    const skew = compositionWireSkew(withHeader(discoveryBody('2026-08-29T17:55:00.000Z'), '2026-08-29T17:25:00.000Z'))
    expect(skew).toEqual({header: '2026-08-29T17:25:00.000Z', body: Date.parse('2026-08-29T17:55:00.000Z')})
  })

  it('reads the **Generated:** trailer as well as the composed-at comment', () => {
    expect(compositionWireSkew(withHeader(fullBody(RECENT), RECENT))).toBeNull()
    expect(compositionWireSkew(withHeader(fullBody('2026-08-29T17:25:00.000Z'), RECENT))).not.toBeNull()
  })

  // ABSENCE IS NOT DISAGREEMENT. Each missing wire is already reported by another arm, or
  // means the hop did not forward the metadata at all; inventing a finding from either
  // would fire on every response a Cloudflare Pages Function strips `x-amz-meta-*` from.
  it('says nothing when the header wire is absent', () => {
    expect(compositionWireSkew(withHeader(discoveryBody(RECENT), null))).toBeNull()
  })

  it('says nothing when the header wire is present but empty', () => {
    expect(compositionWireSkew(withHeader(discoveryBody(RECENT), ''))).toBeNull()
  })

  it('says nothing when the body wire is absent -- llms-{side}-composition-time owns that', () => {
    expect(compositionWireSkew(withHeader('# Site\n\n> Summary\n', RECENT))).toBeNull()
  })

  it('says nothing about a transport-dark snapshot: no header, no body, no claim', () => {
    expect(compositionWireSkew({...withHeader('', null), status: 0, body: new Uint8Array()})).toBeNull()
  })

  it('says nothing when the header wire is present but unparseable -- malformed is not disagreeing', () => {
    expect(compositionWireSkew(withHeader(discoveryBody(RECENT), 'not-a-date'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Orchestration: the same two bodies, reached through an artifact descriptor.
// ---------------------------------------------------------------------------

function validBody(artifact: LlmsArtifact): string {
  return artifact.id === 'llms.txt' ? discoveryBody(RECENT) : fullBody(RECENT)
}

function snapshot(artifact: LlmsArtifact, side: 'origin' | 'site', body = validBody(artifact)) {
  const bytes = new TextEncoder().encode(body)
  const stamped = compositionTimestamp(bytes)
  return {
    status: 200,
    contentType: `${side === 'site' ? artifact.siteContentType : artifact.originContentType}; charset=utf-8`,
    body: bytes,
    cacheControl: side === 'site' ? 'no-store' : ORIGIN_CACHE_CONTROL,
    cdnCacheControl: side === 'site' ? 'no-store' : null,
    cfCacheStatus: side === 'site' ? 'BYPASS' : null,
    // DERIVED FROM THE BODY, NOT RESTATED. The producer computes `composedAt` once and
    // stamps it on both wires (ComposeLlmContent/index.ts:46, :56, :82-:88), so a healthy
    // response agrees by construction -- and so does this fixture. A test that wants skew
    // overrides the field explicitly, which is what makes the override legible as the
    // subject under test rather than as fixture drift.
    composedAtHeader: stamped === null ? null : new Date(stamped).toISOString(),
    age: null,
    xCache: null,
    source: null
  }
}

const visibleProbe = async () => ({status: 'visible', reason: 'focus mode is not hiding public data'})
const coherentFetchPair = async (artifact: LlmsArtifact) => ({artifact, origin: snapshot(artifact, 'origin'), site: snapshot(artifact, 'site')})

async function scratchPaths(prefix: string) {
  const scratch = await mkdtemp(join(tmpdir(), prefix))
  scratchDirectories.push(scratch)
  return {githubOutputPath: join(scratch, 'github-output')}
}

describe('b2-llms audit orchestration', () => {
  it('classifies confirmed suppression as unknown and performs no artifact fetches', async () => {
    const fetchPairImpl = vi.fn()
    const result = await runB2Llms({
      probeSuppressionImpl: async () => ({status: 'suppressed', reason: 'focus mode active'}),
      fetchPairImpl,
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result).toEqual({
      exitCode: 0,
      status: 'unknown',
      // Suppression stands down determinately over all three artifacts, so it is MEASURED
      // (atlas decision 0122). Zero here would wedge the dead-man on every privacy window.
      measured: 3,
      catalogFindings: [],
      coherenceFindings: [],
      unknowns: [{id: 'llms-suppression', evidence: 'focus suppression prevented measurement: focus mode active'}]
    })
    expect(fetchPairImpl).not.toHaveBeenCalled()
  })

  it('classifies an overdue suppression as a red unknown without fetching', async () => {
    const fetchPairImpl = vi.fn()
    const result = await runB2Llms({
      probeSuppressionImpl: async () => ({status: 'overdue', reason: 'hidden for 25h'}),
      fetchPairImpl,
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('unknown')
    expect(result.unknowns).toEqual([{id: 'llms-suppression', evidence: 'overdue focus suppression prevented measurement: hidden for 25h'}])
    expect(fetchPairImpl).not.toHaveBeenCalled()
  })

  it('reds a thrown suppression probe as llms-suppression-probe before measurement', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: async () => {
        throw new Error('focus endpoint unreachable')
      },
      fetchPairImpl: vi.fn(),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('unknown')
    expect(result.unknowns).toEqual([
      expect.objectContaining({id: 'llms-suppression-probe', evidence: expect.stringContaining('focus endpoint unreachable')})
    ])
  })

  // covers: llms-txt#Raw and canonical llms artifacts stay coherent
  it('passes a coherent, structurally valid, present response set', async () => {
    const result = await runB2Llms({probeSuppressionImpl: visibleProbe, fetchPairImpl: coherentFetchPair, nowMs: Date.parse(OBSERVED_AT), logger: logger()})

    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('passed')
    expect(result.catalogFindings).toEqual([])
    expect(result.coherenceFindings).toEqual([])
    expect(result.unknowns).toEqual([])
  })

  it('prints the detection interval beside the thresholds, and printing it changes no verdict', async () => {
    const auditLogger = logger()
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: coherentFetchPair,
      nowMs: Date.parse(OBSERVED_AT),
      logger: auditLogger
    })

    // Additive output only (atlas decision 0128 P4): the line is stated, and the
    // exit code, findings and measured count are what the clean-run cases assert.
    expect(auditLogger.log.mock.calls.flat()).toContain(detectionLatencyLine())
    expect(result).toMatchObject({exitCode: 0, status: 'passed', measured: 3, catalogFindings: [], coherenceFindings: [], unknowns: []})
  })

  // covers: llms-txt#Raw and canonical llms artifacts stay coherent
  it('preserves an independent true finding alongside incomplete transport', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => ({
        artifact,
        origin: artifact.id === 'llms-full.txt'
          ? {...snapshot(artifact, 'origin'), status: 0, body: new Uint8Array(), error: 'TypeError: network unavailable'}
          : snapshot(artifact, 'origin'),
        site: artifact.id === 'llms.txt' ? {...snapshot(artifact, 'site'), cfCacheStatus: 'HIT'} : snapshot(artifact, 'site')
      }),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('failed')
    expect(result.coherenceFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-site-edge-cache-status', artifact: 'llms.txt'})
    ]))
    expect(result.unknowns).toEqual([
      expect.objectContaining({id: 'llms-llms-full.txt-origin-transport', evidence: expect.stringContaining('network unavailable')})
    ])
  })

  it('keeps an origin-only transport gap indeterminate: exit red, status unknown', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => ({
        artifact,
        origin: artifact.id === 'llms-full.txt'
          ? {...snapshot(artifact, 'origin'), status: 0, body: new Uint8Array(), error: 'TypeError: network unavailable'}
          : snapshot(artifact, 'origin'),
        site: snapshot(artifact, 'site')
      }),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    // The raw coherence findings for the unreachable origin red the step, but
    // every one of them restates the transport gap, so the tri-state fold stays
    // unknown -- the managed issue neither opens nor closes on "could not measure".
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('unknown')
    expect(result.catalogFindings).toEqual([])
    expect(result.unknowns).toEqual([expect.objectContaining({id: 'llms-llms-full.txt-origin-transport'})])
  })

  // covers: llms-txt#Served llms.txt conforms to the Lifegames llms.txt profile
  it('reds a structural defect in the served llms.txt through the catalog wrapper', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) =>
        artifact.id === 'llms.txt'
          ? {
            artifact,
            origin: snapshot(artifact, 'origin'),
            site: snapshot(artifact, 'site', 'no title here\n\n<!-- composed-at: 2026-08-29T17:55:00.000Z -->\n')
          }
          : coherentFetchPair(artifact),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('failed')
    expect(result.catalogFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-txt-h1', severity: 'fail'})
    ]))
  })

  it('never fails on a warn-severity structural finding alone', async () => {
    const danglingSection = '# Site\n\n> Summary\n\n<!-- composed-at: 2026-08-29T17:55:00.000Z -->\n\n## Dangling\n'
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) =>
        artifact.id === 'llms.txt'
          ? {artifact, origin: snapshot(artifact, 'origin', danglingSection), site: snapshot(artifact, 'site', danglingSection)}
          : coherentFetchPair(artifact),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.catalogFindings).toEqual([expect.objectContaining({id: 'llms-txt-h2-no-file-list', severity: 'warn'})])
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('passed')
  })

  // covers: llms-txt#One composition instant, carried on two wires, agrees on one response
  it('names a composed-at wire skew per side per artifact without reddening the step', async () => {
    const stale = '2026-08-29T17:25:00.000Z'
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        // The body is untouched and still valid: only the metadata wire moved, which is
        // exactly the delivery skew this arm exists to see. The producer cannot cause it.
        return artifact.id === 'llms.txt' ? {...pair, site: {...pair.site, composedAtHeader: stale}} : pair
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.catalogFindings).toEqual([
      expect.objectContaining({id: 'llms-composed-at-wire-skew', severity: 'warn', message: expect.stringContaining('llms.txt site')})
    ])
    expect(result.catalogFindings[0].message).toContain(stale)
    expect(result.catalogFindings[0].message).toContain('30.0m apart')
    // A warn moves neither the exit code, the tri-state, nor the measured count: the
    // response was held and judged, and the observation is expected edge behaviour.
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('passed')
    expect(result.measured).toBe(3)
    expect(result.coherenceFindings).toEqual([])
  })

  it('emits once per skewed side, so a fleet-wide skew is six findings and still exit 0', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        const drift = (side: typeof pair.origin) => ({...side, composedAtHeader: '2026-08-29T17:25:00.000Z'})
        return {...pair, origin: drift(pair.origin), site: drift(pair.site)}
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.catalogFindings.filter((f: {id: string}) => f.id === 'llms-composed-at-wire-skew')).toHaveLength(6)
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('passed')
  })

  it('stays silent when the hop forwards no x-amz-meta-composed-at at all', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        return {...pair, origin: {...pair.origin, composedAtHeader: null}, site: {...pair.site, composedAtHeader: null}}
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.catalogFindings).toEqual([])
    expect(result.exitCode).toBe(0)
  })

  // covers: llms-txt#The origin still advertises the TTL the convergence window is derived from
  // THE ORIGIN CACHE POLICY THE SKEW WINDOW RESTS ON (atlas decision 0142 step 5.2).
  // `maxCompositionSkew` is 10 minutes because the origin advertises a five-minute TTL and two
  // intervals absorb a cross-key or cross-PoP refresh boundary. That five minutes lived only in a
  // comment: `validateSnapshot` judged cache headers for the SITE side alone, and
  // `fetchSnapshot` captured `origin.cacheControl` without any arm reading it.
  it('says nothing while the origin still advertises the contract TTL', async () => {
    const result = await runB2Llms({probeSuppressionImpl: visibleProbe, fetchPairImpl: coherentFetchPair, nowMs: Date.parse(OBSERVED_AT), logger: logger()})

    expect(result.catalogFindings.filter((f: {id: string}) => f.id === 'llms-origin-cache-policy')).toEqual([])
  })

  it.each([
    ['max-age', `public, max-age=86400, s-maxage=${ORIGIN_CACHE_FRESHNESS_SECONDS}`],
    ['s-maxage', `public, max-age=${ORIGIN_CACHE_FRESHNESS_SECONDS}, s-maxage=86400`],
    ['max-age and s-maxage', 'public, max-age=86400, s-maxage=86400']
  ])('warns per artifact when the origin TTL drifts on %s, without reddening the step', async (directives, cacheControl) => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        return {...pair, origin: {...pair.origin, cacheControl}}
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    const drifted = result.catalogFindings.filter((f: {id: string}) => f.id === 'llms-origin-cache-policy')
    // Once per artifact on the origin side: three origin responses, so an account-wide TTL
    // change is three findings.
    expect(drifted).toHaveLength(3)
    expect(drifted[0].severity).toBe('warn')
    expect(drifted[0].message).toContain(directives)
    expect(drifted[0].message).toContain(String(ORIGIN_CACHE_FRESHNESS_SECONDS))
    // A drifted TTL falsifies the WINDOW'S RATIONALE, not the artifact: the bytes and the stamp
    // are still correct, so nothing reds and the count is unmoved.
    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('passed')
    expect(result.measured).toBe(3)
  })

  // The site plane is REQUIRED to answer no-store, and llms-site-browser-cache-policy already
  // fails it when it does not. Applying the origin rule there would contradict that on every
  // healthy run.
  it('never applies the origin TTL rule to the site plane', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        return {...pair, site: {...pair.site, cacheControl: 'no-store'}}
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.catalogFindings.filter((f: {id: string}) => f.id === 'llms-origin-cache-policy')).toEqual([])
  })

  // An absent header is not a drifted one. `failedSnapshot` nulls the field, and the darkness is
  // already reported as a transport unknown -- inventing a policy finding would double-count it.
  it('says nothing about an origin that forwarded no Cache-Control at all', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        return {...pair, origin: {...pair.origin, cacheControl: null}}
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.catalogFindings).toEqual([])
    expect(result.exitCode).toBe(0)
  })

  // THE INDETERMINATE PROBE (atlas decision 0142 step 5.2). `suppressionDisposition` lets an
  // indeterminate focus answer PROCEED -- unlike `suppressed` and `overdue`, which stand down --
  // so the run fetches and judges normally while recording that it could not establish the
  // privacy state. Nothing covered that third branch, so the unknown it pushes could have been
  // dropped without a test noticing, and the managed issue would then have CLOSED on a run whose
  // privacy posture was unknown.
  it('measures and judges through an indeterminate suppression probe, but stays indeterminate', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: async () => ({status: 'indeterminate', reason: 'focus endpoint returned HTTP 502'}),
      fetchPairImpl: coherentFetchPair,
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    // The artifacts were reached and judged clean, so this is not darkness: measured is full.
    expect(result.measured).toBe(3)
    expect(result.catalogFindings).toEqual([])
    expect(result.coherenceFindings).toEqual([])
    // But the run cannot claim a clean privacy posture, so the fold is unknown and the CLI will
    // write `indeterminate` -- which neither opens nor closes the managed issue.
    expect(result.unknowns).toEqual([
      {id: 'llms-suppression-probe', evidence: 'suppression probe incomplete: focus endpoint returned HTTP 502'}
    ])
    expect(result.status).toBe('unknown')
    expect(managedIssueOutcome('unknown')).toBe('indeterminate')
    // A clean set of artifacts means nothing to red, so the step still exits 0.
    expect(result.exitCode).toBe(0)
  })

  it('keeps a real finding definitive under an indeterminate probe', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: async () => ({status: 'indeterminate', reason: 'focus endpoint returned HTTP 502'}),
      fetchPairImpl: async (artifact: LlmsArtifact) => {
        const pair = await coherentFetchPair(artifact)
        return artifact.id === 'llms.txt' ? {...pair, site: {...pair.site, cfCacheStatus: 'HIT'}} : pair
      },
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    // Any definitive failure wins the fold, so an unresolved probe cannot mask a true finding.
    expect(result.status).toBe('failed')
    expect(result.exitCode).toBe(1)
  })

  // covers: llms-txt#Full-content artifacts stay fresh
  it('keeps the operational presence rules live: an empty site index.md fires index-md', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) =>
        artifact.id === 'index.md'
          ? {artifact, origin: snapshot(artifact, 'origin'), site: snapshot(artifact, 'site', '   \n')}
          : coherentFetchPair(artifact),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('failed')
    expect(result.catalogFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'index-md', severity: 'fail', message: expect.stringContaining('empty body')})
    ]))
  })

  it('emits the presence id as definitive when the SITE fetch of a full artifact fails', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => ({
        artifact,
        origin: snapshot(artifact, 'origin'),
        site: artifact.id === 'llms-full.txt'
          ? {...snapshot(artifact, 'site'), status: 0, body: new Uint8Array(), error: 'TypeError: network unavailable'}
          : snapshot(artifact, 'site')
      }),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    // Site-side unreachability was a definitive failure in the retired
    // structural check's llms-full-txt probe; the merged check preserves that
    // alongside the coherence arm's transport unknown.
    expect(result.exitCode).toBe(1)
    expect(result.status).toBe('failed')
    expect(result.catalogFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-full-txt', severity: 'fail', message: expect.stringContaining('fetch failed')})
    ]))
    expect(result.unknowns).toEqual([expect.objectContaining({id: 'llms-llms-full.txt-site-transport'})])
  })
})

describe('b2-llms CLI issue-outcome channel', () => {
  // THE MEASUREMENT CHANNEL (atlas decision 0122). `measured` is what the dead-man reads, and the
  // distinction it turns on is not obvious: darkness publishes 0, while a determinate stand-down
  // and a real finding both publish a count. Get it backwards and either every focus-privacy
  // window pings /fail, or a genuinely blind lane pings a green tile.
  it('publishes measured=0 when the suppression probe throws before any verdict', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: async () => {
        throw new Error('focus endpoint unreachable')
      },
      fetchPairImpl: vi.fn(),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.measured).toBe(0)
  })

  it('publishes a full count for an overdue suppression: a finding is measured, not dark', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: async () => ({status: 'overdue', reason: 'hidden for 25h'}),
      fetchPairImpl: vi.fn(),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.exitCode).toBe(1)
    expect(result.measured).toBe(3)
  })

  it('publishes a full count for a clean run', async () => {
    const result = await runB2Llms({probeSuppressionImpl: visibleProbe, fetchPairImpl: coherentFetchPair, nowMs: Date.parse(OBSERVED_AT), logger: logger()})

    expect(result.measured).toBe(3)
  })

  it('excludes an artifact from the count when either side of its pair is dark', async () => {
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => ({
        artifact,
        origin: artifact.id === 'llms-full.txt'
          ? {...snapshot(artifact, 'origin'), status: 0, body: new Uint8Array(), error: 'TypeError: network unavailable'}
          : snapshot(artifact, 'origin'),
        site: snapshot(artifact, 'site')
      }),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.measured).toBe(2)
  })

  it('publishes measured=0 when every artifact is dark on both sides', async () => {
    const dark = 'TypeError: network unavailable'
    const result = await runB2Llms({
      probeSuppressionImpl: visibleProbe,
      fetchPairImpl: async (artifact: LlmsArtifact) => ({
        artifact,
        origin: {...snapshot(artifact, 'origin'), status: 0, body: new Uint8Array(), error: dark},
        site: {...snapshot(artifact, 'site'), status: 0, body: new Uint8Array(), error: dark}
      }),
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result.measured).toBe(0)
  })

  it('rejects any argument: the retired --evidence-out flag must not silently no-op', async () => {
    const cliLogger = logger()
    const exitCode = await runB2LlmsCli({arguments_: ['--evidence-out', 'spoke-b2.json'], environment: {}, auditRunner: vi.fn(), logger: cliLogger})

    expect(exitCode).toBe(1)
    expect(cliLogger.error).toHaveBeenCalledWith(expect.stringContaining('unknown argument: --evidence-out'))
  })

  it('writes issue_outcome=indeterminate for a suppressed run and exits 0', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-suppressed-')
    const fetchPairImpl = vi.fn()

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      auditRunner: ({nowMs, logger: auditLogger}) =>
        runB2Llms({probeSuppressionImpl: async () => ({status: 'suppressed', reason: 'focus mode active'}), fetchPairImpl, nowMs, logger: auditLogger}),
      logger: logger()
    })

    expect(exitCode).toBe(0)
    // SUPPRESSED IS MEASURED (atlas decision 0122): the probe answered and the lane stood down on
    // purpose, so the transport worked. Publishing 0 here would ping the dead-man's /fail through
    // every focus-privacy window.
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\nmeasured=3\n')
    expect(fetchPairImpl).not.toHaveBeenCalled()
  })

  it('writes issue_outcome=success for a passed run before returning the audit exit code', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-passed-')

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      auditRunner: async () => ({exitCode: 0, status: 'passed', measured: 3}),
      logger: logger()
    })

    expect(exitCode).toBe(0)
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=success\nmeasured=3\n')
  })

  it('writes issue_outcome=failure for a definitive finding independently of exit handling', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-failed-')

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      auditRunner: async () => ({exitCode: 1, status: 'failed', measured: 3}),
      logger: logger()
    })

    expect(exitCode).toBe(1)
    // A FINDING IS MEASURED. The lane held the bytes and judged them; the dead-man reports lane
    // health, not artifact health.
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=failure\nmeasured=3\n')
  })

  it('classifies an uncaught audit error as indeterminate at the CLI boundary', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-error-')

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      auditRunner: async () => {
        throw new Error('unexpected fetch orchestration failure')
      },
      logger: logger()
    })

    expect(exitCode).toBe(1)
    // A throw before any verdict is the darkest case: measured=0 so the dead-man reports the wedge
    // instead of pinging a green tile off a swallowed exit.
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\nmeasured=0\n')
  })

  // ROUTED THROUGH audits/lib/measurement.mjs (atlas decision 0142 step 5.2). That module
  // declares itself the ONE place a web audit check publishes this channel; this check used to
  // contradict it with a second private append that accepted any value at all. The visible
  // consequence of routing through `publishMeasured` is VALIDATION at the write.
  it('reds the step rather than writing a non-integer count to the dead-man channel', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-bad-count-')
    const cliLogger = logger()

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      // A runner that reached a verdict but reported a nonsense count. Before the routing this
      // wrote the literal line `measured=not-a-number`, which the tier reads as UNCLAIMED -- the
      // same shape as a step that never published at all.
      auditRunner: async () => ({exitCode: 0, status: 'passed', measured: 'not-a-number'}),
      logger: cliLogger
    })

    expect(exitCode).toBe(1)
    expect(cliLogger.error).toHaveBeenCalledWith(expect.stringContaining('measured must be a non-negative integer'))
    // The issue outcome was written first and stands; the corrupt count never reached the file.
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=success\n')
  })

  // The environment is read ONLY when the caller did not speak. `outputPath` is passed
  // explicitly, including when undefined, so a missing GITHUB_OUTPUT is a no-op here rather
  // than falling through to `process.env` and writing to a real Actions file.
  it('writes nothing, and does not read process.env, when the environment carries no GITHUB_OUTPUT', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-no-output-')
    vi.stubEnv('GITHUB_OUTPUT', githubOutputPath)

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {},
      auditRunner: async () => ({exitCode: 0, status: 'passed', measured: 3}),
      logger: logger()
    })

    expect(exitCode).toBe(0)
    await expect(readFile(githubOutputPath, 'utf8')).rejects.toThrow()
    vi.unstubAllEnvs()
  })

  it('reds the step when the issue outcome cannot be written', async () => {
    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: 'unused'},
      auditRunner: async () => ({exitCode: 0, status: 'passed'}),
      issueOutcomeWriter: async () => {
        throw new Error('disk unavailable')
      },
      logger: logger()
    })

    expect(exitCode).toBe(1)
  })
})

describe('llms issue-outcome fold', () => {
  it('any failure wins, otherwise any unknown wins, otherwise passed', () => {
    expect(llmsCheckStatus(1, 1)).toBe('failed')
    expect(llmsCheckStatus(1, 0)).toBe('failed')
    expect(llmsCheckStatus(0, 1)).toBe('unknown')
    expect(llmsCheckStatus(0, 0)).toBe('passed')
  })

  it('maps onto the managed-issue vocabulary exactly', () => {
    expect(managedIssueOutcome('passed')).toBe('success')
    expect(managedIssueOutcome('failed')).toBe('failure')
    expect(managedIssueOutcome('unknown')).toBe('indeterminate')
  })
})

describe('B2 managed-issue lifecycle', () => {
  const check = {id: 'llms', title: 'B2 llms structure + origin/site coherence'}
  const repo = 'j0nathan-ll0yd/j0nathan-ll0yd.github.io'
  const runUrl = `https://github.com/${repo}/actions/runs/567890`
  const checks = (status: 'passed' | 'failed' | 'unknown') => [
    {...check, outcome: 'success'},
    {...check, outcome: managedIssueOutcome(status)}
  ]

  it('leaves suppression and uncaught unknowns unchanged, opens/reopens findings, and closes only all-passed runs', async () => {
    const client = createDryRunClient()

    await reconcileCheckIssues({checks: checks('unknown'), repo, runUrl, client})
    expect(client.issues).toHaveLength(0)

    await reconcileCheckIssues({checks: checks('failed'), repo, runUrl, client})
    expect(client.issues[0].state).toBe('OPEN')

    await reconcileCheckIssues({checks: checks('unknown'), repo, runUrl, client})
    expect(client.issues[0].state).toBe('OPEN')

    await reconcileCheckIssues({checks: checks('passed'), repo, runUrl, client})
    expect(client.issues[0].state).toBe('CLOSED')

    await reconcileCheckIssues({checks: checks('unknown'), repo, runUrl, client})
    expect(client.issues[0].state).toBe('CLOSED')

    await reconcileCheckIssues({checks: checks('failed'), repo, runUrl, client})
    expect(client.issues[0].state).toBe('OPEN')
  })
})
