import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

const distDir = path.resolve('dist')
const catalogPath = path.join(distDir, '.well-known', 'ai-catalog.json')

describe('agent discovery build output', () => {
  const catalog = fs.readFileSync(catalogPath, 'utf-8')

  it('does not publish an A2A Agent Card without an A2A server', () => {
    expect(fs.existsSync(path.join(distDir, '.well-known', 'agent-card.json'))).toBe(false)
    expect(catalog).not.toContain('application/a2a-agent-card+json')
    expect(catalog).not.toContain('/.well-known/agent-card.json')
  })

  it('retains the ARD catalog at specVersion 1.0 with MCP and Agent Skills entries', () => {
    expect(catalog).toContain('"specVersion": "1.0"')
    expect(catalog).toContain('https://jonathanlloyd.me/.well-known/mcp/server-card.json')
    expect(catalog).toContain('https://jonathanlloyd.me/.well-known/agent-skills/index.json')
  })
})
