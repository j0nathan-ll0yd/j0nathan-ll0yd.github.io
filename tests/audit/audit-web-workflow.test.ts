import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const workflowPath = resolve('.github/workflows/audit-web.yml')
const workflow = readFileSync(workflowPath, 'utf8')

// Comment lines stripped. The comments deliberately quote the commands and
// failure modes they warn against ("do not reintroduce apt-get", "used to shell
// out to xmllint"), so the banned-command assertions below must look at what the
// workflow EXECUTES, not at what it explains.
const executable = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const countOccurrences = (text: string, snippet: string) => text.split(snippet).length - 1

const reconcileCondition = `if: >-
          always() && (
            github.event_name == 'schedule' ||
            (github.event_name == 'workflow_dispatch' && (inputs.scheduled_by_external == true || inputs.validate_reconciler == true))
          )`

const pingCondition =
  "if: always() && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.scheduled_by_external == true))"

describe('audit-web issue reconciliation wiring', () => {
  it('gives the workflow issue-write permission and reconciles all three scheduled buckets', () => {
    expect(workflow).toMatch(/permissions:\n(?:  .*\n)*  issues: write/m)
    expect(workflow.match(/name: Reconcile managed audit issues/g)).toHaveLength(3)
    expect(workflow.match(/uses: actions\/github-script@/g)?.length).toBeGreaterThanOrEqual(3)
    expect(workflow.match(/client: reconciler\.createGithubClient\(github\)/g)).toHaveLength(3)
    // Atlas decision 0092: reconcile scheduled and trusted external dispatches.
    // Decision 0091 keeps explicit reconciler validation independent of pings.
    expect(countOccurrences(workflow, reconcileCondition)).toBe(3)
    // Linear regex (no nested quantifier) — the earlier /(?:\s+.*\n)*/ form was a
    // catastrophic-backtracking ReDoS that hung the vitest run.
    expect(workflow).toMatch(/validate_reconciler:\n {8}description: [^\n]*\n {8}type: boolean\n {8}default: false/)
    expect(workflow).toMatch(/scheduled_by_external:\n {8}description: [^\n]*\n {8}type: boolean\n {8}default: false/)
    expect(executable).not.toMatch(/\bgh\s+(issue|label)\b/)
  })

  it('passes every check outcome, including successes needed for recovery', () => {
    expect(workflow).toContain("outcome: '${{ steps.smoke.outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.llms_txt.outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.llms_coherence.outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.security_txt.outcome }}'")
  })

  it('preserves the llms coherence command failure for its managed issue bucket', () => {
    expect(executable).toMatch(
      /id: llms_coherence\n {8}if: steps\.focus_mode\.outputs\.suppressed != 'true'\n {8}continue-on-error: true\n {8}run: pnpm exec tsx scripts\/audit\/check-llms-coherence\.mjs/
    )
    expect(executable).not.toMatch(/check-llms-coherence\.mjs[^\n]*(\|\| true|; true)/)
    expect(workflow).toContain("{id: 'llms-coherence', title: 'B2 llms origin/site coherence', outcome: '${{ steps.llms_coherence.outcome }}'}")
  })

  it('conditions gated checks on the shared focus probe without touching honest static checks', () => {
    expect(workflow).toContain('run: node scripts/audit/probe-suppression.mjs --github-output')
    expect(workflow.match(/if: steps\.focus_mode\.outputs\.suppressed != 'true'/g)).toHaveLength(4)
    expect(workflow).toContain('Lighthouse result is focus-mode-conditioned')
    expect(workflow).toContain('pa11y / result is focus-mode-conditioned')
    expect(workflow).toContain("{id: 'llms-txt', title: 'B2 llms.txt structural validator', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).toContain("{id: 'llms-coherence', title: 'B2 llms origin/site coherence', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).toContain("{id: 'feeds', title: 'B2 feed.xml/feed.json validator', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).toContain("{id: 'lychee', title: 'B5 lychee link check', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).not.toMatch(/id: sitemap[\s\S]{0,120}focus_mode/)
  })
})

describe('audit-web runner isolation', () => {
  // These jobs run on self-hosted arm64 runners behind a default-deny egress
  // allowlist that excludes ports.ubuntu.com and deb.nodesource.com. A per-run
  // package install exits 100 there and kills the whole report-only job before
  // any check runs -- runs 31999694781, 32600311656 and 32695529989 all died
  // this way, leaving B2 live-artifact validation dark from 2026-08-10.
  it('installs no system packages at run time', () => {
    expect(executable).not.toMatch(/apt-get|apt install|yum |apk add|brew install/)
  })

  it('keeps every job on self-hosted runners', () => {
    const runners = executable.match(/runs-on: .*/g) || []
    expect(runners).toHaveLength(3)
    for (const runner of runners) {
      expect(runner).toContain('self-hosted')
      expect(runner).not.toContain('ubuntu-latest')
    }
  })

  it('validates the sitemap in-process rather than shelling out to xmllint', () => {
    expect(executable).not.toContain('xmllint')
    expect(executable).toContain('run: node scripts/audit/validate-sitemap.mjs')
  })
})

describe('audit-web dead-man switch', () => {
  // The switch answers "did the lane run to measurement". A crashed job used to
  // ping plain success while every bucket reported "skipped", so neither the
  // reconciler nor Healthchecks.io raised anything.
  it('routes all three pings through the shared script with the job status', () => {
    const pings = executable.match(/- name: Healthchecks\.io ping[\s\S]*?run: bash scripts\/audit\/healthchecks-ping\.sh/g) || []
    expect(pings).toHaveLength(3)
    for (const ping of pings) {
      // Atlas decision 0092: only schedules and trusted external dispatches ping.
      // Reconciler-validation and ordinary human dispatches do not.
      expect(ping).toContain(pingCondition)
      expect(ping).toContain('JOB_STATUS: ${{ job.status }}')
      expect(ping).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB }}')
    }
  })

  it('no longer curls the ping URL inline, which could not distinguish a wedged lane', () => {
    expect(executable).not.toMatch(/curl .*\$HC_URL/)
  })
})
