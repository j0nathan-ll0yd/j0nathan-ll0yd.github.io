// tests/audit/spec-verification.test.ts -- B2 spec/eval pilot, ADR 0011
// follow-up (a). Two halves:
//   1. The live catalog is green and its conformance rules are all verified
//      against an immutable/pinned source (the invariant this PR establishes).
//   2. The gate CAN FAIL. ADR 0010/0011's core lesson is that a gate never
//      observed to fail is indistinguishable from no gate. verifyRules() is the
//      pure seam, so every failure mode -- a clause-citing rule left
//      unverified, the rule_class-downgrade bypass, a clause 'n/a' rule falsely
//      claiming verified, a living (unpinnable) verification_url, missing
//      metadata, a false rule with no disclosure -- is asserted here as a
//      standing regression, not only demonstrated once by the PR-body probe.

import {describe, expect, it} from 'vitest'
import {checkSpecVerification, verifyRules} from '../../scripts/audit/check-spec-verification.mjs'

const RFC_URL = 'https://www.rfc-editor.org/rfc/rfc9116.txt'
const PINNED = 'https://raw.githubusercontent.com/owner/repo/0123456789abcdef0123456789abcdef01234567/path.md'
const RSSBOARD_ARCHIVE = 'https://www.rssboard.org/rss-2-0-11'

// Every spec field is optional here so the failure-mode tests can `delete` or
// override it without fighting a narrowed inferred type (astro check runs
// under the strict tsconfig floor).
interface SpecFields {
  clause?: string
  verified_against_source?: boolean
  verified_at?: string
  verification_url?: string
  verification_note?: string
}
interface SyntheticRule {
  rel: string
  rule: {id: string; rule_class: string; spec: SpecFields}
}

// A well-formed verified rule that cites an external clause -- the shape the
// gate accepts. The gate keys on spec.clause, not rule_class.
function verifiedClauseRule(): SyntheticRule {
  return {
    rel: 'security-txt/example.rule.json',
    rule: {
      id: 'example',
      rule_class: 'conformance',
      spec: {clause: '§2.5.3', verified_against_source: true, verified_at: '2026-07-30', verification_url: RFC_URL}
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
    r.rule.spec.verification_url = PINNED
    expect(verifyRules([r])).toEqual([])
  })

  it('accepts a verified rule with a numbered RSS Advisory Board archive', () => {
    const r = verifiedClauseRule()
    r.rule.spec.verification_url = RSSBOARD_ARCHIVE
    expect(verifyRules([r])).toEqual([])
  })

  it('accepts a clause n/a rule that is false and discloses why', () => {
    const rules: SyntheticRule[] = [
      {
        rel: 'x/op.rule.json',
        rule: {id: 'op', rule_class: 'operational', spec: {clause: 'n/a', verified_against_source: false, verification_note: 'no external clause to verify'}}
      }
    ]
    expect(verifyRules(rules)).toEqual([])
  })
})

describe('check-spec-verification: the gate CAN fail (known-answer property)', () => {
  it('fails a clause-citing rule left unverified (verified_against_source: false)', () => {
    const r = verifiedClauseRule()
    r.rule.spec.verified_against_source = false
    r.rule.spec.verification_note = 'pretending this is fine'
    delete r.rule.spec.verified_at
    delete r.rule.spec.verification_url
    const v = verifyRules([r])
    expect(v.some((m) => m.includes('cites an external clause, so spec.verified_against_source must be true'))).toBe(true)
  })

  it('closes the rule_class-downgrade bypass: a clause-citing local-policy rule must still be verified', () => {
    // The exact escape path the reviewer flagged -- clause cited, but rule_class
    // downgraded from conformance to local-policy to dodge the gate.
    const rules: SyntheticRule[] = [
      {
        rel: 'security-txt/x.rule.json',
        rule: {id: 'x', rule_class: 'local-policy', spec: {clause: '§2.5.5', verified_against_source: false, verification_note: 'quote is a paraphrase'}}
      }
    ]
    expect(verifyRules(rules).some((m) => m.includes('cites an external clause, so spec.verified_against_source must be true'))).toBe(true)
  })

  it('fails a clause n/a rule that falsely claims verified', () => {
    const rules: SyntheticRule[] = [
      {
        rel: 'x/op.rule.json',
        rule: {
          id: 'op',
          rule_class: 'operational',
          spec: {clause: 'n/a', verified_against_source: true, verified_at: '2026-07-30', verification_url: RFC_URL}
        }
      }
    ]
    expect(verifyRules(rules).some((m) => m.includes('must be false, but it claims true'))).toBe(true)
  })

  it('fails a clause-citing rule with the field deleted entirely', () => {
    const r = verifiedClauseRule()
    delete r.rule.spec.verified_against_source
    delete r.rule.spec.verified_at
    delete r.rule.spec.verification_url
    expect(verifyRules([r]).some((m) => m.includes('required and must be a boolean'))).toBe(true)
  })

  it('fails a verified rule whose verification_url is a living (unpinnable) page', () => {
    const r = verifiedClauseRule()
    r.rule.spec.verification_url = 'https://llmstxt.org/'
    expect(verifyRules([r]).some((m) => m.includes('not an immutable/pinned source'))).toBe(true)
  })

  it('rejects the living RSS page even though numbered RSS archives are allowed', () => {
    const r = verifiedClauseRule()
    r.rule.spec.verification_url = 'https://www.rssboard.org/rss-specification'
    expect(verifyRules([r]).some((m) => m.includes('not an immutable/pinned source'))).toBe(true)
  })

  it('fails a verified rule missing verified_at', () => {
    const r = verifiedClauseRule()
    delete r.rule.spec.verified_at
    expect(verifyRules([r]).some((m) => m.includes('verified_at is missing'))).toBe(true)
  })

  it('fails a false rule that omits its verification_note disclosure', () => {
    const rules: SyntheticRule[] = [{
      rel: 'x/op.rule.json',
      rule: {id: 'op', rule_class: 'operational', spec: {clause: 'n/a', verified_against_source: false}}
    }]
    expect(verifyRules(rules).some((m: string) => m.includes('verification_note is missing'))).toBe(true)
  })
})
