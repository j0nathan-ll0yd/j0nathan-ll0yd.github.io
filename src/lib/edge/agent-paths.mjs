// Site-relative paths of the agent interfaces (atlas decision 0158). Dependency-free on
// purpose: src/lib/edge/middleware.ts builds LINK_HEADER from it on every request, so it
// carries no copy or catalog import. src/lib/edge/agent-catalog.mjs re-exports it.
// Absolute URLs are `${SITE_URL}${path}`.
export const AGENT_PATHS = Object.freeze({
  mcp: '/mcp',
  serverCard: '/mcp/server-card',
  serverCardCompat: '/.well-known/mcp/server-card.json',
  aiCatalog: '/.well-known/ai-catalog.json',
  ard: '/.well-known/ard.json',
  apiCatalog: '/.well-known/api-catalog',
  agentSkillsIndex: '/.well-known/agent-skills/index.json',
  openapi: '/openapi.json',
  developers: '/developers',
  // The developer API facade (is-agentic api-v1 plan): the Worker serves the nine exports here.
  apiV1: '/api/v1'
})

/**
 * The media type the middleware serves ai-catalog.json as. A local choice: ARD §3.3 lists
 * `application/ai-catalog+json` as the entry `type` for a "nested manifest / catalog of entries"
 * (ards-project/ard-spec spec/ard.md at 9d33ea17, the pin since 2026-10-16).
 */
export const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json'

/** The OpenAPI media type the api-catalog advertises and the middleware serves /openapi.json as. */
export const OPENAPI_MEDIA_TYPE = 'application/vnd.oai.openapi+json;version=3.1'
