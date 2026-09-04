import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {LlmsArtifact} from '../../functions/_lib/llms-artifacts'
import {runLlmsCoherenceAudit, runLlmsCoherenceCli} from '../checks/b2-check-llms-coherence.mjs'
import {createDryRunClient, reconcileCheckIssues} from '../lib/file-check-issues.mjs'
import {b2EvidenceSourceFromEnvironment, buildB2SpokeEvidence, managedIssueOutcome} from '../lib/llms-spoke-evidence'
import {validateSpokeEvidence} from '@j0nathan-ll0yd/estate-contracts/llms-assurance'
import freshnessConfig from '@j0nathan-ll0yd/estate-contracts/llms-assurance/freshness-config.json' with {type: 'json'}

const OBSERVED_AT = '2026-08-29T18:00:00.000Z'
const REVISION = '5d9c1575686a283c34b8312201939fc45be99eb3'
const SOURCE = {
  revision: REVISION,
  workflow: '.github/workflows/audit-web.yml',
  runId: '567890',
  runAttempt: 2,
  job: 'weekly',
  runUrl: 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/actions/runs/567890'
}
const ENVIRONMENT = {
  B2_EVIDENCE_REVISION: REVISION,
  B2_EVIDENCE_WORKFLOW_REF: 'j0nathan-ll0yd/j0nathan-ll0yd.github.io/.github/workflows/audit-web.yml@refs/heads/main',
  B2_EVIDENCE_RUN_ID: '567890',
  B2_EVIDENCE_RUN_ATTEMPT: '2',
  B2_EVIDENCE_JOB: 'weekly',
  B2_EVIDENCE_RUN_URL: SOURCE.runUrl
}

const scratchDirectories: string[] = []
const logger = () => ({log: vi.fn(), warn: vi.fn(), error: vi.fn()})
const CACHE_FINDING = {
  id: 'llms-site-edge-cache-status',
  artifact: 'llms.txt' as const,
  message: 'site cache status was HIT',
  participants: [{artifact: 'llms.txt' as const, side: 'site' as const}]
}

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

function validBody(artifact: LlmsArtifact): string {
  return artifact.id === 'llms.txt'
    ? '# Site\n\n> Summary\n\n<!-- composed-at: 2026-08-29T17:55:00.000Z -->\n'
    : '# Complete profile\n\n**Generated:** 2026-08-29T17:55:00.000Z\n\nsame payload\n'
}

function snapshot(artifact: LlmsArtifact, side: 'origin' | 'site') {
  return {
    status: 200,
    contentType: `${side === 'site' ? artifact.siteContentType : artifact.originContentType}; charset=utf-8`,
    body: new TextEncoder().encode(validBody(artifact)),
    cacheControl: side === 'site' ? 'no-store' : 'public, max-age=300',
    cdnCacheControl: side === 'site' ? 'no-store' : null,
    cfCacheStatus: side === 'site' ? 'BYPASS' : null,
    age: null,
    xCache: null,
    source: null
  }
}

describe('B2 spoke evidence v1', () => {
  // covers: llms-txt#Raw and canonical llms artifacts stay coherent
  it('builds the exact passed envelope shape deterministically', () => {
    expect(buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {findings: [], unknowns: []})).toEqual({
      specVersion: 1,
      checkId: 'B2',
      status: 'passed',
      observedAt: OBSERVED_AT,
      source: {repository: 'j0nathan-ll0yd.github.io', ...SOURCE},
      summary: 'All six raw/canonical responses satisfy the B2 coherence and cache contract.',
      results: [{
        id: 'llms-coherence',
        status: 'passed',
        evidence: 'complete response set; no coherence, freshness, content-type, byte, or public-cache findings'
      }]
    })
  })

  // covers: llms-txt#Raw and canonical llms artifacts stay coherent
  //
  // The drift gate. This producer's `source.repository` is a wire token the CONSUMER owns, and
  // the two silently disagreed between 2026-08-31 and this change: Atlas renamed the expected
  // value to the repo's registry name while this file still stamped the retired
  // `web-Lifegames-Portal` alias, so every emitted B2 artifact failed ingest and B2 read as
  // unmeasured. Asserting each built envelope against the contract's OWN validator -- and the
  // token against the contract's declared B2 owner -- makes the next such rename fail in this
  // repo's CI instead of going dark in another repo's collector.
  it('emits envelopes the estate-contracts spoke-evidence validator accepts', () => {
    const envelopes = [
      buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {findings: [], unknowns: []}),
      buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {findings: [CACHE_FINDING], unknowns: []}),
      buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {findings: [], unknowns: [{id: 'llms-suppression', evidence: 'focus suppression prevented measurement'}]})
    ]
    for (const envelope of envelopes) {
      expect(validateSpokeEvidence(envelope)).toEqual([])
    }
    expect(envelopes[0].source.repository).toBe(freshnessConfig.layers.portfolioServing.owner.repository)
  })

  it('classifies complete findings as failed and clean suppression as unknown', () => {
    const failed = buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {findings: [CACHE_FINDING], unknowns: []})
    expect(failed.status).toBe('failed')
    expect(failed.results).toEqual([{id: CACHE_FINDING.id, status: 'failed', evidence: 'llms.txt: site cache status was HIT'}])

    const unknown = buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {
      findings: [],
      unknowns: [{id: 'llms-suppression', evidence: 'focus suppression prevented measurement'}]
    })
    expect(unknown.status).toBe('unknown')
    expect(unknown.results).toEqual([{id: 'llms-suppression', status: 'unknown', evidence: 'focus suppression prevented measurement'}])
    expect(unknown.results).not.toHaveLength(0)

    const incomplete = buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {
      findings: [],
      unknowns: [{id: 'llms-full.txt-origin-transport', evidence: 'origin response unavailable'}]
    })
    expect(incomplete.status).toBe('unknown')
    expect(incomplete.results).not.toHaveLength(0)
  })

  it('aggregates mixed failed and unknown results to failed with neither result discarded', () => {
    const evidence = buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {
      findings: [CACHE_FINDING],
      unknowns: [{id: 'llms-full.txt-origin-transport', evidence: 'origin response unavailable'}]
    })

    expect(evidence.status).toBe('failed')
    expect(evidence.results.map(({status}) => status)).toEqual(['failed', 'unknown'])
    expect(evidence.results).not.toHaveLength(0)
  })

  it('derives workflow provenance from immutable GitHub context without leaking extra fields', () => {
    expect(b2EvidenceSourceFromEnvironment(ENVIRONMENT)).toEqual(SOURCE)
  })
})

describe('B2 coherence evidence orchestration', () => {
  it('classifies confirmed suppression as unknown and performs no artifact fetches', async () => {
    const fetchPairImpl = vi.fn()
    const result = await runLlmsCoherenceAudit({
      probeSuppressionImpl: async () => ({status: 'suppressed', reason: 'focus mode active'}),
      fetchPairImpl,
      nowMs: Date.parse(OBSERVED_AT),
      logger: logger()
    })

    expect(result).toEqual({
      exitCode: 0,
      evidenceOutcome: {findings: [], unknowns: [{id: 'llms-suppression', evidence: 'focus suppression prevented measurement: focus mode active'}]}
    })
    expect(fetchPairImpl).not.toHaveBeenCalled()
  })

  it('writes an uploadable unknown envelope when suppression is confirmed', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'b2-spoke-evidence-suppressed-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'artifacts', 'llms-assurance', 'spoke-b2.json')
    const githubOutputPath = join(scratch, 'github-output')
    const fetchPairImpl = vi.fn()

    const exitCode = await runLlmsCoherenceCli({
      arguments_: ['--evidence-out', outputPath],
      environment: {...ENVIRONMENT, GITHUB_OUTPUT: githubOutputPath},
      now: () => new Date(OBSERVED_AT),
      auditRunner: ({nowMs, logger: auditLogger}: {nowMs: number; logger: ReturnType<typeof logger>}) =>
        runLlmsCoherenceAudit({
          probeSuppressionImpl: async () => ({status: 'suppressed', reason: 'focus mode active'}),
          fetchPairImpl,
          nowMs,
          logger: auditLogger
        }),
      logger: logger()
    })

    const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(exitCode).toBe(0)
    expect(evidence.status).toBe('unknown')
    expect(evidence.results).toEqual([
      {id: 'llms-suppression', status: 'unknown', evidence: 'focus suppression prevented measurement: focus mode active'}
    ])
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\n')
    expect(fetchPairImpl).not.toHaveBeenCalled()
  })

  it('preserves an independent true finding alongside incomplete transport', async () => {
    const result = await runLlmsCoherenceAudit({
      probeSuppressionImpl: async () => ({status: 'visible', reason: 'focus mode is not hiding public data'}),
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
    expect(result.evidenceOutcome.findings).toEqual([
      expect.objectContaining({id: 'llms-site-edge-cache-status', artifact: 'llms.txt'})
    ])
    expect(result.evidenceOutcome.unknowns).toEqual([
      expect.objectContaining({id: 'llms-llms-full.txt-origin-transport', evidence: expect.stringContaining('network unavailable')})
    ])
    const evidence = buildB2SpokeEvidence(OBSERVED_AT, SOURCE, result.evidenceOutcome)
    expect(evidence.status).toBe('failed')
    expect(evidence.results.map(({status}) => status)).toEqual(['failed', 'unknown'])
  })

  it('writes passed evidence before returning the audit exit code', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'b2-spoke-evidence-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'nested', 'spoke-b2.json')
    const githubOutputPath = join(scratch, 'github-output')

    const exitCode = await runLlmsCoherenceCli({
      arguments_: ['--evidence-out', outputPath],
      environment: {...ENVIRONMENT, GITHUB_OUTPUT: githubOutputPath},
      now: () => new Date(OBSERVED_AT),
      auditRunner: async () => ({exitCode: 0, evidenceOutcome: {findings: [], unknowns: []}}),
      logger: logger()
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(buildB2SpokeEvidence(OBSERVED_AT, SOURCE, {findings: [], unknowns: []}))
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=success\n')
  })

  it('writes failure issue output for a definitive finding independently of exit handling', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'b2-spoke-evidence-failed-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'spoke-b2.json')
    const githubOutputPath = join(scratch, 'github-output')

    const exitCode = await runLlmsCoherenceCli({
      arguments_: ['--evidence-out', outputPath],
      environment: {...ENVIRONMENT, GITHUB_OUTPUT: githubOutputPath},
      now: () => new Date(OBSERVED_AT),
      auditRunner: async () => ({exitCode: 1, evidenceOutcome: {findings: [CACHE_FINDING], unknowns: []}}),
      logger: logger()
    })

    expect(exitCode).toBe(1)
    expect(JSON.parse(await readFile(outputPath, 'utf8')).status).toBe('failed')
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=failure\n')
  })

  it('does not publish an issue outcome when evidence writing fails', async () => {
    const githubOutputWriter = vi.fn()
    const exitCode = await runLlmsCoherenceCli({
      arguments_: ['--evidence-out', 'unused.json'],
      environment: ENVIRONMENT,
      now: () => new Date(OBSERVED_AT),
      auditRunner: async () => ({exitCode: 0, evidenceOutcome: {findings: [], unknowns: []}}),
      evidenceWriter: async () => {
        throw new Error('disk unavailable')
      },
      githubOutputWriter,
      logger: logger()
    })

    expect(exitCode).toBe(1)
    expect(githubOutputWriter).not.toHaveBeenCalled()
  })

  it('writes unknown evidence when an uncaught audit error reaches the CLI boundary', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'b2-spoke-evidence-error-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'spoke-b2.json')
    const githubOutputPath = join(scratch, 'github-output')

    const exitCode = await runLlmsCoherenceCli({
      arguments_: [`--evidence-out=${outputPath}`],
      environment: {...ENVIRONMENT, GITHUB_OUTPUT: githubOutputPath},
      now: () => new Date(OBSERVED_AT),
      auditRunner: async () => {
        throw new Error('unexpected fetch orchestration failure')
      },
      logger: logger()
    })

    const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(exitCode).toBe(1)
    expect(evidence.status).toBe('unknown')
    expect(evidence.results[0].evidence).toContain('unexpected fetch orchestration failure')
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\n')
  })
})

describe('B2 managed-issue lifecycle', () => {
  const check = {id: 'llms-coherence', title: 'B2 llms origin/site coherence'}
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
