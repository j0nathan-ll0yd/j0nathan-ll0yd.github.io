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
    expect(workflow).toContain("outcome: '${{ steps.llms_coherence.outputs.issue_outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.security_txt.outcome }}'")
  })

  it('preserves the llms coherence command failure for its managed issue bucket', () => {
    const coherenceStep = executable.match(/      - name: B2 -- llms origin\/site coherence\n[\s\S]*?(?=\n      - name: Upload B2)/)?.[0] ?? ''
    expect(coherenceStep).toContain('id: llms_coherence')
    expect(coherenceStep).toContain('continue-on-error: true')
    expect(coherenceStep).toContain('pnpm exec tsx audits/checks/b2-check-llms-coherence.mjs')
    expect(coherenceStep).toContain('--evidence-out artifacts/llms-assurance/spoke-b2.json')
    expect(executable).not.toMatch(/check-llms-coherence\.mjs[^\n]*(\|\| true|; true)/)
    expect(workflow).toContain(
      "{id: 'llms-coherence', title: 'B2 llms origin/site coherence', outcome: '${{ steps.llms_coherence.outputs.issue_outcome }}'}"
    )
    expect(workflow).not.toContain('steps.llms_coherence.outcome')
  })

  it('runs the coherence classifier under suppression and always uploads its evidence path', () => {
    const coherenceStep = executable.match(/      - name: B2 -- llms origin\/site coherence\n[\s\S]*?(?=\n      - name: Upload B2)/)?.[0] ?? ''
    expect(coherenceStep).not.toContain("if: steps.focus_mode.outputs.suppressed != 'true'")
    expect(coherenceStep).toContain('B2_EVIDENCE_REVISION: ${{ github.sha }}')
    expect(coherenceStep).toContain('B2_EVIDENCE_WORKFLOW_REF: ${{ github.workflow_ref }}')
    expect(coherenceStep).toContain('B2_EVIDENCE_RUN_ATTEMPT: ${{ github.run_attempt }}')
    expect(coherenceStep).toContain('--evidence-out artifacts/llms-assurance/spoke-b2.json')
    expect(workflow).toContain("outcome: '${{ steps.llms_coherence.outputs.issue_outcome }}'")
    expect(workflow).not.toMatch(/steps\.llms_coherence\.outputs\.issue_outcome[^\n]*(\|\||success|failure)/)

    const uploadStep = executable.match(/      - name: Upload B2 llms coherence evidence\n[\s\S]*?(?=\n      - name: B2 -- sitemap)/)?.[0] ?? ''
    expect(uploadStep).toContain('if: always()')
    expect(uploadStep).toContain('continue-on-error: true')
    expect(uploadStep).toContain('uses: actions/upload-artifact@')
    expect(uploadStep).toContain('path: artifacts/llms-assurance/spoke-b2.json')
    expect(uploadStep).toContain('if-no-files-found: error')
  })

  it('wires a fail-closed read-only Cloudflare rule audit with existing secret names', () => {
    const auditStep =
      executable.match(/      - name: B2 -- Cloudflare llms cache rules \(read-only\)\n[\s\S]*?(?=\n      - name: Upload Cloudflare)/)?.[0] ?? ''
    expect(auditStep).toContain('id: llms_cache_rules')
    expect(auditStep).toContain('continue-on-error: true')
    expect(auditStep).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}')
    expect(auditStep).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}')
    expect(auditStep).toContain('CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}')
    expect(auditStep).toContain('node audits/checks/b2-check-cloudflare-llms-cache-rules.mjs')
    expect(auditStep).toContain('--evidence-out artifacts/llms-assurance/cloudflare-cache-rules.json')

    const uploadStep = executable.match(/      - name: Upload Cloudflare llms cache-rule evidence\n[\s\S]*?(?=\n      - name: B2 -- sitemap)/)?.[0] ?? ''
    expect(uploadStep).toContain('if: always()')
    expect(uploadStep).toContain('path: artifacts/llms-assurance/cloudflare-cache-rules.json')
    expect(workflow).toContain(
      "{id: 'llms-cache-rules', title: 'B2 Cloudflare llms cache-rule audit', outcome: '${{ steps.llms_cache_rules.outputs.issue_outcome }}'}"
    )
    expect(workflow).not.toContain('steps.llms_cache_rules.outcome')
  })

  it('conditions gated checks on the shared focus probe without touching honest static checks', () => {
    expect(workflow).toContain('run: node audits/probe-suppression.mjs --github-output')
    expect(workflow.match(/if: steps\.focus_mode\.outputs\.suppressed != 'true'/g)).toHaveLength(3)
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
    expect(executable).toContain('run: node audits/checks/b2-validate-sitemap.mjs')
  })
})

describe('audit-web tier gating', () => {
  // The external scheduler is the only clock (atlas decisions 0092/0093) and
  // this workflow has no `schedule:` trigger, so a `github.event.schedule`
  // comparison can never be true -- dead code whose only possible effect is to
  // silently disable a job if a trigger shape ever changes. Ruling R9a (atlas
  // decision 0116) deleted the three dead arms; this pins the deletion.
  it('gates each tier on the dispatch input alone, with no dead cron-equality arms', () => {
    expect(workflow).not.toContain('github.event.schedule')
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && (inputs.tier == 'daily' || inputs.tier == 'all')")
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && (inputs.tier == 'weekly' || inputs.tier == 'all')")
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && (inputs.tier == 'monthly' || inputs.tier == 'all')")
  })
})

describe('audit-web dead-man switch', () => {
  // The switch answers "did the lane run to measurement". A crashed job used to
  // ping plain success while every bucket reported "skipped", so neither the
  // reconciler nor Healthchecks.io raised anything.
  const pings = executable.match(/- name: Healthchecks\.io ping[\s\S]*?run: bash audits\/healthchecks-ping\.sh/g) || []

  it('routes all three pings through the shared script with the job status', () => {
    expect(pings).toHaveLength(3)
    for (const ping of pings) {
      // Atlas decision 0092: only schedules and trusted external dispatches ping.
      // Reconciler-validation and ordinary human dispatches do not.
      expect(ping).toContain(pingCondition)
      expect(ping).toContain('JOB_STATUS: ${{ job.status }}')
    }
  })

  // Ruling R9a (atlas decision 0116): all three tiers used to ping the SAME
  // tile, so a dead weekly or monthly dispatch refreshed nothing distinct and
  // the daily ping masked it. One tile per tier makes that undeclarable, and
  // HC_SECRET_NAME makes an unarmed tier's skip message name the right secret.
  it('pings one distinct tile per tier, so a dead weekly or monthly lane cannot hide behind the daily ping', () => {
    const [daily, weekly, monthly] = pings
    expect(daily).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB }}')
    expect(daily).toContain('HC_SECRET_NAME: HC_PING_AUDIT_WEB\n')
    expect(weekly).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_WEEKLY }}')
    expect(weekly).toContain('HC_SECRET_NAME: HC_PING_AUDIT_WEB_WEEKLY')
    expect(monthly).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_MONTHLY }}')
    expect(monthly).toContain('HC_SECRET_NAME: HC_PING_AUDIT_WEB_MONTHLY')
    // Exactly one ping per secret: the masking defect was one secret used three times.
    expect(countOccurrences(workflow, 'HC_URL: ${{ secrets.HC_PING_AUDIT_WEB }}')).toBe(1)
    expect(countOccurrences(workflow, 'HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_WEEKLY }}')).toBe(1)
    expect(countOccurrences(workflow, 'HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_MONTHLY }}')).toBe(1)
  })

  it('no longer curls the ping URL inline, which could not distinguish a wedged lane', () => {
    expect(executable).not.toMatch(/curl .*\$HC_URL/)
  })
})
