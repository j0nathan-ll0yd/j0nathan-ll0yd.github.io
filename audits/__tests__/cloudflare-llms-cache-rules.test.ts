import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import accountRequest400 from './fixtures/cloudflare-cache-rules/account-http_request_cache_settings.400.json'
import accountResponse400 from './fixtures/cloudflare-cache-rules/account-http_response_cache_settings.400.json'
import auth403 from './fixtures/cloudflare-cache-rules/auth.403.json'
import pageRulesAccountToken400 from './fixtures/cloudflare-cache-rules/page-rules-account-token.400.json'
import pageRulesEmpty200 from './fixtures/cloudflare-cache-rules/page-rules-empty.200.json'
import zoneRequest200 from './fixtures/cloudflare-cache-rules/zone-request-entrypoint.200.json'
import zoneResponse404 from './fixtures/cloudflare-cache-rules/zone-response-entrypoint.404.json'
import {
  auditCloudflareLlmsCacheRules,
  CLOUDFLARE_FEED_TARGETS,
  CLOUDFLARE_GATED_TARGETS,
  CLOUDFLARE_LLMS_TARGETS,
  evaluateCloudflareLlmsCacheRules,
  expressionApplicability,
  measurementDeclaration,
  runCloudflareLlmsCacheRuleCli
} from '../checks/b2-check-cloudflare-llms-cache-rules.mjs'

const scratchDirectories: string[] = []

const ENTRYPOINT_NOT_FOUND_BODY = zoneResponse404.body

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe('Cloudflare cache-rule expression applicability', () => {
  it('evaluates exact, set, function, boolean, and disjoint path expressions', () => {
    const target = CLOUDFLARE_LLMS_TARGETS[0]
    expect(expressionApplicability('true', target)).toBe('matches')
    expect(expressionApplicability('http.host eq "jonathanlloyd.me" and http.request.uri.path eq "/llms.txt"', target)).toBe('matches')
    expect(expressionApplicability('http.request.uri.path in {"/llms.txt" "/index.md"}', target)).toBe('matches')
    expect(expressionApplicability('http.request.uri.path not in {"/assets/app.js"}', target)).toBe('matches')
    expect(expressionApplicability('starts_with(http.request.uri.path, "/assets/")', target)).toBe('disjoint')
    expect(expressionApplicability('http.request.uri.path eq "/assets/app.js" or http.host eq "example.com"', target)).toBe('disjoint')
  })

  it('fails closed when an expression uses unsupported request state', () => {
    expect(expressionApplicability('cf.bot_management.score gt 20', CLOUDFLARE_LLMS_TARGETS[0])).toBe('unknown')
    expect(expressionApplicability('cf.bot_management.score not in {1 2}', CLOUDFLARE_LLMS_TARGETS[0])).toBe('unknown')
  })
})

// covers: llms-txt#Canonical llms responses always pass through the privacy gate
describe('Cloudflare llms cache-rule evaluation', () => {
  it('fails applicable Edge TTL, response no-store removal, Page Rule, and unsafe cache-key overrides', () => {
    const evaluation = evaluateCloudflareLlmsCacheRules({
      zoneRequestRules: [
        {
          id: 'edge',
          enabled: true,
          action: 'set_cache_settings',
          expression: 'http.request.uri.path eq "/llms.txt"',
          action_parameters: {edge_ttl: {mode: 'override_origin', default: 3600}}
        },
        {
          id: 'key',
          enabled: true,
          action: 'set_cache_settings',
          expression: 'http.request.uri.path eq "/index.md"',
          action_parameters: {cache_key: {custom_key: {header: {include: ['accept-language']}}}}
        },
        {
          id: 'status-ttl',
          enabled: true,
          action: 'set_cache_settings',
          expression: 'http.request.uri.path eq "/llms-full.txt"',
          action_parameters: {edge_ttl: {mode: 'respect_origin', status_code_ttl: [{status_code_range: {to: 299}, value: 600}]}}
        }
      ],
      zoneResponseRules: [
        {
          id: 'response',
          enabled: true,
          action: 'set_cache_control',
          expression: 'http.request.uri.path eq "/llms-full.txt"',
          action_parameters: {'no-store': {operation: 'remove'}}
        }
      ],
      pageRules: [{
        id: 'page',
        status: 'active',
        targets: [{target: 'url', constraint: {value: 'https://jonathanlloyd.me/llms*'}}],
        actions: [{id: 'edge_cache_ttl', value: 7200}, {id: 'explicit_cache_control', value: 'off'}]
      }]
    })

    expect(evaluation.status).toBe('failed')
    expect(evaluation.results.map(({id}) => id)).toEqual(expect.arrayContaining([
      'zone-cache-rule-edge',
      'zone-cache-rule-key',
      'zone-cache-rule-status-ttl',
      'zone-cache-response-rule-response',
      'page-rule-page'
    ]))
  })

  // Atlas decision 0160 PR 0b: the feeds are gated paths, and a catch-all rule
  // over every non-trio path stored them ahead of the Pages Function (Age up to 796 s on 2026-10-08).
  it('judges both feed URLs, and reports the rule mode and TTL for a catch-all non-trio Edge TTL rule', () => {
    expect(CLOUDFLARE_FEED_TARGETS).toEqual(['https://jonathanlloyd.me/feed.xml', 'https://jonathanlloyd.me/feed.json'])
    expect(CLOUDFLARE_GATED_TARGETS).toEqual([...CLOUDFLARE_LLMS_TARGETS, ...CLOUDFLARE_FEED_TARGETS])

    const evaluation = evaluateCloudflareLlmsCacheRules({
      zoneRequestRules: [{
        id: 'catch-all',
        enabled: true,
        action: 'set_cache_settings',
        expression: 'not (http.request.uri.path in {"/llms.txt" "/llms-full.txt" "/index.md"})',
        action_parameters: {cache: true, edge_ttl: {mode: 'override_origin', default: 7200}}
      }]
    })

    expect(evaluation.status).toBe('failed')
    const failed = evaluation.results.filter(({status}) => status === 'failed')
    expect(failed.map(({target}) => target).sort()).toEqual([...CLOUDFLARE_FEED_TARGETS].sort())
    for (const result of failed) {
      expect(result.evidence).toContain('mode=override_origin, ttl=7200s')
    }
  })

  it('passes disabled, disjoint, and origin-respecting rules', () => {
    const evaluation = evaluateCloudflareLlmsCacheRules({
      zoneRequestRules: [
        {id: 'disabled', enabled: false, action: 'set_cache_settings', expression: 'true', action_parameters: {edge_ttl: {mode: 'override_origin'}}},
        {
          id: 'assets',
          enabled: true,
          action: 'set_cache_settings',
          expression: 'starts_with(http.request.uri.path, "/assets/")',
          action_parameters: {edge_ttl: {mode: 'override_origin'}}
        },
        {
          id: 'respect',
          enabled: true,
          action: 'set_cache_settings',
          expression: 'true',
          action_parameters: {cache: true, edge_ttl: {mode: 'respect_origin'}}
        }
      ],
      pageRules: [{
        id: 'respect-browser',
        status: 'active',
        targets: [{target: 'url', constraint: {value: 'https://jonathanlloyd.me/*'}}],
        actions: [{id: 'browser_cache_ttl', value: 0}]
      }]
    })

    expect(evaluation.status).toBe('passed')
    expect(evaluation.results).toHaveLength(1)
  })

  it('classifies unsupported applicability and incomplete API transport as unknown', () => {
    const evaluation = evaluateCloudflareLlmsCacheRules({
      accountRequestRules: [{
        id: 'conditional',
        action: 'set_cache_settings',
        expression: 'cf.bot_management.score gt 20',
        action_parameters: {edge_ttl: {mode: 'override_origin'}}
      }],
      gaps: [{id: 'cloudflare-pageRules-unavailable', evidence: 'HTTP 403'}]
    })
    expect(evaluation.status).toBe('unknown')
    expect(evaluation.results.every(({status}) => status === 'unknown')).toBe(true)
  })
})

describe('Cloudflare cache-rule API audit', () => {
  it('uses only the five allowed GET endpoints and treats absent rulesets as empty', async () => {
    const requests: Array<{url: string; init: RequestInit}> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({url, init})
      if (url.includes('/pagerules?')) {
        return new Response(JSON.stringify({success: true, result: [], result_info: {total_pages: 1}}), {status: 200})
      }
      return new Response(JSON.stringify(ENTRYPOINT_NOT_FOUND_BODY), {status: 404})
    })

    const evidence = await auditCloudflareLlmsCacheRules({
      accountId: 'account-id-do-not-print',
      zoneId: 'zone-id-do-not-print',
      apiToken: 'do-not-print',
      fetchImpl,
      observedAt: '2026-08-29T22:00:00.000Z'
    })
    expect(evidence.status).toBe('passed')
    expect(requests).toHaveLength(5)
    expect(requests.every(({init}) => init.method === 'GET')).toBe(true)
    expect(requests.every(({url}) => !/purge|trace/i.test(url))).toBe(true)
    expect(JSON.stringify(evidence)).not.toContain('do-not-print')
    // The evidence names every judged URL, the two feeds included.
    expect(evidence.targets).toEqual([...CLOUDFLARE_GATED_TARGETS])
  })

  it('names every judged URL even when the run cannot start (missing credential)', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'cloudflare-llms-rules-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'evidence.json')

    const exitCode = await runCloudflareLlmsCacheRuleCli({
      arguments_: ['--evidence-out', outputPath],
      environment: {},
      fetchImpl: vi.fn(),
      now: () => new Date('2026-10-08T00:00:00.000Z'),
      logger: {log: vi.fn(), error: vi.fn()}
    })

    const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(exitCode).toBe(1)
    expect(evidence.targets).toEqual([...CLOUDFLARE_GATED_TARGETS])
  })

  it('judges a Page Rule over the feeds and reports it in the evidence', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/pagerules?')) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [{
              id: 'feeds',
              status: 'active',
              targets: [{target: 'url', constraint: {value: 'https://jonathanlloyd.me/feed.*'}}],
              actions: [{id: 'edge_cache_ttl', value: 7200}]
            }],
            result_info: {total_pages: 1}
          }),
          {status: 200}
        )
      }
      return new Response(JSON.stringify(ENTRYPOINT_NOT_FOUND_BODY), {status: 404})
    })

    const evidence = await auditCloudflareLlmsCacheRules({accountId: 'a', zoneId: 'z', apiToken: 't', fetchImpl, observedAt: '2026-10-08T00:00:00.000Z'})

    expect(evidence.status).toBe('failed')
    const failed = evidence.results.filter(({status}: {status: string}) => status === 'failed')
    expect(failed.map(({target}: {target: string}) => target).sort()).toEqual([...CLOUDFLARE_FEED_TARGETS].sort())
    expect(failed.every(({id}: {id: string}) => id === 'page-rule-feeds')).toBe(true)
  })

  it('writes unknown evidence and exits nonzero when read permission is incomplete', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'cloudflare-llms-rules-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'evidence.json')
    const githubOutputPath = join(scratch, 'github-output.txt')
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({success: false, errors: [{message: 'permission denied for secret-token and account-id'}]}), {status: 403})
    )

    const exitCode = await runCloudflareLlmsCacheRuleCli({
      arguments_: ['--evidence-out', outputPath],
      environment: {
        CLOUDFLARE_ACCOUNT_ID: 'account-id',
        CLOUDFLARE_ZONE_ID: 'zone-id',
        CLOUDFLARE_API_TOKEN: 'secret-token',
        GITHUB_OUTPUT: githubOutputPath
      },
      fetchImpl,
      now: () => new Date('2026-08-29T22:00:00.000Z'),
      logger: {log: vi.fn(), error: vi.fn()}
    })

    const evidence = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(exitCode).toBe(1)
    expect(evidence.status).toBe('unknown')
    expect(evidence.results).not.toHaveLength(0)
    expect(evidence.targets).toEqual([...CLOUDFLARE_GATED_TARGETS])
    expect(JSON.stringify(evidence)).not.toContain('secret-token')
    expect(JSON.stringify(evidence)).not.toContain('account-id')
    expect(JSON.stringify(evidence)).not.toContain('zone-id')
    // Five refusals measured nothing, so the step publishes the real count, 0, which wedges
    // the tier. It is never waived as `deferred`.
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\nmeasured=0\n')
  })

  it.each([
    ['passed', 'success'],
    ['failed', 'failure']
  ])('writes the %s managed-issue outcome after evidence', async (status, issueOutcome) => {
    const scratch = await mkdtemp(join(tmpdir(), 'cloudflare-llms-rules-'))
    scratchDirectories.push(scratch)
    const outputPath = join(scratch, 'evidence.json')
    const githubOutputPath = join(scratch, 'github-output.txt')
    const result = status === 'passed'
      ? []
      : [{
        id: 'conflict',
        enabled: true,
        action: 'set_cache_settings',
        expression: 'true',
        action_parameters: {cache: true, edge_ttl: {mode: 'override_origin'}}
      }]
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/pagerules?')) {
        return new Response(JSON.stringify({success: true, result: [], result_info: {total_pages: 1}}))
      }
      return new Response(JSON.stringify({success: true, result: {rules: result}}))
    })

    const exitCode = await runCloudflareLlmsCacheRuleCli({
      arguments_: ['--evidence-out', outputPath],
      environment: {CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_ZONE_ID: 'zone', CLOUDFLARE_API_TOKEN: 'token', GITHUB_OUTPUT: githubOutputPath},
      fetchImpl,
      now: () => new Date('2026-08-29T22:00:00.000Z'),
      logger: {log: vi.fn(), error: vi.fn()}
    })

    expect(exitCode).toBe(status === 'passed' ? 0 : 1)
    expect(JSON.parse(await readFile(outputPath, 'utf8')).status).toBe(status)
    // All five reads answered, so the channel has landed and the count is the declaration.
    // A `failed` verdict still measured 5: `measured` counts artifacts held and judged, not
    // findings (audits/lib/measurement.mjs).
    expect(await readFile(githubOutputPath, 'utf8')).toBe(`issue_outcome=${issueOutcome}\nmeasured=5\n`)
  })
})

// THE DECLARATION IS THE REAL COUNT (atlas decision 0142 step 5.4). There is no waiver: an
// all-refused run publishes 0, which wedges the tier until the token can read. A run that
// never reached Cloudflare at all (an absent credential, a usage error) publishes nothing,
// and the ping script reads that as crashed-before-measuring. These cases pin the answers
// apart from each other.
describe('Cloudflare cache-rule measurement declaration', () => {
  const CREDENTIALS = {CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_ZONE_ID: 'zone-id', CLOUDFLARE_API_TOKEN: 'secret-token'}

  /** Run the CLI against `fetchImpl` and return the raw `$GITHUB_OUTPUT` it wrote. */
  async function runAndReadOutput(fetchImpl: unknown, environment: Record<string, string> = CREDENTIALS): Promise<{exitCode: number; output: string}> {
    const scratch = await mkdtemp(join(tmpdir(), 'cloudflare-llms-rules-'))
    scratchDirectories.push(scratch)
    const githubOutputPath = join(scratch, 'github-output.txt')
    const exitCode = await runCloudflareLlmsCacheRuleCli({
      arguments_: ['--evidence-out', join(scratch, 'evidence.json')],
      environment: {...environment, GITHUB_OUTPUT: githubOutputPath},
      fetchImpl,
      now: () => new Date('2026-08-29T22:00:00.000Z'),
      logger: {log: vi.fn(), error: vi.fn()}
    })
    return {exitCode, output: await readFile(githubOutputPath, 'utf8')}
  }

  const refuse = (status: number) => vi.fn(async () => new Response(JSON.stringify({success: false, errors: [{message: 'nope'}]}), {status}))

  // EVERY READ REFUSED. 401 as well as 403: a revoked token and an unscoped one both measure
  // nothing. The count is a literal 0, never `deferred`.
  it.each([403, 401])('declares the real count 0, not deferred, when every read is refused with HTTP %s', async (status) => {
    const {exitCode, output} = await runAndReadOutput(refuse(status))
    expect(exitCode).toBe(1)
    expect(output).toBe('issue_outcome=indeterminate\nmeasured=0\n')
    expect(output).not.toContain('deferred')
  })

  // Each refusal names the permission THAT read needs, so an owner can act on the finding.
  it.each([403, 401])('names the missing permission for each refused read (HTTP %s)', async (status) => {
    const evidence = await auditCloudflareLlmsCacheRules({
      accountId: 'account-id',
      zoneId: 'zone-id',
      apiToken: 'secret-token',
      fetchImpl: refuse(status),
      observedAt: '2026-10-11T00:00:00.000Z'
    })
    const byId = Object.fromEntries(evidence.results.map(({id, evidence: text}: {id: string; evidence: string}) => [id, text]))
    // No Cloudflare doc names the read group for the zone entrypoint GET, so BOTH groups of the
    // documented write set are named, and the finding says the docs do not confirm it.
    for (const id of ['cloudflare-zoneRequestRules-unavailable', 'cloudflare-zoneResponseRules-unavailable']) {
      expect(byId[id]).toContain('"Zone > Cache Rules > Read" and "Account > Account Rulesets > Read"')
      expect(byId[id]).toContain('docs do not confirm')
      expect(byId[id]).not.toContain('Cache Settings Read')
    }
    expect(byId['cloudflare-accountRequestRules-unavailable']).toContain('"Account > Account Rulesets > Read"')
    expect(byId['cloudflare-accountResponseRules-unavailable']).toContain('"Account > Account Rulesets > Read"')
    expect(byId['cloudflare-pageRules-unavailable']).toContain('"Zone > Page Rules > Read"')
    expect(Object.values(byId).every((text) => text.includes('unmeasured'))).toBe(true)
  })

  it('does not name a permission for a failure that is not a refusal', async () => {
    const evidence = await auditCloudflareLlmsCacheRules({
      accountId: 'account-id',
      zoneId: 'zone-id',
      apiToken: 'secret-token',
      fetchImpl: refuse(500),
      observedAt: '2026-10-11T00:00:00.000Z'
    })
    expect(evidence.results.every(({evidence: text}: {evidence: string}) => !text.includes('permission'))).toBe(true)
  })

  // THE CRASH. `CLOUDFLARE_API_TOKEN` is absent, so the audit throws before a single
  // request leaves the runner. It declares NOTHING -- and an empty `measured` with a
  // `failure` outcome is `crashed-before-measuring` in audits/healthchecks-ping.sh, which
  // wedges the tier.
  it('publishes no declaration at all when the run crashes before classifying', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', {status: 200}))
    const {exitCode, output} = await runAndReadOutput(fetchImpl, {CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_ZONE_ID: 'zone-id'})
    expect(exitCode).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(output).toBe('issue_outcome=indeterminate\n')
    expect(output).not.toContain('measured=')
  })

  // Five HTTP 500s reach nothing either. A literal 0, which the ping script wedges on as
  // `measured-nothing`.
  it('declares a literal zero when every read fails for a reason that is not a refusal', async () => {
    const {exitCode, output} = await runAndReadOutput(refuse(500))
    expect(exitCode).toBe(1)
    expect(output).toBe('issue_outcome=indeterminate\nmeasured=0\n')
  })

  // THE CHANNEL LANDING, which needs no workflow edit when the owner grants the reads. Two
  // of the five answer, so the transport demonstrably worked; the three that did not are
  // already `unknown` findings the managed-issue reconciler raises on their own.
  it('declares the count once any read answers, so a partial read reports its count', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/pagerules?')) {
        return new Response(JSON.stringify({success: true, result: [], result_info: {total_pages: 1}}), {status: 200})
      }
      if (url.includes('/zones/') && url.includes('http_request_cache_settings')) {
        return new Response(JSON.stringify({success: true, result: {rules: []}}), {status: 200})
      }
      return new Response(JSON.stringify({success: false, errors: [{message: 'nope'}]}), {status: 403})
    })
    const {exitCode, output} = await runAndReadOutput(fetchImpl)
    expect(exitCode).toBe(1)
    expect(output).toBe('issue_outcome=indeterminate\nmeasured=2\n')
  })

  // The evidence artifact carries the same three numbers the declaration is derived from,
  // so a reader of the upload can check the declaration rather than trust it.
  it('records the held/refused census in the evidence artifact under specVersion 3', async () => {
    const evidence = await auditCloudflareLlmsCacheRules({
      accountId: 'account-id',
      zoneId: 'zone-id',
      apiToken: 'secret-token',
      fetchImpl: refuse(403),
      observedAt: '2026-08-29T22:00:00.000Z'
    })
    expect(evidence.specVersion).toBe(3)
    expect(evidence.measurement).toEqual({sources: 5, held: 0, refused: 5, notApplicable: 0})
    expect(measurementDeclaration(evidence)).toBe(0)
  })

  // Evidence built by the CLI's outer catch has no census at all. `null` is what makes the
  // step publish nothing, so it is pinned rather than left to the writer's discretion.
  it.each([[undefined], [{}], [{measurement: {sources: 5}}]])('returns null for evidence carrying no usable census (%j)', (evidence) => {
    expect(measurementDeclaration(evidence)).toBeNull()
  })
})

// RECORDED CLOUDFLARE ANSWERS (fixtures/cloudflare-cache-rules/).
//
// Measured 2026-10-11 with an account-owned read-all token against the live zone. The
// status codes and messages are the recorded evidence. The 7-rule zone ruleset is
// reconstructed from the measured facts (ruleset version 14; the rule at index 3 (4th) "HTML pages
// (catch-all)" with expression `true` and edge and browser TTL overrides; the rule at index 6 (7th) "TTL for
// llms.txt & index.md" later, bypassing the five gated paths with `cache: false` and browser
// TTL `respect_origin`); the other five rules are plausible disjoint neighbours, not
// verbatim. Cloudflare documents no error code for the two ruleset answers, so those
// fixtures carry none and the check matches on status plus message. Page Rules carries
// code 1011 (cloudflare/cloudflare-docs issue 23256).
describe('Cloudflare cache-rule recorded answers', () => {
  type Recorded = {status: number; body: unknown}
  const respond = ({status, body}: Recorded) => new Response(JSON.stringify(body), {status})
  const ZONE_REQUEST_RULES = zoneRequest200.body.result.rules

  /** Route each of the five reads to a recorded answer; the rest of the matrix is overridable. */
  function recordedFetch(overrides: Partial<Record<'accountRequest' | 'accountResponse' | 'zoneRequest' | 'zoneResponse' | 'pageRules', Recorded>> = {}) {
    const answers: Record<string, Recorded> = {
      accountRequest: accountRequest400,
      accountResponse: accountResponse400,
      zoneRequest: zoneRequest200,
      zoneResponse: zoneResponse404,
      pageRules: pageRulesAccountToken400,
      ...overrides
    }
    return vi.fn(async (url: string, _init?: RequestInit) => {
      const account = url.includes('/accounts/')
      const request = url.includes('http_request_cache_settings')
      if (url.includes('/pagerules?')) {
        return respond(answers.pageRules)
      }
      return respond(answers[`${account ? 'account' : 'zone'}${request ? 'Request' : 'Response'}`])
    })
  }

  const audit = (fetchImpl: ReturnType<typeof recordedFetch>, extra: Record<string, string> = {}) =>
    auditCloudflareLlmsCacheRules({
      accountId: 'account-id',
      zoneId: 'zone-id',
      apiToken: 'readall-token',
      ...extra,
      fetchImpl,
      observedAt: '2026-10-11T00:00:00.000Z'
    })

  const rule = (id: string, expression: string, parameters: Record<string, unknown>) => ({
    id,
    enabled: true,
    action: 'set_cache_settings',
    expression,
    action_parameters: parameters
  })
  const CATCH_ALL = rule('catch-all', 'true', {
    cache: true,
    edge_ttl: {mode: 'override_origin', default: 14400},
    browser_ttl: {mode: 'override_origin', default: 600}
  })
  const GATED_PATHS = 'http.request.uri.path in {"/llms.txt" "/llms-full.txt" "/index.md" "/feed.xml" "/feed.json"}'
  const BYPASS = rule('bypass', GATED_PATHS, {cache: false, browser_ttl: {mode: 'respect_origin'}})

  describe('classification of each answer', () => {
    it('reads the live 7-rule zone ruleset as bypassed for all five gated URLs', async () => {
      expect(ZONE_REQUEST_RULES).toHaveLength(7)
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: ZONE_REQUEST_RULES})
      expect(evaluation.status).toBe('passed')
      expect(evaluation.results).toHaveLength(1)
    })

    it('treats "not allowed at account level" (HTTP 400) as not applicable: measured, no gap, no finding', async () => {
      const evidence = await audit(recordedFetch({pageRules: pageRulesEmpty200}))
      expect(evidence.measurement).toEqual({sources: 5, held: 5, refused: 0, notApplicable: 2})
      expect(evidence.status).toBe('passed')
      // Five reads answered, two of them "not allowed at account level": they hold no artifact.
      expect(measurementDeclaration(evidence)).toBe(3)
    })

    it('treats "could not find entrypoint ruleset" (HTTP 404) as measured and empty', async () => {
      const evidence = await audit(recordedFetch({zoneRequest: zoneResponse404, pageRules: pageRulesEmpty200}))
      expect(evidence.measurement).toEqual({sources: 5, held: 5, refused: 0, notApplicable: 2})
      expect(evidence.status).toBe('passed')
    })

    it('does not treat an unexplained 404 or 400 as an empty or inapplicable ruleset', async () => {
      const bare404 = {status: 404, body: {success: false, errors: [{message: 'not found'}]}}
      const bare400 = {status: 400, body: {success: false, errors: [{message: 'bad request'}]}}
      const evidence = await audit(recordedFetch({zoneResponse: bare404, accountResponse: bare400, pageRules: pageRulesEmpty200}))
      expect(evidence.measurement).toEqual({sources: 5, held: 3, refused: 0, notApplicable: 1})
      expect(evidence.status).toBe('unknown')
      expect(evidence.results.map(({id}: {id: string}) => id).sort()).toEqual([
        'cloudflare-accountResponseRules-unavailable',
        'cloudflare-zoneResponseRules-unavailable'
      ])
    })

    it('reports Page Rules with an account-owned token as UNMEASURED with the Cloudflare reason', async () => {
      const evidence = await audit(recordedFetch())
      expect(evidence.status).toBe('unknown')
      const [gap] = evidence.results
      expect(evidence.results).toHaveLength(1)
      expect(gap.id).toBe('cloudflare-pageRules-unavailable')
      expect(gap.status).toBe('unknown')
      expect(gap.evidence).toContain('Page Rules endpoint does not support account owned tokens')
      expect(gap.evidence).toContain('only a user-owned CLOUDFLARE_API_TOKEN can read them')
      // Not a refusal and not held: the other four reads were held, two of them not applicable.
      expect(evidence.measurement).toEqual({sources: 5, held: 4, refused: 0, notApplicable: 2})
      expect(measurementDeclaration(evidence)).toBe(2)
    })

    it('matches Page Rules on code 1011 even when the message wording changes', async () => {
      const reworded = {status: 400, body: {success: false, errors: [{code: 1011, message: 'unsupported credential'}]}}
      const evidence = await audit(recordedFetch({pageRules: reworded}))
      expect(evidence.results[0].evidence).toContain('only a user-owned CLOUDFLARE_API_TOKEN can read them')
    })

    it('measures Page Rules when the token is permitted to read them (user-owned token)', async () => {
      const evidence = await audit(recordedFetch({pageRules: pageRulesEmpty200}))
      expect(evidence.status).toBe('passed')
      expect(measurementDeclaration(evidence)).toBe(3)
    })

    it('keeps HTTP 403 unmeasured with count 0, with the redacted Cloudflare message and the permission', async () => {
      const refused = {status: 403, body: auth403.body}
      const evidence = await audit(
        recordedFetch({accountRequest: refused, accountResponse: refused, zoneRequest: refused, zoneResponse: refused, pageRules: refused})
      )
      expect(evidence.status).toBe('unknown')
      expect(evidence.results).toHaveLength(5)
      expect(evidence.results[0].evidence).toContain('HTTP 403: Authentication error')
      expect(evidence.results[0].evidence).toContain('the token needs the permission')
      expect(evidence.measurement).toEqual({sources: 5, held: 0, refused: 5, notApplicable: 0})
      expect(measurementDeclaration(evidence)).toBe(0)
    })

    it('does not let two not-applicable answers hide a refused zone token', async () => {
      const refused = {status: 403, body: auth403.body}
      const evidence = await audit(recordedFetch({zoneRequest: refused, zoneResponse: refused, pageRules: refused}))
      expect(evidence.measurement).toEqual({sources: 5, held: 2, refused: 3, notApplicable: 2})
      expect(measurementDeclaration(evidence)).toBe(0)
      const partial = await audit(recordedFetch({zoneRequest: refused, zoneResponse: refused}))
      expect(measurementDeclaration(partial)).toBe(0)
    })
  })

  describe('last-match ordering for the five gated URLs', () => {
    it('judges a catch-all cache rule followed by a later bypass rule as bypassed', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [CATCH_ALL, BYPASS]})
      expect(evaluation.status).toBe('passed')
    })

    it('judges the reverse order as cached: a finding for every gated URL, Edge TTL and Browser TTL', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [BYPASS, CATCH_ALL]})
      expect(evaluation.status).toBe('failed')
      const failed = evaluation.results.filter(({status}) => status === 'failed')
      expect([...new Set(failed.map(({target}) => target))].sort()).toEqual([...CLOUDFLARE_GATED_TARGETS].sort())
      expect(failed.every(({id}) => id === 'zone-cache-rule-catch-all')).toBe(true)
      expect(failed.some(({evidence}) => evidence.includes('mode=override_origin, ttl=14400s'))).toBe(true)
      expect(failed.some(({evidence}) => evidence.includes('Browser Cache TTL overrides origin cache-control'))).toBe(true)
    })

    it('lets a later rule override only the settings it sets: browser TTL respect_origin does not excuse Edge TTL', () => {
      const browserOnly = rule('browser-only', GATED_PATHS, {browser_ttl: {mode: 'respect_origin'}})
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [CATCH_ALL, browserOnly]})
      expect(evaluation.status).toBe('failed')
      expect(evaluation.results.every(({evidence}) => !evidence.includes('Browser Cache TTL'))).toBe(true)
      expect(evaluation.results.every(({evidence}) => evidence.includes('Edge Cache TTL'))).toBe(true)
    })

    it('orders account rules before zone rules', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({accountRequestRules: [CATCH_ALL], zoneRequestRules: [BYPASS]})
      expect(evaluation.status).toBe('passed')
      expect(evaluateCloudflareLlmsCacheRules({accountRequestRules: [BYPASS], zoneRequestRules: [CATCH_ALL]}).status).toBe('failed')
    })

    it('reports UNKNOWN, never pass or fail, when a later bypass rule has an expression the evaluator cannot decide', () => {
      const undecidable = rule('bot-bypass', 'cf.bot_management.score gt 20', {cache: false, browser_ttl: {mode: 'respect_origin'}})
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [CATCH_ALL, undecidable]})
      expect(evaluation.status).toBe('unknown')
      expect(evaluation.results.every(({status}) => status === 'unknown')).toBe(true)
      expect(evaluation.results.map(({target}) => target).sort()).toEqual(expect.arrayContaining([...CLOUDFLARE_GATED_TARGETS].sort()))
    })

    it('reports UNKNOWN when only an undecidable rule could cache the URL', () => {
      const undecidable = rule('bot-cache', 'cf.bot_management.score gt 20', {cache: true, edge_ttl: {mode: 'override_origin', default: 60}})
      expect(evaluateCloudflareLlmsCacheRules({zoneRequestRules: [undecidable]}).status).toBe('unknown')
    })

    it('lets a later definite match reset an earlier undecidable one', () => {
      const undecidable = rule('bot-bypass', 'cf.bot_management.score gt 20', {cache: false})
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [undecidable, CATCH_ALL]})
      expect(evaluation.status).toBe('failed')
    })

    it('treats an unparseable expression as unknown, never as a match or a miss', () => {
      const garbled = rule('garbled', 'http.request.uri.path eq (', {cache: false})
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [CATCH_ALL, garbled]})
      expect(evaluation.status).toBe('unknown')
    })

    it('judges the full recorded run end to end: unknown only because Page Rules are unmeasured', async () => {
      const evidence = await audit(recordedFetch())
      expect(evidence.results.every(({id}: {id: string}) => id === 'cloudflare-pageRules-unavailable')).toBe(true)
    })
  })

  describe('credentials', () => {
    it('reads CLOUDFLARE_API_TOKEN for every request, Page Rules included', async () => {
      const fetchImpl = recordedFetch({pageRules: pageRulesEmpty200})
      const scratch = await mkdtemp(join(tmpdir(), 'cloudflare-llms-rules-'))
      scratchDirectories.push(scratch)
      const githubOutputPath = join(scratch, 'github-output.txt')
      const exitCode = await runCloudflareLlmsCacheRuleCli({
        arguments_: ['--evidence-out', join(scratch, 'evidence.json')],
        environment: {
          CLOUDFLARE_ACCOUNT_ID: 'account-id',
          CLOUDFLARE_ZONE_ID: 'zone-id',
          CLOUDFLARE_API_TOKEN: 'api-token',
          GITHUB_OUTPUT: githubOutputPath
        },
        fetchImpl,
        now: () => new Date('2026-10-11T00:00:00.000Z'),
        logger: {log: vi.fn(), error: vi.fn()}
      })
      expect(exitCode).toBe(0)
      expect(fetchImpl.mock.calls.length).toBe(5)
      expect(fetchImpl.mock.calls.every(([, init]) => (init?.headers as Record<string, string>).Authorization === 'Bearer api-token')).toBe(true)
      expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=success\nmeasured=3\n')
    })

    it('publishes no declaration when the token is absent', async () => {
      const fetchImpl = recordedFetch()
      const scratch = await mkdtemp(join(tmpdir(), 'cloudflare-llms-rules-'))
      scratchDirectories.push(scratch)
      const githubOutputPath = join(scratch, 'github-output.txt')
      const exitCode = await runCloudflareLlmsCacheRuleCli({
        arguments_: ['--evidence-out', join(scratch, 'evidence.json')],
        environment: {CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_ZONE_ID: 'z', GITHUB_OUTPUT: githubOutputPath},
        fetchImpl,
        now: () => new Date('2026-10-11T00:00:00.000Z'),
        logger: {log: vi.fn(), error: vi.fn()}
      })
      expect(exitCode).toBe(1)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\n')
    })
  })
})

// EXPRESSION EVALUATOR: A DEFINITE ANSWER ONLY WHEN IT IS SURE. A wrong definite answer is the
// failure mode (a bypass rule hiding a caching finding), so every construct the evaluator cannot
// decide for EVERY request to the gated path is UNKNOWN.
describe('Cloudflare cache-rule expression evaluator certainty', () => {
  const LLMS = CLOUDFLARE_LLMS_TARGETS[0]
  const apply = (expression: string) => expressionApplicability(expression, LLMS)
  const rule = (id: string, expression: string, parameters: Record<string, unknown>, action = 'set_cache_settings') => ({
    id,
    enabled: true,
    action,
    expression,
    action_parameters: parameters
  })
  const CATCH_ALL = rule('catch-all', 'true', {cache: true, edge_ttl: {mode: 'override_origin', default: 14400}})
  const bypassOn = (expression: string) => rule('bypass', expression, {cache: false})
  const status = (rules: unknown[]) => evaluateCloudflareLlmsCacheRules({zoneRequestRules: rules}).status

  describe('wildcard operators (H1, H2)', () => {
    it('keeps `wildcard` case-insensitive and makes `strict wildcard` case-sensitive', () => {
      expect(apply('http.request.uri.path wildcard "/LLMS*"')).toBe('matches')
      expect(apply('http.request.uri.path strict wildcard "/LLMS*"')).toBe('disjoint')
      expect(apply('http.request.uri.path strict wildcard "/llms*"')).toBe('matches')
    })

    it('does not let a case-mismatched strict wildcard bypass hide a catch-all caching finding', () => {
      const upperCaseBypass = ['/LLMS*', '/INDEX*', '/FEED*'].map((pattern) => `http.request.uri.path strict wildcard "${pattern}"`).join(' or ')
      expect(status([CATCH_ALL, bypassOn(upperCaseBypass)])).toBe('failed')
    })

    it('reads `\\*` as a literal star and `\\\\` as a literal backslash', () => {
      expect(apply('http.request.uri.path wildcard "/llms.tx\\\\*"')).toBe('disjoint')
      expect(apply('http.request.uri.path wildcard r"/llms.tx\\*"')).toBe('disjoint')
      expect(apply('http.request.uri.path wildcard r"/llms.tx\\\\*"')).toBe('disjoint')
    })

    it.each(['r"/llms\\.txt"', 'r"/llms\\q*"', 'r"/llms**"', 'r"/llms\\"'])('returns UNKNOWN for the wildcard %s', (pattern) => {
      expect(apply(`http.request.uri.path wildcard ${pattern}`)).toBe('unknown')
    })
  })

  describe('string literals (H3)', () => {
    it('takes a raw string verbatim: no escape sequences', () => {
      // The regex `^/llms\\.txt$` is a literal backslash then any character, so it misses `/llms.txt`.
      expect(apply('http.request.uri.path matches r"^/llms\\\\.txt$"')).toBe('disjoint')
      expect(apply('http.request.uri.path matches r"^/llms\\.txt$"')).toBe('matches')
    })

    it('supports r#"..."# raw strings, which may hold a double quote', () => {
      expect(apply('http.request.uri.path matches r#"^/llms\.txt$"#')).toBe('matches')
      expect(apply('http.request.uri.path ne r#"a"b"#')).toBe('matches')
    })

    it('allows only \\" and \\\\ escapes in a quoted string', () => {
      expect(apply('http.request.uri.path eq "\\n"')).toBe('unknown')
      expect(apply('http.request.uri.path eq "/llms\\u002etxt"')).toBe('unknown')
      expect(apply('http.request.uri.path ne "a\\"b"')).toBe('matches')
    })
  })

  describe('matches uses a Rust-compatible regex subset (H4)', () => {
    it.each(['^/llms\\.txt\\z', '\\A/llms\\.txt', '(?i)^/LLMS', '(?x)^/llms', '^/\\d+', '^/\\w+', '\\bllms', '(?P<n>llms)', '[[:alpha:]]+', '^/llms{'])(
      'returns UNKNOWN for the pattern %s',
      (pattern) => {
        expect(apply(`http.request.uri.path matches r"${pattern}"`)).toBe('unknown')
      }
    )

    it('decides a pattern built only from the shared subset', () => {
      expect(apply('http.request.uri.path matches r"^/llms\.(txt|md)$"')).toBe('matches')
      expect(apply('http.request.uri.path matches r"^/[a-z]{4}\.txt$"')).toBe('matches')
      expect(apply('http.request.uri.path matches r"^/feed\.xml$"')).toBe('disjoint')
    })
  })

  describe('fields that vary between requests are UNKNOWN (H6, M2)', () => {
    it.each([
      'http.request.uri eq "/llms.txt"',
      'http.request.uri.query eq ""',
      'http.request.full_uri eq "https://jonathanlloyd.me/llms.txt"',
      'ssl',
      'http.request.method eq "GET"',
      'http.response.code eq 200'
    ])('returns UNKNOWN for %s', (expression) => {
      expect(apply(expression)).toBe('unknown')
    })

    it('still decides the path, host and extension, which are the same for every request', () => {
      expect(apply('http.request.uri.path eq "/llms.txt"')).toBe('matches')
      expect(apply('http.host eq "jonathanlloyd.me"')).toBe('matches')
      expect(apply('http.request.uri.path.extension eq "txt"')).toBe('matches')
    })

    it('does not let a bypass on http.request.uri hide a catch-all: /llms.txt?x=1 is cached', () => {
      expect(status([CATCH_ALL, bypassOn('http.request.uri in {"/llms.txt" "/llms-full.txt" "/index.md" "/feed.xml" "/feed.json"}')])).not.toBe('passed')
    })

    it('does not pass an Edge TTL rule written on http.request.uri.query', () => {
      expect(status([rule('query-ttl', 'http.request.uri.query ne ""', {cache: true, edge_ttl: {mode: 'override_origin', default: 60}})])).not.toBe('passed')
    })
  })

  describe('operators outside the modelled forms are UNKNOWN (L2)', () => {
    it('rejects a comma-separated set', () => {
      expect(apply('http.request.uri.path in {"/a", "/llms.txt"}')).toBe('unknown')
      expect(apply('http.request.uri.path in {"/a" "/llms.txt"}')).toBe('matches')
    })

    it('does not order strings', () => {
      expect(apply('http.request.uri.path gt "/a"')).toBe('unknown')
      expect(apply('http.request.uri.path lt "/z"')).toBe('unknown')
    })

    it('does not coerce non-string function arguments', () => {
      expect(apply('starts_with(http.request.uri.path, 5)')).toBe('unknown')
      expect(apply('ends_with(5, "x")')).toBe('unknown')
    })

    it('does not compare a string with a number', () => {
      expect(apply('http.request.uri.path eq 5')).toBe('unknown')
    })
  })

  describe('actions the evaluator does not expand (M1)', () => {
    it('reports an execute rule that definitely matches as UNKNOWN, not failed', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [rule('exec', 'true', {id: 'other'}, 'execute')]})
      expect(evaluation.status).toBe('unknown')
      expect(evaluation.results.every(({status: s}) => s === 'unknown')).toBe(true)
    })

    it('reports a skip action (or any future action) as UNKNOWN instead of ignoring it', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [CATCH_ALL, rule('skip', 'true', {ruleset: 'current'}, 'skip')]})
      expect(evaluation.status).toBe('failed')
      expect(evaluation.results.some(({id, status: s}) => id === 'zone-cache-rule-skip' && s === 'unknown')).toBe(true)
      expect(evaluateCloudflareLlmsCacheRules({zoneRequestRules: [rule('skip', 'true', {}, 'skip')]}).status).toBe('unknown')
    })

    it('makes every later rule UNKNOWN once a skip matches: skip then a catch-all Edge TTL is not failed', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneRequestRules: [rule('skip', 'true', {ruleset: 'current'}, 'skip'), CATCH_ALL]})
      expect(evaluation.status).toBe('unknown')
      expect(evaluation.results.every(({status: s}) => s === 'unknown')).toBe(true)
      expect(evaluation.results.some(({id}) => id === 'zone-cache-rule-catch-all')).toBe(true)
    })

    it('does the same after an execute rule, and leaves rules before the opaque rule definite', () => {
      expect(status([rule('exec', 'true', {id: 'other'}, 'execute'), CATCH_ALL])).toBe('unknown')
      expect(status([CATCH_ALL, rule('skip', 'true', {}, 'skip')])).toBe('failed')
    })

    it('reports an unmodelled response-phase action as UNKNOWN', () => {
      const evaluation = evaluateCloudflareLlmsCacheRules({zoneResponseRules: [rule('future', 'true', {}, 'future_action')]})
      expect(evaluation.status).toBe('unknown')
    })
  })

  describe('Edge TTL needs a definite cache-eligibility rule (L1)', () => {
    // https://developers.cloudflare.com/cache/how-to/cache-rules/settings/ lists Edge TTL under
    // "Eligible for cache settings"; it does not say an Edge TTL alone makes a response eligible.
    it('reports an Edge TTL override with no `cache: true` as UNKNOWN', () => {
      expect(status([rule('ttl-only', 'true', {edge_ttl: {mode: 'override_origin', default: 60}})])).toBe('unknown')
    })

    it('reports the same override with `cache: true` as failed', () => {
      expect(status([rule('ttl', 'true', {cache: true, edge_ttl: {mode: 'override_origin', default: 60}})])).toBe('failed')
    })
  })

  describe('Page Rule URL patterns (H5)', () => {
    const pageRule = (pattern: string, actions: unknown[] = [{id: 'edge_cache_ttl', value: 3600}]) => ({
      id: 'pr',
      status: 'active',
      targets: [{target: 'url', constraint: {operator: 'matches', value: pattern}}],
      actions
    })
    const judge = (pattern: string) => evaluateCloudflareLlmsCacheRules({pageRules: [pageRule(pattern)]}).status

    it('matches a scheme-less pattern against the URL without its scheme', () => {
      expect(judge('jonathanlloyd.me/*')).toBe('failed')
      expect(judge('jonathanlloyd.me/llms.txt')).toBe('failed')
    })

    it('matches an https pattern against the full URL', () => {
      expect(judge('https://jonathanlloyd.me/*')).toBe('failed')
    })

    it('is UNKNOWN when only a scheme swap, a case change or a query suffix could match', () => {
      expect(judge('http://jonathanlloyd.me/*')).toBe('unknown')
      expect(judge('JonathanLloyd.me/*')).toBe('unknown')
      expect(judge('jonathanlloyd.me/llms.txt*')).toBe('failed')
    })

    it('is disjoint for another host', () => {
      expect(judge('example.com/*')).toBe('passed')
    })
  })

  describe('measured excludes not-applicable answers (M4)', () => {
    it('publishes held minus not-applicable and keeps the not-applicable count in the evidence', async () => {
      const evidence = {measurement: {sources: 5, held: 4, refused: 0, notApplicable: 2}}
      expect(measurementDeclaration(evidence)).toBe(2)
      expect(measurementDeclaration({measurement: {sources: 5, held: 2, refused: 3, notApplicable: 2}})).toBe(0)
    })
  })
})
