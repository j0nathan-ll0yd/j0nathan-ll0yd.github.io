#!/usr/bin/env node
// audits/checks/b2-validate-robots.mjs -- B2. Parses the live robots.txt with
// robots-parser, asserts the Sitemap directive and effective crawler policy,
// rejects directives outside the site's Lighthouse-safe allowlist, validates
// the Content-Usage HTTP response header, and diffs the AI-crawler User-agent
// sections against a committed golden snapshot (drift guard).

import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import robotsParser from 'robots-parser'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain, report} from '../lib/http.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = path.join(__dirname, '..', 'fixtures', 'golden', 'robots-ai-crawlers.json')

const ROBOTS_URL = `${SITE_URL}/robots.txt`
const EXPECTED_SITEMAP_URL = `${SITE_URL}/sitemap-index.xml`
export const EXPECTED_CONTENT_USAGE = 'train-ai=n, search=y'

// Keep the generated file to the RFC 9309 rules this site uses plus Sitemap,
// which Lighthouse explicitly recognizes. A new directive must be reviewed and
// deliberately added here instead of silently lowering the SEO score.
const ALLOWED_DIRECTIVES = new Set(['user-agent', 'allow', 'disallow', 'sitemap'])

/**
 * Extract the set of `User-agent: <name>` values that appear in a robots.txt
 * body. Pure string parsing (not robots-parser, which normalizes/merges
 * groups rather than preserving each literal block) so the drift guard
 * checks exactly what a human editing the file would see.
 */
function extractUserAgents(body) {
  const names = new Set()
  for (const line of body.split(/\r\n|\r|\n/)) {
    const m = /^\s*User-agent:\s*(\S+)/i.exec(line)
    if (m) {
      names.add(m[1])
    }
  }
  return names
}

function findUnsupportedDirectives(body) {
  const unsupported = []
  for (const [index, rawLine] of body.split(/\r\n|\r|\n/).entries()) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }

    const match = /^([^:\s]+)\s*:/.exec(line)
    const directive = match?.[1].toLowerCase()
    if (!directive || !ALLOWED_DIRECTIVES.has(directive)) {
      unsupported.push({line: index + 1, value: line})
    }
  }
  return unsupported
}

/** Pure validation function. Testable without network. */
export function validateRobots(body, golden, contentUsageHeader) {
  const findings = []

  for (const unsupported of findUnsupportedDirectives(body)) {
    findings.push({
      severity: 'fail',
      id: 'robots-unsupported-directive',
      message: `line ${unsupported.line} is not a supported robots.txt directive: ${JSON.stringify(unsupported.value)}`
    })
  }

  const robots = robotsParser(ROBOTS_URL, body)
  const sitemaps = robots.getSitemaps()
  if (!sitemaps.includes(EXPECTED_SITEMAP_URL)) {
    findings.push({
      severity: 'fail',
      id: 'robots-sitemap-directive',
      message: `Sitemap: directive ${JSON.stringify(sitemaps)} does not include the served sitemap ` + `${EXPECTED_SITEMAP_URL}`
    })
  }

  if ((contentUsageHeader ?? '').trim() !== EXPECTED_CONTENT_USAGE) {
    findings.push({
      severity: 'fail',
      id: 'content-usage-header',
      message: `Content-Usage response header must be ${JSON.stringify(EXPECTED_CONTENT_USAGE)}; got ${JSON.stringify(contentUsageHeader)}`
    })
  }

  const liveAgents = extractUserAgents(body)
  const expectedAgents = [
    ...golden.aiTrainingBotsBlockedExceptLlmsTxt,
    ...golden.aiSearchAgentsAllowedFullSite
  ]
  for (const agent of expectedAgents) {
    if (!liveAgents.has(agent)) {
      findings.push({
        severity: 'fail',
        id: 'robots-ai-crawler-missing',
        message: `expected "User-agent: ${agent}" section is missing from the live robots.txt ` +
          `(golden snapshot: audits/fixtures/golden/robots-ai-crawlers.json)`
      })
    }
  }

  for (const agent of golden.aiTrainingBotsBlockedExceptLlmsTxt) {
    if (
      robots.isAllowed(`${SITE_URL}/llms.txt`, agent) !== true || robots.isAllowed(`${SITE_URL}/`, agent) !== false
    ) {
      findings.push({
        severity: 'fail',
        id: 'robots-ai-training-policy',
        message: `${agent} must be allowed to read /llms.txt and blocked from the dashboard root`
      })
    }
  }

  for (const agent of golden.aiSearchAgentsAllowedFullSite) {
    if (robots.isAllowed(`${SITE_URL}/`, agent) !== true) {
      findings.push({severity: 'fail', id: 'robots-ai-search-policy', message: `${agent} must be allowed to read the full site`})
    }
  }

  const expectedSet = new Set(expectedAgents)
  for (const agent of liveAgents) {
    if (!expectedSet.has(agent) && agent !== '*') {
      findings.push({
        severity: 'warn',
        id: 'robots-ai-crawler-new',
        message: `"User-agent: ${agent}" appears in the live robots.txt but is not in the golden snapshot -- ` +
          'update audits/fixtures/golden/robots-ai-crawlers.json to acknowledge the addition'
      })
    }
  }

  return findings
}

async function main() {
  let body
  let contentUsageHeader
  try {
    const res = await fetchStable(ROBOTS_URL)
    if (!res.ok) {
      process.exit(report('validate-robots', [
        {severity: 'fail', id: 'robots-fetch', message: `HTTP ${res.status} fetching ${ROBOTS_URL}`}
      ]))
    }
    contentUsageHeader = res.headers.get('content-usage')
    body = await res.text()
  } catch (err) {
    process.exit(report('validate-robots', [
      {severity: 'fail', id: 'robots-fetch', message: `fetch failed: ${err.message}`}
    ]))
  }

  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'))
  const findings = validateRobots(body, golden, contentUsageHeader)
  process.exit(report('validate-robots', findings))
}

if (isMain(import.meta.url)) {
  main()
}
