// Wiring assertions for .github/workflows/serving-probe.yml, mirroring
// tests/audit/audit-web-workflow.test.ts. The tight-cadence lane has to carry
// the same D4/D5/D6 guarantees as audit-web.yml, and the two conditions that
// are easiest to get subtly wrong (who reconciles, who pings) are asserted
// against the exact strings audit-web.yml uses.

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const workflow = readFileSync(resolve('.github/workflows/serving-probe.yml'), 'utf8')
const auditWeb = readFileSync(resolve('.github/workflows/audit-web.yml'), 'utf8')

// Comment lines stripped: the header comments deliberately quote the triggers
// and images they warn against ("no native schedule", "NOT the runner-playwright
// image"), so assertions about what the workflow DOES must look at what it
// executes, not at what it explains.
const executable = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')

const reconcileCondition = `if: >-
          always() && (
            github.event_name == 'schedule' ||
            (github.event_name == 'workflow_dispatch' && (inputs.scheduled_by_external == true || inputs.validate_reconciler == true))
          )`

const pingCondition =
  "if: always() && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.scheduled_by_external == true))"

describe('serving-probe report-only wiring (D4)', () => {
  it('keeps the probe non-blocking', () => {
    expect(workflow).toMatch(/id: serving_probe\n {8}if: [^\n]*\n {8}continue-on-error: true/)
    expect(workflow).toContain('run: node scripts/audit/serving-probe.mjs')
  })

  it('gates the probe on the shared focus-suppression probe', () => {
    expect(workflow).toContain('run: node scripts/audit/probe-suppression.mjs --github-output')
    expect(workflow).toContain("if: steps.focus_mode.outputs.suppressed != 'true'")
  })

  it('runs the egress preflight before the report-only step', () => {
    expect(executable).toContain('run: bash scripts/audit/preflight-egress.sh')
    expect(executable.indexOf('preflight-egress.sh')).toBeLessThan(executable.indexOf('serving-probe.mjs'))
  })
})

describe('serving-probe issue reconciliation (D5)', () => {
  it('has issue-write permission and reconciles the bucket through the shared reconciler', () => {
    expect(workflow).toMatch(/permissions:\n(?:  .*\n)*  issues: write/m)
    expect(workflow.match(/name: Reconcile managed audit issues/g)).toHaveLength(1)
    expect(workflow).toContain('client: reconciler.createGithubClient(github)')
    expect(workflow).toContain('scripts/audit/lib/file-check-issues.mjs')
    expect(executable).not.toMatch(/\bgh\s+(issue|label)\b/)
  })

  it('uses the same reconcile condition as audit-web.yml (decisions 0091/0092)', () => {
    expect(workflow).toContain(reconcileCondition)
    expect(auditWeb).toContain(reconcileCondition)
  })

  it('passes both the focus-probe and probe outcomes so a suppressed run cannot close the issue', () => {
    expect(workflow).toContain("outcome: '${{ steps.focus_mode.outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.serving_probe.outcome }}'")
  })

  it('declares both dispatch inputs the external scheduler and reconciler validation rely on', () => {
    expect(workflow).toMatch(/scheduled_by_external:\n {8}description: [^\n]*\n {8}type: boolean\n {8}default: false/)
    expect(workflow).toMatch(/validate_reconciler:\n {8}description: [^\n]*\n {8}type: boolean\n {8}default: false/)
  })
})

describe('serving-probe dead-man switch (D6)', () => {
  it('pings only on a trusted external dispatch, never on a human or reconciler-validation run', () => {
    const pings = executable.match(/- name: Healthchecks\.io ping[\s\S]*?run: bash scripts\/audit\/healthchecks-ping\.sh/g) || []
    expect(pings).toHaveLength(1)
    expect(pings[0]).toContain(pingCondition)
    expect(pings[0]).toContain('JOB_STATUS: ${{ job.status }}')
    // Its own switch, not audit-web's -- a shared URL could not tell which lane missed.
    expect(pings[0]).toContain('HC_URL: ${{ secrets.HC_PING_SERVING_PROBE }}')
    expect(auditWeb).toContain(pingCondition)
  })

  it('routes the ping through the shared script rather than an inline curl', () => {
    expect(executable).not.toMatch(/curl .*\$HC_URL/)
  })
})

describe('serving-probe runner isolation and cadence', () => {
  // The external scheduler is the single clock (Atlas decisions 0092/0093); the
  // estate removed native crons. A `schedule:` trigger here would reintroduce one.
  it('declares no native cron trigger', () => {
    expect(executable).not.toMatch(/^\s*schedule:/m)
    expect(executable).toMatch(/^\s*workflow_dispatch:/m)
  })

  it('stays on a self-hosted node runner and off the Colima-heavy playwright lane', () => {
    const runners = executable.match(/runs-on: .*/g) || []
    expect(runners).toHaveLength(1)
    expect(runners[0]).toContain('self-hosted')
    expect(runners[0]).toContain('node')
    expect(runners[0]).toContain('cfedge')
    expect(runners[0]).not.toContain('playwright')
    expect(runners[0]).not.toContain('ubuntu-latest')
  })

  it('installs no system packages and launches no browser', () => {
    expect(executable).not.toMatch(/apt-get|apt install|yum |apk add|brew install/)
    expect(executable).not.toMatch(/playwright install|lhci|pa11y/)
  })
})
