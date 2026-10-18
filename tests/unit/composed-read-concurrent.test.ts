// @vitest-environment node
//
// The composed read issues the focus probe and the artifact fetch together (atlas decision 0160, soak
// fix 2026-10-17: the serial probe-then-fetch timed out on its 2.5 s budget from colos far from
// CloudFront). This file proves the latency gain and the five privacy invariants of the concurrent
// read, through the injected `upstream` seam:
//
// 1. Composed data only under a VISIBLE focus read in the same request AND an admitted artifact.
// 2. Gate wins: a suppression body under a visible focus answers `suppressed`.
// 3. Signal wins: a hiding focus over an artifact 200 answers `suppressed`; the body is cancelled
//    unread (never read, parsed or logged).
// 4. An unreadable focus answers `focus-unreadable`, even when the artifact arrived.
// 5. No cache, no last-known-good copy, and no work after the answer that reads artifact bytes.
//
// The other proxy routes keep the serial read; tests/unit/cloudfront-proxy.test.ts pins them unchanged.
import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {COMPOSED_ARTIFACT_PATH} from '../../src/lib/composed/artifact'
import {COMPOSED_READ_BUDGET_MS, type ComposedRead, readComposed} from '../../src/lib/composed/read'
import type {Upstream} from '../../src/lib/edge/proxy'

const logger = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()}))
vi.mock('@j0nathan-ll0yd/observability/edge', () => ({createEdgeLogger: () => logger}))

const BASE = 'https://data-plane.test'
const FOCUS_URL = `${BASE}/focus.json`
const ARTIFACT_URL = `${BASE}${COMPOSED_ARTIFACT_PATH}`
const ARTIFACT = readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')
const PARSED = JSON.parse(ARTIFACT) as {composedAt: string; composer: {build: string}}
const NOW = Date.parse(PARSED.composedAt) + 60_000
const SUPPRESSION_BODY = JSON.stringify({suppressed: true, reason: 'focus mode active'})
/** A string only the artifact holds: a log line that carried artifact bytes would contain it. */
const ARTIFACT_MARKER = 'tri-card'
/** The leg delay of the latency test: their sum misses the 2.5 s budget, either alone fits. */
const LEG_MS = 1_400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cloudfrontHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({'x-amz-cf-id': 'cloudfront-request', ...extra})
}

function focus(currentFocus: string): Response {
  return new Response(JSON.stringify({currentFocus}), {headers: cloudfrontHeaders({'Content-Type': 'application/json'})})
}

/** An artifact 200 whose body records whether anything read it or cancelled it. */
interface TracedBody {
  response: Response
  pulls: number
  cancelled: boolean
}

function tracedArtifact(): TracedBody {
  const counts = {pulls: 0, cancelled: false}
  const bytes = new TextEncoder().encode(ARTIFACT)
  // highWaterMark 0: the stream pulls only when a reader asks, so `pulls` counts real reads.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counts.pulls++
      controller.enqueue(bytes)
      controller.close()
    },
    cancel() {
      counts.cancelled = true
    }
  }, {highWaterMark: 0})
  const response = new Response(body, {status: 200, headers: cloudfrontHeaders()})
  return {
    response,
    get pulls() {
      return counts.pulls
    },
    get cancelled() {
      return counts.cancelled
    }
  }
}

interface Call {
  url: string
  init: RequestInit | undefined
  startedAt: number
}

type Answer = (init: RequestInit | undefined) => Response | Promise<Response>

/** A stub upstream: one answer per URL; every call recorded with its init and start time. */
function upstream(answers: Record<string, Answer>): {calls: Call[]; upstream: Upstream} {
  const calls: Call[] = []
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({url, init, startedAt: Date.now()})
    const answer = answers[url]
    if (answer === undefined) {
      throw new TypeError(`unexpected fetch ${url}`)
    }
    return answer(init)
  }) as typeof fetch
  return {calls, upstream: {base: BASE, fetch: fetchStub}}
}

function after<T>(ms: number, value: () => T): () => Promise<T> {
  return async () => {
    await sleep(ms)
    return value()
  }
}

/** Never answers; rejects as the platform does once the fetch's signal aborts. */
function hangs(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
}

function read(u: Upstream, budgetMs = COMPOSED_READ_BUDGET_MS): Promise<ComposedRead> {
  return readComposed({nowMs: NOW, build: PARSED.composer.build, upstream: u, budgetMs})
}

function artifactCalls(calls: Call[]): Call[] {
  return calls.filter(({url}) => url === ARTIFACT_URL)
}

function loggedText(): string {
  return JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the concurrent read: latency', () => {
  // covers: dashboard-ssr#The Worker's read spends its whole budget on the focus probe and the artifact
  it('takes about the slower leg, not the sum: focus 1,400 ms and artifact 1,400 ms fit the 2.5 s budget', async () => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: after(LEG_MS, () => focus('None')), [ARTIFACT_URL]: after(LEG_MS, () => tracedArtifact().response)})
    const started = Date.now()
    const result = await read(u)
    const elapsed = Date.now() - started
    expect(result.kind).toBe('ok')
    // Serial reads take at least 2 x LEG_MS = 2,800 ms and miss the budget; concurrent ones about LEG_MS.
    expect(elapsed).toBeLessThan(2 * LEG_MS - 400)
    // The artifact fetch started before the focus probe answered.
    const [artifact] = artifactCalls(calls)
    expect(artifact.startedAt - started).toBeLessThan(LEG_MS / 2)
    expect(result.timing?.focusMs).toBeGreaterThanOrEqual(LEG_MS - 50)
    expect(result.timing?.artifactMs).toBeGreaterThanOrEqual(LEG_MS - 50)
  })

  it('still shares ONE budget: a hung artifact answers within it', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: () => focus('None'), [ARTIFACT_URL]: hangs})
    const started = Date.now()
    const result = await read(u, 400)
    expect(result.kind).toBe('unavailable')
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('invariant 1: composed data only under a visible focus read AND an admitted artifact', () => {
  it('admits an artifact that arrived before the focus probe answered visible', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: after(100, () => focus('None')), [ARTIFACT_URL]: () => tracedArtifact().response})
    expect((await read(u)).kind).toBe('ok')
  })

  it.each([
    ['a Cloudflare cache hit', {'cf-cache-status': 'HIT'}, true],
    ['no x-amz-cf-id', {}, false]
  ])('refuses a 200 with %s under a visible focus', async (_label, extra, cloudfrontId) => {
    const headers = cloudfrontId ? cloudfrontHeaders(extra) : new Headers(extra)
    const {upstream: u} = upstream({[FOCUS_URL]: () => focus('None'), [ARTIFACT_URL]: () => new Response(ARTIFACT, {headers})})
    expect((await read(u)).kind).toBe('unavailable')
  })
})

describe('invariant 2: the gate wins', () => {
  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it.each([
    ['answers first', 0, 100],
    ['answers last', 100, 0]
  ])('a suppression body under a visible focus answers suppressed with no value (the probe %s)', async (_label, focusMs, artifactMs) => {
    const {upstream: u} = upstream({
      [FOCUS_URL]: after(focusMs, () => focus('None')),
      [ARTIFACT_URL]: after(artifactMs, () => new Response(SUPPRESSION_BODY, {status: 403, headers: cloudfrontHeaders()}))
    })
    expect(await read(u)).toMatchObject({kind: 'suppressed', currentFocus: null})
  })
})

describe('invariant 3: the signal wins, and the artifact bytes are discarded unread', () => {
  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it.each(HIDING_FOCUS_MODES)('a hiding focus (%s) over an artifact 200 answers suppressed and cancels the body unread', async (mode) => {
    const artifact = tracedArtifact()
    const {upstream: u} = upstream({[FOCUS_URL]: after(50, () => focus(mode)), [ARTIFACT_URL]: () => artifact.response})
    expect(await read(u)).toMatchObject({kind: 'suppressed', currentFocus: mode})
    await sleep(20)
    expect(artifact.cancelled).toBe(true)
    expect(artifact.pulls).toBe(0)
    expect(loggedText()).not.toContain(ARTIFACT_MARKER)
  })

  it('cancels unread an artifact 200 that arrives after the hiding value, and retries nothing', async () => {
    const artifact = tracedArtifact()
    // This stub ignores the abort signal, as a response already in flight would.
    const {calls, upstream: u} = upstream({[FOCUS_URL]: () => focus('Work'), [ARTIFACT_URL]: after(100, () => artifact.response)})
    expect(await read(u)).toMatchObject({kind: 'suppressed', currentFocus: 'Work'})
    await sleep(200)
    expect(artifact.cancelled).toBe(true)
    expect(artifact.pulls).toBe(0)
    expect(artifactCalls(calls)).toHaveLength(1)
  })

  it('aborts an artifact fetch still in flight when the hiding value arrives', async () => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: () => focus('Do Not Disturb'), [ARTIFACT_URL]: hangs})
    const started = Date.now()
    expect(await read(u)).toMatchObject({kind: 'suppressed', currentFocus: 'Do Not Disturb'})
    expect(Date.now() - started).toBeLessThan(200)
    await sleep(500)
    const fetched = artifactCalls(calls)
    expect(fetched).toHaveLength(1)
    expect(fetched[0].init?.signal?.aborted).toBe(true)
  })
})

describe('the artifact leg starts no attempt after a denial', () => {
  it('a hiding value that arrives during a retry delay stops the retries', async () => {
    const {calls, upstream: u} = upstream({
      [FOCUS_URL]: after(50, () => focus('Work')),
      [ARTIFACT_URL]: () => new Response('{}', {status: 503, headers: cloudfrontHeaders()})
    })
    expect(await read(u)).toMatchObject({kind: 'suppressed', currentFocus: 'Work'})
    await sleep(600)
    expect(artifactCalls(calls)).toHaveLength(1)
  })
})

describe('invariant 4: an unreadable focus fails closed, even when the artifact arrived', () => {
  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it.each([
    ['a 500', () => new Response('{}', {status: 500, headers: cloudfrontHeaders()})],
    ['malformed JSON', () => new Response('{"currentFocus":', {headers: cloudfrontHeaders()})],
    ['a body with no focus value', () => new Response('{}', {headers: cloudfrontHeaders()})],
    ['a transport failure', () => Promise.reject(new TypeError('network'))]
  ])('%s answers focus-unreadable and cancels the artifact body unread', async (_label, answer) => {
    const artifact = tracedArtifact()
    const {upstream: u} = upstream({[FOCUS_URL]: answer, [ARTIFACT_URL]: () => artifact.response})
    expect((await read(u)).kind).toBe('focus-unreadable')
    await sleep(20)
    expect(artifact.cancelled).toBe(true)
    expect(artifact.pulls).toBe(0)
    expect(loggedText()).not.toContain(ARTIFACT_MARKER)
  })

  it('a focus probe that times out answers focus-unreadable inside the budget', async () => {
    const artifact = tracedArtifact()
    const {upstream: u} = upstream({[FOCUS_URL]: hangs, [ARTIFACT_URL]: () => artifact.response})
    const started = Date.now()
    expect((await read(u, 400)).kind).toBe('focus-unreadable')
    expect(Date.now() - started).toBeLessThan(1_000)
    await sleep(20)
    expect(artifact.pulls).toBe(0)
  })
})

describe('invariant 5: no cache, no last-known-good copy, no work after the answer', () => {
  // covers: dashboard-ssr#The focus value decides before any artifact byte is read
  it('never opens the Cache API on any outcome', async () => {
    const open = vi.fn()
    const defaultCache = {match: vi.fn(), put: vi.fn()}
    vi.stubGlobal('caches', {open, default: defaultCache})
    const outcomes = [
      upstream({[FOCUS_URL]: () => focus('None'), [ARTIFACT_URL]: () => tracedArtifact().response}),
      upstream({[FOCUS_URL]: () => focus('Work'), [ARTIFACT_URL]: () => tracedArtifact().response}),
      upstream({[FOCUS_URL]: () => focus('None'), [ARTIFACT_URL]: () => new Response('{}', {status: 503, headers: cloudfrontHeaders()})}),
      upstream({[FOCUS_URL]: () => Promise.reject(new TypeError('network')), [ARTIFACT_URL]: () => tracedArtifact().response})
    ]
    expect(await Promise.all(outcomes.map(({upstream: u}) => read(u, 1_000).then((r) => r.kind)))).toEqual([
      'ok',
      'suppressed',
      'unavailable',
      'focus-unreadable'
    ])
    await sleep(50)
    expect(open).not.toHaveBeenCalled()
    expect(defaultCache.match).not.toHaveBeenCalled()
    expect(defaultCache.put).not.toHaveBeenCalled()
  })

  it('takes no waitUntil: the read cannot schedule work past its answer', () => {
    // ComposedReadOptions has no waitUntil member; the call below is the whole contract.
    const options: Parameters<typeof readComposed>[0] = {nowMs: NOW, build: PARSED.composer.build}
    expect(Object.keys(options)).not.toContain('waitUntil')
    expect(readComposed.length).toBe(1)
  })
})
