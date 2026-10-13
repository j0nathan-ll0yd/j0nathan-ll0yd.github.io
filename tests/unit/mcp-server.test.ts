// @vitest-environment node
//
// The /mcp Pages Function end to end, in process: the request goes through the real
// Host/Origin guard, the real SDK entry, and the real focus-gated proxy machinery.
// Only `fetch` (the CloudFront data plane) and the edge logger are stubbed.

import {readFileSync} from 'node:fs'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSION,
  RESOURCES,
  SERVER_CARD,
  SERVER_CARD_JSON,
  SERVER_CARD_MEDIA_TYPE,
  TOOLS
} from '../../functions/_lib/agent-catalog.mjs'
import {DISCOVERY_CACHE_SECONDS, LLM_CHANNEL_POLICY, LLM_WITHHELD_URLS} from '../../functions/_lib/agent-catalog.mjs'
import {allowedHostnames, MAX_REQUEST_BODY_BYTES, PAGES_PROJECT_HOST, readGated, STALE_META_KEY, withheldLinks} from '../../functions/_lib/mcp-server'
import type {ReadMemo} from '../../functions/_lib/mcp-server'
import {onRequest as mcpRoute} from '../../functions/mcp/index'
import {onRequest as serverCardRoute} from '../../functions/mcp/server-card'

const logger = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()}))
vi.mock('@j0nathan-ll0yd/observability/edge', () => ({createEdgeLogger: () => logger}))

const SITE_HOST = new URL(SITE_URL).hostname
const FOCUS_URL = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`
const BOOKS = {
  generatedAt: '2026-10-07T00:00:00.000Z',
  books: [
    {title: 'Reading A', status: 'reading'},
    {title: 'Next B', status: 'up-next'},
    ...Array.from({length: 7}, (_, i) => ({title: `Done ${i}`, status: 'finished'}))
  ]
}

// A value only the raw health, sleep, and workouts exports carry. It must never surface on an LLM channel.
const RAW_SENTINEL = 'RAW-POINT-IN-TIME-SENTINEL'

// The forbidden set, stated INDEPENDENTLY of the catalog policy under test (SKILL.md decision 4,
// atlas decision 0096). Deriving it from LLM_CHANNEL_POLICY would let one edit to the policy
// re-expose an export and shrink this list in the same breath.
const RAW_HEALTH_PATHS: readonly string[] = [ENDPOINTS.health, ENDPOINTS.sleep, ENDPOINTS.workouts]
const RAW_HEALTH_URLS = RAW_HEALTH_PATHS.map((path) => `${CLOUDFRONT_BASE}${path}`)

/** A response CloudFront served in this request. The proxy admits no 200 without `x-amz-cf-id`. */
function fromCloudfront(body: string, init: ResponseInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-amz-cf-id', 'test-request')
  return Promise.resolve(new Response(body, {...init, headers}))
}

let currentFocus = 'Personal'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  currentFocus = 'Personal'
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === FOCUS_URL) {
      return fromCloudfront(JSON.stringify({currentFocus}))
    }
    if (url === `${CLOUDFRONT_BASE}${ENDPOINTS.books}`) {
      return fromCloudfront(JSON.stringify(BOOKS))
    }
    if (url === `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.llmsFull}`) {
      return fromCloudfront('# llms-full')
    }
    if (RAW_HEALTH_URLS.includes(url)) {
      return fromCloudfront(JSON.stringify({generatedAt: 'x', heartRate: RAW_SENTINEL}))
    }
    return fromCloudfront(JSON.stringify({generatedAt: 'x', from: url}))
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('caches', {default: {match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined)}})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const META = {
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': {name: 'test', version: '0'},
  'io.modelcontextprotocol/clientCapabilities': {}
}

interface RpcOptions {
  host?: string
  origin?: string
  headers?: Record<string, string>
}

function context(request: Request) {
  const background: Promise<unknown>[] = []
  return {request, waitUntil: (promise: Promise<unknown>) => background.push(promise)}
}

function post(body: unknown, headers: Record<string, string>, {host = SITE_HOST, origin}: RpcOptions = {}) {
  const all: Record<string, string> = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', host, ...headers}
  if (origin) {
    all.origin = origin
  }
  return mcpRoute(context(new Request(`https://${host}/mcp`, {method: 'POST', headers: all, body: JSON.stringify(body)})))
}

/** Parse a JSON or single-message SSE response body into the JSON-RPC message. */
async function message(response: Response): Promise<{result?: Record<string, unknown>; error?: {code: number; message: string}}> {
  const text = await response.text()
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split('\n').filter((line) => line.startsWith('data:')).pop()
    return JSON.parse(data!.slice(5))
  }
  return JSON.parse(text)
}

/** A modern (2026-07-28) request: envelope `_meta` plus the mirrored headers. */
async function modern(method: string, params: Record<string, unknown> = {}, name?: string, options: RpcOptions = {}) {
  const headers: Record<string, string> = {'MCP-Protocol-Version': MCP_PROTOCOL_VERSION, 'Mcp-Method': method, ...options.headers}
  if (name) {
    headers['Mcp-Name'] = name
  }
  const response = await post({jsonrpc: '2.0', id: 1, method, params: {...params, _meta: META}}, headers, options)
  return {response, body: await message(response)}
}

function toolText(result: Record<string, unknown> | undefined) {
  const content = result?.content as Array<{type: string; text: string}>
  return JSON.parse(content[0]!.text)
}

describe('MCP lifecycle', () => {
  it('server/discover reports 2026-07-28, the catalog capabilities, and the server card identity', async () => {
    const {response, body} = await modern('server/discover')
    expect(response.status).toBe(200)
    expect(body.result?.supportedVersions).toContain(MCP_PROTOCOL_VERSION)
    expect(body.result?.capabilities).toEqual(expect.objectContaining({tools: expect.any(Object), resources: expect.any(Object)}))
    const info = (body.result?._meta as Record<string, {name: string; version: string}>)['io.modelcontextprotocol/serverInfo']
    expect(info).toEqual(expect.objectContaining({name: SERVER_CARD.name, version: SERVER_CARD.version}))
    expect(body.result?.ttlMs).toBe(DISCOVERY_CACHE_SECONDS * 1000)
    expect(body.result?.cacheScope).toBe('public')
    expect(body.result?.instructions).toBe(MCP_INSTRUCTIONS)
  })

  it('answers a 2025-11-25 client: initialize, then tools/list with no session', async () => {
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 't', version: '0'}}
    }, {})
    expect(init.status).toBe(200)
    expect(init.headers.get('mcp-session-id')).toBeNull()
    const initBody = await message(init)
    expect(initBody.result?.protocolVersion).toBe('2025-11-25')
    expect(initBody.result?.serverInfo).toEqual(expect.objectContaining({name: SERVER_CARD.name, version: SERVER_CARD.version}))

    const list = await post({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}}, {'MCP-Protocol-Version': '2025-11-25'})
    expect(list.status).toBe(200)
    expect(((await message(list)).result?.tools as unknown[]).length).toBe(TOOLS.length)
  })

  it('mints no session id and ignores one the client sends', async () => {
    const response = await post({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}}, {
      'MCP-Protocol-Version': '2025-11-25',
      'Mcp-Session-Id': 'stale-session'
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-session-id')).toBeNull()
  })

  it.each(['GET', 'DELETE'])('answers %s with 405 and Allow: POST', async (method) => {
    const response = await mcpRoute(context(new Request(`${SITE_URL}/mcp`, {method, headers: {host: SITE_HOST, Accept: 'text/event-stream'}})))
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })

  it('marks every response no-store, rejections included', async () => {
    expect((await modern('tools/list')).response.headers.get('Cache-Control')).toBe('no-store')
    expect((await modern('tools/list', {}, undefined, {origin: 'https://evil.example'})).response.headers.get('Cache-Control')).toBe('no-store')
  })

  // The lists change only on deploy. A listen stream must acknowledge and close, not idle
  // open on a per-request event bus that never publishes.
  it('closes a subscriptions/listen stream right after the acknowledgement', async () => {
    const response = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'subscriptions/listen',
      params: {notifications: {toolsListChanged: true, resourcesListChanged: true}, _meta: META}
    }, {'MCP-Protocol-Version': MCP_PROTOCOL_VERSION, 'Mcp-Method': 'subscriptions/listen'})
    expect(response.status).toBe(200)
    const text = await Promise.race([response.text(), new Promise<string>((resolve) => setTimeout(() => resolve('STILL OPEN'), 1000))])
    expect(text).not.toBe('STILL OPEN')
    expect(text).toContain('notifications/subscriptions/acknowledged')
    expect(text).toContain('"resultType":"complete"')
  })

  it('declares that the tool and resource lists never change at runtime', async () => {
    const {body} = await modern('server/discover')
    expect(body.result?.capabilities).toEqual(expect.objectContaining({tools: {listChanged: false}, resources: {listChanged: false}}))
  })
})

// The amplification bounds (independent review M1). Unbounded, a 100-call batch fanned out to 200
// upstream fetches and a 3.5 MiB junk parameter was accepted.
describe('request bounds', () => {
  const rpc = (body: string, headers: Record<string, string> = {}) =>
    mcpRoute(
      context(
        new Request(`${SITE_URL}/mcp`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', host: SITE_HOST, ...headers},
          body
        })
      )
    )
  const call = (id: number) => ({jsonrpc: '2.0', id, method: 'tools/call', params: {name: 'get_current_reading', arguments: {}, _meta: META}})

  /** A tools/call body padded to exactly `size` bytes. */
  const padded = (size: number) => {
    const base = JSON.stringify({...call(1), params: {...call(1).params, pad: ''}})
    return base.replace('"pad":""', `"pad":"${'x'.repeat(size - base.length)}"`)
  }
  const headers = {'MCP-Protocol-Version': MCP_PROTOCOL_VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_current_reading'}

  // The message is this module's, not the SDK's ("Payload Too Large: ..."), so the test reds if
  // the local bound is removed and only the SDK's maxRequestBodySize remains.
  it.each([
    ['one byte over the bound', MAX_REQUEST_BODY_BYTES + 1],
    ['a 3.5 MiB junk parameter', 3.5 * 1024 * 1024]
  ])('answers 413 for %s, before any upstream read', async (_label, size) => {
    const body = padded(size)
    expect(body.length).toBe(size)
    const response = await rpc(body, headers)
    expect(response.status).toBe(413)
    expect((await response.json()).error).toEqual({code: -32000, message: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 413 from a declared Content-Length over the bound without reading the body', async () => {
    const response = await rpc(JSON.stringify(call(1)), {'Content-Length': String(MAX_REQUEST_BODY_BYTES + 1)})
    expect(response.status).toBe(413)
  })

  it('serves a body at the bound', async () => {
    const body = padded(MAX_REQUEST_BODY_BYTES)
    expect(body.length).toBe(MAX_REQUEST_BODY_BYTES)
    expect((await rpc(body, headers)).status).toBe(200)
  })

  it('answers an unreadable body with 400 -32700, not an uncaught error', async () => {
    const body = new ReadableStream({pull: (controller) => controller.error(new TypeError('client aborted'))})
    const response = await mcpRoute(
      context(
        new Request(`${SITE_URL}/mcp`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', host: SITE_HOST},
            body,
            duplex: 'half'
          } as RequestInit)
      )
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe(-32700)
  })

  // The reviewer's 100-call batch no longer fits the body bound at all.
  it('answers the 100-call batch with 413 and makes no upstream read', async () => {
    const response = await rpc(JSON.stringify(Array.from({length: 100}, (_, i) => call(i))))
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // MCP 2025-11-25 and 2026-07-28 both require one JSON-RPC message per POST, so a batch that fits
  // the bound is rejected outright and makes no upstream read at all.
  it.each([
    ['modern', Array.from({length: 10}, (_, i) => call(i))],
    ['legacy', Array.from({length: 10}, (_, i) => ({jsonrpc: '2.0', id: i, method: 'tools/call', params: {name: 'get_current_reading', arguments: {}}}))]
  ])('rejects a %s JSON-RPC batch with 400 and makes no upstream read', async (_label, batch) => {
    const body = JSON.stringify(batch)
    expect(body.length).toBeLessThan(MAX_REQUEST_BODY_BYTES)
    const response = await rpc(body)
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe(-32600)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // One memo per inbound request: repeated reads of one path share one gated read, so the
  // fan-out is one focus probe and one artifact read per path, however many reads ask.
  it('shares one gated read per path across repeated reads in one request', async () => {
    const memo: ReadMemo = new Map()
    const ctx = context(new Request(`${SITE_URL}/mcp`, {method: 'POST', headers: {host: SITE_HOST}}))
    const reads = await Promise.all([
      ...Array.from({length: 50}, () => readGated(ENDPOINTS.books, ctx, memo)),
      ...Array.from({length: 50}, () => readGated(ENDPOINTS.articles, ctx, memo))
    ])
    expect(reads.every((read) => read.status === 'ok')).toBe(true)
    const upstream = fetchMock.mock.calls.map(([url]) => url as string)
    expect(upstream.filter((url) => url === `${CLOUDFRONT_BASE}${ENDPOINTS.books}`)).toHaveLength(1)
    expect(upstream.filter((url) => url === `${CLOUDFRONT_BASE}${ENDPOINTS.articles}`)).toHaveLength(1)
    expect(upstream.filter((url) => url === FOCUS_URL)).toHaveLength(2)
  })
})

describe('Host and Origin validation', () => {
  it('rejects a foreign Origin with 403 and a fixed message that does not echo the header', async () => {
    const hostile = 'https://evil.example/<script>'
    const {response, body} = await modern('tools/list', {}, undefined, {origin: hostile})
    expect(response.status).toBe(403)
    expect(body.error?.message).toBe('Invalid Origin header')
  })

  it('rejects a foreign Host with a fixed message that does not echo the header', async () => {
    const {response, body} = await modern('tools/list', {}, undefined, {host: 'evil.example'})
    expect(response.status).toBe(403)
    expect(body.error?.message).toBe('Invalid Host header')
  })

  // A localhost Origin is a page on the caller's own machine. Only `wrangler pages dev`, whose
  // Host is localhost, accepts one; a deployed host never does.
  it.each(['http://localhost:4321', 'http://127.0.0.1:8788'])('accepts the Origin %s in development only', async (origin) => {
    expect((await modern('tools/list', {}, undefined, {origin})).response.status).toBe(403)
    expect((await modern('tools/list', {}, undefined, {host: `${PAGES_PROJECT_HOST}`, origin})).response.status).toBe(403)
    expect((await modern('tools/list', {}, undefined, {host: 'localhost:8788', origin})).response.status).toBe(200)
    expect((await modern('tools/list', {}, undefined, {host: '127.0.0.1:8788', origin})).response.status).toBe(200)
  })

  it('accepts the site origin and a preview origin of this Pages project', async () => {
    expect((await modern('tools/list', {}, undefined, {origin: SITE_URL})).response.status).toBe(200)
    const preview = `agent-readiness.${PAGES_PROJECT_HOST}`
    expect((await modern('tools/list', {}, undefined, {host: preview, origin: `https://${preview}`})).response.status).toBe(200)
  })

  it('rejects a Host outside the allowlist, and a look-alike preview suffix', async () => {
    expect((await modern('tools/list', {}, undefined, {host: 'evil.example'})).response.status).toBe(403)
    expect((await modern('tools/list', {}, undefined, {host: `x${PAGES_PROJECT_HOST}`})).response.status).toBe(403)
  })

  it('names the Pages project the deploy workflows deploy to', () => {
    const project = PAGES_PROJECT_HOST.replace('.pages.dev', '')
    for (const workflow of ['.github/workflows/deploy.yml', '.github/workflows/preview-deploy.yml']) {
      expect(readFileSync(workflow, 'utf8')).toContain(`--project-name=${project}`)
    }
    expect(allowedHostnames(undefined)).toContain(SITE_HOST)
    expect(allowedHostnames(undefined)).not.toContain('localhost')
    expect(allowedHostnames(undefined, {development: true})).toEqual(expect.arrayContaining(['localhost', '127.0.0.1']))
  })
})

describe('tools', () => {
  it('lists the catalog tools, every one annotated readOnlyHint: true', async () => {
    const {body} = await modern('tools/list')
    const tools = body.result?.tools as Array<{name: string; annotations: Record<string, boolean>}>
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(true)
      expect(tool.annotations.destructiveHint).toBe(false)
    }
  })

  it.each(TOOLS.filter((t) => t.kind === 'static').map((t) => t.name))('tools/call %s returns the catalog payload', async (name) => {
    const {body} = await modern('tools/call', {name, arguments: {}}, name)
    const tool = TOOLS.find((t) => t.name === name)!
    expect(toolText(body.result)).toEqual(JSON.parse(JSON.stringify('payload' in tool ? tool.payload : null)))
  })

  it('tools/call get_tech_stack names the installed Astro major', async () => {
    const {body} = await modern('tools/call', {name: 'get_tech_stack', arguments: {}}, 'get_tech_stack')
    const astroMajor = JSON.parse(readFileSync('node_modules/astro/package.json', 'utf8')).version.split('.')[0]
    expect(toolText(body.result).framework).toContain(`Astro ${astroMajor}.`)
  })

  it('tools/call get_current_reading reads books through the gate and summarizes them', async () => {
    const {body} = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    const result = toolText(body.result)
    expect(result.reading.map((b: {title: string}) => b.title)).toEqual(['Reading A'])
    expect(result.upNext.map((b: {title: string}) => b.title)).toEqual(['Next B'])
    expect(result.recentlyFinished).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledWith(FOCUS_URL, expect.anything())
  })

  it.each(HIDING_FOCUS_MODES)('tools/call get_current_reading returns the suppression document, never data, during %s', async (mode) => {
    currentFocus = mode
    const {body} = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    expect(toolText(body.result)).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(fetchMock).not.toHaveBeenCalledWith(`${CLOUDFRONT_BASE}${ENDPOINTS.books}`, expect.anything())
  })

  it('fails closed when the focus state cannot be read', async () => {
    fetchMock.mockImplementation((url: string) => url === FOCUS_URL ? fromCloudfront('nope', {status: 404}) : fromCloudfront(JSON.stringify(BOOKS)))
    const {body} = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    expect(body.result?.isError).toBe(true)
    expect(JSON.stringify(body.result)).not.toContain('Reading A')
  })
})

describe('tool failures', () => {
  // The engine's JSON.parse message can quote the upstream body; it never reaches the client.
  it('answers a non-JSON artifact with a structured failure, not the engine error text', async () => {
    fetchMock.mockImplementation((url: string) =>
      url === FOCUS_URL ? fromCloudfront(JSON.stringify({currentFocus})) : fromCloudfront('<html>SECRET-UPSTREAM-PAGE</html>')
    )
    const {body} = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    expect(body.result?.isError).toBe(true)
    expect(toolText(body.result)).toEqual({failed: true, reason: 'artifact unreadable'})
    expect(JSON.stringify(body)).not.toMatch(/SECRET-UPSTREAM-PAGE|Unexpected token|JSON/)
  })

  it('answers an artifact whose summary throws with the same structured failure', async () => {
    fetchMock.mockImplementation((url: string) => url === FOCUS_URL ? fromCloudfront(JSON.stringify({currentFocus})) : fromCloudfront('{"books":[null]}'))
    const {body} = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    expect(toolText(body.result)).toEqual({failed: true, reason: 'artifact unreadable'})
  })
})

describe('resources', () => {
  it('lists the policy-exposed JSON exports and llms-full.txt', async () => {
    const {body} = await modern('resources/list')
    const uris = (body.result?.resources as Array<{uri: string}>).map((r) => r.uri)
    expect(uris).toEqual(RESOURCES.map((r) => r.uri))
    const exposed = (Object.entries(ENDPOINTS) as Array<[string, string]>).filter(([key]) => (LLM_CHANNEL_POLICY.exposed as readonly string[]).includes(key))
    expect(uris).toEqual([...exposed.map(([, path]) => `${CLOUDFRONT_BASE}${path}`), `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`])
  })

  it('resources/read returns the artifact through the proxy', async () => {
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.books}`
    const {body} = await modern('resources/read', {uri}, uri)
    const contents = body.result?.contents as Array<{uri: string; mimeType: string; text: string}>
    expect(contents[0]).toEqual({uri, mimeType: 'application/json', text: JSON.stringify(BOOKS)})
  })

  it('resources/read of a suppressible artifact returns the suppression document during a hiding mode', async () => {
    currentFocus = HIDING_FOCUS_MODES[0]
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.books}`
    const {body} = await modern('resources/read', {uri}, uri)
    const contents = body.result?.contents as Array<{text: string}>
    expect(JSON.parse(contents[0]!.text)).toEqual({suppressed: true, reason: 'focus mode active'})
  })

  // The gate runs before the last-known-good fallback, so a stale copy cannot outlive a hiding transition.
  it('never serves a stale copy while hiding, even when the edge cache holds an admissible one', async () => {
    const match = vi.fn().mockResolvedValue(new Response(JSON.stringify(BOOKS), {headers: {'X-Proxy-Lkg-Composed-At': new Date().toISOString()}}))
    vi.stubGlobal('caches', {default: {match, put: vi.fn()}})
    currentFocus = HIDING_FOCUS_MODES[0]
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.books}`
    const {body} = await modern('resources/read', {uri}, uri)
    const contents = body.result?.contents as Array<{text: string}>
    expect(JSON.parse(contents[0]!.text)).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(match).not.toHaveBeenCalled()
  })

  // The backend gate is the authority, not the focus signal: it can be shut over a visible value,
  // and its 403 suppression body wins over a visible focus probe (functions/_lib/proxy.ts, rule 2).
  // That body reaches an agent as the suppression document, never as an error or data.
  it('returns the suppression document when the gate answers 403 over a visible focus value', async () => {
    fetchMock.mockImplementation((url: string) =>
      url === FOCUS_URL
        ? fromCloudfront(JSON.stringify({currentFocus}))
        : fromCloudfront(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403})
    )
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.books}`
    const read = await modern('resources/read', {uri}, uri)
    const contents = read.body.result?.contents as Array<{text: string}>
    expect(JSON.parse(contents[0]!.text)).toEqual({suppressed: true, reason: 'focus mode active'})
    const call = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    expect(call.body.result?.isError).toBeUndefined()
    expect(toolText(call.body.result)).toEqual({suppressed: true, reason: 'focus mode active'})
  })

  // The proxy serves a stored copy only with a composition stamp at most 3 hours old and gate-open
  // evidence from this request: here, a gate probe answering 200 after three CloudFront 503s.
  it('marks data served from the last-known-good copy with the time it was stored', async () => {
    const stored = new Response(JSON.stringify(BOOKS), {
      headers: {'X-Proxy-Lkg-Stored-At': '2026-10-07T00:00:00.000Z', 'X-Proxy-Lkg-Composed-At': new Date().toISOString()}
    })
    vi.stubGlobal('caches', {default: {match: vi.fn().mockResolvedValue(stored), put: vi.fn()}})
    let artifactAttempts = 0
    fetchMock.mockImplementation((url: string) => {
      if (url === FOCUS_URL) {
        return fromCloudfront(JSON.stringify({currentFocus}))
      }
      artifactAttempts += 1
      return artifactAttempts <= 3 ? fromCloudfront('down', {status: 503}) : fromCloudfront('gate probe body, never served')
    })
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.books}`
    const {body} = await modern('resources/read', {uri}, uri)
    const contents = body.result?.contents as Array<{text: string; _meta?: Record<string, string>}>
    expect(contents[0]!.text).toBe(JSON.stringify(BOOKS))
    expect(contents[0]!._meta?.[STALE_META_KEY]).toBe('2026-10-07T00:00:00.000Z')
  })

  it('reads the focus signal like the gate does: no edge cache, no last-known-good copy', async () => {
    const put = vi.fn()
    vi.stubGlobal('caches', {default: {match: vi.fn().mockResolvedValue(new Response('{"currentFocus":"stale"}')), put}})
    fetchMock.mockImplementation(() => Promise.resolve(new Response('down', {status: 503})))
    const {body} = await modern('resources/read', {uri: FOCUS_URL}, FOCUS_URL)
    expect(body.error).toBeDefined()
    expect(JSON.stringify(body)).not.toContain('stale')
    for (const [url, init] of fetchMock.mock.calls) {
      if (url === FOCUS_URL) {
        expect(init).toEqual(expect.objectContaining({cache: 'no-store'}))
        expect(init.cf).toBeUndefined()
      }
    }
    expect(put).not.toHaveBeenCalled()
  })

  it('resources/read of the focus signal is never gated, as at the edge', async () => {
    currentFocus = HIDING_FOCUS_MODES[0]
    const {body} = await modern('resources/read', {uri: FOCUS_URL}, FOCUS_URL)
    const contents = body.result?.contents as Array<{text: string}>
    expect(JSON.parse(contents[0]!.text)).toEqual({currentFocus: HIDING_FOCUS_MODES[0]})
  })
})

// LLM-CHANNEL DATA POLICY (SKILL.md decision 4, atlas decision 0096, applied 2026-10-07). The raw
// health, sleep, and workouts exports never reach an agent through MCP: not listed, not readable,
// not named, not fetched. These tests are the enforcement: a catalog edit that reintroduces one
// reds here, whichever surface it touches.
// A realistic llms-full.txt: the production document of 2026-10-12, which still links the three raw
// exports in its Streams section (backend PR #379 removes them). Its freshness table names every
// source as a bare file name, which is a disclosure and not a link.
const LLMS_FULL_2026_10_12 = readFileSync('tests/unit/fixtures/llms-full-2026-10-12.txt', 'utf8')
const LLMS_FULL_UPSTREAM = `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.llmsFull}`
const LLMS_FULL_URI = `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`

describe('llms-full.txt passthrough', () => {
  const serving = (text: string) =>
    fetchMock.mockImplementation((url: string) =>
      url === FOCUS_URL ? fromCloudfront(JSON.stringify({currentFocus})) : url === LLMS_FULL_UPSTREAM ? fromCloudfront(text) : fromCloudfront('{}')
    )

  it('the fixture is the pre-#379 document: it links all three raw exports and names them in the freshness table', () => {
    for (const path of RAW_HEALTH_PATHS) {
      expect(LLMS_FULL_2026_10_12).toContain(`${CLOUDFRONT_BASE}${path}`)
      expect(LLMS_FULL_2026_10_12).toContain(`| ${path.slice(1)} |`)
    }
  })

  it('fails closed on a document that links a withheld export: no text reaches the agent', async () => {
    serving(LLMS_FULL_2026_10_12)
    const {body} = await modern('resources/read', {uri: LLMS_FULL_URI}, LLMS_FULL_URI)
    expect(body.result).toBeUndefined()
    expect(body.error).toBeDefined()
    expect(JSON.stringify(body)).not.toContain(RAW_SENTINEL)
    for (const path of RAW_HEALTH_PATHS) {
      expect(JSON.stringify(body)).not.toContain(`${CLOUDFRONT_BASE}${path}`)
    }
    expect(JSON.stringify(body)).not.toContain('Human Datastream (Complete)')
  })

  it.each(RAW_HEALTH_PATHS)('fails closed on any link form of %s: relative, encoded, code span, or another origin', async (path) => {
    const name = path.slice(1)
    const encoded = path.replace('.', '%2E')
    for (
      const form of [
        `see ${path}`,
        `\`https://mirror.example${path}\``,
        `[raw](${path})`,
        `[raw](${name})`,
        `[raw](./${name})`,
        `[raw](${encoded})`,
        `https://mirror.example${encoded}`,
        `<https://mirror.example${encoded}>`,
        `[raw]: ${name}`
      ]
    ) {
      serving(`# Jonathan Lloyd\n\n${form}\n`)
      const {body} = await modern('resources/read', {uri: LLMS_FULL_URI}, LLMS_FULL_URI)
      expect(body.result, form).toBeUndefined()
    }
  })

  it('matches links, not disclosures: the freshness table and plain file names pass', () => {
    expect(withheldLinks('| health.json | 2026-10-12T23:19:04.462Z |\nhealth.json, sleep.json and workouts.json', LLMS_FULL_URI)).toEqual([])
    expect(withheldLinks('<SYSTEM>profile</SYSTEM> [books](https://d1pfm520aduift.cloudfront.net/books.json)', LLMS_FULL_URI)).toEqual([])
    expect(withheldLinks(LLMS_FULL_2026_10_12, LLMS_FULL_URI).sort()).toEqual([...RAW_HEALTH_PATHS].sort())
  })

  // The check guards republished backend prose only. A JSON export carries third-party text (commit
  // titles, starred-repo descriptions) and is served as data, so a title that names a path does not
  // break it.
  it('does not scan a JSON export: a commit title that names /health.json is served', async () => {
    const events = JSON.stringify({events: [{title: 'fix(api): drop the /health.json link'}]})
    fetchMock.mockImplementation((url: string) => url === FOCUS_URL ? fromCloudfront(JSON.stringify({currentFocus})) : fromCloudfront(events))
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.githubEvents}`
    const {body} = await modern('resources/read', {uri}, uri)
    expect((body.result?.contents as Array<{text: string}>)[0]!.text).toBe(events)
  })

  it('serves the post-#379 document verbatim: freshness rows stay, raw links are gone', async () => {
    const fixed = LLMS_FULL_2026_10_12.split('\n').filter((line) => !RAW_HEALTH_PATHS.some((path) => line.includes(`${CLOUDFRONT_BASE}${path}`))).join('\n')
    expect(fixed).toContain('| health.json |')
    serving(fixed)
    const {body} = await modern('resources/read', {uri: LLMS_FULL_URI}, LLMS_FULL_URI)
    const contents = body.result?.contents as Array<{text: string; mimeType: string}>
    expect(contents[0]).toEqual(expect.objectContaining({mimeType: 'text/markdown', text: fixed}))
  })
})

describe('LLM-channel data policy', () => {
  function expectNoRawHealth(text: string) {
    for (const url of RAW_HEALTH_URLS) {
      expect(text).not.toContain(url)
    }
    for (const path of RAW_HEALTH_PATHS) {
      expect(text).not.toContain(path)
    }
    expect(text).not.toContain(RAW_SENTINEL)
  }

  it('classifies every portal-contract endpoint exactly once', () => {
    const classified = [...LLM_CHANNEL_POLICY.exposed, ...LLM_CHANNEL_POLICY.coarsenedOnly].sort()
    expect(classified).toEqual(Object.keys(ENDPOINTS).sort())
    expect([...LLM_CHANNEL_POLICY.coarsenedOnly].sort()).toEqual(['health', 'sleep', 'workouts'])
  })

  it('resources/list names none of the raw health, sleep, or workouts exports', async () => {
    const {body} = await modern('resources/list')
    expectNoRawHealth(JSON.stringify(body))
  })

  it('every tools/call result excludes the raw exports, their URLs, and their values', async () => {
    for (const tool of TOOLS) {
      const {body} = await modern('tools/call', {name: tool.name, arguments: {}}, tool.name)
      expect(body.result, tool.name).toBeDefined()
      expectNoRawHealth(JSON.stringify(body))
    }
    for (const [url] of fetchMock.mock.calls) {
      expect(RAW_HEALTH_URLS).not.toContain(url)
    }
  })

  it('get_data_sources points the coarsened-only domains at llms-full.txt', async () => {
    const {body} = await modern('tools/call', {name: 'get_data_sources', arguments: {}}, 'get_data_sources')
    const sources = toolText(body.result) as Array<{url: string}>
    expect(sources).toHaveLength(Object.keys(ENDPOINTS).length)
    expect(sources.filter((s) => s.url === `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`)).toHaveLength(RAW_HEALTH_URLS.length)
  })

  it('the catalog withholds exactly the three raw exports', () => {
    expect([...LLM_WITHHELD_URLS].sort()).toEqual([...RAW_HEALTH_URLS].sort())
  })

  it.each(RAW_HEALTH_URLS.map((url) => [url]))('resources/read of %s is refused without a fetch', async (uri) => {
    const {body} = await modern('resources/read', {uri}, uri)
    expect(body.result).toBeUndefined()
    expect(body.error).toBeDefined()
    // The SDK's "Resource not found" error echoes the URI the client sent, which discloses
    // nothing. What must hold is no data in the answer and no read of the raw export.
    expect(JSON.stringify(body)).not.toContain(RAW_SENTINEL)
    expect(fetchMock).not.toHaveBeenCalledWith(uri, expect.anything())
  })
})

describe('/mcp/server-card', () => {
  const card = (method = 'GET', headers: Record<string, string> = {}) =>
    serverCardRoute({request: new Request(`${SITE_URL}/mcp/server-card`, {method, headers})})

  it('serves the card with its media type, open CORS, a one-hour public cache and an ETag', async () => {
    const response = await card()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(SERVER_CARD_MEDIA_TYPE)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('ETag')
    expect(response.headers.get('Cache-Control')).toBe(`public, max-age=${DISCOVERY_CACHE_SECONDS}`)
    expect(response.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/)
    expect(await response.text()).toBe(SERVER_CARD_JSON)
  })

  it('is byte-identical to the compatibility copy', () => {
    expect(readFileSync('public/.well-known/mcp/server-card.json', 'utf8')).toBe(SERVER_CARD_JSON)
  })

  it('answers a matching If-None-Match with 304, by weak comparison', async () => {
    const etag = (await card()).headers.get('ETag')!
    expect((await card('GET', {'If-None-Match': etag})).status).toBe(304)
    expect((await card('GET', {'If-None-Match': `W/${etag}`})).status).toBe(304)
    expect((await card('GET', {'If-None-Match': '"other"'})).status).toBe(200)
  })

  it('answers a CORS preflight with 204 and other methods with 405', async () => {
    expect((await card('OPTIONS')).status).toBe(204)
    expect((await card('POST')).status).toBe(405)
  })
})
