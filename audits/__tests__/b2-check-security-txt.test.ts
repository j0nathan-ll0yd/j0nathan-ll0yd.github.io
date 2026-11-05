import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  ARTIFACTS,
  isRfc3339DateTime,
  oneCalendarYearAfter,
  SECURITY_TXT_URL,
  validateSecurityTxt,
  validateSecurityTxtContentType
} from '../checks/b2-check-security-txt.mjs'

const NOW = new Date('2026-07-16T00:00:00.000Z')
const CANONICAL = SECURITY_TXT_URL
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

// decisions/0011 Step 4.5: the known-answer(20d)/comfortably-future(400d)/
// past(-5d)/missing-Expires/unparseable cases formerly hand-written here now
// live as derived cases in specs/security-txt/*.rule.json, exercised by
// audits/__tests__/spec-cases.test.ts against the SAME (or a superset) input --
// deleted here as replacement, not as inconvenience. Retained below: the
// severity-raise regression NB1 explicitly requires be rewritten rather than
// deleted, and the 59-day adjacent-boundary point the catalog does not
// declare a dedicated case for.
describe('validateSecurityTxt', () => {
  it('a missing Contact field fails -- RFC 9116 §2.5.3 lists Contact as mandatory', () => {
    // Raised from severity: warn to severity: fail (decisions/0011,
    // specs/security-txt/security-txt-contact-missing.rule.json): RFC 9116
    // genuinely requires at least one Contact field, and rule_class:
    // conformance forces severity: fail so lib/http.mjs's exit-code check
    // actually reacts to a missing mandatory field.
    const body = `Expires: ${daysFromNow(300)}\nCanonical: ${CANONICAL}\n`
    const findings = validateSecurityTxt(body, NOW)
    expect(findings).toEqual([
      expect.objectContaining({severity: 'fail', id: 'security-txt-contact-missing'})
    ])
  })

  it('one day before the 60-day boundary still fails (the comparison is strict <)', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(59)}\nCanonical: ${CANONICAL}\n`
    const findings = validateSecurityTxt(body, NOW)
    expect(findings.map((f) => f.id)).toContain('security-txt-expiring-soon')
  })
  // The exactly-60-day boundary itself is the catalog's own case
  // (specs/security-txt/cases/expires-60d.txt), asserted by
  // audits/__tests__/spec-cases.test.ts plus its dedicated exactness check --
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
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(300)}\nCanonical: ${CANONICAL}\n`
    expect(validateSecurityTxt(body, NOW)).toEqual([])
  })

  it('one Canonical value among several is enough -- RFC 9116 §2.5.2 permits multiple', () => {
    const body = `Contact: mailto:security@example.com\nExpires: ${daysFromNow(300)}\n` +
      `Canonical: https://mirror.example.com/.well-known/security.txt\nCanonical: ${CANONICAL}\n`
    expect(validateSecurityTxt(body, NOW)).toEqual([])
  })
})

describe('URI field checks', () => {
  const head = `Expires: ${daysFromNow(300)}\nCanonical: ${CANONICAL}\n`
  const ids = (body: string) => validateSecurityTxt(body, NOW).map((f) => f.id)

  it.each(['Acknowledgments', 'Contact', 'Encryption', 'Hiring', 'Policy'])('flags an http:// %s value', (field) => {
    const contact = field === 'Contact' ? '' : 'Contact: mailto:security@example.com\n'
    expect(ids(`${contact}${head}${field}: http://example.com/x\n`)).toEqual(['security-txt-web-uri-not-https'])
  })

  it('keys on the http scheme, with or without //', () => {
    expect(ids(`Contact: mailto:security@example.com\n${head}Policy: http:example.com/policy\n`)).toEqual(['security-txt-web-uri-not-https'])
  })

  it('reads only the scheme: an https:// value carrying http:// in its query passes', () => {
    expect(ids(`Contact: https://example.com/?next=http://example.com/\n${head}`)).toEqual([])
  })

  it('anchors the Contact URI shape at both ends', () => {
    expect(ids(`Contact: see mailto:security@example.com\n${head}`)).toEqual(['security-txt-contact-not-uri'])
    expect(ids(`Contact: mailto:security@example.com or tel:+1-201-555-0123\n${head}`)).toEqual(['security-txt-contact-not-uri'])
  })
})

describe('Expires leap second', () => {
  it('reads second 60 as second 59, not as unparseable', () => {
    const body = `Contact: mailto:security@example.com\nExpires: 2026-07-16T23:59:60Z\nCanonical: ${CANONICAL}\n`
    expect(validateSecurityTxt(body, new Date('2026-05-01T00:00:00.000Z'), 60).map((f) => f.id)).toEqual([])
    expect(validateSecurityTxt(body, new Date('2026-07-17T00:00:00.000Z'), 60).map((f) => f.id)).toEqual(['security-txt-expired'])
  })
})

describe('isRfc3339DateTime', () => {
  // The catalog pins the cases Date parses; these pin each RFC 3339 part range
  // directly, including the ones Date refuses, so every bound is exercised.
  it.each([
    '2027-06-20T00:00:00Z',
    '2027-06-20t23:59:59z',
    '2027-06-20T23:59:60.25-05:30',
    '2028-02-29T00:00:00+23:59',
    '2027-12-31T00:00:00Z',
    '2027-01-01T00:00:00Z',
    '0000-02-29T00:00:00Z',
    '2000-02-29T00:00:00Z',
    '2027-04-30T00:00:00Z'
  ])('accepts %s', (value) => {
    expect(isRfc3339DateTime(value)).toBe(true)
  })

  it.each([
    '2027-06-20',
    '2027-06-20 00:00:00Z',
    '2027-06-20T00:00:00',
    '2027-06-20T00:00Z',
    ' 2027-06-20T00:00:00Z',
    '2027-06-20T00:00:00Z ',
    '2027-00-20T00:00:00Z',
    '2027-13-20T00:00:00Z',
    '2027-06-00T00:00:00Z',
    '2027-06-31T00:00:00Z',
    '2027-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2027-04-31T00:00:00Z',
    '2027-09-31T00:00:00Z',
    '2027-11-31T00:00:00Z',
    '2027-06-20T24:00:00Z',
    '2027-06-20T00:60:00Z',
    '2027-06-20T00:00:61Z',
    '2027-06-20T00:00:00+24:00',
    '2027-06-20T00:00:00+00:60',
    '2027-06-20T00:00:00.Z'
  ])('rejects %s', (value) => {
    expect(isRfc3339DateTime(value)).toBe(false)
  })
})

describe('oneCalendarYearAfter', () => {
  it('adds one calendar year and keeps the time of day', () => {
    expect(oneCalendarYearAfter(new Date('2026-07-16T12:34:56.789Z')).toISOString()).toBe('2027-07-16T12:34:56.789Z')
  })

  it('clamps 29 February to 28 February, as relativedelta(years=1) does', () => {
    expect(oneCalendarYearAfter(new Date('2028-02-29T06:00:00.000Z')).toISOString()).toBe('2029-02-28T06:00:00.000Z')
  })

  it('does not clamp a date that exists one year on', () => {
    expect(oneCalendarYearAfter(new Date('2027-03-01T00:00:00.000Z')).toISOString()).toBe('2028-03-01T00:00:00.000Z')
  })
})

describe('validateSecurityTxtContentType', () => {
  it('passes the production header and the bare media type', () => {
    expect(validateSecurityTxtContentType('text/plain; charset=utf-8')).toEqual([])
    expect(validateSecurityTxtContentType('text/plain')).toEqual([])
    expect(validateSecurityTxtContentType('  TEXT/PLAIN ; foo=bar ;CHARSET = "UTF-8" ')).toEqual([])
  })

  it('fails a missing or blank header', () => {
    expect(validateSecurityTxtContentType(null).map((f) => f.id)).toEqual(['security-txt-content-type'])
    expect(validateSecurityTxtContentType('   ').map((f) => f.id)).toEqual(['security-txt-content-type'])
  })

  it('names each problem in one finding', () => {
    const findings = validateSecurityTxtContentType('text/html; charset=iso-8859-1')
    expect(findings).toEqual([expect.objectContaining({id: 'security-txt-content-type', severity: 'fail'})])
    expect(findings[0].message).toContain('"text/html" is not "text/plain"')
    expect(findings[0].message).toContain('"iso-8859-1" is not "utf-8"')
  })

  it('fails an empty charset value and a second, conflicting charset', () => {
    expect(validateSecurityTxtContentType('text/plain; charset=').map((f) => f.id)).toEqual(['security-txt-content-type'])
    expect(validateSecurityTxtContentType('text/plain; charset=utf-8; charset=latin1').map((f) => f.id)).toEqual(['security-txt-content-type'])
  })

  it('accepts the IANA alias csUTF8', () => {
    expect(validateSecurityTxtContentType('text/plain; charset=csUTF8')).toEqual([])
  })

  it('does not read a parameter whose name only ends in charset', () => {
    expect(validateSecurityTxtContentType('text/plain; xcharset=latin1')).toEqual([])
  })
})

// atlas A18 reads this literal statically; the test keeps a mutation of it visible.
describe('ARTIFACTS', () => {
  it('declares the security-txt surface', () => {
    expect(ARTIFACTS).toEqual([{surfaceId: 'security-txt'}])
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
