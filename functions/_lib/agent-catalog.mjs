// The ONE agent catalog (atlas decision 0158). Every agent-facing surface reads it:
// the MCP server (functions/mcp/), the WebMCP script, the server card, the AI/ARD
// catalogs and the API catalog (all emitted by scripts/generate-webmcp.mjs).
//
// Plain ESM on purpose. The Pages Functions bundler, the node build script and
// vitest all import it as-is, with no transpile step, so it cannot drift into two
// copies. Prose comes from @j0nathan-ll0yd/copy; hosts and paths come from
// @j0nathan-ll0yd/portal-contract. Nothing here states a literal either one owns.
import identity from '@j0nathan-ll0yd/copy/identity.flat.json' with {type: 'json'}
import llm from '@j0nathan-ll0yd/copy/llm.flat.json' with {type: 'json'}
import {CLOUDFRONT_BASE, DATASET_DISTRIBUTIONS, ENDPOINTS, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import astroPackage from 'astro/package.json' with {type: 'json'}

/** Site-relative paths of the agent interfaces. Absolute URLs are `${SITE_URL}${path}`. */
export const AGENT_PATHS = Object.freeze({
  mcp: '/mcp',
  serverCard: '/mcp/server-card',
  serverCardCompat: '/.well-known/mcp/server-card.json',
  aiCatalog: '/.well-known/ai-catalog.json',
  ard: '/.well-known/ard.json',
  apiCatalog: '/.well-known/api-catalog',
  openapi: '/openapi.json',
  developers: '/developers'
})

/** The MCP protocol revision this server implements (stateless Streamable HTTP). It also answers 2025-era clients. */
export const MCP_PROTOCOL_VERSION = '2026-07-28'

export const MCP_URL = `${SITE_URL}${AGENT_PATHS.mcp}`
export const SERVER_CARD_URL = `${SITE_URL}${AGENT_PATHS.serverCard}`

/** SEP-2127 server card media type and schema URI (ext-server-card schema.json, `ServerCard.$schema`). */
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json'
export const SERVER_CARD_SCHEMA_URI = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json'

/**
 * Server identity. The card and `server/discover` report the same name and version,
 * which the server-card extension asks for ("Consistency with Runtime Behavior").
 * Bump the version when the tool or resource set changes.
 */
export const MCP_SERVER_NAME = `${new URL(SITE_URL).hostname.split('.').reverse().join('.')}/human-datastream`
export const MCP_SERVER_VERSION = '1.0.0'

/** Natural-language guidance for clients, returned as `instructions` by `server/discover` and `initialize`. */
export const MCP_INSTRUCTIONS = llm.mcp.serverDescription

/** The installed Astro major, which `llm.mcp.stackFramework` names through `{astroMajor}`. */
export const ASTRO_MAJOR = String(astroPackage.version).split('.')[0]

/** Fill one `{name}` placeholder, failing loud when the copy no longer carries it. */
export function fillTemplate(template, name, value) {
  const placeholder = `{${name}}`
  if (!template.includes(placeholder)) {
    throw new Error(`copy template "${template}" has no ${placeholder} placeholder`)
  }
  return template.split(placeholder).join(value)
}

/** The fixed, ungated focus signal. The edge gate never suppresses it; every other artifact is suppressible. */
export const FOCUS_SIGNAL_PATH = ENDPOINTS.focus

/** One entry per public JSON export, in contract order. A new endpoint without copy fails here, at build. */
export const DATA_SOURCES = Object.freeze(Object.entries(ENDPOINTS).map(([key, path]) => {
  const stem = `ds${key.charAt(0).toUpperCase()}${key.slice(1)}`
  const name = llm.mcp[`${stem}Name`]
  const description = llm.mcp[`${stem}Desc`]
  if (typeof name !== 'string' || typeof description !== 'string') {
    throw new Error(`@j0nathan-ll0yd/copy has no llm.mcp.${stem}Name / ${stem}Desc for portal-contract endpoint "${key}"`)
  }
  return Object.freeze({key, path, url: `${CLOUDFRONT_BASE}${path}`, name, description})
}))

const llmsTxt = DATASET_DISTRIBUTIONS.find((d) => d.name === 'LLM discovery index')
if (!llmsTxt) {
  throw new Error('portal-contract DATASET_DISTRIBUTIONS is missing the LLM discovery index')
}

/** MCP resources: the nine JSON exports plus llms-full.txt, each read on the CloudFront path through the focus gate. */
export const RESOURCES = Object.freeze([
  ...DATA_SOURCES.map((s) =>
    Object.freeze({name: s.key, uri: s.url, path: s.path, title: s.name, description: s.description, mimeType: 'application/json'})
  ),
  Object.freeze({
    name: 'llmsFull',
    uri: `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`,
    path: LLM_CONTENT_PATHS.llmsFull,
    title: llm.dashboard.alternateLinkMarkdown,
    description: llm.dashboard.datasetDescription,
    mimeType: 'text/markdown'
  })
])

const profile = Object.freeze({
  name: identity.person.name,
  title: identity.person.jobTitle,
  location: identity.person.location,
  experience: identity.person.experiencePhrase,
  site: SITE_URL,
  // Convention of person.sameAs: [0] LinkedIn, [1] GitHub.
  github: identity.person.sameAs[1],
  linkedin: identity.person.sameAs[0],
  bio: identity.person.longBio,
  expertise: identity.seo.expertise,
  interests: identity.person.interests
})

const techStack = Object.freeze({
  framework: fillTemplate(llm.mcp.stackFramework, 'astroMajor', ASTRO_MAJOR),
  hosting: llm.mcp.stackHosting,
  liveData: llm.mcp.stackLiveData,
  design: llm.mcp.stackDesign,
  font: llm.mcp.stackFont,
  llmContent: {discoveryIndex: llmsTxt.contentUrl, complete: `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`},
  mcpServer: MCP_URL
})

/**
 * The reading summary. ES2017 on purpose and free of closures: it is the one piece of
 * tool logic, and the MCP server calls it directly. Kept here so a second copy never
 * appears in the browser script, which calls the server instead.
 */
export function selectCurrentReading(data) {
  const books = data && Array.isArray(data.books) ? data.books : []
  return {
    reading: books.filter((b) => b.status === 'reading'),
    upNext: books.filter((b) => b.status === 'up-next'),
    recentlyFinished: books.filter((b) => b.status === 'finished').slice(0, 5)
  }
}

/**
 * The tool catalog. `readOnly` maps to MCP `readOnlyHint` and WebMCP `readOnlyHint`;
 * `untrustedContent` maps to WebMCP `untrustedContentHint` (MCP 2026-07-28 has no
 * equivalent annotation). A tool exposes nothing beyond the public JSON exports and
 * the copy package.
 *
 * `static` tools answer from build-time data. An `artifact` tool reads one export
 * through the focus gate and summarizes it with `select`.
 */
export const TOOLS = Object.freeze([
  Object.freeze({name: 'get_profile', description: llm.mcp.toolGetProfile, readOnly: true, untrustedContent: false, kind: 'static', payload: profile}),
  Object.freeze({
    name: 'get_data_sources',
    description: llm.mcp.toolGetDataSources,
    readOnly: true,
    untrustedContent: false,
    kind: 'static',
    payload: DATA_SOURCES.map(({name, url, description}) => ({name, url, description}))
  }),
  Object.freeze({
    name: 'get_current_reading',
    description: llm.mcp.toolGetCurrentReading,
    readOnly: true,
    // Book titles and authors are third-party text.
    untrustedContent: true,
    kind: 'artifact',
    path: ENDPOINTS.books,
    select: selectCurrentReading
  }),
  Object.freeze({name: 'get_tech_stack', description: llm.mcp.toolGetTechStack, readOnly: true, untrustedContent: false, kind: 'static', payload: techStack})
])

/** The SEP-2127 server card. Served at AGENT_PATHS.serverCard (canonical) and AGENT_PATHS.serverCardCompat. */
export const SERVER_CARD = Object.freeze({
  $schema: SERVER_CARD_SCHEMA_URI,
  name: MCP_SERVER_NAME,
  title: llm.mcp.serverTitle,
  description: llm.mcp.serverCardDescription,
  version: MCP_SERVER_VERSION,
  remotes: [{type: 'streamable-http', url: MCP_URL}]
})

/** The served card bytes: the canonical route and the compatibility file are byte-identical. */
export const SERVER_CARD_JSON = `${JSON.stringify(SERVER_CARD, null, 2)}\n`
