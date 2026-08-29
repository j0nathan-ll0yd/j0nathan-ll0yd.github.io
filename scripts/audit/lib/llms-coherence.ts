import {LLMS_ARTIFACTS, LLMS_MAX_COMPOSITION_AGE_MS, LLMS_MAX_COMPOSITION_SKEW_MS, LLMS_MAX_FUTURE_SKEW_MS} from '../../../functions/_lib/llms-artifacts'
import type {LlmsArtifactId} from '../../../functions/_lib/llms-artifacts'

export interface LlmsResponseSnapshot {
  status: number
  contentType: string | null
  body: Uint8Array
  cacheControl: string | null
  cdnCacheControl: string | null
  cfCacheStatus: string | null
  error?: string
}

export interface LlmsResponsePair {
  origin: LlmsResponseSnapshot
  site: LlmsResponseSnapshot
}

export type LlmsCoherenceInput = Record<LlmsArtifactId, LlmsResponsePair>

export interface LlmsCoherenceThresholds {
  maxCompositionAgeMs: number
  maxCompositionSkewMs: number
  maxFutureSkewMs: number
}

export interface LlmsCoherenceFinding {
  id: string
  artifact: LlmsArtifactId | 'llms-full.txt/index.md'
  message: string
}

export const LLMS_COHERENCE_THRESHOLDS: Readonly<LlmsCoherenceThresholds> = Object.freeze({
  maxCompositionAgeMs: LLMS_MAX_COMPOSITION_AGE_MS,
  maxCompositionSkewMs: LLMS_MAX_COMPOSITION_SKEW_MS,
  maxFutureSkewMs: LLMS_MAX_FUTURE_SKEW_MS
})

const decoder = new TextDecoder('utf-8', {fatal: true})
const COMPOSITION_PATTERNS = [
  /<!--\s*composed-at:\s*([^\s]+)\s*-->/i,
  /\*\*Generated:\*\*\s*([^\s]+)/i
]

function mediaType(contentType: string | null): string | null {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() || null
}

function hasNoStore(value: string | null): boolean {
  return value?.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store') ?? false
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
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

function durationMinutes(milliseconds: number): string {
  return (milliseconds / 60_000).toFixed(1)
}

function validateCompositionSkew(
  findings: LlmsCoherenceFinding[],
  id: string,
  artifact: LlmsCoherenceFinding['artifact'],
  relationship: string,
  leftComposedAt: number | null,
  rightComposedAt: number | null,
  thresholds: LlmsCoherenceThresholds
): void {
  if (leftComposedAt === null || rightComposedAt === null) {
    return
  }

  const skewMs = Math.abs(leftComposedAt - rightComposedAt)
  if (skewMs > thresholds.maxCompositionSkewMs) {
    findings.push({
      id,
      artifact,
      message: `${relationship} composition skew is ${durationMinutes(skewMs)}m; maximum is ${durationMinutes(thresholds.maxCompositionSkewMs)}m`
    })
  }
}

function representsSameComposition(leftComposedAt: number | null, rightComposedAt: number | null): boolean {
  return leftComposedAt !== null && leftComposedAt === rightComposedAt
}

export function compositionTimestamp(body: Uint8Array): number | null {
  let text: string
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

function validateSnapshot(
  findings: LlmsCoherenceFinding[],
  artifact: (typeof LLMS_ARTIFACTS)[number],
  side: 'origin' | 'site',
  snapshot: LlmsResponseSnapshot,
  expectedContentType: string,
  nowMs: number,
  thresholds: LlmsCoherenceThresholds
): number | null {
  if (snapshot.status !== 200) {
    const detail = snapshot.error ? ` (${snapshot.error})` : ''
    findings.push({id: `llms-${side}-status`, artifact: artifact.id, message: `${side} returned HTTP ${snapshot.status}${detail}; expected 200`})
  }

  const actualContentType = mediaType(snapshot.contentType)
  if (actualContentType !== expectedContentType) {
    findings.push({
      id: `llms-${side}-content-type`,
      artifact: artifact.id,
      message: `${side} content-type is ${JSON.stringify(snapshot.contentType)}; expected ${expectedContentType}`
    })
  }

  if (side === 'site') {
    if (!hasNoStore(snapshot.cacheControl)) {
      findings.push({
        id: 'llms-site-browser-cache-policy',
        artifact: artifact.id,
        message: `site Cache-Control is ${JSON.stringify(snapshot.cacheControl)}; expected no-store`
      })
    }
    if (!hasNoStore(snapshot.cdnCacheControl)) {
      findings.push({
        id: 'llms-site-cdn-cache-policy',
        artifact: artifact.id,
        message: `site CDN-Cache-Control is ${JSON.stringify(snapshot.cdnCacheControl)}; expected no-store`
      })
    }
    const edgeStatus = snapshot.cfCacheStatus?.toUpperCase() || null
    if (edgeStatus !== 'BYPASS' && edgeStatus !== 'DYNAMIC') {
      findings.push({
        id: 'llms-site-edge-cache-status',
        artifact: artifact.id,
        message: `site CF-Cache-Status is ${JSON.stringify(snapshot.cfCacheStatus)}; expected BYPASS or DYNAMIC`
      })
    }
  }

  const composedAt = compositionTimestamp(snapshot.body)
  if (composedAt === null) {
    findings.push({id: `llms-${side}-composition-time`, artifact: artifact.id, message: `${side} body has no parseable composed-at/Generated timestamp`})
    return null
  }

  const ageMs = nowMs - composedAt
  if (ageMs > thresholds.maxCompositionAgeMs) {
    findings.push({
      id: `llms-${side}-stale`,
      artifact: artifact.id,
      message: `${side} composition is ${durationMinutes(ageMs)}m old; maximum is ${durationMinutes(thresholds.maxCompositionAgeMs)}m`
    })
  } else if (ageMs < -thresholds.maxFutureSkewMs) {
    findings.push({
      id: `llms-${side}-composition-future`,
      artifact: artifact.id,
      message: `${side} composition is ${durationMinutes(-ageMs)}m in the future; allowance is ${durationMinutes(thresholds.maxFutureSkewMs)}m`
    })
  }

  return composedAt
}

/**
 * Pure comparison of already-fetched CloudFront and portfolio representations.
 * The caller owns network retries and evidence collection; this function owns
 * only deterministic contract evaluation.
 */
export function evaluateLlmsCoherence(
  input: LlmsCoherenceInput,
  nowMs: number,
  thresholds: LlmsCoherenceThresholds = LLMS_COHERENCE_THRESHOLDS
): LlmsCoherenceFinding[] {
  const findings: LlmsCoherenceFinding[] = []
  const compositionTimes: Record<LlmsArtifactId, {origin: number | null; site: number | null}> = {
    'llms.txt': {origin: null, site: null},
    'llms-full.txt': {origin: null, site: null},
    'index.md': {origin: null, site: null}
  }

  for (const artifact of LLMS_ARTIFACTS) {
    const pair = input[artifact.id]
    const originComposedAt = validateSnapshot(findings, artifact, 'origin', pair.origin, artifact.originContentType, nowMs, thresholds)
    const siteComposedAt = validateSnapshot(findings, artifact, 'site', pair.site, artifact.siteContentType, nowMs, thresholds)
    compositionTimes[artifact.id] = {origin: originComposedAt, site: siteComposedAt}
    validateCompositionSkew(findings, 'llms-origin-site-skew', artifact.id, 'origin/site', originComposedAt, siteComposedAt, thresholds)
  }

  for (const artifactId of ['llms-full.txt', 'index.md'] as const) {
    const pair = input[artifactId]
    const times = compositionTimes[artifactId]
    if (representsSameComposition(times.origin, times.site) && !sameBytes(pair.origin.body, pair.site.body)) {
      findings.push({
        id: 'llms-origin-site-bytes',
        artifact: artifactId,
        message: `origin and site advertise the same composition but bytes differ (${pair.origin.body.byteLength} vs ${pair.site.body.byteLength} bytes)`
      })
    }
  }

  const full = input['llms-full.txt']
  const index = input['index.md']
  const fullTimes = compositionTimes['llms-full.txt']
  const indexTimes = compositionTimes['index.md']
  for (const side of ['origin', 'site'] as const) {
    validateCompositionSkew(findings, 'llms-full-index-skew', 'llms-full.txt/index.md', `${side} llms-full.txt/index.md`, fullTimes[side], indexTimes[side],
      thresholds)
    if (representsSameComposition(fullTimes[side], indexTimes[side]) && !sameBytes(full[side].body, index[side].body)) {
      findings.push({
        id: 'llms-full-index-bytes',
        artifact: 'llms-full.txt/index.md',
        message: `${side} llms-full.txt and index.md advertise the same composition but are not byte-identical`
      })
    }
  }

  return findings
}
