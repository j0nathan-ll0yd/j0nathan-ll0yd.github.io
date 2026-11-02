#!/usr/bin/env node
// audits/checks/b2-check-feeds.mjs -- B2. Structural validation of feed.xml
// (RSS 2.0) and feed.json (JSON Feed 1.1), plus a freshness check on the
// newest item. Uses fast-xml-parser for feed.xml (a real XML parser is
// warranted here -- RSS has nested elements, CDATA, and namespaced atom:*
// tags, unlike the flat <loc> tags in the sitemap) rather than a live call to
// the W3C Feed Validator service: an external validator dependency in a
// scheduled CI check trades one class of flakiness (our bug) for another
// (their rate limits/downtime) without buying real signal beyond what
// structural parsing already gives us -- the same judgment call the plan
// makes for CrUX/PSI (D10).

import {XMLParser} from 'fast-xml-parser'
import {SyntaxValidator} from 'fast-xml-validator'
import {feedArtifact} from '../../src/lib/edge/feed-artifacts.ts'
import {SITE_RUNTIME_HEADER} from '../../src/lib/edge/security-headers.ts'
import {fetchStable, isMain, report} from '../lib/http.mjs'
import {siteEdgeCacheFailure} from '../lib/site-edge-cache.mjs'
import {publishMeasured} from '../lib/measurement.mjs'
import {probeSuppression, suppressionDisposition} from '../lib/suppression.mjs'
import {emit, rules} from '../specs/load.mjs'

// Stryker disable all -- fetch-target URLs, read only by main() (network-path
// plumbing with no test coverage), never by the pure validators. Both come from
// src/lib/edge/feed-artifacts.ts, the same module the two route files read,
// so no feed path is a literal in more than one place.
const FEED_XML_URL = feedArtifact('feed.xml').siteUrl
const FEED_JSON_URL = feedArtifact('feed.json').siteUrl
// Stryker restore all
// A18 coverage declaration (atlas decision 0145). The registered estate surfaces
// this runner holds bytes for and judges. feed.xml and feed.json ARE the rss-feed
// artifact, so this is the runner that measures it. Metadata only -- the hub reads
// it statically from the source; nothing imports it.
export const ARTIFACTS = [{surfaceId: 'rss-feed'}]

const R_JSON = rules('feed-json')
const R_XML = rules('feed-xml')
const JSON_FRESHNESS_WINDOW_DAYS = R_JSON['feed-json-stale'].params.maxAgeDays
const XML_FRESHNESS_WINDOW_DAYS = R_XML['feed-xml-stale'].params.maxAgeDays

/** Pure validation function: (feed.xml body) -> findings[]. Testable without network. */
export function validateFeedXml(xml, now = new Date()) {
  const findings = []

  // XMLParser.parse() is deliberately lenient (verified: it does not throw on
  // `<rss><channel><title>unclosed`, mismatched tags, or even `<<<garbage>>>`
  // -- fast-xml-parser recovers rather than erroring). fast-xml-validator's
  // SyntaxValidator is the stricter well-formedness check that actually catches
  // malformed XML.
  //
  // Migration: fast-xml-parser v5 deprecated its bundled XMLValidator (and the
  // XMLParser.parse validationOptions overload), splitting validation into the
  // SEPARATE `fast-xml-validator` package from the same maintainer
  // (NaturalIntelligence). SyntaxValidator.validate() is the non-deprecated
  // successor. Behavioral note: XMLValidator.validate() RETURNED
  // `true | ValidationError`, whereas SyntaxValidator.validate() returns `true`
  // on success and THROWS a ValidationError (`.code` / `.line` / `.col` /
  // `.message`) on malformed XML -- so we wrap it in try/catch to preserve this
  // function's return-a-finding, never-throw contract. Same inputs -> same
  // pass/fail semantics on the feeds.
  try {
    SyntaxValidator.validate(xml)
  } catch (err) {
    return [emit(R_XML, 'feed-xml-parse', `not well-formed XML (${err.code} at line ${err.line}): ${err.message}`)]
  }

  const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_'})
  const doc = parser.parse(xml)

  const channel = doc?.rss?.channel
  if (!channel) {
    findings.push(emit(R_XML, 'feed-xml-shape', 'no <rss><channel> root found'))
    return findings
  }
  if (doc.rss['@_version'] !== '2.0') {
    findings.push(emit(R_XML, 'feed-xml-version', '<rss> version attribute is not "2.0"'))
  }
  for (const field of ['title', 'link', 'description']) {
    if (!channel[field]) {
      findings.push(emit(R_XML, 'feed-xml-channel-field', `<channel> missing required <${field}>`))
    }
  }

  const items = channel.item === undefined ? [] : (Array.isArray(channel.item) ? channel.item : [channel.item])
  if (items.length === 0) {
    findings.push(emit(R_XML, 'feed-xml-no-items', '<channel> has no <item> entries'))
    return findings
  }
  for (const [idx, item] of items.entries()) {
    for (const field of ['title', 'link', 'guid']) {
      if (!item[field]) {
        findings.push(emit(R_XML, 'feed-xml-item-field', `item[${idx}] missing local-profile <${field}>`))
      }
    }
  }

  const newestPubDate = items.map((item) => item.pubDate && new Date(item.pubDate)).filter((d) => d && !Number.isNaN(d.getTime())).sort((a, b) => b - a)[0]
  if (!newestPubDate) {
    findings.push(emit(R_XML, 'feed-xml-no-parseable-pubdate', 'no item has a parseable <pubDate>'))
  } else {
    const ageDays = (now - newestPubDate) / 86_400_000
    if (ageDays > XML_FRESHNESS_WINDOW_DAYS) {
      findings.push(
        emit(R_XML, 'feed-xml-stale',
          `newest item is ${ageDays.toFixed(1)} days old (${newestPubDate.toISOString()}), ` + `exceeds the ${XML_FRESHNESS_WINDOW_DAYS}-day soft window`)
      )
    }
  }

  return findings
}

/** Pure validation function: (feed.json body, parsed) -> findings[]. Testable without network. */
export function validateFeedJson(json, now = new Date()) {
  const findings = []
  for (const field of ['version', 'title', 'items']) {
    if (!(field in json)) {
      findings.push(emit(R_JSON, 'feed-json-field', `missing required top-level field "${field}"`))
    }
  }
  if (json.version && !/^https:\/\/jsonfeed\.org\/version\/1(\.\d+)?$/.test(json.version)) {
    findings.push(emit(R_JSON, 'feed-json-version', `"version" (${json.version}) is not a recognized JSON Feed version URI`))
  }
  if (!Array.isArray(json.items)) {
    return findings
  }
  if (json.items.length === 0) {
    findings.push(emit(R_JSON, 'feed-json-no-items', '"items" array is empty'))
    return findings
  }
  for (const [idx, item] of json.items.entries()) {
    if (!item.id) {
      findings.push(emit(R_JSON, 'feed-json-item-field', `items[${idx}] missing required "id"`))
    }
    if (!item.content_html && !item.content_text) {
      findings.push(
        emit(R_JSON, 'feed-json-item-field', `items[${idx}] has neither "content_html" nor "content_text" (JSON Feed 1.1 requires at least one)`)
      )
    }
  }

  const newestPublished =
    json.items.map((item) => item.date_published && new Date(item.date_published)).filter((d) => d && !Number.isNaN(d.getTime())).sort((a, b) => b - a)[0]
  if (!newestPublished) {
    findings.push(emit(R_JSON, 'feed-json-no-parseable-date', 'no item has a parseable "date_published"'))
  } else {
    const ageDays = (now - newestPublished) / 86_400_000
    if (ageDays > JSON_FRESHNESS_WINDOW_DAYS) {
      findings.push(
        emit(R_JSON, 'feed-json-stale',
          `newest item is ${ageDays.toFixed(1)} days old (${newestPublished.toISOString()}), ` + `exceeds the ${JSON_FRESHNESS_WINDOW_DAYS}-day soft window`)
      )
    }
  }

  return findings
}

/**
 * The edge-cache arm of a served feed: no Cloudflare cache answered it from a stored copy, which
 * would replay it with no focus probe and no gate check. The rule is the llms site plane's
 * (`siteEdgeCacheFailure` in audits/lib/site-edge-cache.mjs), so both gated artifact families are
 * judged one way.
 *
 * THE SEAM IT WATCHES: the served Worker path, from the Worker's response through the public
 * site. The feeds took a stored replay once: on 2026-10-08, on Pages, /feed.xml and /feed.json
 * answered `cf-cache-status: HIT` with `Age` up to 796 s. On Workers the Worker runs before the
 * zone cache and wrangler.jsonc enables no Workers Cache (tests/unit/worker-routing.test.ts), so
 * this arm measures the result those guarantees promise. It took the feed half of the credit
 * from the retired zone cache-rule audit (atlas decision 0160 D7), whose seam closed with the
 * Pages origin. No other measurer reads a feed's served cache state: B2 llms judges only the
 * llms trio.
 *
 * @param {string} artifact the feed file name, for the message
 * @param {{get(name: string): string | null}} headers the served response headers
 * @returns {{severity: 'fail', id: string, message: string}[]}
 */
export function feedEdgeCacheFindings(artifact, headers) {
  const failure = siteEdgeCacheFailure({
    age: headers.get('age'),
    cfCacheStatus: headers.get('cf-cache-status'),
    cdnCacheControl: headers.get('cdn-cache-control'),
    siteRuntime: headers.get(SITE_RUNTIME_HEADER)
  })
  return failure === null ? [] : [{severity: 'fail', id: 'feed-site-edge-cache-status', message: `${artifact}: ${failure}`}]
}

// Stryker disable all -- network-path plumbing (decisions/0011, UD1: the mutation gate scopes to
// the pure functions above). collectFeedFindings is driven by audits/__tests__/feed-edge-cache.test.ts
// through an injected fetch, so the wiring of every arm is tested even though it is not mutated.
// The two artifacts this check measures. Named so the suppression arms below can
// publish a full count without restating the number.
const FEED_ARTIFACT_COUNT = 2

/**
 * Fetches both feeds and judges each one: its body (the catalog validators) and its served
 * headers (the edge-cache arm). Returns the findings and the count of feeds whose bytes this run
 * held and judged.
 *
 * NB2 (decisions/0011): each body is resolved or parsed INSIDE its fetch try, and every validator
 * runs OUTSIDE it. The catch pushes the fetch finding; a validator that threw inside the try would
 * be mislabelled a fetch failure. b2-check-security-txt.mjs and b2-llms.mjs do the same.
 *
 * @param {(url: string) => Promise<Response>} [fetchImpl]
 * @returns {Promise<{findings: Array<{severity: string, id: string, message: string}>, measured: number}>}
 */
export async function collectFeedFindings(fetchImpl = fetchStable) {
  const findings = []
  // One per feed artifact whose bytes this run held and judged: feed.xml, feed.json.
  let measured = 0

  let xml = null
  let xmlHeaders = null
  try {
    const res = await fetchImpl(FEED_XML_URL)
    if (!res.ok) {
      findings.push(emit(R_XML, 'feed-xml-fetch', `HTTP ${res.status} fetching ${FEED_XML_URL}`))
    } else {
      xmlHeaders = res.headers
      xml = await res.text()
    }
  } catch (err) {
    findings.push(emit(R_XML, 'feed-xml-fetch', `fetch failed: ${err.message}`))
  }
  if (xml !== null) {
    measured++
    findings.push(...validateFeedXml(xml), ...feedEdgeCacheFindings('feed.xml', xmlHeaders))
  }

  let json
  let jsonHeaders = null
  try {
    const res = await fetchImpl(FEED_JSON_URL)
    if (!res.ok) {
      findings.push({severity: 'fail', id: 'feed-json-fetch', message: `HTTP ${res.status} fetching ${FEED_JSON_URL}`})
    } else {
      jsonHeaders = res.headers
      try {
        json = await res.json()
      } catch (err) {
        findings.push({severity: 'fail', id: 'feed-json-parse', message: `not valid JSON: ${err.message}`})
        json = null
      }
    }
  } catch (err) {
    findings.push({severity: 'fail', id: 'feed-json-fetch', message: `fetch failed: ${err.message}`})
  }
  // The served headers are judged whenever a 200 arrived, even if its body does not parse.
  if (jsonHeaders !== null) {
    findings.push(...feedEdgeCacheFindings('feed.json', jsonHeaders))
  }
  if (json) {
    measured++
    findings.push(...validateFeedJson(json))
  }

  return {findings, measured}
}

async function main() {
  const suppression = suppressionDisposition(await probeSuppression(), 'feed.xml / feed.json validation')
  // SUPPRESSED COUNTS AS MEASURED (atlas decision 0122). The probe answered and the
  // lane stood down deliberately, so the transport worked; publishing 0 here would
  // ping /fail through every focus-privacy window. An OVERDUE suppression is a
  // finding, and a finding is measured too. Only genuine darkness publishes 0.
  if (suppression === 'skip') {
    publishMeasured(FEED_ARTIFACT_COUNT)
    process.exit(0)
  }
  if (suppression === 'fail') {
    publishMeasured(FEED_ARTIFACT_COUNT)
    process.exit(1)
  }

  const {findings, measured} = await collectFeedFindings()
  process.exit(report('check-feeds', findings, measured))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
