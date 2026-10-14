#!/usr/bin/env node
/* Checks that Cloudflare Access guards a Worker Version URL (atlas decision 0160 D1; plan Step 3.5).
 *
 * Pass, for each URL given:
 *   1. an anonymous GET does not answer 200 (Access answers 401 or 403 under strict service-token
 *      authentication, or redirects to its login page);
 *   2. a GET with the CI service token (CF-Access-Client-Id, CF-Access-Client-Secret) answers 200
 *      and carries the Worker's platform marker, X-Site-Runtime: workers.
 *
 * Three verdicts per URL, never a silent pass:
 *   - FAIL: the host answered wrongly (an anonymous 200, a tokened non-200, no Worker marker).
 *     A wrong answer fails even when another request in the check could not connect.
 *   - UNMEASURED: no wrong answer, but a request never got one (a transport error: connection
 *     refused or reset, DNS failure, timeout). It names the host, its addresses and the error code.
 *     The self-hosted runners' egress stays closed to `*.workers.dev` by owner decision
 *     (decision 0160, 2026-10-14), so CI meets this on every PR; the tokened checks run locally.
 *   - PASS: both requests answered as required.
 *
 * Usage: CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node scripts/check-preview-access.mjs [--unmeasured-ok] <url>...
 * Exit 0 when every URL passes; 1 when any fails; 3 when none fails but any is unmeasured, or 0 with
 * --unmeasured-ok (CI), which then prints a ::warning and, under GitHub Actions, writes the verdict to
 * the step summary and `outcome=pass|unmeasured|fail` to GITHUB_OUTPUT. */
import {appendFileSync} from 'node:fs'
import {lookup} from 'node:dns/promises'
import {SITE_RUNTIME, SITE_RUNTIME_HEADER} from '../src/lib/edge/security-headers.ts'

const TIMEOUT_MS = 15_000

/**
 * A transport error with its cause (undici puts the socket or DNS error there) and the addresses the
 * host resolves to, so an egress refusal names the host, the address and the error.
 */
export async function describeTransportError(url, error, resolve = (host) => lookup(host, {all: true})) {
  const parts = [error instanceof Error ? `${error.name}: ${error.message}` : String(error)]
  const cause = error instanceof Error ? error.cause : undefined
  if (cause && typeof cause === 'object') {
    const fields = ['code', 'syscall', 'address', 'port'].filter((key) => cause[key] !== undefined).map((key) => `${key}=${cause[key]}`)
    parts.push(`cause: ${cause.message ?? ''}${fields.length > 0 ? ` (${fields.join(', ')})` : ''}`.trim())
  }
  const host = new URL(url).hostname
  try {
    const addresses = await resolve(host)
    parts.push(`${host} resolves to ${addresses.map((entry) => entry.address).join(', ') || 'nothing'}`)
  } catch (dnsError) {
    parts.push(`${host} does not resolve (${dnsError instanceof Error ? dnsError.message : String(dnsError)})`)
  }
  return parts.join('; ')
}

/** One GET, without following redirects. Returns the response, or the transport error. */
async function get(url, headers) {
  try {
    return {response: await fetch(url, {headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS)})}
  } catch (error) {
    return {error: await describeTransportError(url, error)}
  }
}

/**
 * @returns {Promise<{verdict: 'pass' | 'fail' | 'unmeasured', failures: string[], unmeasured: string[]}>}
 */
export async function checkPreviewAccess(url, credentials, fetchOne = get) {
  const failures = []
  const unmeasured = []
  const host = new URL(url).hostname
  const anonymous = await fetchOne(url, {})
  if (anonymous.error) {
    unmeasured.push(`no answer to the anonymous GET from ${host} (${anonymous.error})`)
  } else if (anonymous.response.status === 200) {
    failures.push('an anonymous GET answered 200: Access does not protect this Version URL')
  }

  const authorized = await fetchOne(url, {'CF-Access-Client-Id': credentials.id, 'CF-Access-Client-Secret': credentials.secret})
  if (authorized.error) {
    unmeasured.push(`no answer to the service-token GET from ${host} (${authorized.error})`)
  } else if (authorized.response.status !== 200) {
    failures.push(`a GET with the service token answered ${authorized.response.status}, not 200`)
  } else if (authorized.response.headers.get(SITE_RUNTIME_HEADER) !== SITE_RUNTIME) {
    failures.push(`the 200 carries ${SITE_RUNTIME_HEADER}: ${JSON.stringify(authorized.response.headers.get(SITE_RUNTIME_HEADER))}, not the Worker marker`)
  }
  const verdict = failures.length > 0 ? 'fail' : unmeasured.length > 0 ? 'unmeasured' : 'pass'
  return {verdict, failures, unmeasured}
}

/** The run's verdict over every URL: any fail fails; otherwise any unmeasured is unmeasured. */
export function overallVerdict(verdicts) {
  return verdicts.includes('fail') ? 'fail' : verdicts.includes('unmeasured') ? 'unmeasured' : 'pass'
}

async function main() {
  const args = process.argv.slice(2)
  const unmeasuredOk = args.includes('--unmeasured-ok')
  const urls = args.filter((arg) => arg !== '--unmeasured-ok')
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (urls.length === 0 || !id || !secret) {
    console.error('check-preview-access: pass one or more URLs, and set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET')
    process.exit(2)
  }
  const lines = []
  const verdicts = []
  for (const url of urls) {
    const result = await checkPreviewAccess(url, {id, secret})
    verdicts.push(result.verdict)
    lines.push(`${result.verdict.toUpperCase()} ${url}`, ...result.failures.map((line) => `  ${line}`), ...result.unmeasured.map((line) =>
      `  UNMEASURED: ${line}`
    ))
  }
  const verdict = overallVerdict(verdicts)
  console.log(lines.join('\n'))
  if (verdict === 'unmeasured') {
    console.log(
      `::warning title=Preview Access check UNMEASURED::${lines.filter((line) => line.includes('UNMEASURED:')).map((line) => line.trim()).join(' | ')}`
    )
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Preview Access check: ${verdict.toUpperCase()}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${verdict}\n`)
  }
  process.exit(verdict === 'pass' ? 0 : verdict === 'fail' ? 1 : unmeasuredOk ? 0 : 3)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
