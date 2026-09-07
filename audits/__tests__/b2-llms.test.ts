// audits/__tests__/b2-llms.test.ts -- orchestration and managed-issue semantics of
// the merged weekly llms check (atlas decision 0119 D2). The Atlas spoke-evidence
// envelope tests that lived in llms-spoke-evidence.test.ts died with the envelope
// (0119 D1); what survives here is the half that was never hub evidence -- the
// suppression short-circuit, transport observation, tri-state issue_outcome fold,
// and the managed-issue lifecycle it drives.

import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {LlmsArtifact} from '../../functions/_lib/llms-artifacts'
import {runB2Llms, runB2LlmsCli} from '../checks/b2-llms.mjs'
import {createDryRunClient, reconcileCheckIssues} from '../lib/file-check-issues.mjs'
import {llmsCheckStatus, managedIssueOutcome} from '../lib/llms-issue-outcome'

const OBSERVED_AT = '2026-08-29T18:00:00.000Z'

const scratchDirectories: string[] = []
const logger = () => ({log: vi.fn(), warn: vi.fn(), error: vi.fn()})

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

function validBody(artifact: LlmsArtifact): string {
  return artifact.id === 'llms.txt'
    ? '# Site\n\n> Summary\n\n<!-- composed-at: 2026-08-29T17:55:00.000Z -->\n'
    : '# Complete profile\n\n**Generated:** 2026-08-29T17:55:00.000Z\n\nsame payload\n'
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
      auditRunner: ({nowMs, logger: auditLogger}: {nowMs: number; logger: ReturnType<typeof logger>}) =>
        runB2Llms({probeSuppressionImpl: async () => ({status: 'suppressed', reason: 'focus mode active'}), fetchPairImpl, nowMs, logger: auditLogger}),
      logger: logger()
    })

    expect(exitCode).toBe(0)
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\n')
    expect(fetchPairImpl).not.toHaveBeenCalled()
  })

  it('writes issue_outcome=success for a passed run before returning the audit exit code', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-passed-')

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      auditRunner: async () => ({exitCode: 0, status: 'passed'}),
      logger: logger()
    })

    expect(exitCode).toBe(0)
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=success\n')
  })

  it('writes issue_outcome=failure for a definitive finding independently of exit handling', async () => {
    const {githubOutputPath} = await scratchPaths('b2-llms-failed-')

    const exitCode = await runB2LlmsCli({
      arguments_: [],
      environment: {GITHUB_OUTPUT: githubOutputPath},
      auditRunner: async () => ({exitCode: 1, status: 'failed'}),
      logger: logger()
    })

    expect(exitCode).toBe(1)
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=failure\n')
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
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\n')
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
