import {readFileSync} from 'node:fs'
import {expect, type Page, test} from '@playwright/test'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {type Behavior, dataPlaneRequests, resetDataPlane, serveFixtures, setDataPlane} from '../data-plane/control'
import {BASELINE_BY_PATH, fixture, KNOWN_ANSWER_BY_PATH} from '../data-plane/baseline'
import {isAllowedImageUrl, srcsetCandidates} from '../image-url-allowlist'
import {LIVE_CARD_IDS} from '../shared/fixture-sentinels'
import {legacyMarkers, RETIRED_OVERLAY_ROWS} from '../shared/legacy-markers'
import {headFactsOf, prerenderedIndexHtml, visibleTextOf} from '../shared/ssr-page'

// The server render of `/`, read with JavaScript off (atlas decision 0160, PR B; plan Step 6.3).
//
// This is what a crawler or a no-JS visitor gets: the Worker renders the page per request from the
// data plane. The Worker runs in workerd (`astro preview`) and reads the fixture data plane
// (tests/data-plane/server.ts) that these tests steer per path. Every input is the
// `ssrKnownAnswer` variation of @j0nathan-ll0yd/fixtures, whose values appear in no other
// variation, so a projection that matches proves the value came from this request's read.
// Behavioral DOM assertions only; the screenshots are not this suite's evidence.

const TOKEN = 'Kappa-7731'
const SIX_MONTHS_AGO = '2025-01-01T00:00:00.000Z'

/**
 * Cards whose state is `empty` when their export is a valid empty one. Hydration is the exception:
 * its empty state shows the vessels with the no-reading mark, so it stays `live`
 * (@j0nathan-ll0yd/web `runtime/view-models.ts`, "Hydration's empty state").
 */
const EMPTY_CARDS: Partial<Record<DomainKey, string[]>> = {health: ['cardHR', 'cardMovement']}

type DomainKey = 'health' | 'sleep' | 'workouts' | 'books' | 'githubEvents' | 'starredRepos' | 'articles' | 'theatreReviews'

/** Each gated export, the fixture directory of its variations, and the live cards it feeds. */
const DOMAINS: Record<DomainKey, {directory: string; cards: string[]}> = {
  health: {directory: 'health', cards: ['cardHR', 'cardMovement', 'cardHydration']},
  sleep: {directory: 'sleep', cards: ['cardSleep']},
  workouts: {directory: 'workouts', cards: ['cardWorkouts']},
  books: {directory: 'books', cards: ['cardBooks']},
  githubEvents: {directory: 'github-events', cards: ['cardDevLog']},
  starredRepos: {directory: 'github-starred-repos', cards: ['cardStarredRepos']},
  articles: {directory: 'articles', cards: ['cardReading']},
  theatreReviews: {directory: 'theatre-reviews', cards: ['cardTheatreReviews']}
}

const knownAnswer = (key: keyof typeof ENDPOINTS): Record<string, any> => JSON.parse(readFileSync(KNOWN_ANSWER_BY_PATH[ENDPOINTS[key]], 'utf8'))

interface Rendered {
  status: number
  summaryHeader: string | undefined
  summaryMeta: string | undefined
}

async function open(page: Page): Promise<Rendered> {
  const response = await page.goto('/')
  return {
    status: response!.status(),
    summaryHeader: response!.headers()['x-ssr-data'],
    summaryMeta: (await page.locator('meta[name="ssr-data"]').getAttribute('content')) ?? undefined
  }
}

async function cardStates(page: Page): Promise<Record<string, string | null>> {
  const states: Record<string, string | null> = {}
  for (const id of LIVE_CARD_IDS) {
    states[id] = await page.locator(`#${id}`).getAttribute('data-ssr-state')
  }
  return states
}

/** Every live card in `state`, except the named ones in `others`. */
function expectedStates(state: string, others: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(LIVE_CARD_IDS.map((id) => [id, others[id] ?? state]))
}

async function expectSummary(page: Page, summary: string): Promise<void> {
  const rendered = await open(page)
  expect(rendered.status).toBe(200)
  expect(rendered.summaryHeader, 'X-SSR-Data').toBe(summary)
  expect(rendered.summaryMeta, '<meta name="ssr-data">').toBe(summary)
}

test.beforeEach(async () => {
  await resetDataPlane()
  await serveFixtures(KNOWN_ANSWER_BY_PATH)
})

test.describe('server render with JavaScript off: known-answer projections', () => {
  // covers: dashboard-ssr#Rendered values equal the decoded exports
  test('every live card renders the exact projection of its known-answer input', async ({page}) => {
    await expectSummary(page, 'live')
    expect(await cardStates(page)).toEqual(expectedStates('live'))
    for (const id of LIVE_CARD_IDS) {
      await expect(page.locator(`#${id}`), `#${id} generation`).toHaveAttribute('data-generated-at', /^\d{4}-\d{2}-\d{2}T/)
    }

    const health = knownAnswer('health')
    const quantities = health.quantities
    await expect(page.locator('#pulseBpm')).toHaveText(String(Math.round(quantities.heartRate.value)))
    await expect(page.locator('#hrHrvValue')).toHaveText(String(Math.round(quantities.heartRateVariabilitySDNN.value)))
    await expect(page.locator('#ringCenterPct')).toHaveText(`${Math.round((quantities.activeEnergyBurned.value / health.goals.moveKcal) * 100)}%`)
    await expect(page.locator('#legendMove')).toHaveText(`${quantities.activeEnergyBurned.value}/${health.goals.moveKcal}`)
    await expect(page.locator('#legendExercise')).toHaveText(`${quantities.exerciseTime.value}/${health.goals.exerciseMin}`)
    await expect(page.locator('[data-mv-metric="steps"]')).toHaveText(quantities.stepCount.value.toLocaleString('en-US'))
    await expect(page.locator('#hydraWaterVal')).toHaveText(`${Math.round(quantities.dietaryWater.value / 29.5735)} oz`)
    await expect(page.locator('#hydraCoffeeVal')).toHaveText(`${Math.round(quantities.dietaryCaffeine.value * 1000)} mg`)

    // Night Summary follows the sleep export; health lends only the score.
    const sleep = knownAnswer('sleep')
    const asleepSeconds = sleep.core.seconds + sleep.deep.seconds + sleep.rem.seconds
    await expect(page.locator('#sleepDuration')).toHaveText(`${Math.floor(asleepSeconds / 3600)}h ${Math.floor((asleepSeconds % 3600) / 60)}m`)
    await expect(page.locator('#sleepScoreVal')).toHaveText(String(quantities.sleepScore.value))

    const workouts = knownAnswer('workouts').workouts
    await expect(page.locator('#cardWorkouts .workout-sub-type')).toHaveText(workouts.map((w: {activityType: string}) => w.activityType))
    await expect(page.locator('#cardWorkouts .workout-sub-card').first()).toContainText(`${workouts[0].energyBurned} kcal`)
    await expect(page.locator('#cardWorkouts .workout-sub-card').first()).toContainText(`${(workouts[0].distance / 1000).toFixed(2)} km`)

    // The dev log keeps the export's own order (newest first by construction).
    await expect(page.locator('#cardDevLog .gh-dal-title')).toHaveText(knownAnswer('githubEvents').events.map((e: {title: string}) => e.title))

    const books = knownAnswer('books').books
    await expect(page.locator('#dashShelfRow .shelf-book-title')).toHaveText(books.map((b: {title: string}) => b.title))
    await expect(page.locator('#dashShelfRow .shelf-book-active .shelf-book-progress')).toHaveText(
      `${Math.round((books[0].currentPage / books[0].totalPages) * 100)}%`
    )

    await expect(page.locator('#cardReading .article-list-title')).toHaveText(
      knownAnswer('articles').articles.map((a: {articleTitle: string}) => a.articleTitle)
    )

    const repos = knownAnswer('starredRepos').repos
    await expect(page.locator('#cardStarredRepos .gh-sl-name')).toHaveText(
      repos.map((r: {ownerLogin: string; name: string}) => `${r.ownerLogin}/ ${r.name}`.replace(/\s+/g, ' ')),
      {useInnerText: true}
    )
    await expect(page.locator('#cardStarredRepos .gh-sl-stars')).toHaveText(
      repos.map((r: {stargazersCount: number}) => `★ ${r.stargazersCount.toLocaleString('en-US')}`)
    )

    const theatre = knownAnswer('theatreReviews')
    await expect(page.locator('#cardTheatreReviews .theatre-title')).toHaveText(theatre.reviews.map((r: {title: string}) => r.title))
    await expect(page.locator('#cardTheatreReviews .theatre-grade')).toHaveText(theatre.reviews.map((r: {rating: string}) => r.rating))
    await expect(page.locator('#theatreCount')).toContainText(String(theatre.totalReviews))

    // Neither focus overlay shows: the known-answer focus mode is not a hiding mode.
    await expect(page.locator('#focusOverlay')).toBeHidden()
    await expect(page.locator('#dndOverlay')).toBeHidden()
  })

  // The design system's ReadingFeed server markup is plain text rows: one client page of at most
  // ten articles, no outbound links, no note affordance, no pager. The browser's runtime adds those
  // once (the hand-off's enhancement exception for cardReading; see openspec dashboard-ssr). A
  // visitor with JavaScript off keeps the plain rows, and this test pins exactly that.
  test('the Reading Feed renders titles, sources and dates, at most ten rows, and no links', async ({page}) => {
    await expectSummary(page, 'live')
    const articles = knownAnswer('articles').articles as {articleTitle: string; sourceTitle: string; savedAt: string}[]
    const rows = page.locator('#cardReading .article-list-item')
    await expect(rows).toHaveCount(articles.length)
    await expect(page.locator('#cardReading .article-list-source')).toHaveText(articles.map((a) => `(${a.sourceTitle})`))
    await expect(page.locator('#cardReading time.article-list-date')).toHaveText(articles.map(() => /\d+(w|d|h|m) ago|just now/))
    await expect(page.locator('#cardReading time.article-list-date').first()).toHaveAttribute('datetime', articles[0].savedAt)
    await expect(page.locator('#cardReading a.article-list-title, #cardReading .article-list-note, #cardReading .article-page-btn')).toHaveCount(0)

    await serveFixtures({[ENDPOINTS.articles]: fixture('articles', 'overThirty')})
    await open(page)
    await expect(rows, 'forty exported articles render one client page of ten').toHaveCount(10)
    await expect(page.locator('#cardReading a.article-list-title, #cardReading .article-page-btn')).toHaveCount(0)
  })

  test('sorts as the widgets document, whatever order the export arrives in', async ({page}) => {
    const books = knownAnswer('books')
    const articles = knownAnswer('articles')
    await setDataPlane({
      [ENDPOINTS.books]: {kind: 'json', body: {...books, generatedAt: new Date().toISOString(), books: [...books.books].reverse()}},
      [ENDPOINTS.articles]: {kind: 'json', body: {...articles, generatedAt: new Date().toISOString(), articles: [...articles.articles].reverse()}}
    })
    await expectSummary(page, 'live')
    // The shelf puts the book being read first; the reading feed sorts by save time, newest first.
    await expect(page.locator('#dashShelfRow .shelf-book-title').first()).toHaveText(books.books[0].title)
    await expect(page.locator('#cardReading .article-list-title')).toHaveText(articles.articles.map((a: {articleTitle: string}) => a.articleTitle))
  })

  // covers: dashboard-ssr#The server render carries no fixture and no location value
  test('the legacy baseline values never appear, and the retired overlay rows never return', async ({page}) => {
    const allowed = [
      ...Object.values(KNOWN_ANSWER_BY_PATH).map((file) => readFileSync(file, 'utf8')),
      visibleTextOf(prerenderedIndexHtml()),
      prerenderedIndexHtml()
    ].join('\n')
    const markers = legacyMarkers(allowed)
    expect(markers.length, 'legacy marker set').toBeGreaterThan(20)

    for (const scenario of ['known-answer', 'unavailable', 'hiding'] as const) {
      if (scenario === 'unavailable') {
        await setDataPlane(Object.fromEntries(Object.values(ENDPOINTS).map((path) => [path, {kind: 'status', status: 503} as Behavior])))
      } else if (scenario === 'hiding') {
        await serveFixtures({[ENDPOINTS.focus]: fixture('focus', 'baseline')})
      }
      await open(page)
      const html = await page.content()
      const text = await page.locator('body').innerText()
      for (const marker of markers) {
        expect(html, `legacy value "${marker}" in the ${scenario} page`).not.toContain(marker)
        expect(text).not.toContain(marker)
      }
      for (const row of RETIRED_OVERLAY_ROWS) {
        expect(html, `retired overlay row "${row}" in the ${scenario} page`).not.toContain(row)
      }
    }
  })

  // covers: dashboard-ssr#The server render carries no fixture and no location value
  test('carries no coordinates, place or visit data (D14)', async ({page}) => {
    for (const scenario of ['known-answer', 'hiding'] as const) {
      if (scenario === 'hiding') {
        await serveFixtures({[ENDPOINTS.focus]: fixture('focus', 'baseline')})
      }
      await open(page)
      const html = await page.content()
      expect(html, scenario).not.toMatch(/-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/)
      expect(html, scenario).not.toMatch(/\b(latitude|longitude|geolocation_)/i)
      await expect(page.locator('[data-lat], [data-lng], [data-latitude], [data-longitude]'), scenario).toHaveCount(0)
      await expect(page.locator('[id*="map" i], [id*="place" i], [id*="visit" i], [class*="leaderboard" i], [class*="odometer" i]'), scenario).toHaveCount(0)
    }
  })
})

test.describe('server render with JavaScript off: states', () => {
  for (const [key, {directory, cards}] of Object.entries(DOMAINS) as [DomainKey, (typeof DOMAINS)[DomainKey]][]) {
    const path = ENDPOINTS[key]
    const others = (state: string) => Object.fromEntries(cards.map((id) => [id, state]))

    // covers: dashboard-ssr#Each card renders one honest state
    test(`${key}: a 5xx answer makes its cards unavailable and nothing else`, async ({page}) => {
      await setDataPlane({[path]: {kind: 'status', status: 503}})
      await expectSummary(page, 'partial')
      expect(await cardStates(page)).toEqual(expectedStates('live', others('unavailable')))
    })

    test(`${key}: malformed JSON makes its cards unavailable and nothing else`, async ({page}) => {
      await setDataPlane({[path]: {kind: 'malformed'}})
      await expectSummary(page, 'partial')
      expect(await cardStates(page)).toEqual(expectedStates('live', others('unavailable')))
    })

    test(`${key}: an old generatedAt makes its cards stale and nothing else`, async ({page}) => {
      await setDataPlane({[path]: {kind: 'fixture', file: KNOWN_ANSWER_BY_PATH[path], generatedAt: SIX_MONTHS_AGO}})
      await expectSummary(page, 'stale')
      expect(await cardStates(page)).toEqual(expectedStates('live', others('stale')))
      for (const id of cards) {
        await expect(page.locator(`#${id}`), `#${id} generation`).toHaveAttribute('data-generated-at', SIX_MONTHS_AGO)
      }
    })

    test(`${key}: a valid empty export makes its cards empty and nothing else`, async ({page}) => {
      await setDataPlane({[path]: {kind: 'fixture', file: fixture(directory, 'empty')}})
      await expectSummary(page, 'live')
      expect(await cardStates(page)).toEqual(expectedStates('live', Object.fromEntries((EMPTY_CARDS[key] ?? cards).map((id) => [id, 'empty']))))
    })

    // covers: dashboard-ssr#The gate wins every disagreement
    test(`${key}: a 403 suppression body suppresses the whole page`, async ({page}) => {
      await setDataPlane({[path]: {kind: 'suppress'}})
      await expectSummary(page, 'suppressed')
      expect(await cardStates(page)).toEqual(expectedStates('suppressed'))
      expect(await page.content()).not.toContain(TOKEN)
    })
  }

  test('a stalled body is cut at the read deadline and the card is unavailable', async ({page}) => {
    await setDataPlane({[ENDPOINTS.books]: {kind: 'stall'}})
    await expectSummary(page, 'partial')
    expect(await cardStates(page)).toEqual(expectedStates('live', {cardBooks: 'unavailable'}))
  })

  test('an unreadable focus signal makes every card unavailable and reads no export', async ({page}) => {
    await setDataPlane({[ENDPOINTS.focus]: {kind: 'status', status: 500}})
    await expectSummary(page, 'unavailable')
    expect(await cardStates(page)).toEqual(expectedStates('unavailable'))
    expect(await dataPlaneRequests()).toEqual([ENDPOINTS.focus])
    expect(await page.content()).not.toContain(TOKEN)
  })

  test('a 200 without a CloudFront request id is refused', async ({page}) => {
    await setDataPlane({[ENDPOINTS.workouts]: {kind: 'no-cloudfront-id', file: KNOWN_ANSWER_BY_PATH[ENDPOINTS.workouts]}})
    await expectSummary(page, 'partial')
    expect(await cardStates(page)).toEqual(expectedStates('live', {cardWorkouts: 'unavailable'}))
  })

  test('every export down renders an unavailable page with no value', async ({page}) => {
    await setDataPlane(
      Object.fromEntries(Object.entries(ENDPOINTS).filter(([key]) => key !== 'focus').map(([, path]) => [path, {kind: 'status', status: 502} as Behavior]))
    )
    await expectSummary(page, 'unavailable')
    expect(await cardStates(page)).toEqual(expectedStates('unavailable'))
    expect(await page.content()).not.toContain(TOKEN)
  })
})

test.describe('server render with JavaScript off: hiding', () => {
  for (
    const [name, variation, overlay, other] of [
      ['Work', 'baseline', '#focusOverlay', '#dndOverlay'],
      ['Do Not Disturb', 'dnd', '#dndOverlay', '#focusOverlay']
    ] as const
  ) {
    // covers: dashboard-ssr#The gate wins every disagreement
    test(`${name}: the overlay shows, no export is read and no gated value is in the DOM`, async ({page}) => {
      await serveFixtures({[ENDPOINTS.focus]: fixture('focus', variation)})
      await expectSummary(page, 'suppressed')
      await expect(page.locator(overlay)).toBeVisible()
      await expect(page.locator(other)).toBeHidden()
      expect(await cardStates(page)).toEqual(expectedStates('suppressed'))
      expect(await dataPlaneRequests(), 'only the focus signal is read').toEqual([ENDPOINTS.focus])

      const html = await page.content()
      const text = await page.locator('body').innerText()
      expect(html).not.toContain(TOKEN)
      for (const file of Object.values(KNOWN_ANSWER_BY_PATH)) {
        const strings = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))
        for (const value of strings.match(/"[^"]*Kappa-7731[^"]*"/g) ?? []) {
          expect(text).not.toContain(JSON.parse(value))
        }
      }
      await expect(page.locator('[data-generated-at]'), 'no card names a source age').toHaveCount(0)
    })
  }
})

test.describe('server render with JavaScript off: the private render path', () => {
  // covers: dashboard-ssr#Only the Worker reaches the render path
  test('a public GET /ssr-dashboard answers 404 and never renders the dashboard', async ({request}) => {
    for (const path of ['/ssr-dashboard', '/ssr-dashboard/']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
      expect(response.headers()['x-ssr-data'], `${path} carries no render summary`).toBeUndefined()
      expect(await response.text(), path).not.toContain('id="cardHR"')
    }
    expect(await dataPlaneRequests(), 'the public path reads no export').toEqual([])
  })
})

test.describe('server render with JavaScript off: build-test counterparts', () => {
  // tests/build/image-pipeline.test.ts judges the prerendered page, which holds no live image.
  // The server render holds the covers, posters and avatars the exports name.
  test('every image the render references is on the image allowlist', async ({page}) => {
    const scenarios: Record<string, Record<string, string>> = {
      'known answer': KNOWN_ANSWER_BY_PATH,
      baseline: BASELINE_BY_PATH,
      full: {
        ...BASELINE_BY_PATH,
        [ENDPOINTS.books]: fixture('books', 'full'),
        [ENDPOINTS.theatreReviews]: fixture('theatre-reviews', 'full'),
        [ENDPOINTS.articles]: fixture('articles', 'full'),
        [ENDPOINTS.githubEvents]: fixture('github-events', 'full')
      }
    }
    for (const [name, files] of Object.entries(scenarios)) {
      await serveFixtures(files)
      await open(page)
      const urls = await page.evaluate(() =>
        [...document.querySelectorAll('img, source')].flatMap((el) =>
          [el.getAttribute('src'), el.getAttribute('srcset')].filter((value): value is string => Boolean(value))
        )
      )
      expect(urls.length, `${name}: the render references images`).toBeGreaterThan(0)
      const candidates = urls.flatMap((value) => srcsetCandidates(value))
      expect(candidates.filter((url) => !isAllowedImageUrl(url)), `${name}: non-allowlisted image URLs`).toEqual([])
    }
  })

  // tests/build/sa-proxy.test.ts judges the prerendered page; this is the same rule on the render.
  test('analytics stays first party', async ({page}) => {
    await open(page)
    const html = await page.content()
    expect(html).not.toContain('simpleanalyticscdn.com')
    expect(html).toContain('/simple/noscript.gif')
  })
})

test.describe('server render with JavaScript off: head parity', () => {
  // covers: dashboard-ssr#One document serves every client
  test('canonical, robots, JSON-LD types and Link header equal the prerendered data-free page', async ({page, request}) => {
    const rendered = await page.goto('/')
    const ssrHead = headFactsOf(await rendered!.text())
    const staticHead = headFactsOf(prerenderedIndexHtml())
    expect(staticHead.canonical, 'the prerendered page has a canonical URL').toBeTruthy()
    expect(ssrHead).toEqual(staticHead)

    // `HEAD /` is answered from the prerendered page, so its Link header is the data-free page's.
    const head = await request.head('/')
    expect(head.headers()['x-ssr-data'], 'HEAD / carries no render summary').toBeUndefined()
    expect(rendered!.headers()['link']).toBeTruthy()
    expect(rendered!.headers()['link']).toBe(head.headers()['link'])
  })
})
