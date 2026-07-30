import {describe, expect, it} from 'vitest'
import {validateSecurityTxt} from '../../scripts/audit/check-security-txt.mjs'

const NOW = new Date('2026-07-16T00:00:00.000Z')

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

// decisions/0011 Step 4.5: the known-answer(20d)/comfortably-future(400d)/
// past(-5d)/missing-Expires/unparseable cases formerly hand-written here now
// live as derived cases in specs/security-txt/*.rule.json, exercised by
// tests/audit/spec-cases.test.ts against the SAME (or a superset) input --
// deleted here as replacement, not as inconvenience. Retained below: the
// severity-raise regression NB1 explicitly requires be rewritten rather than
// deleted, and the 29-day adjacent-boundary point the catalog does not
// declare a dedicated case for.
describe('validateSecurityTxt', () => {
  it('a missing Contact field fails -- RFC 9116 §2.5.1 lists Contact as mandatory', () => {
    // Raised from severity: warn to severity: fail (decisions/0011,
    // specs/security-txt/security-txt-contact-missing.rule.json): RFC 9116
    // genuinely requires at least one Contact field, and rule_class:
    // conformance forces severity: fail so lib/http.mjs's exit-code check
    // actually reacts to a missing mandatory field.
    const findings = validateSecurityTxt(`Expires: ${daysFromNow(400)}\n`, NOW)
    expect(findings).toEqual([
      expect.objectContaining({severity: 'fail', id: 'security-txt-contact-missing'})
    ])
  })

  it('one day before the 30-day boundary still fails (the comparison is strict <)', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(29)}\n`
    const findings = validateSecurityTxt(body, NOW)
    expect(findings.map((f) => f.id)).toContain('security-txt-expiring-soon')
  })
  // The exactly-30-day boundary itself is the catalog's own case
  // (specs/security-txt/cases/expires-30d.txt), asserted by
  // tests/audit/spec-cases.test.ts plus its dedicated exactness check --
  // duplicating it here would be exactly the lockstep-maintenance cost
  // REVERSAL 2 (decisions/0011) warns against.
})
