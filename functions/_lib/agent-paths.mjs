// Site-relative paths of the agent interfaces (atlas decision 0158). Dependency-free on
// purpose: functions/_middleware.ts builds LINK_HEADER from it on every request, so it
// carries no copy or catalog import. functions/_lib/agent-catalog.mjs re-exports it.
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
  developers: '/developers'
})

/** The OpenAPI media type the api-catalog advertises and the middleware serves /openapi.json as. */
export const OPENAPI_MEDIA_TYPE = 'application/vnd.oai.openapi+json;version=3.1'
