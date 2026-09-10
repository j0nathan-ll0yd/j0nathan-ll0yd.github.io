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
  detectionLatencyLine,
  evaluateLlmsCoherence,
  LLMS_COHERENCE_THRESHOLDS,
  LLMS_DETECTION_LATENCY,
  llmsCheckStatus,
  managedIssueOutcome,
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
 * A snapshot for the PURE evaluator: content-type and cache state are the
 * subjects under test, so they are supplied directly rather than derived from an
 * artifact descriptor.
 */
function pureSnapshot(body: string, contentType: string, status = 200, site = false): LlmsResponseSnapshot {
  return {
    status,
    contentType,
    body: encoder.encode(body),
    cacheControl: site ? 'no-store' : 'public, max-age=300',
    cdnCacheControl: site ? 'no-store' : null,
    cfCacheStatus: site ? 'BYPASS' : null
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
// Orchestration: the same two bodies, reached through an artifact descriptor.
// ---------------------------------------------------------------------------

function validBody(artifact: LlmsArtifact): string {
  return artifact.id === 'llms.txt' ? discoveryBody(RECENT) : fullBody(RECENT)
}

function snapshot(artifact: LlmsArtifact, side: 'origin' | 'site', body = validBody(artifact)) {
  return {
    status: 200,
    contentType: `${side === 'site' ? artifact.siteContentType : artifact.originContentType}; charset=utf-8`,
    body: new TextEncoder().encode(body),
    cacheControl: side === 'site' ? 'no-store' : 'public, max-age=300',
    cdnCacheControl: side === 'site' ? 'no-store' : null,
    cfCacheStatus: side === 'site' ? 'BYPASS' : null,
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
