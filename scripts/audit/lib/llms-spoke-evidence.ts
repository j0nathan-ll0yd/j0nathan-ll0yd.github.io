import {mkdir, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import type {LlmsCoherenceFinding} from './llms-coherence'

export type SpokeEvidenceStatus = 'passed' | 'failed' | 'unknown'

export interface B2EvidenceSourceInput {
  revision: string
  workflow: string
  runId: string
  runAttempt: number
  job: string
  runUrl?: string
}

export interface B2EvidenceUnknown {
  id: string
  evidence: string
}

export interface B2EvidenceOutcome {
  findings: readonly LlmsCoherenceFinding[]
  unknowns: readonly B2EvidenceUnknown[]
}

export interface B2SpokeEvidence {
  specVersion: 1
  checkId: 'B2'
  status: SpokeEvidenceStatus
  observedAt: string
  source: {repository: 'web-Lifegames-Portal'; revision: string; workflow: string; runId: string; runAttempt: number; job: string; runUrl?: string}
  summary: string
  results: Array<{id: string; status: SpokeEvidenceStatus; evidence: string}>
}

const SHA_RE = /^[0-9a-f]{40}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function nonempty(value: string, field: string): string {
  if (value.trim() === '') {
    throw new TypeError(`${field} must be non-empty`)
  }
  return value
}

function checkedSource(input: B2EvidenceSourceInput): B2SpokeEvidence['source'] {
  if (!SHA_RE.test(input.revision)) {
    throw new TypeError('source.revision must be a 40-character lowercase git SHA')
  }
  if (!Number.isInteger(input.runAttempt) || input.runAttempt < 1) {
    throw new TypeError('source.runAttempt must be a positive integer')
  }

  const source: B2SpokeEvidence['source'] = {
    repository: 'web-Lifegames-Portal',
    revision: input.revision,
    workflow: nonempty(input.workflow, 'source.workflow'),
    runId: nonempty(input.runId, 'source.runId'),
    runAttempt: input.runAttempt,
    job: nonempty(input.job, 'source.job')
  }
  if (input.runUrl !== undefined) {
    try {
      new URL(input.runUrl)
    } catch {
      throw new TypeError('source.runUrl must be an absolute URL')
    }
    source.runUrl = input.runUrl
  }
  return source
}

function workflowPath(workflowRef: string): string {
  const withoutRevision = workflowRef.slice(0, workflowRef.lastIndexOf('@') >= 0 ? workflowRef.lastIndexOf('@') : workflowRef.length)
  const marker = '/.github/workflows/'
  const markerIndex = withoutRevision.indexOf(marker)
  return markerIndex >= 0 ? withoutRevision.slice(markerIndex + 1) : withoutRevision
}

/** Build Atlas B2 source fields from explicitly transported immutable GitHub context. */
export function b2EvidenceSourceFromEnvironment(environment: Record<string, string | undefined>): B2EvidenceSourceInput {
  return {
    revision: nonempty(environment.B2_EVIDENCE_REVISION ?? '', 'B2_EVIDENCE_REVISION'),
    workflow: nonempty(workflowPath(environment.B2_EVIDENCE_WORKFLOW_REF ?? ''), 'B2_EVIDENCE_WORKFLOW_REF'),
    runId: nonempty(environment.B2_EVIDENCE_RUN_ID ?? '', 'B2_EVIDENCE_RUN_ID'),
    runAttempt: Number(environment.B2_EVIDENCE_RUN_ATTEMPT),
    job: nonempty(environment.B2_EVIDENCE_JOB ?? '', 'B2_EVIDENCE_JOB'),
    ...(environment.B2_EVIDENCE_RUN_URL ? {runUrl: environment.B2_EVIDENCE_RUN_URL} : {})
  }
}

/** Pure, deterministic Atlas spoke-evidence v1 envelope builder for weekly B2. */
export function buildB2SpokeEvidence(observedAt: string, sourceInput: B2EvidenceSourceInput, outcome: B2EvidenceOutcome): B2SpokeEvidence {
  if (!DATE_TIME_RE.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError('observedAt must be an ISO date-time')
  }

  const results: B2SpokeEvidence['results'] = [
    ...outcome.findings.map((finding) => ({id: finding.id, status: 'failed' as const, evidence: `${finding.artifact}: ${finding.message}`})),
    ...outcome.unknowns.map((unknown) => ({
      id: nonempty(unknown.id, 'unknown result id'),
      status: 'unknown' as const,
      evidence: nonempty(unknown.evidence, 'unknown result evidence')
    }))
  ]
  if (results.length === 0) {
    results.push({
      id: 'llms-coherence',
      status: 'passed',
      evidence: 'complete response set; no coherence, freshness, content-type, byte, or public-cache findings'
    })
  }

  const status: SpokeEvidenceStatus = results.some((result) => result.status === 'failed')
    ? 'failed'
    : results.some((result) => result.status === 'unknown')
    ? 'unknown'
    : 'passed'
  const summary = status === 'failed'
    ? `${outcome.findings.length} llms coherence/cache contract finding(s) and ${outcome.unknowns.length} observation gap(s) recorded.`
    : status === 'unknown'
    ? `The weekly B2 llms coherence run recorded ${outcome.unknowns.length} observation gap(s) and no definitive failure.`
    : 'All six raw/canonical responses satisfy the B2 coherence and cache contract.'

  return {specVersion: 1, checkId: 'B2', status, observedAt, source: checkedSource(sourceInput), summary, results}
}

export async function writeB2SpokeEvidence(outputPath: string, evidence: B2SpokeEvidence): Promise<void> {
  await mkdir(dirname(outputPath), {recursive: true})
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}
