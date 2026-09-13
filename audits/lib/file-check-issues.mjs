// Reconcile one GitHub issue per audit check id. A failed bucket creates or
// reopens its managed issue; a wholly green bucket gets one recovery comment
// and closes it. Unknown, skipped, or partially green buckets never close.
//
// The workflow injects the authenticated Octokit client through
// actions/github-script. No runner-local `gh` binary is required.

export const AUDIT_LABELS = [
  {name: 'audit', color: 'ededed', description: 'lp-audit finding'},
  {name: 'audit:report-only', color: 'ededed', description: 'report-only (non-blocking) audit finding'},
  {name: 'audit:managed', color: 'ededed', description: 'lifecycle managed by the web audit workflow'}
]

const LEGACY_LABELS = ['audit', 'audit:report-only']
const MANAGED_LABEL = 'audit:managed'
const LEGACY_BODY_SUFFIX = 'This is a **report-only** finding (lp-audit Phase 2, D4) -- it does not block CI or deploys. ' +
  "See the run's job log for this check's own findings output."

function encoded(value) {
  return encodeURIComponent(value)
}

function repoParts(repo) {
  const [owner, name] = String(repo).split('/')
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repository name: ${repo}`)
  }
  return {owner, repo: name}
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

export function createGithubClient(github) {
  return {
    async ensureLabel(label, repo) {
      const coordinates = repoParts(repo)
      try {
        await github.rest.issues.getLabel({...coordinates, name: label.name})
        await github.rest.issues.updateLabel({...coordinates, name: label.name, new_name: label.name, color: label.color, description: label.description})
      } catch (error) {
        if (error?.status !== 404) {
          throw error
        }
        await github.rest.issues.createLabel({...coordinates, ...label})
      }
    },

    async listIssues(_check, repo) {
      const coordinates = repoParts(repo)
      const response = await github.rest.issues.listForRepo({...coordinates, state: 'all', labels: 'audit', per_page: 100})
      return response.data.filter((issue) => !issue.pull_request)
    },

    async createIssue(check, repo, runUrl) {
      await github.rest.issues.create({
        ...repoParts(repo),
        title: issueTitle(check.title),
        body: issueBody(check, runUrl),
        labels: AUDIT_LABELS.map((label) => label.name)
      })
    },

    async addManagedLabel(issueNumber, repo) {
      await github.rest.issues.addLabels({...repoParts(repo), issue_number: issueNumber, labels: [MANAGED_LABEL]})
    },

    async addManagedMarker(issue, check, repo) {
      await github.rest.issues.update({...repoParts(repo), issue_number: issue.number, body: `${managedMarker(check.id)}\n\n${issue.body}`})
    },

    async listComments(issueNumber, repo) {
      const response = await github.rest.issues.listComments({...repoParts(repo), issue_number: issueNumber, per_page: 100})
      return response.data
    },

    async comment(issueNumber, repo, body) {
      await github.rest.issues.createComment({...repoParts(repo), issue_number: issueNumber, body})
    },

    async close(issueNumber, repo) {
      await github.rest.issues.update({...repoParts(repo), issue_number: issueNumber, state: 'closed', state_reason: 'completed'})
    },

    async reopen(issueNumber, repo) {
      await github.rest.issues.update({...repoParts(repo), issue_number: issueNumber, state: 'open'})
    }
  }
}

export function createDryRunClient(seed = {}) {
  const issues = structuredClone(seed.issues || [])
  const comments = new Map(Object.entries(seed.comments || {}).map(([number, values]) => [Number(number), structuredClone(values)]))
  const labels = new Map()
  const calls = []

  const record = (op, details = {}) => calls.push({op, ...details})
  const find = (issueNumber) => {
    const issue = issues.find((candidate) => candidate.number === issueNumber)
    if (!issue) {
      throw new Error(`missing dry-run issue #${issueNumber}`)
    }
    return issue
  }

  return {
    issues,
    comments,
    labels,
    calls,
    async ensureLabel(label) {
      record('ensureLabel', {name: label.name})
      labels.set(label.name, {...label})
    },
    async listIssues() {
      record('listIssues')
      return issues
    },
    async createIssue(check, _repo, runUrl) {
      record('createIssue')
      issues.push({
        number: Math.max(0, ...issues.map(({number}) => number)) + 1,
        title: issueTitle(check.title),
        state: 'OPEN',
        body: issueBody(check, runUrl),
        labels: AUDIT_LABELS.map(({name}) => ({name}))
      })
    },
    async addManagedLabel(issueNumber) {
      record('addManagedLabel', {issueNumber})
      find(issueNumber).labels.push({name: MANAGED_LABEL})
    },
    async addManagedMarker(issue, check) {
      record('addManagedMarker', {issueNumber: issue.number})
      issue.body = `${managedMarker(check.id)}\n\n${issue.body}`
    },
    async listComments(issueNumber) {
      record('listComments', {issueNumber})
      return comments.get(issueNumber) || []
    },
    async comment(issueNumber, _repo, body) {
      record('comment', {issueNumber, body})
      comments.set(issueNumber, [...(comments.get(issueNumber) || []), {body}])
    },
    async close(issueNumber) {
      record('close', {issueNumber})
      find(issueNumber).state = 'CLOSED'
    },
    async reopen(issueNumber) {
      record('reopen', {issueNumber})
      find(issueNumber).state = 'OPEN'
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

async function ensureTransitionComment(client, issue, check, repo, runUrl, transition) {
  const marker = transitionMarker(check.id, transition, runUrl)
  const comments = await client.listComments(issue.number, repo)
  if (!commentsContain(comments, marker)) {
    await client.comment(issue.number, repo, transitionBody(check, transition, runUrl))
  }
}

async function adoptLegacyIssue(client, issue, check, repo) {
  const originalBody = issue.body
  const originalLabels = issue.labels || []
  await client.addManagedLabel(issue.number, repo)
  await client.addManagedMarker(issue, check, repo)
  return {...issue, body: `${managedMarker(check.id)}\n\n${originalBody}`, labels: [...originalLabels, {name: MANAGED_LABEL}]}
}

async function adoptRecognizedLegacyIssues(client, issues, check, repo) {
  const adopted = []
  for (const issue of issues) {
    if (isManagedIssue(issue, check)) {
      adopted.push(issue)
    } else if (isLegacyAutoFiledIssue(issue, check, repo)) {
      adopted.push(await adoptLegacyIssue(client, issue, check, repo))
    }
  }
  return adopted
}

async function reconcileFailure(client, issues, check, repo, runUrl) {
  const open = issues.filter((issue) => stateOf(issue) === 'open').sort((a, b) => b.number - a.number)
  if (open.length > 0) {
    console.log(`Audit issue #${open[0].number} remains open for failing bucket "${check.id}".`)
    return
  }

  const closed = issues.filter((issue) => stateOf(issue) === 'closed').sort((a, b) => b.number - a.number)
  if (closed.length > 0) {
    const issue = closed[0]
    await ensureTransitionComment(client, issue, check, repo, runUrl, 'regressed')
    await client.reopen(issue.number, repo)
    console.log(`Reopened audit issue #${issue.number} for regressed bucket "${check.id}".`)
    return
  }

  await client.createIssue(check, repo, runUrl)
  console.log(`Filed new issue for failing bucket "${check.id}".`)
}

async function reconcileSuccess(client, issues, check, repo, runUrl) {
  const open = issues.filter((issue) => stateOf(issue) === 'open').sort((a, b) => a.number - b.number)
  if (open.length === 0) {
    console.log(`Audit bucket "${check.id}" is green; no managed issue is open.`)
    return
  }

  for (const issue of open) {
    await ensureTransitionComment(client, issue, check, repo, runUrl, 'recovered')
    await client.close(issue.number, repo)
    console.log(`Closed recovered audit issue #${issue.number} for bucket "${check.id}".`)
  }
}

export async function reconcileCheckIssues({checks, repo, runUrl, client}) {
  if (!Array.isArray(checks) || checks.length === 0) {
    console.log('No audit check results supplied -- nothing to reconcile.')
    return
  }
  if (!repo || !runUrl || !client) {
    console.error('Repository, run URL, or GitHub client missing -- cannot reconcile audit issues; skipping.')
    return
  }

  for (const label of AUDIT_LABELS) {
    try {
      await client.ensureLabel(label, repo)
    } catch (error) {
      console.warn(`Warning: could not ensure label "${label.name}": ${error.message}`)
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
      const candidates = (await client.listIssues(check, repo)).filter((issue) => issue.title === issueTitle(check.title))
      const managed = await adoptRecognizedLegacyIssues(client, candidates, check, repo)
      if (outcome === 'failure') {
        await reconcileFailure(client, managed, check, repo, runUrl)
      } else {
        await reconcileSuccess(client, managed, check, repo, runUrl)
      }
    } catch (error) {
      console.error(`Warning: could not reconcile issue for audit bucket "${id}": ${error.message}`)
    }
  }
}
