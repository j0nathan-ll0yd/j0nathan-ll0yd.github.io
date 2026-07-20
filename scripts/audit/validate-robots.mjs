#!/usr/bin/env node
// scripts/audit/validate-robots.mjs -- B2. Parses the live robots.txt with
// robots-parser (RFC 9309-ish draft compliant), asserts the Sitemap:
// directive matches the served sitemap, asserts the Content-Signal line
// (contentsignals.org / IETF draft-romm-aipref-contentsignals -- not part of
// the classic robots.txt grammar, so robots-parser can't see it; checked via
// direct text match instead) is present, and diffs the AI-crawler User-agent
// sections against a committed golden snapshot (drift guard).

import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import robotsParser from 'robots-parser'
import {SITE_URL} from '@lifegames/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN_PATH = path.join(__dirname, '..', '..', 'tests', 'audit', 'golden', 'robots-ai-crawlers.json')

const ROBOTS_URL = `${SITE_URL}/robots.txt`
const EXPECTED_SITEMAP_URL = `${SITE_URL}/sitemap-index.xml`

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

/** Pure validation function: (robots.txt body) -> findings[]. Testable without network. */
export function validateRobots(body, golden) {
  const findings = []

  const robots = robotsParser(ROBOTS_URL, body)
  const sitemaps = robots.getSitemaps()
  if (!sitemaps.includes(EXPECTED_SITEMAP_URL)) {
    findings.push({
      severity: 'fail',
      id: 'robots-sitemap-directive',
      message: `Sitemap: directive ${JSON.stringify(sitemaps)} does not include the served sitemap ` + `${EXPECTED_SITEMAP_URL}`
    })
  }

  if (!/^Content-Signal:\s*\S/im.test(body)) {
    findings.push({
      severity: 'fail',
      id: 'robots-content-signal-missing',
      message: 'no "Content-Signal:" directive found (contentsignals.org / IETF draft-romm-aipref-contentsignals)'
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
          `(golden snapshot: tests/audit/golden/robots-ai-crawlers.json)`
      })
    }
  }
  const expectedSet = new Set(expectedAgents)
  for (const agent of liveAgents) {
    if (!expectedSet.has(agent) && agent !== '*') {
      findings.push({
        severity: 'warn',
        id: 'robots-ai-crawler-new',
        message: `"User-agent: ${agent}" appears in the live robots.txt but is not in the golden snapshot -- ` +
          'update tests/audit/golden/robots-ai-crawlers.json to acknowledge the addition'
      })
    }
  }

  return findings
}

async function main() {
  let body
  try {
    const res = await fetchStable(ROBOTS_URL)
    if (!res.ok) {
      process.exit(report('validate-robots', [
        {severity: 'fail', id: 'robots-fetch', message: `HTTP ${res.status} fetching ${ROBOTS_URL}`}
      ]))
      return
    }
    body = await res.text()
  } catch (err) {
    process.exit(report('validate-robots', [
      {severity: 'fail', id: 'robots-fetch', message: `fetch failed: ${err.message}`}
    ]))
    return
  }

  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'))
  const findings = validateRobots(body, golden)
  process.exit(report('validate-robots', findings))
}

if (isMain(import.meta.url)) {
  main()
}
