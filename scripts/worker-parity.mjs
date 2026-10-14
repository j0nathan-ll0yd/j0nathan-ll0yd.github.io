#!/usr/bin/env node
/* Step 3.6 parity by normalized invariants (atlas decision 0160, PR A).
 *
 * Sends the same request matrix to a baseline (production Pages, at its origin alias
 * https://human-datastream.pages.dev, which no zone rule touches) and to a candidate (a Worker
 * Version URL, or `wrangler dev`), then compares each pair:
 *
 * - status, and the redirect target for a 3xx;
 * - every header except transport headers (TRANSPORT_HEADERS), with the version marker as the one
 *   intended difference (X-Site-Runtime on the candidate only);
 * - the body: exact bytes for deterministic content, a normalized digest for dynamic content
 *   (the proxy documents carry a composition stamp; sitemap and service-worker revisions vary).
 *
 * Usage:
 *   node scripts/worker-parity.mjs --baseline https://human-datastream.pages.dev \
 *     --candidate https://<version>-human-datastream.<subdomain>.workers.dev \
 *     [--candidate-header 'CF-Access-Client-Id: ...'] [--json out.json]
 * Access credentials may come from CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET instead.
 *
 * A loopback candidate (`wrangler dev`, `astro preview`) answers the analytics routes with 404 by
 * design (src/lib/edge/routes.ts isLocalAnalyticsRequest), so compare those on a Version URL.
 *
 * Exit 0 when every case matches, 1 otherwise. Read-only on the baseline: GET, HEAD, OPTIONS,
 * a POST and a PUT that the baseline rejects (405 or 415), and one CSP report that only writes a
 * log line naming the probe. No request reaches
 * the Simple Analytics collector or the Web Analytics collector with a payload. */
import {createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {parseArgs} from 'node:util'

/** Headers that describe the transport or the edge, not the site. */
export const TRANSPORT_HEADERS = new Set([
  'date',
  'age',
  'cf-ray',
  'cf-cache-status',
  'server',
  'alt-svc',
  'nel',
  'report-to',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'etag',
  'last-modified',
  'accept-ranges'
])

/** Header name prefixes that describe an upstream, not the site. */
const TRANSPORT_PREFIXES = ['x-amz-', 'cf-']

/** Per-request upstream identifiers the proxy forwards: never equal across two requests. */
const PER_REQUEST_HEADERS = new Set(['x-proxy-upstream-request-id'])

/** The one intended difference (plan Step 3.1). */
export const INTENDED_CANDIDATE_HEADERS = new Map([['x-site-runtime', 'workers']])

/**
 * Headers a Workers 304 carries and a Pages 304 omitted. RFC 9110 section 15.4.5 requires a 304 to
 * send the Cache-Control a 200 would have sent; the Workers asset server sends it and the content
 * type, Pages sent neither. The static plane answers these without the Worker, so the site cannot
 * change them; they are a platform difference, reported as allowed, not as a match.
 */
export const ALLOWED_304_CANDIDATE_HEADERS = new Set(['cache-control', 'content-type'])

/** Hostnames of a local candidate, which answers the analytics routes with 404 by design. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const ANALYTICS_PATHS = ['/sa', '/cf-insights.js', '/cf-rum', '/simple']

const HTML = 'text/html'
const MARKDOWN = 'text/markdown'

/**
 * The request matrix: the Step 0.5 route table plus the deterministic files. `body` names the
 * comparison: 'exact' bytes, 'dynamic' (normalized digest, see normalizeBody), or 'none'.
 */
export const CASES = [
  // Pages, with both Accept variants. `/` negotiates Markdown; every other page never does.
  ...['/', '/privacy', '/offline', '/404'].flatMap((path) => [
    {path, method: 'GET', accept: HTML, body: 'exact'},
    {path, method: 'HEAD', accept: HTML, body: 'none'},
    {path, method: 'GET', accept: MARKDOWN, body: path === '/' ? 'dynamic' : 'exact'}
  ]),
  // trailingSlash 'never' and build.format 'file': the slash and .html forms redirect to /privacy.
  {path: '/privacy/', method: 'GET', accept: HTML, body: 'none'},
  {path: '/privacy.html', method: 'GET', accept: HTML, body: 'none'},
  // Unknown paths: the 404 page, under both Accept variants and on a code-free prefix.
  {path: '/no-such-page', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/no-such-page', method: 'GET', accept: MARKDOWN, body: 'exact'},
  {path: '/no-such-page', method: 'HEAD', accept: HTML, body: 'none'},
  {path: '/_astro/no-such-file.js', method: 'GET', accept: HTML, body: 'exact'},
  // An unknown path with a trailing slash, a malformed escape, and a slash after a file: Pages
  // answered each with the 404 page, never a redirect or a 400.
  {path: '/no-such-page/', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/no-such-page/', method: 'HEAD', accept: HTML, body: 'none'},
  {path: '/%2561bc', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/sw.js/', method: 'GET', accept: HTML, body: 'none'},
  // Revalidation: each side gets its own ETag back as If-None-Match and must answer 304.
  {path: '/', method: 'GET', accept: HTML, body: 'none', conditional: true},
  {path: '/privacy', method: 'GET', accept: HTML, body: 'none', conditional: true},
  {path: '/js/clock.js', method: 'GET', accept: HTML, body: 'none', conditional: true},
  {path: '/focus.json', method: 'GET', accept: HTML, body: 'exact'},
  // Methods the static-asset plane does not serve.
  {path: '/', method: 'POST', accept: HTML, body: 'none'},
  {path: '/', method: 'OPTIONS', accept: HTML, body: 'none'},
  {path: '/privacy', method: 'POST', accept: HTML, body: 'none'},
  {path: '/no-such-page', method: 'POST', accept: HTML, body: 'none'},
  // Static files.
  ...[
    '/robots.txt',
    '/humans.txt',
    '/manifest.webmanifest',
    '/.well-known/api-catalog',
    '/.well-known/webfinger',
    '/.well-known/ai-catalog.json',
    '/.well-known/mcp/server-card.json',
    '/.well-known/agent-skills/index.json',
    '/js/clock.js',
    '/assets/icon-192.png'
  ].flatMap((path) => [{path, method: 'GET', accept: HTML, body: 'exact'}, {path, method: 'HEAD', accept: HTML, body: 'none'}]),
  {path: '/sitemap-index.xml', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/sitemap-0.xml', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/sw.js', method: 'GET', accept: HTML, body: 'dynamic'},
  {path: '/version.json', method: 'GET', accept: HTML, body: 'none'},
  // The proxy routes: GET, HEAD, both Accept variants, a trailing slash, a rejected method.
  ...['/llms.txt', '/llms-full.txt', '/index.md', '/feed.xml', '/feed.json'].flatMap((path) => [
    {path, method: 'GET', accept: HTML, body: 'dynamic'},
    {path, method: 'GET', accept: MARKDOWN, body: 'dynamic'},
    {path, method: 'HEAD', accept: HTML, body: 'none'},
    {path, method: 'PUT', accept: HTML, body: 'exact'}
  ]),
  {path: '/llms.txt/', method: 'GET', accept: HTML, body: 'dynamic'},
  // Analytics and telemetry routes, without a payload.
  {path: '/sa', method: 'GET', accept: HTML, body: 'none'},
  {path: '/cf-insights.js', method: 'GET', accept: HTML, body: 'none'},
  {path: '/cf-rum', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/simple', method: 'GET', accept: HTML, body: 'none'},
  {path: '/simple/', method: 'GET', accept: HTML, body: 'none'},
  // The CSP collector: POST only. GET falls through to the 404 page, PUT to a 405, and a POST
  // with an unaccepted content type answers 415 without logging a report.
  {path: '/api/csp-report', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/api/csp-report/', method: 'GET', accept: HTML, body: 'exact'},
  {path: '/api/csp-report', method: 'PUT', accept: HTML, body: 'none'},
  {path: '/api/csp-report', method: 'POST', accept: HTML, body: 'none', contentType: 'text/plain', payload: 'parity-probe'},
  // An accepted report type answers 204 and logs one line naming the probe. No /cf-rum POST: it
  // would forward a fabricated datapoint into production Web Analytics.
  {
    path: '/api/csp-report',
    method: 'POST',
    accept: HTML,
    body: 'exact',
    contentType: 'application/csp-report',
    payload: JSON.stringify({'csp-report': {'document-uri': 'https://jonathanlloyd.me/', 'violated-directive': 'worker-parity-probe'}})
  }
]

/** Normalizes a dynamic body so two compositions of the same content compare equal. */
export function normalizeBody(path, text) {
  let out = text
  // Composition and generation stamps in the proxy documents and feeds.
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ts>')
  out = out.replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/g, '<lastBuildDate/>')
  // Workbox precache revisions in sw.js.
  if (path === '/sw.js') {
    out = out.replace(/revision:"[0-9a-f]+"/g, 'revision:"<r>"')
  }
  return out
}

function isTransport(name) {
  return TRANSPORT_HEADERS.has(name) || PER_REQUEST_HEADERS.has(name) || TRANSPORT_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function headerMap(response) {
  const map = new Map()
  for (const [name, value] of response.headers) {
    if (!isTransport(name)) {
      map.set(name, value)
    }
  }
  return map
}

async function probe(base, testCase, extraHeaders) {
  const headers = {Accept: testCase.accept, ...extraHeaders}
  if (testCase.conditional) {
    // The side's own validator: Pages and Workers hash files differently, so ETags never match across.
    const first = await fetch(new URL(testCase.path, base), {headers, redirect: 'manual', cache: 'no-store'})
    await first.arrayBuffer()
    const etag = first.headers.get('etag')
    if (etag) {
      headers['If-None-Match'] = etag
    }
  }
  if (testCase.contentType) {
    headers['Content-Type'] = testCase.contentType
  }
  const init = {method: testCase.method, headers, redirect: 'manual', cache: 'no-store'}
  if (testCase.payload !== undefined) {
    init.body = testCase.payload
  }
  const response = await fetch(new URL(testCase.path, base), init)
  const buffer = Buffer.from(await response.arrayBuffer())
  const location = response.headers.get('location')
  return {status: response.status, location: location ? new URL(location, base).pathname : null, headers: headerMap(response), body: buffer}
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Compares one case. Returns a list of differences; an empty list is a match. */
export function compare(testCase, baseline, candidate) {
  const differences = []
  if (baseline.status !== candidate.status) {
    differences.push(`status ${baseline.status} vs ${candidate.status}`)
  }
  if (baseline.location !== candidate.location) {
    differences.push(`location ${baseline.location} vs ${candidate.location}`)
  }
  const names = new Set([...baseline.headers.keys(), ...candidate.headers.keys()])
  for (const name of [...names].sort()) {
    const expected = baseline.headers.get(name)
    const actual = candidate.headers.get(name)
    if (expected === undefined && INTENDED_CANDIDATE_HEADERS.get(name) === actual) {
      continue
    }
    if (expected === undefined && baseline.status === 304 && candidate.status === 304 && ALLOWED_304_CANDIDATE_HEADERS.has(name)) {
      continue
    }
    if (expected !== actual) {
      differences.push(`header ${name}: ${JSON.stringify(expected ?? null)} vs ${JSON.stringify(actual ?? null)}`)
    }
  }
  if (testCase.body === 'exact' && !baseline.body.equals(candidate.body)) {
    differences.push(`body bytes ${digest(baseline.body)} vs ${digest(candidate.body)}`)
  }
  if (testCase.body === 'dynamic') {
    const a = normalizeBody(testCase.path, baseline.body.toString('utf8'))
    const b = normalizeBody(testCase.path, candidate.body.toString('utf8'))
    if (a !== b) {
      differences.push(`normalized body ${digest(a)} vs ${digest(b)}`)
    }
  }
  return differences
}

function parseHeader(line) {
  const at = line.indexOf(':')
  if (at < 1) {
    throw new Error(`--candidate-header needs "Name: value", got ${JSON.stringify(line)}`)
  }
  return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
}

async function main() {
  const {values} = parseArgs({
    options: {
      baseline: {type: 'string', default: 'https://human-datastream.pages.dev'},
      candidate: {type: 'string'},
      'candidate-header': {type: 'string', multiple: true, default: []},
      json: {type: 'string'}
    }
  })
  if (!values.candidate) {
    console.error('worker-parity: --candidate <url> is required')
    process.exit(2)
  }
  const candidateHeaders = Object.fromEntries(values['candidate-header'].map(parseHeader))
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    candidateHeaders['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID
    candidateHeaders['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET
  }

  const results = []
  const loopback = LOOPBACK_HOSTNAMES.has(new URL(values.candidate).hostname)
  for (const testCase of CASES) {
    if (loopback && ANALYTICS_PATHS.some((path) => testCase.path === path || testCase.path.startsWith(`${path}/`))) {
      console.log(`SKIP  ${testCase.method.padEnd(7)} ${testCase.path} (loopback candidate: analytics routes answer 404 by design)`)
      continue
    }
    const [baseline, candidate] = await Promise.all([probe(values.baseline, testCase, {}), probe(values.candidate, testCase, candidateHeaders)])
    const differences = compare(testCase, baseline, candidate)
    results.push({
      ...testCase,
      payload: undefined,
      conditional: testCase.conditional ?? false,
      baselineStatus: baseline.status,
      candidateStatus: candidate.status,
      differences
    })
    const label = `${testCase.method.padEnd(7)} ${testCase.path} [${testCase.accept}]${testCase.conditional ? ' (If-None-Match)' : ''}`
    console.log(`${differences.length === 0 ? 'MATCH' : 'DIFF '} ${label} ${baseline.status}/${candidate.status}`)
    for (const difference of differences) {
      console.log(`        ${difference}`)
    }
  }
  const failed = results.filter((result) => result.differences.length > 0)
  console.log(`\nworker-parity: ${results.length - failed.length}/${results.length} cases match`)
  if (values.json) {
    writeFileSync(values.json, JSON.stringify({baseline: values.baseline, candidate: values.candidate, results}, null, 2) + '\n')
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
