#!/usr/bin/env node
// scripts/audit/check-headers.mjs -- B7. Security headers/TLS: diffs the live
// CSP against a committed golden (drift guard for functions/_middleware.ts),
// asserts the Trusted Types report-only header is present, and checks
// certificate expiry via a raw node:tls connection (no new dependency).

import tls from 'node:tls'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_CSP_PATH = path.join(__dirname, '..', '..', 'tests', 'audit', 'golden', 'csp.txt')
const MIN_CERT_DAYS_REMAINING = 30
const TLS_TIMEOUT_MS = 10_000

const REQUIRED_TRUSTED_TYPES_DIRECTIVE = "require-trusted-types-for 'script'"

/** Pure validation function: (live headers) -> findings[]. Testable without network. */
export function validateHeaders(headers, goldenCsp) {
  const findings = []

  const liveCsp = (headers.get('content-security-policy') || '').trim()
  const expectedCsp = goldenCsp.trim()
  if (!liveCsp) {
    findings.push({severity: 'fail', id: 'headers-csp-missing', message: 'no Content-Security-Policy header on the live response'})
  } else if (liveCsp !== expectedCsp) {
    findings.push({
      severity: 'fail',
      id: 'headers-csp-drift',
      message: 'live CSP differs from tests/audit/golden/csp.txt (either functions/_middleware.ts changed ' +
        'and the golden needs updating, or this is an unintended drift):\n' +
        `    live:     ${liveCsp}\n    expected: ${expectedCsp}`
    })
  }

  const reportOnly = headers.get('content-security-policy-report-only') || ''
  if (!reportOnly.includes(REQUIRED_TRUSTED_TYPES_DIRECTIVE)) {
    findings.push({
      severity: 'fail',
      id: 'headers-trusted-types-missing',
      message: `Content-Security-Policy-Report-Only does not contain "${REQUIRED_TRUSTED_TYPES_DIRECTIVE}"`
    })
  }

  return findings
}

/** Connects via TLS, reads the peer certificate's expiry, and returns findings. */
function checkCertExpiry(host, minDaysRemaining = MIN_CERT_DAYS_REMAINING) {
  return new Promise((resolve) => {
    const findings = []
    const socket = tls.connect({host, port: 443, servername: host, timeout: TLS_TIMEOUT_MS}, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert || !cert.valid_to) {
        findings.push({severity: 'fail', id: 'headers-cert-unreadable', message: `could not read a peer certificate for ${host}`})
        resolve(findings)
        return
      }
      const validTo = new Date(cert.valid_to)
      const daysRemaining = (validTo.getTime() - Date.now()) / 86_400_000
      if (daysRemaining < 0) {
        findings.push({severity: 'fail', id: 'headers-cert-expired', message: `TLS certificate for ${host} expired on ${cert.valid_to}`})
      } else if (daysRemaining < minDaysRemaining) {
        findings.push({
          severity: 'fail',
          id: 'headers-cert-expiring-soon',
          message: `TLS certificate for ${host} expires in ${daysRemaining.toFixed(1)} days (${cert.valid_to}), ` +
            `below the ${minDaysRemaining}-day warn threshold`
        })
      }
      resolve(findings)
    })
    socket.on('error', (err) => {
      findings.push({severity: 'fail', id: 'headers-cert-connect-failed', message: `TLS connection to ${host}:443 failed: ${err.message}`})
      resolve(findings)
    })
    socket.on('timeout', () => {
      findings.push({severity: 'fail', id: 'headers-cert-connect-timeout', message: `TLS connection to ${host}:443 timed out after ${TLS_TIMEOUT_MS}ms`})
      socket.destroy()
      resolve(findings)
    })
  })
}

async function main() {
  const findings = []
  const goldenCsp = readFileSync(GOLDEN_CSP_PATH, 'utf-8')

  try {
    const res = await fetchStable(SITE_URL)
    if (!res.ok) {
      findings.push({severity: 'fail', id: 'headers-fetch', message: `HTTP ${res.status} fetching ${SITE_URL}`})
    } else {
      findings.push(...validateHeaders(res.headers, goldenCsp))
    }
  } catch (err) {
    findings.push({severity: 'fail', id: 'headers-fetch', message: `fetch failed: ${err.message}`})
  }

  const host = new URL(SITE_URL).hostname
  findings.push(...(await checkCertExpiry(host)))

  process.exit(report('check-headers', findings))
}

if (isMain(import.meta.url)) {
  main()
}
