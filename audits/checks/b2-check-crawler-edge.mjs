#!/usr/bin/env node
// audits/checks/b2-check-crawler-edge.mjs -- B2. The EDGE against robots.txt (atlas
// decision 0158). robots.txt states which paths each named crawler may read. The
// Cloudflare zone decides which requests reach the site at all. The two are configured
// in different places, and on 2026-10-07 they disagreed: the zone answered ClaudeBot and
// GPTBot with a 25-byte "Your request was blocked." 403 on every path, including the
// /llms.txt their robots.txt group allows (decision 0158 evidence,
// live-probes-2026-10-07.md section 1).
//
// WHAT THIS MEASURES. For each NAMED User-agent group in the served robots.txt, every
// path that group may read is requested once with that group's token as the User-Agent.
// Each response is judged on one question: did the request pass the edge and reach the
// site? A 403 or the block body is a fail. A response without the site's own
// Content-Usage header is a fail too: the zone answered (a challenge, a rate limit, an
// edge error) and the site never saw the request. Every Pages Function response carries
// that header (functions/_middleware.ts), and so does every static asset
// (public/_headers), so its presence is the proof of reach.
//
// WHY NO OTHER CHECK SEES THIS. b2-validate-robots.mjs judges robots.txt TEXT with a
// default User-Agent, and every other audit check fetches the site with one too. None of
// them ever presents a crawler token, so the zone's per-crawler policy is invisible to
// all of them.
//
// ITS OWN DOUBT. A probe sends the token from the audit runner's IP, so it measures the
// zone's policy against a User-Agent CLAIM. A zone rule keyed on verified-bot IP ranges
// would treat real crawler traffic differently, and this check cannot see that.
//
// A FETCH FAILURE IS INDETERMINATE, NEVER CLEAN (the b2-check-spec-drift.mjs convention).
// A robots.txt the run cannot hold, or a probe that never got a response, is a fail
// finding, and it is not counted in `measured`.

import robotsParser from 'robots-parser'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts.ts'
import {DEFAULT_BUDGET_MS, fetchStable, isMain, report} from '../lib/http.mjs'
import {createDeadline, progress, withHeartbeat} from '../lib/progress.mjs'

// A18 coverage declaration (atlas decision 0145). Empty is a claim, not a gap: this
// runner holds edge RESPONSES to crawler-token requests, not a registered artifact. It
// reads /llms.txt only to see whether the edge lets the request through; it judges no
// llms.txt byte, so declaring llm-outputs here would claim a measurement it does not make.
export const ARTIFACTS = []

export const ROBOTS_URL = `${SITE_URL}/robots.txt`

/** The exact body the zone's block rule returns (25 bytes, live-probes-2026-10-07.md section 1). */
export const BLOCK_BODY = 'Your request was blocked.'

/**
 * Paths every group is TESTED for, beyond its own literal Allow lines. A probe runs only
 * where the group's robots.txt policy allows the path, so the root is probed for a group
 * with `Allow: /` and skipped for a training crawler with `Disallow: /`. /llms.txt is the
 * path decision 0158 names: the robots-allowed discovery index the training crawlers
 * could not reach.
 */
export const BASE_PATHS = ['/', LLMS_TXT_PATH]

/**
 * Wall-clock bound for the WHOLE probe phase (audits/lib/progress.mjs createDeadline).
 * Sixteen groups at about two probes each are ~30 requests; a healthy edge answers each in
 * well under a second. Three minutes leaves room for retried 5xx while staying far inside
 * the weekly tier's ceiling.
 */
export const PHASE_BUDGET_MS = 180_000

/**
 * The User-Agent a probe presents for a robots.txt token. The decision 0158 step-0
 * verification sends `<token>/1.0`, and the zone's block matched exactly that shape.
 */
export function userAgentFor(token) {
  return `${token}/1.0`
}

/**
 * The named groups of a robots.txt body, in file order: `{agents, allows}` per group.
 *
 * RFC 9309 section 2.1: a group is one or more consecutive `user-agent` lines followed by
 * its rules. A `user-agent` line after a rule starts a new group. The `*` group is
 * dropped: it names no crawler, so no User-Agent can stand for it. Only literal Allow
 * paths are kept (no `*` or `$` pattern), because a pattern is not a requestable URL.
 */
export function parseGroups(body) {
  const groups = []
  let current = null
  let lastWasAgent = false
  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) {
      continue
    }
    const directive = match[1].toLowerCase()
    const value = match[2].trim()
    if (directive === 'user-agent') {
      if (!lastWasAgent) {
        current = {agents: [], allows: []}
        groups.push(current)
      }
      current.agents.push(value)
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (directive === 'allow' && current && value.startsWith('/') && !/[*$]/.test(value)) {
      current.allows.push(value)
    }
  }
  return groups.map((group) => ({agents: group.agents.filter((agent) => agent !== '*'), allows: group.allows})).filter((group) => group.agents.length > 0)
}

/**
 * The probe plan: one `{agent, path}` per path a named agent may read, under the served
 * robots.txt as robots-parser evaluates it. Candidates are the group's literal Allow paths
 * plus BASE_PATHS; the robots policy decides which of them the agent may request.
 */
export function planProbes(body, robotsUrl = ROBOTS_URL) {
  const robots = robotsParser(robotsUrl, body)
  const origin = new URL(robotsUrl).origin
  const probes = []
  for (const group of parseGroups(body)) {
    const candidates = [...new Set([...group.allows, ...BASE_PATHS])]
    for (const agent of group.agents) {
      for (const path of candidates) {
        if (robots.isAllowed(`${origin}${path}`, agent) === true) {
          probes.push({agent, path})
        }
      }
    }
  }
  return probes
}

/**
 * Judge one edge response. `reached` means the request passed the zone and the site
 * answered it, whatever the status (a 404 or a focus-suppression 503 is still the site).
 * `blocked` is the zone's refusal. `intercepted` is any other answer the site did not
 * write: it lacks the Content-Usage header every site response carries.
 */
export function classifyResponse({status, contentUsage, body}) {
  if (status === 403 || body.trim() === BLOCK_BODY) {
    return 'blocked'
  }
  return contentUsage ? 'reached' : 'intercepted'
}

/**
 * Findings and the measured count for a set of probe outcomes. Each outcome is
 * `{agent, path, verdict, status}` for a held response, or `{agent, path, error}` for a
 * request that never got one. A held response counts as measured whatever its verdict.
 */
export function judgeProbes(outcomes) {
  const findings = []
  let measured = 0
  for (const outcome of outcomes) {
    const target = `${outcome.path} as User-Agent ${JSON.stringify(userAgentFor(outcome.agent))}`
    if (outcome.error) {
      findings.push({
        severity: 'fail',
        id: 'crawler-edge-indeterminate',
        message: `INDETERMINATE -- no response for ${target} (${outcome.error}). The check could not look, so it reports rather than assumes.`
      })
      continue
    }
    measured++
    if (outcome.verdict === 'blocked') {
      // A 403 that carries Content-Usage came from the site, not the zone; say so, so triage
      // starts in the right system.
      const who = outcome.fromSite ? 'the site refused' : 'the edge blocked'
      findings.push({
        severity: 'fail',
        id: 'crawler-edge-blocked',
        message: `${who} ${target} with HTTP ${outcome.status}, but robots.txt allows ${outcome.agent} to read ${outcome.path}`
      })
    } else if (outcome.verdict === 'intercepted') {
      findings.push({
        severity: 'fail',
        id: 'crawler-edge-intercepted',
        message: `the edge answered ${target} with HTTP ${outcome.status} and no Content-Usage header, so the site never saw a request robots.txt allows`
      })
    }
  }
  return {findings, measured}
}

/**
 * Retry only a 5xx the edge wrote. A 5xx that carries the site's Content-Usage header
 * (a focus-suppression 503, for example) already answers this check's question: the
 * request reached the site. Retrying it would spend the phase budget on a healthy edge.
 */
export function isEdge5xx(res) {
  return res.status >= 500 && !res.headers.get('content-usage')
}

/** Request one probe and classify the response. A transport failure becomes `{error}`. */
async function runProbe({agent, path}, {budgetMs, fetchImpl = fetchStable}) {
  try {
    const res = await fetchImpl(`${SITE_URL}${path}`, {headers: {'User-Agent': userAgentFor(agent)}, redirect: 'manual'}, budgetMs, undefined, isEdge5xx)
    const body = await res.text()
    const contentUsage = res.headers.get('content-usage')
    return {agent, path, status: res.status, fromSite: Boolean(contentUsage), verdict: classifyResponse({status: res.status, contentUsage, body})}
  } catch (err) {
    return {agent, path, error: err.message}
  }
}

/**
 * Run every probe sequentially inside one phase deadline. A probe left when the budget is
 * spent is reported as INDETERMINATE, never skipped silently.
 */
export async function runProbes(probes, {fetchImpl = fetchStable, budgetMs = PHASE_BUDGET_MS, now = Date.now, log = console.log} = {}) {
  const deadline = createDeadline(budgetMs, {now})
  progress(`probing ${probes.length} robots-allowed (agent, path) pair(s), ${Math.round(budgetMs / 1000)}s budget for the phase`, {log})
  const outcomes = []
  for (const probe of probes) {
    if (deadline.expired()) {
      outcomes.push({...probe, error: `${Math.round(deadline.elapsedMs() / 1000)}s phase budget already spent`})
      continue
    }
    const outcome = await withHeartbeat(`${probe.path} as ${probe.agent}`, () =>
      runProbe(probe, {fetchImpl, budgetMs: Math.min(DEFAULT_BUDGET_MS, deadline.remainingMs())}), {log, now})
    progress(`${probe.agent} ${probe.path} -> ${outcome.error ? `no response (${outcome.error})` : `HTTP ${outcome.status} ${outcome.verdict}`}`, {log})
    outcomes.push(outcome)
  }
  return outcomes
}

// Stryker disable all -- main() is network-path plumbing (fetchStable, process.exit). The
// pure parseGroups / planProbes / classifyResponse / judgeProbes above carry the logic.
async function main() {
  let body
  try {
    const res = await fetchStable(ROBOTS_URL)
    if (!res.ok) {
      process.exit(report('check-crawler-edge', [
        {severity: 'fail', id: 'crawler-edge-indeterminate', message: `INDETERMINATE -- HTTP ${res.status} fetching ${ROBOTS_URL}; no probe plan`}
      ], 0))
    }
    body = await res.text()
  } catch (err) {
    process.exit(report('check-crawler-edge', [
      {severity: 'fail', id: 'crawler-edge-indeterminate', message: `INDETERMINATE -- fetch failed for ${ROBOTS_URL}: ${err.message}; no probe plan`}
    ], 0))
  }

  const probes = planProbes(body)
  if (probes.length === 0) {
    process.exit(report('check-crawler-edge', [
      {severity: 'fail', id: 'crawler-edge-no-groups', message: `${ROBOTS_URL} names no crawler group with a readable path, so there is nothing to probe`}
    ], 0))
  }

  const {findings, measured} = judgeProbes(await runProbes(probes))
  process.exit(report('check-crawler-edge', findings, measured))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
