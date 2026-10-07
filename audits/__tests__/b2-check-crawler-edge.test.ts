import {describe, expect, it, vi} from 'vitest'
import {BLOCK_BODY, classifyResponse, isEdge5xx, judgeProbes, parseGroups, planProbes, runProbes, userAgentFor} from '../checks/b2-check-crawler-edge.mjs'
import {GET as getRobotsTxt} from '../../src/pages/robots.txt'
import GOLDEN from '../fixtures/golden/robots-ai-crawlers.json'

const ROBOTS_URL = 'https://jonathanlloyd.me/robots.txt'

describe('parseGroups', () => {
  it('reads named groups in file order and drops the * group', () => {
    const body = 'User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /llms.txt\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n'
    expect(parseGroups(body)).toEqual([
      {agents: ['GPTBot'], allows: ['/llms.txt']},
      {agents: ['OAI-SearchBot'], allows: ['/']}
    ])
  })

  it('keeps consecutive user-agent lines in one group and starts a new group after a rule', () => {
    const body = 'User-agent: A\nUser-agent: B\nAllow: /a\nUser-agent: C\nAllow: /c\n'
    expect(parseGroups(body)).toEqual([{agents: ['A', 'B'], allows: ['/a']}, {agents: ['C'], allows: ['/c']}])
  })

  it('ignores comments and pattern Allow lines, which are not requestable URLs', () => {
    const body = '# header\nUser-agent: A # trailing\nAllow: /*.json\nAllow: /x$\nAllow: /plain\n'
    expect(parseGroups(body)).toEqual([{agents: ['A'], allows: ['/plain']}])
  })
})

describe('planProbes', () => {
  it('probes each path the served robots.txt lets a named group read, and nothing it disallows', async () => {
    const body = await getRobotsTxt().text()
    const probes = planProbes(body, ROBOTS_URL)

    // Training crawlers: /llms.txt only. The root is disallowed for them, so it is never requested.
    for (const agent of GOLDEN.aiTrainingBotsBlockedExceptLlmsTxt) {
      expect(probes.filter((p: {agent: string}) => p.agent === agent)).toEqual([{agent, path: '/llms.txt'}])
    }
    // Search and answer agents: the root and /llms.txt.
    for (const agent of GOLDEN.aiSearchAgentsAllowedFullSite) {
      expect(probes.filter((p: {agent: string}) => p.agent === agent)).toEqual([{agent, path: '/'}, {agent, path: '/llms.txt'}])
    }
    expect(probes).toHaveLength(GOLDEN.aiTrainingBotsBlockedExceptLlmsTxt.length + 2 * GOLDEN.aiSearchAgentsAllowedFullSite.length)
  })

  it('plans nothing for a robots.txt with only the * group', () => {
    expect(planProbes('User-agent: *\nAllow: /\n', ROBOTS_URL)).toEqual([])
  })
})

describe('classifyResponse', () => {
  it.each([
    // The 2026-10-07 zone block: 403 plus the 25-byte body, no site headers.
    [{status: 403, contentUsage: null, body: BLOCK_BODY}, 'blocked'],
    // Any 403 is a refusal, even one that passed through the site.
    [{status: 403, contentUsage: 'train-ai=n, search=y', body: 'Forbidden'}, 'blocked'],
    // The block body under another status is still the block.
    [{status: 200, contentUsage: null, body: `${BLOCK_BODY}\n`}, 'blocked'],
    // The site answered: its Content-Usage header is on the response.
    [{status: 200, contentUsage: 'train-ai=n, search=y', body: '# llms'}, 'reached'],
    [{status: 404, contentUsage: 'train-ai=n, search=y', body: 'not found'}, 'reached'],
    [{status: 503, contentUsage: 'train-ai=n, search=y', body: '{"suppressed":true}'}, 'reached'],
    // The edge answered for the site: a challenge or rate limit with no site header.
    [{status: 429, contentUsage: null, body: 'slow down'}, 'intercepted'],
    [{status: 200, contentUsage: null, body: '<title>Just a moment...</title>'}, 'intercepted']
  ])('%j is %s', (response, verdict) => {
    expect(classifyResponse(response)).toBe(verdict)
  })
})

describe('isEdge5xx', () => {
  it.each([
    [503, null, true],
    [522, null, true],
    [503, 'train-ai=n, search=y', false],
    [200, null, false],
    [403, null, false]
  ])('HTTP %i with Content-Usage %j retries: %s', (status, contentUsage, retry) => {
    const headers: Record<string, string> = contentUsage ? {'Content-Usage': contentUsage} : {}
    expect(isEdge5xx(new Response(null, {status, headers}))).toBe(retry)
  })
})

describe('judgeProbes', () => {
  it('fails a blocked or intercepted probe and counts every held response as measured', () => {
    const {findings, measured} = judgeProbes([
      {agent: 'ClaudeBot', path: '/llms.txt', status: 403, verdict: 'blocked'},
      {agent: 'Claude-User', path: '/', status: 200, verdict: 'reached'},
      {agent: 'GPTBot', path: '/llms.txt', status: 429, verdict: 'intercepted'}
    ])

    expect(measured).toBe(3)
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['crawler-edge-blocked', 'crawler-edge-intercepted'])
    expect(findings.every((f: {severity: string}) => f.severity === 'fail')).toBe(true)
    expect(findings[0].message).toContain('"ClaudeBot/1.0"')
  })

  it('reports an unreached probe as INDETERMINATE and does not count it, so a dark run measures 0', () => {
    const {findings, measured} = judgeProbes([{agent: 'ClaudeBot', path: '/llms.txt', error: 'fetch failed'}])

    expect(measured).toBe(0)
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'crawler-edge-indeterminate'})])
    expect(findings[0].message).toMatch(/^INDETERMINATE/)
  })

  it('names the site, not the edge, when a 403 carries the site header', () => {
    const {findings} = judgeProbes([{agent: 'ClaudeBot', path: '/llms.txt', status: 403, fromSite: true, verdict: 'blocked'}])
    expect(findings[0].message).toMatch(/^the site refused/)
  })

  it('is clean when every probe reached the site', () => {
    expect(judgeProbes([{agent: 'ClaudeBot', path: '/llms.txt', status: 200, verdict: 'reached'}])).toEqual({findings: [], measured: 1})
  })
})

describe('runProbes', () => {
  const log = () => {}

  it('presents the group token as the User-Agent and classifies each response', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).get('User-Agent') === 'ClaudeBot/1.0'
        ? new Response(BLOCK_BODY, {status: 403})
        : new Response('# llms', {headers: {'Content-Usage': 'train-ai=n, search=y'}})
    )

    const outcomes = await runProbes([{agent: 'ClaudeBot', path: '/llms.txt'}, {agent: 'Claude-User', path: '/'}], {fetchImpl, log})

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://jonathanlloyd.me/llms.txt',
      expect.objectContaining({headers: {'User-Agent': userAgentFor('ClaudeBot')}}), expect.any(Number), undefined, isEdge5xx)
    expect(outcomes).toEqual([
      {agent: 'ClaudeBot', path: '/llms.txt', status: 403, fromSite: false, verdict: 'blocked'},
      {agent: 'Claude-User', path: '/', status: 200, fromSite: true, verdict: 'reached'}
    ])
  })

  it('passes the edge-only retry rule, so a site-written 5xx is judged reached on the first answer', async () => {
    const fetchImpl = vi.fn(async (..._args: unknown[]) =>
      new Response('{"suppressed":true}', {status: 503, headers: {'Content-Usage': 'train-ai=n, search=y'}})
    )

    const outcomes = await runProbes([{agent: 'GPTBot', path: '/llms.txt'}], {fetchImpl, log})

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][4]).toBe(isEdge5xx)
    expect(outcomes).toEqual([{agent: 'GPTBot', path: '/llms.txt', status: 503, fromSite: true, verdict: 'reached'}])
  })

  it('turns a transport failure into an outcome with an error, never a pass', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })

    const outcomes = await runProbes([{agent: 'GPTBot', path: '/llms.txt'}], {fetchImpl, log})

    expect(outcomes).toEqual([{agent: 'GPTBot', path: '/llms.txt', error: 'getaddrinfo ENOTFOUND'}])
  })

  it('reports probes left after the phase budget as INDETERMINATE instead of skipping them', async () => {
    let clock = 0
    const now = () => clock
    const fetchImpl = vi.fn(async () => {
      clock += 10
      return new Response('ok', {headers: {'Content-Usage': 'train-ai=n, search=y'}})
    })

    const outcomes = await runProbes([{agent: 'A', path: '/'}, {agent: 'B', path: '/'}], {fetchImpl, budgetMs: 5, now, log})

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(outcomes[1]).toEqual(expect.objectContaining({agent: 'B', error: expect.stringContaining('phase budget already spent')}))
    expect(judgeProbes(outcomes).measured).toBe(1)
  })
})
