// @vitest-environment node
//
// The privacy proof of the composed read (atlas decision 0160, PR B; owner decision 2026-10-16: the
// page is precomposed like llms.txt). `readComposed` IS the llms.txt proxy with no last-known-good
// copy, so the matrix below drives it through a stub upstream and asserts what reaches the Worker:
// a hiding focus never fetches the artifact, the gate's suppression body wins over a visible probe
// (the probe-then-fetch race), a 200 that did not provably pass the gate is refused, an unreadable
// focus fails closed, and no Cache API copy is read or written. The composer's own refusal while
// hiding is proven in tests/oracle/composer-parity.test.ts.
import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {COMPOSED_ARTIFACT_PATH} from '../../src/lib/composed/artifact'
import {type ComposedRead, readComposed} from '../../src/lib/composed/read'
import type {Upstream} from '../../src/lib/edge/proxy'

const logger = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()}))
vi.mock('@j0nathan-ll0yd/observability/edge', () => ({createEdgeLogger: () => logger}))

const BASE = 'https://data-plane.test'
const FOCUS_URL = `${BASE}/focus.json`
const ARTIFACT_URL = `${BASE}${COMPOSED_ARTIFACT_PATH}`
const ARTIFACT = readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')
const PARSED = JSON.parse(ARTIFACT) as {composedAt: string; renderer: {web: string}}
const NOW = Date.parse(PARSED.composedAt) + 60_000
const SUPPRESSION_BODY = JSON.stringify({suppressed: true, reason: 'focus mode active'})

/** A response CloudFront served in this request: it carries `x-amz-cf-id`. */
function fromCloudfront(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('x-amz-cf-id')) {
    headers.set('x-amz-cf-id', 'cloudfront-request')
  }
  return new Response(body, {...init, headers})
}

function focus(currentFocus: string): Response {
  return fromCloudfront(JSON.stringify({currentFocus}), {headers: {'Content-Type': 'application/json'}})
}

type Answer = Response | (() => Response | Promise<Response>)

/** A stub upstream: one answer per URL, every call recorded with its init. */
function upstream(answers: Record<string, Answer>): {calls: [string, RequestInit | undefined][]; upstream: Upstream} {
  const calls: [string, RequestInit | undefined][] = []
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push([url, init])
    const answer = answers[url]
    if (answer === undefined) {
      throw new TypeError(`unexpected fetch ${url}`)
    }
    return typeof answer === 'function' ? answer() : answer.clone()
  }) as typeof fetch
  return {calls, upstream: {base: BASE, fetch: fetchStub}}
}

function read(u: Upstream, nowMs = NOW): Promise<ComposedRead> {
  return readComposed({request: new Request('https://jonathanlloyd.me/'), waitUntil: () => {}, nowMs, renderer: PARSED.renderer, upstream: u})
}

function artifactCalls(calls: [string, RequestInit | undefined][]): number {
  return calls.filter(([url]) => url === ARTIFACT_URL).length
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('readComposed: the gate', () => {
  it('admits a fresh artifact under a visible focus, read no-store with no Cloudflare cache option', async () => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    const result = await read(u)
    expect(result.kind).toBe('ok')
    expect(calls.map(([url]) => url)).toEqual([FOCUS_URL, ARTIFACT_URL])
    const [, init] = calls[1]
    expect(init).toMatchObject({cache: 'no-store', redirect: 'manual'})
    expect(init).not.toHaveProperty('cf')
  })

  it.each(HIDING_FOCUS_MODES)('a hiding focus (%s) never fetches the artifact', async (mode) => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: focus(mode), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    expect(await read(u)).toEqual({kind: 'suppressed'})
    expect(artifactCalls(calls)).toBe(0)
  })

  it('the race: a visible probe, then the gate shuts before the artifact fetch, serves nothing', async () => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(SUPPRESSION_BODY, {status: 403})})
    expect(await read(u)).toEqual({kind: 'suppressed'})
    expect(artifactCalls(calls)).toBe(1)
  })

  it.each([
    ['a 500', () => fromCloudfront('{}', {status: 500})],
    ['malformed JSON', () => fromCloudfront('{"currentFocus":')],
    ['a body with no focus value', () => fromCloudfront('{}')],
    ['a transport failure', () => Promise.reject(new TypeError('network'))]
  ])('an unreadable focus (%s) fails closed and never fetches the artifact', async (_name, answer) => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: answer as () => Promise<Response>, [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    expect(await read(u)).toEqual({kind: 'focus-unreadable'})
    expect(artifactCalls(calls)).toBe(0)
  })
})

describe('readComposed: admission', () => {
  it.each(['HIT', 'STALE', 'UPDATING', 'REVALIDATED'])('refuses a 200 Cloudflare served from its cache (%s)', async (status) => {
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(ARTIFACT, {headers: {'cf-cache-status': status}})})
    const result = await read(u)
    expect(result.kind).toBe('unavailable')
  })

  it('refuses a 200 without x-amz-cf-id', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: () => new Response(ARTIFACT)})
    expect((await read(u)).kind).toBe('unavailable')
  })

  it('a 403 that is not the suppression body is not served and is not read as suppression', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront('denied', {status: 403})})
    expect((await read(u)).kind).toBe('unavailable')
  })
})

describe('readComposed: no stored copy (D3)', () => {
  it('never opens the Cache API, on success or on failure', async () => {
    const open = vi.fn()
    const defaultCache = {match: vi.fn(), put: vi.fn()}
    vi.stubGlobal('caches', {open, default: defaultCache})
    const ok = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    expect((await read(ok.upstream)).kind).toBe('ok')
    const down = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront('{}', {status: 503})})
    expect((await read(down.upstream)).kind).toBe('unavailable')
    expect(open).not.toHaveBeenCalled()
    expect(defaultCache.match).not.toHaveBeenCalled()
    expect(defaultCache.put).not.toHaveBeenCalled()
  })
})

describe('readComposed: the artifact checks', () => {
  it('refuses an artifact that names a hiding focus value, even through an open gate', async () => {
    const hiding = JSON.stringify({...JSON.parse(ARTIFACT), currentFocus: HIDING_FOCUS_MODES[0]})
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(hiding)})
    expect(await read(u)).toEqual({kind: 'refused', refusal: 'hiding'})
  })

  it('refuses an artifact older than its maximum age', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    expect(await read(u, Date.parse(PARSED.composedAt) + 24 * 3_600_000)).toEqual({kind: 'refused', refusal: 'stale'})
  })

  it('refuses an artifact another design-system version composed', async () => {
    const other = JSON.stringify({...JSON.parse(ARTIFACT), renderer: {web: '0.0.0'}})
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(other)})
    expect(await read(u)).toEqual({kind: 'refused', refusal: 'renderer'})
  })
})

describe('readForRequest: the platform fetch', () => {
  // workerd rejects a platform fetch called with any receiver but the global scope. The proxy calls
  // `upstream.fetch(...)` as a method, so a bare global there failed every seam read with
  // "Illegal invocation" and served the data-free page (found by the visual suite, 2026-10-15).
  it('never hands the bare global fetch to the proxy as a method', async () => {
    const strictFetch = vi.fn(function(this: unknown, input: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation')
      }
      return Promise.resolve(String(input).endsWith('/focus.json') ? focus('None') : fromCloudfront(ARTIFACT))
    })
    vi.stubGlobal('fetch', strictFetch)
    const {readForRequest} = await import('../../src/lib/data-plane/request')
    const result = await readForRequest(new Request('http://127.0.0.1:4321/'), {DATA_PLANE_BASE: BASE}, NOW, () => {})
    expect(strictFetch.mock.calls.map(([url]) => String(url))).toEqual([FOCUS_URL, ARTIFACT_URL])
    expect(result.kind).not.toBe('focus-unreadable')
  })
})
