import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

// Atlas decision 0168 item 21 (owner decision): visual shard 1 runs the three Dashboard full-page
// screens at the viewports that pay the 13 s bio-terminal typing wait, and shards 2 to 4 split
// every other test. This suite lists each matrix entry's tests with `playwright test --list` (no
// browser, no web server) and fails when the four sets overlap, miss a test, or drift from the
// matrix in visual-tests.yml.

const LANE_FILE = 'tests/visual/shards/typing-wait.txt'
const WIDE_PROJECTS = ['desktop-1400', 'tablet-1100', 'tablet-768']
const DASHBOARD_SCREENS = ['Dashboard - populated', 'Dashboard - empty', 'Dashboard - full']

const MATRIX: ReadonlyArray<{shard: number; select: string}> = [
  {shard: 1, select: `--test-list=${LANE_FILE}`},
  {shard: 2, select: `--test-list-invert=${LANE_FILE} --shard=1/3`},
  {shard: 3, select: `--test-list-invert=${LANE_FILE} --shard=2/3`},
  {shard: 4, select: `--test-list-invert=${LANE_FILE} --shard=3/3`}
]

/** The `[project] › file:line:col › title` lines `playwright test --list` prints for one selection. */
function listTests(select: string): string[] {
  const output = execFileSync('pnpm', ['exec', 'playwright', 'test', '--list', ...select.split(' ').filter(Boolean)], {encoding: 'utf8'})
  return output.split('\n').map((line) => line.trim()).filter((line) => /^\[[^\]]+\] › /.test(line))
}

describe('visual shard split (decision 0168 item 21)', () => {
  const all = listTests('')
  const shards = MATRIX.map(({select}) => listTests(select))

  it('lists the whole suite', () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it('gives shard 1 exactly the three Dashboard screens at the three wide viewports', () => {
    expect(shards[0]).toHaveLength(WIDE_PROJECTS.length * DASHBOARD_SCREENS.length)
    for (const line of shards[0]) {
      expect(WIDE_PROJECTS.some((project) => line.startsWith(`[${project}] › dashboard.spec.ts:`))).toBe(true)
    }
    for (const screen of DASHBOARD_SCREENS) {
      expect(shards[0].filter((line) => line.includes(`› ${screen} › full page`))).toHaveLength(WIDE_PROJECTS.length)
    }
  })

  it('runs every test in exactly one shard', () => {
    const combined = shards.flat()
    expect(new Set(combined).size).toBe(combined.length)
    expect([...combined].sort()).toEqual([...all].sort())
  })

  it('keeps the serial Widgets - populated group of each project on one shard', () => {
    for (const project of ['desktop-1400', 'tablet-1100', 'tablet-768', 'mobile-600', 'mobile-390']) {
      const holders = shards.filter((tests) =>
        tests.some((line) => line.startsWith(`[${project}] › widgets.spec.ts:`) && line.includes('› Widgets - populated ›'))
      )
      expect(holders).toHaveLength(1)
    }
  })

  it('matches the visual-tests.yml matrix', () => {
    const workflow = readFileSync(resolve('.github/workflows/visual-tests.yml'), 'utf8')
    for (const {shard, select} of MATRIX) {
      expect(workflow).toContain(`          - shard: ${shard}\n            select: ${select}\n`)
    }
    expect(workflow).toContain('pnpm exec playwright test ${{ matrix.select }}')
    expect(workflow).not.toMatch(/--shard=\$\{\{ matrix\.shard \}\}/)
  })
})
