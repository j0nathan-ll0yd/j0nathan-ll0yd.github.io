import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  auditCloudflareLlmsCacheRules,
  CLOUDFLARE_LLMS_TARGETS,
  evaluateCloudflareLlmsCacheRules,
  expressionApplicability,
  runCloudflareLlmsCacheRuleCli
} from '../../scripts/audit/check-cloudflare-llms-cache-rules.mjs'

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
    expect(await readFile(githubOutputPath, 'utf8')).toBe('issue_outcome=indeterminate\n')
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
    expect(await readFile(githubOutputPath, 'utf8')).toBe(`issue_outcome=${issueOutcome}\n`)
  })
})
