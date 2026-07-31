#!/usr/bin/env node
// scripts/audit/check-spec-verification.mjs -- B2 spec/eval pilot, ADR 0011
// follow-up (a): the source-verification gate. It promotes the prose
// disclosure the citation sweep found in 13 of 24 rule files ("recalled from
// training-data familiarity" vs "verified against a live fetch") to a
// required, checkable schema field (spec.verified_against_source) and enforces
// the one rule that stops the 7-of-7 conformance defect from recurring:
//
//   a rule_class: conformance rule -- one asserting an external MUST -- may
//   not ship unless its normative_quote has been verified, character-for-
//   character, against the primary source (verified_against_source: true).
//
// The gate keys on spec.clause, NOT the author-chosen rule_class (review fix):
// a rule that cites ANY external clause (clause != 'n/a') must be verified, so
// a rule cannot dodge verification by downgrading rule_class from conformance
// to local-policy/convention; a clause 'n/a' rule (whose quote is a
// self-authored statement about the absence of external coverage) must be
// false and disclose why.
//
// This is deliberately a SECOND enforcement site. rule.schema.json binds ALL
// of this structurally at load time via ajv -- the clause branch of its
// top-level allOf forces verified_against_source true iff clause != 'n/a', and
// verification_url's anyOf forces the immutable/pinned shape -- so
// specs/load.mjs THROWS on any violation on every audit run (the highest tier,
// B10; the header's earlier claim that ajv "cannot express" the URL shape was
// wrong -- draft-07 expresses it exactly, and the schema now does). This
// script exists alongside the schema because it reads the rule files RAW
// rather than through ajv, so a violation is a clean, greppable message
// instead of an ajv stack trace -- the surface the known-answer probe
// demonstrates -- and it is defence-in-depth for the two facts ajv could in
// principle regress on: the immutable/pinned verification_url, and the honest
// complement (a false rule carries a verification_note).
//
// It walks the specs tree via load.mjs's artifacts() -- the same single walker
// check-spec-severity.mjs and the spec-cases harness use -- so the three
// gates cannot drift on what counts as a catalog directory.

import {readdirSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {artifacts} from './specs/load.mjs'

const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'specs')

// An immutable canonical RFC plaintext, or a GitHub raw blob pinned to a full
// 40-hex commit SHA. A living URL (llmstxt.org, jsonfeed.org, an RFC's HTML
// landing page) is REJECTED here even for a currently-correct quote: the point
// of verification_url is that a future re-fetch reads the same bytes.
const RFC_TXT = /^https:\/\/www\.rfc-editor\.org\/rfc\/rfc\d+\.txt$/
const PINNED_GITHUB = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\/.+/

function isImmutableSource(url) {
  return RFC_TXT.test(url) || PINNED_GITHUB.test(url)
}

/**
 * Read every *.rule.json under specs/ RAW (JSON.parse only, no ajv) so a
 * malformed or gate-violating rule yields a clean message rather than a throw
 * from load.mjs. Returns [{artifact, file, rule}] for every parseable rule and
 * pushes a violation for any file that will not even parse.
 */
function readRawRules(violations) {
  const out = []
  for (const artifact of artifacts()) {
    const dir = join(SPECS_DIR, artifact)
    for (const fileName of readdirSync(dir).filter((n) => n.endsWith('.rule.json'))) {
      const rel = `${artifact}/${fileName}`
      let rule
      try {
        rule = JSON.parse(readFileSync(join(dir, fileName), 'utf-8'))
      } catch (err) {
        violations.push(`${rel}: not valid JSON (${err.message})`)
        continue
      }
      out.push({rel, rule})
    }
  }
  return out
}

/**
 * The pure gate: given [{rel, rule}], return the list of violation strings.
 * Separated from disk I/O so the failure paths (a conformance rule flipped to
 * false, a living verification_url, a false rule with no note) are exercised
 * by tests/audit/spec-verification.test.ts without mutating on-disk fixtures --
 * the known-answer property (ADR 0011's acceptance criterion) encoded as a
 * standing regression, not only demonstrated once by hand.
 */
export function verifyRules(rules) {
  const violations = []

  for (const {rel, rule} of rules) {
    const spec = rule.spec ?? {}
    const v = spec.verified_against_source

    if (typeof v !== 'boolean') {
      violations.push(`${rel}: spec.verified_against_source is required and must be a boolean (found ${JSON.stringify(v)})`)
      continue
    }

    // The gate keys on spec.clause, not the author-chosen rule_class: a rule
    // citing ANY external clause must be verified, closing the rule_class
    // downgrade bypass (ADR 0011 follow-up (a) review fix). This is the
    // assertion the known-answer probe flips.
    const citesExternalClause = typeof spec.clause === 'string' && spec.clause !== 'n/a'
    if (citesExternalClause && v !== true) {
      violations.push(
        `${rel}: spec.clause "${spec.clause}" cites an external clause, so spec.verified_against_source must be true, but it is false -- ` +
          'a rule asserting an external standard may not ship unverified against its cited source, regardless of rule_class (ADR 0011 follow-up (a), the 7-of-7 defect class)'
      )
    }
    if (!citesExternalClause && v === true) {
      violations.push(
        `${rel}: spec.clause is "n/a" (no external clause), so spec.verified_against_source must be false, but it claims true -- ` +
          'a rule with no external clause has no source to verify against; its normative_quote is a self-authored statement about the absence of external coverage'
      )
    }

    if (v === true) {
      if (!spec.verified_at || typeof spec.verified_at !== 'string') {
        violations.push(`${rel}: spec.verified_against_source is true but spec.verified_at is missing`)
      }
      const url = spec.verification_url
      if (!url || typeof url !== 'string') {
        violations.push(`${rel}: spec.verified_against_source is true but spec.verification_url is missing`)
      } else if (!isImmutableSource(url)) {
        violations.push(
          `${rel}: spec.verification_url "${url}" is not an immutable/pinned source -- ` +
            'must be an RFC .txt (rfc-editor.org/rfc/rfcNNNN.txt) or a raw.githubusercontent.com blob pinned to a 40-hex commit SHA ' +
            '(ADR 0011 follow-up (b): a living page cannot be re-verified byte-for-byte)'
        )
      }
    } else {
      // false: the honest complement -- it must say WHY it is unverified.
      if (!spec.verification_note || typeof spec.verification_note !== 'string') {
        violations.push(
          `${rel}: spec.verified_against_source is false but spec.verification_note is missing -- ` +
            'an unverified rule must disclose why (no external clause to verify, or an honest not-yet-checked note)'
        )
      }
    }
  }

  return violations
}

export function checkSpecVerification() {
  const violations = []
  const rules = readRawRules(violations)
  return violations.concat(verifyRules(rules))
}

function main() {
  const violations = checkSpecVerification()
  console.log('\n=== check-spec-verification ===')
  if (violations.length === 0) {
    const rules = readRawRules([])
    const verified = rules.filter((r) => r.rule.spec?.verified_against_source === true).length
    const clauseCiting = rules.filter((r) => typeof r.rule.spec?.clause === 'string' && r.rule.spec.clause !== 'n/a').length
    console.log('  (no violations)')
    console.log(
      `  ${rules.length} rule(s) checked: ${clauseCiting} cite an external clause and are all verified against an immutable/pinned source ` +
        `(${verified} verified_against_source total), 0 violation(s)`
    )
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
  main()
}
