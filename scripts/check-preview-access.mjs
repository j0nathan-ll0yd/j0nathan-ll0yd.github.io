#!/usr/bin/env node
/* Checks that Cloudflare Access guards a Worker Version URL (atlas decision 0160 D1; plan Step 3.5).
 *
 * Pass, for each URL given:
 *   1. an anonymous GET does not answer 200 (Access answers 401 or 403 under strict service-token
 *      authentication, or redirects to its login page);
 *   2. a GET with the CI service token (CF-Access-Client-Id, CF-Access-Client-Secret) answers 200
 *      and carries the Worker's platform marker, X-Site-Runtime: workers.
 *
 * A transport failure is a failure, never a pass: a check that reaches nothing measured nothing.
 * The self-hosted runners resolve an egress allowlist by hostname, and `*.workers.dev` is not on it
 * at the time of writing, so "unreachable" names that cause.
 *
 * Usage: CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... node scripts/check-preview-access.mjs <url>...
 * Exit 0 when every URL passes, 1 otherwise. */
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

/** @returns {Promise<string[]>} the failures for one URL; empty when it passes. */
export async function checkPreviewAccess(url, credentials, fetchOne = get) {
  const failures = []
  const anonymous = await fetchOne(url, {})
  if (anonymous.error) {
    failures.push(`unreachable anonymously (${anonymous.error}); the runner egress allowlist may not cover ${new URL(url).hostname}`)
  } else if (anonymous.response.status === 200) {
    failures.push('an anonymous GET answered 200: Access does not protect this Version URL')
  }

  const authorized = await fetchOne(url, {'CF-Access-Client-Id': credentials.id, 'CF-Access-Client-Secret': credentials.secret})
  if (authorized.error) {
    failures.push(`unreachable with the service token (${authorized.error})`)
  } else if (authorized.response.status !== 200) {
    failures.push(`a GET with the service token answered ${authorized.response.status}, not 200`)
  } else if (authorized.response.headers.get(SITE_RUNTIME_HEADER) !== SITE_RUNTIME) {
    failures.push(`the 200 carries ${SITE_RUNTIME_HEADER}: ${JSON.stringify(authorized.response.headers.get(SITE_RUNTIME_HEADER))}, not the Worker marker`)
  }
  return failures
}

async function main() {
  const urls = process.argv.slice(2)
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (urls.length === 0 || !id || !secret) {
    console.error('check-preview-access: pass one or more URLs, and set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET')
    process.exit(2)
  }
  let failed = false
  for (const url of urls) {
    const failures = await checkPreviewAccess(url, {id, secret})
    console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} ${url}`)
    for (const failure of failures) {
      console.log(`  ${failure}`)
    }
    failed ||= failures.length > 0
  }
  process.exit(failed ? 1 : 0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
