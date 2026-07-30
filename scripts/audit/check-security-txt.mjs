#!/usr/bin/env node
// scripts/audit/check-security-txt.mjs -- B2. RFC 9116 security.txt. The spec
// this validator derives from lives in specs/security-txt/*.rule.json, not in
// this comment (decisions/0011) -- see that directory for the RFC 9116
// clauses, severities, thresholds, and case inputs each finding id derives
// from. The live file (public/.well-known/security.txt) is currently a
// static, unguarded `Expires: 2027-06-18T00:00:00.000Z` -- this is the exact
// standing gap security-txt-expiring-soon exists to eventually catch (§7
// finding #4 of the monorepo audit plan).

import {SITE_URL} from '@lifegames/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'
import {emit, rules} from './specs/load.mjs'

// Stryker disable all -- fetch-target URL, read only by main() (network-path
// plumbing with no test coverage), never by the pure validator.
const SECURITY_TXT_URL = `${SITE_URL}/.well-known/security.txt`
// Stryker restore all
const R = rules('security-txt')

/** Pure validation function: (security.txt body) -> findings[]. Testable without network. */
export function validateSecurityTxt(body, now = new Date(), minDaysRemaining = R['security-txt-expiring-soon'].params.minDaysRemaining) {
  const findings = []

  const match = /^Expires:\s*(.+)$/im.exec(body)
  if (!match) {
    findings.push(emit(R, 'security-txt-expires-missing', 'no "Expires:" field found (required by RFC 9116 §2.5.5)'))
    return findings
  }

  const expiresRaw = match[1].trim()
  const expires = new Date(expiresRaw)
  if (Number.isNaN(expires.getTime())) {
    findings.push(emit(R, 'security-txt-expires-unparseable', `"Expires: ${expiresRaw}" is not a parseable date (RFC 9116 requires ISO 8601 / RFC 3339)`))
    return findings
  }

  const daysRemaining = (expires.getTime() - now.getTime()) / 86_400_000
  if (daysRemaining < 0) {
    findings.push(emit(R, 'security-txt-expired', `Expires (${expires.toISOString()}) is in the PAST -- security.txt has expired`))
  } else if (daysRemaining < minDaysRemaining) {
    findings.push(
      emit(R, 'security-txt-expiring-soon',
        `Expires (${expires.toISOString()}) is only ${daysRemaining.toFixed(1)} days out, ` + `below the ${minDaysRemaining}-day warn threshold`)
    )
  }

  if (!/^Contact:\s*\S/im.test(body)) {
    findings.push(emit(R, 'security-txt-contact-missing', 'no "Contact:" field found (required by RFC 9116 §2.5.1)'))
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
