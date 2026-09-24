#!/usr/bin/env node
// External-spec integrity and drift probe (ADR 0011).
// Offline mode verifies each normative quote against its committed self-hash. Network mode
// verifies ordered quote containment in the immutable primary source; a whole-page hash would
// compare unlike artifacts. Offline integrity blocks PRs, while external drift runs weekly so
// third-party uptime cannot gate merges. Fetch failure is indeterminate, never clean.

import {createHash} from 'node:crypto'
import {readdirSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as cheerio from 'cheerio'
import {DEFAULT_BUDGET_MS} from '../lib/http.mjs'
import {publishMeasured} from '../lib/measurement.mjs'
import {artifacts} from '../specs/load.mjs'

const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs')

// A quote may splice separate passages of one source. The convention (stated
// in rule.schema.json's quote descriptions, on both arms) is that they are
// joined by an ellipsis rather than run together, so a spliced quote is
// checked segment-by-segment, IN ORDER -- reordering passages must not pass.
//
// The dot form matches a run of THREE OR MORE, not exactly three: splicing
// after a sentence produces four ('...file."... The next passage'), and
// consuming only three would leave a stray leading '.' on the next segment
// that occurs nowhere in the source -- turning an ordering violation into a
// spurious "missing segment" report. Absorbing the run drops the sentence's
// own full stop from the comparison, which is harmless: matching is by
// containment, not by byte equality.
const SPLICE = /\s*(?:\.{3,}|…)\s*/

// A segment shorter than this is too weak to constitute a citation, and is
// rejected even if it is present in the source. Without this floor the cheap
// way to "fix" a drift failure is to truncate the quote down to a few common
// words, which would keep the gate green while destroying the thing it
// guards.
//
// THE HEADROOM IS ZERO, AND IT IS PINNED (atlas decision 0142 step 5.3). This
// comment used to claim "the shortest segment in the live catalog is 35
// characters". It is 24 -- exactly the floor -- and has been since a splice
// whose trailing period the SPLICE run absorbs left `link The URL of the item`
// in feed-xml-item-field.rule.json at the boundary. The margin eroded 35 -> 24
// unnoticed precisely because the claim was prose that nothing measured, which
// is the failure mode this whole corpus exists to refuse. So the number is now
// asserted by audits/__tests__/spec-drift.test.ts against the live catalog: any
// further erosion, any floor bump, and any change to `comparable()`'s
// normalisation reds there with the offending segment named, instead of
// reddening the entire catalog at some later merge.
export const MIN_SEGMENT_CHARS = 24

/**
 * Normalize text for comparison. Deliberately conservative: it collapses
 * whitespace (RFC plaintext hard-wraps at ~72 columns, so a quote spanning a
 * line break cannot match byte-for-byte) and folds typographic variants of
 * quotes and dashes that differ between a source and its transcription. It
 * alters no word, no clause, and no sentence boundary -- matching exactly the
 * latitude rule.schema.json's quote descriptions allow.
 */
export function normalizeText(s) {
  return String(s).replace(/\r\n?/g, '\n').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-') // \s already covers NBSP, thin/en/em spaces and U+FEFF in JS, so the
    // collapse below folds every exotic space an HTML-rendered source may
    // carry into the plain U+0020 a transcription uses.
    .replace(/\s+/g, ' ').trim()
}

/**
 * Reduce markdown to the text it renders. Half the pinned sources are
 * markdown/quarto files, so a quote transcribed from the RENDERED page carries
 * no backticks or link syntax while the raw blob does. De-marking both sides
 * makes them comparable without weakening the match: only formatting markers
 * are removed, never words.
 */
export function demarkMarkdown(s) {
  return String(s).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '')
}

/**
 * Reduce an HTML specification to rendered text. RSS Advisory Board archives
 * are immutable, versioned HTML pages. Separating block and table elements
 * keeps adjacent cells from being concatenated before whitespace collapses.
 */
export function dehtml(s) {
  const source = String(s)
  if (!/(?:<!doctype\s+html|<html\b)/i.test(source)) {
    return source
  }
  const $ = cheerio.load(source)
  $('script, style, noscript').remove()
  $('br, p, div, li, tr, td, th, h1, h2, h3, h4, h5, h6').each((_index, element) => {
    $(element).before(' ')
    $(element).after(' ')
  })
  return $.root().text()
}

/** Canonical comparison form: normalized, then de-marked. */
export function comparable(s) {
  return demarkMarkdown(normalizeText(dehtml(s)))
}

/** Split a citation quote into its spliced passages, in order. */
export function quoteSegments(quote) {
  return String(quote).split(SPLICE).map((s) => s.trim()).filter(Boolean)
}

/**
 * Read every *.rule.json under specs/ raw, like check-spec-verification.mjs.
 * Returns [{rel, rule}]; a file that will not parse becomes a violation there
 * rather than throwing here.
 */
export function readRawRules(violations = []) {
  const out = []
  for (const artifact of artifacts()) {
    const dir = join(SPECS_DIR, artifact)
    for (const fileName of readdirSync(dir).filter((n) => n.endsWith('.rule.json'))) {
      const rel = `${artifact}/${fileName}`
      try {
        out.push({rel, rule: JSON.parse(readFileSync(join(dir, fileName), 'utf-8'))})
      } catch (err) {
        violations.push(`${rel}: not valid JSON (${err.message})`)
      }
    }
  }
  return out
}

/**
 * A rule's citation block, whichever arm declares it, or null for a rule that
 * records no external source at all.
 *
 * THE PROBE READS A PINNED SOURCE WHEREVER IT APPEARS, NOT BY RULE CLASS, and that
 * is the correct shape rather than a convenience: whether a quote has gone stale was
 * never a fact about conformance. A `convention` rule quoting llmstxt.org has exactly
 * as much at stake in that sentence as a `conformance` rule quoting RFC 9116 -- if
 * the source is rewritten, the rule's stated rationale is stale either way.
 * `conformance_testable: false` says the upstream has no pass/fail concept; it does
 * NOT say the citation cannot rot.
 *
 * So `cites` and `derivedFrom` differ in the CLAIM they make -- verified conformance
 * evidence versus an informative derivation -- and not in whether they can be located
 * and re-read. Both carry `pinnedAt`, `retrieved` and `content_sha256`; only `cites`
 * carries `conformance_testable`, `verified_against_source` and `verified_at`.
 */
export function citation(rule) {
  return rule.cites ?? rule.derivedFrom ?? null
}

/**
 * THE PINNED SET -- the rules this probe can hold to a source, and the ONLY
 * definition of it in this file. A rule is in it when its citation block records a
 * `pinnedAt`, on EITHER arm: the `conformance` rules that carry `cites`, plus the local
 * rules whose `derivedFrom` names an external clause. The rest record no external
 * source (the old `clause: 'n/a'`), so there is nothing to fetch.
 *
 * NO COUNTS ARE STATED HERE, DELIBERATELY (atlas decision 0142 phase 7). They were, and
 * they rotted: this docblock read "27 of the 34 rules ... The 7 left out" while the
 * catalog held 35 rules with 8 unsourced, and the fetch docblock below read "15 rules
 * resolve to 3 sources" against an actual 27 over 4. A file whose whole doctrine is that
 * a denominator must not shrink in silence cannot carry hand-maintained denominators. The
 * run PRINTS the live figures (see `main()`), and `audits/__tests__/spec-drift.test.ts`
 * asserts the set's membership rule, so both are read off the corpus rather than recalled.
 *
 * THE SET IS KEYED ON `pinnedAt`, NEVER ON `rule_class`, AND THAT IS LOAD-BEARING. An
 * earlier cut of the citation split keyed it on the class and would have dropped every
 * local rule, taking with it the AnswerDotAI/llms-txt blob that is decision 0129 C6's own
 * motivating receipt -- all five llms-txt rules are `convention`. `citation()` above is the
 * one accessor for that reason.
 */
export const pinned = (rules) => rules.filter(({rule}) => typeof citation(rule)?.pinnedAt === 'string')

/**
 * Half 1 -- INTEGRITY, offline. content_sha256 must still equal sha256(quote),
 * and every spliced segment must clear the anti-truncation floor. Pure: takes
 * [{rel, rule}], returns violation strings.
 *
 * Runs over every rule carrying a QUOTE, on BOTH arms. A local rule's transcription
 * is as worth protecting from an unreviewed edit as a conformance rule's.
 *
 * A QUOTELESS `derivedFrom` IS LEGAL; A QUOTELESS `cites` IS NOT (atlas decision 0142
 * step 5.3, reconciling a contradiction this gate carried against the schema).
 *
 * The two arms make different claims, so they owe different things. `cites` REQUIRES
 * `quote` in rule.schema.json's own `required` list, and the demand is re-stated here
 * as defense in depth because this probe reads rule files RAW, with no ajv, so a
 * schema-bypassing edit still meets a named violation. `derivedFrom` requires only
 * `source`, `clause` and `url`: it is "where this rule got its idea", and a pointer at
 * a document without a sentence lifted out of it is a complete derivation note. The
 * schema says so structurally -- its `allOf` reads "IF quote THEN require pinnedAt,
 * retrieved and content_sha256", a conditional that would be dead if `quote` were
 * mandatory.
 *
 * WHY THE SCHEMA WON. Until this change the blocking PR gate (`audit:spec-integrity`)
 * rejected any citation block with no quote, on either arm, with a message asserting a
 * requirement the schema explicitly waives -- so the first author of a quoteless
 * derivation note would have met a red gate and a false explanation. Three things
 * decided it. (1) This function's own purpose is protecting a TRANSCRIPTION from an
 * unreviewed edit; where nothing was transcribed there is nothing to protect, and
 * `content_sha256` has no subject. (2) The sibling blocking gate,
 * b2-check-spec-verification.mjs, ALREADY implements the schema's reading -- its
 * locatability arm runs only `if (typeof spec.quote === 'string' && spec.quote.length
 * > 0)` -- so the two gates contradicted EACH OTHER, and the schema was the tie-break.
 * (3) Making the schema follow the gate instead would have deleted a documented shape
 * to keep a rule nothing needed. Coverage on the `cites` arm is unchanged.
 */
export function checkQuoteIntegrity(rules) {
  const violations = []

  for (const {rel, rule} of rules) {
    const spec = citation(rule)
    if (spec === null) {
      continue // no external source: the rationale is self-authored, so there is no transcription to protect
    }
    const quote = spec.quote
    if (typeof quote !== 'string' || quote.length === 0) {
      if (rule.cites === undefined) {
        continue // a derivedFrom pointer with no transcribed sentence: legal, and nothing to hash
      }
      violations.push(`${rel}: a cites quote is required and must be a non-empty string`)
      continue
    }

    const expected = createHash('sha256').update(quote, 'utf-8').digest('hex')
    if (spec.content_sha256 !== expected) {
      violations.push(
        `${rel}: content_sha256 ${JSON.stringify(spec.content_sha256)} does not match sha256(quote) ${expected} -- ` +
          'the quote was edited after authoring without re-running audits/specs/hash-normative-quotes.mjs. ' +
          'Re-run it ONLY if the edit was a faithful correction re-checked against the primary source; the hash is not the authority, the source is'
      )
    }

    for (const seg of quoteSegments(quote)) {
      if (comparable(seg).length < MIN_SEGMENT_CHARS) {
        violations.push(
          `${rel}: spliced quote segment ${JSON.stringify(seg)} is shorter than the ${MIN_SEGMENT_CHARS}-character floor -- ` +
            'a citation cannot be truncated to a fragment that would match almost any text (that is how a drift failure gets "fixed" into a no-op)'
        )
      }
    }
  }

  return violations
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
 * Half 2 -- DRIFT, network. For every rule carrying a pinned citation, re-fetch
 * that source and assert the quote's segments still occur in it, in order.
 *
 * BOTH ARMS ARE PROBED -- see `pinned` above. This docblock used to say "Only rules
 * carrying `cites` are probed ... A LOCAL rule records no pinned source to drift
 * against", which was false in both directions and contradicted the filter it described,
 * the file's own header, and the test that pins the behaviour ("probes a derivedFrom
 * rule, so the pinned set is not keyed on rule class"). An editor aligning the code to
 * that comment would have re-introduced the exact near-miss decision 0129 recorded.
 *
 * Fetches are deduplicated per URL, and a fetch failure is reported as a violation for
 * every rule that depended on it, never skipped.
 */
export async function checkSourceDrift(rules, opts = {}) {
  return compareQuotesAgainstSources(rules, await fetchPinnedSources(rules, opts))
}

/**
 * Fetch each probed rule's pinned source ONCE, deduplicated per URL.
 *
 * Split out of `checkSourceDrift` so the measurement channel can count what this run
 * actually HELD (atlas decision 0122): the returned map distinguishes a source whose
 * bytes arrived from one that could not be reached, which the violation list alone
 * cannot -- an unreachable source produces one violation per dependent rule, so
 * counting violations would answer a different question.
 *
 * @returns {Promise<Map<string, {ok: boolean, text?: string, error?: string}>>}
 */
export async function fetchPinnedSources(rules, {fetchText: fetchImpl = fetchText} = {}) {
  const probed = pinned(rules)
  const bodies = new Map()
  for (const url of new Set(probed.map(({rule}) => citation(rule).pinnedAt))) {
    try {
      bodies.set(url, {ok: true, text: await fetchImpl(url)})
    } catch (err) {
      bodies.set(url, {ok: false, error: err instanceof Error ? err.message : String(err)})
    }
  }
  return bodies
}

/** The comparison half: pure, over already-fetched bodies. No network. */
export function compareQuotesAgainstSources(rules, bodies) {
  const violations = []
  const probed = pinned(rules)

  for (const {rel, rule} of probed) {
    const spec = citation(rule)
    const body = bodies.get(spec.pinnedAt)

    // A pinned derivation with no transcribed sentence has nothing to compare. Guarded rather
    // than assumed: the schema admits a `derivedFrom` that pins a source and quotes none of it,
    // and without this the segment walk would search the source for the literal text "undefined"
    // and report a drift that never happened.
    if (typeof spec.quote !== 'string' || spec.quote.length === 0) {
      continue
    }

    if (!body.ok) {
      violations.push(
        `${rel}: INDETERMINATE -- could not re-fetch spec.pinnedAt ${spec.pinnedAt} (${body.error}). ` +
          'An unreachable source is not a pass: the probe could not look, so it reports rather than assumes'
      )
      continue
    }

    const haystack = comparable(body.text)
    let cursor = 0
    for (const seg of quoteSegments(spec.quote)) {
      const needle = comparable(seg)
      const at = haystack.indexOf(needle, cursor)
      if (at === -1) {
        const reordered = haystack.includes(needle)
        violations.push(`${rel}: spec.quote no longer occurs in its pinned source ${spec.pinnedAt} -- ` + (reordered
          ? 'the passage is present but OUT OF ORDER relative to the rest of the quote (spliced passages must appear in the order the quote joins them). '
          : '') + `Missing segment: ${JSON.stringify(seg.slice(0, 120))}${seg.length > 120 ? '…' : ''}`)
        break
      }
      cursor = at + needle.length
    }
  }

  return violations
}

/** Offline half only -- the blocking, PR-lane gate. */
export function checkIntegrityOnly() {
  const violations = []
  const rules = readRawRules(violations)
  return violations.concat(checkQuoteIntegrity(rules))
}

/**
 * Both halves -- the weekly, report-only audit.
 *
 * Returns `{violations, measured}` rather than a bare list because the two answer
 * different questions (atlas decision 0122). `violations` is the finding channel;
 * `measured` is the number of PINNED SOURCES whose bytes this run held, and it is the
 * only one the dead-man reads. Counting violations cannot substitute: one unreachable
 * source raises one violation per dependent rule, so a total outage and a single
 * drifted quote can produce the same number.
 */
export async function checkSpecDrift(opts = {}) {
  const violations = []
  const rules = readRawRules(violations)
  violations.push(...checkQuoteIntegrity(rules))
  const bodies = await fetchPinnedSources(rules, opts)
  violations.push(...compareQuotesAgainstSources(rules, bodies))
  return {violations, measured: [...bodies.values()].filter((b) => b.ok).length, ruleCount: rules.length}
}

async function main() {
  const integrityOnly = process.argv.includes('--integrity-only')
  const label = integrityOnly ? 'check-spec-drift --integrity-only' : 'check-spec-drift'

  // `measured` is the number of PINNED SOURCES whose bytes this run held (atlas
  // decision 0122). Reaching none of them is exactly the "an unreachable source
  // reports INDETERMINATE, which is a finding, never a pass" case this check's header
  // states -- and without the count, that state is byte-identical to a clean run once
  // `continue-on-error: true` swallows the exit.
  //
  // OFFLINE MODE HOLDS NO SOURCE, so it counts the committed rule files it did read.
  // It is the blocking PR gate (`audit:spec-integrity`), never a lane step, so nothing
  // consumes the count there; publishing it keeps one code path instead of two.
  const drift = integrityOnly ? null : await checkSpecDrift()
  const offline = integrityOnly ? checkIntegrityOnly() : null
  const violations = drift ? drift.violations : offline
  const allRules = readRawRules([])
  // The integrity half measures the rules it actually HELD AND JUDGED, which since the atlas
  // decision 0129 consumer round is the PINNED set and not every rule file. Publishing the
  // whole-catalog count here would be a falsified record in the exact shape AGENTS.md names: a
  // number that can never reach 0 and never reflects what the step read.
  const measured = publishMeasured(drift ? drift.measured : pinned(allRules).length)
  const measuredUnit = integrityOnly ? 'pinned rule file(s)' : 'pinned source(s)'

  console.log(`\n=== ${label} ===`)
  if (violations.length === 0) {
    const rules = readRawRules([])
    const probed = pinned(rules)
    const sources = new Set(probed.map(({rule}) => citation(rule).pinnedAt))
    console.log('  (no violations)')
    console.log(integrityOnly
      ? `  ${probed.length} quoting rule(s) of ${rules.length} checked: every content_sha256 matches its own quote, 0 violation(s)`
      : `  ${rules.length} rule(s) checked: ${probed.length} pinned rule(s) re-checked against ${sources.size} pinned source(s), 0 violation(s)`)
    console.log(`  measured=${measured} ${measuredUnit} held and judged`)
    process.exit(0)
  }
  for (const v of violations) {
    console.log(`  [fail] ${v}`)
  }
  console.log(`  ${violations.length} violation(s)`)
  console.log(`  measured=${measured} ${measuredUnit} held and judged`)
  process.exit(1)
}

function isMain(importMetaUrl) {
  return importMetaUrl === `file://${process.argv[1]}`
}

if (isMain(import.meta.url)) {
  await main()
}
