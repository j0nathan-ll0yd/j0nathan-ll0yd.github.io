// The composer equals the Astro render (atlas decision 0160, PR B; owner decision 2026-10-16: the
// page is precomposed as the data changes, like llms.txt). For each scenario the BUILT composer
// (dist-composer/composer.mjs, the bundle the backend composer runs) renders the fragments, and Astro
// renders the same view models through the Container API (the oracle, never deployed). Every fragment
// must be byte-identical after attribute ordering (./harness.ts `normalized`), and every scoped-style
// hash in it must be one the website's own built page carries, or the Worker refuses it.
import {existsSync, readFileSync} from 'node:fs'
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
import {COMPOSED_FRAGMENT_IDS} from '../../src/lib/composed/artifact'
import type {GatedKey} from '../../src/lib/data-plane/loader'
import {astroContainer, type DomainSpec, fixtureLoad, LOCAL_COVERS, normalized, rawFixture, renderOf} from './harness'

const COMPOSER = new URL('../../dist-composer/composer.mjs', import.meta.url)
const SITE_PAGE = new URL('../../dist/client/index.html', import.meta.url)
const NOW = Date.parse('2026-03-18T12:00:00.000Z')
const FRESH = new Date(NOW - 60_000).toISOString()
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()
const KEYS: GatedKey[] = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews']
const WEB = JSON.parse(readFileSync(new URL('../../node_modules/@j0nathan-ll0yd/web/package.json', import.meta.url), 'utf8')).version as string

const ORACLE = {
  focusOverlay: [FocusOverlay, 'focusOverlay'],
  dndOverlay: [DndOverlay, 'dndOverlay'],
  systemStatus: [SystemStatus, 'systemStatus'],
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

type Compose = (input: unknown) => Promise<{ok: true; artifact: {fragments: Record<string, string>; summary: string}} | {ok: false; refusal: string}>
let compose: Compose
let container: Awaited<ReturnType<typeof astroContainer>>
let siteScopes: Set<string>

beforeAll(async () => {
  if (!existsSync(COMPOSER)) {
    throw new Error('dist-composer/composer.mjs is missing: run node scripts/build-composer.mjs')
  }
  compose = ((await import(COMPOSER.href)) as {compose: Compose}).compose
  container = await astroContainer()
  siteScopes = new Set(readFileSync(SITE_PAGE, 'utf8').match(/data-astro-cid-[a-z0-9]+/g) ?? [])
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
    const result = await compose({exports, focus: {generatedAt: FRESH, currentFocus: 'None'}, nowMs: NOW, localCovers: LOCAL_COVERS, web: WEB})
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
      expect(normalized(fragment, `#${id}`), id).toBe(normalized(oracle, `#${id}`))
      for (const scope of fragment.match(/data-astro-cid-[a-z0-9]+/g) ?? []) {
        expect(siteScopes.has(scope), `${id}: ${scope} is not in the website's page`).toBe(true)
      }
    }
  })

  it('publishes nothing under a hiding or unreadable focus value', async () => {
    for (const currentFocus of ['Work', 'Do Not Disturb']) {
      const result = await compose({
        exports: {},
        focus: {generatedAt: FRESH, currentFocus, hidingSince: FRESH},
        nowMs: NOW,
        localCovers: LOCAL_COVERS,
        web: WEB
      })
      expect(result).toEqual({ok: false, refusal: 'hiding'})
    }
    expect(await compose({exports: {}, focus: {currentFocus: 42}, nowMs: NOW, localCovers: LOCAL_COVERS, web: WEB})).toEqual({
      ok: false,
      refusal: 'focus-unreadable'
    })
  })
})
