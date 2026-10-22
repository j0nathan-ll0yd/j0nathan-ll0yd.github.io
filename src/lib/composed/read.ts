// One request's read of the composed dashboard (atlas decision 0160, PR B; owner decision 2026-10-16:
// precomposed "just like the llms.txt"). The read applies the llms.txt proxy's rules
// (src/lib/edge/proxy.ts `readGatedConcurrently`): it probes focus.json per request, and a hiding or
// unreadable value answers before any artifact byte is read; it reads the artifact no-store through
// the CloudFront gate with the same admission rules (a suppression body wins, a cache-served 200 or
// one without `x-amz-cf-id` is refused), and keeps NO last-known-good copy (decision 0160 D3). Unlike
// the proxy routes it issues the probe and the artifact fetch together (soak fix, 2026-10-17), so it
// takes about the slower of the two, not their sum. This module only classifies the answer.
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {type GatedReadTiming, readGatedConcurrently, type Upstream} from '../edge/proxy'
import {type ArtifactFacts, type ArtifactRefusal, checkArtifact, COMPOSED_ARTIFACT_PATH, COMPOSED_MAX_BYTES, type ComposedArtifact} from './artifact'

const HIDING_FOCUS_MODE_SET: ReadonlySet<string> = new Set(HIDING_FOCUS_MODES)

/**
 * The read's whole budget: D2's 2.5 s of I/O, inside the Worker's 3 s ceiling (SSR_CEILING_MS). The
 * proxy's own budget is 10 s; without this, a slow focus probe would outlast the ceiling and answer
 * `fallback` where the read itself would answer `focus-unreadable`.
 */
export const COMPOSED_READ_BUDGET_MS = 2_500

export type ComposedRead =
  & (
    | {kind: 'ok'; artifact: ComposedArtifact; facts: ArtifactFacts}
    /** `currentFocus`: the hiding value the probe read, or null when the gate shut over a visible one. */
    | {kind: 'suppressed'; currentFocus: string | null}
    | {kind: 'focus-unreadable'}
    | {kind: 'unavailable'; status: number}
    /** `detail`: for a `fragments` refusal, the fragment and the closed-set reason (value-free). */
    | {kind: 'refused'; refusal: ArtifactRefusal; detail?: string}
  )
  & {
    /** How long each leg took, for the value-free render log. Absent from a test double. */
    timing?: GatedReadTiming
  }

/**
 * The read takes no `waitUntil`: no work that touches artifact bytes may outlive the answer, and
 * none is scheduled (decision 0160 D3).
 */
export interface ComposedReadOptions {
  nowMs: number
  /** The build the artifact must name: the Worker's own (or the fixture seam's, on a preview). */
  build: string
  /** The test seams' upstream; absent in production. */
  upstream?: Upstream
  /** Overrides the read budget, for tests only. */
  budgetMs?: number
}

export async function readComposed({upstream, budgetMs = COMPOSED_READ_BUDGET_MS, nowMs, build}: ComposedReadOptions): Promise<ComposedRead> {
  const read = await readGatedConcurrently({path: COMPOSED_ARTIFACT_PATH, budgetMs, ...(upstream ? {upstream} : {})})
  const {timing} = read
  if (read.kind !== 'ok') {
    return read
  }
  // The read already holds the body in memory; the cap bounds the decode and the fragment check.
  if (read.body.byteLength > COMPOSED_MAX_BYTES) {
    return {kind: 'refused', refusal: 'oversize', timing}
  }
  const checked = checkArtifact(new TextDecoder().decode(read.body), nowMs, build, HIDING_FOCUS_MODE_SET)
  if (checked.ok) {
    return {kind: 'ok', artifact: checked.artifact, facts: checked.facts, timing}
  }
  return checked.detail === undefined
    ? {kind: 'refused', refusal: checked.refusal, timing}
    : {kind: 'refused', refusal: checked.refusal, detail: checked.detail, timing}
}
