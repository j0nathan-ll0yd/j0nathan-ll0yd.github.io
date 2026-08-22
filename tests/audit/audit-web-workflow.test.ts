import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const workflowPath = resolve('.github/workflows/audit-web.yml')
const workflow = readFileSync(workflowPath, 'utf8')

describe('audit-web issue reconciliation wiring', () => {
  it('gives the workflow issue-write permission and reconciles all three scheduled buckets', () => {
    expect(workflow).toMatch(/permissions:\n(?:  .*\n)*  issues: write/m)
    expect(workflow.match(/name: Reconcile managed audit issues/g)).toHaveLength(3)
    expect(workflow.match(/run: node scripts\/audit\/lib\/file-check-issues\.mjs/g)).toHaveLength(3)
    expect(workflow.match(/if: always\(\) && github\.event_name != 'workflow_dispatch'/g)).toHaveLength(3)
  })

  it('passes every check outcome, including successes needed for recovery', () => {
    const resultPayloads = workflow.match(/CHECK_RESULTS_JSON: >-[\s\S]*?run: node scripts\/audit\/lib\/file-check-issues\.mjs/g) || []
    expect(resultPayloads).toHaveLength(3)
    for (const payload of resultPayloads) {
      expect(payload).toContain('"outcome":"${{ steps.')
    }
  })
})
