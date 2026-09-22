import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  auditCloudflareLlmsCacheRules,
  CLOUDFLARE_LLMS_TARGETS,
  evaluateCloudflareLlmsCacheRules,
  expressionApplicability,
  measurementDeclaration,
  runCloudflareLlmsCacheRuleCli
} from '../checks/b2-check-cloudflare-llms-cache-rules.mjs'

const scratchDirectories: string[] = []

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
      return new Response(JSON.stringify({success: false, errors: []}), {status: 404})
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
    expect(JSON.stringify(evidence)).not.toContain('secret-token')
    expect(JSON.stringify(evidence)).not.toContain('account-id')
    expect(JSON.stringify(evidence)).not.toContain('zone-id')
    // Five refusals is exactly the state atlas decision 0120 D2 waives, so the step declares
    // `deferred` alongside the indeterminate issue outcome. The two answer different
    // questions: the issue outcome is "was the artifact healthy", the declaration is "did
    // the transport work at all".
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\nmeasured=deferred\n')
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
      : [{id: 'conflict', enabled: true, action: 'set_cache_settings', expression: 'true', action_parameters: {edge_ttl: {mode: 'override_origin'}}}]
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

// THE CRASH AND THE WAIVER MUST NOT LOOK ALIKE (atlas decision 0142 step 5.4).
//
// `.github/workflows/audit-web.yml` waives this step's measurement channel under atlas
// decision 0120 D2: five Cloudflare reads return 403 because the token lacks read
// permissions, the permissions fix is an open owner action, and the tile must not go
// permanently red on it. That waiver used to be a LITERAL `deferred` in the workflow's
// MEASURED_STEPS record, so it was published on every run regardless of what the step did.
// A run that never reached Cloudflare at all -- an absent credential, a usage error, a
// runner that died -- published the same `deferred` and inherited the same waiver. The
// crash hid behind a legitimate recorded exemption, which is the exact laundering shape the
// measurement channel exists to end.
//
// So the runner classifies its own run and the workflow forwards what it published. These
// cases pin the four answers apart from each other.
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

  // THE WAIVED STATE, and the only one the workflow's reason and `until=2026-12-08`
  // describe: every read refused. 401 as well as 403 -- a revoked token and an unscoped one
  // are the same open owner action.
  it.each([403, 401])('declares deferred when every read is refused with HTTP %s', async (status) => {
    const {exitCode, output} = await runAndReadOutput(refuse(status))
    expect(exitCode).toBe(1)
    expect(output).toBe('issue_outcome=indeterminate\nmeasured=deferred\n')
  })

  // THE CRASH. `CLOUDFLARE_API_TOKEN` is absent, so the audit throws before a single
  // request leaves the runner. It reached nothing and it cannot say why in the waived
  // vocabulary, so it declares NOTHING -- and an empty `measured` with a `failure` outcome
  // is `crashed-before-measuring` in audits/healthchecks-ping.sh, which wedges the tier.
  // The waiver is never consulted, which is the whole point of this change.
  it('publishes no declaration at all when the run crashes before classifying', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', {status: 200}))
    const {exitCode, output} = await runAndReadOutput(fetchImpl, {CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_ZONE_ID: 'zone-id'})
    expect(exitCode).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(output).toBe('issue_outcome=indeterminate\n')
    expect(output).not.toContain('measured=')
  })

  // A FAILURE THAT IS NOT THE WAIVED ONE. Five HTTP 500s reach nothing either, but nothing
  // about them is the permission gap 0120 D2 waives, so widening `deferred` to cover them
  // would widen the waiver to "any total transport failure". It declares a literal 0, which
  // the ping script wedges on as `measured-nothing`.
  it('declares a literal zero when every read fails for a reason that is not a refusal', async () => {
    const {exitCode, output} = await runAndReadOutput(refuse(500))
    expect(exitCode).toBe(1)
    expect(output).toBe('issue_outcome=indeterminate\nmeasured=0\n')
  })

  // THE CHANNEL LANDING, which needs no workflow edit when the owner grants the reads. Two
  // of the five answer, so the transport demonstrably worked; the three that did not are
  // already `unknown` findings the managed-issue reconciler raises on their own.
  it('declares the count once any read answers, so a partial read never defers', async () => {
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
  it('records the held/refused census in the evidence artifact under specVersion 2', async () => {
    const evidence = await auditCloudflareLlmsCacheRules({
      accountId: 'account-id',
      zoneId: 'zone-id',
      apiToken: 'secret-token',
      fetchImpl: refuse(403),
      observedAt: '2026-08-29T22:00:00.000Z'
    })
    expect(evidence.specVersion).toBe(2)
    expect(evidence.measurement).toEqual({sources: 5, held: 0, refused: 5})
    expect(measurementDeclaration(evidence)).toBe('deferred')
  })

  // Evidence built by the CLI's outer catch has no census at all. `null` is what makes the
  // step publish nothing, so it is pinned rather than left to the writer's discretion.
  it.each([[undefined], [{}], [{measurement: {sources: 5}}]])('returns null for evidence carrying no usable census (%j)', (evidence) => {
    expect(measurementDeclaration(evidence)).toBeNull()
  })
})
