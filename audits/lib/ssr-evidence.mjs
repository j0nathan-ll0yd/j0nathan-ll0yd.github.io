// audits/lib/ssr-evidence.mjs -- the evidence both SSR checks read (atlas decision 0160, plan
// Steps 6.8 and 6.9): the raw data-plane snapshot and the parsed server-rendered page.
//
// This module imports NOTHING from the design-system adapters, view models or the site's own
// loader. The known-answer check (b11) is only an oracle if its inputs share no code with the
// code it judges. Raw JSON stays raw here: no decoder, no contract mapping.

import * as cheerio from 'cheerio'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable} from './http.mjs'

export { SITE_URL }

/** The eight gated exports. Their order is the order the snapshot reports them in. */
export const GATED_KEYS = Object.freeze(['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews'])

/** The ten live cards, by element id, and the export each one follows. */
export const CARD_DOMAINS = Object.freeze({
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
})

export const CARD_IDS = Object.freeze(Object.keys(CARD_DOMAINS))

/** The card states a `data-ssr-state` attribute may carry. */
export const CARD_STATES = Object.freeze(['loading', 'live', 'stale', 'empty', 'unavailable', 'suppressed'])

/** Page summaries a rendered page may carry in `X-SSR-Data`. */
export const RENDER_SUMMARIES = Object.freeze(['live', 'stale', 'partial', 'unavailable', 'suppressed'])

/** Worker-only summaries: the data-free page after a missed budget, and the 500 page. */
export const WORKER_SUMMARIES = Object.freeze(['fallback', 'error'])

const HIDING_MODES = new Set(HIDING_FOCUS_MODES)
const SNAPSHOT_BUDGET_MS = 10_000
const PAGE_BUDGET_MS = 20_000
const NO_STORE = {'cache-control': 'no-cache'}

/**
 * One no-store read of one data-plane artifact, as raw JSON.
 * Result kinds: `ok` (body, generatedAt), `suppressed` (the gate's 403 body), `unreadable` (reason).
 */
async function readRaw(url, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, {cache: 'no-store', headers: NO_STORE}, SNAPSHOT_BUDGET_MS)
  } catch (err) {
    return {kind: 'unreadable', reason: `network: ${err instanceof Error ? err.message : String(err)}`}
  }
  let body
  try {
    body = await res.json()
  } catch {
    return {kind: 'unreadable', reason: res.ok ? 'body-not-json' : `http-${res.status}`}
  }
  if (res.status === 403 && body && typeof body === 'object' && body.suppressed === true) {
    return {kind: 'suppressed'}
  }
  if (!res.ok) {
    return {kind: 'unreadable', reason: `http-${res.status}`}
  }
  return {kind: 'ok', body, generatedAt: typeof body?.generatedAt === 'string' ? body.generatedAt : null}
}

/**
 * Snapshot of the focus signal and the eight exports. The reads run together, like the loader's.
 * `focus.hiding` is true for a hiding focus mode; `hiding` is true when ANY suppression signal
 * is present (the gate wins over a visible focus value).
 */
export async function readSnapshot({fetchImpl = fetchStable, base = CLOUDFRONT_BASE} = {}) {
  const keys = ['focus', ...GATED_KEYS]
  const results = await Promise.all(keys.map((key) => readRaw(`${base}${ENDPOINTS[key]}`, fetchImpl)))
  const byKey = Object.fromEntries(keys.map((key, i) => [key, results[i]]))
  const {focus, ...exports} = byKey
  const focusMode = focus.kind === 'ok' && typeof focus.body?.currentFocus === 'string' ? focus.body.currentFocus : null
  return {
    focus: {...focus, mode: focusMode, hiding: focusMode !== null && HIDING_MODES.has(focusMode)},
    exports,
    hiding: (focusMode !== null && HIDING_MODES.has(focusMode)) || Object.values(exports).some((e) => e.kind === 'suppressed'),
    readAt: Date.now()
  }
}

/** The signature a transition compares: a read's kind plus its export timestamp. */
function signature(read) {
  return read.kind === 'ok' ? `ok:${read.generatedAt}` : read.kind
}

/**
 * Domains that changed between snapshot A and snapshot B. A focus change (mode or timestamp)
 * returns every domain: the whole attempt is a TRANSITION.
 */
export function transitionedDomains(a, b) {
  if (signature(a.focus) !== signature(b.focus) || a.focus.mode !== b.focus.mode) {
    return [...GATED_KEYS]
  }
  return GATED_KEYS.filter((key) => signature(a.exports[key]) !== signature(b.exports[key]))
}

/** Fetches `/` with no JavaScript: one plain GET. Returns status, headers and the HTML text. */
export async function fetchPage({fetchImpl = fetchStable, url = `${SITE_URL}/`} = {}) {
  const res = await fetchImpl(url, {headers: {accept: 'text/html', ...NO_STORE}}, PAGE_BUDGET_MS)
  const html = await res.text()
  return {status: res.status, headers: res.headers, html}
}

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

/** Parses the evidence the metadata check and the known-answer check both read. */
export function parsePage(html, headers) {
  const $ = cheerio.load(html)
  const cards = Object.fromEntries(CARD_IDS.map((id) => {
    const el = $(`#${id}`)
    return [id, {count: el.length, state: el.attr('data-ssr-state') ?? null, generatedAt: el.attr('data-generated-at') ?? null}]
  }))
  const meta = $('meta[name="ssr-data"]')
  return {
    $,
    header: headers.get('x-ssr-data'),
    metaCount: meta.length,
    meta: meta.attr('content') ?? null,
    cards,
    generatedAtAttributes: $('[data-generated-at]').length,
    headers
  }
}

export { norm }
