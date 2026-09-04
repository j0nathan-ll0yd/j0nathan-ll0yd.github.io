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
import {artifacts} from '../specs/load.mjs'

const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs')

// A quote may splice separate passages of one source. The convention (stated
// in rule.schema.json's verified_against_source description) is that they are
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
// guards. The shortest segment in the live catalog is 35 characters.
export const MIN_SEGMENT_CHARS = 24

/**
 * Normalize text for comparison. Deliberately conservative: it collapses
 * whitespace (RFC plaintext hard-wraps at ~72 columns, so a quote spanning a
 * line break cannot match byte-for-byte) and folds typographic variants of
 * quotes and dashes that differ between a source and its transcription. It
 * alters no word, no clause, and no sentence boundary -- matching exactly the
 * latitude rule.schema.json's verified_against_source description allows.
 */
export function normalizeText(s) {
  return String(s).replace(/\r\n?/g, '\n').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-') // \s already covers NBSP, thin/en/em spaces and U+FEFF in JS, so the
    // collapse below folds every exotic space an HTML-rendered source may
    // carry into the plain U+0020 a transcription uses.
    .replace(/\s+/g, ' ').trim()
}

/**
 * Reduce markdown to the text it renders. Two of the three pinned sources are
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

/** Split a normative_quote into its spliced passages, in order. */
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
 * Half 1 -- INTEGRITY, offline. content_sha256 must still equal
 * sha256(normative_quote), and every spliced segment must clear the
 * anti-truncation floor. Pure: takes [{rel, rule}], returns violation strings.
 */
export function checkQuoteIntegrity(rules) {
  const violations = []

  for (const {rel, rule} of rules) {
    const spec = rule.spec ?? {}
    const quote = spec.normative_quote
    if (typeof quote !== 'string' || quote.length === 0) {
      violations.push(`${rel}: spec.normative_quote is required and must be a non-empty string`)
      continue
    }

    const expected = createHash('sha256').update(quote, 'utf-8').digest('hex')
    if (spec.content_sha256 !== expected) {
      violations.push(
        `${rel}: spec.content_sha256 ${JSON.stringify(spec.content_sha256)} does not match sha256(spec.normative_quote) ${expected} -- ` +
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
 * Half 2 -- DRIFT, network. For every rule verified against a pinned source,
 * re-fetch that source and assert the quote's segments still occur in it, in
 * order. Only rules with verified_against_source: true are probed; a rule with
 * clause 'n/a' has no external source to drift against (check-spec-verification
 * already enforces that complement).
 *
 * Fetches are deduplicated per URL -- 15 rules resolve to 3 sources -- and a
 * fetch failure is reported as a violation for every rule that depended on it,
 * never skipped.
 */
export async function checkSourceDrift(rules, {fetchText: fetchImpl = fetchText} = {}) {
  const violations = []
  const probed = rules.filter(({rule}) => rule.spec?.verified_against_source === true)

  const bodies = new Map()
  for (const url of new Set(probed.map(({rule}) => rule.spec.verification_url))) {
    try {
      bodies.set(url, {ok: true, text: await fetchImpl(url)})
    } catch (err) {
      bodies.set(url, {ok: false, error: err instanceof Error ? err.message : String(err)})
    }
  }

  for (const {rel, rule} of probed) {
    const spec = rule.spec
    const body = bodies.get(spec.verification_url)

    if (!body.ok) {
      violations.push(
        `${rel}: INDETERMINATE -- could not re-fetch spec.verification_url ${spec.verification_url} (${body.error}). ` +
          'An unreachable source is not a pass: the probe could not look, so it reports rather than assumes'
      )
      continue
    }

    const haystack = comparable(body.text)
    let cursor = 0
    for (const seg of quoteSegments(spec.normative_quote)) {
      const needle = comparable(seg)
      const at = haystack.indexOf(needle, cursor)
      if (at === -1) {
        const reordered = haystack.includes(needle)
        violations.push(`${rel}: spec.normative_quote no longer occurs in its pinned source ${spec.verification_url} -- ` + (reordered
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

/** Both halves -- the weekly, report-only audit. */
export async function checkSpecDrift(opts = {}) {
  const violations = []
  const rules = readRawRules(violations)
  return violations.concat(checkQuoteIntegrity(rules), await checkSourceDrift(rules, opts))
}

async function main() {
  const integrityOnly = process.argv.includes('--integrity-only')
  const label = integrityOnly ? 'check-spec-drift --integrity-only' : 'check-spec-drift'
  const violations = integrityOnly ? checkIntegrityOnly() : await checkSpecDrift()

  console.log(`\n=== ${label} ===`)
  if (violations.length === 0) {
    const rules = readRawRules([])
    const probed = rules.filter(({rule}) => rule.spec?.verified_against_source === true)
    const sources = new Set(probed.map(({rule}) => rule.spec.verification_url))
    console.log('  (no violations)')
    console.log(integrityOnly
      ? `  ${rules.length} rule(s) checked: every content_sha256 matches its own normative_quote, 0 violation(s)`
      : `  ${rules.length} rule(s) checked: ${probed.length} verified rule(s) re-checked against ${sources.size} pinned source(s), 0 violation(s)`)
    process.exit(0)
  }
  for (const v of violations) {
    console.log(`  [fail] ${v}`)
  }
  console.log(`  ${violations.length} violation(s)`)
  process.exit(1)
}

function isMain(importMetaUrl) {
  return importMetaUrl === `file://${process.argv[1]}`
}

if (isMain(import.meta.url)) {
  await main()
}
