#!/usr/bin/env node
// External-spec CURRENCY probe (atlas decision 0129 C6).
//
// THE NAMED DOUBT: "the pinned clause is still what the specification says today."
//
// WHY THIS IS NOT b2-check-spec-drift.mjs. That check re-fetches each rule's
// pinned source and asserts the citation quote still occurs in it. But
// rule.schema.json constrains that field to three IMMUTABLE forms -- an RFC's
// canonical plaintext, a 40-hex commit-pinned raw.githubusercontent blob, or a
// numbered RSS Advisory Board archive -- and immutability is the property the drift
// probe DEPENDS on (a moving target cannot answer "was this transcribed faithfully").
// So drift verifies the integrity of a transcription and structurally cannot observe
// that the upstream document has been revised. Both probes are correct; they ask
// different questions of the same corpus, and nothing else in the estate asks this one.
//
// MEASURED RECEIPT. The llms.txt rules pin AnswerDotAI/llms-txt at c7178b9d with
// retrieved 2026-07-30. Upstream main now serves a v2 of that document dated
// 2026-08-10: path-scope semantics, the "Optional" section rewritten, a new
// rel="alternate"/rel="describedby" recommendation, an RFC 8615 rationale. The five
// normative Format bullets are byte-identical, so no rule is wrong and no rule change
// is due. The point is that a month passed and the estate had no way to know.
//
// SEVERITY, DELIBERATELY SPLIT THREE WAYS. An upstream editorial revision is a prompt to
// re-read, not a defect, so a moved source whose quote SURVIVES is `warn` and exits 0. A
// moved source whose quote is GONE is `fail`: the cited clause itself has changed, and the
// rule may now enforce a superseded reading. That split is the whole point of reporting
// what was compared rather than a bare verdict -- and `fail` is the only severity the
// managed-issue reconciler can see, so it is what makes a human look. This check runs
// weekly and report-only; it is wired into no PR gate, so no severity can red a merge.
//
// THE THIRD ARM IS PATIENCE (atlas decision 0142 step 5.3). A `warn` that never escalates
// is decoration: it exits 0, the reconciler reads only the step outcome, and the prompt to
// re-pin ends in a log line. The receipt above IS that dead end -- a v2 upstream since
// 2026-08-10 against a pin retrieved 2026-07-30, warned weekly and never acted on. So a
// surviving-quote revision that stays un-re-pinned past REPIN_GRACE_RUNS becomes
// `spec-source-moved-unrepinned` at `fail`. The FACT is unchanged; only the patience for it
// has run out.
//
// A FETCH FAILURE IS INDETERMINATE, NEVER CLEAN -- the convention b2-check-spec-drift.mjs
// establishes in its own header. Judging currency needs BOTH blobs; if either is
// unreachable the probe could not look, so it reports rather than assumes.
//
// SCOPE IS "HAS A PINNED SOURCE", NOT "CLAIMS CONFORMANCE" (atlas decision 0129 consumer
// round). This probe reads `cites` and `derivedFrom` alike -- see `citation` in
// b2-check-spec-drift.mjs -- so the citation split left its denominator at 27 rules over 4
// sources, of which 2 are commit-pinned GitHub blobs and therefore measurable here.
//
// THAT IS LOAD-BEARING, AND IT WAS NEARLY LOST. The first cut of the split keyed the probed
// set on rule_class, which would have dropped it to 14 rules over 3 sources with just 1
// measurable -- because all five llms-txt rules are `rule_class: convention`, so the
// AnswerDotAI/llms-txt blob in the receipt above would have left this check's reach
// entirely, one day after the check was built to watch it. The lesson is recorded in
// rule.schema.json: a quote's currency is at stake whenever a rule quotes a source, and
// `conformance_testable: false` says the upstream has no pass/fail concept, not that the
// citation cannot rot.

import {createHash} from 'node:crypto'
import {durationToMilliseconds, LLM_FRESHNESS_CONFIG} from '@j0nathan-ll0yd/estate-contracts/llms-assurance'
import {DEFAULT_BUDGET_MS, isMain, report} from '../lib/http.mjs'
import {citation, comparable, quoteSegments, readRawRules} from './b2-check-spec-drift.mjs'

export const CHECK_ID = 'check-spec-currency'

// A18 coverage declaration (atlas decision 0145). Empty is a claim, not a gap: what
// this runner holds is a pair of upstream specification blobs per pinned source --
// the pinned commit and the same path at HEAD. It fetches no estate artifact and
// judges no served byte; `measured` here counts commit-pinned GitHub SOURCES held,
// never artifacts. Metadata only -- the hub reads it statically.
export const ARTIFACTS = []

/**
 * How many consecutive weekly runs a revised source may stay un-re-pinned before the advisory
 * `warn` becomes a `fail` (atlas decision 0142 step 5.3).
 *
 * A WARNING THAT NEVER ESCALATES IS DECORATION. `spec-source-moved` exits 0, and the weekly
 * reconciler reads the STEP OUTCOME, so the prompt to "re-read and re-pin" terminated in a log
 * line. This check's own header carries the receipt of that dead end: llms.txt shipped a v2 on
 * 2026-08-10 against a pin retrieved 2026-07-30, and the re-pin had still not happened when the
 * decision 0142 review measured it weeks later -- every intervening weekly run having warned into
 * a log nobody reads. `fail` is the only severity the managed-issue reconciler can see, so it is
 * the only thing that makes a human look.
 *
 * THE WINDOW IS COUNTED IN RUNS, AND THE RUN LENGTH COMES FROM THE CONTRACT.
 * `portfolioServing.auditCadence` is the cadence of the weekly `audit-web.yml` lane this step runs
 * in, so the window moves with the lane rather than restating a day count that a cadence change
 * would falsify. The MULTIPLIER is local policy and deliberately generous: eight warned runs is
 * long enough that a re-pin was never going to happen on its own, and short enough that the pin
 * cannot be a season out of date.
 *
 * IT ESCALATES PATIENCE, NOT SEVERITY OF FACT. The escalated finding says exactly what
 * `spec-source-moved` said -- the quotes still occur, no rule is falsified, no rule change is due.
 * What changed is that the prompt has been ignored for long enough to need an owner.
 */
export const REPIN_GRACE_RUNS = 8
export const REPIN_GRACE_MS = durationToMilliseconds(LLM_FRESHNESS_CONFIG.layers.portfolioServing.auditCadence) * REPIN_GRACE_RUNS

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
  // rule.schema.json's immutableUrl anyOf admits exactly the three shapes above,
  // so reaching here means the schema widened without this classifier following. That
  // is an unexamined source, not an out-of-scope one, and it must not read as clean.
  return {
    kind: 'unclassified',
    reason: `no currency rule is defined for this URL shape -- rule.schema.json's immutableUrl patterns and ${CHECK_ID}'s classifier have diverged`
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

/**
 * The rules this probe considers: exactly those the drift probe probes -- every rule
 * whose citation block records a `pinnedAt`, on EITHER arm. `citation()` is the one
 * accessor and it reads `cites ?? derivedFrom`, so the `convention` rules that quote
 * llmstxt.org are in scope alongside the `conformance` rules that cite RFC 9116.
 *
 * THIS DOCBLOCK SAID THE OPPOSITE (corrected by atlas decision 0142 phase 7). It read
 * "the rules carrying a `cites` Citation, which the discriminated union in
 * rule.schema.json admits only on `rule_class: conformance`" and "the set went from 27
 * to 14 ... the 13 that left ... no longer record a pinned source". That describes the
 * arm-keyed cut the 0129 consumer round CONSIDERED AND REJECTED, and it contradicted the
 * filter directly beneath it, this file's own header, and the two tests that pin the
 * behaviour. All five llms-txt rules are `convention`, so an editor aligning code to
 * comment would have dropped the AnswerDotAI/llms-txt blob -- this check's own motivating
 * receipt -- out of scope one day after the check was built to watch it. The denominator
 * did not shrink; only the sentence describing it was wrong, which is the more dangerous
 * of the two because it reads as an instruction.
 *
 * No count is restated here. `main()` prints the live figures and the tests assert the
 * membership rule, so both are read off the corpus rather than recalled.
 */
export function probedRules(rules) {
  return rules.filter(({rule}) => typeof citation(rule)?.pinnedAt === 'string')
}

/**
 * Fetch, per distinct pinned source, the bytes needed to judge currency.
 *
 * Deduplicated per pinned source -- today's 27 pinned rules resolve to 4 sources.
 * BOTH blobs are required: comparing bytes is the verdict, so holding only one of them
 * is not a partial answer, it is no answer.
 *
 * @returns {Promise<Map<string, object>>} keyed by the rule's pinnedAt
 */
export async function fetchCurrencySources(rules, {fetchText: fetchImpl = fetchText, fetchCommit = fetchCurrentCommit} = {}) {
  const sources = new Map()
  for (const url of new Set(probedRules(rules).map(({rule}) => citation(rule).pinnedAt))) {
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
export function judgeCurrency(rules, sources, {nowMs = Date.now()} = {}) {
  const findings = []
  const probed = probedRules(rules)

  for (const [url, source] of sources) {
    const dependents = probed.filter(({rule}) => citation(rule).pinnedAt === url)
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
    const stale = dependents.filter(({rule}) => {
      const {quote} = citation(rule)
      // A pinned derivation that transcribes no sentence cannot have a stale quote. Without this
      // guard the segment walk searches the current blob for the literal text "undefined" and
      // reports the rule as falsified.
      return typeof quote === 'string' && quote.length > 0 && !quoteOccursIn(quote, source.currentText)
    })
    const currentCommit = source.currentCommit ?? 'unresolved (commit lookup degraded; the byte comparison above stands on its own)'
    const provenance =
      `pinned commit ${source.pinnedCommit} (sha256 ${pinnedDigest}) vs current ${currentCommit} (sha256 ${currentDigest}) at ${source.currentUrl}`

    if (stale.length === 0) {
      // HOW LONG HAS THE PROMPT BEEN IGNORED? The dependents' own `retrieved` dates are the only
      // durable record of when a human last re-read this source, and they need no state carried
      // between runs. The FRESHEST one is what counts: if any dependent has been re-pinned
      // recently, the source has been looked at recently, whatever the others say.
      const retrievedAt = dependents.map(({rule}) => Date.parse(citation(rule).retrieved ?? '')).filter((value) => Number.isFinite(value))
      const freshestMs = retrievedAt.length > 0 ? Math.max(...retrievedAt) : null
      const unrepinnedMs = freshestMs === null ? null : nowMs - freshestMs
      const runs = unrepinnedMs === null ? null : Math.floor(unrepinnedMs / (REPIN_GRACE_MS / REPIN_GRACE_RUNS))

      if (unrepinnedMs !== null && unrepinnedMs > REPIN_GRACE_MS) {
        findings.push({
          severity: 'fail',
          id: 'spec-source-moved-unrepinned',
          message: `${url} has been revised upstream AND the pin has not been refreshed for ${runs} weekly run(s) -- ${provenance}. ` +
            `Every dependent quote still occurs in the current blob, so no rule is falsified and no rule change is due; this is the SAME fact ` +
            `spec-source-moved reports, escalated because the prompt to re-read it has now gone unanswered past the ${REPIN_GRACE_RUNS}-run grace ` +
            `window. A warning that never escalates is decoration: fail is the only severity the managed-issue reconciler sees. Re-read the ` +
            `surrounding prose and re-pin pinnedAt and retrieved to record that the check was made. ${dependents.length} rule(s): ${dependentList}`
        })
        continue
      }

      findings.push({
        severity: 'warn',
        id: 'spec-source-moved',
        message:
          `${url} has been revised upstream -- ${provenance}. Every dependent quote STILL OCCURS in the current blob, so no rule is falsified and no rule change is due; the surrounding prose is what changed. Re-read it and, if nothing normative moved, re-pin the citation's pinnedAt and retrieved to record that the check was made. ${dependents.length} rule(s): ${dependentList}` +
          (runs === null ? '' : ` Un-re-pinned for ${runs} of the ${REPIN_GRACE_RUNS} weekly run(s) this stays advisory for.`)
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
  findings.push(...judgeCurrency(rules, sources, opts))

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
