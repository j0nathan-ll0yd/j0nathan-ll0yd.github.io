// The composer equals the Astro render (atlas decision 0160, PR B; owner decision 2026-10-16: the
// page is precomposed as the data changes, like llms.txt). For each scenario the BUILT composer
// (dist-composer/composer.mjs, the bundle the backend composer runs) renders the fragments, and Astro
// renders the same view models through the Container API (the oracle, never deployed). Every fragment
// must be byte-identical after attribute ordering (./harness.ts `normalized`), and every scoped-style
// hash in it must be one the website's own built page carries, or the Worker refuses it.
import {existsSync, readFileSync} from 'node:fs'
import {load} from 'cheerio'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
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
import {COMPOSED_FRAGMENT_IDS, GATE_VARIANT, UNREADABLE_VARIANT, VALUE_FREE_PATH} from '../../src/lib/composed/artifact'
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

type ValueFreeSet = {build: string; variants: Record<string, {summary: string; fragments: Record<string, string>}>}
type ComposeValueFree = (input: {localCovers: readonly string[]}) => Promise<ValueFreeSet>
let composeValueFree: ComposeValueFree
type ComposeDashboard = (options: {fetch?: typeof fetch; nowMs?: number; base?: string}) => Promise<
  {ok: true; artifact: {composer: {build: string}; summary: string; fragments: Record<string, string>}; body: string} | {ok: false; refusal: string}
>
let composeDashboard: ComposeDashboard
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
  ;({compose, composeValueFree, composeDashboard, COMPOSER_CONTRACT, COMPOSER_BUILD} = (await import(COMPOSER.href)) as {
    compose: Compose
    composeValueFree: ComposeValueFree
    composeDashboard: ComposeDashboard
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
  ['zero hydration', {health: {variation: 'zeroHydration'}}],
  ['missing optional health', {health: {variation: 'missingOptional'}}],
  ['long sleep', {sleep: {variation: 'longSleep'}}],
  ['multiple workouts', {workouts: {variation: 'multiWorkout'}}],
  ['workouts without distance', {workouts: {variation: 'noDistance'}}],
  ['commits only', {githubEvents: {variation: 'commitsOnly'}}],
  ['over ten events', {githubEvents: {variation: 'overTen'}}],
  ['old starred repos', {starredRepos: {variation: 'oldTimestamp'}}],
  ['articles with notes', {articles: {variation: 'withNotes'}}],
  ['over thirty articles', {articles: {variation: 'overThirty'}}],
  ['books all completed', {books: {variation: 'allCompleted'}}],
  ['books without covers', {books: {variation: 'noCovers'}}],
  ['books in series', {books: {variation: 'seriesBooks'}}],
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
      const props = id === 'cardBooks' ? {...render.vm.bookshelf, localCovers: LOCAL_COVERS} : render.vm[model]
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
      expect(result).toEqual({ok: false, refusal: 'hiding'})
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
      const props = id === 'cardBooks' ? {...vm.bookshelf, localCovers: LOCAL_COVERS} : vm[model]
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
    expect(await composeDashboard({fetch: plane.fetch, nowMs: NOW})).toEqual({ok: false, refusal: 'hiding'})
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
})
