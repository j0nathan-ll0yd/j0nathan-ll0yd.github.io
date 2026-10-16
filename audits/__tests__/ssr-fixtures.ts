// Fixtures for the SSR checks (B11, B12): raw export bodies, the snapshot shape audits/lib/ssr-evidence.mjs
// returns, and a small renderer that writes the selectors the design-system widgets write. The renderer
// is test scaffolding for the known-answer suites. It is NOT the code under test and shares nothing
// with the production mapper, which is the point: a self-test must be able to break one field on purpose.

export const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const CARD_DOMAINS: Record<string, string> = {
  cardHR: 'health',
  cardMovement: 'health',
  cardHydration: 'health',
  cardSleep: 'sleep',
  cardWorkouts: 'workouts',
  cardDevLog: 'githubEvents',
  cardReading: 'articles',
  cardStarredRepos: 'starredRepos',
  cardBooks: 'books',
  cardTheatreReviews: 'theatreReviews'
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Bodies = Record<string, any>

export function makeBodies(): Bodies {
  return {
    health: {
      generatedAt: ago(5 * MINUTE),
      quantities: {
        heartRate: {value: 58.4, unit: 'count/min'},
        heartRateVariabilitySDNN: {value: 46.6, unit: 'ms'},
        stepCount: {value: 4361, unit: 'count'},
        activeEnergyBurned: {value: 335.7, unit: 'kcal'}
      }
    },
    sleep: {generatedAt: ago(HOUR), deep: {seconds: 3290}, rem: {seconds: 7926}, awake: {seconds: 717}, core: {seconds: 21567}},
    workouts: {generatedAt: ago(HOUR), workouts: [{activityType: 'Walking'}, {activityType: 'Running'}]},
    books: {
      generatedAt: ago(DAY),
      books: [{title: 'Finished Book', status: 'finished'}, {title: 'Up Next Book'}, {title: 'Reading Book', status: 'reading'}]
    },
    githubEvents: {generatedAt: ago(2 * HOUR), events: [{title: 'newest commit'}, {title: 'older commit'}]},
    starredRepos: {generatedAt: ago(HOUR), repos: [{ownerLogin: 'octo', name: 'cat'}, {ownerLogin: 'other', name: 'repo'}]},
    articles: {
      generatedAt: ago(DAY),
      articles: [{articleTitle: 'Older article', savedAt: ago(3 * DAY)}, {articleTitle: 'Newest article', savedAt: ago(2 * DAY)}]
    },
    theatreReviews: {generatedAt: ago(HOUR), reviews: [{title: 'A show'}]},
    focus: {generatedAt: ago(5 * HOUR), currentFocus: 'None'}
  }
}

const KEYS = ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews']

/** A snapshot, as readSnapshot returns it. `suppress` lists exports the gate answered with its 403 body. */
export function makeSnapshot(bodies: Bodies, options: {focus?: string; suppress?: string[]; unreadable?: string[]} = {}) {
  const mode = options.focus ?? bodies.focus.currentFocus
  const exports: Record<string, any> = {}
  for (const key of KEYS) {
    if (options.suppress?.includes(key)) {
      exports[key] = {kind: 'suppressed'}
    } else if (options.unreadable?.includes(key)) {
      exports[key] = {kind: 'unreadable', reason: 'http-503'}
    } else {
      exports[key] = {kind: 'ok', body: bodies[key], generatedAt: bodies[key].generatedAt}
    }
  }
  const hidingMode = mode === 'Work' || mode === 'Do Not Disturb'
  return {
    focus: {kind: 'ok', body: {...bodies.focus, currentFocus: mode}, generatedAt: bodies.focus.generatedAt, mode, hiding: hidingMode},
    exports,
    hiding: hidingMode || Object.values(exports).some((e) => e.kind === 'suppressed'),
    readAt: NOW
  }
}

export interface RenderOptions {
  /** Overrides a card's rendered state (the card then renders no data). */
  states?: Record<string, string>
  /** Overrides a card's data-generated-at. */
  generatedAt?: Record<string, string>
  /** Overrides a rendered field: heartRate, devLogTitle, articleTitle, starredRepo, shelfTitle, workoutCount. */
  values?: Record<string, string | number>
  /** Page summary header and meta. Null omits it. */
  summary?: string | null
  /** Omits the meta only. */
  noMeta?: boolean
  /** Extra attribute value for the meta, when it must disagree with the header. */
  metaValue?: string
  /** Hiding page: every card suppressed, no value. */
  hiding?: boolean
  /** Renders gated structures even though cards say suppressed. */
  leak?: boolean
}

const HEADERS = {'content-type': 'text/html; charset=utf-8', 'cdn-cache-control': 'no-store'}

/** The page as the Worker would serve it, from the bodies the mapper was given. */
export function renderPage(bodies: Bodies, options: RenderOptions = {}) {
  const hiding = options.hiding === true
  const first = <T>(items: T[]) => items[0]
  const shelfRank: Record<string, number> = {reading: 0, upNext: 1, finished: 2}
  const shelf = [...bodies.books.books].sort((a: any, b: any) => shelfRank[a.status ?? 'upNext'] - shelfRank[b.status ?? 'upNext'])
  const newest = [...bodies.articles.articles].sort((a: any, b: any) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
  const values = {
    heartRate: String(Math.round(bodies.health.quantities.heartRate.value)),
    devLogTitle: first<any>(bodies.githubEvents.events).title,
    articleTitle: newest[0].articleTitle,
    starredRepo: `${bodies.starredRepos.repos[0].ownerLogin}/${bodies.starredRepos.repos[0].name}`,
    shelfTitle: shelf[0].title,
    workoutCount: bodies.workouts.workouts.length,
    ...options.values
  }
  const [owner, repo] = String(values.starredRepo).split('/')

  const card = (id: string, inner: string, accent = '') => {
    const domain = CARD_DOMAINS[id]
    const state = hiding ? 'suppressed' : options.states?.[id] ?? 'live'
    const dataState = state === 'live' || state === 'stale'
    const gen = dataState ? options.generatedAt?.[id] ?? bodies[domain].generatedAt : null
    const attrs = `id="${id}" data-ssr-state="${state}"${gen ? ` data-generated-at="${gen}"` : ''}`
    return `<div class="tri-card"${accent} ${attrs}>${dataState || options.leak ? inner : ''}</div>`
  }
  const body = [
    card('cardHR', `<canvas data-bpm="${values.heartRate}"></canvas><span class="pulse-bpm" id="pulseBpm"> ${values.heartRate} </span>`),
    card('cardMovement', '<div>rings</div>'),
    card('cardHydration', '<div>water</div>'),
    card('cardSleep', '<div>sleep</div>'),
    card('cardWorkouts', '<div class="workout-sub-card"></div>'.repeat(Number(values.workoutCount))),
    card('cardDevLog', `<a class="gh-dal-line"><span class="gh-dal-title">${values.devLogTitle}</span></a>`),
    card('cardReading', `<ul class="article-list"><li class="article-list-item"><span class="article-list-title">${values.articleTitle}</span></li></ul>`),
    card('cardStarredRepos', `<div class="gh-sl-row"><a class="gh-sl-name"><span class="gh-sl-owner">${owner}/</span> ${repo} </a></div>`),
    card('cardBooks', `<ul id="dashShelfRow"><li class="shelf-book"><div class="shelf-book-title"><span>${values.shelfTitle}</span></div></li></ul>`),
    card('cardTheatreReviews', '<a class="theatre-card"></a>')
  ].join('\n')
  const summary = options.summary === undefined ? (hiding ? 'suppressed' : 'live') : options.summary
  const metaValue = options.metaValue ?? summary
  const meta = summary !== null && !options.noMeta ? `<meta name="ssr-data" content="${metaValue}">` : ''
  const headers = new Headers(HEADERS)
  if (summary !== null) {
    headers.set('x-ssr-data', summary)
  }
  return {status: 200, headers, html: `<!doctype html><html><head>${meta}</head><body>${body}</body></html>`}
}
