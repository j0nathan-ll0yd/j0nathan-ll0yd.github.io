#!/usr/bin/env node
// audits/checks/b2-check-not-found.mjs -- B2. The deployed 404, under a markdown Accept and under
// an HTML one (atlas decision 0158; website #350; atlas #443 records the gap on
// `site-not-found-markdown`).
//
// THE PROPERTY. A path that does not exist, requested with `Accept: text/markdown`, answers 404
// with a `text/markdown` body that starts with a heading. The same path requested with
// `Accept: text/html` still answers 404 with the HTML page. src/lib/edge/middleware.ts implements
// both: under the homepage negotiation decision (`prefersMarkdown`) a routed 404 is replaced by the
// generated NOT_FOUND_MARKDOWN body, status kept, `Cache-Control: no-store`, `Vary: Accept`.
//
// THE SEAM IT WATCHES. The DEPLOYED Worker and the zone in front of it. tests/unit/
// not-found-markdown.test.ts proves the generated body and tests/unit/middleware-negotiation.test.ts
// proves the negotiation, both against source. Neither sees what production answers: a deploy that
// drops the middleware branch, an asset-plane 404 that never reaches the Worker, or a zone rule that
// rewrites error pages would all leave every unit test green.
//
// WHY NO EXISTING MEASURER SEES THAT SEAM. No scheduled lane requests a missing path, and none
// sends a markdown Accept to anything but the homepage. b2-llms.mjs requests the three llms
// documents. b2-check-crawler-edge.mjs requests existing agent surfaces with crawler User-Agent
// tokens. The other B2 checks fetch existing artifacts. The post-deploy smoke suite loads pages in a
// browser and GETs a fixed list of existing paths. A missing path is outside every one of their
// samples.
//
// A FETCH FAILURE IS INDETERMINATE, NEVER CLEAN (the b2-check-spec-drift.mjs convention). A probe
// that never got a response is a `fail` finding with the INDETERMINATE prefix and is not counted in
// `measured`. Each held response counts once, whatever its verdict.
//
// MANAGED ISSUE. `issue_outcome` follows the reconciler's tri-state: a held 404 that breaks the
// property is `failure`; otherwise an unanswered probe is `indeterminate`, which leaves the issue as
// it stands; only two held, correct 404s are `success`. The step exits 1 on an unanswered probe, so
// the step outcome cannot tell a transport blip from a defect, and the reconciler never reads it.
//
// ITS OWN DOUBTS. It samples one missing path per run, so a 404 that differs by path prefix (an
// asset-plane prefix the Worker never runs for) is outside its sample. It reads the markdown body's
// shape, not its exact bytes, so a stale deploy of the old body still passes; the unit test owns the
// bytes.

import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {DEFAULT_BUDGET_MS, fetchStable, isMain, report} from '../lib/http.mjs'
import {publishIssueOutcome} from '../lib/measurement.mjs'
import {progress, withHeartbeat} from '../lib/progress.mjs'

export const CHECK_ID = 'check-not-found'

// A18 coverage declaration (atlas decision 0145). Empty is a claim, not a gap: this runner holds
// the site's 404 responses, which the surface registry does not register as an artifact.
// Metadata only -- the hub reads it statically.
export const ARTIFACTS = []

/** The prefix of the missing path. A per-run suffix keeps every probe off any cache. */
export const MISSING_PATH_PREFIX = '/__audit-not-found-'

/** The two probes: what each sends and what the deployed 404 must answer. */
export const PROBES = Object.freeze([
  {id: 'markdown', accept: 'text/markdown', mediaType: 'text/markdown'},
  {id: 'html', accept: 'text/html', mediaType: 'text/html'}
])

/** A missing path, unique to this run. */
export function missingPath(nonce = Date.now().toString(36)) {
  return `${MISSING_PATH_PREFIX}${nonce}`
}

/** The media type of a Content-Type value, lowercased, parameters removed. */
export function mediaTypeOf(contentType) {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

/** True when a Vary value names Accept (or `*`). */
export function varyNamesAccept(vary) {
  return (vary ?? '').split(',').map((token) => token.trim().toLowerCase()).some((token) => token === 'accept' || token === '*')
}

/**
 * Judge one held response against its probe. Returns the list of problems; empty means it holds.
 * `response` is `{status, contentType, vary, contentUsage, body}`.
 */
export function judgeResponse(probe, response) {
  const problems = []
  if (!response.contentUsage) {
    problems.push('no Content-Usage header, so the site never answered it (the zone or another layer did)')
  }
  if (response.status !== 404) {
    problems.push(`HTTP ${response.status}, expected 404`)
  }
  const mediaType = mediaTypeOf(response.contentType)
  if (mediaType !== probe.mediaType) {
    problems.push(`Content-Type ${JSON.stringify(response.contentType)}, expected ${probe.mediaType}`)
  }
  if (!varyNamesAccept(response.vary)) {
    problems.push(`Vary ${JSON.stringify(response.vary)} does not name Accept, so a cache can serve one representation for the other`)
  }
  if (probe.id === 'markdown' && !/^#{1,6} \S/.test(response.body.trimStart())) {
    problems.push('the markdown body does not open with a heading')
  }
  if (probe.id === 'html' && !/^<!doctype html/i.test(response.body.trimStart())) {
    problems.push('the HTML body does not open with <!DOCTYPE html>')
  }
  return problems
}

/**
 * Findings, the measured count and `issueOutcome` for the probe outcomes. Each outcome is
 * `{probe, url, response}` for a held response or `{probe, url, error}` for one that never came.
 */
export function judgeProbes(outcomes) {
  const findings = []
  let measured = 0
  let failed = 0
  let unknown = 0
  for (const {probe, url, response, error} of outcomes) {
    const target = `${url} with Accept: ${probe.accept}`
    if (error) {
      unknown++
      findings.push({
        severity: 'fail',
        id: 'not-found-indeterminate',
        message: `INDETERMINATE -- no response for ${target} (${error}). The check could not look, so it reports rather than assumes.`
      })
      continue
    }
    measured++
    const problems = judgeResponse(probe, response)
    if (problems.length > 0) {
      failed++
      findings.push({severity: 'fail', id: `not-found-${probe.id}`, message: `${target}: ${problems.join('; ')}`})
    }
  }
  const issueOutcome = failed > 0 ? 'failure' : unknown > 0 ? 'indeterminate' : 'success'
  return {findings, measured, issueOutcome}
}

/** Run each probe once. A transport failure becomes `{error}`. */
export async function runProbes(path, {fetchImpl = fetchStable, log = console.log} = {}) {
  const url = `${SITE_URL}${path}`
  const outcomes = []
  for (const probe of PROBES) {
    try {
      const res = await withHeartbeat(`${url} (${probe.accept})`, () =>
        fetchImpl(url, {headers: {Accept: probe.accept}, redirect: 'manual'}, DEFAULT_BUDGET_MS), {log})
      const response = {
        status: res.status,
        contentType: res.headers.get('content-type'),
        vary: res.headers.get('vary'),
        contentUsage: res.headers.get('content-usage'),
        body: await res.text()
      }
      progress(`${probe.accept} -> HTTP ${response.status} ${response.contentType}`, {log})
      outcomes.push({probe, url, response})
    } catch (err) {
      progress(`${probe.accept} -> no response (${err.message})`, {log})
      outcomes.push({probe, url, error: err.message})
    }
  }
  return outcomes
}

// Stryker disable all -- main() is network-path plumbing (fetchStable, process.exit). The pure
// judgeResponse / judgeProbes above carry the logic.
async function main() {
  const {findings, measured, issueOutcome} = judgeProbes(await runProbes(missingPath()))
  publishIssueOutcome(issueOutcome)
  process.exit(report(CHECK_ID, findings, measured))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
