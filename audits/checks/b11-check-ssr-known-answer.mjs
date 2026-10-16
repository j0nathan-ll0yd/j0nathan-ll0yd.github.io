#!/usr/bin/env node
// audits/checks/b11-check-ssr-known-answer.mjs -- B11. Production known-answer check for the
// server-rendered `/` (atlas decision 0160, plan Step 6.8).
//
// PROPERTY. The served page, fetched with no JavaScript, shows the values the data plane holds.
// SEAM WATCHED. The path from the CloudFront exports to the served HTML: the zone, the Worker, the
// loader and the view-model mapping. C1 and B2 read the artifacts and never the page. The smoke
// check reads the page after JavaScript ran, so a client repaint hides a server fault. No other
// measurer compares a rendered value with its source.
//
// THE ORACLE IS WRITTEN HERE. It reads raw export JSON and raw page HTML and imports nothing from
// the design-system adapters, the view models or the site loader (audits/lib/ssr-evidence.mjs obeys
// the same rule). A shared mapper would make the check agree with the code it judges.
//
// PROCEDURE. Snapshot A (focus + eight exports, no-store) -> GET `/` -> snapshot B. A domain whose
// `generatedAt` differs between A and B, or any focus change, is TRANSITION: it is not judged. The
// attempt repeats up to three times. A domain still in TRANSITION after the third attempt is
// reported as such (warn, indeterminate), never as a pass.
//
// PARTIAL. A page that is `partial` (or the Worker's `fallback`) while every export is healthy and
// fresh fails only on the SECOND consecutive run. Run N records `partial` in the run memory
// (audits/lib/run-memory.mjs); run N+1 finds it and fails. An unavailable memory fails at once,
// because a blind measurer must stay loud.

import {isMain, report} from '../lib/http.mjs'
import {publishIssueOutcome} from '../lib/measurement.mjs'
import {createRunMemory} from '../lib/run-memory.mjs'
import {CARD_DOMAINS, CARD_IDS, fetchPage, GATED_KEYS, norm, parsePage, readSnapshot, transitionedDomains} from '../lib/ssr-evidence.mjs'

// A18 coverage declaration (atlas decision 0145). Empty is a claim: the exports and the page are
// read here, and neither is judged as a registered estate artifact. Metadata only.
export const ARTIFACTS = []

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The oracle's own copy of the `audit.warn` ages in `atlas/surfaces.yaml` (`export-*-json`). It
 * restates what the design system restates; it imports neither. Atlas check A25 compares the
 * registry with the design-system table, and `audits/__tests__/b11-check-ssr-known-answer.test.ts`
 * pins this one to the same numbers.
 */
export const WARN_AGE_MS = Object.freeze({
  health: 45 * MINUTE,
  sleep: 12 * HOUR,
  workouts: 12 * HOUR,
  books: 7 * DAY,
  articles: 7 * DAY,
  githubEvents: 7 * DAY,
  starredRepos: 18 * HOUR,
  theatreReviews: 18 * HOUR
})

/** Clock skew between this runner, the Worker and CloudFront near the live/stale boundary. */
const BOUNDARY_TOLERANCE_MS = 2 * MINUTE
export const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 4_000
const BOOK_STATUS_ORDER = {reading: 0, upNext: 1, finished: 2}
const MEMORY_TITLE = '[audit-state] B11 SSR known answer'

/** `live`, `stale` or `boundary` (either is acceptable) for an export at `now`. */
function freshnessOf(domain, generatedAt, now) {
  const ms = Date.parse(generatedAt)
  if (!Number.isFinite(ms)) {
    return 'stale'
  }
  const age = now - ms
  const warn = WARN_AGE_MS[domain]
  if (Math.abs(age - warn) <= BOUNDARY_TOLERANCE_MS) {
    return 'boundary'
  }
  return age <= warn ? 'live' : 'stale'
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/** The values the page must show, read from raw export JSON by the oracle's own rules. */
export function buildOracle(exports) {
  const oracle = {}
  const health = exports.health?.kind === 'ok' ? exports.health.body : null
  if (health) {
    const heartRate = health.quantities?.heartRate?.value
    oracle.heartRate = isNumber(heartRate) && heartRate > 0 ? String(Math.round(heartRate)) : null
  }
  const events = exports.githubEvents?.kind === 'ok' ? exports.githubEvents.body.events : null
  if (Array.isArray(events)) {
    oracle.devLogTitle = events.length > 0 ? events[0].title : null
  }
  const articles = exports.articles?.kind === 'ok' ? exports.articles.body.articles : null
  if (Array.isArray(articles)) {
    // Newest first by `savedAt`; the first of equal timestamps wins.
    let newest = null
    for (const article of articles) {
      if (newest === null || Date.parse(article.savedAt) > Date.parse(newest.savedAt)) {
        newest = article
      }
    }
    oracle.articleTitle = newest ? newest.articleTitle : null
  }
  const repos = exports.starredRepos?.kind === 'ok' ? exports.starredRepos.body.repos : null
  if (Array.isArray(repos)) {
    oracle.starredRepo = repos.length > 0 ? `${repos[0].ownerLogin}/${repos[0].name}` : null
  }
  const books = exports.books?.kind === 'ok' ? exports.books.body.books : null
  if (Array.isArray(books)) {
    // Documented shelf sort: reading, then upNext (also the default), then finished. Stable.
    let first = null
    let firstRank = Infinity
    for (const book of books) {
      const rank = BOOK_STATUS_ORDER[book.status ?? 'upNext'] ?? 99
      if (rank < firstRank) {
        first = book
        firstRank = rank
      }
    }
    oracle.shelfTitle = first ? first.title : null
  }
  const workouts = exports.workouts?.kind === 'ok' ? exports.workouts.body.workouts : null
  if (Array.isArray(workouts)) {
    oracle.workoutCount = workouts.length
  }
  return oracle
}

/** The same fields, read from the served HTML by the selectors of the design-system widgets. */
export function extractRendered($) {
  const text = (selector) => {
    const el = $(selector).first()
    return el.length === 0 ? null : norm(el.text())
  }
  const starred = $('#cardStarredRepos .gh-sl-row .gh-sl-name').first()
  let starredRepo = null
  if (starred.length > 0) {
    const owner = norm(starred.find('.gh-sl-owner').text()).replace(/\/$/, '')
    const name = norm(starred.clone().children().remove().end().text())
    starredRepo = `${owner}/${name}`
  }
  return {
    heartRate: text('#cardHR #pulseBpm'),
    devLogTitle: text('#cardDevLog .gh-dal-line .gh-dal-title'),
    articleTitle: text('#cardReading .article-list-item .article-list-title'),
    starredRepo,
    shelfTitle: text('#cardBooks #dashShelfRow .shelf-book .shelf-book-title'),
    workoutCount: $('#cardWorkouts .workout-sub-card').length
  }
}

/** The card states an export in this condition may legitimately take, by the card's own rule. */
function allowedStates(cardId, read, fresh) {
  const data = fresh === 'boundary' ? ['live', 'stale'] : [fresh]
  const body = read.body
  const list = (items) => (Array.isArray(items) && items.length > 0 ? data : ['empty'])
  switch (cardId) {
    case 'cardHR': {
      const quantities = body.quantities ?? {}
      if (body.watch?.worn === false) {
        return data
      }
      const hr = quantities.heartRate?.value
      if (!isNumber(hr)) {
        return Object.keys(quantities).length === 0 ? ['empty'] : ['unavailable']
      }
      const hrv = quantities.heartRateVariabilitySDNN?.value
      return hr === 0 && (!isNumber(hrv) || hrv === 0) ? ['empty'] : data
    }
    case 'cardMovement': {
      if (body.watch?.worn === false) {
        return data
      }
      const q = body.quantities ?? {}
      const measured = [q.stepCount, q.distanceWalkingRunning, q.activeEnergyBurned, q.exerciseTime].filter((m) => m != null)
      return measured.every((m) => m.value === 0) ? ['empty'] : data
    }
    case 'cardHydration':
      return data
    case 'cardSleep': {
      const seconds = ['deep', 'rem', 'core', 'awake'].reduce((sum, phase) => sum + (isNumber(body[phase]?.seconds) ? body[phase].seconds : 0), 0)
      return seconds === 0 ? [...data, 'empty'] : data
    }
    case 'cardWorkouts':
      return list(body.workouts)
    case 'cardDevLog':
      return list(body.events)
    case 'cardReading':
      return list(body.articles)
    case 'cardStarredRepos':
      return list(body.repos)
    case 'cardBooks':
      return list(body.books)
    default:
      return list(body.reviews)
  }
}

/** The comparison each card owes, as [oracle key, label]. Cards not listed owe state and timestamp only. */
const VALUE_FIELDS = Object.freeze({
  cardHR: ['heartRate', 'heart rate'],
  cardDevLog: ['devLogTitle', 'newest dev-log title'],
  cardReading: ['articleTitle', 'newest article title'],
  cardStarredRepos: ['starredRepo', 'first starred repository'],
  cardBooks: ['shelfTitle', 'first shelf title'],
  cardWorkouts: ['workoutCount', 'workout count']
})

/** Structures that exist only when a gated value renders. Each must be absent while hiding. */
const GATED_STRUCTURES = Object.freeze([
  '#cardHR [data-bpm]',
  '#cardWorkouts .workout-sub-card',
  '#cardDevLog .gh-dal-line',
  '#cardReading .article-list-item',
  '#cardStarredRepos .gh-sl-row',
  '#cardBooks .shelf-book',
  '#cardTheatreReviews .theatre-card'
])

const fail = (id, message, extra = {}) => ({severity: 'fail', id, message, ...extra})

function judgeHiding(page) {
  const findings = []
  if (page.header !== 'suppressed') {
    findings.push(fail('ssr-hiding-not-suppressed', `the data plane is hiding but X-SSR-Data is ${JSON.stringify(page.header)}, not "suppressed"`))
  }
  for (const id of CARD_IDS) {
    const card = page.cards[id]
    if (card.state !== 'suppressed') {
      findings.push(fail('ssr-hiding-card-not-suppressed', `${id} is ${JSON.stringify(card.state)} while the data plane is hiding`))
    }
  }
  if (page.generatedAtAttributes > 0) {
    findings.push(fail('ssr-hiding-leaks-generated-at', `${page.generatedAtAttributes} data-generated-at attribute(s) while the data plane is hiding`))
  }
  for (const selector of GATED_STRUCTURES) {
    if (page.$(selector).length > 0) {
      findings.push(fail('ssr-hiding-leaks-value', `gated structure "${selector}" renders while the data plane is hiding`))
    }
  }
  return findings
}

/** True when all eight exports are admitted, stable and within their `audit.warn` age. */
function allHealthyAndFresh(snapshot, transitioned, now) {
  return GATED_KEYS.every((key) => {
    const read = snapshot.exports[key]
    return read.kind === 'ok' && !transitioned.includes(key) && freshnessOf(key, read.generatedAt, now) !== 'stale'
  })
}

/**
 * Judges one attempt. Pure: the snapshots, the parsed page and the clock arrive as arguments.
 * Returns the findings, the number of artifacts compared, the transitioned domains, and the two
 * flags the partial policy reads.
 */
export function judgeAttempt({a, b, page, now}) {
  const findings = []
  if (a.hiding && b.hiding) {
    findings.push(...judgeHiding(page))
    return {findings, compared: 1, transitioned: [], partialCandidate: false, healthyAndFresh: false, hiding: true}
  }
  if (a.hiding !== b.hiding) {
    return {findings, compared: 0, transitioned: [...GATED_KEYS], partialCandidate: false, healthyAndFresh: false, hiding: false}
  }

  const transitioned = transitionedDomains(a, b)
  const oracle = buildOracle(b.exports)
  const rendered = extractRendered(page.$)
  let compared = 0
  let partialCandidate = false
  for (const cardId of CARD_IDS) {
    const domain = CARD_DOMAINS[cardId]
    const read = b.exports[domain]
    if (transitioned.includes(domain) || read.kind !== 'ok') {
      continue
    }
    compared++
    const card = page.cards[cardId]
    const fresh = freshnessOf(domain, read.generatedAt, now)
    const allowed = allowedStates(cardId, read, fresh)
    if (card.count !== 1) {
      findings.push(fail('ssr-card-missing', `${cardId} appears ${card.count} time(s), expected once`))
      continue
    }
    if (!allowed.includes(card.state)) {
      const stuck = card.state === 'loading' || card.state === 'unavailable'
      partialCandidate ||= stuck
      findings.push(
        fail(stuck ? 'ssr-card-not-rendered' : 'ssr-card-state-mismatch',
          `${cardId} is ${JSON.stringify(card.state)} but its ${domain} export is healthy and admitted (expected ${allowed.join(' or ')})`, {partial: stuck})
      )
      continue
    }
    if (card.state !== 'live' && card.state !== 'stale') {
      continue
    }
    if (card.generatedAt !== read.generatedAt) {
      findings.push(
        fail('ssr-generated-at-mismatch',
          `${cardId} data-generated-at is ${JSON.stringify(card.generatedAt)}, its ${domain} export says ${read.generatedAt}`)
      )
    }
    const field = VALUE_FIELDS[cardId]
    if (field && oracle[field[0]] !== undefined && oracle[field[0]] !== null && rendered[field[0]] !== oracle[field[0]]) {
      findings.push(
        fail('ssr-value-mismatch',
          `${cardId} ${field[1]}: the page shows ${JSON.stringify(rendered[field[0]])}, the ${domain} export says ${JSON.stringify(oracle[field[0]])}`)
      )
    }
  }
  return {findings, compared, transitioned, partialCandidate, healthyAndFresh: allHealthyAndFresh(b, transitioned, now), hiding: false}
}

/** Page-level findings: a page that is not a server render has nothing to compare. */
export function classifyPage(page, parsed) {
  if (page.status !== 200) {
    const worker = parsed.header === 'error' ? ' (the Worker 500 page)' : ''
    return {findings: [fail('ssr-page-status', `GET / answered HTTP ${page.status}${worker}`)], usable: false, partial: false}
  }
  if (parsed.header === null && parsed.meta === null) {
    return {
      findings: [
        fail('ssr-not-server-rendered', 'GET / carries no X-SSR-Data header and no ssr-data meta: this is the data-free shell, not a server render')
      ],
      usable: false,
      partial: false
    }
  }
  if (parsed.header === 'fallback') {
    return {
      findings: [
        fail('ssr-fallback-served', 'X-SSR-Data is "fallback": the Worker served the data-free page after a missed render budget', {partial: true})
      ],
      usable: false,
      partial: true
    }
  }
  if (parsed.header === 'error') {
    return {findings: [fail('ssr-error-page', 'X-SSR-Data is "error": the Worker served its 500 page')], usable: false, partial: false}
  }
  return {findings: [], usable: true, partial: false}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One full run: up to three attempts, then the partial policy. Dependencies are injectable. */
export async function runKnownAnswer({
  readSnapshotImpl = readSnapshot,
  fetchPageImpl = fetchPage,
  memory = createRunMemory({key: 'b11-partial', title: MEMORY_TITLE}),
  now = () => Date.now(),
  delay = sleep
} = {}) {
  let last = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const a = await readSnapshotImpl()
    let page
    try {
      page = await fetchPageImpl()
    } catch (err) {
      return {findings: [fail('ssr-page-fetch', `GET / failed: ${err instanceof Error ? err.message : String(err)}`)], measured: 0, outcome: 'failure'}
    }
    const pageAt = now()
    const b = await readSnapshotImpl()
    const parsed = parsePage(page.html, page.headers)
    const heldReads = [a.focus, ...GATED_KEYS.map((key) => a.exports[key])].filter((read) => read.kind !== 'unreadable').length
    const classified = classifyPage(page, parsed)
    last = {classified, heldReads}
    if (!classified.usable) {
      last.judged = {
        findings: [],
        compared: 0,
        transitioned: [],
        partialCandidate: classified.partial,
        healthyAndFresh: allHealthyAndFresh(b, transitionedDomains(a, b), pageAt)
      }
      break
    }
    last.judged = judgeAttempt({a, b, page: parsed, now: pageAt})
    if (last.judged.transitioned.length === 0) {
      break
    }
    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS)
    }
  }

  const {classified, judged, heldReads} = last
  const findings = [...classified.findings, ...judged.findings]
  if (judged.transitioned.length > 0) {
    findings.push({
      severity: 'warn',
      id: 'ssr-transition-persistent',
      message: `${
        judged.transitioned.join(', ')
      } changed between snapshots on all ${MAX_ATTEMPTS} attempts; those domains are TRANSITION and were not judged`
    })
  }

  const failing = findings.filter((f) => f.severity === 'fail')
  const partialOnly = failing.length > 0 && failing.every((f) => f.partial)
  const partialNow = (judged.partialCandidate || classified.partial) && judged.healthyAndFresh
  const prior = await memory.read()
  if (partialNow) {
    const repeat = !prior.available || prior.value === 'partial'
    await memory.write('partial')
    for (const f of findings.filter((item) => item.partial)) {
      if (partialOnly && !repeat) {
        f.severity = 'warn'
        f.message += ' (first sighting: this fails if the next run is partial too)'
      } else if (!prior.available) {
        f.message += ' (run memory unavailable: a first sighting cannot be told from a repeat)'
      }
    }
  } else if (prior.available && prior.value === 'partial' && judged.compared > 0) {
    await memory.write('clear')
  }

  const measured = heldReads > 0 ? 1 + heldReads : 0
  const hasFail = findings.some((f) => f.severity === 'fail')
  const unjudged = judged.compared === 0 || judged.transitioned.length > 0 || findings.some((f) => f.partial && f.severity === 'warn')
  return {findings, measured, outcome: hasFail ? 'failure' : unjudged ? 'indeterminate' : 'success'}
}

async function main() {
  const {findings, measured, outcome} = await runKnownAnswer()
  publishIssueOutcome(outcome)
  process.exit(report('ssr-known-answer', findings, measured))
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    publishIssueOutcome('failure')
    process.exit(report('ssr-known-answer', [fail('ssr-crash', `check crashed before measuring: ${err.message}`)], 0))
  })
}
