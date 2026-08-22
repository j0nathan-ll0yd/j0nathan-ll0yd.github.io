#!/usr/bin/env node
// scripts/audit/check-wellknown.mjs -- B2. Structural assertions for the
// agent-discovery .well-known surface. Automates the manual monthly ARD
// re-verification chore documented in docs/discovery-surface.md ("A recurring
// issue tracks re-verification of all of the above on a monthly cadence").
//
// Assertions are deliberately STRUCTURAL (field presence / shape), not full
// JSON Schema conformance against the upstream specs -- those specs are young
// and moving (see docs/discovery-surface.md "Spec-drift watch"). Pinned
// spec-version constants below are re-verified by the monthly T3
// audit-spec-checklist skill (Phase 5 of the monorepo audit plan), not by
// this script.
//
// Each surface's assertions are a pure `validateXShape(json, contentType)`
// function (testable without network); main() below is just fetch-and-call.

import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable, isMain, report} from './lib/http.mjs'

// Pinned per docs/discovery-surface.md "Agent-discovery conformance notes"
// (point-in-time 2026-08-22). A monthly T3 skill re-verifies this against
// the upstream specs; bump only after that re-verification, not casually.
export const PINNED_ARD_SPEC_VERSION = '1.0'

function assertFields(obj, fields, id, label, findings) {
  for (const field of fields) {
    if (!(field in obj)) {
      findings.push({severity: 'fail', id, message: `${label} missing required field "${field}"`})
    }
  }
}

/** webfinger (RFC 7033): a JRD with a `subject` and a `links` array. Pure -- testable without network. */
export function validateWebfingerShape(json, contentType) {
  const findings = []
  if (!contentType.includes('application/jrd+json')) {
    findings.push({severity: 'fail', id: 'wellknown-webfinger-content-type', message: `expected Content-Type application/jrd+json, got "${contentType}"`})
  }
  assertFields(json, ['subject', 'links'], 'wellknown-webfinger-shape', 'webfinger JRD', findings)
  if (json.subject && !/^acct:/.test(json.subject)) {
    findings.push({
      severity: 'fail',
      id: 'wellknown-webfinger-subject',
      message: `webfinger "subject" (${json.subject}) is not an "acct:" URI (RFC 7033 §3.1)`
    })
  }
  if (Array.isArray(json.links) && !json.links.some((l) => l.rel === 'self')) {
    findings.push({severity: 'warn', id: 'wellknown-webfinger-no-self-link', message: 'webfinger response has no rel="self" link'})
  }
  return findings
}

/** ai-catalog.json (ARD -- Agentic Resource Discovery). Pure -- testable without network. */
export function validateAiCatalogShape(json) {
  const findings = []
  assertFields(json, ['specVersion', 'entries'], 'wellknown-ai-catalog-shape', `ai-catalog.json (ARD specVersion ${PINNED_ARD_SPEC_VERSION})`, findings)
  if (json.specVersion !== undefined && String(json.specVersion) !== PINNED_ARD_SPEC_VERSION) {
    findings.push({
      severity: 'warn',
      id: 'wellknown-ai-catalog-spec-version-drift',
      message: `ai-catalog.json "specVersion" is "${json.specVersion}", pinned constant is ` +
        `"${PINNED_ARD_SPEC_VERSION}" -- re-verify against ards-project/ard-spec`
    })
  }
  if (Array.isArray(json.entries)) {
    if (json.entries.length === 0) {
      findings.push({severity: 'fail', id: 'wellknown-ai-catalog-no-entries', message: 'ai-catalog.json "entries" is empty'})
    }
    for (const entry of json.entries) {
      assertFields(entry, ['identifier', 'displayName', 'type'], 'wellknown-ai-catalog-entry-shape', 'ai-catalog.json entries[] entry', findings)
      if (entry.identifier && !/^urn:air:/.test(entry.identifier)) {
        findings.push({
          severity: 'fail',
          id: 'wellknown-ai-catalog-entry-identifier',
          message: `ai-catalog.json entry identifier "${entry.identifier}" is not an RFC 8141 ` + '"urn:air:<publisher>:<namespace>:<name>" URN'
        })
      }
      if (!('url' in entry) && !('data' in entry)) {
        findings.push({
          severity: 'fail',
          id: 'wellknown-ai-catalog-entry-no-locator',
          message: `ai-catalog.json entry "${entry.identifier ?? '(no identifier)'}" has neither "url" nor "data"`
        })
      }
    }
  }
  return findings
}

/** .well-known/mcp/server-card.json (MCP server descriptor). Pure -- testable without network. */
export function validateMcpServerCardShape(json) {
  const findings = []
  assertFields(json, ['name', 'serverInfo', 'capabilities', 'transport', 'resources'], 'wellknown-mcp-server-card-shape', 'mcp/server-card.json', findings)
  if (json.transport && !json.transport.url) {
    findings.push({severity: 'fail', id: 'wellknown-mcp-server-card-transport-url', message: 'mcp/server-card.json "transport" is missing a "url"'})
  }
  if (Array.isArray(json.resources) && json.resources.length === 0) {
    findings.push({severity: 'warn', id: 'wellknown-mcp-server-card-no-resources', message: 'mcp/server-card.json "resources" array is empty'})
  }
  return findings
}

/** .well-known/api-catalog (RFC 9727 linkset). Pure -- testable without network. */
export function validateApiCatalogShape(json, contentType) {
  const findings = []
  if (!contentType.includes('application/linkset+json')) {
    findings.push({
      severity: 'fail',
      id: 'wellknown-api-catalog-content-type',
      message: `expected Content-Type application/linkset+json (RFC 9727), got "${contentType}"`
    })
  }
  if (!Array.isArray(json.linkset) || json.linkset.length === 0) {
    findings.push({severity: 'fail', id: 'wellknown-api-catalog-linkset', message: 'api-catalog "linkset" is missing or empty'})
  }
  return findings
}

// Never throws -- every expected failure mode (network error, non-2xx, bad
// JSON) resolves to `{ error }`. main() also uses Promise.allSettled so an
// unexpected validator rejection cannot discard the other checks (C77).
async function fetchJson(url, headers) {
  let res
  try {
    res = await fetchStable(url, headers ? {headers} : undefined)
  } catch (err) {
    return {error: `fetch failed for ${url}: ${err.message}`}
  }
  if (!res.ok) {
    return {error: `HTTP ${res.status} fetching ${url}`}
  }
  const contentType = res.headers.get('content-type') || ''
  let json
  try {
    json = await res.json()
  } catch (err) {
    return {error: `${url} did not return valid JSON: ${err.message}`}
  }
  return {json, contentType}
}

async function fetchAndValidate(url, validate, fetchErrorId, headers) {
  const {json, contentType, error} = await fetchJson(url, headers)
  if (error) {
    return [{severity: 'fail', id: fetchErrorId, message: error}]
  }
  return validate(json, contentType)
}

async function main() {
  const settled = await Promise.allSettled([
    fetchAndValidate(
      `${SITE_URL}/.well-known/webfinger?resource=acct:jonathan@jonathanlloyd.me`,
      validateWebfingerShape,
      'wellknown-webfinger-fetch',
      // Accept: application/jrd+json avoids the text/markdown negotiation
      // early-return in functions/_middleware.ts (same header the smoke suite uses).
      {Accept: 'application/jrd+json'}
    ),
    fetchAndValidate(`${SITE_URL}/.well-known/ai-catalog.json`, validateAiCatalogShape, 'wellknown-ai-catalog-fetch'),
    fetchAndValidate(`${SITE_URL}/.well-known/mcp/server-card.json`, validateMcpServerCardShape, 'wellknown-mcp-server-card-fetch'),
    fetchAndValidate(`${SITE_URL}/.well-known/api-catalog`, validateApiCatalogShape, 'wellknown-api-catalog-fetch')
  ])
  const results = settled.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
    return [{severity: 'fail', id: 'wellknown-check-rejected', message: `unexpected check rejection: ${message}`}]
  })
  process.exit(report('check-wellknown', results.flat()))
}

if (isMain(import.meta.url)) {
  main()
}
