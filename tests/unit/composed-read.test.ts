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
import {CLOUDFRONT_BASE, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {checkArtifact, COMPOSED_ARTIFACT_PATH} from '../../src/lib/composed/artifact'
import {COMPOSED_READ_BUDGET_MS, type ComposedRead, readComposed} from '../../src/lib/composed/read'
import {FIXTURE_DATA_PLANE, fixturePlane} from '../../src/lib/data-plane/faults'
import {SSR_CEILING_MS} from '../../src/lib/data-plane/ssr-response'
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
const HIDING: ReadonlySet<string> = new Set(HIDING_FOCUS_MODES)

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
  return readComposed({request: new Request('https://jonathanlloyd.me/'), waitUntil: () => {}, nowMs, build: PARSED.composer.build, upstream: u})
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

  it.each(HIDING_FOCUS_MODES)('a hiding focus (%s) never fetches the artifact, and names the value for its overlay', async (mode) => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: focus(mode), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    expect(await read(u)).toEqual({kind: 'suppressed', currentFocus: mode})
    expect(artifactCalls(calls)).toBe(0)
  })

  it('the race: a visible probe, then the gate shuts before the artifact fetch, serves nothing', async () => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(SUPPRESSION_BODY, {status: 403})})
    // The probe read a visible value, so no overlay is named: the gate variant answers.
    expect(await read(u)).toEqual({kind: 'suppressed', currentFocus: null})
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

  // covers: dashboard-ssr#Card labels and ages are as of composition, at most 11.5 minutes old
  it('refuses an artifact older than its maximum age', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    expect(await read(u, Date.parse(PARSED.composedAt) + 24 * 3_600_000)).toEqual({kind: 'refused', refusal: 'stale'})
  })

  // covers: dashboard-ssr#The Worker serves only an artifact its own build composed
  // covers: dashboard-ssr#A composition never outlives a focus change or a site deploy
  it('refuses an artifact another build composed (a site deploy during a composition)', async () => {
    const other = JSON.stringify({...JSON.parse(ARTIFACT), composer: {build: 'another-build'}})
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront(other)})
    expect(await read(u)).toEqual({kind: 'refused', refusal: 'build'})
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

describe('checkArtifact: fragments and the logged record (review H1, M3)', () => {
  const parsed = () => JSON.parse(ARTIFACT) as {fragments: Record<string, string>; record: Record<string, unknown>}

  it('refuses a fragment that carries a script beside its root', () => {
    const value = parsed()
    value.fragments.cardHR += '<script type="module" src="/Users/someone/HeartRate.astro?astro&type=script"></script>'
    expect(checkArtifact(JSON.stringify(value), NOW, PARSED.composer.build, HIDING)).toEqual({ok: false, refusal: 'fragments'})
  })

  it('refuses a fragment that is not its own root element', () => {
    const value = parsed()
    value.fragments.cardSystem = `<div class="wrapper">${value.fragments.cardSystem}</div>`
    expect(checkArtifact(JSON.stringify(value), NOW, PARSED.composer.build, HIDING)).toEqual({ok: false, refusal: 'fragments'})
  })

  it('carries only the closed-set record fields into the log record', () => {
    const value = parsed()
    value.record = {...value.record, note: 'Known Answer Title Kappa-7731', event: 'spoofed', build: 'spoofed'}
    const checked = checkArtifact(JSON.stringify(value), NOW, PARSED.composer.build, HIDING)
    expect(checked.ok).toBe(true)
    if (checked.ok) {
      expect(Object.keys(checked.artifact.record).sort()).toEqual(['cards', 'degraded', 'domains', 'focus', 'io_ms', 'summary'])
      expect(JSON.stringify(checked.artifact.record)).not.toContain('Kappa-7731')
    }
  })

  it.each([
    ['a domain outcome outside the closed set', (r: Record<string, unknown>) => ({...r, domains: {...(r.domains as object), health: 'ok: 72 bpm'}})],
    ['a card state outside the closed set', (r: Record<string, unknown>) => ({...r, cards: {...(r.cards as object), cardHR: '72 bpm'}})],
    ['an unknown degraded export', (r: Record<string, unknown>) => ({...r, degraded: ['72 bpm']})]
  ])('refuses %s as schema', (_label, change) => {
    const value = parsed()
    value.record = change(value.record)
    expect(checkArtifact(JSON.stringify(value), NOW, PARSED.composer.build, HIDING)).toEqual({ok: false, refusal: 'schema'})
  })
})

describe('readComposed: the D2 budget (review M4)', () => {
  it('is the 2.5 s I/O share of the 3 s ceiling', () => {
    expect(COMPOSED_READ_BUDGET_MS + 500).toBe(SSR_CEILING_MS)
  })

  it('answers focus-unreadable within its budget when the focus probe hangs', async () => {
    const {calls, upstream: u} = upstream({[FOCUS_URL]: () => new Promise<Response>(() => {}), [ARTIFACT_URL]: fromCloudfront(ARTIFACT)})
    const started = Date.now()
    const result = await readComposed({
      request: new Request('https://jonathanlloyd.me/'),
      waitUntil: () => {},
      nowMs: NOW,
      build: PARSED.composer.build,
      upstream: u,
      budgetMs: 300
    })
    expect(result).toEqual({kind: 'focus-unreadable'})
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(artifactCalls(calls)).toBe(0)
  })
})

describe('the fixture data plane never reaches production (review M2)', () => {
  const SEAMS = {'X-SSR-Data-Plane': 'fixture', 'X-SSR-Fault': 'suppress', 'X-SSR-Clock': '2026-03-18T12:02:00.000Z'}

  it.each([
    ['the production host, seams enabled', 'https://jonathanlloyd.me/', '1'],
    ['a preview host, seams disabled', 'https://abc12345-human-datastream.webmaster-872.workers.dev/', undefined]
  ])('%s: fixturePlane is null', (_label, url, enabled) => {
    expect(fixturePlane(new Request(url, {headers: SEAMS}), enabled)).toBeNull()
  })

  it('a preview host with the seams enabled reads the fixture at a pinned ref', () => {
    const plane = fixturePlane(new Request('https://abc12345-human-datastream.webmaster-872.workers.dev/', {headers: SEAMS}), '1')
    expect(plane?.base).toBe(FIXTURE_DATA_PLANE)
    expect(FIXTURE_DATA_PLANE).toMatch(/\/(?:[0-9a-f]{40}|main)\/tests\/fixtures\/composed$/)
  })

  it('production reads CloudFront whatever the headers and variables say', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input))
      return String(input).endsWith('/focus.json') ? focus('None') : fromCloudfront(ARTIFACT)
    }))
    const {readForRequest} = await import('../../src/lib/data-plane/request')
    await readForRequest(new Request('https://jonathanlloyd.me/', {headers: SEAMS}), {SSR_FAULT_INJECTION: '1', DATA_PLANE_BASE: BASE}, NOW, () => {})
    expect(seen.length).toBeGreaterThan(0)
    for (const url of seen) {
      expect(url.startsWith(`${CLOUDFRONT_BASE}/`), url).toBe(true)
    }
  })
})
