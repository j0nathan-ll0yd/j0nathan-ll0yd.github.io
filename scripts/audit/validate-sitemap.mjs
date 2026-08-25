#!/usr/bin/env node
// scripts/audit/validate-sitemap.mjs -- B2. Fetches the live sitemap index +
// its child sitemap(s), validates each against the sitemaps.org 0.9 schema,
// then HEADs every <loc> to assert same-origin + 200.
//
// Schema validation runs IN-PROCESS via lib/sitemap-schema.mjs (fast-xml-parser
// + fast-xml-validator, both already in the dependency tree). It used to shell
// out to `xmllint`, which forced audit-web.yml to apt-get libxml2-utils on every
// run; the self-hosted runners are egress-isolated and that install exited 100,
// killing the whole weekly job before any check ran. See lib/sitemap-schema.mjs
// for the full rationale and the XSD-fidelity guarantee.
//
// @astrojs/sitemap always emits a two-tier structure -- a sitemapindex
// (sitemap-index.xml) pointing at one or more urlset files (sitemap-0.xml, ...)
// -- verified against this repo's own `dist/` build output, 2026-07-16.

import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, headStable, isMain, report} from './lib/http.mjs'
import {validateSitemapDocument} from './lib/sitemap-schema.mjs'

const SITEMAP_INDEX_URL = `${SITE_URL}/sitemap-index.xml`
const SITE_ORIGIN = new URL(SITE_URL).origin

/** Extract <loc>...</loc> text content via regex -- deliberately not a full XML
 * parser dependency for a single flat, non-nested tag (matches the "prefer
 * vendoring tiny validators" guidance for this catalog). Exported: pure, testable. */
export function extractLocs(xml) {
  const locs = []
  const re = /<loc>([^<]+)<\/loc>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1].trim())
  }
  return locs
}

/**
 * Validate one sitemap document against the sitemaps.org 0.9 schema for
 * `profile` ('urlset' or 'sitemapindex'); returns a finding array (empty =
 * valid). Exported: pure, testable with local fixtures, no network.
 */
export function validateAgainstSchema(id, xml, profile, sourceUrl) {
  const violations = validateSitemapDocument(xml, profile)
  if (violations.length === 0) {
    return []
  }
  return [{
    severity: 'fail',
    id,
    message: `${sourceUrl} failed sitemaps.org 0.9 (${profile}) schema validation:\n${violations.map((v) => `  ${v}`).join('\n')}`
  }]
}

async function main() {
  const findings = []

  let indexRes
  try {
    indexRes = await fetchStable(SITEMAP_INDEX_URL)
  } catch (err) {
    process.exit(report('validate-sitemap', [
      {severity: 'fail', id: 'sitemap-index-fetch', message: `fetch failed: ${err.message}`}
    ]))
  }
  if (!indexRes.ok) {
    process.exit(report('validate-sitemap', [
      {severity: 'fail', id: 'sitemap-index-fetch', message: `HTTP ${indexRes.status} fetching ${SITEMAP_INDEX_URL}`}
    ]))
  }
  const indexXml = await indexRes.text()
  findings.push(...validateAgainstSchema('sitemap-index-xsd', indexXml, 'sitemapindex', SITEMAP_INDEX_URL))

  const childSitemapUrls = extractLocs(indexXml)
  if (childSitemapUrls.length === 0) {
    findings.push({severity: 'fail', id: 'sitemap-index-empty', message: `${SITEMAP_INDEX_URL} contains no <sitemap><loc> entries`})
  }

  // Validate every child urlset file against the sitemap.xsd, and collect
  // every page <loc> across all of them for the same-origin + 200 sweep.
  const allPageLocs = []
  for (const childUrl of childSitemapUrls) {
    let childRes
    try {
      childRes = await fetchStable(childUrl)
    } catch (err) {
      findings.push({severity: 'fail', id: 'sitemap-child-fetch', message: `${childUrl}: fetch failed: ${err.message}`})
      continue
    }
    if (!childRes.ok) {
      findings.push({severity: 'fail', id: 'sitemap-child-fetch', message: `${childUrl}: HTTP ${childRes.status}`})
      continue
    }
    const childXml = await childRes.text()
    findings.push(...validateAgainstSchema('sitemap-child-xsd', childXml, 'urlset', childUrl))
    allPageLocs.push(...extractLocs(childXml))
  }

  if (allPageLocs.length === 0 && childSitemapUrls.length > 0) {
    findings.push({severity: 'fail', id: 'sitemap-no-urls', message: 'no <url><loc> entries found across any child sitemap'})
  }

  // Same-origin + reachability sweep. Sequential (not Promise.all) to avoid
  // hammering the live origin with a burst of concurrent HEAD requests.
  for (const loc of allPageLocs) {
    let originOk
    try {
      originOk = new URL(loc).origin === SITE_ORIGIN
    } catch {
      findings.push({severity: 'fail', id: 'sitemap-loc-invalid-url', message: `not a valid absolute URL: ${loc}`})
      continue
    }
    if (!originOk) {
      findings.push({severity: 'fail', id: 'sitemap-loc-cross-origin', message: `<loc> is not same-origin as ${SITE_ORIGIN}: ${loc}`})
      continue
    }
    const head = await headStable(loc)
    if (!head.ok) {
      findings.push({severity: 'fail', id: 'sitemap-loc-unreachable', message: `${loc} returned HTTP ${head.status} on HEAD`})
    }
  }

  process.exit(report('validate-sitemap', findings))
}

if (isMain(import.meta.url)) {
  main()
}
