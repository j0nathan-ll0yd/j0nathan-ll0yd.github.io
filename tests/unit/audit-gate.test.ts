import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

// Atlas decision 0163 item 3 (owner ruling 2026-11-06): `pnpm audit --audit-level=high` blocks, and the
// named waivers are its explicit allowlist. These pins keep the gate able to fail. The audit itself
// cannot run here, because its answer depends on the advisory database, not on this tree.

/** The waivers the owner ruling covers. A new one edits this list in the same reviewed change. */
const NAMED_WAIVERS = {'GHSA-g3hv-75wg-m249': 'minimatch', 'GHSA-3g3m-2fjr-6pw4': 'glob', 'GHSA-gcqx-w48m-w2h4': 'deepmerge'}

/** The whole command. Any other flag or shell form can defeat the gate: a second `--audit-level`, `-P`, `| tee`, `|| exit 0`. */
const AUDIT_COMMAND =
  'pnpm audit --audit-level=high --fetch-timeout=180000 --fetch-retries=3 --fetch-retry-factor=2 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=20000'

const workflow = readFileSync(resolve('.github/workflows/static-checks.yml'), 'utf8')
const workspace = readFileSync(resolve('pnpm-workspace.yaml'), 'utf8')

/** The audit step, from its `- name:` line to the next step, comments removed. */
function auditStep(): string {
  const start = workflow.indexOf('- name: Dependency audit')
  expect(start, 'static-checks.yml has no dependency audit step').toBeGreaterThan(-1)
  const end = workflow.indexOf('\n      - name:', start)
  return workflow.slice(start, end).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
}

/** The step's folded `run: >-` block as the one command the shell receives. */
function auditCommand(): string {
  const [, block = ''] = /^ {8}run: >-\n((?: {10}.*\n?)+)/m.exec(auditStep()) ?? []
  return block.split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
}

/** Every line under `audit.ignore`, up to the next top-level line. A comment or a blank line among them fails the parse. */
function waivers(): Array<{ghsa: string; note: string}> {
  const lines = workspace.split('\n')
  const start = lines.indexOf('audit:')
  expect(start, 'pnpm-workspace.yaml has no audit key').toBeGreaterThan(-1)
  expect(lines.filter((line) => line === 'audit:')).toHaveLength(1)
  expect(lines[start + 1]).toBe('  ignore:')
  const next = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  const entries = lines.slice(start + 2, next === -1 ? undefined : next)
  while (entries.at(-1) === '') {
    entries.pop()
  }
  return entries.map((line) => {
    const match = /^ {4}- (GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}) # (.+)$/.exec(line)
    expect(match, `not a waiver entry: "${line}"`).not.toBeNull()
    return {ghsa: match![1], note: match![2]}
  })
}

describe('the blocking dependency audit', () => {
  it('runs at the high level in the static-checks job, on the install', () => {
    const step = auditStep()
    expect(step).toMatch(/^ {8}id: audit_high$/m)
    expect(step).toContain("steps.install.outcome == 'success'")
    expect(workflow.indexOf('- name: Dependency audit')).toBeLessThan(workflow.indexOf('\n  spec-mutation-score:'))
  })

  it('feeds the required static-checks context', () => {
    expect(workflow).toContain('audit_high=${{ steps.audit_high.outcome }}')
  })

  it('cannot pass without judging: the command is exact, and nothing swallows its exit code', () => {
    expect(auditCommand()).toBe(AUDIT_COMMAND)
    const step = auditStep()
    expect(step).not.toContain('continue-on-error')
    expect(step).not.toMatch(/^\s+shell:/m)
  })
})

describe('the audit allowlist', () => {
  it('names exactly the waivers the owner ruling covers', () => {
    expect(waivers().map(({ghsa}) => ghsa).sort()).toEqual(Object.keys(NAMED_WAIVERS).sort())
  })

  it('states the package, the severity and the date of each waiver', () => {
    for (const {ghsa, note} of waivers()) {
      const pkg = NAMED_WAIVERS[ghsa as keyof typeof NAMED_WAIVERS]
      expect(note, ghsa).toMatch(new RegExp(`^${pkg} (low|moderate|high|critical) \\d{4}-\\d{2}-\\d{2}$`))
    }
  })

  it('has one suppression surface: the deprecated auditConfig form stays out', () => {
    expect(workspace).not.toMatch(/^auditConfig:/m)
    expect(readFileSync(resolve('package.json'), 'utf8')).not.toContain('ignoreGhsas')
  })
})
