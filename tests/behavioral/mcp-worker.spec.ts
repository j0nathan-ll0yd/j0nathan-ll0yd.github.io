/**
 * The MCP server and its card, through the built Worker (atlas decisions 0158 and 0160).
 *
 * tests/unit/mcp-server.test.ts runs the handler in Node with the SDK's Node shim. This suite runs
 * the production build under `astro preview`, which serves it in workerd through src/worker.ts:
 * the run_worker_first routing, the Astro `ALL` adapter, the trailing-slash rewrite with a POST
 * body, the site middleware wrapping, and the SDK's workerd shim. No exchange here reads an
 * upstream: each answers from the catalog, so the suite needs no network.
 */
import {expect, test} from '@playwright/test'

const MODERN = '2026-07-28'
const META = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': {name: 'behavioral', version: '1'},
  'io.modelcontextprotocol/clientCapabilities': {}
}
const JSON_RPC = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'}

/** The JSON-RPC message in a JSON or single-message SSE body. */
function message(text: string, contentType: string): {result?: Record<string, unknown>; error?: {code: number}} {
  if (contentType.includes('text/event-stream')) {
    const data = text.split('\n').filter((line) => line.startsWith('data:')).pop()
    return JSON.parse(data!.slice(5))
  }
  return JSON.parse(text)
}

test.describe('MCP server in the Worker', () => {
  for (const path of ['/mcp', '/mcp/']) {
    test(`answers a 2025-11-25 initialize on ${path} with no session id`, async ({request}) => {
      const response = await request.post(path, {
        headers: JSON_RPC,
        data: {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'b', version: '1'}}}
      })
      expect(response.status()).toBe(200)
      expect(response.headers()['mcp-session-id']).toBeUndefined()
      const body = message(await response.text(), response.headers()['content-type'] ?? '')
      expect(body.result?.serverInfo).toEqual(expect.objectContaining({name: 'me.jonathanlloyd/human-datastream'}))
    })
  }

  test('answers server/discover, tools/list, resources/list, and a catalog tools/call on the 2026-07-28 leg', async ({request}) => {
    const call = async (method: string, params: Record<string, unknown> = {}, name?: string) => {
      const headers = {...JSON_RPC, 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method, ...(name ? {'Mcp-Name': name} : {})}
      const response = await request.post('/mcp', {headers, data: {jsonrpc: '2.0', id: 1, method, params: {...params, _meta: META}}})
      expect(response.status(), method).toBe(200)
      return message(await response.text(), response.headers()['content-type'] ?? '')
    }
    expect((await call('server/discover')).result?.supportedVersions).toEqual([MODERN])
    const tools = (await call('tools/list')).result?.tools as Array<{name: string; annotations: {readOnlyHint: boolean}}>
    expect(tools.map((tool) => tool.name)).toEqual(['get_profile', 'get_data_sources', 'get_current_reading', 'get_tech_stack'])
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true)
    expect((await call('resources/list')).result?.resources).toHaveLength(7)
    const profile = await call('tools/call', {name: 'get_profile', arguments: {}}, 'get_profile')
    expect(profile.result?.isError).toBeUndefined()
  })

  // OPTIONS is left out on purpose: the `astro preview` server answers a preflight itself (204,
  // before the Worker runs), so it would measure the preview server, not the deployed Worker.
  // `wrangler dev` on the same build answers OPTIONS /mcp with 405 and Allow: POST, and
  // tests/unit/worker-entry.test.ts pins that the Worker hands OPTIONS to the route.
  test('answers GET and DELETE on /mcp with 405 and Allow: POST, through the middleware', async ({request}) => {
    for (const method of ['GET', 'DELETE']) {
      const response = await request.fetch('/mcp', {method})
      expect(response.status(), method).toBe(405)
      expect(response.headers()['allow'], method).toBe('POST')
      expect(response.headers()['cache-control'], method).toBe('no-store')
      expect(response.headers()['content-security-policy'], method).toBeTruthy()
    }
  })

  test('bounds the body and refuses a batch before any read', async ({request}) => {
    const big = await request.post('/mcp', {
      headers: JSON_RPC,
      data: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {pad: 'x'.repeat(9000)}})
    })
    expect(big.status()).toBe(413)
    const batch = await request.post('/mcp', {headers: JSON_RPC, data: JSON.stringify([{jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}])})
    expect(batch.status()).toBe(400)
  })

  test('serves the server card with its media type, CORS, and a 304 on a weak If-None-Match', async ({request}) => {
    const response = await request.get('/mcp/server-card')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/mcp-server-card+json')
    expect(response.headers()['access-control-allow-origin']).toBe('*')
    const etag = response.headers()['etag']!
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)
    expect((await request.get('/mcp/server-card', {headers: {'If-None-Match': `W/${etag}`}})).status()).toBe(304)
    const compat = await request.get('/.well-known/mcp/server-card.json')
    expect(await compat.text()).toBe(await response.text())
    expect((await request.post('/mcp/server-card')).status()).toBe(405)
  })
})
