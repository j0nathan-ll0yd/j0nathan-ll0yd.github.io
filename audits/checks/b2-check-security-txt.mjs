#!/usr/bin/env node
// audits/checks/b2-check-security-txt.mjs -- B2. RFC 9116 security.txt. The spec
// this validator derives from lives in specs/security-txt/*.rule.json, not in
// this comment (decisions/0011) -- see that directory for the RFC 9116
// clauses, severities, thresholds, and case inputs each finding id derives
// from. The live file (public/.well-known/security.txt) is currently a
// static, unguarded `Expires: 2027-06-18T00:00:00.000Z` -- this is the exact
// standing gap security-txt-expiring-soon exists to eventually catch (§7
// finding #4 of the monorepo audit plan).

import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain, report} from '../lib/http.mjs'
import {emit, rules} from '../specs/load.mjs'

// The URI this file is served from. Also the value RFC 9116 §2.5.2 expects a
// Canonical field to list, so the pure validator reads it as the default
// `canonicalUrl` operand -- it is no longer main()-only plumbing.
export const SECURITY_TXT_URL = `${SITE_URL}/.well-known/security.txt`
const R = rules('security-txt')

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

/**
 * Pure validation function: (security.txt body) -> findings[]. Testable without network.
 *
 * Every field is checked independently. An earlier revision returned early
 * after a missing or unparseable Expires, which silently skipped the Contact
 * check for exactly the bodies most likely to be broken; the four field groups
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
    const expires = new Date(expiresRaw)
    if (Number.isNaN(expires.getTime())) {
      findings.push(emit(R, 'security-txt-expires-unparseable', `"Expires: ${expiresRaw}" is not a parseable date (RFC 9116 requires ISO 8601 / RFC 3339)`))
    } else {
      const daysRemaining = (expires.getTime() - now.getTime()) / 86_400_000
      if (daysRemaining < 0) {
        findings.push(emit(R, 'security-txt-expired', `Expires (${expires.toISOString()}) is in the PAST -- security.txt has expired`))
      } else if (daysRemaining < minDaysRemaining) {
        findings.push(
          emit(R, 'security-txt-expiring-soon',
            `Expires (${expires.toISOString()}) is only ${daysRemaining.toFixed(1)} days out, ` + `below the ${minDaysRemaining}-day warn threshold`)
        )
      }
    }
  }

  if (fieldValues(body, 'Contact').length === 0) {
    findings.push(emit(R, 'security-txt-contact-missing', 'no "Contact:" field found (required by RFC 9116 §2.5.3)'))
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
// with no test coverage; Stryker targets only the pure validateSecurityTxt above
// (decisions/0011, UD1: the mutation gate scopes to the three pure pilot functions).
async function main() {
  let body
  try {
    const res = await fetchStable(SECURITY_TXT_URL)
    if (!res.ok) {
      process.exit(report('check-security-txt', [emit(R, 'security-txt-fetch', `HTTP ${res.status} fetching ${SECURITY_TXT_URL}`)]))
    }
    body = await res.text()
  } catch (err) {
    process.exit(report('check-security-txt', [emit(R, 'security-txt-fetch', `fetch failed: ${err.message}`)]))
  }

  process.exit(report('check-security-txt', validateSecurityTxt(body)))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
