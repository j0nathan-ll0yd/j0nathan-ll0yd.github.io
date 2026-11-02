// @vitest-environment node
//
// The value-free pages the build compiles into the Worker (atlas decision 0164 row 1; owner decision
// 2026-11-01): the build's gate (src/lib/composed/artifact.ts `checkValueFreeSet`), which runs the
// Worker's own allowlist and refuses the whole set on any finding, and the Worker's lookup
// (src/lib/composed/value-free.ts), which serves only a set its own build compiled. These run on a
// synthetic set, without a build; tests/build/value-free-module.test.ts runs the gate on the real one.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  checkFragments,
  checkValueFreeSet,
  COMPOSED_FRAGMENT_IDS,
  toWireFacts,
  VALUE_FREE_FRAGMENT_OPTIONS,
  type ValueFreeSet
} from '../../src/lib/composed/artifact'
import {compiledValueFree, loadCompiledValueFree, VALUE_FREE_VARIANTS, valueFreeFor, valueFreeVariant} from '../../src/lib/composed/value-free'

const SCOPE = 'data-astro-cid-abc12345'

/** Fragments the allowlist admits on a value-free page: each component's bare root. */
function fragmentsWith(overrides: Record<string, string> = {}): Record<string, string> {
  return {...Object.fromEntries(COMPOSED_FRAGMENT_IDS.map((id) => [id, `<div id="${id}" ${SCOPE}></div>`])), ...overrides}
}

/** A set as the composer returns it: every variant, with the facts the Worker's own check reads. */
function composed(build = 'b', overrides: Record<string, string> = {}): ValueFreeSet {
  const fragments = fragmentsWith(overrides)
  const checked = checkFragments(fragments, VALUE_FREE_FRAGMENT_OPTIONS)
  const facts = checked.ok ? toWireFacts(checked.facts) : {ids: [], scopes: {}, roots: {}}
  const variants = Object.fromEntries(
    VALUE_FREE_VARIANTS.map((key) => [key, {summary: key === 'unreadable' ? 'unavailable' : 'suppressed', fragments, facts}])
  )
  return {build, variants} as ValueFreeSet
}

/** The set with variant `key` replaced (`undefined` removes it). */
function withVariant(key: string, page: unknown): unknown {
  const set = composed()
  const variants: Record<string, unknown> = {...set.variants, [key]: page}
  if (page === undefined) {
    delete variants[key]
  }
  return {...set, variants}
}

describe('checkValueFreeSet: the build gate on the value-free pages', () => {
  it('admits a set of its own build, with the facts of the Worker allowlist', () => {
    const set = composed()
    expect(checkValueFreeSet(set, 'b', VALUE_FREE_VARIANTS)).toEqual({ok: true, set})
  })

  const work = composed().variants.Work
  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it.each([
    ['a set of another build', composed('other'), 'build'],
    ['a set with no variants', {build: 'b'}, 'shape'],
    ['a variant the Worker does not ask for', withVariant('Sleep', work), 'Sleep:unexpected'],
    ['a missing variant', withVariant('gate', undefined), 'gate:missing'],
    ['an unknown summary', withVariant('Work', {...work, summary: 'live'}), 'Work:summary'],
    ['a hiding page that is not suppressed', withVariant('Work', {...work, summary: 'unavailable'}), 'Work:summary'],
    ['an unreadable page that is not unavailable', withVariant('unreadable', {...work, summary: 'suppressed'}), 'unreadable:summary'],
    [
      'a missing fragment',
      withVariant('Work', {...work, fragments: Object.fromEntries(Object.entries(work?.fragments ?? {}).filter(([id]) => id !== 'cardHR'))}),
      'Work:fragments'
    ],
    ['a fragment that is not text', withVariant('Work', {...work, fragments: {...work?.fragments, cardHR: 42}}), 'Work:cardHR:missing'],
    ['a fragment the Worker does not splice', withVariant('Work', {...work, fragments: {...work?.fragments, extra: '<div></div>'}}), 'Work:fragments'],
    ['a fragment the allowlist refuses', composed('b', {cardHR: `<div id="cardHR" ${SCOPE}><script>alert(1)</script></div>`}), 'Work:cardHR:element'],
    ['facts the Worker check does not read', withVariant('Work', {...work, facts: {...work?.facts, ids: ['cardHR']}}), 'Work:facts']
  ])('refuses %s', (_name, set, detail) => {
    expect(checkValueFreeSet(set, 'b', VALUE_FREE_VARIANTS)).toEqual({ok: false, detail})
  })
})

describe('the compiled set: the Worker serves only its own build', () => {
  const compiled = compiledValueFree({VALUE_FREE_SET: composed('b'), VALUE_FREE_SHA256: 'f'.repeat(64)})

  it('holds each variant with its facts as sets, for the shell check', () => {
    const page = compiled.set.variants.Work
    expect(page?.fragments).toEqual(fragmentsWith())
    expect(page?.facts.ids).toEqual(new Set(COMPOSED_FRAGMENT_IDS))
    expect(page?.facts.scopes.cardHR).toEqual(new Set([SCOPE]))
    expect(compiled.sha256).toBe('f'.repeat(64))
  })

  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it('serves the set its own build compiled, and nothing to another build or a Worker with none', () => {
    expect(valueFreeFor('b', compiled)).toBe(compiled.set)
    expect(valueFreeFor('c', compiled)).toBeNull()
    expect(valueFreeFor('b', null)).toBeNull()
    // `unknown` is the id of a build without one: it never proves the same build (review L9).
    expect(valueFreeFor('unknown', compiledValueFree({VALUE_FREE_SET: composed('unknown'), VALUE_FREE_SHA256: 'f'.repeat(64)}))).toBeNull()
  })

  it('looks up each variant by the read, and no other key', () => {
    const {set} = compiled
    expect(valueFreeVariant(set, {kind: 'suppressed', currentFocus: 'Work'})).toBe(set.variants.Work)
    expect(valueFreeVariant(set, {kind: 'suppressed', currentFocus: 'Do Not Disturb'})).toBe(set.variants['Do Not Disturb'])
    expect(valueFreeVariant(set, {kind: 'suppressed', currentFocus: null})).toBe(set.variants.gate)
    expect(valueFreeVariant(set, {kind: 'focus-unreadable'})).toBe(set.variants.unreadable)
    for (const currentFocus of ['Sleep', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(valueFreeVariant(set, {kind: 'suppressed', currentFocus}), currentFocus).toBeNull()
    }
  })
})

describe('the compiled set at start-up (review of website #429, M3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A module that skipped the gate: every variant's facts lack `roots`. */
  function malformed(): ValueFreeSet {
    const set = composed('b')
    const variants = Object.fromEntries(
      Object.entries(set.variants).map(([key, page]) => [key, {...page, facts: {ids: page.facts.ids, scopes: page.facts.scopes}}])
    )
    return {...set, variants} as unknown as ValueFreeSet
  }

  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it('answers null for a module that does not convert, and logs why, where the conversion alone would throw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const generated = {VALUE_FREE_SET: malformed(), VALUE_FREE_SHA256: 'f'.repeat(64)}
    // The conversion the Worker runs at module scope throws on this module: unguarded, every route fails.
    expect(() => compiledValueFree(generated)).toThrow(TypeError)
    expect(loadCompiledValueFree(generated)).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('[value-free] the compiled value-free pages cannot be used')
    // So the Worker holds no set: hiding and unreadable answers serve the data-free page.
    expect(valueFreeFor('b', loadCompiledValueFree(generated))).toBeNull()
  })

  it('loads a module that converts, and nothing from a bundle that has none, without a log line', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(loadCompiledValueFree({VALUE_FREE_SET: composed('b'), VALUE_FREE_SHA256: 'f'.repeat(64)})?.set.build).toBe('b')
    expect(loadCompiledValueFree(undefined)).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })
})
