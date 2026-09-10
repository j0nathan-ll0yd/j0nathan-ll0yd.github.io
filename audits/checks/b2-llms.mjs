#!/usr/bin/env -S pnpm exec tsx
// audits/checks/b2-llms.mjs -- B2. The one llms content-plane check (atlas decision
// 0119 D2), replacing b2-validate-llms-txt.mjs + b2-check-llms-coherence.mjs:
//
//   STRUCTURE arm: the hand-rolled llmstxt.org structural validator over the served
//   llms.txt (no official validator exists -- verified against llmstxt.org directly,
//   2026-07-16 session), plus site-side presence/non-emptiness for llms-full.txt and
//   index.md (CloudFront-only artifacts with no formal spec of their own). All
//   catalog-governed: the spec each finding id derives from lives in
//   specs/llms-txt/*.rule.json, not in this comment (decisions/0011) -- see that
//   directory for which ids are genuine spec convention vs this repo's own
//   operational handling.
//
//   COHERENCE arm: the six origin/site fetches evaluated by evaluateLlmsCoherence
//   below -- status, content-type, composition freshness (contract thresholds),
//   origin/site and full/index skew, conditional byte-equality, and canonical cache
//   state. Findings keep the llms-{side}-* vocabulary.
//
//   MANAGED-ISSUE arm: the tri-state issue_outcome and the measured count, both
//   written to GITHUB_OUTPUT below.
//
// ONE FILE, NO HELPER LIBS (atlas decision 0122 phase 4, executed by 0128). Both
// arms used to sit in audits/lib/llms-coherence.ts (285 lines) and
// audits/lib/llms-issue-outcome.ts (62 lines), each with exactly one caller: this
// file. A module boundary with one consumer on each side hides nothing and costs a
// reader two extra files to hold the check in their head, so the boundary is gone
// and the code is unchanged across it. Every finding id, severity, message string,
// exit code and GITHUB_OUTPUT field is what it was before the fold.
//
// The retired Atlas spoke-evidence envelope is NOT emitted (0119 D1 -- lane
// liveness is decision 0116's job now). The managed-issue reconciler consumes the
// tri-state issue_outcome this check writes to GITHUB_OUTPUT, never the step
// outcome.

import {createHash} from 'node:crypto'
import {appendFile} from 'node:fs/promises'
import {durationToMilliseconds, LLM_FRESHNESS_CONFIG} from '@j0nathan-ll0yd/estate-contracts/llms-assurance'
import {checkLlmsStructure} from '@j0nathan-ll0yd/estate-contracts/llms-structure'
import {LLMS_ARTIFACTS} from '../../functions/_lib/llms-artifacts.ts'
import {fetchStable, isMain} from '../lib/http.mjs'
import {probeSuppression, suppressionDisposition} from '../lib/suppression.mjs'
import {emit, rules} from '../specs/load.mjs'

const R = rules('llms-txt')

/**
 * One side of one artifact, as this run observed it.
 * @typedef {{
 *   status: number,
 *   contentType: string | null,
 *   body: Uint8Array,
 *   cacheControl: string | null,
 *   cdnCacheControl: string | null,
 *   cfCacheStatus: string | null,
 *   error?: string
 * }} LlmsResponseSnapshot
 */
/** @typedef {{origin: LlmsResponseSnapshot, site: LlmsResponseSnapshot}} LlmsResponsePair */
/** @typedef {import('../../functions/_lib/llms-artifacts.ts').LlmsArtifactId} LlmsArtifactId */
/** @typedef {Record<LlmsArtifactId, LlmsResponsePair>} LlmsCoherenceInput */
/** @typedef {{maxCompositionAgeMs: number, maxCompositionSkewMs: number, maxFutureSkewMs: number}} LlmsCoherenceThresholds */
/** @typedef {{artifact: LlmsArtifactId, side: 'origin' | 'site'}} LlmsCoherenceParticipant */
/**
 * @typedef {{
 *   id: string,
 *   artifact: LlmsArtifactId | 'llms-full.txt/index.md',
 *   message: string,
 *   participants: readonly LlmsCoherenceParticipant[]
 * }} LlmsCoherenceFinding
 */
/** @typedef {'passed' | 'failed' | 'unknown'} LlmsCheckStatus */
/** @typedef {'success' | 'failure' | 'indeterminate'} ManagedIssueOutcome */

/**
 * Validate llms.txt structure against the llmstxt.org convention.
 * Pure function (string in, findings out) so it's testable without network.
 *
 * The five structural rules live in
 * @j0nathan-ll0yd/estate-contracts/llms-structure, the shared reference atlas
 * owns and publishes. The backend producer consumes the same package at the
 * same exact pin, so neither side holds a copy to drift. This function is the
 * CATALOG WRAPPER over it: the
 * reference decides WHAT is wrong, the rule files decide how bad it is.
 * emit() stamps severity from the rule and throws on an id no rule file
 * declares, so surjectivity survives the extraction unchanged.
 */
export function validateLlmsTxt(rawText) {
  return checkLlmsStructure(rawText).map((finding) => emit(R, finding.id, finding.message))
}

/**
 * Freshness/skew authority: the packaged estate contract, read in the AUDIT layer
 * only so the Pages Functions runtime bundle stays free of the package (atlas
 * decision 0119 D2). The contract owns `maxCompositionAge` (4 hours: the composer
 * runs on a 30-minute EventBridge rate plus an event trigger, bounding missed
 * compositions and the three-hour last-known-good origin fallback) and
 * `maxCompositionSkew` (10 minutes: CloudFront advertises a five-minute origin
 * TTL; two intervals tolerate a cross-key or cross-PoP refresh boundary while
 * still detecting a longer hold).
 */
const {coherencePolicy} = LLM_FRESHNESS_CONFIG.layers.portfolioServing

/** @type {Readonly<LlmsCoherenceThresholds>} */
export const LLMS_COHERENCE_THRESHOLDS = Object.freeze({
  maxCompositionAgeMs: durationToMilliseconds(coherencePolicy.maxCompositionAge),
  maxCompositionSkewMs: durationToMilliseconds(coherencePolicy.maxCompositionSkew),
  maxFutureSkewMs: durationToMilliseconds(coherencePolicy.maxFutureSkew)
})

/**
 * Worst-case detection latency for the PUBLIC path (atlas decision 0128 P4).
 *
 * The contract already declares both halves; what no artifact stated was their
 * consequence. A violation has to exist before a sample can see it, and this lane
 * samples on `portfolioServing.auditCadence`, so the longest a persistent
 * violation can stand while every check reports green is the threshold PLUS the
 * sampling interval. Stating the interval the check actually provides is the
 * point: the age threshold on its own establishes no detection guarantee.
 *
 * DERIVED, NEVER AUTHORED. Both fields are read off the same pinned contract the
 * thresholds come from, so a cadence or threshold change moves this figure with
 * no edit here. A second local copy of either number is the defect this replaces.
 *
 * @type {Readonly<{thresholdMs: number, auditCadenceMs: number, worstCaseMs: number}>}
 */
export const LLMS_DETECTION_LATENCY = (() => {
  const thresholdMs = durationToMilliseconds(coherencePolicy.maxCompositionAge)
  const auditCadenceMs = durationToMilliseconds(LLM_FRESHNESS_CONFIG.layers.portfolioServing.auditCadence)
  return Object.freeze({thresholdMs, auditCadenceMs, worstCaseMs: thresholdMs + auditCadenceMs})
})()

const decoder = new TextDecoder('utf-8', {fatal: true})
const COMPOSITION_PATTERNS = [
  /<!--\s*composed-at:\s*([^\s]+)\s*-->/i,
  /\*\*Generated:\*\*\s*([^\s]+)/i
]

function mediaType(contentType) {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() || null
}

function hasNoStore(value) {
  return value?.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store') ?? false
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function durationMinutes(milliseconds) {
  return (milliseconds / 60_000).toFixed(1)
}

function durationHours(milliseconds) {
  return (milliseconds / 3_600_000).toFixed(1)
}

/** The one line the check prints about the interval it provides (atlas decision 0128 P4). */
export function detectionLatencyLine(latency = LLMS_DETECTION_LATENCY) {
  return `  detection: worst-case public-path latency is ${durationHours(latency.worstCaseMs)}h ` +
    `= composition-age threshold ${durationHours(latency.thresholdMs)}h + audit cadence ${durationHours(latency.auditCadenceMs)}h; ` +
    'a persistent violation can stand that long with every check green.'
}

/**
 * @param {LlmsCoherenceFinding[]} findings
 * @param {string} id
 * @param {LlmsCoherenceFinding['artifact']} artifact
 * @param {string} relationship
 * @param {number | null} leftComposedAt
 * @param {number | null} rightComposedAt
 * @param {readonly LlmsCoherenceParticipant[]} participants
 * @param {LlmsCoherenceThresholds} thresholds
 */
function validateCompositionSkew(findings, id, artifact, relationship, leftComposedAt, rightComposedAt, participants, thresholds) {
  if (leftComposedAt === null || rightComposedAt === null) {
    return
  }

  const skewMs = Math.abs(leftComposedAt - rightComposedAt)
  if (skewMs > thresholds.maxCompositionSkewMs) {
    findings.push({
      id,
      artifact,
      message: `${relationship} composition skew is ${durationMinutes(skewMs)}m; maximum is ${durationMinutes(thresholds.maxCompositionSkewMs)}m`,
      participants
    })
  }
}

function representsSameComposition(leftComposedAt, rightComposedAt) {
  return leftComposedAt !== null && leftComposedAt === rightComposedAt
}

/**
 * Read the composer's own timestamp out of a published body.
 * @param {Uint8Array} body
 * @returns {number | null}
 */
export function compositionTimestamp(body) {
  let text
  try {
    text = decoder.decode(body)
  } catch {
    return null
  }

  for (const pattern of COMPOSITION_PATTERNS) {
    const raw = pattern.exec(text)?.[1]
    if (!raw) {
      continue
    }
    const value = Date.parse(raw)
    return Number.isFinite(value) ? value : null
  }
  return null
}

/**
 * @param {LlmsCoherenceFinding[]} findings
 * @param {(typeof LLMS_ARTIFACTS)[number]} artifact
 * @param {'origin' | 'site'} side
 * @param {LlmsResponseSnapshot} snapshot
 * @param {string} expectedContentType
 * @param {number} nowMs
 * @param {LlmsCoherenceThresholds} thresholds
 * @returns {number | null}
 */
function validateSnapshot(findings, artifact, side, snapshot, expectedContentType, nowMs, thresholds) {
  const participants = [{artifact: artifact.id, side}]
  if (snapshot.status !== 200) {
    const detail = snapshot.error ? ` (${snapshot.error})` : ''
    findings.push({
      id: `llms-${side}-status`,
      artifact: artifact.id,
      message: `${side} returned HTTP ${snapshot.status}${detail}; expected 200`,
      participants
    })
  }

  const actualContentType = mediaType(snapshot.contentType)
  if (actualContentType !== expectedContentType) {
    findings.push({
      id: `llms-${side}-content-type`,
      artifact: artifact.id,
      message: `${side} content-type is ${JSON.stringify(snapshot.contentType)}; expected ${expectedContentType}`,
      participants
    })
  }

  if (side === 'site') {
    if (!hasNoStore(snapshot.cacheControl)) {
      findings.push({
        id: 'llms-site-browser-cache-policy',
        artifact: artifact.id,
        message: `site Cache-Control is ${JSON.stringify(snapshot.cacheControl)}; expected no-store`,
        participants
      })
    }
    if (!hasNoStore(snapshot.cdnCacheControl)) {
      findings.push({
        id: 'llms-site-cdn-cache-policy',
        artifact: artifact.id,
        message: `site CDN-Cache-Control is ${JSON.stringify(snapshot.cdnCacheControl)}; expected no-store`,
        participants
      })
    }
    const edgeStatus = snapshot.cfCacheStatus?.toUpperCase() || null
    if (edgeStatus !== 'BYPASS' && edgeStatus !== 'DYNAMIC') {
      findings.push({
        id: 'llms-site-edge-cache-status',
        artifact: artifact.id,
        message: `site CF-Cache-Status is ${JSON.stringify(snapshot.cfCacheStatus)}; expected BYPASS or DYNAMIC`,
        participants
      })
    }
  }

  const composedAt = compositionTimestamp(snapshot.body)
  if (composedAt === null) {
    findings.push({
      id: `llms-${side}-composition-time`,
      artifact: artifact.id,
      message: `${side} body has no parseable composed-at/Generated timestamp`,
      participants
    })
    return null
  }

  const ageMs = nowMs - composedAt
  if (ageMs > thresholds.maxCompositionAgeMs) {
    findings.push({
      id: `llms-${side}-stale`,
      artifact: artifact.id,
      message: `${side} composition is ${durationMinutes(ageMs)}m old; maximum is ${durationMinutes(thresholds.maxCompositionAgeMs)}m`,
      participants
    })
  } else if (ageMs < -thresholds.maxFutureSkewMs) {
    findings.push({
      id: `llms-${side}-composition-future`,
      artifact: artifact.id,
      message: `${side} composition is ${durationMinutes(-ageMs)}m in the future; allowance is ${durationMinutes(thresholds.maxFutureSkewMs)}m`,
      participants
    })
  }

  return composedAt
}

/**
 * Pure comparison of already-fetched CloudFront and portfolio representations.
 * The caller owns network retries and evidence collection; this function owns
 * only deterministic contract evaluation.
 *
 * @param {LlmsCoherenceInput} input
 * @param {number} nowMs
 * @param {LlmsCoherenceThresholds} [thresholds]
 * @returns {LlmsCoherenceFinding[]}
 */
export function evaluateLlmsCoherence(input, nowMs, thresholds = LLMS_COHERENCE_THRESHOLDS) {
  /** @type {LlmsCoherenceFinding[]} */
  const findings = []
  const compositionTimes = {'llms.txt': {origin: null, site: null}, 'llms-full.txt': {origin: null, site: null}, 'index.md': {origin: null, site: null}}

  for (const artifact of LLMS_ARTIFACTS) {
    const pair = input[artifact.id]
    const originComposedAt = validateSnapshot(findings, artifact, 'origin', pair.origin, artifact.originContentType, nowMs, thresholds)
    const siteComposedAt = validateSnapshot(findings, artifact, 'site', pair.site, artifact.siteContentType, nowMs, thresholds)
    compositionTimes[artifact.id] = {origin: originComposedAt, site: siteComposedAt}
    validateCompositionSkew(findings, 'llms-origin-site-skew', artifact.id, 'origin/site', originComposedAt, siteComposedAt, [
      {artifact: artifact.id, side: 'origin'},
      {artifact: artifact.id, side: 'site'}
    ], thresholds)
  }

  for (const artifactId of ['llms-full.txt', 'index.md']) {
    const pair = input[artifactId]
    const times = compositionTimes[artifactId]
    if (representsSameComposition(times.origin, times.site) && !sameBytes(pair.origin.body, pair.site.body)) {
      findings.push({
        id: 'llms-origin-site-bytes',
        artifact: artifactId,
        message: `origin and site advertise the same composition but bytes differ (${pair.origin.body.byteLength} vs ${pair.site.body.byteLength} bytes)`,
        participants: [{artifact: artifactId, side: 'origin'}, {artifact: artifactId, side: 'site'}]
      })
    }
  }

  const full = input['llms-full.txt']
  const index = input['index.md']
  const fullTimes = compositionTimes['llms-full.txt']
  const indexTimes = compositionTimes['index.md']
  for (const side of ['origin', 'site']) {
    const participants = [{artifact: 'llms-full.txt', side}, {artifact: 'index.md', side}]
    validateCompositionSkew(findings, 'llms-full-index-skew', 'llms-full.txt/index.md', `${side} llms-full.txt/index.md`, fullTimes[side], indexTimes[side],
      participants, thresholds)
    if (representsSameComposition(fullTimes[side], indexTimes[side]) && !sameBytes(full[side].body, index[side].body)) {
      findings.push({
        id: 'llms-full-index-bytes',
        artifact: 'llms-full.txt/index.md',
        message: `${side} llms-full.txt and index.md advertise the same composition but are not byte-identical`,
        participants
      })
    }
  }

  return findings
}

/**
 * Fold definitive failures and observation gaps into the check's tri-state
 * status: any failure wins, otherwise any observation gap wins, otherwise passed.
 *
 * @param {number} failureCount
 * @param {number} unknownCount
 * @returns {LlmsCheckStatus}
 */
export function llmsCheckStatus(failureCount, unknownCount) {
  if (failureCount > 0) {
    return 'failed'
  }
  return unknownCount > 0 ? 'unknown' : 'passed'
}

/**
 * Map check status to the existing managed-issue reconciler vocabulary.
 *
 * The workflow reconciler consumes `steps.llms.outputs.issue_outcome`, never the
 * step outcome: a report-only step's process outcome cannot distinguish "measured
 * and failed" from "could not measure", and a missing output is deliberately
 * indeterminate.
 *
 * @param {LlmsCheckStatus} status
 * @returns {ManagedIssueOutcome}
 */
export function managedIssueOutcome(status) {
  if (status === 'passed') {
    return 'success'
  }
  if (status === 'failed') {
    return 'failure'
  }
  return 'indeterminate'
}

// Stryker disable all -- everything below is network-path orchestration over live
// HTTP responses with no mutation-gate coverage; Stryker targets only the pure
// validators, the coherence evaluator and the tri-state fold above
// (decisions/0011, UD1: the mutation gate scopes to the pure pilot validators).

/** Append `issue_outcome=` to GITHUB_OUTPUT so the reconciler reads the measured tri-state. */
async function writeIssueOutcome(outputPath, status) {
  if (!outputPath) {
    return
  }
  await appendFile(outputPath, `issue_outcome=${managedIssueOutcome(status)}\n`, 'utf8')
}

/**
 * Append `measured=` to GITHUB_OUTPUT -- the dead-man's-switch channel.
 *
 * SEPARATE FROM `issue_outcome` ON PURPOSE, because the two answer different questions.
 * `issue_outcome` asks "was the artifact healthy" and drives managed-issue lifecycle.
 * `measured` asks "did the transport work at all", and it is the only one the dead-man reads:
 * a lane that ran, reached nothing, and exited cleanly is byte-identical to a healthy one without
 * it (atlas decisions 0083, 0107, 0122).
 *
 * BOTH HALVES SHIP TOGETHER. Publishing this count without the `measured=0` rung in
 * `audits/healthchecks-ping.sh` changes nothing, and adding the rung without this count makes the
 * field empty -- which the script treats as "not claimed", never as a pass.
 */
async function writeMeasurement(outputPath, measured) {
  if (!outputPath) {
    return
  }
  await appendFile(outputPath, `measured=${measured}\n`, 'utf8')
}

function failedSnapshot(error) {
  return {
    status: 0,
    contentType: null,
    body: new Uint8Array(),
    cacheControl: null,
    cdnCacheControl: null,
    cfCacheStatus: null,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    age: null,
    xCache: null,
    source: null
  }
}

async function fetchSnapshot(url) {
  try {
    const response = await fetchStable(url)
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: new Uint8Array(await response.arrayBuffer()),
      cacheControl: response.headers.get('cache-control'),
      cdnCacheControl: response.headers.get('cdn-cache-control'),
      cfCacheStatus: response.headers.get('cf-cache-status'),
      age: response.headers.get('age'),
      xCache: response.headers.get('x-cache'),
      source: response.headers.get('x-source')
    }
  } catch (error) {
    return failedSnapshot(error)
  }
}

async function fetchPair(artifact) {
  const settled = await Promise.allSettled([
    fetchSnapshot(artifact.originUrl),
    fetchSnapshot(artifact.siteUrl)
  ])
  const value = (result) => result.status === 'fulfilled' ? result.value : failedSnapshot(result.reason)
  return {artifact, origin: value(settled[0]), site: value(settled[1])}
}

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function timestampLabel(body) {
  const value = compositionTimestamp(body)
  return value === null ? 'missing' : new Date(value).toISOString()
}

function printSnapshot(side, snapshot, logger) {
  logger.log(
    `  ${side}: status=${snapshot.status} type=${JSON.stringify(snapshot.contentType)} ` +
      `composed=${timestampLabel(snapshot.body)} bytes=${snapshot.body.byteLength} sha256=${sha256(snapshot.body)} ` +
      `cache-control=${JSON.stringify(snapshot.cacheControl)} cdn-cache-control=${JSON.stringify(snapshot.cdnCacheControl)} ` +
      `cf-cache-status=${JSON.stringify(snapshot.cfCacheStatus)} age=${JSON.stringify(snapshot.age)} ` +
      `x-cache=${JSON.stringify(snapshot.xCache)} x-source=${JSON.stringify(snapshot.source)}`
  )
  if (snapshot.error) {
    logger.log(`    error=${snapshot.error}`)
  }
}

function annotationValue(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function responseKey(artifact, side) {
  return `${artifact}.${side}`
}

function transportObservation(pairs) {
  const incomplete = new Set()
  const unknowns = []
  for (const {artifact, origin, site} of pairs) {
    for (const [side, snapshot] of [['origin', origin], ['site', site]]) {
      if (snapshot.error) {
        incomplete.add(responseKey(artifact.id, side))
        unknowns.push({id: `llms-${artifact.id}-${side}-transport`, evidence: `${artifact.id}.${side} response unavailable: ${snapshot.error}`})
      }
    }
  }
  return {incomplete, unknowns}
}

/**
 * An early return where the lane reached NO verdict about any artifact.
 *
 * `measured: 0` is the dead-man's-switch channel (atlas decisions 0083, 0107, 0122): it counts the
 * artifacts this run held bytes for and judged. Zero means the lane executed and measured nothing,
 * which `audits/healthchecks-ping.sh` pings `/fail` on. Reserve this for genuine darkness — see
 * `standDown` for the case that looks similar and is not.
 */
function unmeasured(exitCode, id, evidence) {
  return {exitCode, status: 'unknown', measured: 0, catalogFindings: [], coherenceFindings: [], unknowns: [{id, evidence}]}
}

/**
 * An early return where the lane reached a DETERMINATE verdict and declined to fetch.
 *
 * SUPPRESSED COUNTS AS MEASURED, and that is not an oversight — the same rule
 * mantle-LifegamesPortal states at `audits/lib/served-artifact-check.mts:181-186`. The suppression
 * probe answered, the lane stood down on purpose, and the transport worked. Counting it as
 * unmeasured would ping `/fail` through every focus-privacy window, turning intentional privacy
 * into a wedge alert. An OVERDUE suppression is a finding, and a finding is measured too.
 */
function standDown(exitCode, id, evidence) {
  return {exitCode, status: 'unknown', measured: LLMS_ARTIFACTS.length, catalogFindings: [], coherenceFindings: [], unknowns: [{id, evidence}]}
}

// Lossy UTF-8 decode, mirroring Response.text() -- structural validation should
// see the same string a text() consumer would, and the strict-UTF-8 question is
// the coherence arm's (compositionTimestamp decodes fatally there).
const lossyDecoder = new TextDecoder()

/** The catalog ids for the two full-content artifacts' operational presence rules. */
const PRESENCE_IDS = Object.freeze({'llms-full.txt': 'llms-full-txt', 'index.md': 'index-md'})

function siteFailure(pair) {
  const {artifact, site} = pair
  if (site.error) {
    return `fetch failed: ${site.error}`
  }
  if (site.status < 200 || site.status >= 300) {
    return `HTTP ${site.status} fetching ${artifact.siteUrl}`
  }
  return null
}

/** Structure arm: the served llms.txt body through the catalog wrapper; transport failure emits the operational llms-txt-fetch rule. */
function structureFindings(pair) {
  const failure = siteFailure(pair)
  if (failure !== null) {
    return [emit(R, 'llms-txt-fetch', failure)]
  }
  return validateLlmsTxt(lossyDecoder.decode(pair.site.body))
}

/** Presence arm: site-side existence/non-emptiness for an artifact with no formal spec of its own. */
function presenceFindings(pair) {
  const id = PRESENCE_IDS[pair.artifact.id]
  const failure = siteFailure(pair)
  if (failure !== null) {
    return [emit(R, id, failure)]
  }
  if (lossyDecoder.decode(pair.site.body).trim().length === 0) {
    return [emit(R, id, `${pair.artifact.siteUrl} returned an empty body`)]
  }
  return []
}

/**
 * Run both arms over one set of live responses. Returns the exit code, the
 * tri-state managed-issue status, and the raw material behind both.
 *
 * Exit/status semantics preserve both retired checks: a fail-severity catalog
 * finding or any coherence finding reds the step (exit 1); warn-severity catalog
 * findings never fail alone (status passed, exit 0). The tri-state fold EXCLUDES
 * coherence findings whose every participant response is transport-incomplete --
 * they restate the transport gap, which is already an unknown -- exactly as the
 * retired spoke-evidence outcome did, so "could not measure" stays indeterminate
 * to the reconciler while site-side presence failures stay definitive.
 */
/**
 * The three console methods the check actually uses -- typed structurally so a
 * test can hand in a minimal mock instead of a full Console.
 * @typedef {{log: (...args: unknown[]) => void, warn: (...args: unknown[]) => void, error: (...args: unknown[]) => void}} LlmsAuditLogger
 */
/**
 * What the CLI wrapper depends on from the audit run: the exit code and the
 * tri-state status, nothing else.
 * @typedef {(options: {nowMs: number, logger: LlmsAuditLogger}) => Promise<{exitCode: number, status: string}>} LlmsAuditRunner
 */

export async function runB2Llms({
  probeSuppressionImpl = probeSuppression,
  fetchPairImpl = fetchPair,
  nowMs = Date.now(),
  logger = /** @type {LlmsAuditLogger} */ (console)
} = {}) {
  let focus
  try {
    focus = await probeSuppressionImpl()
  } catch (error) {
    const reason = `suppression probe threw before measurement: ${errorText(error)}`
    logger.error(reason)
    return unmeasured(1, 'llms-suppression-probe', reason)
  }

  const suppression = suppressionDisposition(focus, 'llms structure + CloudFront/portfolio coherence', logger)
  if (suppression === 'skip') {
    return standDown(0, 'llms-suppression', `focus suppression prevented measurement: ${focus.reason}`)
  }
  if (suppression === 'fail') {
    return standDown(1, 'llms-suppression', `overdue focus suppression prevented measurement: ${focus.reason}`)
  }

  const settled = await Promise.allSettled(LLMS_ARTIFACTS.map(fetchPairImpl))
  const pairs = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const artifact = LLMS_ARTIFACTS[index]
    const failure = failedSnapshot(result.reason)
    return {artifact, origin: failure, site: failure}
  })
  const input = Object.fromEntries(pairs.map(({artifact, origin, site}) => [artifact.id, {origin, site}]))

  logger.log('\n=== b2-llms: llms.txt structure + CloudFront/portfolio coherence ===')
  logger.log(
    `  thresholds: max-age=${LLMS_COHERENCE_THRESHOLDS.maxCompositionAgeMs}ms ` +
      `composition-skew=${LLMS_COHERENCE_THRESHOLDS.maxCompositionSkewMs}ms ` +
      `future-skew=${LLMS_COHERENCE_THRESHOLDS.maxFutureSkewMs}ms`
  )
  logger.log(detectionLatencyLine())
  for (const {artifact, origin, site} of pairs) {
    logger.log(`\n  ${artifact.id}`)
    printSnapshot('origin', origin, logger)
    printSnapshot('site', site, logger)
  }

  const catalogFindings = [
    ...structureFindings(pairs.find(({artifact}) => artifact.id === 'llms.txt')),
    ...pairs.filter(({artifact}) => artifact.id !== 'llms.txt').flatMap((pair) => presenceFindings(pair))
  ]
  const catalogFailures = catalogFindings.filter((finding) => finding.severity === 'fail')
  logger.log('')
  if (catalogFindings.length === 0) {
    logger.log('OK: llms.txt satisfies every structural rule; llms-full.txt and index.md are present and non-empty.')
  } else {
    for (const finding of catalogFindings) {
      const message = `[${finding.severity}] ${finding.id}: ${finding.message}`
      if (finding.severity === 'fail') {
        logger.error(`  FAIL ${message}`)
        logger.log(`::error title=llms structure::${annotationValue(message)}`)
      } else {
        logger.log(`  WARN ${message}`)
      }
    }
  }

  const coherenceFindings = evaluateLlmsCoherence(input, nowMs)
  logger.log('')
  if (coherenceFindings.length === 0) {
    logger.log('OK: all pairs are fresh and within the convergence window; same-generation full/index representations are byte-identical.')
  } else {
    for (const finding of coherenceFindings) {
      const message = `[${finding.id}] ${finding.artifact}: ${finding.message}`
      logger.error(`  FAIL ${message}`)
      logger.log(`::error title=llms coherence ${finding.artifact}::${annotationValue(message)}`)
    }
    logger.error(`FAIL: ${coherenceFindings.length} llms coherence finding(s).`)
  }

  const unknowns = []
  if (focus.status === 'indeterminate') {
    unknowns.push({id: 'llms-suppression-probe', evidence: `suppression probe incomplete: ${focus.reason}`})
  }
  const transport = transportObservation(pairs)
  unknowns.push(...transport.unknowns)

  const countedCoherence = coherenceFindings.filter((finding) =>
    finding.participants.every(({artifact, side}) => !transport.incomplete.has(responseKey(artifact, side)))
  )
  const exitCode = coherenceFindings.length > 0 || catalogFailures.length > 0 ? 1 : 0
  const status = llmsCheckStatus(catalogFailures.length + countedCoherence.length, unknowns.length)
  // An artifact is MEASURED when this run held bytes for both of its sides, so every judgment the
  // coherence arm makes about it rests on responses this run actually saw. A finding counts as
  // measured; darkness does not. `measured=0` is what the dead-man reads (atlas decision 0122).
  const measured =
    pairs.filter(({artifact}) =>
      !transport.incomplete.has(responseKey(artifact.id, 'origin')) && !transport.incomplete.has(responseKey(artifact.id, 'site'))
    ).length
  logger.log(`\nmeasured=${measured} of ${pairs.length} artifact(s) — both sides held.`)
  return {exitCode, status, measured, catalogFindings, coherenceFindings, unknowns}
}

export async function runB2LlmsCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  auditRunner = /** @type {LlmsAuditRunner} */ (runB2Llms),
  issueOutcomeWriter = writeIssueOutcome,
  measurementWriter = writeMeasurement,
  logger = /** @type {LlmsAuditLogger} */ (console)
} = {}) {
  if (arguments_.length > 0) {
    logger.error(
      `unknown argument: ${arguments_[0]} -- b2-llms takes none ` + '(the --evidence-out spoke-evidence flag was retired by atlas decision 0119 D1)'
    )
    return 1
  }

  let audit
  try {
    audit = await auditRunner({nowMs: Date.now(), logger})
  } catch (error) {
    const reason = `b2-llms audit terminated unexpectedly: ${errorText(error)}`
    logger.error(reason)
    // A throw before any verdict is the darkest case there is: measured 0, so the dead-man reports
    // the wedge rather than pinging a green tile off a swallowed exit (atlas decision 0122).
    audit = {exitCode: 1, status: 'unknown', measured: 0}
  }

  try {
    await issueOutcomeWriter(environment.GITHUB_OUTPUT, audit.status)
    await measurementWriter(environment.GITHUB_OUTPUT, audit.measured ?? 0)
  } catch (error) {
    logger.error(`b2-llms issue outcome write failed: ${errorText(error)}`)
    return 1
  }
  return audit.exitCode
}

if (isMain(import.meta.url)) {
  void runB2LlmsCli().then((exitCode) => {
    process.exitCode = exitCode
  }).catch((error) => {
    console.error(errorText(error))
    process.exitCode = 1
  })
}
// Stryker restore all
