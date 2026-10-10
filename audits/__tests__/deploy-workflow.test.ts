import {readdirSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

// The deploy image-mirror check (`scripts/fetch-images.mjs`) was blind from 2026-08-28 to
// 2026-10-10. Its job ran without the `cfedge` label, the self-hosted Linux fleet reaches
// CloudFront only from the cfedge egress lane (ci-runners-private #130, atlas decisions 0085
// and 0088), and every fetch failed. A direct `issues.create` call then filed 65 duplicate
// issues. These assertions keep the lane and the managed-issue reconciler in place.

const WORKFLOWS_DIR = resolve('.github/workflows')
const IMAGE_AUDIT_SCRIPT = 'scripts/fetch-images.mjs'

interface Job {
  workflow: string
  key: string
  body: string
}

/** Workflow text with comment lines removed, so a comment that names a command never counts as running it. */
function executable(text: string): string {
  return text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
}

/** The jobs under the top-level `jobs:` key, bounded by the two-space job headers. */
function parseJobs(workflow: string, text: string): Job[] {
  const start = /^jobs:\s*$/m.exec(text)
  if (!start) {
    return []
  }
  const section = text.slice(start.index + start[0].length)
  const headers = [...section.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)]
  return headers.map((header, index) => ({
    workflow,
    key: header[1],
    body: section.slice(header.index, index + 1 < headers.length ? headers[index + 1].index : section.length)
  }))
}

/**
 * The labels in a job's `runs-on:`, as a flow sequence, a block sequence, or a scalar.
 * Returns null for any other shape, so an unreadable `runs-on` fails the lane assertion
 * instead of passing it.
 */
function runsOnLabels(jobBody: string): string[] | null {
  const lines = executable(jobBody).split('\n')
  const index = lines.findIndex((line) => /^ {4}runs-on:/.test(line))
  if (index < 0) {
    return null
  }
  const value = lines[index].replace(/^ {4}runs-on:\s*/, '').trim()
  const flow = /^\[(.*)\]$/.exec(value)
  if (flow) {
    return flow[1].split(',').map((label) => label.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  if (value === '') {
    const labels: string[] = []
    for (const line of lines.slice(index + 1)) {
      const item = /^ {6}- (.+)$/.exec(line)
      if (!item) {
        break
      }
      labels.push(item[1].trim().replace(/^['"]|['"]$/g, ''))
    }
    return labels.length > 0 ? labels : null
  }
  return /^[A-Za-z0-9_-]+$/.test(value) ? [value] : null
}

/** Jobs that run the image audit and lack the cfedge lane, as `workflow:job` strings. */
export function jobsMissingCfedge(workflows: Record<string, string>): {auditJobs: string[]; missing: string[]} {
  const auditJobs: string[] = []
  const missing: string[] = []
  for (const [name, text] of Object.entries(workflows)) {
    for (const job of parseJobs(name, text)) {
      if (!executable(job.body).includes(IMAGE_AUDIT_SCRIPT)) {
        continue
      }
      auditJobs.push(`${name}:${job.key}`)
      if (!runsOnLabels(job.body)?.includes('cfedge')) {
        missing.push(`${name}:${job.key}`)
      }
    }
  }
  return {auditJobs, missing}
}

/** True when the workflow files an issue directly instead of through the managed-issue reconciler. */
export function callsIssuesCreateDirectly(text: string): boolean {
  return /\bissues\.create\s*\(/.test(executable(text))
}

function readWorkflows(): Record<string, string> {
  const files = readdirSync(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/.test(file)).sort()
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(WORKFLOWS_DIR, file), 'utf8')]))
}

const workflows = readWorkflows()
const deploy = workflows['deploy.yml']

describe('image mirror audit lane', () => {
  it('runs every image-audit job on the cfedge egress lane', () => {
    const {auditJobs, missing} = jobsMissingCfedge(workflows)
    // Guards against a vacuous pass: renaming the script or deleting the job must red here.
    expect(auditJobs).toContain('deploy.yml:check-images')
    expect(missing).toEqual([])
  })

  it('reds when the cfedge label is removed', () => {
    const mutated = deploy.replace('[self-hosted, linux, arm64, node, cfedge]', '[self-hosted, linux, arm64, node]')
    expect(mutated).not.toBe(deploy)
    expect(jobsMissingCfedge({'deploy.yml': mutated}).missing).toEqual(['deploy.yml:check-images'])
  })

  it('reads block-sequence and scalar runs-on shapes, and rejects a cfedge that only appears in a comment', () => {
    const job = (runsOn: string) => `jobs:\n  audit:\n${runsOn}\n    steps:\n      - run: node ${IMAGE_AUDIT_SCRIPT} --check-only\n`
    expect(jobsMissingCfedge({'a.yml': job('    runs-on:\n      - self-hosted\n      - cfedge')}).missing).toEqual([])
    expect(jobsMissingCfedge({'a.yml': job('    runs-on: ubuntu-latest')}).missing).toEqual(['a.yml:audit'])
    expect(jobsMissingCfedge({'a.yml': job('    # runs-on: [cfedge]\n    runs-on: [self-hosted, node]')}).missing).toEqual(['a.yml:audit'])
    expect(jobsMissingCfedge({'a.yml': job('    runs-on: ${{ matrix.runner }}')}).missing).toEqual(['a.yml:audit'])
  })
})

describe('image mirror issue filing', () => {
  it('files issues only through the managed-issue reconciler', () => {
    expect(callsIssuesCreateDirectly(deploy)).toBe(false)
    expect(deploy).toContain("{id: 'image-mirror', title: 'Image mirror audit (deploy)', outcome: process.env.IMAGE_MIRROR_ISSUE_OUTCOME || 'failure'}")
    expect(deploy).toContain('IMAGE_MIRROR_ISSUE_OUTCOME: ${{ steps.check.outputs.issue_outcome }}')
    expect(deploy).toContain('client: reconciler.createGithubClient(github)')
  })

  it('reds when deploy.yml calls issues.create directly', () => {
    const mutated = deploy.replace('await reconciler.reconcileCheckIssues({',
      'await github.rest.issues.create({owner: context.repo.owner, repo: context.repo.repo, title: "x"});\n            await reconciler.reconcileCheckIssues({')
    expect(mutated).not.toBe(deploy)
    expect(callsIssuesCreateDirectly(mutated)).toBe(true)
  })

  it('ignores issues.create named only in a comment, and does not confuse createComment or createLabel', () => {
    expect(callsIssuesCreateDirectly('      # never call github.rest.issues.create( here\n')).toBe(false)
    expect(callsIssuesCreateDirectly('github.rest.issues.createComment({})\ngithub.rest.issues.createLabel({})')).toBe(false)
  })
})
