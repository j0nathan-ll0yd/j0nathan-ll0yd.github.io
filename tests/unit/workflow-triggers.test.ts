import {readdirSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

// Atlas decision 0168 pins three workflow facts here.
//
// Item 2: drafts run CI, and the draft-to-ready flip runs nothing. `strict: true` forces a new
// sha whenever main moves, so a `ready_for_review` run re-tests a head that already ran (record
// F3: 30 of 176 heads, p50 213 s). A `pull_request` trigger must keep the three default types and
// must not skip drafts.
//
// Item 5: no `actions/setup-node` step restores the pnpm store from the GitHub cache. On this
// fleet the restore (p50 23 s) cost more than the install it saved (p50 10 s).
//
// Item 16: `visual-gate` is the one context branch protection can require for the visual
// workflow, so it must run on every outcome and fail on anything but `success` (decision 0152:
// never skip-as-pass).

const WORKFLOWS_DIR = resolve('.github/workflows')
const DEFAULT_PULL_REQUEST_TYPES = ['opened', 'synchronize', 'reopened']

const workflows = readdirSync(WORKFLOWS_DIR).filter((name) => /\.ya?ml$/.test(name)).map((name) => ({
  name,
  text: readFileSync(join(WORKFLOWS_DIR, name), 'utf8')
}))

/** Workflow text with comment lines removed, so a comment that names a key never counts as setting it. */
function executable(text: string): string {
  return text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
}

/** The body of the `pull_request:` trigger under `on:`, or undefined when the workflow has none. */
function pullRequestTrigger(text: string): string | undefined {
  const match = /^ {2}pull_request:[^\n]*\n((?: {4,}[^\n]*\n|\s*\n)*)/m.exec(executable(text))
  return match ? match[0] : undefined
}

/** The body of one top-level job, bounded by the next two-space job header. */
function jobBody(text: string, key: string): string | undefined {
  const lines = executable(text).split('\n')
  const start = lines.findIndex((line) => line === `  ${key}:`)
  if (start < 0) {
    return undefined
  }
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line))
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

describe('pull_request triggers (decision 0168 item 2)', () => {
  const triggered = workflows.filter(({text}) => pullRequestTrigger(text) !== undefined)

  it('finds the pull_request workflows', () => {
    expect(triggered.map(({name}) => name)).toEqual(expect.arrayContaining(['static-checks.yml', 'visual-tests.yml', 'preview-deploy.yml']))
  })

  it.each(triggered)('$name runs on drafts and not on the ready flip', ({text}) => {
    const trigger = pullRequestTrigger(text) ?? ''
    const types = /types:\s*\[([^\]]*)\]/.exec(trigger)
    if (types) {
      const listed = types[1].split(',').map((type) => type.trim()).filter(Boolean)
      expect(listed).toEqual(expect.arrayContaining(DEFAULT_PULL_REQUEST_TYPES))
      expect(listed).not.toContain('ready_for_review')
    } else {
      expect(trigger).not.toMatch(/types:/)
    }
    expect(executable(text)).not.toMatch(/pull_request\.draft/)
  })
})

describe('setup-node (decision 0168 item 5)', () => {
  it.each(workflows)('$name does not restore a package-manager cache', ({text}) => {
    expect(executable(text)).not.toMatch(/^\s+cache:\s*\S/m)
  })
})

describe('visual-gate (decision 0168 item 16)', () => {
  const visual = workflows.find(({name}) => name === 'visual-tests.yml')?.text ?? ''
  const gate = jobBody(visual, 'visual-gate') ?? ''

  it('needs every visual shard and the behavioral suite', () => {
    expect(gate).toMatch(/needs:\s*\[visual-tests, behavioral\]/)
  })

  it('runs on every outcome of the jobs it needs', () => {
    expect(gate).toMatch(/^ {4}if: always\(\)$/m)
  })

  it('fails unless each needed job concluded success', () => {
    expect(gate).toContain('${{ needs.visual-tests.result }}')
    expect(gate).toContain('${{ needs.behavioral.result }}')
    expect(gate).toMatch(/"\$VISUAL_RESULT" != "success"/)
    expect(gate).toMatch(/"\$BEHAVIORAL_RESULT" != "success"/)
    expect(gate).toMatch(/exit 1/)
  })
})
