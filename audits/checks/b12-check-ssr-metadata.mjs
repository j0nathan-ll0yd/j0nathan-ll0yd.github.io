#!/usr/bin/env node
// audits/checks/b12-check-ssr-metadata.mjs -- B12. Production metadata-consistency check for the
// server-rendered `/` (atlas decision 0160, plan Step 6.9).
//
// PROPERTY. The page's three statements about itself agree: the `X-SSR-Data` header, the
// `<meta name="ssr-data">` tag, and the ten cards' `data-ssr-state` / `data-generated-at`.
// SEAM WATCHED. The Worker's summary path (the header it writes) against the page body (the meta
// and attributes the layout writes). The two come from separate code paths, so they can drift
// apart while each stays plausible alone.
// WHY NO OTHER MEASURER SEES IT. B11 judges values against the exports and never compares the
// header with the body. The Worker unit tests see one code path at a time. This check holds NO
// export: it asserts consistency only, never correctness.
//
// The summary rule is restated here from the render contract: over the ten live cards' final
// states, `suppressed` (any suppressed), `unavailable` (all unavailable), `live` (all live or
// empty), `stale` (all live, empty or stale with at least one stale), else `partial`. The Worker
// adds `fallback` and `error`.

import {isMain, report} from '../lib/http.mjs'
import {publishIssueOutcome} from '../lib/measurement.mjs'
import {CARD_IDS, CARD_STATES, fetchPage, parsePage, RENDER_SUMMARIES, WORKER_SUMMARIES} from '../lib/ssr-evidence.mjs'

// A18 coverage declaration (atlas decision 0145). Empty is a claim: this check holds the served
// page only, and the page is not a registered estate artifact. Metadata only.
export const ARTIFACTS = []

const fail = (id, message) => ({severity: 'fail', id, message})
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** The summary the ten card states imply. First match wins. */
export function summarizeStates(states) {
  if (states.includes('suppressed')) {
    return 'suppressed'
  }
  if (states.every((state) => state === 'unavailable')) {
    return 'unavailable'
  }
  if (states.every((state) => state === 'live' || state === 'empty')) {
    return 'live'
  }
  if (states.every((state) => state === 'live' || state === 'empty' || state === 'stale')) {
    return 'stale'
  }
  return 'partial'
}

/** Judges parsed page evidence and the response status. Pure. */
export function judgeMetadata(parsed, status) {
  const findings = []
  if (status !== 200) {
    findings.push(fail('ssr-meta-status', `GET / answered HTTP ${status}`))
  }
  if (parsed.header === null) {
    findings.push(fail('ssr-header-missing', 'the response carries no X-SSR-Data header'))
  } else if (![...RENDER_SUMMARIES, ...WORKER_SUMMARIES].includes(parsed.header)) {
    findings.push(fail('ssr-header-unknown', `X-SSR-Data is ${JSON.stringify(parsed.header)}, not a known summary`))
  }

  const workerPage = WORKER_SUMMARIES.includes(parsed.header)
  if (parsed.metaCount > 1) {
    findings.push(fail('ssr-meta-duplicate', `${parsed.metaCount} <meta name="ssr-data"> tags, expected one`))
  }
  if (workerPage) {
    // The Worker's data-free page and its 500 page are not renders: they have no data cards to date.
    if (parsed.generatedAtAttributes > 0) {
      findings.push(
        fail('ssr-worker-page-generated-at', `X-SSR-Data is "${parsed.header}" but ${parsed.generatedAtAttributes} data-generated-at attribute(s) render`)
      )
    }
    return findings
  }

  if (parsed.metaCount === 0) {
    findings.push(fail('ssr-meta-missing', 'the page carries no <meta name="ssr-data"> tag'))
  } else if (parsed.header !== null && parsed.meta !== parsed.header) {
    findings.push(
      fail('ssr-header-meta-disagree', `X-SSR-Data is ${JSON.stringify(parsed.header)} but <meta name="ssr-data"> is ${JSON.stringify(parsed.meta)}`)
    )
  }

  const states = []
  for (const id of CARD_IDS) {
    const card = parsed.cards[id]
    if (card.count !== 1) {
      findings.push(fail('ssr-card-count', `${id} appears ${card.count} time(s), expected once`))
      continue
    }
    if (!CARD_STATES.includes(card.state)) {
      findings.push(fail('ssr-card-state-invalid', `${id} data-ssr-state is ${JSON.stringify(card.state)}`))
      continue
    }
    states.push(card.state)
    const dataState = card.state === 'live' || card.state === 'stale'
    if (dataState && card.generatedAt === null) {
      findings.push(fail('ssr-generated-at-missing', `${id} is ${card.state} but carries no data-generated-at`))
    } else if (!dataState && card.generatedAt !== null) {
      findings.push(fail('ssr-generated-at-on-non-data-card', `${id} is ${card.state} but carries data-generated-at=${JSON.stringify(card.generatedAt)}`))
    } else if (card.generatedAt !== null && (!ISO_INSTANT.test(card.generatedAt) || Number.isNaN(Date.parse(card.generatedAt)))) {
      findings.push(fail('ssr-generated-at-invalid', `${id} data-generated-at is ${JSON.stringify(card.generatedAt)}, not an ISO instant`))
    }
  }

  if (states.length === CARD_IDS.length && parsed.header !== null) {
    const expected = summarizeStates(states)
    if (parsed.header !== expected) {
      findings.push(fail('ssr-summary-mismatch', `X-SSR-Data is ${JSON.stringify(parsed.header)} but the ten card states imply ${JSON.stringify(expected)}`))
    }
  }
  if (parsed.header === 'suppressed' && parsed.generatedAtAttributes > 0) {
    findings.push(fail('ssr-suppressed-generated-at', `the page is suppressed but ${parsed.generatedAtAttributes} data-generated-at attribute(s) render`))
  }
  return findings
}

/** Header values for a rendered page; the Worker's own pages are exempt. */
export function judgeCacheHeaders(headers, summary) {
  if (summary === null || WORKER_SUMMARIES.includes(summary)) {
    return []
  }
  const findings = []
  if (headers.get('cdn-cache-control') !== 'no-store') {
    findings.push(
      fail('ssr-cache-header', `CDN-Cache-Control is ${JSON.stringify(headers.get('cdn-cache-control'))}, expected "no-store" on a server render`)
    )
  }
  if ((headers.get('content-type') ?? '').split(';')[0].trim() !== 'text/html') {
    findings.push(fail('ssr-content-type', `Content-Type is ${JSON.stringify(headers.get('content-type'))}, expected text/html`))
  }
  return findings
}

export async function runMetadata({fetchPageImpl = fetchPage} = {}) {
  let page
  try {
    page = await fetchPageImpl()
  } catch (err) {
    return {findings: [fail('ssr-meta-fetch', `GET / failed: ${err instanceof Error ? err.message : String(err)}`)], measured: 0, outcome: 'failure'}
  }
  const parsed = parsePage(page.html, page.headers)
  const findings = [...judgeMetadata(parsed, page.status), ...judgeCacheHeaders(page.headers, parsed.header)]
  return {findings, measured: 1, outcome: findings.some((f) => f.severity === 'fail') ? 'failure' : 'success'}
}

async function main() {
  const {findings, measured, outcome} = await runMetadata()
  publishIssueOutcome(outcome)
  process.exit(report('ssr-metadata', findings, measured))
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    publishIssueOutcome('failure')
    process.exit(report('ssr-metadata', [fail('ssr-meta-crash', `check crashed before measuring: ${err.message}`)], 0))
  })
}
