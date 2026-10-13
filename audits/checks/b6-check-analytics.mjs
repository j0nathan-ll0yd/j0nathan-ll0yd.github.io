#!/usr/bin/env node
// Two arms, one per workflow step, selected by `--arm` (owner decision 2026-10-13, option A).
//
//   --arm beacons    Loads the live homepage in Playwright and requires both first-party analytics
//                    proxy chains to fire. Browser-observed statuses avoid curl-shape false
//                    positives. `measured` = beacons observed (0..4).
//   --arm ingestion  Posts a synthetic event through the first-party proxy and polls the SA Stats
//                    API for the count to rise, because headless pageviews are bot-filtered.
//                    `measured` = 1 when ingestion was judged (pass or fail), 0 when the arm was
//                    UNMEASURED or SKIPPED.
//
// WHY TWO STEPS. One step used to run both arms and publish `measured=<beacons seen>`, so a day
// the Stats API could not be read still published 4 and the dead-man ping stayed green. Each arm
// now publishes its own count, and `audits/healthchecks-ping.sh` wedges the daily tier on any
// step that claims 0. Both arms feed ONE managed-issue bucket (`analytics`, issue #149) through
// their own `issue_outcome`, so an unmeasured arm still reads `indeterminate` and never closes it.
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
// case is roughly 375s across both arms, comfortably inside one job budget, and no interval
// between two output lines can exceed the 30s heartbeat.

import {appendFileSync} from 'node:fs'
import {chromium} from '@playwright/test'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {DEFAULT_BUDGET_MS, fetchStable, isMain, report} from '../lib/http.mjs'
import {publishIssueOutcome} from '../lib/measurement.mjs'
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

/** Finding id for the no-key arm: the ingestion arm did not run, so the run cannot say "healthy". */
export const INGESTION_SKIPPED_ID = 'analytics-sa-ingestion-skipped'

/**
 * Failure codes that mean the runner never got an answer from Simple Analytics. Fetch reports
 * them as `err.cause.code` on its `TypeError: fetch failed`, and a body read reports them on its
 * `TypeError: terminated`. Node codes: connection reset, refused, DNS (permanent and temporary),
 * connect timeout, no route, broken pipe. undici codes, checked against `lib/core/errors.js` in
 * undici 8.11.2 and the undici 7.25.0 bundled with Node 24.16.0 (same codes): `SocketError`
 * (the peer closed or reset the socket) and the connect, headers, and body timeouts.
 *
 * Anything else is a defect and stays a fail: an invalid Api-Key byte, an invalid URL, a TLS
 * certificate error, or `UND_ERR_CLOSED` (a client our own code closed).
 */
export const UNREACHABLE_CAUSE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
])

/** Pure: an UNMEASURED error. It renders as a warn and makes the run's issue outcome indeterminate. */
function statsApiUnmeasured(id, reason) {
  return {id, unmeasured: true, message: `UNMEASURED: ${reason}. SA ingestion was not judged; this is runner egress or an SA outage, not a site finding.`}
}

/**
 * Pure: classify an error thrown by a Stats API request or by reading its body.
 *
 * Daily runs 37102564954, 37580690736 and 38356590370 failed in ~36ms with `fetch failed`
 * while all four site beacons were observed. The runner's egress allowlist had dropped SA's
 * address after a transient DNS miss (ci-runners-private #163). That is not a site failure, and
 * reporting it as one reopened issue #149 three times.
 *
 * ONE RULE FOR AN SA OUTAGE: when SA served no answer -- a transport failure listed in
 * `UNREACHABLE_CAUSE_CODES`, a budget timeout, or a 5xx after the fetch helper's retries -- the
 * run is UNMEASURED. An answer that points at our side (401 bad key, 404 wrong hostname, `ok:false`,
 * invalid JSON on a non-5xx) is a measurement and stays a fail. So is any unclassified throw.
 *
 * @param {Error & {cause?: {code?: string, message?: string}}} err
 * @returns {{id: string, message: string, unmeasured?: true}}
 */
export function classifyStatsReadError(err) {
  const causeCode = err?.cause?.code
  if (err?.name === 'TimeoutError' || UNREACHABLE_CAUSE_CODES.has(causeCode)) {
    const cause = causeCode || err?.cause?.message || err?.name || 'unknown'
    return statsApiUnmeasured('analytics-sa-stats-api-unreachable', `the runner could not reach the SA Stats API (${err?.message || err}; cause: ${cause})`)
  }
  const cause = causeCode || err?.cause?.message
  return {id: 'analytics-sa-stats-api-fetch', message: `Stats API fetch failed: ${err?.message || err}${cause ? ` (cause: ${cause})` : ''}`}
}

/**
 * Pure decision -> findings[]. Testable without network. Given the resolved
 * outcome of the trigger-then-confirm flow, decide pass/fail:
 *   - an `unmeasured` error -> warn carrying `unmeasured: true`, never fail
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
 * @param {{id: string, message: string, unmeasured?: boolean}} [r.error]
 * @returns {Array<{severity: string, id: string, message: string, unmeasured?: true}>}
 */
export function evaluateIngestion({eventName, before, after, elapsedMs, timeoutMs, error}) {
  if (error?.unmeasured) {
    return [{severity: 'warn', id: error.id, message: error.message, unmeasured: true}]
  }
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

/**
 * "Not observed" is a claim about the whole window, so it needs a successful read near its end.
 * Two poll intervals is the tolerance: one late or failed read near the deadline still counts.
 */
export const INGESTION_OBSERVED_TAIL_MS = 2 * INGESTION_POLL_INTERVAL_MS

/**
 * Pure: conclude the poll phase. Precedence:
 *   1. the count rose -> confirmed (success evidence outranks any earlier read error);
 *   2. a definite read error (401, bad JSON, unclassified throw) -> that fail, even if an
 *      unmeasured error came later;
 *   3. a successful read within `INGESTION_OBSERVED_TAIL_MS` of the deadline -> not observed (fail);
 *   4. otherwise the window was not watched to its end -> UNMEASURED.
 */
export function concludeIngestion({eventName, before, after, startedAt, endedAt, deadline, lastReadAt, definiteError, unmeasuredError}) {
  const timeoutMs = deadline - startedAt
  if (after > before) {
    return evaluateIngestion({eventName, before, after, elapsedMs: endedAt - startedAt, timeoutMs})
  }
  if (definiteError) {
    return evaluateIngestion({eventName, error: definiteError})
  }
  if (lastReadAt !== null && deadline - lastReadAt <= INGESTION_OBSERVED_TAIL_MS) {
    return evaluateIngestion({eventName, before, after, elapsedMs: endedAt - startedAt, timeoutMs})
  }
  const observedS = lastReadAt === null ? 0 : Math.round((lastReadAt - startedAt) / 1000)
  return evaluateIngestion({
    eventName,
    error: statsApiUnmeasured('analytics-sa-ingestion-unobserved',
      `the Stats API answered for only the first ${observedS}s of the ${Math.round(timeoutMs / 1000)}s ingestion window (last read error: ${
        unmeasuredError?.message ?? 'none'
      }), so "not ingested" cannot be claimed`)
  })
}

/**
 * Read the current SA count for `eventName`. Network I/O; returns {ok, total} or {ok:false, error}.
 * `fetchImpl` has the shared fetch helper's signature, so tests drive the real classification.
 */
export async function readEventTotal(queryUrl, apiKey, eventName, {fetchImpl = fetchStable} = {}) {
  let res
  try {
    res = await fetchImpl(queryUrl, {headers: {'Api-Key': apiKey}})
  } catch (err) {
    return {ok: false, error: classifyStatsReadError(err)}
  }
  if (res.status >= 500) {
    // SA served no answer after the helper's retries: the SA-outage rule in classifyStatsReadError.
    return {ok: false, error: statsApiUnmeasured('analytics-sa-stats-api-unavailable', `the SA Stats API returned HTTP ${res.status} after retries`)}
  }
  let json
  try {
    json = await res.json()
  } catch (err) {
    if (err instanceof SyntaxError) {
      return {ok: false, error: {id: 'analytics-sa-stats-api-parse', message: `Stats API did not return valid JSON: ${err.message}`}}
    }
    // The body stream itself failed (reset or timeout mid-body): the same classifier as the request.
    return {ok: false, error: classifyStatsReadError(err)}
  }
  if (!res.ok || json?.ok !== true) {
    return {ok: false, error: {id: 'analytics-sa-stats-api-error', message: `SA Stats API error (HTTP ${res.status}): ${json?.error ?? '(no error field)'}`}}
  }
  return {ok: true, total: eventTotal(json, eventName)}
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Trigger-then-confirm ingestion test. Reads the event's baseline count, POSTs a
 * fresh server-side event through the first-party /simple/events proxy, then
 * polls the Stats API until the count increments (or the timeout is hit).
 * The pure decisions live in evaluateIngestion and concludeIngestion (unit tested).
 * `fetchImpl`, `postImpl`, `now` and `sleep` are injectable so tests run the real path.
 */
export async function checkSaIngestion(apiKey, {fetchImpl = fetchStable, postImpl = fetch, now = Date.now, sleep = realSleep, siteUrl = SITE_URL} = {}) {
  const hostname = new URL(siteUrl).hostname
  const eventsUrl = `${siteUrl}/simple/events`
  const queryUrl = saEventsQueryUrl(hostname, INGESTION_EVENT_NAME, SA_QUERY_WINDOW_DAYS)

  progress(`reading SA baseline count for "${INGESTION_EVENT_NAME}"`)
  const beforeRead = await withHeartbeat('SA Stats API baseline read', () => readEventTotal(queryUrl, apiKey, INGESTION_EVENT_NAME, {fetchImpl}))
  if (!beforeRead.ok) {
    progress(`baseline read failed: ${beforeRead.error.id}`)
    return evaluateIngestion({eventName: INGESTION_EVENT_NAME, error: beforeRead.error})
  }
  const before = beforeRead.total
  progress(`baseline count is ${before}; posting synthetic event to ${eventsUrl}`)

  const startedAt = now()
  try {
    // Bounded but deliberately NOT routed through fetchStable: retrying this POST
    // could ingest the synthetic event twice and skew the before/after count.
    await postImpl(eventsUrl, {
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
  let lastReadAt = null
  let definiteError = null
  let unmeasuredError = null
  const deadline = startedAt + INGESTION_POLL_TIMEOUT_MS
  progress(`polling the Stats API every ${INGESTION_POLL_INTERVAL_MS / 1000}s for up to ${INGESTION_POLL_TIMEOUT_MS / 1000}s`)
  while (now() < deadline) {
    // The sleep is clamped to what is LEFT of the window. It used to be a flat
    // interval taken after the `while` test, so the last iteration could start at
    // deadline-1ms and still spend a full interval plus a full read -- pushing the
    // phase past its own stated 180s bound by ~35s for no added signal.
    await sleep(Math.min(INGESTION_POLL_INTERVAL_MS, Math.max(0, deadline - now())))
    polls++
    const read = await readEventTotal(queryUrl, apiKey, INGESTION_EVENT_NAME, {fetchImpl})
    // One line per poll is what keeps this phase audible: at a 15s interval the gap
    // between consecutive lines is an order of magnitude inside the ~600s deadline.
    progress(`poll ${polls} at +${Math.round((now() - startedAt) / 1000)}s -- ${read.ok ? `count ${read.total}` : `read failed (${read.error.id})`}`)
    if (read.ok) {
      lastReadAt = now()
      after = read.total
      if (after > before) {
        break
      }
    } else if (read.error.unmeasured) {
      unmeasuredError = read.error
    } else {
      definiteError ??= read.error
    }
  }
  return concludeIngestion({eventName: INGESTION_EVENT_NAME, before, after, startedAt, endedAt: now(), deadline, lastReadAt, definiteError, unmeasuredError})
}

/**
 * Pure: one arm's managed-issue tri-state for bucket `analytics` (audits/lib/file-check-issues.mjs).
 * Any fail files or keeps the issue. An unmeasured arm or a skipped arm (no SA_API_KEY) is
 * `indeterminate`: the arm judged nothing, so it may neither file nor close the issue (atlas
 * decisions 0104, 0142). The reconciler folds both arms' outcomes into the one bucket.
 */
export function issueOutcome(findings) {
  if (findings.some((finding) => finding.severity === 'fail')) {
    return 'failure'
  }
  if (findings.some((finding) => finding.unmeasured === true || finding.id === INGESTION_SKIPPED_ID)) {
    return 'indeterminate'
  }
  return 'success'
}

/**
 * Pure: the ingestion arm's `measured` count. 1 when the arm judged ingestion -- confirmed, not
 * observed, or a definite answer about our side such as an HTTP 401 -- and 0 when it judged
 * nothing. 0 wedges the daily tier on the day it happens (owner decision 2026-10-13, option A).
 *
 * A fail is judged and counts 1, even beside an unmeasured finding: the fail reaches the issue,
 * and the tile answers only "did the arm run to measurement".
 */
export function ingestionMeasured(findings) {
  return issueOutcome(findings) === 'indeterminate' ? 0 : 1
}

function annotationValue(value) {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

/** Make an unjudged ingestion arm visible: one workflow warning per finding and one step-summary line. */
function announceUnjudged(findings, {env, logger, append}) {
  const unjudged = findings.filter((finding) => finding.unmeasured === true || finding.id === INGESTION_SKIPPED_ID)
  for (const finding of unjudged) {
    const title = finding.unmeasured === true ? 'B6 SA Stats API UNMEASURED' : 'B6 SA ingestion SKIPPED'
    logger.log(`::warning title=${title}::${annotationValue(finding.message)}`)
  }
  if (unjudged.length > 0 && env.GITHUB_STEP_SUMMARY) {
    const state = unjudged.some((finding) => finding.unmeasured === true) ? 'UNMEASURED' : 'SKIPPED'
    append(env.GITHUB_STEP_SUMMARY, `- B6 SA ingestion: ${state} (measured=0) -- ${unjudged.map((finding) => finding.message).join(' | ')}\n`, 'utf8')
  }
}

/**
 * The beacons arm: load the live page, judge the four beacons, publish `measured` = beacons
 * observed and the arm's `issue_outcome`. Returns the exit code.
 *
 * The launch/navigation failure is caught rather than left to reject. An unhandled rejection exits
 * nonzero having written no count, and `continue-on-error: true` then swallows it -- the dead-man
 * reads that as `crashed-before-measuring`, but a caught failure keeps the finding in the report.
 */
export async function runBeaconsArm({env = process.env, collectBeacons = collectBeaconEvents} = {}) {
  const findings = []
  // One per EXPECTATION the browser observed a response for (atlas decision 0122). Each is a live
  // transport probe: three of four is a finding about the missing beacon, none is transport-dark.
  let seen = new Map()
  try {
    seen = await withHeartbeat('the browser beacon phase', () => collectBeacons(SITE_URL))
  } catch (err) {
    findings.push({
      severity: 'fail',
      id: 'analytics-page-load-failed',
      message: `could not load ${SITE_URL} in a headless browser, so no beacon could be observed: ${err.message}`
    })
  }
  findings.push(...evaluateBeacons(seen))

  const exitCode = report('check-analytics-beacons', findings, seen.size)
  publishIssueOutcome(issueOutcome(findings), {outputPath: env.GITHUB_OUTPUT})
  return exitCode
}

/**
 * The SA ingestion arm: synthetic event -> first-party proxy -> SA collector -> Stats API. Publishes
 * `measured` (1 judged, 0 unmeasured or skipped) and the arm's `issue_outcome`. Returns the exit
 * code. Every I/O edge is injectable; production passes nothing.
 *
 * NO SA_API_KEY PUBLISHES 0. The key is a provisioned repository secret, so its absence under
 * Actions is a lost secret, not a design state: the arm is dark, and a dark arm must turn the tile
 * red that day, exactly as an unreadable Stats API does. The same rule as the B2 Cloudflare
 * cache-rule step, whose refused token publishes 0. Outside Actions there is no output path, so a
 * workstation run without the key stays a visible SKIPPED and writes nothing.
 */
export async function runIngestionArm({
  env = process.env,
  fetchImpl = fetchStable,
  postImpl = fetch,
  now = Date.now,
  sleep = realSleep,
  logger = console,
  append = appendFileSync
} = {}) {
  const findings = []
  const saApiKey = env.SA_API_KEY
  if (saApiKey) {
    progress('SA_API_KEY present -- running the end-to-end ingestion confirmation')
    findings.push(...(await checkSaIngestion(saApiKey, {fetchImpl, postImpl, now, sleep})))
  } else {
    // Explicit, visible SKIPPED marker -- never silently green when the arm did not run.
    findings.push({
      severity: 'info',
      id: INGESTION_SKIPPED_ID,
      message: 'SKIPPED(server-side): SA_API_KEY not set -- end-to-end SA ingestion confirmation (synthetic event -> Stats API delta) was not run'
    })
  }

  const exitCode = report('check-analytics-ingestion', findings, ingestionMeasured(findings))
  publishIssueOutcome(issueOutcome(findings), {outputPath: env.GITHUB_OUTPUT})
  // AFTER both channels, and never fatal: a summary file that cannot be written must not reach
  // main()'s crash path, which would publish `failure` and file #149 for a run that judged nothing.
  try {
    announceUnjudged(findings, {env, logger, append})
  } catch (err) {
    console.error(`could not announce the unjudged ingestion arm: ${err?.message || err}`)
  }
  return exitCode
}

/** The arms `--arm` accepts, each mapped to its runner. */
export const ARMS = Object.freeze({beacons: runBeaconsArm, ingestion: runIngestionArm})

/**
 * Pure: read `--arm <name>` or `--arm=<name>` from argv. Required: each workflow step names its arm,
 * and a step that names none is a wiring defect, never "run both" -- running both would publish
 * one count for two arms, which is the defect this split removes.
 *
 * @returns {string|null} the arm name, or null when absent or unknown
 */
export function parseArm(argv) {
  const index = argv.findIndex((arg) => arg === '--arm' || arg.startsWith('--arm='))
  if (index < 0) {
    return null
  }
  const value = argv[index] === '--arm' ? argv[index + 1] : argv[index].slice('--arm='.length)
  return Object.hasOwn(ARMS, value) ? value : null
}

async function main() {
  const arm = parseArm(process.argv.slice(2))
  let exitCode
  try {
    if (arm === null) {
      throw new TypeError(`--arm must be one of ${Object.keys(ARMS).join('|')} (argv: ${JSON.stringify(process.argv.slice(2))})`)
    }
    exitCode = await ARMS[arm]()
  } catch (err) {
    // A crash judged nothing, but it must still file: `failure`, never a missing output that the
    // reconciler would read as indeterminate and leave a broken lane quiet. It publishes no count,
    // so the dead-man reads the failed step as `crashed-before-measuring`.
    console.error(`check-analytics${arm ? ` --arm ${arm}` : ''} terminated unexpectedly: ${err?.stack || err}`)
    publishIssueOutcome('failure')
    exitCode = 1
  }
  process.exit(exitCode)
}

if (isMain(import.meta.url)) {
  main()
}
