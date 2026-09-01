import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  PINNED_AGENT_SKILLS_SCHEMA,
  PINNED_ARD_SPEC_VERSION,
  validateAgentSkillsIndexShape,
  validateAiCatalogShape,
  validateApiCatalogShape,
  validateMcpServerCardShape,
  validateWebfingerShape
} from '../../scripts/audit/check-wellknown.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
