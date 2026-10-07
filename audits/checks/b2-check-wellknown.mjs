#!/usr/bin/env node
// audits/checks/b2-check-wellknown.mjs -- B2. Structural assertions for the
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

import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import Ajv2020 from 'ajv/dist/2020.js'
import {fetchStable, isMain, report} from '../lib/http.mjs'

// Pinned per docs/discovery-surface.md "Agent-discovery conformance notes"
// (point-in-time 2026-08-22). A monthly T3 skill re-verifies this against
// the upstream specs; bump only after that re-verification, not casually.
export const PINNED_ARD_SPEC_VERSION = '1.0'

// The agentskills.io discovery schema the served index declares, pinned the
// same way and re-verified on the same monthly cadence. Asserting the exact
// $schema URL is how a version bump becomes visible here: the shape check
// below is written against 0.2.0, so a silent move to another version would
// otherwise be validated by the wrong rules.
export const PINNED_AGENT_SKILLS_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'

// A18 coverage declaration (atlas decision 0145). Empty is a claim, not a gap: what
// this runner holds is the agent-discovery surface (webfinger, ai-catalog.json,
// ard.json, the MCP server card at its canonical and compatibility URLs,
// agent-skills/index.json, api-catalog) plus one live MCP exchange, none of which the
// surface registry registers. Metadata only -- the hub reads it statically.
export const ARTIFACTS = []

// The MCP server card media type (SEP-2127) and the 2025-era protocol revision the
// liveness probe speaks. The probe uses the `initialize` handshake on purpose: it is
// what every deployed MCP client still sends first, and the server answers it on the
// stateless legacy leg.
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json'
export const PROBE_PROTOCOL_VERSION = '2025-11-25'

/**
 * The vendored upstream schemas, byte-identical to the commit-pinned blobs listed in
 * audits/vendor/agent-discovery/SOURCES.json. Validation here is FULL schema
 * conformance, unlike the structural assertions above: these specifications publish a
 * schema, so the check can ask the upstream's own question.
 */
const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'agent-discovery')
const vendored = (file) => JSON.parse(readFileSync(join(VENDOR_DIR, file), 'utf8'))
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  formats: {uri: (value) => URL.canParse(value), 'date-time': (value) => !Number.isNaN(Date.parse(value))}
})
ajv.addSchema(vendored('mcp-server-card.schema.json'), 'mcp-server-card')
ajv.addSchema(vendored('ard-ai-catalog.schema.json'), 'ard-ai-catalog')
ajv.addSchema(vendored('ard-entry.schema.json'), 'ard-entry')
const validators = {
  serverCard: ajv.getSchema('mcp-server-card#/$defs/ServerCard'),
  aiCatalog: ajv.getSchema('ard-ai-catalog'),
  ardManifest: ajv.getSchema('ard-entry#/$defs/ArdManifest')
}

function schemaFindings(validate, json, id, label) {
  if (validate(json)) {
    return []
  }
  return validate.errors.map((error) => ({severity: 'fail', id, message: `${label} ${error.instancePath || '/'} ${error.message}`}))
}

// "sha256:" plus a lowercase hex digest, the form the served index uses.
const SKILL_DIGEST = /^sha256:[a-f0-9]{64}$/

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
  const findings = schemaFindings(validators.aiCatalog, json, 'wellknown-ai-catalog-schema', 'ai-catalog.json')
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

/**
 * An MCP server card (SEP-2127). Pure -- testable without network. Full conformance
 * against the vendored ext-server-card schema, plus the two properties the schema
 * cannot see: the served media type (when `contentType` is given) and at least one
 * streamable-http remote, without which the card advertises nothing to connect to.
 */
export function validateMcpServerCard(json, contentType) {
  const findings = schemaFindings(validators.serverCard, json, 'wellknown-mcp-server-card-schema', 'server card')
  if (contentType !== undefined && !contentType.includes(SERVER_CARD_MEDIA_TYPE)) {
    findings.push({
      severity: 'fail',
      id: 'wellknown-mcp-server-card-content-type',
      message: `expected Content-Type ${SERVER_CARD_MEDIA_TYPE}, got "${contentType}"`
    })
  }
  if (!streamableRemotes(json).length) {
    findings.push({severity: 'fail', id: 'wellknown-mcp-server-card-no-remote', message: 'server card declares no streamable-http remote'})
  }
  return findings
}

/** The streamable-http remote URLs a card declares. */
export function streamableRemotes(card) {
  return Array.isArray(card?.remotes) ? card.remotes.filter((r) => r?.type === 'streamable-http' && typeof r.url === 'string').map((r) => r.url) : []
}

/** ard.json (ARD v0.91 ArdManifest). Pure -- full conformance against the vendored ard-entry schema. */
export function validateArdManifest(json) {
  return schemaFindings(validators.ardManifest, json, 'wellknown-ard-schema', 'ard.json')
}

/**
 * One MCP response body, JSON or a single-response SSE stream. The stateless legacy
 * leg answers with `text/event-stream` when the client accepts it; the message is the
 * last `data:` line.
 */
export function parseMcpBody(text, contentType) {
  if (!contentType.includes('text/event-stream')) {
    return JSON.parse(text)
  }
  const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
  if (data.length === 0) {
    throw new Error('SSE response carried no data line')
  }
  return JSON.parse(data[data.length - 1])
}

/**
 * Judge the initialize and tools/list answers. Pure -- testable without network.
 * A valid JSON-RPC 2.0 result is required for both; every tool must declare
 * readOnlyHint, since the server is advertised as read-only; and serverInfo should
 * match the card (SEP-2127 "Consistency with Runtime Behavior", a SHOULD, so warn).
 */
export function judgeMcpExchange({initialize, toolsList, card}) {
  const findings = []
  const isResult = (message, id) => message?.jsonrpc === '2.0' && message.id === id && message.result !== undefined && message.error === undefined
  if (!isResult(initialize, 1) || typeof initialize.result.protocolVersion !== 'string' || typeof initialize.result.serverInfo?.name !== 'string') {
    findings.push({
      severity: 'fail',
      id: 'mcp-initialize',
      message: `initialize did not return a valid JSON-RPC result: ${JSON.stringify(initialize).slice(0, 300)}`
    })
    return findings
  }
  if (!isResult(toolsList, 2) || !Array.isArray(toolsList.result.tools) || toolsList.result.tools.length === 0) {
    findings.push({
      severity: 'fail',
      id: 'mcp-tools-list',
      message: `tools/list did not return a non-empty tools array: ${JSON.stringify(toolsList).slice(0, 300)}`
    })
    return findings
  }
  for (const tool of toolsList.result.tools) {
    if (tool?.annotations?.readOnlyHint !== true) {
      findings.push({severity: 'fail', id: 'mcp-tool-not-read-only', message: `tool "${tool?.name}" does not declare annotations.readOnlyHint: true`})
    }
  }
  const info = initialize.result.serverInfo
  if (card && (info.name !== card.name || info.version !== card.version)) {
    findings.push({
      severity: 'warn',
      id: 'mcp-server-card-mismatch',
      message: `serverInfo ${info.name}@${info.version} differs from the server card ${card.name}@${card.version}`
    })
  }
  return findings
}

async function postMcp(url, message, protocolVersion) {
  const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'}
  if (protocolVersion) {
    headers['MCP-Protocol-Version'] = protocolVersion
  }
  const res = await fetchStable(url, {method: 'POST', headers, body: JSON.stringify(message)})
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${message.method}: ${text.slice(0, 200)}`)
  }
  return parseMcpBody(text, res.headers.get('content-type') || '')
}

/**
 * The live MCP exchange, against every streamable-http remote the card declares:
 * initialize, then tools/list on the negotiated revision. `measured` counts remotes
 * that answered both requests with parseable JSON-RPC, judged or not.
 */
export async function probeMcpRemotes(card, post = postMcp) {
  const findings = []
  let measured = 0
  for (const url of streamableRemotes(card)) {
    try {
      const initialize = await post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {protocolVersion: PROBE_PROTOCOL_VERSION, capabilities: {}, clientInfo: {name: 'b2-check-wellknown', version: '1'}}
      })
      const toolsList = await post(url, {jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}},
        initialize?.result?.protocolVersion ?? PROBE_PROTOCOL_VERSION)
      measured++
      findings.push(...judgeMcpExchange({initialize, toolsList, card}).map((f) => ({...f, message: `${url}: ${f.message}`})))
    } catch (err) {
      findings.push({severity: 'fail', id: 'mcp-unreachable', message: `${url}: ${err instanceof Error ? err.message : String(err)}`})
    }
  }
  return {measured, findings}
}

/**
 * .well-known/agent-skills/index.json (agentskills.io discovery index). Pure --
 * testable without network. Shape only, matching this file's scope: the fields
 * the served index actually carries, not full conformance against the upstream
 * 0.2.0 JSON Schema. `digest` is optional in shape terms but is validated when
 * present, because a malformed digest is worse than an absent one -- a consumer
 * that cannot parse it may skip integrity checking silently.
 */
export function validateAgentSkillsIndexShape(json) {
  const findings = []
  assertFields(json, ['$schema', 'skills'], 'wellknown-agent-skills-shape', 'agent-skills/index.json', findings)

  if (json.$schema !== undefined && json.$schema !== PINNED_AGENT_SKILLS_SCHEMA) {
    findings.push({
      severity: 'warn',
      id: 'wellknown-agent-skills-schema-drift',
      message: `agent-skills/index.json "$schema" is "${json.$schema}", pinned constant is ` +
        `"${PINNED_AGENT_SKILLS_SCHEMA}" -- re-verify against schemas.agentskills.io`
    })
  }

  if (Array.isArray(json.skills)) {
    if (json.skills.length === 0) {
      findings.push({severity: 'fail', id: 'wellknown-agent-skills-no-skills', message: 'agent-skills/index.json "skills" is empty'})
    }
    for (const skill of json.skills) {
      assertFields(skill, ['name', 'description', 'type', 'url'], 'wellknown-agent-skills-skill-shape', 'agent-skills/index.json skills[] entry', findings)
      const label = skill.name ?? '(no name)'
      if (skill.url && !/^https:\/\//.test(skill.url)) {
        findings.push({
          severity: 'fail',
          id: 'wellknown-agent-skills-skill-url',
          message: `agent-skills/index.json skill "${label}" has a non-https url "${skill.url}"`
        })
      }
      if ('digest' in skill && !SKILL_DIGEST.test(skill.digest)) {
        findings.push({
          severity: 'fail',
          id: 'wellknown-agent-skills-skill-digest',
          message: `agent-skills/index.json skill "${label}" has digest "${skill.digest}", not a "sha256:<64 hex>" value`
        })
      }
    }
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
    return findings
  }
  // RFC 9727 section 4: the catalog lists its APIs as `item` links, and each API is
  // described by a `service-desc`. A linkset with neither names no API at all.
  if (!json.linkset.some((entry) => Array.isArray(entry.item) && entry.item.length > 0)) {
    findings.push({severity: 'fail', id: 'wellknown-api-catalog-no-item', message: 'api-catalog has no "item" link to any API (RFC 9727 section 4)'})
  }
  if (!json.linkset.some((entry) => Array.isArray(entry['service-desc']) && entry['service-desc'].length > 0)) {
    findings.push({severity: 'fail', id: 'wellknown-api-catalog-no-service-desc', message: 'api-catalog describes no API with a "service-desc" link'})
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

/**
 * `{measured, findings}` for one discovery artifact. `measured` is 1 only when this
 * run held the artifact's bytes and parsed them -- a network error, a non-2xx, or
 * unparseable JSON all mean nothing was judged, which is darkness rather than a
 * finding about the artifact's shape (atlas decision 0122).
 */
async function fetchAndValidate(url, validate, fetchErrorId, headers) {
  const {json, contentType, error} = await fetchJson(url, headers)
  if (error) {
    return {measured: 0, findings: [{severity: 'fail', id: fetchErrorId, message: error}]}
  }
  return {measured: 1, findings: validate(json, contentType)}
}

/**
 * Re-home a production URL onto the base under audit. Discovery documents name
 * production URLs; when this check audits a preview deploy (`--base <url>`), every
 * hop of the chain must stay on that preview, or the probe silently measures
 * production instead. A URL on another origin is left alone.
 */
export function rebase(url, base) {
  const target = new URL(url)
  if (target.origin !== new URL(SITE_URL).origin) {
    return url
  }
  const rebased = new URL(`${target.pathname}${target.search}`, base)
  return rebased.toString()
}

/**
 * The MCP discovery chain, walked the way a client walks it: the AI catalog's
 * server-card entry, then the card, then each remote it declares. This is the seam
 * the old shape check could not see -- it asserted that `transport.url` existed and
 * stayed green while that URL answered every MCP request with a CloudFront 403.
 */
async function checkMcpChain(base) {
  const catalog = await fetchJson(`${base}/.well-known/ai-catalog.json`)
  if (catalog.error) {
    return {measured: 0, findings: [{severity: 'fail', id: 'mcp-chain-catalog', message: catalog.error}]}
  }
  const entries = Array.isArray(catalog.json.entries) ? catalog.json.entries.filter((e) => e.type === SERVER_CARD_MEDIA_TYPE && e.url) : []
  if (entries.length === 0) {
    return {measured: 0, findings: [{severity: 'fail', id: 'mcp-chain-no-card', message: `ai-catalog.json has no ${SERVER_CARD_MEDIA_TYPE} entry`}]}
  }
  const findings = []
  let measured = 0
  for (const entry of entries) {
    const card = await fetchJson(rebase(entry.url, base), {Accept: SERVER_CARD_MEDIA_TYPE})
    if (card.error) {
      findings.push({severity: 'fail', id: 'wellknown-mcp-server-card-fetch', message: card.error})
      continue
    }
    measured++
    findings.push(...validateMcpServerCard(card.json, card.contentType))
    const rehomed = {...card.json, remotes: (card.json.remotes ?? []).map((r) => ({...r, url: typeof r.url === 'string' ? rebase(r.url, base) : r.url}))}
    const live = await probeMcpRemotes(rehomed)
    measured += live.measured
    findings.push(...live.findings)
  }
  return {measured, findings}
}

async function main() {
  const baseIndex = process.argv.indexOf('--base')
  const base = (baseIndex > 0 ? process.argv[baseIndex + 1] : SITE_URL).replace(/\/$/, '')
  const settled = await Promise.allSettled([
    fetchAndValidate(
      `${base}/.well-known/webfinger?resource=acct:jonathan@jonathanlloyd.me`,
      validateWebfingerShape,
      'wellknown-webfinger-fetch',
      // Accept: application/jrd+json is the correct request header for a JRD resource (the same
      // one the smoke suite sends). It does NOT avoid a markdown negotiation early-return:
      // negotiation has been homepage-only since PR #288, so this path cannot negotiate at all.
      // The old comment described the pre-#288 every-path middleware (atlas decision 0142 phase 7).
      {Accept: 'application/jrd+json'}
    ),
    fetchAndValidate(`${base}/.well-known/ai-catalog.json`, validateAiCatalogShape, 'wellknown-ai-catalog-fetch'),
    fetchAndValidate(`${base}/.well-known/ard.json`, validateArdManifest, 'wellknown-ard-fetch'),
    // The compatibility copy, judged on schema only: it is served as plain JSON.
    fetchAndValidate(`${base}/.well-known/mcp/server-card.json`, (json) => validateMcpServerCard(json), 'wellknown-mcp-server-card-compat-fetch'),
    fetchAndValidate(`${base}/.well-known/agent-skills/index.json`, validateAgentSkillsIndexShape, 'wellknown-agent-skills-fetch'),
    fetchAndValidate(`${base}/.well-known/api-catalog`, validateApiCatalogShape, 'wellknown-api-catalog-fetch'),
    checkMcpChain(base)
  ])
  const results = settled.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
    return {measured: 0, findings: [{severity: 'fail', id: 'wellknown-check-rejected', message: `unexpected check rejection: ${message}`}]}
  })
  // One per discovery artifact held and judged, plus one per MCP remote that answered
  // both requests. A partial sweep is a finding; reaching none of them is the darkness
  // the dead-man reports.
  const measured = results.reduce((total, r) => total + r.measured, 0)
  process.exit(report('check-wellknown', results.flatMap((r) => r.findings), measured))
}

if (isMain(import.meta.url)) {
  main()
}
