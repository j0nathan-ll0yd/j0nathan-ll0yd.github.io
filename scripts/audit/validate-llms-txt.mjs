#!/usr/bin/env node
// scripts/audit/validate-llms-txt.mjs -- B2. Hand-rolled llmstxt.org structural
// validator (no official validator exists -- verified against llmstxt.org
// directly, 2026-07-16 session). Also checks llms-full.txt / index.md
// (CloudFront-only artifacts with no formal spec of their own) for
// existence, non-emptiness, and freshness.
//
// The spec each finding id derives from lives in specs/llms-txt/*.rule.json,
// not in this comment (decisions/0011) -- see that directory for the
// llmstxt.org structure this validator checks, which ids are genuine spec
// convention vs which are this repo's own operational handling, and the case
// inputs each one derives from.

import {LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'
import {checkLlmsStructure} from './lib/llms-structure.mjs'
import {emit, rules} from './specs/load.mjs'

const R = rules('llms-txt')

// Stryker disable all -- fetch-target URLs, read only by main()/checkPresence
// (network-path plumbing with no test coverage), never by the pure validator.
const LLMS_TXT_URL = `${SITE_URL}/llms.txt`
// PROD-DOMAIN paths, deliberately: B2's concern is that jonathanlloyd.me serves
// these (they 404'd there until 2026-07-17 because only /llms.txt had a proxy
// route — functions/llms-full.txt.ts + functions/index.md.ts now cover them).
// Source-side CloudFront freshness for the same artifacts is C1's job
// (mantle-LifegamesPortal/scripts/audit/freshness.mjs).
const LLMS_FULL_URL = `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`
const INDEX_MD_URL = `${SITE_URL}${LLM_CONTENT_PATHS.indexMarkdown}`
// Stryker restore all

/**
 * Validate llms.txt structure against the llmstxt.org convention.
 * Pure function (string in, findings out) so it's testable without network.
 *
 * The five structural rules live in lib/llms-structure.mjs, the shared
 * reference the backend producer vendors too (canonical copy in atlas,
 * pinned by sha256). This function is the CATALOG WRAPPER over it: the
 * reference decides WHAT is wrong, the rule files decide how bad it is.
 * emit() stamps severity from the rule and throws on an id no rule file
 * declares, so surjectivity survives the extraction unchanged.
 */
export function validateLlmsTxt(rawText) {
  return checkLlmsStructure(rawText).map((finding) => emit(R, finding.id, finding.message))
}

// Stryker disable all -- checkPresence and main() are network-path plumbing with
// no test coverage; Stryker targets only the pure validateLlmsTxt above
// (decisions/0011, UD1: the mutation gate scopes to the three pure pilot functions).
/** Existence/non-emptiness/freshness check for an artifact with no formal spec. */
async function checkPresence(id, url, maxAgeHours) {
  const findings = []
  let res
  try {
    res = await fetchStable(url)
  } catch (err) {
    findings.push(emit(R, id, `fetch failed: ${err.message}`))
    return findings
  }
  if (!res.ok) {
    findings.push(emit(R, id, `HTTP ${res.status} fetching ${url}`))
    return findings
  }
  const body = await res.text()
  if (body.trim().length === 0) {
    findings.push(emit(R, id, `${url} returned an empty body`))
    return findings
  }

  // Freshness: prefer an embedded "**Generated:** <ISO date>" marker (present
  // in this composer's output); fall back to the Last-Modified header.
  const generatedMatch = body.match(/\*\*Generated:\*\*\s*([0-9T:.Z-]+)/)
  const generatedAt = generatedMatch ? new Date(generatedMatch[1]) : null
  const lastModifiedHeader = res.headers.get('last-modified')
  const referenceDate = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt
    : (lastModifiedHeader ? new Date(lastModifiedHeader) : null)

  if (!referenceDate || Number.isNaN(referenceDate.getTime())) {
    findings.push(
      emit(R, `${id}-freshness-unknown`,
        `could not determine a generation/modification time for ${url} (no embedded ` +
          'Generated marker and no Last-Modified header) -- freshness unchecked')
    )
  } else {
    const ageHours = (Date.now() - referenceDate.getTime()) / 3_600_000
    if (ageHours > maxAgeHours) {
      findings.push(
        emit(R, `${id}-stale`,
          `${url} is ${ageHours.toFixed(1)}h old (reference: ${referenceDate.toISOString()}), ` + `exceeds the ${maxAgeHours}h warn threshold`)
      )
    }
  }

  return findings
}

async function main() {
  let exit = 0

  let llmsTxtBody
  try {
    const res = await fetchStable(LLMS_TXT_URL)
    if (!res.ok) {
      exit = report('validate-llms-txt', [emit(R, 'llms-txt-fetch', `HTTP ${res.status} fetching ${LLMS_TXT_URL}`)])
    } else {
      llmsTxtBody = await res.text()
    }
  } catch (err) {
    exit = report('validate-llms-txt', [emit(R, 'llms-txt-fetch', `fetch failed: ${err.message}`)])
  }

  if (llmsTxtBody !== undefined) {
    const findings = validateLlmsTxt(llmsTxtBody)
    exit = report('validate-llms-txt (llms.txt structure)', findings) || exit
  }

  // llms-full.txt / index.md: the composer runs on a 30m EventBridge rate +
  // event trigger (§11.2 of the audit plan); a 3h warn window covers a couple
  // of missed ticks without being noisy. +1h on top because the prod-domain
  // routes edge-cache the CloudFront upstream for up to an hour
  // (functions/_lib/proxy.ts: cacheTtl 3600 / s-maxage=3600), so a legitimately
  // fresh document can read up to 1h older through the proxy. The window itself
  // is params.maxAgeHours on each artifact's own -stale rule
  // (specs/llms-txt/llms-full-txt-stale.rule.json, index-md-stale.rule.json),
  // read here rather than restated as a literal (decisions/0011, R3).
  const fullFindings = await checkPresence('llms-full-txt', LLMS_FULL_URL, R['llms-full-txt-stale'].params.maxAgeHours)
  const indexMdFindings = await checkPresence('index-md', INDEX_MD_URL, R['index-md-stale'].params.maxAgeHours)
  exit = report('validate-llms-txt (llms-full.txt + index.md presence)', [...fullFindings, ...indexMdFindings]) || exit

  process.exit(exit)
}

if (isMain(import.meta.url)) {
  main()
}
// Stryker restore all
