#!/usr/bin/env node
// External-spec CURRENCY probe (atlas decision 0129 C6).
//
// THE NAMED DOUBT: "the pinned clause is still what the specification says today."
//
// WHY THIS IS NOT b2-check-spec-drift.mjs. That check re-fetches each rule's
// `spec.verification_url` and asserts the normative_quote still occurs in it. But
// rule.schema.json constrains that field to three IMMUTABLE forms -- an RFC's
// canonical plaintext, a 40-hex commit-pinned raw.githubusercontent blob, or a
// numbered RSS Advisory Board archive -- and immutability is the property the drift
// probe DEPENDS on (a moving target cannot answer "was this transcribed faithfully").
// So drift verifies the integrity of a transcription and structurally cannot observe
// that the upstream document has been revised. Both probes are correct; they ask
// different questions of the same corpus, and nothing else in the estate asks this one.
//
// MEASURED RECEIPT. The llms.txt rules pin AnswerDotAI/llms-txt at c7178b9d with
// spec.retrieved 2026-07-30. Upstream main now serves a v2 of that document dated
// 2026-08-10: path-scope semantics, the "Optional" section rewritten, a new
// rel="alternate"/rel="describedby" recommendation, an RFC 8615 rationale. The five
// normative Format bullets are byte-identical, so no rule is wrong and no rule change
// is due. The point is that a month passed and the estate had no way to know.
//
// SEVERITY, DELIBERATELY SPLIT. An upstream editorial revision is a prompt to re-read,
// not a defect, so a moved source whose quote SURVIVES is `warn` and exits 0. A moved
// source whose quote is GONE is `fail`: the cited clause itself has changed, and the
// rule may now enforce a superseded reading. That split is the whole point of reporting
// what was compared rather than a bare verdict -- and `fail` is the only severity the
// managed-issue reconciler can see, so it is what makes a human look. This check runs
// weekly and report-only; it is wired into no PR gate, so neither severity can red a
// merge.
//
// A FETCH FAILURE IS INDETERMINATE, NEVER CLEAN -- the convention b2-check-spec-drift.mjs
// establishes in its own header. Judging currency needs BOTH blobs; if either is
// unreachable the probe could not look, so it reports rather than assumes.

import {createHash} from 'node:crypto'
import {DEFAULT_BUDGET_MS, isMain, report} from '../lib/http.mjs'
import {comparable, quoteSegments, readRawRules} from './b2-check-spec-drift.mjs'

export const CHECK_ID = 'check-spec-currency'

// `HEAD` resolves to the repository's default branch on raw.githubusercontent.com,
// so the current blob is reached without a second host and without hardcoding a
// branch name that a repository is free to rename.
const DEFAULT_BRANCH_REF = 'HEAD'

const GITHUB_RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(.+)$/

/**
 * Which currency question a pinned source admits.
 *
 * ONLY A COMMIT-PINNED GITHUB BLOB HAS ONE. An RFC's canonical plaintext and a
 * numbered RSS Advisory Board archive are immutable PUBLICATIONS: there is no
 * "current version at the same identity" to compare against, because a revision is
 * published under a new number at a new URL. Classifying them explicitly -- rather
 * than filtering them out -- is what keeps the reported denominator honest: a reader
 * sees 17 rules deliberately out of scope, not 17 rules quietly unexamined.
 *
 * @returns {{kind: 'github-raw', owner: string, repo: string, pinnedCommit: string, path: string, currentUrl: string, reason?: undefined}
 *          | {kind: 'immutable-publication' | 'unclassified', reason: string}}
 */
export function classifySource(url) {
  const m = GITHUB_RAW.exec(String(url))
  if (m) {
    const [, owner, repo, pinnedCommit, path] = m
    return {
      kind: 'github-raw',
      owner,
      repo,
      pinnedCommit,
      path,
      currentUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${DEFAULT_BRANCH_REF}/${path}`
    }
  }
  if (/^https:\/\/www\.rfc-editor\.org\/rfc\/rfc[0-9]+\.txt$/.test(String(url))) {
    return {
      kind: 'immutable-publication',
      reason:
        'an RFC is published once and never revised in place -- a revision becomes a new RFC number at a new URL, so there is no current version at this identity'
    }
  }
  if (/^https:\/\/www\.rssboard\.org\/rss-2-0-[0-9]+$/.test(String(url))) {
    return {
      kind: 'immutable-publication',
      reason:
        'the RSS Advisory Board publishes each specification revision as its own numbered archive page, so this URL names one frozen revision rather than a moving document'
    }
  }
  // rule.schema.json's verification_url anyOf admits exactly the three shapes above,
  // so reaching here means the schema widened without this classifier following. That
  // is an unexamined source, not an out-of-scope one, and it must not read as clean.
  return {
    kind: 'unclassified',
    reason: `no currency rule is defined for this URL shape -- rule.schema.json's verification_url patterns and ${CHECK_ID}'s classifier have diverged`
  }
}

/** Default fetcher: plain text, with a timeout. Injectable for tests. */
export async function fetchText(url) {
  const res = await fetch(url, {signal: AbortSignal.timeout(DEFAULT_BUDGET_MS), headers: {accept: 'text/plain, text/markdown, */*'}})
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return await res.text()
}

/**
 * Resolve the newest commit that touched `path` on the default branch.
 *
 * ENRICHMENT ONLY, and that is a deliberate boundary. The verdict is decided by
 * comparing BYTES, which needs no API and no credential; this call exists so the
 * report can name the commit a reader would re-pin to. A rate limit or an outage
 * here therefore degrades the report and never the verdict -- turning it into an
 * INDETERMINATE would make an advisory probe depend on a second service for a field
 * it does not judge on.
 *
 * @returns {Promise<string|null>} 40-hex commit sha, or null when unresolved
 */
export async function fetchCurrentCommit({owner, repo, path}, {fetchJson = defaultFetchJson} = {}) {
  try {
    const commits = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`)
    const sha = Array.isArray(commits) ? commits[0]?.sha : undefined
    return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

async function defaultFetchJson(url) {
  // GITHUB_TOKEN raises the unauthenticated 60/hr per-IP ceiling, which this
  // self-hosted runner shares with every other job on the host. Absent, the call
  // still works and simply degrades to null under contention.
  const token = process.env.GITHUB_TOKEN
  const res = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_BUDGET_MS),
    headers: {accept: 'application/vnd.github+json', ...(token ? {authorization: `Bearer ${token}`} : {})}
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return await res.json()
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}

/** The rules this probe considers: exactly those the drift probe probes. */
export function probedRules(rules) {
  return rules.filter(({rule}) => rule.spec?.verified_against_source === true)
}

/**
 * Fetch, per distinct pinned source, the bytes needed to judge currency.
 *
 * Deduplicated per verification_url -- today's 27 verified rules resolve to 4 sources.
 * BOTH blobs are required: comparing bytes is the verdict, so holding only one of them
 * is not a partial answer, it is no answer.
 *
 * @returns {Promise<Map<string, object>>} keyed by the rule's pinned verification_url
 */
export async function fetchCurrencySources(rules, {fetchText: fetchImpl = fetchText, fetchCommit = fetchCurrentCommit} = {}) {
  const sources = new Map()
  for (const url of new Set(probedRules(rules).map(({rule}) => rule.spec.verification_url))) {
    const source = classifySource(url)
    if (source.kind !== 'github-raw') {
      sources.set(url, {...source, held: false})
      continue
    }
    try {
      const [pinnedText, currentText] = [await fetchImpl(url), await fetchImpl(source.currentUrl)]
      sources.set(url, {...source, held: true, pinnedText, currentText, currentCommit: await fetchCommit(source)})
    } catch (err) {
      sources.set(url, {...source, held: false, error: err instanceof Error ? err.message : String(err)})
    }
  }
  return sources
}

/**
 * The judging half: pure, over already-fetched bodies. No network.
 *
 * Reports per SOURCE, not per rule. A source is one document and its currency is one
 * fact; emitting it once per dependent rule would inflate a single upstream revision
 * into five findings and bury the count of documents actually examined. The rules that
 * depend on it are named in the message, because they are what a reader has to re-read.
 */
export function judgeCurrency(rules, sources) {
  const findings = []
  const probed = probedRules(rules)

  for (const [url, source] of sources) {
    const dependents = probed.filter(({rule}) => rule.spec.verification_url === url)
    const dependentList = dependents.map(({rel}) => rel).sort().join(', ')

    if (source.kind !== 'github-raw') {
      findings.push({
        severity: source.kind === 'unclassified' ? 'fail' : 'info',
        id: source.kind === 'unclassified' ? 'spec-currency-unclassified-source' : 'spec-currency-not-applicable',
        message: `${url} -- ${source.reason}. ${dependents.length} rule(s) out of scope for currency: ${dependentList}`
      })
      continue
    }

    if (!source.held) {
      findings.push({
        severity: 'fail',
        id: 'spec-currency-indeterminate',
        message:
          `INDETERMINATE -- could not hold both blobs for ${url} (${source.error}). Currency is judged by comparing the pinned bytes against ${source.currentUrl}; with either side missing the probe could not look, so it reports rather than assumes. ${dependents.length} rule(s) unjudged: ${dependentList}`
      })
      continue
    }

    const pinnedDigest = sha256(source.pinnedText)
    const currentDigest = sha256(source.currentText)
    if (pinnedDigest === currentDigest) {
      // EMITTED, NOT SKIPPED. A source that is still current is the answer to the
      // question this probe asks, and a silent pass makes it indistinguishable from a
      // source that was never reached -- the same conflation the measurement channel
      // exists to end, one level down. Every source the run considered appears once.
      findings.push({
        severity: 'info',
        id: 'spec-currency-current',
        message:
          `${url} is byte-identical to ${source.currentUrl} (sha256 ${currentDigest}) -- pinned commit ${source.pinnedCommit} still carries what the specification says today. ${dependents.length} rule(s): ${dependentList}`
      })
      continue
    }

    // WHAT A READER ACTUALLY WANTS TO KNOW. "The source moved" alone cannot be acted
    // on: it does not say whether the clause this repo enforces is among what moved.
    // Re-running the drift comparison against the CURRENT blob answers exactly that,
    // and it is what separates "re-read the surrounding prose" from "the cited clause
    // is gone".
    const stale = dependents.filter(({rule}) => !quoteOccursIn(rule.spec.normative_quote, source.currentText))
    const currentCommit = source.currentCommit ?? 'unresolved (commit lookup degraded; the byte comparison above stands on its own)'
    const provenance =
      `pinned commit ${source.pinnedCommit} (sha256 ${pinnedDigest}) vs current ${currentCommit} (sha256 ${currentDigest}) at ${source.currentUrl}`

    if (stale.length === 0) {
      findings.push({
        severity: 'warn',
        id: 'spec-source-moved',
        message:
          `${url} has been revised upstream -- ${provenance}. Every dependent normative_quote STILL OCCURS in the current blob, so no rule is falsified and no rule change is due; the surrounding prose is what changed. Re-read it and, if nothing normative moved, re-pin spec.verification_url and spec.retrieved to record that the check was made. ${dependents.length} rule(s): ${dependentList}`
      })
      continue
    }

    findings.push({
      severity: 'fail',
      id: 'spec-source-moved-quote-absent',
      message:
        `${url} has been revised upstream AND the cited clause no longer occurs in the current document -- ${provenance}. This is not an editorial revision: the passage these rules enforce is gone from what the specification says today, so the rule may now enforce a superseded reading. ${stale.length} of ${dependents.length} rule(s) affected: ${
          stale.map(({rel}) => rel).sort().join(', ')
        }`
    })
  }

  return findings
}

/** Ordered segment containment, identical to the drift probe's comparison. */
function quoteOccursIn(quote, text) {
  const haystack = comparable(text)
  let cursor = 0
  for (const seg of quoteSegments(quote)) {
    const needle = comparable(seg)
    const at = haystack.indexOf(needle, cursor)
    if (at === -1) {
      return false
    }
    cursor = at + needle.length
  }
  return true
}

/**
 * Both halves.
 *
 * `measured` COUNTS ONLY APPLICABLE SOURCES WHOSE BOTH BLOBS ARRIVED, and the exclusion
 * of not-applicable sources is the load-bearing part. Today 2 of 4 sources are immutable
 * publications; counting them would let a total raw.githubusercontent outage publish
 * measured=2 and ping a green tile while the probe saw nothing it exists to see -- the
 * transport-dark shape the channel exists to end (atlas decisions 0122, 0125). The cost
 * of that choice is stated rather than hidden: if the catalog ever pinned no GitHub blob
 * at all, this check would measure 0 honestly, and the `spec-currency-no-applicable-source`
 * finding below explains why rather than leaving the tier to wedge unexplained.
 */
export async function checkSpecCurrency(opts = {}) {
  const findings = []
  const parseErrors = []
  const rules = readRawRules(parseErrors)
  for (const message of parseErrors) {
    findings.push({severity: 'fail', id: 'spec-currency-unreadable-rule', message})
  }

  const sources = await fetchCurrencySources(rules, opts)
  findings.push(...judgeCurrency(rules, sources))

  const applicable = [...sources.values()].filter((s) => s.kind === 'github-raw')
  if (applicable.length === 0) {
    findings.push({
      severity: 'fail',
      id: 'spec-currency-no-applicable-source',
      message:
        `no rule pins a commit-pinned raw.githubusercontent.com source, so this probe has nothing to compare and measures 0. That is an honest zero, not transport darkness -- but it wedges the tier either way, because a currency probe with no subject is a question worth asking out loud rather than a silent no-op`
    })
  }

  return {
    findings,
    measured: applicable.filter((s) => s.held).length,
    ruleCount: rules.length,
    probedCount: probedRules(rules).length,
    applicableCount: applicable.length,
    notApplicableCount: [...sources.values()].filter((s) => s.kind === 'immutable-publication').length
  }
}

async function main() {
  const {findings, measured, ruleCount, probedCount, applicableCount, notApplicableCount} = await checkSpecCurrency()
  console.log(
    `  ${ruleCount} rule(s) in catalog, ${probedCount} pinned to a source: ${applicableCount} commit-pinned GitHub source(s) carry a currency question, ${notApplicableCount} immutable publication(s) do not`
  )
  process.exit(report(CHECK_ID, findings, measured))
}

if (isMain(import.meta.url)) {
  await main()
}
