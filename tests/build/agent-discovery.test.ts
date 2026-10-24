import fs from 'node:fs'
import path from 'node:path'
import {Validator} from '@seriousme/openapi-schema-validator'
import {CLOUDFRONT_BASE, ENDPOINTS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import Ajv2020 from 'ajv/dist/2020.js'
import * as cheerio from 'cheerio'
import {describe, expect, it} from 'vitest'
import {AGENT_PATHS, API_V1_BASE, API_V1_RATE_LIMIT, SERVER_CARD_JSON, SERVER_CARD_MEDIA_TYPE, SERVER_CARD_URL} from '../../src/lib/edge/agent-catalog.mjs'
import {clientDir} from '../../scripts/lib/build-paths.mjs'

const distDir = clientDir()
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

// The served Agent Skill is an LLM channel: the LLM-channel data policy (SKILL.md decision 4, atlas
// decision 0096) holds for the bytes an agent actually fetches, not only for the source file.
describe('served portfolio-expert SKILL.md', () => {
  const skill = read('.well-known/agent-skills/portfolio-expert/SKILL.md')

  it('names none of the three raw health, sleep, or workouts export URLs', () => {
    for (const path of [ENDPOINTS.health, ENDPOINTS.sleep, ENDPOINTS.workouts]) {
      expect(skill).not.toContain(`${CLOUDFRONT_BASE}${path}`)
    }
  })

  // Owner answer, 2026-10-12: developer documentation stays linkable from an LLM-facing file.
  it('links the developer documentation at /openapi.json, which the build serves', () => {
    expect(skill).toContain(`<${SITE_URL}${AGENT_PATHS.openapi}>`)
    expect(fs.existsSync(path.join(distDir, AGENT_PATHS.openapi))).toBe(true)
  })
})

describe('API catalog and OpenAPI', () => {
  const openapi = JSON.parse(read(AGENT_PATHS.openapi))

  // One item per public JSON export, all nine, at the developer API facade: the catalog is developer
  // documentation, so the raw health exports are listed. Each item answers JSON, and each failure an
  // RFC 9457 problem (audits/checks/b2-check-wellknown.mjs probes both live).
  it('the RFC 9727 catalog anchors on itself, lists every JSON export, and describes each with /openapi.json', () => {
    const {linkset} = JSON.parse(read(AGENT_PATHS.apiCatalog))
    expect(linkset[0].anchor).toBe(`${SITE_URL}${AGENT_PATHS.apiCatalog}`)
    const items = linkset[0].item.map((i: {href: string}) => i.href)
    expect(items.sort()).toEqual(Object.values(ENDPOINTS).map((path) => `${API_V1_BASE}${path}`).sort())
    expect(API_V1_BASE).toBe(`${SITE_URL}/api/v1`)
    for (const href of items) {
      const api = linkset.find((entry: {anchor: string}) => entry.anchor === href)
      expect(api['service-desc'], href).toEqual([{href: `${SITE_URL}${AGENT_PATHS.openapi}`, type: 'application/vnd.oai.openapi+json;version=3.1'}])
      expect(api['service-doc'], href).toHaveLength(1)
    }
  })

  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(openapi)
    expect(result.errors ?? []).toEqual([])
    expect(result.valid).toBe(true)
    expect(openapi.openapi).toBe('3.1.0')
  })

  it('describes exactly the nine exports on the developer API facade, with unchanged operation ids', () => {
    expect(openapi.servers.map((server: {url: string}) => server.url)).toEqual([API_V1_BASE])
    expect(Object.keys(openapi.paths).sort()).toEqual(Object.values(ENDPOINTS).sort())
    const operationIds = Object.values(openapi.paths).map((item) => (item as {get: {operationId: string}}).get.operationId)
    expect(new Set(operationIds).size).toBe(9)
  })

  it('declares the focus-suppression 503 problem on every export except the focus signal, and no 403', () => {
    for (const [route, item] of Object.entries(openapi.paths) as Array<[string, {get: {responses: Record<string, unknown>}}]>) {
      expect('503' in item.get.responses, route).toBe(route !== ENDPOINTS.focus)
      expect('403' in item.get.responses, route).toBe(false)
      for (const status of ['405', '429', '502']) {
        expect(item.get.responses[status], `${route} ${status}`).toBeDefined()
      }
    }
    expect(openapi.components.schemas.Problem.properties.suppressed).toEqual({const: true})
    expect(openapi.components.schemas).not.toHaveProperty('Suppressed')
  })

  // api-error-model: every 4xx and 5xx response is typed as an RFC 9457 problem.
  // covers: developer-api#The OpenAPI document and the API catalog advertise the facade
  it('types every 4xx and 5xx response as application/problem+json with the Problem schema', () => {
    const resolve = (response: {$ref?: string}) => response.$ref ? openapi.components.responses[response.$ref.split('/').pop()!] : response
    const errorResponses = [
      ...Object.values(openapi.components.responses),
      ...Object.values(openapi.paths).flatMap((item) =>
        Object.entries((item as {get: {responses: Record<string, {$ref?: string}>}}).get.responses).filter(([status]) => Number(status) >= 400).map((
          [, r]
        ) => resolve(r))
      )
    ] as Array<{content: Record<string, {schema: {$ref?: string; allOf?: Array<{$ref?: string}>}}>}>
    expect(errorResponses.length).toBeGreaterThan(5)
    for (const response of errorResponses) {
      expect(Object.keys(response.content)).toEqual(['application/problem+json'])
      const schema = response.content['application/problem+json'].schema
      const refs = [schema.$ref, ...(schema.allOf ?? []).map((part) => part.$ref)]
      expect(refs).toContain('#/components/schemas/Problem')
    }
    expect(Object.keys(openapi.components.responses).sort()).toEqual([
      'FocusSuppressed',
      'MethodNotAllowed',
      'NotFound',
      'RateLimited',
      'UpstreamUnavailable'
    ])
  })

  // covers: developer-api#The versioning promise is published and machine-visible
  it('states the rate-limit policy and the deprecation fields as response headers', () => {
    expect(openapi.components.headers['RateLimit-Policy'].example).toBe(
      `"${API_V1_RATE_LIMIT.policy}";q=${API_V1_RATE_LIMIT.limit};w=${API_V1_RATE_LIMIT.windowSeconds}`
    )
    for (const item of Object.values(openapi.paths) as Array<{get: {responses: {200: {headers: Record<string, unknown>}}}}>) {
      expect(Object.keys(item.get.responses[200].headers).sort()).toEqual(['Deprecation', 'Link', 'RateLimit', 'RateLimit-Policy', 'Sunset'])
    }
    expect(openapi.components.responses.RateLimited.headers['Retry-After']).toEqual({$ref: '#/components/headers/Retry-After'})
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
  // Pages build as files (build.format 'file'), so /privacy is privacy.html.
  it.each(['index.html', '404.html', 'privacy.html', 'about.html', 'contact.html', 'developers.html'])('%s loads /js/webmcp.js first, deferred, from <head>',
    (page) => {
      const $ = cheerio.load(read(page))
      const first = $('script').first()
      expect(first.attr('src')).toBe('/js/webmcp.js')
      expect(first.attr('defer')).toBeDefined()
      expect(first.parent().is('head')).toBe(true)
      expect($('script[src="/js/webmcp.js"]')).toHaveLength(1)
    })

  // client-privacy: /offline carries no WebMCP script (the data-free Dashboard).
  it('offline.html loads no WebMCP script', () => {
    expect(cheerio.load(read('offline.html'))('script[src="/js/webmcp.js"]')).toHaveLength(0)
  })
})
