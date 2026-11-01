// The value-free pages, checked at build time and compiled into the Worker (atlas decision 0164 row 1;
// owner decision 2026-11-01, option B).
//
// The Worker no longer runs its allowlist on these pages when it serves them, so this suite measures
// the guarantee that replaced that check: the build's gate (scripts/build-value-free.mjs, which runs
// the Worker's own `checkFragments` through src/lib/composed/artifact.ts `checkValueFreeSet`) on the
// exact bytes the Worker holds. The gate fails the build on every page the allowlist refuses, at the
// rigor of tests/unit/composed-fragment.property.test.ts (the same seeded mutation corpus, 4,000 runs,
// and the parse5 tree check on every page it admits). The compiled module is this build's composer's
// set byte for byte, held by exactly one Worker module; the build ships no value-free asset; and the
// Worker serves each variant byte-identical to the splice of the composer's fragments into the compiled
// shell, which is the page it served from the asset before. It still checks the build and the shell fit.
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import fc from 'fast-check'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {
  type CheckedValueFreeSet,
  checkFragments,
  COMPOSED_FRAGMENT_IDS,
  toWireFacts,
  VALUE_FREE_FRAGMENT_OPTIONS,
  type ValueFreeSet
} from '../../src/lib/composed/artifact'
import type {PublishedRead} from '../../src/lib/composed/published'
import type {ComposedRead} from '../../src/lib/composed/read'
import {assemble} from '../../src/lib/composed/shell'
import {SHELL} from '../../src/lib/composed/shell.generated'
import {compiledValueFree, VALUE_FREE_VARIANTS, valueFreeFor} from '../../src/lib/composed/value-free'
import {VALUE_FREE_SET, VALUE_FREE_SHA256} from '../../src/lib/composed/value-free.generated'
import {type DashboardRenderDeps, renderDashboard, SSR_DATA_HEADER} from '../../src/lib/data-plane/ssr-response'
import {checkCompiledValueFree, composedValueFree, VALUE_FREE_MODULE, valueFreeModule, valueFreeSha256} from '../../scripts/build-value-free.mjs'
import {bundlesNaming} from '../../scripts/lib/build-gates.mjs'
import {buildId} from '../../scripts/lib/build-id.mjs'
import {clientDir} from '../../scripts/lib/build-paths.mjs'
import {mutateFragment, mutation, treeProblems} from '../shared/fragment-mutations'

const BUILD = buildId()
const COMPILED = compiledValueFree({VALUE_FREE_SET, VALUE_FREE_SHA256})
const NOW = Date.parse('2026-11-01T12:00:00.000Z')

/** The value-free pages this build's composer composes now: what the Worker read from the asset before. */
let composed: ValueFreeSet

beforeAll(async () => {
  composed = (await composedValueFree(BUILD)) as ValueFreeSet
}, 60_000)

afterEach(() => {
  vi.restoreAllMocks()
})

/** The set with variant `key`'s fragment `id` replaced, with the facts the composer would publish for it. */
function withFragment(key: string, id: string, fragment: string): ValueFreeSet {
  const page = VALUE_FREE_SET.variants[key]
  if (page === undefined) {
    throw new Error(`no variant ${key}`)
  }
  const fragments = {...page.fragments, [id]: fragment}
  const checked = checkFragments(fragments, VALUE_FREE_FRAGMENT_OPTIONS)
  const facts = checked.ok ? toWireFacts(checked.facts) : page.facts
  return {...VALUE_FREE_SET, variants: {...VALUE_FREE_SET.variants, [key]: {...page, fragments, facts}}}
}

describe('the compiled value-free module (atlas decision 0164 row 1)', () => {
  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it('is the module this build wrote, from its own composer, after the gate', () => {
    expect(VALUE_FREE_SET.build).toBe(BUILD)
    expect(readFileSync(VALUE_FREE_MODULE, 'utf8')).toBe(valueFreeModule(composed, BUILD))
    // Byte for byte: the JSON text the Worker holds is the composer's, the text the asset carried.
    expect(JSON.stringify(VALUE_FREE_SET)).toBe(JSON.stringify(composed))
    expect(VALUE_FREE_SHA256).toBe(valueFreeSha256(composed))
  })

  it('holds exactly the variants the Worker asks for, each admitted by the Worker allowlist with its own facts', () => {
    expect(Object.keys(VALUE_FREE_SET.variants)).toEqual([...VALUE_FREE_VARIANTS])
    for (const [key, page] of Object.entries(VALUE_FREE_SET.variants)) {
      const checked = checkFragments(page.fragments, VALUE_FREE_FRAGMENT_OPTIONS)
      expect(checked.ok, key).toBe(true)
      expect(checked.ok && toWireFacts(checked.facts), key).toEqual(page.facts)
      for (const id of COMPOSED_FRAGMENT_IDS) {
        expect(treeProblems(page.fragments[id], id), `${key} ${id}`).toEqual([])
      }
    }
  })

  it('is held by exactly one Worker module', () => {
    expect(bundlesNaming(VALUE_FREE_SHA256)).toHaveLength(1)
  })

  it('fails the post-build check on another module, another sha256, or a bundle that holds it zero or two times', () => {
    const source = readFileSync(VALUE_FREE_MODULE, 'utf8')
    const bundle = mkdtempSync(path.join(tmpdir(), 'value-free-bundle-'))
    try {
      const check = (moduleText: string, sha256: string, holders: number) => {
        rmSync(bundle, {recursive: true, force: true})
        mkdirSync(bundle)
        for (let i = 0; i < holders; i++) {
          writeFileSync(path.join(bundle, `chunk-${i}.mjs`), `var marker = "${sha256}"`)
        }
        return () =>
          checkCompiledValueFree({source, moduleText, compiled: {VALUE_FREE_SET, VALUE_FREE_SHA256: sha256}, build: BUILD, serverDirectory: bundle})
      }
      expect(check(source, VALUE_FREE_SHA256, 1)()).toBe('chunk-0.mjs')
      expect(check(`${source} `, VALUE_FREE_SHA256, 1)).toThrow('not the checked pages')
      expect(check(source, '0'.repeat(64), 1)).toThrow('do not match the sha256')
      expect(check(source, VALUE_FREE_SHA256, 0)).toThrow('0 Worker modules')
      expect(check(source, VALUE_FREE_SHA256, 2)).toThrow('2 Worker modules')
    } finally {
      rmSync(bundle, {recursive: true, force: true})
    }
  })

  it('ships no value-free asset: the composer is the only file under _ssr/', () => {
    expect(readdirSync(path.join(clientDir(), '_ssr')).filter((file) => !/^composer-[A-Za-z0-9._-]+\.mjs$/.test(file))).toEqual([])
  })
})

describe('the build gate refuses a hostile value-free page (atlas decision 0164 row 1)', () => {
  const cardHR = VALUE_FREE_SET.variants.Work?.fragments.cardHR ?? ''
  const afterRoot = (insert: string) => cardHR.replace(/^(<div\b[^>]*>)/, `$1${insert}`)
  const inRoot = (attribute: string) => cardHR.replace(/^<div\b/, `<div${attribute}`)

  it.each([
    ['a script element', afterRoot('<script>alert(1)</script>'), 'element'],
    ['an event handler attribute', inRoot(' onclick="alert(1)"'), 'attribute'],
    ['a javascript: link', afterRoot('<a href="javascript:alert(1)">x</a>'), 'url'],
    ['a link to a host off the allowlist', afterRoot('<a href="https://evil.example/">x</a>'), 'url'],
    ['a comment', afterRoot('<!-- x -->'), 'markup'],
    ["another component's full-viewport class", afterRoot('<div class="glitch-page"></div>'), 'class'],
    ["another card's root id", afterRoot('<span id="cardSystem"></span>'), 'id'],
    ['a fixed full-viewport style', inRoot(' style="position:fixed;inset:0"'), 'style'],
    ['an unclosed element', afterRoot('<span>'), 'nesting'],
    ['a source age', inRoot(' data-generated-at="2026-01-01T00:00:00.000Z"'), 'data']
  ])('fails the build on %s', (_name, fragment, reason) => {
    expect(fragment).not.toBe(cardHR)
    expect(() => valueFreeModule(withFragment('Work', 'cardHR', fragment), BUILD)).toThrow(`(Work:cardHR:${reason})`)
  })

  it('fails the build on a set another build composed, or facts the Worker check does not read', () => {
    expect(() => valueFreeModule(VALUE_FREE_SET, `${BUILD}-other`)).toThrow('(build)')
    const unreadable = VALUE_FREE_SET.variants.unreadable
    const forged = {...VALUE_FREE_SET, variants: {...VALUE_FREE_SET.variants, unreadable: {...unreadable, facts: {...unreadable?.facts, ids: []}}}}
    expect(() => valueFreeModule(forged, BUILD)).toThrow('(unreadable:facts)')
  })

  // The seeded corpus of tests/unit/composed-fragment.property.test.ts, on the pages the build compiles in.
  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it('fails the build on every mutation the Worker allowlist refuses, and compiles in only pages parse5 reads as allowlisted', () => {
    let admitted = 0
    let refused = 0
    fc.assert(fc.property(fc.constantFrom(...VALUE_FREE_VARIANTS), mutation, (key, {id, edits}) => {
      const fragment = mutateFragment(VALUE_FREE_SET.variants[key]?.fragments[id] ?? '', edits)
      const set = withFragment(key, id, fragment)
      const checked = checkFragments(set.variants[key]?.fragments ?? {}, VALUE_FREE_FRAGMENT_OPTIONS)
      if (!checked.ok) {
        refused++
        expect(() => valueFreeModule(set, BUILD)).toThrow(`(${key}:${checked.detail})`)
        return true
      }
      admitted++
      expect(valueFreeModule(set, BUILD)).toContain(JSON.stringify(fragment))
      const problems = treeProblems(fragment, id)
      if (problems.length > 0) {
        throw new Error(`${key} ${id}: admitted ${JSON.stringify(edits)} but parse5 reads ${problems.join('; ')}`)
      }
      return true
    }), {numRuns: 4_000, seed: 20261101})
    // Not vacuous: the run exercised both sides of the gate. Measured 2026-11-01 on web 4.6.0: 210
    // admitted, 3,790 refused. The floor leaves room for a design-system release that changes the pages.
    expect(admitted).toBeGreaterThan(100)
    expect(refused).toBeGreaterThan(1_000)
  }, 180_000)
})

describe('the Worker serves the compiled pages (atlas decision 0164 row 1)', () => {
  /** The dashboard's dependencies with the compiled shell and set: the published read, or the artifact read for the gate. */
  function deps(valueFree: () => CheckedValueFreeSet | null, read: {published: PublishedRead} | {artifact: ComposedRead}): DashboardRenderDeps {
    return {
      read: async () => {
        if (!('artifact' in read)) {
          throw new Error('the composed artifact must not be read on the published path')
        }
        return read.artifact
      },
      now: () => NOW,
      asset: async (_path, method) => new Response(method === 'HEAD' ? null : 'data-free page', {status: 200, headers: {'Content-Type': 'text/html'}}),
      shell: async () => SHELL,
      valueFree,
      ...('published' in read ? {published: {read: async () => read.published, shell: SHELL}} : {})
    }
  }
  const TIMING = {focusMs: 1, fragmentsMs: null}
  const READS: [string, {published: PublishedRead} | {artifact: ComposedRead}, string][] = [
    ['Work', {published: {kind: 'hiding', currentFocus: 'Work', focusAgeMs: 1_000, timing: TIMING}}, 'suppressed'],
    ['Do Not Disturb', {published: {kind: 'hiding', currentFocus: 'Do Not Disturb', focusAgeMs: 1_000, timing: TIMING}}, 'suppressed'],
    ['gate', {artifact: {kind: 'suppressed', currentFocus: null}}, 'suppressed'],
    ['unreadable', {published: {kind: 'focus-unreadable', reason: 'focus-missing', timing: TIMING}}, 'unavailable']
  ]

  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it.each(READS)('serves %s byte-identical to the splice of the composer fragments into the compiled shell', async (key, read, summary) => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await renderDashboard(new Request('https://jonathanlloyd.me/'), deps(() => valueFreeFor(BUILD, COMPILED), read))
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
    expect(composed.variants[key]?.summary).toBe(summary)
    expect(await response.text()).toBe(assemble(SHELL, composed.variants[key]?.fragments ?? {}, summary))
  })

  it.each(READS)('refuses %s from another build: the data-free page answers', async (_key, read, summary) => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await renderDashboard(new Request('https://jonathanlloyd.me/'), deps(() => valueFreeFor(`${BUILD}-other`, COMPILED), read))
    expect(response.headers.get(SSR_DATA_HEADER)).toBe(summary)
    expect(await response.text()).toBe('data-free page')
  })
})
