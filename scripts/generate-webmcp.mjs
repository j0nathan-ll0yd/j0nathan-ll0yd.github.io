// Generates the agent-discovery surface from the ONE agent catalog
// (src/lib/edge/agent-catalog.mjs). Run via `pnpm run generate:webmcp` (wired into
// prebuild). Every output is byte-stable across runs; edit this file or the catalog,
// never the outputs.
//
//   public/js/webmcp.js                          WebMCP tools (document.modelContext.registerTool)
//   public/.well-known/mcp/server-card.json      SEP-2127 card, compatibility copy of /mcp/server-card
//   public/.well-known/agent-skills/index.json   agentskills.io discovery index
//   public/.well-known/ai-catalog.json           AI catalog (ARD predecessor path)
//   public/.well-known/ard.json                  the same catalog at the ARD v0.91 path
//   public/.well-known/api-catalog               RFC 9727 linkset
//   public/openapi.json                          OpenAPI 3.1 for the JSON exports
//
// Prose comes from @j0nathan-ll0yd/copy and addressing from
// @j0nathan-ll0yd/portal-contract, both through the catalog or directly. The export
// schemas come from the contract's raw-schemas; none is copied by hand.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {basename, dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import identity from '@j0nathan-ll0yd/copy/identity.flat.json' with {type: 'json'}
import llm from '@j0nathan-ll0yd/copy/llm.flat.json' with {type: 'json'}
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {
  AGENT_PATHS,
  API_DEPRECATION_WINDOW_DAYS,
  API_PROBLEMS,
  API_V1_BASE,
  API_V1_RATE_LIMIT,
  DATA_SOURCES,
  fillTemplate,
  FOCUS_SIGNAL_PATH,
  LLM_DATA_SOURCE_DIRECTORY,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_SLUG,
  MCP_SERVER_VERSION,
  OPENAPI_DOCUMENT_VERSION,
  OPENAPI_MEDIA_TYPE,
  SERVER_CARD_JSON,
  SERVER_CARD_MEDIA_TYPE,
  SERVER_CARD_URL,
  TOOLS
} from '../src/lib/edge/agent-catalog.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const req = createRequire(import.meta.url)

// `--check` compares instead of writing: every generated file must already equal what this script
// would write, or the run exits 1 naming the drifted files. CI runs it (static-checks.yml, lint job)
// so a hand edit to a generated file, or a generator change committed without regenerating,
// cannot merge. The build regenerates anyway (prebuild), so drift would otherwise ship unreviewed.
const CHECK = process.argv.includes('--check')
const drifted = []

function emit(outPath, content) {
  if (CHECK) {
    if (!existsSync(outPath) || readFileSync(outPath, 'utf8') !== content) {
      drifted.push(outPath)
    }
    return
  }
  writeFileSync(outPath, content)
  console.log(`Generated ${outPath}`)
}

function write(relativePath, content) {
  emit(join(publicDir, relativePath), content)
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

// The project wiki page that documented the agent surface before /developers existed. A
// deliberate literal: it is a page on github.com, which no package owns.
const WIKI_LLM_CONTENT_SPEC = 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki/LLM-Content-Spec'

// ---------------------------------------------------------------------------
// WebMCP (Draft CG Report 2026-10-02): document.modelContext.registerTool(tool).
//
// The script registers the catalog's tools and executes each one as a tools/call
// against the site's own /mcp endpoint. It therefore carries no tool logic and no
// data host: every read goes through the server's focus gate, and the script stays
// small. Raw-served, so ES2017 syntax only. navigator.modelContext is the trailing
// fallback for older origin-trial builds, which exposed registerTool there.
// ---------------------------------------------------------------------------
const webmcpTools = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: {type: 'object', properties: {}},
  annotations: tool.untrustedContent ? {readOnlyHint: true, untrustedContentHint: true} : {readOnlyHint: true}
}))

const webmcp = `(function () {
  var tools = ${JSON.stringify(webmcpTools)};
  var version = ${JSON.stringify(MCP_PROTOCOL_VERSION)};
  function call(name, options) {
    return fetch(${JSON.stringify(AGENT_PATHS.mcp)}, {
      method: 'POST',
      signal: options && options.signal,
      headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version, 'Mcp-Method': 'tools/call', 'Mcp-Name': name},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: name, arguments: {}, _meta: {'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': {name: 'webmcp', version: ${
  JSON.stringify(MCP_SERVER_VERSION)
}}, 'io.modelcontextprotocol/clientCapabilities': {}}}})
    }).then(function (res) { return res.json(); }).then(function (message) {
      if (message.error) { throw new Error(message.error.message); }
      var result = JSON.parse(message.result.content[0].text);
      if (message.result.isError) { throw new Error(JSON.stringify(result)); }
      return result;
    });
  }
  function register(modelContext) {
    tools.forEach(function (tool) {
      tool.execute = function (input, options) { return call(tool.name, options); };
      // One failed registration (a synchronous throw or a rejection) must not stop the rest.
      try { Promise.resolve(modelContext.registerTool(tool)).catch(function () {}); } catch (error) {}
    });
  }
  if (typeof document !== 'undefined' && document.modelContext && document.modelContext.registerTool) {
    register(document.modelContext);
  } else if (typeof navigator !== 'undefined' && navigator.modelContext && navigator.modelContext.registerTool) {
    register(navigator.modelContext);
  }
})();
`
write(join('js', 'webmcp.js'), webmcp)

// ---------------------------------------------------------------------------
// SEP-2127 server card, compatibility copy. Byte-identical to /mcp/server-card.
// ---------------------------------------------------------------------------
write(AGENT_PATHS.serverCardCompat.slice(1), SERVER_CARD_JSON)

// ---------------------------------------------------------------------------
// Agent Skills index. SKILL.md is HAND-WRITTEN apart from two generated blocks (rendered
// below); this script computes the digest from the resulting served bytes. A literal digest
// desyncs the moment SKILL.md is edited, and audits/checks/b2-check-wellknown.mjs validates the
// digest's FORMAT, not its match, so a stale one would ship green.
// ---------------------------------------------------------------------------
const skillMdPath = join(publicDir, '.well-known', 'agent-skills', 'portfolio-expert', 'SKILL.md')

// ADVERTISE ONLY WHAT WORKS: /developers is named (in SKILL.md and as the api-catalog
// service-doc) only once that page exists in this tree, so no deploy can link a 404.
const developersPage = ['developers.astro', join('developers', 'index.astro')].some((file) => existsSync(join(root, 'src', 'pages', file)))

/** Replace the body of one `BEGIN GENERATED: <name>` ... `END GENERATED: <name>` block. */
function renderBlock(source, name, body) {
  const begin = new RegExp(`<!-- BEGIN GENERATED: ${name}\\.[^>]*-->\n`).exec(source)
  const endMarker = `<!-- END GENERATED: ${name} -->`
  const end = source.indexOf(endMarker)
  if (!begin || end < begin.index) {
    throw new Error(`${skillMdPath} lost its generated ${name} markers`)
  }
  return `${source.slice(0, begin.index + begin[0].length)}${body}\n${source.slice(end)}`
}

// The Live Data Sources table is rendered from LLM_DATA_SOURCE_DIRECTORY, the same list
// get_data_sources serves. The LLM-channel data policy (LLM_CHANNEL_POLICY) therefore governs the
// skill too, and the table cannot drift from it.
const cell = (value) => String(value).replace(/\|/g, '\\|')
const directoryTable = [
  '| Data | Where to read it | Description |',
  '| --- | --- | --- |',
  ...LLM_DATA_SOURCE_DIRECTORY.map((s) => `| ${cell(s.name)} | <${s.url}> | ${cell(s.description)} |`)
].join('\n')

// The developer documentation links (owner answer, 2026-10-12): an LLM-facing file may link the
// developer documentation, /openapi.json and /developers, but never a raw health, sleep, or
// workouts export. Labels, URLs, and notes come from the same copy keys llms.txt uses.
const developerDocs = [llm.txt.whenToUseApi, ...(developersPage ? [llm.txt.whenToUseDevelopers] : [])]
const developerLinks = developerDocs.map((link) => `- **${link.label}:** <${fillTemplate(link.url, 'siteUrl', SITE_URL)}> — ${link.notes}`).join('\n')

const withDirectory = renderBlock(readFileSync(skillMdPath, 'utf8'), 'data-source directory', directoryTable)
const skillMd = renderBlock(withDirectory, 'developer documentation', developerLinks)
emit(skillMdPath, skillMd)

const skillMdDigest = createHash('sha256').update(skillMd).digest('hex')
write(AGENT_PATHS.agentSkillsIndex.slice(1), json({
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: 'portfolio-expert',
      description: llm.mcp.agentSkillDescription,
      type: 'skill-md',
      url: `${SITE_URL}${dirname(AGENT_PATHS.agentSkillsIndex)}/portfolio-expert/SKILL.md`,
      digest: `sha256:${skillMdDigest}`
    }
  ]
}))

// ---------------------------------------------------------------------------
// AI catalog, served at both the ARD v0.91 path (/.well-known/ard.json) and its
// predecessor path (/.well-known/ai-catalog.json). One document satisfies both: the
// ai-catalog schema requires specVersion "1.0" and entries; an ARD manifest requires
// entries and ignores other top-level members. host.identifier is omitted: ARD makes
// it optional, and did:web:jonathanlloyd.me does not resolve. Verified 2026-10-07
// against ards-project/ard-spec b76f235a (spec/schemas/ai-catalog.schema.json and
// spec/schemas/ard-entry.schema.json). Re-verified 2026-10-16 at 9d33ea17: ard-entry is
// re-pinned there, and ai-catalog is byte-identical at both commits, so it keeps the b76f235a
// pin; see docs/discovery-surface.md.
// ---------------------------------------------------------------------------
const air = (namespace, name) => `urn:air:${new URL(SITE_URL).hostname}:${namespace}:${name}`
const catalog = json({
  specVersion: '1.0',
  host: {displayName: identity.site.fullName, documentationUrl: WIKI_LLM_CONTENT_SPEC},
  entries: [
    {
      identifier: air('server', MCP_SERVER_SLUG),
      displayName: llm.agentDiscovery.aiCatalogMcpName,
      type: SERVER_CARD_MEDIA_TYPE,
      url: SERVER_CARD_URL,
      description: llm.agentDiscovery.aiCatalogMcpDescription,
      representativeQueries: llm.agentDiscovery.aiCatalogMcpQueries,
      capabilities: TOOLS.map((tool) => tool.name)
    },
    {
      // ARD defines no dedicated media type for an agent-skills index; typed as generic JSON.
      identifier: air('skills', 'portfolio-expert'),
      displayName: llm.agentDiscovery.aiCatalogSkillsName,
      type: 'application/json',
      url: `${SITE_URL}${AGENT_PATHS.agentSkillsIndex}`,
      description: llm.agentDiscovery.aiCatalogSkillsDescription,
      representativeQueries: llm.agentDiscovery.aiCatalogSkillsQueries
    }
  ]
})
write(AGENT_PATHS.aiCatalog.slice(1), catalog)
write(AGENT_PATHS.ard.slice(1), catalog)

// ---------------------------------------------------------------------------
// RFC 9727 API catalog. The anchor is the catalog's own URL. Each public JSON export is
// one `item` (all nine), at its developer API facade URL (API_V1_BASE plus the contract
// path): every item answers JSON, and every failure answers application/problem+json. The
// catalog is developer documentation, so the raw health exports are listed too. Each item
// is described by its own linkset entry (RFC 9727 Appendix A.1): service-desc is
// /openapi.json, and service-doc names /developers only once that page exists
// (developersPage, above).
// ---------------------------------------------------------------------------
const serviceLinks = {
  'service-desc': [{href: `${SITE_URL}${AGENT_PATHS.openapi}`, type: OPENAPI_MEDIA_TYPE}],
  'service-doc': [{href: developersPage ? `${SITE_URL}${AGENT_PATHS.developers}` : WIKI_LLM_CONTENT_SPEC, type: 'text/html'}]
}
write(AGENT_PATHS.apiCatalog.slice(1), json({
  linkset: [
    {anchor: `${SITE_URL}${AGENT_PATHS.apiCatalog}`, item: DATA_SOURCES.map((source) => ({href: source.apiUrl, type: 'application/json'}))},
    ...DATA_SOURCES.map((source) => ({anchor: source.apiUrl, ...serviceLinks}))
  ]
}))

// ---------------------------------------------------------------------------
// OpenAPI 3.1 for the nine JSON exports on the developer API facade (API_V1_BASE,
// src/lib/edge/api-v1.ts). Every failure is an RFC 9457 problem (the Problem schema, one
// response component per problem type); every response states the rate-limit policy, and every
// 200 lists the deprecation fields the versioning promise uses. Response schemas are the
// contract's published raw schemas, one per export, matched by file name and checked
// as a set in both directions. They are draft-07 documents that use no keyword
// outside the 2020-12 dialect (no $ref, definitions, dependencies or tuple items), so
// only their `$schema` member is dropped when they become component schemas.
// ---------------------------------------------------------------------------
const rawSchemaIndex = req('@j0nathan-ll0yd/portal-contract/raw-schemas/index.json')
const schemaFile = (path) => `${basename(path, '.json')}-export.schema.json`
const expected = new Set(DATA_SOURCES.map((source) => schemaFile(source.path)))
const published = new Set(rawSchemaIndex)
const unmatched = [...expected].filter((file) => !published.has(file)).concat([...published].filter((file) => !expected.has(file)))
if (unmatched.length > 0) {
  throw new Error(`portal-contract raw-schemas and ENDPOINTS disagree: ${unmatched.join(', ')}`)
}

const pascal = (key) => `${key.charAt(0).toUpperCase()}${key.slice(1)}`
const DRAFT_ONLY_KEYWORDS = new Set(['$ref', 'definitions', 'dependencies', 'additionalItems'])

/** The first draft-07 construct outside JSON Schema 2020-12 in `node`, or null. Walks every subschema. */
function draftOnlyConstruct(node, at = '#') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const found = draftOnlyConstruct(item, `${at}/${index}`)
      if (found) {
        return found
      }
    }
    return null
  }
  if (node === null || typeof node !== 'object') {
    return null
  }
  for (const [key, value] of Object.entries(node)) {
    if (DRAFT_ONLY_KEYWORDS.has(key)) {
      return `${at}/${key}`
    }
    // Tuple-form `items` (an array) is draft-07; 2020-12 spells it prefixItems.
    if (key === 'items' && Array.isArray(value)) {
      return `${at}/items (tuple form)`
    }
    const found = draftOnlyConstruct(value, `${at}/${key}`)
    if (found) {
      return found
    }
  }
  return null
}

const schemas = {}
for (const source of DATA_SOURCES) {
  const schema = JSON.parse(readFileSync(req.resolve(`@j0nathan-ll0yd/portal-contract/raw-schemas/${schemaFile(source.path)}`), 'utf8'))
  const construct = draftOnlyConstruct(schema)
  if (construct) {
    throw new Error(
      `${schemaFile(source.path)} uses ${construct}, a draft-07 construct outside JSON Schema 2020-12; convert it before publishing it in OpenAPI 3.1`
    )
  }
  delete schema.$schema
  schemas[`${pascal(source.key)}Export`] = schema
}
/**
 * The function-calling-compat experiment (is-agentic api-v1 plan, Design): `type: object` beside
 * each export `$ref`, legal in OpenAPI 3.1 (JSON Schema 2020-12 allows `$ref` siblings), on the
 * hypothesis that the scanner reads `schema.type` without resolving `$ref`. If the next production
 * scan still reports 0/9 typed schemas, set this to false: the revert is this one line.
 */
const OPENAPI_REF_TYPE_SIBLING = true

/** The response schema of one export: its component, with the experiment's sibling when on. */
function exportSchema(source) {
  const name = `${pascal(source.key)}Export`
  if (OPENAPI_REF_TYPE_SIBLING && schemas[name].type !== 'object') {
    throw new Error(`${name} is not a JSON object schema; the type: object sibling would contradict it`)
  }
  return {...(OPENAPI_REF_TYPE_SIBLING ? {type: 'object'} : {}), $ref: `#/components/schemas/${name}`}
}

// RFC 9457 section 3.1 members, plus the extension members the facade uses (section 3.2).
schemas.Problem = {
  type: 'object',
  required: ['type', 'title', 'status', 'detail', 'instance'],
  properties: {
    type: {type: 'string', format: 'uri'},
    title: {type: 'string'},
    status: {type: 'integer', minimum: 400, maximum: 599},
    detail: {type: 'string'},
    instance: {type: 'string', format: 'uri-reference'},
    validPaths: {type: 'array', items: {type: 'string'}},
    retryAfterSeconds: {type: 'integer', minimum: 0},
    suppressed: {const: true},
    reason: {type: 'string'}
  }
}

/** One response component per problem type, and the extension members each always carries. */
const PROBLEM_RESPONSES = {
  'not-found': {name: 'NotFound', required: ['validPaths']},
  'method-not-allowed': {name: 'MethodNotAllowed', required: []},
  'rate-limited': {name: 'RateLimited', required: ['retryAfterSeconds']},
  'focus-suppressed': {name: 'FocusSuppressed', required: ['retryAfterSeconds', 'suppressed', 'reason']},
  'upstream-unavailable': {name: 'UpstreamUnavailable', required: ['retryAfterSeconds']}
}
const header = (name) => ({$ref: `#/components/headers/${name}`})
const policyHeader = {'RateLimit-Policy': header('RateLimit-Policy')}
const rateLimitHeaders = {...policyHeader, RateLimit: header('RateLimit')}
const retryHeaders = {...rateLimitHeaders, 'Retry-After': header('Retry-After')}
const PROBLEM_HEADERS = {
  'not-found': policyHeader,
  'method-not-allowed': {...policyHeader, Allow: header('Allow')},
  'rate-limited': retryHeaders,
  'focus-suppressed': retryHeaders,
  'upstream-unavailable': retryHeaders
}
const problemSchema = {$ref: '#/components/schemas/Problem'}
const responses = {}
for (const problem of API_PROBLEMS) {
  const entry = PROBLEM_RESPONSES[problem.slug]
  if (!entry) {
    throw new Error(`no OpenAPI response component for problem type "${problem.slug}"`)
  }
  const schema = entry.required.length > 0 ? {allOf: [problemSchema, {required: entry.required}]} : problemSchema
  responses[entry.name] = {description: problem.title, headers: PROBLEM_HEADERS[problem.slug], content: {'application/problem+json': {schema}}}
}
const responseRef = (slug) => ({$ref: `#/components/responses/${PROBLEM_RESPONSES[slug].name}`})

const stringHeader = {schema: {type: 'string'}}
const headers = {
  // draft-ietf-httpapi-ratelimit-headers-11 sections 3 and 4: Structured Field Lists.
  'RateLimit-Policy': {...stringHeader, example: `"${API_V1_RATE_LIMIT.policy}";q=${API_V1_RATE_LIMIT.limit};w=${API_V1_RATE_LIMIT.windowSeconds}`},
  RateLimit: {...stringHeader, example: `"${API_V1_RATE_LIMIT.policy}";r=${API_V1_RATE_LIMIT.limit - 1};t=${API_V1_RATE_LIMIT.windowSeconds}`},
  'Retry-After': {schema: {type: 'integer', minimum: 0}},
  Allow: {...stringHeader, example: 'GET, HEAD'},
  // RFC 9745 Deprecation, RFC 8594 Sunset and the RFC 8288 rel="successor-version" Link: sent only
  // while a successor version is live, for at least API_DEPRECATION_WINDOW_DAYS days.
  Deprecation: stringHeader,
  Sunset: stringHeader,
  Link: stringHeader
}

const paths = {}
for (const source of DATA_SOURCES) {
  const operationResponses = {
    200: {
      description: source.description,
      headers: {...rateLimitHeaders, Deprecation: header('Deprecation'), Sunset: header('Sunset'), Link: header('Link')},
      content: {'application/json': {schema: exportSchema(source)}}
    },
    405: responseRef('method-not-allowed'),
    429: responseRef('rate-limited'),
    502: responseRef('upstream-unavailable')
  }
  // The edge gate never suppresses the focus signal; every other export may be hidden.
  if (source.path !== FOCUS_SIGNAL_PATH) {
    operationResponses[503] = responseRef('focus-suppressed')
  }
  paths[source.path] = {get: {operationId: `get${pascal(source.key)}`, summary: source.name, description: source.description, responses: operationResponses}}
}

// The prose states the numbers the code enforces; a copy release that drops one fails the build.
// The rate-limit window may read as seconds, or as "minute" when it is exactly 60 seconds.
const windowPhrases = [`${API_V1_RATE_LIMIT.windowSeconds} seconds`, ...(API_V1_RATE_LIMIT.windowSeconds === 60 ? ['minute'] : [])]
for (
  const [key, phrases] of [
    ['versioningBody', [[`${API_DEPRECATION_WINDOW_DAYS} days`]]],
    ['rateLimitBody', [[`${API_V1_RATE_LIMIT.limit} requests`], windowPhrases]]
  ]
) {
  for (const alternatives of phrases) {
    if (!alternatives.some((phrase) => new RegExp(`\\b${phrase}\\b`).test(llm.developers[key]))) {
      throw new Error(`llm.developers.${key} states none of ${alternatives.join(' / ')}, which the facade enforces`)
    }
  }
}

write(AGENT_PATHS.openapi.slice(1),
  json({
    openapi: '3.1.0',
    info: {
      title: identity.site.fullName,
      version: OPENAPI_DOCUMENT_VERSION,
      description: [llm.dashboard.datasetDescription, llm.developers.versioningBody, llm.developers.rateLimitBody].join('\n\n')
    },
    servers: [{url: API_V1_BASE, description: fillTemplate(llm.developers.apiBaseNote, 'siteUrl', SITE_URL)}],
    paths,
    components: {schemas, responses, headers}
  }))

if (CHECK) {
  if (drifted.length > 0) {
    console.error('[generate-webmcp --check] FAIL: committed files differ from the generator output:')
    for (const path of drifted) {
      console.error('  -', path)
    }
    console.error('Run `pnpm run generate:webmcp` and commit the result.')
    process.exit(1)
  }
  console.log('[generate-webmcp --check] OK: every generated file matches the generator output.')
}
