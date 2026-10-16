import {describe, expect, it} from 'vitest'
import {buildOracle, classifyPage, extractRendered, judgeAttempt, runKnownAnswer, WARN_AGE_MS} from '../checks/b11-check-ssr-known-answer.mjs'
import {parsePage, transitionedDomains} from '../lib/ssr-evidence.mjs'
import {type Bodies, makeBodies, makeSnapshot, NOW, type RenderOptions, renderPage} from './ssr-fixtures.ts'

const judge = (bodies: Bodies, options: RenderOptions = {}, snapshotOptions = {}) => {
  const rendered = renderPage(bodies, options)
  const snapshot = makeSnapshot(bodies, snapshotOptions)
  return judgeAttempt({a: snapshot, b: snapshot, page: parsePage(rendered.html, rendered.headers), now: NOW})
}
const ids = (result: {findings: {id: string}[]}) => result.findings.map((f) => f.id)

/** In-memory run memory with the same read/write contract as audits/lib/run-memory.mjs. */
function fakeMemory(initial: string | null, available = true) {
  const state = {value: initial, writes: [] as string[]}
  return {
    state,
    read: async () => ({available, value: available ? state.value : null}),
    write: async (value: string) => {
      state.writes.push(value)
      state.value = value
      return available
    }
  }
}

function run(bodies: Bodies, options: RenderOptions, memory = fakeMemory(null), snapshots?: () => ReturnType<typeof makeSnapshot>) {
  const snapshot = makeSnapshot(bodies)
  return runKnownAnswer({
    readSnapshotImpl: async () => (snapshots ? snapshots() : snapshot),
    fetchPageImpl: async () => renderPage(bodies, options),
    memory,
    now: () => NOW,
    delay: async () => {}
  })
}

describe('the oracle', () => {
  it('reads the six fields from raw export JSON by its own rules', () => {
    const snapshot = makeSnapshot(makeBodies())
    expect(buildOracle(snapshot.exports)).toEqual({
      heartRate: '58',
      devLogTitle: 'newest commit',
      articleTitle: 'Newest article',
      starredRepo: 'octo/cat',
      shelfTitle: 'Reading Book',
      workoutCount: 2
    })
  })

  it('pins the audit.warn ages the registry holds', () => {
    expect(WARN_AGE_MS).toEqual({
      health: 45 * 60_000,
      sleep: 12 * 3_600_000,
      workouts: 12 * 3_600_000,
      books: 7 * 86_400_000,
      articles: 7 * 86_400_000,
      githubEvents: 7 * 86_400_000,
      starredRepos: 18 * 3_600_000,
      theatreReviews: 18 * 3_600_000
    })
  })

  it('reads the same six fields back from rendered HTML', () => {
    const rendered = renderPage(makeBodies())
    expect(extractRendered(parsePage(rendered.html, rendered.headers).$)).toEqual({
      heartRate: '58',
      devLogTitle: 'newest commit',
      articleTitle: 'Newest article',
      starredRepo: 'octo/cat',
      shelfTitle: 'Reading Book',
      workoutCount: 2
    })
  })
})

describe('judgeAttempt: a correct page', () => {
  it('passes with no finding and compares all ten cards', () => {
    const result = judge(makeBodies())
    expect(result.findings).toEqual([])
    expect(result.compared).toBe(10)
    expect(result.healthyAndFresh).toBe(true)
  })

  it('accepts a stale card whose export is older than its audit.warn age', () => {
    const bodies = makeBodies()
    bodies.articles.generatedAt = new Date(NOW - 9 * 86_400_000).toISOString()
    expect(judge(bodies, {states: {cardReading: 'stale'}}).findings).toEqual([])
  })

  it('accepts an empty card only for an empty collection', () => {
    const bodies = makeBodies()
    bodies.workouts.workouts = []
    expect(judge(bodies, {states: {cardWorkouts: 'empty'}, values: {workoutCount: 0}}).findings).toEqual([])
    expect(ids(judge(makeBodies(), {states: {cardWorkouts: 'empty'}}))).toEqual(['ssr-card-state-mismatch'])
  })
})

// The five self-tests plan Step 6.8 names. Each must make the check fail.
describe('self-tests: the check fails on a broken page', () => {
  it('a wrong value', () => {
    const result = judge(makeBodies(), {values: {heartRate: '59'}})
    expect(ids(result)).toEqual(['ssr-value-mismatch'])
    expect(result.findings[0].message).toContain('"59"')
    expect(result.findings[0].message).toContain('"58"')
  })

  it('a fabricated generatedAt', () => {
    const result = judge(makeBodies(), {generatedAt: {cardDevLog: '2030-01-01T00:00:00.000Z'}})
    expect(ids(result)).toEqual(['ssr-generated-at-mismatch'])
  })

  it('a stale snapshot: the page was rendered from older exports than the data plane holds', () => {
    const older = makeBodies()
    older.githubEvents = {generatedAt: new Date(NOW - 5 * 3_600_000).toISOString(), events: [{title: 'yesterday commit'}]}
    const result = judge(makeBodies(), {}, {})
    expect(result.findings).toEqual([])
    const rendered = renderPage(older)
    const current = makeSnapshot(makeBodies())
    const stale = judgeAttempt({a: current, b: current, page: parsePage(rendered.html, rendered.headers), now: NOW})
    expect(ids(stale)).toContain('ssr-generated-at-mismatch')
    expect(ids(stale)).toContain('ssr-value-mismatch')
  })

  it('a mapper with two fields swapped', () => {
    const result = judge(makeBodies(), {values: {devLogTitle: 'Newest article', articleTitle: 'newest commit'}})
    expect(ids(result)).toEqual(['ssr-value-mismatch', 'ssr-value-mismatch'])
  })

  it('a permanently partial page: fails on the second consecutive run, never the first', async () => {
    const options = {states: {cardDevLog: 'unavailable'}, summary: 'partial'}
    const memory = fakeMemory(null)
    const first = await run(makeBodies(), options, memory)
    expect(first.outcome).toBe('indeterminate')
    expect(first.findings.map((f: {severity: string}) => f.severity)).toEqual(['warn'])
    expect(memory.state.value).toBe('partial')
    const second = await run(makeBodies(), options, memory)
    expect(second.outcome).toBe('failure')
    expect(second.findings.map((f: {id: string}) => f.id)).toEqual(['ssr-card-not-rendered'])
  })
})

describe('partial policy', () => {
  it('clears the memory after a clean run, so one blip a day never accumulates', async () => {
    const memory = fakeMemory('partial')
    const result = await run(makeBodies(), {}, memory)
    expect(result.outcome).toBe('success')
    expect(memory.state.value).toBe('clear')
  })

  it('fails at once when the memory is unavailable, because a first sighting cannot be proved', async () => {
    const result = await run(makeBodies(), {states: {cardDevLog: 'unavailable'}}, fakeMemory(null, false))
    expect(result.outcome).toBe('failure')
    expect(result.findings[0].message).toContain('run memory unavailable')
  })

  it('does not call a partial page a first sighting when an export is stale', async () => {
    const bodies = makeBodies()
    bodies.health.generatedAt = new Date(NOW - 3 * 3_600_000).toISOString()
    const result = await run(bodies, {states: {cardDevLog: 'unavailable', cardHR: 'stale', cardMovement: 'stale', cardHydration: 'stale'}}, fakeMemory(null))
    expect(result.outcome).toBe('failure')
  })

  it('treats the Worker fallback page as a partial sighting', async () => {
    const memory = fakeMemory(null)
    const fallback = await runKnownAnswer({
      readSnapshotImpl: async () => makeSnapshot(makeBodies()),
      fetchPageImpl: async () => ({status: 200, headers: new Headers({'x-ssr-data': 'fallback'}), html: '<html></html>'}),
      memory,
      now: () => NOW,
      delay: async () => {}
    })
    expect(fallback.outcome).toBe('indeterminate')
    expect(fallback.findings[0].id).toBe('ssr-fallback-served')
    expect(fallback.findings[0].severity).toBe('warn')
  })
})

describe('transition', () => {
  const moved = () => {
    const bodies = makeBodies()
    bodies.books = {...bodies.books, generatedAt: new Date(NOW - 1000).toISOString()}
    return makeSnapshot(bodies)
  }

  it('a domain whose generatedAt differs between A and B is TRANSITION', () => {
    expect(transitionedDomains(makeSnapshot(makeBodies()), moved())).toEqual(['books'])
  })

  it('a focus change makes every domain TRANSITION', () => {
    expect(transitionedDomains(makeSnapshot(makeBodies()), makeSnapshot(makeBodies(), {focus: 'Work'}))).toHaveLength(8)
  })

  it('does not judge a transitioned domain, even when its page value is wrong', () => {
    const rendered = renderPage(makeBodies(), {values: {shelfTitle: 'wrong'}})
    const result = judgeAttempt({a: makeSnapshot(makeBodies()), b: moved(), page: parsePage(rendered.html, rendered.headers), now: NOW})
    expect(result.findings).toEqual([])
    expect(result.transitioned).toEqual(['books'])
    expect(result.compared).toBe(9)
  })

  it('retries, then passes when the data settles', async () => {
    const bodies = makeBodies()
    const calls: number[] = []
    const result = await runKnownAnswer({
      readSnapshotImpl: async () => {
        calls.push(1)
        // Attempt 1 reads A then B (calls 1, 2) with a change between them. Attempt 2 is stable.
        return calls.length === 2 ? moved() : makeSnapshot(bodies)
      },
      fetchPageImpl: async () => renderPage(bodies),
      memory: fakeMemory(null),
      now: () => NOW,
      delay: async () => {}
    })
    expect(calls).toHaveLength(4)
    expect(result.outcome).toBe('success')
  })

  it('reports a persistent transition as a warning with an indeterminate outcome, never a pass', async () => {
    const bodies = makeBodies()
    let n = 0
    const result = await runKnownAnswer({
      readSnapshotImpl: async () => (n++ % 2 === 1 ? moved() : makeSnapshot(bodies)),
      fetchPageImpl: async () => renderPage(bodies),
      memory: fakeMemory(null),
      now: () => NOW,
      delay: async () => {}
    })
    expect(n).toBe(6)
    expect(result.findings.map((f: {id: string}) => f.id)).toEqual(['ssr-transition-persistent'])
    expect(result.outcome).toBe('indeterminate')
  })
})

describe('hiding', () => {
  it('passes a suppressed page with no value, when the focus mode hides', () => {
    const result = judge(makeBodies(), {hiding: true}, {focus: 'Do Not Disturb'})
    expect(result.findings).toEqual([])
    expect(result.hiding).toBe(true)
  })

  it('passes a suppressed page when the gate answers with its 403 body under a visible focus', () => {
    expect(judge(makeBodies(), {hiding: true}, {suppress: ['health']}).findings).toEqual([])
  })

  it('fails a live page while the data plane is hiding', () => {
    const result = judge(makeBodies(), {summary: 'live'}, {focus: 'Work'})
    expect(ids(result)).toContain('ssr-hiding-not-suppressed')
    expect(ids(result)).toContain('ssr-hiding-card-not-suppressed')
    expect(ids(result)).toContain('ssr-hiding-leaks-generated-at')
    expect(ids(result)).toContain('ssr-hiding-leaks-value')
  })

  it('fails a suppressed page that still renders a gated value', () => {
    const result = judge(makeBodies(), {hiding: true, leak: true}, {focus: 'Work'})
    expect(ids(result)).toContain('ssr-hiding-leaks-value')
  })
})

describe('a page that is not a server render, and an unreadable data plane', () => {
  it('fails the data-free shell by name and still counts what it held', async () => {
    const result = await run(makeBodies(), {summary: null, states: Object.fromEntries(['cardHR', 'cardDevLog'].map((id) => [id, 'loading']))})
    expect(result.findings.map((f: {id: string}) => f.id)).toEqual(['ssr-not-server-rendered'])
    expect(result.outcome).toBe('failure')
    expect(result.measured).toBe(10)
  })

  it('classifies a non-200 page and the Worker error page', () => {
    const parsed = parsePage('<html></html>', new Headers({'x-ssr-data': 'error'}))
    expect(classifyPage({status: 500}, parsed).findings[0].id).toBe('ssr-page-status')
    expect(classifyPage({status: 200}, parsed).findings[0].id).toBe('ssr-error-page')
  })

  it('measures zero and fails when the page cannot be fetched', async () => {
    const result = await runKnownAnswer({
      readSnapshotImpl: async () => makeSnapshot(makeBodies()),
      fetchPageImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
      memory: fakeMemory(null),
      now: () => NOW,
      delay: async () => {}
    })
    expect(result.measured).toBe(0)
    expect(result.outcome).toBe('failure')
  })

  it('measures zero when the page loads but the data plane is dark', async () => {
    const dark = makeSnapshot(makeBodies(), {
      unreadable: ['health', 'sleep', 'workouts', 'books', 'githubEvents', 'starredRepos', 'articles', 'theatreReviews']
    })
    dark.focus = {kind: 'unreadable', reason: 'network', mode: null, hiding: false} as never
    const result = await runKnownAnswer({
      readSnapshotImpl: async () => dark,
      fetchPageImpl: async () => renderPage(makeBodies()),
      memory: fakeMemory(null),
      now: () => NOW,
      delay: async () => {}
    })
    expect(result.measured).toBe(0)
    expect(result.outcome).toBe('indeterminate')
  })

  it('does not judge a card whose export was unreadable', () => {
    const result = judge(makeBodies(), {states: {cardWorkouts: 'unavailable'}}, {unreadable: ['workouts']})
    expect(result.findings).toEqual([])
    expect(result.compared).toBe(9)
  })
})
