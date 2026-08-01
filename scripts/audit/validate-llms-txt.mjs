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

const LINK_ITEM_RE = /^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(:\s*.*)?$/
const LIST_ITEM_RE = /^[-*]\s+/

/**
 * Validate llms.txt structure against the llmstxt.org convention.
 * Pure function (string in, findings out) so it's testable without network.
 */
export function validateLlmsTxt(rawText) {
  const findings = []
  let text = rawText

  // 1. Optional BOM.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1)
  }

  const lines = text.split(/\r\n|\r|\n/)
  let i = 0
  const nextNonBlank = () => {
    while (i < lines.length && lines[i].trim() === '') {
      i++
    }
    return i < lines.length ? lines[i] : null
  }

  // 2. First non-blank line MUST be an H1.
  const h1Line = nextNonBlank()
  if (h1Line === null || !/^#\s+\S/.test(h1Line)) {
    findings.push(emit(R, 'llms-txt-h1', `first non-blank line must be "# <title>"; got ${JSON.stringify(h1Line)}`))
    return findings // structure is unrecoverable past this point
  }
  i++

  // 3. Next non-blank line MUST be a blockquote -- specs/llms-txt/llms-txt-blockquote.rule.json
  // records why this validator treats it as required even though the spec's own
  // prose marks only the H1 as strictly required.
  const bqLine = nextNonBlank()
  if (bqLine === null || !/^>\s+\S/.test(bqLine)) {
    findings.push(emit(R, 'llms-txt-blockquote', `expected a "> summary" blockquote immediately after the H1; got ${JSON.stringify(bqLine)}`))
  } else {
    i++
  }

  // 4/5. Walk remaining lines. Before the first H2: anything except another
  // H1 is fine (free-form body). From the first H2 onward: every H2 section's
  // list items must be markdown links.
  let sawH2 = false
  let currentSection = null // { name, hasListItem, isOptional }
  const sectionFindings = []

  const closeSection = () => {
    if (currentSection && !currentSection.hasListItem) {
      sectionFindings.push(
        emit(R, 'llms-txt-h2-no-file-list',
          `H2 section "${currentSection.name}" has no [name](url) file-list items` + ' (llmstxt.org: H2 sections are "file lists" of links)')
      )
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const h2Match = /^##\s+(.+?)\s*$/.exec(line)
    if (h2Match) {
      closeSection()
      sawH2 = true
      currentSection = {name: h2Match[1], hasListItem: false, isOptional: h2Match[1].trim() === 'Optional'}
      continue
    }
    if (/^#\s+\S/.test(line)) {
      sectionFindings.push(emit(R, 'llms-txt-second-h1', `unexpected second H1 at "${line}" -- only one H1 is allowed`))
      continue
    }
    if (!sawH2) {
      continue // free-form pre-H2 body: anything but headings is spec-legal
    }
    if (LIST_ITEM_RE.test(line) && currentSection) {
      currentSection.hasListItem = true
      if (!LINK_ITEM_RE.test(line)) {
        sectionFindings.push(
          emit(R, 'llms-txt-non-link-list-item',
            `H2 section "${currentSection.name}" has a list item that is not a ` +
              `"[name](url)" or "[name](url): notes" markdown link: ${JSON.stringify(line.trim())}`)
        )
      }
    }
  }
  closeSection()

  return [...findings, ...sectionFindings]
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
