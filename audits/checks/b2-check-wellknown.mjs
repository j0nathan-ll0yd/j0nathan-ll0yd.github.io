#!/usr/bin/env node
// audits/checks/b2-check-wellknown.mjs -- B2. Structural assertions for the
// agent-discovery .well-known surface. Automates the manual monthly ARD
// re-verification chore documented in docs/discovery-surface.md ("A recurring
// issue tracks re-verification of all of the above on a monthly cadence").
//
// Two kinds of assertion:
//
// - FULL JSON Schema conformance for the documents whose upstream schema is
//   vendored under audits/vendor/agent-discovery/ (byte-identical to commit-pinned
//   blobs, digests in SOURCES.json): ai-catalog.json and ard.json against the ARD
//   schemas, and the MCP server card against the SEP-2127 extension schema.
//   b2-check-spec-currency.mjs watches those upstreams for revisions.
// - STRUCTURAL assertions (field presence, shape, served media type) for the rest
//   (webfinger, agent-skills/index.json, api-catalog), whose specs publish no
//   schema this repo vendors, plus the media types a schema cannot see.
//
// Then a live GET of every api-catalog item, which must answer a JSON object (or,
// while hiding, the developer API's focus-suppressed problem), the developer API's
// failure semantics as served (checkApiV1ErrorShape), and a live MCP
// exchange against every remote the card declares: both protocol eras, a
// tools/call per tool, resources/list, and resources/read of the ungated focus
// signal and llms-full.txt (see probeMcpRemotes).
//
// Each surface's assertions are a pure `validateX(json, contentType)` function
// (testable without network); main() below is just fetch-and-call.

import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CLOUDFRONT_BASE, ENDPOINTS, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
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
// agent-skills/index.json, api-catalog) plus a live GET of each api-catalog item, the
// developer API facade's failure answers, and one live MCP exchange, none of which the
// surface registry registers.
// Metadata only -- the hub reads it statically.
export const ARTIFACTS = []

// The MCP server card media type (SEP-2127) and the 2025-era protocol revision the
// liveness probe speaks. The probe uses the `initialize` handshake on purpose: it is
// what every deployed MCP client still sends first, and the server answers it on the
// stateless legacy leg.
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json'

// The media type ai-catalog.json is served as. A local choice: ARD §3.3 lists
// `application/ai-catalog+json` as the entry `type` for a "nested manifest / catalog of
// entries" (ards-project/ard-spec spec/ard.md at 9d33ea17, the pin since 2026-10-16).
// Restated here rather than imported from src/lib/edge/agent-paths.mjs, so the measurer
// does not share the value it measures.
export const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json'

// The MCP resources the live server must list: every JSON export except the three the
// LLM-channel policy withholds (health, sleep, workouts), plus llms-full.txt. Stated here
// from the contract, independently of src/lib/edge/agent-catalog.mjs, so a catalog edit
// that exposes a withheld export, or drops one, reds the probe.
const WITHHELD_EXPORTS = new Set([ENDPOINTS.health, ENDPOINTS.sleep, ENDPOINTS.workouts])
export const EXPECTED_RESOURCE_URIS = Object.freeze([
  ...Object.values(ENDPOINTS).filter((path) => !WITHHELD_EXPORTS.has(path)).map((path) => `${CLOUDFRONT_BASE}${path}`),
  `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`
])

// The resources the probe reads. No tool reads focus.json, so without this read the
// ungated focus reader never runs in the deployed runtime; llms-full.txt is the one
// resource that republishes backend text, behind the withheld-link check.
export const FOCUS_RESOURCE_URI = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`
export const LLMS_FULL_RESOURCE_URI = `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`

// The developer API facade's path version (is-agentic api-v1 plan). Restated here rather than
// imported from src/lib/edge/agent-paths.mjs, so the measurer does not share the value it measures.
export const API_V1_PATH = '/api/v1'

// The api-catalog items: one per public JSON export, all nine (the catalog is developer
// documentation, so the raw health exports are listed), at the developer API facade. Stated from
// the contract.
export const EXPECTED_API_CATALOG_ITEMS = Object.freeze(Object.values(ENDPOINTS).map((path) => `${SITE_URL}${API_V1_PATH}${path}`))

// The facade's focus-signal item, which no focus mode suppresses.
export const FOCUS_API_ITEM = `${SITE_URL}${API_V1_PATH}${ENDPOINTS.focus}`

// A withheld export the probe asks for by URI. The server must refuse it: listing it is a
// fail, and so is reading it.
export const WITHHELD_RESOURCE_URI = `${CLOUDFRONT_BASE}${ENDPOINTS.health}`
export const PROBE_PROTOCOL_VERSION = '2025-11-25'

// The modern revision, which the WebMCP script speaks: no handshake, a per-request
// `_meta` envelope, and mirrored Mcp-Method / Mcp-Name headers.
export const MODERN_PROTOCOL_VERSION = '2026-07-28'
const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': {name: 'b2-check-wellknown', version: '1'},
  'io.modelcontextprotocol/clientCapabilities': {}
}

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

/**
 * ai-catalog.json (ARD -- Agentic Resource Discovery). Pure -- testable without network.
 * The served media type is checked when `contentType` is given.
 */
export function validateAiCatalogShape(json, contentType) {
  const findings = schemaFindings(validators.aiCatalog, json, 'wellknown-ai-catalog-schema', 'ai-catalog.json')
  if (contentType !== undefined && !contentType.includes(AI_CATALOG_MEDIA_TYPE)) {
    findings.push({
      severity: 'fail',
      id: 'wellknown-ai-catalog-content-type',
      message: `expected Content-Type ${AI_CATALOG_MEDIA_TYPE}, got "${contentType}"`
    })
  }
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

/**
 * Cloudflare Access service-token headers for one URL. A preview Version URL sits behind Access
 * (atlas decision 0160), so an audit of it (`--base`) must authenticate. The token goes ONLY to
 * the audited origin: never to production, CloudFront, or any other host a discovery document
 * names. Pure -- testable without network.
 */
export function accessHeadersFor(url, base, env = process.env) {
  const id = env.CF_ACCESS_CLIENT_ID
  const secret = env.CF_ACCESS_CLIENT_SECRET
  if (!id || !secret || base === undefined || new URL(url).origin !== new URL(base).origin) {
    return {}
  }
  return {'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret}
}

/** The deploy under audit (`--base`); main() sets it. Access headers go to this origin only. */
let auditedBase

async function postMcp(url, message, extraHeaders = {}) {
  const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extraHeaders, ...accessHeadersFor(url, auditedBase)}
  const res = await fetchStable(url, {method: 'POST', headers, body: JSON.stringify(message)})
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${message.method}: ${text.slice(0, 200)}`)
  }
  return parseMcpBody(text, res.headers.get('content-type') || '')
}

/** One modern (2026-07-28) request: the `_meta` envelope plus the mirrored headers. */
function modernRequest(id, method, params = {}, name) {
  const headers = {'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': method, ...(name ? {'Mcp-Name': name} : {})}
  return {message: {jsonrpc: '2.0', id, method, params: {...params, _meta: ENVELOPE}}, headers}
}

/**
 * Judge the modern exchange. Pure -- testable without network. `server/discover` must
 * offer the modern revision and should report the card's identity (warn, as above).
 * Every `tools/call` must return a result that is not `isError`: a focus-suppressed
 * answer is a valid result, an upstream failure is not.
 */
export function judgeModernExchange({discover, calls, card}) {
  const findings = []
  const result = discover?.result
  if (discover?.jsonrpc !== '2.0' || !Array.isArray(result?.supportedVersions) || !result.supportedVersions.includes(MODERN_PROTOCOL_VERSION)) {
    findings.push({
      severity: 'fail',
      id: 'mcp-discover',
      message: `server/discover did not offer ${MODERN_PROTOCOL_VERSION}: ${JSON.stringify(discover).slice(0, 300)}`
    })
    return findings
  }
  const info = result._meta?.['io.modelcontextprotocol/serverInfo']
  if (card && (info?.name !== card.name || info?.version !== card.version)) {
    findings.push({
      severity: 'warn',
      id: 'mcp-server-card-mismatch',
      message: `server/discover serverInfo ${info?.name}@${info?.version} differs from the server card ${card.name}@${card.version}`
    })
  }
  for (const {name, response} of calls) {
    if (response?.result === undefined || response.result.isError === true) {
      findings.push({severity: 'fail', id: 'mcp-tool-call', message: `tools/call ${name} failed: ${JSON.stringify(response).slice(0, 300)}`})
    }
  }
  return findings
}

/**
 * Judge resources/list and the resources/read answers. Pure -- testable without network.
 *
 * - The list must be exactly EXPECTED_RESOURCE_URIS: a missing resource, and above all a
 *   withheld export that appears, both fail.
 * - focus.json must read as a focus document (a string `currentFocus`). The edge never
 *   gates it, so a suppression document there is a fail too.
 * - llms-full.txt must read as text, or as the suppression document during a hiding focus
 *   mode. An error fails, which includes the server refusing a copy that links a withheld
 *   export. Text that names a withheld path fails too: the probe does not trust the
 *   server's own refusal.
 * - A read of a withheld export must answer an error, never content.
 */
export function judgeResourceExchange({list, reads}) {
  const findings = []
  const listed = Array.isArray(list?.result?.resources) ? list.result.resources.map((resource) => resource.uri) : undefined
  const expected = [...EXPECTED_RESOURCE_URIS].sort()
  if (!listed || JSON.stringify([...listed].sort()) !== JSON.stringify(expected)) {
    findings.push({
      severity: 'fail',
      id: 'mcp-resources-list',
      message: `resources/list returned ${JSON.stringify(listed ?? list).slice(0, 400)}; expected the ${expected.length} URIs ${expected.join(', ')}`
    })
  }
  for (const {uri, response} of reads) {
    if (uri === WITHHELD_RESOURCE_URI) {
      if (response?.error === undefined) {
        findings.push({
          severity: 'fail',
          id: 'mcp-withheld-readable',
          message: `resources/read ${uri} did not answer an error: ${JSON.stringify(response).slice(0, 300)}`
        })
      }
      continue
    }
    const content = response?.result?.contents?.[0]
    const text = typeof content?.text === 'string' ? content.text : undefined
    let problem
    if (text === undefined || content.uri !== uri) {
      problem = `no content for ${uri}`
    } else if (uri === FOCUS_RESOURCE_URI) {
      let focus
      try {
        focus = JSON.parse(text)
      } catch {
        focus = undefined
      }
      if (typeof focus?.currentFocus !== 'string') {
        problem = 'focus.json did not read as a focus document'
      }
    } else if (text.trim() === '') {
      problem = `${uri} read empty`
    } else if ([...WITHHELD_EXPORTS].some((path) => text.includes(path))) {
      problem = `${uri} names a withheld export (${[...WITHHELD_EXPORTS].filter((path) => text.includes(path)).join(', ')})`
    }
    if (problem) {
      findings.push({
        severity: 'fail',
        id: 'mcp-resource-read',
        message: `resources/read ${uri} failed: ${problem}: ${JSON.stringify(response).slice(0, 300)}`
      })
    }
  }
  return findings
}

/**
 * The live MCP exchange, against every streamable-http remote the card declares, in
 * both protocol eras the server answers:
 *
 * - 2025-era: initialize, then tools/list on the negotiated revision. This is what
 *   deployed MCP clients send first.
 * - 2026-07-28: server/discover, then tools/call for every listed tool. This is the
 *   path public/js/webmcp.js uses, and the calls run a focus-gated read in the
 *   deployed runtime. Then resources/list (exactly the expected URIs) and
 *   resources/read of focus.json and llms-full.txt: no tool reads focus.json, so this
 *   read is the only one that runs the ungated focus reader in the deployed runtime.
 *
 * `measured` counts each era's exchange that returned parseable JSON-RPC, judged or not.
 */
export async function probeMcpRemotes(card, post = postMcp) {
  const findings = []
  let measured = 0
  const tag = (url) => (f) => ({...f, message: `${url}: ${f.message}`})
  for (const url of streamableRemotes(card)) {
    let toolsList
    try {
      const initialize = await post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {protocolVersion: PROBE_PROTOCOL_VERSION, capabilities: {}, clientInfo: {name: 'b2-check-wellknown', version: '1'}}
      })
      toolsList = await post(url, {jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}}, {
        'MCP-Protocol-Version': initialize?.result?.protocolVersion ?? PROBE_PROTOCOL_VERSION
      })
      measured++
      findings.push(...judgeMcpExchange({initialize, toolsList, card}).map(tag(url)))
    } catch (err) {
      findings.push({severity: 'fail', id: 'mcp-unreachable', message: `${url}: ${err instanceof Error ? err.message : String(err)}`})
      continue
    }
    try {
      const discoverRequest = modernRequest(3, 'server/discover')
      const discover = await post(url, discoverRequest.message, discoverRequest.headers)
      const names = Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools.map((tool) => tool.name) : []
      const calls = []
      for (const [index, name] of names.entries()) {
        const callRequest = modernRequest(4 + index, 'tools/call', {name, arguments: {}}, name)
        calls.push({name, response: await post(url, callRequest.message, callRequest.headers)})
      }
      const listRequest = modernRequest(100, 'resources/list')
      const list = await post(url, listRequest.message, listRequest.headers)
      const reads = []
      for (const [index, uri] of [FOCUS_RESOURCE_URI, LLMS_FULL_RESOURCE_URI, WITHHELD_RESOURCE_URI].entries()) {
        const readRequest = modernRequest(101 + index, 'resources/read', {uri}, uri)
        reads.push({uri, response: await post(url, readRequest.message, readRequest.headers)})
      }
      measured++
      findings.push(...judgeModernExchange({discover, calls, card}).map(tag(url)))
      findings.push(...judgeResourceExchange({list, reads}).map(tag(url)))
    } catch (err) {
      findings.push({severity: 'fail', id: 'mcp-modern-unreachable', message: `${url}: ${err instanceof Error ? err.message : String(err)}`})
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

/** The `item` hrefs of an api-catalog linkset, in document order. */
export function apiCatalogItems(json) {
  return Array.isArray(json?.linkset) ? json.linkset.flatMap((entry) => (Array.isArray(entry.item) ? entry.item : [])).map((item) => item?.href) : []
}

/**
 * Judge the item set. Pure -- testable without network. The items must be exactly
 * EXPECTED_API_CATALOG_ITEMS, and each must carry a `service-desc` in its own linkset entry.
 */
export function judgeApiCatalogItems(json) {
  const findings = []
  const items = apiCatalogItems(json)
  if (JSON.stringify([...items].sort()) !== JSON.stringify([...EXPECTED_API_CATALOG_ITEMS].sort())) {
    findings.push({
      severity: 'fail',
      id: 'wellknown-api-catalog-items',
      message: `api-catalog items are ${JSON.stringify(items)}; expected the ${EXPECTED_API_CATALOG_ITEMS.length} JSON exports ${
        EXPECTED_API_CATALOG_ITEMS.join(', ')
      }`
    })
  }
  for (const href of items) {
    const entry = json.linkset.find((candidate) => candidate.anchor === href)
    if (!Array.isArray(entry?.['service-desc']) || entry['service-desc'].length === 0) {
      findings.push({
        severity: 'fail',
        id: 'wellknown-api-catalog-item-no-service-desc',
        message: `api-catalog item ${href} has no linkset entry with a "service-desc"`
      })
    }
  }
  return findings
}

/**
 * Judge one item's live answer. Pure -- testable without network. An item must answer JSON:
 *
 * - a 2xx `application/json` body that is a JSON object (every export is one); or
 * - while a hiding focus mode is active, the facade's focus-suppressed problem: 503,
 *   `application/problem+json`, with `suppressed: true` and a string `reason`. Never for
 *   focus.json, which the gate never suppresses (mantle-LifegamesPortal src/edge/focus-gate.js).
 *
 * Anything else fails: above all the S3 XML `AccessDenied` 403 the CloudFront root answered
 * when it was the item, the HTML 404 page, and any redirect.
 */
export function judgeApiCatalogItemAnswer({href, status, contentType, body}) {
  let json
  try {
    json = JSON.parse(body)
  } catch {
    json = undefined
  }
  const jsonType = /^application\/json\b/i.test(contentType)
  const object = json !== null && typeof json === 'object'
  if (status >= 200 && status < 300 && jsonType && object) {
    return []
  }
  const problemType = /^application\/problem\+json\b/i.test(contentType)
  if (status === 503 && problemType && href !== FOCUS_API_ITEM && json?.suppressed === true && typeof json.reason === 'string') {
    return []
  }
  return [{
    severity: 'fail',
    id: 'wellknown-api-catalog-item-not-json',
    message: `api-catalog item ${href} answered HTTP ${status} ${contentType || '(no Content-Type)'}, not a JSON export or suppression: ${
      String(body).slice(0, 120)
    }`
  }]
}

/**
 * Fetch every api-catalog item and judge its answer. `measured` counts the items whose answer was
 * held. Each item is a site URL, so it is fetched from the deploy under audit (`rebase`).
 */
export async function probeApiCatalogItems(json, get = fetchStable, base = SITE_URL) {
  const findings = judgeApiCatalogItems(json)
  let measured = 0
  for (const href of apiCatalogItems(json)) {
    let answer
    try {
      const url = rebase(href, base)
      const res = await get(url, {headers: {Accept: 'application/json', ...accessHeadersFor(url, base)}, redirect: 'manual'})
      answer = {href, status: res.status, contentType: res.headers.get('content-type') || '', body: await res.text()}
    } catch (err) {
      findings.push({
        severity: 'fail',
        id: 'wellknown-api-catalog-item-unreachable',
        message: `api-catalog item ${href}: ${err instanceof Error ? err.message : String(err)}`
      })
      continue
    }
    measured++
    findings.push(...judgeApiCatalogItemAnswer(answer))
  }
  return {measured, findings}
}

/** The api-catalog: its shape and media type, then a live answer from every item. */
async function checkApiCatalog(base) {
  const catalog = await fetchJson(`${base}/.well-known/api-catalog`)
  if (catalog.error) {
    return {measured: 0, findings: [{severity: 'fail', id: 'wellknown-api-catalog-fetch', message: catalog.error}]}
  }
  const items = await probeApiCatalogItems(catalog.json, fetchStable, base)
  return {measured: 1 + items.measured, findings: [...validateApiCatalogShape(catalog.json, catalog.contentType), ...items.findings]}
}

// ---------------------------------------------------------------------------
// Arm `api-v1-error-shape`: the developer API facade's failure semantics as served.
//
// Property: every failure under /api answers an RFC 9457 problem, and every facade answer states
// its rate limit (draft-ietf-httpapi-ratelimit-headers-11). Seam: the Worker route and the
// Cloudflare edge in front of it. No existing measurer sees it: the item arm above asserts only
// 2xx bodies and the suppression problem, and B5 lychee follows links and never reads an error body.
// ---------------------------------------------------------------------------

/** The RFC 9457 media type (section 3). */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json'

/** The facade probes, each with the status RFC 9457 and RFC 9110 say it must answer. */
export const API_V1_ERROR_PROBES = Object.freeze([
  Object.freeze({label: 'unknown export', path: `${API_V1_PATH}/__not_a_resource__.json`, method: 'GET', status: 404}),
  Object.freeze({label: 'unsafe method', path: `${API_V1_PATH}${ENDPOINTS.books}`, method: 'POST', status: 405}),
  Object.freeze({label: 'unknown path under /api', path: '/api/nope', method: 'GET', status: 404})
])

/** The valid facade path the header probe reads: the focus signal, which no focus mode suppresses. */
export const API_V1_HEADER_PROBE_PATH = `${API_V1_PATH}${ENDPOINTS.focus}`

/**
 * Judge one failure answer. Pure -- testable without network. It must be the expected status,
 * served as application/problem+json, with `type` an absolute URI, a string `title`, a `status`
 * member equal to the HTTP status, and `instance` the request path. A 405 must also send `Allow`.
 */
export function judgeProblemAnswer({probe, status, contentType, allow, body}) {
  const id = 'api-v1-error-shape'
  const label = `${probe.method} ${probe.path}`
  if (status !== probe.status) {
    return [{severity: 'fail', id, message: `${label} (${probe.label}) answered HTTP ${status}; expected ${probe.status}`}]
  }
  if (!contentType.toLowerCase().startsWith(PROBLEM_MEDIA_TYPE)) {
    return [{
      severity: 'fail',
      id,
      message: `${label} answered ${contentType || '(no Content-Type)'}, not ${PROBLEM_MEDIA_TYPE}: ${String(body).slice(0, 120)}`
    }]
  }
  let json
  try {
    json = JSON.parse(body)
  } catch {
    return [{severity: 'fail', id, message: `${label} answered a problem body that is not JSON: ${String(body).slice(0, 120)}`}]
  }
  const findings = []
  if (typeof json?.type !== 'string' || !URL.canParse(json.type)) {
    findings.push({severity: 'fail', id, message: `${label}: problem "type" ${JSON.stringify(json?.type)} is not an absolute URI`})
  }
  if (typeof json?.title !== 'string' || json.title.length === 0) {
    findings.push({severity: 'fail', id, message: `${label}: problem has no "title"`})
  }
  if (json?.status !== status) {
    findings.push({severity: 'fail', id, message: `${label}: problem "status" ${JSON.stringify(json?.status)} differs from HTTP ${status}`})
  }
  if (json?.instance !== probe.path) {
    findings.push({severity: 'fail', id, message: `${label}: problem "instance" ${JSON.stringify(json?.instance)} is not the request path`})
  }
  if (probe.status === 405 && !/\bGET\b/.test(allow ?? '')) {
    findings.push({severity: 'fail', id, message: `${label}: a 405 must send Allow naming GET, got ${JSON.stringify(allow)}`})
  }
  return findings
}

/** The parameters of each Structured Field List member (`"name";k=v;k=v`), by member name. */
export function structuredListParams(value) {
  const members = new Map()
  for (const member of String(value ?? '').split(',')) {
    const [name, ...params] = member.trim().split(';')
    const key = /^"[^"]*"$/.test(name ?? '') ? name.slice(1, -1) : null
    if (key === null) {
      continue
    }
    members.set(key, Object.fromEntries(params.map((param) => param.trim().split('=')).filter((pair) => pair.length === 2)))
  }
  return members
}

/**
 * Judge the RateLimit fields of one facade answer. Pure -- testable without network.
 * `RateLimit-Policy` must name a policy with an Integer `q` and `w` (draft section 3.1); `RateLimit`
 * must name that policy with an Integer `r` and `t` (draft section 4.1).
 */
export function judgeRateLimitHeaders({policy, rateLimit}) {
  const id = 'api-v1-error-shape'
  const integer = (value) => /^\d+$/.test(value ?? '')
  const policies = structuredListParams(policy)
  const named = [...policies].find(([, params]) => integer(params.q) && integer(params.w))
  if (!named) {
    return [{severity: 'fail', id, message: `${API_V1_HEADER_PROBE_PATH}: RateLimit-Policy ${JSON.stringify(policy)} names no policy with q and w`}]
  }
  const limit = structuredListParams(rateLimit).get(named[0])
  if (!limit || !integer(limit.r) || !integer(limit.t)) {
    return [{
      severity: 'fail',
      id,
      message: `${API_V1_HEADER_PROBE_PATH}: RateLimit ${JSON.stringify(rateLimit)} carries no r and t for policy "${named[0]}"`
    }]
  }
  return []
}

/** Probe the facade's failures and its rate-limit fields. `measured` counts the answers held. */
export async function checkApiV1ErrorShape(base, get = fetchStable) {
  const findings = []
  let measured = 0
  const ask = async (path, method) => {
    const url = `${base}${path}`
    return get(url, {method, headers: {Accept: 'application/json', ...accessHeadersFor(url, base)}, redirect: 'manual'})
  }
  for (const probe of API_V1_ERROR_PROBES) {
    try {
      const res = await ask(probe.path, probe.method)
      const body = await res.text()
      measured++
      findings.push(
        ...judgeProblemAnswer({probe, status: res.status, contentType: res.headers.get('content-type') || '', allow: res.headers.get('allow'), body})
      )
    } catch (err) {
      findings.push({
        severity: 'fail',
        id: 'api-v1-error-shape-unreachable',
        message: `${probe.method} ${probe.path}: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }
  try {
    const res = await ask(API_V1_HEADER_PROBE_PATH, 'GET')
    await res.text()
    measured++
    findings.push(...judgeRateLimitHeaders({policy: res.headers.get('ratelimit-policy'), rateLimit: res.headers.get('ratelimit')}))
  } catch (err) {
    findings.push({
      severity: 'fail',
      id: 'api-v1-error-shape-unreachable',
      message: `GET ${API_V1_HEADER_PROBE_PATH}: ${err instanceof Error ? err.message : String(err)}`
    })
  }
  return {measured, findings}
}

// Never throws -- every expected failure mode (network error, non-2xx, bad
// JSON) resolves to `{ error }`. main() also uses Promise.allSettled so an
// unexpected validator rejection cannot discard the other checks (C77).
async function fetchJson(url, headers) {
  let res
  try {
    res = await fetchStable(url, {headers: {...headers, ...accessHeadersFor(url, auditedBase)}})
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
  const baseArgument = baseIndex > 0 ? process.argv[baseIndex + 1] : SITE_URL
  if (typeof baseArgument !== 'string' || !URL.canParse(baseArgument)) {
    console.error('usage: node audits/checks/b2-check-wellknown.mjs [--base <absolute URL of the deploy to audit>]')
    console.error('  A preview Version URL sits behind Cloudflare Access: set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.')
    process.exit(2)
  }
  const base = baseArgument.replace(/\/$/, '')
  auditedBase = base
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
    checkApiCatalog(base),
    checkApiV1ErrorShape(base),
    checkMcpChain(base)
  ])
  const results = settled.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
    return {measured: 0, findings: [{severity: 'fail', id: 'wellknown-check-rejected', message: `unexpected check rejection: ${message}`}]}
  })
  // One per discovery artifact held and judged, plus one per api-catalog item whose
  // answer was held and judged, plus one per developer API probe answered, plus one per MCP
  // remote and protocol era that answered.
  // A partial sweep is a finding; reaching none of them is the darkness the dead-man
  // reports.
  const measured = results.reduce((total, r) => total + r.measured, 0)
  process.exit(report('check-wellknown', results.flatMap((r) => r.findings), measured))
}

if (isMain(import.meta.url)) {
  main()
}
