import {describe, expect, it} from 'vitest'
import {validateRobots} from '../../scripts/audit/validate-robots.mjs'

const GOLDEN = {aiTrainingBotsBlockedExceptLlmsTxt: ['GPTBot', 'ClaudeBot'], aiSearchAgentsAllowedFullSite: ['OAI-SearchBot']}

const SITEMAP_URL = 'https://jonathanlloyd.me/sitemap-index.xml'

function robotsBody(overrides: {sitemap?: string; contentSignal?: string; agents?: string[]} = {}) {
  const sitemap = overrides.sitemap ?? `Sitemap: ${SITEMAP_URL}`
  const contentSignal = overrides.contentSignal ?? 'Content-Signal: search=yes, ai-train=no, ai-input=yes'
  const agents = overrides.agents ?? ['GPTBot', 'ClaudeBot', 'OAI-SearchBot']
  const agentBlocks = agents.map((a) => `User-agent: ${a}\nDisallow: /\n`).join('\n')
  return `User-agent: *\nAllow: /\n\n${contentSignal}\n\n${agentBlocks}\n${sitemap}\n`
}

describe('validateRobots', () => {
  it('a fully-conformant robots.txt (matching the golden AI-crawler list) produces zero findings', () => {
    expect(validateRobots(robotsBody(), GOLDEN)).toEqual([])
  })

  it('a Sitemap: directive pointing elsewhere fails', () => {
    const findings = validateRobots(robotsBody({sitemap: 'Sitemap: https://elsewhere.example/sitemap.xml'}), GOLDEN)
    expect(findings.map((f) => f.id)).toContain('robots-sitemap-directive')
  })

  it('a missing Content-Signal line fails', () => {
    const body = robotsBody().replace(/Content-Signal:.*\n/, '')
    const findings = validateRobots(body, GOLDEN)
    expect(findings.map((f) => f.id)).toContain('robots-content-signal-missing')
  })

  it('known-answer: dropping a golden AI-crawler User-agent section is a drift-guard fail', () => {
    const findings = validateRobots(robotsBody({agents: ['ClaudeBot', 'OAI-SearchBot']}), GOLDEN)
    expect(findings).toContainEqual(expect.objectContaining({severity: 'fail', id: 'robots-ai-crawler-missing', message: expect.stringContaining('GPTBot')}))
  })

  it('a new, not-yet-golden User-agent section is a warn, not a fail', () => {
    const findings = validateRobots(robotsBody({agents: ['GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'SomeNewBot']}), GOLDEN)
    const newBotFinding = findings.find((f) => f.id === 'robots-ai-crawler-new')
    expect(newBotFinding?.severity).toBe('warn')
    expect(findings.some((f) => f.severity === 'fail')).toBe(false)
  })
})
