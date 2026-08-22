#!/usr/bin/env node
// scripts/audit/lib/file-check-issues.mjs -- D5: reconcile one GitHub issue
// per audit check id. A failed bucket creates or reopens its managed issue; a
// wholly green bucket gets one recovery comment and closes it. Unknown,
// skipped, or partially green buckets never close anything.
//
// Invoked once per job from .github/workflows/audit-web.yml with a JSON array
// of `{ id, title, outcome }` built from that job's step outcomes. Duplicate
// ids are allowed so one logical bucket can contain multiple results. Shells
// out to `gh` (preinstalled + auto-authenticated via GH_TOKEN on GitHub-hosted
// runners) rather than adding an Octokit dependency.
//
// Every check step in audit-web.yml uses `continue-on-error: true`, so the
// script deliberately reads each step's own `outcome` instead of the aggregate
// job status. This remains report-only: reconciliation failures are logged per
// bucket and never make the audit job block CI or deploys.

import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

export const AUDIT_LABELS = [
  {name: 'audit', color: 'ededed', description: 'lp-audit finding'},
  {name: 'audit:report-only', color: 'ededed', description: 'report-only (non-blocking) audit finding'},
  {name: 'audit:managed', color: 'ededed', description: 'lifecycle managed by the web audit workflow'}
]

const LEGACY_LABELS = ['audit', 'audit:report-only']
const MANAGED_LABEL = 'audit:managed'
const LEGACY_BODY_SUFFIX = 'This is a **report-only** finding (lp-audit Phase 2, D4) -- it does not block CI or deploys. ' +
  "See the run's job log for this check's own findings output."

function gh(args) {
  return execFileSync('gh', args, {encoding: 'utf-8'})
}

function encoded(value) {
  return encodeURIComponent(value)
}

export function managedMarker(id) {
  return `<!-- audit-check-issue:v1 check-id=${encoded(id)} -->`
}

export function transitionMarker(id, transition, runUrl) {
  return `<!-- audit-check-transition:v1 check-id=${encoded(id)} state=${transition} run=${encoded(runUrl)} -->`
}

export function issueTitle(title) {
  return `[audit] ${title}`
}

export function issueBody({id}, runUrl) {
  return [
    managedMarker(id),
    '',
    `Check \`${id}\` failed.`,
    '',
    `Run: ${runUrl}`,
    '',
    LEGACY_BODY_SUFFIX
  ].join('\n')
}

function labelNames(issue) {
  return new Set((issue.labels || []).map((label) => typeof label === 'string' ? label : label.name))
}

function hasLabels(issue, required) {
  const names = labelNames(issue)
  return required.every((label) => names.has(label))
}

function hasExactMarker(issue, id) {
  return (issue.body || '').split('\n').includes(managedMarker(id))
}

/**
 * Recognize the exact body emitted before lifecycle markers were introduced.
 * This narrow migration path is what allows the existing audit issues to be
 * adopted without treating similarly titled, manually-authored issues as ours.
 */
export function isLegacyAutoFiledIssue(issue, check, repo) {
  if (issue.title !== issueTitle(check.title) || !hasLabels(issue, LEGACY_LABELS)) {
    return false
  }

  const expectedPrefix = `Check \`${check.id}\` failed.\n\nRun: `
  const body = issue.body || ''
  if (!body.startsWith(expectedPrefix) || !body.endsWith(`\n\n${LEGACY_BODY_SUFFIX}`)) {
    return false
  }

  const runUrl = body.slice(expectedPrefix.length, -(LEGACY_BODY_SUFFIX.length + 2))
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+$/.test(runUrl) &&
    new URL(runUrl).pathname.startsWith(`/${repo}/actions/runs/`)
}

export function isManagedIssue(issue, check) {
  return issue.title === issueTitle(check.title) && hasLabels(issue, [...LEGACY_LABELS, MANAGED_LABEL]) && hasExactMarker(issue, check.id)
}

export function bucketChecks(checks) {
  const buckets = new Map()
  for (const check of checks) {
    if (!check || typeof check.id !== 'string' || typeof check.title !== 'string') {
      continue
    }
    const bucket = buckets.get(check.id) || []
    bucket.push(check)
    buckets.set(check.id, bucket)
  }
  return buckets
}

export function bucketOutcome(checks) {
  if (checks.some((check) => check.outcome === 'failure')) {
    return 'failure'
  }
  if (checks.length > 0 && checks.every((check) => check.outcome === 'success')) {
    return 'success'
  }
  return 'indeterminate'
}

export function createGhClient(runGh = gh) {
  return {
    ensureLabel({name, color, description}, repo) {
      runGh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description, '--force'])
    },

    listIssues(check, repo) {
      const raw = runGh([
        'issue',
        'list',
        '--repo',
        repo,
        '--state',
        'all',
        '--label',
        'audit',
        '--search',
        `"${issueTitle(check.title)}" in:title`,
        '--json',
        'number,title,state,body,labels',
        '--limit',
        '100'
      ])
      return JSON.parse(raw)
    },

    createIssue(check, repo, runUrl) {
      runGh([
        'issue',
        'create',
        '--repo',
        repo,
        '--title',
        issueTitle(check.title),
        '--body',
        issueBody(check, runUrl),
        '--label',
        AUDIT_LABELS.map((label) => label.name).join(',')
      ])
    },

    addManagedLabel(issueNumber, repo) {
      runGh(['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', MANAGED_LABEL])
    },

    addManagedMarker(issue, check, repo) {
      runGh([
        'issue',
        'edit',
        String(issue.number),
        '--repo',
        repo,
        '--body',
        `${managedMarker(check.id)}\n\n${issue.body}`
      ])
    },

    listComments(issueNumber, repo) {
      const raw = runGh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'comments'])
      return JSON.parse(raw).comments || []
    },

    comment(issueNumber, repo, body) {
      runGh(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body])
    },

    close(issueNumber, repo) {
      runGh(['issue', 'close', String(issueNumber), '--repo', repo, '--reason', 'completed'])
    },

    reopen(issueNumber, repo) {
      runGh(['issue', 'reopen', String(issueNumber), '--repo', repo])
    }
  }
}

function stateOf(issue) {
  return String(issue.state || '').toLowerCase()
}

function commentsContain(comments, marker) {
  return comments.some((comment) => (comment.body || '').split('\n').includes(marker))
}

function transitionBody(check, transition, runUrl) {
  const recovery = transition === 'recovered'
  return [
    transitionMarker(check.id, transition, runUrl),
    '',
    recovery
      ? `Recovery confirmed: every result in audit bucket \`${check.id}\` is green.`
      : `Regression detected: audit bucket \`${check.id}\` is failing again.`,
    '',
    `Run: ${runUrl}`
  ].join('\n')
}

function ensureTransitionComment(client, issue, check, repo, runUrl, transition) {
  const marker = transitionMarker(check.id, transition, runUrl)
  const comments = client.listComments(issue.number, repo)
  if (!commentsContain(comments, marker)) {
    client.comment(issue.number, repo, transitionBody(check, transition, runUrl))
  }
}

function adoptLegacyIssue(client, issue, check, repo) {
  const originalBody = issue.body
  const originalLabels = issue.labels || []
  client.addManagedLabel(issue.number, repo)
  client.addManagedMarker(issue, check, repo)
  return {...issue, body: `${managedMarker(check.id)}\n\n${originalBody}`, labels: [...originalLabels, {name: MANAGED_LABEL}]}
}

function exactCandidates(client, check, repo) {
  return client.listIssues(check, repo).filter((issue) => issue.title === issueTitle(check.title))
}

function adoptRecognizedLegacyIssues(client, issues, check, repo) {
  return issues.map((issue) => {
    if (isManagedIssue(issue, check)) {
      return issue
    }
    if (!isLegacyAutoFiledIssue(issue, check, repo)) {
      return null
    }
    return adoptLegacyIssue(client, issue, check, repo)
  }).filter(Boolean)
}

function reconcileFailure(client, issues, check, repo, runUrl) {
  const open = issues.filter((issue) => stateOf(issue) === 'open').sort((a, b) => b.number - a.number)
  if (open.length > 0) {
    console.log(`Audit issue #${open[0].number} remains open for failing bucket "${check.id}".`)
    return
  }

  const closed = issues.filter((issue) => stateOf(issue) === 'closed').sort((a, b) => b.number - a.number)
  if (closed.length > 0) {
    const issue = closed[0]
    ensureTransitionComment(client, issue, check, repo, runUrl, 'regressed')
    client.reopen(issue.number, repo)
    console.log(`Reopened audit issue #${issue.number} for regressed bucket "${check.id}".`)
    return
  }

  client.createIssue(check, repo, runUrl)
  console.log(`Filed new issue for failing bucket "${check.id}".`)
}

function reconcileSuccess(client, issues, check, repo, runUrl) {
  const open = issues.filter((issue) => stateOf(issue) === 'open').sort((a, b) => a.number - b.number)
  if (open.length === 0) {
    console.log(`Audit bucket "${check.id}" is green; no managed issue is open.`)
    return
  }

  for (const issue of open) {
    ensureTransitionComment(client, issue, check, repo, runUrl, 'recovered')
    client.close(issue.number, repo)
    console.log(`Closed recovered audit issue #${issue.number} for bucket "${check.id}".`)
  }
}

export function reconcileCheckIssues({checks, repo, runUrl, client = createGhClient()}) {
  if (!Array.isArray(checks) || checks.length === 0) {
    console.log('No audit check results supplied -- nothing to reconcile.')
    return
  }
  if (!repo || !runUrl) {
    console.error('GH_REPO or GH_RUN_URL env var not set -- cannot reconcile audit issues; skipping.')
    return
  }

  for (const label of AUDIT_LABELS) {
    try {
      client.ensureLabel(label, repo)
    } catch (err) {
      console.warn(`Warning: could not ensure label "${label.name}": ${err.message}`)
    }
  }

  for (const [id, bucket] of bucketChecks(checks)) {
    const titles = new Set(bucket.map((check) => check.title))
    if (titles.size !== 1) {
      console.error(`Warning: audit bucket "${id}" has conflicting titles; skipping reconciliation.`)
      continue
    }

    const outcome = bucketOutcome(bucket)
    if (outcome === 'indeterminate') {
      console.log(`Audit bucket "${id}" is not wholly green or failing -- leaving its issue unchanged.`)
      continue
    }

    const check = bucket[0]
    try {
      const candidates = exactCandidates(client, check, repo)
      const managed = adoptRecognizedLegacyIssues(client, candidates, check, repo)
      if (outcome === 'failure') {
        reconcileFailure(client, managed, check, repo, runUrl)
      } else {
        reconcileSuccess(client, managed, check, repo, runUrl)
      }
    } catch (err) {
      console.error(`Warning: could not reconcile issue for audit bucket "${id}": ${err.message}`)
    }
  }
}

export function main(env = process.env) {
  let checks
  try {
    checks = JSON.parse(env.CHECK_RESULTS_JSON || '[]')
  } catch (err) {
    console.error(`Invalid CHECK_RESULTS_JSON -- cannot reconcile audit issues; skipping. ${err.message}`)
    return
  }

  reconcileCheckIssues({checks, repo: env.GH_REPO, runUrl: env.GH_RUN_URL})
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
