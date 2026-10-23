// The composer equals the Astro render (atlas decision 0160, PR B; owner decision 2026-10-16: the
// page is precomposed as the data changes, like llms.txt). For each scenario the BUILT composer
// (dist-composer/composer.mjs, the bundle the backend composer runs) renders the fragments, and Astro
// renders the same view models through the Container API (the oracle, never deployed). Every fragment
// must be byte-identical after attribute ordering (./harness.ts `normalized`), and every scoped-style
// hash in it must be one the website's own built page carries, or the Worker refuses it.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname} from 'node:path'
import {load} from 'cheerio'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {buildId} from '../../scripts/lib/build-id.mjs'
import {beforeAll, describe, expect, it} from 'vitest'
import {
  Bookshelf,
  DevActivityLog,
  DndOverlay,
  FocusOverlay,
  HeartRate,
  Hydration,
  MovementRings,
  NightSummary,
  ReadingFeed,
  StarredRepoList,
  SystemStatus,
  TheatreReviews,
  Workouts
} from '@j0nathan-ll0yd/web/production'
import {
  checkArtifact,
  checkedVariant,
  checkValueFree,
  COMPOSED_FRAGMENT_IDS,
  COMPOSED_MAX_BYTES,
  type ComposedFragmentId,
  GATE_VARIANT,
  toWireFacts,
  UNREADABLE_VARIANT,
  VALUE_FREE_PATH,
  type WireFacts
} from '../../src/lib/composed/artifact'
import {PUBLISHED_MAX_BYTES, type PublishedEntry, type PublishedFragments} from '../../src/lib/composed/published'
import {FRAGMENT_CLASS_TOKENS, FRAGMENT_ROOT_CLASS_TOKENS} from '../../src/lib/composed/fragment-classes'
import {ARIA_ATTRIBUTES, DATA_ATTRIBUTES, HTML_ELEMENTS, LINK_HOSTS, MAX_TITLE, SVG_ELEMENTS} from '../../src/lib/composed/fragment-policy'
import {composableReading} from '../../src/lib/composed/reading-links'
import {READING_LINKS} from '../../src/lib/composed/reading-option'
import {REFUSED_ARTICLE_URLS} from '../shared/refused-article-urls'
import {VALUE_FREE_VARIANTS} from '../../src/lib/composed/value-free'
import {type GatedKey, valueFreeLoad, type ValueFreeState} from '../../src/lib/data-plane/loader'
import {astroContainer, type DomainSpec, fixtureLoad, LOCAL_COVERS, normalized, rawFixture, renderOf} from './harness'

const COMPOSER = new URL('../../dist-composer/composer.mjs', import.meta.url)
const SITE_PAGE = new URL('../../dist/client/index.html', import.meta.url)
const NOW = Date.parse('2026-03-18T12:00:00.000Z')
const FRESH = new Date(NOW - 60_000).toISOString()
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()
const KEYS: GatedKey[] = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews']
const BUILD = buildId()

/**
 * The id of a fragment's first element. The Worker replaces the page element with the fragment's id,
 * so the fragment must BE that element: a fragment keyed on an inner id would nest the component
 * inside itself (it did, for System Status: root #cardSystem, inner #systemStatus).
 */
function rootId(fragment: string): string | undefined {
  return load(fragment, null, false).root().children().filter((_, node) => node.type === 'tag').first().attr('id')
}

/**
 * The top-level nodes of a fragment beside its root, other than whitespace and the component's own
 * hidden data carrier (`#<id>Data[hidden]`, which Hydration emits in a data state for the browser to
 * draw its bands). Anything else is foreign: the container once appended a module script whose `src`
 * named this machine's path.
 */
function besideRoot(fragment: string, id: string): string[] {
  const nodes = load(fragment, null, false).root().contents().toArray().filter((node) => node.type !== 'text' || (node.data ?? '').trim() !== '')
  return nodes.slice(1).filter((node) => !(node.type === 'tag' && node.attribs.id === `${id}Data` && 'hidden' in node.attribs)).map((node) =>
    node.type === 'tag' || node.type === 'script' || node.type === 'style' ? `${node.type}:${node.name}#${node.attribs?.id ?? ''}` : node.type
  )
}

/**
 * Tag and first class: the element's kind. Later classes are state (`is-loading`) or data-driven
 * (`tri-card-accent-red` at a heart-rate peak) and differ by design.
 */
function shape(tag: string | undefined, classes: string | undefined): string {
  return `${tag ?? 'missing'}.${(classes ?? '').split(/\s+/)[0] ?? ''}`
}

/** The shape of the page's element with `id`: the element a fragment replaces. */
function pageElement(id: string): string {
  const element = sitePage(`#${id}`)
  return shape(element.prop('tagName'), element.attr('class'))
}

function fragmentElement(fragment: string, id: string): string {
  const element = load(fragment, null, false)(`#${id}`).first()
  return shape(element.prop('tagName'), element.attr('class'))
}

const ORACLE = {
  focusOverlay: [FocusOverlay, 'focusOverlay'],
  dndOverlay: [DndOverlay, 'dndOverlay'],
  cardSystem: [SystemStatus, 'systemStatus'],
  cardHR: [HeartRate, 'heartRate'],
  cardMovement: [MovementRings, 'movementRings'],
  cardHydration: [Hydration, 'hydration'],
  cardSleep: [NightSummary, 'nightSummary'],
  cardWorkouts: [Workouts, 'workouts'],
  cardDevLog: [DevActivityLog, 'devActivityLog'],
  cardReading: [ReadingFeed, 'readingFeed'],
  cardStarredRepos: [StarredRepoList, 'starredRepoList'],
  cardBooks: [Bookshelf, 'bookshelf'],
  cardTheatreReviews: [TheatreReviews, 'theatreReviews']
} as const

type ValueFreeSet = {build: string; variants: Record<string, {summary: string; fragments: Record<string, string>; facts: WireFacts}>}
type ComposeValueFree = (input: {localCovers: readonly string[]}) => Promise<ValueFreeSet>
let composeValueFree: ComposeValueFree
type ComposeDashboard = (options: {fetch?: typeof fetch; nowMs?: number; base?: string}) => Promise<
  {ok: true; artifact: {composer: {build: string}; summary: string; fragments: Record<string, string>}; body: string} | {ok: false; refusal: string}
>
let composeDashboard: ComposeDashboard
let publishedEntry: (source: PublishedFragments, composedAt: string) => PublishedEntry
let COMPOSER_CONTRACT: number
let COMPOSER_BUILD: string
type Compose = (input: unknown) => Promise<{ok: true; artifact: {fragments: Record<string, string>; summary: string}} | {ok: false; refusal: string}>
let compose: Compose
let container: Awaited<ReturnType<typeof astroContainer>>
let siteScopes: Set<string>
let sitePage: ReturnType<typeof load>

beforeAll(async () => {
  if (!existsSync(COMPOSER)) {
    throw new Error('dist-composer/composer.mjs is missing: run node scripts/build-composer.mjs')
  }
  ;({compose, composeValueFree, composeDashboard, publishedEntry, COMPOSER_CONTRACT, COMPOSER_BUILD} = (await import(COMPOSER.href)) as {
    compose: Compose
    composeValueFree: ComposeValueFree
    composeDashboard: ComposeDashboard
    publishedEntry: typeof publishedEntry
    COMPOSER_CONTRACT: number
    COMPOSER_BUILD: string
  })
  container = await astroContainer()
  const site = readFileSync(SITE_PAGE, 'utf8')
  siteScopes = new Set(site.match(/data-astro-cid-[a-z0-9]+/g) ?? [])
  sitePage = load(site)
}, 120_000)

const SCENARIOS: [string, Partial<Record<GatedKey, DomainSpec>>][] = [
  ['baseline, fresh', {}],
  ['full exports', Object.fromEntries(KEYS.map((k) => [k, {variation: 'full'}]))],
  ['known answer', Object.fromEntries(KEYS.map((k) => [k, {variation: 'ssrKnownAnswer'}]))],
  ['empty exports', Object.fromEntries(KEYS.map((k) => [k, {variation: 'empty'}]))],
  ['stale exports', Object.fromEntries(KEYS.map((k) => [k, {variation: 'baseline', generatedAt: OLD}]))],
  ['every export unavailable', Object.fromEntries(KEYS.map((k) => [k, 'unavailable']))],
  ['one export unavailable (partial)', {books: 'unavailable'}],
  ['sparse health', {health: {variation: 'sparse'}}],
  ['watch charging', {health: {variation: 'pausedCharging'}}],
  ['watch off the wrist', {health: {variation: 'pausedHrGap'}}],
  ['heart-rate peak', {health: {variation: 'peak'}}],
  ['heart-rate fat burn (the amber accent)', {health: {variation: 'fatBurn'}}],
  ['zero hydration', {health: {variation: 'zeroHydration'}}],
  ['missing optional health', {health: {variation: 'missingOptional'}}],
  ['long sleep', {sleep: {variation: 'longSleep'}}],
  ['multiple workouts', {workouts: {variation: 'multiWorkout'}}],
  ['workouts without distance', {workouts: {variation: 'noDistance'}}],
  ["a Barry's Bootcamp workout (the share.barrys.com link)", {workouts: {variation: 'barrysBootcamp'}}],
  ['commits only', {githubEvents: {variation: 'commitsOnly'}}],
  ['over ten events', {githubEvents: {variation: 'overTen'}}],
  ['old starred repos', {starredRepos: {variation: 'oldTimestamp'}}],
  ['articles with notes', {articles: {variation: 'withNotes'}}],
  ['over thirty articles', {articles: {variation: 'overThirty'}}],
  ['books all completed', {books: {variation: 'allCompleted'}}],
  ['books without covers', {books: {variation: 'noCovers'}}],
  ['books in series', {books: {variation: 'seriesBooks'}}],
  [
    'a pending book (the fourth status in the books schema enum)',
    {
      books: {
        variation: 'baseline',
        change: (raw) => {
          ;(raw.books as {status: string}[])[0]!.status = 'pending'
        }
      }
    }
  ],
  [
    'books with CloudFront covers, not mirrored',
    {
      books: {
        variation: 'baseline',
        change: (raw) => {
          const book = (raw.books as Record<string, unknown>[])[0]!
          for (const field of ['mainImage', 'mainImageCard', 'mainImageThumb', 'mainImageAvif', 'mainImageCardAvif', 'mainImageThumbAvif']) {
            book[field] = `${CLOUDFRONT_BASE}/images/books/unmirrored-${field}.${field.endsWith('Avif') ? 'avif' : 'webp'}`
          }
        }
      }
    }
  ],
  [
    'books with mirrored covers',
    {
      books: {
        variation: 'baseline',
        change: (raw) => {
          const book = (raw.books as Record<string, unknown>[])[0]!
          const cover = (suffix: string) => LOCAL_COVERS.find((path) => path.endsWith(suffix))
          book.mainImageCard = `${CLOUDFRONT_BASE}${cover('-card.webp')}`
          book.mainImageThumb = `${CLOUDFRONT_BASE}${cover('-thumb.webp')}`
          book.mainImageCardAvif = `${CLOUDFRONT_BASE}${cover('-card.avif')}`
          book.mainImageThumbAvif = `${CLOUDFRONT_BASE}${cover('-thumb.avif')}`
        }
      }
    }
  ],
  ['theatre without images', {theatreReviews: {variation: 'noImages'}}],
  ['theatre every grade', {theatreReviews: {variation: 'allGrades'}}],
  [
    'values that need escaping',
    {
      books: {
        variation: 'baseline',
        change: (raw) => {
          const books = raw.books as {title: string; author: string}[]
          books[0]!.title = 'A & B <i>"quoted"</i> &amp; \'apos\''
          books[0]!.author = 'X &lt;Y&gt;'
        }
      },
      theatreReviews: {
        variation: 'baseline',
        change: (raw) => {
          const reviews = raw.reviews as {title: string; url: string}[]
          reviews[0]!.title = 'Q & A <script>alert(1)</script> &amp;'
          reviews[0]!.url = 'https://www.coasttocoastreviews.com/x?a=1&b=2&amp;c'
        }
      }
    }
  ]
]

describe('the composer equals the Astro render', () => {
  it.each(SCENARIOS)('%s', async (_label, domains) => {
    const exports = Object.fromEntries(KEYS.map((key) => {
      const spec = domains[key] ?? {variation: 'baseline'}
      if (spec === 'unavailable' || spec === 'suppressed') {
        return [key, null]
      }
      const raw = rawFixture(key, spec.variation, spec.change)
      raw.generatedAt = spec.generatedAt ?? FRESH
      return [key, raw]
    }))
    const result = await compose({exports, focus: {generatedAt: FRESH, currentFocus: 'None'}, nowMs: NOW, localCovers: LOCAL_COVERS})
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const render = renderOf(fixtureLoad('None', domains, FRESH), NOW)
    expect(result.artifact.summary).toBe(render.summary)
    for (const id of COMPOSED_FRAGMENT_IDS) {
      const [Component, model] = ORACLE[id]
      const props = id === 'cardBooks'
        ? {...render.vm.bookshelf, localCovers: LOCAL_COVERS}
        : id === 'cardReading'
        ? composableReading(render.vm.readingFeed)
        : render.vm[model]
      const oracle = await container.renderToString(Component as Parameters<typeof container.renderToString>[0], {props: props as Record<string, unknown>})
      const fragment = result.artifact.fragments[id] ?? ''
      expect(rootId(fragment), `${id} is its component's root`).toBe(id)
      expect(besideRoot(fragment, id), `${id} is its root element, with nothing foreign beside it`).toEqual([])
      expect(fragment, `${id} carries no script`).not.toMatch(/<script\b/i)
      expect(fragmentElement(fragment, id), `${id} replaces the same element`).toBe(pageElement(id))
      expect(normalized(fragment, `#${id}`), id).toBe(normalized(oracle, `#${id}`))
      for (const scope of fragment.match(/data-astro-cid-[a-z0-9]+/g) ?? []) {
        expect(siteScopes.has(scope), `${id}: ${scope} is not in the website's page`).toBe(true)
      }
    }
  })

  it('publishes nothing under a hiding or unreadable focus value', async () => {
    for (const currentFocus of ['Work', 'Do Not Disturb']) {
      const result = await compose({exports: {}, focus: {generatedAt: FRESH, currentFocus, hidingSince: FRESH}, nowMs: NOW, localCovers: LOCAL_COVERS})
      expect(result).toEqual({ok: false, refusal: 'hiding', currentFocus})
    }
    expect(await compose({exports: {}, focus: {currentFocus: 42}, nowMs: NOW, localCovers: LOCAL_COVERS})).toEqual({ok: false, refusal: 'focus-unreadable'})
  })
})

const VALUE_FREE_STATES: Record<string, ValueFreeState> = {
  Work: {kind: 'hiding', currentFocus: 'Work'},
  'Do Not Disturb': {kind: 'hiding', currentFocus: 'Do Not Disturb'},
  [GATE_VARIANT]: {kind: 'gate', currentFocus: 'None'},
  [UNREADABLE_VARIANT]: {kind: 'unreadable', reason: 'focus-unreadable'}
}

describe('the value-free pages equal the Astro render and hold no value', () => {
  let set: ValueFreeSet
  beforeAll(async () => {
    set = await composeValueFree({localCovers: LOCAL_COVERS})
  }, 120_000)

  it('composes exactly the variants the Worker asks for', () => {
    expect(Object.keys(set.variants).sort()).toEqual([...VALUE_FREE_VARIANTS].sort())
    expect(Object.keys(VALUE_FREE_STATES).sort()).toEqual([...VALUE_FREE_VARIANTS].sort())
    expect(set.build).toBe(BUILD)
  })

  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it.each(Object.entries(VALUE_FREE_STATES))('%s', async (key, state) => {
    const page = set.variants[key]
    const render = renderOf(valueFreeLoad(state), NOW)
    expect(page?.summary).toBe(render.summary)
    // The overlay clock is the browser's (clock.js); the build leaves its placeholder.
    const vm = {...render.vm, focusOverlay: {...render.vm.focusOverlay, now: ''}, dndOverlay: {...render.vm.dndOverlay, now: ''}}
    for (const id of COMPOSED_FRAGMENT_IDS) {
      const [Component, model] = ORACLE[id]
      const props = id === 'cardBooks' ? {...vm.bookshelf, localCovers: LOCAL_COVERS} : id === 'cardReading' ? composableReading(vm.readingFeed) : vm[model]
      const oracle = await container.renderToString(Component as Parameters<typeof container.renderToString>[0], {props: props as Record<string, unknown>})
      const fragment = page?.fragments[id] ?? ''
      expect(rootId(fragment), `${id} is its component's root`).toBe(id)
      expect(besideRoot(fragment, id), `${id} is its root element, with nothing foreign beside it`).toEqual([])
      expect(fragment, `${id} carries no script`).not.toMatch(/<script\b/i)
      expect(fragmentElement(fragment, id), `${id} replaces the same element`).toBe(pageElement(id))
      expect(normalized(fragment, `#${id}`), id).toBe(normalized(oracle, `#${id}`))
      expect(fragment, `${id} names no source age`).not.toContain('data-generated-at')
      for (const scope of fragment.match(/data-astro-cid-[a-z0-9]+/g) ?? []) {
        expect(siteScopes.has(scope), `${id}: ${scope} is not in the website's page`).toBe(true)
      }
    }
    const cardStates = COMPOSED_FRAGMENT_IDS.filter((id) => id.startsWith('card') && id !== 'cardSystem').map((id) =>
      /data-ssr-state="([a-z]+)"/.exec(page?.fragments[id] ?? '')?.[1]
    )
    expect(new Set(cardStates)).toEqual(new Set([state.kind === 'unreadable' ? 'unavailable' : 'suppressed']))
    const shown = (id: string) => /style="display: flex"/.test(page?.fragments[id] ?? '')
    expect(shown('focusOverlay'), 'Work overlay').toBe(key === 'Work')
    expect(shown('dndOverlay'), 'Do Not Disturb overlay').toBe(key === 'Do Not Disturb')
    // atlas decision 0164: the runner publishes this page's facts while hiding; they are the Worker's own check.
    const checked = page === undefined
      ? null
      : checkedVariant({page: {summary: page.summary as 'suppressed' | 'unavailable', fragments: page.fragments as Record<ComposedFragmentId, string>}})
    expect(checked && toWireFacts(checked.facts)).toEqual(page?.facts)
  })

  it('is what the website build shipped', () => {
    const built = readFileSync(new URL(`../../dist/client${VALUE_FREE_PATH}`, import.meta.url), 'utf8')
    expect(JSON.parse(built)).toEqual(set)
  })
})

describe('composeDashboard: the runner entry (owner decision 2026-10-16, the live site supplies the composer)', () => {
  const KEY_BY_PATH = Object.fromEntries(Object.entries(ENDPOINTS).map(([key, path]) => [path, key])) as Record<string, GatedKey | 'focus'>

  /** A public data plane answering like CloudFront: each export from its baseline fixture, stamped fresh. */
  function dataPlane(answer: (key: GatedKey | 'focus', call: number) => Response | null = () => null) {
    const calls: string[] = []
    const fetchStub = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const key = KEY_BY_PATH[path]
      calls.push(path)
      const own = key ? answer(key, calls.filter((p) => p === path).length) : null
      if (own) {
        return own
      }
      if (!key) {
        return new Response('{}', {status: 404, headers: {'x-amz-cf-id': 'test'}})
      }
      const raw = key === 'focus' ? {generatedAt: FRESH, currentFocus: 'None'} : {...rawFixture(key, 'baseline'), generatedAt: FRESH}
      return new Response(JSON.stringify(raw), {headers: {'content-type': 'application/json', 'x-amz-cf-id': 'test'}})
    }) as typeof fetch
    return {calls, fetch: fetchStub}
  }

  it('exports the contract version and this build', () => {
    expect(COMPOSER_CONTRACT).toBe(1)
    expect(COMPOSER_BUILD).toBe(BUILD)
  })

  // atlas decision 0164: the runner and the focus writer encode the KV values with the website's own code.
  it('exports the KV contract: both keys, the TTL and both encoders', async () => {
    const module = (await import(COMPOSER.href)) as Record<string, unknown>
    expect(module.PUBLISHED_FOCUS_KEY).toBe('focus')
    expect(module.PUBLISHED_TTL_S).toBe(690)
    expect((module.publishedFragmentsKey as (build: string) => string)(BUILD)).toBe(`fragments:${BUILD}`)
    expect(typeof module.publishedFocusValue).toBe('function')
    expect(typeof module.publishedEntry).toBe('function')
  })

  it('reads the public data plane, composes, and stamps this build', async () => {
    const plane = dataPlane()
    const result = await composeDashboard({fetch: plane.fetch, nowMs: NOW})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.artifact.composer.build).toBe(BUILD)
      expect(result.artifact.summary).toBe('live')
      expect(JSON.parse(result.body)).toEqual(result.artifact)
    }
    expect(plane.calls.every((path) => path.startsWith('/'))).toBe(true)
    expect(plane.calls.filter((path) => path === ENDPOINTS.focus)).toHaveLength(2)
  })

  // atlas decision 0164: the body gains `facts` (an added field, so the contract stays 1), and the
  // composer encodes the KV entry the runner publishes from it.
  it('returns the facts in the body, and encodes the fragments:<build> entry from it', async () => {
    const result = await composeDashboard({fetch: dataPlane().fetch, nowMs: NOW})
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const body = JSON.parse(result.body) as {
      composedAt: string
      summary: PublishedFragments['summary']
      fragments: PublishedFragments['fragments']
      facts: WireFacts
    }
    expect(Object.keys(body.facts.scopes)).toEqual([...COMPOSED_FRAGMENT_IDS])
    expect(Object.keys(body.facts.roots)).toEqual([...COMPOSED_FRAGMENT_IDS])
    const entry = publishedEntry(body, body.composedAt)
    expect(entry.key).toBe(`fragments:${BUILD}`)
    expect(entry.metadata).toEqual({build: BUILD, composedAt: body.composedAt, summary: body.summary})
    expect(JSON.parse(entry.value)).toEqual({fragments: body.fragments, facts: body.facts, summary: body.summary})
    expect(new TextEncoder().encode(entry.value).byteLength).toBeLessThan(PUBLISHED_MAX_BYTES)
  })

  it('reads CloudFront by default', async () => {
    const seen: string[] = []
    const plane = dataPlane()
    await composeDashboard({
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => (seen.push(String(input)), plane.fetch(input, init))) as typeof fetch,
      nowMs: NOW
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((url) => url.startsWith(`${CLOUDFRONT_BASE}/`))).toBe(true)
  })

  it.each(['Work', 'Do Not Disturb'])('publishes nothing and reads no export under %s', async (mode) => {
    const plane = dataPlane((key) =>
      key === 'focus' ? new Response(JSON.stringify({generatedAt: FRESH, currentFocus: mode, hidingSince: FRESH}), {headers: {'x-amz-cf-id': 'test'}}) : null
    )
    expect(await composeDashboard({fetch: plane.fetch, nowMs: NOW})).toEqual({ok: false, refusal: 'hiding', currentFocus: mode})
    expect(plane.calls).toEqual([ENDPOINTS.focus])
  })

  it('publishes nothing when the focus signal cannot be read', async () => {
    const plane = dataPlane((key) => (key === 'focus' ? new Response('{}', {status: 503, headers: {'x-amz-cf-id': 'test'}}) : null))
    expect(await composeDashboard({fetch: plane.fetch, nowMs: NOW})).toEqual({ok: false, refusal: 'focus-unreadable'})
  })

  it('publishes nothing when the gate is shut over a visible value', async () => {
    const plane = dataPlane((key) =>
      key === 'books' ? new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403, headers: {'x-amz-cf-id': 'test'}}) : null
    )
    expect(await composeDashboard({fetch: plane.fetch, nowMs: NOW})).toEqual({ok: false, refusal: 'suppressed'})
  })

  // covers: dashboard-ssr#A composition never outlives a focus change or a site deploy
  it('privacy race (a): focus turns hiding while the page renders, so nothing is published', async () => {
    const plane = dataPlane((key, call) =>
      key === 'focus' && call === 2
        ? new Response(JSON.stringify({generatedAt: FRESH, currentFocus: 'Work', hidingSince: FRESH}), {headers: {'x-amz-cf-id': 'test'}})
        : null
    )
    expect(await composeDashboard({fetch: plane.fetch, nowMs: NOW})).toEqual({ok: false, refusal: 'focus-changed'})
  })

  it('refuses when the visible focus value changes during the render (review L6)', async () => {
    const plane = dataPlane((key, call) =>
      key === 'focus' && call === 2 ? new Response(JSON.stringify({generatedAt: FRESH, currentFocus: 'Personal'}), {headers: {'x-amz-cf-id': 'test'}}) : null
    )
    expect(await composeDashboard({fetch: plane.fetch, nowMs: NOW})).toEqual({ok: false, refusal: 'focus-changed'})
  })
})

describe("the Worker's fragment allowlist admits every render, and names nothing the renders do not use (review 2026-10-16, H1)", () => {
  const used = {
    elements: new Set<string>(),
    data: new Set<string>(),
    hosts: new Set<string>(),
    ids: new Set<string>(),
    aria: new Set<string>(),
    classes: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set<string>()])) as Record<ComposedFragmentId, Set<string>>,
    scopes: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set<string>()])) as Record<ComposedFragmentId, Set<string>>,
    rootClasses: Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, new Set<string>()])) as Record<ComposedFragmentId, Set<string>>,
    maxBytes: 0,
    rootMismatches: [] as string[]
  }

  function record(id: ComposedFragmentId, fragment: string): void {
    const $ = load(fragment, {xml: false}, false)
    // The root keeps its slot root's scoped-style hash (src/lib/composed/shell.ts fitsShell, `root`).
    const rootAttribs = $.root().children().first().attr() ?? {}
    for (const token of (rootAttribs.class ?? '').split(/\s+/).filter(Boolean)) {
      used.rootClasses[id].add(token)
    }
    for (const name of Object.keys(sitePage(`#${id}`).attr() ?? {}).filter((attr) => attr.startsWith('data-astro-cid-'))) {
      if (!(name in rootAttribs)) {
        used.rootMismatches.push(`${id} root lacks ${name}`)
      }
    }
    $('*').each((_, node) => {
      if (node.type !== 'tag') {
        return
      }
      used.elements.add(node.name)
      if (node.attribs.id !== undefined) {
        used.ids.add(node.attribs.id)
      }
      for (const token of (node.attribs.class ?? '').split(/\s+/)) {
        if (token !== '') {
          used.classes[id].add(token)
        }
      }
      for (const [name, value] of Object.entries(node.attribs)) {
        if (name.startsWith('data-astro-cid-')) {
          used.scopes[id].add(name)
        } else if (name.startsWith('data-')) {
          used.data.add(name)
        } else if (name.startsWith('aria-')) {
          used.aria.add(name)
        }
        if (name === 'href' && value.startsWith('https://')) {
          used.hosts.add(new URL(value).hostname)
        }
      }
    })
  }

  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it('admits the artifact of every scenario, through checkArtifact', async () => {
    for (const [label, domains] of SCENARIOS) {
      const exports = Object.fromEntries(KEYS.map((key) => {
        const spec = domains[key] ?? {variation: 'baseline'}
        if (spec === 'unavailable' || spec === 'suppressed') {
          return [key, null]
        }
        const raw = rawFixture(key, spec.variation, spec.change)
        raw.generatedAt = spec.generatedAt ?? FRESH
        return [key, raw]
      }))
      const result = await compose({exports, focus: {generatedAt: FRESH, currentFocus: 'None'}, nowMs: NOW, localCovers: LOCAL_COVERS})
      expect(result.ok, label).toBe(true)
      if (!result.ok) {
        continue
      }
      const artifact = result.artifact as unknown as {composedAt: string; composer: {build: string}; fragments: Record<string, string>; facts: WireFacts}
      const checked = checkArtifact(JSON.stringify(artifact), Date.parse(artifact.composedAt), artifact.composer.build, new Set(HIDING_FOCUS_MODES))
      expect(checked, label).toMatchObject({ok: true})
      // atlas decision 0164: the facts the composer publishes are the Worker's own check of its fragments.
      expect(checked.ok && toWireFacts(checked.facts), label).toEqual(artifact.facts)
      used.maxBytes = Math.max(used.maxBytes, JSON.stringify(artifact).length)
      for (const id of COMPOSED_FRAGMENT_IDS) {
        record(id, artifact.fragments[id] ?? '')
      }
    }
  })

  // The scenarios above name the variations parity needs; this sweep composes EVERY variation the
  // fixtures package ships, one export at a time, so a data-driven class or link no scenario names
  // (the fat-burn accent and the Barry's link both refused the page before this sweep) reds here.
  it('admits every fixture variation of every export, through checkArtifact', async () => {
    const require = createRequire(import.meta.url)
    let composed = 0
    for (const key of KEYS) {
      const dir = dirname(require.resolve(`@j0nathan-ll0yd/fixtures/generated/${ENDPOINTS[key].replace(/^\//, '').replace(/\.json$/, '')}/baseline.json`))
      for (const variation of readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length))) {
        const exports = Object.fromEntries(KEYS.map((other) => {
          const raw = rawFixture(other, other === key ? variation : 'baseline')
          raw.generatedAt = FRESH
          return [other, raw]
        }))
        const label = `${key}/${variation}`
        const result = await compose({exports, focus: {generatedAt: FRESH, currentFocus: 'None'}, nowMs: NOW, localCovers: LOCAL_COVERS}).catch((
          error: Error
        ) => ({ok: false as const, refusal: error.message}))
        expect(result, label).toMatchObject({ok: true})
        if (!result.ok) {
          continue
        }
        const artifact = result.artifact as unknown as {composedAt: string; composer: {build: string}; fragments: Record<string, string>; facts: WireFacts}
        const checked = checkArtifact(JSON.stringify(artifact), Date.parse(artifact.composedAt), artifact.composer.build, new Set(HIDING_FOCUS_MODES))
        expect(checked, label).toMatchObject({ok: true})
        // atlas decision 0164: the facts the composer publishes are the Worker's own check of its fragments.
        expect(checked.ok && toWireFacts(checked.facts), label).toEqual(artifact.facts)
        used.maxBytes = Math.max(used.maxBytes, JSON.stringify(artifact).length)
        for (const id of COMPOSED_FRAGMENT_IDS) {
          record(id, artifact.fragments[id] ?? '')
        }
        composed++
      }
    }
    expect(composed).toBeGreaterThan(KEYS.length)
  })

  it('admits the value-free set the website build shipped', () => {
    const built = readFileSync(new URL(`../../dist/client${VALUE_FREE_PATH}`, import.meta.url), 'utf8')
    const set = checkValueFree(built, BUILD, VALUE_FREE_VARIANTS)
    expect(set).not.toBeNull()
    for (const page of Object.values((JSON.parse(built) as ValueFreeSet).variants)) {
      for (const id of COMPOSED_FRAGMENT_IDS) {
        record(id, page.fragments[id] ?? '')
      }
    }
  })

  it('admits the committed fixture artifact', () => {
    const text = readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')
    const value = JSON.parse(text) as {composedAt: string; composer: {build: string}}
    expect(checkArtifact(text, Date.parse(value.composedAt), value.composer.build, new Set(HIDING_FOCUS_MODES))).toMatchObject({ok: true})
  })

  it('allowlists only elements, data attributes and link hosts the renders use', () => {
    const allowed = [...Object.keys(HTML_ELEMENTS), ...Object.keys(SVG_ELEMENTS)].sort()
    expect(allowed.filter((name) => !used.elements.has(name)), 'allowlisted elements no render uses').toEqual([])
    expect([...DATA_ATTRIBUTES].filter((name) => !used.data.has(name)), 'allowlisted data attributes no render uses').toEqual([])
    expect([...LINK_HOSTS].filter((host) => !used.hosts.has(host)), 'allowlisted link hosts no render uses').toEqual([])
    for (const id of COMPOSED_FRAGMENT_IDS) {
      expect([...FRAGMENT_CLASS_TOKENS[id]].filter((token) => !used.classes[id].has(token)), `${id}: allowlisted class tokens no render uses`).toEqual([])
      expect([...used.classes[id]].filter((token) => !FRAGMENT_CLASS_TOKENS[id].has(token)), `${id}: class tokens a render uses that the allowlist lacks`)
        .toEqual([])
      expect([...used.rootClasses[id]].sort(), `${id}: root class tokens`).toEqual([...FRAGMENT_ROOT_CLASS_TOKENS[id]].sort())
    }
    expect([...ARIA_ATTRIBUTES].filter((name) => !used.aria.has(name)), 'allowlisted aria attributes no render uses').toEqual([])
  })

  it("carries only its own slot's scoped-style hashes (src/lib/composed/shell.ts fitsShell)", () => {
    const page = load(readFileSync(SITE_PAGE, 'utf8'))
    for (const id of COMPOSED_FRAGMENT_IDS) {
      const slot = new Set(page.html(page(`#${id}`)).match(/data-astro-cid-[a-z0-9]+/g) ?? [])
      expect([...used.scopes[id]].filter((scope) => !slot.has(scope)), `${id}: hashes its slot in the data-free page lacks`).toEqual([])
    }
    expect(used.rootMismatches).toEqual([])
  })

  it('stays under the size cap with room to spare', () => {
    expect(used.maxBytes).toBeGreaterThan(0)
    expect(used.maxBytes).toBeLessThan(COMPOSED_MAX_BYTES * 0.75)
  })

  it("carries no id the website's page keeps outside the replaced elements (src/lib/composed/shell.ts fitsShell)", () => {
    const page = load(readFileSync(SITE_PAGE, 'utf8'))
    for (const id of COMPOSED_FRAGMENT_IDS) {
      page(`#${id}`).remove()
    }
    const shellIds = new Set(page('[id]').map((_, element) => page(element).attr('id')).get())
    expect(shellIds.size).toBeGreaterThan(0)
    expect(used.ids.size).toBeGreaterThan(COMPOSED_FRAGMENT_IDS.length)
    expect([...used.ids].filter((id) => shellIds.has(id))).toEqual([])
  })
})

// One article the Worker would refuse must never turn the composed page off (review of #386, M):
// the BUILT composer degrades the link to the title as text and cuts an over-long note title, the
// artifact passes the Worker's check, and the Reading card keeps every row.
describe('the composer degrades a Reading link or note the Worker would refuse (src/lib/composed/reading-links.ts)', () => {
  /** The composed artifact with the known-answer articles, the first one changed by `change`. */
  async function composeArticles(change: (article: Record<string, unknown>) => void) {
    const articles = rawFixture('articles', 'ssrKnownAnswer', (raw) => change((raw.articles as Record<string, unknown>[])[0]!))
    articles.generatedAt = FRESH
    const exports = Object.fromEntries(KEYS.map((key) => {
      const raw = key === 'articles' ? articles : rawFixture(key, 'baseline')
      raw.generatedAt = FRESH
      return [key, raw]
    }))
    const result = await compose({exports, focus: {generatedAt: FRESH, currentFocus: 'None'}, nowMs: NOW, localCovers: LOCAL_COVERS})
    expect(result.ok).toBe(true)
    const artifact = (result as {artifact: {composedAt: string; composer: {build: string}; fragments: Record<string, string>}}).artifact
    const checked = checkArtifact(JSON.stringify(artifact), Date.parse(artifact.composedAt), artifact.composer.build, new Set(HIDING_FOCUS_MODES))
    expect(checked).toMatchObject({ok: true})
    return {articles: articles.articles as {articleTitle: string; articleUrl: string}[], reading: load(artifact.fragments.cardReading ?? '', null, false)}
  }

  it.each(REFUSED_ARTICLE_URLS)('renders an article URL with %s as a span with the same text, in an admitted artifact', async (_label, url) => {
    const {articles, reading} = await composeArticles((article) => {
      article.articleUrl = url
    })
    expect(reading('#cardReading').attr('data-ssr-state'), 'the card is live: the export decoded').toBe('live')
    expect(reading('.article-list-item')).toHaveLength(articles.length)
    const first = reading('.article-list-item').first().find('.article-list-title')
    expect(first.prop('tagName')).toBe('SPAN')
    expect(first.text()).toBe(articles[0]!.articleTitle)
    expect(first.attr('href')).toBeUndefined()
    // The other rows keep their links (option A).
    expect(reading('a.article-list-title')).toHaveLength(READING_LINKS === 'allow' ? articles.length - 1 : 0)
  })

  it('cuts a joined note title above MAX_TITLE, in an admitted artifact', async () => {
    const {reading} = await composeArticles((article) => {
      article.notes = [{comment: 'n'.repeat(MAX_TITLE), createdAt: FRESH}, {comment: 'more', createdAt: FRESH}]
    })
    const title = reading('.article-list-note').first().attr('title') ?? ''
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE)
    expect(title.endsWith('…')).toBe(true)
  })
})

// Byte stability (atlas decision 0164; design-system-Lifegames #317): the same exports composed at two
// clocks 10 minutes apart give byte-equal fragments, so the LP runner can skip a KV write whose value
// did not change. Since @j0nathan-ll0yd/web 4.4.0 the server markup prints absolute times and the
// browser fills the relative labels (src/lib/runtime/live-data.ts fillRelativeTimes).
describe('byte stability across the composition clock (atlas decision 0164)', () => {
  it('composes byte-equal fragments 10 minutes apart', async () => {
    const exportsFor = () => Object.fromEntries(KEYS.map((key) => [key, {...rawFixture(key, 'ssrKnownAnswer'), generatedAt: FRESH}]))
    const focus = {generatedAt: FRESH, currentFocus: 'None'}
    const first = await compose({exports: exportsFor(), focus, nowMs: NOW, localCovers: LOCAL_COVERS})
    const later = await compose({exports: exportsFor(), focus, nowMs: NOW + 10 * 60_000, localCovers: LOCAL_COVERS})
    expect(first.ok && later.ok).toBe(true)
    if (first.ok && later.ok) {
      for (const id of COMPOSED_FRAGMENT_IDS) {
        expect(later.artifact.fragments[id], id).toBe(first.artifact.fragments[id])
      }
    }
  })
})
