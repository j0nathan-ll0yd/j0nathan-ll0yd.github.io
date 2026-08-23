#!/usr/bin/env node
// Loads the live homepage in Playwright and requires both first-party analytics proxy chains to
// fire. Browser-observed statuses avoid curl-shape false positives. With `SA_API_KEY`, it also
// posts a synthetic event and polls the Stats API because headless pageviews are bot-filtered.

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
