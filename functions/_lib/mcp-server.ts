// The read-only MCP server behind /mcp (atlas decision 0158).
//
// Protocol: MCP revision 2026-07-28 over stateless Streamable HTTP, served by the
// official SDK's `createMcpHandler`. Its default `legacy: 'stateless'` posture also
// answers 2025-era clients (`initialize`, then any request, no session): one fresh
// server instance per request, no session id minted, GET and DELETE answered 405.
// The SDK entry performs no Host or Origin validation by design, so this module
// puts both in front of it. There is no authorization: the server is public and
// read-only, which the revision allows.
//
// Every artifact read goes through the same CloudFront proxy machinery as the
// llms routes (functions/_lib/proxy.ts): the fail-closed focus gate first, then
// the bounded retry and the last-known-good fallback. During a hiding focus mode a
// suppressible artifact yields the suppression document, never data.

import {
  createMcpHandler,
  hostHeaderValidationResponse,
  McpServer,
  originValidationResponse,
  validateHostHeader,
  validateOriginHeader
} from '@modelcontextprotocol/server'
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/server'
import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {
  DISCOVERY_CACHE_SECONDS,
  MCP_INSTRUCTIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_SLUG,
  MCP_SERVER_VERSION,
  RESOURCES,
  SERVER_CARD,
  TOOLS
} from './agent-catalog.mjs'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy, SUPPRESSION_SOURCE} from './proxy'
import type {CloudfrontProxyContext} from './proxy'

const logger = createEdgeLogger({service: 'mcp-server'})

/**
 * The Cloudflare Pages project host. Preview deploys answer on `<branch>.<host>` and
 * `<hash>.<host>`. Must equal `--project-name` in .github/workflows/deploy.yml and
 * preview-deploy.yml; tests/unit/mcp-server.test.ts holds the two together.
 */
export const PAGES_PROJECT_HOST = `${MCP_SERVER_SLUG}.pages.dev`

/** Hostnames always allowed. Localhost serves `wrangler pages dev`; Cloudflare never routes a localhost Host to this project. */
const FIXED_HOSTNAMES = [new URL(SITE_URL).hostname, PAGES_PROJECT_HOST, 'localhost', '127.0.0.1']

/** The allowlist for one candidate hostname: the fixed set, plus the candidate itself when it is a preview host of this project. */
export function allowedHostnames(candidate: string | undefined): string[] {
  return candidate !== undefined && candidate.endsWith(`.${PAGES_PROJECT_HOST}`) ? [...FIXED_HOSTNAMES, candidate] : FIXED_HOSTNAMES
}

/** Host (DNS rebinding) and Origin validation. An invalid Origin answers 403, as the transport requires. */
export function guardResponse(request: Request): Response | undefined {
  const host = validateHostHeader(request.headers.get('host'), [])
  const origin = validateOriginHeader(request.headers.get('origin'), [])
  return hostHeaderValidationResponse(request, allowedHostnames(host.hostname)) ?? originValidationResponse(request, allowedHostnames(origin.hostname))
}

/**
 * `staleSince` is set when the proxy answered from its last-known-good copy because the
 * origin failed: the time that copy was stored. Clients see it as `_meta[STALE_META_KEY]`.
 */
type GatedRead = {status: 'ok'; text: string; staleSince?: string} | {status: 'suppressed'; text: string} | {
  status: 'unavailable'
  httpStatus: number
  text: string
}

/** Result `_meta` key that marks data served from the last-known-good copy (reverse-DNS prefix, per the MCP `_meta` rules). */
export const STALE_META_KEY = `${new URL(SITE_URL).hostname.split('.').reverse().join('.')}/lastKnownGoodSince`

/** One proxy handler per artifact path, built once per isolate. The no-store policy matches the gated reads they serve. */
const readers = new Map<string, ReturnType<typeof makeCloudfrontProxy>>(RESOURCES.map((resource) => [
  resource.path,
  makeCloudfrontProxy({path: resource.path, contentType: resource.mimeType, cachePolicy: LLM_OUTPUT_CACHE_POLICY})
]))

/** Read one artifact through the focus gate, and classify the answer. */
export async function readGated(path: string, context: CloudfrontProxyContext): Promise<GatedRead> {
  const reader = readers.get(path)
  if (!reader) {
    throw new Error(`no gated reader for ${path}`)
  }
  const response = await reader({request: new Request(new URL(path, context.request.url), {method: 'GET'}), waitUntil: context.waitUntil})
  const text = await response.text()
  if (response.status === 200) {
    return response.headers.get('X-Proxy-Stale') === 'true'
      ? {status: 'ok', text, staleSince: response.headers.get('X-Proxy-Lkg-Stored-At') ?? 'unknown'}
      : {status: 'ok', text}
  }
  if (response.headers.get('X-Source') === SUPPRESSION_SOURCE) {
    return {status: 'suppressed', text}
  }
  return {status: 'unavailable', httpStatus: response.status, text}
}

function textResult(value: unknown, {isError = false, staleSince}: {isError?: boolean; staleSince?: string} = {}): CallToolResult {
  return {
    content: [{type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value)}],
    ...(isError ? {isError: true} : {}),
    ...(staleSince ? {_meta: {[STALE_META_KEY]: staleSince}} : {})
  }
}

/** The server factory. One instance per request, so nothing is shared between callers. */
export function buildMcpServer(context: CloudfrontProxyContext): McpServer {
  const cacheHint = {ttlMs: DISCOVERY_CACHE_SECONDS * 1000, cacheScope: 'public' as const}
  const server = new McpServer({name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: SERVER_CARD.title}, {
    // The lists change only on deploy, so the server emits no list-change notifications.
    // Declaring that also makes a `subscriptions/listen` stream acknowledge and close at
    // once, instead of idling open on a per-request event bus that never publishes.
    capabilities: {tools: {listChanged: false}, resources: {listChanged: false}},
    instructions: MCP_INSTRUCTIONS,
    cacheHints: {'server/discover': cacheHint, 'tools/list': cacheHint, 'resources/list': cacheHint}
  })

  for (const tool of TOOLS) {
    const annotations = {readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false}
    server.registerTool(tool.name, {description: tool.description, annotations}, async () => {
      if (!('select' in tool)) {
        return textResult(tool.payload)
      }
      const read = await readGated(tool.path, context)
      if (read.status === 'suppressed') {
        return textResult(read.text)
      }
      if (read.status === 'unavailable') {
        return textResult({failed: true, status: read.httpStatus, reason: read.text}, {isError: true})
      }
      return textResult(tool.select(JSON.parse(read.text)), {staleSince: read.staleSince})
    })
  }

  for (const resource of RESOURCES) {
    server.registerResource(resource.name, resource.uri, {title: resource.title, description: resource.description, mimeType: resource.mimeType},
      async (uri): Promise<ReadResourceResult> => {
        const read = await readGated(resource.path, context)
        if (read.status === 'unavailable') {
          throw new Error(`${resource.path} unavailable (HTTP ${read.httpStatus})`)
        }
        // A suppressed read returns the suppression document in place of the artifact.
        const mimeType = read.status === 'suppressed' ? 'application/json' : resource.mimeType
        const staleSince = read.status === 'ok' ? read.staleSince : undefined
        return {contents: [{uri: uri.href, mimeType, text: read.text, ...(staleSince ? {_meta: {[STALE_META_KEY]: staleSince}} : {})}]}
      })
  }

  return server
}

/** The /mcp request handler: validation first, then the SDK entry with a per-request factory. */
export async function handleMcpRequest(context: CloudfrontProxyContext): Promise<Response> {
  const response = guardResponse(context.request) ??
    await createMcpHandler(() => buildMcpServer(context), {
      onerror: (error) => logger.error('mcp_handler_error', {error_class: error.name, message: error.message})
    }).fetch(context.request)
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}
