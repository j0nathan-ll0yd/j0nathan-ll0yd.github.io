// @vitest-environment node
//
// The portfolio-expert Agent Skill is an LLM-facing channel, so the LLM-channel data policy
// governs it (SKILL.md decision 4, atlas decision 0096, applied 2026-10-07): it names none of the
// raw health, sleep, or workouts exports. Its Live Data Sources table is rendered from
// LLM_DATA_SOURCE_DIRECTORY by scripts/generate-webmcp.mjs, the same list get_data_sources serves.

import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {describe, expect, it} from 'vitest'
import {LLM_DATA_SOURCE_DIRECTORY} from '../../functions/_lib/agent-catalog.mjs'

const SKILL_PATH = 'public/.well-known/agent-skills/portfolio-expert/SKILL.md'
const SKILL = readFileSync(SKILL_PATH, 'utf8')

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
    const block = SKILL.slice(SKILL.indexOf('<!-- BEGIN GENERATED: data-source directory'), SKILL.indexOf('<!-- END GENERATED: data-source directory -->'))
    const rows = block.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Data ') && !line.startsWith('| ---'))
    expect(rows).toHaveLength(LLM_DATA_SOURCE_DIRECTORY.length)
    for (const [index, source] of LLM_DATA_SOURCE_DIRECTORY.entries()) {
      expect(rows[index]).toContain(`<${source.url}>`)
      expect(rows[index]).toContain(source.name)
    }
  })

  it('is described by an agent-skills index digest computed from these exact bytes', () => {
    const index = JSON.parse(readFileSync('public/.well-known/agent-skills/index.json', 'utf8'))
    expect(index.skills[0].digest).toBe(`sha256:${createHash('sha256').update(readFileSync(SKILL_PATH)).digest('hex')}`)
  })
})
