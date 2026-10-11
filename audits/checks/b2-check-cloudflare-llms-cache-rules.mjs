#!/usr/bin/env node

import {appendFile, mkdir, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts.ts'
import {FEED_ARTIFACTS} from '../../functions/_lib/feed-artifacts.ts'
import {fetchStable, isMain} from '../lib/http.mjs'
import {publishMeasured} from '../lib/measurement.mjs'

// The three canonical URLs, derived from the portal contract rather than
// restated (atlas decision 0119 D2): the site origin plus the same paths the
// serving proxies register. The discovery path comes through
// functions/_lib/llms-artifacts.ts, which reads the contract's generated
// distribution registry.
export const CLOUDFLARE_LLMS_TARGETS = Object.freeze([
  `${SITE_URL}${LLMS_TXT_PATH}`,
  `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`,
  `${SITE_URL}${LLM_CONTENT_PATHS.indexMarkdown}`
])

// The two feed URLs (atlas decision 0160, PR 0b). They are gated paths
// of the same backend focus gate and are served by the same proxy factory, but a zone edge
// cache stored and replayed them ahead of the Pages Function: on 2026-10-08 both answered
// `cf-cache-status: HIT` with `Age` up to 796 s while sending `s-maxage=60`. Any rule that
// can make Cloudflare store them is the same defect as for the trio. Derived from the feed
// registry the routes themselves read, not restated.
export const CLOUDFLARE_FEED_TARGETS = Object.freeze(FEED_ARTIFACTS.map((artifact) => artifact.siteUrl))

// Every gated proxy URL this runner judges.
export const CLOUDFLARE_GATED_TARGETS = Object.freeze([...CLOUDFLARE_LLMS_TARGETS, ...CLOUDFLARE_FEED_TARGETS])

// A18 coverage declaration (atlas decision 0145). The registered estate surface this
// runner measures. The artifact it holds is the Cloudflare rule inventory, but the
// property it judges is a DECLARED property of llm-outputs: that surface's registry
// node carries `external_dependency.cloudflare_edge_cache_ttl: required-unverified`
// ("account-level rules can override response headers"), and every finding here is
// keyed to one of the CLOUDFLARE_GATED_TARGETS above. Since atlas decision 0160 PR 0b it
// also judges the two `rss-feed` URLs. Metadata only -- the hub reads it statically from
// the source; nothing imports it.
export const ARTIFACTS = [{surfaceId: 'llm-outputs'}, {surfaceId: 'rss-feed'}]

const API_BASE = 'https://api.cloudflare.com/client/v4'
const UNKNOWN = Symbol('unknown')

// The two HTTP statuses that mean CLOUDFLARE REFUSED THE READ. A refused read is
// UNMEASURED, never waived: the finding names the missing token permission, and the run
// publishes the real count (0 when every read is refused), which wedges the tier.
const REFUSAL_STATUSES = new Set([401, 403])

// The Cloudflare API token permission groups each read needs. NO Cloudflare doc states which
// permission allows GET on the zone phase entrypoint:
//
//   - The phase entrypoint GET operation page lists "Account Rulesets Read" among its accepted
//     permissions and lists no Cache Rules group
//     (https://developers.cloudflare.com/api/resources/rulesets/subresources/phases/methods/get/).
//   - The permissions reference lists "Cache Rules Read" at zone scope
//     (https://developers.cloudflare.com/fundamentals/api/reference/permissions/).
//   - The documented WRITE set for Cache Rules is "Zone > Cache Rules > Edit" plus "Account
//     Rulesets > Edit" (plus "Account Filter Lists > Edit")
//     (https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/).
//
// So the zone cache-phase reads name BOTH `Zone > Cache Rules > Read` and `Account > Account
// Rulesets > Read`, mirroring the write set. The docs do not confirm the exact read group for
// the entrypoint GET; the finding text says so. The account phases answer "not allowed at
// account level" regardless of permission. Page Rules: "Page Rules Read" at zone scope
// (https://developers.cloudflare.com/api/resources/page_rules/methods/list/).
export const PERMISSIONS_ZONE_CACHE_PHASE_READ = Object.freeze(['Zone > Cache Rules > Read', 'Account > Account Rulesets > Read'])
export const PERMISSIONS_ACCOUNT_PHASE_READ = Object.freeze(['Account > Account Rulesets > Read'])
export const PERMISSIONS_PAGE_RULES_READ = Object.freeze(['Zone > Page Rules > Read'])

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
    const rawOpening = character === 'r' ? expression.slice(index).match(/^r(#*)"/) : null
    if (rawOpening) {
      // RAW STRING: no escape sequences. The bytes between the delimiters are taken
      // verbatim (https://developers.cloudflare.com/ruleset-engine/rules-language/values/).
      const closing = `"${rawOpening[1]}`
      const start = index + rawOpening[0].length
      const end = expression.indexOf(closing, start)
      if (end < 0) {
        throw new SyntaxError('unterminated raw string')
      }
      tokens.push({type: 'value', value: expression.slice(start, end)})
      index = end + closing.length
      continue
    }
    if (character === '"') {
      // QUOTED STRING: only `\"` and `\\` are escapes. Any other escape is a SyntaxError,
      // which the caller reads as UNKNOWN, never as a guessed decoding.
      let value = ''
      index++
      let closed = false
      while (index < expression.length) {
        const current = expression[index++]
        if (current === '"') {
          closed = true
          break
        }
        if (current === '\\') {
          const next = expression[index++]
          if (next !== '"' && next !== '\\') {
            throw new SyntaxError('unsupported string escape')
          }
          value += next
        } else {
          value += current
        }
      }
      if (!closed) {
        throw new SyntaxError('unterminated string')
      }
      tokens.push({type: 'value', value})
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

// The evaluator judges the gated URL, not one request. A field is decidable ONLY if it is the
// same for EVERY request to the gated path. The path, the host and the extension of the last
// path segment are. The query string, the full URI, the scheme (`ssl`), the method and the
// response code vary between requests (`/llms.txt?x=1` reaches the same rules with a different
// `http.request.uri`), so each is UNKNOWN. A definite answer for them would be a guess about
// one request, and a wrong definite answer is the failure mode this evaluator must not have.
function fieldValue(name, request) {
  const url = new URL(request.url)
  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  const values = {
    'cf.zone.name': url.hostname,
    'http.host': url.hostname,
    'http.request.uri.path': url.pathname,
    'http.request.uri.path.extension': lastSegment.includes('.') ? lastSegment.slice(lastSegment.lastIndexOf('.') + 1) : ''
  }
  return Object.hasOwn(values, name) ? values[name] : UNKNOWN
}

// Wildcard patterns (https://developers.cloudflare.com/ruleset-engine/rules-language/operators/).
// `wildcard` is case-insensitive; `strict wildcard` is case-sensitive. Scanned left to right:
// `\*` is a literal `*`, `\\` is a literal backslash, a bare `*` is any run of characters.
// Any other backslash, or `**`, is UNKNOWN (null): the docs leave it open.
function wildcardRegex(pattern, strict = false) {
  let source = ''
  for (let position = 0; position < pattern.length; position++) {
    const character = pattern[position]
    if (character === '\\') {
      const next = pattern[position + 1]
      if (next !== '*' && next !== '\\') {
        return null
      }
      source += `\\${next}`
      position++
    } else if (character === '*') {
      if (pattern[position + 1] === '*') {
        return null
      }
      source += '.*'
    } else {
      source += character.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, strict ? 's' : 'is')
}

// `matches` uses Rust regex semantics (https://developers.cloudflare.com/ruleset-engine/rules-language/operators/).
// JavaScript's engine differs, so a pattern is compiled only when every construct it uses has
// the same meaning in both: literals, `.`, `^`, `$`, `|`, groups and `(?:`, quantifiers
// (`* + ?`, `{n}`, `{n,}`, `{n,m}`, lazy forms), simple character classes, and backslash
// escapes of PUNCTUATION. Everything else -- `\z`, `\A`, inline flags, named groups, `\d`
// `\w` `\s` `\b` (Unicode in Rust, ASCII in JavaScript), POSIX or nested classes -- is UNKNOWN (null).
function rustRegex(pattern) {
  let position = 0
  while (position < pattern.length) {
    const character = pattern[position]
    if (character === '\\') {
      if (!/^[^A-Za-z0-9]$/u.test(pattern[position + 1] ?? 'a')) {
        return null
      }
      position += 2
    } else if (character === '(') {
      if (pattern[position + 1] === '?') {
        if (pattern.slice(position, position + 3) !== '(?:') {
          return null
        }
        position += 3
      } else {
        position++
      }
    } else if (character === '[') {
      position++
      if (pattern[position] === '^') {
        position++
      }
      if (pattern[position] === ']') {
        return null
      }
      while (pattern[position] !== ']') {
        const inner = pattern[position]
        if (inner === undefined || inner === '[') {
          return null
        }
        if (inner === '\\') {
          if (!/^[^A-Za-z0-9]$/u.test(pattern[position + 1] ?? 'a')) {
            return null
          }
          position += 2
          continue
        }
        if (['&&', '--', '~~'].includes(pattern.slice(position, position + 2))) {
          return null
        }
        position++
      }
      position++
    } else if (character === '{') {
      const quantifier = pattern.slice(position).match(/^\{\d+(?:,\d*)?\}/)
      if (!quantifier) {
        return null
      }
      position += quantifier[0].length
    } else if (character === '}' || character === ']') {
      return null
    } else {
      position++
    }
  }
  try {
    return new RegExp(pattern, 'u')
  } catch {
    return null
  }
}

function compare(left, operator, right) {
  if (left === UNKNOWN || right === UNKNOWN) {
    return UNKNOWN
  }
  if (operator === 'eq' || operator === 'ne') {
    // A string against a number is a type error in Cloudflare's language, not a mismatch.
    if (typeof left !== typeof right) {
      return UNKNOWN
    }
    return operator === 'eq' ? left === right : left !== right
  }
  if (operator === 'contains') {
    return typeof left === 'string' && typeof right === 'string' ? left.includes(right) : UNKNOWN
  }
  if (operator === 'matches') {
    if (typeof left !== 'string' || typeof right !== 'string') {
      return UNKNOWN
    }
    const expression = rustRegex(right)
    return expression ? expression.test(left) : UNKNOWN
  }
  if (operator === 'wildcard' || operator === 'strict wildcard') {
    if (typeof left !== 'string' || typeof right !== 'string') {
      return UNKNOWN
    }
    const expression = wildcardRegex(right, operator === 'strict wildcard')
    return expression ? expression.test(left) : UNKNOWN
  }
  // Ordering is decided for numbers only. Cloudflare's string ordering is not specified here.
  if (['gt', 'ge', 'lt', 'le'].includes(operator) && typeof left === 'number' && typeof right === 'number') {
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
      // Every argument must be a string. `starts_with(path, 5)` and the like are UNKNOWN,
      // never a coerced guess.
      if (!arguments_.every((value) => typeof value === 'string')) {
        return UNKNOWN
      }
      if (token.value === 'starts_with' && arguments_.length === 2) {
        return arguments_[0].startsWith(arguments_[1])
      }
      if (token.value === 'ends_with' && arguments_.length === 2) {
        return arguments_[0].endsWith(arguments_[1])
      }
      if (token.value === 'lower' && arguments_.length === 1) {
        return arguments_[0].toLowerCase()
      }
      if (token.value === 'upper' && arguments_.length === 1) {
        return arguments_[0].toUpperCase()
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
      // Cloudflare separates set members with spaces. A comma is not that syntax, so the
      // expression is rejected (UNKNOWN) rather than read as if it were.
      if (peek(',')) {
        throw new SyntaxError('set members are separated by spaces, not commas')
      }
      if (!tokens[index]) {
        throw new SyntaxError('unterminated set')
      }
    }
    take()
    if (left === UNKNOWN || values.some((value) => value === UNKNOWN)) {
      return UNKNOWN
    }
    if (values.some((value) => typeof value !== typeof left)) {
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
    const result = parser(tokenize(expression), {url})
    return result === true ? 'matches' : result === false ? 'disjoint' : 'unknown'
  } catch {
    return 'unknown'
  }
}

// Cache Rule settings, each judged on its own because the last matching rule wins PER
// SETTING. Cloudflare: "If several matching rules set a value for the same setting, the
// value in the last matching rule wins"
// (https://developers.cloudflare.com/cache/how-to/cache-rules/order/); cache settings are
// non-terminating, so "the last change made by rules in the same phase will win"
// (https://developers.cloudflare.com/ruleset-engine/about/rules/). Rules at the account
// level run before the zone's rules for the same phase
// (https://developers.cloudflare.com/ruleset-engine/about/phases/).
// ASSUMPTION (the docs do not settle it): `edge_ttl` is ONE setting, so a later matching rule that
// sets `edge_ttl` replaces the earlier object as a whole, including `status_code_ttl`. The docs
// say the value in the last matching rule wins per setting and do not describe merging the
// sub-fields of one setting. A deployment that relies on merging would be mis-judged.
const REQUEST_SETTINGS = Object.freeze(['cache', 'edge_ttl', 'browser_ttl', 'cache_key'])

function requestSettingRisks(setting, parameters) {
  const risks = []
  if (setting === 'edge_ttl') {
    if (parameters.edge_ttl?.mode === 'override_origin') {
      // The mode and the TTL are the two numbers an owner needs to size the replay window, so
      // the evidence carries both rather than a bare verdict.
      const ttl = parameters.edge_ttl.default === undefined ? 'unset' : `${parameters.edge_ttl.default}s`
      risks.push(`Edge Cache TTL ignores origin cache-control (mode=override_origin, ttl=${ttl})`)
    }
    const successStatusTtl = parameters.edge_ttl?.status_code_ttl?.find((entry) => {
      if (Number(entry.value) <= 0) {
        return false
      }
      if (Number.isInteger(entry.status_code)) {
        return entry.status_code === 200
      }
      const from = Number(entry.status_code_range?.from ?? 100)
      const to = Number(entry.status_code_range?.to ?? 599)
      return from <= 200 && to >= 200
    })
    if (successStatusTtl) {
      risks.push(`Edge Cache TTL status override caches HTTP 200 for ${successStatusTtl.value} seconds`)
    }
  } else if (setting === 'browser_ttl') {
    if (parameters.browser_ttl?.mode === 'override_origin' && Number(parameters.browser_ttl.default) > 0) {
      risks.push('Browser Cache TTL overrides origin cache-control')
    }
  } else if (setting === 'cache_key') {
    const customKey = parameters.cache_key?.custom_key
    if (customKey?.header || customKey?.cookie || customKey?.user || parameters.cache_key?.cache_by_device_type) {
      risks.push('custom cache key prevents a complete bare-URL purge')
    }
  }
  return risks
}

// Whether the request is bypassed from the cache. `yes`: every possible outcome is
// `cache: false`. `no`: none is. `maybe`: a rule whose expression this evaluator cannot
// decide could flip it.
function bypassState(chain) {
  if (chain.length === 0 || !chain.some((candidate) => candidate.parameters.cache === false)) {
    return 'no'
  }
  return chain[0].definite && chain.every((candidate) => candidate.parameters.cache === false) ? 'yes' : 'maybe'
}

// Judge the request-phase rules (account rules first, then zone rules, each in ruleset
// order) for one URL with last-match-wins per setting. A chain holds the candidates that
// could still be the effective rule for a setting: a rule that definitely matches resets
// the chain, a rule this evaluator cannot decide is appended to it.
function requestRuleFindings(orderedRules, target) {
  const findings = []
  const chains = Object.fromEntries(REQUEST_SETTINGS.map((setting) => [setting, []]))
  for (const [source, rule] of orderedRules) {
    if (rule.enabled === false) {
      continue
    }
    const applicability = expressionApplicability(rule.expression, target)
    if (applicability === 'disjoint') {
      continue
    }
    if (rule.action === 'execute') {
      // The executed ruleset is not expanded, so what it sets is unknown even when this rule
      // definitely matches. Never failed: a wrong definite answer is the failure mode.
      findings.push(findingFor(source, rule, target, applicability, 'executes another cache ruleset that this response did not expand', 'unknown'))
      continue
    }
    if (rule.action !== 'set_cache_settings') {
      // `skip` or a future action. Not modelled, so not silently ignored.
      findings.push(findingFor(source, rule, target, applicability, `action "${rule.action}" is not modelled`, 'unknown'))
      continue
    }
    const parameters = rule.action_parameters ?? {}
    for (const setting of REQUEST_SETTINGS) {
      if (parameters[setting] === undefined) {
        continue
      }
      const definite = applicability === 'matches'
      if (definite) {
        chains[setting].length = 0
      }
      chains[setting].push({source, rule, definite, parameters})
    }
  }
  const bypass = bypassState(chains.cache)
  for (const setting of REQUEST_SETTINGS.filter((name) => name !== 'cache')) {
    const chain = chains[setting]
    // A bypassed response is never stored, so its Edge TTL and cache key cannot replay it.
    // Browser TTL is a different header on a different cache, so bypass does not excuse it.
    if (bypass === 'yes' && setting !== 'browser_ttl') {
      continue
    }
    const everyOutcomeRisky = chain.length > 0 && chain[0].definite &&
      chain.every((candidate) => requestSettingRisks(setting, candidate.parameters).length > 0)
    for (const candidate of chain) {
      for (const risk of requestSettingRisks(setting, candidate.parameters)) {
        // Edge TTL is a setting of "Eligible for cache"
        // (https://developers.cloudflare.com/cache/how-to/cache-rules/settings/). The docs do not
        // say an Edge TTL alone makes a response eligible, so without a definite `cache: true`
        // earlier in the chain the override is UNKNOWN, not a finding.
        const eligible = setting !== 'edge_ttl' || (chains.cache.length > 0 && chains.cache[0].definite)
        const decided = everyOutcomeRisky && bypass === 'no' && eligible
        findings.push(findingFor(candidate.source, candidate.rule, target, candidate.definite ? 'matches' : 'unknown', risk, decided ? 'failed' : 'unknown'))
      }
    }
  }
  return findings
}

function responseRuleRisks(rule) {
  if (rule.action === 'execute') {
    return ['executes another cache response ruleset that this response did not expand']
  }
  if (rule.action !== 'set_cache_control') {
    return [`action "${rule.action}" is not modelled`]
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

// A Page Rule URL pattern with no scheme matches BOTH http and https
// (https://developers.cloudflare.com/rules/page-rules/), so it is matched against the URL with
// the scheme removed. A pattern with a scheme is matched against the full URL. A definite
// answer needs certainty: `matches` only when the pattern matches the bare gated URL exactly
// as written; `disjoint` only when no variant matches either. The docs leave case and query
// behaviour open, so a pattern that matches only after a case change, a query suffix or a
// scheme swap is UNKNOWN.
function pageRuleApplicability(rule, url) {
  const urlTargets = (rule.targets ?? []).filter((target) => target.target === 'url')
  if (urlTargets.length === 0) {
    return 'unknown'
  }
  const withoutScheme = (value) => value.replace(/^https?:\/\//i, '')
  const decisions = urlTargets.map((target) => {
    const pattern = String(target.constraint?.value ?? '')
    const hasScheme = /^https?:\/\//i.test(pattern)
    const subject = hasScheme ? url : withoutScheme(url)
    const sensitive = wildcardRegex(pattern, true)
    const insensitive = wildcardRegex(pattern, false)
    if (!sensitive || !insensitive) {
      return 'unknown'
    }
    if (sensitive.test(subject)) {
      return 'matches'
    }
    const variants = [subject, `${subject}?x=1`, `${subject}/`]
    if (hasScheme) {
      variants.push(url.replace(/^https:/, 'http:'))
    }
    return variants.some((variant) => insensitive.test(variant)) ? 'unknown' : 'disjoint'
  })
  if (decisions.includes('disjoint')) {
    return 'disjoint'
  }
  return decisions.every((decision) => decision === 'matches') ? 'matches' : 'unknown'
}

function findingFor(source, rule, target, applicability, risk, status = applicability === 'matches' ? 'failed' : 'unknown') {
  const identifier = rule.id ?? rule.ref ?? 'unidentified-rule'
  const description = rule.description ? ` (${rule.description})` : ''
  return {
    id: `${source}-${identifier}`,
    status,
    target,
    evidence: `${source} rule ${identifier}${description}: ${risk}; applicability=${applicability}; expression=${JSON.stringify(rule.expression ?? null)}`
  }
}

export function evaluateCloudflareLlmsCacheRules(inventory) {
  const results = []
  const orderedRequestRules = [
    ...(inventory.accountRequestRules ?? []).map((rule) => ['account-cache-rule', rule]),
    ...(inventory.zoneRequestRules ?? []).map((rule) => ['zone-cache-rule', rule])
  ]
  for (const target of CLOUDFLARE_GATED_TARGETS) {
    results.push(...requestRuleFindings(orderedRequestRules, target))
  }
  // Response rules are judged rule by rule, conservatively: any applicable risky rule is
  // reported. Modelling set/remove sequencing per directive is not needed while the zone
  // has no http_response_cache_settings entrypoint (HTTP 404, measured 2026-10-11).
  const responseSources = [
    ['account-cache-response-rule', inventory.accountResponseRules ?? []],
    ['zone-cache-response-rule', inventory.zoneResponseRules ?? []]
  ]
  for (const [source, rules] of responseSources) {
    for (const rule of rules) {
      if (rule.enabled === false) {
        continue
      }
      const risks = responseRuleRisks(rule)
      if (risks.length === 0) {
        continue
      }
      for (const target of CLOUDFLARE_GATED_TARGETS) {
        const applicability = expressionApplicability(rule.expression, target)
        if (applicability === 'disjoint') {
          continue
        }
        // An action this evaluator does not expand is UNKNOWN even when the rule definitely matches.
        const status = rule.action === 'set_cache_control' && applicability === 'matches' ? 'failed' : 'unknown'
        for (const risk of risks) {
          results.push(findingFor(source, rule, target, applicability, risk, status))
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
    for (const target of CLOUDFLARE_GATED_TARGETS) {
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

// How Cloudflare answers the reads that are NOT a rule collection and NOT a refusal. Each
// is matched on HTTP status AND message, because the documented evidence is the message:
//
//   not-applicable  HTTP 400 `phase "<phase>" not allowed at account level`. Measured
//                   2026-10-11 for http_request_cache_settings and
//                   http_response_cache_settings on the account. The entrypoint cannot
//                   exist, so there is nothing to hold and nothing to be blind to.
//   empty           HTTP 404 `could not find entrypoint ruleset`. The zone has no rule in
//                   that phase. The Rulesets API documents the 404 for a missing entrypoint
//                   (https://developers.cloudflare.com/ruleset-engine/rulesets-api/view/),
//                   an authoritative "nothing there".
//
// Cloudflare documents no error code for either, so no code is matched; matching an
// invented one would be a guess. Any other 400 or 404 is an error, never an empty set.
const NOT_ALLOWED_AT_ACCOUNT_LEVEL = /not allowed at account level/i
const ENTRYPOINT_NOT_FOUND = /could not find entrypoint/i

// Page Rules reject account-owned tokens: HTTP 400, code 1011, "Page Rules endpoint does not
// support account owned tokens" (cloudflare/cloudflare-docs issue 23256; the compatibility
// matrix at https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/
// marks Page Rules unsupported). Only a user-owned token can read them.
const PAGE_RULES_ACCOUNT_TOKEN_CODE = 1011
const PAGE_RULES_ACCOUNT_TOKEN_MESSAGE = /does not support account owned tokens/i
const PAGE_RULES_ACCOUNT_TOKEN_REASON = 'Page Rules endpoint does not support account owned tokens; only a user-owned CLOUDFLARE_API_TOKEN can read them'

function errorMessages(payload) {
  return [...(payload?.errors ?? []), ...(payload?.messages ?? [])].map((entry) => String(entry?.message ?? '')).filter(Boolean).join('; ')
}

async function apiGet(path, label, permissions, token, sensitiveValues, fetchImpl) {
  const response = await fetchImpl(`${API_BASE}${path}`, {method: 'GET', headers: {Accept: 'application/json', Authorization: `Bearer ${token}`}})
  let payload = null
  try {
    payload = await response.json()
  } catch {
    // A status-only error is sufficient and avoids logging an untrusted body.
  }
  const rawMessage = errorMessages(payload)
  if (response.status === 404 && ENTRYPOINT_NOT_FOUND.test(rawMessage)) {
    return {kind: 'empty', result: null, resultInfo: null}
  }
  if (response.status === 400 && NOT_ALLOWED_AT_ACCOUNT_LEVEL.test(rawMessage)) {
    return {kind: 'not-applicable', result: null, resultInfo: null}
  }
  if (!response.ok || payload?.success !== true) {
    const detail = safeApiMessage(payload, sensitiveValues)
    // The STATUS travels with the error, not just inside its message: the census counts
    // refusals, and re-reading that out of a redacted, truncated, prose message would be a guess.
    const accountOwnedTokenRejected = response.status === 400 &&
      ((payload?.errors ?? []).some((entry) => entry?.code === PAGE_RULES_ACCOUNT_TOKEN_CODE) || PAGE_RULES_ACCOUNT_TOKEN_MESSAGE.test(rawMessage))
    const named = permissions.map((name) => `"${name}"`).join(' and ')
    const missingPermission = REFUSAL_STATUSES.has(response.status)
      ? `; unmeasured: the token needs the permission${
        permissions.length > 1 ? 's' : ''
      } ${named} (Cloudflare docs do not confirm the exact read group for this endpoint)`
      : ''
    throw Object.assign(new Error(`${label} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}${missingPermission}`), {
      status: response.status,
      accountOwnedTokenRejected
    })
  }
  return {kind: 'held', result: payload.result, resultInfo: payload.result_info ?? null}
}

async function rulesetRules(scope, identifier, phase, token, sensitiveValues, fetchImpl) {
  const label = `${scope === 'accounts' ? 'account' : 'zone'} ${phase} entrypoint`
  const permission = scope === 'accounts' ? PERMISSIONS_ACCOUNT_PHASE_READ : PERMISSIONS_ZONE_CACHE_PHASE_READ
  const response = await apiGet(`/${scope}/${identifier}/rulesets/phases/${phase}/entrypoint`, label, permission, token, sensitiveValues, fetchImpl)
  if (response.kind !== 'held') {
    return {rules: [], notApplicable: response.kind === 'not-applicable'}
  }
  if (!response.result || !Array.isArray(response.result.rules)) {
    throw new Error(`${scope} ${phase} response had no rules array`)
  }
  return {rules: response.result.rules, notApplicable: false}
}

async function activePageRules(zoneId, token, sensitiveValues, fetchImpl) {
  const rules = []
  let page = 1
  while (true) {
    let response
    try {
      response = await apiGet(`/zones/${zoneId}/pagerules?status=active&per_page=50&page=${page}`, 'active Page Rules', PERMISSIONS_PAGE_RULES_READ, token,
        sensitiveValues, fetchImpl)
    } catch (error) {
      if (error?.accountOwnedTokenRejected) {
        // UNMEASURED, with the reason an owner can act on. Not a refusal: the token is valid
        // and the zone is reachable; Cloudflare serves this one endpoint to user-owned
        // tokens only.
        throw Object.assign(new Error(`${error.message}; ${PAGE_RULES_ACCOUNT_TOKEN_REASON}`), {status: error.status})
      }
      throw error
    }
    if (response.kind !== 'held' || !Array.isArray(response.result)) {
      throw new Error('Page Rules response was not an array')
    }
    rules.push(...response.result)
    const totalPages = Number(response.resultInfo?.total_pages ?? 1)
    if (page >= totalPages) {
      return {rules, notApplicable: false}
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
  let held = 0
  let refused = 0
  let notApplicable = 0
  for (let index = 0; index < requests.length; index++) {
    const [name] = requests[index]
    const result = settled[index]
    if (result.status === 'fulfilled') {
      // HELD AND JUDGED, which is what `measured` counts everywhere in this lane. An
      // absent ruleset (HTTP 404) counts: the API answered authoritatively that there is
      // nothing there, and that answer is judged like any other.
      held++
      if (result.value.notApplicable) {
        notApplicable++
      }
      inventory[name] = result.value.rules
    } else {
      if (REFUSAL_STATUSES.has(Number(result.reason?.status))) {
        refused++
      }
      inventory.gaps.push({
        id: `cloudflare-${name}-unavailable`,
        evidence: redactSensitive(result.reason instanceof Error ? result.reason.message : result.reason, sensitiveValues)
      })
    }
  }
  const evaluation = evaluateCloudflareLlmsCacheRules(inventory)
  return {
    specVersion: 3,
    checkId: 'cloudflare-llms-cache-rules',
    status: evaluation.status,
    observedAt,
    targets: [...CLOUDFLARE_GATED_TARGETS],
    // specVersion 3 added `notApplicable`: reads Cloudflare answered with "phase not allowed at
    // account level". They count in `held` and cannot alone lift a run out of darkness.
    // specVersion 2 added this block (atlas decision 0142 step 5.4). It is what lets a
    // reader of the uploaded artifact answer "did this run reach Cloudflare at all?"
    // without inferring it from a prose evidence string, and it is the input to
    // `measurementDeclaration` below.
    measurement: {sources: requests.length, held, refused, notApplicable},
    results: evaluation.results
  }
}

/**
 * The step's own `measured` declaration, or `null` when the run never got far enough to
 * make one.
 *
 * It is the REAL count, never a waiver:
 *
 *   held - notApplicable  the count. n rule collections were held and judged. "Not allowed
 *                         at account level" answers hold no artifact, so they are subtracted:
 *                         two such answers must not hide a refused zone token behind a
 *                         non-zero count.
 *   nothing held          `0`. Every read was refused (HTTP 401 or 403), or failed some other
 *                         way. The ping script wedges the tier on a literal zero, which is the
 *                         honest "unmeasured" signal until the token can read. Each refused
 *                         read's finding names the permission it lacks.
 *   never classified      `null`, so the step publishes NOTHING. An empty field with a
 *                         non-benign outcome is `crashed-before-measuring` in
 *                         audits/healthchecks-ping.sh, the correct reading of a usage error,
 *                         an absent credential, or a runner that died.
 */
export function measurementDeclaration(evidence) {
  const measurement = evidence?.measurement
  if (!measurement || !Number.isInteger(measurement.held) || !Number.isInteger(measurement.sources)) {
    return null
  }
  // An account-phase 400 "not allowed at account level" holds no artifact, so it is not counted.
  // The not-applicable count stays in the evidence only.
  const notApplicable = Number.isInteger(measurement.notApplicable) ? measurement.notApplicable : 0
  return Math.max(measurement.held - notApplicable, 0)
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

async function writeGithubOutput(outputPath, evidence) {
  if (!outputPath) {
    return
  }
  await appendFile(outputPath, `issue_outcome=${managedIssueOutcome(evidence.status)}\n`, 'utf8')
  const declaration = measurementDeclaration(evidence)
  if (declaration !== null) {
    // Published through the one measurement writer (audits/lib/measurement.mjs), with this
    // file's own already-open output path rather than the ambient $GITHUB_OUTPUT, so the
    // injected-environment seam the CLI is tested through stays honest. A `null`
    // declaration writes NOTHING on purpose: silence is the crashed-before-measuring
    // signal, and a placeholder would be the falsified record this change removes.
    publishMeasured(declaration, {outputPath})
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
      targets: [...CLOUDFLARE_GATED_TARGETS],
      results: [{id: 'cloudflare-rule-audit-unavailable', status: 'unknown', target: null, evidence: error instanceof Error ? error.message : String(error)}]
    }
  }
  if (outputPath) {
    await mkdir(dirname(outputPath), {recursive: true})
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await writeGithubOutput(environment.GITHUB_OUTPUT, evidence)
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
