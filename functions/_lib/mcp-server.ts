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
// anything is parsed, and a JSON-RPC batch array answers 400 (see boundedRequest). Every
// inbound request also carries one read memo, so repeated reads of one path would share
// one gated read.

import {
  createMcpHandler,
  localhostAllowedHostnames,
  McpServer,
  readRequestBody,
  validateHostHeader,
  validateOriginHeader
} from '@modelcontextprotocol/server'
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
 * The `wrangler pages dev` hostnames (`localhost`, `127.0.0.1`, `[::1]`). Cloudflare routes a request
 * to this project by its Host, so a request whose Host is one of these never reached a deploy: it is
 * local development.
 */
const DEVELOPMENT_HOSTNAMES = localhostAllowedHostnames()

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
}

/**
 * One memo per inbound request: repeated reads of one path share one gated read. Defense in depth:
 * with batches rejected, one POST carries one message and each message reads at most one path, so
 * no inbound request reaches a second read today. The memo keeps that bound if that ever changes.
 */
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

/** The withheld exports' file names (`health.json`, ...), for matching a resolved link target. */
const WITHHELD_NAMES = new Set(LLM_WITHHELD_PATHS.map((path: string) => path.slice(1)))

/** Link targets in markdown: inline `](target)`, autolinks `<target>`, reference definitions, and bare URLs. */
const LINK_TARGETS = [/\]\(\s*<?([^)\s>]+)/g, /<([^>\s]+)>/g, /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm, /\bhttps?:\/\/[^\s)>\]|`'"]+/g]

/**
 * The withheld exports a text links, in any form an agent could follow:
 *
 * - any occurrence of `/health.json`, `/sleep.json`, or `/workouts.json`: absolute and root-relative
 *   links, code spans, and an unresolved `{cloudfrontBase}` placeholder all contain it;
 * - any link target that resolves, against the document URL and after percent-decoding, to a path
 *   whose last segment is a withheld file name: `[raw](health.json)`, `/health%2Ejson`.
 *
 * A bare file name in prose with no slash, such as the freshness table's `| health.json |`, is a
 * disclosure, not a link, and does not match. The backend tests its llms documents with the same
 * slash rule (mantle-LifegamesPortal PR #379).
 */
export function withheldLinks(text: string, documentUrl: string): string[] {
  const found = new Set<string>(LLM_WITHHELD_PATHS.filter((path: string) => text.includes(path)))
  for (const pattern of LINK_TARGETS) {
    for (const match of text.matchAll(pattern)) {
      let name: string | undefined
      try {
        name = decodeURIComponent(new URL(match[1] ?? match[0], documentUrl).pathname).split('/').pop()
      } catch {
        continue
      }
      if (name !== undefined && WITHHELD_NAMES.has(name)) {
        found.add(`/${name}`)
      }
    }
  }
  return [...found]
}

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
        // FAIL CLOSED on a withheld export link in republished backend text. llms-full.txt reaches
        // agents verbatim, so the LLM-channel data policy holds for it only while the backend omits
        // those links. A copy that links one is never served on this channel.
        const linked = read.status === 'ok' && resource.republished ? withheldLinks(read.text, resource.uri) : []
        if (linked.length > 0) {
          logger.error('mcp_withheld_link_refused', {artifact: resource.path, withheld: linked})
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
 *
 * Batches: 2026-07-28 says "The body of the HTTP POST MUST be a single JSON-RPC request or
 * notification", 2025-11-25 "The body of the POST request MUST be a single JSON-RPC request,
 * notification, or response", and 2025-06-18 removed batching. Neither revision this server serves
 * as current needs batch support, and a batch is the fan-out that multiplies upstream reads. This
 * is a deliberate deviation for one older revision: the SDK's legacy leg still negotiates
 * 2025-03-26, which says implementations "MUST support receiving JSON-RPC batches". A 2025-03-26
 * client that batches gets 400.
 *
 * The body is decoded as UTF-8 (RFC 8259 requires it of JSON) and forwarded as text with the
 * client's abort signal; the runtime sets the new Content-Length.
 */
async function boundedRequest(request: Request): Promise<Request | Response> {
  if (request.method !== 'POST') {
    return request
  }
  let body: Awaited<ReturnType<typeof readRequestBody>>
  try {
    body = await readRequestBody(request, MAX_REQUEST_BODY_BYTES)
  } catch (error) {
    logger.warn('mcp_request_body_unreadable', {error_class: error instanceof Error ? error.name : 'unknown'})
    return jsonRpcError(400, -32700, 'The request body could not be read')
  }
  if (body.tooLarge || body.text === undefined) {
    return jsonRpcError(413, -32000, `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`)
  }
  if (isBatch(body.text)) {
    return jsonRpcError(400, -32600, 'JSON-RPC batch requests are not supported: send one message per POST')
  }
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  return new Request(request.url, {method: 'POST', headers, body: body.text, signal: request.signal})
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
