#!/usr/bin/env node
// External-source verification gate (ADR 0011).
// Any rule citing an external clause must carry a verified quote and immutable primary-source URL;
// a clause marked n/a must disclose why it is unverified. The schema enforces the same branch at
// load time; this raw-file pass provides focused diagnostics and defense in depth.

import {readdirSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {artifacts} from '../specs/load.mjs'

const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs')

// An immutable canonical RFC plaintext, a GitHub raw blob pinned to a full
// 40-hex commit SHA, or a numbered RSS Advisory Board archive. A living URL is
// rejected even for a currently-correct quote.
const RFC_TXT = /^https:\/\/www\.rfc-editor\.org\/rfc\/rfc\d+\.txt$/
const PINNED_GITHUB = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\/.+/
const RSSBOARD_ARCHIVE = /^https:\/\/www\.rssboard\.org\/rss-2-0-\d+$/

function isImmutableSource(url) {
  return RFC_TXT.test(url) || PINNED_GITHUB.test(url) || RSSBOARD_ARCHIVE.test(url)
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
 * by audits/__tests__/spec-verification.test.ts without mutating on-disk fixtures --
 * the known-answer property (ADR 0011's acceptance criterion) encoded as a
 * standing regression, not only demonstrated once by hand.
 */
export function verifyRules(rules) {
  const violations = []

  for (const {rel, rule} of rules) {
    const isConformance = rule.rule_class === 'conformance'

    // THE ARM GATE. Before the atlas decision 0129 consumer round this keyed on
    // spec.clause rather than rule_class, because one shared `spec` block made a
    // citation and a derivation indistinguishable -- so the only way to stop a
    // rule_class downgrade buying an exemption was to force verification onto
    // anything that named a clause. The union makes the two different SHAPES, so
    // the bypass is closed structurally and this gate now asserts the shapes.
    if (isConformance && rule.cites === undefined) {
      violations.push(`${rel}: rule_class is "conformance" but there is no cites block -- a conformance rule asserts an external standard and must cite it`)
      continue
    }
    if (!isConformance && rule.cites !== undefined) {
      violations.push(
        `${rel}: rule_class is ${JSON.stringify(rule.rule_class)} but it carries a cites block -- ` +
          'cites asserts VERIFIED CONFORMANCE EVIDENCE, which only a conformance rule may claim. ' +
          'Use derivedFrom for an informative derivation, or move the rule to rule_class: conformance and cite properly'
      )
      continue
    }
    if (!isConformance && (typeof rule.rationale !== 'string' || rule.rationale.trim() === '')) {
      violations.push(`${rel}: a local rule must carry a rationale saying why it exists, given that no conformance claim backs it`)
    }

    const spec = rule.cites ?? rule.derivedFrom
    if (spec === undefined) {
      continue // a local rule with no external source at all: its rationale is self-authored
    }

    // THE CONFORMANCE CEREMONY, on the conformance arm alone. These three fields
    // assert that the quote is verified conformance evidence; a local rule does
    // not carry them, and the schema forbids it from doing so.
    if (isConformance) {
      if (spec.verified_against_source !== true) {
        violations.push(
          `${rel}: cites.verified_against_source must be true -- ` +
            'a rule asserting an external standard may not ship unverified against its cited source (ADR 0011 follow-up (a), the 7-of-7 defect class)'
        )
      }
      if (spec.conformance_testable !== true) {
        violations.push(
          `${rel}: cites.conformance_testable must be true -- a conformance rule may not be built on a clause its source does not pass/fail test (0010's lesson)`
        )
      }
      if (!spec.verified_at || typeof spec.verified_at !== 'string') {
        violations.push(`${rel}: cites.verified_at is missing -- a verification claim needs the date it was made`)
      }
    }

    // THE LOCATABILITY GATE, on BOTH arms. A quote that cannot be re-read is a claim
    // that cannot be checked, and whether a source has been rewritten under a
    // transcription is not a fact about conformance -- so a derivedFrom quote is held
    // to the same immutable-source requirement a cites quote is.
    if (typeof spec.quote === 'string' && spec.quote.length > 0) {
      const url = spec.pinnedAt
      if (!url || typeof url !== 'string') {
        violations.push(`${rel}: the citation carries a quote but no pinnedAt -- there is nothing for the drift or currency probe to fetch`)
      } else if (!isImmutableSource(url)) {
        violations.push(
          `${rel}: pinnedAt "${url}" is not an immutable/pinned source -- ` +
            'must be an RFC .txt, a raw.githubusercontent.com blob pinned to a 40-hex commit SHA, ' +
            'or a numbered rssboard.org RSS archive ' +
            '(ADR 0011 follow-up (b): a living page cannot be re-verified byte-for-byte)'
        )
      }
      if (!spec.retrieved || typeof spec.retrieved !== 'string') {
        violations.push(`${rel}: the citation carries a quote but no retrieved date`)
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
    const conformance = rules.filter((r) => r.rule.rule_class === 'conformance').length
    const derived = rules.filter((r) => r.rule.derivedFrom !== undefined).length
    console.log('  (no violations)')
    console.log(
      `  ${rules.length} rule(s) checked: ${conformance} cite a verified conformance clause, ${derived} record an informative derivation, ` +
        `all ${conformance + derived} quoting rules pinned to an immutable source, 0 violation(s)`
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
