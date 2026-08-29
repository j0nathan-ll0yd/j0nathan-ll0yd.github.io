#!/usr/bin/env -S pnpm exec tsx

import {createHash} from 'node:crypto'
import {LLMS_ARTIFACTS} from '../../functions/_lib/llms-artifacts.ts'
import {compositionTimestamp, evaluateLlmsCoherence, LLMS_COHERENCE_THRESHOLDS} from './lib/llms-coherence.ts'
import {b2EvidenceSourceFromEnvironment, buildB2SpokeEvidence, writeB2GithubOutput, writeB2SpokeEvidence} from './lib/llms-spoke-evidence.ts'
import {fetchStable, isMain} from './lib/http.mjs'
import {probeSuppression, suppressionDisposition} from './lib/suppression.mjs'

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

function unknownOutcome(id, evidence) {
  return {findings: [], unknowns: [{id, evidence}]}
}

export function evidenceOutputPath(arguments_) {
  let outputPath = null
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === '--evidence-out') {
      if (outputPath !== null || !arguments_[index + 1]) {
        throw new TypeError('--evidence-out requires exactly one path')
      }
      outputPath = arguments_[index + 1]
      index++
    } else if (argument.startsWith('--evidence-out=')) {
      if (outputPath !== null || argument.slice('--evidence-out='.length) === '') {
        throw new TypeError('--evidence-out requires exactly one path')
      }
      outputPath = argument.slice('--evidence-out='.length)
    } else {
      throw new TypeError(`unknown argument: ${argument}`)
    }
  }
  return outputPath
}

export async function runLlmsCoherenceAudit({
  probeSuppressionImpl = probeSuppression,
  fetchPairImpl = fetchPair,
  nowMs = Date.now(),
  logger = console
} = {}) {
  let focus
  try {
    focus = await probeSuppressionImpl()
  } catch (error) {
    const reason = `suppression probe threw before measurement: ${errorText(error)}`
    logger.error(reason)
    return {exitCode: 1, evidenceOutcome: unknownOutcome('llms-suppression-probe', reason)}
  }

  const suppression = suppressionDisposition(focus, 'llms CloudFront/portfolio coherence', logger)
  if (suppression === 'skip') {
    return {exitCode: 0, evidenceOutcome: unknownOutcome('llms-suppression', `focus suppression prevented measurement: ${focus.reason}`)}
  }
  if (suppression === 'fail') {
    return {exitCode: 1, evidenceOutcome: unknownOutcome('llms-suppression', `overdue focus suppression prevented measurement: ${focus.reason}`)}
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

  logger.log('\n=== llms CloudFront/portfolio coherence ===')
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

  const findings = evaluateLlmsCoherence(input, nowMs)
  logger.log('')
  if (findings.length === 0) {
    logger.log('OK: all pairs are fresh and within the convergence window; same-generation full/index representations are byte-identical.')
  } else {
    for (const finding of findings) {
      const message = `[${finding.id}] ${finding.artifact}: ${finding.message}`
      logger.error(`  FAIL ${message}`)
      logger.log(`::error title=llms coherence ${finding.artifact}::${annotationValue(message)}`)
    }
    logger.error(`FAIL: ${findings.length} llms coherence finding(s).`)
  }

  const unknowns = []
  if (focus.status === 'indeterminate') {
    unknowns.push({id: 'llms-suppression-probe', evidence: `suppression probe incomplete: ${focus.reason}`})
  }
  const transport = transportObservation(pairs)
  unknowns.push(...transport.unknowns)
  const evidenceFindings = findings.filter((finding) =>
    finding.participants.every(({artifact, side}) => !transport.incomplete.has(responseKey(artifact, side)))
  )
  return {exitCode: findings.length > 0 ? 1 : 0, evidenceOutcome: {findings: evidenceFindings, unknowns}}
}

export async function runLlmsCoherenceCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  now = () => new Date(),
  auditRunner = runLlmsCoherenceAudit,
  evidenceWriter = writeB2SpokeEvidence,
  githubOutputWriter = writeB2GithubOutput,
  logger = console
} = {}) {
  let outputPath
  let source
  try {
    outputPath = evidenceOutputPath(arguments_)
    source = outputPath ? b2EvidenceSourceFromEnvironment(environment) : null
  } catch (error) {
    logger.error(errorText(error))
    return 1
  }

  const observedAt = now().toISOString()
  let audit
  try {
    audit = await auditRunner({nowMs: Date.parse(observedAt), logger})
  } catch (error) {
    const reason = `llms coherence audit terminated unexpectedly: ${errorText(error)}`
    logger.error(reason)
    audit = {exitCode: 1, evidenceOutcome: unknownOutcome('llms-coherence', reason)}
  }

  if (outputPath && source) {
    let evidence
    try {
      evidence = buildB2SpokeEvidence(observedAt, source, audit.evidenceOutcome)
      await evidenceWriter(outputPath, evidence)
    } catch (error) {
      logger.error(`B2 spoke evidence write failed: ${errorText(error)}`)
      return 1
    }
    try {
      await githubOutputWriter(environment.GITHUB_OUTPUT, evidence.status)
    } catch (error) {
      logger.error(`B2 managed-issue output write failed: ${errorText(error)}`)
      return 1
    }
    logger.log(`Wrote B2 spoke evidence to ${outputPath}`)
  }
  return audit.exitCode
}

if (isMain(import.meta.url)) {
  void runLlmsCoherenceCli().then((exitCode) => {
    process.exitCode = exitCode
  }).catch((error) => {
    console.error(errorText(error))
    process.exitCode = 1
  })
}
