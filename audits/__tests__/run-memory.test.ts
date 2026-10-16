import {describe, expect, it} from 'vitest'
import {createRunMemory} from '../lib/run-memory.mjs'

const TITLE = '[audit-state] test'

/** A fake GitHub issues API holding at most one state issue. */
function fakeGithub(initialBody: string | null = null) {
  const calls: {method: string; url: string; body?: unknown}[] = []
  let issue = initialBody === null ? null : {number: 7, title: TITLE, body: initialBody}
  const fetchImpl = async (url: string, init: {method?: string; body?: string} = {}) => {
    const method = init.method ?? 'GET'
    calls.push({method, url, body: init.body ? JSON.parse(init.body) : undefined})
    if (method === 'GET') {
      return new Response(JSON.stringify(issue ? [issue] : []), {status: 200})
    }
    const payload = JSON.parse(init.body!)
    issue = {number: 7, title: TITLE, body: payload.body}
    return new Response('{}', {status: 200})
  }
  return {calls, fetchImpl: fetchImpl as unknown as typeof fetch, body: () => issue?.body ?? null}
}

const memory = (github: ReturnType<typeof fakeGithub>, extra = {}) =>
  createRunMemory({key: 'k1', title: TITLE, token: 't', repo: 'o/r', fetchImpl: github.fetchImpl, ...extra})

describe('createRunMemory', () => {
  it('is unavailable without a token or repository, and writes nothing', async () => {
    const github = fakeGithub()
    const none = createRunMemory({key: 'k1', title: TITLE, token: '', repo: '', fetchImpl: github.fetchImpl})
    expect(await none.read()).toEqual({available: false, value: null})
    expect(await none.write('partial')).toBe(false)
    expect(github.calls).toEqual([])
  })

  it('reads an absent state issue as available with no value', async () => {
    expect(await memory(fakeGithub()).read()).toEqual({available: true, value: null})
  })

  it('creates the state issue on the first write, then updates it in place', async () => {
    const github = fakeGithub()
    const mem = memory(github)
    expect(await mem.write('partial')).toBe(true)
    expect(github.calls.at(-1)).toMatchObject({method: 'POST', body: {title: TITLE, labels: ['audit:state']}})
    expect(await mem.read()).toEqual({available: true, value: 'partial'})
    expect(await mem.write('clear')).toBe(true)
    expect(github.calls.at(-1)).toMatchObject({method: 'PATCH'})
    expect(await mem.read()).toEqual({available: true, value: 'clear'})
  })

  it('ignores a marker written for another key', async () => {
    const github = fakeGithub('<!-- audit-run-memory:v1 key=other value=partial -->')
    expect(await memory(github).read()).toEqual({available: true, value: null})
  })

  it('reports an API failure as unavailable, never as a clean slate', async () => {
    const failing = (async () => new Response('{}', {status: 500})) as unknown as typeof fetch
    const mem = createRunMemory({key: 'k1', title: TITLE, token: 't', repo: 'o/r', fetchImpl: failing})
    expect(await mem.read()).toEqual({available: false, value: null})
    expect(await mem.write('partial')).toBe(false)
  })
})
