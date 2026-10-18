#!/usr/bin/env node
// audits/checks/b7-check-headers.mjs -- B7. Security headers/TLS: diffs the live
// CSP against a committed golden (drift guard for src/lib/edge/security-headers.ts),
// asserts the Trusted Types report-only header is present, checks
// certificate expiry via a raw node:tls connection (no new dependency), and
// asserts every plain-HTTP request is redirected to HTTPS before any content.

import tls from 'node:tls'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {DEFAULT_BUDGET_MS, fetchStable, isMain, report} from '../lib/http.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_CSP_PATH = path.join(__dirname, '..', 'fixtures', 'golden', 'csp.txt')
const MIN_CERT_DAYS_REMAINING = 30
const TLS_TIMEOUT_MS = 10_000

const REQUIRED_TRUSTED_TYPES_DIRECTIVE = "require-trusted-types-for 'script'"

// The HTTPS-redirect arm. Cloudflare Pages redirected plain HTTP to HTTPS as a platform
// guarantee; the Workers cutover (atlas decision 0160 PR A, 2026-10-14) retired it, and
// http://jonathanlloyd.me/ then answered 200 with the live composed page. HSTS cannot cover
// that first visit: a browser ignores HSTS received over plain HTTP (RFC 6797 section 8.1).
// The seam is the zone's HTTPS enforcement in front of the Worker route, so every probe
// asks the zone over port 80 and never follows the redirect.
const REDIRECT_STATUSES = new Set([301, 308])
// A redirect notice is a few hundred bytes at most: the www redirect body measured 162 bytes
// (2026-10-18). A body larger than this is a page, not a redirect notice.
const REDIRECT_BODY_MAX_BYTES = 1024
const SSR_DATA_HEADER = 'x-ssr-data'
const SITE_HOST = new URL(SITE_URL).hostname
// www.jonathanlloyd.me resolves (Cloudflare-proxied, 2026-10-18), so it is covered. It may
// redirect to its own https origin or straight to the apex; both keep path and query.
const WWW_HOST = `www.${SITE_HOST}`
// The probe paths: the root (the live composed page), a gated proxy route, and a deep page
// with a query that the redirect must keep.
const REDIRECT_PROBE_PATHS = ['/', '/llms.txt', '/privacy?b7=1']

/** The probes: `{url, allowed}`, where `allowed` lists the exact acceptable Location values. */
export function httpsRedirectProbes() {
  const probes = []
  for (const host of [SITE_HOST, WWW_HOST]) {
    for (const pathAndQuery of REDIRECT_PROBE_PATHS) {
      const allowed = [`https://${host}${pathAndQuery}`]
      if (host === WWW_HOST) {
        allowed.push(`https://${SITE_HOST}${pathAndQuery}`)
      }
      probes.push({url: `http://${host}${pathAndQuery}`, allowed})
    }
  }
  return probes
}

// A18 coverage declaration (atlas decision 0145). Empty is a claim, not a gap. What this
// runner holds is the homepage response headers, the TLS peer certificate, and the zone's
// plain-HTTP redirect answers. None is a registered estate surface: the /llms.txt probe
// holds the redirect, never the artifact bytes. The site-plane cache headers that DO belong
// to llm-outputs are judged by b2-llms.mjs, per artifact, not here. Metadata only -- the
// hub reads it statically.
export const ARTIFACTS = []

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
      message: 'live CSP differs from audits/fixtures/golden/csp.txt (either src/lib/edge/security-headers.ts changed ' +
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

/**
 * Pure judgment of one plain-HTTP answer: `(probe, {status, location, ssrData, bodyBytes})`
 * -> findings[]. Every failure names the probe URL and the status it answered.
 */
export function judgeHttpsRedirect(probe, response) {
  const findings = []
  const {url, allowed} = probe
  const {status, location, ssrData, bodyBytes} = response
  if (!REDIRECT_STATUSES.has(status)) {
    findings.push({
      severity: 'fail',
      id: 'headers-http-not-redirected',
      message: `${url} answered HTTP ${status} over plain HTTP; expected 301 or 308 to ${allowed.join(' or ')}`
    })
  } else if (!allowed.includes(location ?? '')) {
    findings.push({
      severity: 'fail',
      id: 'headers-http-redirect-location',
      message: `${url} answered HTTP ${status} with Location ${location ? `"${location}"` : '(none)'}; ` +
        `expected exactly ${allowed.join(' or ')} (https, path and query kept)`
    })
  }
  if (ssrData !== null && ssrData !== undefined) {
    findings.push({
      severity: 'fail',
      id: 'headers-http-ssr-data',
      message: `${url} answered HTTP ${status} over plain HTTP with X-SSR-Data: ${ssrData}; the Worker rendered the page in plaintext`
    })
  }
  if (bodyBytes > REDIRECT_BODY_MAX_BYTES) {
    findings.push({
      severity: 'fail',
      id: 'headers-http-body',
      message: `${url} answered HTTP ${status} over plain HTTP with a ${bodyBytes}-byte body ` +
        `(limit ${REDIRECT_BODY_MAX_BYTES}); content was served before any redirect`
    })
  }
  return findings
}

/**
 * Runs every HTTPS-redirect probe and returns `{measured, findings}`. One GET per probe,
 * redirects NOT followed. `measured` counts the probes whose status and headers were held
 * and judged; a network failure before an answer adds a finding and no count, because a probe that reached nothing
 * proved nothing about the redirect (atlas decision 0122).
 */
export async function runHttpsRedirectArm({fetchImpl = fetchStable, probes = httpsRedirectProbes()} = {}) {
  const findings = []
  let measured = 0
  for (const probe of probes) {
    let res
    try {
      res = await fetchImpl(probe.url, {redirect: 'manual'}, DEFAULT_BUDGET_MS)
    } catch (err) {
      findings.push({
        severity: 'fail',
        id: 'headers-http-unmeasured',
        message: `UNMEASURED: GET ${probe.url} failed before an answer (${err.message}); the redirect is unproven, not passed`
      })
      continue
    }
    // The status and headers are held from here, so the probe is measured even if the body
    // breaks: they alone prove or disprove the redirect.
    measured++
    let bodyBytes = 0
    try {
      bodyBytes = (await res.arrayBuffer()).byteLength
    } catch (err) {
      findings.push({
        severity: 'warn',
        id: 'headers-http-body-unreadable',
        message: `${probe.url} answered HTTP ${res.status} but its body could not be read (${err.message}); the body size is unjudged`
      })
    }
    findings.push(
      ...judgeHttpsRedirect(probe, {status: res.status, location: res.headers.get('location'), ssrData: res.headers.get(SSR_DATA_HEADER), bodyBytes})
    )
  }
  return {measured, findings}
}

/**
 * Connects via TLS, reads the peer certificate's expiry, and returns
 * `{measured, findings}`.
 *
 * `measured` is 1 only when a certificate was actually READ -- a refused connection,
 * a timeout, or an unreadable peer certificate all mean this probe never held the
 * bytes it judges, which is darkness rather than a finding about the certificate.
 * The distinction is the whole measurement channel (atlas decision 0122).
 */
function checkCertExpiry(host, minDaysRemaining = MIN_CERT_DAYS_REMAINING) {
  return new Promise((resolve) => {
    const findings = []
    const socket = tls.connect({host, port: 443, servername: host, timeout: TLS_TIMEOUT_MS}, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert || !cert.valid_to) {
        findings.push({severity: 'fail', id: 'headers-cert-unreadable', message: `could not read a peer certificate for ${host}`})
        resolve({measured: 0, findings})
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
      resolve({measured: 1, findings})
    })
    socket.on('error', (err) => {
      findings.push({severity: 'fail', id: 'headers-cert-connect-failed', message: `TLS connection to ${host}:443 failed: ${err.message}`})
      resolve({measured: 0, findings})
    })
    socket.on('timeout', () => {
      findings.push({severity: 'fail', id: 'headers-cert-connect-timeout', message: `TLS connection to ${host}:443 timed out after ${TLS_TIMEOUT_MS}ms`})
      socket.destroy()
      resolve({measured: 0, findings})
    })
  })
}

async function main() {
  const findings = []
  const goldenCsp = readFileSync(GOLDEN_CSP_PATH, 'utf-8')
  // Independent transports, counted independently: the HTTPS response whose headers
  // carry the CSP, the raw TLS handshake that carries the certificate, and one plain-HTTP
  // answer per redirect probe. Losing one is a finding; losing all is darkness, and only
  // the latter publishes 0.
  let measured = 0

  try {
    const res = await fetchStable(SITE_URL)
    if (!res.ok) {
      findings.push({severity: 'fail', id: 'headers-fetch', message: `HTTP ${res.status} fetching ${SITE_URL}`})
    } else {
      measured++
      findings.push(...validateHeaders(res.headers, goldenCsp))
    }
  } catch (err) {
    findings.push({severity: 'fail', id: 'headers-fetch', message: `fetch failed: ${err.message}`})
  }

  const host = new URL(SITE_URL).hostname
  const cert = await checkCertExpiry(host)
  measured += cert.measured
  findings.push(...cert.findings)

  const redirect = await runHttpsRedirectArm()
  measured += redirect.measured
  findings.push(...redirect.findings)

  process.exit(report('check-headers', findings, measured))
}

if (isMain(import.meta.url)) {
  main()
}
