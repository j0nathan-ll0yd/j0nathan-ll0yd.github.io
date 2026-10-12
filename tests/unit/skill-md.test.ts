// @vitest-environment node
//
// The portfolio-expert Agent Skill is an LLM-facing channel, so the LLM-channel data policy
// governs it (SKILL.md decision 4, atlas decision 0096, applied 2026-10-07): it names none of the
// raw health, sleep, or workouts exports. Its Live Data Sources table is rendered from
// LLM_DATA_SOURCE_DIRECTORY by scripts/generate-webmcp.mjs, the same list get_data_sources serves.

import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {CLOUDFRONT_BASE, ENDPOINTS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {describe, expect, it} from 'vitest'
import {AGENT_PATHS, LLM_DATA_SOURCE_DIRECTORY} from '../../functions/_lib/agent-catalog.mjs'

const SKILL_PATH = 'public/.well-known/agent-skills/portfolio-expert/SKILL.md'
const SKILL = readFileSync(SKILL_PATH, 'utf8')

/** The body of one generated block, markers excluded. */
function generated(name: string): string {
  const begin = SKILL.indexOf(`<!-- BEGIN GENERATED: ${name}`)
  const end = SKILL.indexOf(`<!-- END GENERATED: ${name} -->`)
  expect(begin, name).toBeGreaterThanOrEqual(0)
  expect(end, name).toBeGreaterThan(begin)
  return SKILL.slice(SKILL.indexOf('\n', begin) + 1, end)
}

// Stated independently of the catalog policy, so one policy edit cannot both re-expose an
// export and drop it from this list.
const RAW_HEALTH_PATHS: readonly string[] = [ENDPOINTS.health, ENDPOINTS.sleep, ENDPOINTS.workouts]

describe('portfolio-expert SKILL.md', () => {
  it('names none of the raw health, sleep, or workouts exports', () => {
    for (const path of RAW_HEALTH_PATHS) {
      expect(SKILL).not.toContain(`${CLOUDFRONT_BASE}${path}`)
      expect(SKILL).not.toContain(path)
    }
  })

  it('renders its data-source table from LLM_DATA_SOURCE_DIRECTORY, row for row', () => {
    const block = generated('data-source directory')
    const rows = block.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Data ') && !line.startsWith('| ---'))
    expect(rows).toHaveLength(LLM_DATA_SOURCE_DIRECTORY.length)
    for (const [index, source] of LLM_DATA_SOURCE_DIRECTORY.entries()) {
      expect(rows[index]).toContain(`<${source.url}>`)
      expect(rows[index]).toContain(source.name)
    }
  })

  // Owner answer, 2026-10-12: an LLM-facing file may link the developer documentation, but never a
  // raw export. The first test above still holds the whole file to the second half.
  it('links the developer documentation: /openapi.json always, /developers once that page exists', () => {
    const block = generated('developer documentation')
    expect(block).toContain(`<${SITE_URL}${AGENT_PATHS.openapi}>`)
    const developersPage = ['developers.astro', 'developers/index.astro'].some((file) => existsSync(`src/pages/${file}`))
    expect(block.includes(`<${SITE_URL}${AGENT_PATHS.developers}>`)).toBe(developersPage)
  })

  it('is described by an agent-skills index digest computed from these exact bytes', () => {
    const index = JSON.parse(readFileSync('public/.well-known/agent-skills/index.json', 'utf8'))
    expect(index.skills[0].digest).toBe(`sha256:${createHash('sha256').update(readFileSync(SKILL_PATH)).digest('hex')}`)
  })
})
