import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {SECURITY_TXT_URL, validateSecurityTxt} from '../../scripts/audit/check-security-txt.mjs'

const NOW = new Date('2026-07-16T00:00:00.000Z')
const CANONICAL = SECURITY_TXT_URL
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
  it('a missing Contact field fails -- RFC 9116 §2.5.3 lists Contact as mandatory', () => {
    // Raised from severity: warn to severity: fail (decisions/0011,
    // specs/security-txt/security-txt-contact-missing.rule.json): RFC 9116
    // genuinely requires at least one Contact field, and rule_class:
    // conformance forces severity: fail so lib/http.mjs's exit-code check
    // actually reacts to a missing mandatory field.
    const body = `Expires: ${daysFromNow(400)}\nCanonical: ${CANONICAL}\n`
    const findings = validateSecurityTxt(body, NOW)
    expect(findings).toEqual([
      expect.objectContaining({severity: 'fail', id: 'security-txt-contact-missing'})
    ])
  })

  it('one day before the 30-day boundary still fails (the comparison is strict <)', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(29)}\nCanonical: ${CANONICAL}\n`
    const findings = validateSecurityTxt(body, NOW)
    expect(findings.map((f) => f.id)).toContain('security-txt-expiring-soon')
  })
  // The exactly-30-day boundary itself is the catalog's own case
  // (specs/security-txt/cases/expires-30d.txt), asserted by
  // tests/audit/spec-cases.test.ts plus its dedicated exactness check --
  // duplicating it here would be exactly the lockstep-maintenance cost
  // REVERSAL 2 (decisions/0011) warns against.

  it('Contact is validated even when Expires is missing (the lifted early return)', () => {
    // The catalog pins this on cases/no-expires.txt too. Kept here because the
    // regression is about CONTROL FLOW, not about that fixture: the early
    // return meant the bodies most likely to be broken were the ones whose
    // mandatory Contact field went unchecked.
    const findings = validateSecurityTxt(`Canonical: ${CANONICAL}\n`, NOW)
    expect(findings.map((f) => f.id).sort()).toEqual(['security-txt-contact-missing', 'security-txt-expires-missing'])
  })

  it('Contact is validated even when Expires is present but unparseable', () => {
    const body = `Expires: not-a-date\nCanonical: ${CANONICAL}\n`
    expect(validateSecurityTxt(body, NOW).map((f) => f.id).sort()).toEqual([
      'security-txt-contact-missing',
      'security-txt-expires-unparseable'
    ])
  })

  it('an absent Preferred-Languages field is not a finding -- RFC 9116 §2.5 makes it optional', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(400)}\nCanonical: ${CANONICAL}\n`
    expect(validateSecurityTxt(body, NOW)).toEqual([])
  })

  it('one Canonical value among several is enough -- RFC 9116 §2.5.2 permits multiple', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(400)}\n` +
      `Canonical: https://mirror.example.com/.well-known/security.txt\nCanonical: ${CANONICAL}\n`
    expect(validateSecurityTxt(body, NOW)).toEqual([])
  })
})

// The served artifact is the thing every rule above exists to protect, so it
// is asserted directly rather than inferred from the case fixtures. `now` is
// pinned: whether the live Expires is still far enough out is the scheduled
// audit job's question, not a unit test's, and a real clock here would turn
// this into a time bomb 30 days before the file expires.
describe('the served public/.well-known/security.txt', () => {
  it('produces zero findings against the full RFC 9116 field coverage', () => {
    const served = readFileSync(join(REPO_ROOT, 'public', '.well-known', 'security.txt'), 'utf-8')
    expect(validateSecurityTxt(served, new Date('2026-08-31T00:00:00.000Z'))).toEqual([])
  })
})
