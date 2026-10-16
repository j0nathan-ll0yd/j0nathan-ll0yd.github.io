// One request's read of the composed dashboard (atlas decision 0160, PR B; owner decision 2026-10-16:
// precomposed "just like the llms.txt"). The read IS the llms.txt proxy: makeCloudfrontProxy
// (src/lib/edge/proxy.ts) probes focus.json per request, denies a hiding value before any artifact
// fetch, reads the artifact no-store through the CloudFront gate with the same admission rules (a
// suppression body wins, a cache-served 200 or one without `x-amz-cf-id` is refused), and keeps NO
// last-known-good copy (decision 0160 D3). This module only classifies the proxy's answer.
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {makeCloudfrontProxy, SUPPRESSION_SOURCE, type Upstream} from '../edge/proxy'
import {type ArtifactFacts, type ArtifactRefusal, checkArtifact, COMPOSED_ARTIFACT_PATH, COMPOSED_MAX_BYTES, type ComposedArtifact} from './artifact'

const HIDING_FOCUS_MODE_SET: ReadonlySet<string> = new Set(HIDING_FOCUS_MODES)
/** The proxy's `X-Source` on an unreadable focus signal (proxy.ts `focusUnavailableResponse`). */
const FOCUS_ERROR_SOURCE = 'cloudfront-proxy-focus-error'
const ARTIFACT_SOURCE = 'cloudfront-proxy'

/**
 * The read's whole budget: D2's 2.5 s of I/O, inside the Worker's 3 s ceiling (SSR_CEILING_MS). The
 * proxy's own budget is 10 s; without this, a slow focus probe would outlast the ceiling and answer
 * `fallback` where the read itself would answer `focus-unreadable`.
 */
export const COMPOSED_READ_BUDGET_MS = 2_500

const proxyDashboard = makeCloudfrontProxy({path: COMPOSED_ARTIFACT_PATH, contentType: 'application/json; charset=utf-8', lastKnownGood: false})

export type ComposedRead =
  | {kind: 'ok'; artifact: ComposedArtifact; facts: ArtifactFacts}
  /** `currentFocus`: the hiding value the probe read, or null when the gate shut over a visible one. */
  | {kind: 'suppressed'; currentFocus: string | null}
  | {kind: 'focus-unreadable'}
  | {kind: 'unavailable'; status: number}
  /** `detail`: for a `fragments` refusal, the fragment and the closed-set reason (value-free). */
  | {kind: 'refused'; refusal: ArtifactRefusal; detail?: string}

export interface ComposedReadOptions {
  request: Request
  waitUntil(promise: Promise<unknown>): void
  nowMs: number
  /** The build the artifact must name: the Worker's own (or the fixture seam's, on a preview). */
  build: string
  /** The test seams' upstream; absent in production. */
  upstream?: Upstream
  /** Overrides the read budget, for tests only. */
  budgetMs?: number
}

export async function readComposed(
  {request, waitUntil, nowMs, build, upstream, budgetMs = COMPOSED_READ_BUDGET_MS}: ComposedReadOptions
): Promise<ComposedRead> {
  let hidingFocus: string | null = null
  const response = await proxyDashboard({
    request: new Request(request.url, {method: 'GET'}),
    waitUntil,
    budgetMs,
    onHidingFocus: (currentFocus) => {
      hidingFocus = currentFocus
    },
    ...(upstream ? {upstream} : {})
  })
  const source = response.headers.get('X-Source')
  if (source === SUPPRESSION_SOURCE) {
    return {kind: 'suppressed', currentFocus: hidingFocus}
  }
  if (source === FOCUS_ERROR_SOURCE) {
    response.body?.cancel().catch(() => {})
    return {kind: 'focus-unreadable'}
  }
  if (response.status !== 200 || source !== ARTIFACT_SOURCE) {
    response.body?.cancel().catch(() => {})
    return {kind: 'unavailable', status: response.status}
  }
  // The proxy already holds the body in memory; the cap bounds the decode and the fragment check.
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > COMPOSED_MAX_BYTES) {
    return {kind: 'refused', refusal: 'oversize'}
  }
  const checked = checkArtifact(new TextDecoder().decode(bytes), nowMs, build, HIDING_FOCUS_MODE_SET)
  if (checked.ok) {
    return {kind: 'ok', artifact: checked.artifact, facts: checked.facts}
  }
  return checked.detail === undefined ? {kind: 'refused', refusal: checked.refusal} : {kind: 'refused', refusal: checked.refusal, detail: checked.detail}
}
