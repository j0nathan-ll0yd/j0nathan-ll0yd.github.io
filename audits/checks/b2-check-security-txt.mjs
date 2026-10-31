#!/usr/bin/env node
// audits/checks/b2-check-security-txt.mjs -- B2. RFC 9116 security.txt. The spec
// this validator derives from lives in specs/security-txt/*.rule.json, not in
// this comment (decisions/0011) -- see that directory for the RFC 9116
// clauses, severities, thresholds, and case inputs each finding id derives
// from. The live file (public/.well-known/security.txt) is static: nothing
// renews its Expires. This check guards it. The monthly audit-web.yml tier runs
// main() against production. security-txt-expiring-soon fails from 60 days
// before expiry (params.minDaysRemaining), so at least one monthly run fails
// before the file expires.

import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {SECURITY_TXT_PATH} from '../../src/lib/edge/site-paths.ts'
import {fetchStable, isMain, report} from '../lib/http.mjs'
import {emit, rules} from '../specs/load.mjs'

// The URI this file is served from. Also the value RFC 9116 §2.5.2 expects a
// Canonical field to list, so the pure validator reads it as the default
// `canonicalUrl` operand -- it is no longer main()-only plumbing.
export const SECURITY_TXT_URL = `${SITE_URL}${SECURITY_TXT_PATH}`
const R = rules('security-txt')

// A18 coverage declaration (atlas decision 0145). The registered estate surface this
// runner holds bytes for and judges: security.txt is the security-txt artifact, and
// main() judges both its body and its served Content-Type. Metadata only -- the hub
// reads it statically from the source; nothing imports it.
export const ARTIFACTS = [{surfaceId: 'security-txt'}]

// RFC 9116 §2 puts every field on its own line, so a field's value is what
// follows the colon on THAT line and never on a later one. Matching [ \t]*
// rather than \s* is what makes the duplicate counts below trustworthy: \s*
// crosses a newline, so "Expires:\nExpires: x" would collapse into ONE match
// and hide exactly the duplicate §2.5.5 forbids. Empty values are dropped, so
// a bare "Expires:" counts as absent rather than as an unparseable date.
function fieldValues(body, name) {
  return [...body.matchAll(new RegExp(`^${name}:[ \\t]*(.*)$`, 'gim'))].map((m) => m[1].trim()).filter((value) => value.length > 0)
}

// RFC 5646 language tag, SHAPE only: hyphen-separated subtags of 1-8
// alphanumerics, the first alphabetic. Deliberately liberal -- it accepts
// "en", "zh-Hans-CN" and "x-private" -- because RFC 9116 §2.5.8 constrains the
// value's grammar, not its registration. Rejecting a well-formed but
// unregistered tag would be this validator inventing a requirement.
const LANGUAGE_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/

// RFC 3339 §5.6 `date-time`, the production RFC 9116's ABNF imports for
// expires-field. RFC 3339 §5.6 lets "T" and "Z" be lowercase, so the letters
// match case-insensitively. Erratum EID 7264 (uppercase Z only) is Reported,
// not Verified, so this grammar does not enforce it.
const RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/

/**
 * Whether a value is an RFC 3339 §5.6 date-time, with the §5.6 and §5.7 ranges
 * on each part. The ranges matter because Date rolls an impossible date
 * forward instead of refusing it: "2027-02-30T00:00:00Z" parses as 2 March.
 * time-second allows 60 for a leap second (§5.6). Leap years are computed
 * arithmetically, because Date.UTC maps years 0-99 to 1900-1999.
 */
export function isRfc3339DateTime(value) {
  const match = RFC3339_DATE_TIME.exec(value)
  if (match === null) {
    return false
  }
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map((part) => Number(part ?? 0))
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = month === 2 ? (leapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 60 && offsetHour <= 23 && offsetMinute <= 59
}

// RFC 3986 §3: a URI begins with a scheme and a colon. This is a SHAPE check on
// the scheme only, which is the half of the grammar RFC 9116 §2.5.3 spells out:
// an email address needs "mailto:" and a phone number needs "tel:".
const URI_WITH_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/

// The RFC 9116 fields whose web URI MUST begin with "https://" (§2.5.1, §2.5.2,
// §2.5.3, §2.5.4, §2.5.6, §2.5.7). CSAF is IANA-registered, not in RFC 9116, so
// it has its own local rule.
const RFC9116_WEB_URI_FIELDS = ['Acknowledgments', 'Canonical', 'Contact', 'Encryption', 'Hiring', 'Policy']

// A URI with the "http" scheme, with or without "//", as sectxt keys on the
// scheme. Schemes are case-insensitive (RFC 3986 §3.1).
const HTTP_WEB_URI = /^http:/i

// The two values the IANA "security.txt Fields" registry defines for Bug-Bounty
// (record dated 2026-03-07): the lines "Bug-Bounty: True" and "Bug-Bounty: False".
const BUG_BOUNTY_VALUES = ['True', 'False']

/**
 * The same instant one calendar year later, in UTC. A plain setUTCFullYear
 * turns 29 February into 1 March; this clamps it to 28 February instead, as
 * sectxt's relativedelta(years=1) does.
 */
export function oneCalendarYearAfter(instant) {
  const next = new Date(instant.getTime())
  next.setUTCFullYear(instant.getUTCFullYear() + 1)
  if (next.getUTCMonth() !== instant.getUTCMonth()) {
    next.setUTCDate(0)
  }
  return next
}

/** Every field value whose web URI uses "http://" instead of "https://". */
function httpWebUris(body, names) {
  return names.flatMap((name) => fieldValues(body, name).filter((value) => HTTP_WEB_URI.test(value)).map((value) => `${name}: ${value}`))
}

// The IANA Character Sets registry names UTF-8 "UTF-8" with the alias "csUTF8";
// sectxt accepts both. Compared lowercased.
const UTF8_CHARSET_NAMES = ['utf-8', 'csutf8']

/**
 * Pure validation function: (Content-Type header value or null) -> findings[].
 *
 * RFC 9116 §3 requires the media type "text/plain" and the charset "utf-8".
 * An absent charset parameter passes: utf-8 is the default the RFC names, and
 * sectxt reads it the same way. Media type and parameter names compare
 * case-insensitively (RFC 2045 §5.1), and so do charset names (RFC 2046 §4.1.2).
 */
export function validateSecurityTxtContentType(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return [emit(R, 'security-txt-content-type', 'the response sent no Content-Type header (RFC 9116 §3 requires "text/plain" with charset "utf-8")')]
  }
  const [mediaType, ...parameters] = value.split(';')
  const problems = []
  if (mediaType.trim().toLowerCase() !== 'text/plain') {
    problems.push(`media type ${JSON.stringify(mediaType.trim())} is not "text/plain"`)
  }
  const charsets = parameters.map((parameter) => parameter.split('=')).filter(([name]) => name.trim().toLowerCase() === 'charset').map(([, charset = '']) =>
    charset.trim().replace(/^"(.*)"$/, '$1')
  )
  const badCharsets = charsets.filter((charset) => !UTF8_CHARSET_NAMES.includes(charset.toLowerCase()))
  if (badCharsets.length > 0) {
    problems.push(`charset ${badCharsets.map((charset) => JSON.stringify(charset)).join(', ')} is not "utf-8"`)
  }
  if (problems.length === 0) {
    return []
  }
  return [emit(R, 'security-txt-content-type', `Content-Type "${value}": ${problems.join('; ')} (RFC 9116 §3)`)]
}

/**
 * Pure validation function: (security.txt body) -> findings[]. Testable without network.
 *
 * Every field is checked independently. An earlier revision returned early
 * after a missing or unparseable Expires, which silently skipped the Contact
 * check for exactly the bodies most likely to be broken; the field groups
 * below now accumulate into one findings list instead.
 */
export function validateSecurityTxt(
  body,
  now = new Date(),
  minDaysRemaining = R['security-txt-expiring-soon'].params.minDaysRemaining,
  canonicalUrl = SECURITY_TXT_URL
) {
  const findings = []

  const expiresValues = fieldValues(body, 'Expires')
  if (expiresValues.length === 0) {
    findings.push(emit(R, 'security-txt-expires-missing', 'no "Expires:" field found (required by RFC 9116 §2.5.5)'))
  } else {
    if (expiresValues.length > 1) {
      findings.push(
        emit(R, 'security-txt-expires-duplicate',
          `"Expires:" appears ${expiresValues.length} times (RFC 9116 §2.5.5 permits at most one): ${expiresValues.join(' | ')}`)
      )
    }

    const expiresRaw = expiresValues[0]
    const grammatical = isRfc3339DateTime(expiresRaw)
    // Date refuses a leap second (time-second 60), which RFC 3339 allows. Read
    // it as second 59, one second early, rather than call it unparseable.
    const leapSecond = grammatical && expiresRaw.slice(17, 19) === '60'
    const expires = new Date(leapSecond ? `${expiresRaw.slice(0, 17)}59${expiresRaw.slice(19)}` : expiresRaw)
    if (Number.isNaN(expires.getTime())) {
      findings.push(emit(R, 'security-txt-expires-unparseable', `"Expires: ${expiresRaw}" is not a parseable date (RFC 9116 requires ISO 8601 / RFC 3339)`))
    } else if (!grammatical) {
      // Date parses more than RFC 3339. A value outside the grammar may lack an
      // offset, and Date reads some such values in the runner's local time
      // zone; Date also rolls an impossible date forward. An age computed from
      // it is not trustworthy, so the age checks below are skipped. This
      // finding fails the check on its own.
      findings.push(
        emit(R, 'security-txt-expires-format',
          `"Expires: ${expiresRaw}" is not an RFC 3339 date-time (RFC 9116 §2.5.5, ABNF expires-field = "Expires" fs SP date-time)`)
      )
    } else {
      const daysRemaining = (expires.getTime() - now.getTime()) / 86_400_000
      const yearAhead = oneCalendarYearAfter(now)
      if (daysRemaining < 0) {
        findings.push(emit(R, 'security-txt-expired', `Expires (${expires.toISOString()}) is in the PAST -- security.txt has expired`))
      } else if (daysRemaining < minDaysRemaining) {
        findings.push(
          emit(R, 'security-txt-expiring-soon',
            `Expires (${expires.toISOString()}) is only ${daysRemaining.toFixed(1)} days out, ` + `below the ${minDaysRemaining}-day floor`)
        )
      } else if (expires.getTime() > yearAhead.getTime()) {
        findings.push(
          emit(R, 'security-txt-expires-over-a-year',
            `Expires (${expires.toISOString()}) is later than ${yearAhead.toISOString()}, one year after the evaluation instant ` +
              '(RFC 9116 §2.5.5 RECOMMENDS less than a year)')
        )
      }
    }
  }

  const contactValues = fieldValues(body, 'Contact')
  if (contactValues.length === 0) {
    findings.push(emit(R, 'security-txt-contact-missing', 'no "Contact:" field found (required by RFC 9116 §2.5.3)'))
  }
  const notUris = contactValues.filter((value) => !URI_WITH_SCHEME.test(value))
  if (notUris.length > 0) {
    findings.push(
      emit(R, 'security-txt-contact-not-uri', `"Contact:" value(s) ${
        notUris.map((value) => JSON.stringify(value)).join(', ')
      } are not URIs with a scheme ` + '(RFC 9116 §2.5.3: use "mailto:" for an email address and "tel:" for a phone number)')
    )
  }

  const insecure = httpWebUris(body, RFC9116_WEB_URI_FIELDS)
  if (insecure.length > 0) {
    findings.push(emit(R, 'security-txt-web-uri-not-https', `web URI(s) not beginning with "https://" (RFC 9116 §2.5): ${insecure.join(' | ')}`))
  }
  const insecureCsaf = httpWebUris(body, ['CSAF'])
  if (insecureCsaf.length > 0) {
    findings.push(emit(R, 'security-txt-csaf-not-https', `CSAF web URI(s) not beginning with "https://": ${insecureCsaf.join(' | ')}`))
  }

  const badBugBounty = fieldValues(body, 'Bug-Bounty').filter((value) => !BUG_BOUNTY_VALUES.includes(value))
  if (badBugBounty.length > 0) {
    findings.push(
      emit(R, 'security-txt-bug-bounty-value', `"Bug-Bounty:" value(s) ${
        badBugBounty.map((value) => JSON.stringify(value)).join(', ')
      } are not "True" or "False" ` + '(IANA security.txt Fields registry)')
    )
  }

  // §2.5.2 permits several Canonical fields; the requirement it attaches trust
  // to is that the retrieval URI appears among them, not that there is exactly
  // one. Canonical itself stays optional (§2.5: "all fields MUST be considered
  // optional"), so its absence is a warn, not a fail.
  const canonicalValues = fieldValues(body, 'Canonical')
  if (canonicalValues.length === 0) {
    findings.push(emit(R, 'security-txt-canonical-missing', `no "Canonical:" field found -- ${canonicalUrl} is unlisted (RFC 9116 §2.5.2)`))
  } else if (!canonicalValues.includes(canonicalUrl)) {
    findings.push(
      emit(R, 'security-txt-canonical-mismatch',
        `the retrieval URI ${canonicalUrl} is listed in no "Canonical:" field (found: ${canonicalValues.join(' | ')}) -- ` +
          'RFC 9116 §2.5.2 says such a file SHOULD NOT be trusted')
    )
  }

  // Preferred-Languages is optional. Format is checked only when it is present.
  const languageValues = fieldValues(body, 'Preferred-Languages')
  if (languageValues.length > 1) {
    findings.push(
      emit(R, 'security-txt-preferred-languages-duplicate',
        `"Preferred-Languages:" appears ${languageValues.length} times (RFC 9116 §2.5.8 permits at most one): ${languageValues.join(' | ')}`)
    )
  }
  if (languageValues.length > 0) {
    const malformed = languageValues[0].split(',').map((tag) => tag.trim()).filter((tag) => !LANGUAGE_TAG.test(tag))
    if (malformed.length > 0) {
      findings.push(
        emit(R, 'security-txt-preferred-languages-malformed',
          `"Preferred-Languages: ${languageValues[0]}" is not a comma-separated list of RFC 5646 language tags ` +
            `(RFC 9116 §2.5.8); offending value(s): ${malformed.map((tag) => JSON.stringify(tag)).join(', ')}`)
      )
    }
  }

  return findings
}

// Stryker disable all -- main() is network-path plumbing (fetchStable, process.exit)
// with no test coverage; Stryker targets only the pure validators above
// (decisions/0011, UD1: the mutation gate scopes to the three pure pilot functions).
async function main() {
  // The measurement channel (atlas decision 0122). One artifact: security.txt. A
  // fetch that never held bytes publishes 0, so the monthly tier's dead-man reports
  // the wedge rather than pinging a green tile off a swallowed `continue-on-error`.
  let body
  let contentType
  try {
    const res = await fetchStable(SECURITY_TXT_URL)
    if (!res.ok) {
      process.exit(report('check-security-txt', [emit(R, 'security-txt-fetch', `HTTP ${res.status} fetching ${SECURITY_TXT_URL}`)], 0))
    }
    contentType = res.headers.get('content-type')
    body = await res.text()
  } catch (err) {
    process.exit(report('check-security-txt', [emit(R, 'security-txt-fetch', `fetch failed: ${err.message}`)], 0))
  }

  process.exit(report('check-security-txt', [...validateSecurityTxtContentType(contentType), ...validateSecurityTxt(body)], 1))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
