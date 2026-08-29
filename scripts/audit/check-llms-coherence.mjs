#!/usr/bin/env -S pnpm exec tsx

import {createHash} from 'node:crypto'
import {LLMS_ARTIFACTS} from '../../functions/_lib/llms-artifacts.ts'
import {compositionTimestamp, evaluateLlmsCoherence, LLMS_COHERENCE_THRESHOLDS} from './lib/llms-coherence.ts'
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

function printSnapshot(side, snapshot) {
  console.log(
    `  ${side}: status=${snapshot.status} type=${JSON.stringify(snapshot.contentType)} ` +
      `composed=${timestampLabel(snapshot.body)} bytes=${snapshot.body.byteLength} sha256=${sha256(snapshot.body)} ` +
      `cache-control=${JSON.stringify(snapshot.cacheControl)} cdn-cache-control=${JSON.stringify(snapshot.cdnCacheControl)} ` +
      `cf-cache-status=${JSON.stringify(snapshot.cfCacheStatus)} age=${JSON.stringify(snapshot.age)} ` +
      `x-cache=${JSON.stringify(snapshot.xCache)} x-source=${JSON.stringify(snapshot.source)}`
  )
  if (snapshot.error) {
    console.log(`    error=${snapshot.error}`)
  }
}

function annotationValue(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

async function main() {
  const suppression = suppressionDisposition(await probeSuppression(), 'llms CloudFront/portfolio coherence')
  if (suppression === 'skip') {
    return
  }
  if (suppression === 'fail') {
    process.exitCode = 1
    return
  }

  const settled = await Promise.allSettled(LLMS_ARTIFACTS.map(fetchPair))
  const pairs = settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const artifact = LLMS_ARTIFACTS[index]
    const failure = failedSnapshot(result.reason)
    return {artifact, origin: failure, site: failure}
  })
  const input = Object.fromEntries(pairs.map(({artifact, origin, site}) => [artifact.id, {origin, site}]))

  console.log('\n=== llms CloudFront/portfolio coherence ===')
  console.log(
    `  thresholds: max-age=${LLMS_COHERENCE_THRESHOLDS.maxCompositionAgeMs}ms ` +
      `origin-site-skew=${LLMS_COHERENCE_THRESHOLDS.maxOriginToSiteSkewMs}ms ` +
      `future-skew=${LLMS_COHERENCE_THRESHOLDS.maxFutureSkewMs}ms`
  )
  for (const {artifact, origin, site} of pairs) {
    console.log(`\n  ${artifact.id}`)
    printSnapshot('origin', origin)
    printSnapshot('site', site)
  }

  const findings = evaluateLlmsCoherence(input, Date.now())
  console.log('')
  if (findings.length === 0) {
    console.log('OK: all three origin/site pairs are fresh and coherent; full/index aliases are byte-identical.')
    return
  }

  for (const finding of findings) {
    const message = `[${finding.id}] ${finding.artifact}: ${finding.message}`
    console.error(`  FAIL ${message}`)
    console.log(`::error title=llms coherence ${finding.artifact}::${annotationValue(message)}`)
  }
  console.error(`FAIL: ${findings.length} llms coherence finding(s).`)
  process.exitCode = 1
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
