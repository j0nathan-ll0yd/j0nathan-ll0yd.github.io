#!/usr/bin/env node
// scripts/audit/check-security-txt.mjs -- B2. RFC 9116 security.txt: the
// `Expires` field must be parseable and at least MIN_DAYS_REMAINING days in
// the future. The live file (public/.well-known/security.txt) is currently a
// static, unguarded `Expires: 2027-06-18T00:00:00.000Z` -- this is the exact
// standing gap the check exists to eventually catch (§7 finding #4 of the
// monorepo audit plan).

import {SITE_URL} from '@lifegames/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'

const SECURITY_TXT_URL = `${SITE_URL}/.well-known/security.txt`
const MIN_DAYS_REMAINING = 30

/** Pure validation function: (security.txt body) -> findings[]. Testable without network. */
export function validateSecurityTxt(body, now = new Date(), minDaysRemaining = MIN_DAYS_REMAINING) {
  const findings = []

  const match = /^Expires:\s*(.+)$/im.exec(body)
  if (!match) {
    findings.push({severity: 'fail', id: 'security-txt-expires-missing', message: 'no "Expires:" field found (required by RFC 9116 §2.5.5)'})
    return findings
  }

  const expiresRaw = match[1].trim()
  const expires = new Date(expiresRaw)
  if (Number.isNaN(expires.getTime())) {
    findings.push({
      severity: 'fail',
      id: 'security-txt-expires-unparseable',
      message: `"Expires: ${expiresRaw}" is not a parseable date (RFC 9116 requires ISO 8601 / RFC 3339)`
    })
    return findings
  }

  const daysRemaining = (expires.getTime() - now.getTime()) / 86_400_000
  if (daysRemaining < 0) {
    findings.push({severity: 'fail', id: 'security-txt-expired', message: `Expires (${expires.toISOString()}) is in the PAST -- security.txt has expired`})
  } else if (daysRemaining < minDaysRemaining) {
    findings.push({
      severity: 'fail',
      id: 'security-txt-expiring-soon',
      message: `Expires (${expires.toISOString()}) is only ${daysRemaining.toFixed(1)} days out, ` + `below the ${minDaysRemaining}-day warn threshold`
    })
  }

  if (!/^Contact:\s*\S/im.test(body)) {
    findings.push({severity: 'warn', id: 'security-txt-contact-missing', message: 'no "Contact:" field found (required by RFC 9116 §2.5.1)'})
  }

  return findings
}

async function main() {
  let body
  try {
    const res = await fetchStable(SECURITY_TXT_URL)
    if (!res.ok) {
      process.exit(report('check-security-txt', [
        {severity: 'fail', id: 'security-txt-fetch', message: `HTTP ${res.status} fetching ${SECURITY_TXT_URL}`}
      ]))
    }
    body = await res.text()
  } catch (err) {
    process.exit(report('check-security-txt', [
      {severity: 'fail', id: 'security-txt-fetch', message: `fetch failed: ${err.message}`}
    ]))
  }

  process.exit(report('check-security-txt', validateSecurityTxt(body)))
}

if (isMain(import.meta.url)) {
  main()
}
