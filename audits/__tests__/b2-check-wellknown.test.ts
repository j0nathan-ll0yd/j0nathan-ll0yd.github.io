import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  judgeMcpExchange,
  judgeModernExchange,
  MODERN_PROTOCOL_VERSION,
  parseMcpBody,
  PINNED_AGENT_SKILLS_SCHEMA,
  PINNED_ARD_SPEC_VERSION,
  probeMcpRemotes,
  rebase,
  SERVER_CARD_MEDIA_TYPE,
  streamableRemotes,
  validateAgentSkillsIndexShape,
  validateAiCatalogShape,
  validateApiCatalogShape,
  validateArdManifest,
  validateMcpServerCard,
  validateWebfingerShape
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

  it('runs both eras: initialize and tools/list, then server/discover and a tools/call per tool', async () => {
    const calls: Array<{method: string; headers?: Record<string, string>; meta?: unknown}> = []
    const post = async (_url: string, message: {method: string; params?: {_meta?: unknown}}, headers?: Record<string, string>) => {
      calls.push({method: message.method, headers, meta: message.params?._meta})
      return ({initialize, 'tools/list': toolsList, 'server/discover': discover} as Record<string, unknown>)[message.method] ?? called
    }
    const result = await probeMcpRemotes(card, post)
    expect(calls.map((c) => c.method)).toEqual(['initialize', 'tools/list', 'server/discover', 'tools/call'])
    expect(calls[1]!.headers).toEqual({'MCP-Protocol-Version': '2025-11-25'})
    expect(calls[3]!.headers).toEqual({'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_profile'})
    expect(calls[3]!.meta).toEqual(expect.objectContaining({'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION}))
    expect(result).toEqual({measured: 2, findings: []})
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
    expect(rebase('https://jonathanlloyd.me/mcp', 'https://x.human-datastream.pages.dev')).toBe('https://x.human-datastream.pages.dev/mcp')
    expect(rebase('https://d1pfm520aduift.cloudfront.net/a.json', 'https://x.human-datastream.pages.dev')).toBe(
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
