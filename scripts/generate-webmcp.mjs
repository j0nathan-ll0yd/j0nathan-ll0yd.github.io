// Generates the agent-discovery surface from the ONE agent catalog
// (functions/_lib/agent-catalog.mjs). Run via `pnpm run generate:webmcp` (wired into
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
import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {
  AGENT_PATHS,
  DATA_SOURCES,
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
} from '../functions/_lib/agent-catalog.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const req = createRequire(import.meta.url)

function write(relativePath, content) {
  const outPath = join(publicDir, relativePath)
  writeFileSync(outPath, content)
  console.log(`Generated ${outPath}`)
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
// Agent Skills index. SKILL.md is HAND-WRITTEN apart from its generated data-source table
// (rendered below); this script computes the digest from the resulting served bytes. A literal digest desyncs the moment SKILL.md is
// edited, and audits/checks/b2-check-wellknown.mjs validates the digest's FORMAT, not
// its match, so a stale one would ship green.
// ---------------------------------------------------------------------------
const skillMdPath = join(publicDir, '.well-known', 'agent-skills', 'portfolio-expert', 'SKILL.md')

// SKILL.md is hand-written EXCEPT its Live Data Sources table, which is rendered here from
// LLM_DATA_SOURCE_DIRECTORY, the same list get_data_sources serves. The LLM-channel data policy
// (LLM_CHANNEL_POLICY) therefore governs the skill too, and the table cannot drift from it. The
// block is regenerated before the digest is computed, so the digest covers the served bytes.
const DIRECTORY_BEGIN = /<!-- BEGIN GENERATED: data-source directory\.[^>]*-->\n/
const DIRECTORY_END = '<!-- END GENERATED: data-source directory -->'
const cell = (value) => String(value).replace(/\|/g, '\\|')
const skillSource = readFileSync(skillMdPath, 'utf8')
const begin = DIRECTORY_BEGIN.exec(skillSource)
const end = skillSource.indexOf(DIRECTORY_END)
if (!begin || end < begin.index) {
  throw new Error(`${skillMdPath} lost its generated data-source directory markers`)
}
const directoryTable = [
  '| Data | Where to read it | Description |',
  '| --- | --- | --- |',
  ...LLM_DATA_SOURCE_DIRECTORY.map((s) => `| ${cell(s.name)} | <${s.url}> | ${cell(s.description)} |`)
].join('\n')
writeFileSync(skillMdPath, `${skillSource.slice(0, begin.index + begin[0].length)}${directoryTable}\n${skillSource.slice(end)}`)

const skillMdDigest = createHash('sha256').update(readFileSync(skillMdPath)).digest('hex')
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
// spec/schemas/ard-entry.schema.json); see docs/discovery-surface.md.
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
// RFC 9727 API catalog. The anchor is the catalog's own URL; each API is an item,
// described by its own linkset entry. ADVERTISE ONLY WHAT WORKS: service-doc names
// /developers only once that page exists in this tree, so no deploy can link a 404.
// ---------------------------------------------------------------------------
const developersPage = ['developers.astro', join('developers', 'index.astro')].some((file) => existsSync(join(root, 'src', 'pages', file)))
const dataApi = `${CLOUDFRONT_BASE}/`
write(AGENT_PATHS.apiCatalog.slice(1), json({
  linkset: [
    {anchor: `${SITE_URL}${AGENT_PATHS.apiCatalog}`, item: [{href: dataApi}]},
    {
      anchor: dataApi,
      'service-desc': [{href: `${SITE_URL}${AGENT_PATHS.openapi}`, type: OPENAPI_MEDIA_TYPE}],
      'service-doc': [{href: developersPage ? `${SITE_URL}${AGENT_PATHS.developers}` : WIKI_LLM_CONTENT_SPEC, type: 'text/html'}]
    }
  ]
}))

// ---------------------------------------------------------------------------
// OpenAPI 3.1 for the nine JSON exports on CLOUDFRONT_BASE. Response schemas are the
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
schemas.Suppressed = {type: 'object', required: ['suppressed', 'reason'], properties: {suppressed: {const: true}, reason: {type: 'string'}}}

const paths = {}
for (const source of DATA_SOURCES) {
  const responses = {
    200: {description: source.description, content: {'application/json': {schema: {$ref: `#/components/schemas/${pascal(source.key)}Export`}}}}
  }
  // The edge gate never suppresses the focus signal; every other export may be hidden.
  if (source.path !== FOCUS_SIGNAL_PATH) {
    responses[403] = {$ref: '#/components/responses/Suppressed'}
  }
  paths[source.path] = {get: {operationId: `get${pascal(source.key)}`, summary: source.name, description: source.description, responses}}
}

write(AGENT_PATHS.openapi.slice(1),
  json({
    openapi: '3.1.0',
    info: {title: identity.site.fullName, version: OPENAPI_DOCUMENT_VERSION, description: llm.dashboard.datasetDescription},
    servers: [{url: CLOUDFRONT_BASE}],
    paths,
    components: {
      schemas,
      responses: {
        Suppressed: {description: llm.developers.apiSuppressedResponse, content: {'application/json': {schema: {$ref: '#/components/schemas/Suppressed'}}}}
      }
    }
  }))
