#!/usr/bin/env node
// scripts/audit/check-analytics.mjs -- B6. Loads the live homepage in a real
// browser (Playwright chromium, the same engine/dependency as
// playwright.smoke.config.ts -- no launch-arg determinism flags needed here
// either, since this takes no screenshots) and asserts BOTH first-party
// analytics proxies actually fire:
//   - Cloudflare Web Analytics: GET /cf-insights.js (200) then POST /cf-rum
//   - Simple Analytics: GET /sa (200) then GET /simple/simple.gif (pageview)
//
// Status codes below were captured from a REAL browser-triggered request
// (not a hand-built curl probe -- an earlier curl attempt lacking the SA
// client's full query string got HTTP 200 from the same route, which would
// have been the wrong assertion). Verified live 2026-07-16: /cf-rum forwards
// upstream.status when ok (contract doc in functions/cf-rum.ts says "ALWAYS a
// clean 2xx"), and the real SA collector accepts a well-formed pageview ping
// with HTTP 202 (functions/simple/[[path]].ts forwards upstream.status verbatim).
//
// The `/simple/append` sendBeacon ping (used for on-page-duration tracking)
// only fires on pagehide/visibilitychange, not on initial load -- it is NOT
// asserted here to keep this check fast and deterministic; the pageview pixel
// already proves the SA collection path is wired end-to-end.
//
// When SA_API_KEY is set, a second, server-side check proves the SA INGESTION
// pipeline works END TO END: it fires a synthetic SA event through the
// first-party /simple/events proxy and polls the Stats API until that event's
// count increments (an after > before delta). See checkSaIngestion for the
// empirical basis (the headless browser beacon is bot-filtered and never
// counted; a server-side EVENT is, in ~11-32s, and doesn't distort real
// pageview metrics).

import {chromium} from '@playwright/test'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'

const NAV_TIMEOUT_MS = 30_000
const BEACON_WAIT_MS = 15_000

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
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const seen = new Map() // id -> { status, method }

    page.on('response', (res) => {
      const req = res.request()
      for (const exp of EXPECTATIONS) {
        if (exp.urlPattern.test(res.url()) && req.method() === exp.method && !seen.has(exp.id)) {
          seen.set(exp.id, {status: res.status(), url: res.url()})
        }
      }
    })

    await page.goto(url, {waitUntil: 'load', timeout: NAV_TIMEOUT_MS})

    const deadline = Date.now() + BEACON_WAIT_MS
    while (seen.size < EXPECTATIONS.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
    }

    return seen
  } finally {
    await browser.close()
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

// --- SA end-to-end ingestion check (trigger a synthetic event, then confirm) ---
//
// This is a REAL end-to-end pipeline test: fire a server-side Simple Analytics
// EVENT through our own first-party proxy, then poll the SA Stats API until the
// event's count increments (an after > before DELTA). It confirms
// first-party proxy -> SA collector -> ingestion -> Stats API, unambiguously.
//
// The design was chosen EMPIRICALLY (not from docs) -- see the PR thread on #150
// for the full experiment log. Key measured facts against the live account:
//   1. The client-side headless beacon is NOT counted. SA's own script stamps
//      `bot=true` in the pixel params when it detects the automated browser
//      (HeadlessChrome UA / navigator.webdriver), so a Playwright-driven page
//      load can never be confirmed via the API -- proven: a real-UA, bot=false,
//      residential-IP pixel replay to a unique path stayed at 0 pageviews for
//      7+ minutes.
//   2. A server-side EVENT posted to the SA collect API (`/simple/events` proxy
//      -> queue.simpleanalyticscdn.com) with a realistic UA IS counted, and is
//      queryable via `?fields=pageviews&events=<name>` -> `events:[{name,total}]`.
//      Measured ingestion latency: ~11-32s, including from a GitHub Actions
//      Azure datacenter IP (the proxy forwards CF-Connecting-IP as
//      X-Forwarded-For, so SA sees the runner IP -- it is NOT datacenter-filtered
//      here). This is why the poll below only needs a few-minute budget.
//   3. We use an EVENT, not a pageview, on purpose: events are separate from
//      pageviews/visitors in SA, so the daily synthetic signal does NOT distort
//      this low-traffic site's real pageview metrics (a synthetic pageview would
//      roughly double them). One fixed event name = one tidy dashboard row.
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

  const beforeRead = await readEventTotal(queryUrl, apiKey, INGESTION_EVENT_NAME)
  if (!beforeRead.ok) {
    return evaluateIngestion({eventName: INGESTION_EVENT_NAME, error: beforeRead.error})
  }
  const before = beforeRead.total

  const startedAt = Date.now()
  try {
    await fetch(eventsUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'User-Agent': SYNTHETIC_UA},
      body: JSON.stringify(syntheticEventPayload(hostname, INGESTION_EVENT_NAME, SYNTHETIC_UA))
    })
  } catch (err) {
    return evaluateIngestion({
      eventName: INGESTION_EVENT_NAME,
      error: {id: 'analytics-sa-ingestion-post-failed', message: `could not POST synthetic event to ${eventsUrl}: ${err.message}`}
    })
  }

  let after = before
  const deadline = startedAt + INGESTION_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, INGESTION_POLL_INTERVAL_MS))
    const read = await readEventTotal(queryUrl, apiKey, INGESTION_EVENT_NAME)
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

  const seen = await collectBeaconEvents(SITE_URL)
  findings.push(...evaluateBeacons(seen))

  const saApiKey = process.env.SA_API_KEY
  if (saApiKey) {
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

  process.exit(report('check-analytics', findings))
}

if (isMain(import.meta.url)) {
  main()
}
