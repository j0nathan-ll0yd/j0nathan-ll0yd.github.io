// tests/audit/spec-verification.test.ts -- B2 spec/eval pilot, ADR 0011
// follow-up (a). Two halves:
//   1. The live catalog is green and its conformance rules are all verified
//      against an immutable/pinned source (the invariant this PR establishes).
//   2. The gate CAN FAIL. ADR 0010/0011's core lesson is that a gate never
//      observed to fail is indistinguishable from no gate. verifyRules() is the
//      pure seam, so every failure mode -- a conformance rule flipped to false,
//      a living (unpinnable) verification_url, missing metadata, a false rule
//      with no disclosure -- is asserted here as a standing regression rather
//      than only demonstrated once by the known-answer probe in the PR body.

import {describe, expect, it} from 'vitest'
import {checkSpecVerification, verifyRules} from '../../scripts/audit/check-spec-verification.mjs'

const RFC_URL = 'https://www.rfc-editor.org/rfc/rfc9116.txt'
const PINNED = 'https://raw.githubusercontent.com/owner/repo/0123456789abcdef0123456789abcdef01234567/path.md'

// Every spec field is optional here so the failure-mode tests can `delete` or
// override it without fighting a narrowed inferred type (astro check runs
// under the strict tsconfig floor).
interface SpecFields {
  verified_against_source?: boolean
  verified_at?: string
  verification_url?: string
  verification_note?: string
}
interface SyntheticRule {
  rel: string
  rule: {id: string; rule_class: string; spec: SpecFields}
}

// A well-formed verified conformance rule -- the shape the gate accepts.
function verifiedConformanceRule(): SyntheticRule {
  return {
    rel: 'security-txt/example.rule.json',
    rule: {id: 'example', rule_class: 'conformance', spec: {verified_against_source: true, verified_at: '2026-07-30', verification_url: RFC_URL}}
  }
}

describe('check-spec-verification: the live catalog', () => {
  it('has zero violations', () => {
    expect(checkSpecVerification()).toEqual([])
  })
})

describe('check-spec-verification: verifyRules accepts honest rules', () => {
  it('accepts a verified conformance rule with an immutable RFC source', () => {
    expect(verifyRules([verifiedConformanceRule()])).toEqual([])
  })

  it('accepts a verified rule with a commit-pinned GitHub blob', () => {
    const r = verifiedConformanceRule()
    r.rule.spec.verification_url = PINNED
    expect(verifyRules([r])).toEqual([])
  })

  it('accepts an unverified non-conformance rule that discloses why', () => {
    const rules: SyntheticRule[] = [
      {rel: 'x/op.rule.json', rule: {id: 'op', rule_class: 'operational', spec: {verified_against_source: false, verification_note: 'clause n/a'}}}
    ]
    expect(verifyRules(rules)).toEqual([])
  })
})

describe('check-spec-verification: the gate CAN fail (known-answer property)', () => {
  it('fails a conformance rule flipped to verified_against_source: false', () => {
    const r = verifiedConformanceRule()
    r.rule.spec.verified_against_source = false
    r.rule.spec.verification_note = 'pretending this is fine'
    delete r.rule.spec.verified_at
    delete r.rule.spec.verification_url
    const v = verifyRules([r])
    expect(v.some((m) => m.includes('rule_class "conformance" requires spec.verified_against_source: true'))).toBe(true)
  })

  it('fails a conformance rule with the field deleted entirely', () => {
    const r = verifiedConformanceRule()
    delete r.rule.spec.verified_against_source
    delete r.rule.spec.verified_at
    delete r.rule.spec.verification_url
    expect(verifyRules([r]).some((m) => m.includes('required and must be a boolean'))).toBe(true)
  })

  it('fails a verified rule whose verification_url is a living (unpinnable) page', () => {
    const r = verifiedConformanceRule()
    r.rule.spec.verification_url = 'https://llmstxt.org/'
    expect(verifyRules([r]).some((m) => m.includes('not an immutable/pinned source'))).toBe(true)
  })

  it('fails a verified rule missing verified_at', () => {
    const r = verifiedConformanceRule()
    delete r.rule.spec.verified_at
    expect(verifyRules([r]).some((m) => m.includes('verified_at is missing'))).toBe(true)
  })

  it('fails a false rule that omits its verification_note disclosure', () => {
    const rules: SyntheticRule[] = [{rel: 'x/op.rule.json', rule: {id: 'op', rule_class: 'operational', spec: {verified_against_source: false}}}]
    expect(verifyRules(rules).some((m: string) => m.includes('verification_note is missing'))).toBe(true)
  })
})
