#!/usr/bin/env node
// Loads the live homepage in Playwright and requires both first-party analytics proxy chains to
// fire. Browser-observed statuses avoid curl-shape false positives. With `SA_API_KEY`, it also
// posts a synthetic event and polls the Stats API because headless pageviews are bot-filtered.
//
// THIS CHECK IS NARRATED FROM END TO END, AND THAT IS A CORRECTNESS PROPERTY, NOT LOGGING
// TASTE. GitHub kills a self-hosted job at a ~600s INACTIVITY deadline, so silence is what
// terminates a lane -- not duration (see audits/lib/progress.mjs for the measured receipts).
// Daily run 36387113309 spent 926.4s here and NEVER CONCLUDED, emitting not one line, because
// the final report block was this file's only output. The job died at 601s and the Healthchecks
// tile could not tell a wedged beacon probe from a healthy one.
//
// Normal cost is 18-35s (runs 36685525918, 36299679621, 36102170861, 36972883627, 36223284562),
// so 926.4s was a 26x outlier rather than the design cost. With every phase now bounded --
// launch 60s, navigation 30s, beacon wait 15s, close 30s, each Stats API read
// `DEFAULT_BUDGET_MS`, the ingestion poll 180s clamped to its own window -- the arithmetic worst
// case is roughly 375s, comfortably inside one job budget, and no interval between two output
// lines can exceed the 30s heartbeat.

import {chromium} from '@playwright/test'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {DEFAULT_BUDGET_MS, fetchStable, isMain, report} from '../lib/http.mjs'
import {progress, withHeartbeat} from '../lib/progress.mjs'

// A18 coverage declaration (atlas decision 0145). Empty is a claim, not a gap, and it
// matches what catalog row B6 claims: what this runner measures is the two first-party
// analytics proxy chains, which the surface registry does not register as an estate
// surface. Metadata only -- the hub reads it statically from the source.
export const ARTIFACTS = []

const NAV_TIMEOUT_MS = 30_000
const BEACON_WAIT_MS = 15_000

/**
 * Explicit bounds on the two browser-lifecycle awaits.
 *
 * WHY THEY ARE STATED RATHER THAN LEFT TO PLAYWRIGHT. Daily run 36387113309 spent 926.4s
 * in this step and never concluded, and the step emitted NOTHING across the whole
 * interval -- its only output was the final report block, at the very end -- so the log cannot say
 * which await held it. What the log CAN establish is that the bounded phases do not
 * account for it: navigation is capped at 30s, the beacon wait at 15s, and every Stats
 * API call at `DEFAULT_BUDGET_MS`, which totals roughly 300s against 926.4s measured. So
 * at least ~626s was spent somewhere unbounded, and `chromium.launch()` and
 * `browser.close()` were the only unbounded awaits in the file.
 *
 * `launch` has a 30s Playwright default; it is restated here because a default is not a
 * stated bound and the next reader should not have to look it up to reason about the
 * worst case. `close()` has NO default, and a wedged Chromium -- the likely shape when a
 * page is still retrying assets against a default-deny egress allowlist -- can hang it
 * indefinitely. It is raced rather than awaited: the beacons are already collected by
 * then, so a browser that will not close is a cleanup problem, never a reason to lose
 * the verdict.
 */
const LAUNCH_TIMEOUT_MS = 60_000
const CLOSE_TIMEOUT_MS = 30_000

const EXPECTATIONS = [
  {id: 'cf-insights-js', urlPattern: /\/cf-insights\.js/, method: 'GET', acceptStatus: (s) => s === 200},
  {id: 'cf-rum', urlPattern: /\/cf-rum(\?|$)/, method: 'POST', acceptStatus: (s) => s >= 200 && s < 300},
  {id: 'sa-script', urlPattern: /\/sa(\?|$)/, method: 'GET', acceptStatus: (s) => s === 200},
  {
    id: 'sa-pageview-pixel',
    urlPattern: /\/simple\/simple\.gif/,
    method: 'GET',
    acceptStatus: (s) => s === 202,
    onWrongStatus: (s) =>
      `expected HTTP 202 from the SA collector (verified live behavior for a well-formed pageview ping); ` +
      `got ${s}. If Simple Analytics' upstream contract changed, update EXPECTATIONS here deliberately.`
  }
]

/** Collects matching request/response pairs from a live page load. Network I/O -- not unit tested directly. */
async function collectBeaconEvents(url) {
  progress(`launching headless chromium (bounded at ${LAUNCH_TIMEOUT_MS / 1000}s)`)
  const launchedAt = Date.now()
  const browser = await withHeartbeat('chromium.launch()', () => chromium.launch({timeout: LAUNCH_TIMEOUT_MS}))
  progress(`chromium up in ${Date.now() - launchedAt}ms`)
  try {
    const page = await browser.newPage()
    const seen = new Map() // id -> { status, method }

    page.on('response', (res) => {
      const req = res.request()
      for (const exp of EXPECTATIONS) {
        if (exp.urlPattern.test(res.url()) && req.method() === exp.method && !seen.has(exp.id)) {
          seen.set(exp.id, {status: res.status(), url: res.url()})
          // Narrated as it happens rather than tallied at the end: when the step is cut
          // short by the inactivity deadline, the beacons already observed are the only
          // evidence that survives in the log.
          progress(`beacon ${exp.id} observed -- HTTP ${res.status()}`)
        }
      }
    })

    progress(`navigating to ${url} (bounded at ${NAV_TIMEOUT_MS / 1000}s)`)
    const navAt = Date.now()
    await withHeartbeat(`page.goto(${url})`, () => page.goto(url, {waitUntil: 'load', timeout: NAV_TIMEOUT_MS}))
    progress(`load event in ${Date.now() - navAt}ms; waiting up to ${BEACON_WAIT_MS / 1000}s for ${EXPECTATIONS.length} beacons`)

    const deadline = Date.now() + BEACON_WAIT_MS
    while (seen.size < EXPECTATIONS.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
    }
    progress(`beacon wait finished with ${seen.size}/${EXPECTATIONS.length} observed`)

    return seen
  } finally {
    // RACED, NOT AWAITED. `browser.close()` carries no default timeout, and it was one of
    // only two unbounded awaits in this file when run 36387113309 hung for 926.4s. By this
    // point every beacon is already in `seen`, so a browser that refuses to close must not
    // be allowed to cost the verdict -- the process exits moments later regardless.
    const closedAt = Date.now()
    const closed = await Promise.race([
      browser.close().then(() => true, () => true),
      new Promise((r) => setTimeout(() => r(false), CLOSE_TIMEOUT_MS))
    ])
    progress(closed ? `browser closed in ${Date.now() - closedAt}ms` : `browser did not close within ${CLOSE_TIMEOUT_MS / 1000}s -- abandoning it`)
  }
}

/** Pure: (Map of id -> {status,url}) -> findings[]. Testable without a browser. */
export function evaluateBeacons(seen) {
  const findings = []
  for (const exp of EXPECTATIONS) {
    const hit = seen.get(exp.id)
    if (!hit) {
      findings.push({
        severity: 'fail',
        id: `analytics-${exp.id}-missing`,
        message: `no ${exp.method} request matching ${exp.urlPattern} fired within ${BEACON_WAIT_MS}ms of page load`
      })
      continue
    }
    if (!exp.acceptStatus(hit.status)) {
      findings.push({
        severity: 'fail',
        id: `analytics-${exp.id}-status`,
        message: exp.onWrongStatus ? exp.onWrongStatus(hit.status) : `${hit.url} returned HTTP ${hit.status}`
      })
    }
  }
  return findings
}

// A headless browser beacon cannot prove ingestion because Simple Analytics classifies it as bot
// traffic. Post a synthetic event through the first-party proxy and poll the Stats API for a
// count delta instead. Events avoid distorting the site's pageview total.
const INGESTION_EVENT_NAME = 'audit_ingestion_probe'
// Realistic desktop Chrome UA -- avoids SA's server-side UA reject-list
// (bot/crawl/curl/node-fetch/axios/...) that would classify the event as a bot.
const SYNTHETIC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
const INGESTION_POLL_TIMEOUT_MS = 180_000 // measured latency ~11-32s; generous margin
const INGESTION_POLL_INTERVAL_MS = 15_000
// 2-day UTC window (today-1d..today) so the just-fired event is always inside
// the window even if the run straddles UTC midnight. timezone=UTC is pinned
// because the Stats API otherwise defaults to the site's dashboard timezone
// (docs.simpleanalytics.com/api/helpers).
const SA_QUERY_WINDOW_DAYS = 1

/** Pure: Stats API URL that returns the count for a named event. */
export function saEventsQueryUrl(hostname, eventName, windowDays) {
  const params = new URLSearchParams({version: '6', fields: 'pageviews', events: eventName, start: `today-${windowDays}d`, end: 'today', timezone: 'UTC'})
  return `https://simpleanalytics.com/${hostname}.json?${params}`
}

/** Pure: extract a named event's total from a Stats API response (0 if absent). */
export function eventTotal(json, eventName) {
  const ev = Array.isArray(json?.events) ? json.events.find((e) => e?.name === eventName) : null
  return ev && typeof ev.total === 'number' ? ev.total : 0
}

/** Pure: the server-side SA event payload (POSTed to the /simple/events proxy). */
export function syntheticEventPayload(hostname, eventName, ua) {
  return {type: 'event', hostname, event: eventName, ua, unique: true}
}

/**
 * Pure decision -> findings[]. Testable without network. Given the resolved
 * outcome of the trigger-then-confirm flow, decide pass/fail:
 *   - a pre-resolved I/O `error` -> fail (surfaced with its own id)
 *   - after > before -> confirmed (info finding carrying the measured latency)
 *   - otherwise -> the delta was never observed within the timeout -> fail
 *
 * @param {object} r
 * @param {string} r.eventName
 * @param {number} [r.before]
 * @param {number} [r.after]
 * @param {number} [r.elapsedMs]
 * @param {number} [r.timeoutMs]
 * @param {{id: string, message: string}} [r.error]
 * @returns {Array<{severity: string, id: string, message: string}>}
 */
export function evaluateIngestion({eventName, before, after, elapsedMs, timeoutMs, error}) {
  if (error) {
    return [{severity: 'fail', id: error.id, message: error.message}]
  }
  if (typeof before === 'number' && typeof after === 'number' && after > before) {
    return [{
      severity: 'info',
      id: 'analytics-sa-ingestion-confirmed',
      message: `SA ingestion confirmed end-to-end: event "${eventName}" count ${before} -> ${after} in ~${
        Math.round(elapsedMs / 1000)
      }s (server-side POST -> SA collector -> Stats API).`
    }]
  }
  return [{
    severity: 'fail',
    id: 'analytics-sa-ingestion-not-observed',
    message: `SA ingestion NOT observed: event "${eventName}" count did not increase from ${before} within ${
      Math.round(timeoutMs / 1000)
    }s (last seen ${after}). The first-party proxy -> SA collector -> Stats API pipeline may be broken.`
  }]
}

/** Read the current SA count for `eventName`. Network I/O; returns {ok, total} or {ok:false, error}. */
async function readEventTotal(queryUrl, apiKey, eventName) {
  let res
  try {
    res = await fetchStable(queryUrl, {headers: {'Api-Key': apiKey}})
  } catch (err) {
    return {ok: false, error: {id: 'analytics-sa-stats-api-fetch', message: `Stats API fetch failed: ${err.message}`}}
  }
  let json
  try {
    json = await res.json()
  } catch (err) {
    return {ok: false, error: {id: 'analytics-sa-stats-api-parse', message: `Stats API did not return valid JSON: ${err.message}`}}
  }
  if (!res.ok || json?.ok !== true) {
    return {ok: false, error: {id: 'analytics-sa-stats-api-error', message: `SA Stats API error (HTTP ${res.status}): ${json?.error ?? '(no error field)'}`}}
  }
  return {ok: true, total: eventTotal(json, eventName)}
}

/**
 * Trigger-then-confirm ingestion test. Reads the event's baseline count, POSTs a
 * fresh server-side event through the first-party /simple/events proxy, then
 * polls the Stats API until the count increments (or the timeout is hit).
 * The pure decision lives in evaluateIngestion (unit tested).
 */
async function checkSaIngestion(apiKey) {
  const hostname = new URL(SITE_URL).hostname
  const eventsUrl = `${SITE_URL}/simple/events`
  const queryUrl = saEventsQueryUrl(hostname, INGESTION_EVENT_NAME, SA_QUERY_WINDOW_DAYS)

  progress(`reading SA baseline count for "${INGESTION_EVENT_NAME}"`)
  const beforeRead = await withHeartbeat('SA Stats API baseline read', () => readEventTotal(queryUrl, apiKey, INGESTION_EVENT_NAME))
  if (!beforeRead.ok) {
    progress(`baseline read failed: ${beforeRead.error.id}`)
    return evaluateIngestion({eventName: INGESTION_EVENT_NAME, error: beforeRead.error})
  }
  const before = beforeRead.total
  progress(`baseline count is ${before}; posting synthetic event to ${eventsUrl}`)

  const startedAt = Date.now()
  try {
    // Bounded but deliberately NOT routed through fetchStable: retrying this POST
    // could ingest the synthetic event twice and skew the before/after count.
    await fetch(eventsUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'User-Agent': SYNTHETIC_UA},
      body: JSON.stringify(syntheticEventPayload(hostname, INGESTION_EVENT_NAME, SYNTHETIC_UA)),
      signal: AbortSignal.timeout(DEFAULT_BUDGET_MS)
    })
  } catch (err) {
    return evaluateIngestion({
      eventName: INGESTION_EVENT_NAME,
      error: {id: 'analytics-sa-ingestion-post-failed', message: `could not POST synthetic event to ${eventsUrl}: ${err.message}`}
    })
  }

  let after = before
  let polls = 0
  const deadline = startedAt + INGESTION_POLL_TIMEOUT_MS
  progress(`polling the Stats API every ${INGESTION_POLL_INTERVAL_MS / 1000}s for up to ${INGESTION_POLL_TIMEOUT_MS / 1000}s`)
  while (Date.now() < deadline) {
    // The sleep is clamped to what is LEFT of the window. It used to be a flat
    // interval taken after the `while` test, so the last iteration could start at
    // deadline-1ms and still spend a full interval plus a full read -- pushing the
    // phase past its own stated 180s bound by ~35s for no added signal.
    await new Promise((r) => setTimeout(r, Math.min(INGESTION_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))))
    polls++
    const read = await readEventTotal(queryUrl, apiKey, INGESTION_EVENT_NAME)
    // One line per poll is what keeps this phase audible: at a 15s interval the gap
    // between consecutive lines is an order of magnitude inside the ~600s deadline.
    progress(`poll ${polls} at +${Math.round((Date.now() - startedAt) / 1000)}s -- ${read.ok ? `count ${read.total}` : `read failed (${read.error.id})`}`)
    if (read.ok) {
      after = read.total
      if (after > before) {
        break
      }
    }
  }
  return evaluateIngestion({eventName: INGESTION_EVENT_NAME, before, after, elapsedMs: Date.now() - startedAt, timeoutMs: INGESTION_POLL_TIMEOUT_MS})
}

async function main() {
  const findings = []

  // The measurement channel (atlas decision 0122): one per EXPECTATION the browser
  // observed a response for. Each is a live transport probe, so observing three of
  // four is a finding about the missing beacon, while observing none means the page
  // never loaded or nothing left the browser -- the transport-dark shape.
  //
  // The launch/navigation failure is caught rather than left to reject. An unhandled
  // rejection exits nonzero having written no count, and `continue-on-error: true`
  // then swallows it into a green daily tile: the exact defect this channel closes.
  let seen = new Map()
  try {
    seen = await withHeartbeat('the browser beacon phase', () => collectBeaconEvents(SITE_URL))
  } catch (err) {
    findings.push({
      severity: 'fail',
      id: 'analytics-page-load-failed',
      message: `could not load ${SITE_URL} in a headless browser, so no beacon could be observed: ${err.message}`
    })
  }
  findings.push(...evaluateBeacons(seen))

  const saApiKey = process.env.SA_API_KEY
  if (saApiKey) {
    progress('SA_API_KEY present -- running the end-to-end ingestion confirmation')
    findings.push(...(await checkSaIngestion(saApiKey)))
  } else {
    // Explicit, visible SKIPPED marker -- never silently green when a whole
    // sub-check didn't run (§8 Q2: SA_API_KEY is a Phase 0 user-provisioned secret).
    findings.push({
      severity: 'info',
      id: 'analytics-sa-ingestion-skipped',
      message: 'SKIPPED(server-side): SA_API_KEY not set -- end-to-end SA ingestion confirmation (synthetic event -> Stats API delta) was not run'
    })
  }

  process.exit(report('check-analytics', findings, seen.size))
}

if (isMain(import.meta.url)) {
  main()
}
