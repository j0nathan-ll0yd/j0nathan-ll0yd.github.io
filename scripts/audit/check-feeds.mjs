#!/usr/bin/env node
// scripts/audit/check-feeds.mjs -- B2. Structural validation of feed.xml
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
import {SITE_URL} from '@lifegames/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'
import {emit, rules} from './specs/load.mjs'

// Stryker disable all -- fetch-target URLs, read only by main() (network-path
// plumbing with no test coverage), never by the pure validators.
const FEED_XML_URL = `${SITE_URL}/feed.xml`
const FEED_JSON_URL = `${SITE_URL}/feed.json`
// Stryker restore all
// Shared between validateFeedXml (out of the B2 pilot's scope) and
// validateFeedJson (in scope) -- deliberately NOT threaded through
// specs/feed-json/feed-json-stale.rule.json's params, which instead declares
// params_pending and why (decisions/0011 §B3): deriving it here would delete
// the constant validateFeedXml still reads, and threading it for JSON only
// would leave the same 7 living in two places.
const FRESHNESS_WINDOW_DAYS = 7 // matches the plan's "event-driven ... 7d soft window" cadence class
const R = rules('feed-json')

// Stryker disable all -- validateFeedXml is explicitly OUT of the B2 pilot's
// scope (UD2 brought in validateFeedJson only, one function from this file, not
// the file); the mutation gate targets only the three pure pilot functions
// (decisions/0011, UD1).
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
    return [{severity: 'fail', id: 'feed-xml-parse', message: `not well-formed XML (${err.code} at line ${err.line}): ${err.message}`}]
  }

  const parser = new XMLParser({ignoreAttributes: false, attributeNamePrefix: '@_'})
  const doc = parser.parse(xml)

  const channel = doc?.rss?.channel
  if (!channel) {
    findings.push({severity: 'fail', id: 'feed-xml-shape', message: 'no <rss><channel> root found'})
    return findings
  }
  for (const field of ['title', 'link', 'description']) {
    if (!channel[field]) {
      findings.push({severity: 'fail', id: 'feed-xml-channel-field', message: `<channel> missing required <${field}>`})
    }
  }

  const items = channel.item === undefined ? [] : (Array.isArray(channel.item) ? channel.item : [channel.item])
  if (items.length === 0) {
    findings.push({severity: 'warn', id: 'feed-xml-no-items', message: '<channel> has no <item> entries'})
    return findings
  }
  for (const [idx, item] of items.entries()) {
    for (const field of ['title', 'link', 'guid']) {
      if (!item[field]) {
        findings.push({severity: 'fail', id: 'feed-xml-item-field', message: `item[${idx}] missing required <${field}>`})
      }
    }
  }

  const newestPubDate = items.map((item) => item.pubDate && new Date(item.pubDate)).filter((d) => d && !Number.isNaN(d.getTime())).sort((a, b) => b - a)[0]
  if (!newestPubDate) {
    findings.push({severity: 'warn', id: 'feed-xml-no-parseable-pubdate', message: 'no item has a parseable <pubDate>'})
  } else {
    const ageDays = (now - newestPubDate) / 86_400_000
    if (ageDays > FRESHNESS_WINDOW_DAYS) {
      findings.push({
        severity: 'fail',
        id: 'feed-xml-stale',
        message: `newest item is ${ageDays.toFixed(1)} days old (${newestPubDate.toISOString()}), ` + `exceeds the ${FRESHNESS_WINDOW_DAYS}-day soft window`
      })
    }
  }

  return findings
}
// Stryker restore all

/** Pure validation function: (feed.json body, parsed) -> findings[]. Testable without network. */
export function validateFeedJson(json, now = new Date()) {
  const findings = []
  for (const field of ['version', 'title', 'items']) {
    if (!(field in json)) {
      findings.push(emit(R, 'feed-json-field', `missing required top-level field "${field}"`))
    }
  }
  if (json.version && !/^https:\/\/jsonfeed\.org\/version\/1(\.\d+)?$/.test(json.version)) {
    findings.push(emit(R, 'feed-json-version', `"version" (${json.version}) is not a recognized JSON Feed version URI`))
  }
  if (!Array.isArray(json.items)) {
    return findings
  }
  if (json.items.length === 0) {
    findings.push(emit(R, 'feed-json-no-items', '"items" array is empty'))
    return findings
  }
  for (const [idx, item] of json.items.entries()) {
    if (!item.id) {
      findings.push(emit(R, 'feed-json-item-field', `items[${idx}] missing required "id"`))
    }
    if (!item.content_html && !item.content_text) {
      findings.push(emit(R, 'feed-json-item-field', `items[${idx}] has neither "content_html" nor "content_text" (JSON Feed 1.1 requires at least one)`))
    }
  }

  const newestPublished =
    json.items.map((item) => item.date_published && new Date(item.date_published)).filter((d) => d && !Number.isNaN(d.getTime())).sort((a, b) => b - a)[0]
  if (!newestPublished) {
    findings.push(emit(R, 'feed-json-no-parseable-date', 'no item has a parseable "date_published"'))
  } else {
    const ageDays = (now - newestPublished) / 86_400_000
    if (ageDays > FRESHNESS_WINDOW_DAYS) {
      findings.push(
        emit(R, 'feed-json-stale',
          `newest item is ${ageDays.toFixed(1)} days old (${newestPublished.toISOString()}), ` + `exceeds the ${FRESHNESS_WINDOW_DAYS}-day soft window`)
      )
    }
  }

  return findings
}

// Stryker disable all -- main() is network-path plumbing with no test coverage
// (decisions/0011, UD1: the mutation gate scopes to the three pure pilot functions).
async function main() {
  const findings = []

  try {
    const res = await fetchStable(FEED_XML_URL)
    if (!res.ok) {
      findings.push({severity: 'fail', id: 'feed-xml-fetch', message: `HTTP ${res.status} fetching ${FEED_XML_URL}`})
    } else {
      findings.push(...validateFeedXml(await res.text()))
    }
  } catch (err) {
    findings.push({severity: 'fail', id: 'feed-xml-fetch', message: `fetch failed: ${err.message}`})
  }

  // NB2 (decisions/0011): json is resolved/parsed INSIDE the try, but
  // validateFeedJson() is called OUTSIDE it. The catch below pushes
  // feed-json-fetch; if emit() ever threw for an unregistered id while the
  // call sat inside this try, that throw would be mislabelled a fetch
  // failure. check-security-txt.mjs and validate-llms-txt.mjs already call
  // their validators outside their own fetch trys -- this matches them.
  let json
  try {
    const res = await fetchStable(FEED_JSON_URL)
    if (!res.ok) {
      findings.push({severity: 'fail', id: 'feed-json-fetch', message: `HTTP ${res.status} fetching ${FEED_JSON_URL}`})
    } else {
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
  if (json) {
    findings.push(...validateFeedJson(json))
  }

  process.exit(report('check-feeds', findings))
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
