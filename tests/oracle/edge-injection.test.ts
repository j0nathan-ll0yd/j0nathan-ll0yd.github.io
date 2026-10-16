// The edge injection equals the Astro render (atlas decision 0160, PR B; owner decision 2026-10-16,
// option B). For each scenario the test builds one set of view models, renders every injected card
// two ways, and compares the markup after normalization (./harness.ts `normalized`):
//
// - ORACLE: Astro renders the design system's component with the view model's props (Container API).
// - EDGE: the site's injector writes the same view model into the data-free card, in workerd.
//
// A design-system markup change that the injector does not follow fails here, by card and scenario.
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Bookshelf, DndOverlay, FocusOverlay, HeartRate, TheatreReviews} from '@j0nathan-ll0yd/web/production'
import TemplatesPage from '../../src/pages/ssr-templates.astro'
import type {DashboardLoad} from '../../src/lib/data-plane/loader'
import {astroContainer, type DomainSpec, fixtureLoad, LOCAL_COVERS, normalized, renderOf, startInjector} from './harness'

const NOW = Date.parse('2026-03-18T12:00:00.000Z')
const FRESH = new Date(NOW - 60_000).toISOString()
const OLD = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()

/** The cards the injector writes in this phase, with the component and extra props each takes. */
const CARDS = [
  {id: 'cardHR', Component: HeartRate, model: 'heartRate', extra: {}},
  {id: 'cardBooks', Component: Bookshelf, model: 'bookshelf', extra: {localCovers: LOCAL_COVERS}},
  {id: 'cardTheatreReviews', Component: TheatreReviews, model: 'theatreReviews', extra: {}}
] as const

const OVERLAYS = [
  {id: 'focusOverlay', Component: FocusOverlay},
  {id: 'dndOverlay', Component: DndOverlay}
] as const

let container: Awaited<ReturnType<typeof astroContainer>>
let injector: Awaited<ReturnType<typeof startInjector>>
let page: string
let templates: string

beforeAll(async () => {
  container = await astroContainer()
  injector = await startInjector()
  // The data-free page as the build renders it: each card `loading`, the overlays hidden.
  const parts = [
    ...(await Promise.all(OVERLAYS.map(({Component}) => container.renderToString(Component, {props: {}})))),
    ...(await Promise.all(CARDS.map(({Component, extra}) => container.renderToString(Component, {props: {state: 'loading', ...extra}}))))
  ]
  page = `<!DOCTYPE html><html><head><meta name="robots" content="index, follow"></head><body>${parts.join('')}</body></html>`
  templates = await container.renderToString(TemplatesPage)
}, 180_000)

afterAll(async () => {
  await injector?.stop()
})

async function inject(loaded: DashboardLoad, nowMs = NOW): Promise<{edge: string; oracle: Record<string, string>; summary: string}> {
  const render = renderOf(loaded, nowMs)
  const response = await injector.fetch('/', {method: 'POST', body: JSON.stringify({page, templates, render, nowMs})})
  const edge = await response.text()
  expect(response.status, edge.slice(0, 500)).toBe(200)
  const oracle: Record<string, string> = {}
  for (const {id, Component, model, extra} of CARDS) {
    oracle[id] = await container.renderToString(Component, {props: {...render.vm[model], ...extra}})
  }
  for (const {id, Component} of OVERLAYS) {
    oracle[id] = await container.renderToString(Component, {props: id === 'focusOverlay' ? render.vm.focusOverlay : render.vm.dndOverlay})
  }
  return {edge, oracle, summary: render.summary}
}

const SCENARIOS: [string, string | 'unreadable', Partial<Record<string, DomainSpec>>][] = [
  ['baseline, fresh', 'None', {}],
  ['full exports', 'None', {health: {variation: 'full'}, books: {variation: 'full'}, theatreReviews: {variation: 'full'}}],
  ['known answer', 'None', {health: {variation: 'ssrKnownAnswer'}, books: {variation: 'ssrKnownAnswer'}, theatreReviews: {variation: 'ssrKnownAnswer'}}],
  ['empty exports', 'None', {health: {variation: 'empty'}, books: {variation: 'empty'}, theatreReviews: {variation: 'empty'}}],
  ['stale exports', 'None', {
    health: {variation: 'baseline', generatedAt: OLD},
    books: {variation: 'baseline', generatedAt: OLD},
    theatreReviews: {variation: 'baseline', generatedAt: OLD}
  }],
  ['unavailable exports', 'None', {health: 'unavailable', books: 'unavailable', theatreReviews: 'unavailable'}],
  ['a gate suppression body', 'None', {books: 'suppressed'}],
  ['focus Work', 'Work', {}],
  ['focus Do Not Disturb', 'Do Not Disturb', {}],
  ['an unreadable focus signal', 'unreadable', {}],
  ['sparse health', 'None', {health: {variation: 'sparse'}}],
  ['watch charging', 'None', {health: {variation: 'pausedCharging'}}],
  ['watch off the wrist', 'None', {health: {variation: 'pausedHrGap'}}],
  ['heart-rate zones', 'None', {health: {variation: 'peak'}}],
  ['resting heart rate', 'None', {health: {variation: 'resting'}}],
  ['bradycardia', 'None', {health: {variation: 'bradycardia'}}],
  ['books all completed', 'None', {books: {variation: 'allCompleted'}}],
  ['books all reading', 'None', {books: {variation: 'allReading'}}],
  ['books without covers', 'None', {books: {variation: 'noCovers'}}],
  ['books mixed status', 'None', {books: {variation: 'mixedStatus'}}],
  ['books with progress', 'None', {books: {variation: 'withProgress'}}],
  ['books in series', 'None', {books: {variation: 'seriesBooks'}}],
  ['six books', 'None', {books: {variation: 'sixBooks'}}],
  ['theatre without images', 'None', {theatreReviews: {variation: 'noImages'}}],
  ['theatre every grade', 'None', {theatreReviews: {variation: 'allGrades'}}],
  ['theatre at its maximum', 'None', {theatreReviews: {variation: 'maxReviews'}}],
  [
    'values that need escaping',
    'None',
    {
      books: {
        variation: 'baseline',
        change: (raw) => {
          const books = raw.books as {title: string; author: string}[]
          books[0].title = 'A & B <i>"quoted"</i> &amp; \'apos\''
          books[0].author = 'X &lt;Y&gt;'
        }
      },
      theatreReviews: {
        variation: 'baseline',
        change: (raw) => {
          const reviews = raw.reviews as {title: string; url: string}[]
          reviews[0].title = 'Q & A <script>alert(1)</script> &amp;'
          reviews[0].url = 'https://www.coasttocoastreviews.com/x?a=1&b=2&amp;c'
        }
      }
    }
  ]
]

describe('edge injection equals the Astro render', () => {
  it.each(SCENARIOS)('%s', async (_label, focus, domains) => {
    const {edge, oracle, summary} = await inject(fixtureLoad(focus, domains, FRESH))
    for (const {id} of [...CARDS, ...OVERLAYS]) {
      expect(normalized(edge, `#${id}`), `${id}`).toBe(normalized(oracle[id], `#${id}`))
    }
    // The summary the header carries is the one the page names.
    expect(edge).toContain(`<meta name="ssr-data" content="${summary}">`)
    // No slot stand-in survives into a page.
    expect(edge).not.toMatch(/ssr-slot/)
  })
})
