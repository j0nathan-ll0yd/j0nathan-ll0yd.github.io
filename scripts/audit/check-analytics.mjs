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

import {chromium} from '@playwright/test'
import {SITE_URL} from '@lifegames/portal-contract/constants'
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

/** Optional server-side confirmation via the SA Stats API (https://simpleanalytics.com/{hostname}.json). */
async function checkSaStatsApi(apiKey) {
  const hostname = new URL(SITE_URL).hostname
  const url = `https://simpleanalytics.com/${hostname}.json?version=5&fields=pageviews&start=today&end=today`
  let res
  try {
    res = await fetchStable(url, {headers: {'Api-Key': apiKey}})
  } catch (err) {
    return [{severity: 'fail', id: 'analytics-sa-stats-api-fetch', message: `fetch failed: ${err.message}`}]
  }
  let json
  try {
    json = await res.json()
  } catch (err) {
    return [{severity: 'fail', id: 'analytics-sa-stats-api-parse', message: `${url} did not return valid JSON: ${err.message}`}]
  }
  if (!res.ok || json.ok !== true) {
    return [{
      severity: 'fail',
      id: 'analytics-sa-stats-api-error',
      message: `SA Stats API returned an error (HTTP ${res.status}): ${json.error ?? '(no error field)'}`
    }]
  }
  if (!(typeof json.pageviews === 'number' && json.pageviews > 0)) {
    return [{
      severity: 'fail',
      id: 'analytics-sa-stats-api-zero-pageviews',
      message: `SA Stats API reports ${json.pageviews ?? 0} pageviews today for ${hostname} -- expected > 0`
    }]
  }
  return []
}

async function main() {
  const findings = []

  const seen = await collectBeaconEvents(SITE_URL)
  findings.push(...evaluateBeacons(seen))

  const saApiKey = process.env.SA_API_KEY
  if (saApiKey) {
    findings.push(...(await checkSaStatsApi(saApiKey)))
  } else {
    // Explicit, visible SKIPPED marker -- never silently green when a whole
    // sub-check didn't run (§8 Q2: SA_API_KEY is a Phase 0 user-provisioned secret).
    findings.push({
      severity: 'info',
      id: 'analytics-sa-stats-api-skipped',
      message: 'SKIPPED(server-side): SA_API_KEY not set -- server-side pageview confirmation via the SA Stats API was not run'
    })
  }

  process.exit(report('check-analytics', findings))
}

if (isMain(import.meta.url)) {
  main()
}
