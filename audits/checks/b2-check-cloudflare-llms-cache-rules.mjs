#!/usr/bin/env node

import {appendFile, mkdir, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {fetchStable, isMain} from '../lib/http.mjs'

export const CLOUDFLARE_LLMS_TARGETS = Object.freeze([
  'https://jonathanlloyd.me/llms.txt',
  'https://jonathanlloyd.me/llms-full.txt',
  'https://jonathanlloyd.me/index.md'
])

const API_BASE = 'https://api.cloudflare.com/client/v4'
const UNKNOWN = Symbol('unknown')

function tri(value) {
  return value === UNKNOWN ? UNKNOWN : Boolean(value)
}

function triAnd(left, right) {
  if (left === false || right === false) {
    return false
  }
  if (left === UNKNOWN || right === UNKNOWN) {
    return UNKNOWN
  }
  return true
}

function triOr(left, right) {
  if (left === true || right === true) {
    return true
  }
  if (left === UNKNOWN || right === UNKNOWN) {
    return UNKNOWN
  }
  return false
}

function tokenize(expression) {
  const tokens = []
  let index = 0
  while (index < expression.length) {
    const character = expression[index]
    if (/\s/.test(character)) {
      index++
      continue
    }
    if ('(){},'.includes(character)) {
      tokens.push({type: character, value: character})
      index++
      continue
    }
    if (character === '"' || (character === 'r' && expression[index + 1] === '"')) {
      if (character === 'r') {
        index++
      }
      const start = index
      index++
      let escaped = false
      while (index < expression.length) {
        const current = expression[index++]
        if (!escaped && current === '"') {
          break
        }
        escaped = !escaped && current === '\\'
        if (current !== '\\') {
          escaped = false
        }
      }
      if (expression[index - 1] !== '"') {
        throw new SyntaxError('unterminated string')
      }
      const raw = expression.slice(start, index)
      tokens.push({type: 'value', value: JSON.parse(raw)})
      continue
    }
    const number = expression.slice(index).match(/^-?\d+(?:\.\d+)?/)
    if (number) {
      tokens.push({type: 'value', value: Number(number[0])})
      index += number[0].length
      continue
    }
    const identifier = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.-]*/)
    if (identifier) {
      tokens.push({type: 'identifier', value: identifier[0]})
      index += identifier[0].length
      continue
    }
    throw new SyntaxError(`unsupported token at offset ${index}`)
  }
  return tokens
}

function fieldValue(name, request) {
  const url = new URL(request.url)
  const values = {
    'cf.zone.name': url.hostname,
    'http.host': url.hostname,
    'http.request.full_uri': url.href,
    'http.request.method': request.method,
    'http.request.uri': `${url.pathname}${url.search}`,
    'http.request.uri.path': url.pathname,
    'http.request.uri.path.extension': url.pathname.includes('.') ? url.pathname.slice(url.pathname.lastIndexOf('.') + 1) : '',
    'http.request.uri.query': url.search.slice(1),
    'http.response.code': request.responseCode,
    ssl: url.protocol === 'https:'
  }
  return Object.hasOwn(values, name) ? values[name] : UNKNOWN
}

function wildcardRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function compare(left, operator, right) {
  if (left === UNKNOWN || right === UNKNOWN) {
    return UNKNOWN
  }
  if (operator === 'eq') {
    return left === right
  }
  if (operator === 'ne') {
    return left !== right
  }
  if (operator === 'contains') {
    return typeof left === 'string' && typeof right === 'string' ? left.includes(right) : UNKNOWN
  }
  if (operator === 'matches') {
    if (typeof left !== 'string' || typeof right !== 'string') {
      return UNKNOWN
    }
    try {
      return new RegExp(right).test(left)
    } catch {
      return UNKNOWN
    }
  }
  if (operator === 'wildcard' || operator === 'strict wildcard') {
    return typeof left === 'string' && typeof right === 'string' ? wildcardRegex(right).test(left) : UNKNOWN
  }
  if (['gt', 'ge', 'lt', 'le'].includes(operator) && typeof left === typeof right) {
    if (operator === 'gt') {
      return left > right
    }
    if (operator === 'ge') {
      return left >= right
    }
    if (operator === 'lt') {
      return left < right
    }
    return left <= right
  }
  return UNKNOWN
}

function parser(tokens, request) {
  let index = 0
  const peek = (value) => tokens[index]?.value === value
  const take = () => tokens[index++]

  function primary() {
    const token = take()
    if (!token) {
      throw new SyntaxError('unexpected end of expression')
    }
    if (token.type === 'value') {
      return token.value
    }
    if (token.type === '(') {
      const value = orExpression()
      if (take()?.type !== ')') {
        throw new SyntaxError('missing closing parenthesis')
      }
      return value
    }
    if (token.type !== 'identifier') {
      throw new SyntaxError('expected value')
    }
    if (token.value === 'true' || token.value === 'false') {
      return token.value === 'true'
    }
    if (peek('(')) {
      take()
      const arguments_ = []
      while (!peek(')')) {
        arguments_.push(primary())
        if (peek(',')) {
          take()
        } else if (!peek(')')) {
          throw new SyntaxError('expected comma')
        }
      }
      take()
      if (arguments_.some((value) => value === UNKNOWN)) {
        return UNKNOWN
      }
      if (token.value === 'starts_with' && arguments_.length === 2) {
        return String(arguments_[0]).startsWith(String(arguments_[1]))
      }
      if (token.value === 'ends_with' && arguments_.length === 2) {
        return String(arguments_[0]).endsWith(String(arguments_[1]))
      }
      if (token.value === 'lower' && arguments_.length === 1) {
        return String(arguments_[0]).toLowerCase()
      }
      if (token.value === 'upper' && arguments_.length === 1) {
        return String(arguments_[0]).toUpperCase()
      }
      return UNKNOWN
    }
    return fieldValue(token.value, request)
  }

  function comparison() {
    const left = primary()
    if (peek('not') && tokens[index + 1]?.value === 'in') {
      take()
      take()
      const membership = inSet(left)
      return membership === UNKNOWN ? UNKNOWN : !membership
    }
    if (peek('in')) {
      take()
      return inSet(left)
    }
    if (peek('strict') && tokens[index + 1]?.value === 'wildcard') {
      take()
      take()
      return compare(left, 'strict wildcard', primary())
    }
    const operator = tokens[index]?.value
    if (['eq', 'ne', 'contains', 'matches', 'wildcard', 'gt', 'ge', 'lt', 'le'].includes(operator)) {
      take()
      return compare(left, operator, primary())
    }
    return left
  }

  function inSet(left) {
    if (take()?.type !== '{') {
      throw new SyntaxError('expected set')
    }
    const values = []
    while (tokens[index]?.type !== '}') {
      values.push(primary())
      if (peek(',')) {
        take()
      }
      if (!tokens[index]) {
        throw new SyntaxError('unterminated set')
      }
    }
    take()
    if (left === UNKNOWN || values.some((value) => value === UNKNOWN)) {
      return UNKNOWN
    }
    return values.includes(left)
  }

  function unary() {
    if (peek('not')) {
      take()
      const value = tri(unary())
      return value === UNKNOWN ? UNKNOWN : !value
    }
    return comparison()
  }

  function andExpression() {
    let value = tri(unary())
    while (peek('and')) {
      take()
      value = triAnd(value, tri(unary()))
    }
    return value
  }

  function orExpression() {
    let value = andExpression()
    while (peek('or') || peek('xor')) {
      const operator = take().value
      const right = andExpression()
      value = operator === 'or' ? triOr(value, right) : value === UNKNOWN || right === UNKNOWN ? UNKNOWN : value !== right
    }
    return value
  }

  const value = tri(orExpression())
  if (index !== tokens.length) {
    throw new SyntaxError('unsupported expression tail')
  }
  return value
}

export function expressionApplicability(expression, url) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    return 'unknown'
  }
  try {
    const result = parser(tokenize(expression), {url, method: 'GET', responseCode: 200})
    return result === true ? 'matches' : result === false ? 'disjoint' : 'unknown'
  } catch {
    return 'unknown'
  }
}

function requestRuleRisks(rule) {
  if (rule.action === 'execute') {
    return ['executes another cache ruleset that this response did not expand']
  }
  if (rule.action !== 'set_cache_settings') {
    return []
  }
  const parameters = rule.action_parameters ?? {}
  const risks = []
  if (parameters.edge_ttl?.mode === 'override_origin') {
    risks.push('Edge Cache TTL ignores origin cache-control')
  }
  const successStatusTtl = parameters.edge_ttl?.status_code_ttl?.find((setting) => {
    if (Number(setting.value) <= 0) {
      return false
    }
    if (Number.isInteger(setting.status_code)) {
      return setting.status_code === 200
    }
    const from = Number(setting.status_code_range?.from ?? 100)
    const to = Number(setting.status_code_range?.to ?? 599)
    return from <= 200 && to >= 200
  })
  if (successStatusTtl) {
    risks.push(`Edge Cache TTL status override caches HTTP 200 for ${successStatusTtl.value} seconds`)
  }
  if (parameters.browser_ttl?.mode === 'override_origin' && Number(parameters.browser_ttl.default) > 0) {
    risks.push('Browser Cache TTL overrides origin cache-control')
  }
  const customKey = parameters.cache_key?.custom_key
  if (customKey?.header || customKey?.cookie || customKey?.user || parameters.cache_key?.cache_by_device_type) {
    risks.push('custom cache key prevents a complete bare-URL purge')
  }
  return risks
}

function responseRuleRisks(rule) {
  if (rule.action === 'execute') {
    return ['executes another cache response ruleset that this response did not expand']
  }
  if (rule.action !== 'set_cache_control') {
    return []
  }
  const parameters = rule.action_parameters ?? {}
  const risks = []
  for (const directive of ['max-age', 's-maxage']) {
    const setting = parameters[directive]
    if (setting?.operation === 'set' && Number(setting.value) > 0) {
      risks.push(`sets ${directive}=${setting.value}`)
    }
  }
  for (const directive of ['no-store', 'no_store', 'no-cache', 'no_cache', 'private']) {
    if (parameters[directive]?.operation === 'remove') {
      risks.push(`removes ${directive.replace('_', '-')}`)
    }
  }
  if (parameters.public?.operation === 'set') {
    risks.push('sets public')
  }
  return risks
}

function pageRuleRisks(rule) {
  const risks = []
  for (const action of rule.actions ?? []) {
    if (action.id === 'edge_cache_ttl' || action.id === 'cache_ttl_by_status') {
      risks.push(`Page Rule ${action.id} overrides origin cache-control`)
    }
    if (action.id === 'browser_cache_ttl' && Number(action.value) > 0) {
      risks.push('Page Rule browser_cache_ttl overrides origin cache-control')
    }
    if (action.id === 'explicit_cache_control' && action.value === 'off') {
      risks.push('Page Rule disables origin cache-control')
    }
    if (action.id === 'cache_key') {
      risks.push('Page Rule custom cache key prevents a complete bare-URL purge')
    }
  }
  return risks
}

function pageRuleApplicability(rule, url) {
  const urlTargets = (rule.targets ?? []).filter((target) => target.target === 'url')
  if (urlTargets.length === 0) {
    return 'unknown'
  }
  try {
    return urlTargets.every((target) => wildcardRegex(String(target.constraint?.value ?? '')).test(url)) ? 'matches' : 'disjoint'
  } catch {
    return 'unknown'
  }
}

function findingFor(source, rule, target, applicability, risk) {
  const identifier = rule.id ?? rule.ref ?? 'unidentified-rule'
  const description = rule.description ? ` (${rule.description})` : ''
  return {
    id: `${source}-${identifier}`,
    status: applicability === 'matches' ? 'failed' : 'unknown',
    target,
    evidence: `${source} rule ${identifier}${description}: ${risk}; applicability=${applicability}; expression=${JSON.stringify(rule.expression ?? null)}`
  }
}

export function evaluateCloudflareLlmsCacheRules(inventory) {
  const results = []
  const ruleSources = [
    ['account-cache-rule', inventory.accountRequestRules ?? [], requestRuleRisks],
    ['zone-cache-rule', inventory.zoneRequestRules ?? [], requestRuleRisks],
    ['account-cache-response-rule', inventory.accountResponseRules ?? [], responseRuleRisks],
    ['zone-cache-response-rule', inventory.zoneResponseRules ?? [], responseRuleRisks]
  ]
  for (const [source, rules, risksFor] of ruleSources) {
    for (const rule of rules) {
      if (rule.enabled === false) {
        continue
      }
      const risks = risksFor(rule)
      if (risks.length === 0) {
        continue
      }
      for (const target of CLOUDFLARE_LLMS_TARGETS) {
        const applicability = expressionApplicability(rule.expression, target)
        if (applicability === 'disjoint') {
          continue
        }
        for (const risk of risks) {
          results.push(findingFor(source, rule, target, applicability, risk))
        }
      }
    }
  }
  for (const rule of inventory.pageRules ?? []) {
    if (rule.status && rule.status !== 'active') {
      continue
    }
    const risks = pageRuleRisks(rule)
    if (risks.length === 0) {
      continue
    }
    for (const target of CLOUDFLARE_LLMS_TARGETS) {
      const applicability = pageRuleApplicability(rule, target)
      if (applicability === 'disjoint') {
        continue
      }
      for (const risk of risks) {
        results.push(findingFor('page-rule', rule, target, applicability, risk))
      }
    }
  }
  for (const gap of inventory.gaps ?? []) {
    results.push({id: gap.id, status: 'unknown', target: null, evidence: gap.evidence})
  }
  if (results.length === 0) {
    results.push({
      id: 'cloudflare-llms-cache-rules',
      status: 'passed',
      target: null,
      evidence: 'no applicable Edge Cache TTL, Cache Response Rule, Page Rule, browser TTL override, or unsafe custom cache key was found'
    })
  }
  const status = results.some((result) => result.status === 'failed')
    ? 'failed'
    : results.some((result) => result.status === 'unknown')
    ? 'unknown'
    : 'passed'
  return {status, results}
}

function redactSensitive(value, sensitiveValues) {
  let safe = String(value)
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue) {
      safe = safe.replaceAll(sensitiveValue, '[redacted]')
    }
  }
  return safe.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

function safeApiMessage(payload, sensitiveValues) {
  const messages = [...(payload?.errors ?? []), ...(payload?.messages ?? [])].map((entry) => String(entry?.message ?? '')).filter(Boolean).join('; ')
  return redactSensitive(messages, sensitiveValues)
}

async function apiGet(path, label, token, sensitiveValues, fetchImpl) {
  const response = await fetchImpl(`${API_BASE}${path}`, {method: 'GET', headers: {Accept: 'application/json', Authorization: `Bearer ${token}`}})
  let payload = null
  try {
    payload = await response.json()
  } catch {
    // A status-only error is sufficient and avoids logging an untrusted body.
  }
  if (response.status === 404) {
    return {missing: true, result: null, resultInfo: null}
  }
  if (!response.ok || payload?.success !== true) {
    const detail = safeApiMessage(payload, sensitiveValues)
    throw new Error(`${label} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return {missing: false, result: payload.result, resultInfo: payload.result_info ?? null}
}

async function rulesetRules(scope, identifier, phase, token, sensitiveValues, fetchImpl) {
  const label = `${scope === 'accounts' ? 'account' : 'zone'} ${phase} entrypoint`
  const response = await apiGet(`/${scope}/${identifier}/rulesets/phases/${phase}/entrypoint`, label, token, sensitiveValues, fetchImpl)
  if (response.missing) {
    return []
  }
  if (!response.result || !Array.isArray(response.result.rules)) {
    throw new Error(`${scope} ${phase} response had no rules array`)
  }
  return response.result.rules
}

async function activePageRules(zoneId, token, sensitiveValues, fetchImpl) {
  const rules = []
  let page = 1
  while (true) {
    const response = await apiGet(`/zones/${zoneId}/pagerules?status=active&per_page=50&page=${page}`, 'active Page Rules', token, sensitiveValues,
      fetchImpl)
    if (!Array.isArray(response.result)) {
      throw new Error('Page Rules response was not an array')
    }
    rules.push(...response.result)
    const totalPages = Number(response.resultInfo?.total_pages ?? 1)
    if (page >= totalPages) {
      return rules
    }
    page++
  }
}

export async function auditCloudflareLlmsCacheRules({accountId, zoneId, apiToken, fetchImpl = fetchStable, observedAt = new Date().toISOString()}) {
  const sensitiveValues = [apiToken, accountId, zoneId]
  const requests = [
    ['accountRequestRules', () => rulesetRules('accounts', accountId, 'http_request_cache_settings', apiToken, sensitiveValues, fetchImpl)],
    ['zoneRequestRules', () => rulesetRules('zones', zoneId, 'http_request_cache_settings', apiToken, sensitiveValues, fetchImpl)],
    ['accountResponseRules', () => rulesetRules('accounts', accountId, 'http_response_cache_settings', apiToken, sensitiveValues, fetchImpl)],
    ['zoneResponseRules', () => rulesetRules('zones', zoneId, 'http_response_cache_settings', apiToken, sensitiveValues, fetchImpl)],
    ['pageRules', () => activePageRules(zoneId, apiToken, sensitiveValues, fetchImpl)]
  ]
  const settled = await Promise.allSettled(requests.map(([, request]) => request()))
  const inventory = {gaps: []}
  for (let index = 0; index < requests.length; index++) {
    const [name] = requests[index]
    const result = settled[index]
    if (result.status === 'fulfilled') {
      inventory[name] = result.value
    } else {
      inventory.gaps.push({
        id: `cloudflare-${name}-unavailable`,
        evidence: redactSensitive(result.reason instanceof Error ? result.reason.message : result.reason, sensitiveValues)
      })
    }
  }
  const evaluation = evaluateCloudflareLlmsCacheRules(inventory)
  return {
    specVersion: 1,
    checkId: 'cloudflare-llms-cache-rules',
    status: evaluation.status,
    observedAt,
    targets: [...CLOUDFLARE_LLMS_TARGETS],
    results: evaluation.results
  }
}

function requiredEnvironment(environment, name) {
  const value = environment[name]
  if (!value) {
    throw new TypeError(`${name} is required`)
  }
  return value
}

function evidencePath(arguments_) {
  const index = arguments_.indexOf('--evidence-out')
  if (index < 0 || !arguments_[index + 1] || arguments_.length !== 2) {
    throw new TypeError('usage: --evidence-out PATH')
  }
  return arguments_[index + 1]
}

function managedIssueOutcome(status) {
  return status === 'passed' ? 'success' : status === 'failed' ? 'failure' : 'indeterminate'
}

async function writeGithubOutput(outputPath, status) {
  if (outputPath) {
    await appendFile(outputPath, `issue_outcome=${managedIssueOutcome(status)}\n`, 'utf8')
  }
}

export async function runCloudflareLlmsCacheRuleCli(
  {arguments_ = process.argv.slice(2), environment = process.env, fetchImpl = fetchStable, now = () => new Date(), logger = console} = {}
) {
  let outputPath
  let evidence
  const observedAt = now().toISOString()
  try {
    outputPath = evidencePath(arguments_)
    evidence = await auditCloudflareLlmsCacheRules({
      accountId: requiredEnvironment(environment, 'CLOUDFLARE_ACCOUNT_ID'),
      zoneId: requiredEnvironment(environment, 'CLOUDFLARE_ZONE_ID'),
      apiToken: requiredEnvironment(environment, 'CLOUDFLARE_API_TOKEN'),
      fetchImpl,
      observedAt
    })
  } catch (error) {
    evidence = {
      specVersion: 1,
      checkId: 'cloudflare-llms-cache-rules',
      status: 'unknown',
      observedAt,
      targets: [...CLOUDFLARE_LLMS_TARGETS],
      results: [{id: 'cloudflare-rule-audit-unavailable', status: 'unknown', target: null, evidence: error instanceof Error ? error.message : String(error)}]
    }
  }
  if (outputPath) {
    await mkdir(dirname(outputPath), {recursive: true})
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await writeGithubOutput(environment.GITHUB_OUTPUT, evidence.status)
  }
  for (const result of evidence.results) {
    const writer = result.status === 'passed' ? logger.log : logger.error
    writer.call(logger, `${result.status.toUpperCase()}: ${result.id}: ${result.evidence}`)
  }
  return evidence.status === 'passed' ? 0 : 1
}

if (isMain(import.meta.url)) {
  void runCloudflareLlmsCacheRuleCli().then((exitCode) => {
    process.exitCode = exitCode
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
