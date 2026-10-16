// @vitest-environment node
//
// The dashboard loader and its privacy matrix (atlas decision 0160, plan Step 6.1). Every branch of
// plan Step 4.2 and of the disclosure model, against a stub data plane that answers like CloudFront:
// raw fixture exports with `x-amz-cf-id`, and the gate's 403 suppression body when it is shut.
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {describe, expect, it} from 'vitest'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {GATED_KEYS, type GatedKey, loadDashboard, LOADER_TIMEOUTS, type LoaderTimeouts} from '../../src/lib/data-plane/loader'
import {summarize, toDashboardRender} from '../../src/lib/data-plane/render-model'

const require = createRequire(import.meta.url)
const BASE = 'https://data-plane.test'
const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const FRESH = new Date(NOW - 60_000).toISOString()
/** Older than every export's `audit.warn` age and its `audit.error` age (books, articles, events: 14 d). */
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()

const FIXTURE_DIRS: Record<GatedKey | 'focus', string> = {
  health: 'health',
  sleep: 'sleep',
  workouts: 'workouts',
  books: 'books',
  githubEvents: 'github-events',
  starredRepos: 'github-starred-repos',
  articles: 'articles',
  theatreReviews: 'theatre-reviews',
  focus: 'focus'
}

function fixture(key: GatedKey | 'focus', variation = 'baseline', generatedAt = FRESH): Record<string, unknown> {
  const raw: Record<string, unknown> = JSON.parse(
    readFileSync(require.resolve(`@j0nathan-ll0yd/fixtures/generated/${FIXTURE_DIRS[key]}/${variation}.json`), 'utf8')
  )
  return {...raw, generatedAt}
}

const SUPPRESSION_BODY = JSON.stringify({suppressed: true, reason: 'focus mode active'})
const CF = {'x-amz-cf-id': 'test-request', 'content-type': 'application/json'}

type Answer = Response | (() => Response | Promise<Response>)

function json(body: unknown, headers: Record<string, string> = CF, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers})
}

function suppressed403(): Response {
  return new Response(SUPPRESSION_BODY, {status: 403, headers: CF})
}

/** A body that never arrives. The response itself does. */
function stalledBody(): Response {
  return new Response(new ReadableStream({pull: () => new Promise(() => {})}), {status: 200, headers: CF})
}

interface Plane {
  fetch: typeof fetch
  requested: string[]
}

/** A stub data plane: each path answers its override, or a fresh baseline export; focus reads `None`. */
function plane(overrides: Partial<Record<GatedKey | 'focus', Answer>> = {}): Plane {
  const requested: string[] = []
  const byPath = new Map<string, GatedKey | 'focus'>(Object.entries(ENDPOINTS).map(([key, path]) => [path, key as GatedKey | 'focus']))
  const stub: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    requested.push(url.pathname)
    // The loader's admission rules depend on these two options.
    expect(init?.cache).toBe('no-store')
    expect(init?.redirect).toBe('manual')
    const key = byPath.get(url.pathname)
    if (!key) {
      return new Response('not found', {status: 404, headers: CF})
    }
    const override = overrides[key]
    if (override) {
      return typeof override === 'function' ? override() : override
    }
    return key === 'focus' ? json({generatedAt: FRESH, currentFocus: 'None'}) : json(fixture(key))
  }
  return {fetch: stub, requested}
}

const QUICK = {focusMs: 200, artifactMs: 300, ioBudgetMs: 400}

function load(p: Plane, timeouts: Partial<LoaderTimeouts> = QUICK) {
  return loadDashboard({base: BASE, fetch: p.fetch, timeouts})
}

/** Every distinctive string of the fresh baseline exports: titles, names, repos. */
function baselineValues(): string[] {
  const values: string[] = []
  const books = fixture('books') as {books: {title: string}[]}
  const articles = fixture('articles') as {articles: {articleTitle: string}[]}
  const starred = fixture('starredRepos') as {repos: {name: string}[]}
  values.push(...books.books.map((b) => b.title), ...articles.articles.map((a) => a.articleTitle), ...starred.repos.map((r) => r.name))
  return values.filter((value) => typeof value === 'string' && value.length > 6)
}

describe('loader: a visible focus signal and a healthy data plane', () => {
  // covers: dashboard-ssr#The server render reads every export through the gate
  it('reads focus first, then all eight exports, with no-store, and admits each one', async () => {
    const p = plane()
    const result = await load(p)
    expect(p.requested[0]).toBe(ENDPOINTS.focus)
    expect(p.requested.slice(1).sort()).toEqual(GATED_KEYS.map((key) => ENDPOINTS[key]).sort())
    expect(result.focus.state).toBe('visible')
    expect(result.suppressed).toBe(false)
    for (const key of GATED_KEYS) {
      expect(result.domains[key].kind, key).toBe('ok')
    }
  })

  it('renders every live card live or empty from fresh exports, and says so in one summary', async () => {
    const render = toDashboardRender(await load(plane()), NOW)
    expect(Object.values(render.cards).every((state) => state === 'live' || state === 'empty')).toBe(true)
    expect(render.summary).toBe('live')
    expect(render.record.summary).toBe('live')
    expect(render.record.degraded).toEqual([])
  })
})

describe('loader: the gate wins every disagreement (disclosure model)', () => {
  const allSuppressed = Object.fromEntries(GATED_KEYS.map((key) => [key, () => suppressed403()]))

  // covers: dashboard-ssr#The gate wins every disagreement
  it('gate shut over a visible signal: every artifact 403 suppresses the whole page', async () => {
    const render = toDashboardRender(await load(plane(allSuppressed)), NOW)
    expect(render.summary).toBe('suppressed')
    expect(Object.values(render.cards).every((state) => state === 'suppressed')).toBe(true)
    expect(render.vm.suppressed).toBe(true)
    // System Status names no source age while suppressed.
    expect(render.vm.systemStatus.system.lines.every((line) => line.suppressed === true)).toBe(true)
  })

  it('failed publication: the signal stays visible and the gate stays shut, so every later render stays suppressed', async () => {
    for (let request = 0; request < 3; request++) {
      expect(toDashboardRender(await load(plane(allSuppressed)), NOW).summary).toBe('suppressed')
    }
  })

  // covers: dashboard-ssr#The gate wins every disagreement
  it('propagation: one artifact 403 while the others answer 200 suppresses everything; no admitted value reaches the view models', async () => {
    const render = toDashboardRender(await load(plane({books: () => suppressed403()})), NOW)
    expect(render.summary).toBe('suppressed')
    for (const key of GATED_KEYS) {
      expect(render.record.domains[key]).toBe('suppressed')
    }
    const serialized = JSON.stringify(render.vm)
    for (const value of baselineValues()) {
      expect(serialized, value).not.toContain(value)
    }
  })

  // covers: dashboard-ssr#The gate wins every disagreement
  it('a hiding focus value suppresses every gated domain and fetches no gated export', async () => {
    for (const currentFocus of ['Work', 'Do Not Disturb']) {
      const p = plane({focus: () => json({generatedAt: FRESH, currentFocus, hidingSince: FRESH})})
      const result = await load(p)
      expect(p.requested).toEqual([ENDPOINTS.focus])
      const render = toDashboardRender(result, NOW)
      expect(render.summary).toBe('suppressed')
      expect(render.record.focus).toBe('hiding')
      expect(render.vm.focusOverlay.currentFocus).toBe(currentFocus)
    }
  })

  it('a hiding value in a body that fails its contract (no hidingSince) still suppresses, as the proxy routes do', async () => {
    const p = plane({focus: () => json({generatedAt: FRESH, currentFocus: 'Work'})})
    const render = toDashboardRender(await load(p), NOW)
    expect(p.requested).toEqual([ENDPOINTS.focus])
    expect(render.summary).toBe('suppressed')
    expect(render.vm.focusOverlay.currentFocus).toBe('Work')
  })

  it('a 403 that is not the suppression body is a refusal for that export only', async () => {
    const result = await load(plane({articles: () => new Response('forbidden', {status: 403, headers: CF})}))
    expect(result.suppressed).toBe(false)
    expect(result.domains.articles).toEqual({kind: 'unavailable', reason: 'http-403'})
    expect(result.domains.books.kind).toBe('ok')
  })
})

describe('loader: an unreadable focus signal fails closed', () => {
  const unreadable: [string, Answer][] = [
    ['an HTTP error', () => new Response('error', {status: 503, headers: CF})],
    ['malformed JSON', () => new Response('{not json', {status: 200, headers: CF})],
    ['a body that fails its contract', () => json({currentFocus: 42})],
    ['a copy Cloudflare served from its own cache', () => json({generatedAt: FRESH, currentFocus: 'None'}, {...CF, 'cf-cache-status': 'HIT'})],
    ['a response without x-amz-cf-id', () => json({generatedAt: FRESH, currentFocus: 'None'}, {'content-type': 'application/json'})],
    ['a stalled body', () => stalledBody()],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))]
  ]

  // covers: dashboard-ssr#An unreadable focus signal fails closed
  it.each(unreadable)('%s: every gated domain is unavailable, and no gated export is fetched', async (_label, answer) => {
    const p = plane({focus: answer})
    const result = await load(p)
    expect(p.requested).toEqual([ENDPOINTS.focus])
    expect(result.focus.state).toBe('unreadable')
    const render = toDashboardRender(result, NOW)
    expect(render.summary).toBe('unavailable')
    expect(Object.values(render.cards).every((state) => state === 'unavailable')).toBe(true)
    expect(render.vm.focusOverlay.currentFocus).toBeNull()
  })
})

describe('loader: admission refuses a 200 that cannot prove it passed the gate', () => {
  // covers: dashboard-ssr#The server render reads every export through the gate
  it.each(['HIT', 'STALE', 'UPDATING', 'REVALIDATED'])('cf-cache-status %s makes that export unavailable', async (status) => {
    const result = await load(plane({health: () => json(fixture('health'), {...CF, 'cf-cache-status': status})}))
    expect(result.domains.health).toEqual({kind: 'unavailable', reason: 'cloudflare-cache'})
    expect(result.domains.sleep.kind).toBe('ok')
  })

  it('a 200 with no x-amz-cf-id is refused', async () => {
    const result = await load(plane({sleep: () => json(fixture('sleep'), {'content-type': 'application/json'})}))
    expect(result.domains.sleep).toEqual({kind: 'unavailable', reason: 'no-cloudfront-id'})
  })

  it('a 2xx other than 200 is refused', async () => {
    const result = await load(plane({workouts: () => new Response(null, {status: 204, headers: CF})}))
    expect(result.domains.workouts).toEqual({kind: 'unavailable', reason: 'non-200-success'})
  })

  it('a redirect is not followed and is refused', async () => {
    const result = await load(plane({books: () => new Response(null, {status: 302, headers: {...CF, location: 'https://elsewhere.test/books.json'}})}))
    expect(result.domains.books).toEqual({kind: 'unavailable', reason: 'http-302'})
  })
})

describe('loader: failures mark one export only, with no retry and no stored copy (D3)', () => {
  // covers: dashboard-ssr#A failed read marks one export, with no retry and no stored copy
  it.each([408, 429, 500, 502, 503, 504])('HTTP %i: that export is unavailable after one attempt', async (status) => {
    const p = plane({githubEvents: () => new Response('error', {status, headers: CF})})
    const result = await load(p)
    expect(result.domains.githubEvents).toEqual({kind: 'unavailable', reason: `http-${status}`})
    expect(p.requested.filter((path) => path === ENDPOINTS.githubEvents)).toHaveLength(1)
    expect(result.domains.articles.kind).toBe('ok')
  })

  it('a timeout and a stalled body are unavailable by the deadline', async () => {
    const started = Date.now()
    const result = await load(plane({starredRepos: () => new Promise<Response>(() => {}), theatreReviews: () => stalledBody()}))
    expect(result.domains.starredRepos).toEqual({kind: 'unavailable', reason: 'timeout'})
    expect(result.domains.theatreReviews).toEqual({kind: 'unavailable', reason: 'timeout'})
    expect(Date.now() - started).toBeLessThan(QUICK.ioBudgetMs + 200)
  })

  it('malformed JSON and a contract violation are decode failures', async () => {
    const result = await load(
      plane({articles: () => new Response('{"generatedAt":', {status: 200, headers: CF}), books: () => json({generatedAt: FRESH, unexpected: true})})
    )
    expect(result.domains.articles).toEqual({kind: 'unavailable', reason: 'decode'})
    expect(result.domains.books).toEqual({kind: 'unavailable', reason: 'decode'})
  })

  it('a mixed result is partial, and the record names each outcome without a value', async () => {
    const render = toDashboardRender(await load(plane({githubEvents: () => new Response('error', {status: 503, headers: CF})})), NOW)
    expect(render.cards.cardDevLog).toBe('unavailable')
    expect(render.summary).toBe('partial')
    expect(render.record.domains.githubEvents).toBe('unavailable:http-503')
    expect(render.record.domains.health).toBe('ok')
  })
})

describe('loader: valid exports render honest states', () => {
  // covers: dashboard-ssr#A missing measurement renders as no reading
  it('a sparse health export renders "no reading" for every missing measurement, never 0', async () => {
    const render = toDashboardRender(await load(plane({health: () => json(fixture('health', 'sparse'))})), NOW)
    const sparse = fixture('health', 'sparse') as {quantities: Record<string, unknown>}
    // The fixture really lacks the two measurements this test is about.
    expect(sparse.quantities.dietaryWater ?? null).toBeNull()
    expect(sparse.quantities.dietaryCaffeine ?? null).toBeNull()
    const hydration = render.vm.hydration.health?.hydration
    // The sparse export carries no water and no caffeine: the view model holds null, not 0.
    expect(hydration?.waterOz).toBeNull()
    expect(hydration?.caffeineMg).toBeNull()
    expect(JSON.stringify(render.vm.movementRings)).not.toMatch(/"exerciseTime":0\b/)
  })

  // covers: dashboard-ssr#Each card renders one honest state
  it('a valid export with an empty list is empty, not a failure', async () => {
    const render = toDashboardRender(await load(plane({githubEvents: () => json(fixture('githubEvents', 'empty'))})), NOW)
    expect(render.cards.cardDevLog).toBe('empty')
    expect(render.summary).toBe('live')
  })

  // covers: dashboard-ssr#Each card renders one honest state
  it('an old source is stale with its generatedAt kept for the "as of" time, and is logged as degraded', async () => {
    const render = toDashboardRender(await load(plane({articles: () => json(fixture('articles', 'baseline', OLD))})), NOW)
    expect(render.cards.cardReading).toBe('stale')
    expect(render.vm.readingFeed.generatedAt).toBe(OLD)
    expect(render.summary).toBe('stale')
    expect(render.record.degraded).toEqual(['articles'])
  })
})

describe('loader: the six-connection queue', () => {
  // covers: dashboard-ssr#Every read ends within the I/O budget
  it('answers by the I/O budget when every export is slow, with each late export unavailable', async () => {
    let open = 0
    const queue: (() => void)[] = []
    // Six open connections at most, like a Worker request; the rest wait for a free slot.
    const slow = (): Promise<Response> =>
      new Promise((resolve) => {
        const start = () => {
          open++
          setTimeout(() => {
            open--
            queue.shift()?.()
            resolve(json(fixture('health')))
          }, 10_000)
        }
        if (open < 6) {
          start()
        } else {
          queue.push(start)
        }
      })
    const overrides = Object.fromEntries(GATED_KEYS.map((key) => [key, slow]))
    const started = Date.now()
    const result = await load(plane(overrides))
    expect(Date.now() - started).toBeLessThan(QUICK.ioBudgetMs + 200)
    expect(GATED_KEYS.every((key) => result.domains[key].kind === 'unavailable')).toBe(true)
    expect(toDashboardRender(result, NOW).summary).toBe('unavailable')
  })

  it('keeps the production bounds of plan Step 4.2: focus 1 s, each export 2 s, all I/O by 2.5 s', () => {
    expect(LOADER_TIMEOUTS).toEqual({focusMs: 1_000, artifactMs: 2_000, ioBudgetMs: 2_500})
  })
})

describe('summarize: the X-SSR-Data rule, first match wins', () => {
  // covers: dashboard-ssr#One summary names the page state
  it.each([
    ['all live', ['live', 'live'], false, 'live'],
    ['all empty', ['empty', 'empty'], false, 'live'],
    ['live and empty', ['live', 'empty'], false, 'live'],
    ['all stale', ['stale', 'stale'], false, 'stale'],
    ['live and stale', ['live', 'stale', 'empty'], false, 'stale'],
    ['mixed with unavailable', ['live', 'unavailable'], false, 'partial'],
    ['all unavailable', ['unavailable', 'unavailable'], false, 'unavailable'],
    ['any suppression signal', ['live', 'live'], true, 'suppressed'],
    ['a suppressed card', ['live', 'suppressed'], false, 'suppressed'],
    ['a loading card', ['live', 'loading'], false, 'partial']
  ] as const)('%s', (_label, cards, suppressed, expected) => {
    expect(summarize(cards, suppressed)).toBe(expected)
  })
})

describe('loader: a gated 403 whose body cannot be read fails closed', () => {
  it('suppresses the page when CloudFront answered 403 and the body stalls', async () => {
    const result = await load(plane({books: () => new Response(new ReadableStream({pull: () => new Promise(() => {})}), {status: 403, headers: CF})}))
    expect(result.suppressed).toBe(true)
    expect(toDashboardRender(result, NOW).summary).toBe('suppressed')
  })

  it('keeps a stalled 403 without x-amz-cf-id a refusal of that export only', async () => {
    const stalled403 = () =>
      new Response(new ReadableStream({pull: () => new Promise(() => {})}), {status: 403, headers: {'content-type': 'application/json'}})
    const result = await load(plane({books: stalled403}))
    expect(result.suppressed).toBe(false)
    expect(result.domains.books).toEqual({kind: 'unavailable', reason: 'http-403'})
  })
})
