// audits/__tests__/spec-verification.test.ts -- B2 spec/eval pilot, ADR 0011
// follow-up (a). Two halves:
//   1. The live catalog is green and its conformance rules are all verified
//      against an immutable/pinned source (the invariant this PR establishes).
//   2. The gate CAN FAIL. ADR 0010/0011's core lesson is that a gate never
//      observed to fail is indistinguishable from no gate. verifyRules() is the
//      pure seam, so every failure mode -- a local rule claiming conformance
//      evidence, a conformance rule with no citation, a living (unpinnable)
//      pinnedAt, missing verification metadata, a local rule with no rationale,
//      and a quote nobody can re-read -- is asserted here as a standing
//      regression, not only demonstrated once by the PR-body probe.
//
// RESHAPED BY THE CITATION SPLIT (atlas decision 0129 consumer round). The old gate
// keyed on spec.clause because one shared `spec` block made a citation and a
// derivation indistinguishable, so the rule_class-downgrade bypass had to be closed by
// forcing verification onto anything naming a clause. `cites` and `derivedFrom` are now
// different shapes, so that bypass is closed structurally -- and the test for it below
// asserts the structural refusal rather than the old field-level one.

import {describe, expect, it} from 'vitest'
import {checkSpecVerification, verifyRules} from '../checks/b2-check-spec-verification.mjs'

const RFC_URL = 'https://www.rfc-editor.org/rfc/rfc9116.txt'
const PINNED = 'https://raw.githubusercontent.com/owner/repo/0123456789abcdef0123456789abcdef01234567/path.md'
const RSSBOARD_ARCHIVE = 'https://www.rssboard.org/rss-2-0-11'

// Every field is optional here so the failure-mode tests can `delete` or
// override it without fighting a narrowed inferred type (astro check runs
// under the strict tsconfig floor).
interface CitationFields {
  source?: string
  clause?: string
  quote?: string
  url?: string
  pinnedAt?: string
  retrieved?: string
  content_sha256?: string
  conformance_testable?: boolean
  verified_against_source?: boolean
  verified_at?: string
}
interface SyntheticRule {
  rel: string
  rule: {id: string; rule_class: string; cites?: CitationFields; derivedFrom?: CitationFields; rationale?: string}
}

/** A well-formed conformance rule citing an external clause -- the shape the gate accepts. */
function verifiedClauseRule(): SyntheticRule {
  return {
    rel: 'security-txt/example.rule.json',
    rule: {
      id: 'example',
      rule_class: 'conformance',
      cites: {clause: '\u00a72.5.3', conformance_testable: true, verified_against_source: true, verified_at: '2026-07-30', pinnedAt: RFC_URL}
    }
  }
}

/** A well-formed local rule recording an informative derivation. */
function derivedRule(rule_class = 'convention'): SyntheticRule {
  return {
    rel: 'llms-txt/example.rule.json',
    rule: {
      id: 'example',
      rule_class,
      rationale: 'llmstxt.org frames its structure as a convention, not a conformance-tested format.',
      derivedFrom: {clause: 'Format section, item 3', quote: 'A blockquote with a short summary', pinnedAt: PINNED, retrieved: '2026-07-30'}
    }
  }
}

describe('check-spec-verification: the live catalog', () => {
  it('has zero violations', () => {
    expect(checkSpecVerification()).toEqual([])
  })
})

describe('check-spec-verification: verifyRules accepts honest rules', () => {
  it('accepts a verified clause-citing rule with an immutable RFC source', () => {
    expect(verifyRules([verifiedClauseRule()])).toEqual([])
  })

  it('accepts a verified rule with a commit-pinned GitHub blob', () => {
    const r = verifiedClauseRule()
    r.rule.cites!.pinnedAt = PINNED
    expect(verifyRules([r])).toEqual([])
  })

  it('accepts a verified rule with a numbered RSS Advisory Board archive', () => {
    const r = verifiedClauseRule()
    r.rule.cites!.pinnedAt = RSSBOARD_ARCHIVE
    expect(verifyRules([r])).toEqual([])
  })

  it('accepts a local rule recording a pinned, dated derivation', () => {
    expect(verifyRules([derivedRule()])).toEqual([])
    expect(verifyRules([derivedRule('local-policy')])).toEqual([])
  })

  it('accepts a local rule with no external source at all', () => {
    const rules: SyntheticRule[] = [{
      rel: 'x/op.rule.json',
      rule: {id: 'op', rule_class: 'operational', rationale: 'no external clause covers a transport failure'}
    }]
    expect(verifyRules(rules)).toEqual([])
  })
})

describe('check-spec-verification: the gate CAN fail (known-answer property)', () => {
  it('fails a conformance rule whose citation is unverified', () => {
    const r = verifiedClauseRule()
    r.rule.cites!.verified_against_source = false
    expect(verifyRules([r]).some((m) => m.includes('cites.verified_against_source must be true'))).toBe(true)
  })

  it('closes the rule_class-downgrade bypass STRUCTURALLY: a local rule may not carry cites', () => {
    // The exact escape path the original reviewer flagged -- a clause cited, but
    // rule_class downgraded to dodge the gate. Under the union it is no longer a
    // field-value question: the local arm cannot hold a citation at all.
    const r = verifiedClauseRule()
    r.rule.rule_class = 'local-policy'
    expect(verifyRules([r]).some((m) => m.includes('carries a cites block'))).toBe(true)
  })

  it('fails an operational rule that dresses itself in conformance evidence', () => {
    const rules: SyntheticRule[] = [
      {rel: 'x/op.rule.json', rule: {id: 'op', rule_class: 'operational', cites: {clause: 'n/a', verified_against_source: true, pinnedAt: RFC_URL}}}
    ]
    expect(verifyRules(rules).some((m) => m.includes('carries a cites block'))).toBe(true)
  })

  it('fails a conformance rule with no citation at all', () => {
    const rules: SyntheticRule[] = [{rel: 'x/c.rule.json', rule: {id: 'c', rule_class: 'conformance'}}]
    expect(verifyRules(rules).some((m) => m.includes('no cites block'))).toBe(true)
  })

  it('fails a conformance rule built on a clause its source does not conformance-test', () => {
    const r = verifiedClauseRule()
    r.rule.cites!.conformance_testable = false
    expect(verifyRules([r]).some((m) => m.includes('conformance_testable must be true'))).toBe(true)
  })

  it('fails a verified rule whose pinnedAt is a living (unpinnable) page', () => {
    const r = verifiedClauseRule()
    r.rule.cites!.quote = 'a quote'
    r.rule.cites!.pinnedAt = 'https://llmstxt.org/'
    expect(verifyRules([r]).some((m) => m.includes('not an immutable/pinned source'))).toBe(true)
  })

  it('rejects the living RSS page even though numbered RSS archives are allowed', () => {
    const r = verifiedClauseRule()
    r.rule.cites!.quote = 'a quote'
    r.rule.cites!.pinnedAt = 'https://www.rssboard.org/rss-specification'
    expect(verifyRules([r]).some((m) => m.includes('not an immutable/pinned source'))).toBe(true)
  })

  it('fails a verified rule missing verified_at', () => {
    const r = verifiedClauseRule()
    delete r.rule.cites!.verified_at
    expect(verifyRules([r]).some((m) => m.includes('verified_at is missing'))).toBe(true)
  })

  it('fails a local rule that omits its rationale', () => {
    const r = derivedRule()
    delete r.rule.rationale
    expect(verifyRules([r]).some((m) => m.includes('must carry a rationale'))).toBe(true)
  })

  it('fails a DERIVED quote nobody can re-read, exactly as it fails a cited one', () => {
    // The locatability gate applies to both arms: a quote with no pinned source is a
    // claim no drift or currency probe can check, whatever the rule claims about it.
    const r = derivedRule()
    delete r.rule.derivedFrom!.pinnedAt
    expect(verifyRules([r]).some((m) => m.includes('carries a quote but no pinnedAt'))).toBe(true)
  })

  it('fails a derived quote with no retrieved date', () => {
    const r = derivedRule()
    delete r.rule.derivedFrom!.retrieved
    expect(verifyRules([r]).some((m) => m.includes('carries a quote but no retrieved date'))).toBe(true)
  })
})
