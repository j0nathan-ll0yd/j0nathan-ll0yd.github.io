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
//   COHERENCE arm: the six origin/site fetches evaluated by
//   audits/lib/llms-coherence.ts -- status, content-type, composition freshness
//   (contract thresholds), origin/site and full/index skew, conditional
//   byte-equality, and canonical cache state. Findings keep the llms-{side}-*
//   vocabulary that library owns.
//
// The retired Atlas spoke-evidence envelope is NOT emitted (0119 D1 -- lane
// liveness is decision 0116's job now). The managed-issue reconciler consumes the
// tri-state issue_outcome this check writes to GITHUB_OUTPUT, never the step
// outcome; the fold lives in audits/lib/llms-issue-outcome.ts.

import {createHash} from 'node:crypto'
import {checkLlmsStructure} from '@j0nathan-ll0yd/estate-contracts/llms-structure'
import {LLMS_ARTIFACTS} from '../../functions/_lib/llms-artifacts.ts'
import {compositionTimestamp, evaluateLlmsCoherence, LLMS_COHERENCE_THRESHOLDS} from '../lib/llms-coherence.ts'
import {llmsCheckStatus, writeIssueOutcome, writeMeasurement} from '../lib/llms-issue-outcome.ts'
import {fetchStable, isMain} from '../lib/http.mjs'
import {probeSuppression, suppressionDisposition} from '../lib/suppression.mjs'
import {emit, rules} from '../specs/load.mjs'

const R = rules('llms-txt')

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

// Stryker disable all -- everything below is network-path orchestration over live
// HTTP responses with no mutation-gate coverage; Stryker targets only the pure
// validateLlmsTxt above (decisions/0011, UD1: the mutation gate scopes to the
// pure pilot validators).

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
