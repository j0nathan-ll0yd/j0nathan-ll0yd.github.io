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
import {DISCOVERY_CACHE_SECONDS} from '../../functions/_lib/agent-catalog.mjs'
import {allowedHostnames, PAGES_PROJECT_HOST, STALE_META_KEY} from '../../functions/_lib/mcp-server'
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

let currentFocus = 'Personal'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  currentFocus = 'Personal'
  fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === FOCUS_URL) {
      return Promise.resolve(new Response(JSON.stringify({currentFocus})))
    }
    if (url === `${CLOUDFRONT_BASE}${ENDPOINTS.books}`) {
      return Promise.resolve(new Response(JSON.stringify(BOOKS)))
    }
    if (url === `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.llmsFull}`) {
      return Promise.resolve(new Response('# llms-full'))
    }
    return Promise.resolve(new Response(JSON.stringify({generatedAt: 'x', from: url})))
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

  it.each(['GET', 'DELETE'])('answers %s with 405', async (method) => {
    const response = await mcpRoute(context(new Request(`${SITE_URL}/mcp`, {method, headers: {host: SITE_HOST, Accept: 'text/event-stream'}})))
    expect(response.status).toBe(405)
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

describe('Host and Origin validation', () => {
  it('rejects a foreign Origin with 403', async () => {
    const {response} = await modern('tools/list', {}, undefined, {origin: 'https://evil.example'})
    expect(response.status).toBe(403)
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
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === FOCUS_URL ? new Response('nope', {status: 404}) : new Response(JSON.stringify(BOOKS)))
    )
    const {body} = await modern('tools/call', {name: 'get_current_reading', arguments: {}}, 'get_current_reading')
    expect(body.result?.isError).toBe(true)
    expect(JSON.stringify(body.result)).not.toContain('Reading A')
  })
})

describe('resources', () => {
  it('lists the nine JSON exports and llms-full.txt', async () => {
    const {body} = await modern('resources/list')
    const uris = (body.result?.resources as Array<{uri: string}>).map((r) => r.uri)
    expect(uris).toEqual(RESOURCES.map((r) => r.uri))
    expect(uris).toEqual([...Object.values(ENDPOINTS).map((path) => `${CLOUDFRONT_BASE}${path}`), `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`])
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
  it('never serves a stale copy while hiding, even when the edge cache holds one', async () => {
    vi.stubGlobal('caches', {default: {match: vi.fn().mockResolvedValue(new Response(JSON.stringify(BOOKS))), put: vi.fn()}})
    currentFocus = HIDING_FOCUS_MODES[0]
    const uri = `${CLOUDFRONT_BASE}${ENDPOINTS.books}`
    const {body} = await modern('resources/read', {uri}, uri)
    const contents = body.result?.contents as Array<{text: string}>
    expect(JSON.parse(contents[0]!.text)).toEqual({suppressed: true, reason: 'focus mode active'})
  })

  it('marks data served from the last-known-good copy with the time it was stored', async () => {
    const stored = new Response(JSON.stringify(BOOKS), {headers: {'X-Proxy-Lkg-Stored-At': '2026-10-07T00:00:00.000Z'}})
    vi.stubGlobal('caches', {default: {match: vi.fn().mockResolvedValue(stored), put: vi.fn()}})
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === FOCUS_URL ? new Response(JSON.stringify({currentFocus})) : new Response('down', {status: 503}))
    )
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
