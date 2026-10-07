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
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {MCP_INSTRUCTIONS, MCP_SERVER_NAME, MCP_SERVER_VERSION, RESOURCES, SERVER_CARD, TOOLS} from './agent-catalog.mjs'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy, SUPPRESSION_SOURCE} from './proxy'
import type {CloudfrontProxyContext} from './proxy'

/**
 * The Cloudflare Pages project host. Preview deploys answer on `<branch>.<host>` and
 * `<hash>.<host>`. Must equal `--project-name` in .github/workflows/deploy.yml and
 * preview-deploy.yml; tests/unit/mcp-server.test.ts holds the two together.
 */
export const PAGES_PROJECT_HOST = 'human-datastream.pages.dev'

/** Hostnames always allowed. Localhost serves `wrangler pages dev`; Cloudflare never routes a localhost Host to this project. */
const FIXED_HOSTNAMES = [new URL(SITE_URL).hostname, PAGES_PROJECT_HOST, 'localhost', '127.0.0.1']

/**
 * How long a client may cache `server/discover`, `tools/list` and `resources/list`.
 * The tool and resource sets change only on deploy. `resources/read` keeps the SDK
 * default (ttl 0, private) because focus state can hide an artifact at any moment.
 */
export const DISCOVERY_CACHE_SECONDS = 3600

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

type GatedRead = {status: 'ok'; text: string} | {status: 'suppressed'; text: string} | {status: 'unavailable'; httpStatus: number; text: string}

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
    return {status: 'ok', text}
  }
  if (response.headers.get('X-Source') === SUPPRESSION_SOURCE) {
    return {status: 'suppressed', text}
  }
  return {status: 'unavailable', httpStatus: response.status, text}
}

function textResult(value: unknown, isError = false): CallToolResult {
  return {content: [{type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value)}], ...(isError ? {isError: true} : {})}
}

/** The server factory. One instance per request, so nothing is shared between callers. */
export function buildMcpServer(context: CloudfrontProxyContext): McpServer {
  const cacheHint = {ttlMs: DISCOVERY_CACHE_SECONDS * 1000, cacheScope: 'public' as const}
  const server = new McpServer({name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: SERVER_CARD.title}, {
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
        return textResult({failed: true, status: read.httpStatus, reason: read.text}, true)
      }
      return textResult(tool.select(JSON.parse(read.text)))
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
        return {contents: [{uri: uri.href, mimeType, text: read.text}]}
      })
  }

  return server
}

/** The /mcp request handler: validation first, then the SDK entry with a per-request factory. */
export async function handleMcpRequest(context: CloudfrontProxyContext): Promise<Response> {
  const rejected = guardResponse(context.request)
  if (rejected) {
    return rejected
  }
  const handler = createMcpHandler(() => buildMcpServer(context))
  const response = await handler.fetch(context.request)
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}
