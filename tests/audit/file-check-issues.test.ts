import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  AUDIT_LABELS,
  bucketOutcome,
  createGhClient,
  issueBody,
  issueTitle,
  managedMarker,
  reconcileCheckIssues,
  transitionMarker
} from '../../scripts/audit/lib/file-check-issues.mjs'

type Label = {name: string}
type Issue = {number: number; title: string; state: string; body: string; labels: Label[]}
type Comment = {body: string}
type Check = {id: string; title: string; outcome: string}

const REPO = 'j0nathan-ll0yd/j0nathan-ll0yd.github.io'
const RUN_1 = `https://github.com/${REPO}/actions/runs/200`
const RUN_2 = `https://github.com/${REPO}/actions/runs/201`
const FEEDS = {id: 'feeds', title: 'B2 feed.xml/feed.json validator'}

function loadIssues(name: string): Issue[] {
  const path = resolve(`tests/audit/fixtures/file-check-issues/${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function managedIssue(number: number, check = FEEDS, state = 'OPEN'): Issue {
  return {number, title: issueTitle(check.title), state, body: issueBody(check, RUN_1), labels: AUDIT_LABELS.map(({name}) => ({name}))}
}

class FixtureClient {
  issues: Issue[]
  comments = new Map<number, Comment[]>()
  calls: Array<{op: string; issueNumber?: number; body?: string}> = []
  failures = new Map<string, number>()

  constructor(issues: Issue[] = []) {
    this.issues = structuredClone(issues)
  }

  failNext(op: string, count = 1) {
    this.failures.set(op, count)
  }

  called(op: string) {
    return this.calls.filter((call) => call.op === op)
  }

  record(op: string, details: {issueNumber?: number; body?: string} = {}) {
    this.calls.push({op, ...details})
    const remaining = this.failures.get(op) || 0
    if (remaining > 0) {
      this.failures.set(op, remaining - 1)
      throw new Error(`fixture ${op} failure`)
    }
  }

  find(issueNumber: number) {
    const issue = this.issues.find(({number}) => number === issueNumber)
    if (!issue) {
      throw new Error(`missing fixture issue #${issueNumber}`)
    }
    return issue
  }

  ensureLabel() {
    this.record('ensureLabel')
  }

  listIssues() {
    this.record('listIssues')
    return this.issues
  }

  createIssue(check: Check, _repo: string, runUrl: string) {
    this.record('createIssue')
    this.issues.push({
      number: Math.max(0, ...this.issues.map(({number}) => number)) + 1,
      title: issueTitle(check.title),
      state: 'OPEN',
      body: issueBody(check, runUrl),
      labels: AUDIT_LABELS.map(({name}) => ({name}))
    })
  }

  addManagedLabel(issueNumber: number) {
    this.record('addManagedLabel', {issueNumber})
    this.find(issueNumber).labels.push({name: 'audit:managed'})
  }

  addManagedMarker(issue: Issue, check: Check) {
    this.record('addManagedMarker', {issueNumber: issue.number})
    issue.body = `${managedMarker(check.id)}\n\n${issue.body}`
  }

  listComments(issueNumber: number) {
    this.record('listComments', {issueNumber})
    return this.comments.get(issueNumber) || []
  }

  comment(issueNumber: number, _repo: string, body: string) {
    this.record('comment', {issueNumber, body})
    this.comments.set(issueNumber, [...(this.comments.get(issueNumber) || []), {body}])
  }

  close(issueNumber: number) {
    this.record('close', {issueNumber})
    this.find(issueNumber).state = 'CLOSED'
  }

  reopen(issueNumber: number) {
    this.record('reopen', {issueNumber})
    this.find(issueNumber).state = 'OPEN'
  }
}

function reconcile(client: FixtureClient, checks: Check[], runUrl = RUN_2) {
  reconcileCheckIssues({checks, repo: REPO, runUrl, client})
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('audit bucket outcomes', () => {
  it('requires every result to be green and lets any failure dominate a mixed bucket', () => {
    expect(bucketOutcome([{outcome: 'success'}, {outcome: 'success'}])).toBe('success')
    expect(bucketOutcome([{outcome: 'success'}, {outcome: 'failure'}])).toBe('failure')
    expect(bucketOutcome([{outcome: 'success'}, {outcome: 'skipped'}])).toBe('indeterminate')
    expect(bucketOutcome([{outcome: 'cancelled'}])).toBe('indeterminate')
  })
})

describe('failure lifecycle', () => {
  it('files a marker-and-label-owned issue without touching manual or unrelated collisions', () => {
    const client = new FixtureClient(loadIssues('manual-collisions'))

    reconcile(client, [{...FEEDS, outcome: 'failure'}])

    expect(client.called('createIssue')).toHaveLength(1)
    expect(client.issues).toHaveLength(4)
    expect(client.issues.slice(0, 3).map(({state}) => state)).toEqual(['OPEN', 'OPEN', 'OPEN'])
    const created = client.issues[3]
    expect(created.body.split('\n')).toContain(managedMarker(FEEDS.id))
    expect(created.labels.map(({name}) => name)).toEqual(['audit', 'audit:report-only', 'audit:managed'])
  })

  it('is idempotent on repeated failures and does not append failure comments', () => {
    const client = new FixtureClient()
    const checks = [{...FEEDS, outcome: 'failure'}]

    reconcile(client, checks, RUN_1)
    reconcile(client, checks, RUN_2)

    expect(client.called('createIssue')).toHaveLength(1)
    expect(client.called('comment')).toHaveLength(0)
    expect(client.issues).toHaveLength(1)
    expect(client.issues[0].state).toBe('OPEN')
  })
})

describe('recovery lifecycle', () => {
  it('does not close manually-authored, wrong-marker, or merely similarly titled issues', () => {
    const client = new FixtureClient(loadIssues('manual-collisions'))

    reconcile(client, [{...FEEDS, outcome: 'success'}])

    expect(client.issues.map(({state}) => state)).toEqual(['OPEN', 'OPEN', 'OPEN'])
    expect(client.called('comment')).toHaveLength(0)
    expect(client.called('close')).toHaveLength(0)
  })

  it('strictly adopts a known legacy auto-filed issue, comments recovery, and then closes it', () => {
    const client = new FixtureClient(loadIssues('legacy-open'))

    reconcile(client, [{...FEEDS, outcome: 'success'}])

    const issue = client.find(169)
    expect(issue.labels.map(({name}) => name)).toContain('audit:managed')
    expect(issue.body.split('\n')).toContain(managedMarker(FEEDS.id))
    expect(client.called('comment')[0].body).toContain('Recovery confirmed')
    expect(client.called('comment')[0].body).toContain(transitionMarker(FEEDS.id, 'recovered', RUN_2))
    expect(issue.state).toBe('CLOSED')
  })

  it('does nothing on repeated recovery after the managed issue is closed', () => {
    const client = new FixtureClient(loadIssues('managed-open'))
    const checks = [{...FEEDS, outcome: 'success'}]

    reconcile(client, checks, RUN_1)
    reconcile(client, checks, RUN_2)

    expect(client.called('comment')).toHaveLength(1)
    expect(client.called('close')).toHaveLength(1)
    expect(client.find(21).state).toBe('CLOSED')
  })

  it('reopens a future regression with one useful transition comment and no repeated-failure spam', () => {
    const client = new FixtureClient([managedIssue(41)])

    reconcile(client, [{...FEEDS, outcome: 'success'}], RUN_1)
    reconcile(client, [{...FEEDS, outcome: 'failure'}], RUN_2)
    reconcile(client, [{...FEEDS, outcome: 'failure'}], RUN_2)

    expect(client.find(41).state).toBe('OPEN')
    expect(client.called('reopen')).toHaveLength(1)
    expect(client.called('comment')).toHaveLength(2)
    expect(client.called('comment')[1].body).toContain('Regression detected')
    expect(client.called('comment')[1].body).toContain(transitionMarker(FEEDS.id, 'regressed', RUN_2))
  })
})

describe('mixed and incomplete results', () => {
  it('keeps a partially failing bucket open while independently closing an all-green bucket', () => {
    const analytics = {id: 'analytics', title: 'B6 analytics beacons (CF + SA)'}
    const client = new FixtureClient([managedIssue(51), managedIssue(52, analytics)])

    reconcile(client, [
      {...FEEDS, outcome: 'success'},
      {...FEEDS, outcome: 'failure'},
      {...analytics, outcome: 'success'}
    ])

    expect(client.find(51).state).toBe('OPEN')
    expect(client.comments.get(51)).toBeUndefined()
    expect(client.find(52).state).toBe('CLOSED')
    expect(client.comments.get(52)?.[0].body).toContain('Recovery confirmed')
  })

  it('leaves a success-plus-skipped bucket unchanged because it is not wholly green', () => {
    const client = new FixtureClient([managedIssue(61)])

    reconcile(client, [{...FEEDS, outcome: 'success'}, {...FEEDS, outcome: 'skipped'}])

    expect(client.find(61).state).toBe('OPEN')
    expect(client.called('listIssues')).toHaveLength(0)
    expect(client.called('close')).toHaveLength(0)
  })
})

describe('API failure safety', () => {
  it('does not close when the recovery comment fails and continues reconciling later buckets', () => {
    const analytics = {id: 'analytics', title: 'B6 analytics beacons (CF + SA)'}
    const client = new FixtureClient([managedIssue(71)])
    client.failNext('comment')

    reconcile(client, [{...FEEDS, outcome: 'success'}, {...analytics, outcome: 'failure'}])

    expect(client.find(71).state).toBe('OPEN')
    expect(client.called('close')).toHaveLength(0)
    expect(client.issues.some(({title}) => title === issueTitle(analytics.title))).toBe(true)
  })

  it('retries a failed close without duplicating the already-recorded recovery comment', () => {
    const client = new FixtureClient([managedIssue(72)])
    client.failNext('close')

    reconcile(client, [{...FEEDS, outcome: 'success'}], RUN_1)
    reconcile(client, [{...FEEDS, outcome: 'success'}], RUN_1)

    expect(client.find(72).state).toBe('CLOSED')
    expect(client.called('comment')).toHaveLength(1)
    expect(client.called('close')).toHaveLength(2)
  })

  it('retries a failed reopen without duplicating the already-recorded regression comment', () => {
    const client = new FixtureClient([managedIssue(73, FEEDS, 'CLOSED')])
    client.failNext('reopen')

    reconcile(client, [{...FEEDS, outcome: 'failure'}], RUN_2)
    reconcile(client, [{...FEEDS, outcome: 'failure'}], RUN_2)

    expect(client.find(73).state).toBe('OPEN')
    expect(client.called('comment')).toHaveLength(1)
    expect(client.called('reopen')).toHaveLength(2)
  })

  it('never closes a legacy issue unless both managed ownership mutations succeed', () => {
    const client = new FixtureClient(loadIssues('legacy-open'))
    client.failNext('addManagedMarker')

    reconcile(client, [{...FEEDS, outcome: 'success'}])

    expect(client.find(169).state).toBe('OPEN')
    expect(client.called('comment')).toHaveLength(0)
    expect(client.called('close')).toHaveLength(0)
  })
})

describe('gh command adapter', () => {
  it('searches all issue states and creates issues with every ownership label', () => {
    const commands: string[][] = []
    const client = createGhClient((args: string[]) => {
      commands.push(args)
      return args[0] === 'issue' && args[1] === 'list' ? '[]' : ''
    })

    client.listIssues(FEEDS, REPO)
    client.createIssue(FEEDS, REPO, RUN_1)

    expect(commands[0]).toEqual(expect.arrayContaining(['--state', 'all', '--label', 'audit']))
    expect(commands[0]).toEqual(expect.arrayContaining(['--json', 'number,title,state,body,labels']))
    expect(commands[1]).toEqual(expect.arrayContaining(['--label', 'audit,audit:report-only,audit:managed']))
    expect(commands[1].join('\n')).toContain(managedMarker(FEEDS.id))
  })
})
