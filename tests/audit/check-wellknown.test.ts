import {describe, expect, it} from 'vitest'
import {
  PINNED_A2A_SPEC_VERSION,
  PINNED_ARD_SPEC_VERSION,
  validateAgentCardShape,
  validateAiCatalogShape,
  validateApiCatalogShape,
  validateMcpServerCardShape,
  validateWebfingerShape
} from '../../scripts/audit/check-wellknown.mjs'

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

describe('validateAgentCardShape', () => {
  const valid = {
    name: 'x',
    description: 'x',
    version: '1.0.0',
    capabilities: {},
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    supportedInterfaces: [{url: 'https://example.com', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0'}],
    skills: [{id: 'x'}]
  }

  it(`a conformant A2A v${PINNED_A2A_SPEC_VERSION} card produces zero findings`, () => {
    expect(validateAgentCardShape(valid)).toEqual([])
  })

  it('an empty supportedInterfaces array fails -- A2A requires at least one', () => {
    const findings = validateAgentCardShape({...valid, supportedInterfaces: []})
    expect(findings.map((f) => f.id)).toContain('wellknown-agent-card-no-interfaces')
  })

  it('a supportedInterfaces entry missing protocolBinding fails', () => {
    const findings = validateAgentCardShape({...valid, supportedInterfaces: [{url: 'https://example.com'}]})
    expect(findings.map((f) => f.id)).toContain('wellknown-agent-card-interface-shape')
  })

  it('an empty skills array is a warn', () => {
    const findings = validateAgentCardShape({...valid, skills: []})
    expect(findings).toEqual([expect.objectContaining({severity: 'warn', id: 'wellknown-agent-card-no-skills'})])
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

  it('a specVersion drifted from the pinned constant is a warn, not a fail', () => {
    const findings = validateAiCatalogShape({...valid, specVersion: '2.0'})
    expect(findings).toEqual([
      expect.objectContaining({severity: 'warn', id: 'wellknown-ai-catalog-spec-version-drift'})
    ])
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

describe('validateMcpServerCardShape', () => {
  const valid = {name: 'x', serverInfo: {}, capabilities: {}, transport: {url: 'https://example.com'}, resources: [{uri: 'https://example.com/health.json'}]}

  it('a conformant server card produces zero findings', () => {
    expect(validateMcpServerCardShape(valid)).toEqual([])
  })

  it('a transport missing a url fails', () => {
    const findings = validateMcpServerCardShape({...valid, transport: {}})
    expect(findings.map((f) => f.id)).toContain('wellknown-mcp-server-card-transport-url')
  })

  it('an empty resources array is a warn', () => {
    const findings = validateMcpServerCardShape({...valid, resources: []})
    expect(findings).toEqual([
      expect.objectContaining({severity: 'warn', id: 'wellknown-mcp-server-card-no-resources'})
    ])
  })
})

describe('validateApiCatalogShape', () => {
  it('a conformant linkset produces zero findings', () => {
    const findings = validateApiCatalogShape({linkset: [{anchor: 'https://example.com'}]}, 'application/linkset+json')
    expect(findings).toEqual([])
  })

  it('wrong content-type fails (RFC 9727)', () => {
    const findings = validateApiCatalogShape({linkset: [{anchor: 'https://example.com'}]}, 'application/json')
    expect(findings.map((f) => f.id)).toContain('wellknown-api-catalog-content-type')
  })

  it('an empty linkset fails', () => {
    const findings = validateApiCatalogShape({linkset: []}, 'application/linkset+json')
    expect(findings.map((f) => f.id)).toContain('wellknown-api-catalog-linkset')
  })
})
