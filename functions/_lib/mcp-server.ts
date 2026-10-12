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
//
// Amplification bounds: a POST body over MAX_REQUEST_BODY_BYTES answers 413 before
// anything is parsed, a JSON-RPC batch array answers 400 (both supported revisions
// require one message per POST), and every inbound request carries one read memo, so
// repeated reads of one path share one gated read.

import {createMcpHandler, McpServer, validateHostHeader, validateOriginHeader} from '@modelcontextprotocol/server'
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/server'
import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {
  DISCOVERY_CACHE_SECONDS,
  LLM_WITHHELD_PATHS,
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

/** The deployed hostnames. */
const PUBLIC_HOSTNAMES = [new URL(SITE_URL).hostname, PAGES_PROJECT_HOST]

/**
 * The `wrangler pages dev` hostnames. Cloudflare routes a request to this project by its Host, so a
 * request whose Host is one of these never reached a deploy: it is local development.
 */
const DEVELOPMENT_HOSTNAMES = ['localhost', '127.0.0.1']

/** The largest POST body /mcp reads. One request with an empty `arguments` object is well under 1 KiB. */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024

/**
 * The allowlist for one candidate hostname: the deployed hostnames, the candidate itself when it is
 * a preview host of this project, and the localhost names in development only.
 */
export function allowedHostnames(candidate: string | undefined, {development = false}: {development?: boolean} = {}): string[] {
  const preview = candidate !== undefined && candidate.endsWith(`.${PAGES_PROJECT_HOST}`) ? [candidate] : []
  return [...PUBLIC_HOSTNAMES, ...preview, ...(development ? DEVELOPMENT_HOSTNAMES : [])]
}

/** A JSON-RPC error with no request id, the shape the transport uses for a rejected HTTP request. */
function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({jsonrpc: '2.0', error: {code, message}, id: null}, {status})
}

/**
 * Host (DNS rebinding) and Origin validation. An invalid Origin answers 403, as the transport
 * requires. The messages are fixed: a rejection never echoes the header it rejected.
 */
export function guardResponse(request: Request): Response | undefined {
  const host = validateHostHeader(request.headers.get('host'), [])
  const development = host.hostname !== undefined && DEVELOPMENT_HOSTNAMES.includes(host.hostname)
  if (!validateHostHeader(request.headers.get('host'), allowedHostnames(host.hostname, {development: true})).ok) {
    return jsonRpcError(403, -32000, 'Invalid Host header')
  }
  const origin = validateOriginHeader(request.headers.get('origin'), [])
  if (!validateOriginHeader(request.headers.get('origin'), allowedHostnames(origin.hostname, {development})).ok) {
    return jsonRpcError(403, -32000, 'Invalid Origin header')
  }
  return undefined
}

/**
 * `staleSince` is set when the proxy answered from its last-known-good copy because the
 * origin failed: the time that copy was stored. Clients see it as `_meta[STALE_META_KEY]`.
 */
type GatedRead = {status: 'ok'; text: string; staleSince?: string} | {status: 'suppressed'; text: string} | {
  status: 'unavailable'
  httpStatus: number
  text: string
} | {status: 'withheld'}

/** One memo per inbound request: repeated reads of one path share one gated read. */
export type ReadMemo = Map<string, Promise<GatedRead>>

/** Result `_meta` key that marks data served from the last-known-good copy (reverse-DNS prefix, per the MCP `_meta` rules). */
export const STALE_META_KEY = `${new URL(SITE_URL).hostname.split('.').reverse().join('.')}/lastKnownGoodSince`

/** One proxy handler per artifact path, built once per isolate. The no-store policy matches the gated reads they serve. */
const readers = new Map<string, ReturnType<typeof makeCloudfrontProxy>>(RESOURCES.map((resource) => [
  resource.path,
  makeCloudfrontProxy({path: resource.path, contentType: resource.mimeType, cachePolicy: LLM_OUTPUT_CACHE_POLICY})
]))

/**
 * Read one artifact through the focus gate, and classify the answer. With a memo, a second read of
 * the same path in the same inbound request reuses the first read and makes no upstream request.
 */
export function readGated(path: string, context: CloudfrontProxyContext, memo?: ReadMemo): Promise<GatedRead> {
  const shared = memo?.get(path)
  if (shared) {
    return shared
  }
  const read = readGatedOnce(path, context)
  memo?.set(path, read)
  return read
}

async function readGatedOnce(path: string, context: CloudfrontProxyContext): Promise<GatedRead> {
  const reader = readers.get(path)
  if (!reader) {
    throw new Error(`no gated reader for ${path}`)
  }
  const response = await reader({request: new Request(new URL(path, context.request.url), {method: 'GET'}), waitUntil: context.waitUntil})
  const text = await response.text()
  if (response.status === 200) {
    // FAIL CLOSED on a withheld export link. llms-full.txt is backend text republished verbatim, so
    // the LLM-channel data policy holds for it only while the backend omits those links. A copy
    // that names one is never served on this channel.
    const linked = LLM_WITHHELD_PATHS.filter((withheld: string) => text.includes(withheld))
    if (linked.length > 0) {
      logger.error('mcp_withheld_link_refused', {artifact: path, withheld: linked})
      return {status: 'withheld'}
    }
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

/** The fixed answer for an artifact the policy check refused. */
const WITHHELD_REASON = 'artifact withheld: it links a raw health, sleep, or workouts export'

/**
 * The server factory. One instance per request, so nothing is shared between callers. `memo` is
 * the inbound request's read memo; the handler creates one per request.
 */
export function buildMcpServer(context: CloudfrontProxyContext, memo: ReadMemo = new Map()): McpServer {
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
      const read = await readGated(tool.path, context, memo)
      if (read.status === 'suppressed') {
        return textResult(read.text)
      }
      if (read.status === 'withheld') {
        return textResult({failed: true, reason: WITHHELD_REASON}, {isError: true})
      }
      if (read.status === 'unavailable') {
        return textResult({failed: true, status: read.httpStatus, reason: read.text}, {isError: true})
      }
      // The engine's parse error text never reaches the client: it can quote the upstream body.
      let selected: unknown
      try {
        selected = tool.select(JSON.parse(read.text))
      } catch (error) {
        logger.error('mcp_tool_artifact_unreadable', {tool: tool.name, artifact: tool.path, error_class: error instanceof Error ? error.name : 'unknown'})
        return textResult({failed: true, reason: 'artifact unreadable'}, {isError: true})
      }
      return textResult(selected, {staleSince: read.staleSince})
    })
  }

  for (const resource of RESOURCES) {
    server.registerResource(resource.name, resource.uri, {title: resource.title, description: resource.description, mimeType: resource.mimeType},
      async (uri): Promise<ReadResourceResult> => {
        const read = await readGated(resource.path, context, memo)
        if (read.status === 'unavailable') {
          throw new Error(`${resource.path} unavailable (HTTP ${read.httpStatus})`)
        }
        if (read.status === 'withheld') {
          throw new Error(`${resource.path} ${WITHHELD_REASON}`)
        }
        // A suppressed read returns the suppression document in place of the artifact.
        const mimeType = read.status === 'suppressed' ? 'application/json' : resource.mimeType
        const staleSince = read.status === 'ok' ? read.staleSince : undefined
        return {contents: [{uri: uri.href, mimeType, text: read.text, ...(staleSince ? {_meta: {[STALE_META_KEY]: staleSince}} : {})}]}
      })
  }

  return server
}

/** The body, or undefined when it exceeds MAX_REQUEST_BODY_BYTES. Stops reading at the bound. */
async function readBoundedBody(request: Request): Promise<string | undefined> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BODY_BYTES) {
    return undefined
  }
  if (!request.body) {
    return ''
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength
    if (size > MAX_REQUEST_BODY_BYTES) {
      await reader.cancel()
      return undefined
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** True when the body parses as a JSON array: a JSON-RPC batch. Anything unparseable is the SDK's to answer. */
function isBatch(body: string): boolean {
  try {
    return Array.isArray(JSON.parse(body))
  } catch {
    return false
  }
}

/**
 * Bounds a POST before the SDK sees it. A body over the bound answers 413 and a batch array 400.
 * MCP 2025-06-18 removed JSON-RPC batching; 2025-11-25 requires "The body of the POST request MUST
 * be a single JSON-RPC request, notification, or response", and 2026-07-28 "The body of the HTTP
 * POST MUST be a single JSON-RPC request or notification". Neither revision this server speaks
 * needs batch support, and a batch is the fan-out that multiplies upstream reads.
 */
async function boundedRequest(request: Request): Promise<Request | Response> {
  if (request.method !== 'POST') {
    return request
  }
  const body = await readBoundedBody(request)
  if (body === undefined) {
    return jsonRpcError(413, -32000, `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`)
  }
  if (isBatch(body)) {
    return jsonRpcError(400, -32600, 'JSON-RPC batch requests are not supported: send one message per POST')
  }
  return new Request(request.url, {method: 'POST', headers: request.headers, body})
}

/** The /mcp request handler: validation and bounds first, then the SDK entry with a per-request factory. */
export async function handleMcpRequest(context: CloudfrontProxyContext): Promise<Response> {
  const bounded = guardResponse(context.request) ?? await boundedRequest(context.request)
  const memo: ReadMemo = new Map()
  const response = bounded instanceof Response
    ? bounded
    : await createMcpHandler(() => buildMcpServer(context, memo), {
      maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
      onerror: (error) => logger.error('mcp_handler_error', {error_class: error.name, message: error.message})
    }).fetch(bounded)
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  if (response.status === 405) {
    headers.set('Allow', 'POST')
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}
