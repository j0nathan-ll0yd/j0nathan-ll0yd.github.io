import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  accessHeadersFor,
  AI_CATALOG_MEDIA_TYPE,
  API_V1_ERROR_PROBES,
  API_V1_HEADER_PROBE_PATH,
  apiCatalogItems,
  ARTIFACTS,
  checkApiV1ErrorShape,
  EXPECTED_API_CATALOG_ITEMS,
  EXPECTED_RESOURCE_URIS,
  FOCUS_API_ITEM,
  FOCUS_RESOURCE_URI,
  judgeApiCatalogItemAnswer,
  judgeApiCatalogItems,
  judgeMcpExchange,
  judgeModernExchange,
  judgeOpenApiAnswer,
  judgeProblemAnswer,
  judgeRateLimitHeaders,
  judgeResourceExchange,
  judgeServiceDescTargets,
  LLMS_FULL_RESOURCE_URI,
  MODERN_PROTOCOL_VERSION,
  OPENAPI_EXPECTED_PATHS,
  OPENAPI_SERVER_URL,
  OPENAPI_URL,
  parseMcpBody,
  PINNED_AGENT_SKILLS_SCHEMA,
  PINNED_ARD_SPEC_VERSION,
  probeApiCatalogItems,
  probeMcpRemotes,
  probeOpenApiTargets,
  rebase,
  SERVER_CARD_MEDIA_TYPE,
  serviceDescTargets,
  streamableRemotes,
  validateAgentSkillsIndexShape,
  validateAiCatalogShape,
  validateApiCatalogShape,
  validateArdManifest,
  validateMcpServerCard,
  validateWebfingerShape,
  WITHHELD_RESOURCE_URI
} from '../checks/b2-check-wellknown.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const served = (...path: string[]) => JSON.parse(readFileSync(join(REPO_ROOT, 'public', ...path), 'utf-8'))

describe('validateWebfingerShape', () => {
  const valid = {subject: 'acct:jonathan@jonathanlloyd.me', links: [{rel: 'self', href: 'https://mastodon.social/ap/users/1'}]}

  it('a conformant JRD produces zero findings', () => {
    expect(validateWebfingerShape(valid, 'application/jrd+json')).toEqual([])
  })

  it('wrong content-type fails', () => {
    const findings = validateWebfingerShape(valid, 'application/json')
    expect(findings.map((f) => f.id)).toContain('wellknown-webfinger-content-type')
  })

  it('a non-acct subject fails', () => {
    const findings = validateWebfingerShape({...valid, subject: 'https://example.com/x'}, 'application/jrd+json')
    expect(findings.map((f) => f.id)).toContain('wellknown-webfinger-subject')
  })

  it('missing a rel="self" link is a warn', () => {
    const findings = validateWebfingerShape({...valid, links: []}, 'application/jrd+json')
    expect(findings).toEqual([expect.objectContaining({severity: 'warn', id: 'wellknown-webfinger-no-self-link'})])
  })

  it('missing both required fields produces two distinct findings, one per field', () => {
    const findings = validateWebfingerShape({}, 'application/jrd+json')
    const shapeFindings = findings.filter((f) => f.id === 'wellknown-webfinger-shape')
    expect(shapeFindings).toHaveLength(2)
    expect(shapeFindings.some((f) => f.message.includes('"subject"'))).toBe(true)
    expect(shapeFindings.some((f) => f.message.includes('"links"'))).toBe(true)
  })
})

describe('validateAiCatalogShape', () => {
  const valid = {
    specVersion: PINNED_ARD_SPEC_VERSION,
    entries: [{identifier: 'urn:air:example.com:server:x', displayName: 'X', type: 'application/json', url: 'https://example.com'}]
  }

  it(`a conformant ARD specVersion ${PINNED_ARD_SPEC_VERSION} catalog produces zero findings`, () => {
    expect(validateAiCatalogShape(valid)).toEqual([])
    expect(validateAiCatalogShape(valid, AI_CATALOG_MEDIA_TYPE)).toEqual([])
  })

  it('the SERVED catalog conforms to the vendored ai-catalog schema and names no unresolvable host identifier', () => {
    const catalog = served('.well-known', 'ai-catalog.json')
    expect(validateAiCatalogShape(catalog)).toEqual([])
    expect(catalog.host.identifier).toBeUndefined()
  })

  it('a specVersion drifted from the pinned constant is a warn here, and a fail against the 1.0 schema', () => {
    const findings = validateAiCatalogShape({...valid, specVersion: '2.0'})
    expect(findings).toContainEqual(expect.objectContaining({severity: 'warn', id: 'wellknown-ai-catalog-spec-version-drift'}))
    expect(findings).toContainEqual(expect.objectContaining({severity: 'fail', id: 'wellknown-ai-catalog-schema'}))
  })

  it('an empty entries array fails', () => {
    const findings = validateAiCatalogShape({...valid, entries: []})
    expect(findings.map((f) => f.id)).toContain('wellknown-ai-catalog-no-entries')
  })

  it('an entry identifier that is not a urn:air: URN fails', () => {
    const findings = validateAiCatalogShape({...valid, entries: [{...valid.entries[0], identifier: 'not-a-urn'}]})
    expect(findings.map((f) => f.id)).toContain('wellknown-ai-catalog-entry-identifier')
  })

  it('an entry with neither url nor data fails', () => {
    const {url: _url, ...entryWithoutLocator} = valid.entries[0]
    const findings = validateAiCatalogShape({...valid, entries: [entryWithoutLocator]})
    expect(findings.map((f) => f.id)).toContain('wellknown-ai-catalog-entry-no-locator')
  })
})

describe('validateMcpServerCard (SEP-2127 schema)', () => {
  const valid = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: 'com.example/weather',
    description: 'Weather data.',
    version: '1.0.0',
    remotes: [{type: 'streamable-http', url: 'https://example.com/mcp'}]
  }

  it('a conformant card served with the card media type produces zero findings', () => {
    expect(validateMcpServerCard(valid, SERVER_CARD_MEDIA_TYPE)).toEqual([])
  })

  it('the SERVED compatibility card conforms to the vendored schema', () => {
    expect(validateMcpServerCard(served('.well-known', 'mcp', 'server-card.json'))).toEqual([])
  })

  // The shape the site served until atlas decision 0158: SEP-1649 fields, a CloudFront transport.url.
  it('the superseded SEP-1649 card fails', () => {
    const legacy = {
      name: 'human-datastream',
      serverInfo: {},
      capabilities: {},
      transport: {type: 'http', url: 'https://d1pfm520aduift.cloudfront.net/'},
      resources: []
    }
    const ids = validateMcpServerCard(legacy).map((f) => f.id)
    expect(ids).toContain('wellknown-mcp-server-card-schema')
    expect(ids).toContain('wellknown-mcp-server-card-no-remote')
  })

  it('a description over 100 characters fails', () => {
    expect(validateMcpServerCard({...valid, description: 'x'.repeat(101)}).map((f) => f.id)).toContain('wellknown-mcp-server-card-schema')
  })

  it('a card served as plain JSON fails the media-type check', () => {
    expect(validateMcpServerCard(valid, 'application/json').map((f) => f.id)).toEqual(['wellknown-mcp-server-card-content-type'])
  })

  it('collects only streamable-http remotes', () => {
    expect(streamableRemotes({remotes: [{type: 'sse', url: 'https://a'}, {type: 'streamable-http', url: 'https://b'}]})).toEqual(['https://b'])
    expect(streamableRemotes({})).toEqual([])
  })
})

describe('validateArdManifest', () => {
  it('the SERVED ard.json conforms to the vendored ArdManifest schema', () => {
    expect(validateArdManifest(served('.well-known', 'ard.json'))).toEqual([])
  })

  it('a manifest without entries fails', () => {
    expect(validateArdManifest({specVersion: '1.0'}).map((f) => f.id)).toContain('wellknown-ard-schema')
  })

  it('an entry with both url and data fails', () => {
    const entry = {identifier: 'urn:air:example.com:server:x', displayName: 'X', type: 'application/json', url: 'https://example.com', data: {}}
    expect(validateArdManifest({entries: [entry]}).map((f) => f.id)).toContain('wellknown-ard-schema')
  })
})

describe('MCP liveness probe', () => {
  const card = {name: 'me.jonathanlloyd/human-datastream', version: '1.0.0', remotes: [{type: 'streamable-http', url: 'https://jonathanlloyd.me/mcp'}]}
  const initialize = {jsonrpc: '2.0', id: 1, result: {protocolVersion: '2025-11-25', serverInfo: {name: card.name, version: card.version}}}
  const toolsList = {jsonrpc: '2.0', id: 2, result: {tools: [{name: 'get_profile', annotations: {readOnlyHint: true}}]}}

  it('a valid initialize and tools/list exchange produces zero findings', () => {
    expect(judgeMcpExchange({initialize, toolsList, card})).toEqual([])
  })

  it('a JSON-RPC error in place of the initialize result fails', () => {
    const error = {jsonrpc: '2.0', id: 1, error: {code: -32000, message: 'no'}}
    expect(judgeMcpExchange({initialize: error, toolsList, card}).map((f) => f.id)).toEqual(['mcp-initialize'])
  })

  it('an empty tool list fails', () => {
    expect(judgeMcpExchange({initialize, toolsList: {...toolsList, result: {tools: []}}, card}).map((f) => f.id)).toEqual(['mcp-tools-list'])
  })

  it('a tool without readOnlyHint: true fails', () => {
    const writable = {...toolsList, result: {tools: [{name: 'write', annotations: {readOnlyHint: false}}]}}
    expect(judgeMcpExchange({initialize, toolsList: writable, card}).map((f) => f.id)).toEqual(['mcp-tool-not-read-only'])
  })

  it('serverInfo that contradicts the card is a warn (SEP-2127 SHOULD)', () => {
    const findings = judgeMcpExchange({initialize, toolsList, card: {...card, version: '9.9.9'}})
    expect(findings).toEqual([expect.objectContaining({severity: 'warn', id: 'mcp-server-card-mismatch'})])
  })

  it('parses a JSON body and a single-message SSE body', () => {
    expect(parseMcpBody(JSON.stringify(initialize), 'application/json')).toEqual(initialize)
    expect(parseMcpBody(`event: message\ndata: ${JSON.stringify(initialize)}\n\n`, 'text/event-stream')).toEqual(initialize)
    expect(() => parseMcpBody('event: message\n\n', 'text/event-stream')).toThrow()
  })

  const discover = {
    jsonrpc: '2.0',
    id: 3,
    result: {supportedVersions: [MODERN_PROTOCOL_VERSION], _meta: {'io.modelcontextprotocol/serverInfo': {name: card.name, version: card.version}}}
  }
  const called = {jsonrpc: '2.0', id: 4, result: {content: [{type: 'text', text: '{}'}]}}
  const resourcesList = {jsonrpc: '2.0', id: 100, result: {resources: EXPECTED_RESOURCE_URIS.map((uri) => ({uri}))}}
  const readOf = (uri: string, text: string) => ({jsonrpc: '2.0', id: 101, result: {contents: [{uri, text}]}})
  const focusRead = readOf(FOCUS_RESOURCE_URI, '{"generatedAt":"x","currentFocus":"None"}')
  const llmsRead = readOf(LLMS_FULL_RESOURCE_URI, '# Jonathan Lloyd')

  it('runs both eras: initialize and tools/list, then server/discover and a tools/call per tool', async () => {
    const calls: Array<{method: string; headers?: Record<string, string>; meta?: unknown; uri?: string}> = []
    const post = async (_url: string, message: {method: string; params?: {_meta?: unknown; uri?: string}}, headers?: Record<string, string>) => {
      calls.push({method: message.method, headers, meta: message.params?._meta, uri: message.params?.uri})
      if (message.method === 'resources/read') {
        const uri = message.params?.uri
        return uri === FOCUS_RESOURCE_URI
          ? focusRead
          : uri === LLMS_FULL_RESOURCE_URI
          ? llmsRead
          : {jsonrpc: '2.0', id: 103, error: {code: -32602, message: 'Resource not found'}}
      }
      return ({initialize, 'tools/list': toolsList, 'server/discover': discover, 'resources/list': resourcesList} as Record<string, unknown>)[
        message.method
      ] ?? called
    }
    const result = await probeMcpRemotes(card, post)
    expect(calls.map((c) => c.method)).toEqual([
      'initialize',
      'tools/list',
      'server/discover',
      'tools/call',
      'resources/list',
      'resources/read',
      'resources/read',
      'resources/read'
    ])
    expect(calls.slice(5).map((c) => c.uri)).toEqual([FOCUS_RESOURCE_URI, LLMS_FULL_RESOURCE_URI, WITHHELD_RESOURCE_URI])
    expect(calls[5]!.headers).toEqual({'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': 'resources/read', 'Mcp-Name': FOCUS_RESOURCE_URI})
    expect(calls[1]!.headers).toEqual({'MCP-Protocol-Version': '2025-11-25'})
    expect(calls[3]!.headers).toEqual({'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_profile'})
    expect(calls[3]!.meta).toEqual(expect.objectContaining({'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION}))
    expect(result).toEqual({measured: 2, findings: []})
  })

  it('expects exactly seven resources: the six policy-exposed exports and llms-full.txt, no raw health export', () => {
    expect(EXPECTED_RESOURCE_URIS).toHaveLength(7)
    expect(EXPECTED_RESOURCE_URIS).toContain(LLMS_FULL_RESOURCE_URI)
    expect(EXPECTED_RESOURCE_URIS.join(' ')).not.toMatch(/health\.json|sleep\.json|workouts\.json/)
  })

  it('a full resource exchange produces zero findings; a suppressed llms-full.txt read is valid', () => {
    expect(
      judgeResourceExchange({
        list: resourcesList,
        reads: [{uri: FOCUS_RESOURCE_URI, response: focusRead}, {uri: LLMS_FULL_RESOURCE_URI, response: llmsRead}]
      })
    ).toEqual([])
    const suppressed = readOf(LLMS_FULL_RESOURCE_URI, '{"suppressed":true,"reason":"focus mode active"}')
    expect(judgeResourceExchange({list: resourcesList, reads: [{uri: LLMS_FULL_RESOURCE_URI, response: suppressed}]})).toEqual([])
  })

  it('a resource list that exposes a withheld export, or drops one, fails', () => {
    const health = 'https://d1pfm520aduift.cloudfront.net/health.json'
    const exposed = {...resourcesList, result: {resources: [...EXPECTED_RESOURCE_URIS, health].map((uri) => ({uri}))}}
    const dropped = {...resourcesList, result: {resources: EXPECTED_RESOURCE_URIS.slice(1).map((uri) => ({uri}))}}
    expect(judgeResourceExchange({list: exposed, reads: []}).map((f) => f.id)).toEqual(['mcp-resources-list'])
    expect(judgeResourceExchange({list: dropped, reads: []}).map((f) => f.id)).toEqual(['mcp-resources-list'])
  })

  it('a refused llms-full.txt read, and a focus read that is not a focus document, fail', () => {
    const refused = {jsonrpc: '2.0', id: 102, error: {code: -32603, message: 'withheld'}}
    const gatedFocus = readOf(FOCUS_RESOURCE_URI, '{"suppressed":true,"reason":"focus mode active"}')
    const findings = judgeResourceExchange({
      list: resourcesList,
      reads: [{uri: FOCUS_RESOURCE_URI, response: gatedFocus}, {uri: LLMS_FULL_RESOURCE_URI, response: refused}]
    })
    expect(findings.map((f) => f.id)).toEqual(['mcp-resource-read', 'mcp-resource-read'])
  })

  it('fails llms-full.txt text that names a withheld export, even when the server serves it', () => {
    const leaked = readOf(LLMS_FULL_RESOURCE_URI, '# Streams\n- https://d1pfm520aduift.cloudfront.net/health.json')
    expect(judgeResourceExchange({list: resourcesList, reads: [{uri: LLMS_FULL_RESOURCE_URI, response: leaked}]}).map((f) => f.id)).toEqual([
      'mcp-resource-read'
    ])
  })

  it('a withheld export that reads as content fails; a refusal passes', () => {
    const served = readOf(WITHHELD_RESOURCE_URI, '{"heartRate":60}')
    const refused = {jsonrpc: '2.0', id: 103, error: {code: -32602, message: 'Resource not found'}}
    expect(judgeResourceExchange({list: resourcesList, reads: [{uri: WITHHELD_RESOURCE_URI, response: served}]}).map((f) => f.id)).toEqual([
      'mcp-withheld-readable'
    ])
    expect(judgeResourceExchange({list: resourcesList, reads: [{uri: WITHHELD_RESOURCE_URI, response: refused}]})).toEqual([])
  })

  it('ai-catalog.json served as plain JSON fails the media-type assertion', () => {
    const catalog = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', '.well-known', 'ai-catalog.json'), 'utf8'))
    expect(validateAiCatalogShape(catalog, 'application/json').map((f) => f.id)).toEqual(['wellknown-ai-catalog-content-type'])
  })

  it('a discover that does not offer the modern revision fails', () => {
    const legacyOnly = {...discover, result: {...discover.result, supportedVersions: ['2025-11-25']}}
    expect(judgeModernExchange({discover: legacyOnly, calls: [], card}).map((f) => f.id)).toEqual(['mcp-discover'])
  })

  it('a tools/call that returns isError fails; a suppressed answer is a valid result', () => {
    const failed = {jsonrpc: '2.0', id: 4, result: {isError: true, content: [{type: 'text', text: '{"failed":true}'}]}}
    const suppressed = {jsonrpc: '2.0', id: 5, result: {content: [{type: 'text', text: '{"suppressed":true,"reason":"focus mode active"}'}]}}
    const findings = judgeModernExchange({discover, calls: [{name: 'a', response: failed}, {name: 'b', response: suppressed}], card})
    expect(findings.map((f) => f.id)).toEqual(['mcp-tool-call'])
    expect(findings[0]!.message).toContain('tools/call a')
  })

  it('a modern-era failure is its own finding and the legacy era still counts', async () => {
    const post = async (_url: string, message: {method: string}) => {
      if (message.method === 'server/discover') {
        throw new Error('HTTP 400 from server/discover')
      }
      return message.method === 'initialize' ? initialize : toolsList
    }
    const result = await probeMcpRemotes(card, post)
    expect(result.measured).toBe(1)
    expect(result.findings.map((f) => f.id)).toEqual(['mcp-modern-unreachable'])
  })

  // The receipt: the CloudFront transport.url answered an MCP initialize with an HTML 403.
  it('an unreachable remote is a fail and is not measured', async () => {
    const post = async () => {
      throw new Error('HTTP 403 from initialize: <HTML>')
    }
    const result = await probeMcpRemotes(card, post)
    expect(result.measured).toBe(0)
    expect(result.findings.map((f) => f.id)).toEqual(['mcp-unreachable'])
  })

  it('rebases production URLs onto an audited preview and leaves other origins alone', () => {
    expect(rebase('https://jonathanlloyd.me/mcp', 'https://abc12345-human-datastream.account.workers.dev')).toBe(
      'https://abc12345-human-datastream.account.workers.dev/mcp'
    )
    expect(rebase('https://d1pfm520aduift.cloudfront.net/a.json', 'https://abc12345-human-datastream.account.workers.dev')).toBe(
      'https://d1pfm520aduift.cloudfront.net/a.json'
    )
  })
})

describe('validateAgentSkillsIndexShape', () => {
  const valid = {
    $schema: PINNED_AGENT_SKILLS_SCHEMA,
    skills: [
      {
        name: 'portfolio-expert',
        description: 'Deep technical context about the portfolio.',
        type: 'skill-md',
        url: 'https://jonathanlloyd.me/.well-known/agent-skills/portfolio-expert/SKILL.md',
        digest: `sha256:${'d'.repeat(64)}`
      }
    ]
  }

  it('a conformant discovery index produces zero findings', () => {
    expect(validateAgentSkillsIndexShape(valid)).toEqual([])
  })

  it('the SERVED index produces zero findings', () => {
    const served = JSON.parse(readFileSync(join(REPO_ROOT, 'public', '.well-known', 'agent-skills', 'index.json'), 'utf-8'))
    expect(validateAgentSkillsIndexShape(served)).toEqual([])
  })

  it('missing both required fields produces two distinct findings, one per field', () => {
    const findings = validateAgentSkillsIndexShape({})
    const shapeFindings = findings.filter((f) => f.id === 'wellknown-agent-skills-shape')
    expect(shapeFindings).toHaveLength(2)
    expect(shapeFindings.some((f) => f.message.includes('"$schema"'))).toBe(true)
    expect(shapeFindings.some((f) => f.message.includes('"skills"'))).toBe(true)
  })

  it('a $schema drifted from the pinned discovery version is a warn, not a fail', () => {
    const findings = validateAgentSkillsIndexShape({...valid, $schema: 'https://schemas.agentskills.io/discovery/0.3.0/schema.json'})
    expect(findings).toEqual([expect.objectContaining({severity: 'warn', id: 'wellknown-agent-skills-schema-drift'})])
  })

  it('an empty skills array fails', () => {
    const findings = validateAgentSkillsIndexShape({...valid, skills: []})
    expect(findings.map((f) => f.id)).toContain('wellknown-agent-skills-no-skills')
  })

  it('a skill missing type and url produces one finding per absent field', () => {
    const {type: _type, url: _url, ...partial} = valid.skills[0]
    const findings = validateAgentSkillsIndexShape({...valid, skills: [partial]})
    expect(findings.filter((f) => f.id === 'wellknown-agent-skills-skill-shape')).toHaveLength(2)
  })

  it('a non-https skill url fails', () => {
    const findings = validateAgentSkillsIndexShape({...valid, skills: [{...valid.skills[0], url: 'http://example.com/SKILL.md'}]})
    expect(findings.map((f) => f.id)).toContain('wellknown-agent-skills-skill-url')
  })

  it('a malformed digest fails', () => {
    const findings = validateAgentSkillsIndexShape({...valid, skills: [{...valid.skills[0], digest: 'deadbeef'}]})
    expect(findings.map((f) => f.id)).toContain('wellknown-agent-skills-skill-digest')
  })

  it('an absent digest is not a finding -- it is optional, only its format is checked', () => {
    const {digest: _digest, ...withoutDigest} = valid.skills[0]
    expect(validateAgentSkillsIndexShape({...valid, skills: [withoutDigest]})).toEqual([])
  })
})

describe('validateApiCatalogShape', () => {
  const linkset = [
    {anchor: 'https://example.com/.well-known/api-catalog', item: [{href: 'https://api.example.com/'}]},
    {anchor: 'https://api.example.com/', 'service-desc': [{href: 'https://example.com/openapi.json'}]}
  ]

  it('a conformant linkset produces zero findings', () => {
    expect(validateApiCatalogShape({linkset}, 'application/linkset+json')).toEqual([])
  })

  it('the SERVED catalog produces zero findings', () => {
    expect(validateApiCatalogShape(served('.well-known', 'api-catalog'), 'application/linkset+json')).toEqual([])
  })

  it('wrong content-type fails (RFC 9727)', () => {
    const findings = validateApiCatalogShape({linkset}, 'application/json')
    expect(findings.map((f) => f.id)).toContain('wellknown-api-catalog-content-type')
  })

  it('an empty linkset fails', () => {
    const findings = validateApiCatalogShape({linkset: []}, 'application/linkset+json')
    expect(findings.map((f) => f.id)).toContain('wellknown-api-catalog-linkset')
  })

  // The shape the site served until atlas decision 0158: one anchor, no item, llms.txt as service-desc.
  it('a linkset without an item fails', () => {
    const findings = validateApiCatalogShape({linkset: [linkset[1]]}, 'application/linkset+json')
    expect(findings.map((f) => f.id)).toEqual(['wellknown-api-catalog-no-item'])
  })

  it('a linkset without a service-desc fails', () => {
    const findings = validateApiCatalogShape({linkset: [linkset[0]]}, 'application/linkset+json')
    expect(findings.map((f) => f.id)).toEqual(['wellknown-api-catalog-no-service-desc'])
  })
})

describe('api-catalog items', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const served = JSON.parse(readFileSync(join(here, '..', '..', 'public', '.well-known', 'api-catalog'), 'utf8'))
  const S3_ACCESS_DENIED = '<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>'
  const SUPPRESSED = '{"suppressed":true,"reason":"focus mode active"}'
  const SUPPRESSED_PROBLEM = JSON.stringify({
    type: 'https://jonathanlloyd.me/developers#problem-focus-suppressed',
    title: 'Hidden by focus mode',
    status: 503,
    detail: 'x',
    instance: '/api/v1/books.json',
    suppressed: true,
    reason: 'focus mode active',
    retryAfterSeconds: 60
  })
  const PROBLEM = 'application/problem+json; charset=utf-8'
  const json = {'content-type': 'application/json'}

  it('the committed catalog lists all nine exports at the developer API facade, raw health included, each with a service-desc', () => {
    expect(EXPECTED_API_CATALOG_ITEMS).toHaveLength(9)
    const raw = ['health', 'sleep', 'workouts'].map((name) => `https://jonathanlloyd.me/api/v1/${name}.json`)
    expect(EXPECTED_API_CATALOG_ITEMS).toEqual(expect.arrayContaining(raw))
    expect(apiCatalogItems(served).sort()).toEqual([...EXPECTED_API_CATALOG_ITEMS].sort())
    expect(judgeApiCatalogItems(served)).toEqual([])
  })

  it('the old single CloudFront-root item fails the item set', () => {
    const root = {linkset: [{anchor: 'https://jonathanlloyd.me/.well-known/api-catalog', item: [{href: 'https://d1pfm520aduift.cloudfront.net/'}]}]}
    expect(judgeApiCatalogItems(root).map((f) => f.id)).toEqual(['wellknown-api-catalog-items', 'wellknown-api-catalog-item-no-service-desc'])
  })

  it('accepts a 2xx JSON object and the facade 503 focus-suppressed problem', () => {
    expect(judgeApiCatalogItemAnswer({href: 'a', status: 200, contentType: 'application/json', body: '{"books":[]}'})).toEqual([])
    expect(judgeApiCatalogItemAnswer({href: 'a', status: 200, contentType: 'application/json; charset=utf-8', body: '{}'})).toEqual([])
    expect(judgeApiCatalogItemAnswer({href: 'a', status: 503, contentType: PROBLEM, body: SUPPRESSED_PROBLEM})).toEqual([])
  })

  // The receipt: the CloudFront root item answered S3 XML AccessDenied. focus.json is never gated
  // at the edge, so a suppression 403 there means the signal is broken.
  it.each([
    ['S3 XML AccessDenied', 'a', 403, 'application/xml', S3_ACCESS_DENIED],
    ['a 403 JSON body that is not a suppression', 'a', 403, 'application/json', '{"message":"Forbidden"}'],
    ['a suppression body with no reason', 'a', 403, 'application/json', '{"suppressed":true}'],
    ['a suppression body served as text/html', 'a', 403, 'text/html', SUPPRESSED],
    ['a suppression problem on focus.json', FOCUS_API_ITEM, 503, PROBLEM, SUPPRESSED_PROBLEM],
    ['the CloudFront 403 suppression body, which the facade never serves', 'a', 403, 'application/json', SUPPRESSED],
    ['a 503 suppression served as plain JSON', 'a', 503, 'application/json', SUPPRESSED],
    ['a 502 problem', 'a', 502, PROBLEM, '{"type":"x","status":502}'],
    ['an HTML 200', 'a', 200, 'text/html', '<html></html>'],
    ['a JSON body served as text/html', 'a', 200, 'text/html', '{}'],
    ['a JSON body served as octet-stream', 'a', 200, 'binary/octet-stream', '{}'],
    ['a JSON null body', 'a', 200, 'application/json', 'null'],
    ['a JSON scalar body', 'a', 200, 'application/json', '"oops"'],
    ['a 404 JSON body', 'a', 404, 'application/json', '{}'],
    ['a redirect', 'a', 302, '', ''],
    ['a 304', 'a', 304, '', '']
  ])('rejects %s', (_label, href, status, contentType, body) => {
    expect(judgeApiCatalogItemAnswer({href, status, contentType, body}).map((f) => f.id)).toEqual(['wellknown-api-catalog-item-not-json'])
  })

  it('fetches every item without following redirects; an unreachable item is a fail and is not measured', async () => {
    const asked: string[] = []
    const inits: RequestInit[] = []
    const get = async (href: string, init: RequestInit) => {
      asked.push(href)
      inits.push(init)
      if (href.endsWith('/books.json')) {
        throw new Error('ECONNRESET')
      }
      return href.endsWith('/health.json')
        ? new Response(S3_ACCESS_DENIED, {status: 403, headers: {'content-type': 'application/xml'}})
        : new Response('{}', {headers: json})
    }
    const result = await probeApiCatalogItems(served, get)
    expect(asked.sort()).toEqual([...EXPECTED_API_CATALOG_ITEMS].sort())
    expect(inits.every((init) => init.redirect === 'manual')).toBe(true)
    expect(result.measured).toBe(8)
    expect(result.findings.map((f) => f.id).sort()).toEqual(['wellknown-api-catalog-item-not-json', 'wellknown-api-catalog-item-unreachable'])
  })

  it("a body that fails mid-read is that item's finding, not a rejection of the whole check", async () => {
    const stalled = {status: 200, headers: new Headers(json), text: () => Promise.reject(new Error('TimeoutError'))} as unknown as Response
    const get = async (href: string) => (href.endsWith('/books.json') ? stalled : new Response('{}', {headers: json}))
    const result = await probeApiCatalogItems(served, get)
    expect(result.measured).toBe(8)
    expect(result.findings.map((f) => f.id)).toEqual(['wellknown-api-catalog-item-unreachable'])
  })
})

// A preview Version URL sits behind Cloudflare Access (atlas decision 0160). The service token may
// reach the audited origin only, never production or CloudFront, which discovery documents name.
describe('api-catalog items on a preview deploy', () => {
  it('fetches each item from the audited base, with the Access token for that origin only', async () => {
    const asked: Array<{url: string; headers: Record<string, string>}> = []
    const get = async (url: string, init: RequestInit) => {
      asked.push({url, headers: init.headers as Record<string, string>})
      return new Response('{}', {headers: {'content-type': 'application/json'}})
    }
    const catalog = {linkset: [{anchor: 'x', item: [{href: 'https://jonathanlloyd.me/api/v1/books.json'}]}]}
    const previous = {id: process.env.CF_ACCESS_CLIENT_ID, secret: process.env.CF_ACCESS_CLIENT_SECRET}
    process.env.CF_ACCESS_CLIENT_ID = 'id'
    process.env.CF_ACCESS_CLIENT_SECRET = 'secret'
    try {
      await probeApiCatalogItems(catalog, get, 'https://pr-1-human-datastream.example.workers.dev')
    } finally {
      process.env.CF_ACCESS_CLIENT_ID = previous.id
      process.env.CF_ACCESS_CLIENT_SECRET = previous.secret
      if (previous.id === undefined) {
        delete process.env.CF_ACCESS_CLIENT_ID
      }
      if (previous.secret === undefined) {
        delete process.env.CF_ACCESS_CLIENT_SECRET
      }
    }
    expect(asked).toEqual([{
      url: 'https://pr-1-human-datastream.example.workers.dev/api/v1/books.json',
      headers: {Accept: 'application/json', 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret'}
    }])
  })
})

// covers: developer-api#Every failure under /api is an RFC 9457 problem
describe('api-v1-error-shape', () => {
  const PROBLEM = 'application/problem+json; charset=utf-8'
  const [unknownExport, unsafeMethod, unknownApiPath] = API_V1_ERROR_PROBES
  const problem = (status: number, instance: string) =>
    JSON.stringify({type: 'https://jonathanlloyd.me/developers#problem-x', title: 'T', status, detail: 'D', instance})

  it('probes an unknown export, an unsafe method, and an unknown /api path', () => {
    expect(API_V1_ERROR_PROBES.map((p) => [p.method, p.path, p.status])).toEqual([
      ['GET', '/api/v1/__not_a_resource__.json', 404],
      ['POST', '/api/v1/books.json', 405],
      ['GET', '/api/nope', 404]
    ])
    expect(API_V1_HEADER_PROBE_PATH).toBe('/api/v1/focus.json')
  })

  it('accepts a well-formed problem answer', () => {
    expect(judgeProblemAnswer({probe: unknownExport!, status: 404, contentType: PROBLEM, allow: null, body: problem(404, unknownExport!.path)})).toEqual([])
    expect(judgeProblemAnswer({probe: unsafeMethod!, status: 405, contentType: PROBLEM, allow: 'GET, HEAD', body: problem(405, unsafeMethod!.path)}))
      .toEqual([])
  })

  it.each([
    ['the HTML 404 page', 404, 'text/html; charset=utf-8', null, '<!doctype html>'],
    ['a text/plain 405', 405, 'text/plain; charset=utf-8', 'GET, HEAD', 'Method not allowed'],
    ['an empty 405 with no problem body', 405, '', null, ''],
    ['a problem whose status member disagrees', 404, PROBLEM, null, problem(500, '/api/nope')],
    ['a problem with a relative type', 404, PROBLEM, null, JSON.stringify({type: '#x', title: 'T', status: 404, instance: '/api/nope'})],
    ['a problem with no instance', 404, PROBLEM, null, JSON.stringify({type: 'https://x.test/', title: 'T', status: 404})],
    ['a wrong status', 200, 'application/json', null, '{}']
  ])('rejects %s', (_label, status, contentType, allow, body) => {
    const probe = status === 405 ? unsafeMethod! : unknownApiPath!
    expect(judgeProblemAnswer({probe, status, contentType, allow, body}).length).toBeGreaterThan(0)
  })

  it('requires Allow naming GET on a 405', () => {
    const findings = judgeProblemAnswer({probe: unsafeMethod!, status: 405, contentType: PROBLEM, allow: null, body: problem(405, unsafeMethod!.path)})
    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('Allow')])
  })

  it('accepts the RateLimit fields with q, w, r and t, and rejects a missing r or t', () => {
    expect(judgeRateLimitHeaders({policy: '"default";q=60;w=60', rateLimit: '"default";r=59;t=42'})).toEqual([])
    expect(judgeRateLimitHeaders({policy: '"default";q=60;w=60', rateLimit: null})).toHaveLength(1)
    expect(judgeRateLimitHeaders({policy: '"default";q=60;w=60', rateLimit: '"default";r=59'})).toHaveLength(1)
    expect(judgeRateLimitHeaders({policy: '"default";q=60;w=60', rateLimit: '"other";r=59;t=1'})).toHaveLength(1)
    expect(judgeRateLimitHeaders({policy: 'default;q=60;w=60', rateLimit: '"default";r=59;t=1'})).toHaveLength(1)
    expect(judgeRateLimitHeaders({policy: null, rateLimit: '"default";r=59;t=1'})).toHaveLength(1)
  })

  it('counts each held answer as measured, and an unreachable probe as a finding', async () => {
    const asked: string[] = []
    const get = async (url: string, init: RequestInit) => {
      asked.push(`${init.method} ${url}`)
      const path = new URL(url).pathname
      if (path === '/api/nope') {
        throw new Error('ECONNRESET')
      }
      if (path === API_V1_HEADER_PROBE_PATH) {
        return new Response('{}', {headers: {'content-type': 'application/json', 'ratelimit-policy': '"default";q=60;w=60', ratelimit: '"default";r=1;t=2'}})
      }
      const status = init.method === 'POST' ? 405 : 404
      return new Response(problem(status, path), {status, headers: {'content-type': PROBLEM, ...(status === 405 ? {allow: 'GET, HEAD'} : {})}})
    }
    const result = await checkApiV1ErrorShape('https://jonathanlloyd.me', get)
    expect(asked).toEqual([
      'GET https://jonathanlloyd.me/api/v1/__not_a_resource__.json',
      'POST https://jonathanlloyd.me/api/v1/books.json',
      'GET https://jonathanlloyd.me/api/nope',
      'GET https://jonathanlloyd.me/api/v1/focus.json'
    ])
    expect(result.measured).toBe(3)
    expect(result.findings.map((f) => f.id)).toEqual(['api-v1-error-shape-unreachable'])
  })
})

describe('accessHeadersFor', () => {
  const base = 'https://abc12345-human-datastream.account.workers.dev'
  const env = {CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret'}

  it('sends the service token to the audited origin', () => {
    expect(accessHeadersFor(`${base}/mcp`, base, env)).toEqual({'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret'})
  })

  it.each([
    'https://jonathanlloyd.me/mcp',
    'https://d1pfm520aduift.cloudfront.net/books.json',
    'https://abc12345-human-datastream.account.workers.dev.evil.example/mcp',
    'http://abc12345-human-datastream.account.workers.dev/mcp'
  ])('never sends it to %s', (url) => {
    expect(accessHeadersFor(url, base, env)).toEqual({})
  })

  it('sends nothing without both credentials or without an audited base', () => {
    expect(accessHeadersFor(`${base}/mcp`, base, {CF_ACCESS_CLIENT_ID: 'id'})).toEqual({})
    expect(accessHeadersFor(`${base}/mcp`, undefined, env)).toEqual({})
  })
})

// Arm `openapi`. The fixture is the committed document and catalog, the bytes the site serves.
describe('openapi arm', () => {
  const catalog = served('.well-known', 'api-catalog')
  const documentText = readFileSync(join(REPO_ROOT, 'public', 'openapi.json'), 'utf-8')
  const document = JSON.parse(documentText)
  const MEDIA_TYPE = 'application/vnd.oai.openapi+json;version=3.1'
  const answer = (overrides: Partial<{status: number; contentType: string; body: string}> = {}) => ({
    href: OPENAPI_URL,
    status: 200,
    contentType: MEDIA_TYPE,
    body: documentText,
    ...overrides
  })
  const ids = (findings: Array<{id: string}>) => findings.map((f) => f.id)

  it('names the production document, the facade server and the nine export paths', () => {
    expect(OPENAPI_URL).toBe('https://jonathanlloyd.me/openapi.json')
    expect(OPENAPI_SERVER_URL).toBe('https://jonathanlloyd.me/api/v1')
    expect(OPENAPI_EXPECTED_PATHS).toHaveLength(9)
    expect([...OPENAPI_EXPECTED_PATHS].sort()).toEqual(Object.keys(document.paths).sort())
  })

  it('the committed catalog names one distinct target, the document', () => {
    expect(serviceDescTargets(catalog)).toEqual([OPENAPI_URL])
    expect(judgeServiceDescTargets(serviceDescTargets(catalog))).toEqual([])
  })

  it('a missing, extra or foreign target fails', () => {
    expect(serviceDescTargets({})).toEqual([])
    expect(serviceDescTargets({linkset: [{'service-desc': [{}]}, {anchor: 'x'}]})).toEqual([])
    expect(ids(judgeServiceDescTargets([]))).toEqual(['wellknown-openapi-target'])
    expect(ids(judgeServiceDescTargets([OPENAPI_URL, 'https://jonathanlloyd.me/llms.txt']))).toEqual(['wellknown-openapi-target'])
    expect(ids(judgeServiceDescTargets(['https://jonathanlloyd.me/llms.txt']))).toEqual(['wellknown-openapi-target'])
  })

  it('the committed document, served as advertised, passes', () => {
    expect(judgeOpenApiAnswer(answer())).toEqual([])
    expect(judgeOpenApiAnswer(answer({contentType: 'Application/VND.OAI.OpenAPI+JSON; version=3.1'}))).toEqual([])
  })

  it('a non-200 answer fails on its status alone', () => {
    expect(ids(judgeOpenApiAnswer(answer({status: 404, contentType: 'text/html', body: '<html>'})))).toEqual(['wellknown-openapi-status'])
    expect(ids(judgeOpenApiAnswer(answer({status: 308})))).toEqual(['wellknown-openapi-status'])
  })

  it('application/json is not the advertised media type', () => {
    expect(ids(judgeOpenApiAnswer(answer({contentType: 'application/json'})))).toEqual(['wellknown-openapi-content-type'])
    expect(ids(judgeOpenApiAnswer(answer({contentType: ''})))).toEqual(['wellknown-openapi-content-type'])
  })

  it('a body that is not a JSON object fails', () => {
    expect(ids(judgeOpenApiAnswer(answer({body: 'not json'})))).toEqual(['wellknown-openapi-json'])
    expect(ids(judgeOpenApiAnswer(answer({body: 'null'})))).toEqual(['wellknown-openapi-json'])
    expect(ids(judgeOpenApiAnswer(answer({body: '[]'})))).toEqual(['wellknown-openapi-json'])
  })

  it('an OpenAPI version other than 3.1.x fails', () => {
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify({...document, openapi: '3.0.3'})})))).toEqual(['wellknown-openapi-version'])
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify({...document, openapi: '3.10.0'})})))).toEqual(['wellknown-openapi-version'])
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify({...document, openapi: 3.1})})))).toEqual(['wellknown-openapi-version'])
  })

  it('a server other than the facade fails', () => {
    const cloudfront = {...document, servers: [{url: 'https://d1.cloudfront.net'}, document.servers[0]]}
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify(cloudfront)})))).toEqual(['wellknown-openapi-server'])
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify({...document, servers: undefined})})))).toEqual(['wellknown-openapi-server'])
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify({...document, servers: []})})))).toEqual(['wellknown-openapi-server'])
  })

  it('a missing export path fails and names it', () => {
    const {'/books.json': _books, ...rest} = document.paths
    const findings = judgeOpenApiAnswer(answer({body: JSON.stringify({...document, paths: {...rest, '/sleep.json': null}})}))
    expect(ids(findings)).toEqual(['wellknown-openapi-paths'])
    expect(findings[0].message).toContain('/books.json')
    expect(findings[0].message).toContain('/sleep.json')
    expect(findings[0].message).not.toContain('/health.json')
    expect(ids(judgeOpenApiAnswer(answer({body: JSON.stringify({...document, paths: null})})))).toEqual(['wellknown-openapi-paths'])
  })

  it('fetches each distinct target once, from the audited base, and counts what it held', async () => {
    const asked: Array<{url: string; init: RequestInit}> = []
    const get = async (url: string, init: RequestInit) => {
      asked.push({url, init})
      return new Response(documentText, {headers: {'content-type': MEDIA_TYPE}})
    }
    const doubled = {linkset: [...catalog.linkset, ...catalog.linkset]}
    const result = await probeOpenApiTargets(doubled, get, 'https://pr-1-human-datastream.example.workers.dev')
    expect(asked.map((a) => a.url)).toEqual(['https://pr-1-human-datastream.example.workers.dev/openapi.json'])
    expect(asked[0].init.redirect).toBe('manual')
    expect((asked[0].init.headers as Record<string, string>).Accept).toBe(MEDIA_TYPE)
    expect(result).toEqual({measured: 1, findings: []})
  })

  it('an unreachable target is a finding and is not measured, never a pass', async () => {
    const result = await probeOpenApiTargets(catalog, async () => {
      throw new Error('ECONNRESET')
    })
    expect(result.measured).toBe(0)
    expect(ids(result.findings)).toEqual(['wellknown-openapi-unreachable'])
    expect(result.findings[0].message).toContain('ECONNRESET')
  })

  it('a catalog with no target measures nothing and fails', async () => {
    const result = await probeOpenApiTargets({linkset: []}, async () => {
      throw new Error('not called')
    })
    expect(result).toEqual({measured: 0, findings: [expect.objectContaining({id: 'wellknown-openapi-target'})]})
  })
})

// atlas A18 reads this literal statically; the test keeps a change to it visible.
describe('ARTIFACTS', () => {
  it('declares the three registered surfaces this runner measures', () => {
    expect(ARTIFACTS).toEqual([{surfaceId: 'site-api-v1'}, {surfaceId: 'site-mcp-server'}, {surfaceId: 'site-openapi'}])
  })
})
