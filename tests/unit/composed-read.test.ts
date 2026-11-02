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
import {checkArtifact, checkValueFreeSet, COMPOSED_ARTIFACT_PATH, COMPOSED_FRAGMENT_IDS, COMPOSED_MAX_BYTES} from '../../src/lib/composed/artifact'
import {VALUE_FREE_VARIANTS} from '../../src/lib/composed/value-free'
import {COMPOSED_READ_BUDGET_MS, type ComposedRead, readComposed} from '../../src/lib/composed/read'
import {FIXTURE_DATA_PLANE, fixturePlane} from '../../src/lib/data-plane/faults'
import {SSR_CEILING_MS} from '../../src/lib/data-plane/ssr-response'
import {artifactBudget, PROXY_TIMEOUTS, startBudget, type Upstream} from '../../src/lib/edge/proxy'

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

/** The read's answer without its leg timings, which vary run to run. */
async function read(u: Upstream, nowMs = NOW): Promise<ComposedRead> {
  const {timing: _timing, ...answer} = await readComposed({nowMs, build: PARSED.composer.build, upstream: u})
  return answer as ComposedRead
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

  // The focus matrix of the concurrent read (hiding, unreadable, the gate's suppression body, a body
  // cancelled unread) is in tests/unit/composed-read-concurrent.test.ts.
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
    const result = await readForRequest(new Request('http://127.0.0.1:4321/'), {DATA_PLANE_BASE: BASE}, NOW)
    expect(strictFetch.mock.calls.map(([url]) => String(url))).toEqual([FOCUS_URL, ARTIFACT_URL])
    expect(result.kind).not.toBe('focus-unreadable')
  })
})

describe('checkArtifact: fragments and the logged record (review H1, M3)', () => {
  const parsed = () => JSON.parse(ARTIFACT) as {fragments: Record<string, string>; record: Record<string, unknown>}

  it('refuses a fragment that carries a script beside its root', () => {
    const value = parsed()
    value.fragments.cardHR += '<script type="module" src="/Users/someone/HeartRate.astro?astro&type=script"></script>'
    expect(checkArtifact(JSON.stringify(value), NOW, PARSED.composer.build, HIDING)).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses a fragment that is not its own root element', () => {
    const value = parsed()
    value.fragments.cardSystem = `<div class="wrapper">${value.fragments.cardSystem}</div>`
    expect(checkArtifact(JSON.stringify(value), NOW, PARSED.composer.build, HIDING)).toMatchObject({ok: false, refusal: 'fragments'})
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
    const result = await readComposed({nowMs: NOW, build: PARSED.composer.build, upstream: u, budgetMs: 300})
    expect(result.kind).toBe('focus-unreadable')
    expect(Date.now() - started).toBeLessThan(1_500)
    // The artifact leg started beside the probe and was stopped: one attempt, its fetch aborted.
    expect(artifactCalls(calls)).toBe(1)
    expect(calls.find(([url]) => url === ARTIFACT_URL)?.[1]?.signal?.aborted).toBe(true)
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
    await readForRequest(new Request('https://jonathanlloyd.me/', {headers: SEAMS}), {SSR_FAULT_INJECTION: '1', DATA_PLANE_BASE: BASE}, NOW)
    expect(seen.length).toBeGreaterThan(0)
    for (const url of seen) {
      expect(url.startsWith(`${CLOUDFRONT_BASE}/`), url).toBe(true)
    }
  })
})

describe('checkArtifact: a build without an id (review L9)', () => {
  it('never treats two unknown builds as the same build', () => {
    const value = {...JSON.parse(ARTIFACT), composer: {build: 'unknown'}}
    expect(checkArtifact(JSON.stringify(value), NOW, 'unknown', HIDING)).toEqual({ok: false, refusal: 'build'})
  })
})

describe('checkArtifact: the fragment allowlist (review 2026-10-16, H1)', () => {
  const parsed = () => JSON.parse(ARTIFACT) as {fragments: Record<string, string>}

  /** The artifact with `html` placed inside the root element of fragment `id`. */
  function injected(id: string, html: string): string {
    const value = parsed()
    const fragment = value.fragments[id]
    const open = fragment.indexOf('>') + 1
    value.fragments[id] = fragment.slice(0, open) + html + fragment.slice(open)
    return JSON.stringify(value)
  }

  function replaced(id: string, fragment: string): string {
    const value = parsed()
    value.fragments[id] = fragment
    return JSON.stringify(value)
  }

  function refusal(text: string) {
    return checkArtifact(text, NOW, PARSED.composer.build, HIDING)
  }

  it('admits the committed fixture, every fragment of it', () => {
    const checked = refusal(ARTIFACT)
    expect(checked.ok).toBe(true)
  })

  // The seven probes the review ran; every one was admitted before the allowlist.
  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it.each([
    ['<plaintext> swallows the rest of the page', 'cardHR', '<plaintext>'],
    ['an unclosed comment swallows the rest of the page', 'cardHR', '<!--'],
    ['<textarea> swallows the rest of the page', 'cardHR', '<textarea>'],
    ['a full-screen fixed overlay link', 'cardHR', '<a href="https://evil.example/" style="position:fixed;inset:0;z-index:2147483647"></a>'],
    ['an iframe whose srcdoc hides an entity-encoded script', 'cardHR', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
    ['a form posting off-site', 'cardHR', '<form action="https://evil.example/"></form>']
  ])('refuses %s', (_label, id, html) => {
    expect(refusal(injected(id, html))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses a root whose id lives inside another attribute value', () => {
    const value = parsed()
    const inner = value.fragments.cardHR.slice(value.fragments.cardHR.indexOf('>') + 1)
    expect(refusal(replaced('cardHR', `<div data-x=' id="cardHR"'>${inner}`))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it.each([
    ['a comment', '<!-- x -->'],
    ['a doctype', '<!DOCTYPE html>'],
    ['a processing instruction', '<?xml version="1.0"?>'],
    ['a script', '<script>alert(1)</script>'],
    ['a style element', '<style>body{display:none}</style>'],
    ['a link element', '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example/">'],
    ['a base element', '<base href="https://evil.example/">'],
    ['an object', '<object data="https://evil.example/x"></object>'],
    ['an embed', '<embed src="https://evil.example/x">'],
    ['a template', '<template><div></div></template>'],
    ['a noscript', '<noscript><div></div></noscript>'],
    ['an unknown element', '<marquee>x</marquee>'],
    ['an input', '<input value="x">'],
    ['an event handler attribute', '<div onclick="alert(1)"></div>'],
    ['a mixed-case event handler', '<div OnMouseOver="alert(1)"></div>'],
    ['an unknown attribute', '<div formaction="https://evil.example/"></div>'],
    ['a single-quoted attribute', "<div class='x'></div>"],
    ['an unquoted attribute', '<div class=x></div>'],
    ['a duplicate attribute', '<div class="a" class="b"></div>'],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>'],
    ['an entity-encoded javascript: link', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['a link to a host off the allowlist', '<a href="https://evil.example/">x</a>'],
    ['a protocol-relative link', '<a href="//evil.example/">x</a>'],
    ['a backslash link', '<a href="/\\evil.example/">x</a>'],
    ['a link with credentials', '<a href="https://user@github.com/">x</a>'],
    ['a plain-http link', '<a href="http://github.com/">x</a>'],
    ['a target without noopener', '<a href="https://github.com/" target="_blank">x</a>'],
    ['a data: image', '<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;" alt="">'],
    ['an off-origin image', '<img src="https://evil.example/pixel.gif" alt="">'],
    ['an off-origin srcset candidate', '<img src="/images/no-cover.svg" srcset="/images/no-cover.svg 1x, https://evil.example/p.gif 2x" alt="">'],
    ['a style with position fixed', '<div style="position: fixed"></div>'],
    ['a style with a url()', '<div style="background: url(https://evil.example/x)"></div>'],
    ['a style with an escape', '<div style="col\\6fr: red"></div>'],
    ['a style with a huge size', '<div style="width: 100000px"></div>'],
    ['a style with !important', '<div style="width: 10px !important"></div>'],
    ['a style with an unknown property', '<div style="z-index: 9"></div>'],
    ['an element that reparents its own p', '<p><div></div></p>'],
    ['a nested link', '<a href="/x"><a href="/y">x</a></a>'],
    ['a list item outside a list', '<li>x</li>'],
    ['an html self-closing non-void', '<div/>'],
    ['an end tag that does not match', '<div></span>'],
    ['an unclosed element', '<div>'],
    ['a stray less-than', '< div>'],
    ['an svg link', '<svg viewBox="0 0 1 1"><a href="/x"></a></svg>'],
    ['an svg script', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['an svg foreignObject', '<svg viewBox="0 0 1 1"><foreignObject><div></div></foreignObject></svg>'],
    ['an svg filter url off the page', '<svg viewBox="0 0 1 1"><path d="M0 0" filter="url(https://evil.example/f.svg#x)"></path></svg>'],
    ['an svg path with markup characters', '<svg viewBox="0 0 1 1"><path d="M0 0 expression(1)"></path></svg>'],
    ['another card root id', '<div id="cardSystem"></div>'],
    ['an id that is not a name', '<div id="__proto__"></div>'],
    ['a NUL character', '\u0000'],
    ['a scoped-style attribute with a value', '<div data-astro-cid-g2wqwvvr="x"></div>']
  ])('refuses %s', (_label, html) => {
    expect(refusal(injected('cardHR', html))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses a second top-level element beside the root', () => {
    const value = parsed()
    expect(refusal(replaced('cardHR', `${value.fragments.cardHR}<div class="overlay"></div>`))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses text beside the root', () => {
    const value = parsed()
    expect(refusal(replaced('cardHR', `${value.fragments.cardHR}Known Answer Kappa-7731`))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses a data carrier on a card that has none', () => {
    const value = parsed()
    expect(refusal(replaced('cardHR', `${value.fragments.cardHR}<div id="cardHRData" hidden></div>`))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses a data carrier that is not hidden', () => {
    const value = parsed()
    const fragment = value.fragments.cardHydration.replace(/ hidden><\/div>$/, '></div>')
    expect(fragment).not.toBe(value.fragments.cardHydration)
    expect(refusal(replaced('cardHydration', fragment))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('refuses an id that two fragments both carry', () => {
    expect(refusal(injected('cardSleep', '<span id="pulseBpm"></span>'))).toMatchObject({ok: false, refusal: 'fragments'})
  })

  it('names the fragment and a closed-set reason, never the offending text', () => {
    const checked = refusal(injected('cardHR', '<kappa7731-tag></kappa7731-tag>'))
    expect(checked).toEqual({ok: false, refusal: 'fragments', detail: 'cardHR:element'})
  })

  // The second review's reproducers (2026-10-16): each was admitted by the first allowlist.
  /** The fixture with the first `data-book` value replaced by `book` (an object, JSON-encoded and escaped). */
  function withBook(book: Record<string, unknown>): string {
    const value = parsed()
    const encoded = JSON.stringify(book).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    value.fragments.cardBooks = value.fragments.cardBooks.replace(/data-book="[^"]*"/, `data-book="${encoded}"`)
    return JSON.stringify(value)
  }
  const BOOK = {
    title: 'A <i>title</i> & more',
    status: 'reading',
    statusLabel: 'Reading',
    progress: 35,
    pages: 391,
    year: 1993,
    link: 'https://www.amazon.com/dp/X?tag=a&b=c',
    genres: ['g'],
    mainImage: '/images/no-cover.svg',
    mainImageAvif: null
  }

  it('admits a book whose escaped text fields hold markup characters', () => {
    expect(refusal(withBook(BOOK))).toMatchObject({ok: true})
  })

  it.each([
    ['markup in pages, which the Book modal writes into innerHTML', {...BOOK, pages: '<meta http-equiv=refresh content=0;url=https://evil.example/>'}],
    ['markup in year', {...BOOK, year: '<a href=https://evil.example/>x</a>'}],
    ['a status outside the schema enum', {...BOOK, status: 'reading"><img src=x>'}],
    ['a status label that is not a word', {...BOOK, statusLabel: '<b>x</b>'}],
    ['a progress outside 0 to 100', {...BOOK, progress: 1e9}],
    ['a link off the book host', {...BOOK, link: 'https://evil.example/'}],
    ['an off-origin cover', {...BOOK, mainImage: 'https://evil.example/c.jpg'}],
    ['an unknown key', {...BOOK, onclick: 'x'}]
  ])('refuses a data-book with %s', (_label, book) => {
    expect(refusal(withBook(book))).toEqual({ok: false, refusal: 'fragments', detail: 'cardBooks:data'})
  })

  it.each([
    [
      'a class the page styles as a fixed full-viewport layer',
      'cardStarredRepos',
      (f: string) => f.replace('class="tri-card', 'class="glitch-page tri-card'),
      'class'
    ],
    [
      'an overlay root shown in a data artifact',
      'focusOverlay',
      (f: string) => f.replace('<div id="focusOverlay"', '<div id="focusOverlay" style="display: flex"'),
      'root'
    ],
    ['a popover root', 'cardHR', (f: string) => f.replace('<div ', '<div popover '), 'root'],
    ['a styled root', 'cardHR', (f: string) => f.replace('<div ', '<div style="width: 100%" '), 'root'],
    ['an li root', 'cardHR', (f: string) => f.replace(/^<div /, '<li ').replace(/<\/div>$/, '</li>'), 'root'],
    [
      "one of the card's own absolute layers on its root (round 4: the root covered its column)",
      'cardHydration',
      (f: string) => f.replace('class="tri-card', 'class="hydra-v3-bubbles tri-card'),
      'root'
    ],
    [
      'a source age after the composition',
      'cardHR',
      (f: string) => f.replace(/data-generated-at="[^"]*"/, 'data-generated-at="2099-01-01T00:00:00.000Z"'),
      'data'
    ]
  ])('refuses %s', (_label, id, change, reason) => {
    const value = parsed()
    const fragment = value.fragments[id]
    const changed = change(fragment)
    expect(changed).not.toBe(fragment)
    value.fragments[id] = changed
    expect(refusal(JSON.stringify(value))).toEqual({ok: false, refusal: 'fragments', detail: `${id}:${reason}`})
  })

  it.each([
    ['a styled popover', '<div popover style="display: block; width: 100%; height: 100%"></div>', 'style'],
    ['an svg wider than a card', '<svg width="5000" height="5000" viewBox="0 0 1 1"></svg>', 'attribute'],
    ['an image path with an encoded dot segment', '<img src="/images/%2e%2e/api/csp-report" alt="">', 'url'],
    ['a data-plane image with an encoded dot segment', `<img src="${CLOUDFRONT_BASE}/images/%2e%2e/dashboard.json" alt="">`, 'url'],
    ['a same-origin link with an encoded slash', '<a href="/x%2f..%2fy">x</a>', 'url'],
    ['a canvas stroke that is not a paint', '<canvas data-stroke="url(https://evil.example/)"></canvas>', 'data'],
    ['a cover list naming another host', '<div data-local-covers="[&quot;https://evil.example/c.jpg&quot;]"></div>', 'data'],
    ['a data value that is not plain data', '<div data-bpm="72; alert(1)"></div>', 'data'],
    ['an unknown class', '<span class="x-unknown"></span>', 'class']
  ])('refuses %s', (_label, html, reason) => {
    expect(refusal(injected('cardHR', html))).toEqual({ok: false, refusal: 'fragments', detail: `cardHR:${reason}`})
  })

  it('refuses a carrier with markup in its data or an extra attribute', () => {
    const value = parsed()
    const carrier = value.fragments.cardHydration
    value.fragments.cardHydration = carrier.replace('data-hydration-fixture="{', 'data-hydration-fixture="{&quot;x&quot;:&quot;&lt;img&gt;&quot;,')
    expect(refusal(JSON.stringify(value))).toEqual({ok: false, refusal: 'fragments', detail: 'cardHydration:data'})
    value.fragments.cardHydration = carrier.replace(/ hidden><\/div>$/, ' hidden role="status"></div>')
    expect(refusal(JSON.stringify(value))).toEqual({ok: false, refusal: 'fragments', detail: 'cardHydration:carrier'})
  })

  it('refuses nesting deeper than any render, at once', () => {
    const started = performance.now()
    expect(refusal(injected('cardHR', `${'<div>'.repeat(5_000)}${'</div>'.repeat(5_000)}`))).toEqual({
      ok: false,
      refusal: 'fragments',
      detail: 'cardHR:nesting'
    })
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('refuses an artifact over the size cap before parsing it', () => {
    const value = parsed()
    value.fragments.cardHR = value.fragments.cardHR.replace('>', `>${'<span></span>'.repeat(COMPOSED_MAX_BYTES / 13)}`)
    const started = performance.now()
    expect(refusal(JSON.stringify(value))).toEqual({ok: false, refusal: 'oversize'})
    expect(performance.now() - started).toBeLessThan(50)
  })

  // The re-review's reproducers (2026-10-16): each was admitted by the second allowlist.
  it.each([
    [
      'a closed popover shown by an allowed class (an overlay over the main column)',
      'cardStarredRepos',
      '<div popover class="widget-header"><h2 class="widget-label">Sign in</h2></div>',
      'class'
    ],
    ['the System Status tooltip class outside System Status', 'cardHR', '<div popover class="sys-tooltip"></div>', 'class'],
    ["another component's fixed badge class (a Privacy Mode indicator in a card)", 'cardStarredRepos', '<div class="dnd-badge">Privacy Mode</div>', 'class'],
    ['an aria attribute no component emits', 'cardHR', '<span aria-flowto="x"></span>', 'attribute'],
    ['two scoped-style hashes on one element', 'cardHR', '<span data-astro-cid-g2wqwvvr data-astro-cid-odardf2v></span>', 'attribute']
  ])('refuses %s', (_label, id, html, reason) => {
    expect(refusal(injected(id, html))).toEqual({ok: false, refusal: 'fragments', detail: `${id}:${reason}`})
  })

  it('admits the System Status tooltip popover it renders', () => {
    const value = parsed()
    expect(value.fragments.cardSystem).toMatch(/<div[^>]* popover[^>]*>/)
    expect(refusal(ARTIFACT)).toMatchObject({ok: true})
  })

  it('refuses an attribute flood at once, under the size cap', () => {
    const names = Array.from({length: 7_000}, (_, i) => ` aria-${i.toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)] ?? 'a')}`).join('')
    const text = injected('cardHR', `<span${names}></span>`)
    expect(text.length).toBeLessThan(COMPOSED_MAX_BYTES)
    const started = performance.now()
    expect(refusal(text)).toEqual({ok: false, refusal: 'fragments', detail: 'cardHR:attribute'})
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('readComposed refuses an oversize body without decoding it', async () => {
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: fromCloudfront('x'.repeat(COMPOSED_MAX_BYTES + 1))})
    expect(await read(u)).toEqual({kind: 'refused', refusal: 'oversize'})
  })

  it('refuses a hostile value-free page too, at build time (atlas decision 0164 row 1)', () => {
    // The build runs this gate (scripts/build-value-free.mjs); the Worker serves the pages it admitted unchecked.
    const fragments = Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, `<div id="${id}"></div>`]))
    const set = (cardHR: string) => ({
      build: 'b',
      variants: Object.fromEntries(VALUE_FREE_VARIANTS.map((key) => [key, {summary: 'suppressed', fragments: {...fragments, cardHR}}]))
    })
    expect(checkValueFreeSet(set('<div id="cardHR"></div>'), 'b', VALUE_FREE_VARIANTS)).toEqual({ok: false, detail: 'Work:facts'})
    expect(checkValueFreeSet(set('<div id="cardHR"><plaintext></div>'), 'b', VALUE_FREE_VARIANTS)).toEqual({ok: false, detail: 'Work:cardHR:element'})
  })
})

describe('readComposed: the budget split (review 2026-10-16, I1)', () => {
  // covers: dashboard-ssr#The Worker's read spends its whole budget on the focus probe and the artifact
  it('reserves the last-known-good window only for a route that keeps a copy', () => {
    const budget = startBudget(2_500)
    expect(artifactBudget(budget, false).remainingMs()).toBeGreaterThan(2_400)
    expect(artifactBudget(budget, true).remainingMs()).toBeLessThanOrEqual(2_500 - PROXY_TIMEOUTS.lkgReadReserveMs)
  })

  it('gives the artifact read the whole budget after the focus probe: no last-known-good reserve', async () => {
    const slow = () => new Promise<Response>((resolve) => setTimeout(() => resolve(fromCloudfront(ARTIFACT)), 400))
    const {upstream: u} = upstream({[FOCUS_URL]: focus('None'), [ARTIFACT_URL]: slow})
    const result = await readComposed({nowMs: NOW, build: PARSED.composer.build, upstream: u, budgetMs: 1_200})
    expect(result.kind).toBe('ok')
  })
})
