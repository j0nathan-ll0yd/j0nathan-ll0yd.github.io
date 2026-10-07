import fs from 'node:fs'
import path from 'node:path'
import {Validator} from '@seriousme/openapi-schema-validator'
import {CLOUDFRONT_BASE, ENDPOINTS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import Ajv2020 from 'ajv/dist/2020.js'
import * as cheerio from 'cheerio'
import {describe, expect, it} from 'vitest'
import {AGENT_PATHS, SERVER_CARD_JSON, SERVER_CARD_MEDIA_TYPE, SERVER_CARD_URL} from '../../functions/_lib/agent-catalog.mjs'

const distDir = path.resolve('dist')
const read = (relativePath: string) => fs.readFileSync(path.join(distDir, relativePath), 'utf-8')

describe('agent discovery build output', () => {
  const catalog = read('.well-known/ai-catalog.json')

  it('does not publish an A2A Agent Card without an A2A server', () => {
    expect(fs.existsSync(path.join(distDir, '.well-known', 'agent-card.json'))).toBe(false)
    expect(catalog).not.toContain('application/a2a-agent-card+json')
    expect(catalog).not.toContain('/.well-known/agent-card.json')
  })

  it('points the catalog MCP entry at the canonical server card, and names no unresolvable DID', () => {
    const parsed = JSON.parse(catalog)
    expect(parsed.specVersion).toBe('1.0')
    const mcp = parsed.entries.find((e: {type: string}) => e.type === SERVER_CARD_MEDIA_TYPE)
    expect(mcp.url).toBe(SERVER_CARD_URL)
    expect(SERVER_CARD_URL).toBe(`${SITE_URL}/mcp/server-card`)
    expect(catalog).not.toContain('did:web:')
    expect(catalog).toContain(`${SITE_URL}/.well-known/agent-skills/index.json`)
  })

  it('serves the same catalog at the ARD path', () => {
    expect(read(AGENT_PATHS.ard)).toBe(catalog)
  })

  it('ships the server card compatibility copy byte-identical to the canonical route', () => {
    expect(read(AGENT_PATHS.serverCardCompat)).toBe(SERVER_CARD_JSON)
  })
})

describe('API catalog and OpenAPI', () => {
  const openapi = JSON.parse(read(AGENT_PATHS.openapi))

  it('the RFC 9727 catalog anchors on itself and describes the data API with /openapi.json', () => {
    const {linkset} = JSON.parse(read(AGENT_PATHS.apiCatalog))
    expect(linkset[0].anchor).toBe(`${SITE_URL}${AGENT_PATHS.apiCatalog}`)
    const items = linkset[0].item.map((i: {href: string}) => i.href)
    expect(items).toHaveLength(1)
    const api = linkset.find((entry: {anchor: string}) => entry.anchor === items[0])
    expect(api['service-desc']).toEqual([{href: `${SITE_URL}${AGENT_PATHS.openapi}`, type: 'application/vnd.oai.openapi+json;version=3.1'}])
    expect(api['service-doc']).toHaveLength(1)
  })

  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(openapi)
    expect(result.errors ?? []).toEqual([])
    expect(result.valid).toBe(true)
    expect(openapi.openapi).toBe('3.1.0')
  })

  it('describes exactly the nine exports on the CloudFront data host', () => {
    expect(openapi.servers).toEqual([{url: CLOUDFRONT_BASE}])
    expect(Object.keys(openapi.paths).sort()).toEqual(Object.values(ENDPOINTS).sort())
  })

  it('declares the focus-suppression 403 on every export except the focus signal', () => {
    for (const [route, item] of Object.entries(openapi.paths) as Array<[string, {get: {responses: Record<string, unknown>}}]>) {
      expect('403' in item.get.responses, route).toBe(route !== ENDPOINTS.focus)
    }
    expect(openapi.components.schemas.Suppressed.properties.suppressed).toEqual({const: true})
  })

  // The response schemas are the contract's published raw schemas. Proving each one accepts the
  // design system's generated export fixtures shows the document describes real responses.
  it.each(Object.values(ENDPOINTS))('the %s response schema accepts the generated export fixtures', (route) => {
    const ajv = new Ajv2020({strict: false, allErrors: true, validateFormats: false})
    const ref: string = openapi.paths[route].get.responses['200'].content['application/json'].schema.$ref
    const validate = ajv.compile(openapi.components.schemas[ref.split('/').pop()!])
    const domain = route.slice(1, -'.json'.length)
    for (const variation of ['baseline', 'empty']) {
      const fixture = JSON.parse(fs.readFileSync(path.resolve(`node_modules/@j0nathan-ll0yd/fixtures/src/generated/${domain}/${variation}.json`), 'utf-8'))
      expect(validate(fixture), `${domain}/${variation}: ${JSON.stringify(validate.errors)}`).toBe(true)
    }
  })
})

describe('WebMCP script placement', () => {
  // Scanners read only the first few same-origin scripts (the 2026-10-07 is-agentic scan read
  // 8 of 17 and missed webmcp.js at position 15), so it must be the first script, and deferred.
  it.each(['index.html', '404.html', 'privacy/index.html'])('%s loads /js/webmcp.js first, deferred, from <head>', (page) => {
    const $ = cheerio.load(read(page))
    const first = $('script').first()
    expect(first.attr('src')).toBe('/js/webmcp.js')
    expect(first.attr('defer')).toBeDefined()
    expect(first.parent().is('head')).toBe(true)
    expect($('script[src="/js/webmcp.js"]')).toHaveLength(1)
  })
})
